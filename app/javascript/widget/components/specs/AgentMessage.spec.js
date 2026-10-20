// EVIRMA: Touch gestures on agent messages select the message to reply to.
import { mount } from '@vue/test-utils';
import VueDOMPurifyHTML from 'vue-dompurify-html';
import { BUS_EVENTS } from 'shared/constants/busEvents';
import { emitter } from 'shared/helpers/mitt';
import AgentMessage from '../AgentMessage.vue';

describe('AgentMessage replies', () => {
  let wrapper;
  let onReply;
  const message = {
    id: 42,
    content: 'How can I help?',
    content_type: 'text',
    content_attributes: {},
    message_type: 1,
  };

  beforeEach(() => {
    window.chatwootWebChannel = { enabledFeatures: [] };
    onReply = vi.fn();
    emitter.on(BUS_EVENTS.TOGGLE_REPLY_TO_MESSAGE, onReply);
  });

  afterEach(() => {
    wrapper?.unmount();
    emitter.off(BUS_EVENTS.TOGGLE_REPLY_TO_MESSAGE, onReply);
    delete window.chatwootWebChannel;
  });

  it('replies to the agent message after a left touch swipe', async () => {
    wrapper = mount(AgentMessage, {
      props: { message },
      global: { plugins: [VueDOMPurifyHTML] },
    });
    const bubble = wrapper.get('.chat-bubble.agent');

    await bubble.trigger('touchstart', { touches: [{ clientX: 160 }] });
    await bubble.trigger('touchmove', { touches: [{ clientX: 80 }] });
    await bubble.trigger('touchend');

    expect(onReply).toHaveBeenCalledExactlyOnceWith(message);
  });

  it('does not reply to a read-only message after a left touch swipe', async () => {
    wrapper = mount(AgentMessage, {
      props: { message, readOnly: true },
      global: { plugins: [VueDOMPurifyHTML] },
    });
    const bubble = wrapper.get('.chat-bubble.agent');

    await bubble.trigger('touchstart', { touches: [{ clientX: 160 }] });
    await bubble.trigger('touchmove', { touches: [{ clientX: 80 }] });
    await bubble.trigger('touchend');

    expect(onReply).not.toHaveBeenCalled();
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('replies to the agent message when the reply button is pressed', async () => {
    wrapper = mount(AgentMessage, {
      props: { message },
      global: { plugins: [VueDOMPurifyHTML] },
    });

    await wrapper.get('button').trigger('click');

    expect(onReply).toHaveBeenCalledExactlyOnceWith(message);
  });
});
