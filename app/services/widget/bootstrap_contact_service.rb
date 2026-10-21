# EVIRMA: Resolve bootstrap identity without an anonymous intermediate or a cross-identifier merge.
class Widget::BootstrapContactService
  pattr_initialize [:web_widget!, :user!, :contact_inbox, :hmac_verified, :additional_attributes]

  def perform
    return identify_unverified_contact unless hmac_verified

    ActiveRecord::Base.transaction do
      guest = locked_guest_contact
      contact = find_or_create_contact
      verified_inbox = resolve_verified_inbox(contact, guest)
      update_contact(contact)
      verified_inbox
    end
  end

  private

  # EVIRMA: Lock before finding the user so two tabs sharing a guest serialize their bootstrap.
  def locked_guest_contact
    return unless contact_inbox

    web_widget.account.contacts.lock.find_by(id: contact_inbox.contact_id)
  end

  def find_or_create_contact
    web_widget.account.contacts.find_or_create_by!(identifier: user.fetch(:identifier)) do |record|
      record.assign_attributes(user.slice(:name).merge(additional_attributes: additional_attributes))
    end
  end

  # EVIRMA: A signed identifier does not grant ownership of another contact's email.
  def update_contact(contact)
    attributes = user.slice(:name, :email).compact_blank
    email_contact = web_widget.account.contacts.from_email(attributes[:email]) if attributes[:email]
    attributes.delete(:email) if email_contact && email_contact.id != contact.id
    contact.assign_attributes(attributes)
    contact.discard_invalid_attrs
    contact.save! if contact.changed?
  end

  # EVIRMA: Keep the canonical verified link while migrating only the current guest session.
  def resolve_verified_inbox(contact, guest)
    verified_inbox = contact.contact_inboxes.find_by(inbox_id: web_widget.inbox.id, hmac_verified: true)
    migrate_guest_inbox(contact, guest)
    verified_inbox || contact.contact_inboxes.find_by(inbox_id: web_widget.inbox.id, hmac_verified: true) ||
      ContactInboxBuilder.new(contact: contact, inbox: web_widget.inbox, hmac_verified: true).perform
  end

  # EVIRMA: A fresh locked read rejects a guest identified by another tab or already removed.
  def migrate_guest_inbox(contact, guest)
    return unless guest && (guest.identifier.blank? || guest.identifier == user.fetch(:identifier))

    ContactMergeAction.new(account: web_widget.account, base_contact: contact, mergee_contact: guest).perform if guest.id != contact.id

    # EVIRMA: Only verify an inbox now owned by the signed user, never an unidentified guest.
    contact.contact_inboxes.find_by(id: contact_inbox.id)&.update!(hmac_verified: true)
  end

  # EVIRMA: Optional unsigned setUser behavior must never reuse or upgrade another verified session.
  def identify_unverified_contact
    # EVIRMA: Even a legacy verified guest cannot authorize an unsigned user's conversation history.
    if contact_inbox.nil? || contact_inbox.hmac_verified? ||
       (contact_inbox.contact.identifier.present? && contact_inbox.contact.identifier != user[:identifier])
      @contact_inbox = web_widget.create_contact_inbox(additional_attributes)
    end
    ContactIdentifyAction.new(contact: contact_inbox.contact, params: user, discard_invalid_attrs: true).perform
    contact_inbox.reload
  end
end
