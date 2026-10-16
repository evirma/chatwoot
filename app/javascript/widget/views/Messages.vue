<script>
import { provide, ref } from 'vue';
import { mapGetters } from 'vuex';

import ChatFooter from '../components/ChatFooter.vue';
import ConversationWrap from '../components/ConversationWrap.vue';

export default {
  components: { ChatFooter, ConversationWrap },
  // EVIRMA: Share the conversation area with the paperclip's native drop handler.
  setup() {
    const attachmentDropTarget = ref(null);
    provide('evirmaAttachmentDropTarget', attachmentDropTarget);
    return { attachmentDropTarget };
  },
  computed: {
    ...mapGetters({
      groupedMessages: 'conversation/getGroupedConversation',
    }),
  },
  mounted() {
    this.$store.dispatch('conversation/setUserLastSeen');
  },
};
</script>

<template>
  <div
    ref="attachmentDropTarget"
    class="relative flex flex-col flex-1 overflow-hidden rounded-b-lg bg-n-slate-2 dark:bg-n-solid-1"
    @dragover.prevent
    @drop.prevent
  >
    <div class="flex flex-1 overflow-auto">
      <ConversationWrap :grouped-messages="groupedMessages" />
    </div>
    <ChatFooter class="px-5" />
  </div>
</template>
