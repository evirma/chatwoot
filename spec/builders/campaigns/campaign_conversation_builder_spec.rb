require 'rails_helper'

describe Campaigns::CampaignConversationBuilder do
  let(:account) { create(:account) }
  let(:inbox) { create(:inbox, account: account) }
  let(:contact) { create(:contact, account: account, identifier: '123') }
  let(:contact_inbox) { create(:contact_inbox, contact: contact, inbox: inbox) }
  let(:campaign) { create(:campaign, inbox: inbox, account: account, trigger_rules: { url: 'https://test.com' }) }

  describe '#perform' do
    it 'creates a conversation with campaign id and message with campaign message' do
      campaign_conversation = described_class.new(
        contact_inbox_id: contact_inbox.id,
        campaign_display_id: campaign.display_id
      ).perform

      expect(campaign_conversation.campaign_id).to eq(campaign.id)
      expect(campaign_conversation.messages.first.content).to eq(campaign.message)
      expect(campaign_conversation.messages.first.additional_attributes['campaign_id']).to eq(campaign.id)
    end

    it 'will not create a conversation with campaign id if another conversation exists' do
      create(:conversation, contact_inbox_id: contact_inbox.id, inbox: inbox, account: account)
      campaign_conversation = described_class.new(
        contact_inbox_id: contact_inbox.id,
        campaign_display_id: campaign.display_id
      ).perform

      expect(campaign_conversation).to be_nil
    end

    # EVIRMA: campaign messages wait for the contact before entering the agent queue.
    context 'with auto assignment enabled' do
      let(:agent) { create(:user, account: account, auto_offline: false) }
      let(:campaign) { create(:campaign, inbox: inbox, account: account, sender: agent) }
      let(:campaign_conversation) do
        described_class.new(contact_inbox_id: contact_inbox.id, campaign_display_id: campaign.display_id).perform
      end

      before do
        account.disable_features!('assignment_v2')
        inbox.update!(enable_auto_assignment: true)
        create(:inbox_member, inbox: inbox, user: agent)
        allow(OnlineStatusTracker).to receive(:get_available_users).with(account.id).and_return({ agent.id.to_s => 'online' })
      end

      it 'keeps the campaign conversation pending and unassigned after the campaign message' do
        expect(campaign_conversation.reload).to be_pending
        expect(campaign_conversation.assignee).to be_nil
        expect(campaign_conversation.messages.incoming).to be_empty
        expect(campaign_conversation.messages.outgoing.first.content).to eq(campaign.message)
      end

      it 'opens and assigns the campaign conversation on the first incoming message' do
        expect(campaign_conversation.reload).to be_pending
        expect(campaign_conversation.assignee).to be_nil

        create(:message, conversation: campaign_conversation, account: account, inbox: inbox, sender: contact, message_type: :incoming)

        expect(campaign_conversation.reload).to be_open
        expect(campaign_conversation.assignee).to eq(agent)
      end

      it 'still opens and assigns an ordinary conversation without a campaign' do
        conversation = ConversationBuilder.new(contact_inbox: contact_inbox, params: {}).perform

        expect(conversation.reload).to be_open
        expect(conversation.assignee).to eq(agent)
        expect(conversation.campaign_id).to be_nil
      end
    end
  end
end
