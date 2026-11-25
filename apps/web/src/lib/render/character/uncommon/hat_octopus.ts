/** Octopus hat: a chubby octopus sits on the head, its eight tentacles hold on and curl up at the tips. */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, type PartBuilder, type Ring } from '../mesh-kit.js';
import { HEAD, SIDES } from '../shop-items.js';
import { sideSign, type V3 } from '../skeleton.js';

const CORAL = PAL.hatA;
const PINK = PAL.hatB;
const WHITE = PAL.hatC;
const DARK = PAL.hatD;

/** Body from the inside of the rim to the top of the mantle: centre x, y, radius forward, back, sideways, how much the back drops. */
const ROWS: readonly (readonly number[])[] = [
	[0.1, 0.6, 4.9, 5.2, 4.5, 0.6],
	[0.1, 0.1, 5.6, 5.9, 5.2, 0.6],
	[0.1, 0.8, 6.0, 6.2, 5.6, 0.5],
	[0, 1.9, 5.75, 5.9, 5.35, 0.2],
	[-0.3, 3.2, 5.7, 5.8, 5.4, 0],
	[-0.8, 4.8, 5.9, 6.2, 5.9, 0],
	[-1.4, 6.6, 5.95, 6.4, 6.15, 0.1],
	[-2.0, 8.4, 5.4, 6.0, 5.7, 0.3],
	[-2.6, 9.9, 4.2, 4.9, 4.5, 0.5],
	[-3.1, 10.9, 2.4, 2.9, 2.6, 0.4],
	[-3.35, 11.2, 0.6, 0.7, 0.6, 0.1]
];
const TABLE = ROWS.map((r, i) => [i, ...r]);

/** Point of the body at a (fractional) row and an angle, 0 in front. */
function at(row: number, a: number, off = 0): THREE.Vector3 {
	const [, x, y, f, back, s, drop] = sample(TABLE, row) as [number, number, number, number, number, number, number];
	const c = Math.cos(a);
	return new THREE.Vector3(x + c * ((c > 0 ? f : back) + off), y + drop * c, Math.sin(a) * (s + off));
}

/** Outward direction of the body. */
function normal(row: number, a: number): THREE.Vector3 {
	const da = at(row, a + 0.05).sub(at(row, a - 0.05));
	return at(row + 0.4, a).sub(at(row - 0.4, a)).cross(da).normalize();
}

/** Tentacle: [angle round the head, distance from the head, height], root to tip; thickness at the root. */
interface Tentacle {
	r: number;
	pts: readonly V3[];
}
const TENTACLES: readonly Tentacle[] = [
	// Brow: forward, then curled up beside the eyes.
	{ r: 1.3, pts: [[0.5, -1.4, 2], [0.58, -0.1, 1.3], [0.7, 1.2, 0.95], [0.82, 2.5, 0.95], [0.9, 3.6, 1.7], [0.93, 3.7, 2.8], [0.92, 2.8, 3.3], [0.91, 2.1, 2.7]] },
	// In front of the ear.
	{ r: 1.38, pts: [[1.25, -1.3, 1.7], [1.3, 0, 0.8], [1.36, 0.75, -0.6], [1.4, 1.7, -2], [1.42, 3.1, -2.5], [1.44, 4.2, -1.6], [1.44, 3.9, -0.3], [1.43, 2.9, -0.2], [1.42, 2.7, -1]] },
	// Behind the ear.
	{ r: 1.38, pts: [[1.95, -1.3, 1.5], [2, 0, 0.4], [2.04, 0.45, -1.4], [2.08, 0.4, -3.2], [2.1, 1.1, -4.7], [2.12, 2.6, -5.1], [2.14, 3.5, -4], [2.14, 3, -2.9], [2.13, 2.15, -3.2]] },
	// Nape.
	{ r: 1.42, pts: [[2.65, -1.3, 1.1], [2.68, 0, 0], [2.7, 0.35, -1.7], [2.7, 0.2, -3.5], [2.68, 0.8, -5], [2.66, 2.2, -5.6], [2.64, 3.25, -4.7], [2.64, 2.9, -3.5], [2.64, 2, -3.7]] }
];

function tentacle(b: PartBuilder, t: Tentacle, k: 1 | -1, i: number): void {
	// The two sides differ a bit.
	const wob = k > 0 ? 0 : (i % 2 ? -1 : 1) * 0.09;
	const curve = new THREE.CatmullRomCurve3(
		t.pts.map(([a, out, y], j) => {
			const an = a + (wob * j) / t.pts.length;
			const c = Math.cos(an);
			return new THREE.Vector3(c * ((c > 0 ? 5.5 : 5.8) + out), y + (j > 3 ? wob * 3 : 0), k * Math.sin(an) * (5.1 + out));
		}),
		false,
		'centripetal'
	);
	const n = b.pick(10, 6, 4);
	// Frame at `u`: centre, towards the suckers, sideways, radius.
	const frame = (u: number) => {
		const c = curve.getPointAt(u);
		const d = curve.getTangentAt(u);
		const an = k * lerp(t.pts[0]![0], t.pts[t.pts.length - 1]![0], u);
		const s = new THREE.Vector3(-Math.sin(an), 0, Math.cos(an)).addScaledVector(d, -(-Math.sin(an) * d.x + Math.cos(an) * d.z)).normalize();
		const down = d.clone().cross(s).normalize();
		return { c, d, down, side: down.clone().cross(d), r: t.r * lerp(1, 0.4, u ** 1.15) * b.pick(1, 1.05, 1.2) };
	};
	const us = Array.from({ length: n }, (_, j) => (j === n - 1 ? 1 : (j / (n - 1)) ** b.pick(0.85, 0.75, 0.8)));
	const fr = us.map(frame);
	b.loft(
		us.map((_u, j): Ring => ({ c: [0, j, 0], f: 1, s: 1, w: HEAD, pal: j === n - 1 ? PINK : CORAL })),
		{
			seg: b.pick(7, 5, 4),
			capEnd: true,
			deform: (p, _t, a, j) => {
				const f = fr[j]!;
				const ca = Math.cos(a);
				// Flat underside; the tip is rounded off.
				const r = f.r * (j === n - 1 ? 0.72 : 1);
				p.copy(f.c).addScaledVector(f.down, ca * r * (ca > 0 ? 0.8 : 1)).addScaledVector(f.side, Math.sin(a) * r);
			},
			palAt: (_j, a) => (Math.cos(a) > b.pick(0.85, 0.5, 0.5) ? PINK : CORAL),
			shadeAt: (_p, a, j) => (j === 0 ? 0.8 : 1) * lerp(0.9, 1.04, 0.5 - 0.5 * Math.cos(a))
		}
	);
	if (b.lod > 0) return;
	// Suckers, staggered, smaller towards the tip.
	for (let j = 0; j < 4; j++) {
		const f = frame(0.48 + j * 0.145);
		const side = f.side.clone().multiplyScalar((j % 2 ? -1 : 1) * 0.2).add(f.down).normalize();
		const u = f.d.clone();
		const v = u.clone().cross(side).normalize();
		const c = f.c.clone().addScaledVector(side, f.r * 0.74);
		const r = f.r * 0.5;
		const ring = (h: number, q: number, pal: number, shade: number): Ring => ({ c: [c.x + side.x * h, c.y + side.y * h, c.z + side.z * h], f: q, s: q, w: HEAD, pal, shade });
		b.loft([ring(0, r, WHITE, 0.95), ring(r * 0.5, r * 0.8, PINK, 0.72)], { seg: 5, u: [u.x, u.y, u.z], v: [v.x, v.y, v.z], capEnd: true });
	}
}

function eye(b: PartBuilder, k: 1 | -1): void {
	const c = at(4.1, k * 0.44, -0.5);
	const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -k * 0.3, 0.1));
	/** Front of an ellipsoid. `from`: angle of the edge, π/2 is half of it. */
	const dome = (x: number, y: number, z: number, r: V3, from: number, n: number, seg: number, pal: number, shade = 1) =>
		b.loft(
			Array.from({ length: n }, (_, i): Ring => {
				const t = from * (1 - i / n);
				return { c: [x + Math.cos(t) * r[0], y, z * k], f: Math.sin(t) * r[1], s: Math.sin(t) * r[2], w: HEAD };
			}),
			{ seg, u: [0, 1, 0], v: [0, 0, 1], pal, capEnd: true, deform: (p) => void p.applyQuaternion(q).add(c), shadeAt: () => shade }
		);
	// Bump, eyeball, pupil, glints.
	if (b.lod === 0) dome(-0.3, 0.2, 0.1, [1.3, 2.3, 2.15], 1.7, 3, 10, CORAL, 1.02);
	dome(b.pick(0.3, 0.1, 0.1), 0, 0, [b.pick(1.4, 1.5, 1.5), 1.85, 1.75], 1.5, b.pick(4, 3, 2), b.pick(12, 8, 6), WHITE);
	dome(1, -0.05, -0.2, [b.pick(0.83, 0.95, 1), 1.22, 1.1], 1.5, 2, b.pick(12, 7, 6), DARK);
	if (b.lod > 0) return;
	dome(1.5, 0.48, 0.15, [0.4, 0.42, 0.4], 1.5, 2, 7, WHITE);
	dome(1.55, -0.5, -0.6, [0.25, 0.2, 0.2], 1.5, 2, 5, WHITE);
}

/** Round patch on the body. */
function spot(b: PartBuilder, row: number, a: number, r: number, pal: number, shade: number): void {
	const n = normal(row, a);
	// Units per row and per radian.
	const dr = at(row + 0.2, a).distanceTo(at(row - 0.2, a)) / 0.4;
	const da = at(row, a + 0.1).distanceTo(at(row, a - 0.1)) / 0.2;
	const seg = b.pick(7, 5, 4);
	const ring = Array.from({ length: seg }, (_, j) => {
		const t = (j / seg) * Math.PI * 2;
		return at(row + (Math.sin(t) * r * 0.85) / dr, a - (Math.cos(t) * r) / da).addScaledVector(n, 0.07);
	});
	const c = at(row, a).addScaledVector(n, 0.12 + r * 0.1);
	b.grid([ring, ring.map(() => c.clone())], { w: HEAD, pal, wrap: true, shadeAt: () => shade });
}

registerItemMesh('hat_octopus', {
	hides: ['hair'],
	colors: [0xee6a50, 0xf9c3b8, 0xfffaf2, 0x1d1620],
	build(b) {
		b.socket('hat', () => {
			const rows = b.pick([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [0, 1, 2, 4, 6, 7.5, 9, 10], [1, 2, 5, 7.3, 9.5]);
			b.loft(
				rows.map((r): Ring => ({ c: [0, r, 0], f: 1, s: 1, w: HEAD, pal: CORAL, shade: r === 0 ? 0.6 : 1 })),
				{
					seg: b.pick(20, 11, 9),
					capEnd: true,
					deform: (p, _t, a, i) => void p.copy(at(rows[i]!, a)),
					shadeAt: (_p, _a, i) => lerp(0.86, 1.03, smooth(1, 4, rows[i]!))
				}
			);
			for (const s of SIDES) {
				const k = sideSign(s);
				eye(b, k);
				TENTACLES.forEach((t, i) => tentacle(b, t, k, i));
				if (b.lod === 0) spot(b, 2.75, k * 0.62, 0.75, PINK, 0.94);
			}
			// Darker spots, uneven.
			if (b.lod < 2)
				for (const [row, a, r] of [[7.3, 0.35, 1.15], [8.2, -0.35, 0.8], [6.4, -0.75, 0.6], [6, 1.5, 1.2], [7.6, 1.15, 0.6], [6.6, -1.75, 1.2], [5, -1.4, 0.65], [7.2, 2.6, 1.1], [5.6, 3.2, 1], [6.2, -2.6, 0.75]].slice(0, b.pick(9, 4, 0)) as [number, number, number][])
					spot(b, row, a, r, CORAL, 0.68);
			// Smile.
			if (b.lod === 0)
				b.loft(
					[-1, -0.5, 0, 0.5, 1].map((t): Ring => {
						const p = at(2.55 + t * t * 0.5, t * 0.19, 0.02);
						const r = 0.2 * (1 - 0.45 * t * t);
						return { c: [p.x, p.y, p.z], f: r, s: r, w: HEAD };
					}),
					{ seg: 4, u: [1, 0, 0], v: [0, 1, 0], pal: DARK, capStart: true, capEnd: true }
				);
		});
	}
});
