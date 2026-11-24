/** Patchwork jeans: loose panels of light and dark denim with sewn-on patches and hand stitching. */
import * as THREE from 'three';
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { bone, lerp, mix, PAL, sample, smooth, superellipse, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

const LIGHT = PAL.bottomA;
const INDIGO = PAL.bottomB;
const OCHRE = PAL.bottomC;
const THREAD = PAL.bottomD;

/** Wide straight leg: bind y, front, back, sideways. */
const LEG: readonly (readonly number[])[] = [
	[2.7, 3.75, 4.0, 3.55],
	[6, 3.6, 3.9, 3.45],
	[11, 3.55, 3.95, 3.4],
	[14.5, 3.65, 4.05, 3.5],
	[17.5, 3.75, 3.9, 3.55],
	[19.8, 4.0, 3.85, 3.65],
	[22.5, 4.0, 4.05, 3.8],
	[27, 4.4, 4.5, 4.05],
	[31, 4.8, 5.0, 4.3],
	[34, 4.9, 5.2, 4.3],
	[35.4, 4.4, 4.75, 3.6],
	[36.4, 3.0, 3.4, 2.2]
];
/** Seat: y, front, back, sideways, exponent. */
const SEAT: readonly (readonly number[])[] = [
	[30.6, 1.6, 2.2, 2, 2.2],
	[31.8, 3.3, 4.1, 5.2, 2.6],
	[33, 4.4, 5, 8, 2.8],
	[34.4, 5.0, 5.4, 8.35, 2.7],
	[35.6, 4.95, 5.4, 8.0, 2.5],
	[37, 4.8, 5.2, 7.6, 2.4],
	[38.6, 4.0, 4.4, 6.6, 2.3]
];
const HEM = 2.9;
const X = -0.2;

function seatWeights(y: number, z: number): Weights {
	if (y > 35.5) return mix('pelvis', 'spine', smooth(36.5, 39, y) * 0.3);
	return mix('pelvis', z > 0 ? 'thighHR' : 'thighHL', smooth(1, 6, Math.abs(z)) * lerp(0.75, 0.3, smooth(33, 35.4, y)));
}
/** Outermost point of the hips; `dir`: 1 front, -1 back. */
function hipX(y: number, z: number, dir: 1 | -1): number {
	const at = (r: number, s: number, n: number, dz: number) => (Math.abs(dz) >= s ? -Infinity : dir * X + r * (1 - (Math.abs(dz) / s) ** n) ** (1 / n));
	const q = sample(SEAT, y);
	const l = sample(LEG, y);
	const c = dir > 0 ? 1 : 2;
	return dir * Math.max(0, at(q[c]!, q[3]!, q[4]!, z), at(l[c]!, l[3]!, 2.5, Math.abs(z) - 4.3));
}
/** Point on a leg, `off` outside it. `a`: 0 front, π/2 outwards. */
function legAt(s: Side, a: number, y: number, off: number): THREE.Vector3 {
	const r = sample(LEG, y);
	const [c, n] = superellipse(a, y > 28 ? 2.5 : 2.15);
	return new THREE.Vector3(X + ((c >= 0 ? r[1]! : r[2]!) + off) * c, y, BIND[`thigh${s}`][2] + sideSign(s) * (r[3]! + off) * n);
}
/** Faded at the thigh and knee. */
function wash(p: THREE.Vector3): number {
	const front = smooth(0.2, 3.2, p.x) * Math.exp(-(((Math.abs(p.z) - 4.3) / 2.8) ** 2));
	const k = front * Math.max(Math.exp(-(((p.y - 27) / 4.6) ** 2)), Math.exp(-(((p.y - 20.4) / 2.6) ** 2)), 0.4 * Math.exp(-(((p.y - 12) / 4) ** 2)));
	return lerp(0.84, 1.16, k) * lerp(0.78, 1, smooth(0, 3, Math.abs(p.z) + Math.max(0, p.y - 28) * 0.35)) * lerp(0.86, 1, smooth(3, 8, p.y));
}

/** Panels of a leg: a seam's height slants around it. Right: dark knee panel. Left: dark thigh, light shin with a dark hem. */
const PANELS: Record<Side, readonly number[]> = { R: [24.2, 13.4], L: [28, 7.5] };
/** Angle 0..2π of the legs is measured from the front to the outside. */
const turned = (s: Side, a: number) => Math.atan2(Math.sin(a) * sideSign(s), Math.cos(a));
const slant = (s: Side, a: number) => Math.sin(a + (s === 'R' ? 0.6 : -0.4)) * (s === 'R' ? 1.1 : 1.6);

function buildLegOf(b: PartBuilder, s: Side): void {
	const z0 = BIND[`thigh${s}`][2];
	const seg = b.pick(16, 8, 5);
	const [hi, lo] = PANELS[s] as [number, number];
	const ring = (y: number, d = 0, pal?: number, shade = 1): Ring => {
		const r = sample(LEG, y);
		return { c: [X, y, z0], f: r[1]! + d, b: r[2]! + d, s: r[3]! + d, n: y > 28 ? 2.5 : 2.15, w: legWeights(s, y), pal, shade };
	};
	const base = b.pick([36.4, 35.2, 33, 30.6, 26, 22.2, 19.8, 17.2, 15.4, 11, 9, 5.2], [36.4, 34.8, 31, 19.8, 17, 10.5], [36, 31.5, 19.8]);
	const ys = [...base, hi, lo].sort((p, q) => q - p);
	const rows = [...ys.map((y) => ring(y)), ring(HEM, b.pick(0, 0.3, 0.45), undefined, 0.95), ring(HEM, -0.45, INDIGO, 0.6), ring(HEM + 1.4, -1.1, INDIGO, 0.4)];
	// Rings near a seam slant with it, so the panels meet in one line.
	const bend = (y: number, a: number): number => {
		const near = (h: number) => Math.max(0, 1 - Math.abs(y - h) / 3.4);
		return Math.max(near(hi), near(lo)) * slant(s, a);
	};
	b.loft(rows, {
		seg,
		capStart: true,
		pal: LIGHT,
		deform: (p, _t, a, i) => {
			if (i >= ys.length) return;
			const t = turned(s, a);
			const y = p.y + bend(p.y, t);
			p.copy(legAt(s, t, y, 0));
			if (b.lod > 0) return;
			const knee = Math.exp(-(((p.y - 19) / 2.6) ** 2)) * (Math.cos(a) < -0.4 ? 1 : 0.25);
			const stack = Math.exp(-(((p.y - 5) / 2) ** 2));
			const k = 1 + (0.02 * knee + 0.028 * stack) * Math.sin(p.y * 2.3 + a * 2);
			p.x = X + (p.x - X) * k;
			p.z = z0 + (p.z - z0) * k;
		},
		weightAt: (p) => legWeights(s, p.y),
		palAt: (i) => {
			if (rows[i]!.pal !== undefined) return rows[i]!.pal;
			const y = rows[i]!.c[1];
			const dark = s === 'R' ? y <= hi && y > lo : y > hi || y <= lo;
			return dark ? INDIGO : LIGHT;
		},
		shadeAt: (p) => wash(p)
	});
	if (b.lod > 0) return;
	// Dashed stitching on both sides of the panel seams.
	for (const h of [hi, lo])
		for (const d of h > 10 ? [0.42, -0.42] : [0.42])
			for (let i = 0; i < 11; i++) {
				const a = ((i + 0.5) / 11) * Math.PI * 2;
				// None between the legs.
				if (Math.sin(a) < -0.75) continue;
				const at = (t: number, off: number) => legAt(s, t, h + slant(s, t) + d, off);
				dash(b, at(a - 0.09, 0.07), at(a + 0.09, 0.07), at(a, 1).sub(at(a, 0)), legWeights(s, h + slant(s, a)));
			}
}

/** Short flat stitch from `p` to `q`, facing `n`. */
function dash(b: PartBuilder, p: THREE.Vector3, q: THREE.Vector3, n: THREE.Vector3, w: Weights, half = 0.1): void {
	const c = n.clone().cross(q.clone().sub(p)).normalize().multiplyScalar(half);
	b.grid([[q.clone().sub(c), q.clone().add(c)], [p.clone().sub(c), p.clone().add(c)]], { w, pal: THREAD });
}

type Outline = readonly (readonly [number, number])[];
/** Outlines from the top, towards +u: [u, v]. */
const SQUARE: Outline = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
const ROUND: Outline = Array.from({ length: 10 }, (_, i) => [Math.sin((i / 10) * Math.PI * 2), Math.cos((i / 10) * Math.PI * 2)] as const);
const HEART: Outline = [[0, 0.5], [0.45, 0.98], [0.92, 0.8], [1, 0.25], [0.6, -0.4], [0, -1], [-0.6, -0.4], [-1, 0.25], [-0.92, 0.8], [-0.45, 0.98]];
const SHIELD: Outline = [[0, 1], [0.9, 1], [1, 0.1], [0.75, -0.5], [0, -1], [-0.75, -0.5], [-1, 0.1], [-0.9, 1]];
const TRIANGLE: Outline = [[0, 1], [0.5, 0.1], [0.95, -0.7], [0.5, -0.85], [0, -0.85], [-0.5, -0.85], [-0.95, -0.7], [-0.5, 0.1]];

/** Sewn-on patch of cloth; `put` maps a point of it to the trousers. */
function patch(b: PartBuilder, shape: Outline, size: readonly [number, number], rot: number, pal: number, shade: number, weights: (y: number) => Weights, put: (u: number, v: number, off: number) => THREE.Vector3, flip: boolean): void {
	const c = Math.cos(rot);
	const r = Math.sin(rot);
	const at = (i: number, k: number, off: number): THREE.Vector3 => {
		const [u0, v0] = shape[i % shape.length]!;
		const u = u0 * size[0] * k;
		const v = v0 * size[1] * k;
		return put(u * c - v * r, u * r + v * c, off);
	};
	const rings = b.pick([[1, 0], [1, 0.17], [0.6, 0.2], [0.02, 0.2]], [[1, 0.28], [0.02, 0.42]], [[1, 0.2], [0.02, 0.3]]) as [number, number][];
	const w = weights(put(0, 0, 0).y);
	const rows = rings.map(([k, off]) => shape.map((_, i) => at(i, k, off)));
	b.grid(rows, { w, pal, wrap: true, flip, shadeAt: (_p, i) => shade * (i === 0 ? 0.6 : 1) });
	if (b.lod > 0) return;
	// Visible stitches across the edge.
	for (let i = 0; i < shape.length; i++)
		for (const t of shape.length > 8 ? [0.5] : [0.2, 0.7]) {
			const p = at(i, 0.8, 0.24).lerp(at(i + 1, 0.8, 0.24), t);
			const q = at(i, 1.12, 0.12).lerp(at(i + 1, 1.12, 0.12), t);
			dash(b, p, q, put(0, 0, 1).sub(put(0, 0, 0)), w, 0.09);
		}
}

function buildPatches(b: PartBuilder): void {
	/** On a leg: angle from the front to the outside, height. */
	const leg = (s: Side, a: number, y: number, shape: Outline, size: readonly [number, number], rot: number, pal: number, shade = 1) =>
		patch(b, shape, size, rot, pal, shade, (h) => legWeights(s, h), (u, v, off) => legAt(s, a + u / (sample(LEG, y)[1]! * 0.97), y + v, off), s === 'L');
	leg('R', 0.15, 28.6, SQUARE, [1.75, 1.9], 0.14, OCHRE);
	leg('L', 0.1, 20.6, ROUND, [1.95, 2.0], 0, INDIGO);
	leg('R', 0.5, 9, TRIANGLE, [1.9, 1.9], -0.2, OCHRE);
	if (b.lod === 2) return;
	leg('L', 0.45, 31.2, SQUARE, [1.35, 1.2], -0.2, LIGHT, 1.1);
	leg('L', 0.2, 12.4, SQUARE, [1.3, 1.7], 0.12, OCHRE, 0.9);
	leg('R', -0.05, 19.2, HEART, [1.75, 1.7], 0, OCHRE, 1.05);
	if (b.lod === 0) leg('R', Math.PI + 0.2, 22, SQUARE, [1.7, 1.5], 0.2, LIGHT);
	leg('L', Math.PI - 0.2, 15.5, SQUARE, [1.6, 1.8], -0.15, INDIGO);
	// Back pockets of the other wash.
	for (const s of SIDES) {
		const z0 = sideSign(s) * 4.15;
		patch(b, SHIELD, [2, 2.1], 0, s === 'R' ? INDIGO : LIGHT, 1, (y) => legWeights(s, y), (u, v, off) => new THREE.Vector3(hipX(31.9 + v, z0 + u, -1) - off * 1.3, 31.9 + v, z0 + u), true);
	}
}

function buildHips(b: PartBuilder): void {
	const full = b.pick(0, 0.22, 0.35);
	const seg = b.pick(18, 10, 6);
	const at = (y: number, d = 0, pal?: number, shade = 1): Ring => {
		const q = sample(SEAT, y);
		d += full;
		return { c: [X, y, 0], f: q[1]! + d, b: q[2]! + d, s: q[3]! + d, n: q[4], w: bone('pelvis'), pal, shade };
	};
	b.loft(b.pick([30.6, 31.8, 33, 34.4, 35.6, 37, 38.6], [30.6, 32, 33.4, 34.6, 36.4, 38.6], [30.8, 33.2, 35, 38.4]).map((y) => at(y)), {
		seg,
		capStart: true,
		capEnd: true,
		pal: LIGHT,
		weightAt: (p) => seatWeights(p.y, p.z),
		// The left side continues the dark thigh.
		palAt: (i, a) => (i === b.pick(5, 4, 2) || Math.sin(a) < 0 ? INDIGO : LIGHT),
		shadeAt: wash
	});
	// Waistband with a thread edge, loops and a button.
	b.loft(
		b.pick([at(35.45, -0.2, INDIGO, 0.6), at(35.45, 0.16, INDIGO, 0.85), at(35.75, 0.2, THREAD, 0.9), at(35.92, 0.2, INDIGO, 0.9), at(37, 0.16, INDIGO, 0.95), at(37, -0.25, INDIGO, 0.7)], [at(35.45, 0.16, INDIGO, 0.85), at(37, 0.16, INDIGO, 0.9), at(37, -0.25, INDIGO, 0.7)], [at(35.45, 0.1, INDIGO), at(37, 0.1, INDIGO)]),
		{ seg, weightAt: (p) => seatWeights(Math.max(p.y, 35.6), p.z) }
	);
	if (b.lod > 0) return;
	b.ball([hipX(36.3, 0, 1) + 0.2, 36.35, 0], [0.22, 0.5, 0.5], { w: bone('pelvis'), pal: THREAD, seg: 8, rings: 4 });
	for (const [z, dir] of [[3.6, 1], [-3.6, 1], [0, -1]] as const) b.box([hipX(36.2, z, dir) + dir * 0.18, 36.2, z], [0.4, 1.9, 0.65], { w: seatWeights(36.2, z), pal: LIGHT, rot: [0, dir * z * 0.05, 0] });
	const thread = (path: readonly (readonly [number, number])[]) =>
		b.loft(path.map(([y, z]): Ring => ({ c: [hipX(y, z, 1) + 0.02, y, z], f: 0.11, s: 0.11, w: y > 34 ? seatWeights(y, z) : legWeights(z > 0 ? 'R' : 'L', y) })), { seg: 3, pal: THREAD, capStart: true, capEnd: true });
	thread([[35.4, 1.1], [34, 1.1], [32.9, 0.8], [32.2, 0.1]]);
	for (const s of SIDES) thread([[35.4, 3.6], [34.2, 4.1], [33.4, 5.2], [32.9, 6.4], [32.7, 7.3]].map(([y, z]) => [y!, sideSign(s) * z!] as const));
}

registerItemMesh('bottom_patch', {
	hides: ['shins'],
	colors: [0x9dbbd9, 0x35507f, 0xe6a043, 0xf6ead0],
	build(b) {
		buildHips(b);
		for (const s of SIDES) buildLegOf(b, s);
		buildPatches(b);
	}
});
