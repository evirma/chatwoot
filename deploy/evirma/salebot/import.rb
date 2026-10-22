require 'csv'
require 'json'
require 'optparse'

# EVIRMA: one-off SaleBot migration script; kept as one readable file
# rubocop:disable Metrics/ClassLength, Metrics/AbcSize, Metrics/CyclomaticComplexity, Metrics/MethodLength, Metrics/PerceivedComplexity, Metrics/ParameterLists, Rails/SkipsModelValidations, Style/MultilineBlockChain
# Historical records must bypass callbacks, including labels and ContactInbox.
class EvirmaSalebotImport
  ACCOUNT_ID = 1
  BATCH_SIZE = 200
  TIME_ZONE = 'Europe/Moscow'.freeze
  REPORT_HEADERS = ['ID', 'Имя', 'Мессенджер', 'Тег', 'Заполненная заявка', 'Успех', 'Состояние воронки'].freeze
  MAPPING_HEADERS = %w[salebot_client_id client_type contact_id conversation_id messages_inserted messages_skipped
                       max_user_id chatwoot_contact_id chatwoot_conversation_id status reason contact_action conversation_action].freeze

  def self.run(argv = ARGV, output: $stdout)
    options = { dry_run: true, output: output }
    parser = OptionParser.new do |cli|
      cli.banner = 'rails runner deploy/evirma/salebot/import.rb -- [options]'
      %w[clients report mapping-out].each do |key|
        cli.on("--#{key} VALUE") { |value| options[key.tr('-', '_').to_sym] = value }
      end
      %w[telegram-inbox max-inbox].each do |key|
        cli.on("--#{key} ID", Integer) { |value| options[key.tr('-', '_').to_sym] = value }
      end
      cli.on('--dry-run') { options[:dry_run] = true }
      cli.on('--apply') { options[:dry_run] = false }
      cli.on('--limit N', Integer) { |value| options[:limit] = value }
      cli.on('-h', '--help') do
        output.puts cli
        throw :help
      end
    end
    args = argv.dup
    args.shift if args.first == '--'
    raise OptionParser::InvalidArgument, 'choose --apply OR --dry-run' if args.include?('--apply') && args.include?('--dry-run')

    return if catch(:help) { parser.parse!(args) }.nil?

    raise OptionParser::InvalidArgument, args.join(' ') if args.any?

    %i[clients report telegram_inbox max_inbox mapping_out].each do |key|
      raise OptionParser::MissingArgument, "--#{key.to_s.tr('_', '-')}" unless options.key?(key)
    end
    new(**options).perform
  end

  def initialize(clients:, report:, telegram_inbox:, max_inbox:, mapping_out:, dry_run: true, limit: nil, output: $stdout)
    raise ArgumentError, '--limit must be positive' if limit && limit <= 0

    @account = Account.find(ACCOUNT_ID)
    @inboxes = { 1 => @account.inboxes.find(telegram_inbox), 20 => @account.inboxes.find(max_inbox) }
    raise ArgumentError, '--telegram-inbox must be Channel::Telegram' unless @inboxes.fetch(1).telegram?
    raise ArgumentError, '--max-inbox must be Channel::Api' unless @inboxes.fetch(20).api?

    @clients_path = clients
    @report_path = report
    @mapping_path = mapping_out
    @dry_run = dry_run
    @limit = limit
    @output = output
    @zone = Time.find_zone!(TIME_ZONE)
    @stats = Hash.new(0)
    @contacts = {}
    @bindings = {}
    @conversations = {}
    @tags = {}
    @seen_messages = {}
    @users = @account.users.index_by { |user| user.email.downcase }
  end

  def perform
    @report = read_report
    lines = File.foreach(@clients_path, encoding: 'bom|utf-8').lazy.with_index(1)
    lines = lines.take(@limit) if @limit
    # Exclusive creation protects source files and mappings from previous attempts.
    CSV.open(@mapping_path, 'wx', write_headers: true, headers: MAPPING_HEADERS) do |csv|
      lines.each_slice(BATCH_SIZE) do |batch|
        results = ApplicationRecord.transaction { batch.map { |line, number| import_line(line, number) } }
        results.each do |result|
          csv << MAPPING_HEADERS.map { |header| result[header] }
          @output.puts JSON.generate(result)
        end
        csv.flush
        refresh_label_cache unless @dry_run
      end
    end
    summary = { mode: @dry_run ? 'dry-run' : 'apply', time_zone: TIME_ZONE, totals: @stats }
    @output.puts JSON.generate(summary)
    summary
  end

  private

  def read_report
    rows = CSV.read(@report_path, headers: true, col_sep: ';', encoding: 'bom|utf-8')
    missing = REPORT_HEADERS - (rows.headers || [])
    raise ArgumentError, "CSV missing columns: #{missing.join(', ')}" if missing.any?

    rows.each_with_object({}) do |row, report|
      id = row.fetch('ID')
      raise ArgumentError, "CSV blank or duplicate ID: #{id.inspect}" if id.blank? || report.key?(id)

      report[id] = row
    end
  end

  def import_line(line, number)
    payload = JSON.parse(line)
    client = payload.fetch('client')
    id = client.fetch('id').to_s
    result = { 'salebot_client_id' => id, 'client_type' => client.fetch('client_type'),
               'messages_inserted' => 0, 'messages_skipped' => 0 }
    type = client.fetch('client_type')
    platform_id = client.fetch('platform_id').to_s
    reason = 'unsupported client_type' unless @inboxes.key?(type)
    reason ||= 'non-numeric Telegram platform_id' if type == 1 && !platform_id.match?(/\A[0-9]+\z/)
    reason ||= 'empty platform_id' if platform_id.empty?
    if reason
      @stats[:clients_skipped] += 1
      result['messages_skipped'] = payload.fetch('messages').size
      @stats[:messages_skipped] += result.fetch('messages_skipped')
      return result.merge('status' => 'skipped', 'reason' => reason)
    end

    messages = prepare_messages(payload.fetch('messages'))
    row = @report.fetch(id) { raise ArgumentError, "CSV has no client #{id}" }
    inbox = @inboxes.fetch(type)
    source_id = type == 1 ? platform_id : "max:#{platform_id}"
    key = [inbox.id, source_id]
    binding, contact = import_contact(client, row, inbox, source_id, key, result)
    tags = import_labels(row['Состояние воронки'], row['Тег'].presence || client['tag'])
    attach_labels(contact, tags)
    conversation = import_conversation(client, binding, contact, inbox, key, messages, result) if messages.any?
    if conversation
      attach_labels(conversation, tags)
      import_messages(messages, binding, contact, conversation, key, result)
    end
    result.merge!('contact_id' => contact.id, 'conversation_id' => conversation&.id, 'status' => @dry_run ? 'dry-run' : 'imported')
    result.merge!('max_user_id' => platform_id, 'chatwoot_contact_id' => contact.id, 'chatwoot_conversation_id' => conversation&.id) if type == 20
    @stats[:clients_processed] += 1
    result
  rescue StandardError => e
    raise e.class, "JSONL line #{number}: #{e.message}", e.backtrace
  end

  def import_contact(client, row, inbox, source_id, key, result)
    id = client.fetch('id').to_s
    binding = @bindings[key] ||= ContactInbox.find_by(inbox_id: inbox.id, source_id: source_id)
    contact = binding&.contact || @contacts[id] || @account.contacts.find_by("custom_attributes ->> 'salebot_client_id' = ?", id)
    action = contact ? 'found' : 'created'
    attributes = { 'salebot_client_id' => id, 'salebot_tag' => row['Тег'].presence || client['tag'],
                   'salebot_funnel_state' => row['Состояние воронки'], 'salebot_success' => row['Успех'],
                   'salebot_application' => row['Заполненная заявка'], 'salebot_messenger' => row['Мессенджер'] }
    if contact
      raise ArgumentError, 'ContactInbox contact belongs to another account' unless contact.account_id == @account.id

      write_columns(contact, custom_attributes: contact.custom_attributes.merge(attributes))
    else
      contact = insert_record(Contact, account_id: @account.id, name: client['name'].presence || row['Имя'].to_s,
                                       custom_attributes: attributes.merge('salebot_import_created' => true),
                                       created_at: client['created_at'].present? ? timestamp(client['created_at']) : Time.current,
                                       updated_at: Time.current)
    end
    if client['client_type'] == 1
      write_columns(contact, additional_attributes: contact.additional_attributes.merge('social_telegram_user_id' => client['platform_id'].to_i))
    end
    binding ||= insert_record(ContactInbox, inbox_id: inbox.id, contact_id: contact.id, source_id: source_id,
                                            pubsub_token: ContactInbox.generate_unique_secure_token,
                                            created_at: Time.current, updated_at: Time.current)
    binding.contact = contact if @dry_run
    @bindings[key] = binding
    @contacts[id] = contact
    @stats["contacts_#{action}".to_sym] += 1
    result['contact_action'] = action
    [binding, contact]
  end

  def import_labels(funnel, tag)
    { 'funnel' => funnel, 'tag' => tag }.filter_map do |kind, value|
      next if value.blank?

      slug = value.to_s.downcase.gsub(/[^\p{L}\p{N}_-]+/, '-').gsub(/\A[-_]+|[-_]+\z/, '')
      if slug.empty?
        @stats[:labels_skipped] += 1
        @output.puts JSON.generate(status: 'label_skipped', reason: 'no valid label characters', value: value)
        next
      end
      title = "salebot-#{kind}-#{slug}"
      @tags[title] ||= begin
        if @account.labels.exists?(title: title)
          @stats[:labels_found] += 1
        else
          insert_record(Label, account_id: @account.id, title: title, created_at: Time.current, updated_at: Time.current)
          @stats[:labels_created] += 1
          @labels_changed = true
        end
        ActsAsTaggableOn::Tag.find_by(name: title) || insert_record(ActsAsTaggableOn::Tag, name: title)
      end
    end
  end

  def attach_labels(record, tags)
    return if @dry_run || tags.empty?

    scope = { taggable_type: record.class.base_class.name, taggable_id: record.id, context: 'labels' }
    existing = ActsAsTaggableOn::Tagging.where(scope).pluck(:tag_id)
    rows = tags.reject { |tag| existing.include?(tag.id) }.map { |tag| scope.merge(tag_id: tag.id, created_at: Time.current) }
    ActsAsTaggableOn::Tagging.insert_all!(rows) if rows.any?
    return unless record.is_a?(Conversation)

    names = ActsAsTaggableOn::Tag.joins(:taggings).where(taggings: scope).distinct.order(:name).pluck(:name)
    write_columns(record, cached_label_list: names.join(', '))
  end

  def import_conversation(client, binding, contact, inbox, key, messages, result)
    conversation = @conversations[key] || (binding.conversations.reorder(id: :desc).first if binding.persisted?)
    action = conversation ? 'found' : 'created'
    attributes = { 'salebot_imported' => true, 'salebot_client_id' => client.fetch('id').to_s }
    if conversation
      write_columns(conversation, custom_attributes: conversation.custom_attributes.merge(attributes))
    else
      conversation = insert_record(Conversation, account_id: @account.id, inbox_id: inbox.id, contact_id: contact.id, contact_inbox_id: binding.id,
                                                 status: Conversation.statuses.fetch('resolved'), created_at: messages.first.fetch(:created_at),
                                                 updated_at: messages.last.fetch(:created_at), last_activity_at: messages.last.fetch(:created_at),
                                                 custom_attributes: attributes.merge('salebot_import_created' => true),
                                                 additional_attributes: client['client_type'] == 1 ? { chat_id: client['platform_id'].to_i } : {})
    end
    @stats["conversations_#{action}".to_sym] += 1
    result['conversation_action'] = action
    @conversations[key] = conversation
  end

  def prepare_messages(messages)
    messages.map.with_index do |message, index|
      raise ArgumentError, 'message id is required' if message.fetch('id').blank?
      raise ArgumentError, 'client_replica must be boolean' unless [true, false].include?(message.fetch('client_replica'))

      attachments = message['attachments']
      attachments = [attachments] if attachments.is_a?(Hash)
      raise ArgumentError, 'attachments must be null, object or array' unless attachments.nil? || attachments.is_a?(Array)
      raise ArgumentError, 'message text must be a string or null' unless message['text'].nil? || message['text'].is_a?(String)

      links = (attachments || []).map do |attachment|
        url = attachment.fetch('attachment_url')
        raise ArgumentError, 'attachment_url must be a non-empty string' unless url.is_a?(String) && url.present?

        "Вложение: #{url}"
      end
      content = [message['text'].presence, *links].compact.join("\n")
      { source_id: "salebot:#{message.fetch('id')}", created_at: timestamp(message.fetch('created_at')), index: index,
        incoming: message.fetch('client_replica'), manager_email: message['manager_email'], content: content }
    end.sort_by { |message| [message.fetch(:created_at), message.fetch(:index)] }
  end

  def import_messages(messages, binding, contact, conversation, key, result)
    seen = @seen_messages[key] ||= if binding.persisted?
                                     @account.messages.where(conversation_id: binding.conversations.select(:id))
                                             .where('source_id LIKE ?', 'salebot:%').pluck(:source_id).to_set
                                   else
                                     Set.new
                                   end
    rows = messages.filter_map do |message|
      unless seen.add?(message.fetch(:source_id))
        result['messages_skipped'] += 1
        next
      end
      sender = message.fetch(:incoming) ? contact : @users[message[:manager_email].to_s.downcase]
      { account_id: @account.id, inbox_id: conversation.inbox_id, conversation_id: conversation.id,
        source_id: message.fetch(:source_id), content: message.fetch(:content), processed_message_content: message.fetch(:content),
        message_type: Message.message_types.fetch(message.fetch(:incoming) ? 'incoming' : 'outgoing'),
        content_type: Message.content_types.fetch('text'), status: Message.statuses.fetch('sent'), private: false,
        sender_type: sender&.class&.base_class&.name, sender_id: sender&.id,
        created_at: message.fetch(:created_at), updated_at: message.fetch(:created_at),
        content_attributes: { external_created_at: message.fetch(:created_at).iso8601(6) } }
    end
    Message.insert_all!(rows) if rows.any? && !@dry_run
    result['messages_inserted'] = rows.size
    @stats[:messages_inserted] += rows.size
    @stats[:messages_skipped] += result.fetch('messages_skipped')
    return if @dry_run

    latest = conversation.messages.reorder(created_at: :desc, id: :desc).pick(:created_at)
    write_columns(conversation, last_activity_at: latest) if latest
  end

  def timestamp(value)
    @zone.parse(value) || raise(ArgumentError, "invalid timestamp: #{value.inspect}")
  end

  def insert_record(model, attributes)
    return model.new(attributes) if @dry_run

    model.find(model.insert_all!([attributes], returning: %w[id]).rows.first.first)
  end

  def write_columns(record, attributes)
    @dry_run ? record.assign_attributes(attributes) : record.update_columns(attributes)
  end

  def refresh_label_cache
    return unless @labels_changed

    # Account#update_cache_key also dispatches an event; only update its Redis value.
    Redis::Alfred.setex(@account.get_prefixed_cache_key(@account.id, 'label'), Time.now.utc.to_i, Account::CACHE_KEYS_EXPIRY)
    @labels_changed = false
  end
end
# rubocop:enable Metrics/ClassLength, Metrics/AbcSize, Metrics/CyclomaticComplexity, Metrics/MethodLength, Metrics/PerceivedComplexity, Metrics/ParameterLists, Rails/SkipsModelValidations, Style/MultilineBlockChain

EvirmaSalebotImport.run if $PROGRAM_NAME == __FILE__
