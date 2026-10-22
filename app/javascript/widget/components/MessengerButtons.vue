<script setup>
// EVIRMA: Ask the host to continue in a configured messenger without network requests.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMapGetter } from 'dashboard/composables/store';
import { IFrameHelper } from 'widget/helpers/utils';

const appConfig = useMapGetter('appConfig/getAppConfig');
const { t } = useI18n();
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
  <div v-if="channels.length" class="flex flex-wrap gap-2">
    <button
      v-for="channel in channels"
      :key="channel"
      class="rounded-lg border border-n-weak px-3 py-2 text-xs text-n-slate-12 hover:bg-n-alpha-1"
      @click="requestMessenger(channel)"
    >
      {{ messengerLabels[channel] }}
    </button>
  </div>
</template>
