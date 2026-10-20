// EVIRMA: Check the real message menu eligibility and metadata rendering.
import { defineComponent, ref } from 'vue';
import { mount, shallowMount } from '@vue/test-utils';
import { createStore } from 'vuex';
import Message from '../Message.vue';
import MessageMeta from '../MessageMeta.vue';
import ContextMenu from 'dashboard/modules/conversations/components/MessageContextMenu.vue';
import { provideMessageContext } from '../provider';
import MenuItem from 'dashboard/components/widgets/conversation/contextMenu/menuItem.vue';

vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));

const store = createStore({
  getters: {
    'inboxes/getInbox': () => () => ({}),
    'inboxes/getInboxById': () => () => ({
      channel_type: 'Channel::WebWidget',
    }),
    'globalConfig/isOnChatwootCloud': () => false,
    'globalConfig/get': () => ({}),
    getSelectedChat: () => ({ inbox_id: 1 }),
    getSelectedChatAttachments: () => [],
  },
});

const messageProps = {
  id: 10,
  conversationId: 1,
  createdAt: 1723456789,
  currentUserId: 7,
  messageType: 1,
  status: 'sent',
  content: 'Original text',
  sender: { id: 7, type: 'user', name: 'Agent' },
};

describe('operator message editing', () => {
  it.each([
    ['own outgoing', {}, true],
    ['own note', { private: true }, true],
    ['another operator', { sender: { id: 8, type: 'user' } }, false],
    ['incoming', { messageType: 0 }, false],
    ['email', { isEmailInbox: true }, false],
    ['deleted', { contentAttributes: { deleted: true } }, false],
    [
      'without text',
      { content: '', attachments: [{ fileType: 'image' }] },
      false,
    ],
    [
      'bot with same numeric ID',
      { sender: { id: 7, type: 'agent_bot' } },
      false,
    ],
  ])(
    'offers Edit only for eligible messages: %s',
    (_name, overrides, expected) => {
      const wrapper = shallowMount(Message, {
        props: { ...messageProps, ...overrides },
        global: { plugins: [store] },
      });
      const menu = wrapper.findComponent(ContextMenu);
      expect(menu.props('enabledOptions').edit).toBe(expected);
      expect(menu.props('hideButton')).toBe(false);
      wrapper.unmount();
    }
  );

  it.each([true, false])(
    'renders the Edit menu item only when eligible: %s',
    async enabled => {
      const wrapper = shallowMount(ContextMenu, {
        props: {
          message: { id: 10, content: 'Original text' },
          isOpen: true,
          enabledOptions: { edit: enabled },
        },
        global: {
          plugins: [store],
          stubs: { ContextMenu: { template: '<div><slot /></div>' } },
        },
      });
      const editItem = wrapper
        .findAllComponents(MenuItem)
        .find(
          item =>
            item.props('option').label ===
            'CONVERSATION.EVIRMA_MESSAGE_EDIT.EDIT'
        );
      expect(!!editItem).toBe(enabled);
      if (enabled) {
        editItem.vm.$emit('click', new MouseEvent('click'));
        expect(wrapper.emitted('edit')).toHaveLength(1);
        expect(wrapper.emitted('close')).toHaveLength(1);
      }
      wrapper.unmount();
    }
  );

  it.each([
    [{ editedAt: '2026-10-19T12:00:00Z' }, true],
    [{}, false],
    [{ editedAt: '2026-10-19T12:00:00Z', deleted: true }, false],
  ])('marks only edited, non-deleted messages: %j', (attributes, visible) => {
    const Host = defineComponent({
      components: { MessageMeta },
      setup() {
        provideMessageContext({
          status: ref('sent'),
          isPrivate: ref(false),
          createdAt: ref(1723456789),
          sourceId: ref('123'),
          messageType: ref(1),
          contentAttributes: ref(attributes),
        });
      },
      template: '<MessageMeta />',
    });
    const wrapper = mount(Host, { global: { plugins: [store] } });
    expect(
      wrapper.text().includes('CONVERSATION.EVIRMA_MESSAGE_EDIT.EDITED')
    ).toBe(visible);
    wrapper.unmount();
  });
});
