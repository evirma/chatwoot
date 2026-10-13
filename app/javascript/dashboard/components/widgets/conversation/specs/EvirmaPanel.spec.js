import { flushPromises, shallowMount } from '@vue/test-utils';
import { createStore } from 'vuex';
import Frame from '../../DashboardApp/Frame.vue';
import EvirmaPanel from '../EvirmaPanel.vue';

describe('EvirmaPanel', () => {
  const evirmaApp = {
    id: 1,
    title: 'evirma:right-panel',
    content: [{ type: 'frame', url: 'https://evirma.example.com' }],
  };
  const currentChat = { id: 10, meta: { sender: { id: 2 } } };
  let store;
  let getApps;
  let wrapper;
  let mountOptions;

  beforeEach(() => {
    getApps = vi.fn();
    store = createStore({
      state: { records: [] },
      getters: {
        'dashboardApps/getRecords': state => state.records,
        'contacts/getContact': () => () => ({ id: 2 }),
        getCurrentUser: () => ({
          id: 3,
          name: 'Agent',
          email: 'agent@example.com',
        }),
        'attributes/getAttributes': () => [],
      },
      actions: { 'dashboardApps/get': getApps },
    });
    mountOptions = {
      attachTo: document.body,
      props: { currentChat },
      global: {
        plugins: [store],
        stubs: { Frame: false, LoadingState: true },
      },
    };
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it('renders nothing and fetches apps once when no apps are loaded', async () => {
    wrapper = shallowMount(EvirmaPanel, mountOptions);
    await flushPromises();

    expect(wrapper.findComponent(Frame).exists()).toBe(false);
    expect(wrapper.find('div').exists()).toBe(false);
    expect(getApps).toHaveBeenCalledOnce();
  });

  it('renders the EVIRMA frame with its config and sends the app context', async () => {
    store.state.records = [evirmaApp];
    wrapper = shallowMount(EvirmaPanel, mountOptions);
    await flushPromises();

    const frame = wrapper.findComponent(Frame);
    expect(frame.props('config')).toEqual(evirmaApp.content);
    expect(frame.props('position')).toBe(-1);
    expect(frame.props('currentChat')).toEqual(currentChat);
    expect(getApps).not.toHaveBeenCalled();

    const iframe = wrapper.find('iframe');
    expect(iframe.attributes('src')).toBe('https://evirma.example.com');
    expect(iframe.attributes('id')).toBe('dashboard-app--frame--1-0');
    const postMessage = vi.fn();
    Object.defineProperty(iframe.element, 'contentWindow', {
      value: { postMessage },
    });
    await iframe.trigger('load');

    expect(JSON.parse(postMessage.mock.calls[0][0])).toMatchObject({
      event: 'appContext',
      data: {
        conversation: currentChat,
        contact: { id: 2 },
        currentAgent: { id: 3 },
        customAttributes: [],
        theme: 'light',
      },
    });
  });

  it('ignores other dashboard apps', async () => {
    store.state.records = [
      { ...evirmaApp, id: 2, title: 'Other app' },
      { ...evirmaApp, id: 3, title: 'evirma:right-panel-extra' },
    ];
    wrapper = shallowMount(EvirmaPanel, mountOptions);
    await flushPromises();

    expect(wrapper.findComponent(Frame).exists()).toBe(false);
    expect(wrapper.find('div').exists()).toBe(false);
    expect(getApps).not.toHaveBeenCalled();
  });

  it('opens the frame when the EVIRMA app finishes loading', async () => {
    wrapper = shallowMount(EvirmaPanel, mountOptions);
    await flushPromises();
    store.state.records = [
      { ...evirmaApp, id: 2, title: 'Other app' },
      evirmaApp,
    ];
    await flushPromises();

    expect(wrapper.findAll('iframe')).toHaveLength(1);
    expect(wrapper.find('iframe').attributes('src')).toBe(
      'https://evirma.example.com'
    );
    expect(getApps).toHaveBeenCalledOnce();
  });

  it('recreates and opens the frame when the conversation changes', async () => {
    store.state.records = [evirmaApp];
    wrapper = shallowMount(EvirmaPanel, mountOptions);
    await flushPromises();
    const previousIframe = wrapper.find('iframe').element;
    const nextChat = { id: 11, meta: { sender: { id: 4 } } };

    await wrapper.setProps({ currentChat: nextChat });
    await flushPromises();

    expect(wrapper.find('iframe').element).not.toBe(previousIframe);
    expect(wrapper.findComponent(Frame).props('currentChat')).toEqual(nextChat);
  });
});
