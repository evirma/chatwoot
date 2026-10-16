// EVIRMA: Use the widget's reactive i18n locale for calendar dates and clock conventions.
import { computed } from 'vue';
import { fromUnixTime } from 'date-fns';
import { useLocale } from 'shared/composables/useLocale';

const DATE_OPTIONS = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  calendar: 'gregory',
};
const TIME_OPTIONS = { hour: '2-digit', minute: '2-digit' };

export function useWidgetDate() {
  const { resolvedLocale } = useLocale();
  const dateFormatter = computed(
    () => new Intl.DateTimeFormat(resolvedLocale.value, DATE_OPTIONS)
  );
  const timeFormatter = computed(
    () => new Intl.DateTimeFormat(resolvedLocale.value, TIME_OPTIONS)
  );
  const dateTimeFormatter = computed(
    () =>
      new Intl.DateTimeFormat(resolvedLocale.value, {
        ...DATE_OPTIONS,
        ...TIME_OPTIONS,
      })
  );

  return {
    formatDate: date => dateFormatter.value.format(date),
    formatTime: time => timeFormatter.value.format(fromUnixTime(time)),
    formatDateTime: time => dateTimeFormatter.value.format(fromUnixTime(time)),
  };
}
