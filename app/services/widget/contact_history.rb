# EVIRMA: Keep history selection, public payloads and live delivery under the same contact/account boundary.
class Widget::ContactHistory
  LIMIT = 100
  EVENT = 'contact.history_message.created'.freeze
  CHANNEL_LABELS = {
    'Channel::Telegram' => 'telegram',
    'Channel::Api' => 'max',
    'Channel::Email' => 'email',
    'Channel::WebWidget' => 'web'
  }.freeze

  def initialize(contact, account:)
    @contact = contact
    @account = account
  end

  def messages(excluding_inbox:)
    return [] if @contact.identifier.blank?

    visible_messages.where.not(inbox_id: excluding_inbox.id)
                    .includes(:sender, :attachments, :inbox, :conversation)
                    .order(created_at: :desc, id: :desc).limit(LIMIT).reverse.map { |message| payload(message) }
  end

  def broadcast(message)
    return if @contact.identifier.blank?
    return unless visible_messages.exists?(id: message.id)

    tokens = @contact.contact_inboxes.joins(:inbox)
                     .where(inboxes: { account_id: @account.id, channel_type: 'Channel::WebWidget' })
                     .where.not(inbox_id: message.inbox_id).pluck(:pubsub_token)
    return if tokens.empty?

    ActionCableBroadcastJob.perform_later(tokens.uniq, EVENT, payload(message))
  end

  private

  def visible_messages
    conversations = @contact.conversations.where(account_id: @account.id)
    Message.where(conversation_id: conversations.select(:id), account_id: @account.id,
                  private: false, message_type: [:incoming, :outgoing])
  end

  def payload(message)
    data = {
      id: message.id,
      account_id: @account.id,
      content: message.content,
      message_type: message.message_type,
      sender_type: message.sender_type,
      created_at: message.created_at.to_i,
      conversation_id: message.conversation.display_id,
      inbox_id: message.inbox_id,
      attachments: message.attachments.map(&:push_event_data),
      channel: channel_data(message.inbox)
    }
    data[:sender] = message.sender.push_event_data.slice(:name, :available_name, :avatar_url) if message.outgoing? && message.sender
    data
  end

  def channel_data(inbox)
    {
      name: inbox.name,
      channel_type: inbox.channel_type,
      label: CHANNEL_LABELS.fetch(inbox.channel_type, inbox.channel_type.delete_prefix('Channel::').downcase)
    }
  end
end
