// EVIRMA: The source label is rendered next to the time of incoming customer messages only.
import { defineComponent, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import MessageMeta from '../MessageMeta.vue';
import { provideMessageContext } from '../provider';

const createTestStore = (inbox, chat = { inbox_id: 1 }) =>
  createStore({
    getters: {
      'inboxes/getInboxById': () => () => inbox,
      getSelectedChat: () => chat,
    },
  });

const mountMeta = ({
  store,
  messageType = 0,
  isPrivate = false,
  attributes = {},
}) => {
  const Host = defineComponent({
    components: { MessageMeta },
    setup() {
      provideMessageContext({
        status: ref('sent'),
        isPrivate: ref(isPrivate),
        createdAt: ref(1723456789),
        sourceId: ref(null),
        messageType: ref(messageType),
        contentAttributes: ref(attributes),
      });
    },
    template: '<MessageMeta />',
  });
  return mount(Host, { global: { plugins: [store] } });
};

const label = wrapper => wrapper.find('[data-test-id="evirma-message-source"]');

describe('MessageMeta EVIRMA source label', () => {
  const web = { channel_type: 'Channel::WebWidget' };

  it('shows the WB label for an incoming message from a WB page', () => {
    const wrapper = mountMeta({
      store: createTestStore(web),
      attributes: { evirmaSourceHost: 'seller.wildberries.ru' },
    });
    expect(label(wrapper).text()).toBe('CONVERSATION.EVIRMA_MESSAGE_SOURCE.WB');
  });

  it('shows the site label for an incoming message from evirma.ru', () => {
    const wrapper = mountMeta({
      store: createTestStore(web),
      attributes: { evirmaSourceHost: 'evirma.ru' },
    });
    expect(label(wrapper).text()).toBe(
      'CONVERSATION.EVIRMA_MESSAGE_SOURCE.SITE'
    );
  });

  it('falls back to the conversation source for older messages', () => {
    const wrapper = mountMeta({
      store: createTestStore(web, {
        inbox_id: 1,
        custom_attributes: { source: 'extension' },
      }),
    });
    expect(label(wrapper).text()).toBe('CONVERSATION.EVIRMA_MESSAGE_SOURCE.WB');
  });

  it('labels Telegram and MAX inboxes', () => {
    const telegram = mountMeta({
      store: createTestStore({ channel_type: 'Channel::Telegram' }),
    });
    expect(label(telegram).text()).toBe(
      'CONVERSATION.EVIRMA_MESSAGE_SOURCE.TELEGRAM'
    );
    const max = mountMeta({
      store: createTestStore({
        channel_type: 'Channel::Api',
        webhook_url: 'https://evirma.ru/api/v1/support/max/chatwoot-webhook',
      }),
    });
    expect(label(max).text()).toBe('CONVERSATION.EVIRMA_MESSAGE_SOURCE.MAX');
  });

  it.each([
    ['outgoing', { messageType: 1 }],
    ['private note', { isPrivate: true }],
  ])('hides the label for an %s', (_, options) => {
    const wrapper = mountMeta({
      store: createTestStore(web),
      attributes: { evirmaSourceHost: 'evirma.ru' },
      ...options,
    });
    expect(label(wrapper).exists()).toBe(false);
  });
});
