import type { Point, PointId } from '@shared/types';

/**
 * The only view of the backlog that generation code receives (invariant 1).
 * It has no mutating methods, and implementations return frozen copies.
 */
export interface ReadonlyBacklog {
  /** Every non-deleted point in the folder, oldest first. */
  listLive(folder: string): Promise<readonly Point[]>;
  listUnfiled(folder: string): Promise<readonly Point[]>;
  get(id: PointId): Promise<Point | undefined>;
}
