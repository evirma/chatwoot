// EVIRMA: A hidden widget iframe sits on the host page (WB, evirma.ru); it must not take focus or send typed text.
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createStore } from 'vuex';
import ChatInputWrap from '../ChatInputWrap.vue';
import { IFrameHelper } from 'widget/helpers/utils';

const mountInput = isWidgetOpen => {
  const store = createStore({
    state: { isWidgetOpen },
    getters: {
      'appConfig/getWidgetColor': () => '#000',
      'appConfig/getIsWidgetOpen': state => state.isWidgetOpen,
      'appConfig/getShouldShowEmojiPicker': () => false,
      'appConfig/getShouldShowFilePicker': () => false,
    },
    mutations: {
      setOpen: (state, value) => {
        state.isWidgetOpen = value;
      },
    },
    actions: { 'conversation/toggleUserTyping': () => {} },
  });
  const onSendMessage = vi.fn();
  const wrapper = mount(ChatInputWrap, {
    props: { onSendMessage },
    attachTo: document.body,
    global: {
      plugins: [store],
      mocks: { $t: key => key },
      stubs: {
        ChatAttachmentButton: true,
        ChatSendButton: true,
        FluentIcon: true,
      },
    },
  });
  return { wrapper, store, onSendMessage };
};

const pressEnter = () =>
  document.dispatchEvent(
    new KeyboardEvent('keypress', { keyCode: 13, bubbles: true })
  );

describe('ChatInputWrap in a hidden widget iframe', () => {
  let wrapper;

  beforeEach(() => {
    vi.spyOn(IFrameHelper, 'isIFrame').mockReturnValue(true);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  it('does not take focus or send Enter while the widget is hidden', async () => {
    const mounted = mountInput(false);
    wrapper = mounted.wrapper;
    await nextTick();
    await nextTick();
    const textarea = wrapper.find('textarea').element;

    expect(document.activeElement).not.toBe(textarea);

    await wrapper.find('textarea').setValue('dsadasdas');
    expect(document.activeElement).not.toBe(textarea);
    pressEnter();
    expect(mounted.onSendMessage).not.toHaveBeenCalled();
  });

  it('focuses and sends after the widget is opened, and releases focus on close', async () => {
    const mounted = mountInput(false);
    wrapper = mounted.wrapper;
    await nextTick();
    const textarea = wrapper.find('textarea').element;

    mounted.store.commit('setOpen', true);
    await nextTick();
    expect(document.activeElement).toBe(textarea);

    await wrapper.find('textarea').setValue('Здравствуйте');
    pressEnter();
    expect(mounted.onSendMessage).toHaveBeenCalledExactlyOnceWith(
      'Здравствуйте'
    );

    mounted.store.commit('setOpen', false);
    await nextTick();
    expect(document.activeElement).not.toBe(textarea);
  });
});
