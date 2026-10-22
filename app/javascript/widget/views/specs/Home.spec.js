// EVIRMA: Exercise skipHome through configuration, navigation and rendered input/history.
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createRouter, createMemoryHistory } from 'vue-router';
import { directive as onClickaway } from 'vue3-click-away';
import Home from '../Home.vue';
import Messages from '../Messages.vue';
import TeamAvailability from '../../components/TeamAvailability.vue';
import appConfig from '../../store/modules/appConfig';

describe('Home skipHome', () => {
  let store;
  let router;
  let wrapper;

  beforeEach(async () => {
    window.chatwootWebChannel = {
      enabledFeatures: [],
      preChatFormEnabled: false,
      allowMessagesAfterResolved: true,
    };
    store = createStore({
      modules: {
        appConfig: { ...appConfig, state: { ...appConfig.state } },
        conversation: {
          namespaced: true,
          state: () => ({ size: 0, loading: false }),
          getters: {
            getConversationSize: state => state.size,
            getIsFetchingList: state => state.loading,
            getUnreadMessageCount: () => 0,
            getGroupedConversation: () => [],
            getEarliestMessage: () => ({}),
            getLastMessage: () => ({}),
            getAllMessagesLoaded: () => true,
            getIsAgentTyping: () => false,
          },
          actions: { setUserLastSeen: vi.fn() },
        },
        agent: {
          namespaced: true,
          getters: { availableAgents: () => [] },
        },
        conversationAttributes: {
          namespaced: true,
          getters: { getConversationParams: () => ({}) },
        },
        contacts: {
          namespaced: true,
          getters: { getCurrentUser: () => ({}) },
        },
        contactHistory: {
          namespaced: true,
          state: () => ({
            records: [
              {
                id: 7,
                content: 'Earlier message from MAX',
                // EVIRMA: Match the required string enum supplied by Widget::ContactHistory.
                message_type: 'outgoing',
                channel: { name: 'Support MAX', label: 'max' },
                created_at: 1700000000,
                attachments: [],
              },
            ],
          }),
          actions: { fetch: vi.fn() },
        },
      },
    });
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'home', component: Home },
        { path: '/messages', name: 'messages', component: Messages },
        {
          path: '/prechat-form',
          name: 'prechat-form',
          component: { template: '<form />' },
        },
      ],
    });
    await router.push('/');
    await router.isReady();
    wrapper = mount(
      { template: '<router-view />' },
      {
        global: {
          plugins: [store, router],
          directives: { 'on-clickaway': onClickaway },
          stubs: {
            TeamAvailability: true,
            ArticleContainer: true,
            ChatMessage: true,
            AgentTypingBubble: true,
            DateSeparator: true,
            Spinner: true,
            ChatAttachmentButton: true,
            ChatSendButton: true,
            FluentIcon: true,
            FooterReplyTo: true,
          },
        },
      }
    );
  });

  afterEach(() => {
    wrapper.unmount();
    delete window.chatwootWebChannel;
  });

  it.each([false, undefined])(
    'keeps home and starts a conversation on request with skipHome=%s',
    async skipHome => {
      await store.dispatch('appConfig/setAppConfig', { skipHome });
      await flushPromises();
      expect(router.currentRoute.value.name).toBe('home');

      wrapper.findComponent(TeamAvailability).vm.$emit('startConversation');
      await flushPromises();
      expect(router.currentRoute.value.name).toBe('messages');
      expect(wrapper.find('textarea').exists()).toBe(true);
    }
  );

  it.each([
    [0, false],
    [1, false],
    [1, true],
  ])(
    'opens messages with input and cross-channel history (size=%s, prechat=%s)',
    async (size, prechat) => {
      store.state.conversation.size = size;
      window.chatwootWebChannel.preChatFormEnabled = prechat;
      await store.dispatch('appConfig/setAppConfig', { skipHome: true });
      await flushPromises();

      expect(router.currentRoute.value.name).toBe('messages');
      expect(wrapper.find('textarea').exists()).toBe(true);
      expect(wrapper.get('summary').text()).toBe(
        'EVIRMA_CONTACT_HISTORY.TITLE'
      );
      // EVIRMA: ChatMessage is stubbed here; inspect its public message prop.
      expect(
        wrapper.getComponent({ name: 'ChatMessage' }).props('message')
      ).toMatchObject({ content: 'Earlier message from MAX' });
    }
  );

  it('keeps the enabled prechat form for a new conversation', async () => {
    window.chatwootWebChannel.preChatFormEnabled = true;
    await store.dispatch('appConfig/setAppConfig', { skipHome: true });
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('prechat-form');
    expect(wrapper.find('textarea').exists()).toBe(false);
  });

  it('waits for existing conversations before deciding whether prechat is needed', async () => {
    window.chatwootWebChannel.preChatFormEnabled = true;
    store.state.conversation.loading = true;
    await store.dispatch('appConfig/setAppConfig', { skipHome: true });
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('home');

    store.state.conversation.size = 1;
    store.state.conversation.loading = false;
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('messages');
  });

  it('skips home again after returning from another widget view', async () => {
    await store.dispatch('appConfig/setAppConfig', { skipHome: true });
    await flushPromises();
    await router.replace({ name: 'home' });
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('messages');
  });

  it('defaults skipHome to false and resets it when omitted from config-set', async () => {
    expect(store.state.appConfig.skipHome).toBe(false);
    await store.dispatch('appConfig/setAppConfig', { skipHome: true });
    await store.dispatch('appConfig/setAppConfig', {});

    expect(store.state.appConfig.skipHome).toBe(false);
  });
});
