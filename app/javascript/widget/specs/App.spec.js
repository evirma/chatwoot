// EVIRMA: Verify availability messages from the widget, independently of headers.
import { shallowMount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createStore } from 'vuex';
import { createRouter, createMemoryHistory } from 'vue-router';
import App from '../App.vue';
import agent from '../store/modules/agent';
import appConfig from '../store/modules/appConfig';
import { IFrameHelper } from '../helpers/utils';
import { emitter } from 'shared/helpers/mitt';
// EVIRMA: Verify unread events using the widget's actual counting and read-state rules.
import conversation from '../store/modules/conversation';

describe('App availability-changed', () => {
  let store;
  let wrapper;
  let router;
  let postMessage;
  let listeners;

  beforeEach(async () => {
    window.chatwootWebChannel = {
      websiteToken: 'token',
      enabledLanguages: [],
      enabledFeatures: [],
      workingHoursEnabled: false,
    };
    store = createStore({
      modules: {
        agent: {
          ...agent,
          actions: { ...agent.actions, fetchAvailableAgents: vi.fn() },
          state: {
            records: [],
            uiFlags: { hasFetched: false, isError: false },
          },
        },
        appConfig: {
          ...appConfig,
          state: { ...appConfig.state, hideHeader: true },
        },
        conversation: {
          namespaced: true,
          state: { conversations: {}, meta: {} },
          getters: {
            getConversationSize: () => 0,
            getIsFetchingList: () => false,
            getMessageCount: conversation.getters.getMessageCount,
            getUnreadMessageCount: conversation.getters.getUnreadMessageCount,
          },
          mutations: conversation.mutations,
          actions: { fetchOldConversations: vi.fn() },
        },
        campaign: {
          namespaced: true,
          state: { activeCampaign: {} },
          getters: { getActiveCampaign: state => state.activeCampaign },
          mutations: {
            setActiveCampaign: (state, value) => {
              state.activeCampaign = value;
            },
          },
        },
        conversationAttributes: {
          namespaced: true,
          actions: { getAttributes: vi.fn() },
        },
      },
    });
    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'home', component: { template: '<div />' } }],
    });
    await router.push('/');
    await router.isReady();
    vi.spyOn(IFrameHelper, 'isIFrame').mockReturnValue(true);
    postMessage = vi
      .spyOn(window.parent, 'postMessage')
      .mockImplementation(() => {});
    listeners = vi.spyOn(window, 'addEventListener');
    wrapper = shallowMount(App, {
      global: { plugins: [store, router], stubs: { 'router-view': true } },
    });
    postMessage.mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    listeners.mock.calls
      .filter(([event]) => event === 'message')
      .forEach(([event, handler]) =>
        window.removeEventListener(event, handler)
      );
    emitter.all.clear();
    delete window.chatwootWebChannel;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([
    [[], false],
    [[{ id: 1, availability_status: 'online' }], true],
  ])(
    'sends the initial status only after agents are loaded: %j',
    async (records, isOnline) => {
      expect(postMessage).not.toHaveBeenCalled();
      store.commit('agent/setAgents', records);
      await nextTick();
      expect(postMessage).not.toHaveBeenCalled();

      store.commit('agent/setHasFetched', true);
      await nextTick();

      expect(postMessage).toHaveBeenCalledExactlyOnceWith(
        `chatwoot-widget:${JSON.stringify({ event: 'availability-changed', isOnline, isOutOfOffice: false, opensAt: null })}`,
        '*'
      );
    }
  );

  it('sends presence changes without repeating an unchanged status', async () => {
    store.commit('agent/setAgents', [{ id: 1, availability_status: 'online' }]);
    store.commit('agent/setHasFetched', true);
    await nextTick();
    postMessage.mockClear();

    await store.dispatch('agent/updatePresence', { 1: 'online' });
    await nextTick();
    expect(postMessage).not.toHaveBeenCalled();

    await store.dispatch('agent/updatePresence', { 1: 'offline' });
    await nextTick();
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      'chatwoot-widget:{"event":"availability-changed","isOnline":false,"isOutOfOffice":false,"opensAt":null}',
      '*'
    );

    await store.dispatch('agent/updatePresence', { 1: 'online' });
    await nextTick();
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenLastCalledWith(
      'chatwoot-widget:{"event":"availability-changed","isOnline":true,"isOutOfOffice":false,"opensAt":null}',
      '*'
    );
  });

  it('waits for a successful load after an error', async () => {
    store.commit('agent/setError', true);
    store.commit('agent/setHasFetched', true);
    await nextTick();
    expect(postMessage).not.toHaveBeenCalled();

    store.commit('agent/setAgents', [{ id: 1, availability_status: 'online' }]);
    store.commit('agent/setError', false);
    await nextTick();
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      'chatwoot-widget:{"event":"availability-changed","isOnline":true,"isOutOfOffice":false,"opensAt":null}',
      '*'
    );
  });

  it('refreshes agent availability every 60 seconds and stops after unmount', async () => {
    // EVIRMA: Keep host availability current without a presence websocket event.
    wrapper.unmount();
    wrapper = null;
    vi.useFakeTimers();
    wrapper = shallowMount(App, {
      global: { plugins: [store, router], stubs: { 'router-view': true } },
    });
    const dispatch = vi.spyOn(store, 'dispatch');
    dispatch.mockClear();

    await vi.advanceTimersByTimeAsync(59 * 1000 + 999);
    expect(dispatch).not.toHaveBeenCalledWith(
      'agent/fetchAvailableAgents',
      'token'
    );

    await vi.advanceTimersByTimeAsync(1);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(
      'agent/fetchAvailableAgents',
      'token'
    );

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(dispatch).toHaveBeenCalledTimes(2);

    wrapper.unmount();
    wrapper = null;
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('uses the header availability rule outside business hours', async () => {
    window.chatwootWebChannel.workingHoursEnabled = true;
    window.chatwootWebChannel.workingHours = [];
    store.commit('agent/setAgents', [{ id: 1, availability_status: 'online' }]);
    store.commit('agent/setHasFetched', true);
    await nextTick();
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      'chatwoot-widget:{"event":"availability-changed","isOnline":false,"isOutOfOffice":true,"opensAt":null}',
      '*'
    );
  });
  // EVIRMA: Exercise real schedule calculations through the parent event.
  it('reports the next opening in the inbox timezone and follows schedule boundaries', async () => {
    wrapper.unmount();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T05:59:00Z'));
    window.chatwootWebChannel = {
      ...window.chatwootWebChannel,
      workingHoursEnabled: true,
      timezone: 'Europe/Moscow',
      utcOffset: '+03:00',
      workingHours: [
        {
          day_of_week: 4,
          open_hour: 9,
          open_minutes: 0,
          close_hour: 18,
          close_minutes: 0,
          closed_all_day: false,
        },
        {
          day_of_week: 5,
          open_hour: 10,
          open_minutes: 30,
          close_hour: 18,
          close_minutes: 0,
          closed_all_day: false,
        },
      ],
    };
    store.commit('agent/setHasFetched', true);
    postMessage.mockClear();
    wrapper = shallowMount(App, {
      global: { plugins: [store, router], stubs: { 'router-view': true } },
    });
    expect(postMessage).toHaveBeenCalledWith(
      'chatwoot-widget:{"event":"availability-changed","isOnline":false,"isOutOfOffice":true,"opensAt":"09:00"}',
      '*'
    );
    postMessage.mockClear();

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      'chatwoot-widget:{"event":"availability-changed","isOnline":true,"isOutOfOffice":false,"opensAt":"10:30"}',
      '*'
    );
    postMessage.mockClear();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(postMessage).not.toHaveBeenCalled();

    vi.setSystemTime(new Date('2026-10-15T15:00:00Z'));
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      'chatwoot-widget:{"event":"availability-changed","isOnline":false,"isOutOfOffice":true,"opensAt":"10:30"}',
      '*'
    );
    postMessage.mockClear();

    // Only opensAt changes when the next opening moves to the following week.
    vi.setSystemTime(new Date('2026-10-16T15:00:00Z'));
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      'chatwoot-widget:{"event":"availability-changed","isOnline":false,"isOutOfOffice":true,"opensAt":"09:00"}',
      '*'
    );
  });
  // EVIRMA: External page attribution must be available before conversation loading, without fetching campaigns twice.
  it('applies config-set attribution before fetching conversations', async () => {
    store.registerModule('contacts', {
      namespaced: true,
      actions: { get: vi.fn() },
    });
    const fetchConversations = vi
      .spyOn(wrapper.vm, 'fetchOldConversations')
      .mockImplementation(() => {
        expect(window.referrerURL).toBe('https://market.example/orders/42');
        expect(store.state.appConfig.referrerHost).toBe('market.example');
        return Promise.resolve();
      });
    vi.spyOn(wrapper.vm, 'setLocale').mockImplementation(() => {});
    vi.spyOn(wrapper.vm, 'setBubbleLabel').mockImplementation(() => {});
    vi.spyOn(wrapper.vm, 'setUnreadView').mockImplementation(() => {});
    const initCampaigns = vi
      .spyOn(wrapper.vm, 'initCampaigns')
      .mockImplementation(() => {});
    const data = {
      event: 'config-set',
      referrerURL: 'https://market.example/orders/42',
      referrerHost: 'market.example',
      messengerButtons: ['max'],
    };
    window.dispatchEvent(
      new MessageEvent('message', {
        data: `chatwoot-widget:${JSON.stringify(data)}`,
      })
    );
    await nextTick();
    expect(fetchConversations).toHaveBeenCalledOnce();
    expect(initCampaigns).not.toHaveBeenCalled();
    expect(store.state.appConfig.messengerButtons).toEqual(['max']);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: 'chatwoot-widget:{"event":"change-url","referrerURL":"https://market.example/orders/42","referrerHost":"market.example"}',
      })
    );
    expect(initCampaigns).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        currentURL: 'https://market.example/orders/42',
      })
    );
    delete window.referrerURL;
  });

  // EVIRMA: A closed hidden widget must publish initial zero, new replies and read receipts.
  it('reports initial unread state and unread changes with both launcher surfaces disabled', async () => {
    store.registerModule('contacts', {
      namespaced: true,
      actions: { get: vi.fn() },
    });
    // EVIRMA: Keep visibility unchanged during config-set so only initial loading publishes zero.
    await store.dispatch('appConfig/setAppConfig', {
      hideMessageBubble: true,
      showUnreadMessagesDialog: false,
    });
    await nextTick();
    postMessage.mockClear();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: 'chatwoot-widget:{"event":"config-set","hideMessageBubble":true,"showUnreadMessagesDialog":false}',
      })
    );
    await nextTick();
    await nextTick();
    expect(postMessage).toHaveBeenCalledWith(
      'chatwoot-widget:{"event":"handleNotificationDot","unreadMessageCount":0}',
      '*'
    );
    postMessage.mockClear();
    store.commit('conversation/pushMessageToConversation', {
      id: 1,
      message_type: 1,
      created_at: 10,
    });
    await nextTick();
    expect(postMessage).toHaveBeenCalledWith(
      'chatwoot-widget:{"event":"handleNotificationDot","unreadMessageCount":1}',
      '*'
    );
    store.commit('conversation/setMetaUserLastSeenAt', 11);
    await nextTick();
    expect(postMessage).toHaveBeenLastCalledWith(
      'chatwoot-widget:{"event":"handleNotificationDot","unreadMessageCount":0}',
      '*'
    );
    expect(store.state.appConfig.isWidgetOpen).toBe(false);
    expect(router.currentRoute.value.name).toBe('home');
  });

  // EVIRMA: Eligible timer campaigns reach the host without routing to a popup.
  it('publishes a campaign message without opening the hidden widget', async () => {
    await store.dispatch('appConfig/setAppConfig', {
      hideMessageBubble: true,
      showUnreadMessagesDialog: false,
    });
    postMessage.mockClear();
    const sender = { id: 7, name: 'Support' };
    store.commit('campaign/setActiveCampaign', {
      id: 42,
      message: 'Welcome',
      sender,
    });
    await nextTick();
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      `chatwoot-widget:${JSON.stringify({
        event: 'onEvent',
        eventIdentifier: 'chatwoot:on-message',
        data: {
          content: 'Welcome',
          sender,
          sender_type: 'User',
          message_type: 1,
          attachments: [],
          campaignId: 42,
          is_campaign: true,
        },
      })}`,
      '*'
    );
    expect(store.state.appConfig.isWidgetOpen).toBe(false);
    expect(router.currentRoute.value.name).toBe('home');
  });

  it.each(['snoozed', 'has messages'])(
    'does not notify a campaign when %s',
    async condition => {
      await store.dispatch('appConfig/setAppConfig', {
        hideMessageBubble: true,
        showUnreadMessagesDialog: false,
      });
      if (condition === 'snoozed')
        wrapper.vm.setCampaignReadData(Date.now() + 60 * 60 * 1000);
      else
        store.commit('conversation/pushMessageToConversation', {
          id: 1,
          message_type: 0,
        });
      await nextTick();
      postMessage.mockClear();
      store.commit('campaign/setActiveCampaign', {
        id: 42,
        message: 'Welcome',
      });
      await nextTick();
      expect(postMessage).not.toHaveBeenCalled();
    }
  );

  // EVIRMA: The snooze mark stored by the host must match the widget's mark exactly.
  it('sends every local campaign snooze to the host', () => {
    emitter.emit('snooze-campaigns');
    expect(postMessage).toHaveBeenLastCalledWith(
      `chatwoot-widget:${JSON.stringify({ event: 'setCampaignReadOn', till: wrapper.vm.campaignsSnoozedTill })}`,
      '*'
    );
  });
});
