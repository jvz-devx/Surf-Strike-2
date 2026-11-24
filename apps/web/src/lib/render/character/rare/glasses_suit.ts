/** Executive shades: slim gunmetal frames with silver brow lines, gradient lenses and fine temples. */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, smooth, type Ring } from '../mesh-kit.js';
import { HEAD, SIDES } from '../shop-items.js';
import { sideSign } from '../skeleton.js';
import { CHARCOAL, SILVER } from './suit.js';

const FRAME = PAL.glassesA;
const METAL = PAL.glassesB;
const LENS = PAL.glassesC;
const TIP = PAL.glassesD;

/** Outline at angle `a` (0 up, π/2 outwards): distance from the middle of the face, height. Straight brow, tapered below. */
function outline(a: number): [number, number] {
	const c = Math.cos(a);
	const s = Math.sin(a);
	const e = (v: number, k: number) => Math.sign(v) * Math.abs(v) ** k;
	const x = e(s, 0.62) * 1.52 * (1 + 0.1 * c);
	return [2.08 + x, (c > 0 ? 0.86 : 1.16) * e(c, 0.62) + 0.06 * x];
}
const bend = (o: number): number => 0.42 - 0.095 * o * o;

registerItemMesh('glasses_suit', {
	// Gunmetal, silver, smoked lens, temple tips.
	colors: [0x4a4f58, SILVER, 0x59626f, CHARCOAL],
	build(b) {
		b.socket('glasses', () => {
			const seg = b.pick(36, 18, 10);
			const r = b.pick(0.13, 0.16, 0.22);
			const sides = b.pick(6, 4, 3);
			const bar = (pts: readonly (readonly [number, number, number])[], f: number, s: number, pal: number) =>
				b.loft(pts.map((c): Ring => ({ c, f, s, w: HEAD, n: 3 })), { seg: b.pick(6, 4, 4), u: [1, 0, 0], v: [0, 1, 0], pal, capStart: true, capEnd: true });
			for (const s of SIDES) {
				const z = sideSign(s);
				const rim = Array.from({ length: seg + 1 }, (_, i) => {
					const a = ((i % seg) / seg) * Math.PI * 2;
					const [o, y] = outline(a);
					const [o0, y0] = outline(a - 0.06);
					const [o1, y1] = outline(a + 0.06);
					const l = Math.hypot(o1 - o0, y1 - y0) || 1;
					// Heavier along the brow.
					const t = r * (1 + 0.45 * Math.max(0, Math.cos(a)));
					return Array.from({ length: sides }, (_, j) => {
						const k = (j / sides) * Math.PI * 2;
						const n = (Math.cos(k) * t) / l;
						return new THREE.Vector3(bend(o) + Math.sin(k) * r * 1.3, y + (o1 - o0) * n, z * (o - (y1 - y0) * n));
					});
				});
				b.grid(rim, { w: HEAD, pal: FRAME, wrap: true, flip: z > 0, shadeAt: (p) => (p.y > 0.4 ? 1.15 : 0.85) });
				// Lens: nearly black above, smoke grey below.
				const rows = seg / 2;
				const cols = b.pick(5, 3, 2);
				const pts = Array.from({ length: rows + 1 }, (_, i) => {
					const a = (i / rows) * Math.PI;
					const [o0, y0] = outline(-a);
					const [o1, y1] = outline(a);
					return Array.from({ length: cols + 1 }, (_, j) => {
						const t = z > 0 ? j / cols : 1 - j / cols;
						const o = lerp(o0, o1, t);
						return new THREE.Vector3(bend(o), lerp(y0, y1, t), z * o);
					});
				});
				b.grid(pts, { w: HEAD, pal: LENS, shadeAt: (p) => lerp(1.2, 0.12, smooth(-1.15, 0.45, p.y - 0.28 * p.z * 0.4)) });
				if (b.lod < 2) b.grid(pts.map((row) => row.map((p) => p.clone().setX(p.x - 0.08))), { w: HEAD, pal: LENS, flip: true, shadeAt: () => 0.3 });
				// Silver line on the brow, running into the hinge.
				if (b.lod < 2) {
					const line = b.pick([-0.75, -0.35, 0, 0.35, 0.8], [-0.75, 0, 0.8], []).map((a): [number, number, number] => {
						const [o, y] = outline(a);
						return [bend(o) + r * 1.35, y + r * 0.5, z * o];
					});
					bar(z > 0 ? line : line.reverse(), 0.07, 0.075, METAL);
				}
				const [hinge, hy] = outline(1.05);
				if (b.lod < 2) b.box([bend(hinge) + 0.02, hy - 0.12, z * (hinge + 0.14)], [0.42, 0.34, 0.3], { w: HEAD, pal: METAL, rot: [0, z * 0.5, 0] });
				const arm = (x: number, y: number, o: number, f: number, t: number): Ring => ({ c: [x, y, z * o], f, s: t, n: 3, w: HEAD });
				const y = hy - 0.12;
				b.loft([arm(bend(hinge) + 0.02, y, hinge + 0.16, 0.17, 0.1), arm(-2.2, 0.66, 4.12, 0.16, 0.1), arm(-3.2, 0.72, 4.35, 0.15, 0.1), arm(-4.4, 0.76, 4.48, 0.15, 0.1)], { seg: b.pick(6, 4, 3), u: [0, 1, 0], v: [0, 0, 1], pal: METAL, palAt: (i) => (b.lod === 0 && i === 0 ? METAL : FRAME), capStart: true });
				b.loft([arm(-4.35, 0.76, 4.47, 0.14, 0.1), arm(-4.45, 0.76, 4.49, 0.2, 0.15), arm(-5.6, 0.8, 4.6, 0.21, 0.16), arm(-6.3, 0.5, 4.6, 0.24, 0.16), arm(-7, -0.6, 4.45, 0.16, 0.12)], { seg: b.pick(6, 4, 3), u: [0, 1, 0], v: [0, 0, 1], pal: TIP, capStart: true, capEnd: true });
				if (b.lod === 0) b.ball([0.12, -0.36, z * 0.74], [0.18, 0.32, 0.1], { w: HEAD, pal: METAL, seg: 6, rings: 4, rot: [z * -0.2, 0, 0] });
			}
			// Flat keyhole bridge.
			const [o, y] = outline(-0.85);
			bar([[bend(o), y - 0.1, -o], [bend(0) + 0.06, y + 0.04, -0.3], [bend(0) + 0.06, y + 0.04, 0.3], [bend(o), y - 0.1, o]], r, r * 1.15, FRAME);
			if (b.lod === 0) bar([[bend(0) + 0.2, y + 0.06, -0.42], [bend(0) + 0.22, y + 0.06, 0.42]], 0.06, 0.07, METAL);
		});
	}
});
