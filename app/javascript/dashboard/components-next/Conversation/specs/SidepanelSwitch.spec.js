// EVIRMA: Operators cannot hide the contact sidebar via a button or Alt+O.
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import SidepanelSwitch from '../SidepanelSwitch.vue';

describe('persistent contact sidebar controls', () => {
  it.each([false, true])(
    'keeps only the optional copilot control (enabled: %s)',
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
      expect(wrapper.find('.i-ph-user-bold').exists()).toBe(false);
      expect(wrapper.findAll('button')).toHaveLength(enabled ? 1 : 0);
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', altKey: true })
      );
      expect(updateUISettings).not.toHaveBeenCalled();
      if (enabled) {
        await wrapper.get('button').trigger('click');
        expect(
          updateUISettings.mock.calls[0][1].uiSettings.is_contact_sidebar_open
        ).toBe(true);
      }
      wrapper.unmount();
    }
  );
});
