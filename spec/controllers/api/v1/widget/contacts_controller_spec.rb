require 'rails_helper'

RSpec.describe '/api/v1/widget/contacts', type: :request do
  let(:account) { create(:account) }
  let(:web_widget) { create(:channel_widget, account: account) }
  let(:contact) { create(:contact, account: account, email: 'test@test.com', phone_number: '+745623239') }
  let(:contact_inbox) { create(:contact_inbox, contact: contact, inbox: web_widget.inbox) }
  let(:payload) { { source_id: contact_inbox.source_id, inbox_id: web_widget.inbox.id } }
  let(:token) { Widget::TokenService.new(payload: payload).generate_token }

  describe 'PATCH /api/v1/widget/contact' do
    let(:params) { { website_token: web_widget.website_token, identifier: 'test' } }

    context 'with invalid website token' do
      it 'returns unauthorized' do
        patch '/api/v1/widget/contact', params: { website_token: '' }
        expect(response).to have_http_status(:not_found)
      end
    end

    context 'with correct website token' do
      let(:identify_action) { double }

      before do
        allow(ContactIdentifyAction).to receive(:new).and_return(identify_action)
        allow(identify_action).to receive(:perform).and_return(contact)
      end

      it 'calls contact identify' do
        patch '/api/v1/widget/contact',
              params: params,
              headers: { 'X-Auth-Token' => token },
              as: :json

        expect(response).to have_http_status(:success)
        expected_params = { contact: contact, params: params, discard_invalid_attrs: true }
        expect(ContactIdentifyAction).to have_received(:new).with(expected_params)
        expect(identify_action).to have_received(:perform)
      end
    end

    context 'with update contact' do
      let(:params) { { website_token: web_widget.website_token } }

      it 'dont update phone number if invalid phone number passed' do
        patch '/api/v1/widget/contact',
              params: params.merge({ phone_number: '45623239' }),
              headers: { 'X-Auth-Token' => token },
              as: :json
        body = response.parsed_body
        expect(body['has_phone_number']).to be true
        contact.reload
        expect(contact.phone_number).to eq('+745623239')
        expect(response).to have_http_status(:success)
      end

      it 'update phone number if valid phone number passed' do
        patch '/api/v1/widget/contact',
              params: params.merge({ phone_number: '+245623239' }),
              headers: { 'X-Auth-Token' => token },
              as: :json
        body = response.parsed_body
        expect(body['has_phone_number']).to be true
        contact.reload
        expect(contact.phone_number).to eq('+245623239')
        expect(response).to have_http_status(:success)
      end

      it 'dont update email if invalid email passed' do
        patch '/api/v1/widget/contact',
              params: params.merge({ email: 'test@' }),
              headers: { 'X-Auth-Token' => token },
              as: :json
        body = response.parsed_body
        expect(body['has_email']).to be true
        contact.reload
        expect(contact.email).to eq('test@test.com')
        expect(response).to have_http_status(:success)
      end

      it 'dont update email if empty value email passed' do
        patch '/api/v1/widget/contact',
              params: params.merge({ email: '' }),
              headers: { 'X-Auth-Token' => token },
              as: :json
        body = response.parsed_body
        expect(body['has_email']).to be true
        contact.reload
        expect(contact.email).to eq('test@test.com')
        expect(response).to have_http_status(:success)
      end

      it 'dont update email if nil value email passed' do
        patch '/api/v1/widget/contact',
              params: params.merge({ email: nil }),
              headers: { 'X-Auth-Token' => token },
              as: :json
        body = response.parsed_body
        expect(body['has_email']).to be true
        contact.reload
        expect(contact.email).to eq('test@test.com')
        expect(response).to have_http_status(:success)
      end

      it 'update email if valid email passed' do
        patch '/api/v1/widget/contact',
              params: params.merge({ email: 'test-1@test.com' }),
              headers: { 'X-Auth-Token' => token },
              as: :json
        body = response.parsed_body
        expect(body['has_email']).to be true
        contact.reload
        expect(contact.email).to eq('test-1@test.com')
        expect(response).to have_http_status(:success)
      end
    end
  end

  describe 'PATCH /api/v1/widget/contact with HMAC enforcement' do
    let(:web_widget) { create(:channel_widget, account: account, hmac_mandatory: true) }
    let!(:victim) { create(:contact, account: account, identifier: 'victim-identifier', name: 'Victim') }
    let(:correct_identifier_hash) { OpenSSL::HMAC.hexdigest('sha256', web_widget.hmac_token, 'victim-identifier') }

    context 'when an identifier is supplied on a mandatory-hmac inbox' do
      it 'rejects when identifier_hash is omitted' do
        patch '/api/v1/widget/contact',
              params: { website_token: web_widget.website_token, identifier: 'victim-identifier', name: 'Attacker' },
              headers: { 'X-Auth-Token' => token },
              as: :json

        expect(response).to have_http_status(:unauthorized)
        expect(victim.reload.name).to eq('Victim')
      end

      it 'rejects when identifier_hash is blank' do
        patch '/api/v1/widget/contact',
              params: { website_token: web_widget.website_token, identifier: 'victim-identifier', identifier_hash: '', name: 'Attacker' },
              headers: { 'X-Auth-Token' => token },
              as: :json

        expect(response).to have_http_status(:unauthorized)
        expect(victim.reload.name).to eq('Victim')
      end

      it 'rejects when identifier_hash is null' do
        patch '/api/v1/widget/contact',
              params: { website_token: web_widget.website_token, identifier: 'victim-identifier', identifier_hash: nil, name: 'Attacker' },
              headers: { 'X-Auth-Token' => token },
              as: :json

        expect(response).to have_http_status(:unauthorized)
        expect(victim.reload.name).to eq('Victim')
      end

      it 'rejects when identifier_hash is invalid' do
        patch '/api/v1/widget/contact',
              params: { website_token: web_widget.website_token, identifier: 'victim-identifier',
                        identifier_hash: 'DEFINITELY_INVALID_AAAAA_NOT_A_REAL_HMAC', name: 'Attacker' },
              headers: { 'X-Auth-Token' => token },
              as: :json

        expect(response).to have_http_status(:unauthorized)
        expect(victim.reload.name).to eq('Victim')
      end

      it 'succeeds when a valid identifier_hash is provided' do
        patch '/api/v1/widget/contact',
              params: { website_token: web_widget.website_token, identifier: 'victim-identifier',
                        identifier_hash: correct_identifier_hash, name: 'Legit' },
              headers: { 'X-Auth-Token' => token },
              as: :json

        expect(response).to have_http_status(:success)
      end
    end

    context 'when no identifier is supplied (anonymous prechat update)' do
      it 'allows updating name/email without an identifier_hash' do
        patch '/api/v1/widget/contact',
              params: { website_token: web_widget.website_token, email: 'prechat@test.com', name: 'Prechat User' },
              headers: { 'X-Auth-Token' => token },
              as: :json

        expect(victim.reload.email).to be_nil
        expect(Contact.from_email('prechat@test.com')).to be_present
        expect(response).to have_http_status(:success)
      end
    end
  end

  describe 'PATCH /api/v1/widget/contact/set_user' do
    let(:params) { { website_token: web_widget.website_token, identifier: 'test' } }
    let(:web_widget) { create(:channel_widget, account: account, hmac_mandatory: true) }
    let(:correct_identifier_hash) { OpenSSL::HMAC.hexdigest('sha256', web_widget.hmac_token, params[:identifier].to_s) }
    let(:incorrect_identifier_hash) { 'test' }

    # EVIRMA: A guest credential must not gain access to the identified contact's conversations.
    context 'when identifying a guest with a verified contact' do
      let!(:guest_conversation) do
        create(:conversation, account: account, inbox: web_widget.inbox, contact: contact, contact_inbox: contact_inbox)
      end
      let(:identified_contact) { create(:contact, account: account, identifier: params[:identifier]) }
      let!(:identified_conversation) do
        verified_inbox = create(:contact_inbox, contact: identified_contact, inbox: web_widget.inbox, hmac_verified: true)
        create(:conversation, account: account, inbox: web_widget.inbox, contact: identified_contact, contact_inbox: verified_inbox)
      end

      def fetch_widget_conversation(auth_token)
        get '/api/v1/widget/conversations', params: { website_token: web_widget.website_token },
                                            headers: { 'X-Auth-Token' => auth_token }, as: :json
      end

      def sign_in_guest
        patch '/api/v1/widget/contact/set_user',
              params: params.merge(identifier_hash: correct_identifier_hash),
              headers: { 'X-Auth-Token' => token }, as: :json
        response.parsed_body['widget_auth_token']
      end

      it 'revokes the guest token after HMAC verification' do
        fetch_widget_conversation(token)
        expect(response.parsed_body['id']).to eq(guest_conversation.display_id)
        old_source_id = contact_inbox.source_id
        old_pubsub_token = contact_inbox.pubsub_token

        new_token = sign_in_guest
        expect(new_token).to be_present
        expect(response.parsed_body['pubsub_token']).to eq(contact_inbox.reload.pubsub_token)

        fetch_widget_conversation(token)
        expect(response).to have_http_status(:not_found)
        expect(contact_inbox.source_id).not_to eq(old_source_id)
        expect(contact_inbox.pubsub_token).not_to eq(old_pubsub_token)
        expect(ContactInbox.exists?(pubsub_token: old_pubsub_token)).to be(false)
      end

      it 'opens the identified contact conversations with the new token' do
        fetch_widget_conversation(sign_in_guest)

        expect(response).to have_http_status(:success)
        expect(response.parsed_body['id']).to eq(identified_conversation.display_id)
        expect(contact_inbox.reload).to be_hmac_verified
        expect(contact_inbox.contact_id).to eq(identified_contact.id)
        expect(guest_conversation.reload.contact_inbox_id).to eq(contact_inbox.id)
      end
    end

    # EVIRMA: Repeated signed setUser calls must preserve the existing verified session.
    it 'keeps the token and source id for an already verified contact with the same identifier' do
      contact.update!(identifier: params[:identifier])
      contact_inbox.update!(hmac_verified: true)
      old_source_id = contact_inbox.source_id
      old_pubsub_token = contact_inbox.pubsub_token

      patch '/api/v1/widget/contact/set_user',
            params: params.merge(identifier_hash: correct_identifier_hash),
            headers: { 'X-Auth-Token' => token }, as: :json

      expect(response).to have_http_status(:success)
      expect(response.parsed_body).not_to have_key('widget_auth_token')
      expect(response.parsed_body).not_to have_key('pubsub_token')
      expect(contact_inbox.reload.source_id).to eq(old_source_id)
      expect(contact_inbox.pubsub_token).to eq(old_pubsub_token)
    end

    # EVIRMA: A legacy verified flag without an identified owner does not preserve guest credentials.
    it 'rotates both credentials for a verified guest without an identifier' do
      contact_inbox.update!(hmac_verified: true)
      old_source_id = contact_inbox.source_id
      old_pubsub_token = contact_inbox.pubsub_token

      patch '/api/v1/widget/contact/set_user', params: params.merge(identifier_hash: correct_identifier_hash),
                                               headers: { 'X-Auth-Token' => token }, as: :json

      expect(response).to have_http_status(:success)
      expect(response.parsed_body['widget_auth_token']).to be_present
      expect(response.parsed_body['pubsub_token']).to eq(contact_inbox.reload.pubsub_token)
      expect(contact_inbox.source_id).not_to eq(old_source_id)
      expect(contact_inbox.pubsub_token).not_to eq(old_pubsub_token)
    end

    # EVIRMA: A merge race cannot return credentials for a link reassigned after identification.
    it 'rolls back when the final link belongs to a different identifier' do
      other_contact = create(:contact, account: account, identifier: 'another-user')
      old_source_id = contact_inbox.source_id
      old_pubsub_token = contact_inbox.pubsub_token
      allow(ContactIdentifyAction).to receive(:new).and_wrap_original do |original, *args, **kwargs|
        action = original.call(*args, **kwargs)
        allow(action).to receive(:perform).and_wrap_original do |perform|
          result = perform.call
          ContactInbox.find(contact_inbox.id).update!(contact: other_contact)
          result
        end
        action
      end

      patch '/api/v1/widget/contact/set_user', params: params.merge(identifier_hash: correct_identifier_hash),
                                               headers: { 'X-Auth-Token' => token }, as: :json

      expect(response).to have_http_status(:unauthorized)
      expect(response.parsed_body).not_to include('widget_auth_token', 'pubsub_token', 'hmac_verified')
      expect(contact_inbox.reload).to have_attributes(source_id: old_source_id, pubsub_token: old_pubsub_token,
                                                      hmac_verified: false, contact_id: contact.id)
      expect(contact.reload.identifier).to be_nil
    end

    # EVIRMA: Optional unsigned identification retains its existing guest credentials.
    context 'without mandatory HMAC' do
      let(:web_widget) { create(:channel_widget, account: account, hmac_mandatory: false) }

      it 'keeps the token and source id when no identifier hash is supplied' do
        old_source_id = contact_inbox.source_id

        patch '/api/v1/widget/contact/set_user', params: params,
                                                 headers: { 'X-Auth-Token' => token }, as: :json

        expect(response).to have_http_status(:success)
        expect(response.parsed_body).not_to have_key('widget_auth_token')
        expect(response.parsed_body).not_to have_key('pubsub_token')
        expect(contact_inbox.reload.source_id).to eq(old_source_id)
        expect(contact_inbox).not_to be_hmac_verified
      end
    end

    # EVIRMA: Failed signed identification must not leave a verified guest session behind.
    it 'does not verify the contact inbox when identification returns 422' do
      patch '/api/v1/widget/contact/set_user',
            params: params.merge(identifier_hash: correct_identifier_hash, name: 'a' * 256),
            headers: { 'X-Auth-Token' => token },
            as: :json

      expect(response).to have_http_status(:unprocessable_entity)
      expect(contact_inbox.reload).not_to be_hmac_verified
      expect(contact.reload.identifier).to be_nil
    end

    context 'when the current contact identifier is different from param identifier' do
      before do
        contact.update(identifier: 'random')
      end

      it 'return a new contact for the provided identifier' do
        patch '/api/v1/widget/contact/set_user',
              params: params.merge(identifier_hash: correct_identifier_hash),
              headers: { 'X-Auth-Token' => token },
              as: :json

        body = response.parsed_body
        expect(body['id']).not_to eq(contact.id)
        expect(body['widget_auth_token']).not_to be_nil
        expect(body['pubsub_token']).to eq(Contact.find(body['id']).contact_inboxes.first.pubsub_token)
        expect(Contact.find(body['id']).contact_inboxes.first.hmac_verified?).to be(true)
      end
    end

    context 'with mandatory hmac' do
      it 'returns success when correct identifier hash is provided' do
        patch '/api/v1/widget/contact/set_user',
              params: params.merge(identifier_hash: correct_identifier_hash),
              headers: { 'X-Auth-Token' => token },
              as: :json

        expect(response).to have_http_status(:success)
      end

      it 'returns error when incorrect identifier hash is provided' do
        patch '/api/v1/widget/contact/set_user',
              params: params.merge(identifier_hash: incorrect_identifier_hash),
              headers: { 'X-Auth-Token' => token },
              as: :json

        expect(response).to have_http_status(:unauthorized)
      end

      it 'returns error when identifier hash is blank' do
        patch '/api/v1/widget/contact/set_user',
              params: params.merge(identifier_hash: ''),
              headers: { 'X-Auth-Token' => token },
              as: :json

        expect(response).to have_http_status(:unauthorized)
      end

      it 'returns error when identifier hash is not provided' do
        patch '/api/v1/widget/contact/set_user',
              params: params,
              headers: { 'X-Auth-Token' => token },
              as: :json

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe 'POST /api/v1/widget/destroy_custom_attributes' do
    let(:params) { { website_token: web_widget.website_token, identifier: 'test', custom_attributes: ['test'] } }

    context 'with invalid website token' do
      it 'returns unauthorized' do
        post '/api/v1/widget/destroy_custom_attributes', params: { website_token: '' }
        expect(response).to have_http_status(:not_found)
      end
    end

    context 'with correct website token' do
      it 'calls destroy custom attributes' do
        post '/api/v1/widget/destroy_custom_attributes',
             params: params,
             headers: { 'X-Auth-Token' => token },
             as: :json
        expect(contact.reload.custom_attributes).to eq({})
      end
    end
  end
end
