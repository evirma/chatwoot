// EVIRMA: Exercise inline uploads in the real editor, including the text-only edit mode.
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { uploadFile } from 'dashboard/helper/uploadHelper';
import Editor from './Editor.vue';

vi.mock('dashboard/helper/uploadHelper', () => ({ uploadFile: vi.fn() }));
vi.mock('dashboard/composables/useCaptain', () => ({
  useCaptain: () => ({ captainTasksEnabled: { value: false } }),
}));

const rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
Range.prototype.getClientRects = () => [rect];
Range.prototype.getBoundingClientRect = () => rect;
Element.prototype.scrollIntoView = () => {};

let wrapper;
const readClipboard = vi.fn();

beforeEach(async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { read: readClipboard },
  });
  readClipboard.mockResolvedValue([
    {
      types: ['image/png'],
      getType: async () => new Blob(['image'], { type: 'image/png' }),
    },
  ]);
  uploadFile.mockResolvedValue({ fileUrl: 'https://example.test/image.png' });
  wrapper = mount(Editor, {
    attachTo: document.body,
    props: { channelType: 'Channel::WebWidget', modelValue: 'Existing text' },
    global: {
      plugins: [createStore({ getters: { getUISettings: () => ({}) } })],
      stubs: {
        TagAgents: true,
        CannedResponse: true,
        VariableList: true,
        MacroList: true,
        KeyboardEmojiSelector: true,
        TagTools: true,
        CopilotMenuBar: true,
      },
    },
  });
  await flushPromises();
});

afterEach(() => {
  wrapper.unmount();
  delete navigator.clipboard;
  vi.restoreAllMocks();
});

const pasteInlineImage = async () => {
  wrapper.get('.ProseMirror').element.focus();
  document.activeElement.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'V',
      code: 'KeyV',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    })
  );
  await flushPromises();
};

it('blocks inline image paste while editing and restores uploading afterwards', async () => {
  await wrapper.setProps({ enableImageUpload: false });
  await pasteInlineImage();

  expect(readClipboard).not.toHaveBeenCalled();
  expect(uploadFile).not.toHaveBeenCalled();
  expect(wrapper.find('input[type="file"]').exists()).toBe(false);
  expect(wrapper.get('.ProseMirror').text()).toBe('Existing text');

  await wrapper.setProps({ enableImageUpload: true });
  await pasteInlineImage();

  expect(readClipboard).toHaveBeenCalledOnce();
  expect(uploadFile).toHaveBeenCalledOnce();
  expect(wrapper.find('input[type="file"]').exists()).toBe(true);
});

it('removes and restores the image upload menu with the upload setting', async () => {
  const input = wrapper.get('input[type="file"]').element;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File(['image'], 'image.png', { type: 'image/png' })],
  });
  await wrapper.get('input[type="file"]').trigger('change');
  await flushPromises();
  expect(uploadFile).toHaveBeenCalledOnce();

  const menuItems = () => wrapper.findAll('.ProseMirror-menuitem').length;
  const countWithUpload = menuItems();
  await wrapper.setProps({ enableImageUpload: false });
  expect(menuItems()).toBe(countWithUpload - 1);
  await wrapper.setProps({ enableImageUpload: true });
  expect(menuItems()).toBe(countWithUpload);
});
