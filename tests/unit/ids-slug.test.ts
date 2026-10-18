import { describe, expect, it } from 'vitest';
import { isPointId, newPointId } from '@core/formats/ids';
import { isSlug, slugify, uniqueSlug } from '@core/formats/slug';

describe('point IDs', () => {
  it('are p- plus 8 lowercase base36 characters', () => {
    for (let i = 0; i < 200; i++) expect(newPointId(new Set())).toMatch(/^p-[0-9a-z]{8}$/);
  });

  it('never return a taken ID', () => {
    let calls = 0;
    // First 8 draws spell p-00000000 (taken); the next 8 spell p-11111111.
    const rand = (): number => (calls++ < 8 ? 0 : 1);
    expect(newPointId(new Set(['p-00000000']), rand)).toBe('p-11111111');
  });

  it('validates format', () => {
    expect(isPointId('p-k3x9a2bq')).toBe(true);
    expect(isPointId('p-K3X9A2BQ')).toBe(false);
    expect(isPointId('p-short')).toBe(false);
    expect(isPointId('x-k3x9a2bq')).toBe(false);
  });
});

describe('slugs', () => {
  it('only contain [a-z0-9-]', () => {
    expect(slugify('Kubernetes Networking!')).toBe('kubernetes-networking');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
    expect(slugify('Café  Crème')).toBe('cafe-creme');
    expect(slugify('日本語')).toBe('');
    expect(isSlug('a/b')).toBe(false);
    expect(isSlug('..')).toBe(false);
    expect(isSlug('ok-slug-1')).toBe(true);
  });

  it('dedupe against taken slugs', () => {
    expect(uniqueSlug('k8s', new Set(['k8s', 'k8s-2']))).toBe('k8s-3');
    expect(uniqueSlug('', new Set())).toBe('untitled');
  });
});
