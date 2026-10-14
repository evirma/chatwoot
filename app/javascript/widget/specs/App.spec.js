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
    const router = createRouter({
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
    wrapper.unmount();
    listeners.mock.calls
      .filter(([event]) => event === 'message')
      .forEach(([event, handler]) =>
        window.removeEventListener(event, handler)
      );
    emitter.all.clear();
    delete window.chatwootWebChannel;
    vi.restoreAllMocks();
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
        `chatwoot-widget:${JSON.stringify({ event: 'availability-changed', isOnline })}`,
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
      'chatwoot-widget:{"event":"availability-changed","isOnline":false}',
      '*'
    );

    await store.dispatch('agent/updatePresence', { 1: 'online' });
    await nextTick();
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenLastCalledWith(
      'chatwoot-widget:{"event":"availability-changed","isOnline":true}',
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
      'chatwoot-widget:{"event":"availability-changed","isOnline":true}',
      '*'
    );
  });

  it('uses the header availability rule outside business hours', async () => {
    window.chatwootWebChannel.workingHoursEnabled = true;
    window.chatwootWebChannel.workingHours = [];
    store.commit('agent/setAgents', [{ id: 1, availability_status: 'online' }]);
    store.commit('agent/setHasFetched', true);
    await nextTick();
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      'chatwoot-widget:{"event":"availability-changed","isOnline":false}',
      '*'
    );
  });
});
