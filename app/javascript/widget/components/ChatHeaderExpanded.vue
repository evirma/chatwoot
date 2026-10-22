<script setup>
import HeaderActions from './HeaderActions.vue';
// EVIRMA: Follow the app clock when displaying the next opening in the expanded header.
import { computed, inject } from 'vue';
import {
  EVIRMA_AVAILABILITY_TIME,
  useAvailability,
} from 'widget/composables/useAvailability';
import MessengerButtons from './MessengerButtons.vue';
import { useMessageFormatter } from 'shared/composables/useMessageFormatter';

const props = defineProps({
  avatarUrl: {
    type: String,
    default: '',
  },
  introHeading: {
    type: String,
    default: '',
  },
  introBody: {
    type: String,
    default: '',
  },
  showPopoutButton: {
    type: Boolean,
    default: false,
  },
});

const { formatMessage } = useMessageFormatter();
// EVIRMA: Reuse the availability event's schedule and channel-local opening time.
const { isOutOfOffice, opensAt } = useAvailability(
  [],
  inject(
    EVIRMA_AVAILABILITY_TIME,
    computed(() => new Date())
  )
);

const containerClasses = computed(() => [
  props.avatarUrl ? 'justify-between' : 'justify-end',
]);
</script>

<template>
  <header
    class="header-expanded pt-6 pb-4 px-5 relative box-border w-full bg-transparent"
  >
    <div class="flex items-start" :class="containerClasses">
      <img
        v-if="avatarUrl"
        class="h-12 rounded-full"
        :src="avatarUrl"
        alt="Avatar"
      />
      <HeaderActions
        :show-popout-button="showPopoutButton"
        :show-end-conversation-button="false"
      />
    </div>
    <h2
      v-dompurify-html="introHeading"
      class="mt-4 text-2xl mb-1.5 font-medium text-n-slate-12 line-clamp-4"
    />
    <p
      v-dompurify-html="formatMessage(introBody)"
      class="text-lg leading-normal text-n-slate-11 [&_a]:underline line-clamp-6"
    />
    <!-- EVIRMA: Show the known opening time and optional messenger actions on home. -->
    <p v-if="isOutOfOffice && opensAt" class="mt-2 text-sm text-n-slate-11">
      {{ $t('EVIRMA_OPENS_AT', { opensAt }) }}
    </p>
    <MessengerButtons class="mt-3" />
  </header>
</template>
