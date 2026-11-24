/**
 * Procedural mesh kit for character parts (docs/characters.md): lofted tubes,
 * ellipsoids and rounded boxes with bone weights, a palette index and a baked
 * shade per vertex. Everything ends up in plain arrays (`PartData`), which
 * `geometry.ts` merges into one skinned geometry per loadout.
 */
import * as THREE from 'three';
import { BIND, BONE_INDEX, SOCKET_DEFS, type BoneName, type SocketName, type V3 } from './skeleton.js';

/** 0 close, 1 mid, 2 far. */
export type Lod = 0 | 1 | 2;

/** Bone weights: up to four pairs, normalised when stored. */
export type Weights = ReadonlyArray<readonly [BoneName, number]>;

/**
 * Palette slots. Vertices store an index, the material holds the colours, so
 * one geometry serves every colour and role. Each cosmetic slot has four.
 */
export const PAL = Object.freeze({
	skin: 0,
	skinDark: 1,
	hair: 2,
	brow: 3,
	eyeWhite: 4,
	iris: 5,
	mouth: 6,
	topA: 7,
	topB: 8,
	topC: 9,
	topD: 10,
	bottomA: 11,
	bottomB: 12,
	bottomC: 13,
	bottomD: 14,
	shoesA: 15,
	shoesB: 16,
	shoesC: 17,
	shoesD: 18,
	hatA: 19,
	hatB: 20,
	hatC: 21,
	hatD: 22,
	glassesA: 23,
	glassesB: 24,
	glassesC: 25,
	glassesD: 26
});
export const PAL_SIZE = 27;

export interface PartData {
	pos: number[];
	nrm: number[];
	/** Four bone indices and weights per vertex. */
	si: number[];
	sw: number[];
	pal: number[];
	shade: number[];
	idx: number[];
}

export interface Ring {
	/** Centre. */
	c: V3;
	/** Radius along the loft's `u` axis, forward and backward. */
	f: number;
	b?: number;
	/** Radius along the `v` axis (sideways). */
	s: number;
	/** Superellipse exponent: 2 is round, higher is boxier. */
	n?: number;
	w: Weights;
	pal?: number;
	shade?: number;
}

export interface LoftOptions {
	seg: number;
	u?: V3;
	v?: V3;
	pal?: number;
	/** Close the first / last ring with a fan. */
	capStart?: boolean;
	capEnd?: boolean;
	/** Change a point: `t` 0..1 along the loft, `a` angle (0 = +u, π/2 = +v). */
	deform?: (p: THREE.Vector3, t: number, a: number, ring: number) => void;
	/** Palette of the quad between rings `i`, `i+1` at angle `a`. */
	palAt?: (i: number, a: number) => number | undefined;
	shadeAt?: (p: THREE.Vector3, a: number, ring: number) => number;
	weightAt?: (p: THREE.Vector3, ring: number) => Weights;
}

const tmp = new THREE.Vector3();
const X: V3 = [1, 0, 0];
const Z: V3 = [0, 0, 1];

export const bone = (b: BoneName): Weights => [[b, 1]];
/** Blend of two bones: `t` = share of `b`. */
export const mix = (a: BoneName, b: BoneName, t: number): Weights => [
	[a, 1 - t],
	[b, t]
];
export const smooth = (a: number, b: number, x: number): number => {
	const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Linear interpolation in a table sorted by its first column. */
export function sample(table: readonly (readonly number[])[], x: number, out: number[] = []): number[] {
	const last = table.length - 1;
	let i = 0;
	while (i < last - 1 && table[i + 1]![0]! < x) i++;
	const a = table[i]!;
	const b = table[i + 1]!;
	const t = Math.max(0, Math.min(1, (x - a[0]!) / (b[0]! - a[0]! || 1)));
	out.length = 0;
	for (let k = 0; k < a.length; k++) out.push(lerp(a[k]!, b[k]!, t));
	return out;
}

export function superellipse(a: number, n: number): [number, number] {
	const c = Math.cos(a);
	const s = Math.sin(a);
	if (n === 2) return [c, s];
	const e = 2 / n;
	return [Math.sign(c) * Math.abs(c) ** e, Math.sign(s) * Math.abs(s) ** e];
}

export class PartBuilder {
	readonly data: PartData = { pos: [], nrm: [], si: [], sw: [], pal: [], shade: [], idx: [] };
	private groupStart = 0;
	private socketDef: (typeof SOCKET_DEFS)[SocketName] | null = null;
	private socketBone: BoneName | null = null;
	private socketAt: THREE.Matrix4 | null = null;

	constructor(readonly lod: Lod) {}

	/** Pick a value for the current LOD. */
	pick<T>(a: T, b: T, c: T): T {
		return this.lod === 0 ? a : this.lod === 1 ? b : c;
	}

	/**
	 * Build the parts inside `fn` in the local space of a socket, rigidly bound
	 * to its bone (hats, glasses). Weights given to the primitives are ignored.
	 * `at` places everything inside the socket (uniform scale, then rotate, then move).
	 */
	socket(name: SocketName, fn: () => void, at?: { pos: V3; scale: number; rot?: V3 }): void {
		this.socketAt = at ? new THREE.Matrix4().compose(new THREE.Vector3(...at.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(at.rot ?? [0, 0, 0]))), new THREE.Vector3(at.scale, at.scale, at.scale)) : null;
		this.socketDef = SOCKET_DEFS[name];
		this.socketBone = this.socketDef.bone;
		try {
			fn();
		} finally {
			this.socketDef = null;
			this.socketBone = null;
			this.socketAt = null;
		}
	}

	private vertex(p: THREE.Vector3, w: Weights, pal: number, shade: number): number {
		const d = this.data;
		const i = d.pos.length / 3;
		if (this.socketDef) {
			tmp.copy(p);
			if (this.socketAt) tmp.applyMatrix4(this.socketAt);
			tmp.applyQuaternion(this.socketDef.quat);
			d.pos.push(tmp.x + this.socketDef.pos[0], tmp.y + this.socketDef.pos[1], tmp.z + this.socketDef.pos[2]);
			w = [[this.socketBone!, 1]];
		} else d.pos.push(p.x, p.y, p.z);
		d.nrm.push(0, 0, 0);
		let sum = 0;
		for (const [, v] of w) sum += v;
		for (let k = 0; k < 4; k++) {
			const e = w[k];
			d.si.push(e ? BONE_INDEX[e[0]] : 0);
			d.sw.push(e && sum > 0 ? e[1] / sum : 0);
		}
		d.pal.push(pal);
		d.shade.push(shade);
		return i;
	}

	private tri(a: number, b: number, c: number): void {
		this.data.idx.push(a, b, c);
	}

	/** Smooth normals over everything added since the last call (one smoothing group). */
	private finish(): void {
		const d = this.data;
		const p = d.pos;
		const acc = new Map<string, [number, number, number]>();
		const key = (i: number) => `${Math.round(p[i * 3]! * 500)},${Math.round(p[i * 3 + 1]! * 500)},${Math.round(p[i * 3 + 2]! * 500)}`;
		for (let t = this.groupStart; t < d.idx.length; t += 3) {
			const i = d.idx[t]! * 3;
			const j = d.idx[t + 1]! * 3;
			const k = d.idx[t + 2]! * 3;
			const ux = p[j]! - p[i]!;
			const uy = p[j + 1]! - p[i + 1]!;
			const uz = p[j + 2]! - p[i + 2]!;
			const vx = p[k]! - p[i]!;
			const vy = p[k + 1]! - p[i + 1]!;
			const vz = p[k + 2]! - p[i + 2]!;
			const n: [number, number, number] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
			for (let c = 0; c < 3; c++) {
				const id = key(d.idx[t + c]!);
				const e = acc.get(id);
				if (e) {
					e[0] += n[0];
					e[1] += n[1];
					e[2] += n[2];
				} else acc.set(id, [...n]);
			}
		}
		for (let t = this.groupStart; t < d.idx.length; t++) {
			const v = d.idx[t]!;
			const e = acc.get(key(v))!;
			const l = Math.hypot(e[0], e[1], e[2]) || 1;
			d.nrm[v * 3] = e[0] / l;
			d.nrm[v * 3 + 1] = e[1] / l;
			d.nrm[v * 3 + 2] = e[2] / l;
		}
		this.groupStart = d.idx.length;
	}

	/** Tube through rings (front faces outwards). */
	loft(rings: readonly Ring[], o: LoftOptions): void {
		const u = o.u ?? X;
		const v = o.v ?? Z;
		const seg = o.seg;
		const first = rings[0]!.c;
		const last = rings[rings.length - 1]!.c;
		// Axis direction against u × v decides the winding.
		const cx = u[1] * v[2] - u[2] * v[1];
		const cy = u[2] * v[0] - u[0] * v[2];
		const cz = u[0] * v[1] - u[1] * v[0];
		const flip = cx * (last[0] - first[0]) + cy * (last[1] - first[1]) + cz * (last[2] - first[2]) < 0;
		const pts: THREE.Vector3[][] = rings.map((r, i) => {
			const row: THREE.Vector3[] = [];
			for (let j = 0; j < seg; j++) {
				const a = (j / seg) * Math.PI * 2;
				const [ca, sa] = superellipse(a, r.n ?? 2);
				const ru = (ca >= 0 ? r.f : (r.b ?? r.f)) * ca;
				const rv = r.s * sa;
				const p = new THREE.Vector3(r.c[0] + u[0] * ru + v[0] * rv, r.c[1] + u[1] * ru + v[1] * rv, r.c[2] + u[2] * ru + v[2] * rv);
				o.deform?.(p, i / (rings.length - 1), a, i);
				row.push(p);
			}
			return row;
		});
		const cache = new Map<number, number>();
		const vert = (i: number, j: number, pal: number): number => {
			j %= seg;
			const k = (i * seg + j) * PAL_SIZE + pal;
			let id = cache.get(k);
			if (id === undefined) {
				const r = rings[i]!;
				const p = pts[i]![j]!;
				const shade = (r.shade ?? 1) * (o.shadeAt?.(p, (j / seg) * Math.PI * 2, i) ?? 1);
				id = this.vertex(p, o.weightAt?.(p, i) ?? r.w, pal, shade);
				cache.set(k, id);
			}
			return id;
		};
		for (let i = 0; i < rings.length - 1; i++) {
			const r = rings[i]!;
			for (let j = 0; j < seg; j++) {
				const pal = o.palAt?.(i, ((j + 0.5) / seg) * Math.PI * 2) ?? r.pal ?? o.pal ?? 0;
				const a = vert(i, j, pal);
				const b = vert(i, j + 1, pal);
				const c = vert(i + 1, j + 1, pal);
				const d = vert(i + 1, j, pal);
				if (flip) {
					this.tri(a, c, b);
					this.tri(a, d, c);
				} else {
					this.tri(a, b, c);
					this.tri(a, c, d);
				}
			}
		}
		const cap = (i: number, start: boolean) => {
			const r = rings[i]!;
			const pal = r.pal ?? o.pal ?? 0;
			const c = new THREE.Vector3();
			for (const p of pts[i]!) c.add(p);
			c.divideScalar(seg);
			const m = this.vertex(c, o.weightAt?.(c, i) ?? r.w, pal, r.shade ?? 1);
			for (let j = 0; j < seg; j++) {
				const a = vert(i, j, pal);
				const b = vert(i, j + 1, pal);
				if (start !== flip) this.tri(m, b, a);
				else this.tri(m, a, b);
			}
		};
		if (o.capStart) cap(0, true);
		if (o.capEnd) cap(rings.length - 1, false);
		this.finish();
	}

	/** Open grid of points (`rows` × `cols`), wound so that row → col is counter-clockwise from outside. */
	grid(pts: readonly (readonly THREE.Vector3[])[], o: { w: Weights; pal: number; wrap?: boolean; flip?: boolean; shadeAt?: (p: THREE.Vector3, i: number) => number }): void {
		const ids = pts.map((row, i) => row.map((p) => this.vertex(p, o.w, o.pal, o.shadeAt?.(p, i) ?? 1)));
		for (let i = 0; i < ids.length - 1; i++) {
			const n = ids[i]!.length;
			for (let j = 0; j < (o.wrap ? n : n - 1); j++) {
				const a = ids[i]![j]!;
				const b = ids[i]![(j + 1) % n]!;
				const c = ids[i + 1]![(j + 1) % n]!;
				const d = ids[i + 1]![j]!;
				if (o.flip) {
					this.tri(a, c, b);
					this.tri(a, d, c);
				} else {
					this.tri(a, b, c);
					this.tri(a, c, d);
				}
			}
		}
		this.finish();
	}

	/** Ellipsoid; `rot` is an Euler rotation (radians). */
	ball(c: V3, r: V3, o: { w: Weights; pal: number; seg?: number; rings?: number; shade?: number; rot?: V3 }): void {
		const seg = o.seg ?? 8;
		const rows = o.rings ?? 6;
		const e = o.rot ? new THREE.Euler(...o.rot) : null;
		const pts: THREE.Vector3[][] = [];
		for (let i = 0; i <= rows; i++) {
			const row: THREE.Vector3[] = [];
			const th = (i / rows) * Math.PI;
			for (let j = 0; j < seg; j++) {
				const a = (j / seg) * Math.PI * 2;
				const p = new THREE.Vector3(Math.sin(th) * Math.cos(a) * r[0], Math.cos(th) * r[1], Math.sin(th) * Math.sin(a) * r[2]);
				if (e) p.applyEuler(e);
				row.push(p.add(new THREE.Vector3(...c)));
			}
			pts.push(row);
		}
		this.grid(pts, { w: o.w, pal: o.pal, wrap: true, shadeAt: () => o.shade ?? 1 });
	}

	/** Flat-shaded box; `rot` is an Euler rotation (radians), `taper` scales the +X end. */
	box(c: V3, size: V3, o: { w: Weights; pal: number; rot?: V3; taper?: number; shade?: number }): void {
		const e = o.rot ? new THREE.Euler(...o.rot) : null;
		const h = [size[0] / 2, size[1] / 2, size[2] / 2] as const;
		const corner = (sx: number, sy: number, sz: number) => {
			const k = sx > 0 ? (o.taper ?? 1) : 1;
			const p = new THREE.Vector3(sx * h[0], sy * h[1] * k, sz * h[2] * k);
			if (e) p.applyEuler(e);
			return p.add(new THREE.Vector3(...c));
		};
		const faces: [V3, V3, V3, V3][] = [
			[[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
			[[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
			[[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]],
			[[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
			[[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
			[[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]
		];
		for (const f of faces) {
			const [a, b, cc, d] = f.map((k) => this.vertex(corner(...k), o.w, o.pal, o.shade ?? 1)) as [number, number, number, number];
			this.tri(a, b, cc);
			this.tri(a, cc, d);
			this.finish();
		}
	}
}

/** Bind position of a bone moved by an offset. */
export function from(b: BoneName, x: number, y: number, z: number): V3 {
	const p = BIND[b];
	return [p[0] + x, p[1] + y, p[2] + z];
}
