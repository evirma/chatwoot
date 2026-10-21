# EVIRMA: Read-only cross-channel history uses the widget's existing contact authentication.
class Api::V1::Widget::ContactHistoryController < Api::V1::Widget::BaseController
  def index
    history = Widget::ContactHistory.new(@contact, account: @current_account)
    render json: { payload: history.messages(excluding_inbox: @web_widget.inbox, contact_inbox: @contact_inbox) }
  end
end
