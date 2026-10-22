module WidgetHelper
  # EVIRMA: Bootstrap and setUser must verify the same channel-scoped HMAC in constant time.
  def valid_widget_hmac?(web_widget, identifier, identifier_hash)
    expected_hash = OpenSSL::HMAC.hexdigest('sha256', web_widget.hmac_token, identifier.to_s)
    identifier_hash = identifier_hash.to_s
    return false unless identifier_hash.bytesize == expected_hash.bytesize

    ActiveSupport::SecurityUtils.secure_compare(identifier_hash, expected_hash)
  end

  def build_contact_inbox_with_token(web_widget, additional_attributes = {})
    contact_inbox = web_widget.create_contact_inbox(additional_attributes)
    payload = { source_id: contact_inbox.source_id, inbox_id: web_widget.inbox.id }
    token = ::Widget::TokenService.new(payload: payload).generate_token

    [contact_inbox, token]
  end
end
