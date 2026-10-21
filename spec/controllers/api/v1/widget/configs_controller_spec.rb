require 'rails_helper'

RSpec.describe '/api/v1/widget/config', type: :request do
  let(:account) { create(:account) }
  let(:web_widget) { create(:channel_widget, account: account) }
  let!(:contact) { create(:contact, account: account) }
  let(:contact_inbox) { create(:contact_inbox, contact: contact, inbox: web_widget.inbox) }
  let(:payload) { { source_id: contact_inbox.source_id, inbox_id: web_widget.inbox.id } }
  let(:token) { Widget::TokenService.new(payload: payload).generate_token }

  describe 'POST /api/v1/widget/config' do
    let(:params) { { website_token: web_widget.website_token } }
    let(:response_keys) { %w[website_channel_config contact global_config] }

    # EVIRMA: Bootstrap identity before allocating an anonymous widget contact.
    context 'with a bootstrap user' do
      let(:identifier) { 'evirma-user-42' }
      let(:identifier_hash) { OpenSSL::HMAC.hexdigest('sha256', web_widget.hmac_token, identifier) }
      let(:user) { { identifier: identifier, identifier_hash: identifier_hash, name: 'Customer', email: 'customer@example.com' } }
      let(:params) { { website_token: web_widget.website_token, user: user } }

      it 'creates only the identified contact and a verified link without a conversation token' do
        expect do
          post '/api/v1/widget/config', params: params, as: :json
        end.to change(Contact, :count).by(1).and change(ContactInbox, :count).by(1)

        expect(response).to have_http_status(:success)
        body = response.parsed_body
        identified_contact = account.contacts.find_by!(identifier: identifier)
        expect(identified_contact).to have_attributes(name: 'Customer', email: 'customer@example.com')
        expect(body['contact']['id']).to eq(identified_contact.id)
        decoded = Widget::TokenService.new(token: body['website_channel_config']['auth_token']).decode_token
        expect(decoded[:inbox_id]).to eq(web_widget.inbox.id)
        expect(identified_contact.contact_inboxes.find_by!(source_id: decoded[:source_id])).to be_hmac_verified
      end

      it 'reuses the existing verified contact inbox in the current channel' do
        contact.update!(identifier: identifier, email: user[:email])
        contact_inbox.update!(hmac_verified: true)

        expect do
          post '/api/v1/widget/config', params: params, as: :json
        end.not_to change(ContactInbox, :count)

        expect(response.parsed_body['contact']['pubsub_token']).to eq(contact_inbox.pubsub_token)
        expect(response.parsed_body['contact']['id']).to eq(contact.id)
      end

      it 'creates a verified link rather than reusing an unverified browser session' do
        contact.update!(identifier: identifier)
        contact_inbox

        expect do
          post '/api/v1/widget/config', params: params, as: :json
        end.to change(ContactInbox, :count).by(1)

        expect(contact_inbox.reload).not_to be_hmac_verified
        expect(response.parsed_body['contact']['pubsub_token']).not_to eq(contact_inbox.pubsub_token)
      end

      it 'merges the guest into the user and keeps the guest conversation visible with the final token' do
        identified_contact = create(:contact, account: account, identifier: identifier, email: user[:email])
        verified_link = create(:contact_inbox, contact: identified_contact, inbox: web_widget.inbox, hmac_verified: true)
        guest_conversation = create(:conversation, account: account, inbox: web_widget.inbox, contact: contact, contact_inbox: contact_inbox)

        expect do
          post '/api/v1/widget/config', params: params, headers: { 'X-Auth-Token' => token }, as: :json
        end.to change(Contact, :count).by(-1)

        body = response.parsed_body
        expect(body['contact']['id']).to eq(identified_contact.id)
        expect(body['contact']['pubsub_token']).to eq(verified_link.pubsub_token)
        expect(guest_conversation.reload.contact_id).to eq(identified_contact.id)
        expect(contact_inbox.reload).to be_hmac_verified
        get '/api/v1/widget/conversations', params: { website_token: web_widget.website_token },
                                            headers: { 'X-Auth-Token' => body['website_channel_config']['auth_token'] }
        expect(response).to have_http_status(:success)
        expect(response.parsed_body['id']).to eq(guest_conversation.display_id)
      end

      it 'ignores the conversation token of a different identified contact' do
        contact.update!(identifier: 'someone-else')
        contact_inbox

        expect do
          post '/api/v1/widget/config', params: params, headers: { 'X-Auth-Token' => token }, as: :json
        end.to change(Contact, :count).by(1)

        expect(contact.reload.identifier).to eq('someone-else')
        expect(contact_inbox.reload).not_to be_hmac_verified
        expect(response.parsed_body['contact']['identifier']).to eq(identifier)
        expect(response.parsed_body['contact']['id']).not_to eq(contact.id)
      end

      # EVIRMA: A first login can reuse the guest's email without losing its conversation.
      it 'creates an identified contact and merges a guest that already has the same email' do
        contact.update!(email: user[:email])
        guest_conversation = create(:conversation, account: account, inbox: web_widget.inbox, contact: contact, contact_inbox: contact_inbox)

        expect do
          post '/api/v1/widget/config', params: params, headers: { 'X-Auth-Token' => token }, as: :json
        end.not_to change(Contact, :count)

        expect(response).to have_http_status(:success)
        identified_contact = account.contacts.find_by!(identifier: identifier)
        expect(identified_contact.email).to eq(user[:email])
        expect(guest_conversation.reload.contact_id).to eq(identified_contact.id)
        expect(contact_inbox.reload.contact_id).to eq(identified_contact.id)
        expect(contact_inbox).to be_hmac_verified
      end

      it 'ignores a token signed for another inbox even if its source id exists in this inbox' do
        other_widget = create(:channel_widget, account: account)
        other_token = Widget::TokenService.new(payload: { source_id: contact_inbox.source_id, inbox_id: other_widget.inbox.id }).generate_token

        post '/api/v1/widget/config', params: params, headers: { 'X-Auth-Token' => other_token }, as: :json

        expect(contact.reload.identifier).to be_nil
        expect(contact_inbox.reload).not_to be_hmac_verified
        expect(response.parsed_body['contact']['id']).not_to eq(contact.id)
      end

      it 'creates a link only in the requested inbox for an existing account contact' do
        contact.update!(identifier: identifier)
        other_widget = create(:channel_widget, account: account)
        other_link = create(:contact_inbox, inbox: other_widget.inbox, contact: contact, hmac_verified: true)

        post '/api/v1/widget/config', params: params, as: :json

        body = response.parsed_body
        expect(body['contact']['id']).to eq(contact.id)
        expect(body['contact']['pubsub_token']).not_to eq(other_link.pubsub_token)
        decoded = Widget::TokenService.new(token: body['website_channel_config']['auth_token']).decode_token
        expect(decoded[:inbox_id]).to eq(web_widget.inbox.id)
      end

      it 'does not resolve a matching identifier from another account' do
        foreign_contact = create(:contact, identifier: identifier)

        post '/api/v1/widget/config', params: params, as: :json

        expect(response.parsed_body['contact']['id']).not_to eq(foreign_contact.id)
        expect(account.contacts.find_by!(identifier: identifier).id).to eq(response.parsed_body['contact']['id'])
      end

      it 'allows a repeated setUser without creating or merging contacts' do
        post '/api/v1/widget/config', params: params, as: :json
        body = response.parsed_body

        expect do
          patch '/api/v1/widget/contact/set_user', params: user.merge(website_token: web_widget.website_token),
                                                  headers: { 'X-Auth-Token' => body['website_channel_config']['auth_token'] }, as: :json
        end.not_to change(Contact, :count)

        expect(response).to have_http_status(:success)
        expect(response.parsed_body['id']).to eq(body['contact']['id'])
        expect(response.parsed_body).not_to have_key('widget_auth_token')
      end

      # EVIRMA: Matching email must not rebind a different identifier during bootstrap.
      it 'ignores an email owned by another identified contact' do
        other_contact = create(:contact, account: account, identifier: 'other-user', email: user[:email])

        post '/api/v1/widget/config', params: params, as: :json

        expect(response).to have_http_status(:success)
        expect(response.parsed_body['contact']['identifier']).to eq(identifier)
        expect(response.parsed_body['contact']['email']).to be_nil
        expect(other_contact.reload.identifier).to eq('other-user')
        expect(other_contact.email).to eq(user[:email])
      end

      # EVIRMA: Malformed public input uses the existing 422 request error, without creating a contact.
      it 'rejects a user that is not an object' do
        expect do
          post '/api/v1/widget/config', params: params.merge(user: 'customer'), as: :json
        end.not_to change(Contact, :count)

        expect(response).to have_http_status(:unprocessable_entity)
      end

      context 'with an invalid signature' do
        let(:identifier_hash) { 'invalid' }

        it 'returns an anonymous contact and the standard set-user error without binding identity' do
          post '/api/v1/widget/config', params: params, as: :json

          expect(response).to have_http_status(:success)
          expect(response.parsed_body['contact']['identifier']).to be_nil
          expect(response.parsed_body['set_user_error']).to eq('error' => 'HMAC failed: Invalid Identifier Hash Provided')
          expect(account.contacts.find_by(identifier: identifier)).to be_nil
        end

        it 'does not merge or verify the supplied guest contact' do
          contact_inbox
          post '/api/v1/widget/config', params: params, headers: { 'X-Auth-Token' => token }, as: :json

          expect(contact.reload.identifier).to be_nil
          expect(contact_inbox.reload).not_to be_hmac_verified
        end
      end

      context 'without a signature' do
        let(:identifier_hash) { nil }

        it 'rejects an unsigned user when HMAC is mandatory' do
          web_widget.update!(hmac_mandatory: true)
          post '/api/v1/widget/config', params: params, as: :json

          expect(response.parsed_body['contact']['identifier']).to be_nil
          expect(response.parsed_body).to have_key('set_user_error')
        end

        it 'preserves optional setUser behavior without issuing a verified session' do
          contact.update!(identifier: identifier)
          contact_inbox.update!(hmac_verified: true)
          post '/api/v1/widget/config', params: params, as: :json

          body = response.parsed_body
          expect(body['contact']['identifier']).to eq(identifier)
          expect(body['contact']['pubsub_token']).not_to eq(contact_inbox.pubsub_token)
          decoded = Widget::TokenService.new(token: body['website_channel_config']['auth_token']).decode_token
          expect(ContactInbox.find_by!(inbox_id: web_widget.inbox.id, source_id: decoded[:source_id])).not_to be_hmac_verified
        end
      end
    end

    context 'with invalid website token' do
      it 'returns not found' do
        post '/api/v1/widget/config', params: { website_token: '' }
        expect(response).to have_http_status(:not_found)
      end
    end

    context 'with correct website token and missing X-Auth-Token' do
      it 'returns widget config along with a new contact' do
        expect do
          post '/api/v1/widget/config',
               params: params,
               as: :json
        end.to change(Contact, :count).by(1)

        expect(response).to have_http_status(:success)
        response_data = response.parsed_body
        expect(response_data.keys).to include(*response_keys)
      end
    end

    context 'with correct website token and valid X-Auth-Token' do
      it 'returns widget config along with the same contact' do
        expect do
          post '/api/v1/widget/config',
               params: params,
               headers: { 'X-Auth-Token' => token },
               as: :json
        end.not_to change(Contact, :count)

        expect(response).to have_http_status(:success)
        response_data = response.parsed_body
        expect(response_data.keys).to include(*response_keys)
        expect(response_data['contact']['pubsub_token']).to eq(contact_inbox.pubsub_token)
      end

      it 'returns 401 if account is suspended' do
        account.update!(status: :suspended)

        post '/api/v1/widget/config',
             params: params,
             headers: { 'X-Auth-Token' => token },
             as: :json

        expect(response).to have_http_status(:unauthorized)
      end
    end

    context 'with correct website token and invalid X-Auth-Token' do
      it 'returns widget config and new contact with error message' do
        expect do
          post '/api/v1/widget/config',
               params: params,
               headers: { 'X-Auth-Token' => 'invalid token' },
               as: :json
        end.to change(Contact, :count).by(1)

        expect(response).to have_http_status(:success)
        response_data = response.parsed_body
        expect(response_data.keys).to include(*response_keys)
      end
    end
  end
end
