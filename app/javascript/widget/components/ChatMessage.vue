<script>
import AgentMessage from 'widget/components/AgentMessage.vue';
import UserMessage from 'widget/components/UserMessage.vue';
import { mapGetters } from 'vuex';
import { MESSAGE_TYPE } from 'widget/helpers/constants';

export default {
  components: {
    AgentMessage,
    UserMessage,
  },
  props: {
    // EVIRMA: History must not reply into the active conversation.
    readOnly: { type: Boolean, default: false },
    message: {
      type: Object,
      default: () => {},
    },
  },
  computed: {
    ...mapGetters({
      allMessages: 'conversation/getConversation',
    }),
    isUserMessage() {
      return this.message.message_type === MESSAGE_TYPE.INCOMING;
    },
    replyTo() {
      if (this.readOnly) return null;
      const replyTo = this.message?.content_attributes?.in_reply_to;
      return replyTo ? this.allMessages[replyTo] : null;
    },
  },
};
</script>

<template>
  <UserMessage
    v-if="isUserMessage"
    :id="`cwmsg-${message.id}`"
    :message="message"
    :reply-to="replyTo"
    :read-only="readOnly"
  >
    <!-- EVIRMA: History adds channel/time metadata inside the native layout. -->
    <template v-if="$slots.metadata" #metadata>
      <slot name="metadata" />
    </template>
  </UserMessage>
  <AgentMessage
    v-else
    :id="`cwmsg-${message.id}`"
    :message="message"
    :reply-to="replyTo"
    :read-only="readOnly"
  >
    <template v-if="$slots.metadata" #metadata>
      <slot name="metadata" />
    </template>
  </AgentMessage>
</template>

<style scoped lang="scss">
.message-wrap {
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  max-width: 90%;
}
</style>
