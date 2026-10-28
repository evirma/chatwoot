require 'rails_helper'

RSpec.describe ActionCableBroadcastJob do
  # EVIRMA: A queued update rereads the conversation after the widget credentials rotate.
  it 'does not broadcast the rotated pubsub token to the original recipient' do
    conversation = create(:conversation)
    contact_inbox = conversation.contact_inbox
    original_pubsub_token = contact_inbox.pubsub_token
    queued_data = conversation.push_event_data.merge(account_id: conversation.account_id)
    rotated_pubsub_token = ContactInbox.generate_unique_secure_token
    contact_inbox.update!(source_id: SecureRandom.uuid, pubsub_token: rotated_pubsub_token)
    broadcast = nil
    expect(ActionCable.server).to receive(:broadcast) do |recipient, event|
      expect(recipient).to eq(original_pubsub_token)
      broadcast = JSON.parse(event.to_json)
    end

    described_class.perform_now([original_pubsub_token], 'conversation.updated', queued_data)

    expect(broadcast['data']['contact_inbox']).not_to have_key('pubsub_token')
    expect(broadcast.to_json).not_to include(rotated_pubsub_token)
    expect(broadcast['data']['contact_inbox']['source_id']).to eq(contact_inbox.source_id)
  end
end
