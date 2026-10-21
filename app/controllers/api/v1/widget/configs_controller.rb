class Api::V1::Widget::ConfigsController < Api::V1::Widget::BaseController
  # EVIRMA: Reuse setUser signature verification before creating a bootstrap identity.
  include WidgetHelper

  before_action :set_global_config

  def create
    # EVIRMA: Resolve the signed identity before the legacy anonymous-contact fallback.
    bootstrap_contact if params.key?(:user)
    build_contact
    set_token
  end

  private

  def set_global_config
    @global_config = GlobalConfig.get(
      'LOGO_THUMBNAIL',
      'BRAND_NAME',
      'WIDGET_BRAND_URL',
      'MAXIMUM_FILE_UPLOAD_SIZE',
      'INSTALLATION_NAME'
    )
  end

  def set_contact
    # EVIRMA: A token from another inbox cannot authorize even a matching source id.
    return unless auth_token_params[:inbox_id] == @web_widget.inbox.id

    @contact_inbox = @web_widget.inbox.contact_inboxes.find_by(
      source_id: auth_token_params[:source_id]
    )
    @contact = @contact_inbox&.contact
  end

  # EVIRMA: Invalid identity falls back to a guest and reports the existing SDK error contract.
  def bootstrap_contact
    # EVIRMA: Reject malformed bootstrap objects at the request boundary instead of silently logging in a guest.
    raise ActionController::ParameterMissing, :user unless params[:user].is_a?(ActionController::Parameters)

    user = permitted_params.require(:user).to_h.symbolize_keys
    verify_hmac = user[:identifier_hash].present? || @web_widget.hmac_mandatory?
    return reject_bootstrap_user unless valid_bootstrap_user?(user, verify_hmac)

    @contact_inbox = Widget::BootstrapContactService.new(
      web_widget: @web_widget, user: user, contact_inbox: @contact_inbox,
      hmac_verified: verify_hmac, additional_attributes: additional_attributes
    ).perform
    @contact = @contact_inbox.contact
  end

  # EVIRMA: Keep request validation separate from bootstrap contact resolution.
  def valid_bootstrap_user?(user, verify_hmac)
    user[:identifier].present? && (!verify_hmac || valid_widget_hmac?(@web_widget, user[:identifier], user[:identifier_hash]))
  end

  def reject_bootstrap_user
    @set_user_error = { error: 'HMAC failed: Invalid Identifier Hash Provided' }
    @contact = @contact_inbox = nil if @contact&.identifier.present?
  end

  # EVIRMA: Bootstrap identity is accepted only as a nested request-body object.
  def permitted_params
    params.permit(:website_token, user: [:identifier, :identifier_hash, :name, :email])
  end

  def build_contact
    return if @contact.present?

    @contact_inbox = @web_widget.create_contact_inbox(additional_attributes)
    @contact = @contact_inbox.contact
  end

  def set_token
    payload = { source_id: @contact_inbox.source_id, inbox_id: @web_widget.inbox.id }
    @token = ::Widget::TokenService.new(payload: payload).generate_token
  end

  def additional_attributes
    if @web_widget.inbox.account.feature_enabled?('ip_lookup')
      { created_at_ip: request.remote_ip }
    else
      {}
    end
  end
end
