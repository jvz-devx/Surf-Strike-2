import * as THREE from 'three';
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { shoeWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

/** Chelsea boots: suede upper (A), welt, outsole and stacked heel (B), elastic and lining (C), stitching and pull loops (D). */

/** Upper: x, half width, top y, centre shift. Long and low with an almond toe. */
const VAMP: readonly (readonly number[])[] = [
	[-4.3, 1.25, 2.6, 0],
	[-3.95, 1.85, 3.15, 0],
	[-2.8, 2.25, 4.2, 0],
	[-0.6, 2.3, 5.75, 0],
	[1.1, 2.3, 5.05, -0.05],
	[2.8, 2.4, 4.05, -0.15],
	[4.6, 2.5, 3.25, -0.25],
	[6.2, 2.25, 2.75, -0.35],
	[7.6, 1.6, 2.3, -0.45],
	[8.4, 0.95, 1.95, -0.5],
	[8.75, 0.4, 1.65, -0.5]
];

/** Shaft: y, front, back, sideways, centre x. Slim at the ankle. */
const SHAFT: readonly (readonly number[])[] = [
	[3, 3.45, 2.45, 2.1, -1.1],
	[3.7, 3.3, 2.25, 2.18, -1.1],
	[4.6, 3.1, 2.2, 2.28, -1.05],
	[5.6, 2.75, 2.25, 2.32, -0.95],
	[6.8, 2.45, 2.3, 2.34, -0.68],
	[8.2, 2.42, 2.4, 2.4, -0.4],
	[9.4, 2.52, 2.55, 2.5, -0.3],
	[10.3, 2.62, 2.68, 2.6, -0.3]
];
const PANEL_TOP = 9.95;
const PANEL_LOW = 4.15;

const WELT = 0.34;
const OUTSOLE = 0.42;
/** Bottom of the outsole: on the heel block, down through the arch, flat, then the toe spring. */
const base = (x: number): number => 1.15 * (1 - smooth(-1.5, 2.3, x)) + (x > 5.8 ? (x - 5.8) * 0.16 : 0);

/** Short stitch lying on a surface. */
function stitch(b: PartBuilder, w: Weights, at: THREE.Vector3, along: THREE.Vector3, normal: THREE.Vector3, len = 0.36, wide = 0.13): void {
	const l = along.clone().normalize().multiplyScalar(len / 2);
	const c = normal.clone().cross(along).normalize().multiplyScalar(wide / 2);
	const row = (k: number) => [at.clone().addScaledVector(l, k).sub(c), at.clone().addScaledVector(l, k).add(c)];
	b.grid([row(1), row(-1)], { w, pal: PAL.shoesD });
}

function buildBoot(b: PartBuilder, s: Side): void {
	const side = sideSign(s);
	const z0 = BIND[`foot${s}`][2] + side * 0.15;
	const zAt = (x: number) => z0 + side * sample(VAMP, x)[3]!;

	// Upper.
	const xs = b.pick(VAMP.map((r) => r[0]!).filter((x) => x !== -0.6), [-4.3, -3.6, -0.6, 1.8, 4.6, 7, 8.6], [-4.3, -0.4, 4.6, 8.4]);
	b.loft(
		xs.map((x): Ring => {
			const [, hw, top] = sample(VAMP, x) as [number, number, number, number];
			const lo = base(x) + OUTSOLE;
			return { c: [x, (top + lo) / 2, zAt(x)], f: (top - lo) / 2, s: hw, n: 2.5, w: shoeWeights(s, x) };
		}),
		{
			seg: b.pick(11, 7, 5),
			u: [0, 1, 0],
			v: [0, 0, 1],
			pal: PAL.shoesA,
			capStart: true,
			capEnd: true,
			// Darker towards the welt, a little wear on the toe.
			shadeAt: (p) => lerp(0.76, 1, smooth(0.9, 2.6, p.y)) * (1 + 0.06 * smooth(4.5, 7, p.x))
		}
	);

	// Outsole and welt.
	const slab = (y0: number, y1: number, grow: number, shade: number) =>
		b.loft(
			xs.map((x, i): Ring => {
				const end = i === 0 ? -0.22 : i === xs.length - 1 ? 0.2 : 0;
				return { c: [x + end, base(x) + (y0 + y1) / 2, zAt(x)], f: (y1 - y0) / 2, s: sample(VAMP, x)[1]! + grow * (end ? 0.55 : 1), n: 10, w: shoeWeights(s, x), shade };
			}),
			{ seg: 8, u: [0, 1, 0], v: [0, 0, 1], pal: PAL.shoesB, capStart: true, capEnd: true }
		);
	slab(0, b.lod > 0 ? OUTSOLE + WELT : OUTSOLE, 0.3, b.lod > 0 ? 0.85 : 0.6);
	if (b.lod === 0) slab(OUTSOLE, OUTSOLE + WELT, 0.36, 1.12);

	// Stacked heel: rubber tip under two leather lifts.
	const heel = (y: number, grow: number, shade: number): Ring => ({ c: [-2.85, y, z0], f: 1.45 + grow * 0.5, b: 1.5 + grow * 0.5, s: 2.05 + grow, n: 2.9, w: shoeWeights(s, -2.8), shade });
	const lifts = b.pick([heel(0, 0, 0.5), heel(0.32, 0.02, 0.5), heel(0.32, 0.06, 1), heel(0.75, 0.1, 1), heel(0.75, 0.1, 0.78), heel(1.42, 0.18, 0.82)], [heel(0, 0, 0.5), heel(0.4, 0.04, 0.9), heel(1.42, 0.18, 0.9)], [heel(0, 0, 0.7), heel(1.42, 0.18, 0.8)]);
	b.loft(lifts, { seg: b.pick(10, 8, 6), pal: PAL.shoesB, capStart: true, capEnd: true });

	// Shaft: same weights as the trousers; the rim dips at the sides.
	const ring = (y: number, d = 0, pal: number = PAL.shoesA, shade = 1, drop = 0): Ring => {
		const r = sample(SHAFT, y) as [number, number, number, number, number];
		return { c: [r[4], y - drop, z0], f: r[1] + d, b: r[2] + d, s: r[3] + d, w: legWeights(s, y - drop), pal, shade };
	};
	const ys = b.pick([3, 4, 5.2, 6.8, 8.2, 9.95, 10.3], [3, 5, 6.8, 9.95, 10.3], [3, 6.4, 10.3]);
	const rows = [...ys.map((y) => ring(y)), ring(10.3, -0.35, PAL.shoesC, 0.8, -0.06), ring(10.3, -0.7, PAL.shoesC, 0.5, 1.5)];
	const top = ys.length - 2;
	b.loft(rows, {
		seg: b.pick(18, 8, 6),
		palAt: (i, a) => {
			if (i >= ys.length - 1) return i === ys.length - 1 ? PAL.shoesA : PAL.shoesC;
			return b.lod > 0 && i > 0 && i < (b.lod === 1 ? top : 9) && Math.abs(Math.sin(a)) > 0.9 ? PAL.shoesC : PAL.shoesA;
		},
		deform: (p, _t, a, i) => {
			p.y -= 0.35 * Math.sin(a) ** 2 * smooth(8.5, 10.2, rows[Math.min(i, ys.length)]!.c[1]);
		},
		shadeAt: (p) => lerp(0.88, 1, smooth(4, 6.5, p.y))
	});
	if (b.lod > 0) return;

	/** Point on the shaft, `out` off the surface. */
	const on = (y: number, a: number, out: number): THREE.Vector3 => {
		const r = sample(SHAFT, y);
		const ca = Math.cos(a);
		const sa = Math.sin(a);
		return new THREE.Vector3(r[4]! + ((ca >= 0 ? r[1]! : r[2]!) + out) * ca, y - 0.35 * sa * sa * smooth(8.5, 10.2, y), z0 + (r[3]! + out) * sa);
	};
	// Elastic side panels: ribbed, tapering to a rounded end at the ankle.
	const half = (t: number) => lerp(0.2, 0.56, Math.min(1, t * 1.4) ** 0.55);
	for (const k of [1, -1]) {
		const ribs = 8;
		const cols = Array.from({ length: ribs + 1 }, (_, j) => Array.from({ length: 5 }, (_, i) => {
			const t = i / 4;
			return on(lerp(PANEL_LOW, PANEL_TOP, t), k * (Math.PI / 2 + (j / ribs - 0.5) * 2 * half(t)), 0.07);
		}));
		b.grid(cols, { w: legWeights(s, 7), pal: PAL.shoesC, flip: k < 0, shadeAt: (_p, j) => (j % 2 ? 1.35 : 0.75) });
		// Stitching along both edges.
		for (const e of [1, -1])
			for (let i = 0; i < 8; i++) {
				const t = 0.12 + i * 0.118;
				const y = lerp(PANEL_LOW, PANEL_TOP, t);
				const a = (tt: number) => k * (Math.PI / 2 + e * (half(tt) + 0.09));
				const p = on(y, a(t), 0.06);
				stitch(b, legWeights(s, y), p, on(y + 0.2, a(t + 0.034), 0.06).sub(p), new THREE.Vector3(p.x - sample(SHAFT, y)[4]!, 0, p.z - z0).normalize());
			}
	}

	// Pull loops over the rim, front and back.
	for (const k of [1, -1]) {
		const rim = (y: number, out: number) => {
			const r = sample(SHAFT, y);
			return new THREE.Vector2(r[4]! + k * ((k > 0 ? r[1]! : r[2]!) + out), y);
		};
		const path = [rim(8.6, 0.1), rim(9.5, 0.14), rim(10.3, 0.14).add(new THREE.Vector2(0, 0.5)), rim(10.3, -0.1).add(new THREE.Vector2(0, 0.85)), rim(10.3, -0.3).add(new THREE.Vector2(0, 0.5)), rim(10.3, -0.32)];
		const tube = path.map((c, i) => {
			const d = path[Math.min(i + 1, path.length - 1)]!.clone().sub(path[Math.max(i - 1, 0)]!).normalize();
			const n = new THREE.Vector2(-d.y, d.x).multiplyScalar(0.07);
			return ([[1, 1], [1, -1], [-1, -1], [-1, 1]] as const).map(([u, v]) => new THREE.Vector3(c.x + n.x * u, c.y + n.y * u, z0 + v * 0.48));
		});
		b.grid(tube, { w: legWeights(s, 10), pal: PAL.shoesD, wrap: true, shadeAt: (_p, i) => (i > 3 ? 0.6 : 0.85) });
	}

	// Side seam from the panel down to the welt.
	for (const k of [1, -1])
		for (let i = 0; i < 4; i++) {
			const seam = (t: number): THREE.Vector3 => {
				const x = lerp(-0.75, 1.1, t);
				const y = lerp(3.95, 1.75, t);
				const [, hw, top] = sample(VAMP, x) as [number, number, number, number];
				const lo = base(x) + OUTSOLE;
				const v = Math.min(1, Math.abs((2 * y - top - lo) / (top - lo)));
				return new THREE.Vector3(x, y, zAt(x) + k * (hw * (1 - v ** 2.5) ** 0.4 + 0.05));
			};
			const p = seam(0.1 + i * 0.24);
			stitch(b, shoeWeights(s, p.x), p, seam(0.16 + i * 0.24).sub(p), new THREE.Vector3(0, 0.25, k), 0.4);
		}

	// Light stitching round the welt.
	const welt = (x: number, k: number) => new THREE.Vector3(x, base(x) + OUTSOLE + WELT + 0.015, zAt(x) + k * (sample(VAMP, x)[1]! + 0.2));
	const up = new THREE.Vector3(0, 1, 0);
	for (const k of [1, -1])
		for (let i = 0; i < 13; i++) {
			const x = -2.6 + i * 0.83;
			const p = welt(x, k);
			stitch(b, shoeWeights(s, x), p, welt(x + 0.1, k).sub(p), up, 0.42, 0.12);
		}
}

registerItemMesh('shoes_chelsea', {
	colors: [0x7a4c2e, 0x3f291b, 0x2a2320, 0xdcbd8d],
	build(b) {
		for (const s of SIDES) buildBoot(b, s);
	}
});
