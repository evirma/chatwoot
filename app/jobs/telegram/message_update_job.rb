# EVIRMA: Propagate operator edits/deletions through the channel's configured Telegram relay.
class Telegram::MessageUpdateJob < ApplicationJob
  queue_as :high

  def perform(message_id, operation)
    message = Message.find(message_id)
    # EVIRMA: Reload content under the same lock held through HTTP so queued edits cannot restore stale text.
    message.with_lock do
      return if operation == 'edit' && message.deleted

      channel = message.inbox.channel
      ids, method, caption = update_targets(message, operation)
      ids.each do |id|
        body = update_body(channel, message, id, operation, caption)
        send_update(channel, method, body, message.id, operation)
      end
    end
  end

  private

  def update_targets(message, operation)
    attributes = message.content_attributes
    text_message_id = attributes['telegram_text_message_id']
    return [attributes['telegram_message_ids'].presence || [message.source_id], 'deleteMessage', nil] if operation == 'delete'

    caption = text_message_id.blank? && message.attachments.exists?
    [[text_message_id || message.source_id], caption ? 'editMessageCaption' : 'editMessageText', caption]
  end

  def update_body(channel, message, id, operation, caption)
    body = { chat_id: channel.chat_id(message), message_id: id }
    body[:business_connection_id] = channel.business_connection_id(message) if channel.business_connection_id(message).present?
    if operation == 'edit'
      body[caption ? :caption : :text] = message.outgoing_content
      body[:parse_mode] = 'HTML'
    end
    body
  end

  # EVIRMA: A rejected/dead Telegram message must not prevent deleting the rest of the album.
  def send_update(channel, method, body, message_id, operation)
    response = HTTParty.post("#{channel.telegram_api_url}/#{method}", body: body)
    return if response.success? && response.parsed_response['ok']

    Rails.logger.warn("Telegram #{operation} failed for message #{message_id}: #{response.parsed_response['description']}")
  rescue StandardError => e
    # Do not log request URLs: they contain the bot token.
    Rails.logger.warn("Telegram #{operation} failed for message #{message_id}: #{e.class.name}")
  end
end
