# EVIRMA: Resolve bootstrap identity without an anonymous intermediate or a cross-identifier merge.
class Widget::BootstrapContactService
  pattr_initialize [:web_widget!, :user!, :contact_inbox, :hmac_verified, :additional_attributes]

  def perform
    return identify_unverified_contact unless hmac_verified

    ActiveRecord::Base.transaction do
      contact = web_widget.account.contacts.find_or_create_by!(identifier: user.fetch(:identifier)) do |record|
        record.assign_attributes(user.slice(:name).merge(additional_attributes: additional_attributes))
      end
      verified_inbox = resolve_verified_inbox(contact)
      # EVIRMA: A signed identifier does not grant ownership of another contact's email.
      attributes = user.slice(:name, :email).compact_blank
      email_contact = web_widget.account.contacts.from_email(attributes[:email]) if attributes[:email]
      attributes.delete(:email) if email_contact && email_contact.id != contact.id
      contact.assign_attributes(attributes)
      contact.discard_invalid_attrs
      contact.save! if contact.changed?
      verified_inbox
    end
  end

  private

  # EVIRMA: Keep the canonical verified link while migrating only the current guest session.
  def resolve_verified_inbox(contact)
    verified_inbox = contact.contact_inboxes.find_by(inbox_id: web_widget.inbox.id, hmac_verified: true)
    if contact_inbox && (contact_inbox.contact.identifier.blank? || contact_inbox.contact_id == contact.id)
      if contact_inbox.contact_id != contact.id
        ContactMergeAction.new(account: web_widget.account, base_contact: contact, mergee_contact: contact_inbox.contact).perform
      end
      # EVIRMA: Verified sessions must retain access to the migrated guest conversation.
      contact_inbox.reload.update!(hmac_verified: true)
      verified_inbox ||= contact_inbox
    end

    verified_inbox || ContactInboxBuilder.new(contact: contact, inbox: web_widget.inbox, hmac_verified: true).perform
  end

  # EVIRMA: Optional unsigned setUser behavior must never reuse or upgrade another verified session.
  def identify_unverified_contact
    if contact_inbox.nil? || (contact_inbox.contact.identifier.present? && contact_inbox.contact.identifier != user[:identifier])
      @contact_inbox = web_widget.create_contact_inbox(additional_attributes)
    end
    ContactIdentifyAction.new(contact: contact_inbox.contact, params: user, discard_invalid_attrs: true).perform
    contact_inbox.reload
  end
end
