<script setup>
// EVIRMA: Keep the shared separator's appearance while localizing the widget's date label.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { isToday, isYesterday } from 'date-fns';
import { useWidgetDate } from 'widget/composables/useWidgetDate';

const props = defineProps({
  date: { type: String, required: true },
});
const { t } = useI18n();
const { formatDate } = useWidgetDate();
const formattedDate = computed(() => {
  const date = new Date(props.date);
  if (isToday(date)) return t('TODAY');
  if (isYesterday(date)) return t('YESTERDAY');
  return formatDate(date);
});
</script>

<template>
  <div
    class="text-sm text-n-slate-11 h-[3.125rem] leading-[3.125rem] relative text-center w-full before:content-[''] before:h-px before:absolute before:top-6 before:w-[calc((100%-7.5rem)/2)] before:bg-n-slate-4 before:dark:bg-n-slate-6 before:start-0 after:content-[''] after:h-px after:absolute after:top-6 after:w-[calc((100%-7.5rem)/2)] after:bg-n-slate-4 after:dark:bg-n-slate-6 after:end-0"
  >
    {{ formattedDate }}
  </div>
</template>
