// EVIRMA: Verify header visibility through the widget configuration store.
import { shallowMount } from '@vue/test-utils';
import { createStore } from 'vuex';
import ViewWithHeader from '../layouts/ViewWithHeader.vue';
import ChatHeader from '../ChatHeader.vue';
import ChatHeaderExpanded from '../ChatHeaderExpanded.vue';
import appConfig from '../../store/modules/appConfig';
import agent from '../../store/modules/agent';

describe('ViewWithHeader hideHeader', () => {
  let store;
  let wrapper;

  beforeEach(() => {
    window.chatwootWebChannel = {
      welcomeTitle: 'Welcome',
      welcomeTagline: 'How can we help?',
      websiteName: 'Support',
      avatarUrl: '',
      enabledFeatures: [],
    };
    store = createStore({
      modules: {
        appConfig: { ...appConfig, state: { ...appConfig.state } },
        agent: {
          ...agent,
          state: {
            records: [],
            uiFlags: { hasFetched: false, isError: false },
          },
        },
      },
    });
  });

  afterEach(() => {
    wrapper.unmount();
    delete window.chatwootWebChannel;
  });

  it.each(['home', 'messages'])(
    'hides both headers on %s when hideHeader is enabled',
    async routeName => {
      await store.dispatch('appConfig/setAppConfig', { hideHeader: true });
      wrapper = shallowMount(ViewWithHeader, {
        global: {
          plugins: [store],
          mocks: { $route: { name: routeName } },
          stubs: { 'router-view': true },
        },
      });

      expect(wrapper.findComponent(ChatHeader).exists()).toBe(false);
      expect(wrapper.findComponent(ChatHeaderExpanded).exists()).toBe(false);
    }
  );

  it.each([
    ['home', ChatHeaderExpanded],
    ['messages', ChatHeader],
  ])('keeps the default header on %s', async (routeName, header) => {
    await store.dispatch('appConfig/setAppConfig', {});
    wrapper = shallowMount(ViewWithHeader, {
      global: {
        plugins: [store],
        mocks: { $route: { name: routeName } },
        stubs: { 'router-view': true },
      },
    });

    expect(store.state.appConfig.hideHeader).toBe(false);
    expect(wrapper.findComponent(header).exists()).toBe(true);
  });
});
