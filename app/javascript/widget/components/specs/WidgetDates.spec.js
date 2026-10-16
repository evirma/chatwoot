// EVIRMA: Exercise date formatting through widget output with the real i18n locale.
import { config, mount, shallowMount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import VueDOMPurifyHTML from 'vue-dompurify-html';
import AgentMessage from '../AgentMessage.vue';
import UserMessage from '../UserMessage.vue';
import EvirmaContactHistory from '../EvirmaContactHistory.vue';
import ConversationWrap from '../ConversationWrap.vue';
import { getters } from '../../store/modules/conversation/getters';
import en from '../../i18n/locale/en.json';
import ru from '../../i18n/locale/ru.json';

const originalPlugins = config.global.plugins;

describe('widget dates', () => {
  let i18n;
  let store;
  const timestamp = new Date(2023, 10, 14, 22, 13).getTime() / 1000;
  const message = {
    id: 1,
    created_at: timestamp,
    content: 'Hello',
    content_attributes: {},
    message_type: 1,
    attachments: [{ id: 2, file_type: 'image', data_url: '/image.png' }],
    channel: { name: 'Support', label: 'max' },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2023, 10, 16, 12));
    window.chatwootWebChannel = { enabledFeatures: [] };
    i18n = createI18n({
      legacy: false,
      locale: 'ru',
      messages: { en, ru },
    });
    config.global.plugins = [i18n];
    store = createStore({
      modules: {
        appConfig: {
          namespaced: true,
          getters: {
            darkMode: () => 'light',
            getWidgetColor: () => '#1f93ff',
            getIsWidgetOpen: () => false,
          },
        },
        contactHistory: {
          namespaced: true,
          state: () => ({
            records: [
              {
                ...message,
                message_type: 'outgoing',
                channel_type: 'Channel::Api',
              },
            ],
          }),
          actions: { fetch: vi.fn() },
        },
        conversation: {
          namespaced: true,
          state: () => ({
            conversations: { 1: { ...message } },
            uiFlags: { allMessagesLoaded: true },
          }),
          getters,
        },
        conversationAttributes: {
          namespaced: true,
          getters: { getConversationParams: () => ({ status: 'open' }) },
        },
      },
    });
  });

  afterEach(() => {
    config.global.plugins = originalPlugins;
    vi.useRealTimers();
    delete window.chatwootWebChannel;
  });

  it.each([
    [AgentMessage, '14.11.2023, 22:13', '11/14/2023, 10:13 PM'],
    [UserMessage, '22:13', '10:13 PM'],
  ])(
    'localizes attachment timestamps in $name',
    async (component, russian, english) => {
      const wrapper = shallowMount(component, {
        props: { message },
        global: {
          plugins: [store],
          stubs: { ImageBubble: false },
          renderStubDefaultSlot: true,
        },
      });

      expect(wrapper.get('.time').text()).toBe(russian);
      i18n.global.locale.value = 'en';
      await nextTick();
      expect(wrapper.get('.time').text()).toBe(english);
      wrapper.unmount();
    }
  );

  it.each([
    [timestamp, '22:13', '10:13 PM'],
    [new Date(2023, 0, 2, 0, 5).getTime() / 1000, '00:05', '12:05 AM'],
  ])(
    'localizes history timestamp %s and reacts to a locale change',
    async (time, russian, english) => {
      store.state.contactHistory.records[0].created_at = time;
      const wrapper = mount(EvirmaContactHistory, {
        global: { plugins: [store, VueDOMPurifyHTML] },
      });

      expect(wrapper.get('time').text()).toBe(russian);
      i18n.global.locale.value = 'en';
      await nextTick();
      expect(wrapper.get('time').text()).toBe(english);
      wrapper.unmount();
    }
  );

  // EVIRMA: History uses the same localized separator, including today/yesterday.
  it.each([
    [14, '14.11.2023', '11/14/2023'],
    [15, 'Вчера', 'Yesterday'],
    [16, 'Сегодня', 'Today'],
  ])(
    'localizes the history separator for November %s',
    async (day, russian, english) => {
      store.state.contactHistory.records[0].created_at =
        new Date(2023, 10, day, 12).getTime() / 1000;
      const wrapper = shallowMount(EvirmaContactHistory, {
        global: { plugins: [store], stubs: { DateSeparator: false } },
      });
      expect(wrapper.text()).toContain(russian);
      i18n.global.locale.value = 'en';
      await nextTick();
      expect(wrapper.text()).toContain(english);
      wrapper.unmount();
    }
  );

  it.each([
    [14, '14.11.2023', '11/14/2023'],
    [15, 'Вчера', 'Yesterday'],
    [16, 'Сегодня', 'Today'],
  ])(
    'localizes the conversation date separator for November %s',
    async (day, russian, english) => {
      store.state.conversation.conversations[1].created_at =
        new Date(2023, 10, day, 12).getTime() / 1000;
      const wrapper = shallowMount(ConversationWrap, {
        props: {
          groupedMessages: store.getters['conversation/getGroupedConversation'],
        },
        global: {
          plugins: [store],
          stubs: { DateSeparator: false },
        },
      });

      expect(wrapper.text()).toBe(russian);
      i18n.global.locale.value = 'en';
      await nextTick();
      expect(wrapper.text()).toBe(english);
      wrapper.unmount();
    }
  );
});
