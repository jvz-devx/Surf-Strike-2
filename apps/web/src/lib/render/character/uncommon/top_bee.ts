/** Bee suit: chubby striped fur in overlapping jagged layers, a fluffy ruff, short black sleeves, two pairs of veined wings and a stinger. */
import * as THREE from 'three';
import { alongArm, armSide, armWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { bone, lerp, PAL, sample, smooth, superellipse, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { TORSO_TABLE, torsoWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import { sideSign, type Side } from '../skeleton.js';

const YELLOW = PAL.topA;
const BLACK = PAL.topB;
const FLUFF = PAL.topC;
const WING = PAL.topD;

const TAU = Math.PI * 2;
const N = 2.3;
/** Padding: y, front and back, sideways. */
const PAD: readonly (readonly number[])[] = [
	[35.8, 0.3, 0.25],
	[37.6, 1.2, 0.75],
	[40, 2.5, 1.3],
	[43, 3.1, 1.65],
	[46, 2.5, 1.2],
	[49, 1.3, 0.6],
	[52, 0.5, 0.25],
	[55, 0.4, 0.3],
	[57.5, 0.3, 0.3],
	[59, 0.15, 0.15]
];

const hash = (n: number): number => {
	const x = Math.sin(n * 127.1 + 11.7) * 43758.5453;
	return x - Math.floor(x);
};

function onBody(a: number, y: number, off: number, out = new THREE.Vector3()): THREE.Vector3 {
	const r = sample(TORSO_TABLE, y);
	const e = sample(PAD, y);
	const [c, s] = superellipse(a, N);
	return out.set((c >= 0 ? r[1]! + e[1]! + off : -r[2]! + e[1]! + off) * c, y, (r[3]! + e[2]! + off) * s);
}

const bend = (p: THREE.Vector3): Weights => torsoWeights(p.y, p.z);

/** Layers of fur from the shoulders down: lower edge and colour. */
const LAYERS: readonly (readonly [number, number])[] = [
	[55.4, YELLOW],
	[52.4, YELLOW],
	[49.8, BLACK],
	[47.3, BLACK],
	[44.9, YELLOW],
	[42.6, YELLOW],
	[40.5, BLACK],
	[38.5, BLACK],
	[36.3, YELLOW]
];

function buildBody(b: PartBuilder): void {
	if (b.lod > 0) {
		const e = b.pick(0, 0.2, 0.4);
		const bands = b.pick<readonly (readonly [number, number])[]>(
			[],
			[[58.5, YELLOW], [56.2, YELLOW], [52.4, BLACK], [49.8, BLACK], [47.3, YELLOW], [45, YELLOW], [42.6, BLACK], [40.5, BLACK], [38.5, YELLOW], [36.3, YELLOW]],
			[[58.3, YELLOW], [55.8, YELLOW], [52.4, BLACK], [47.3, YELLOW], [42.6, BLACK], [38.5, YELLOW], [36.4, YELLOW]]
		);
		const seg = b.pick(0, 12, 8);
		const rows = [...bands.map(([y, pal], i): Ring => ({ c: [0, y, 0], f: 1, s: 1, w: [], pal, shade: i % 2 ? 1 : 0.9 })), { c: [0, 37, 0], f: 1, s: 1, w: [], pal: YELLOW, shade: 0.5 } as Ring];
		b.loft(rows, {
			seg,
			deform: (p, _t, a, i) => void onBody(a, rows[i]!.c[1], i === bands.length ? -0.7 : e, p),
			weightAt: bend
		});
		return;
	}
	const seg = 20;
	LAYERS.forEach(([edge, pal], k) => {
		const top = k === 0 ? 58.5 : LAYERS[k - 1]![0] + 1.5;
		const last = k === LAYERS.length - 1;
		// [height, how far out]
		const prof: (readonly [number, number])[] = k === 0 ? [[58.5, 0], [57.6, 0.05], [56.6, 0.12], [edge, 0]] : [[top, -0.3], [lerp(top, edge, 0.55), 0.14], [edge, 0]];
		const jag = prof.length - 1;
		if (last) prof.push([edge + 0.8, -0.4], [edge + 1.6, -1.2]);
		b.loft(
			prof.map(([y], i): Ring => ({ c: [0, y, 0], f: 1, s: 1, w: [], shade: i > jag ? 0.5 : 1 })),
			{
				seg,
				pal,
				deform: (p, _t, a, i) => {
					const j = Math.round((a / TAU) * seg) + k * 1;
					const tip = j % 2 === 0;
					const r = hash(j * 3.7 + k * 17);
					const [y, off] = prof[i]!;
					if (i === jag) onBody(a, tip ? y - 0.35 - r * 0.45 : y + 0.75, tip ? 0.42 + r * 0.2 : 0.02, p);
					else onBody(a, y, off + (i > 0 && i < jag ? (tip ? 0.1 : -0.06) : 0), p);
				},
				weightAt: bend,
				shadeAt: (_p, a, i) => {
					const j = Math.round((a / TAU) * seg) + k;
					const under = Math.max(0, 1 - Math.abs(Math.sin(a)) ** 8 * 0.15);
					return under * (i === 0 ? 0.62 : i === jag ? (j % 2 === 0 ? 1.16 : 0.6) : 0.9 + 0.12 * hash(j * 5.1 + k));
				}
			}
		);
	});
}

/** Fluffy ruff: jagged layers round the neck. */
function buildRuff(b: PartBuilder): void {
	const neck = (a: number, y: number, r: number, p: THREE.Vector3): void => void p.set(-0.45 + Math.cos(a) * (r + (Math.cos(a) < 0 ? 0.2 : 0)), y, Math.sin(a) * (r + 0.3));
	const layers = b.pick(
		[[20, 54.4, 56.6, 0.8, 1.45, 3.7], [18, 56, 57.5, 1.15, 1.9, 3.5], [16, 57.4, 58.5, 1.2, 1.9, 3.2]] as const,
		[[14, 55.4, 56.9, 0.6, 1.0, 3.2]] as const,
		[[8, 55, 57, 1.3, 1.5, 3]] as const
	);
	layers.forEach(([seg, tipY, midY, mid, out, root], k) => {
		b.loft(
			[0, 1, 2].slice(b.lod === 2 ? 1 : 0).map((i): Ring => ({ c: [0, -i, 0], f: 1, s: 1, w: [] })),
			{
				seg,
				pal: FLUFF,
				deform: (p, _t, a, i0) => {
					const i = b.lod === 2 ? i0 + 1 : i0;
					const j = Math.round((a / TAU) * seg);
					const tip = j % 2 === 0;
					const r = hash(j * 2.3 + k * 31);
					const th = a + k * 0.13;
					if (i === 0 || (i === 1 && b.lod === 2)) neck(th, 58.7 + k * 0.1, root, p);
					else if (i === 1) onBody(th, midY, mid + (tip ? 0.15 : -0.1), p);
					else onBody(th, tip ? tipY + r * 0.5 : lerp(tipY, midY, 0.6), tip ? out : mid * 0.3, p);
				},
				weightAt: bend,
				shadeAt: (_p, a, i) => {
					const tip = Math.round((a / TAU) * seg) % 2 === 0;
					return i === 0 ? 0.9 : i === 1 && b.lod < 2 ? (tip ? 1 : 0.86) : tip ? 1.08 : 0.55;
				}
			}
		);
	});
	if (b.lod === 2) return;
	const row = (y: number, r: number, shade: number): Ring => ({ c: [-0.45, y, 0], f: r, b: r + 0.2, s: r + 0.3, w: torsoWeights(58.5), shade });
	b.loft(b.pick([row(58.5, 3.15, 0.9), row(59.2, 2.75, 1.05), row(58.9, 2.3, 0.8), row(58, 2.0, 0.5)], [row(58.4, 3.2, 0.9), row(59.1, 2.6, 1), row(58.2, 2.1, 0.6)], []), { seg: b.pick(12, 8, 6), pal: FLUFF });
}

const SLEEVE: readonly (readonly number[])[] = [
	// t, radius along X, radius sideways
	[-3.6, 1.45, 1.35],
	[-2.6, 2.9, 2.5],
	[-1.2, 3.55, 3.05],
	[0.6, 3.95, 3.5],
	[3, 4.0, 3.55],
	[5.6, 3.8, 3.4],
	[9, 3.5, 3.15]
];

function buildSleeve(b: PartBuilder, s: Side): void {
	const v = armSide(s);
	const z = sideSign(s);
	/** Layers: start, middle, edge along the arm, how far out, palette. */
	const layer = (ts: readonly number[], offs: readonly number[], seg: number, pal: number, jag: boolean, seed: number, inside: boolean) => {
		const n = ts.length - 1;
		const rows = [...ts, ...(inside ? (b.lod === 0 ? [ts[n]! - 0.6, ts[n]! - 1.8] : [ts[n]! - 1]) : [])];
		b.loft(
			rows.map((t, i): Ring => {
				const r = sample(SLEEVE, t);
				const d = i > n ? (i === n + 1 ? -0.35 : -0.75) : offs[i]!;
				return { c: alongArm(s, t), f: r[1]! + d, s: r[2]! + d, w: armWeights(s, t), shade: i > n ? 0.5 : 1 };
			}),
			{
				seg,
				v,
				pal,
				capStart: seed === 0,
				deform: (p, _t, a, i) => {
					if (!jag || i !== n) return;
					const j = Math.round((a / TAU) * seg);
					const tip = j % 2 === 0;
					const k = tip ? 0.45 + hash(j + seed * 9 + (z > 0 ? 4 : 0)) * 0.4 : -0.6;
					const c = alongArm(s, rows[i]!);
					const c2 = alongArm(s, rows[i]! + k);
					const g = tip ? 1.1 : 0.96;
					p.set(c2[0] + (p.x - c[0]) * g, c2[1] + (p.y - c[1]) * g, c2[2] + (p.z - c[2]) * g);
				},
				shadeAt: (_p, a, i) => {
					const tip = Math.round((a / TAU) * seg) % 2 === 0;
					return i === n && jag ? (tip ? 1.12 : 0.72) : i === 0 && seed > 0 ? 0.75 : 0.9 + (tip ? 0.12 : 0);
				}
			}
		);
	};
	if (b.lod === 0) {
		layer([-3.6, -2.4, -0.6, 1.6, 3.6], [0, 0, 0, 0.05, 0.1], 10, BLACK, true, 0, false);
		layer([2.6, 4.2, 5.9], [-0.25, 0.1, 0.1], 10, BLACK, true, 1, false);
		layer([4.9, 6.2, 7.2], [-0.1, 0.4, 0.35], 12, FLUFF, true, 2, false);
		layer([6, 7.2, 8.4], [-0.1, 0.25, 0.1], 12, FLUFF, true, 3, true);
	} else if (b.lod === 1) {
		layer([-3.4, -1.2, 2, 5.9], [0, 0, 0, 0], 7, BLACK, false, 0, false);
		layer([5.6, 6.8, 8.4], [-0.2, 0.5, 0.2], 8, FLUFF, true, 2, true);
	} else {
		layer([-3, 1, 6], [0, 0.2, 0.1], 5, BLACK, false, 0, false);
		layer([5.8, 8.4], [0.3, 0.3], 5, FLUFF, false, 2, false);
	}
}

// ---------------------------------------------------------------------------
// Wings (rigid on the chest)

const CHEST = bone('chest');

interface WingShape {
	root: readonly [number, number, number];
	/** Along the wing. */
	dir: readonly [number, number, number];
	len: number;
	wide: number;
}
const FORE: WingShape = { root: [-5.9, 53.6, 1.5], dir: [-0.52, 0.5, 0.69], len: 17.5, wide: 4.9 };
const HIND: WingShape = { root: [-6.0, 50.6, 1.5], dir: [-0.68, -0.02, 0.73], len: 11.5, wide: 3.7 };

/** Half outline: along 0..1, across; the upper edge is fuller. */
function wingOutline(th: number): [number, number] {
	const c = Math.cos(th);
	const s = Math.sin(th);
	const u = 0.5 - 0.5 * c;
	// Narrow at the root, round at the tip.
	const w = Math.abs(s) ** 0.9 * lerp(0.5, 1.08, smooth(0, 0.75, u));
	return [u, Math.sign(s) * w * (s > 0 ? 0.92 : 1.05)];
}

function buildWing(b: PartBuilder, s: Side, w: WingShape): void {
	const z = sideSign(s);
	const d = new THREE.Vector3(w.dir[0], w.dir[1], w.dir[2] * z).normalize();
	const root = new THREE.Vector3(w.root[0], w.root[1], w.root[2] * z);
	// The wing's plane holds the vertical, so both faces show from the front and the back.
	const e = new THREE.Vector3(0, 1, 0).addScaledVector(d, -d.y).normalize();
	const n = new THREE.Vector3().crossVectors(d, e);
	const at = (u: number, v: number, o: number): THREE.Vector3 =>
		root
			.clone()
			.addScaledVector(d, u * w.len)
			.addScaledVector(e, v * w.wide)
			.addScaledVector(n, o);
	const thick = b.pick(0.16, 0.2, 0.3);
	// Through the plate from the front face to the back face: scale, offset.
	const prof = b.pick<readonly (readonly [number, number])[]>(
		[[0.91, -1], [1, 0], [0.91, 1]],
		[[0.88, -1], [1, 0], [0.88, 1]],
		[[1, -1], [1, 1]]
	);
	const seg = b.pick(16, 8, 6);
	b.loft(
		prof.map((_, i): Ring => ({ c: [n.x * i, n.y * i, n.z * i], f: 1, s: 1, w: CHEST, pal: WING })),
		{
			seg,
			u: [d.x, d.y, d.z],
			v: [e.x, e.y, e.z],
			capStart: true,
			capEnd: true,
			deform: (p, _t, a, i) => {
				const [k, o] = prof[i]!;
				const [u, v] = wingOutline(a + Math.PI);
				p.copy(at(0.55 + (u - 0.55) * k, -v * k, o * thick));
			},
			palAt: (i) => (b.lod === 0 ? BLACK : undefined),
			shadeAt: (_p, a) => lerp(0.82, 1.08, 0.5 + 0.5 * Math.cos(a))
		}
	);
	if (b.lod === 2) return;
	// Veins, seen on both faces.
	const veins: readonly (readonly (readonly [number, number])[])[] = b.pick(
		[
			[[0.02, 0], [0.4, 0.2], [0.9, 0.42]],
			[[0.02, 0], [0.45, -0.1], [0.95, -0.12]],
			[[0.02, 0], [0.4, -0.42], [0.72, -0.8]],
			[[0.46, 0.22], [0.6, -0.11]],
			[[0.5, -0.11], [0.52, -0.55]]
		],
		[[[0.02, 0], [0.95, 0.3]], [[0.02, 0], [0.8, -0.5]]],
		[]
	);
	veins.slice(0, w === FORE ? 9 : b.pick(3, 1, 0)).forEach((path, k) => {
		const r = b.pick(k < 3 ? 0.2 : 0.14, 0.24, 0);
		b.loft(
			path.map((_, i): Ring => ({ c: [0, i, 0], f: 1, s: 1, w: CHEST })),
			{
				seg: 4,
				pal: BLACK,
				deform: (p, _t, a, i) => {
					const [u, v] = path[i]!;
					const [u0, v0] = path[Math.max(0, i - 1)]!;
					const [u1, v1] = path[Math.min(path.length - 1, i + 1)]!;
					const du = (u1 - u0) * w.len;
					const dv = (v1 - v0) * w.wide;
					const l = Math.hypot(du, dv);
					const thin = r * (i === path.length - 1 ? 0.5 : 1);
					// Through the wing, then across the vein.
					const across = -Math.sin(a) * thin;
					p.copy(at(u + (dv / l) * (across / w.len), v - (du / l) * (across / w.wide), 0)).addScaledVector(n, Math.cos(a) * (thick + 0.09));
				}
			}
		);
	});
}

function buildWings(b: PartBuilder): void {
	for (const s of SIDES) {
		const z = sideSign(s);
		buildWing(b, s, FORE);
		buildWing(b, s, HIND);
		// Fuzzy joint.
		if (b.lod === 0) for (const w of [FORE, HIND]) b.ball([w.root[0] + 0.1, w.root[1], w.root[2] * z], [0.9, 0.85, 0.85], { w: CHEST, pal: BLACK, seg: 6, rings: 3 });
	}
}

/** Stinger out of a tuft at the lower back. */
function buildStinger(b: PartBuilder): void {
	const w = torsoWeights(40.2);
	const x = onBody(Math.PI, 40.2, 0).x;
	const rows = b.pick<readonly (readonly [number, number, number])[]>(
		[[0.9, 40.6, 1.7], [-0.4, 40.4, 1.75], [-0.9, 40.2, 1.25], [-1.0, 40.2, 0.85], [-2.2, 39.6, 0.6], [-3.4, 38.5, 0.3], [-4.0, 37.6, 0.04]],
		[[0.6, 40.5, 1.6], [-0.8, 40.2, 1.2], [-2.2, 39.6, 0.6], [-4, 37.6, 0.05]],
		[[0.6, 40.5, 1.5], [-4, 37.6, 0.1]]
	);
	b.loft(
		rows.map(([dx, y, r], i): Ring => ({ c: [x + dx, y, 0], f: r, s: r, w, pal: b.lod === 0 && i < 3 ? FLUFF : BLACK, shade: i === 4 ? 1.8 : 1 })),
		{ seg: b.pick(9, 5, 4), u: [0.35, 0.94, 0], v: [0, 0, 1], capEnd: true }
	);
}

registerItemMesh('top_bee', {
	colors: [0xffc42a, 0x2b2322, 0xfff1cf, 0xcfe6ef],
	build(b) {
		buildBody(b);
		buildRuff(b);
		for (const s of SIDES) buildSleeve(b, s);
		buildWings(b);
		buildStinger(b);
	}
});
