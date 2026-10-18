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
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

export function shortDate(date: string): string {
  if (!date) return '';
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
