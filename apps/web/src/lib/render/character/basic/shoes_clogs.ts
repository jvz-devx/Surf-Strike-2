/** Garden clogs: one chunky piece of foam with holes on top and a heel strap, over a plain sock. */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, superellipse, type PartBuilder, type Ring } from '../mesh-kit.js';
import { shoeWeights } from '../outfit.js';
import { shaft, SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

const FOAM = PAL.shoesA;
const SOLE = PAL.shoesB;
const SOCK = PAL.shoesC;
const HOLE = PAL.shoesD;

/** Foam: x, half width, top. Low around the heel, the sock stands out of it. */
const SHAPE: readonly (readonly number[])[] = [
	[-4.75, 1.4, 2.5],
	[-4.4, 2.1, 2.85],
	[-3, 2.6, 2.95],
	[-1, 2.6, 3.1],
	[0.2, 2.6, 3.7],
	[1.1, 2.62, 4.75],
	[1.7, 2.68, 5.15],
	[2.6, 2.8, 5],
	[4, 3.02, 4.55],
	[5.4, 3.1, 4.05],
	[6.8, 2.85, 3.5],
	[7.9, 2.15, 2.9],
	[8.5, 1.3, 2.3]
];
/** Sock inside it: x, half width, top. */
const FOOT: readonly (readonly number[])[] = [
	[-4.3, 1.1, 3.4],
	[-3.9, 1.75, 4.5],
	[-2.6, 2.15, 5.2],
	[-0.6, 2.2, 5.3],
	[1.2, 2.2, 4.7],
	[2.6, 2.1, 4]
];
const N = 2.9;
const LO = 0.7;

function buildClog(b: PartBuilder, s: Side): void {
	const side = sideSign(s);
	const z0 = BIND[`foot${s}`][2] + side * 0.15;
	const zAt = (x: number) => z0 - side * 0.45 * smooth(0, 8, x);
	const xs = b.pick(SHAPE.map((r) => r[0]!), [-4.7, -3.6, -0.6, 1.5, 4, 6.6, 8.4], [-4.6, 0, 1.8, 5.2, 8.2]);
	const section = (x: number, lo: number, top: number, hw: number, n: number): Ring => ({ c: [x, (lo + top) / 2, zAt(x)], f: (top - lo) / 2, s: hw, n, w: shoeWeights(s, x) });
	const along = { u: [0, 1, 0] as [number, number, number], v: [0, 0, 1] as [number, number, number], capStart: true, capEnd: true };
	b.loft(
		xs.map((x) => {
			const [, hw, top] = sample(SHAPE, x) as [number, number, number];
			return section(x, LO, top, hw, N);
		}),
		{ ...along, seg: b.pick(14, 7, 6), pal: FOAM, shadeAt: (p) => lerp(0.8, 1, smooth(1, 2.8, p.y)) }
	);
	b.loft(
		xs.map((x, i) => {
			const lift = x > 6 ? (x - 6) * 0.16 : 0;
			const end = i === 0 ? -0.15 : i === xs.length - 1 ? 0.15 : 0;
			return { ...section(x, lift, lift + 1.2, sample(SHAPE, x)[1]! + 0.16, 4), c: [x + end, lift + 0.6, zAt(x)] };
		}),
		{ ...along, seg: b.pick(10, 5, 4), pal: SOLE }
	);
	// Sock: foot and ankle.
	b.loft(b.pick(FOOT, [FOOT[0]!, FOOT[2]!, FOOT[3]!, FOOT[5]!], [FOOT[0]!, FOOT[2]!, FOOT[5]!]).map(([x, hw, top]) => section(x!, 1.4, top!, hw!, 2.4)), { ...along, seg: b.pick(9, 6, 5), pal: SOCK });
	shaft(
		b,
		s,
		b.pick(
			[
				[3.6, 3.4, 2.45, 2.15],
				[4.8, 3.1, 2.25, 2.25],
				[6.2, 2.95, 2.25, 2.35],
				[8, 2.75, 2.35, 2.35]
			],
			[
				[3.6, 3.4, 2.45, 2.2],
				[5.2, 3.15, 2.3, 2.35],
				[8, 2.85, 2.4, 2.4]
			],
			[
				[3.6, 3.7, 2.5, 2.5],
				[5.2, 3.5, 2.5, 2.6],
				[8, 3.1, 2.6, 2.6]
			]
		),
		{ shaft: SOCK, top: SOCK, inner: SOCK }
	);
	if (b.lod === 2) return;

	// Heel strap from pivot to pivot.
	const n = b.pick(12, 5, 4);
	const rows = Array.from({ length: n + 1 }, (_, i) => {
		const a = lerp(-1, 1, i / n) * (Math.PI / 2);
		const [c, e] = superellipse(a, 2.5);
		const y = 3.9 + 0.35 * Math.sin(Math.max(0, c) * 1.5);
		return ([[0, -0.42], [0.3, -0.42], [0.3, 0.42], [0, 0.42]] as const).map(([o, h]) => new THREE.Vector3(1 - (5.35 + o) * c, y + h, z0 + (2.95 + o) * e));
	});
	b.grid(rows, { w: shoeWeights(s, 0), pal: FOAM, wrap: true, flip: true, shadeAt: () => 0.88 });
	for (const k of [1, -1]) b.ball([1.15, 3.9, z0 + k * 3.05], [0.6, 0.6, 0.28], { w: shoeWeights(s, 1), pal: SOLE, seg: b.pick(8, 4, 4), rings: b.pick(4, 3, 3) });
	if (b.lod > 0) return;

	// Holes: dark discs on the top of the foam.
	const on = (x: number, z: number): THREE.Vector3 => {
		const [, hw, top] = sample(SHAPE, x) as [number, number, number];
		const a = Math.sign(z) * Math.asin(Math.min(1, Math.abs(z) / hw) ** (N / 2));
		return new THREE.Vector3(x, (top + LO) / 2 + ((top - LO) / 2 + 0.04) * superellipse(a, N)[0], zAt(x) + z);
	};
	for (const [x, zs] of [[3.2, [-1.15, 0, 1.15]], [4.4, [-1.65, -0.55, 0.55, 1.65]], [5.6, [-1.15, 0, 1.15]]] as const)
		for (const z of zs) {
			const edge = (r: number) => Array.from({ length: 7 }, (_, j) => on(x + Math.cos((j / 7) * Math.PI * 2) * r, z + Math.sin((j / 7) * Math.PI * 2) * r));
			b.grid([edge(0.32), edge(0.01)], { w: shoeWeights(s, x), pal: HOLE, wrap: true, flip: true });
		}
}

registerItemMesh('shoes_clogs', {
	colors: [0x7cb342, 0x5f9132, 0xf1efe8, 0x2c4418],
	build(b) {
		for (const s of SIDES) buildClog(b, s);
	}
});
