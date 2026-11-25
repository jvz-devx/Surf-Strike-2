/** Monster feet: oversized plush paws with layers of shaggy fur, fat toes, ivory claws and pink pads underneath. */
import * as THREE from 'three';
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { shoeWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

const FUR = PAL.shoesA;
const DARK = PAL.shoesB;
const IVORY = PAL.shoesC;
const PINK = PAL.shoesD;

/**
 * The paw from the sole up to the ankle: row; front x, y; side y; inner and
 * outer half width; back x, y. It bulges outwards: the inner sides pass close
 * to each other when running.
 */
const ROWS: readonly (readonly number[])[] = [
	[0, 7.0, 0.5, 0.5, 2.55, 4.2, 4.9, 0.5],
	[1, 7.3, 1.7, 1.7, 3.0, 4.7, 5.5, 1.7],
	[2, 6.6, 3.3, 3.0, 3.5, 4.6, 5.5, 3.2],
	[3, 5.0, 4.6, 4.2, 3.6, 4.3, 5.0, 4.5],
	[4, 3.7, 5.5, 5.5, 3.6, 3.9, 4.35, 5.7]
];

const TAU = Math.PI * 2;
const hash = (n: number): number => {
	const v = Math.sin(n * 12.9898 + 4.1) * 43758.5453;
	return v - Math.floor(v);
};

/** Dark tufts: about every fourth. */
const spotted = (k: number): boolean => k % 4 === 2 || k % 13 === 4;

/** Point of the paw at a (fractional) row and an angle: 0 in front, π/2 to the right. */
function at(p: THREE.Vector3, s: Side, row: number, a: number, off = 0): void {
	const [, fx, fy, sy, zi, zo, bx, by] = sample(ROWS, row) as [number, number, number, number, number, number, number, number];
	const c = Math.cos(a);
	const n = Math.sin(a);
	const side = sideSign(s);
	const outer = n * side > 0;
	const x = c > 0 ? (fx + off) * c ** 0.72 : -(bx + off) * Math.abs(c) ** 0.85;
	// Wide at the toes, narrow at the heel.
	const wide = lerp(0.9, 1.02, smooth(-4, 4, x));
	const z = Math.sign(n) * Math.abs(n) ** 0.8 * ((outer ? zo : zi) + off * (outer ? 1 : 0.35)) * wide;
	p.set(x, lerp(sy, c > 0 ? fy : by, Math.abs(c) ** 1.6), BIND[`foot${s}`][2] + z);
}

interface Coat {
	/** Number of tufts. */
	n: number;
	/** Rows of the roots, the bulge and the tips. */
	rows: readonly [number, number, number];
	/** How far the bulge and the tips stand out. */
	out: readonly [number, number];
	seed: number;
	weights: (p: THREE.Vector3) => Weights;
}

/** One layer of fur: a skirt that ends in a jagged line of tufts. */
function coat(b: PartBuilder, s: Side, o: Coat): void {
	const seg = o.n * 2;
	const [root, bulge, tip] = o.rows;
	const phase = hash(o.seed + (s === 'R' ? 0.3 : 0)) * (TAU / o.n);
	const p3 = b.lod === 2 ? 1 : 2;
	b.loft(
		Array.from({ length: p3 + 1 }, (_, i): Ring => ({ c: [0, -i, 0], f: 1, s: 1, w: [] })),
		{
			seg,
			pal: FUR,
			palAt: (_i, a) => (spotted(Math.floor((a / TAU) * o.n) + o.seed) ? DARK : FUR),
			deform: (p, _t, a, i) => {
				const j = Math.round((a / TAU) * seg);
				const isTip = j % 2 === 1;
				const r = hash(Math.floor(j / 2) + o.seed * 91);
				const th = a + phase + (isTip && i === p3 ? (r - 0.5) * (TAU / o.n) * 0.7 : 0);
				if (i === 0) at(p, s, root, th, -0.1);
				else if (i < p3) at(p, s, bulge, th, isTip ? o.out[0] : o.out[0] * 0.45);
				else if (isTip) at(p, s, tip - 0.2 + r * 0.4, th, o.out[1] * (0.75 + r * 0.5));
				else at(p, s, lerp(bulge, tip, 0.55), th, o.out[0] * 0.1);
				p.y = Math.max(p.y, 0.15);
			},
			weightAt: (p) => o.weights(p),
			shadeAt: (_p, a, i) => {
				const isTip = Math.round((a / TAU) * seg) % 2 === 1;
				return i === 0 ? 0.85 : i < p3 ? (isTip ? 1.05 : 0.8) : isTip ? 1.14 : 0.66;
			}
		}
	);
}

function buildToe(b: PartBuilder, s: Side, k: number): void {
	const side = sideSign(s);
	const z = BIND[`foot${s}`][2] + side * (1.0 + k * 2.4);
	const x = 7.1 - Math.abs(k) * 0.55;
	const w = shoeWeights(s, x);
	const yaw = -side * k * 0.16;
	const big = k === -1 ? 1.06 : 1;
	b.ball([x, 1.75, z], [2.5, 1.62, 1.42 * big], { w, pal: FUR, seg: b.pick(8, 6, 4), rings: b.pick(5, 3, 3), rot: [0, yaw, 0] });
	// Claw: thick, rounded, hooked over the toe.
	const rows: readonly (readonly [number, number, number, number])[] = b.pick(
		[[1.7, 2.1, 1.0, 0.98], [2.8, 1.85, 1.0, 1.0], [3.65, 1.3, 0.72, 0.7], [4.05, 0.85, 0.28, 0.28]] as const,
		[[1.6, 2.1, 0.9, 0.85], [2.9, 1.8, 0.85, 0.8], [4.0, 0.8, 0.25, 0.25]] as const,
		[[1.8, 2.0, 0.9, 0.9], [4.0, 0.8, 0.3, 0.3]] as const
	);
	const ca = Math.cos(yaw);
	const sa = Math.sin(yaw);
	b.loft(
		rows.map(([d, y, h, hw], i): Ring => ({ c: [x + d * ca, y, z - d * sa], f: h, s: hw, w, shade: i === 0 ? 0.8 : 1 })),
		{ seg: b.pick(6, 5, 3), u: [0, 1, 0], v: [sa, 0, ca], pal: IVORY, capEnd: true }
	);
	if (b.lod > 0) return;
	// Cuticle of fur over the claw.
	for (const t of [-0.55, 0.55])
		b.loft(
			[[1.0, 2.75, 0.55], [2.0, 2.95, 0.36], [2.75, 2.5, 0.02]].map(([d, y, r], i): Ring => ({ c: [x + d! * ca + t * sa, y!, z - d! * sa + t * ca], f: r!, s: r! * 1.2, w, shade: 0.9 + i * 0.1 })),
			{ seg: 3, u: [0, 1, 0], v: [sa, 0, ca], pal: k === 0 ? DARK : FUR }
		);
}

function buildPad(b: PartBuilder, s: Side, x: number, dz: number, rx: number, rz: number, seg: number): void {
	const z = BIND[`foot${s}`][2] + sideSign(s) * dz;
	b.loft(
		[[0.4, 1], [0.02, 0.85]].map(([y, r]): Ring => ({ c: [x, y!, z], f: rx * r!, s: rz * r!, n: 2.4, w: [] })),
		{ seg, pal: PINK, capEnd: true, weightAt: (p) => shoeWeights(s, p.x) }
	);
}

function buildPaw(b: PartBuilder, s: Side): void {
	const z0 = BIND[`foot${s}`][2];
	const paw = (p: THREE.Vector3): Weights => shoeWeights(s, p.x);
	// Body under the fur; the top closes inside the cuff.
	const rows = b.pick([-0.3, 0.3, 1.6, 3.6, 4.2], [-0.3, 1, 3.2, 4.1], [-0.3, 1.5, 4.1]);
	b.loft(
		rows.map((r, i): Ring => ({ c: [0, r, 0], f: 1, s: 1, w: [], pal: i === 0 || i === rows.length - 1 ? DARK : FUR, shade: i === 0 ? 0.75 : i === rows.length - 1 ? 0.5 : 0.8 })),
		{
			seg: b.pick(12, 8, 6),
			capStart: true,
			capEnd: true,
			deform: (p, _t, a, i) => {
				const r = rows[i]!;
				at(p, s, Math.max(r, 0), a, r < 0 ? -0.5 : r > 4 ? -1 : 0);
				if (r < 0) p.y = 0.12;
				if (r > 4) p.y = 5.2;
			},
			weightAt: paw
		}
	);
	for (const k of [-1, 0, 1]) buildToe(b, s, k);
	// Coat, bottom layer first.
	if (b.lod === 0) coat(b, s, { n: 16, rows: [1.9, 1.2, 0.25], out: [0.4, 0.75], seed: 1, weights: paw });
	coat(b, s, { n: b.pick(15, 9, 7), rows: b.lod === 0 ? [2.9, 2.2, 1.2] : [3.2, 2, 0.5], out: [0.45, 0.8], seed: 2, weights: paw });
	if (b.lod === 0) coat(b, s, { n: 13, rows: [4, 3.2, 2.2], out: [0.45, 0.75], seed: 3, weights: paw });
	// Fluffy cuff round the hem of the trousers: it moves with them.
	const cuff = (top: number, tip: number, r: number, n: number, seed: number, rim = true) => {
		const seg = n * 2;
		const phase = hash(seed) * (TAU / n);
		const prof = b.pick(
			rim ? [[top - 0.8, 2.3], [top, r - 0.35], [(top + tip) / 2, r + 0.25], [tip, r + 0.45]] : [[top - 0.3, r - 0.3], [(top + tip) / 2, r + 0.2], [tip, r + 0.5]],
			[[top - 0.8, 2.3], [top, r - 0.2], [tip, r + 0.5]],
			[[top, r - 0.4], [tip, r + 0.5]]
		) as readonly (readonly [number, number])[];
		const last = prof.length - 1;
		b.loft(
			prof.map(([, rad], i): Ring => ({ c: [0, -i, 0], f: rad, s: rad, w: [], shade: i === 0 && rim ? 0.6 : 1 })),
			{
				seg,
				pal: FUR,
				palAt: (_i, a) => (spotted(Math.floor((a / TAU) * n) + seed) ? DARK : FUR),
				deform: (p, _t, a, i) => {
					const isTip = Math.round((a / TAU) * seg) % 2 === 1;
					const k = hash(Math.floor(((a / TAU) * seg) / 2) + seed * 91);
					const th = a + phase + (isTip && i === last ? (k - 0.5) * 0.25 : 0);
					let [y, rad] = prof[i]!;
					if (i === last) {
						y = isTip ? y - 0.3 + k * 0.6 : y + 1.0;
						rad = isTip ? rad : rad - 0.35;
					} else if (i > 0) {
						y += isTip ? (k - 0.2) * 0.35 : -0.12;
						rad += isTip ? 0.06 : -0.1;
					}
					const c = Math.cos(th);
					p.set(-0.35 + c * rad * (c > 0 ? 1.06 : 1.02), y, z0 + Math.sin(th) * rad);
				},
				weightAt: (p) => legWeights(s, p.y),
				shadeAt: (_p, a, i) => (i === 0 ? 1 : Math.round((a / TAU) * seg) % 2 === 1 ? 1.1 : i === last ? 0.66 : 0.86)
			}
		);
	};
	if (b.lod === 0) cuff(5.9, 3.3, 3.95, 12, 7, false);
	cuff(6.6, b.pick(4.9, 4.2, 4), 3.75, b.pick(11, 7, 6), 5);
	// Furry shaft inside the trousers, torn off in tufts at the top (bare legs show it).
	const sn = b.pick(12, 6, 6);
	const shaftRows = b.pick([4.6, 7, 8.9], [4.6, 8.8], [4.6, 8.6]);
	b.loft(
		shaftRows.map((y, i): Ring => ({ c: [lerp(-0.6, -0.25, smooth(4, 9, y)), y, z0], f: [2.65, 2.7, 2.45][i]!, b: [2.7, 2.7, 2.5][i]!, s: [2.55, 2.6, 2.4][i]!, w: [], shade: [0.75, 0.9, 1.05][i]! })),
		{
			seg: sn,
			pal: FUR,
			palAt: (_i, a) => (Math.floor((a / TAU) * sn + 1) % 6 < 2 && b.lod === 0 ? DARK : FUR),
			capEnd: true,
			deform: (p, _t, a, i) => {
				if (i === shaftRows.length - 1 && Math.round((a / TAU) * sn) % 2) p.y -= 1.3;
			},
			shadeAt: (_p, a, i) => (i > 0 && Math.round((a / TAU) * sn) % 2 ? 0.72 : 1),
			weightAt: (p) => legWeights(s, p.y)
		}
	);
	if (b.lod > 0) return;
	// Paw pads.
	buildPad(b, s, 2.4, 0.8, 2.6, 2.7, 9);
	for (const k of [-1, 0, 1]) buildPad(b, s, 7.2 - Math.abs(k) * 0.55, 1.0 + k * 2.4, 1.0, 0.85, 6);
	// Heel pad.
	buildPad(b, s, -2.9, 0.3, 1.2, 1.4, 6);
}

registerItemMesh('shoes_monster', {
	colors: [0x2f86ff, 0x2a1f7a, 0xf8eed2, 0xff7fae],
	build(b) {
		for (const s of SIDES) buildPaw(b, s);
	}
});
