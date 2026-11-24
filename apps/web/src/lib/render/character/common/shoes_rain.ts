/** Rain boots: glossy green rubber boots with a chunky cream sole, yellow top rim and pull loops. */
import * as THREE from 'three';
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, type PartBuilder, type Ring } from '../mesh-kit.js';
import { shoeWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

const RUBBER = PAL.shoesA;
const SOLE = PAL.shoesB;
const RIM = PAL.shoesC;
const INNER = PAL.shoesD;

/** Foot: x, half width, top y, centre shift. A full, round toe. */
const FOOT: readonly (readonly number[])[] = [
	[-4.25, 1.2, 2.7, 0],
	[-3.9, 1.95, 3.35, 0],
	[-2.7, 2.35, 4.5, 0],
	[-0.6, 2.4, 5.4, 0],
	[1.2, 2.4, 4.9, -0.05],
	[3, 2.6, 4.2, -0.15],
	[4.8, 2.8, 3.85, -0.25],
	[6.3, 2.65, 3.55, -0.32],
	[7.5, 2.1, 3.05, -0.4],
	[8.2, 1.4, 2.5, -0.42],
	[8.5, 0.6, 2.1, -0.42]
];
/** Shaft: y, front, back, sideways, centre x. Wide and straight. */
const SHAFT: readonly (readonly number[])[] = [
	[3, 3.5, 2.5, 2.15, -1.1],
	[4.2, 3.25, 2.3, 2.35, -1.1],
	[5.4, 2.9, 2.35, 2.45, -0.95],
	[6.8, 2.65, 2.45, 2.5, -0.65],
	[8.4, 2.62, 2.6, 2.6, -0.4],
	[10.4, 2.7, 2.75, 2.7, -0.3],
	[11.5, 2.72, 2.8, 2.72, -0.3]
];
const TOP = 11.5;
const RIM_FROM = 10.55;
/** Bottom of the sole: raised arch in front of the heel, toe spring. */
const base = (x: number): number => 0.55 * Math.exp(-(((x + 0.4) / 0.9) ** 2)) + (x > 5.8 ? (x - 5.8) * 0.16 : 0);
const soleTop = (x: number): number => lerp(1.75, 1.45, smooth(-2, 4, x)) + 0.35 * smooth(5.5, 8, x);

function buildBoot(b: PartBuilder, s: Side): void {
	const side = sideSign(s);
	const z0 = BIND[`foot${s}`][2] + side * 0.15;
	const zAt = (x: number) => z0 + side * sample(FOOT, x)[3]!;
	const xs = b.pick(FOOT.map((r) => r[0]!), [-4.2, -3, -0.6, 2, 4.8, 7, 8.4], [-4.2, -0.4, 4.6, 8.2]);

	// Foot: wet-looking highlights along the instep and on the toe.
	b.loft(
		xs.map((x): Ring => {
			const [, hw, top] = sample(FOOT, x) as [number, number, number, number];
			const lo = base(x) + 0.5;
			return { c: [x, (top + lo) / 2, zAt(x)], f: (top - lo) / 2, s: hw, n: 2.4, w: shoeWeights(s, x) };
		}),
		{
			seg: b.pick(12, 7, 5),
			u: [0, 1, 0],
			v: [0, 0, 1],
			pal: RUBBER,
			capStart: true,
			capEnd: true,
			shadeAt: (p, a) => lerp(0.72, 1, smooth(1.4, 3, p.y)) * (b.lod === 0 && Math.abs(Math.atan2(Math.sin(a - side * 0.52), Math.cos(a - side * 0.52))) < 0.25 && p.x > 2.5 && p.x < 7.8 ? 1.27 : 0.82)
		}
	);
	// Sole: tread and a wider foxing strip that rises around the toe.
	const slab = (lo: (x: number) => number, hi: (x: number) => number, grow: number, pal: number, shade: number) =>
		b.loft(
			xs.map((x, i): Ring => {
				const end = i === 0 ? -0.25 : i === xs.length - 1 ? 0.28 : 0;
				return { c: [x + end, (lo(x) + hi(x)) / 2, zAt(x)], f: (hi(x) - lo(x)) / 2, s: sample(FOOT, x)[1]! + grow * (end ? 0.7 : 1), n: 7, w: shoeWeights(s, x), shade };
			}),
			{ seg: 8, u: [0, 1, 0], v: [0, 0, 1], pal, capStart: true, capEnd: true }
		);
	if (b.lod === 0) slab(base, (x) => base(x) + 0.5, 0.18, INNER, 0.85);
	slab((x) => base(x) + (b.lod === 0 ? 0.45 : 0), soleTop, 0.34, SOLE, 1);
	// Tread lugs.
	if (b.lod === 0)
		for (const k of [1, -1])
			for (const x of [-3, 2.4, 4.2, 6]) b.box([x, base(x) + 0.36, zAt(x) + k * (sample(FOOT, x)[1]! + 0.2)], [0.75, 0.7, 0.34], { w: shoeWeights(s, x), pal: INNER });

	// Shaft: same weights as the trousers.
	const ring = (y: number, d = 0, pal: number = RUBBER, shade = 1): Ring => {
		const r = sample(SHAFT, y) as [number, number, number, number, number];
		// Coarse trousers are narrower between their corners.
		d -= b.pick(0, 0.1, 0.05);
		return { c: [r[4], y, z0], f: r[1] + d, b: r[2] + d, s: r[3] + d, w: legWeights(s, y), pal, shade };
	};
	const ys = b.pick([3, 4.2, 5.4, 6.8, 8.4, 9.6], [3, 5, 7, 9], [3, 5.4, 7.4]);
	b.loft(
		[
			...ys.map((y) => ring(y)),
			...b.pick([ring(RIM_FROM), ring(RIM_FROM, 0.14, RIM), ring(11.1, 0.15, RIM), ring(TOP, 0.08, RIM), ring(TOP, -0.22, INNER, 0.8), ring(9.8, -0.5, INNER, 0.5)], [ring(RIM_FROM, 0, RIM), ring(RIM_FROM, 0.12, RIM), ring(TOP, 0.1, RIM), ring(10, -0.5, INNER, 0.5)], [ring(RIM_FROM, 0.1, RIM), ring(TOP, 0.1, RIM), ring(10, -0.5, INNER, 0.5)])
		],
		{
			seg: b.pick(16, 8, 5),
			deform:
				b.lod > 0
					? undefined
					: (p, _t, a) => {
							// Two soft folds at the ankle.
							const k = 1 + 0.025 * Math.exp(-(((p.y - 6) / 1.3) ** 2)) * Math.sin(p.y * 2.6 + Math.cos(a));
							p.z = z0 + (p.z - z0) * k;
						},
			// A streak of light down the outer front.
			shadeAt: (p, a) => lerp(0.86, 1, smooth(4, 6.5, p.y)) * (b.lod === 0 && p.y > 5 && p.y < RIM_FROM + 0.1 && Math.abs(a - (side > 0 ? 0.785 : Math.PI * 2 - 0.785)) < 0.1 ? 1.27 : 0.82)
		}
	);
	if (b.lod === 2) return;

	// Pull loops standing on the rim, left and right.
	for (const k of [1, -1]) {
		const n = b.pick(9, 5, 4);
		const tube = Array.from({ length: n }, (_, i) => {
			const t = (i / (n - 1)) * Math.PI;
			const dir = new THREE.Vector3(Math.cos(t), Math.sin(t), 0);
			const c = new THREE.Vector3(-0.3 + Math.cos(t) * 0.95, TOP - 0.55 + Math.sin(t) * 1.45, z0 + k * 2.58);
			return ([[1, 1], [1, -1], [-1, -1], [-1, 1]] as const).map(([u, v]) => c.clone().addScaledVector(dir, u * 0.17).add(new THREE.Vector3(0, 0, v * 0.17)));
		});
		b.grid(tube, { w: legWeights(s, TOP), pal: RIM, wrap: true, flip: false, shadeAt: () => 0.92 });
	}
	if (b.lod === 1) return;
	// Back seam rib, and a strap with a buckle on the outside.
	b.loft([6.6, 8.4, 10.4].map((y): Ring => { const r = ring(y); return { c: [r.c[0] - r.b!, y, z0], f: 0.12, s: 0.2, w: r.w }; }), { seg: 4, pal: RUBBER, capStart: true, capEnd: true, shadeAt: () => 0.8 });
	const strap = (y: number, half: number, off: number, a0: number, a1: number, pal: number, n: number) => {
		const cols = Array.from({ length: n }, (_, i) => {
			const a = side * lerp(a0, a1, i / (n - 1));
			return [-half, half].map((d) => {
				const r = ring(y + d);
				const c = Math.cos(a);
				return new THREE.Vector3(r.c[0] + ((c >= 0 ? r.f : r.b!) + off) * c, y + d, z0 + (r.s + off) * Math.sin(a));
			});
		});
		b.grid(cols, { w: legWeights(s, y), pal, flip: side < 0 });
	};
	strap(9.1, 0.34, 0.1, 0.5, 2.5, INNER, 9);
	strap(9.1, 0.55, 0.16, 1.25, 1.75, RIM, 4);
	strap(9.1, 0.26, 0.2, 1.36, 1.64, INNER, 3);
}

registerItemMesh('shoes_rain', {
	colors: [0x3bb366, 0xf3e9cf, 0xf2bb3d, 0x174a33],
	build(b) {
		for (const s of SIDES) buildBoot(b, s);
	}
});
