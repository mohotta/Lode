export function localDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dayLabel(date: string, now = new Date()): string {
  const today = localDate(now);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (date === today) return 'Today';
  if (date === localDate(y)) return 'Yesterday';
  return dayMonth(date, now);
}

/** "15 Sep", with the year only when it isn't this year. Takes a YYYY-MM-DD date or an ISO time. */
export function dayMonth(date: string, now = new Date()): string {
  if (!date) return '';
  const d = new Date(date.length === 10 ? `${date}T00:00:00` : date);
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function shortDate(date: string): string {
  if (!date) return '';
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
