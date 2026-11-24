/** Polished oxfords: black cap-toe shoes with closed lacing, a thin welt and a low stacked heel. */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, superellipse, type PartBuilder, type Ring } from '../mesh-kit.js';
import { shoeWeights } from '../outfit.js';
import { shaft, SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

const LEATHER = PAL.shoesA;
const SOLE = PAL.shoesB;
const WELT = PAL.shoesC;
const LACE = PAL.shoesD;

/** Upper: x, half width, top y, centre shift. Long and lean with an almond toe. */
const VAMP: readonly (readonly number[])[] = [
	[-4.4, 1.2, 3.4, 0],
	[-4.05, 1.8, 4.4, 0],
	[-2.8, 2.2, 5, 0],
	[-0.8, 2.22, 5.1, 0],
	[0.6, 2.2, 4.75, -0.02],
	[2, 2.3, 4.1, -0.1],
	[3.4, 2.42, 3.5, -0.2],
	[4.7, 2.45, 3.06, -0.28],
	[5.7, 2.32, 2.86, -0.34],
	[6.9, 1.95, 2.62, -0.42],
	[7.9, 1.35, 2.25, -0.5],
	[8.6, 0.75, 1.85, -0.52],
	[8.85, 0.35, 1.6, -0.52]
];
const CAP = 5.4;
const OUTSOLE = 0.4;
const N = 2.5;
const base = (x: number): number => 0.8 * (1 - smooth(-1.6, 1.6, x)) + (x > 5.8 ? (x - 5.8) * 0.13 : 0);

/** Mirror polish: black leather with light along the toe cap, the sides and the heel. */
function polish(x: number, up: number): number {
	const g = (v: number, m: number, w: number) => Math.exp(-(((v - m) / w) ** 2));
	const cap = 1.1 * g(x, 6.7, 0.6) * g(up, 0.75, 0.28);
	const vamp = 0.4 * g(x, 4.7, 0.45) * g(up, 0.75, 0.3);
	const side = 0.3 * g(up, 0.12, 0.22) * g(x, 1.2, 2.6);
	const heel = 0.5 * g(x, -3.3, 0.8) * g(up, 0.35, 0.35);
	return 0.15 + cap + vamp + side + heel;
}

function buildOxford(b: PartBuilder, s: Side): void {
	const side = sideSign(s);
	const z0 = BIND[`foot${s}`][2] + side * 0.15;
	const zAt = (x: number) => z0 + side * sample(VAMP, x)[3]!;
	const xs = b.pick(VAMP.map((r) => r[0]!), [-4.4, -3.4, -0.6, 2.2, CAP, 6.6, 8, 8.8], [-4.4, -0.4, 4.6, 8.5]);
	const shape = (x: number) => {
		const [, hw, top] = sample(VAMP, x) as [number, number, number, number];
		const lo = base(x) + OUTSOLE;
		return { y: (top + lo) / 2, f: (top - lo) / 2, s: hw };
	};
	/** Point of the upper at angle `a` (0 top), `out` off it. */
	const on = (x: number, a: number, out: number): THREE.Vector3 => {
		const u = shape(x);
		const [c, k] = superellipse(a, N);
		return new THREE.Vector3(x, u.y + (u.f + out) * c, zAt(x) + (u.s + out) * k);
	};
	b.loft(
		xs.map((x): Ring => {
			const u = shape(x);
			return { c: [x, u.y, zAt(x)], f: u.f, s: u.s, n: N, w: shoeWeights(s, x) };
		}),
		{
			seg: b.pick(16, 8, 5),
			u: [0, 1, 0],
			v: [0, 0, 1],
			pal: LEATHER,
			capStart: true,
			capEnd: true,
			shadeAt: (p, a) => polish(p.x, Math.cos(a))
		}
	);
	// Outsole and welt, then the heel.
	const slab = (y0: number, y1: number, grow: number, pal: number, shade: number) =>
		b.loft(
			xs.map((x, i): Ring => {
				const end = i === 0 ? -0.2 : i === xs.length - 1 ? 0.2 : 0;
				return { c: [x + end, base(x) + (y0 + y1) / 2, zAt(x)], f: (y1 - y0) / 2, s: sample(VAMP, x)[1]! + grow * (end ? 0.55 : 1), n: 6, w: shoeWeights(s, x), shade };
			}),
			{ seg: b.pick(6, 5, 4), u: [0, 1, 0], v: [0, 0, 1], pal, capStart: true, capEnd: true }
		);
	slab(0, OUTSOLE, 0.16, SOLE, 1);
	if (b.lod === 0) slab(OUTSOLE, OUTSOLE + 0.12, 0.2, WELT, 1);
	const heel = (y: number, grow: number, shade: number): Ring => ({ c: [-2.85, y, z0], f: 1.4 + grow, b: 1.5 + grow, s: 2 + grow, n: 2.9, w: shoeWeights(s, -2.8), shade });
	b.loft(b.pick([heel(0, 0, 0.7), heel(0.95, 0.14, 1.2)], [heel(0, 0, 0.7), heel(0.95, 0.14, 1)], [heel(0, 0, 0.8), heel(0.95, 0.14, 1)]), { seg: b.pick(12, 7, 5), pal: SOLE, capStart: true, capEnd: true });
	// Topline and a fine black sock.
	shaft(b, s, b.lod === 2 ? [[3.4, 3.1, 2.5, 2.1], [7, 2.4, 2.3, 2.2]] : [[3.2, 3.1, 2.5, 2.1], [4.7, 2.75, 2.2, 2.2], [5.35, 2.9, 2.2, 2.25], [5.4, 2.7, 2.1, 2.15], [8, 2.65, 2.35, 2.35]], { shaft: SOLE, top: SOLE, inner: SOLE });
	if (b.lod === 2) return;

	/** Band over the upper: `mid(a)` its middle, `wide` its half width. */
	const band = (as: readonly number[], mid: (a: number) => number, wide: number, h: number, shade: number, pal: number = LEATHER) =>
		b.grid(as.map((a) => [[-1, 0], [-0.8, h], [0.8, h], [1, 0]].map(([k, d]) => on(mid(a) + k! * wide, a, d!))), { w: shoeWeights(s, mid(0)), pal, shadeAt: (p) => shade * lerp(0.55, 1, smooth(1.4, 2.8, p.y)) });
	// Cap seam, and the seam of the facing curving down to the sole.
	const fan = b.pick([-1.95, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 1.95], [-1.9, -0.8, 0, 0.8, 1.9], []);
	band(fan, (a) => CAP - 0.1 * a * a, 0.16, 0.13, 0.75);
	if (b.lod === 1) return;
	band(fan, (a) => CAP - 0.42 - 0.1 * a * a, 0.06, 0.07, 0.55, WELT);
	band([-1.95, -1.6, -1.2, -0.8, -0.45, 0, 0.45, 0.8, 1.2, 1.6, 1.95], (a) => 4.4 - 2.6 * smooth(0.4, 2, Math.abs(a)), 0.11, 0.1, 0.8);
	// Closed lacing: two facings meeting in a slit, with flat laces across.
	const facing = [0.8, 1.6, 2.5, 3.3, 4.1];
	for (const k of [1, -1]) {
		const cols = k > 0 ? [0.05, 0.12, 0.6, 0.68] : [-0.68, -0.6, -0.12, -0.05];
		b.grid(facing.map((x) => cols.map((a, j) => on(x, a, j === 0 || j === 3 ? 0.02 : 0.12)).reverse()).reverse(), { w: shoeWeights(s, 1.4), pal: LEATHER, flip: false, shadeAt: (_p, i) => 0.34 + 0.04 * i });
	}
	for (let i = 0; i < 5; i++) {
		const x = 1.5 + i * 0.55;
		const p = on(x, 0, 0.16);
		b.box([p.x, p.y, p.z], [0.22, 0.16, 1.6 - i * 0.1], { w: shoeWeights(s, x), pal: LACE, rot: [0, 0, -0.5] });
	}
	// Bow.
	const bow = on(1.15, 0, 0.22);
	for (const k of [1, -1]) b.ball([bow.x - 0.1, bow.y, bow.z + k * 0.6], [0.24, 0.12, 0.5], { w: shoeWeights(s, 0), pal: LACE, seg: 6, rings: 4, rot: [k * 0.35, k * 0.35, 0] });
}

registerItemMesh('shoes_suit', {
	// Leather, sole and sock, welt, laces.
	colors: [0x6b707b, 0x17181b, 0x2b231d, 0x33363d],
	build(b) {
		for (const s of SIDES) buildOxford(b, s);
	}
});
