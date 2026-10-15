<script setup>
// EVIRMA: A read-only list avoids reply controls tied to the active widget conversation.
import { computed, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import { formatUnixDate } from 'shared/helpers/DateHelper';

const store = useStore();
const messages = computed(() => store.state.contactHistory.records);
const isWidgetOpen = computed(() => store.getters['appConfig/getIsWidgetOpen']);
const fetchHistory = () => store.dispatch('contactHistory/fetch');
onMounted(fetchHistory);
watch(isWidgetOpen, open => {
  if (open) fetchHistory();
});
</script>

<template>
  <details
    v-if="messages.length"
    class="mb-4 rounded-lg border border-n-weak bg-n-background p-3 text-sm text-n-slate-12"
  >
    <summary class="cursor-pointer py-2 font-medium">
      {{ $t('EVIRMA_CONTACT_HISTORY.TITLE') }}
    </summary>
    <ol class="mt-3 flex list-none flex-col gap-3 p-0">
      <li
        v-for="message in messages"
        :key="message.id"
        class="rounded-lg bg-n-slate-2 p-3"
        :class="{ 'ms-6': message.message_type === 'incoming' }"
      >
        <div
          class="mb-2 flex flex-wrap items-center gap-2 text-xs text-n-slate-11"
        >
          <span>{{ message.channel.name }}</span>
          <span class="uppercase">{{ message.channel.label }}</span>
          <time :datetime="new Date(message.created_at * 1000).toISOString()">
            {{ formatUnixDate(message.created_at, 'yyyy-MM-dd HH:mm') }}
          </time>
        </div>
        <div v-if="message.sender" class="mb-2 flex items-center gap-2">
          <img
            v-if="message.sender.avatar_url"
            :src="message.sender.avatar_url"
            alt=""
            class="h-6 w-6 rounded-full"
          />
          <span class="font-medium">
            {{ message.sender.available_name || message.sender.name }}
          </span>
        </div>
        <p class="m-0 whitespace-pre-wrap break-words">{{ message.content }}</p>
        <template
          v-for="attachment in message.attachments"
          :key="attachment.id"
        >
          <a
            v-if="attachment.data_url"
            :href="attachment.data_url"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-2 block break-all text-n-blue-11 underline"
          >
            {{ $t('COMPONENTS.FILE_BUBBLE.DOWNLOAD') }}
            {{ attachment.file_type }}
          </a>
        </template>
      </li>
    </ol>
  </details>
  <template v-else />
</template>
