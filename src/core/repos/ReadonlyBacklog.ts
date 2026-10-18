import type { Point, PointId } from '@shared/types';

/**
 * The only view of the backlog that generation code receives (invariant 1).
 * It has no mutating methods, and implementations return frozen copies.
 */
export interface ReadonlyBacklog {
  listUnfiled(folder: string): Promise<readonly Point[]>;
  get(id: PointId): Promise<Point | undefined>;
}
