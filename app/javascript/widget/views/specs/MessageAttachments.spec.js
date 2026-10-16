// EVIRMA: Dropped and pasted files use the paperclip's upload path.
import { mount, flushPromises, config } from '@vue/test-utils';
import { createStore } from 'vuex';
import FloatingVue from 'floating-vue';
import { routerKey } from 'vue-router';
import { createI18n } from 'vue-i18n';
import { DirectUpload } from 'activestorage';
import { emitter } from 'shared/helpers/mitt';
import { BUS_EVENTS } from 'shared/constants/busEvents';
import Messages from '../Messages.vue';
import en from '../../i18n/locale/en.json';
import ru from '../../i18n/locale/ru.json';

const previousPlugins = config.global.plugins;
const widgetI18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en, ru },
});
beforeAll(() => {
  config.global.plugins = [widgetI18n, FloatingVue];
});
afterAll(() => {
  config.global.plugins = previousPlugins;
});

describe('message attachments', () => {
  let wrapper;
  let sendAttachment;
  let store;
  const createObjectURL = window.URL.createObjectURL;

  beforeEach(() => {
    widgetI18n.global.locale.value = 'en';
    window.chatwootWebChannel = { enabledFeatures: ['attachments'] };
    window.URL.createObjectURL = vi.fn(() => 'blob:attachment');
    sendAttachment = vi.fn();
    store = createStore({
      state: () => ({
        globalConfig: { maximumFileUploadSize: 1, directUploadsEnabled: false },
      }),
      getters: { 'globalConfig/get': state => state.globalConfig },
      modules: {
        conversation: {
          namespaced: true,
          getters: {
            getGroupedConversation: () => [],
            getConversationSize: () => 1,
          },
          actions: {
            sendAttachment,
            setUserLastSeen: vi.fn(),
            toggleUserTyping: vi.fn(),
          },
        },
        conversationAttributes: {
          namespaced: true,
          getters: { getConversationParams: () => ({ status: 'open' }) },
        },
        contacts: {
          namespaced: true,
          getters: { getCurrentUser: () => ({}) },
        },
        appConfig: {
          namespaced: true,
          state: () => ({ allowFiles: true }),
          getters: {
            getShouldShowFilePicker: state => state.allowFiles,
            getShouldShowEmojiPicker: () => false,
            getWidgetColor: () => '#123456',
            getIsWidgetOpen: () => false,
            isWidgetStyleFlat: () => true,
          },
        },
      },
    });
    wrapper = mount(Messages, {
      attachTo: document.body,
      global: {
        plugins: [store],
        provide: { [routerKey]: { replace: vi.fn() } },
        directives: { 'on-clickaway': {} },
        stubs: {
          ConversationWrap: { template: '<div data-test="timeline" />' },
        },
      },
    });
  });

  afterEach(() => {
    wrapper.unmount();
    window.URL.createObjectURL = createObjectURL;
    delete window.chatwootWebChannel;
    vi.restoreAllMocks();
  });

  it.each(['en', 'ru'])(
    'highlights the drop zone in %s and clears it on leaving',
    async locale => {
      wrapper.vm.$i18n.locale = locale;
      const dataTransfer = { types: ['Files'], files: [] };
      const timeline = wrapper.get('[data-test="timeline"]');
      await wrapper.trigger('dragenter', { dataTransfer });
      await timeline.trigger('dragenter', { dataTransfer });
      const event = new Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      timeline.element.dispatchEvent(event);
      await flushPromises();
      expect(event.defaultPrevented).toBe(true);
      expect(wrapper.get('[role="status"]').text()).toBe(
        locale === 'ru' ? 'Отпустите, чтобы отправить' : 'Drop to send'
      );
      await timeline.trigger('dragleave', { relatedTarget: document.body });
      expect(wrapper.find('[role="status"]').exists()).toBe(false);
    }
  );

  it.each(['timeline', 'input'])(
    'sends multiple dropped files over the %s',
    async target => {
      const files = [
        new File(['image'], 'photo.png', { type: 'image/png' }),
        new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
        new File(['document'], 'report.pdf', { type: 'application/pdf' }),
      ];
      await wrapper.get('textarea').setValue('Text in progress');
      const element =
        target === 'timeline'
          ? wrapper.get('[data-test="timeline"]')
          : wrapper.get('textarea');
      await element.trigger('drop', { dataTransfer: { files } });
      await flushPromises();
      expect(sendAttachment).toHaveBeenCalledTimes(3);
      files.forEach((file, index) => {
        expect(sendAttachment.mock.calls[index][1].attachment.file).toBe(file);
      });
      expect(wrapper.get('textarea').element.value).toBe('Text in progress');
    }
  );

  it('pastes an image while a text draft exists', async () => {
    const file = new File(['image'], 'pasted.png', { type: 'image/png' });
    await wrapper.get('textarea').setValue('Draft');
    await wrapper.get('textarea').trigger('paste', {
      clipboardData: { items: [{ kind: 'file', getAsFile: () => file }] },
    });
    await flushPromises();
    expect(sendAttachment).toHaveBeenCalledOnce();
    expect(sendAttachment.mock.calls[0][1].attachment.file).toBe(file);
    expect(wrapper.get('textarea').element.value).toBe('Draft');
  });

  it('uses the same direct upload flow for dropped files', async () => {
    store.state.globalConfig.directUploadsEnabled = true;
    const create = vi
      .spyOn(DirectUpload.prototype, 'create')
      .mockImplementation(callback => {
        callback(null, { signed_id: 'signed-blob' });
      });
    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    await wrapper
      .get('textarea')
      .trigger('drop', { dataTransfer: { files: [file] } });
    await flushPromises();
    expect(create).toHaveBeenCalledOnce();
    expect(sendAttachment.mock.calls[0][1].attachment).toEqual({
      file: 'signed-blob',
      fileType: 'image',
      thumbUrl: 'blob:attachment',
    });
  });

  it.each(['picker', 'drop', 'paste'])(
    'enforces the configured size limit for %s',
    async source => {
      const file = new File([new Uint8Array(1024 * 1024 + 1)], 'large.png', {
        type: 'image/png',
      });
      const alert = vi.spyOn(emitter, 'emit');
      if (source === 'picker') {
        const input = wrapper.get('input[type="file"]');
        Object.defineProperty(input.element, 'files', { value: [file] });
        await input.trigger('change');
      } else if (source === 'drop') {
        await wrapper
          .get('textarea')
          .trigger('drop', { dataTransfer: { files: [file] } });
      } else {
        await wrapper.get('textarea').trigger('paste', {
          clipboardData: { items: [{ kind: 'file', getAsFile: () => file }] },
        });
      }
      await flushPromises();
      expect(sendAttachment).not.toHaveBeenCalled();
      expect(alert).toHaveBeenCalledWith(BUS_EVENTS.SHOW_ALERT, {
        message: 'File exceeds the 1 attachment limit',
      });
    }
  );

  it('accepts files exactly at the configured size limit', async () => {
    const file = new File([new Uint8Array(1024 * 1024)], 'limit.pdf', {
      type: 'application/pdf',
    });
    await wrapper
      .get('textarea')
      .trigger('drop', { dataTransfer: { files: [file] } });
    await flushPromises();
    expect(sendAttachment).toHaveBeenCalledOnce();
  });

  it('rejects dropped types unavailable in the paperclip picker', async () => {
    const file = new File(['binary'], 'program.exe', {
      type: 'application/x-msdownload',
    });
    await wrapper
      .get('textarea')
      .trigger('drop', { dataTransfer: { files: [file] } });
    await flushPromises();
    expect(sendAttachment).not.toHaveBeenCalled();
  });

  it('leaves ordinary pasted text to the input', async () => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { items: [{ kind: 'string' }] },
    });
    wrapper.get('textarea').element.dispatchEvent(event);
    await flushPromises();
    expect(event.defaultPrevented).toBe(false);
    expect(sendAttachment).not.toHaveBeenCalled();
  });

  it('does not send files when uploads are disabled', async () => {
    store.state.appConfig.allowFiles = false;
    await flushPromises();
    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
    wrapper.element.dispatchEvent(event);
    await flushPromises();
    expect(event.defaultPrevented).toBe(true);
    expect(sendAttachment).not.toHaveBeenCalled();
  });
});
