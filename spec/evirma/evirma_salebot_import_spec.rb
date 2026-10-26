require 'rails_helper'
require 'stringio'
require 'tmpdir'
require Rails.root.join('deploy/evirma/salebot/import').to_s

RSpec.describe EvirmaSalebotImport do
  let!(:account) { create(:account) }
  let!(:telegram_inbox) { create(:channel_telegram, account: account).inbox }
  let!(:max_inbox) { create(:channel_api, account: account).inbox }
  let!(:manager) { create(:user, account: account, email: 'manager@example.com') }
  let(:directory) { Dir.mktmpdir('salebot-import') }
  let(:fixtures) { Rails.root.join('deploy/evirma/salebot/fixtures') }
  let(:output) { StringIO.new }
  let(:options) do
    { clients: fixtures.join('clients.jsonl').to_s, report: fixtures.join('report.csv').to_s,
      telegram_inbox: telegram_inbox.id, max_inbox: max_inbox.id, mapping_out: File.join(directory, 'mapping.csv'), output: output }
  end

  before do
    stub_const('EvirmaSalebotImport::ACCOUNT_ID', account.id)
    clear_enqueued_jobs
  end

  after { FileUtils.remove_entry(directory) }

  it 'imports clients missing from the CSV report without funnel data', :aggregate_failures do
    report = File.join(directory, 'report.csv')
    File.write(report, File.readlines(fixtures.join('report.csv')).first)

    summary = described_class.new(**options, report: report, dry_run: false).perform

    # The fourth fixture client is skipped for its non-numeric platform_id before the report is read.
    expect(summary.fetch(:totals).fetch(:clients_without_report)).to eq(3)
    expect(account.contacts.count).to eq(3)
    expect(account.contacts.find_by!("custom_attributes ->> 'salebot_client_id' = '101'").custom_attributes['salebot_funnel_state']).to be_nil
  end

  it 'keeps SaleBot UUID tags as an attribute without creating labels', :aggregate_failures do
    report = File.join(directory, 'report.csv')
    table = CSV.read(fixtures.join('report.csv'), headers: true, col_sep: ';', encoding: 'bom|utf-8')
    table.each { |row| row['Тег'] = '2a4d3740-bd29-47af-a89c-e1e582a1b2c3' if row['ID'] == '101' }
    File.write(report, table.to_csv(col_sep: ';'))

    described_class.new(**options, report: report, dry_run: false).perform

    contact = account.contacts.find_by!("custom_attributes ->> 'salebot_client_id' = '101'")
    expect(contact.custom_attributes['salebot_tag']).to eq('2a4d3740-bd29-47af-a89c-e1e582a1b2c3')
    expect(account.labels.pluck(:title)).not_to include(a_string_including('2a4d3740'))
  end

  it 'imports contacts, channel identities, labels and chronologically ordered history', :aggregate_failures do
    summary = described_class.new(**options, dry_run: false).perform

    contact = account.contacts.find_by!("custom_attributes ->> 'salebot_client_id' = '101'")
    binding = ContactInbox.find_by!(inbox: telegram_inbox, source_id: '10001')
    conversation = binding.conversations.sole
    expect(account.contacts.count).to eq(3)
    expect(ContactInbox.where(inbox_id: [telegram_inbox.id, max_inbox.id]).count).to eq(3)
    expect(account.conversations.count).to eq(2)
    expect(account.messages.count).to eq(5)
    expect(binding.contact).to eq(contact)
    expect(binding.pubsub_token).to be_present
    expect(contact.additional_attributes).to include('social_telegram_user_id' => 10_001)
    expect(contact.custom_attributes).to include('salebot_tag' => 'VIP / Telegram', 'salebot_application' => 'Да',
                                                 'salebot_success' => 'Нет', 'salebot_messenger' => 'Telegram')
    expect(contact.label_list).to contain_exactly('salebot-funnel-заполненная-заявка', 'salebot-tag-vip-telegram')
    expect(conversation).to be_resolved
    expect(conversation.display_id).to be_positive
    expect(conversation.additional_attributes).to include('chat_id' => 10_001)
    expect(conversation.custom_attributes).to include('salebot_imported' => true)
    expect(conversation.label_list).to match_array(contact.label_list)
    expect(conversation.cached_label_list_array).to match_array(contact.label_list)
    expect(conversation.messages.pluck(:source_id)).to eq(%w[salebot:1000 salebot:1001 salebot:1002])
    expect(conversation.messages.first).to have_attributes(content: "Hello\nВложение: https://example.com/photo.jpg", sender: contact)
    expect(conversation.messages.first.content_attributes).to include('external_created_at' => '2026-10-14T03:29:26.837000+03:00')
    expect(conversation.messages.first.created_at.utc.hour).to eq(0)
    expect(conversation.created_at).to eq(conversation.messages.first.created_at)
    expect(conversation.last_activity_at).to eq(conversation.messages.last.created_at)
    expect(conversation.messages.find_by!(source_id: 'salebot:1001')).to have_attributes(sender: nil, message_type: 'outgoing',
                                                                                         content: 'Вложение: https://example.com/file.pdf')
    expect(conversation.messages.last).to have_attributes(sender: manager, message_type: 'outgoing', processed_message_content: 'Manager reply')
    expect(ContactInbox.find_by!(inbox: max_inbox, source_id: 'max:20003').conversations).to be_empty
    expect(account.labels.pluck(:title)).to contain_exactly('salebot-funnel-заполненная-заявка', 'salebot-tag-vip-telegram',
                                                            'salebot-funnel-успех', 'salebot-tag-max', 'salebot-funnel-новый')
    expect(summary[:totals]).to include(contacts_created: 3, conversations_created: 2, messages_inserted: 5, clients_skipped: 1)
  end

  it 'writes MAX mapping columns, message counts and a reason for skipped clients', :aggregate_failures do
    described_class.new(**options, dry_run: false).perform

    rows = CSV.read(options.fetch(:mapping_out), headers: true).index_by { |row| row['salebot_client_id'] }
    binding = ContactInbox.find_by!(inbox: max_inbox, source_id: 'max:20002')
    expect(rows.fetch('102').to_h).to include('max_user_id' => '20002', 'chatwoot_contact_id' => binding.contact_id.to_s,
                                              'chatwoot_conversation_id' => binding.conversations.sole.id.to_s, 'messages_inserted' => '2')
    expect(rows.fetch('103')['chatwoot_conversation_id']).to be_nil
    expect(rows.fetch('104').to_h).to include('status' => 'skipped', 'reason' => 'non-numeric Telegram platform_id')
    expect(output.string).to include('"clients_skipped":1')
  end

  it 'does not duplicate any imported records on a second run', :aggregate_failures do
    described_class.new(**options, dry_run: false).perform

    expect do
      described_class.new(**options, mapping_out: File.join(directory, 'again.csv'), dry_run: false).perform
    end.not_to(change do
                 [Contact.count, ContactInbox.count, Conversation.count, Message.count, Label.count,
                  ActsAsTaggableOn::Tag.count, ActsAsTaggableOn::Tagging.count]
               end)

    expect(CSV.read(File.join(directory, 'again.csv'), headers: true).sum { |row| row['messages_inserted'].to_i }).to eq(0)
    expect(output.string).to include('"messages_skipped":5')
  end

  it 'defaults to a read-only dry run, including SQL writes and the label cache', :aggregate_failures do
    writes = []
    subscriber = ActiveSupport::Notifications.subscribe('sql.active_record') do |*_args, payload|
      writes << payload[:sql] if payload[:sql].match?(/\A\s*(INSERT|UPDATE|DELETE|SELECT\s+nextval)/i)
    end
    allow(Redis::Alfred).to receive(:setex).and_call_original

    begin
      args = options.except(:output).flat_map { |key, value| ["--#{key.to_s.tr('_', '-')}", value.to_s] }
      described_class.run(['--', *args], output: output)
    ensure
      ActiveSupport::Notifications.unsubscribe(subscriber)
    end

    expect(writes).to be_empty
    expect(Redis::Alfred).not_to have_received(:setex)
    expect(account.contacts).to be_empty
    expect(account.conversations).to be_empty
    expect(account.messages).to be_empty
    expect(account.labels).to be_empty
    expect(output.string).to include('"mode":"dry-run"', '"messages_inserted":5')
    expect(CSV.read(options.fetch(:mapping_out), headers: true).first['contact_id']).to be_nil
  end

  it 'imports without events, jobs, notifications or email', :aggregate_failures do
    events = []
    allow(Rails.configuration.dispatcher).to receive(:dispatch) { |event_name, *_args| events << event_name }

    expect do
      described_class.new(**options, dry_run: false).perform
    end.not_to(change { ActionMailer::Base.deliveries.count })

    expect(events).to be_empty
    expect(enqueued_jobs).to be_empty
    expect(Notification.where(account: account)).to be_empty
  end

  it 'plans one contact when two SaleBot cards share the same platform identity' do
    payload = JSON.parse(File.foreach(fixtures.join('clients.jsonl')).first)
    payload['client']['id'] = 105
    path = File.join(directory, 'shared-platform.jsonl')
    report = File.join(directory, 'shared-platform.csv')
    File.write(path, "#{File.read(fixtures.join('clients.jsonl'))}#{payload.to_json}\n")
    File.write(report, "#{File.read(fixtures.join('report.csv'))}" \
                       "105;Another card;Telegram;VIP / Telegram;Да;Нет;Заполненная заявка;ignored\n")

    summary = described_class.new(**options, clients: path, report: report).perform

    expect(summary[:totals]).to include(contacts_created: 3, contacts_found: 1, conversations_created: 2,
                                        conversations_found: 1, messages_inserted: 5, messages_skipped: 3)
    expect(account.contacts).to be_empty
  end

  it 'reuses an existing ContactInbox and preserves live conversation state and labels', :aggregate_failures do
    contact = create(:contact, account: account, name: 'Existing', custom_attributes: { business_key: 'keep' })
    binding = create(:contact_inbox, inbox: telegram_inbox, contact: contact, source_id: '10001')
    conversation = create(:conversation, account: account, inbox: telegram_inbox, contact: contact, contact_inbox: binding,
                                         status: :open, label_list: ['existing'], custom_attributes: { business_key: 'keep' })
    live_message = create(:message, account: account, inbox: telegram_inbox, conversation: conversation, sender: contact,
                                    created_at: Time.utc(2026, 10, 22, 10))

    described_class.new(**options, dry_run: false).perform

    expect(ContactInbox.find_by!(inbox: telegram_inbox, source_id: '10001')).to eq(binding)
    expect(contact.reload).to have_attributes(name: 'Existing', custom_attributes: include('business_key' => 'keep', 'salebot_client_id' => '101'))
    expect(contact.custom_attributes).not_to have_key('salebot_import_created')
    expect(binding.conversations.reload).to contain_exactly(conversation)
    expect(conversation.reload).to be_open
    expect(conversation.custom_attributes).to include('business_key' => 'keep', 'salebot_imported' => true)
    expect(conversation.custom_attributes).not_to have_key('salebot_import_created')
    expect(conversation.cached_label_list_array).to contain_exactly('existing', 'salebot-funnel-заполненная-заявка', 'salebot-tag-vip-telegram')
    expect(conversation.last_activity_at).to eq(live_message.created_at)
  end

  it 'finds a previously imported contact by its SaleBot id when the channel binding is missing' do
    contact = create(:contact, account: account, custom_attributes: { salebot_client_id: 101, business_key: 'keep' })

    described_class.new(**options, dry_run: false).perform

    expect(ContactInbox.find_by!(inbox: telegram_inbox, source_id: '10001').contact).to eq(contact)
    expect(contact.reload.custom_attributes).to include('business_key' => 'keep')
    expect(account.contacts.count).to eq(3)
  end

  it 'does not copy old history again when a new live conversation exists', :aggregate_failures do
    described_class.new(**options, dry_run: false).perform
    binding = ContactInbox.find_by!(inbox: telegram_inbox, source_id: '10001')
    original = binding.conversations.sole
    live = create(:conversation, account: account, inbox: telegram_inbox, contact: binding.contact, contact_inbox: binding)

    expect do
      described_class.new(**options, mapping_out: File.join(directory, 'again.csv'), dry_run: false).perform
    end.not_to change(Message, :count)

    expect(original.messages.count).to eq(3)
    expect(live.messages).to be_empty
    expect(live.reload.custom_attributes).to include('salebot_imported' => true)
  end

  it 'never attributes outgoing messages to a user outside the target account' do
    create(:user, account: create(:account), email: 'outsider@example.com')

    described_class.new(**options, dry_run: false).perform

    expect(account.messages.find_by!(source_id: 'salebot:2001')).to have_attributes(message_type: 'outgoing', sender: nil)
    # SaleBot sends a bare URL string as an attachment and {} when there is none.
    expect(account.messages.find_by!(source_id: 'salebot:2000').content).to eq("MAX question\nВложение: https://example.com/voice.ogg")
    expect(account.messages.find_by!(source_id: 'salebot:2001').content).to eq('MAX answer')
  end

  it 'supports a limited trial through the CLI' do
    args = options.except(:output).flat_map { |key, value| ["--#{key.to_s.tr('_', '-')}", value.to_s] }

    described_class.run([*args, '--apply', '--limit', '1'], output: output)

    expect(account.contacts.count).to eq(1)
    expect(account.messages.count).to eq(3)
    expect(CSV.read(options.fetch(:mapping_out), headers: true).size).to eq(1)
  end

  it 'rolls back the entire client batch on a malformed line' do
    path = File.join(directory, 'broken.jsonl')
    File.write(path, "#{File.read(fixtures.join('clients.jsonl'))}{broken json}\n")

    expect do
      described_class.new(**options, clients: path, dry_run: false).perform
    end.to raise_error(JSON::ParserError, /JSONL line 5/)

    expect(account.contacts).to be_empty
    expect(account.conversations).to be_empty
    expect(account.messages).to be_empty
    expect(account.labels).to be_empty
  end

  it 'refuses a wrong channel type and non-positive limits before importing' do
    expect { described_class.new(**options, telegram_inbox: max_inbox.id) }.to raise_error(ArgumentError, /Channel::Telegram/)
    expect { described_class.new(**options, limit: 0) }.to raise_error(ArgumentError, /positive/)
    expect(account.contacts).to be_empty
  end

  it 'refuses to overwrite a previous mapping' do
    File.write(options.fetch(:mapping_out), 'previous result')

    expect { described_class.new(**options, dry_run: false).perform }.to raise_error(Errno::EEXIST)

    expect(File.read(options.fetch(:mapping_out))).to eq('previous result')
    expect(account.contacts).to be_empty
  end
end
