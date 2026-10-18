import { randomInt } from 'node:crypto';
import type { PointId } from '@shared/types';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
export const POINT_ID_RE = /^p-[0-9a-z]{8}$/;

export function isPointId(value: string): value is PointId {
  return POINT_ID_RE.test(value);
}

export type RandomInt = (maxExclusive: number) => number;

/** Generates a fresh point ID that is not in `taken`. IDs are never reused or changed. */
export function newPointId(taken: ReadonlySet<string>, rand: RandomInt = (n) => randomInt(n)): PointId {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let s = 'p-';
    for (let i = 0; i < 8; i++) s += ALPHABET[rand(ALPHABET.length)];
    if (!taken.has(s)) return s as PointId;
  }
  throw new Error('Could not generate a unique point ID');
}
