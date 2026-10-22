<script setup>
// EVIRMA: Ask the host to continue in a configured messenger without network requests.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMapGetter } from 'dashboard/composables/store';
import { IFrameHelper } from 'widget/helpers/utils';

const appConfig = useMapGetter('appConfig/getAppConfig');
const { t } = useI18n();
// EVIRMA: Use short brand names visually and retain translated action labels for accessibility.
const messengerNames = { telegram: 'Telegram', max: 'MAX' };
const TELEGRAM_COLOR = '#229ED9';
const messengerLabels = computed(() => ({
  telegram: t('EVIRMA_MESSENGERS.TELEGRAM'),
  max: t('EVIRMA_MESSENGERS.MAX'),
}));
const channels = computed(() =>
  ['telegram', 'max'].filter(channel =>
    appConfig.value.messengerButtons?.includes(channel)
  )
);
const requestMessenger = channel => {
  IFrameHelper.sendMessage({ event: 'messenger-requested', channel });
};
</script>

<!-- eslint-disable-next-line vue/no-root-v-if -->
<template>
  <div v-if="channels.length" class="flex flex-nowrap gap-2">
    <button
      v-for="channel in channels"
      :key="channel"
      class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-n-weak px-2 py-1 text-xs leading-4 whitespace-nowrap text-n-slate-12 hover:bg-n-alpha-1"
      :title="messengerLabels[channel]"
      :aria-label="messengerLabels[channel]"
      @click="requestMessenger(channel)"
    >
      <svg
        v-if="channel === 'telegram'"
        viewBox="0 0 24 24"
        class="w-4 h-4 shrink-0"
        :fill="TELEGRAM_COLOR"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="m22.05 3.41-3.18 15c-.24 1.06-.87 1.32-1.75.82l-4.85-3.58-2.34 2.25c-.26.26-.48.48-.98.48l.35-4.93 8.98-8.11c.39-.35-.08-.55-.6-.2L6.58 12.13 1.77 10.63c-1.05-.33-1.07-1.05.22-1.55L20.8 1.83c.87-.33 1.62.2 1.25 1.58Z"
        />
      </svg>
      <!-- EVIRMA: Embed the MAX brandbook mark (https://go.max.ru/brandbook) in the theme text color. -->
      <svg
        v-else
        viewBox="0 0 100 100"
        class="w-4 h-4 shrink-0 fill-current"
        aria-hidden="true"
        focusable="false"
      >
        <path
          fill-rule="evenodd"
          d="M50.76 0c27.53 0 49.12 22.34 49.12 49.89S77.61 99.23 51.02 99.23c-9.43 0-14.01-1.33-21.37-6.54-.5-.36-1.2-.26-1.63.19-5.66 6.04-20.17 10.28-20.83 2.03C7.19 80.53 0 71.18 0 49.61 0 21.3 23.22 0 50.76 0m.77 24.55c-13.07-.68-23.26 8.39-25.51 22.58-1.86 11.75 1.44 26.07 4.26 26.8 1.2.3 4.08-1.9 6.18-3.88.4-.37.99-.44 1.45-.15 3.27 2 6.97 3.5 11.05 3.71 13.42.7 25.3-9.8 26-23.21.71-13.42-10.01-25.14-23.43-25.85"
          clip-rule="evenodd"
        />
      </svg>
      {{ messengerNames[channel] }}
    </button>
  </div>
</template>
