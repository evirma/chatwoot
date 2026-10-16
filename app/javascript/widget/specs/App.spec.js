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
          getters: {
            getConversationSize: () => 0,
            getIsFetchingList: () => false,
            getMessageCount: () => 0,
            getUnreadMessageCount: () => 0,
          },
          actions: { fetchOldConversations: vi.fn() },
        },
        campaign: {
          namespaced: true,
          getters: { getActiveCampaign: () => ({}) },
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
});
