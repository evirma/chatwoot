<script setup>
// EVIRMA: Read-only history reuses the active conversation's bubbles and date separators.
import { computed, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import ChatMessage from 'widget/components/ChatMessage.vue';
import DateSeparator from 'widget/components/DateSeparator.vue';
import ChannelIcon from 'dashboard/components-next/icon/ChannelIcon.vue';
import { getters as conversationGetters } from 'widget/store/modules/conversation/getters';
import { MESSAGE_TYPE } from 'widget/helpers/constants';
import { useWidgetDate } from 'widget/composables/useWidgetDate';

const store = useStore();
const { formatTime } = useWidgetDate();
const messages = computed(() =>
  store.state.contactHistory.records.map(message => ({
    ...message,
    message_type: MESSAGE_TYPE[message.message_type.toUpperCase()],
  }))
);
const groupedMessages = computed(() =>
  conversationGetters.getGroupedConversation({ conversations: messages.value })
);
const isWidgetOpen = computed(() => store.getters['appConfig/getIsWidgetOpen']);
const fetchHistory = () => store.dispatch('contactHistory/fetch');
onMounted(fetchHistory);
watch(isWidgetOpen, open => {
  if (open) fetchHistory();
});
</script>

<template>
  <!-- EVIRMA: Keep history expanded and retain the native collapse control. -->
  <details v-if="messages.length" open class="mb-4 text-sm text-n-slate-12">
    <summary class="cursor-pointer py-2 font-medium">
      {{ $t('EVIRMA_CONTACT_HISTORY.TITLE') }}
    </summary>
    <div
      v-for="group in groupedMessages"
      :key="group.date"
      class="messages-wrap"
    >
      <DateSeparator :date="group.date" />
      <ChatMessage
        v-for="message in group.messages"
        :key="message.id"
        :message="message"
        read-only
      >
        <template #metadata>
          <div class="my-1 flex items-center gap-1 text-xs text-n-slate-11">
            <ChannelIcon
              :inbox="{ channel_type: message.channel_type }"
              class="size-3"
              aria-hidden="true"
            />
            <time :datetime="new Date(message.created_at * 1000).toISOString()">
              {{ formatTime(message.created_at) }}
            </time>
          </div>
        </template>
      </ChatMessage>
    </div>
  </details>
  <template v-else />
</template>
