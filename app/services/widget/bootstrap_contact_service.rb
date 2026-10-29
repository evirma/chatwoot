# EVIRMA: Resolve bootstrap identity without an anonymous intermediate or a cross-identifier merge.
class Widget::BootstrapContactService
  pattr_initialize [:web_widget!, :user!, :contact_inbox, :hmac_verified, :additional_attributes]

  def perform
    return identify_unverified_contact unless hmac_verified

    retries = 0
    begin
      ActiveRecord::Base.transaction do
        guest = locked_guest_contact
        contact = find_or_create_contact
        verified_inbox = resolve_verified_inbox(contact, guest)
        update_contact(contact)
        verified_inbox
      end
    rescue ActiveRecord::Deadlocked, ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid => e
      raise if retries == 1 || (e.is_a?(ActiveRecord::RecordInvalid) && !e.record.errors.of_kind?(:identifier, :taken))

      # EVIRMA: Retry the entire rolled-back transaction once after an identity race or deadlock.
      retries += 1
      retry
    end
  end

  private

  # EVIRMA: Lock the cached owner before the link and reject ownership changed while waiting.
  def locked_guest_contact
    return unless contact_inbox

    guest = web_widget.account.contacts.lock.find_by(id: contact_inbox.contact_id)
    return unless guest

    @contact_inbox = web_widget.inbox.contact_inboxes.lock.find_by(id: contact_inbox.id)
    guest if @contact_inbox&.contact_id == guest.id
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
    return unless migratable_guest?(guest)

    ContactMergeAction.new(account: web_widget.account, base_contact: contact, mergee_contact: guest).perform if guest.id != contact.id

    # EVIRMA: Revoke both guest credentials only after the migrated link belongs to the signed user.
    migrated_inbox = contact.contact_inboxes.find_by(id: contact_inbox.id)
    return unless migrated_inbox
    return if migrated_inbox.hmac_verified? && guest.identifier == user.fetch(:identifier)

    migrated_inbox.update!(source_id: SecureRandom.uuid, pubsub_token: ContactInbox.generate_unique_secure_token, hmac_verified: true)
  end

  def migratable_guest?(guest)
    guest && (guest.identifier.blank? || guest.identifier == user.fetch(:identifier))
  end

  # EVIRMA: Optional unsigned setUser behavior must never reuse or upgrade another verified session.
  def identify_unverified_contact
    # EVIRMA: Even a legacy verified guest cannot authorize an unsigned user's conversation history.
    if contact_inbox.nil? || contact_inbox.hmac_verified? ||
       (contact_inbox.contact.identifier.present? && contact_inbox.contact.identifier != user[:identifier])
      @contact_inbox = web_widget.create_contact_inbox(additional_attributes)
    end
    # EVIRMA: An unsigned request cannot return credentials rotated by a signed request after token resolution.
    source_id = contact_inbox.source_id
    ContactIdentifyAction.new(contact: contact_inbox.contact, params: user, discard_invalid_attrs: true).perform
    contact_inbox_or_new_guest(source_id)
  end

  def contact_inbox_or_new_guest(source_id)
    contact_inbox.reload
    return web_widget.create_contact_inbox(additional_attributes) if contact_inbox.source_id != source_id

    contact_inbox
  end
end
