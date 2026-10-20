// EVIRMA: The contact sidebar can be closed independently of Captain.
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import SidepanelSwitch from '../SidepanelSwitch.vue';

describe('contact sidebar controls', () => {
  it.each([false, true])(
    'toggles contact with the button and Alt+O (Captain enabled: %s)',
    async enabled => {
      const updateUISettings = vi.fn();
      const store = createStore({
        getters: {
          getUISettings: () => ({ is_contact_sidebar_open: true }),
          getCurrentAccountId: () => 1,
          'accounts/isFeatureEnabledonAccount': () => () => enabled,
        },
        actions: { updateUISettings },
      });
      const wrapper = mount(SidepanelSwitch, { global: { plugins: [store] } });
      await flushPromises();
      expect(wrapper.findAll('button')).toHaveLength(enabled ? 2 : 1);
      await wrapper.findAll('button')[0].trigger('click');
      expect(
        updateUISettings.mock.calls[0][1].uiSettings.is_contact_sidebar_open
      ).toBe(false);
      updateUISettings.mockClear();
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'o',
          code: 'KeyO',
          altKey: true,
          bubbles: true,
        })
      );
      expect(
        updateUISettings.mock.calls[0][1].uiSettings.is_contact_sidebar_open
      ).toBe(false);
      wrapper.unmount();
    }
  );
});
