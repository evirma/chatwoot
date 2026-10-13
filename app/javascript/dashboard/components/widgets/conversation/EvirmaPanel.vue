<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useStore, useMapGetter } from 'dashboard/composables/store';
import Frame from '../DashboardApp/Frame.vue';

const props = defineProps({
  currentChat: {
    type: Object,
    required: true,
  },
});

const EVIRMA_APP_TITLE = 'evirma:right-panel';
const store = useStore();
const dashboardApps = useMapGetter('dashboardApps/getRecords');
const evirmaApp = computed(() =>
  dashboardApps.value.find(app => app.title === EVIRMA_APP_TITLE)
);
const isVisible = ref(false);

watch(
  [evirmaApp, () => props.currentChat.id],
  () => {
    // Frame opens only when isVisible changes after it has mounted.
    isVisible.value = false;
    nextTick(() => {
      isVisible.value = true;
    });
  },
  { immediate: true }
);

onMounted(() => {
  if (!dashboardApps.value.length) store.dispatch('dashboardApps/get');
});
</script>

<!-- eslint-disable-next-line vue/no-root-v-if -->
<template>
  <div v-if="evirmaApp" class="h-[28rem] shrink-0 border-b border-n-weak">
    <Frame
      :key="currentChat.id"
      :config="evirmaApp.content"
      :current-chat="currentChat"
      :position="-1"
      :is-visible="isVisible"
    />
  </div>
</template>
