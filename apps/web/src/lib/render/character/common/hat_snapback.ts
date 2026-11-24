/** Backwards snapback: cream crown with rust stitching, the half-moon and the strap on the forehead, a flat green brim behind. */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, superellipse, type PartBuilder } from '../mesh-kit.js';
import { HEAD } from '../shop-items.js';

const CROWN_PAL = PAL.hatA;
const BRIM = PAL.hatB;
const STITCH = PAL.hatC;
const STRAP = PAL.hatD;

/** Crown: height, front, back, side radius. Structured: upright at the back, where the front panels are. */
const CROWN: readonly (readonly number[])[] = [
	[-0.75, 5.4, 5.65, 5.05],
	[0.4, 5.45, 5.75, 5.1],
	[1.6, 5.2, 5.7, 4.95],
	[2.6, 4.6, 5.35, 4.45],
	[3.4, 3.7, 4.65, 3.75],
	[4.05, 2.6, 3.5, 2.7],
	[4.45, 1.4, 2, 1.5],
	[4.6, 0.3, 0.4, 0.3]
];
const LOW = -0.75;
/** Half-moon: its top and its half angle at the bottom. */
const MOON = 2.15;
const GAP = 0.6;
const gap = (y: number): number => (y >= MOON ? 0 : GAP * Math.sqrt(1 - (Math.max(0, y - 0.2) / (MOON - 0.2)) ** 2));

const at = (a: number, y: number, off = 0): THREE.Vector3 => {
	const r = sample(CROWN, y);
	const [c, s] = superellipse(a, 2.2);
	return new THREE.Vector3(0.1 + ((c >= 0 ? r[1]! : r[2]!) + off) * c, y, (r[3]! + off) * s);
};

/** Thin ribbon along points of the crown. */
function ribbon(b: PartBuilder, path: readonly (readonly [number, number])[], half: number, off: number, pal: number, shade = 1): void {
	const ps = path.map(([a, y]) => at(a, y, off));
	const rows = ps.map((p, i) => {
		const [a, y] = path[i]!;
		const t = ps[Math.min(i + 1, ps.length - 1)]!.clone().sub(ps[Math.max(i - 1, 0)]!);
		const n = at(a, y + 0.1).sub(at(a, y - 0.1)).cross(at(a + 0.05, y).sub(at(a - 0.05, y))).normalize();
		const d = t.cross(n).normalize().multiplyScalar(half);
		return [p.clone().sub(d), p.clone().add(d)];
	});
	b.grid(rows, { w: HEAD, pal, shadeAt: () => shade });
}

registerItemMesh('hat_snapback', {
	hides: ['hair'],
	colors: [0xe7dcc3, 0x2c5a45, 0xb9622f, 0x1d2a2a],
	build(b) {
		b.socket('hat', () => {
			const seg = b.pick(34, 16, 10);
			const ys = b.pick([LOW, -0.2, 0.2, 0.8, 1.3, 1.75, MOON - 0.06, MOON, 2.6, 3.4, 4.05, 4.45, 4.6], [LOW, 0.2, 1.3, MOON, 3.2, 4.1, 4.6], [LOW, 0.8, MOON, 3.6, 4.6]);
			// Crown, open in front below the half-moon.
			const row = (y: number, off = 0) =>
				Array.from({ length: seg + 1 }, (_, j) => {
					const g = gap(y);
					return at(lerp(g, Math.PI * 2 - g, j / seg), y, off);
				});
			const seams = (p: THREE.Vector3) => (b.lod > 0 ? 1 : 1 - 0.06 * smooth(0.9, 1, Math.abs(Math.cos(Math.atan2(p.z, p.x) * 3))));
			b.grid(ys.map((y) => row(y)), { w: HEAD, pal: CROWN_PAL, flip: true, shadeAt: (p) => lerp(0.9, 1, smooth(-0.7, 1, p.y)) * seams(p) });
			// Lining seen through the half-moon.
			const low = ys.filter((y) => y <= MOON);
			const cols = b.pick(9, 5, 4);
			for (const k of [1, -1])
				b.grid(
					low.map((y) => Array.from({ length: cols }, (_, j) => at(k * (gap(y) + (j / (cols - 1)) * 0.9), y, -0.18))),
					{ w: HEAD, pal: CROWN_PAL, flip: k < 0, shadeAt: () => 0.42 }
				);
			// Bound edge of the half-moon.
			const arch = b.pick(14, 8, 6);
			const moon = Array.from({ length: arch + 1 }, (_, i) => {
				const t = (i / arch) * Math.PI;
				return [GAP * Math.cos(t), 0.2 + (MOON - 0.2) * Math.sin(t)] as const;
			});
			const edge = [[GAP, LOW] as const, ...moon, [-GAP, LOW] as const];
			ribbon(b, edge, b.pick(0.2, 0.24, 0.3), 0.09, STITCH);
			const inner = edge.map(([a, y]) => at(a, y, 0));
			b.grid([inner.map((p) => p.clone().setX(p.x - 0.3)), inner], { w: HEAD, pal: CROWN_PAL, flip: true, shadeAt: () => 0.6 });
			// Strap with snaps across the gap.
			const sc = b.pick(11, 7, 5);
			const strap = (y: number, off: number) => Array.from({ length: sc }, (_, j) => at(lerp(-GAP - 0.2, GAP + 0.2, j / (sc - 1)), y, off));
			b.grid([strap(LOW, -0.05), strap(LOW, 0.2), strap(0.25, 0.2), strap(0.25, -0.05)], { w: HEAD, pal: STRAP, flip: true });
			if (b.lod === 0) {
				for (let i = 0; i < 6; i++) {
					const p = at((i / 5 - 0.5) * 1.25, -0.25, 0.22);
					b.ball([p.x, p.y, p.z], [0.16, 0.17, 0.17], { w: HEAD, pal: STRAP, seg: 6, rings: 4, shade: 2.6 });
				}
				ribbon(b, [[0.16, LOW], [0.16, 0.25]], 0.07, 0.23, STRAP, 0.5);
			}
			// Seams of the six panels, double stitched, and eyelets.
			if (b.lod < 2)
				for (const a of [Math.PI / 3, (2 * Math.PI) / 3, Math.PI, (4 * Math.PI) / 3, (5 * Math.PI) / 3, 0]) {
					const from = a === 0 ? MOON + 0.1 : LOW;
					const path = b.pick([from, 0.4, 1.6, 2.6, 3.4, 4.05, 4.45], [from, 1.6, 3.4, 4.4], []).filter((y) => y >= from);
					for (const d of b.pick([-1, 1], [0], [])) ribbon(b, path.map((y) => [a + (d * 0.13) / Math.max(1, sample(CROWN, y)[3]!), y] as const), b.pick(0.06, 0.12, 0), 0.07, STITCH);
				}
			if (b.lod === 0)
				for (let i = 0; i < 6; i++) {
					const c = at(((i + 0.5) * Math.PI) / 3, 3, 0.04);
					b.ball([c.x, c.y, c.z], [0.2, 0.2, 0.2], { w: HEAD, pal: STITCH, seg: 6, rings: 4 });
				}
			// Stitched line above the edge.
			if (b.lod === 0) ribbon(b, Array.from({ length: 25 }, (_, i) => [lerp(GAP + 0.1, Math.PI * 2 - GAP - 0.1, i / 24), -0.1] as const), 0.06, 0.06, STITCH);
			if (b.lod < 2) b.ball([0, 4.6, 0], [0.65, 0.35, 0.65], { w: HEAD, pal: BRIM, seg: b.pick(10, 6, 4), rings: 4 });
			// Flat brim behind.
			const bc = b.pick(17, 9, 5);
			const brim = (k: number, y: number) =>
				Array.from({ length: bc }, (_, j) => {
					const a = (j / (bc - 1) - 0.5) * 2.25;
					const c = Math.cos(a);
					return new THREE.Vector3(-(c * (5.35 + k * 4.5) - k * (1 - c) * 2.2), y - 0.25 - k * 0.75 - Math.sin(a) ** 2 * 0.25 * k, Math.sin(a) * (4.95 + k * 0.55));
				});
			const ks = b.pick([0, 0.5, 1], [0, 1], [0, 1]);
			b.grid(ks.map((k) => brim(k, 0)), { w: HEAD, pal: BRIM, flip: true });
			b.grid(ks.map((k) => brim(k, -0.36)), { w: HEAD, pal: BRIM, shadeAt: () => 0.7 });
			b.grid([brim(1, 0), brim(1.02, -0.18), brim(1, -0.36)], { w: HEAD, pal: BRIM, flip: true, shadeAt: () => 0.9 });
			if (b.lod === 0) for (const k of [0.3, 0.5, 0.7, 0.9]) b.grid([brim(k, 0.04), brim(k + 0.025, 0.04)], { w: HEAD, pal: STITCH, flip: true });
		}, { pos: [0, 0.1, 0], scale: 1 });
	}
});
