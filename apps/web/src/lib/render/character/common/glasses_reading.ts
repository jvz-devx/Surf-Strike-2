/** Reading glasses: round-cornered tortoise-shell frames without lenses, so the eyes stay visible. */
import type * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { PAL, type Ring } from '../mesh-kit.js';
import { HEAD, SIDES } from '../shop-items.js';
import { sideSign } from '../skeleton.js';

const SHELL = PAL.glassesA;
const DARK = PAL.glassesB;
const AMBER = PAL.glassesC;
const PIN = PAL.glassesD;

/** Outline at angle `a` (0 up, π/2 outwards): distance from the middle, height; wider at the top. */
function outline(a: number, grow: number): [number, number] {
	const c = Math.cos(a);
	const s = Math.sin(a);
	const e = (v: number) => Math.sign(v) * Math.abs(v) ** 0.78;
	return [2.06 + e(s) * (1.42 + grow * 0.36) * (1 + 0.07 * c), e(c) * (1.24 + grow * (c > 0.2 ? 0.4 : 0.3)) - 0.08];
}
const bend = (out: number): number => 0.36 - 0.085 * out * out;
/** Mottled tortoise shell. */
function shell(u: number, v: number): number {
	const m = Math.sin(u * 2.9 + v * 1.3) + Math.sin(u * 5.3 - v * 2.1 + 1.1) * 0.8;
	return m > 0.75 ? AMBER : m < -0.45 ? DARK : SHELL;
}

registerItemMesh('glasses_reading', {
	colors: [0x84491d, 0x3a1f12, 0xc98433, 0xd9b661],
	build(b) {
		b.socket('glasses', () => {
			const seg = b.pick(40, 18, 12);
			const prof = b.pick<readonly (readonly [number, number, number])[]>(
				[[0, -0.18, 0.7], [1, -0.18, 0.8], [1.08, 0.06, 0.95], [0.85, 0.28, 1.12], [0.15, 0.28, 1.05], [0, 0.06, 0.8], [0, -0.18, 0.6]],
				[[1, -0.18, 0.8], [1, 0.26, 1], [0, 0.26, 1], [0, -0.18, 0.6], [1, -0.18, 0.8]],
				[[1.15, -0.15, 0.8], [1.1, 0.26, 1], [0, 0.22, 1], [1.15, -0.15, 0.8]]
			);
			for (const s of SIDES) {
				const z = sideSign(s);
				const local = (a: number) => Math.atan2(Math.sin(a) * z, Math.cos(a));
				b.loft(
					prof.map(([, , shade], i): Ring => ({ c: [i, 0, 0], f: 1, s: 1, w: HEAD, shade })),
					{
						seg,
						u: [0, 1, 0],
						v: [0, 0, 1],
						deform: (p: THREE.Vector3, _t, a, i) => {
							const [o, y] = outline(local(a), prof[i]![0]);
							p.set(bend(o) + prof[i]![1], y, z * o);
						},
						palAt: (i, a) => (b.lod === 2 ? SHELL : shell(local(a) * 1.6 + z * 0.7, b.lod === 0 ? (i < 3 ? 0.4 : 0) : 0))
					}
				);
				// Temple with a curved tip; thicker towards the ear.
				const xs = b.pick([0.16, -0.5, -1.3, -2.1, -3, -4, -5, -5.8, -6.4, -6.9], [0.16, -2.1, -4.2, -5.6, -6.8], [0.16, -4, -6.6]);
				const arm = (x: number): Ring => {
					const k = Math.max(0, -x - 5.2);
					const o = x > -2.1 ? 3.9 + ((bend(3.8) - x) / 2.6) * 0.3 : 4.22 + (Math.min(-x, 5.2) - 2.1) * 0.12;
					return { c: [x > 0 ? bend(3.8) + 0.2 : Math.min(x, bend(3.8)), 0.62 - k * k * 0.42, z * o], f: 0.22 + 0.06 * k, s: 0.15, n: 3, w: HEAD };
				};
				b.loft(xs.map(arm), { seg: b.pick(8, 5, 4), u: [0, 1, 0], v: [0, 0, 1], capStart: true, capEnd: true, pal: SHELL, palAt: (i) => (b.lod === 2 ? SHELL : shell(i * 1.1 + 3, z)) });
				if (b.lod > 0) continue;
				// Hinge pins and nose pads.
				for (const d of [0.14, -0.14]) {
					const [o] = outline(1.15, 0.5);
					b.ball([bend(o) + 0.27, 0.62 + d, z * (o + 0.06)], [0.06, 0.085, 0.085], { w: HEAD, pal: PIN, seg: 6, rings: 4 });
				}
				b.ball([0.1, -0.35, z * 0.62], [0.18, 0.4, 0.14], { w: HEAD, pal: AMBER, seg: 7, rings: 5, rot: [z * -0.25, 0, 0] });
			}
			b.loft(
				[-0.72, -0.35, 0, 0.35, 0.72].map((zz): Ring => ({ c: [bend(0.5) + 0.08 + (0.5 - Math.abs(zz)) * 0.12, 0.42 - zz * zz * 0.35, zz], f: 0.2, s: 0.24, w: HEAD })),
				{ seg: b.pick(8, 5, 4), u: [1, 0, 0], v: [0, 1, 0], pal: SHELL, capStart: true, capEnd: true, palAt: (i) => (b.lod === 0 && i % 2 ? DARK : SHELL) }
			);
		});
	}
});
