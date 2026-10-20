# EVIRMA: Deliver cross-channel history after the native message event.
module EvirmaContactHistoryListener
  def message_created(event)
    super
    message, account = extract_message_and_account(event)
    Widget::ContactHistory.new(message.conversation.contact, account: account).broadcast(message)
  end

  def message_updated(event)
    super
    message, account = extract_message_and_account(event)
    Widget::ContactHistory.new(message.conversation.contact, account: account).broadcast(message, event: Widget::ContactHistory::UPDATED_EVENT)
  end
end
