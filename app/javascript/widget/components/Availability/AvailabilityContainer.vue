<script setup>
// EVIRMA: Use the same polling clock as availability events sent to the host.
import { computed, inject, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMapGetter } from 'dashboard/composables/store.js';
import GroupedAvatars from 'widget/components/GroupedAvatars.vue';
import AvailabilityText from './AvailabilityText.vue';
import {
  EVIRMA_AVAILABILITY_TIME,
  useAvailability,
} from 'widget/composables/useAvailability';

const props = defineProps({
  agents: {
    type: Array,
    default: () => [],
  },
  showHeader: {
    type: Boolean,
    default: true,
  },
  showAvatars: {
    type: Boolean,
    default: true,
  },
  textClasses: {
    type: String,
    default: '',
  },
});

const { t } = useI18n();

const availableMessage = useMapGetter('appConfig/getAvailableMessage');
const unavailableMessage = useMapGetter('appConfig/getUnavailableMessage');

// Pass toRef(props, 'agents') instead of props.agents to maintain reactivity
// when the parent component's agents prop updates (e.g., after API response)
const {
  currentTime,
  hasOnlineAgents,
  isOnline,
  inboxConfig,
  isInWorkingHours,
  // EVIRMA: Prefer the known channel-local opening time over generic offline text.
  isOutOfOffice,
  opensAt,
} = useAvailability(
  toRef(props, 'agents'),
  inject(
    EVIRMA_AVAILABILITY_TIME,
    computed(() => new Date())
  )
);

const workingHours = computed(() => inboxConfig.value.workingHours || []);
const workingHoursEnabled = computed(
  () => inboxConfig.value.workingHoursEnabled || false
);
const utcOffset = computed(
  () => inboxConfig.value.utcOffset || inboxConfig.value.timezone || 'UTC'
);
const replyTime = computed(
  () => inboxConfig.value.replyTime || 'in_a_few_minutes'
);

// If online or in working hours
const isAvailable = computed(
  () => isOnline.value || (workingHoursEnabled.value && isInWorkingHours.value)
);

const headerText = computed(() =>
  isAvailable.value
    ? availableMessage.value || t('TEAM_AVAILABILITY.ONLINE')
    : unavailableMessage.value || t('TEAM_AVAILABILITY.OFFLINE')
);
</script>

<template>
  <div class="flex items-center justify-between gap-2">
    <div class="flex flex-col gap-1">
      <div v-if="showHeader" class="font-medium text-n-slate-12">
        {{ headerText }}
      </div>

      <!-- EVIRMA: Show the next opening consistently in the compact native header. -->
      <span
        v-if="isOutOfOffice && opensAt"
        :class="textClasses"
        class="text-n-slate-11"
      >
        {{ t('EVIRMA_OPENS_AT', { opensAt }) }}
      </span>
      <AvailabilityText
        v-else
        :time="currentTime"
        :utc-offset="utcOffset"
        :working-hours="workingHours"
        :working-hours-enabled="workingHoursEnabled"
        :has-online-agents="hasOnlineAgents"
        :reply-time="replyTime"
        :is-online="isOnline"
        :is-in-working-hours="isInWorkingHours"
        :class="textClasses"
        class="text-n-slate-11"
      />
    </div>

    <GroupedAvatars v-if="showAvatars && isOnline" :users="agents" />
  </div>
</template>
