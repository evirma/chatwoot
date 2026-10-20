import { shallowMount, flushPromises } from '@vue/test-utils';
import { REPLY_EDITOR_MODES } from 'dashboard/components/widgets/WootWriter/constants';
import { nextTick } from 'vue';
import { createStore } from 'vuex';
import ReplyBox from '../ReplyBox.vue';
// EVIRMA: The browser editor focus is outside these composer-state checks.
import WootMessageEditor from '../../WootWriter/Editor.vue';
// EVIRMA: Exercise the public event that opens editing in the existing composer.
import { BUS_EVENTS } from 'shared/constants/busEvents';
import { emitter } from 'shared/helpers/mitt';
import { LocalStorage } from 'shared/helpers/localStorage';
import { LOCAL_STORAGE_KEYS } from 'dashboard/constants/localStorage';
import WhatsappTemplates from '../WhatsappTemplates/Modal.vue';

const CHANNELS = [
  { name: 'WhatsApp Cloud', inbox: { channel_type: 'Channel::Whatsapp' } },
  {
    name: 'Twilio WhatsApp',
    inbox: { channel_type: 'Channel::TwilioSms', medium: 'whatsapp' },
  },
  { name: 'API', inbox: { channel_type: 'Channel::Api' } },
  { name: 'Instagram', inbox: { channel_type: 'Channel::Instagram' } },
  { name: 'TikTok', inbox: { channel_type: 'Channel::Tiktok' } },
  { name: 'Facebook', inbox: { channel_type: 'Channel::FacebookPage' } },
  { name: 'Line', inbox: { channel_type: 'Channel::Line' } },
  { name: 'Telegram', inbox: { channel_type: 'Channel::Telegram' } },
  { name: 'Email', inbox: { channel_type: 'Channel::Email' } },
  { name: 'Web widget', inbox: { channel_type: 'Channel::WebWidget' } },
];

const exemptFromMessagingWindow = name =>
  ['WhatsApp Cloud', 'Twilio WhatsApp', 'API'].includes(name);

const REPLIABLE = {
  id: 1,
  inbox_id: 1,
  can_reply: true,
  status: 'open',
  meta: { sender: { id: 2 } },
  messages: [],
};

const buildStore = ({
  inbox,
  chat,
  templates,
  drafts = {},
  inboxes,
  isMetaMessageSendingDisabled = false,
}) =>
  createStore({
    state: {
      chat: { ...REPLIABLE, ...chat },
      replyEditorMode: REPLY_EDITOR_MODES.REPLY,
      drafts: { ...drafts },
    },
    mutations: {
      selectChat: (s, c) => {
        s.chat = c;
      },
      setReplyEditorMode: (s, mode) => {
        s.replyEditorMode = mode;
      },
      setDraft: (s, { key, message }) => {
        s.drafts = { ...s.drafts, [key]: message };
      },
    },
    actions: {
      'draftMessages/setReplyEditorMode': ({ commit }, { mode }) =>
        commit('setReplyEditorMode', mode),
      'draftMessages/set': ({ commit }, payload) => commit('setDraft', payload),
    },
    getters: {
      getSelectedChat: s => s.chat,
      getCurrentUser: () => ({ id: 7, name: 'Agent', accounts: [] }),
      getCurrentAccountId: () => 1,
      getMessageSignature: () => '',
      getUISettings: () => ({}),
      getLastEmailInSelectedChat: () => null,
      'globalConfig/get': () => ({}),
      'globalConfig/isMetaMessageSendingDisabled': () =>
        isMetaMessageSendingDisabled,
      'inboxes/getInbox': () => inboxId => ({
        id: inboxId,
        ...(inboxes?.[inboxId] || inbox),
      }),
      'inboxes/getWhatsAppTemplates': () => () => templates,
      'contacts/getContact': () => () => ({}),
      'draftMessages/get': s => key => s.drafts[key] || '',
      'draftMessages/getReplyEditorMode': s => s.replyEditorMode,
      'accounts/isFeatureEnabledonAccount': () => () => false,
      'accounts/getAccount': () => () => ({}),
      'portals/allPortals': () => [],
      'integrations/getUIFlags': () => ({ isFetching: false }),
    },
  });

const mountWith = ({
  inbox,
  chat,
  templates = [{ name: 'greeting' }],
  drafts,
  inboxes,
  isMetaMessageSendingDisabled,
  attachTo,
}) => {
  const store = buildStore({
    inbox,
    chat,
    templates,
    drafts,
    inboxes,
    isMetaMessageSendingDisabled,
  });
  const wrapper = shallowMount(ReplyBox, {
    attachTo,
    global: {
      plugins: [store],
      mocks: { $t: key => key },
      // The bottom panel sits inside a <Transition>, which shallowMount stubs
      // without rendering its children.
      stubs: {
        transition: false,
        // EVIRMA: Keep real editor props while replacing ProseMirror's DOM/focus.
        WootMessageEditor: {
          name: 'WootMessageEditor',
          props: WootMessageEditor.props,
          methods: { focusEditorInputField: vi.fn() },
          template: '<textarea />',
        },
      },
    },
  });
  return { wrapper, store };
};

const topPanel = wrapper =>
  wrapper.findComponent({ name: 'ReplyTopPanel' }).props();
const bottomPanel = wrapper =>
  wrapper.findComponent({ name: 'ReplyBottomPanel' }).props();
const editor = wrapper =>
  wrapper.findComponent({ name: 'WootMessageEditor' }).props();

describe('ReplyBox', () => {
  // EVIRMA: Edits submit once through their own route and preserve unsent replies.
  describe('editing a sent message', () => {
    const sentMessage = {
      id: 10,
      conversationId: 1,
      content: 'Original text',
      private: false,
    };

    it('loads the existing text, disables attachments and restores the original draft on cancel', async () => {
      const { wrapper, store } = mountWith({
        inbox: { channel_type: 'Channel::WebWidget' },
      });
      await wrapper.setData({ message: 'Unsent reply' });
      emitter.emit(BUS_EVENTS.EDIT_MESSAGE, sentMessage);
      await nextTick();
      expect(editor(wrapper).modelValue).toBe('Original text');
      expect(wrapper.text()).toContain(
        'CONVERSATION.EVIRMA_MESSAGE_EDIT.EDITING'
      );
      expect(wrapper.findComponent({ name: 'ReplyBottomPanel' }).exists()).toBe(
        false
      );
      expect(editor(wrapper).allowSignature).toBe(false);
      expect(editor(wrapper).enableImageUpload).toBe(false);
      wrapper.vm.message = 'Edited text';
      wrapper.vm.saveDraft(1, REPLY_EDITOR_MODES.REPLY);
      expect(store.getters['draftMessages/get']('draft-1-REPLY')).toBe(
        'Unsent reply'
      );
      await wrapper.get('[aria-label="GENERAL.CANCEL"]').trigger('click');
      await nextTick();
      expect(editor(wrapper).modelValue).toBe('Unsent reply');
      expect(wrapper.vm.editingMessage).toBeNull();
      expect(editor(wrapper).enableImageUpload).toBe(true);
      wrapper.unmount();
    });

    it('cancels editing with Escape while the editor is focused', async () => {
      const { wrapper } = mountWith({
        inbox: { channel_type: 'Channel::WebWidget' },
        attachTo: document.body,
      });
      await wrapper.setData({ message: 'Unsent reply' });
      emitter.emit(BUS_EVENTS.EDIT_MESSAGE, sentMessage);
      await flushPromises();
      const input = wrapper.get('textarea').element;
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
        })
      );
      await nextTick();
      expect(editor(wrapper).modelValue).toBe('Unsent reply');
      expect(wrapper.vm.editingMessage).toBeNull();
      wrapper.unmount();
    });

    it('saves the edited content instead of creating a new message', async () => {
      const { wrapper, store } = mountWith({
        inbox: { channel_type: 'Channel::WebWidget' },
      });
      const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue({});
      emitter.emit(BUS_EVENTS.EDIT_MESSAGE, sentMessage);
      await nextTick();
      await wrapper.setData({ message: 'Edited text' });
      await wrapper.vm.onSendReply();
      expect(dispatch).toHaveBeenCalledWith('editMessage', {
        conversationId: 1,
        messageId: 10,
        content: 'Edited text',
      });
      expect(
        dispatch.mock.calls.some(([action]) => action === 'sendMessage')
      ).toBe(false);
      expect(wrapper.vm.editingMessage).toBeNull();
      wrapper.unmount();
    });

    it('restores a reply draft after editing a private note', async () => {
      const { wrapper, store } = mountWith({
        inbox: { channel_type: 'Channel::WebWidget' },
        drafts: {
          'draft-1-REPLY': 'Public draft',
          'draft-1-NOTE': 'Private draft',
        },
      });
      emitter.emit(BUS_EVENTS.EDIT_MESSAGE, { ...sentMessage, private: true });
      await nextTick();
      expect(editor(wrapper).isPrivate).toBe(true);
      wrapper.vm.cancelMessageEdit();
      await nextTick();
      expect(editor(wrapper).modelValue).toBe('Public draft');
      expect(store.getters['draftMessages/get']('draft-1-NOTE')).toBe(
        'Private draft'
      );
      wrapper.unmount();
    });

    it('keeps failed edits open with the entered text', async () => {
      const { wrapper, store } = mountWith({
        inbox: { channel_type: 'Channel::WebWidget' },
      });
      vi.spyOn(store, 'dispatch').mockRejectedValue(
        new Error('Network unavailable')
      );
      emitter.emit(BUS_EVENTS.EDIT_MESSAGE, sentMessage);
      await nextTick();
      await wrapper.setData({ message: 'Edited text' });
      await wrapper.vm.onSendReply();
      expect(editor(wrapper).modelValue).toBe('Edited text');
      expect(wrapper.vm.editingMessage.id).toBe(10);
      wrapper.unmount();
    });

    // EVIRMA: Editing must not leak into the next conversation or overwrite either reply draft.
    it('resets editing when switching conversations and loads the new conversation draft', async () => {
      const { wrapper, store } = mountWith({
        inbox: { channel_type: 'Channel::WebWidget' },
        drafts: {
          'draft-1-REPLY': 'First draft',
          'draft-2-REPLY': 'Second draft',
        },
      });
      emitter.emit(BUS_EVENTS.EDIT_MESSAGE, sentMessage);
      await nextTick();
      await wrapper.setData({ message: 'Edited text' });

      store.commit('selectChat', { ...REPLIABLE, id: 2 });
      await nextTick();

      expect(wrapper.vm.editingMessage).toBeNull();
      expect(editor(wrapper).modelValue).toBe('Second draft');
      expect(store.getters['draftMessages/get']('draft-1-REPLY')).toBe(
        'First draft'
      );
      expect(editor(wrapper).enableImageUpload).toBe(true);
      wrapper.unmount();
    });

    // EVIRMA: Both exits restore the selected quote and the ordinary send path.
    it.each(['cancel', 'save'])(
      'sends a normal reply with its selected quote after %s',
      async exit => {
        LocalStorage.updateJsonStore(
          LOCAL_STORAGE_KEYS.MESSAGE_REPLY_TO,
          1,
          99
        );
        const { wrapper, store } = mountWith({
          inbox: { channel_type: 'Channel::WebWidget' },
          chat: { messages: [{ id: 99, content: 'Quoted message' }] },
          drafts: { 'draft-1-REPLY': 'Unsent reply' },
        });
        const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue({});
        emitter.emit(BUS_EVENTS.EDIT_MESSAGE, sentMessage);
        await nextTick();
        if (exit === 'save') {
          await wrapper.setData({ message: 'Edited text' });
          await wrapper.vm.onSendReply();
        } else {
          await wrapper.get('[aria-label="GENERAL.CANCEL"]').trigger('click');
        }
        await nextTick();
        expect(editor(wrapper).modelValue).toBe('Unsent reply');
        expect(
          wrapper.findComponent({ name: 'ReplyToMessage' }).props('message').id
        ).toBe(99);
        expect(editor(wrapper).enableImageUpload).toBe(true);
        dispatch.mockClear();

        await wrapper.vm.onSendReply();
        await flushPromises();

        expect(dispatch).toHaveBeenCalledWith(
          'createPendingMessageAndSend',
          expect.objectContaining({
            conversationId: 1,
            message: 'Unsent reply',
            contentAttributes: { in_reply_to: 99 },
          })
        );
        expect(
          dispatch.mock.calls.some(([action]) => action === 'editMessage')
        ).toBe(false);
        expect(editor(wrapper).modelValue).toBe('');
        wrapper.unmount();
        LocalStorage.remove(LOCAL_STORAGE_KEYS.MESSAGE_REPLY_TO);
      }
    );
  });

  describe('Instagram incident restriction', () => {
    it('opens in note mode and restores only the private-note draft', async () => {
      const { wrapper, store } = mountWith({
        inbox: { channel_type: 'Channel::Instagram' },
        isMetaMessageSendingDisabled: true,
        drafts: {
          'draft-1-REPLY': 'unsent public reply',
          'draft-1-NOTE': 'incident note',
        },
      });
      await nextTick();

      expect(topPanel(wrapper).mode).toBe(REPLY_EDITOR_MODES.NOTE);
      expect(topPanel(wrapper).isReplyRestricted).toBe(true);
      expect(bottomPanel(wrapper).isOnPrivateNote).toBe(true);
      expect(editor(wrapper).editorId).toBe('draft-1-NOTE');
      expect(wrapper.vm.message).toBe('incident note');
      expect(store.getters['draftMessages/getReplyEditorMode']).toBe(
        REPLY_EDITOR_MODES.NOTE
      );
      expect(store.getters['draftMessages/get']('draft-1-REPLY')).toBe(
        'unsent public reply'
      );
    });

    it('preserves draft ownership when switching to a restricted conversation', async () => {
      const drafts = {
        'draft-1-REPLY': 'conversation A reply',
        'draft-1-NOTE': 'conversation A note',
        'draft-2-REPLY': 'conversation B reply',
        'draft-2-NOTE': 'conversation B note',
      };
      const { wrapper, store } = mountWith({
        inbox: { channel_type: 'Channel::WebWidget' },
        inboxes: {
          1: { channel_type: 'Channel::WebWidget' },
          2: { channel_type: 'Channel::Instagram' },
        },
        drafts,
        isMetaMessageSendingDisabled: true,
      });
      await nextTick();

      store.commit('selectChat', { ...REPLIABLE, id: 2, inbox_id: 2 });
      await nextTick();

      expect(editor(wrapper)).toMatchObject({
        editorId: 'draft-2-NOTE',
        modelValue: 'conversation B note',
      });
      Object.entries(drafts).forEach(([key, message]) => {
        expect(store.getters['draftMessages/get'](key)).toBe(message);
      });
    });
  });

  describe.each(CHANNELS)('$name', ({ name, inbox }) => {
    it('locks the composer and hides template sends when a bot owns a pending conversation', () => {
      const { wrapper } = mountWith({
        inbox,
        chat: {
          status: 'pending',
          meta: { sender: { id: 2 }, assignee_type: 'AgentBot' },
        },
      });

      expect(topPanel(wrapper).isReplyRestricted).toBe(true);
      expect(bottomPanel(wrapper).enableWhatsAppTemplates).toBe(false);
      expect(bottomPanel(wrapper).enableContentTemplates).toBe(false);
      // The note composer stays usable — this is a restriction, not a lockout.
      expect(topPanel(wrapper).isEditorDisabled).toBe(false);
    });

    it('opens directly in note mode when a bot already owns the pending conversation', () => {
      const { wrapper, store } = mountWith({
        inbox,
        chat: {
          can_reply: false,
          status: 'pending',
          meta: { sender: { id: 2 }, assignee_type: 'AgentBot' },
        },
      });

      expect(bottomPanel(wrapper).isOnPrivateNote).toBe(true);
      expect(store.getters['draftMessages/getReplyEditorMode']).toBe(
        REPLY_EDITOR_MODES.NOTE
      );
      expect(topPanel(wrapper).isEditorDisabled).toBe(false);
    });

    it('opens in reply mode for every other conversation', () => {
      const { wrapper, store } = mountWith({ inbox });

      expect(bottomPanel(wrapper).isOnPrivateNote).toBe(false);
      expect(store.getters['draftMessages/getReplyEditorMode']).toBe(
        REPLY_EDITOR_MODES.REPLY
      );
    });

    it.each(['open', 'resolved', 'snoozed'])(
      'leaves the composer open when a bot owns a %s conversation',
      status => {
        const { wrapper } = mountWith({
          inbox,
          chat: {
            status,
            meta: { sender: { id: 2 }, assignee_type: 'AgentBot' },
          },
        });

        expect(topPanel(wrapper).isReplyRestricted).toBe(false);
        expect(bottomPanel(wrapper).enableWhatsAppTemplates).toBe(true);
      }
    );

    it('leaves the composer open when a human owns a pending conversation', () => {
      const { wrapper } = mountWith({
        inbox,
        chat: {
          status: 'pending',
          meta: { sender: { id: 2 }, assignee_type: 'User' },
        },
      });

      expect(topPanel(wrapper).isReplyRestricted).toBe(false);
      expect(bottomPanel(wrapper).enableWhatsAppTemplates).toBe(true);
    });

    it('matches the existing messaging-window rule when no bot is involved', () => {
      const { wrapper } = mountWith({
        inbox,
        chat: { can_reply: false, status: 'resolved' },
      });

      const stillRepliable = exemptFromMessagingWindow(name);
      expect(topPanel(wrapper).isReplyRestricted).toBe(!stillRepliable);
      expect(bottomPanel(wrapper).enableWhatsAppTemplates).toBe(stillRepliable);
      // WhatsApp/API disable the editor and steer to templates; everywhere
      // else the composer falls back to a usable private note.
      expect(topPanel(wrapper).isEditorDisabled).toBe(stillRepliable);
    });
  });

  it('hides the template action when the inbox has no templates synced', () => {
    const { wrapper } = mountWith({
      inbox: { channel_type: 'Channel::Whatsapp' },
      chat: { can_reply: false, status: 'open' },
      templates: [],
    });

    expect(bottomPanel(wrapper).enableWhatsAppTemplates).toBe(false);
    expect(topPanel(wrapper).isReplyRestricted).toBe(false);
  });

  describe('drafts', () => {
    const DRAFTS = {
      'draft-1-REPLY': 'half typed reply',
      'draft-1-NOTE': 'a note',
    };

    it('loads the note draft while a bot owns the conversation', async () => {
      const { wrapper } = mountWith({
        inbox: { channel_type: 'Channel::WebWidget' },
        chat: {
          status: 'pending',
          meta: { sender: { id: 2 }, assignee_type: 'AgentBot' },
        },
        drafts: DRAFTS,
      });
      await nextTick();

      expect(editor(wrapper)).toMatchObject({
        editorId: 'draft-1-NOTE',
        modelValue: 'a note',
      });
    });

    it('leaves the saved reply draft intact and restores it on takeover', async () => {
      const { wrapper, store } = mountWith({
        inbox: { channel_type: 'Channel::WebWidget' },
        chat: {
          status: 'pending',
          meta: { sender: { id: 2 }, assignee_type: 'AgentBot' },
        },
        drafts: DRAFTS,
      });
      await nextTick();
      expect(store.getters['draftMessages/get']('draft-1-REPLY')).toBe(
        'half typed reply'
      );

      store.commit('selectChat', {
        ...REPLIABLE,
        status: 'open',
        meta: { sender: { id: 2 }, assignee_type: 'User' },
      });
      await nextTick();

      expect(editor(wrapper)).toMatchObject({
        editorId: 'draft-1-REPLY',
        modelValue: 'half typed reply',
      });
    });
  });

  it('offers content templates on Twilio WhatsApp when no bot owns the conversation', () => {
    const { wrapper } = mountWith({
      inbox: { channel_type: 'Channel::TwilioSms', medium: 'whatsapp' },
      chat: { can_reply: true, status: 'open' },
    });

    expect(bottomPanel(wrapper).enableContentTemplates).toBe(true);
  });

  describe('on selecting a conversation', () => {
    const selectChat = async chat => {
      const { wrapper, store } = mountWith({
        inbox: { channel_type: 'Channel::WebWidget' },
      });
      store.commit('selectChat', { ...REPLIABLE, id: 99, ...chat });
      await nextTick();
      return { wrapper, store };
    };

    it('switches to note mode when a bot owns a pending conversation', async () => {
      const { wrapper } = await selectChat({
        status: 'pending',
        meta: { sender: { id: 2 }, assignee_type: 'AgentBot' },
      });

      expect(bottomPanel(wrapper).isOnPrivateNote).toBe(true);
    });

    it('stays in reply mode when a human owns a pending conversation', async () => {
      const { wrapper } = await selectChat({
        status: 'pending',
        meta: { sender: { id: 2 }, assignee_type: 'User' },
      });

      expect(bottomPanel(wrapper).isOnPrivateNote).toBe(false);
    });

    it('closes an open template modal when a bot takes over the conversation', async () => {
      const { wrapper, store } = mountWith({
        inbox: { channel_type: 'Channel::Whatsapp' },
      });
      wrapper
        .findComponent({ name: 'ReplyBottomPanel' })
        .vm.$emit('selectWhatsappTemplate');
      await nextTick();
      expect(wrapper.findComponent(WhatsappTemplates).props('show')).toBe(true);

      store.commit('selectChat', {
        ...REPLIABLE,
        status: 'pending',
        meta: { sender: { id: 2 }, assignee_type: 'AgentBot' },
      });
      await nextTick();

      expect(wrapper.findComponent(WhatsappTemplates).props('show')).toBe(
        false
      );
    });

    it('returns to reply mode once the agent takes over', async () => {
      const { wrapper, store } = await selectChat({
        status: 'pending',
        meta: { sender: { id: 2 }, assignee_type: 'AgentBot' },
      });
      expect(bottomPanel(wrapper).isOnPrivateNote).toBe(true);

      store.commit('selectChat', {
        ...REPLIABLE,
        id: 99,
        status: 'open',
        meta: { sender: { id: 2 }, assignee_type: 'User' },
      });
      await nextTick();

      expect(bottomPanel(wrapper).isOnPrivateNote).toBe(false);
      expect(topPanel(wrapper).isReplyRestricted).toBe(false);
      expect(store.getters['draftMessages/getReplyEditorMode']).toBe(
        REPLY_EDITOR_MODES.REPLY
      );
    });

    it('keeps the agent in note mode after they chose it themselves', async () => {
      const { wrapper } = await selectChat({});
      wrapper
        .findComponent({ name: 'ReplyTopPanel' })
        .vm.$emit('setReplyMode', REPLY_EDITOR_MODES.NOTE);
      await nextTick();

      expect(bottomPanel(wrapper).isOnPrivateNote).toBe(true);
    });

    it('mirrors the forced note mode into the draftMessages store', async () => {
      const { store } = await selectChat({
        status: 'pending',
        meta: { sender: { id: 2 }, assignee_type: 'AgentBot' },
      });

      expect(store.getters['draftMessages/getReplyEditorMode']).toBe(
        REPLY_EDITOR_MODES.NOTE
      );
    });
  });
});
