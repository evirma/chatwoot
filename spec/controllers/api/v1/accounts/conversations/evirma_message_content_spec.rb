require 'rails_helper'

# EVIRMA: Exercise editing through the authenticated route, including sender/channel boundaries.
RSpec.describe 'Operator message text editing', type: :request do
  let(:account) { create(:account) }
  let(:agent) { create(:user, account: account, role: :agent) }
  let(:inbox) { create(:channel_widget, account: account).inbox }
  let(:conversation) { create(:conversation, account: account, inbox: inbox) }
  let!(:original_message) { create(:message, account: account, conversation: conversation, source_id: 'external-123') }
  let!(:message) do
    create(:message, account: account, conversation: conversation, sender: agent, message_type: :outgoing,
                     content: 'Original text', content_attributes: { 'in_reply_to' => original_message.id })
  end
  let(:path) { "/api/v1/accounts/#{account.id}/conversations/#{conversation.display_id}/messages/#{message.id}/content" }

  before { create(:inbox_member, inbox: inbox, user: agent) }

  it 'updates its own outgoing text, retaining metadata in the response and webhook payload' do
    patch path, params: { content: 'Edited text' }, headers: agent.create_new_auth_token, as: :json

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include('id' => message.id, 'content' => 'Edited text')
    expect(response.parsed_body['content_attributes']).to include('previous_content' => 'Original text',
                                                                  'in_reply_to_external_id' => 'external-123', 'edited_at' => be_present)
    expect(message.reload.webhook_data).to include(content: 'Edited text', content_attributes: message.content_attributes)
  end

  it 'edits a private note' do
    message.update!(private: true)
    patch path, params: { content: 'Edited note' }, headers: agent.create_new_auth_token, as: :json

    expect(response).to have_http_status(:ok)
    expect(message.reload.content).to eq('Edited note')
    expect(message).to be_private
  end

  it 'forbids editing another author even when the conversation is accessible' do
    message.update!(sender: create(:user, account: account))
    patch path, params: { content: 'Edited text' }, headers: agent.create_new_auth_token, as: :json

    expect(response).to have_http_status(:forbidden)
    expect(message.reload.content).to eq('Original text')
  end

  # EVIRMA: Both account and conversation scopes apply before message authorship.
  it 'rejects editing through another account' do
    other_account = create(:account)
    other_conversation = create(:conversation, account: other_account)
    other_message = create(:message, account: other_account, conversation: other_conversation, sender: agent,
                                     message_type: :outgoing, content: 'Other account text')
    other_path = "/api/v1/accounts/#{other_account.id}/conversations/#{other_conversation.display_id}/messages/#{other_message.id}/content"

    patch other_path, params: { content: 'Edited text' }, headers: agent.create_new_auth_token, as: :json

    expect(response).to have_http_status(:unauthorized)
    expect(other_message.reload.content).to eq('Other account text')
  end

  it 'cannot edit a message from another conversation using an accessible conversation path' do
    other_conversation = create(:conversation, account: account, inbox: inbox)
    other_message = create(:message, account: account, conversation: other_conversation, sender: agent,
                                     message_type: :outgoing, content: 'Other conversation text')
    other_path = "/api/v1/accounts/#{account.id}/conversations/#{conversation.display_id}/messages/#{other_message.id}/content"

    patch other_path, params: { content: 'Edited text' }, headers: agent.create_new_auth_token, as: :json

    expect(response).to have_http_status(:not_found)
    expect(other_message.reload.content).to eq('Other conversation text')
  end

  it 'rejects incoming messages' do
    message.update!(message_type: :incoming)
    patch path, params: { content: 'Edited text' }, headers: agent.create_new_auth_token, as: :json

    expect(response).to have_http_status(:unprocessable_entity)
    expect(message.reload.content).to eq('Original text')
  end

  it 'rejects deleted messages' do
    message.update!(content_attributes: { deleted: true })
    patch path, params: { content: 'Edited text' }, headers: agent.create_new_auth_token, as: :json

    expect(response).to have_http_status(:unprocessable_entity)
    expect(message.reload.content).to eq('Original text')
  end

  it 'rejects messages without existing text' do
    message.update!(content: nil)
    patch path, params: { content: 'Edited text' }, headers: agent.create_new_auth_token, as: :json

    expect(response).to have_http_status(:unprocessable_entity)
    expect(message.reload.content).to be_nil
  end

  [nil, '', '  ', [], { text: 'wrong shape' }, 123].each do |content|
    it "rejects malformed or blank content: #{content.inspect}" do
      patch path, params: { content: content }, headers: agent.create_new_auth_token, as: :json

      expect(response).to have_http_status(:unprocessable_entity)
      expect(message.reload.content).to eq('Original text')
    end
  end

  context 'with an email inbox' do
    let(:inbox) { create(:channel_email, account: account).inbox }

    it 'rejects editing delivered email text' do
      patch path, params: { content: 'Edited text' }, headers: agent.create_new_auth_token, as: :json

      expect(response).to have_http_status(:unprocessable_entity)
      expect(message.reload.content).to eq('Original text')
    end
  end

  context 'with a Telegram inbox' do
    let(:inbox) { create(:channel_telegram, account: account).inbox }

    before { message.update!(source_id: '456') }

    it 'enqueues remote editing after saving the local text' do
      expect do
        patch path, params: { content: 'Edited text' }, headers: agent.create_new_auth_token, as: :json
      end.to have_enqueued_job(Telegram::MessageUpdateJob).with(message.id, 'edit')
      expect(message.reload.content).to eq('Edited text')
    end

    it 'enqueues remote deletion for public outgoing messages' do
      expect do
        delete path.delete_suffix('/content'), headers: agent.create_new_auth_token, as: :json
      end.to have_enqueued_job(Telegram::MessageUpdateJob).with(message.id, 'delete')
      expect(message.reload.deleted).to be(true)
    end

    # EVIRMA: Repeated DELETE must retain delivery IDs and enqueue remote deletion exactly once.
    it 'does not enqueue another remote deletion for an already deleted message' do
      message.update!(content_attributes: { telegram_message_ids: [123, 456], telegram_text_message_id: 123 })
      delete path.delete_suffix('/content'), headers: agent.create_new_auth_token, as: :json
      expect(response).to have_http_status(:ok)

      expect do
        delete path.delete_suffix('/content'), headers: agent.create_new_auth_token, as: :json
      end.not_to have_enqueued_job(Telegram::MessageUpdateJob)

      expect(response).to have_http_status(:ok)
      expect(message.reload.content_attributes).to include('deleted' => true, 'telegram_message_ids' => [123, 456], 'telegram_text_message_id' => 123)
    end

    it 'enqueues deletion of successfully sent parts when a later attachment failed' do
      message.update!(source_id: nil, content_attributes: { telegram_message_ids: [123], telegram_text_message_id: 123 })

      expect do
        delete path.delete_suffix('/content'), headers: agent.create_new_auth_token, as: :json
      end.to have_enqueued_job(Telegram::MessageUpdateJob).with(message.id, 'delete')

      expect(message.reload.content_attributes).to include('deleted' => true, 'telegram_message_ids' => [123])
    end

    it 'does not delete incoming Telegram messages remotely' do
      message.update!(message_type: :incoming, sender: conversation.contact)
      expect do
        delete path.delete_suffix('/content'), headers: agent.create_new_auth_token, as: :json
      end.not_to have_enqueued_job(Telegram::MessageUpdateJob)
      expect(message.reload.deleted).to be(true)
    end

    it 'does not send note edits to Telegram' do
      message.update!(private: true)
      expect do
        patch path, params: { content: 'Edited note' }, headers: agent.create_new_auth_token, as: :json
      end.not_to have_enqueued_job(Telegram::MessageUpdateJob)
      expect(response).to have_http_status(:ok)
    end
  end
end
