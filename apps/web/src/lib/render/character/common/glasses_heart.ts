/** Heart shades: glossy red heart frames, dark lenses with a glare, metal hinges and slim temples. */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, smooth, type Ring } from '../mesh-kit.js';
import { HEAD, SIDES } from '../shop-items.js';
import { sideSign } from '../skeleton.js';

const RED = PAL.glassesA;
const LENS = PAL.glassesB;
const SHINE = PAL.glassesC;
const METAL = PAL.glassesD;

/** Half a heart from the cleft round the outside to the tip, evenly spaced: across, up. */
const HALF: readonly (readonly [number, number])[] = (() => {
	const n = 400;
	const pts = Array.from({ length: n + 1 }, (_, i): [number, number] => {
		const t = (i / n) * Math.PI;
		return [Math.sin(t) ** 3, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16 + 0.14];
	});
	const len = [0];
	for (let i = 1; i <= n; i++) len.push(len[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
	return Array.from({ length: 49 }, (_, k) => pts[len.findIndex((l) => l >= (k / 48) * len[n]! - 1e-9)]!);
})();

const TILT = 0.1;
const CENTRE = 2.12;

/** Outline at angle `a` (0 cleft, π tip, positive outwards), scaled by `k`: distance from the middle of the face, height. */
function heart(a: number, k: number): [number, number] {
	const t = Math.atan2(Math.sin(a), Math.cos(a));
	const f = (Math.abs(t) / Math.PI) * 48;
	const i = Math.min(47, Math.floor(f + 1e-6));
	const p = HALF[i]!;
	const q = HALF[i + 1]!;
	const x = lerp(p[0], q[0], f - i) * Math.sign(t) * 1.58 * k;
	const y = lerp(p[1], q[1], f - i) * 1.6 * k;
	return [CENTRE + x * Math.cos(TILT) + y * Math.sin(TILT) * 0.8, y * Math.cos(TILT) - x * Math.sin(TILT) * -0.6 - 0.1];
}
const bend = (out: number): number => 0.42 - 0.085 * out * out;

registerItemMesh('glasses_heart', {
	colors: [0xe01f4e, 0x24161c, 0xffb9c8, 0xd4d6dc],
	build(b) {
		b.socket('glasses', () => {
			const seg = b.pick(40, 20, 12);
			for (const s of SIDES) {
				const z = sideSign(s);
				const put = (p: THREE.Vector3, a: number, k: number, x: number) => {
					const [o, y] = heart(Math.atan2(Math.sin(a) * z, Math.cos(a)), k);
					p.set(bend(o) + x, y, z * o);
				};
				// Frame, rounded: scale, depth, shade.
				const prof = b.pick<readonly (readonly [number, number, number])[]>(
					[[0.96, -0.22, 0.7], [1.17, -0.22, 0.8], [1.22, 0.06, 0.95], [1.16, 0.28, 1.1], [1.07, 0.34, 1.15], [1, 0.22, 0.95], [0.96, 0.02, 0.7]],
					[[1.16, -0.2, 0.8], [1.2, 0.1, 1], [1.08, 0.32, 1.1], [0.96, 0.02, 0.75]],
					[[1.2, -0.15, 0.85], [1.16, 0.28, 1.05], [0.96, 0.05, 0.8]]
				);
				b.loft(
					prof.map(([, , shade], i): Ring => ({ c: [i, 0, 0], f: 1, s: 1, w: HEAD, shade })),
					{
						seg,
						u: [0, 1, 0],
						v: [0, 0, 1],
						pal: RED,
						deform: (p, _t, a, i) => put(p, a, prof[i]![0], prof[i]![1]),
						// Gloss along both lobes.
						palAt: (i, a) => {
							const t = Math.atan2(Math.sin(a) * z, Math.cos(a));
							return b.lod === 0 && i === 3 && ((t > 0.45 && t < 1.15) || (t > 1.3 && t < 1.46) || (t > -1.0 && t < -0.55)) ? SHINE : RED;
						},
						shadeAt: (p) => lerp(0.85, 1.08, smooth(-1.6, 1.2, p.y))
					}
				);
				const dome = b.pick([1, 0.65, 0.3], [1, 0.5], [1]);
				const [co, cy] = heart(0, 0);
				b.loft(
					dome.map((_, i): Ring => ({ c: [i, 0, 0], f: 1, s: 1, w: HEAD })),
					{
						seg,
						u: [0, 1, 0],
						v: [0, 0, 1],
						pal: LENS,
						capEnd: true,
						deform: (p, _t, a, i) => {
							const k = dome[i]!;
							const [o, y] = heart(Math.atan2(Math.sin(a) * z, Math.cos(a)), 0.99);
							const oo = lerp(co, o, k);
							p.set(bend(oo) + 0.06 + 0.1 * (1 - k), lerp(cy, y, k), z * oo);
						},
						shadeAt: (p) => lerp(0.8, 2.1, smooth(-1.2, 1.2, p.y))
					}
				);
				// Glare: two slanted streaks.
				if (b.lod < 2)
					for (const [o0, w] of b.pick([[-0.78, 0.26], [-0.36, 0.1]] as const, [[-0.75, 0.3]] as const, [])) {
						// Same slant on both lenses; +Z is to the wearer's right.
						const rows = [0.62, 0.2, -0.22].map((y) =>
							[0, w].map((d) => {
								const o = co + (o0 + d + y * 0.4) * 0.95 * -z;
								return new THREE.Vector3(bend(o) + 0.19, y * 0.95 + 0.05, z * o);
							})
						);
						b.grid(rows, { w: HEAD, pal: SHINE, flip: true, shadeAt: (_p, i) => 0.95 - i * 0.22 });
					}
				// Hinge plate and slim temple.
				const y0 = 0.5;
				const ho = heart(1.3, 1.17)[0];
				if (b.lod < 2) b.box([bend(ho) + 0.06, y0, z * (ho + 0.08)], [0.44, 0.42, 0.24], { w: HEAD, pal: METAL, rot: [0, z * 0.55, 0] });
				if (b.lod === 0) for (const dy of [0.12, -0.12]) b.ball([bend(ho) + 0.3, y0 + dy, z * (ho + 0.02)], [0.09, 0.09, 0.09], { w: HEAD, pal: METAL, seg: 6, rings: 4, shade: 0.6 });
				const arm = (x: number, y: number, o: number, h: number, pal: number): Ring => ({ c: [x, y, z * o], f: h, s: 0.14, n: 3, w: HEAD, pal });
				b.loft(
					[arm(bend(ho) - 0.02, y0, ho + 0.1, 0.2, METAL), arm(bend(ho) - 0.6, y0 + 0.03, 4.18, 0.2, RED), arm(-2.1, y0 + 0.15, 4.3, 0.21, RED), arm(-4.6, y0 + 0.25, 4.5, 0.2, RED), arm(-5.8, y0 + 0.1, 4.6, 0.24, RED), arm(-6.7, -0.4, 4.55, 0.26, RED)],
					{ seg: b.pick(8, 5, 4), u: [0, 1, 0], v: [0, 0, 1], capStart: true, capEnd: true }
				);
				// Nose pad.
				if (b.lod === 0) b.ball([0.12, -0.35, z * 0.78], [0.22, 0.34, 0.12], { w: HEAD, pal: METAL, seg: 7, rings: 5, rot: [z * -0.2, 0, 0] });
			}
			// Bridge.
			b.loft(
				[-0.75, -0.3, 0.3, 0.75].map((zz): Ring => ({ c: [bend(0.5) + 0.06, 0.42 + (Math.abs(zz) < 0.5 ? 0.12 : 0), zz], f: 0.2, s: 0.22, w: HEAD })),
				{ seg: b.pick(8, 5, 4), u: [1, 0, 0], v: [0, 1, 0], pal: RED, capStart: true, capEnd: true }
			);
		});
	}
});
