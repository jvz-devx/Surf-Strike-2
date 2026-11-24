/** Headphones: over-ear studio headphones with a padded band, metal sliders and cups with a turquoise ring. */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, smooth, type Ring } from '../mesh-kit.js';
import { HEAD, SIDES } from '../shop-items.js';
import { sideSign } from '../skeleton.js';

const SHELL = PAL.hatA;
const PAD = PAL.hatB;
const RING = PAL.hatC;
const METAL = PAL.hatD;

/** Centre of the cups in the socket: over the ears. */
const CUP_X = -0.35;
const CUP_Y = -2.7;

/** Band in the (z, y) plane: angle 0 right, π/2 top. */
function arch(t: number, out: number): [number, number] {
	const c = Math.cos(t);
	const s = Math.sin(t);
	return [Math.sign(c) * Math.abs(c) ** 0.86 * (6.05 + out), -0.9 + s ** 0.92 * (5.1 + out)];
}

registerItemMesh('hat_headphones', {
	colors: [0x2b2e36, 0x4a4039, 0x2fb8ad, 0xc9ced4],
	build(b) {
		b.socket('hat', () => {
			const n = b.pick(28, 14, 8);
			/** Band between two angles: half width along X, inner and outer offset. */
			const band = (t0: number, t1: number, half: (k: number) => number, lo: (k: number) => number, hi: (k: number) => number, pal: number, sides: number, count: number, shade: (k: number) => number = () => 1) => {
				const rows = Array.from({ length: count + 1 }, (_, i) => {
					const k = i / count;
					const t = lerp(t0, t1, k);
					return Array.from({ length: sides }, (_, j) => {
						const a = ((j + 0.5) / sides) * Math.PI * 2;
						const q = sides === 4 ? Math.SQRT2 : 1;
						const [z, y] = arch(t, (lo(k) + hi(k)) / 2 + ((hi(k) - lo(k)) / 2) * Math.sin(a) * q);
						return new THREE.Vector3(CUP_X + Math.cos(a) * half(k) * q + 0.25 * Math.sin(t), y, z);
					});
				});
				b.grid(rows, { w: HEAD, pal, wrap: true, flip: true, shadeAt: (_p, i) => shade(i / count) });
			};
			// Outer band, and the stitched padding below it.
			band(0.12, Math.PI - 0.12, (k) => lerp(0.7, 1.15, Math.sin(k * Math.PI)), () => 0.25, () => 0.6, SHELL, b.pick(6, 4, 4), n);
			const tufts = (k: number) => (b.lod === 0 ? 0.13 * Math.abs(Math.sin(k * Math.PI * 7)) : 0.1);
			band(0.62, Math.PI - 0.62, () => 1.2, (k) => -0.28 - tufts(k), () => 0.35, PAD, b.pick(8, 6, 4), b.pick(28, 10, 5), (k) => (b.lod === 0 ? lerp(0.72, 1.05, Math.abs(Math.sin(k * Math.PI * 7))) : 1));
			for (const s of SIDES) {
				const z = sideSign(s);
				const seg = b.pick(20, 10, 7);
				// Slightly taller than wide and tilted like the ears.
				const disc = (out: number, r: number, pal: number, shade = 1): Ring => ({ c: [CUP_X, CUP_Y, z * out], f: r * 1.12, b: r * 1.12, s: r, n: 2.2, w: HEAD, pal, shade });
				const loft = (rings: Ring[]) => b.loft(rings, { seg, u: [0, 1, 0], v: [1, 0, 0], capEnd: true });
				// Cushion, from the head outwards.
				loft(
					b.pick(
						[disc(4.62, 1.2, PAD, 0.5), disc(4.6, 1.9, PAD, 0.8), disc(4.85, 2.25, PAD), disc(5.3, 2.3, PAD), disc(5.65, 2.05, PAD, 0.75), disc(5.7, 1.8, PAD, 0.6)],
						[disc(4.6, 1.8, PAD, 0.7), disc(4.9, 2.28, PAD), disc(5.65, 2.1, PAD, 0.8)],
						[disc(4.6, 2, PAD, 0.8), disc(5.6, 2.2, PAD)]
					)
				);
				// Shell with a coloured ring on its face.
				loft(
					b.pick(
						[disc(5.55, 2.05, SHELL, 0.8), disc(5.75, 2.2, SHELL), disc(6.25, 2.1, SHELL), disc(6.55, 1.8, SHELL), disc(6.62, 1.62, RING), disc(6.7, 1.58, RING), disc(6.72, 1.28, RING, 0.9), disc(6.62, 1.24, SHELL, 1.5), disc(6.7, 0.9, SHELL, 1.4), disc(6.82, 0.4, SHELL, 1.3)],
						[disc(5.6, 2.15, SHELL), disc(6.3, 2.05, SHELL), disc(6.6, 1.65, RING), disc(6.7, 1.25, SHELL, 1.4)],
						[disc(5.6, 2.15, SHELL), disc(6.4, 1.8, RING), disc(6.7, 1.1, SHELL, 1.4)]
					)
				);
				if (b.lod === 2) continue;
				// Yoke: a metal fork holding the cup, and the slider up to the band.
				if (b.lod === 0) {
					const fork = Array.from({ length: 13 }, (_, i) => {
						const t = lerp(-0.25, Math.PI + 0.25, i / 12);
						const c = new THREE.Vector3(CUP_X + Math.cos(t) * 2.5, CUP_Y + Math.sin(t) * 2.8, z * lerp(6, 5.85, smooth(0, 1, Math.sin(t))));
						const r = new THREE.Vector3(Math.cos(t), Math.sin(t), 0);
						return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => c.clone().addScaledVector(r, u! * 0.13).add(new THREE.Vector3(0, 0, v! * z * 0.26)));
					});
					b.grid(fork, { w: HEAD, pal: METAL, wrap: true, flip: z > 0 });
					for (const k of [1, -1]) b.ball([CUP_X + k * 2.4, CUP_Y - 0.35, z * 6], [0.3, 0.42, 0.36], { w: HEAD, pal: METAL, seg: 7, rings: 4, shade: 0.85 });
				}
				b.box([CUP_X, 0.15, z * 5.98], [0.85, 1.5, 0.34], { w: HEAD, pal: METAL });
				if (b.lod === 0) {
					b.box([CUP_X, 0.85, z * 6.12], [1.5, 1.1, 0.62], { w: HEAD, pal: SHELL, rot: [z * -0.08, 0, 0] });
					for (let i = 0; i < 3; i++) b.box([CUP_X, 0.15 - i * 0.22, z * 6.16], [0.5, 0.06, 0.04], { w: HEAD, pal: SHELL });
				}
			}
		});
	}
});
