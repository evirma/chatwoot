// EVIRMA: Cover native header messenger controls and opening-time status with real config and schedule.
import { config, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import ChatHeader from '../ChatHeader.vue';
import ChatHeaderExpanded from '../ChatHeaderExpanded.vue';
import appConfig from '../../store/modules/appConfig';
import ru from '../../i18n/locale/ru.json';
import en from '../../i18n/locale/en.json';
import { EVIRMA_AVAILABILITY_TIME } from '../../composables/useAvailability';

vi.mock('vue-router', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

describe('EVIRMA native headers', () => {
  let store;
  let wrapper;
  let postMessage;
  const clock = ref(new Date('2026-10-21T06:00:00Z'));
  const i18n = createI18n({
    legacy: false,
    locale: 'ru',
    messages: { ru, en },
  });
  // EVIRMA: Replace the empty global translator with only the widget locales under test.
  config.global.plugins = config.global.plugins.map(plugin =>
    plugin?.global ? i18n : plugin
  );

  beforeEach(() => {
    i18n.global.locale.value = 'ru';
    clock.value = new Date('2026-10-21T06:00:00Z');
    window.chatwootWebChannel = {
      workingHoursEnabled: true,
      timezone: 'UTC',
      utcOffset: 'UTC',
      workingHours: Array.from({ length: 7 }, (_, day) => ({
        day_of_week: day,
        open_hour: 9,
        close_hour: 18,
        open_minutes: 0,
        close_minutes: 0,
        closed_all_day: false,
      })),
    };
    store = createStore({
      modules: { appConfig: { ...appConfig, state: { ...appConfig.state } } },
    });
    postMessage = vi
      .spyOn(window.parent, 'postMessage')
      .mockImplementation(() => {});
  });
  afterEach(() => {
    wrapper?.unmount();
    delete window.chatwootWebChannel;
    vi.restoreAllMocks();
  });

  const mountHeader = header =>
    mount(header, {
      props: { title: 'Support' },
      global: {
        plugins: [store],
        provide: { [EVIRMA_AVAILABILITY_TIME]: clock },
        stubs: { HeaderActions: true, GroupedAvatars: true },
        directives: {
          dompurifyHtml: (element, binding) => {
            element.textContent = binding.value;
          },
        },
      },
    });

  it.each([
    ['compact', ChatHeader],
    ['expanded', ChatHeaderExpanded],
  ])('hides messenger controls by default in %s', (_name, header) => {
    wrapper = mountHeader(header);
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it.each([
    ['compact', ChatHeader],
    ['expanded', ChatHeaderExpanded],
  ])(
    'renders configured controls and posts their channels in %s',
    async (_name, header) => {
      await store.dispatch('appConfig/setAppConfig', {
        messengerButtons: ['telegram', 'max'],
      });
      wrapper = mountHeader(header);
      const buttons = wrapper.findAll('button');
      expect(buttons.map(button => button.text())).toEqual([
        'Продолжить в Telegram',
        'Продолжить в MAX',
      ]);
      await buttons[0].trigger('click');
      await buttons[1].trigger('click');
      expect(postMessage.mock.calls).toEqual([
        [
          'chatwoot-widget:{"event":"messenger-requested","channel":"telegram"}',
          '*',
        ],
        [
          'chatwoot-widget:{"event":"messenger-requested","channel":"max"}',
          '*',
        ],
      ]);
      await store.dispatch('appConfig/setAppConfig', {});
      expect(wrapper.findAll('button')).toHaveLength(0);
    }
  );

  it('renders only the requested messenger', async () => {
    await store.dispatch('appConfig/setAppConfig', {
      messengerButtons: ['max'],
    });
    wrapper = mountHeader(ChatHeader);
    expect(wrapper.findAll('button').map(button => button.text())).toEqual([
      'Продолжить в MAX',
    ]);
  });

  it.each([
    ['compact', ChatHeader],
    ['expanded', ChatHeaderExpanded],
  ])(
    'shows the opening and updates with the app clock in %s',
    async (_name, header) => {
      wrapper = mountHeader(header);
      expect(wrapper.text()).toContain('Откроемся утром в 09:00');
      clock.value = new Date('2026-10-21T10:00:00Z');
      await wrapper.vm.$nextTick();
      expect(wrapper.text()).not.toContain('Откроемся утром');
    }
  );

  it.each([
    ['compact', ChatHeader],
    ['expanded', ChatHeaderExpanded],
  ])('keeps normal text when no opening is known in %s', (_name, header) => {
    window.chatwootWebChannel.workingHours = [];
    wrapper = mountHeader(header);
    expect(wrapper.text()).not.toContain('Откроемся утром');
  });

  it('keeps the default offline text without working hours', () => {
    window.chatwootWebChannel.workingHoursEnabled = false;
    wrapper = mountHeader(ChatHeader);
    expect(wrapper.text()).toContain('Мы вернемся как можно скорее');
  });

  it('uses the channel timezone rather than the viewer timezone', () => {
    window.chatwootWebChannel.timezone = 'Asia/Kolkata';
    window.chatwootWebChannel.utcOffset = '+05:30';
    clock.value = new Date('2026-10-21T01:00:00Z');
    wrapper = mountHeader(ChatHeader);
    expect(wrapper.text()).toContain('Откроемся утром в 09:00');
  });
  // EVIRMA: Supply the English source copy alongside the explicitly requested Russian copy.
  it('renders the English messenger labels and opening time', async () => {
    i18n.global.locale.value = 'en';
    await store.dispatch('appConfig/setAppConfig', {
      messengerButtons: ['telegram', 'max'],
    });
    wrapper = mountHeader(ChatHeader);
    expect(wrapper.text()).toContain('We open in the morning at 09:00');
    expect(wrapper.findAll('button').map(button => button.text())).toEqual([
      'Continue in Telegram',
      'Continue in MAX',
    ]);
  });
});
