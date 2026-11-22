import type { AABB, Plane, Vec3 } from '../types.ts';
import type { BrushDef, MapDef } from '../maps/types.ts';

/** DIST_EPSILON from Source. */
export const DIST_EPSILON = 0.03125;

/** Convex solid built from a BrushDef. */
export interface Solid {
	/** Face planes followed by bevel planes; outward normals. */
	planes: Plane[];
	/** Number of leading entries in `planes` that are real faces (not bevels). */
	faceCount: number;
	/** Face polygons for rendering: vertices counter-clockwise seen from outside. */
	faces: Array<{ normal: Vec3; vertices: Vec3[] }>;
	bounds: AABB;
	material: string;
}

export interface Trace {
	fraction: number; // 0..1
	endpos: Vec3;
	/** Hit plane; normal is (0,0,0) when nothing was hit. */
	plane: Plane;
	startsolid: boolean;
	allsolid: boolean;
}

export interface CollisionWorld {
	solids: Solid[];
	/** Sweep an AABB (mins/maxs relative to origin) from start to end. */
	trace(start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3): Trace;
}

// Implemented in ./brush.ts and ./world.ts:
//   export function buildSolid(def: BrushDef): Solid
//   export function buildCollisionWorld(map: Pick<MapDef, 'brushes'>): CollisionWorld
export type { BrushDef, MapDef };
