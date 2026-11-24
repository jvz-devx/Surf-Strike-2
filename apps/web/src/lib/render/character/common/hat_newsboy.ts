/** Newsboy cap: puffy eight-panel crown in herringbone tweed, a button on top and a short stiff brim. */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, superellipse, type PartBuilder } from '../mesh-kit.js';
import { HEAD, hatRing } from '../shop-items.js';

const TWEED = PAL.hatA;
const FLECK = PAL.hatB;
const BAND = PAL.hatC;
const BUTTON = PAL.hatD;

/** Crown: height, front, back and side radius. It balloons over the band. */
const CROWN: readonly (readonly [number, number, number, number])[] = [
	[-0.75, 5.4, 5.65, 5.0],
	[-0.2, 5.75, 6.1, 5.5],
	[0.4, 6.3, 6.75, 6.15],
	[1.1, 6.75, 7.15, 6.6],
	[1.8, 6.95, 7.25, 6.75],
	[2.45, 6.8, 7, 6.55],
	[3, 6.35, 6.5, 6.1],
	[3.45, 5.6, 5.75, 5.4],
	[3.8, 4.6, 4.75, 4.45],
	[4.05, 3.4, 3.5, 3.3],
	[4.2, 2.1, 2.15, 2.05],
	[4.25, 0.7, 0.75, 0.7]
];

const TABLE = CROWN.map((r, i) => [i, ...r]);

/** Distance to the nearest of the eight seams, 0..1. */
const seam = (a: number): number => Math.abs(((a / (Math.PI / 4)) % 1) - 0.5) * 2;

function buildBrim(b: PartBuilder): void {
	const cols = b.pick(17, 9, 5);
	const row = (k: number, drop: number) =>
		Array.from({ length: cols }, (_, j) => {
			const a = (j / (cols - 1) - 0.5) * 2.3;
			const c = Math.cos(a);
			return new THREE.Vector3(c * (5.3 + k * 3.1) - k * (1 - c) * 1.5 + 0.1, -0.15 - k * 0.75 - k * k * 0.35 - Math.sin(a) ** 2 * 0.75 * k - drop, Math.sin(a) * (5 + k * 0.25));
		});
	const ks = b.pick([0, 0.4, 0.75, 1], [0, 0.6, 1], [0, 1]);
	const top = ks.map((k) => row(k, 0));
	const under = ks.map((k) => row(k, 0.42));
	b.grid(top, { w: HEAD, pal: TWEED, shadeAt: (_p, i) => 0.92 + 0.08 * (i % 2) });
	b.grid(under, { w: HEAD, pal: BAND, flip: true, shadeAt: () => 0.8 });
	b.grid([top[top.length - 1]!, row(1.03, 0.21), under[under.length - 1]!], { w: HEAD, pal: TWEED, shadeAt: () => 0.8 });
	// Stitching along the edge.
	if (b.lod === 0)
		for (const k of [0.82, 0.62]) {
			const e = row(k, -0.05);
			const f = row(k + 0.025, -0.05);
			b.grid([e, f], { w: HEAD, pal: FLECK });
		}
}

registerItemMesh('hat_newsboy', {
	hides: ['hair'],
	colors: [0x93816a, 0x6f5f4d, 0x3d3029, 0x6e4a32],
	build(b) {
		b.socket('hat', () => {
			const seg = b.pick(48, 16, 8);
			// Rows as places in the table. Near, they zigzag: the bands between them make the herringbone.
			const last = CROWN.length - 1;
			const rows = b.pick(Array.from({ length: 21 }, (_, i) => (i === 20 ? last : lerp(0, last - 0.9, i / 19))), [0, 1, 3, 5, 7, 9, 11], [0, 3, 5, 8, 11]);
			b.loft(rows.map((_, i) => hatRing(i, 5, 5, 5)), {
				seg,
				pal: TWEED,
				capEnd: true,
				deform: (p, _t, a, i) => {
					const zig = b.lod === 0 && i > 1 && i < 20 && Math.round((a / (Math.PI * 2)) * seg) % 2 ? 0.42 : 0;
					const [, y, f, back, r] = sample(TABLE, rows[i]! + zig) as [number, number, number, number, number];
					const [ca, sa] = superellipse(a, 2.2);
					p.set(0.1 + (ca >= 0 ? f : back) * ca, y, r * sa);
					// Panels puff out between the seams.
					const full = smooth(-0.6, 1.2, y) * (b.lod === 2 ? 0 : 1);
					const k = 1 - 0.055 * full * smooth(0.55, 1, seam(a));
					p.x *= k;
					p.z *= k;
					// Slouches to the front, onto the brim.
					p.x += 0.35 * smooth(0, 2, y);
					p.y -= 0.11 * p.x * smooth(0, 3, y);
					if (b.lod === 0) p.y -= 0.12 * smooth(0.6, 1, seam(a)) * smooth(2, 3.4, y);
				},
				palAt: (i) => (b.lod === 0 && i > 0 && i % 2 === 0 ? FLECK : TWEED),
				shadeAt: (p, a) => lerp(0.8, 1, smooth(-0.6, 1, p.y)) * (b.lod < 2 ? lerp(1, 0.74, smooth(0.7, 1, seam(a))) : 1)
			});
			// Dark band, only seen at the edge.
			b.loft([hatRing(-1.05, 4.9, 5.1, 4.6, 0.7), hatRing(-1.05, 5.4, 5.65, 5.05), hatRing(-0.5, 5.55, 5.85, 5.2)], { seg: b.pick(32, 14, 8), pal: BAND });
			b.ball([0.4, 4.22, 0], [0.75, 0.42, 0.75], { w: HEAD, pal: BUTTON, seg: b.pick(12, 6, 4), rings: b.pick(6, 4, 3) });
			buildBrim(b);
		}, { pos: [0, 0.5, 0], scale: 1, rot: [0, 0, 0.03] });
	}
});
