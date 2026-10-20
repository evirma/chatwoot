class Telegram::SendOnTelegramService < Base::SendOnChannelService
  private

  def channel_class
    Channel::Telegram
  end

  def perform_reply
    ## send reply to telegram message api
    # https://core.telegram.org/bots/api#sendmessage
    message_id = channel.send_message_on_telegram(message)
    # EVIRMA: Also persist all successfully sent IDs when a later attachment fails.
    message.source_id = message_id if message_id.present?
    message.save! if message.has_changes_to_save?
  end

  def inbox
    @inbox ||= message.inbox
  end

  def channel
    @channel ||= inbox.channel
  end
end
