// EVIRMA: Check the read-only history through rendered content and user interaction.
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import EvirmaContactHistory from '../EvirmaContactHistory.vue';

describe('EvirmaContactHistory', () => {
  const message = {
    id: 7,
    content: '<script>alert(1)</script>Hello from MAX',
    message_type: 'outgoing',
    created_at: 1700000000,
    sender: { name: 'Agent', avatar_url: 'https://example.com/avatar.png' },
    channel: { name: 'Support MAX', label: 'max' },
    attachments: [
      { id: 8, file_type: 'file', data_url: 'https://example.com/report.pdf' },
    ],
  };

  const render = (records = []) => {
    const fetch = vi.fn();
    const store = createStore({
      modules: {
        contactHistory: {
          namespaced: true,
          state: () => ({ records }),
          actions: { fetch },
        },
        appConfig: {
          namespaced: true,
          state: () => ({ isOpen: false }),
          getters: { getIsWidgetOpen: state => state.isOpen },
          mutations: {
            open: state => {
              state.isOpen = true;
            },
          },
        },
      },
    });
    return {
      wrapper: mount(EvirmaContactHistory, { global: { plugins: [store] } }),
      store,
      fetch,
    };
  };

  it('fetches on mounting and has no visible block when history is empty', () => {
    const { wrapper, fetch } = render();

    expect(fetch).toHaveBeenCalledOnce();
    expect(wrapper.find('details').exists()).toBe(false);
  });

  it('renders a collapsible read-only history with channel, date, sender and attachments', async () => {
    const { wrapper } = render([message]);
    const details = wrapper.get('details');

    expect(details.attributes('open')).toBeUndefined();
    expect(wrapper.get('summary').text()).toContain(
      'EVIRMA_CONTACT_HISTORY.TITLE'
    );
    await wrapper.get('summary').trigger('click');
    expect(wrapper.text()).toContain('Support MAX');
    expect(wrapper.text()).toContain('max');
    expect(wrapper.text()).toContain(message.content);
    expect(wrapper.get('time').attributes('datetime')).toBe(
      '2023-11-14T22:13:20.000Z'
    );
    expect(wrapper.text()).toContain('Agent');
    expect(wrapper.get('img').attributes('src')).toBe(
      message.sender.avatar_url
    );
    expect(wrapper.get('a').attributes('href')).toBe(
      message.attachments[0].data_url
    );
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('input, textarea, button').exists()).toBe(false);
  });

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

    expect(wrapper.get('details').text()).toContain(message.content);
  });
});
