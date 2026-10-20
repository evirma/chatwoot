<script setup>
// EVIRMA: Attachment timestamps follow the widget locale, including 24-hour clocks.
import { useWidgetDate } from 'widget/composables/useWidgetDate';

const { formatDateTime } = useWidgetDate();
</script>

<script>
import UserMessage from 'widget/components/UserMessage.vue';
import AgentMessageBubble from 'widget/components/AgentMessageBubble.vue';
import MessageReplyButton from 'widget/components/MessageReplyButton.vue';
// EVIRMA: Reuse the customer message swipe gesture for agent replies.
import DragWrapper from 'widget/components/DragWrapper.vue';
import ImageBubble from 'widget/components/ImageBubble.vue';
import VideoBubble from 'widget/components/VideoBubble.vue';
import FileBubble from 'widget/components/FileBubble.vue';
import Avatar from 'dashboard/components-next/avatar/Avatar.vue';
import { MESSAGE_TYPE } from 'widget/helpers/constants';
import configMixin from '../mixins/configMixin';
import messageMixin from '../mixins/messageMixin';
import { isASubmittedFormMessage } from 'shared/helpers/MessageTypeHelper';
import ReplyToChip from 'widget/components/ReplyToChip.vue';
import { BUS_EVENTS } from 'shared/constants/busEvents';
import { emitter } from 'shared/helpers/mitt';

export default {
  name: 'AgentMessage',
  components: {
    AgentMessageBubble,
    ImageBubble,
    VideoBubble,
    Avatar,
    UserMessage,
    FileBubble,
    MessageReplyButton,
    ReplyToChip,
    DragWrapper,
  },
  mixins: [configMixin, messageMixin],
  props: {
    // EVIRMA: Reuse native rendering without active-conversation reply controls.
    readOnly: { type: Boolean, default: false },
    message: {
      type: Object,
      default: () => {},
    },
    replyTo: {
      type: Object,
      default: () => {},
    },
  },
  data() {
    return {
      hasImageError: false,
      hasVideoError: false,
    };
  },
  computed: {
    shouldDisplayAgentMessage() {
      if (
        this.contentType === 'input_select' &&
        this.messageContentAttributes.submitted_values &&
        !this.message.content
      ) {
        return false;
      }
      return this.message.content;
    },
    messageType() {
      const { message_type: type = 1 } = this.message;
      return type;
    },
    contentType() {
      const { content_type: type = '' } = this.message;
      return type;
    },
    agentName() {
      if (this.message.sender) {
        return this.message.sender.available_name || this.message.sender.name;
      }

      if (this.message.additional_attributes?.sender_name) {
        return this.message.additional_attributes.sender_name;
      }

      if (this.useInboxAvatarForBot) {
        return this.channelConfig.websiteName;
      }

      return this.$t('UNREAD_VIEW.BOT');
    },
    avatarUrl() {
      const displayImage = this.useInboxAvatarForBot
        ? this.inboxAvatarUrl
        : '/assets/images/chatwoot_bot.png';

      if (this.message.message_type === MESSAGE_TYPE.TEMPLATE) {
        return displayImage;
      }

      if (this.message.sender) {
        return this.message.sender.avatar_url;
      }

      return (
        this.message.additional_attributes?.sender_avatar_url || displayImage
      );
    },
    hasRecordedResponse() {
      return (
        this.messageContentAttributes.submitted_email ||
        (this.messageContentAttributes.submitted_values &&
          !['form', 'input_csat'].includes(this.contentType))
      );
    },
    responseMessage() {
      if (this.messageContentAttributes.submitted_email) {
        return { content: this.messageContentAttributes.submitted_email };
      }

      if (this.messageContentAttributes.submitted_values) {
        if (this.contentType === 'input_select') {
          const [selectionOption = {}] =
            this.messageContentAttributes.submitted_values;
          return { content: selectionOption.title || selectionOption.value };
        }
      }
      return '';
    },
    isASubmittedForm() {
      return isASubmittedFormMessage(this.message);
    },
    submittedFormValues() {
      return this.messageContentAttributes.submitted_values.map(
        submittedValue => ({
          id: submittedValue.name,
          content: submittedValue.value,
        })
      );
    },
    wrapClass() {
      return {
        'has-text': this.shouldDisplayAgentMessage,
      };
    },
    hasReplyTo() {
      return this.replyTo && (this.replyTo.content || this.replyTo.attachments);
    },
  },
  watch: {
    message() {
      this.hasImageError = false;
      this.hasVideoError = false;
    },
  },
  mounted() {
    this.hasImageError = false;
    this.hasVideoError = false;
  },
  methods: {
    onImageLoadError() {
      this.hasImageError = true;
    },
    onVideoLoadError() {
      this.hasVideoError = true;
    },
    toggleReply() {
      emitter.emit(BUS_EVENTS.TOGGLE_REPLY_TO_MESSAGE, this.message);
    },
  },
};
</script>

<template>
  <div
    class="agent-message-wrap group"
    :class="{
      'has-response': hasRecordedResponse || isASubmittedForm,
    }"
  >
    <div v-if="!isASubmittedForm" class="agent-message">
      <div class="avatar-wrap">
        <div class="user-thumbnail-box">
          <Avatar
            v-if="message.showAvatar || hasRecordedResponse"
            :src="avatarUrl"
            :size="24"
            :name="agentName"
            rounded-full
          />
        </div>
      </div>
      <div class="message-wrap">
        <div v-if="hasReplyTo" class="flex mt-2 mb-1 text-xs">
          <ReplyToChip :reply-to="replyTo" />
        </div>
        <div class="flex w-full gap-1">
          <!-- EVIRMA: Enable swipe replies while keeping history messages read-only. -->
          <DragWrapper
            class="space-y-2"
            direction="left"
            :disabled="readOnly"
            :class="{
              'w-full':
                contentType === 'form' &&
                !messageContentAttributes?.submitted_values,
            }"
            @dragged="toggleReply"
          >
            <AgentMessageBubble
              v-if="shouldDisplayAgentMessage"
              :content-type="contentType"
              :message-content-attributes="messageContentAttributes"
              :message-id="message.id"
              :message-type="messageType"
              :message="message.content"
            />
            <!-- EVIRMA: Increase agent bubble contrast in both widget themes. -->
            <div
              v-if="hasAttachments"
              class="space-y-2 chat-bubble has-attachment agent bg-n-slate-4 dark:bg-n-slate-6"
              :class="wrapClass"
            >
              <div
                v-for="attachment in message.attachments"
                :key="attachment.id"
              >
                <ImageBubble
                  v-if="attachment.file_type === 'image' && !hasImageError"
                  :url="attachment.data_url"
                  :thumb="attachment.data_url"
                  :readable-time="formatDateTime(message.created_at)"
                  @error="onImageLoadError"
                />

                <VideoBubble
                  v-if="attachment.file_type === 'video' && !hasVideoError"
                  :url="attachment.data_url"
                  :readable-time="formatDateTime(message.created_at)"
                  @error="onVideoLoadError"
                />

                <audio
                  v-else-if="attachment.file_type === 'audio'"
                  controls
                  class="h-10 dark:invert"
                >
                  <source :src="attachment.data_url" />
                </audio>
                <FileBubble v-else :url="attachment.data_url" />
              </div>
            </div>
          </DragWrapper>
          <div class="flex flex-col justify-end">
            <!-- EVIRMA: Keep reply controls visible without a hover-capable pointer. -->
            <MessageReplyButton
              v-if="!readOnly"
              class="transition-opacity delay-75 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
              @click="toggleReply"
            />
          </div>
        </div>
        <!-- EVIRMA: Keep the history timestamp and edit label on the same line. -->
        <div class="flex items-center gap-1">
          <slot name="metadata" />
          <div
            v-if="
              messageContentAttributes.edited_at &&
              !messageContentAttributes.deleted
            "
            class="flex gap-1 text-xs text-n-slate-11"
          >
            <time v-if="!$slots.metadata">{{
              formatDateTime(message.created_at)
            }}</time>
            <span>{{ $t('EVIRMA_MESSAGE_EDIT.EDITED') }}</span>
          </div>
        </div>
        <p
          v-if="message.showAvatar || hasRecordedResponse"
          class="agent-name text-n-slate-11"
        >
          {{ agentName }}
        </p>
      </div>
    </div>

    <UserMessage v-if="hasRecordedResponse" :message="responseMessage" />
    <div v-if="isASubmittedForm">
      <UserMessage
        v-for="submittedValue in submittedFormValues"
        :key="submittedValue.id"
        :message="submittedValue"
      />
    </div>
  </div>
</template>
