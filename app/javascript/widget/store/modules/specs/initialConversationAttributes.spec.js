// EVIRMA: Exercise creation defaults through the real store and API payloads.
import { createStore } from 'vuex';
import { flushPromises } from '@vue/test-utils';
import { API } from 'widget/helpers/axios';
import appConfig from '../appConfig';
import conversation from '../conversation';
import conversationAttributes from '../conversationAttributes';
import campaign from '../campaign';

vi.mock('widget/helpers/axios');
// EVIRMA: Timer scheduling belongs to App tests; isolate its singleton store import here.
vi.mock('widget/helpers/campaignTimer', () => ({
  default: { initTimers: vi.fn() },
}));

describe('host conversation creation attributes', () => {
  let store;

  beforeEach(async () => {
    window.WOOT_WIDGET = { $root: { $i18n: { locale: 'en' } } };
    store = createStore({
      modules: {
        appConfig: { ...appConfig, state: { ...appConfig.state } },
        conversation: {
          ...conversation,
          state: {
            ...conversation.state,
            conversations: {},
            meta: {},
            pendingCustomAttributes: {},
            pendingLabels: [],
          },
        },
        conversationAttributes: {
          ...conversationAttributes,
          state: { id: '', status: '' },
        },
        campaign: { ...campaign, state: { ...campaign.state } },
      },
    });
    API.post.mockResolvedValue({
      data: { id: 10, messages: [{ id: 1, content: 'hello' }] },
    });
    API.get.mockResolvedValue({ data: { id: 10 } });
    await store.dispatch('appConfig/setAppConfig', {
      conversationCustomAttributes: { order_id: '42', source: 'host' },
    });
  });

  afterEach(() => {
    delete window.WOOT_WIDGET;
    vi.clearAllMocks();
  });

  it('survives prechat clearing and merges form attributes in the creation request', async () => {
    await store.dispatch('conversation/clearConversations');
    await store.dispatch('conversation/createConversation', {
      message: 'hello',
      customAttributes: { source: 'form', priority: 'high' },
    });
    expect(API.post).toHaveBeenCalledWith(
      expect.stringContaining('/widget/conversations'),
      expect.objectContaining({
        custom_attributes: { order_id: '42', source: 'form', priority: 'high' },
      })
    );
  });

  it('uses defaults for the first text and omits them once the conversation exists', async () => {
    await store.dispatch('conversation/setCustomAttributes', {
      source: 'setter',
    });
    await store.dispatch('conversation/sendMessage', { content: 'hello' });
    // EVIRMA: sendMessage dispatches its asynchronous request without returning its promise.
    await flushPromises();
    expect(API.post.mock.calls[0][1].custom_attributes).toEqual({
      order_id: '42',
      source: 'setter',
    });
    store.commit('conversationAttributes/SET_CONVERSATION_ATTRIBUTES', {
      id: 10,
    });
    API.post.mockClear();
    await store.dispatch('conversation/sendMessage', { content: 'again' });
    expect(API.post.mock.calls[0][1]).not.toHaveProperty('custom_attributes');
  });

  // EVIRMA: Retry bypasses sendMessage, but can still be the request that creates the conversation.
  it('keeps creation defaults when retrying a failed first message', async () => {
    await store.dispatch('conversation/sendMessageWithData', {
      message: {
        id: 'retry',
        content: 'Retry',
        status: 'failed',
        message_type: 0,
      },
    });
    expect(API.post.mock.calls[0][1].custom_attributes).toEqual({
      order_id: '42',
      source: 'host',
    });
  });

  it('passes defaults with the first attachment', async () => {
    await store.dispatch('conversation/sendAttachment', {
      attachment: { file: 'signed-blob', thumbUrl: '', fileType: 'file' },
    });
    expect(API.post.mock.calls[0][1].get('custom_attributes[order_id]')).toBe(
      '42'
    );
  });

  it('passes defaults when a campaign creates the conversation', async () => {
    await store.dispatch('campaign/executeCampaign', {
      campaignId: 7,
      websiteToken: 'website',
      customAttributes: { source: 'campaign' },
    });
    expect(API.post.mock.calls[0][1].event_info.custom_attributes).toEqual({
      order_id: '42',
      source: 'campaign',
    });
  });
});
