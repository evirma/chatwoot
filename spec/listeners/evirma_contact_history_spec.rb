require 'rails_helper'

# EVIRMA: Verify the listener's separate event and exact recipient set, without changing native delivery.
RSpec.describe ActionCableListener do
  let(:account) { create(:account) }
  let(:contact) { create(:contact, account: account, identifier: 'evirma-customer') }
  let(:inbox) { create(:channel_api, account: account).inbox }
  let(:conversation) { create(:conversation, account: account, contact: contact, inbox: inbox) }
  let(:message) { create(:message, account: account, conversation: conversation, message_type: :outgoing) }
  let(:event) { Events::Base.new(:'message.created', Time.zone.now, message: message) }
  let!(:web_contact_inbox) { create(:contact_inbox, contact: contact, inbox: create(:channel_widget, account: account).inbox) }

  before do
    message
    allow(ActionCableBroadcastJob).to receive(:perform_later)
  end

  it 'sends an outgoing reply only to this contact web inbox tokens in the same account' do
    second_web_inbox = create(:contact_inbox, contact: contact, inbox: create(:channel_widget, account: account).inbox)
    create(:contact_inbox, inbox: web_contact_inbox.inbox)
    create(:contact_inbox, contact: contact, inbox: create(:channel_widget).inbox)
    create(:contact_inbox, contact: contact, inbox: create(:channel_api, account: account).inbox)

    described_class.instance.message_created(event)

    expect(ActionCableBroadcastJob).to have_received(:perform_later).with(
      a_collection_containing_exactly(web_contact_inbox.pubsub_token, second_web_inbox.pubsub_token),
      'contact.history_message.created',
      hash_including(id: message.id, content: message.content, message_type: 'outgoing', channel: hash_including(label: 'max'))
    ).once
  end

  it 'also delivers incoming messages to keep the read-only history complete' do
    message.update!(message_type: :incoming, sender: contact)

    described_class.instance.message_created(event)

    expect(ActionCableBroadcastJob).to have_received(:perform_later).with(
      [web_contact_inbox.pubsub_token], 'contact.history_message.created', hash_including(id: message.id, message_type: 'incoming')
    )
  end

  it 'does not send history back to the source web inbox' do
    conversation.update!(inbox: web_contact_inbox.inbox, contact_inbox: web_contact_inbox)
    message.update!(inbox: web_contact_inbox.inbox)

    described_class.instance.message_created(event)

    expect(ActionCableBroadcastJob).not_to have_received(:perform_later).with(anything, 'contact.history_message.created', anything)
  end

  it 'does not broadcast guest history' do
    contact.update!(identifier: nil)

    described_class.instance.message_created(event)

    expect(ActionCableBroadcastJob).not_to have_received(:perform_later).with(anything, 'contact.history_message.created', anything)
  end

  it 'does not broadcast private notes, activities or templates as history' do
    message.update!(private: true)
    described_class.instance.message_created(event)
    message.update!(private: false, message_type: :activity)
    described_class.instance.message_created(event)
    message.update!(message_type: :template)
    described_class.instance.message_created(event)

    expect(ActionCableBroadcastJob).not_to have_received(:perform_later).with(anything, 'contact.history_message.created', anything)
  end
end
