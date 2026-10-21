require 'rails_helper'

# EVIRMA: Bootstrap must recheck guest ownership before merging or verifying a session.
RSpec.describe Widget::BootstrapContactService do
  let(:account) { create(:account) }
  let(:web_widget) { create(:channel_widget, account: account) }
  let(:identifier) { 'evirma-user-42' }
  let!(:identified_contact) { create(:contact, account: account, identifier: identifier) }
  let(:guest) { create(:contact, account: account) }
  let(:contact_inbox) { create(:contact_inbox, contact: guest, inbox: web_widget.inbox) }
  let(:service) do
    described_class.new(
      web_widget: web_widget, user: { identifier: identifier }, contact_inbox: contact_inbox,
      hmac_verified: true, additional_attributes: {}
    )
  end

  describe '#perform' do
    it 'does not merge a cached guest whose identifier has changed before the lock' do
      conversation = create(:conversation, account: account, inbox: web_widget.inbox, contact: guest, contact_inbox: contact_inbox)
      expect(contact_inbox.contact.identifier).to be_nil
      Contact.find(guest.id).update!(identifier: 'another-user')

      verified_inbox = service.perform

      expect(verified_inbox.contact_id).to eq(identified_contact.id)
      expect(verified_inbox).to be_hmac_verified
      expect(guest.reload.identifier).to eq('another-user')
      expect(conversation.reload.contact_id).to eq(guest.id)
      expect(contact_inbox.reload.contact_id).to eq(guest.id)
      expect(contact_inbox).not_to be_hmac_verified
    end

    it 'verifies the migrated inbox only after it belongs to the signed identifier' do
      contact_inbox

      verified_inbox = service.perform

      expect(Contact.exists?(guest.id)).to be(false)
      expect(verified_inbox.id).to eq(contact_inbox.id)
      expect(verified_inbox.contact.identifier).to eq(identifier)
      expect(contact_inbox.reload).to have_attributes(contact_id: identified_contact.id, hmac_verified: true)
    end

    it 'returns a verified user inbox when the cached guest and its inbox have been deleted' do
      service
      expect(contact_inbox.contact.identifier).to be_nil
      contact_inbox.destroy!
      guest.destroy!

      verified_inbox = service.perform

      expect(verified_inbox.contact_id).to eq(identified_contact.id)
      expect(verified_inbox.contact.identifier).to eq(identifier)
      expect(verified_inbox).to be_hmac_verified
    end
  end
end
