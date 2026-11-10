require 'rails_helper'

# EVIRMA: The widget stores only the host of the page each incoming message came from.
RSpec.describe 'EVIRMA widget message source host', type: :request do
  let(:account) { create(:account) }
  let(:web_widget) { create(:channel_widget, account: account) }
  let(:contact) { create(:contact, account: account, email: nil) }
  let(:contact_inbox) { create(:contact_inbox, contact: contact, inbox: web_widget.inbox) }
  let!(:conversation) do
    create(:conversation, contact: contact, account: account, inbox: web_widget.inbox, contact_inbox: contact_inbox)
  end
  let(:token) do
    Widget::TokenService.new(payload: { source_id: contact_inbox.source_id, inbox_id: web_widget.inbox.id }).generate_token
  end

  def send_message(message)
    post api_v1_widget_messages_url,
         params: { website_token: web_widget.website_token, message: { content: 'hello', timestamp: Time.current }.merge(message) },
         headers: { 'X-Auth-Token' => token },
         as: :json
    expect(response).to have_http_status(:success)
    # Other callbacks may add service messages after the customer message, so look it up by id.
    Message.find(response.parsed_body['id'])
  end

  it 'stores the lowercase host of the page without path or query' do
    message = send_message(referer_url: 'https://Seller.Wildberries.ru/analytics/report?token=secret')

    expect(message.content_attributes['evirma_source_host']).to eq('seller.wildberries.ru')
    expect(message.content_attributes.to_json).not_to include('secret')
  end

  it 'ignores a host sent directly instead of the page address' do
    message = send_message(referer_url: 'https://evirma.ru/pricing', content_attributes: { evirma_source_host: 'www.wildberries.ru' })

    expect(message.content_attributes['evirma_source_host']).to eq('evirma.ru')
  end

  it 'stores nothing for a missing or non-http page address' do
    expect(send_message(referer_url: '').content_attributes).not_to have_key('evirma_source_host')
    expect(send_message(referer_url: 'javascript:alert(1)').content_attributes).not_to have_key('evirma_source_host')
    expect(send_message(referer_url: 'not a url %').content_attributes).not_to have_key('evirma_source_host')
  end

  it 'keeps the in_reply_to attribute as before' do
    first_message = create(:message, account: account, inbox: web_widget.inbox, conversation: conversation)
    message = send_message(referer_url: 'https://evirma.ru/', reply_to: first_message.id)

    expect(message.content_attributes['in_reply_to']).to eq(first_message.id)
  end
end
