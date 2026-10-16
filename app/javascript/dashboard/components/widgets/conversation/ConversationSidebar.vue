<script setup>
import ContactPanel from 'dashboard/routes/dashboard/conversation/ContactPanel.vue';
import EvirmaPanel from './EvirmaPanel.vue'; // EVIRMA: persistent right panel.

defineProps({
  currentChat: {
    required: true,
    type: Object,
  },
});
</script>

<template>
  <!-- EVIRMA: Always visible, including narrow windows; no outside-click dismissal. -->
  <div
    class="bg-n-surface-2 h-full overflow-hidden flex flex-col w-80 min-w-80 border-s border-n-weak 2xl:min-w-[22.5rem] 2xl:w-[22.5rem]"
  >
    <!-- EVIRMA: share one scroll area so the tall app does not hide the contact. -->
    <div class="flex flex-col flex-1 min-h-0 overflow-auto">
      <!-- EVIRMA: always expanded, outside the contact's saved accordion state. -->
      <EvirmaPanel :current-chat="currentChat" />
      <ContactPanel
        :conversation-id="currentChat.id"
        :inbox-id="currentChat.inbox_id"
      />
    </div>
  </div>
</template>
