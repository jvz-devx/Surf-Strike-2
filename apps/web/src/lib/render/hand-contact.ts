/**
 * How deep or how far a point is from a gun, and what a posed hand touches: the measuring side of the hand poses,
 * for hand-contact.test.ts and tools/models/procedural/fit_hands.mjs. Not used by the game.
 *
 * A gun is a union of closed, overlapping solids (bolts through receivers, screws in
 * stocks), so "inside" is a count: along a ray, faces left minus faces entered is positive
 * inside, however the solids overlap; three rays vote, so one missing sliver
 * doesn't decide. Distances are to the outer surface only: faces buried in another solid are left out, or
 * a point deep in a receiver would measure its depth to the hidden end of a pin.
 */
import * as THREE from 'three';
import { HAND_BONES } from './hands.js';

/** Bounding-volume tree over triangles (xyz ×3 each). */
class Tree {
	private readonly lo: Float64Array;
	private readonly hi: Float64Array;
	private readonly kids: Int32Array;
	private readonly order: Int32Array;
	private readonly count: Int32Array;
	private nodes = 0;

	constructor(readonly tri: Float64Array) {
		const n = tri.length / 9;
		this.order = Int32Array.from({ length: n }, (_, i) => i);
		const cap = Math.max(1, 2 * Math.ceil(n / 2) * 2);
		this.lo = new Float64Array(cap * 3);
		this.hi = new Float64Array(cap * 3);
		this.kids = new Int32Array(cap);
		this.count = new Int32Array(cap);
		if (n) this.build(0, n);
	}

	private build(from: number, to: number): number {
		const id = this.nodes++;
		const lo = [Infinity, Infinity, Infinity];
		const hi = [-Infinity, -Infinity, -Infinity];
		const clo = [Infinity, Infinity, Infinity];
		const chi = [-Infinity, -Infinity, -Infinity];
		for (let i = from; i < to; i++) {
			const t = this.order[i]! * 9;
			for (let k = 0; k < 3; k++) {
				const a = this.tri[t + k]!;
				const b = this.tri[t + 3 + k]!;
				const c = this.tri[t + 6 + k]!;
				lo[k] = Math.min(lo[k]!, a, b, c);
				hi[k] = Math.max(hi[k]!, a, b, c);
				const m = (a + b + c) / 3;
				clo[k] = Math.min(clo[k]!, m);
				chi[k] = Math.max(chi[k]!, m);
			}
		}
		for (let k = 0; k < 3; k++) {
			this.lo[id * 3 + k] = lo[k]!;
			this.hi[id * 3 + k] = hi[k]!;
		}
		if (to - from <= 4) {
			this.kids[id] = from;
			this.count[id] = to - from;
			return id;
		}
		let axis = 0;
		for (let k = 1; k < 3; k++) if (chi[k]! - clo[k]! > chi[axis]! - clo[axis]!) axis = k;
		const mid = (from + to) >> 1;
		const key = (t: number) => this.tri[t * 9 + axis]! + this.tri[t * 9 + 3 + axis]! + this.tri[t * 9 + 6 + axis]!;
		const part = Array.from(this.order.subarray(from, to)).sort((a, b) => key(a) - key(b));
		this.order.set(part, from);
		this.count[id] = 0;
		this.build(from, mid);
		this.kids[id] = this.build(mid, to);
		return id;
	}

	/** Squared distance to the nearest triangle, at most `best`. */
	nearest(x: number, y: number, z: number, best = Infinity): number {
		if (!this.nodes) return best;
		const stack = [0];
		const box = (n: number) => {
			let d = 0;
			const p = [x, y, z];
			for (let k = 0; k < 3; k++) {
				const v = p[k]!;
				const e = Math.max(this.lo[n * 3 + k]! - v, 0, v - this.hi[n * 3 + k]!);
				d += e * e;
			}
			return d;
		};
		while (stack.length) {
			const n = stack.pop()!;
			if (box(n) >= best) continue;
			if (this.count[n]! > 0) {
				for (let i = this.kids[n]!; i < this.kids[n]! + this.count[n]!; i++) best = Math.min(best, pointTriangle(x, y, z, this.tri, this.order[i]! * 9));
				continue;
			}
			const l = n + 1;
			const r = this.kids[n]!;
			if (box(l) < box(r)) stack.push(r, l);
			else stack.push(l, r);
		}
		return best;
	}

	/** Faces left minus faces entered along a ray. */
	crossings(x: number, y: number, z: number, d: readonly number[]): number {
		if (!this.nodes) return 0;
		let sum = 0;
		const stack = [0];
		const o = [x, y, z];
		while (stack.length) {
			const n = stack.pop()!;
			let t0 = 0;
			let t1 = Infinity;
			for (let k = 0; k < 3; k++) {
				const a = (this.lo[n * 3 + k]! - o[k]!) / d[k]!;
				const b = (this.hi[n * 3 + k]! - o[k]!) / d[k]!;
				t0 = Math.max(t0, Math.min(a, b));
				t1 = Math.min(t1, Math.max(a, b));
			}
			if (t0 > t1) continue;
			if (this.count[n]! > 0) for (let i = this.kids[n]!; i < this.kids[n]! + this.count[n]!; i++) sum += crossing(x, y, z, d, this.tri, this.order[i]! * 9);
			else stack.push(n + 1, this.kids[n]!);
		}
		return sum;
	}
}

/** Squared distance of a point to a triangle. */
function pointTriangle(px: number, py: number, pz: number, t: Float64Array, o: number): number {
	const ax = t[o]!, ay = t[o + 1]!, az = t[o + 2]!;
	const abx = t[o + 3]! - ax, aby = t[o + 4]! - ay, abz = t[o + 5]! - az;
	const acx = t[o + 6]! - ax, acy = t[o + 7]! - ay, acz = t[o + 8]! - az;
	const apx = px - ax, apy = py - ay, apz = pz - az;
	const d1 = abx * apx + aby * apy + abz * apz;
	const d2 = acx * apx + acy * apy + acz * apz;
	const sq = (u: number, v: number) => {
		const dx = apx - abx * u - acx * v;
		const dy = apy - aby * u - acy * v;
		const dz = apz - abz * u - acz * v;
		return dx * dx + dy * dy + dz * dz;
	};
	if (d1 <= 0 && d2 <= 0) return sq(0, 0);
	const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
	const d3 = abx * bpx + aby * bpy + abz * bpz;
	const d4 = acx * bpx + acy * bpy + acz * bpz;
	if (d3 >= 0 && d4 <= d3) return sq(1, 0);
	const vc = d1 * d4 - d3 * d2;
	if (vc <= 0 && d1 >= 0 && d3 <= 0) return sq(d1 / (d1 - d3), 0);
	const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
	const d5 = abx * cpx + aby * cpy + abz * cpz;
	const d6 = acx * cpx + acy * cpy + acz * cpz;
	if (d6 >= 0 && d5 <= d6) return sq(0, 1);
	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) return sq(0, d2 / (d2 - d6));
	const va = d3 * d6 - d5 * d4;
	if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
		const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
		return sq(1 - w, w);
	}
	const k = 1 / (va + vb + vc);
	return sq(vb * k, vc * k);
}

/** +1 when a ray leaves through the front of a triangle, −1 when it enters, 0 when it misses. */
function crossing(x: number, y: number, z: number, d: readonly number[], t: Float64Array, o: number): number {
	const ax = t[o]!, ay = t[o + 1]!, az = t[o + 2]!;
	const e1x = t[o + 3]! - ax, e1y = t[o + 4]! - ay, e1z = t[o + 5]! - az;
	const e2x = t[o + 6]! - ax, e2y = t[o + 7]! - ay, e2z = t[o + 8]! - az;
	const [dx, dy, dz] = d as [number, number, number];
	const qx = dy * e2z - dz * e2y, qy = dz * e2x - dx * e2z, qz = dx * e2y - dy * e2x;
	const det = e1x * qx + e1y * qy + e1z * qz;
	if (Math.abs(det) < 1e-14) return 0;
	const sx = x - ax, sy = y - ay, sz = z - az;
	const u = (sx * qx + sy * qy + sz * qz) / det;
	if (u < 0 || u > 1) return 0;
	const rx = sy * e1z - sz * e1y, ry = sz * e1x - sx * e1z, rz = sx * e1y - sy * e1x;
	const v = (dx * rx + dy * ry + dz * rz) / det;
	if (v < 0 || u + v > 1) return 0;
	const at = (e2x * rx + e2y * ry + e2z * rz) / det;
	if (at <= 0) return 0;
	// det = d · (e2 × e1)…: negative when the ray runs with the outward normal.
	return det < 0 ? 1 : -1;
}

/**
 * The same triangles with every hole filled: the little pyramids of a stippled grip have no base, and a sliver cut
 * from the shipped mesh leaves a slit. A ray out through such an opening would leave a solid it never entered.
 */
export function closed(tri: Float64Array): Float64Array {
	const ids = new Map<string, number>();
	const at: number[] = [];
	const idOf = (o: number): number => {
		const key = tri[o]!.toFixed(4) + ',' + tri[o + 1]!.toFixed(4) + ',' + tri[o + 2]!.toFixed(4);
		let id = ids.get(key);
		if (id === undefined) {
			ids.set(key, (id = ids.size));
			at.push(tri[o]!, tri[o + 1]!, tri[o + 2]!);
		}
		return id;
	};
	// Edges walked one way only.
	const open = new Map<string, number>();
	for (let o = 0; o < tri.length; o += 9) {
		const v = [idOf(o), idOf(o + 3), idOf(o + 6)];
		if (v[0] === v[1] || v[1] === v[2] || v[2] === v[0]) continue;
		for (let k = 0; k < 3; k++) {
			const a = v[k]!;
			const b = v[(k + 1) % 3]!;
			const back = open.get(b + ',' + a) ?? 0;
			if (back > 1) open.set(b + ',' + a, back - 1);
			else if (back === 1) open.delete(b + ',' + a);
			else open.set(a + ',' + b, (open.get(a + ',' + b) ?? 0) + 1);
		}
	}
	// The rim of a hole runs the other way.
	const next = new Map<number, number[]>();
	for (const [e, n] of open) {
		const [a, b] = e.split(',').map(Number) as [number, number];
		for (let i = 0; i < n; i++) next.set(b, [...(next.get(b) ?? []), a]);
	}
	const out: number[] = [];
	for (const start of next.keys()) {
		while (next.get(start)!.length) {
			const rim: number[] = [];
			const seen = new Map<number, number>();
			let v = start;
			for (;;) {
				// A rim that meets itself is a hole of its own.
				const before = seen.get(v);
				if (before !== undefined) {
					const loop = rim.splice(before);
					for (const w of loop) seen.delete(w);
					for (let i = 1; i + 1 < loop.length; i++) for (const w of [loop[0]!, loop[i]!, loop[i + 1]!]) out.push(at[w * 3]!, at[w * 3 + 1]!, at[w * 3 + 2]!);
				}
				seen.set(v, rim.length);
				rim.push(v);
				const to = next.get(v);
				if (!to?.length) break;
				v = to.pop()!;
			}
		}
	}
	const all = new Float64Array(tri.length + out.length);
	all.set(tri);
	all.set(out, tri.length);
	return all;
}

const RAYS = [
	[0.9701, 0.1873, 0.1544],
	[-0.3127, 0.9219, -0.2289],
	[0.1311, -0.2417, 0.9614]
] as const;

/** A union of closed solids: signed distance, negative inside. */
export class Solid {
	private readonly all: Tree;
	private readonly outer: Tree;

	/** Triangles as xyz ×3, counter-clockwise from outside. `quick`: every face counts as outer (one closed skin, posed anew every step). */
	constructor(triangles: Float64Array, quick = false) {
		if (!quick) triangles = closed(triangles);
		this.all = new Tree(triangles);
		if (quick) {
			this.outer = this.all;
			return;
		}
		// The outer surface: pieces no longer than half a unit whose middle, a little outwards, is outside.
		const out: number[] = [];
		const piece = (p: number[]): void => {
			const len = (i: number, j: number) => Math.hypot(p[i]! - p[j]!, p[i + 1]! - p[j + 1]!, p[i + 2]! - p[j + 2]!);
			const e = [len(0, 3), len(3, 6), len(6, 0)];
			const m = Math.max(...e);
			if (m > 0.5) {
				const k = e.indexOf(m);
				const a = p.slice(k * 3, k * 3 + 3);
				const b = p.slice(((k + 1) % 3) * 3, ((k + 1) % 3) * 3 + 3);
				const c = p.slice(((k + 2) % 3) * 3, ((k + 2) % 3) * 3 + 3);
				const h = a.map((v, i) => (v + b[i]!) / 2);
				piece([...a, ...h, ...c]);
				piece([...h, ...b, ...c]);
				return;
			}
			const u = [p[3]! - p[0]!, p[4]! - p[1]!, p[5]! - p[2]!];
			const v = [p[6]! - p[0]!, p[7]! - p[1]!, p[8]! - p[2]!];
			const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
			const l = Math.hypot(...n);
			if (l < 1e-9) return;
			const c = [0, 1, 2].map((i) => (p[i]! + p[i + 3]! + p[i + 6]!) / 3 + (n[i]! / l) * 0.015);
			if (!this.inside(c[0]!, c[1]!, c[2]!)) out.push(...p);
		};
		for (let i = 0; i < triangles.length; i += 9) piece(Array.from(triangles.subarray(i, i + 9)));
		this.outer = new Tree(Float64Array.from(out));
	}

	inside(x: number, y: number, z: number): boolean {
		let votes = 0;
		for (const r of RAYS) if (this.all.crossings(x, y, z, r) > 0) votes++;
		return votes >= 2;
	}

	/** Distance to the outer surface, negative inside. */
	signed(x: number, y: number, z: number): number {
		const d = Math.sqrt(this.outer.nearest(x, y, z));
		return this.inside(x, y, z) ? -d : d;
	}

	/** Area-free size of the outer surface (pieces), for the tests. */
	get pieces(): number {
		return this.outer.tri.length / 9;
	}
}

/** Triangles of the meshes of an object, moved by `to` (applied after their world matrix). Skinned meshes are left out. */
export function trianglesOf(o: THREE.Object3D, to: THREE.Matrix4): Float64Array {
	o.updateWorldMatrix(true, true);
	const out: number[] = [];
	const v = new THREE.Vector3();
	const m = new THREE.Matrix4();
	o.traverse((c) => {
		if (!(c instanceof THREE.Mesh) || c instanceof THREE.SkinnedMesh) return;
		m.multiplyMatrices(to, c.matrixWorld);
		const pos = (c.geometry as THREE.BufferGeometry).getAttribute('position');
		const idx = (c.geometry as THREE.BufferGeometry).index;
		const n = idx ? idx.count : pos.count;
		for (let i = 0; i < n; i++) {
			v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m);
			out.push(v.x, v.y, v.z);
		}
	});
	return Float64Array.from(out);
}

export const REGIONS = ['index', 'middle', 'ring', 'pinky', 'thumb', 'palm', 'hand', 'forearm'] as const;
/** What a vertex of the hand belongs to: the last bone of a finger (`tip`), the palm face, the rest of the hand, the forearm. */
export interface HandSample {
	/** Vertex of the geometry; of a point on a face, its nearest corner. */
	vertex: number;
	/** A point on a face: its corners and their weights. The skin is flat between its vertices. */
	face?: readonly [number, number, number];
	weights?: readonly [number, number, number];
	/** Bone that moves it most. */
	bone: string;
	/** Finger whose last bone it is on, else null. */
	tip: (typeof REGIONS)[number] | null;
	palm: boolean;
	arm: boolean;
}

/**
 * Sample points of the hand's skin: its vertices, one per place, and with `spacing` points all over its faces too, that far
 * apart at most (a thin edge of the gun could pass between two vertices). Sorted into regions by their bones and bind positions.
 */
export function handSamples(mesh: THREE.SkinnedMesh, spacing = 0): HandSample[] {
	const out = vertexSamples(mesh);
	if (spacing <= 0) return out;
	const g = mesh.geometry;
	const pos = g.getAttribute('position');
	const keyOf = (i: number) => [0, 1, 2].map((k) => pos.getComponent(i, k).toFixed(5)).join();
	const byPlace = new Map(out.map((s) => [keyOf(s.vertex), s]));
	const n = g.index ? g.index.count : pos.count;
	const bind = new THREE.Vector3();
	const hand = mesh.skeleton.boneInverses[mesh.skeleton.bones.findIndex((b) => b.name === 'hand')]!;
	for (let i = 0; i < n; i += 3) {
		const v = [0, 1, 2].map((k) => (g.index ? g.index.getX(i + k) : i + k)) as [number, number, number];
		const s = v.map((k) => byPlace.get(keyOf(k))!);
		if (s.every((k) => k.arm)) continue;
		const p = v.map((k) => bind.fromBufferAttribute(pos, k).applyMatrix4(hand).clone());
		const m = Math.ceil(Math.max(p[0]!.distanceTo(p[1]!), p[1]!.distanceTo(p[2]!), p[2]!.distanceTo(p[0]!)) / spacing);
		for (let a = 0; a <= m; a++)
			for (let b = 0; a + b <= m; b++) {
				const w = [a / m, b / m, (m - a - b) / m] as [number, number, number];
				// The corners are the vertices.
				if (Math.max(...w) > 1 - 1e-9) continue;
				const near = s[w.indexOf(Math.max(...w))]!;
				out.push({ ...near, face: v, weights: w });
			}
	}
	return out;
}

function vertexSamples(mesh: THREE.SkinnedMesh): HandSample[] {
	const pos = mesh.geometry.getAttribute('position');
	const si = mesh.geometry.getAttribute('skinIndex');
	const sw = mesh.geometry.getAttribute('skinWeight');
	const seen = new Set<string>();
	const out: HandSample[] = [];
	const bind = new THREE.Vector3();
	const inv = mesh.skeleton.boneInverses;
	const names = mesh.skeleton.bones.map((b) => b.name);
	const handInverse = inv[names.indexOf('hand')]!;
	for (let i = 0; i < pos.count; i++) {
		const key = [0, 1, 2].map((k) => pos.getComponent(i, k).toFixed(5)).join() ;
		if (seen.has(key)) continue;
		seen.add(key);
		let best = 0;
		for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > sw.getComponent(i, best)) best = k;
		const bone = names[si.getComponent(i, best)]!;
		// In hand space: the quantized mesh has its own.
		bind.fromBufferAttribute(pos, i).applyMatrix4(handInverse);
		const arm = bone === 'forearm' || bind.z > 0.1;
		const tip = bone.endsWith('3') ? (bone.slice(0, -1) as HandSample['tip']) : null;
		const palm = !arm && (bone === 'hand' || bone === 'thumb1') && bind.y < -0.3 && bind.z < -0.5 && bind.z > -4.3;
		if (!(bone in HAND_BONES)) throw new Error('unknown bone ' + bone);
		out.push({ vertex: i, bone, tip, palm, arm });
	}
	return out;
}

export interface Contact {
	/** Deepest point of the fingers and the palm inside the gun (0: none), and where it is. */
	depth: number;
	deepest: string;
	/** Points deeper than 0.02, as a share of all. */
	inside: number;
	/** Smallest distance of each fingertip and of the palm (negative: inside). */
	gaps: Record<'index' | 'middle' | 'ring' | 'pinky' | 'thumb' | 'palm', number>;
	/** Deepest point of the forearm and the cuff (0: none). */
	arm: number;
}

/** Measure a posed hand (positions xyz per vertex, in the space of the solid). */
export function measure(solid: Solid, samples: readonly HandSample[], positions: ArrayLike<number>): Contact {
	const c: Contact = { depth: 0, deepest: '', inside: 0, gaps: { index: Infinity, middle: Infinity, ring: Infinity, pinky: Infinity, thumb: Infinity, palm: Infinity }, arm: 0 };
	let n = 0;
	let deep = 0;
	const p = [0, 0, 0];
	for (const s of samples) {
		for (let k = 0; k < 3; k++) p[k] = s.face ? positions[s.face[0] * 3 + k]! * s.weights![0] + positions[s.face[1] * 3 + k]! * s.weights![1] + positions[s.face[2] * 3 + k]! * s.weights![2] : positions[s.vertex * 3 + k]!;
		const d = solid.signed(p[0]!, p[1]!, p[2]!);
		if (s.arm) {
			c.arm = Math.max(c.arm, -d);
			continue;
		}
		n++;
		if (d < -0.02) deep++;
		if (-d > c.depth) {
			c.depth = -d;
			c.deepest = s.bone;
		}
		if (s.tip) c.gaps[s.tip as 'index'] = Math.min(c.gaps[s.tip as 'index'], d);
		if (s.palm) c.gaps.palm = Math.min(c.gaps.palm, d);
	}
	c.inside = deep / n;
	return c;
}
