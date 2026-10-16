// EVIRMA: Render history through the same message components as the active conversation.
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import VueDOMPurifyHTML from 'vue-dompurify-html';
import EvirmaContactHistory from '../EvirmaContactHistory.vue';
import ChatMessage from '../ChatMessage.vue';
import AgentMessage from '../AgentMessage.vue';
import UserMessage from '../UserMessage.vue';
import DateSeparator from '../DateSeparator.vue';

describe('EvirmaContactHistory', () => {
  const message = {
    id: 7,
    content: '<script>alert(1)</script>Hello from MAX',
    message_type: 'outgoing',
    content_type: 'text',
    content_attributes: {},
    created_at: 1700000000,
    sender: {
      name: 'Agent',
      type: 'user',
      avatar_url: 'https://example.com/avatar.png',
    },
    channel_type: 'Channel::Api',
    channel: {
      name: 'Support MAX bot',
      label: 'max',
      channel_type: 'Channel::Api',
    },
    attachments: [
      { id: 8, file_type: 'file', data_url: 'https://example.com/report.pdf' },
    ],
  };
  const wrappers = [];
  beforeEach(() => {
    window.chatwootWebChannel = { enabledFeatures: [] };
  });
  afterEach(() => {
    wrappers.forEach(wrapper => wrapper.unmount());
    wrappers.length = 0;
    delete window.chatwootWebChannel;
  });

  const render = (records = []) => {
    const fetch = vi.fn();
    const store = createStore({
      modules: {
        contactHistory: {
          namespaced: true,
          state: () => ({ records }),
          actions: { fetch },
        },
        conversation: {
          namespaced: true,
          getters: { getConversation: () => ({}) },
        },
        appConfig: {
          namespaced: true,
          state: () => ({ isOpen: false }),
          getters: {
            getIsWidgetOpen: state => state.isOpen,
            getWidgetColor: () => '#123456',
          },
          mutations: {
            open: state => {
              state.isOpen = true;
            },
          },
        },
      },
    });
    const wrapper = mount(EvirmaContactHistory, {
      global: { plugins: [store, VueDOMPurifyHTML] },
    });
    wrappers.push(wrapper);
    return { wrapper, store, fetch };
  };

  it('fetches on mounting and has no visible block when history is empty', () => {
    const { wrapper, fetch } = render();
    expect(fetch).toHaveBeenCalledOnce();
    expect(wrapper.find('details').exists()).toBe(false);
  });

  it('keeps the expanded history collapsible', () => {
    const { wrapper } = render([message]);
    const details = wrapper.get('details');
    expect(details.element.open).toBe(true);
    wrapper.get('summary').element.click();
    expect(details.element.open).toBe(false);
    wrapper.get('summary').element.click();
    expect(details.element.open).toBe(true);
  });

  it('uses native operator bubbles, avatars and attachments without reply controls', () => {
    const { wrapper } = render([message]);
    expect(wrapper.findComponent(ChatMessage).exists()).toBe(true);
    expect(wrapper.findComponent(AgentMessage).exists()).toBe(true);
    expect(wrapper.get('.chat-bubble.agent').text()).toContain(
      'Hello from MAX'
    );
    expect(wrapper.get('.agent-name').text()).toBe('Agent');
    expect(wrapper.get('img').attributes('src')).toBe(
      message.sender.avatar_url
    );
    expect(wrapper.get('a.download').attributes('href')).toBe(
      message.attachments[0].data_url
    );
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('input, textarea, button').exists()).toBe(false);
    expect(wrapper.findComponent(DateSeparator).exists()).toBe(true);
  });

  it('uses native customer bubbles and the configured widget color', () => {
    const { wrapper } = render([
      {
        ...message,
        message_type: 'incoming',
        content: 'Customer reply',
        attachments: [],
      },
    ]);
    expect(wrapper.findComponent(UserMessage).exists()).toBe(true);
    expect(wrapper.findComponent(AgentMessage).exists()).toBe(false);
    expect(wrapper.get('.chat-bubble.user').element.style.background).toBe(
      'rgb(18, 52, 86)'
    );
    expect(wrapper.find('button').exists()).toBe(false);
    expect(
      wrapper.findComponent({ name: 'DragWrapper' }).props('disabled')
    ).toBe(true);
  });

  it.each([
    ['Channel::Telegram', 'i-woot-telegram'],
    ['Channel::Api', 'i-woot-api'],
    ['Channel::WebWidget', 'i-woot-website'],
    ['Channel::Email', 'i-woot-mail'],
  ])(
    'shows only a small channel icon for %s, without the bot or inbox name',
    (channelType, icon) => {
      const { wrapper } = render([
        {
          ...message,
          channel_type: channelType,
          sender: { ...message.sender, name: 'Evirma', type: 'agent_bot' },
        },
      ]);
      expect(wrapper.find(`.${icon}`).exists()).toBe(true);
      expect(wrapper.get('.agent-name').text()).toBe('Evirma');
      expect(wrapper.text()).not.toContain('Support MAX bot');
      expect(wrapper.text()).not.toContain('telegram');
    }
  );

  it('refreshes when the widget is reopened', async () => {
    const { store, fetch } = render([message]);
    store.commit('appConfig/open');
    await flushPromises();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shows live messages added to the store', async () => {
    const { wrapper, store } = render();
    store.state.contactHistory.records = [message];
    await flushPromises();
    expect(wrapper.get('.chat-bubble.agent').text()).toContain(
      'Hello from MAX'
    );
    expect(wrapper.get('details').element.open).toBe(true);
  });
});
