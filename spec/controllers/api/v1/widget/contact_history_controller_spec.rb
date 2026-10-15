require 'rails_helper'

# EVIRMA: Exercise contact isolation through the real widget authentication boundary.
RSpec.describe '/api/v1/widget/contact_history', type: :request do
  let(:account) { create(:account) }
  let(:web_widget) { create(:channel_widget, account: account) }
  let(:contact) { create(:contact, account: account, identifier: 'evirma-customer') }
  let(:contact_inbox) { create(:contact_inbox, contact: contact, inbox: web_widget.inbox) }
  let(:token) { Widget::TokenService.new(payload: { source_id: contact_inbox.source_id, inbox_id: web_widget.inbox.id }).generate_token }
  let(:other_inbox) { create(:channel_api, account: account).inbox }
  let(:conversation) { create(:conversation, account: account, contact: contact, inbox: other_inbox) }
  let!(:message) { create(:message, :with_attachment, account: account, conversation: conversation, message_type: :outgoing) }

  it 'returns public messages from other inboxes with widget attachments, sender and channel metadata' do
    incoming = create(:message, account: account, conversation: conversation, sender: contact, content: 'Customer reply')
    web_conversation = create(:conversation, account: account, contact: contact, inbox: web_widget.inbox, contact_inbox: contact_inbox)
    create(:message, account: account, conversation: web_conversation)

    get '/api/v1/widget/contact_history', params: { website_token: web_widget.website_token }, headers: { 'X-Auth-Token' => token }

    expect(response).to have_http_status(:ok)
    history = response.parsed_body['payload']
    expect(history.pluck('id')).to eq([message.id, incoming.id])
    expect(history.first).to include('id' => message.id, 'message_type' => 'outgoing', 'created_at' => message.created_at.to_i)
    expect(history.first['attachments']).to eq(message.attachments.map(&:push_event_data).as_json)
    expect(history.first['sender']).to include('name' => message.sender.name, 'avatar_url' => message.sender.avatar_url)
    expect(history.first['channel']).to include('name' => other_inbox.name, 'channel_type' => 'Channel::Api', 'label' => 'max')
  end

  it 'never returns another contact history, even if a contact id is supplied' do
    stranger = create(:contact, account: account, identifier: 'stranger')
    stranger_inbox = create(:contact_inbox, contact: stranger, inbox: web_widget.inbox)
    stranger_token = Widget::TokenService.new(payload: { source_id: stranger_inbox.source_id, inbox_id: web_widget.inbox.id }).generate_token

    get '/api/v1/widget/contact_history', params: { website_token: web_widget.website_token, contact_id: contact.id },
                                          headers: { 'X-Auth-Token' => stranger_token }

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body['payload']).to eq([])
  end

  it 'returns no history for guests' do
    contact.update!(identifier: nil)

    get '/api/v1/widget/contact_history', params: { website_token: web_widget.website_token }, headers: { 'X-Auth-Token' => token }

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body['payload']).to eq([])
  end

  it 'excludes private notes, activities and templates' do
    create(:message, account: account, conversation: conversation, private: true, content: 'Internal note')
    create(:message, account: account, conversation: conversation, message_type: :activity)
    create(:message, account: account, conversation: conversation, message_type: :template)

    get '/api/v1/widget/contact_history', params: { website_token: web_widget.website_token }, headers: { 'X-Auth-Token' => token }

    expect(response.parsed_body['payload'].pluck('id')).to eq([message.id])
  end

  it 'rejects a contact token belonging to another website' do
    different_widget = create(:channel_widget, account: account)

    get '/api/v1/widget/contact_history', params: { website_token: different_widget.website_token }, headers: { 'X-Auth-Token' => token }

    expect(response).to have_http_status(:not_found)
  end

  it 'does not expose conversations belonging to another account' do
    foreign_account = create(:account)
    foreign_conversation = create(:conversation, account: foreign_account, contact: contact)
    create(:message, account: foreign_account, conversation: foreign_conversation)

    get '/api/v1/widget/contact_history', params: { website_token: web_widget.website_token }, headers: { 'X-Auth-Token' => token }

    expect(response.parsed_body['payload'].pluck('id')).to eq([message.id])
  end

  it 'returns only the latest 100 messages in chronological order' do
    # Avoid the unrelated per-minute flood limit while populating a long history.
    older_messages = Array.new(101) do |index|
      create(:message, account: account, conversation: conversation, created_at: (200 - index).minutes.ago)
    end

    get '/api/v1/widget/contact_history', params: { website_token: web_widget.website_token }, headers: { 'X-Auth-Token' => token }

    expected_ids = older_messages.last(99).map(&:id) + [message.id]
    expect(response.parsed_body['payload'].pluck('id')).to eq(expected_ids)
  end
end
