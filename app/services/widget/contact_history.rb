# EVIRMA: Keep history selection, public payloads and live delivery under the same contact/account boundary.
class Widget::ContactHistory
  LIMIT = 100
  EVENT = 'contact.history_message.created'.freeze
  # EVIRMA: Separate updates carry edits and deletion markers without new-message notifications.
  UPDATED_EVENT = 'contact.history_message.updated'.freeze
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

    # EVIRMA: Filter before LIMIT so deleted records cannot displace visible history.
    visible_messages.where("(content_attributes #>> '{}')::jsonb ->> 'deleted' IS DISTINCT FROM 'true'").where.not(inbox_id: excluding_inbox.id)
                    .includes(:sender, :attachments, :inbox, :conversation)
                    .reorder(created_at: :desc, id: :desc).limit(LIMIT).reverse.map { |message| payload(message) }
  end

  # EVIRMA: Deleted messages still pass the contact boundary for live removal.
  def broadcast(message, event: EVENT)
    return if @contact.identifier.blank?
    return unless visible_messages.exists?(id: message.id)

    tokens = @contact.contact_inboxes.joins(:inbox)
                     .where(inboxes: { account_id: @account.id, channel_type: 'Channel::WebWidget' })
                     .where.not(inbox_id: message.inbox_id).pluck(:pubsub_token)
    return if tokens.empty?

    ActionCableBroadcastJob.perform_later(tokens.uniq, event, payload(message))
  end

  private

  def visible_messages
    conversations = @contact.conversations.where(account_id: @account.id)
    Message.where(conversation_id: conversations.select(:id), account_id: @account.id,
                  private: false, message_type: [:incoming, :outgoing])
  end

  def payload(message)
    {
      id: message.id,
      account_id: @account.id,
      content: message.content,
      # EVIRMA: Preserve edit/deletion metadata in HTTP and live history.
      content_attributes: message.content_attributes,
      message_type: message.message_type,
      sender_type: message.sender_type,
      created_at: message.created_at.to_i,
      conversation_id: message.conversation.display_id,
      inbox_id: message.inbox_id,
      attachments: message.attachments.map(&:push_event_data),
      channel: channel_data(message.inbox),
      # EVIRMA: Native widget bubbles consume the content type and sender identity.
      content_type: message.content_type,
      channel_type: message.inbox.channel_type,
      sender: sender_data(message)
    }
  end

  # EVIRMA: Reuse native sender serialization, including AgentBot's inbox avatar fallback.
  def sender_data(message)
    sender = message.merge_sender_attributes({})[:sender] || {}
    data = sender.slice(:id, :name, :available_name, :avatar_url, :type)
    return data unless message.outgoing? && !message.sender.is_a?(User)

    data.merge(name: 'Evirma', available_name: 'Evirma', type: 'agent_bot', avatar_url: sender[:avatar_url].presence || message.inbox.avatar_url)
  end

  def channel_data(inbox)
    {
      name: inbox.name,
      channel_type: inbox.channel_type,
      label: CHANNEL_LABELS.fetch(inbox.channel_type, inbox.channel_type.delete_prefix('Channel::').downcase)
    }
  end
end
