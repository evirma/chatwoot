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
    # EVIRMA: Concurrent identity creation must retry once and return a verified session.
    [ActiveRecord::Deadlocked, ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid].each do |error_class|
      context "when the transaction raises #{error_class.name}" do
        let(:error) do
          if error_class.name == 'ActiveRecord::RecordInvalid'
            duplicate = account.contacts.new(identifier: identifier)
            duplicate.errors.add(:identifier, :taken)
            error_class.new(duplicate)
          else
            error_class.new('concurrent bootstrap')
          end
        end

        it 'retries the transaction and returns the verified contact inbox' do
          contacts = web_widget.account.contacts
          attempts = 0
          allow(contacts).to receive(:find_or_create_by!).and_wrap_original do |original, *args, &block|
            attempts += 1
            raise error if attempts == 1

            original.call(*args, &block)
          end

          verified_inbox = service.perform

          expect(verified_inbox.contact_id).to eq(identified_contact.id)
          expect(verified_inbox).to be_hmac_verified
          expect(contacts).to have_received(:find_or_create_by!).twice
        end

        it 'propagates the error after one retry' do
          contacts = web_widget.account.contacts
          allow(contacts).to receive(:find_or_create_by!).and_raise(error)

          expect { service.perform }.to raise_error(satisfy { |raised| raised.equal?(error) })
          expect(contacts).to have_received(:find_or_create_by!).twice
        end
      end
    end

    it 'does not retry validation errors unrelated to identifier uniqueness' do
      invalid_contact = account.contacts.new(name: 'a' * 256)
      invalid_contact.validate
      error = ActiveRecord::RecordInvalid.new(invalid_contact)
      contacts = web_widget.account.contacts
      allow(contacts).to receive(:find_or_create_by!).and_raise(error)

      expect { service.perform }.to raise_error(satisfy { |raised| raised.equal?(error) })
      expect(contacts).to have_received(:find_or_create_by!).once
    end

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
