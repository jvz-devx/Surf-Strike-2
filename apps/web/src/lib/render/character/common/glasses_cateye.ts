/** Cat-eye shades: upswept two-tone acetate frames with studs at the corners and dark lenses. */
import type * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, smooth, type Ring } from '../mesh-kit.js';
import { HEAD, SIDES } from '../shop-items.js';
import { sideSign } from '../skeleton.js';

const TOP = PAL.glassesA;
const LOWER = PAL.glassesB;
const LENS = PAL.glassesC;
const STUD = PAL.glassesD;

/** Outline at angle `a` (0 up, π/2 outwards): distance from the middle of the face, height. `grow`: from the lens (0) to the outer edge (1). */
function outline(a: number, grow: number): [number, number] {
	const c = Math.cos(a);
	const s = Math.sin(a);
	const e = (v: number) => Math.sign(v) * Math.abs(v) ** 0.82;
	const down = Math.max(0, -c);
	// Upswept outer corner; narrower below.
	const o = e(s) * (1.5 + 0.28 * grow) * (1 - 0.1 * down);
	const y = e(c) * (c > 0 ? 1.0 + 0.36 * grow : 1.12 + 0.2 * grow);
	const tip = Math.exp(-(((a - 0.92) / 0.4) ** 2));
	return [2.08 + o + tip * (0.14 + 0.42 * grow), y - 0.05 + 0.2 * smooth(-0.6, 1.7, o) * (c > -0.4 ? 1 : 0.4) + tip * (0.1 + 0.62 * grow)];
}
const bend = (out: number): number => 0.36 - 0.085 * out * out;

registerItemMesh('glasses_cateye', {
	colors: [0x86203f, 0xf0c4b4, 0x221a22, 0xe9c46a],
	build(b) {
		b.socket('glasses', () => {
			const seg = b.pick(36, 18, 12);
			for (const s of SIDES) {
				const z = sideSign(s);
				const local = (a: number) => {
					const t = Math.atan2(Math.sin(a) * z, Math.cos(a));
					return t;
				};
				const put = (p: THREE.Vector3, a: number, grow: number, x: number) => {
					const [o, y] = outline(local(a), grow);
					p.set(bend(o) + x, y, z * o);
				};
				// Frame: [grow, depth].
				const prof = b.pick<readonly (readonly [number, number, number])[]>(
					[[0, -0.2, 0.7], [1, -0.2, 0.8], [1.06, 0.08, 0.95], [0.85, 0.3, 1.1], [0.2, 0.3, 1], [0, 0.06, 0.75], [0, -0.2, 0.6]],
					[[1, -0.2, 0.8], [1, 0.26, 1], [0, 0.26, 1], [0, -0.2, 0.6]],
					[[1.1, -0.15, 0.8], [1.05, 0.26, 1], [0, 0.2, 1]]
				);
				b.loft(
					prof.map(([, , shade], i): Ring => ({ c: [i, 0, 0], f: 1, s: 1, w: HEAD, shade })),
					{
						seg,
						u: [0, 1, 0],
						v: [0, 0, 1],
						deform: (p, _t, a, i) => put(p, a, prof[i]![0], prof[i]![1]),
						// Dark brow line over the light lower half.
						palAt: (_i, a) => (Math.abs(local(a) - 0.2) < 1.45 ? TOP : LOWER)
					}
				);
				// Lens: slightly domed, a lighter sheen across the top.
				const dome = b.pick([1, 0.7, 0.35], [1, 0.5], [1]);
				b.loft(
					dome.map((k, i): Ring => ({ c: [i, 0.1, z * 2.1], f: 1, s: 1, w: HEAD, shade: 1 })),
					{
						seg,
						u: [0, 1, 0],
						v: [0, 0, 1],
						pal: LENS,
						capEnd: true,
						deform: (p, _t, a, i) => {
							const k = dome[i]!;
							const [o, y] = outline(local(a), 0.1);
							const oo = lerp(2.15, o, k);
							p.set(bend(oo) + 0.08 + 0.06 * (1 - k), lerp(0, y, k), z * oo);
						},
						shadeAt: (p) => lerp(0.75, 1.9, smooth(-0.8, 1.2, p.y))
					}
				);
				// Temple from the corner, swept back over the ear.
				const arm = (x: number, y: number, o: number, h: number, pal: number): Ring => ({ c: [x, y, z * o], f: h, s: 0.16, n: 3, w: HEAD, pal });
				b.loft([arm(bend(3.9) + 0.22, 0.98, 4.0, 0.34, TOP), arm(-2.1, 0.92, 4.22, 0.32, TOP), arm(-4.6, 0.8, 4.5, 0.28, TOP), arm(-5.8, 0.6, 4.6, 0.3, TOP), arm(-6.7, -0.4, 4.55, 0.3, TOP)], { seg: b.pick(8, 5, 4), u: [0, 1, 0], v: [0, 0, 1], capStart: true, capEnd: true });
				// Studs at the corner.
				if (b.lod === 0)
					for (const [a, g] of [[0.78, 0.62], [1.02, 0.66], [1.28, 0.6]] as const) {
						const [o, y] = outline(a, g);
						b.ball([bend(o) + 0.3, y, z * o], [0.13, 0.15, 0.15], { w: HEAD, pal: STUD, seg: 8, rings: 5 });
					}
				else if (b.lod === 1) {
					const [o, y] = outline(1, 0.7);
					b.ball([bend(o) + 0.28, y, z * o], [0.15, 0.25, 0.25], { w: HEAD, pal: STUD, seg: 5, rings: 3 });
				}
			}
			// Keyhole bridge.
			b.loft(
				[-0.75, -0.3, 0.3, 0.75].map((zz): Ring => ({ c: [bend(0.5) + 0.06, 0.34 + (Math.abs(zz) < 0.5 ? 0.14 : 0), zz], f: 0.2, s: 0.24, w: HEAD })),
				{ seg: b.pick(8, 5, 4), u: [1, 0, 0], v: [0, 1, 0], pal: TOP, capStart: true, capEnd: true }
			);
		});
	}
});
