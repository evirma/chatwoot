class ActionCableBroadcastJob < ApplicationJob
  queue_as :critical
  include Events::Types

  CONVERSATION_UPDATE_EVENTS = [
    CONVERSATION_READ,
    CONVERSATION_UPDATED,
    TEAM_CHANGED,
    ASSIGNEE_CHANGED,
    CONVERSATION_STATUS_CHANGED
  ].freeze

  def perform(members, event_name, data)
    members = current_members(members)
    return if members.blank?

    broadcast_data = prepare_broadcast_data(event_name, data)
    broadcast_to_members(members, event_name, broadcast_data)
  end

  private

  # EVIRMA: A job queued before a widget login still holds the guest pubsub token; the login rotates it,
  # so a token that no longer belongs to a user or contact inbox must not get the identified contact's events.
  def current_members(members)
    tokens = Array(members).reject { |member| member.to_s.start_with?('account_') }
    return members if tokens.empty?

    known = User.where(pubsub_token: tokens).pluck(:pubsub_token) + ContactInbox.where(pubsub_token: tokens).pluck(:pubsub_token)
    Array(members).select { |member| member.to_s.start_with?('account_') || known.include?(member) }
  end

  # Ensures that only the latest available data is sent to prevent UI issues
  # caused by out-of-order events during high-traffic periods. This prevents
  # the conversation job from processing outdated data.
  def prepare_broadcast_data(event_name, data)
    return data unless CONVERSATION_UPDATE_EVENTS.include?(event_name)

    account = Account.find(data[:account_id])
    conversation = account.conversations.find_by!(display_id: data[:id])
    conversation.push_event_data.merge(account_id: data[:account_id])
  end

  def broadcast_to_members(members, event_name, broadcast_data)
    members.each do |member|
      ActionCable.server.broadcast(
        member,
        {
          event: event_name,
          data: broadcast_data
        }
      )
    end
  end
end
