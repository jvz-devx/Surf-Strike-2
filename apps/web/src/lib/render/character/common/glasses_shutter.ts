/** Shutter shades: chunky pink plastic frames with tilted slats instead of lenses and yellow temple tips. */
import { registerItemMesh } from '../items.js';
import { PAL, type Ring } from '../mesh-kit.js';
import { HEAD, SIDES } from '../shop-items.js';
import { sideSign } from '../skeleton.js';

const FRAME = PAL.glassesA;
const SLAT = PAL.glassesB;
const TIP = PAL.glassesC;
const PIN = PAL.glassesD;

const MID = 2.12;
const W = 1.5;
const H = 1.16;
/** Superellipse exponent of the opening. */
const N = 3.6;
/** Outline at angle `a` (0 up, π/2 outwards): distance from the middle of the face, height. `grow`: from the opening (0) to the outer edge (1). */
function outline(a: number, grow: number): [number, number] {
	const c = Math.cos(a);
	const s = Math.sin(a);
	const e = (v: number) => Math.sign(v) * Math.abs(v) ** (2 / N);
	// Flared a little at the upper outer corner.
	const o = e(s) * (W + 0.32 * grow) * (1 + 0.05 * c);
	return [MID + o, e(c) * (H + 0.32 * grow) + 0.06 * Math.max(0, o)];
}
const bend = (out: number): number => 0.42 - 0.085 * out * out;

registerItemMesh('glasses_shutter', {
	colors: [0xf2418f, 0xff78b4, 0xffd83d, 0xfff3f8],
	build(b) {
		b.socket('glasses', () => {
			const seg = b.pick(36, 16, 8);
			// Frame: grow, depth, shade.
			const prof = b.pick<readonly (readonly [number, number, number])[]>(
				[[0, -0.22, 0.6], [1, -0.22, 0.75], [1.1, 0, 0.9], [1.05, 0.26, 1], [0.8, 0.4, 1.12], [0.2, 0.4, 1.06], [0, 0.26, 0.85], [0, -0.22, 0.6]],
				[[0, -0.22, 0.6], [1, -0.22, 0.8], [1.05, 0.36, 1.04], [0, 0.36, 0.95], [0, -0.22, 0.6]],
				[[1.1, -0.2, 0.8], [1.1, 0.34, 1.02], [0, 0.3, 0.95]]
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
						pal: FRAME,
						deform: (p, _t, a, i) => {
							const [o, y] = outline(local(a), prof[i]![0]);
							p.set(bend(o) + prof[i]![1], y, z * o);
						}
					}
				);
				// Slats, tilted like a blind. The gaps between them are as wide as the slats.
				const ys = b.pick([0.72, 0.24, -0.24, -0.72], [0.72, 0.24, -0.24, -0.72], [0.4, -0.4]);
				for (const y of ys) {
					const half = W * (1 - (Math.abs(y) / H) ** N) ** (1 / N) + 0.06;
					const ks = b.pick([-1, -0.5, 0, 0.5, 1], [-1, 0, 1], [-1, 1]);
					b.loft(
						ks.map((k): Ring => ({ c: [bend(MID + k * half) + 0.12, y + 0.06 * Math.max(0, k * half), z * (MID + k * half)], f: 0.2, s: b.pick(0.115, 0.14, 0.2), n: 4, w: HEAD })),
						{
							seg: b.pick(8, 4, 4),
							u: [1, 0, 0],
							v: [0, 1, 0],
							pal: SLAT,
							deform: (p, _t, a) => {
								p.y -= Math.cos(a) * 0.07;
							},
							shadeAt: (_p, a) => (Math.sin(a) > 0.3 ? 1.15 : Math.sin(a) < -0.3 ? 0.62 : 0.95)
						}
					);
				}
				// Wide temple with a yellow tip.
				const arm = (x: number, y: number, o: number, h: number, pal: number): Ring => ({ c: [x, y, z * o], f: h, s: 0.2, n: 4, w: HEAD, pal });
				b.loft(
					[arm(bend(3.75) + 0.3, 0.55, 3.86, 0.5, FRAME), arm(-1.2, 0.55, 4.08, 0.46, FRAME), arm(-2.4, 0.52, 4.3, 0.4, FRAME), arm(-3.9, 0.48, 4.5, 0.36, TIP), arm(-5.6, 0.4, 4.64, 0.34, TIP), arm(-6.7, -0.35, 4.6, 0.32, TIP)],
					{ seg: b.pick(8, 6, 4), u: [0, 1, 0], v: [0, 0, 1], capStart: true, capEnd: true }
				);
				// Corner studs.
				if (b.lod === 0) for (const y of [0.78, 0.42]) b.box([bend(3.75) + 0.36, y, z * 3.72], [0.2, 0.2, 0.2], { w: HEAD, pal: PIN, rot: [0, z * -0.55, 0] });
			}
			// Bridge and a straight brow bar.
			b.loft(
				[-0.85, -0.4, 0, 0.4, 0.85].map((zz): Ring => ({ c: [bend(0.5) + 0.14, 0.5 - zz * zz * 0.15, zz], f: 0.26, s: 0.34, n: 3, w: HEAD })),
				{ seg: b.pick(8, 5, 4), u: [1, 0, 0], v: [0, 1, 0], pal: FRAME, capStart: true, capEnd: true }
			);
		});
	}
});
