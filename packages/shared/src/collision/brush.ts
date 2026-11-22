import type { BrushDef } from '../maps/types.ts';
import type { Plane, Vec3 } from '../types.ts';
import type { Solid } from './api.ts';
import { add, cross, dot, length, normalizeInPlace, scale, sub, v3 } from './vec.ts';

/** Tolerance for "point lies on / behind plane" during brush construction. */
const ON_EPS = 1e-3;
/** Normals closer than this (1 - dot) are the same direction. */
const NORMAL_EPS = 1e-6;

/** Build a convex solid: face planes, Source-style bevel planes, face polygons and bounds. */
export function buildSolid(def: BrushDef): Solid {
	let raw: Plane[];
	if (def.type === 'box') raw = boxPlanes(def.min, def.max);
	else if (def.type === 'ramp') raw = rampPlanes(def);
	else raw = def.planes.map((p) => normalizedPlane(p));

	// Dedupe identical planes.
	const planes: Plane[] = [];
	for (const p of raw) if (!hasPlane(planes, p)) planes.push(p);

	const verts = computeVertices(planes);
	if (verts.length < 4) throw new Error(`buildSolid: degenerate brush (${verts.length} vertices)`);

	// Real faces: planes touching at least 3 vertices. Redundant planes are dropped.
	const facePlanes: Plane[] = [];
	const faces: Solid['faces'] = [];
	for (const p of planes) {
		const poly = facePolygon(p, verts);
		if (poly.length >= 3) {
			facePlanes.push(p);
			faces.push({ normal: { ...p.normal }, vertices: poly });
		}
	}

	const min = v3(Infinity, Infinity, Infinity);
	const max = v3(-Infinity, -Infinity, -Infinity);
	for (const v of verts) {
		min.x = Math.min(min.x, v.x);
		min.y = Math.min(min.y, v.y);
		min.z = Math.min(min.z, v.z);
		max.x = Math.max(max.x, v.x);
		max.y = Math.max(max.y, v.y);
		max.z = Math.max(max.z, v.z);
	}

	const all = facePlanes.slice();
	addBevels(all, faces, verts, min, max);

	return {
		planes: all,
		faceCount: facePlanes.length,
		faces,
		bounds: { min, max },
		material: def.material
	};
}

function boxPlanes(min: Vec3, max: Vec3): Plane[] {
	return [
		{ normal: v3(1, 0, 0), dist: max.x },
		{ normal: v3(-1, 0, 0), dist: -min.x },
		{ normal: v3(0, 1, 0), dist: max.y },
		{ normal: v3(0, -1, 0), dist: -min.y },
		{ normal: v3(0, 0, 1), dist: max.z },
		{ normal: v3(0, 0, -1), dist: -min.z }
	];
}

function normalizedPlane(p: Plane): Plane {
	const n = { ...p.normal };
	const l = normalizeInPlace(n);
	if (l === 0) throw new Error('buildSolid: zero plane normal');
	return { normal: n, dist: p.dist / l };
}

/**
 * Triangular prism ramp. Cross-section lies in the vertical plane perpendicular to the
 * horizontal peak direction u; `left` = u rotated +90° about Z (left looking from→to).
 */
function rampPlanes(def: Extract<BrushDef, { type: 'ramp' }>): Plane[] {
	const { from: F, to: T, height, halfWidth, side } = def;
	const u = v3(T.x - F.x, T.y - F.y, 0);
	if (normalizeInPlace(u) === 0) throw new Error('buildSolid: ramp peak line has no horizontal extent');
	if (!(height > 0) || !(halfWidth > 0)) throw new Error('buildSolid: ramp height/halfWidth must be > 0');
	const left = v3(-u.y, u.x, 0);
	const drop = v3(0, 0, -height);
	const baseL = (P: Vec3) => add(add(P, scale(left, halfWidth)), drop);
	const baseR = (P: Vec3) => add(add(P, scale(left, -halfWidth)), drop);
	const under = (P: Vec3) => add(P, drop);

	const FL = side === 'right' ? under(F) : baseL(F);
	const TL = side === 'right' ? under(T) : baseL(T);
	const FR = side === 'left' ? under(F) : baseR(F);
	const TR = side === 'left' ? under(T) : baseR(T);
	const pts = [F, T, FL, TL, FR, TR];
	const c = scale(pts.reduce((a, b) => add(a, b), v3()), 1 / pts.length);

	return [
		planeThrough(F, T, FL, c), // left slope (or back face for 'right')
		planeThrough(F, T, FR, c), // right slope (or back face for 'left')
		planeThrough(FL, TL, FR, c), // bottom, parallel to the peak line
		{ normal: v3(-u.x, -u.y, 0), dist: -(u.x * F.x + u.y * F.y) }, // cap at `from`
		{ normal: v3(u.x, u.y, 0), dist: u.x * T.x + u.y * T.y } // cap at `to`
	];
}

/** Plane through a, b, c with the normal pointing away from interior point `inside`. */
function planeThrough(a: Vec3, b: Vec3, c: Vec3, inside: Vec3): Plane {
	const n = cross(sub(b, a), sub(c, a));
	if (normalizeInPlace(n) === 0) throw new Error('buildSolid: degenerate ramp face');
	let d = dot(n, a);
	if (dot(n, inside) - d > 0) {
		n.x = -n.x;
		n.y = -n.y;
		n.z = -n.z;
		d = -d;
	}
	return { normal: n, dist: d };
}

function samePlane(a: Plane, b: Plane): boolean {
	return 1 - dot(a.normal, b.normal) < NORMAL_EPS && Math.abs(a.dist - b.dist) < ON_EPS;
}

function hasPlane(list: Plane[], p: Plane): boolean {
	for (const q of list) if (samePlane(q, p)) return true;
	return false;
}

/** Vertices = plane-triple intersections lying inside all planes, deduped. */
function computeVertices(planes: Plane[]): Vec3[] {
	const out: Vec3[] = [];
	const n = planes.length;
	for (let i = 0; i < n; i++)
		for (let j = i + 1; j < n; j++)
			for (let k = j + 1; k < n; k++) {
				const p = intersect3(planes[i]!, planes[j]!, planes[k]!);
				if (!p) continue;
				let inside = true;
				for (const q of planes) {
					if (dot(q.normal, p) - q.dist > ON_EPS) {
						inside = false;
						break;
					}
				}
				if (!inside) continue;
				let dup = false;
				for (const o of out) {
					if (length(sub(o, p)) < ON_EPS * 10) {
						dup = true;
						break;
					}
				}
				if (!dup) out.push(p);
			}
	return out;
}

function intersect3(a: Plane, b: Plane, c: Plane): Vec3 | null {
	const bc = cross(b.normal, c.normal);
	const det = dot(a.normal, bc);
	if (Math.abs(det) < 1e-9) return null;
	const ca = cross(c.normal, a.normal);
	const ab = cross(a.normal, b.normal);
	return scale(add(add(scale(bc, a.dist), scale(ca, b.dist)), scale(ab, c.dist)), 1 / det);
}

/** Vertices on plane p, sorted counter-clockwise as seen from outside (looking against the normal). */
function facePolygon(p: Plane, verts: Vec3[]): Vec3[] {
	const on = verts.filter((v) => Math.abs(dot(p.normal, v) - p.dist) < ON_EPS * 10);
	if (on.length < 3) return on;
	const c = scale(on.reduce((s, v) => add(s, v), v3()), 1 / on.length);
	const n = p.normal;
	// Basis (a, b, n) right-handed: increasing atan2 angle is CCW seen from +n.
	const a = Math.abs(n.x) < 0.9 ? cross(v3(1, 0, 0), n) : cross(v3(0, 1, 0), n);
	normalizeInPlace(a);
	const b = cross(n, a);
	const ang = new Map<Vec3, number>();
	for (const v of on) {
		const d = sub(v, c);
		ang.set(v, Math.atan2(dot(d, b), dot(d, a)));
	}
	return on.sort((x, y) => ang.get(x)! - ang.get(y)!).map((v) => ({ ...v }));
}

/**
 * Source vbsp AddBrushBevels: axial planes for every missing ±X/±Y/±Z, then for each
 * non-axial edge the planes cross(edge, ±axis) that support the brush. With these, offsetting
 * planes by the box extents gives the exact Minkowski sum, so AABB sweeps don't snag.
 */
function addBevels(planes: Plane[], faces: Solid['faces'], verts: Vec3[], min: Vec3, max: Vec3): void {
	for (let axis = 0; axis < 3; axis++) {
		for (const dir of [1, -1]) {
			const n = v3(axis === 0 ? dir : 0, axis === 1 ? dir : 0, axis === 2 ? dir : 0);
			let found = false;
			for (const p of planes) if (1 - dot(p.normal, n) < NORMAL_EPS) found = true;
			if (found) continue;
			const ref = dir > 0 ? max : min;
			const comp = axis === 0 ? ref.x : axis === 1 ? ref.y : ref.z;
			planes.push({ normal: n, dist: dir * comp });
		}
	}

	for (const f of faces) {
		const w = f.vertices;
		for (let j = 0; j < w.length; j++) {
			const p0 = w[j]!;
			const p1 = w[(j + 1) % w.length]!;
			const e = sub(p0, p1);
			if (normalizeInPlace(e) < 0.5) continue;
			if (Math.abs(e.x) > 1 - NORMAL_EPS || Math.abs(e.y) > 1 - NORMAL_EPS || Math.abs(e.z) > 1 - NORMAL_EPS)
				continue; // axial edge: covered by axial planes
			for (let axis = 0; axis < 3; axis++) {
				for (const dir of [-1, 1]) {
					const a = v3(axis === 0 ? dir : 0, axis === 1 ? dir : 0, axis === 2 ? dir : 0);
					const n = cross(e, a);
					// Source skips |n| < 0.5 (edges within 30° of an axis); we keep them so the
					// Minkowski sum stays exact for near-axial edges.
					if (normalizeInPlace(n) < 1e-4) continue;
					const d = dot(p0, n);
					let behind = true;
					for (const v of verts) {
						if (dot(v, n) - d > ON_EPS) {
							behind = false;
							break;
						}
					}
					if (!behind) continue;
					const bevel = { normal: n, dist: d };
					if (!hasPlane(planes, bevel)) planes.push(bevel);
				}
			}
		}
	}
}
