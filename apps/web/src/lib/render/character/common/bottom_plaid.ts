/** Plaid golf trousers: coral, navy and white plaid, pleated front, white belt and a tapered leg. */
import * as THREE from 'three';
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { bone, lerp, mix, PAL, sample, smooth, superellipse, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

const BASE = PAL.bottomA;
const BAND = PAL.bottomB;
const CROSS = PAL.bottomC;
const WHITE = PAL.bottomD;

/** Leg: bind y, front, back, sideways. Roomy at the thigh, narrow at the hem. */
const LEG: readonly (readonly number[])[] = [
	[3.2, 3.15, 3.55, 3.0],
	[7, 3.1, 3.4, 2.98],
	[11, 3.25, 3.6, 3.2],
	[14.5, 3.45, 3.9, 3.4],
	[17.5, 3.65, 3.8, 3.5],
	[19.8, 3.95, 3.75, 3.65],
	[22.5, 4.1, 4, 3.85],
	[27, 4.6, 4.5, 4.15],
	[31, 4.95, 5.0, 4.35],
	[34, 4.95, 5.2, 4.3],
	[35.4, 4.45, 4.8, 3.6],
	[36.6, 3.0, 3.4, 2.2]
];
/** Seat: y, front, back, sideways, exponent. */
const SEAT: readonly (readonly number[])[] = [
	[30.6, 1.6, 2.2, 2, 2.2],
	[31.8, 3.3, 4.1, 5.2, 2.6],
	[33, 4.4, 5, 8, 2.8],
	[34.4, 5.05, 5.4, 8.35, 2.7],
	[35.6, 5, 5.4, 8.0, 2.5],
	[37, 4.8, 5.2, 7.6, 2.4],
	[38.6, 4.0, 4.4, 6.6, 2.3]
];
const HEM = 3.2;
const X = -0.2;

/** Threads of the plaid: 0 plain, 1 wide band, 2 thin line. */
type Thread = 0 | 1 | 2;
const weave = (u: Thread, v: Thread): number => (u === 2 || v === 2 ? WHITE : u === 1 && v === 1 ? CROSS : u || v ? BAND : BASE);
/** Rows from the waist down: heights and the thread below each. */
const REPEAT = 5.36;
const ROWS: readonly (readonly [number, Thread])[] = Array.from({ length: 6 }, (_, k) => ([[0, 1], [1.95, 0], [3.35, 2], [3.95, 0]] as const).map(([d, t]) => [35.4 - k * REPEAT - d, t] as const)).flat();
const rowThread = (y: number): Thread => [...ROWS].reverse().find(([top]) => top >= y - 1e-6)?.[1] ?? 1;
/** Four repeats around: column edges in degrees, and the thread after each. */
const COLS: readonly (readonly [number, Thread])[] = [[-15, 1], [15, 0], [41, 2], [49, 0]];

/** Columns of half the seat, the fly in the middle. */
const SEAT_COLS: readonly (readonly [number, Thread])[] = [[-75, 1], [-50, 0], [-24, 1], [-8, 0], [-1, 2], [1, 0], [8, 1], [24, 0], [50, 1], [75, 0]];

function seatWeights(y: number, z: number): Weights {
	if (y > 35.5) return mix('pelvis', 'spine', smooth(36.5, 39, y) * 0.3);
	return mix('pelvis', z > 0 ? 'thighHR' : 'thighHL', smooth(1, 6, Math.abs(z)) * lerp(0.75, 0.3, smooth(33, 35.4, y)));
}
/** Front of the hips. */
function hipX(y: number, z: number): number {
	const at = (r: number, s: number, n: number, dz: number) => (Math.abs(dz) >= s ? -Infinity : X + r * (1 - (Math.abs(dz) / s) ** n) ** (1 / n));
	const q = sample(SEAT, y);
	const l = sample(LEG, y);
	return Math.max(0, at(q[1]!, q[3]!, q[4]!, z), at(l[1]!, l[3]!, 2.5, Math.abs(z) - 4.3));
}
const cloth = (p: THREE.Vector3): number => lerp(0.76, 1, smooth(0, 3, Math.abs(p.z) + Math.max(0, p.y - 28) * 0.35)) * lerp(0.9, 1, smooth(3, 8, p.y));

function buildLegOf(b: PartBuilder, s: Side): void {
	const z0 = BIND[`thigh${s}`][2];
	const seg = b.pick(16, 8, 5);
	const angle = (a: number): number => {
		const j = Math.round((a / (Math.PI * 2)) * seg);
		if (b.lod === 0) return ((COLS[j % 4]![0] + Math.floor(j / 4) * 90) * Math.PI) / 180;
		return b.lod === 1 ? ((j % 2 ? 18 : -18) * Math.PI) / 180 + Math.floor(j / 2) * (Math.PI / 2) : a;
	};
	const ring = (y: number, d = 0, pal?: number, shade = 1): Ring => {
		const r = sample(LEG, y);
		d += b.pick(0, 0.15, 0.3) * (1 - smooth(28, 33, y));
		return { c: [X, y, z0], f: r[1]! + d, b: r[2]! + d, s: r[3]! + d, n: y > 28 ? 2.5 : 2.15, w: legWeights(s, y), pal, shade };
	};
	const ys = b.pick(ROWS.map(([y]) => y), [35.2, 33.3, 29.9, 28, 24.6, 22.7, 19.6, 17.7, 14.2, 12.3, 8.8, 6.9], [35, 30, 24, 19.8, 13, 8]);
	const rows = [ring(36.4), ...ys.map((y) => ring(y)), ring(HEM, b.pick(0.05, 0.15, 0.2)), ring(HEM, -0.4, CROSS, 0.6), ring(HEM + 1.4, -0.9, CROSS, 0.4)];
	b.loft(rows, {
		seg,
		capStart: true,
		pal: BASE,
		deform: (p, _t, a, i) => {
			const t = angle(a);
			const r = rows[i]!;
			const [c, n] = superellipse(t, r.n!);
			p.set(X + (c >= 0 ? r.f : r.b!) * c, r.c[1], z0 + r.s * n);
			if (b.lod > 0 || i > ys.length) return;
			// Creases behind the knee, a soft break above the shoe.
			const knee = Math.exp(-(((p.y - 19) / 2.6) ** 2)) * (c < -0.4 ? 1 : 0.3);
			const k = 1 + 0.022 * knee * Math.sin(p.y * 2.3 + t * 2) + 0.022 * Math.exp(-(((p.y - 6.5) / 2) ** 2)) * Math.sin(p.y * 2 + t);
			p.x = X + (p.x - X) * k;
			p.z = z0 + (p.z - z0) * k;
		},
		palAt: (i, a) => {
			if (rows[i]!.pal !== undefined) return rows[i]!.pal;
			const j = Math.floor((a / (Math.PI * 2)) * seg);
			if (b.lod === 0) return weave(COLS[j % 4]![1], i === 0 ? 0 : rowThread(rows[i]!.c[1]));
			return b.lod === 1 ? weave(j % 2 ? 0 : 1, i % 2 ? 1 : 0) : (i + j) % 2 ? BASE : BAND;
		},
		shadeAt: cloth
	});
	if (b.lod > 0) return;
	// Two pleats below the belt, and the pressed crease they run into.
	const out = sideSign(s);
	for (const [z, end, r] of [[3.1, 27.5, 0.17], [5.1, 31.2, 0.14]] as const) {
		const path = [35.5, 34, 32.2, 30, 27.5].filter((y) => y >= end);
		b.loft(
			path.map((y, i): Ring => {
				const zz = out * lerp(z, 4.2, smooth(36, 27, y) * 0.8);
				const k = 1 - i / path.length;
				return { c: [hipX(y, zz) - 0.02, y, zz], f: r * (0.4 + k), s: r * (0.6 + k * 0.8), w: y > 34 ? seatWeights(y, zz) : legWeights(s, y) };
			}),
			{ seg: 4, pal: BAND, capStart: true, capEnd: true, shadeAt: () => 0.8 }
		);
	}
	// Slanted pocket edge.
	const pocket = [[35.3, 6.3], [33.8, 6.9], [32.2, 7.5], [30.8, 7.9]].map(([y, z]) => new THREE.Vector3(hipX(y!, z!) + 0.02, y!, out * z!));
	b.loft(pocket.map((p): Ring => ({ c: [p.x, p.y, p.z], f: 0.15, s: 0.15, w: p.y > 34 ? seatWeights(p.y, p.z) : legWeights(s, p.y) })), { seg: 4, pal: WHITE, capStart: true, capEnd: true });
}

function buildHips(b: PartBuilder): void {
	const full = b.pick(0, 0.22, 0.35);
	const seg = b.pick(20, 10, 6);
	const at = (y: number, d = 0, pal?: number, shade = 1): Ring => {
		const q = sample(SEAT, y);
		d += full;
		return { c: [X, y, 0], f: q[1]! + d, b: q[2]! + d, s: q[3]! + d, n: q[4], w: bone('pelvis'), pal, shade };
	};
	const rows = b.pick([at(30.6), at(31.45), at(32.05), at(33.45), at(34.4), at(35.4), at(37), at(38.6)], [at(30.6), at(32), at(33.3), at(34.5), at(35.6), at(38.6)], [at(30.8), at(33.2), at(35), at(38.4)]);
	b.loft(rows, {
		seg,
		pal: BASE,
		capStart: true,
		capEnd: true,
		deform:
			b.lod > 0
				? undefined
				: (p, _t, a, i) => {
						const j = Math.round((a / (Math.PI * 2)) * seg);
						const r = rows[i]!;
						const [c, n] = superellipse(((SEAT_COLS[j % 10]![0] + (j >= 10 ? 180 : 0)) * Math.PI) / 180, r.n!);
						p.set(X + (c >= 0 ? r.f : r.b!) * c, r.c[1], r.s * n);
					},
		weightAt: (p) => seatWeights(p.y, p.z),
		palAt: (i, a) => {
			const j = Math.floor((a / (Math.PI * 2)) * seg);
			if (rows[i]!.c[1] >= 35) return WHITE;
			if (b.lod === 2) return (i + j) % 2 ? BASE : BAND;
			if (b.lod === 1) return weave(j % 2 ? 0 : 1, i % 2 ? 1 : 0);
			return weave(SEAT_COLS[j % 10]![1], rowThread(rows[i + 1]!.c[1]));
		},
		shadeAt: cloth
	});
	b.loft([at(35.45, -0.2, WHITE, 0.7), at(35.45, b.pick(0.24, 0.08, 0.05), WHITE, 0.92), at(36.95, b.pick(0.24, 0.08, 0.05), WHITE), at(37, -0.25, WHITE, 0.8)], { seg: b.pick(20, 10, 6), weightAt: (p) => seatWeights(Math.max(p.y, 35.6), p.z) });
	if (b.lod === 2) return;
	const pel = bone('pelvis');
	b.box([5.06 + full, 36.2, 0], [0.4, 1.75, 2.2], { w: pel, pal: CROSS });
	if (b.lod === 1) return;
	b.box([5.22, 36.2, 0], [0.18, 1.05, 1.5], { w: pel, pal: WHITE });
	b.box([5.3, 36.2, 0.2], [0.16, 0.26, 1.6], { w: pel, pal: CROSS });
	for (const z of [3.7, -3.7]) b.box([hipX(36.2, z) + 0.18, 36.2, z], [0.4, 1.95, 0.6], { w: seatWeights(36.2, z), pal: BASE, rot: [0, z * 0.05, 0] });
	// Fly.
	b.loft([[35.4, 0.9], [34, 0.9], [32.9, 0.6], [32.3, 0]].map(([y, z]): Ring => ({ c: [hipX(y!, z!) + 0.02, y!, z!], f: 0.1, s: 0.1, w: seatWeights(y!, z!) })), { seg: 4, pal: BAND, capStart: true, capEnd: true, shadeAt: () => 0.8 });
}

registerItemMesh('bottom_plaid', {
	hides: ['shins'],
	colors: [0xf08a70, 0xa2586c, 0x2c3466, 0xfbf6ea],
	build(b) {
		buildHips(b);
		for (const s of SIDES) buildLegOf(b, s);
	}
});
