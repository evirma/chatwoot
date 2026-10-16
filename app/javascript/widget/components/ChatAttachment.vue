<script>
import { inject, ref } from 'vue';
import FileUpload from 'vue-upload-component';
import Spinner from 'shared/components/Spinner.vue';
import {
  checkFileSizeLimit,
  resolveMaximumFileUploadSize,
} from 'shared/helpers/FileHelper';
import { ALLOWED_FILE_TYPES } from 'shared/constants/messages';
import { BUS_EVENTS } from 'shared/constants/busEvents';
import FluentIcon from 'shared/components/FluentIcon/Index.vue';
import { DirectUpload } from 'activestorage';
import { mapGetters } from 'vuex';
import { emitter } from 'shared/helpers/mitt';
import { useAttachments } from '../composables/useAttachments';

export default {
  components: { FluentIcon, FileUpload, Spinner },
  props: {
    onAttach: {
      type: Function,
      default: () => {},
    },
  },
  setup() {
    const { canHandleAttachments } = useAttachments();
    // EVIRMA: Reuse FileUpload for drops over both the timeline and the input.
    const attachmentDropTarget = inject('evirmaAttachmentDropTarget', null);
    const upload = ref(null);
    return { canHandleAttachments, attachmentDropTarget, upload };
  },
  data() {
    return { isUploading: false };
  },
  computed: {
    ...mapGetters({
      globalConfig: 'globalConfig/get',
    }),
    fileUploadSizeLimit() {
      return resolveMaximumFileUploadSize(
        this.globalConfig.maximumFileUploadSize
      );
    },
    allowedFileTypes() {
      return ALLOWED_FILE_TYPES;
    },
  },
  mounted() {
    document.addEventListener('paste', this.handleClipboardPaste);
  },
  unmounted() {
    document.removeEventListener('paste', this.handleClipboardPaste);
  },
  methods: {
    // EVIRMA: Apply the paperclip's accepted types to drops and clipboard files too.
    filterFile(newFile, oldFile, prevent) {
      if (!newFile || oldFile) return;
      const allowed = this.allowedFileTypes.split(',').some(value => {
        const type = value.trim();
        if (!type) return false;
        if (type.startsWith('.')) {
          return newFile.name.toLowerCase().endsWith(type);
        }
        if (type.endsWith('/*')) {
          return newFile.type.startsWith(type.slice(0, -1));
        }
        return newFile.type === type;
      });
      if (!allowed) prevent();
    },
    handleClipboardPaste(e) {
      // If file picker is not enabled, do not allow paste
      if (!this.canHandleAttachments) return;

      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      // items is a DataTransferItemList object which does not have forEach method
      const itemsArray = Array.from(items);
      itemsArray.forEach(item => {
        if (item.kind === 'file') {
          e.preventDefault();
          const file = item.getAsFile();
          this.$refs.upload.add(file);
        }
      });
    },
    getFileType(fileType) {
      return fileType.includes('image') ? 'image' : 'file';
    },
    async onFileUpload(file) {
      if (this.globalConfig.directUploadsEnabled) {
        await this.onDirectFileUpload(file);
      } else {
        await this.onIndirectFileUpload(file);
      }
    },
    async onDirectFileUpload(file) {
      if (!file) {
        return;
      }
      this.isUploading = true;
      try {
        if (checkFileSizeLimit(file, this.fileUploadSizeLimit)) {
          const { websiteToken } = window.chatwootWebChannel;
          const upload = new DirectUpload(
            file.file,
            `/api/v1/widget/direct_uploads?website_token=${websiteToken}`,
            {
              directUploadWillCreateBlobWithXHR: xhr => {
                xhr.setRequestHeader('X-Auth-Token', window.authToken);
              },
            }
          );

          upload.create((error, blob) => {
            if (error) {
              emitter.emit(BUS_EVENTS.SHOW_ALERT, {
                message: error,
              });
            } else {
              this.onAttach({
                file: blob.signed_id,
                ...this.getLocalFileAttributes(file),
              });
            }
          });
        } else {
          emitter.emit(BUS_EVENTS.SHOW_ALERT, {
            message: this.$t('FILE_SIZE_LIMIT', {
              MAXIMUM_FILE_UPLOAD_SIZE: this.fileUploadSizeLimit,
            }),
          });
        }
      } catch (error) {
        // Error
      }
      this.isUploading = false;
    },
    async onIndirectFileUpload(file) {
      if (!file) {
        return;
      }
      this.isUploading = true;
      try {
        if (checkFileSizeLimit(file, this.fileUploadSizeLimit)) {
          await this.onAttach({
            file: file.file,
            ...this.getLocalFileAttributes(file),
          });
        } else {
          emitter.emit(BUS_EVENTS.SHOW_ALERT, {
            message: this.$t('FILE_SIZE_LIMIT', {
              MAXIMUM_FILE_UPLOAD_SIZE: this.fileUploadSizeLimit,
            }),
          });
        }
      } catch (error) {
        // Error
      }
      this.isUploading = false;
    },
    getLocalFileAttributes(file) {
      return {
        thumbUrl: window.URL.createObjectURL(file.file),
        fileType: this.getFileType(file.type),
      };
    },
  },
};
</script>

<template>
  <FileUpload
    ref="upload"
    multiple
    :drop="canHandleAttachments ? attachmentDropTarget : false"
    :size="fileUploadSizeLimit * 1024 * 1024"
    :accept="allowedFileTypes"
    :data="{
      direct_upload_url: '/api/v1/widget/direct_uploads',
      direct_upload: true,
    }"
    @input-filter="filterFile"
    @input-file="onFileUpload"
  >
    <button class="min-h-8 min-w-8 flex items-center justify-center">
      <FluentIcon v-if="!isUploading.image" icon="attach" />
      <Spinner v-if="isUploading" size="small" />
    </button>
    <!-- EVIRMA: The native uploader owns drag state and removes its listeners on unmount. -->
    <Teleport
      v-if="attachmentDropTarget && upload?.dropElementActive"
      :to="attachmentDropTarget"
    >
      <div
        role="status"
        class="absolute inset-0 z-[60] flex items-center justify-center border-2 border-dashed border-n-brand bg-n-background/90 text-n-slate-12 pointer-events-none"
      >
        {{ $t('EVIRMA_DROP_TO_SEND') }}
      </div>
    </Teleport>
  </FileUpload>
</template>
