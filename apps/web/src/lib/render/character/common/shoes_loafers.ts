/** Penny loafers: polished burgundy leather, moc-toe seam, slotted strap, low heel and a short sock. */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, superellipse, type PartBuilder, type Ring } from '../mesh-kit.js';
import { shoeWeights } from '../outfit.js';
import { shaft, SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

const LEATHER = PAL.shoesA;
const SOLE = PAL.shoesB;
const SOCK = PAL.shoesC;
const SEAM = PAL.shoesD;

/** Upper: x, half width, top y, centre shift. */
const VAMP: readonly (readonly number[])[] = [
	[-4.3, 1.3, 3.2, 0],
	[-3.95, 1.9, 4.2, 0],
	[-2.8, 2.3, 4.65, 0],
	[-0.6, 2.3, 4.6, 0],
	[0.8, 2.3, 4.35, -0.02],
	[2.2, 2.4, 3.85, -0.1],
	[3.6, 2.52, 3.4, -0.2],
	[5, 2.55, 3.05, -0.28],
	[6.4, 2.3, 2.75, -0.37],
	[7.6, 1.65, 2.4, -0.46],
	[8.3, 0.95, 2, -0.5],
	[8.6, 0.4, 1.65, -0.5]
];
const OUTSOLE = 0.45;
const N = 2.6;
const base = (x: number): number => 0.75 * (1 - smooth(-1.5, 1.5, x)) + (x > 5.8 ? (x - 5.8) * 0.14 : 0);

function buildLoafer(b: PartBuilder, s: Side): void {
	const side = sideSign(s);
	const z0 = BIND[`foot${s}`][2] + side * 0.15;
	const zAt = (x: number) => z0 + side * sample(VAMP, x)[3]!;
	const xs = b.pick(VAMP.map((r) => r[0]!), [-4.3, -3.6, -0.6, 2.2, 5, 7.2, 8.5], [-4.3, -0.4, 4.6, 8.3]);
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
	const SEG = b.pick(14, 7, 5);
	b.loft(
		xs.map((x): Ring => {
			const u = shape(x);
			return { c: [x, u.y, zAt(x)], f: u.f, s: u.s, n: N, w: shoeWeights(s, x) };
		}),
		{
			seg: SEG,
			u: [0, 1, 0],
			v: [0, 0, 1],
			pal: LEATHER,
			capStart: true,
			capEnd: true,
			// Polish: light on the toe and the instep, dark near the sole and behind the toe.
			shadeAt: (p) => lerp(0.62, 1, smooth(0.9, 2.5, p.y)) * (1 + 0.45 * Math.exp(-(((p.x - 6.4) / 1.1) ** 2)) * smooth(1.8, 2.7, p.y)) * (1 - 0.14 * Math.exp(-(((p.x - 4.4) / 0.9) ** 2))) * (1 + 0.2 * Math.exp(-(((p.x + 3.4) / 0.7) ** 2)) * smooth(2, 3.4, p.y))
		}
	);
	// Outsole with a lighter welt, and a low heel.
	const slab = (y0: number, y1: number, grow: number, pal: number, shade: number) =>
		b.loft(
			xs.map((x, i): Ring => {
				const end = i === 0 ? -0.2 : i === xs.length - 1 ? 0.2 : 0;
				return { c: [x + end, base(x) + (y0 + y1) / 2, zAt(x)], f: (y1 - y0) / 2, s: sample(VAMP, x)[1]! + grow * (end ? 0.55 : 1), n: 6, w: shoeWeights(s, x), shade };
			}),
			{ seg: b.pick(6, 5, 4), u: [0, 1, 0], v: [0, 0, 1], pal, capStart: true, capEnd: true }
		);
	slab(0, OUTSOLE, 0.26, SOLE, 1);
	if (b.lod === 0) slab(OUTSOLE, OUTSOLE + 0.22, 0.32, SEAM, 0.62);
	const heel = (y: number, grow: number, shade: number): Ring => ({ c: [-2.85, y, z0], f: 1.4 + grow, b: 1.5 + grow, s: 2.1 + grow, n: 2.9, w: shoeWeights(s, -2.8), shade });
	b.loft(b.pick([heel(0, 0, 0.6), heel(0.25, 0.02, 0.6), heel(0.25, 0.05, 1.2), heel(1, 0.14, 1.2)], [heel(0, 0, 0.7), heel(1, 0.14, 1)], [heel(0, 0, 0.8), heel(1, 0.14, 1)]), { seg: b.pick(12, 7, 5), pal: SOLE, capStart: true, capEnd: true });
	// Low collar and a short sock.
	shaft(b, s, b.lod === 2 ? [[3.4, 3.2, 2.5, 2.2], [7, 2.7, 2.3, 2.3]] : [[3.2, 3.2, 2.5, 2.2], [4.5, 2.75, 2.28, 2.3], [4.85, 2.6, 2.26, 2.3], [4.9, 2.6, 2.1, 2.15], [7.2, 2.75, 2.3, 2.3]], { shaft: LEATHER, top: SOCK, inner: SOCK });
	if (b.lod === 2) return;

	// Moc-toe seam: a raised ridge around the toe.
	const half = (x: number) => 0.78 * Math.max(0, 1 - ((x - 2) / 5.1) ** 2.6) ** 0.5;
	const xr = b.pick([3.3, 4, 5, 6, 6.6, 6.95, 7.08], [3.3, 5.4, 7.05], []);
	const uPath = [...xr.map((x) => [x, half(x)] as const), ...xr.slice(0, -1).reverse().map((x) => [x, -half(x)] as const)];
	// `half` is a share of the half width of the top.
	const top = (x: number, k: number, out: number): THREE.Vector3 => on(x, Math.sign(k) * Math.asin(Math.abs(k) ** (N / 2)), out);
	const path = uPath.map(([x, k]) => top(x, k, 0.02));
	const r = b.pick(0.15, 0.2, 0);
	const tube = path.map((c, i) => {
		const d = path[Math.min(i + 1, path.length - 1)]!.clone().sub(path[Math.max(i - 1, 0)]!).normalize();
		const n = new THREE.Vector3(0, 1, 0);
		const w = d.clone().cross(n).normalize();
		return [w.clone().multiplyScalar(-r), n.clone().multiplyScalar(r), w.clone().multiplyScalar(r), n.clone().multiplyScalar(-r)].map((o) => c.clone().add(o));
	});
	b.grid(tube, { w: shoeWeights(s, 5), pal: LEATHER, wrap: true, flip: true, shadeAt: (_p, i) => (i % 2 ? 0.75 : 0.6) });
	// Gathering stitches across the seam.
	if (b.lod === 0)
		for (const k of [1, -1])
			for (let i = 0; i < 5; i++) {
				const x = 3.75 + i * 0.64;
				const p = top(x, k * half(x), 0.16);
				b.box([p.x, p.y, p.z], [0.13, 0.14, 0.5], { w: shoeWeights(s, x), pal: SEAM, rot: [k * 0.5, k * 0.25 * smooth(4.5, 6.5, x), -0.2] });
			}
	// Strap over the instep, with stitched edges and the slot.
	const as = b.pick([-2, -1.6, -1.2, -0.8, -0.4, 0, 0.4, 0.8, 1.2, 1.6, 2], [-1.9, -0.8, 0, 0.8, 1.9], []);
	const wide = (a: number) => lerp(0.55, 0.95, smooth(0.6, 1.9, Math.abs(a)));
	const mid = (a: number) => 2.75 - 0.6 * smooth(0.6, 2, Math.abs(a));
	const prof: readonly (readonly [number, number])[] = b.pick([[-1, 0], [-0.95, 0.2], [0.95, 0.2], [1, 0]], [[-1, 0], [-0.9, 0.2], [0.9, 0.2], [1, 0]], []);
	b.grid(as.map((a) => prof.map(([k, h]) => on(mid(a) + k * wide(a), a, h))), { w: shoeWeights(s, 2), pal: LEATHER, flip: true, shadeAt: (p) => 1.25 * lerp(0.66, 1, smooth(1.4, 3.2, p.y)) });
	if (b.lod > 0) return;
	for (const k of [0.72, -0.72]) b.grid(as.map((a) => [-0.07, 0.07].map((d) => on(mid(a) + k * wide(a) + d, a, 0.24))), { w: shoeWeights(s, 2), pal: SEAM, flip: true });
	const slot = (a: number, dx: number, h: number) => on(2.75 + dx, a, h);
	// Slot: a dark opening with a small notch above and below it.
	b.grid([-0.6, -0.16, 0, 0.16, 0.6].map((a, i) => [slot(a, -[0.1, 0.2, 0.42, 0.2, 0.1][i]!, 0.25), slot(a, [0.1, 0.2, 0.42, 0.2, 0.1][i]!, 0.25)]), { w: shoeWeights(s, 2), pal: SOLE, flip: true, shadeAt: () => 0.5 });
}

registerItemMesh('shoes_loafers', {
	colors: [0x6a1726, 0x2b1a17, 0xe9e0cc, 0xb98563],
	build(b) {
		for (const s of SIDES) buildLoafer(b, s);
	}
});
