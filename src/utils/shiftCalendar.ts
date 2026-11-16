export type DateKey = string;

export const toDateKey = (value: Date | string): DateKey => {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return toDateKey(parsed);
};

export const isWeekendDay = (date: Date) => {
  const day = date.getDay();
  return day === 5 || day === 6;
};

export const countEffectiveDaysBetween = (
  start: Date,
  end: Date,
  options: { excludedDates?: Set<string>; excludeWeekend?: boolean } = {}
): number => {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (endDay.getTime() <= startDay.getTime()) return 0;

  const excludedDates = options.excludedDates || new Set<string>();
  const excludeWeekend = options.excludeWeekend ?? false;
  let count = 0;
  const cursor = new Date(startDay);
  cursor.setDate(cursor.getDate() + 1);

  while (cursor <= endDay) {
    const key = toDateKey(cursor);
    const isExcluded = (excludeWeekend && isWeekendDay(cursor)) || excludedDates.has(key);
    if (!isExcluded) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  return count;
};
