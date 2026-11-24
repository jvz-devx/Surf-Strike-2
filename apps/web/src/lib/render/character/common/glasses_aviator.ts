/** Gold aviators: teardrop gradient lenses in a thin wire frame with a double bridge. */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, smooth, type Ring } from '../mesh-kit.js';
import { HEAD, SIDES } from '../shop-items.js';
import { sideSign, type V3 } from '../skeleton.js';

/** Distance of a lens centre from the middle of the face. */
const CENTRE = 2.12;

/** Teardrop outline at angle `a` (0 up, π/2 outwards): distance from the middle of the face, height. */
function outline(a: number): [number, number] {
	const c = Math.cos(a);
	const s = Math.sin(a);
	const down = Math.max(0, -c);
	const o = Math.sign(s) * Math.abs(s) ** 0.85 * 1.55 * (1 - 0.14 * down) + 0.36 * down ** 1.1;
	const y = c > 0 ? 1.1 * c ** 0.75 : -1.75 * down;
	return [CENTRE + o, y + 0.05 - 0.09 * o];
}

/** Curved around the face: `out` is the distance from the middle. */
const bend = (out: number): number => 0.42 - 0.095 * out * out;

registerItemMesh('glasses_aviator', {
	// Gold wire, dark top of the lens, amber bottom, temple tips.
	colors: [0xe0ab3c, 0x4a3420, 0xe8c088, 0x2a1a14],
	build(b) {
		b.socket('glasses', () => {
			const wire = b.pick(0.115, 0.15, 0.22);
			const seg = b.pick(30, 16, 10);
			const sides = b.pick(6, 4, 3);
			/** Wire in the Z direction, through points from left to right. */
			const bar = (pts: readonly V3[], r: number) =>
				b.loft(
					pts.map((c): Ring => ({ c, f: r, s: r, w: HEAD })),
					{ seg: sides, u: [1, 0, 0], v: [0, 1, 0], pal: PAL.glassesA, capStart: true, capEnd: true }
				);
			for (const s of SIDES) {
				const z = sideSign(s);
				// Rim.
				const rim = Array.from({ length: seg + 1 }, (_, i) => {
					const a = ((i % seg) / seg) * Math.PI * 2;
					const [o, y] = outline(a);
					const [o0, y0] = outline(a - 0.05);
					const [o1, y1] = outline(a + 0.05);
					const l = Math.hypot(o1 - o0, y1 - y0);
					return Array.from({ length: sides }, (_, j) => {
						const k = (j / sides) * Math.PI * 2;
						const n = (Math.cos(k) * wire) / l;
						return new THREE.Vector3(bend(o) + Math.sin(k) * wire * 1.15, y + (o1 - o0) * n, z * (o - (y1 - y0) * n));
					});
				});
				b.grid(rim, { w: HEAD, pal: PAL.glassesA, wrap: true, flip: z > 0 });
				// Lens: strips from the top to the bottom, dark above and amber below; the shades meet in the middle.
				const rows = seg / 2;
				const cols = b.pick(6, 3, 2);
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
				const mid = Math.round(rows * 0.47);
				const dark = (i: number) => lerp(0.25, 1.2, smooth(0, mid, i));
				const light = (i: number) => lerp(0.1, 1.05, (i / (rows - mid)) ** 1.2);
				const back = (r: THREE.Vector3[]) => r.map((p) => p.clone().setX(p.x - 0.08));
				b.grid(pts.slice(0, mid + 1), { w: HEAD, pal: PAL.glassesB, shadeAt: (_p, i) => dark(i) });
				b.grid(pts.slice(mid), { w: HEAD, pal: PAL.glassesC, shadeAt: (_p, i) => light(i) });
				if (b.lod < 2) b.grid(pts.map(back), { w: HEAD, pal: PAL.glassesB, flip: true, shadeAt: () => 0.6 });
				// Hinge and temple, with a dark tip bent down behind the ear.
				const [hinge] = outline(1.25);
				if (b.lod === 0) b.box([bend(hinge) - 0.05, 0.62, z * (hinge + 0.12)], [0.4, 0.36, 0.34], { w: HEAD, pal: PAL.glassesA, rot: [0, z * 0.5, 0] });
				const t = b.pick(0.11, 0.14, 0.2);
				const arm = (x: number, y: number, side: number, k = 1): Ring => ({ c: [x, y, z * side], f: t * 1.25 * k, s: t * k, w: HEAD });
				b.loft([arm(bend(hinge) + 0.05, 0.62, hinge + 0.14), arm(-2.2, 0.72, 4.1), arm(-3.2, 0.8, 4.35), arm(-4.4, 0.85, 4.48)], {
					seg: sides,
					u: [0, 1, 0],
					v: [0, 0, 1],
					pal: PAL.glassesA,
					capStart: true
				});
				b.loft([arm(-4.3, 0.85, 4.47), arm(-4.45, 0.85, 4.49, 1.6), arm(-5.6, 0.9, 4.6, 1.7), arm(-6.2, 0.6, 4.62, 1.8), arm(-6.8, -0.3, 4.55, 2), arm(-7.1, -0.9, 4.45, 1.2)], {
					seg: sides,
					u: [0, 1, 0],
					v: [0, 0, 1],
					pal: PAL.glassesD,
					capStart: true,
					capEnd: true
				});
				// Nose pad on a short wire.
				if (b.lod === 0) {
					b.ball([0.12, -0.42, z * 0.76], [0.2, 0.34, 0.12], { w: HEAD, pal: PAL.glassesC, seg: 7, rings: 5, rot: [z * -0.2, 0, 0] });
					bar(z > 0 ? [[0.1, -0.35, 0.74], [0.36, -0.2, 0.86]] : [[0.36, -0.2, -0.86], [0.1, -0.35, -0.74]], 0.06);
				}
			}
			// Double bridge: a straight brow bar and an arched one below it.
			const [top, topY] = outline(-0.55);
			bar([[bend(top), topY, -top], [bend(0) + 0.04, topY + 0.02, 0], [bend(top), topY, top]], wire * 0.95);
			if (b.lod < 2) {
				const [low, lowY] = outline(-1.6);
				bar([[bend(low), lowY, -low], [0.5, lowY + 0.2, -0.3], [0.5, lowY + 0.2, 0.3], [bend(low), lowY, low]], wire * 0.85);
			}
		});
	}
});
