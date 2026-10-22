<script setup>
// EVIRMA: Keep the header presence indicator on the same schedule clock as its status.
import { computed, inject, toRef } from 'vue';
import { useRouter } from 'vue-router';
// EVIRMA: Read the optional host subtitle without changing other availability cards.
import { useMapGetter } from 'dashboard/composables/store';
import FluentIcon from 'shared/components/FluentIcon/Index.vue';
import HeaderActions from './HeaderActions.vue';
// EVIRMA: Offer the configured messenger actions in the compact header.
import MessengerButtons from './MessengerButtons.vue';
import AvailabilityContainer from 'widget/components/Availability/AvailabilityContainer.vue';
import {
  EVIRMA_AVAILABILITY_TIME,
  useAvailability,
} from 'widget/composables/useAvailability';

const props = defineProps({
  avatarUrl: { type: String, default: '' },
  title: { type: String, default: '' },
  showPopoutButton: { type: Boolean, default: false },
  showBackButton: { type: Boolean, default: false },
  availableAgents: { type: Array, default: () => [] },
});

const availableAgents = toRef(props, 'availableAgents');
const appConfig = useMapGetter('appConfig/getAppConfig');

const router = useRouter();
// EVIRMA: Advance the compact header when the shared app polling clock changes.
const { isOnline } = useAvailability(
  availableAgents,
  inject(
    EVIRMA_AVAILABILITY_TIME,
    computed(() => new Date())
  )
);

const onBackButtonClick = () => {
  router.replace({ name: 'home' });
};
</script>

<template>
  <header class="flex justify-between w-full p-5 bg-n-background gap-2">
    <!-- EVIRMA: Let header copy shrink while keeping the avatar and actions intact. -->
    <div class="flex flex-1 min-w-0 items-center">
      <button
        v-if="showBackButton"
        class="px-2 ltr:-ml-3 rtl:-mr-3"
        @click="onBackButtonClick"
      >
        <FluentIcon
          icon="chevron-left"
          size="24"
          class="text-n-slate-12 rtl:rotate-180"
        />
      </button>
      <img
        v-if="avatarUrl"
        class="w-8 h-8 shrink-0 ltr:mr-3 rtl:ml-3 rounded-full"
        :src="avatarUrl"
        alt="avatar"
      />
      <div class="flex flex-col min-w-0 gap-1">
        <div
          class="flex items-center text-base font-medium leading-4 text-n-slate-12"
        >
          <span v-dompurify-html="title" class="min-w-0 break-words me-1" />
          <div
            :class="`h-2 w-2 shrink-0 rounded-full
              ${isOnline ? 'bg-n-teal-10' : 'hidden'}`"
          />
        </div>
        <!-- EVIRMA: Replace reply time only online; preserve the scheduled F6 status offline. -->
        <span
          v-if="isOnline && appConfig.headerSubtitle"
          class="text-xs leading-4 text-n-slate-11 line-clamp-2 break-words"
        >
          {{ appConfig.headerSubtitle }}
        </span>
        <AvailabilityContainer
          v-else
          :agents="availableAgents"
          :show-header="false"
          :show-avatars="false"
          text-classes="text-xs leading-3"
        />
        <!-- EVIRMA: Keep optional messenger actions beneath the native status. -->
        <MessengerButtons />
      </div>
    </div>
    <HeaderActions class="shrink-0" :show-popout-button="showPopoutButton" />
  </header>
</template>
