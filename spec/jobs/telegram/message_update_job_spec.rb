require 'rails_helper'

# EVIRMA: Stub the HTTP boundary, preserving real channel URL selection and message rendering.
RSpec.describe Telegram::MessageUpdateJob do
  let(:channel) { create(:channel_telegram) }
  let(:conversation) { create(:conversation, inbox: channel.inbox, additional_attributes: { chat_id: '123' }) }
  let(:message) { create(:message, conversation: conversation, message_type: :outgoing, content: 'Edited text', source_id: '456') }
  let(:relay) { 'https://telegram-relay.example' }

  it 'edits text through the same relay used for sending' do
    with_modified_env TELEGRAM_API_URL: relay do
      request = stub_request(:post, "#{channel.telegram_api_url}/editMessageText")
                .with(body: hash_including('chat_id' => '123', 'message_id' => '456', 'text' => 'Edited text', 'parse_mode' => 'HTML'))
                .to_return(status: 200, body: { ok: true }.to_json, headers: { 'Content-Type' => 'application/json' })

      described_class.perform_now(message.id, 'edit')
      expect(request).to have_been_requested
    end
  end

  it 'edits captions for messages with attachments' do
    attachment = message.attachments.new(account_id: message.account_id, file_type: :image)
    attachment.file.attach(io: Rails.root.join('spec/assets/avatar.png').open, filename: 'avatar.png', content_type: 'image/png')
    message.save!
    request = stub_request(:post, "#{channel.telegram_api_url}/editMessageCaption")
              .with(body: hash_including('caption' => 'Edited text', 'message_id' => '456'))
              .to_return(status: 200, body: { ok: true }.to_json, headers: { 'Content-Type' => 'application/json' })

    described_class.perform_now(message.id, 'edit')
    expect(request).to have_been_requested
    expect(message.reload.attachments).to include(attachment)
  end

  it 'deletes a message through the relay even after local deletion' do
    message.update!(content_attributes: { deleted: true })
    with_modified_env TELEGRAM_API_URL: relay do
      request = stub_request(:post, "#{channel.telegram_api_url}/deleteMessage")
                .with(body: hash_including('chat_id' => '123', 'message_id' => '456'))
                .to_return(status: 200, body: { ok: true }.to_json, headers: { 'Content-Type' => 'application/json' })

      described_class.perform_now(message.id, 'delete')
      expect(request).to have_been_requested
    end
  end

  it 'logs rejected deletions without undoing the local deletion' do
    message.update!(content_attributes: { deleted: true })
    stub_request(:post, "#{channel.telegram_api_url}/deleteMessage")
      .to_return(status: 400, body: { ok: false, description: 'message can no longer be deleted' }.to_json,
                 headers: { 'Content-Type' => 'application/json' })
    allow(Rails.logger).to receive(:warn)

    expect { described_class.perform_now(message.id, 'delete') }.not_to raise_error
    expect(Rails.logger).to have_received(:warn).with(/message can no longer be deleted/)
    expect(message.reload.deleted).to be(true)
  end

  it 'logs a network failure without losing the edited text or exposing the token' do
    stub_request(:post, "#{channel.telegram_api_url}/editMessageText").to_raise(Net::ReadTimeout)
    allow(Rails.logger).to receive(:warn)

    expect { described_class.perform_now(message.id, 'edit') }.not_to raise_error
    expect(Rails.logger).to have_received(:warn).with("Telegram edit failed for message #{message.id}: Net::ReadTimeout")
    expect(message.reload.content).to eq('Edited text')
  end

  it 'does not apply a queued edit after deletion' do
    message.update!(content_attributes: { deleted: true })
    described_class.perform_now(message.id, 'edit')
    expect(WebMock).not_to have_requested(:post, "#{channel.telegram_api_url}/editMessageText")
  end

  # EVIRMA: Even an earlier queued job holding a stale instance must send the latest locked content.
  it 'reloads and serializes queued edits so an older job cannot restore earlier text' do
    earlier_job_message = Message.find(message.id)
    message.update!(content: 'Latest text')
    allow(Message).to receive(:find).with(message.id).and_return(message, earlier_job_message)
    expect(message).to receive(:with_lock).and_call_original
    expect(earlier_job_message).to receive(:with_lock).and_call_original
    request = stub_request(:post, "#{channel.telegram_api_url}/editMessageText")
              .with(body: hash_including('text' => 'Latest text'))
              .to_return(status: 200, body: { ok: true }.to_json, headers: { 'Content-Type' => 'application/json' })

    2.times { described_class.perform_now(message.id, 'edit') }

    expect(request).to have_been_requested.twice
  end

  context 'with a reply sent as text, an album, audio and separate documents' do
    before do
      message.update!(source_id: nil, content_attributes: { 'previous_content' => 'Original text' })
      files = [[:image, 'avatar.png', 'image/png'], [:image, 'avatar.png', 'image/png'], [:audio, 'sample.mp3', 'audio/mpeg'],
               [:file, 'sample.pdf', 'application/pdf'], [:file, 'sample.pdf', 'application/pdf']]
      files.each do |type, file, mime|
        attachment = message.attachments.new(account_id: message.account_id, file_type: type)
        attachment.file.attach(io: Rails.root.join('spec/assets', file).open, filename: file, content_type: mime)
      end
      message.save!
      stub_request(:post, "#{channel.telegram_api_url}/sendMessage")
        .to_return(status: 200, body: { ok: true, result: { message_id: 101 } }.to_json, headers: { 'Content-Type' => 'application/json' })
      stub_request(:post, "#{channel.telegram_api_url}/sendMediaGroup")
        .to_return(
          { status: 200, body: { ok: true, result: [{ message_id: 102 }, { message_id: 103 }] }.to_json,
            headers: { 'Content-Type' => 'application/json' } },
          { status: 200, body: { ok: true, result: [{ message_id: 104 }] }.to_json, headers: { 'Content-Type' => 'application/json' } }
        )
      stub_request(:post, "#{channel.telegram_api_url}/sendDocument")
        .to_return(
          { status: 200, body: { ok: true, result: { message_id: 105 } }.to_json, headers: { 'Content-Type' => 'application/json' } },
          { status: 200, body: { ok: true, result: { message_id: 106 } }.to_json, headers: { 'Content-Type' => 'application/json' } }
        )
      Telegram::SendOnTelegramService.new(message: message).perform
    end

    it 'persists every ID and edits the separate text instead of adding an attachment caption' do
      expect(message.reload.source_id).to eq('106')
      expect(message.content_attributes).to include('telegram_message_ids' => [101, 102, 103, 104, 105, 106],
                                                    'telegram_text_message_id' => 101, 'previous_content' => 'Original text')
      message.update!(content: 'New text')
      request = stub_request(:post, "#{channel.telegram_api_url}/editMessageText")
                .with(body: hash_including('text' => 'New text', 'message_id' => '101'))
                .to_return(status: 200, body: { ok: true }.to_json, headers: { 'Content-Type' => 'application/json' })

      described_class.perform_now(message.id, 'edit')

      expect(request).to have_been_requested.once
      expect(WebMock).not_to have_requested(:post, "#{channel.telegram_api_url}/editMessageCaption")
    end

    it 'deletes every external message even after local attachments are removed' do
      # The controller's soft-delete shape retains delivery metadata and removes attachments.
      message.update!(content_attributes: message.content_attributes.merge('deleted' => true))
      message.attachments.destroy_all
      requests = (101..106).map do |id|
        stub_request(:post, "#{channel.telegram_api_url}/deleteMessage")
          .with(body: hash_including('message_id' => id.to_s))
          .to_return(status: 200, body: { ok: true }.to_json, headers: { 'Content-Type' => 'application/json' })
      end

      described_class.perform_now(message.id, 'delete')

      expect(requests).to all(have_been_requested.once)
    end
  end
end
