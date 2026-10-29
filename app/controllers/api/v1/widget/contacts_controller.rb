class Api::V1::Widget::ContactsController < Api::V1::Widget::BaseController
  include WidgetHelper

  before_action :validate_hmac, only: [:set_user]
  before_action :validate_hmac_for_identified_update, only: [:update]

  def show; end

  def update
    identify_contact(@contact)
  end

  def set_user
    # EVIRMA: Lock the cached owner before the link, then reject stale JWTs or changed ownership.
    @contact.with_lock(requires_new: true) do
      @contact_inbox.lock!
      raise ActiveRecord::RecordNotFound unless @contact_inbox.source_id == auth_token_params[:source_id] &&
                                                @contact_inbox.contact_id == @contact.id

      verified_same_identifier = @contact_inbox.hmac_verified? && @contact.identifier == permitted_params[:identifier]
      widget_auth_token = nil
      @contact_inbox, widget_auth_token = build_contact_inbox_with_token(@web_widget) if a_different_contact?

      identify_contact(@contact_inbox.contact)
      @widget_auth_token = verify_and_rotate_contact_inbox(widget_auth_token, verified_same_identifier)
    end
  end

  # TODO : clean up this with proper routes delete contacts/custom_attributes
  def destroy_custom_attributes
    @contact.custom_attributes = @contact.custom_attributes.excluding(params[:custom_attributes])
    @contact.save!
    render json: @contact
  end

  private

  # EVIRMA: Verify the final link owner before issuing either credential after a merge.
  def verify_and_rotate_contact_inbox(widget_auth_token, verified_same_identifier)
    return widget_auth_token unless should_verify_hmac?

    @contact_inbox.reload
    if @contact_inbox.contact.identifier != permitted_params[:identifier]
      render json: { error: 'HMAC failed: Invalid Identifier Hash Provided' }, status: :unauthorized
      raise ActiveRecord::Rollback
    end

    unless verified_same_identifier || widget_auth_token.present?
      @contact_inbox.source_id = SecureRandom.uuid
      @contact_inbox.pubsub_token = ContactInbox.generate_unique_secure_token
      payload = { source_id: @contact_inbox.source_id, inbox_id: @web_widget.inbox.id }
      widget_auth_token = ::Widget::TokenService.new(payload: payload).generate_token
    end
    @contact_inbox.update!(hmac_verified: true)
    widget_auth_token
  end

  def identify_contact(contact)
    contact_identify_action = ContactIdentifyAction.new(
      contact: contact,
      params: permitted_params.to_h.deep_symbolize_keys,
      discard_invalid_attrs: true
    )
    @contact = contact_identify_action.perform
  end

  def a_different_contact?
    @contact.identifier.present? && @contact.identifier != permitted_params[:identifier]
  end

  # The plain update endpoint is also used for anonymous prechat updates
  # (name/email/phone/custom_attributes with no identifier), which must keep
  # working on hmac_mandatory inboxes. Only the identity-binding path, where an
  # identifier is supplied and the contact can be rebound, requires HMAC.
  def validate_hmac_for_identified_update
    return if params[:identifier].blank?

    validate_hmac
  end

  def validate_hmac
    return unless should_verify_hmac?

    render json: { error: 'HMAC failed: Invalid Identifier Hash Provided' }, status: :unauthorized unless valid_hmac?
  end

  def should_verify_hmac?
    return false if params[:identifier_hash].blank? && !@web_widget.hmac_mandatory

    # Taking an extra caution that the hmac is triggered whenever identifier is present
    return false if params[:custom_attributes].present? && params[:identifier].blank?

    true
  end

  def valid_hmac?
    # EVIRMA: Share signature verification with identity bootstrap.
    valid_widget_hmac?(@web_widget, params[:identifier], params[:identifier_hash])
  end

  def permitted_params
    params.permit(:website_token, :identifier, :identifier_hash, :email, :name, :avatar_url, :phone_number, custom_attributes: {},
                                                                                                            additional_attributes: {})
  end
end
