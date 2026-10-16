// EVIRMA: Media clicks stay in Chatwoot's gallery; document links keep their download path.
import { defineComponent, h, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import VueDOMPurifyHTML from 'vue-dompurify-html';
import { provideMessageContext } from '../../provider';
import ImageChip from '../../chips/Image.vue';
import VideoChip from '../../chips/Video.vue';
import FileChip from '../../chips/File.vue';
import ImageBubble from '../Image.vue';
import VideoBubble from '../Video.vue';
import GalleryView from 'dashboard/components/widgets/conversation/components/GalleryView.vue';

// Match the neighboring bubble tests: keep the message frame out of media interaction tests.
const BaseBubble = { template: '<div><slot /></div>' };

describe('media gallery', () => {
  let wrapper;
  afterEach(() => {
    wrapper.unmount();
    vi.restoreAllMocks();
  });

  it.each([
    {
      name: 'image thumbnail',
      component: ImageChip,
      fileType: 'image',
      selector: 'img',
    },
    {
      name: 'video thumbnail',
      component: VideoChip,
      fileType: 'video',
      selector: 'video',
    },
    {
      name: 'image bubble',
      component: ImageBubble,
      fileType: 'image',
      selector: '[data-bubble-name="image"]',
    },
    {
      name: 'video bubble',
      component: VideoBubble,
      fileType: 'video',
      selector: 'video',
    },
  ])(
    'opens $name in the modal on click',
    async ({ component, fileType, selector }) => {
      const attachment = {
        id: 1,
        messageId: 12,
        fileType,
        dataUrl: `https://example.com/attachment.${fileType === 'image' ? 'png' : 'mp4'}`,
      };
      const store = createStore({
        getters: {
          getSelectedChatAttachments: () => [
            {
              id: 1,
              message_id: 12,
              file_type: fileType,
              data_url: attachment.dataUrl,
            },
          ],
          getCurrentUser: () => ({ id: 3 }),
          'accounts/isRTL': () => false,
        },
      });
      const Host = defineComponent({
        setup() {
          provideMessageContext({ attachments: ref([attachment]) });
          return () =>
            h(
              component,
              component === ImageChip || component === VideoChip
                ? { attachment }
                : {}
            );
        },
      });
      const open = vi.spyOn(window, 'open').mockImplementation(() => {});
      wrapper = mount(Host, {
        attachTo: document.body,
        global: { plugins: [store, VueDOMPurifyHTML], stubs: { BaseBubble } },
      });
      expect(wrapper.findComponent(GalleryView).exists()).toBe(false);
      await wrapper.get(selector).trigger('click');
      await flushPromises();
      expect(wrapper.findComponent(GalleryView).exists()).toBe(true);
      const galleryContent = document.body.querySelector('div[dir="ltr"]');
      const media = galleryContent.querySelector(
        fileType === 'image' ? 'img' : 'video[controls]'
      );
      expect(media.getAttribute('src')).toBe(attachment.dataUrl);
      expect(open).not.toHaveBeenCalled();
      wrapper.getComponent(GalleryView).vm.$emit('close');
      await flushPromises();
      expect(wrapper.findComponent(GalleryView).exists()).toBe(false);
    }
  );

  it('keeps document download links unchanged', () => {
    wrapper = mount(FileChip, {
      props: {
        attachment: {
          fileType: 'file',
          dataUrl: 'https://example.com/report.pdf',
        },
      },
    });
    expect(wrapper.get('a').attributes('href')).toBe(
      'https://example.com/report.pdf'
    );
    expect(wrapper.get('a').attributes('target')).toBe('_blank');
    expect(wrapper.findComponent(GalleryView).exists()).toBe(false);
  });
});
