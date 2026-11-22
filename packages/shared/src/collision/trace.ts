import type { Plane, Vec3 } from '../types.ts';
import { DIST_EPSILON, type Solid } from './api.ts';

/** Tolerance on d2 >= d1 (units); far below any real per-tick motion. */
const PARALLEL_EPS = 1e-7;

/** Mutable trace accumulator used while testing brushes (one per world, reused). */
export interface TraceWork {
	fraction: number;
	plane: Plane | null;
	startsolid: boolean;
	allsolid: boolean;
}

/**
 * Port of Source 2013 CM_ClipBoxToBrush. Each plane is pushed out by the box corner that
 * reaches furthest against it (ofs = normal<0 ? maxs : mins); the latest entry and the
 * earliest exit fraction decide the hit. Updates `tw` only when this brush is nearer.
 */
export function clipBoxToSolid(
	tw: TraceWork,
	solid: Solid,
	start: Vec3,
	end: Vec3,
	mins: Vec3,
	maxs: Vec3
): void {
	let enterfrac = -1;
	let leavefrac = 1;
	let clip: Plane | null = null;
	let getout = false;
	let startout = false;
	const planes = solid.planes;
	for (let i = 0; i < planes.length; i++) {
		const p = planes[i]!;
		const n = p.normal;
		const ox = n.x < 0 ? maxs.x : mins.x;
		const oy = n.y < 0 ? maxs.y : mins.y;
		const oz = n.z < 0 ? maxs.z : mins.z;
		const dist = p.dist - (ox * n.x + oy * n.y + oz * n.z);
		const d1 = start.x * n.x + start.y * n.y + start.z * n.z - dist;
		const d2 = end.x * n.x + end.y * n.y + end.z * n.z - dist;
		if (d2 > 0) getout = true; // endpoint is not in solid
		if (d1 > 0) startout = true;
		// Completely in front of this face: no intersection with the brush. PARALLEL_EPS absorbs
		// rounding when sliding exactly along a face from inside the epsilon band (otherwise a
		// tangent move gets fraction 0 and TryPlayerMove zeroes the velocity: a "ramp bug").
		if (d1 > 0 && (d2 >= DIST_EPSILON || d2 >= d1 - PARALLEL_EPS)) return;
		if (d1 <= 0 && d2 <= 0) continue;
		if (d1 > d2) {
			// entering
			let f = d1 - DIST_EPSILON;
			if (f < 0) f = 0;
			f /= d1 - d2;
			if (f > enterfrac) {
				enterfrac = f;
				clip = p;
			}
		} else {
			// leaving
			const f = (d1 + DIST_EPSILON) / (d1 - d2);
			if (f < leavefrac) leavefrac = f;
		}
	}

	if (!startout) {
		// Started inside the brush.
		tw.startsolid = true;
		if (!getout) {
			tw.allsolid = true;
			tw.fraction = 0;
		}
		return;
	}

	if (enterfrac < leavefrac && enterfrac > -1 && enterfrac < tw.fraction) {
		if (enterfrac < 0) enterfrac = 0;
		tw.fraction = enterfrac;
		tw.plane = clip;
	}
}
