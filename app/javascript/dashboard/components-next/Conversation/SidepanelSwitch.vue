<script setup>
import Button from 'dashboard/components-next/button/Button.vue';
import ButtonGroup from 'dashboard/components-next/buttonGroup/ButtonGroup.vue';
import { useUISettings } from 'dashboard/composables/useUISettings';
// EVIRMA: Restore the native contact toggle and Alt+O independently of Captain.
import { useKeyboardEvents } from 'dashboard/composables/useKeyboardEvents';
import { computed } from 'vue';
import { FEATURE_FLAGS } from 'dashboard/featureFlags';
import { useMapGetter } from 'dashboard/composables/store';

const { uiSettings, updateUISettings } = useUISettings();

const currentAccountId = useMapGetter('getCurrentAccountId');
const isFeatureEnabledonAccount = useMapGetter(
  'accounts/isFeatureEnabledonAccount'
);

const showCopilotTab = computed(() =>
  isFeatureEnabledonAccount.value(currentAccountId.value, FEATURE_FLAGS.CAPTAIN)
);

const isCopilotPanelOpen = computed(
  () => uiSettings.value.is_copilot_panel_open
);

const isContactSidebarOpen = computed(
  () => uiSettings.value.is_contact_sidebar_open
);
const handleContactSidebarToggle = () => {
  updateUISettings({ is_contact_sidebar_open: !isContactSidebarOpen.value });
};
useKeyboardEvents({ 'Alt+KeyO': handleContactSidebarToggle });

const handleCopilotSidebarToggle = () => {
  updateUISettings({
    is_copilot_panel_open: !isCopilotPanelOpen.value,
  });
};
</script>

<template>
  <ButtonGroup
    class="flex flex-col justify-center items-center absolute top-36 xl:top-24 ltr:right-2 rtl:left-2 bg-n-solid-2/90 backdrop-blur-lg border border-n-weak/50 rounded-full gap-1.5 p-1.5 shadow-sm transition-shadow duration-200 hover:shadow !z-20"
  >
    <!-- EVIRMA: The contact panel remains available without Captain. -->
    <Button
      v-tooltip.bottom="$t('CONVERSATION.SIDEBAR.CONTACT')"
      ghost
      slate
      sm
      class="!rounded-full"
      :class="{ 'bg-n-alpha-2 !text-n-iris-9': isContactSidebarOpen }"
      icon="i-ph-user-bold"
      @click="handleContactSidebarToggle"
    />
    <Button
      v-if="showCopilotTab"
      v-tooltip.bottom="$t('CONVERSATION.SIDEBAR.COPILOT')"
      ghost
      slate
      sm
      class="!rounded-full transition-all duration-[250ms] ease-out active:!scale-95 active:duration-75"
      :class="{
        'bg-n-alpha-2 !text-n-iris-9 active:!brightness-105 active:shadow-sm':
          isCopilotPanelOpen,
      }"
      icon="i-woot-captain"
      @click="handleCopilotSidebarToggle"
    />
  </ButtonGroup>
</template>
