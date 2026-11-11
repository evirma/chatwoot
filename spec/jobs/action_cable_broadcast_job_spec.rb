require 'rails_helper'

RSpec.describe ActionCableBroadcastJob do
  # EVIRMA: A job queued before a widget login must not reach the rotated guest token.
  it 'skips a pubsub token rotated after the job was queued' do
    conversation = create(:conversation)
    contact_inbox = conversation.contact_inbox
    original_pubsub_token = contact_inbox.pubsub_token
    queued_data = conversation.push_event_data.merge(account_id: conversation.account_id)
    contact_inbox.update!(source_id: SecureRandom.uuid, pubsub_token: ContactInbox.generate_unique_secure_token)
    expect(ActionCable.server).not_to receive(:broadcast)

    described_class.perform_now([original_pubsub_token], 'conversation.updated', queued_data)
  end

  # EVIRMA: Current recipients keep their events, and the payload never carries a pubsub token.
  it 'still reaches current contact, agent and account streams without leaking pubsub tokens' do
    conversation = create(:conversation)
    agent = create(:user, account: conversation.account)
    members = [conversation.contact_inbox.pubsub_token, agent.pubsub_token, "account_#{conversation.account_id}"]
    recipients = []
    allow(ActionCable.server).to receive(:broadcast) do |recipient, event|
      recipients << recipient
      expect(JSON.parse(event.to_json)['data']['contact_inbox']).not_to have_key('pubsub_token')
    end

    described_class.perform_now(members, 'conversation.updated', conversation.push_event_data.merge(account_id: conversation.account_id))

    expect(recipients).to match_array(members)
  end
end
