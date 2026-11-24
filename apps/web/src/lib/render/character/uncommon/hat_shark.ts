/** Shark bite hat: a plush shark that swallows the head from above, felt teeth round the forehead, tail at the back. */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, type PartBuilder, type Ring } from '../mesh-kit.js';
import { HEAD, SIDES } from '../shop-items.js';
import { sideSign, type V3 } from '../skeleton.js';

const BLUE = PAL.hatA;
const WHITE = PAL.hatB;
const MOUTH = PAL.hatC;
const DARK = PAL.hatD;

/** From the forehead over the palate and the lip to the crown: front x, y; side z, y; back x, y. */
const ROWS: readonly (readonly number[])[] = [
	[4.0, 0.9, 3.9, 0.4, 4.9, -0.6],
	[6.2, 1.25, 4.6, -0.5, 6.0, -2.2],
	[8.0, 0.5, 5.4, -1.75, 6.75, -3.2],
	[8.75, 0.6, 5.95, -1.6, 7.2, -3],
	[9.35, 1.3, 6.2, -0.35, 7.4, -1.5],
	[9.5, 2.2, 6.2, 1.1, 7.2, 0.3],
	[8.7, 3.5, 5.8, 2.7, 6.4, 2.3],
	[6.6, 4.8, 4.8, 4.3, 5.4, 4.1],
	[3.6, 5.7, 3.1, 5.5, 3.6, 5.4],
	[0.5, 6.05, 0.5, 6.05, 0.5, 6.05]
];
const TABLE = ROWS.map((r, i) => [i, ...r]);

/** Point of the plush at a (fractional) row and an angle, 0 in front. */
function at(row: number, a: number, off = 0): THREE.Vector3 {
	const [, fx, fy, sz, sy, bx, by] = sample(TABLE, row) as [number, number, number, number, number, number, number];
	const c = Math.cos(a);
	const s = Math.sin(a);
	const k = Math.abs(c) ** 1.6;
	// The snout narrows towards the nose.
	const nose = 1 - 0.2 * smooth(0.35, 1, c);
	const p = new THREE.Vector3(c * (c > 0 ? fx + off : bx + off), lerp(sy, c > 0 ? fy : by, k), s * (sz + off) * nose);
	return p;
}

/** Cushion fin along a line; `chord` and `thick` are half sizes. */
function fin(b: PartBuilder, pts: readonly (readonly [number, number, number, number, number])[], v: V3, pal: number, tip = pal): void {
	b.loft(
		pts.map(([x, y, z, chord, thick], i): Ring => ({ c: [x, y, z], f: chord, s: thick, w: HEAD, pal: i >= pts.length - 2 ? tip : pal })),
		{ seg: b.pick(10, 5, 4), v, pal, capEnd: true, shadeAt: (_p, a) => (Math.abs(Math.cos(a)) > 0.95 ? 0.82 : 1) }
	);
}

function eye(b: PartBuilder, k: 1 | -1): void {
	const c = at(5.95, k * 0.82, 0);
	if (b.lod === 2) {
		b.ball([c.x, c.y, c.z], [1, 1.1, 0.9], { w: HEAD, pal: DARK, seg: 5, rings: 3 });
		return;
	}
	const rot: V3 = [k * -0.35, k * 0.75, 0];
	const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot));
	const put = (x: number, y: number, z: number): V3 => {
		const p = new THREE.Vector3(x, y, z * k).applyQuaternion(q).add(c);
		return [p.x, p.y, p.z];
	};
	b.ball(put(0, 0, 0.12), [1.15, 1.25, 0.5], { w: HEAD, pal: WHITE, seg: b.pick(10, 6, 5), rings: b.pick(5, 4, 3), rot });
	b.ball(put(0.22, -0.1, 0.45), [0.66, 0.78, 0.3], { w: HEAD, pal: DARK, seg: b.pick(8, 5, 5), rings: b.pick(4, 3, 3), rot });
	if (b.lod > 0) return;
	b.ball(put(0.48, 0.25, 0.7), [0.2, 0.2, 0.12], { w: HEAD, pal: WHITE, seg: 6, rings: 3, rot });
	// Heavy lid, a bit grumpy.
	b.ball(put(-0.05, 0.72, 0.16), [1.36, 0.62, 0.66], { w: HEAD, pal: BLUE, seg: 8, rings: 5, rot: [rot[0], rot[1], rot[2] - 0.22], shade: 0.86 });
}

registerItemMesh('hat_shark', {
	hides: ['hair'],
	colors: [0x5384a8, 0xf4f3ea, 0xd2434f, 0x1a232c],
	build(b) {
		b.socket('hat', () => {
			const rows = b.pick([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 2, 3, 4, 5.4, 7, 8.2, 9], [0, 2, 3, 4, 6, 8, 9]);
			const pal = (r: number) => (r < 2 ? MOUTH : r < 4 ? WHITE : BLUE);
			b.loft(
				rows.map((r): Ring => ({ c: [0, r, 0], f: 1, s: 1, w: HEAD, pal: pal(r) })),
				{
					seg: b.pick(28, 14, 9),
					capEnd: true,
					deform: (p, _t, a, i) => void p.copy(at(rows[i]!, a)),
					shadeAt: (p, a, i) => {
						const r = rows[i]!;
						if (r < 2) return [0.55, 0.75][Math.round(r)]!;
						// Seam over the back, soft shadow below the belly line.
						const seam = r >= 4 && (Math.abs(p.z) < 0.01 || (b.lod === 0 && r === 4)) ? 0.84 : 1;
						return seam * (r === 3 ? 0.92 : 1) * (b.lod === 0 ? 1 + 0.025 * Math.sin(a * 9 + r * 2) : 1);
					}
				}
			);
			// Felt teeth hang from the lip; biggest in front.
			const n = b.pick(21, 9, 5);
			for (let i = 0; i < n; i++) {
				const t = i / (n - 1) - 0.5;
				const a = t * 4.3;
				const p = at(2.45, a);
				const size = lerp(1, 0.68, smooth(0.15, 0.5, Math.abs(t))) * (b.lod === 0 ? 1 + (i % 2) * 0.16 : b.lod === 1 ? 1.35 : 1.9);
				const q = at(2.45, a + 0.02).sub(at(2.45, a - 0.02)).setY(0).normalize();
				const inw: V3 = [q.z, 0, -q.x];
				const u: V3 = [q.x, 0, q.z];
				const in2 = inw[0] * p.x + inw[2] * p.z > 0 ? -1 : 1;
				const tooth: Ring[] = [
					{ c: [p.x, p.y + 0.35, p.z], f: 0.64 * size, s: 0.26, w: HEAD },
					{ c: [p.x + in2 * inw[0] * 0.1, p.y - 0.45 * size, p.z + in2 * inw[2] * 0.1], f: 0.42 * size, s: 0.2, w: HEAD },
					{ c: [p.x + in2 * inw[0] * 0.25, p.y - 1.25 * size, p.z + in2 * inw[2] * 0.25], f: 0.05, s: 0.05, w: HEAD }
				];
				b.loft(tooth.filter((_, j) => b.lod === 0 || j !== 1), { seg: 4, u, v: inw, pal: WHITE });
			}
			for (const s of SIDES) {
				const k = sideSign(s);
				eye(b, k);
				// Side fins.
				fin(
					b,
					b.pick(
						[[-0.6, 0.9, k * 5.6, 1.9, 0.6], [-1.2, 0.3, k * 7.2, 1.75, 0.62], [-2.3, -0.8, k * 8.9, 1.35, 0.45], [-3.3, -1.7, k * 10, 0.75, 0.28], [-3.8, -2.1, k * 10.4, 0.2, 0.1]],
						[[-0.6, 0.9, k * 5.6, 1.9, 0.6], [-1.6, -0.1, k * 7.8, 1.6, 0.5], [-3.7, -2, k * 10.3, 0.3, 0.12]],
						[[-0.6, 0.9, k * 5.6, 2, 0.7], [-3.5, -1.8, k * 10.2, 0.6, 0.2]]
					),
					[0, 1, 0],
					BLUE
				);
				if (b.lod > 0) continue;
				// Gill slits.
				for (let i = 0; i < 3; i++) {
					const a = k * (1.72 + i * 0.2);
					const g = [4.3, 4.9, 5.6, 6.2].map((r, j) => at(r, a + k * 0.05 * Math.sin(j), 0.03));
					b.loft(
						g.map((p, j): Ring => ({ c: [p.x, p.y, p.z], f: j === 0 || j === 3 ? 0.05 : 0.2, s: 0.12, w: HEAD })),
						{ seg: 5, pal: DARK, capStart: true, capEnd: true }
					);
				}
				// Nostril.
				const nostril = at(5.2, k * 0.3, 0);
				b.ball([nostril.x, nostril.y, nostril.z], [0.16, 0.22, 0.3], { w: HEAD, pal: DARK, seg: 6, rings: 4, rot: [0, k * 0.5, 0] });
			}
			// Dorsal fin, swept back.
			fin(
				b,
				b.pick(
					[[-0.4, 5.3, 0, 2.9, 0.8], [-0.9, 6.8, 0, 2.3, 0.72], [-1.8, 8.4, 0, 1.6, 0.52], [-2.8, 9.7, 0, 0.85, 0.32], [-3.4, 10.3, 0, 0.25, 0.12]],
					[[-0.4, 5.3, 0, 2.9, 0.8], [-1.5, 8, 0, 1.8, 0.55], [-3.3, 10.2, 0, 0.35, 0.15]],
					[[-0.4, 5.2, 0, 2.9, 0.9], [-3, 10, 0, 0.6, 0.2]]
				),
				[0, 0, 1],
				BLUE
			);
			// Body tapers into the tail behind the head.
			const tail = b.pick(
				[[-4.6, 1.6, 3.4, 3.9], [-7.2, 1.9, 2.7, 2.9], [-9.4, 2.5, 1.9, 1.9], [-11.2, 3.5, 1.25, 1.1], [-12.6, 4.8, 0.9, 0.65], [-13.2, 5.6, 0.5, 0.35]],
				[[-4.6, 1.6, 3.4, 3.9], [-8.4, 2.1, 2.2, 2.3], [-11.2, 3.5, 1.2, 1], [-13.1, 5.4, 0.5, 0.35]],
				[[-4.6, 1.6, 3.4, 3.9], [-12.6, 4.6, 0.7, 0.6]]
			);
			b.loft(
				tail.map(([x, y, f, w]): Ring => ({ c: [x!, y!, 0], f: f!, b: f!, s: w!, w: HEAD })),
				{ seg: b.pick(16, 8, 6), u: [0, 1, 0], pal: BLUE, capEnd: true, palAt: (_i, a) => (Math.cos(a) < -0.7 ? WHITE : BLUE), shadeAt: (_p, a) => (Math.cos(a) > 0.999 ? 0.84 : 1) }
			);
			// Tail fluke: a tall upper and a short lower lobe.
			for (const [x, y, dx, dy] of [[-12.4, 4.6, -3.4, 5.2], [-12.4, 4.8, -2.2, -3.8]] as const)
				fin(
					b,
					b.pick([0, 0.35, 0.7, 1], [0, 0.5, 1], [0, 1]).map((t) => [x + dx * t, y + dy * t, 0, lerp(1.35, 0.25, t ** 1.3), lerp(0.55, 0.12, t)] as const),
					[0, 0, 1],
					BLUE
				);
		});
	}
});
