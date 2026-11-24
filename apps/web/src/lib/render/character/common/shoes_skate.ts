/** Skate shoes: chunky suede, puffy tongue and collar, wide laces, gum cupsole, double-stitched side panel. */
import * as THREE from 'three';
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, superellipse, type PartBuilder, type Ring } from '../mesh-kit.js';
import { shoeWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

const SUEDE = PAL.shoesA;
const GUM = PAL.shoesB;
const LACE = PAL.shoesC;
const DARK = PAL.shoesD;

/** x, half width, top of the upper. */
const SHAPE: readonly (readonly number[])[] = [
	[-4.5, 1.5, 3.5],
	[-4.1, 2.15, 4.7],
	[-2.8, 2.6, 5.3],
	[-0.6, 2.62, 5.4],
	[0.8, 2.6, 5.05],
	[2.1, 2.7, 4.5],
	[3.5, 2.88, 4],
	[4.9, 3, 3.65],
	[6.3, 2.85, 3.35],
	[7.4, 2.3, 3],
	[8.1, 1.5, 2.6],
	[8.4, 0.8, 2.2]
];
const N = 2.7;
const SOLE_H = 1.75;

function buildSkate(b: PartBuilder, s: Side): void {
	const side = sideSign(s);
	const z0 = BIND[`foot${s}`][2] + side * 0.15;
	const zAt = (x: number) => z0 - side * 0.42 * smooth(0, 8, x);
	const xs = b.pick(SHAPE.map((r) => r[0]!), [-4.5, -3.6, -0.6, 2.1, 4.9, 7.2, 8.3], [-4.4, -0.4, 4.8, 8.2]);
	const lo = 1;
	const at = (x: number, a: number, out: number): THREE.Vector3 => {
		const [, hw, top] = sample(SHAPE, x) as [number, number, number];
		const [c, k] = superellipse(a, N);
		return new THREE.Vector3(x, (top + lo) / 2 + ((top - lo) / 2 + out) * c, zAt(x) + (hw * 0.97 + out) * k);
	};
	b.loft(
		xs.map((x): Ring => {
			const [, hw, top] = sample(SHAPE, x) as [number, number, number];
			return { c: [x, (top + lo) / 2, zAt(x)], f: (top - lo) / 2, s: hw * 0.97, n: N, w: shoeWeights(s, x) };
		}),
		{
			seg: b.pick(16, 8, 5),
			u: [0, 1, 0],
			v: [0, 0, 1],
			pal: SUEDE,
			capStart: true,
			capEnd: true,
			// Brushed suede: soft uneven nap.
			shadeAt: (p, a, i) => lerp(0.82, 1, smooth(1.6, 3, p.y)) * (b.lod === 0 ? 1 + 0.05 * Math.sin(a * 7 + i * 2.3) : 1)
		}
	);
	// Gum cupsole with a groove; the toe springs up a little.
	const sole: readonly (readonly [number, number, number, number?])[] = b.pick(
		[[0, 0.22, GUM, 0.75], [0.12, 0.34, GUM], [0.62, 0.38, GUM], [0.68, 0.26, GUM, 0.6], [0.78, 0.36, GUM], [0.97, 0.34, GUM], [1, -0.8, GUM, 0.8]],
		[[0, 0.25, GUM, 0.8], [0.65, 0.38, GUM], [0.98, 0.34, GUM], [1, -0.8, GUM, 0.8]],
		[[0, 0.3, GUM], [0.98, 0.35, GUM], [1, -0.8, GUM]]
	);
	const around = b.pick(24, 14, 8);
	b.loft(
		sole.map(([, , pal, shade], i): Ring => ({ c: [0, i, 0], f: 1, s: 1, w: shoeWeights(s, 0), pal, shade })),
		{
			seg: around,
			capStart: true,
						deform: (p, _t, a, i) => {
				const [k, grow] = sole[i]!;
				const [c, e] = superellipse(a, 2.8);
				const x = 1.95 + 6.45 * c;
				const w = sample(SHAPE, Math.max(-2.8, Math.min(6.3, x)))[1]!;
				const spring = 0.32 * smooth(5.4, 8.4, x);
				p.set(x + grow * Math.sign(c) * Math.abs(c), spring + k * (SOLE_H + 0.45 * smooth(5.8, 8.2, x) - spring * 0.5), zAt(x) + (w + grow) * e);
			},
			weightAt: (p) => shoeWeights(s, p.x)
		}
	);
	// Puffy collar and a short sock; weights of the trousers.
	const ring = (y: number, f: number, back: number, r: number, pal: number, shade = 1): Ring => ({ c: [lerp(-1.1, -0.4, smooth(4, 9, y)), y, z0], f, b: back, s: r, w: legWeights(s, y), pal, shade });
	const collar = [
		ring(3.6, 3.3, 2.4, 2.25, SUEDE),
		ring(4.8, 3, 2.1, 2.4, SUEDE),
		ring(5.2, 2.9, 2.14, 2.46, DARK),
		ring(5.8, 2.75, 2.18, 2.48, DARK),
		ring(6.05, 2.6, 2.05, 2.3, DARK, 0.85),
		ring(5.95, 2.6, 1.95, 2.15, LACE, 0.8),
		ring(7.2, 2.65, 2.2, 2.25, LACE),
		ring(7.2, 2.3, 1.9, 1.9, LACE, 0.7),
		ring(6, 1.5, 1.5, 1.5, DARK, 0.5)
	];
	b.loft(b.pick(collar, [0, 2, 3, 5, 6, 8].map((i) => collar[i]!), [0, 3, 6, 8].map((i) => collar[i]!)), { seg: b.pick(12, 8, 5) });
	if (b.lod === 2) return;

	// Puffy tongue above the laces.
	const tongue = (x: number, y: number, f: number, r: number, shade = 1): Ring => ({ c: [x, y, zAt(1)], f, s: r, n: 2.6, w: legWeights(s, Math.min(6, y)), shade });
	b.loft(b.pick([tongue(2.3, 4.3, 0.45, 1.15), tongue(1.9, 5.1, 0.62, 1.35), tongue(1.75, 5.9, 0.72, 1.5), tongue(1.75, 6.6, 0.66, 1.45, 1.05), tongue(1.75, 7, 0.35, 1.1, 0.9)], [tongue(2.2, 4.4, 0.5, 1.2), tongue(1.75, 6, 0.75, 1.5), tongue(1.75, 6.9, 0.4, 1.2)], []), { seg: b.pick(10, 6, 4), pal: DARK, capEnd: true, capStart: true });
	if (b.lod === 1) return;
	b.box([2.46, 6.15, zAt(1)], [0.1, 0.75, 1.5], { w: legWeights(s, 6), pal: SUEDE, rot: [0, 0, 0.02] });

	/** Panel on the upper between angles. */
	const panel = (pts: readonly (readonly (readonly [number, number])[])[], k: number, out: number, pal: number, shade = 1) => {
		const rows = pts.map((r) => r.map(([x, a]) => at(x, a * k, out)));
		b.grid(rows, { w: shoeWeights(s, pts[0]![0]![0] * 0.5 + pts[pts.length - 1]![0]![0] * 0.5), pal, flip: k < 0, shadeAt: () => shade });
	};
	/** Stitches along a line of [x, angle]. */
	const stitches = (from: readonly [number, number], to: readonly [number, number], n: number, k: number, out = 0.18) => {
		for (let i = 0; i < n; i++) {
			const p = (t: number) => at(lerp(from[0], to[0], t), lerp(from[1], to[1], t) * k, out);
			const c0 = p((i + 0.15) / n);
			const c1 = p((i + 0.8) / n);
			const d = c1.clone().sub(c0).normalize();
			const nrm = at(lerp(from[0], to[0], (i + 0.5) / n), lerp(from[1], to[1], (i + 0.5) / n) * k, 1).sub(p((i + 0.5) / n));
			const w = d.clone().cross(nrm).normalize().multiplyScalar(0.06);
			b.grid([[c0.clone().sub(w), c0.clone().add(w)], [c1.clone().sub(w), c1.clone().add(w)]], { w: shoeWeights(s, c0.x), pal: LACE });
		}
	};
	for (const k of [1, -1]) {
		// Heel counter, dark eyestay.
		panel([[-3.9, 0.9], [-3.4, 0.9], [-2.6, 0.9]].map(([x]) => [1.1, 1.4, 1.75, 2].map((a) => [x! + (a - 1.1) * 0.9 * (x! > -3 ? 1 : 0), a] as const)), k, 0.1, DARK);
		panel([0.75, 1.6, 2.5, 3.4, 4.2].map((x) => [[x, 0.34], [x, 0.62]] as const), k, 0.16, DARK);
		// Side panel: three straight double-stitched lines from the laces to the sole.
		for (const [x0, x1] of [[1.1, -0.9], [2.3, 0.6]] as const) {
			stitches([x0, 0.72], [x1, 1.85], 6, k);
			stitches([x0 + 0.34, 0.72], [x1 + 0.34, 1.85], 6, k);
		}
		// Toe cap seam.
		stitches([4.75, 0.05], [5.25, 0.8], 4, k);
		stitches([5.25, 0.8], [4.2, 1.85], 5, k);
	}
	// Wide flat laces.
	for (let i = 0; i < 5; i++) {
		const x = 1.15 + i * 0.75;
		const y = sample(SHAPE, x)[2]!;
		b.box([x, y + 0.12, zAt(x)], [0.5, 0.26, 2.5], { w: shoeWeights(s, x), pal: LACE, rot: [0, (i % 2 ? 1 : -1) * 0.12, -0.38] });
	}
}

registerItemMesh('shoes_skate', {
	colors: [0x55705f, 0xc08548, 0xf2ead8, 0x27302d],
	build(b) {
		for (const s of SIDES) buildSkate(b, s);
	}
});
