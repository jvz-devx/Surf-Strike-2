import { describe, expect, it } from 'vitest';
import type { BrushDef } from '../maps/types.ts';
import type { Vec3 } from '../types.ts';
import { DIST_EPSILON, type Solid } from './api.ts';
import { buildSolid } from './brush.ts';
import { clipBoxToSolid, type TraceWork } from './trace.ts';
import { cross, dot, sub, v3 } from './vec.ts';
import { buildCollisionWorld } from './world.ts';

const MINS = v3(-16, -16, 0);
const MAXS = v3(16, 16, 72);
const ZERO = v3();

const box = (min: Vec3, max: Vec3): BrushDef => ({ type: 'box', min, max, material: 'm' });
const ramp = (from: Vec3, to: Vec3, height: number, halfWidth: number, side: 'both' | 'left' | 'right'): BrushDef => ({
	type: 'ramp',
	from,
	to,
	height,
	halfWidth,
	side,
	material: 'm'
});

function expectVec(a: Vec3, b: Vec3, digits = 6) {
	expect(a.x).toBeCloseTo(b.x, digits);
	expect(a.y).toBeCloseTo(b.y, digits);
	expect(a.z).toBeCloseTo(b.z, digits);
}

function faceNormals(s: Solid): Vec3[] {
	return s.planes.slice(0, s.faceCount).map((p) => p.normal);
}

function hasNormal(list: Vec3[], n: Vec3) {
	return list.some((m) => Math.abs(m.x - n.x) < 1e-6 && Math.abs(m.y - n.y) < 1e-6 && Math.abs(m.z - n.z) < 1e-6);
}

/** Generic solid invariants: faces planar + CCW from outside, every vertex inside every plane. */
function checkSolid(s: Solid) {
	expect(s.faces.length).toBe(s.faceCount);
	for (let i = 0; i < s.faceCount; i++) {
		const f = s.faces[i]!;
		const p = s.planes[i]!;
		expectVec(f.normal, p.normal);
		expect(f.vertices.length).toBeGreaterThanOrEqual(3);
		// Newell normal points along the outward normal => CCW seen from outside.
		let nx = 0,
			ny = 0,
			nz = 0;
		for (let j = 0; j < f.vertices.length; j++) {
			const a = f.vertices[j]!;
			const b = f.vertices[(j + 1) % f.vertices.length]!;
			nx += (a.y - b.y) * (a.z + b.z);
			ny += (a.z - b.z) * (a.x + b.x);
			nz += (a.x - b.x) * (a.y + b.y);
			expect(Math.abs(dot(p.normal, a) - p.dist)).toBeLessThan(1e-6);
		}
		expect(nx * p.normal.x + ny * p.normal.y + nz * p.normal.z).toBeGreaterThan(0);
	}
	for (const p of s.planes) {
		expect(Math.hypot(p.normal.x, p.normal.y, p.normal.z)).toBeCloseTo(1, 9);
		for (const f of s.faces) for (const v of f.vertices) expect(dot(p.normal, v) - p.dist).toBeLessThan(1e-6);
	}
}

/** Independent SAT overlap test of an AABB against the solid's actual vertices. */
function satOverlap(s: Solid, o: Vec3, mins: Vec3, maxs: Vec3): boolean {
	const verts = s.faces.flatMap((f) => f.vertices);
	const axes: Vec3[] = [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1), ...s.faces.map((f) => f.normal)];
	for (const f of s.faces) {
		for (let j = 0; j < f.vertices.length; j++) {
			const e = sub(f.vertices[(j + 1) % f.vertices.length]!, f.vertices[j]!);
			for (const a of [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)]) {
				const c = cross(e, a);
				const l = Math.hypot(c.x, c.y, c.z);
				if (l > 1e-6) axes.push(v3(c.x / l, c.y / l, c.z / l));
			}
		}
	}
	for (const a of axes) {
		let smin = Infinity,
			smax = -Infinity;
		for (const v of verts) {
			const d = dot(v, a);
			smin = Math.min(smin, d);
			smax = Math.max(smax, d);
		}
		const c = dot(o, a);
		const bmin = c + Math.min(a.x * mins.x, a.x * maxs.x) + Math.min(a.y * mins.y, a.y * maxs.y) + Math.min(a.z * mins.z, a.z * maxs.z);
		const bmax = c + Math.max(a.x * mins.x, a.x * maxs.x) + Math.max(a.y * mins.y, a.y * maxs.y) + Math.max(a.z * mins.z, a.z * maxs.z);
		if (bmax < smin || bmin > smax) return false;
	}
	return true;
}

// Deterministic PRNG for randomized tests.
function rng(seed: number) {
	return () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 4294967296;
	};
}

describe('buildSolid', () => {
	it('box: 6 axial faces, quads, bounds, no extra bevels', () => {
		const s = buildSolid(box(v3(0, 0, 0), v3(100, 50, 20)));
		expect(s.faceCount).toBe(6);
		expect(s.planes.length).toBe(6);
		expect(s.faces.every((f) => f.vertices.length === 4)).toBe(true);
		expectVec(s.bounds.min, v3(0, 0, 0));
		expectVec(s.bounds.max, v3(100, 50, 20));
		checkSolid(s);
	});

	const r = Math.SQRT1_2;
	it('ramp both: A-frame with two 45° slopes, bottom and caps', () => {
		const s = buildSolid(ramp(v3(0, 0, 100), v3(1000, 0, 100), 100, 100, 'both'));
		expect(s.faceCount).toBe(5);
		const n = faceNormals(s);
		expect(hasNormal(n, v3(0, r, r))).toBe(true); // left (+Y looking along +X)
		expect(hasNormal(n, v3(0, -r, r))).toBe(true);
		expect(hasNormal(n, v3(0, 0, -1))).toBe(true);
		expect(hasNormal(n, v3(-1, 0, 0))).toBe(true);
		expect(hasNormal(n, v3(1, 0, 0))).toBe(true);
		expectVec(s.bounds.min, v3(0, -100, 0));
		expectVec(s.bounds.max, v3(1000, 100, 100));
		checkSolid(s);
	});

	it('ramp left / right: one slope plus a vertical back face', () => {
		const L = buildSolid(ramp(v3(0, 0, 100), v3(1000, 0, 100), 100, 100, 'left'));
		const nl = faceNormals(L);
		expect(L.faceCount).toBe(5);
		expect(hasNormal(nl, v3(0, r, r))).toBe(true);
		expect(hasNormal(nl, v3(0, -1, 0))).toBe(true);
		expectVec(L.bounds.min, v3(0, 0, 0));
		expectVec(L.bounds.max, v3(1000, 100, 100));
		checkSolid(L);

		const R = buildSolid(ramp(v3(0, 0, 100), v3(1000, 0, 100), 100, 100, 'right'));
		const nr = faceNormals(R);
		expect(hasNormal(nr, v3(0, -r, r))).toBe(true);
		expect(hasNormal(nr, v3(0, 1, 0))).toBe(true);
		expectVec(R.bounds.min, v3(0, -100, 0));
		checkSolid(R);

		// Along -Y the left side is +X.
		const Y = buildSolid(ramp(v3(0, 0, 100), v3(0, -1000, 100), 100, 100, 'left'));
		expect(hasNormal(faceNormals(Y), v3(r, 0, r))).toBe(true);
		checkSolid(Y);
	});

	it('descending ramp: sheared prism, faces parallel to the peak line', () => {
		const from = v3(0, 0, 300);
		const to = v3(1000, 0, 200);
		const s = buildSolid(ramp(from, to, 150, 200, 'both'));
		checkSolid(s);
		expect(s.faceCount).toBe(5);
		const d = sub(to, from);
		const n = faceNormals(s);
		// Slopes and bottom contain the peak direction; caps are vertical, perpendicular to it in XY.
		const along = n.filter((m) => Math.abs(dot(m, d)) < 1e-6);
		expect(along.length).toBe(3);
		const bottom = along.find((m) => m.z < 0)!;
		expect(bottom.x).toBeLessThan(0); // tilted with the descent
		expect(hasNormal(n, v3(1, 0, 0))).toBe(true);
		expect(hasNormal(n, v3(-1, 0, 0))).toBe(true);
		expectVec(s.bounds.min, v3(0, -200, 50));
		expectVec(s.bounds.max, v3(1000, 200, 300));
	});

	it('convex: arbitrary planes, redundant plane dropped', () => {
		const s = buildSolid({
			type: 'convex',
			material: 'm',
			planes: [
				{ normal: v3(1, 0, 0), dist: 10 },
				{ normal: v3(-1, 0, 0), dist: 10 },
				{ normal: v3(0, 1, 0), dist: 10 },
				{ normal: v3(0, -1, 0), dist: 10 },
				{ normal: v3(0, 0, 1), dist: 10 },
				{ normal: v3(0, 0, -1), dist: 10 },
				{ normal: v3(2, 0, 0), dist: 100 }, // redundant (x <= 50), unnormalized
				{ normal: v3(1, 1, 0), dist: 10 } // chops a vertical edge
			]
		});
		expect(s.faceCount).toBe(7);
		checkSolid(s);
	});

	it('adds axial and edge bevels for non-axial brushes', () => {
		const s = buildSolid(ramp(v3(0, 0, 0), v3(700, 400, 300), 200, 150, 'both'));
		checkSolid(s);
		expect(s.planes.length).toBeGreaterThan(s.faceCount);
		const all = s.planes.map((p) => p.normal);
		for (const a of [v3(1, 0, 0), v3(-1, 0, 0), v3(0, 1, 0), v3(0, -1, 0), v3(0, 0, 1), v3(0, 0, -1)])
			expect(hasNormal(all, a)).toBe(true);
		// Bevel planes each touch the brush (pass through at least one vertex).
		const verts = s.faces.flatMap((f) => f.vertices);
		for (const p of s.planes.slice(s.faceCount)) {
			const maxD = Math.max(...verts.map((v) => dot(p.normal, v) - p.dist));
			expect(Math.abs(maxD)).toBeLessThan(1e-6);
		}
	});
});

describe('trace', () => {
	const world = buildCollisionWorld({ brushes: [box(v3(0, 0, 0), v3(100, 100, 100))] });

	it('box vs box: hit fraction and normal', () => {
		const t = world.trace(v3(-100, 50, 10), v3(100, 50, 10), MINS, MAXS);
		expect(t.fraction).toBeCloseTo((84 - DIST_EPSILON) / 200, 9);
		expectVec(t.plane.normal, v3(-1, 0, 0));
		expect(t.endpos.x).toBeCloseTo(-16 - DIST_EPSILON, 9);
		expect(t.startsolid).toBe(false);
		expect(t.allsolid).toBe(false);
		// Landing on top.
		const d = world.trace(v3(50, 50, 200), v3(50, 50, 50), MINS, MAXS);
		expectVec(d.plane.normal, v3(0, 0, 1));
		expect(d.endpos.z).toBeCloseTo(100 + DIST_EPSILON, 9);
	});

	it('miss returns fraction 1, endpos = end, zero normal', () => {
		const t = world.trace(v3(-100, 200, 10), v3(100, 200, 10), MINS, MAXS);
		expect(t.fraction).toBe(1);
		expectVec(t.endpos, v3(100, 200, 10));
		expectVec(t.plane.normal, ZERO);
	});

	it('startsolid / allsolid', () => {
		const a = world.trace(v3(50, 50, 50), v3(60, 50, 50), MINS, MAXS);
		expect(a.startsolid).toBe(true);
		expect(a.allsolid).toBe(true);
		expect(a.fraction).toBe(0);
		const b = world.trace(v3(50, 50, 50), v3(300, 50, 50), MINS, MAXS);
		expect(b.startsolid).toBe(true);
		expect(b.allsolid).toBe(false);
	});

	it('zero-length traces detect stuck, not touching', () => {
		const inside = world.trace(v3(110, 50, 50), v3(110, 50, 50), MINS, MAXS);
		expect(inside.startsolid).toBe(true);
		expect(inside.allsolid).toBe(true);
		const touching = v3(116 + DIST_EPSILON, 50, 50);
		const out = world.trace(touching, touching, MINS, MAXS);
		expect(out.startsolid).toBe(false);
		expect(out.fraction).toBe(1);
		const standing = v3(50, 50, 100 + DIST_EPSILON);
		expect(world.trace(standing, standing, MINS, MAXS).startsolid).toBe(false);
	});

	it('nearest hit across brushes and broadphase across cells', () => {
		const brushes: BrushDef[] = [];
		for (let i = 0; i < 40; i++) brushes.push(box(v3(i * 300, 0, 0), v3(i * 300 + 64, 64, 64)));
		const w = buildCollisionWorld({ brushes });
		const t = w.trace(v3(-500, 32, 32), v3(20000, 32, 32), ZERO, ZERO);
		expect(t.endpos.x).toBeCloseTo(-DIST_EPSILON, 6);
		const t2 = w.trace(v3(3000 + 100, 32, 32), v3(3000 + 400, 32, 32), ZERO, ZERO);
		expect(t2.endpos.x).toBeCloseTo(3300 - DIST_EPSILON, 6);
		const t3 = w.trace(v3(3000 + 100, 32, 200), v3(3000 + 400, 32, 200), MINS, MAXS);
		expect(t3.fraction).toBe(1);
	});

	it('bevels: no phantom hit above an A-frame peak', () => {
		const s = buildSolid(ramp(v3(0, 0, 100), v3(1000, 0, 100), 100, 100, 'both'));
		const naive: Solid = { ...s, planes: s.planes.slice(0, s.faceCount) };
		const run = (solid: Solid) => {
			const tw: TraceWork = { fraction: 1, plane: null, startsolid: false, allsolid: false };
			clipBoxToSolid(tw, solid, v3(500, -300, 110), v3(500, 300, 110), MINS, MAXS);
			return tw.fraction;
		};
		expect(run(naive)).toBeLessThan(1); // box bottom (z=110) is 10 units above the peak
		expect(run(s)).toBe(1);
	});

	it('bevels: sweeping along a diagonal ramp face does not snag', () => {
		const from = v3(0, 0, 500);
		const to = v3(2000, 1500, 300);
		const w = buildCollisionWorld({ brushes: [ramp(from, to, 400, 400, 'left')] });
		const s = w.solids[0]!;
		const slope = s.planes.slice(0, s.faceCount).find((p) => p.normal.z > 0)!;
		const n = slope.normal;
		// Box support against the slope, then sit 0.5 units off the surface.
		const sup = v3(n.x < 0 ? MAXS.x : MINS.x, n.y < 0 ? MAXS.y : MINS.y, n.z < 0 ? MAXS.z : MINS.z);
		const place = (t: number) => {
			const peak = v3(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t);
			// Point on the slope 200 units down-slope from the peak line, plus clearance.
			const len = Math.hypot(to.x - from.x, to.y - from.y);
			const left = v3(-(to.y - from.y) / len, (to.x - from.x) / len, 0);
			const onFace = v3(peak.x + left.x * 200, peak.y + left.y * 200, peak.z - 200);
			const k = slope.dist - dot(onFace, n) + 0.5 - dot(sup, n); // push along n until clear
			return v3(onFace.x + n.x * k, onFace.y + n.y * k, onFace.z + n.z * k);
		};
		const a = place(0.1);
		const b = place(0.9);
		const t = w.trace(a, b, MINS, MAXS);
		expect(t.startsolid).toBe(false);
		expect(t.fraction).toBe(1);
		// And moving into the face stops at it with the slope normal.
		const into = w.trace(a, v3(a.x - n.x * 50, a.y - n.y * 50, a.z - n.z * 50), MINS, MAXS);
		expect(into.fraction).toBeLessThan(1);
		expectVec(into.plane.normal, n);
	});

	it('randomized sweeps agree with an independent SAT test', () => {
		const rand = rng(1234);
		const defs: BrushDef[] = [
			ramp(v3(0, 0, 0), v3(700, 400, 300), 200, 150, 'both'),
			ramp(v3(0, 0, 0), v3(-300, 900, -200), 300, 250, 'left'),
			ramp(v3(0, 0, 0), v3(500, -500, 0), 250, 120, 'right'),
			box(v3(-50, -60, -70), v3(80, 90, 40))
		];
		const steps = 2000;
		let hits = 0;
		for (const def of defs) {
			const s = buildSolid(def);
			const c = v3(
				(s.bounds.min.x + s.bounds.max.x) / 2,
				(s.bounds.min.y + s.bounds.max.y) / 2,
				(s.bounds.min.z + s.bounds.max.z) / 2
			);
			for (let i = 0; i < 60; i++) {
				const r = () => (rand() - 0.5) * 1600;
				const a = v3(c.x + r(), c.y + r(), c.z + r());
				const b = v3(c.x + r(), c.y + r(), c.z + r());
				if (satOverlap(s, a, MINS, MAXS)) continue;
				const tw: TraceWork = { fraction: 1, plane: null, startsolid: false, allsolid: false };
				clipBoxToSolid(tw, s, a, b, MINS, MAXS);
				let first = 1;
				for (let k = 1; k <= steps; k++) {
					const t = k / steps;
					if (satOverlap(s, v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t), MINS, MAXS)) {
						first = t;
						break;
					}
				}
				// Epsilon backs off along the hit normal: in fraction terms eps / |move·n|.
				const pn = tw.plane?.normal ?? v3(1, 0, 0);
				const len = Math.abs(dot(sub(b, a), pn));
				if (first === 1) expect(tw.fraction).toBe(1);
				else {
					hits++;
					expect(tw.fraction).toBeLessThanOrEqual(first);
					expect(tw.fraction).toBeGreaterThanOrEqual(first - 1 / steps - (2 * DIST_EPSILON) / len - 1e-6);
				}
			}
		}
		expect(hits).toBeGreaterThan(20);
	});
});
