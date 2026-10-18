import { describe, expect, it } from 'vitest';
import { inPeriod, monthOf, periodRange, weekOf } from '@core/formats/period';

describe('digest periods', () => {
  it('computes ISO weeks, including year boundaries', () => {
    expect(weekOf('2026-10-17')).toBe('2026-W42');
    expect(weekOf('2026-10-12')).toBe('2026-W42'); // Monday
    expect(weekOf('2026-10-18')).toBe('2026-W42'); // Sunday
    expect(weekOf('2026-01-01')).toBe('2026-W01'); // Thursday
    expect(weekOf('2027-01-01')).toBe('2026-W53'); // Friday: still the last week of 2026
    expect(weekOf('2024-12-30')).toBe('2025-W01');
  });

  it('gives ranges and titles, and rejects impossible periods', () => {
    expect(periodRange('2026-W42')).toEqual({ kind: 'week', from: '2026-10-12', to: '2026-10-18', title: 'Week 42: Oct 12–18, 2026' });
    expect(periodRange('2026-W53')?.to).toBe('2027-01-03');
    expect(periodRange('2025-W53')).toBeNull(); // 2025 has 52 ISO weeks
    expect(periodRange('2026-02')).toEqual({ kind: 'month', from: '2026-02-01', to: '2026-02-28', title: 'February 2026' });
    expect(periodRange('2026-13')).toBeNull();
    expect(periodRange('../x')).toBeNull();
    expect(monthOf('2026-10-17')).toBe('2026-10');
    expect(inPeriod('2026-10-18', periodRange('2026-W42')!)).toBe(true);
    expect(inPeriod('2026-10-19', periodRange('2026-W42')!)).toBe(false);
  });
});
