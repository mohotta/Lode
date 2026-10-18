import type { DigestKind } from '@shared/types';

/**
 * Digest periods: ISO-8601 weeks (`2026-W42`, Monday to Sunday) and calendar months
 * (`2026-10`). All dates are local calendar days in YYYY-MM-DD form.
 */

export const PERIOD_RE = /^(\d{4})-(?:W(\d{2})|(\d{2}))$/;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad = (n: number): string => String(n).padStart(2, '0');
const ymd = (d: Date): string => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (date: string): Date => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};

/** ISO week ID of a day: the week belongs to the year of its Thursday. */
export function weekOf(date: string): string {
  const d = utc(date);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this week
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${year}-W${pad(week)}`;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export interface PeriodRange {
  kind: DigestKind;
  from: string;
  to: string;
  title: string;
}

/** Range and display title of a period ID, or null if the ID is not a valid period. */
export function periodRange(id: string): PeriodRange | null {
  const m = PERIOD_RE.exec(id);
  if (!m) return null;
  const year = Number(m[1]);
  if (m[2]) {
    const week = Number(m[2]);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    if (weekOf(ymd(monday)) !== id) return null; // e.g. W53 in a 52-week year
    const a = `${MONTHS[monday.getUTCMonth()]} ${monday.getUTCDate()}`;
    const b =
      monday.getUTCMonth() === sunday.getUTCMonth()
        ? String(sunday.getUTCDate())
        : `${MONTHS[sunday.getUTCMonth()]} ${sunday.getUTCDate()}`;
    return {
      kind: 'week',
      from: ymd(monday),
      to: ymd(sunday),
      title: `Week ${week}: ${a}–${b}, ${sunday.getUTCFullYear()}`,
    };
  }
  const month = Number(m[3]);
  if (month < 1 || month > 12) return null;
  const last = new Date(Date.UTC(year, month, 0));
  return { kind: 'month', from: `${year}-${pad(month)}-01`, to: ymd(last), title: `${MONTHS_LONG[month - 1]} ${year}` };
}

export function inPeriod(date: string, range: { from: string; to: string }): boolean {
  return date >= range.from && date <= range.to;
}
