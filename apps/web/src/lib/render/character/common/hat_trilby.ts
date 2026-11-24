/** Trilby: felt with a pinched crown, snap brim, ribbon with a side bow and a feather. */
import type * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, smooth, type Ring } from '../mesh-kit.js';
import { HEAD, hatRing } from '../shop-items.js';

/** Crown: height, front, back and side radius; the last rows run inwards over the top. */
const CROWN: readonly (readonly [number, number, number, number])[] = [
	[-0.6, 4.9, 5, 4.5],
	[-0.5, 5.4, 5.7, 5.05],
	[0.6, 5.4, 5.7, 5.05],
	[1.9, 5.25, 5.55, 4.9],
	[3, 5.05, 5.3, 4.65],
	[4.1, 4.8, 5, 4.3],
	[5, 4.45, 4.65, 3.85],
	[5.5, 4, 4.25, 3.3],
	[5.62, 3.55, 3.8, 2.75],
	[5.3, 3.2, 3.4, 1.9],
	[4.6, 2.9, 3.1, 1.05],
	[4.3, 2.6, 2.8, 0.35]
];
const ROWS = [CROWN.map((_, i) => i), [1, 3, 5, 7, 8, 10, 11], [1, 4, 7, 10, 11]] as const;

/** Angle from the front, 0..π. */
const off = (a: number): number => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));

registerItemMesh('hat_trilby', {
	hides: ['hair'],
	colors: [0x5d6a7a, 0x7d2635, 0xe9b24c, 0x343d49],
	build(b) {
		b.socket('hat', () => {
			const seg = b.pick(36, 16, 10);
			const rows = ROWS[b.lod].map((i) => CROWN[i]!);
			b.loft(rows.map(([y, f, back, s]) => hatRing(y, f, back, s)), {
				seg,
				pal: PAL.hatA,
				capEnd: true,
				deform: (p, _t, a) => {
					const up = smooth(1.8, 4.8, p.y);
					// Two dents pinch the front.
					const dent = up * Math.exp(-(((off(a) - 0.75) / 0.36) ** 2));
					p.z *= 1 - 0.34 * dent;
					p.x *= 1 - 0.17 * dent;
					// Narrower towards the front, where the top is lower too.
					p.z *= 1 - 0.1 * up * smooth(0, 4, p.x);
					p.y -= 0.12 * up * p.x;
				},
				shadeAt: (p, a, i) => {
					const [y, f] = rows[i]!;
					const crease = y > 4 && f < 3.4 ? lerp(0.6, 0.85, smooth(4.3, 5.4, y)) : 1;
					return crease * (1 - 0.3 * smooth(2.5, 4.8, p.y) * Math.exp(-(((off(a) - 0.75) / 0.3) ** 2)));
				}
			});

			// Ribbon, with a thin dark line along both edges.
			const band = (y: number, d: number, shade = 1): Ring => hatRing(y, 5.36 + d - 0.07 * y, 5.66 + d - 0.07 * y, 5.01 + d - 0.07 * y, shade);
			b.loft(b.lod === 0 ? [band(-0.3, 0.18), band(0.28, 0.18), band(0.4, 0.2, 1.05), band(1.75, 0.2, 1.05), band(1.88, 0.18), band(1.9, -0.1)] : [band(-0.3, 0.2), band(1.9, 0.2), band(1.9, -0.15)], {
				seg,
				pal: PAL.hatB,
				palAt: (i) => (b.lod === 0 && i !== 2 ? PAL.hatD : PAL.hatB)
			});

			// Brim: down at the front, turned up at the back. Profile: top, edge, underside; [reach 0..1, drop].
			const profile = b.pick<readonly (readonly [number, number])[]>(
				[[-0.08, 0], [0.3, 0], [0.62, 0], [0.8, 0], [0.84, 0], [0.92, 0], [0.925, -0.07], [1, -0.05], [1, 0.3], [0.5, 0.28], [-0.08, 0.28]],
				[[-0.08, 0], [0.5, 0], [1, 0], [1, 0.3], [-0.08, 0.3]],
				[[-0.08, 0], [1, 0], [1, 0.32], [-0.08, 0.32]]
			);
			const bseg = b.pick(40, 18, 10);
			b.loft(
				// Heights only set the direction of the loft; `deform` places the points.
				profile.map(([k, drop], i) => ({ ...hatRing(-0.01 * i, 5.4 + 2.9 * k, 5.7 + 2.2 * k, 5.05 + 2.2 * k), shade: i >= profile.length - 2 && drop > 0 ? 0.9 : 1 })),
				{
					seg: bseg,
					pal: PAL.hatA,
					deform: (p: THREE.Vector3, _t, a, i) => {
						const [k, drop] = profile[i]!;
						const c = Math.cos(a);
						const k1 = Math.max(0, k);
						const back = smooth(0.1, 0.9, -c);
						p.y = -0.12 - drop + (c > 0 ? -1.0 * k1 ** 1.3 * c * c : 0) + 2.1 * k1 ** 1.4 * back + 0.25 * k1 * Math.sin(a) ** 2;
						// The turned-up back keeps its thickness.
						p.x -= drop * 0.7 * back * k1;
					},
					palAt: (i, a) => {
						if (b.lod > 0) return i >= profile.length - 3 ? PAL.hatD : PAL.hatA;
						// Dashed stitching and a bound edge.
						if (i === 3) return Math.floor((a / (Math.PI * 2)) * bseg) % 2 ? PAL.hatD : PAL.hatA;
						return i >= 5 ? PAL.hatD : PAL.hatA;
					}
				}
			);

			// Flat bow on the left.
			const bow = (x: number, h: number, t: number, shade = 1): Ring => ({ c: [x, 0.85, -5.18 + x * x * 0.05], f: h, s: t, n: 3, w: HEAD, shade });
			b.loft(
				b.pick(
					[bow(-1.95, 0.8, 0.14, 0.95), bow(-1.8, 0.9, 0.34), bow(-1.1, 0.82, 0.48, 1.12), bow(-0.35, 0.5, 0.3, 0.75), bow(0.35, 0.5, 0.3, 0.75), bow(1.1, 0.82, 0.48, 1.12), bow(1.8, 0.9, 0.34), bow(1.95, 0.8, 0.14, 0.95)],
					[bow(-1.9, 0.9, 0.35), bow(0, 0.5, 0.4, 0.8), bow(1.9, 0.9, 0.35)],
					[bow(-1.9, 0.9, 0.4), bow(1.9, 0.9, 0.4)]
				),
				{ seg: b.pick(10, 5, 4), u: [0, 1, 0], v: [0, 0, 1], pal: PAL.hatB, capStart: true, capEnd: true }
			);
			if (b.lod < 2) b.box([0, 0.85, -5.45], [0.62, 1.25, 0.5], { w: HEAD, pal: PAL.hatB, shade: 0.8 });

			// Feather behind the bow, leaning back; a dark tip.
			const D = [-0.6, 0.8] as const;
			const quill = (l: number, half: number, pal: number, shade = 1): Ring => ({ c: [-0.7 + D[0] * l, 0.9 + D[1] * l, -5.12 + 0.06 * l], f: half, s: 0.1, w: HEAD, pal, shade });
			b.loft(
				b.pick(
					[quill(0, 0.2, PAL.hatC), quill(1.1, 0.5, PAL.hatC), quill(2, 0.75, PAL.hatC, 1.05), quill(2.9, 0.82, PAL.hatC), quill(2.95, 0.62, PAL.hatC, 0.9), quill(3.7, 0.74, PAL.hatC, 1.05), quill(4.1, 0.62, PAL.hatB), quill(4.8, 0.4, PAL.hatB), quill(5.5, 0.05, PAL.hatB)],
					[quill(0, 0.2, PAL.hatC), quill(2.4, 0.8, PAL.hatC), quill(3.9, 0.68, PAL.hatB), quill(5.5, 0.05, PAL.hatB)],
					[quill(0, 0.3, PAL.hatC), quill(2.8, 0.85, PAL.hatC), quill(5.5, 0.1, PAL.hatC)]
				),
				{ seg: 4, u: [0.75, 0.56, 0.35], v: [-0.35, 0, 0.94], pal: PAL.hatC, capStart: true, capEnd: true }
			);
			// Its shaft.
			if (b.lod === 0) b.box([-0.7 + D[0] * 2.2, 0.9 + D[1] * 2.2, -5.1], [4.2, 0.09, 0.06], { w: HEAD, pal: PAL.hatD, rot: [0, 0.1, 2.22] });
		});
	}
});
