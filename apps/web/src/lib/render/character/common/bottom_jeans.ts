import * as THREE from 'three';
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { bone, lerp, mix, PAL, sample, smooth, superellipse, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

const DENIM = PAL.bottomA;
const INSIDE = PAL.bottomB;
const LEATHER = PAL.bottomC;
const THREAD = PAL.bottomD;

/** Straight-cut leg: bind y, front, back, sideways. */
const LEG: readonly (readonly number[])[] = [
	[3.6, 3.2, 3.35, 3.0],
	[7, 3.15, 3.35, 3.0],
	[11, 3.3, 3.65, 3.2],
	[14.5, 3.4, 3.9, 3.35],
	[17.5, 3.5, 3.7, 3.4],
	[19.8, 3.8, 3.6, 3.5],
	[22.5, 3.8, 3.8, 3.6],
	[27, 4.2, 4.3, 3.95],
	[31, 4.7, 4.9, 4.3],
	[34, 4.85, 5.2, 4.3],
	[35.2, 4.4, 4.75, 3.7],
	[36.2, 3.0, 3.3, 2.2]
];
const LEG_X = -0.2;
const CUFF_TOP = 7.3;
const CUFF_END = 3.8;

/** Seat: y, front, back, sideways, exponent. */
const SEAT: readonly (readonly number[])[] = [
	[30.6, 1.6, 2.2, 2, 2.2],
	[31.8, 3.3, 4.1, 5.2, 2.6],
	[33, 4.35, 5, 8, 2.8],
	[34.4, 5.0, 5.4, 8.35, 2.7],
	[35.4, 5.0, 5.4, 8.1, 2.55],
	[37, 4.8, 5.2, 7.6, 2.4],
	[38.6, 4.0, 4.4, 6.6, 2.3]
];
const SEAT_X = -0.2;

/** Wash: dark indigo, faded on the front of the thighs, the knees and a little on the seat. */
function wash(x: number, y: number, z: number): number {
	const across = Math.exp(-(((Math.abs(z) - 4.3) / 2.6) ** 2));
	const front = smooth(0.2, 3.2, x) * across;
	const thigh = Math.exp(-(((y - 27.2) / 4.6) ** 2));
	const knee = Math.exp(-(((y - 20.4) / 2.4) ** 2));
	const shin = 0.3 * Math.exp(-(((y - 13) / 4.5) ** 2));
	const seat = 0.4 * smooth(1, 4, -x) * across * Math.exp(-(((y - 29.5) / 3.5) ** 2));
	const k = Math.min(1, front * Math.max(thigh, knee, shin) + seat);
	// Darker between the legs and above the cuffs.
	const inner = lerp(0.8, 1, smooth(0, 3, Math.abs(z) + Math.max(0, y - 28) * 0.35));
	return lerp(0.34, 1.25, k) * inner * lerp(0.85, 1, smooth(7, 11, y));
}

/** Seat follows the thighs, the belt the hips. */
function seatWeights(y: number, z: number): Weights {
	if (y > 35.5) return mix('pelvis', 'spine', smooth(36.5, 39, y) * 0.3);
	return mix('pelvis', z > 0 ? 'thighHR' : 'thighHL', smooth(1, 6, Math.abs(z)) * lerp(0.75, 0.3, smooth(33, 35.4, y)));
}

/** Outermost point of the hips at a height and a distance from the middle; `dir`: 1 front, -1 back. */
function hipX(y: number, z: number, dir: 1 | -1): number {
	const at = (x: number, r: number, s: number, n: number, dz: number) => {
		const k = Math.abs(dz) / s;
		return k >= 1 ? -Infinity : dir * x + r * (1 - k ** n) ** (1 / n);
	};
	const q = sample(SEAT, y);
	const l = sample(LEG, y);
	const c = dir > 0 ? 1 : 2;
	return dir * Math.max(0, at(SEAT_X, q[c]!, q[3]!, q[4]!, z), at(LEG_X, l[c]!, l[3]!, 2.5, Math.abs(z) - 4.3));
}

/** Thin thread along a path on the surface. */
function thread(b: PartBuilder, path: readonly { p: THREE.Vector3; w: Weights }[], r: number, axes?: { u: readonly [number, number, number]; v: readonly [number, number, number] }): void {
	b.loft(
		path.map(({ p, w }): Ring => ({ c: [p.x, p.y, p.z], f: r, s: r, w })),
		{ seg: b.pick(4, 3, 3), pal: THREAD, capStart: true, capEnd: true, ...axes }
	);
}

function buildLegOf(b: PartBuilder, s: Side): void {
	const z0 = BIND[`thigh${s}`][2];
	const out = sideSign(s);
	const seg = b.pick(16, 8, 5);
	const ring = (y: number, d = 0, pal?: number, shade = 1): Ring => {
		const r = sample(LEG, y);
		return { c: [LEG_X, y, z0], f: r[1]! + d, b: r[2]! + d, s: r[3]! + d, n: y > 28 ? 2.5 : 2.15, w: legWeights(s, y), pal, shade };
	};
	// Creases behind the knee and stacking above the cuff.
	const crease = (p: THREE.Vector3, a: number) => {
		if (b.lod > 0 || p.y < CUFF_TOP) return;
		const knee = Math.exp(-(((p.y - 19) / 2.6) ** 2)) * (a > 2 && a < 4.3 ? 1 : 0.4);
		const stack = Math.exp(-(((p.y - 10) / 2.4) ** 2));
		const k = 1 + (0.02 * knee + 0.03 * stack) * Math.sin(p.y * 2.3 + a * 2);
		p.x *= k;
		p.z = z0 + (p.z - z0) * k;
	};
	const ys = b.pick([36.2, 35.2, 34, 31, 28, 25.5, 23, 21.3, 19.6, 17.8, 15.5, 13, 10.8, 9.2], [36.2, 34.8, 31, 27, 23, 19.8, 17, 12], [36, 32, 26, 19.8, 14]);
	b.loft([...ys.map((y) => ring(y)), ring(CUFF_TOP - 0.3)], {
		seg,
		capStart: true,
		pal: DENIM,
		deform: (p, _t, a) => crease(p, a),
		shadeAt: (p) => wash(p.x, p.y, p.z)
	});
	// Rolled cuff: the light inside of the denim, with a stitched edge.
	const cuff = b.pick(
		[
			ring(CUFF_TOP - 0.2, -0.1, INSIDE, 0.7),
			ring(CUFF_TOP, 0.42, INSIDE),
			ring(CUFF_TOP - 0.75, 0.53, THREAD),
			ring(CUFF_TOP - 1.05, 0.54, INSIDE),
			ring(CUFF_END + 0.3, 0.5, INSIDE, 0.97),
			ring(CUFF_END, 0.3, INSIDE, 0.85),
			ring(CUFF_END, -0.2, INSIDE, 0.55),
			ring(CUFF_END + 1.4, -0.8, INSIDE, 0.4)
		],
		[ring(CUFF_TOP, 0, INSIDE, 0.8), ring(CUFF_TOP - 0.2, 0.55, INSIDE), ring(CUFF_END, 0.65, INSIDE, 0.92), ring(CUFF_END, -0.2, INSIDE, 0.55), ring(CUFF_END + 1.4, -0.8, INSIDE, 0.4)],
		[ring(CUFF_TOP, 0.6, INSIDE), ring(CUFF_END, 0.95, INSIDE, 0.92), ring(CUFF_END + 1, -0.8, INSIDE, 0.4)]
	);
	b.loft(cuff, { seg, pal: INSIDE });

	// Outer seam: two rows of orange stitching on the facets beside it.
	if (b.lod === 2) return;
	const j = (seg / 4) * (out > 0 ? 1 : 3);
	const point = (y: number, k: number): THREE.Vector3 => {
		const a = ((j + k) / seg) * Math.PI * 2;
		const r = ring(y);
		const [ca, sa] = superellipse(a, r.n!);
		const p = new THREE.Vector3(LEG_X + (ca >= 0 ? r.f : r.b!) * ca, y, z0 + r.s * sa);
		crease(p, a);
		return p;
	};
	for (const dir of b.pick([1, -1], [1], [])) {
		const path = ys
			.filter((y) => y < 35)
			.concat(CUFF_TOP - 0.1)
			.map((y) => ({ p: point(y, 0).lerp(point(y, dir), 0.2).add(new THREE.Vector3(0, 0, out * 0.03)), w: legWeights(s, y) }));
		thread(b, path, b.pick(0.13, 0.22, 0));
	}
}

function buildHips(b: PartBuilder): void {
	// Coarser facets: a fuller seat, so the thighs join it in a clean line.
	const full = b.pick(0, 0.22, 0.35);
	const rings = SEAT.map(([y, f, back, s, n], i): Ring => ({ c: [SEAT_X, y!, 0], f: f! + full, b: back! + full, s: s! + full * 0.5, n, w: bone('pelvis'), shade: [0.85, 0.95, 1, 1, 1, 1, 1][i] }));
	const at = (y: number, d: number, pal: number, shade = 1): Ring => {
		const q = sample(SEAT, y);
		d += full;
		return { c: [SEAT_X, y, 0], f: q[1]! + d, b: q[2]! + d, s: q[3]! + d, n: q[4], w: bone('pelvis'), pal, shade };
	};
	const seg = b.pick(20, 10, 6);
	b.loft(rings, { seg, pal: DENIM, capStart: true, capEnd: true, weightAt: (p) => seatWeights(p.y, p.z), shadeAt: (p) => Math.max(0.36, wash(p.x, p.y, p.z)) });
	// Leather belt.
	b.loft([at(35.5, -0.2, LEATHER, 0.7), at(35.5, 0.22, LEATHER, 0.9), at(36.9, 0.22, LEATHER), at(36.95, -0.25, LEATHER, 0.8)], { seg, weightAt: (p) => seatWeights(Math.max(p.y, 35.6), p.z) });
	if (b.lod === 2) return;
	const pel = bone('pelvis');
	// Brass buckle: frame, dark opening, prong.
	b.box([5.05 + full, 36.2, 0], [0.4, 1.75, 2.3], { w: pel, pal: THREAD });
	if (b.lod === 1) return;
	b.box([5.22, 36.2, 0.1], [0.16, 1.05, 1.5], { w: pel, pal: LEATHER, shade: 0.75 });
	b.box([5.32, 36.2, -0.2], [0.14, 0.26, 1.7], { w: pel, pal: THREAD });
	// Belt loops.
	for (const [z, dir] of [[3.6, 1], [-3.6, 1], [4.2, -1], [-4.2, -1], [0, -1]] as const) {
		const x = hipX(36.2, z, dir) + dir * 0.18;
		b.box([x, 36.2, z], [0.4, 1.95, 0.75], { w: seatWeights(36.2, z), pal: DENIM, shade: 0.5, rot: [0, dir * z * 0.05, 0] });
	}
	// Fly stitching: down, then curving to the middle.
	thread(
		b,
		[[35.3, 1.2], [34, 1.2], [33, 1.0], [32.3, 0.55], [32, 0]].map(([y, z]) => ({ p: new THREE.Vector3(hipX(y!, z!, 1) + 0.02, y!, z!), w: seatWeights(y!, z!) })),
		0.11
	);
	for (const s of SIDES) {
		const out = sideSign(s);
		// Front pocket opening, scooped from the belt to the outer seam.
		const scoop = [[35.3, 3.5], [34.4, 3.9], [33.6, 4.8], [33, 5.9], [32.7, 7]].map(([y, z]) => ({
			p: new THREE.Vector3(hipX(y!, z!, 1) + 0.03, y!, out * z!),
			w: y! > 34 ? seatWeights(y!, out * z!) : legWeights(s, y!)
		}));
		thread(b, scoop, 0.12);
		buildBackPocket(b, s);
	}
}

/** Back pocket: a five-sided patch with a stitched border. */
function buildBackPocket(b: PartBuilder, s: Side): void {
	const z0 = sideSign(s) * 4.15;
	const top = 34;
	const bottom = 29.6;
	// Outline from the top, anticlockwise: [side, height].
	const outline: readonly (readonly [number, number])[] = [[0, 1], [1, 1], [0.96, 0.4], [0.9, -0.55], [0, -1], [-0.9, -0.55], [-0.96, 0.4], [-1, 1]];
	const cy = (top + bottom) / 2;
	const layer = (k: number, d: number, pal: number): [number, number, number] => [k, d, pal];
	const layers = [layer(1, -0.35, DENIM), layer(1, 0.3, DENIM), layer(0.9, 0.36, THREAD), layer(0.82, 0.37, DENIM)];
	const rings = layers.map(([k, d, pal], i): Ring => ({ c: [-5 - i * 0.2, cy, z0], f: k, s: k, w: bone('pelvis'), pal, shade: d < 0 ? 0.8 : 1 }));
	b.loft(rings, {
		seg: 8,
		u: [0, 1, 0],
		v: [0, 0, 1],
		capEnd: true,
		deform: (p, _t, a, i) => {
			const [k, d] = layers[i]!;
			const [oz, oy] = outline[Math.round((a / (Math.PI * 2)) * 8) % 8]!;
			p.y = cy + oy * ((top - bottom) / 2) * k!;
			p.z = z0 + oz * 2.1 * k!;
			p.x = hipX(p.y, p.z, -1) - d!;
		},
		weightAt: (p) => legWeights(s, p.y),
		shadeAt: (p, _a, i) => (i === 2 ? 1 : Math.max(0.46, wash(p.x, p.y, p.z)))
	});
}

registerItemMesh('bottom_jeans', {
	hides: ['shins'],
	colors: [0x7492c6, 0xa9bfdb, 0x6f4426, 0xe08f3c],
	build(b) {
		buildHips(b);
		for (const s of SIDES) buildLegOf(b, s);
	}
});
