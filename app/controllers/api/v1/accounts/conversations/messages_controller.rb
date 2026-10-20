class Api::V1::Accounts::Conversations::MessagesController < Api::V1::Accounts::Conversations::BaseController
  before_action :ensure_api_inbox, only: :update

  def index
    @messages = message_finder.perform
  end

  def create
    user = Current.user || @resource
    mb = Messages::MessageBuilder.new(user, @conversation, params)
    @message = mb.perform
  rescue StandardError => e
    render_could_not_create_error(e.message)
  end

  def update
    Messages::StatusUpdateService.new(message, permitted_params[:status], permitted_params[:external_error]).perform
    @message = message
  end

  # EVIRMA: Edit only the author's text; keep reply metadata and native update events.
  def update_content
    message.with_lock do
      return render json: { error: I18n.t('conversations.messages.edit_forbidden') }, status: :forbidden unless own_message?
      return render json: { error: I18n.t('conversations.messages.edit_unavailable') }, status: :unprocessable_entity unless editable_message_content?

      content = params[:content]
      unless content.is_a?(String) && content.present?
        return render json: { error: I18n.t('conversations.messages.edit_invalid_content') }, status: :unprocessable_entity
      end

      update_message_content(content)
    end
    enqueue_telegram_update('edit')
    render :update
  rescue ActiveRecord::RecordInvalid => e
    render_could_not_create_error(e.message)
  end

  def destroy
    # EVIRMA: Claim deletion once and retain the Telegram IDs needed after attachments are removed.
    message.with_lock do
      return if message.deleted

      message.update!(
        content: I18n.t('conversations.messages.deleted'), content_type: :text,
        content_attributes: message.content_attributes.slice('telegram_message_ids', 'telegram_text_message_id').merge('deleted' => true)
      )
      message.attachments.destroy_all
      # EVIRMA: Enqueue only the first deletion, within the same lock.
      enqueue_telegram_update('delete')
    end
  end

  def retry
    return if message.blank?

    ::SendReplyJob.perform_later(message.id) if claim_message_retry
  rescue StandardError => e
    render_could_not_create_error(e.message)
  end

  def translate
    return head :ok if already_translated_content_available?

    translated_content = Integrations::GoogleTranslate::ProcessorService.new(
      message: message,
      target_language: permitted_params[:target_language]
    ).perform

    if translated_content.present?
      translations = {}
      translations[permitted_params[:target_language]] = translated_content
      translations = message.translations.merge!(translations) if message.translations.present?
      message.update!(translations: translations)
    end

    render json: { content: translated_content }
  rescue Google::Cloud::Error => e
    # `details` carries the clean human message; `message` includes gRPC debug noise
    render_could_not_create_error(e.details.presence || e.message)
  end

  private

  # EVIRMA: Keep author/channel checks and metadata updates inside the edit lock.
  def own_message?
    Current.user.is_a?(User) && message.sender == Current.user
  end

  def editable_message_content?
    (message.outgoing? || message.private?) && !message.deleted && message.content.present? && !@conversation.inbox.email?
  end

  def update_message_content(content)
    message.update!(content: content, content_attributes: message.content_attributes.merge(
      'edited_at' => Time.current.iso8601, 'previous_content' => message.content
    ))
  end

  # EVIRMA: Notes and incoming messages must never change a Telegram customer's messages.
  def enqueue_telegram_update(operation)
    return unless @conversation.inbox.telegram? && message.outgoing? && !message.private?
    return if message.source_id.blank? && message.content_attributes['telegram_message_ids'].blank?

    Telegram::MessageUpdateJob.perform_later(message.id, operation)
  end

  def message
    @message ||= @conversation.messages.find(permitted_params[:id])
  end

  def message_finder
    @message_finder ||= MessageFinder.new(@conversation, params)
  end

  def claim_message_retry
    message.with_lock do
      next false unless message.failed?

      Messages::StatusUpdateService.new(message, 'sent').perform
      previous_source_id = message.source_id
      retry_attributes = { content_attributes: retry_content_attributes }
      retry_attributes[:source_id] = nil unless @conversation.inbox.api? || @conversation.inbox.web_widget?
      message.update!(retry_attributes)
      if retry_attributes.key?(:source_id) && previous_source_id.present?
        Rails.logger.info "Cleared older source ID #{previous_source_id} for message #{message.id}"
      end
      true
    end
  end

  def retry_content_attributes
    return message.content_attributes if message.content_attributes.dig('whatsapp_contact_info', 'type') == 'request'

    {}
  end

  def permitted_params
    params.permit(:id, :target_language, :status, :external_error)
  end

  def already_translated_content_available?
    message.translations.present? && message.translations[permitted_params[:target_language]].present?
  end

  # API inbox check
  def ensure_api_inbox
    # Only API inboxes can update messages
    render json: { error: 'Message status update is only allowed for API inboxes' }, status: :forbidden unless @conversation.inbox.api?
  end
end

Api::V1::Accounts::Conversations::MessagesController.prepend_mod_with('Api::V1::Accounts::Conversations::MessagesController')
