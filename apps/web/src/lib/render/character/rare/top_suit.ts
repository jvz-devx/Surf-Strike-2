/** Tailored suit jacket: shaped two-button jacket with peak lapels over a white shirt and a silk tie. */
import * as THREE from 'three';
import { alongArm, armSide, armWeights } from '../body.js';
import { button, line, patch, strip, Torso, wrinkle } from '../common/top_denim.js';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, type PartBuilder, type Ring } from '../mesh-kit.js';
import { torsoWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import { sideSign, type Side } from '../skeleton.js';
import { CHARCOAL, sheet, skirtWeights, WOOL } from './suit.js';

const CLOTH = PAL.topA;
const SHIRT = PAL.topB;
const TIE = PAL.topC;
const DARK = PAL.topD;

const HEM = 33;
/** Where the lapels meet, and where the fronts start to curve away. */
const ROLL = 44.4;
const CUT = 40;

const ease = (y: number): number =>
	0.16 + 0.22 * Math.exp(-(((y - 50.5) / 4) ** 2)) + 0.1 * Math.exp(-(((y - 42.5) / 2.5) ** 2)) + 0.4 * (1 - smooth(36, 40.5, y)) + 0.55 * (1 - smooth(32.5, 36.5, y));
const boxy = (y: number): number => 2.35 + 0.4 * (1 - smooth(34, 40, y));
const jacket = new Torso(ease, boxy);
const shirt = new Torso((y) => ease(y) - 0.42, boxy);

/** Half width of the opening in front. */
function opening(y: number): number {
	if (y < CUT) return 0.08 + 2.6 * ((CUT - y) / 7) ** 1.7;
	return sample([[CUT, 0.08], [ROLL, 0.08], [50, 1.45], [54.6, 2.5], [57, 2.75], [59, 2.6]], y)[1]!;
}

const clothShade = (p: THREE.Vector3): number =>
	lerp(0.68, 1.02, smooth(33, 49, p.y)) * (1 - 0.2 * smooth(5.6, 7.6, Math.abs(p.z)) * (1 - smooth(52, 55, p.y))) * (p.x > 0 ? 1 + 0.08 * Math.exp(-(((p.y - 50.5) / 3) ** 2)) : 1);

function buildBody(b: PartBuilder): void {
	const K = b.pick(8, 4, 2);
	const seg = 1 + 2 * (3 + K);
	const ys = b.pick([35, 36.8, 38.8, CUT, 42.8, ROLL, 46.6, 49, 51.4, 53.4, 55.2, 56.6, 57.7, 58.3], [35.6, CUT, ROLL, 49, 53, 56, 58.3], [37, 43, 50, 55.5, 58.3]);
	const all = [HEM + 1, HEM, ...ys];
	b.loft(all.map((y, i): Ring => ({ c: [0, i, 0], f: 1, s: 1, w: torsoWeights(y), shade: i === 0 ? 0.5 : i === 1 ? 0.9 : 1 })), {
		seg,
		pal: CLOTH,
		weightAt: (p) => skirtWeights(p),
		deform: (p, _t, a, i) => {
			const j = Math.round((a / (Math.PI * 2)) * seg) % seg;
			const sgn = j <= seg / 2 ? 1 : -1;
			const k = sgn > 0 ? j : seg - j;
			let y = all[i]!;
			const z = opening(Math.max(y, HEM));
			const w = jacket.angle(y, z);
			// Coarse facets would cut into the hips.
			const full = b.pick(0, 0.5, 1.2) * (1 - smooth(38.5, 42, y));
			const inner = (i === 0 ? -0.7 : 0) + full;
			if (k < 3) {
				// Shirt front, set back between the edges; deep inside the trousers below the waist.
				const deep = -0.46 - 2.2 * (1 - smooth(36.4, 38.4, y));
				p.copy(jacket.at(y, sgn * w * (k === 2 ? 1 : k * 0.6), deep + inner));
			} else {
				const vent = lerp(0.016, 0.006, smooth(36.5, 38.4, y)) * (1 - 0.6 * smooth(52, 57, y));
				// Far away: corners in front and behind, none in the middle of the back.
				const u = b.lod === 2 ? [0, 0.36, 0.76][k - 3]! : (k - 3) / K;
				p.copy(jacket.at(y, sgn * lerp(w, Math.PI - vent, u), inner));
				// Rounded front corners of the hem.
				if (i < 2) p.y += 1.15 * Math.exp(-(((Math.abs(p.z) - z) / 1.1) ** 2)) * (p.x > 0 ? 1 : 0);
			}
			// Neckline, tucked under the collar.
			const tuck = 1 - 0.14 * smooth(57, 58.3, p.y);
			p.x = -0.5 + (p.x + 0.5) * tuck;
			p.z *= tuck;
			if (i === all.length - 1 && b.lod < 2) p.y -= 0.2;
		},
		palAt: (i, a) => {
			const j = Math.floor((a / (Math.PI * 2)) * seg);
			const k = Math.min(j, seg - 1 - j);
			if (k < 2) return all[i]! < 36 ? DARK : SHIRT;
			return j === 3 + K && b.lod < 2 && all[i]! < 38 ? DARK : CLOTH;
		},
		shadeAt: (p, a) => {
			const j = Math.round((a / (Math.PI * 2)) * seg) % seg;
			const k = Math.min(j, seg - j);
			if (k < 3) return k === 2 ? 0.62 : 0.95;
			return clothShade(p);
		}
	});
}

const SLEEVE: readonly (readonly number[])[] = [
	[-3.6, 1.3, 1],
	[-2.5, 2.6, 1.8],
	[-0.8, 3.3, 2.5],
	[1, 3.6, 3],
	[4.5, 3.5, 3.1],
	[7.5, 3.3, 2.95],
	[11, 3.05, 2.8],
	[14, 2.9, 2.65],
	[17, 2.6, 2.4],
	[19.8, 2.35, 2.15]
];
const CUFF = 19.7;

function buildSleeves(b: PartBuilder): void {
	const ring = (s: Side, t: number, d = 0, pal: number = CLOTH, shade = 1): Ring => {
		const r = sample(SLEEVE, t);
		return { c: alongArm(s, t), f: r[1]! + d, s: r[2]! + d, w: armWeights(s, t), pal, shade };
	};
	const ts = b.pick([-3.6, -2.5, -0.8, 1, 4.5, 7.6, 9.6, 11.4, 13.6, 16.6], [-3.4, -0.8, 3, 8, 13], [-3, 2, 10]);
	for (const s of SIDES) {
		const n = ts.length;
		b.loft(
			[
				...ts.map((t) => ring(s, t)),
				ring(s, CUFF, 0.02),
				...b.pick(
					[ring(s, CUFF, -0.2, SHIRT, 0.7), ring(s, CUFF + 0.05, -0.26, SHIRT, 0.95), ring(s, 20.65, -0.3, SHIRT), ring(s, 20.65, -0.48, SHIRT, 0.8), ring(s, 20, -1.1, SHIRT, 0.4)],
					[ring(s, CUFF, -0.2, SHIRT), ring(s, 20.65, -0.25, SHIRT), ring(s, 20, -1.1, SHIRT, 0.5)],
					[ring(s, CUFF, -0.1, SHIRT), ring(s, 20.7, -0.2, SHIRT)]
				)
			],
			{
				seg: b.pick(12, 6, 5),
				v: armSide(s),
				capStart: true,
				deform: b.lod > 0 ? undefined : (p, _t, a, i) => i < n && wrinkle(p, s, ts[i]!, a),
				palAt: (i) => (i < n ? CLOTH : SHIRT),
				shadeAt: (p, a, i) => (i > n ? 1 : lerp(0.72, 0.98, smooth(0, 2.8, Math.abs(p.z) - 7.5)) * lerp(1, 0.86, smooth(4, 18, ts[i] ?? 20)) * (1 - 0.08 * Math.max(0, -Math.cos(a))))
			}
		);
		if (b.lod > 0) continue;
		// Row of cuff buttons on the outside.
		const v = armSide(s);
		for (let i = 0; i < 3; i++) {
			const r = ring(s, 19.2 - i * 0.75);
			const a = 2.05;
			b.ball([r.c[0] + r.f * Math.cos(a), r.c[1] + v[1] * r.s * Math.sin(a), r.c[2] + v[2] * r.s * Math.sin(a)], [0.3, 0.3, 0.3], { w: armWeights(s, 19 - i * 0.75), pal: DARK, seg: 5, rings: 2 });
		}
	}
}

/** Peak lapel, right side: [inner y, inner z, outer y, outer z] from the roll up to the gorge. */
const LAPEL: readonly (readonly number[])[] = [
	[43.9, 0.02, 43.9, 0.2],
	[45.4, 0.3, 45.8, 1.5],
	[47.6, 0.78, 48.2, 2.75],
	[50, 1.3, 50.8, 3.75],
	[52, 1.75, 53.2, 4.65],
	[53.1, 1.98, 54.9, 5.45],
	[54, 2.15, 54.15, 3.75],
	[54.8, 2.3, 54.8, 3]
];

function buildLapels(b: PartBuilder): void {
	const rows = b.pick(LAPEL, LAPEL.filter((_, i) => i % 2 === 1 || i === 0), [LAPEL[0]!, LAPEL[3]!, LAPEL[5]!, LAPEL[7]!]);
	for (const s of SIDES) {
		const k = sideSign(s);
		sheet(
			b,
			rows.map(([yi, zi, yo, zo]) => {
				const at = (t: number, off: number) => jacket.front(lerp(yi!, yo!, t), k * lerp(zi!, zo!, t), off);
				// The fold is a round roll, the edge lies close to the chest.
				return b.lod === 0 ? [at(0, -0.4), at(0.02, 0.3), at(0.14, 0.52), at(0.55, 0.42), at(1, 0.36), at(1, 0.02)] : [at(0, -0.4), at(0.06, 0.5), at(1, 0.42), at(1, 0)];
			}),
			{
				pal: CLOTH,
				flip: k < 0,
				shadeAt: (i, j, p) => clothShade(p) * (b.lod === 0 ? [0.5, 0.95, 1.3, 1.14, 1.24, 0.35] : [0.5, 1.25, 1.18, 0.45])[j]! * (i === 0 ? 0.95 : 1)
			}
		);
	}
}

/** Jacket collar, from the gorge round the nape to the other gorge. */
function buildCollar(b: PartBuilder): void {
	const n = b.pick(14, 8, 4);
	const rows = Array.from({ length: n + 1 }, (_, i) => {
		const t = lerp(-1, 1, i / n);
		const k = t < 0 ? 1 : -1;
		const u = 1 - Math.abs(t);
		const back = smooth(0.12, 0.62, u);
		const y = lerp(54, 58.6, smooth(0, 0.55, u));
		const ring = (d: number, dy: number) => {
			const q = lerp(0.75, Math.PI, u);
			return new THREE.Vector3(-0.5 + (3.75 + d) * Math.cos(q), y + dy, k * (3.95 + d) * Math.sin(q));
		};
		const sewn = (d: number, dy: number) => jacket.front(Math.min(y + dy, 57), k * lerp(2.1, 3, smooth(0, 0.3, u)), d);
		const fold = (d: number, dy: number) => sewn(0.35 + d, dy).lerp(ring(d, dy), back);
		const ye = lerp(54.2, 57.4, smooth(0, 0.32, u)) - 0.7 * smooth(0.5, 1, u);
		const edge = (d: number) => jacket.at(ye, k * lerp(jacket.angle(54.2, 3.75), Math.PI, u ** 0.9), d);
		const top = fold(0.16, 0.02);
		const e = edge(0.46);
		if (b.lod > 0) return [fold(-0.35, -0.9), top, e, edge(0)];
		return [fold(-0.35, -0.9), fold(-0.06, 0), top, top.clone().lerp(e, 0.5).addScaledVector(jacket.normal(ye, k * lerp(0.5, Math.PI, u)), 0.18), e, edge(0)];
	});
	sheet(b, rows, { pal: CLOTH, weightAt: () => torsoWeights(57), shadeAt: (_i, j) => (b.lod > 0 ? [0.45, 1.1, 1.06, 0.4] : [0.45, 0.8, 1.16, 1.04, 1.14, 0.35])[j]! });
}

/** Shirt collar: stands above the jacket's and folds down to two points beside the knot. */
function buildShirtCollar(b: PartBuilder): void {
	const n = b.pick(14, 8, 4);
	const rows = Array.from({ length: n + 1 }, (_, i) => {
		const t = lerp(-1, 1, i / n);
		const k = t < 0 ? 1 : -1;
		const u = 1 - Math.abs(t);
		const q = lerp(0.2, Math.PI, u);
		const y = lerp(57.5, 59.45, smooth(0.05, 0.6, u));
		const ring = (d: number, yy: number) => new THREE.Vector3(-0.5 + (2.95 + d) * Math.cos(q), yy, k * (3.1 + d) * Math.sin(q));
		const tip = 1 - smooth(0, 0.3, u);
		const edge = (d: number) => ring(0.32 + d, y - 1.5).lerp(shirt.front(54.7, k * 1.75, 0.3 + d), tip);
		return b.lod > 0 ? [ring(-0.4, y - 1), ring(0.1, y), edge(0.04)] : [ring(-0.45, y - 1), ring(-0.02, y - 0.02), ring(0.16, y), edge(0.06), edge(-0.25)];
	});
	sheet(b, rows, { pal: SHIRT, weightAt: () => torsoWeights(58.5), shadeAt: (_i, j) => [0.55, b.lod > 0 ? 1 : 0.85, 1.02, 1, 0.5][j]! });
}

function buildShirt(b: PartBuilder): void {
	buildShirtCollar(b);
	// Tie: knot with a dimple, then the blade disappearing into the jacket.
	const x = (y: number) => shirt.front(y, 0).x;
	const knot = (y: number, s: number, f: number, dx: number, shade = 1): Ring => ({ c: [x(y) + dx, y, 0], f, s, n: 2.6, w: torsoWeights(y), shade });
	if (b.lod < 2) b.loft(b.pick([knot(57.3, 0.7, 0.5, -0.1, 0.6), knot(56.95, 1, 0.75, 0.1, 1.15), knot(56.1, 0.85, 0.75, 0.2, 1.2), knot(55.1, 0.5, 0.55, 0.2, 0.7)], [knot(57.2, 0.85, 0.6, 0), knot(55.2, 0.5, 0.5, 0.14, 0.8)], [knot(57.2, 0.9, 0.6, 0), knot(55, 0.5, 0.5, 0.1)]), { seg: b.pick(8, 5, 4), pal: TIE, capStart: true, capEnd: true });
	const ys = b.pick([55.5, 54.5, 54.15, 52.9, 52.55, 51.3, 50.95, 49.7, 49.35, 48.1, 47.75, 46.2, 45.8, 44.2], [55.6, 53, 49, 44.2], [57, 50, 44.2]);
	sheet(
		b,
		ys.map((y) => {
			const w = lerp(0.5, 1.2, 1 - smooth(46.5, 56.5, y));
			const at = (k: number, h: number) => {
				const yy = Math.max(43.8, y + (b.lod === 0 ? k * w * 0.55 : 0));
				const p = shirt.front(yy, k * w, 0);
				return p.setX(p.x + h + b.pick(0, 0.25, 0.4));
			};
			return [at(-1, -0.1), at(-0.9, 0.2), at(0, 0.36), at(0.9, 0.2), at(1, -0.1)];
		}),
		{ pal: TIE, flip: true, shadeAt: (i, j) => [0.6, 0.95, 1.2, 0.8, 0.6][j]! * (i === 0 ? 0.6 : 1), palAt: b.lod === 0 ? (i) => (i % 2 === 1 ? DARK : TIE) : undefined }
	);
	if (b.lod < 2) b.box([x(50.35) + 0.36, 50.35, 0.1], [0.26, 0.3, 1.75], { w: torsoWeights(50.3), pal: SHIRT, shade: 0.82 });
}

/** Angle from the top towards +z, the order of the outlines of `patch`. */
const clockwise = (p: readonly number[]): number => (Math.atan2(p[0]!, p[1]!) + Math.PI * 2) % (Math.PI * 2);

function buildDetails(b: PartBuilder): void {
	if (b.lod === 2) return;
	for (const y of [43.2, 40.4]) button(b, jacket, y, 0.5, b.pick(0.46, 0.5, 0), 0.2, DARK);
	if (b.lod > 0) {
		patch(b, jacket, 51.6, -5.3, [[0, 0.7], [1, 0.7], [1, -0.4], [-1, -0.4]], [[1, 0.05, SHIRT, 0.7], [1, 0.28, SHIRT, 0.95]]);
		return;
	}
	// Breast welt and a pocket square folded to three points, on the heart side.
	patch(b, jacket, 50.95, -5.35, [[0, 0.3], [1.35, 0.36], [1.35, -0.28], [0, -0.36], [-1.35, -0.44], [-1.35, 0.2]], [[1, 0, CLOTH, 0.6], [1, 0.3, CLOTH, 1.05]]);
	patch(b, jacket, 51.6, -5.3, [[0.05, 0.75], [0.35, 0.45], [0.7, 0.95], [1.05, -0.35], [0, -0.4], [-1.05, -0.45], [-0.95, 0.55], [-0.45, 0.25]], [[1, 0.05, SHIRT, 0.7], [1, 0.24, SHIRT, 0.95], [0.5, 0.4, SHIRT, 1.05]]);
	// Centre back seam, down to the vent.
	strip(b, jacket, line(jacket, [56.6, 0], [38, 0], 5, true), 0.07, 0.05, CLOTH, { shade: 0.5 });
	for (const s of SIDES) {
		const k = sideSign(s);
		// Slanted flap pockets.
		patch(b, jacket, 38.7, k * 5, [[0, 0.55], [k * 1.6, 0.45], [k * 1.6, -0.75], [0, -0.75], [k * -1.6, -0.65], [k * -1.6, 0.65]].sort((p, q) => clockwise(p) - clockwise(q)) as [number, number][], [[1, -0.05, CLOTH, 0.45], [1, 0.22, CLOTH, 0.9], [0.8, 0.3, CLOTH, 0.96]]);
		// Darts: a fine line from the pocket to the chest.
		strip(b, jacket, line(jacket, [39.6, k * 4.3], [48, k * 3.9], 4), 0.07, 0.05, CLOTH, { shade: 0.5 });
		strip(b, jacket, line(jacket, [52.5, k * 5.9], [40, k * 4.3], 5, true), 0.07, 0.05, CLOTH, { shade: 0.5 });
	}
}
registerItemMesh('top_suit', {
	hides: ['upperArms', 'forearms'],
	// Wool, shirt, silk, buttons and seams.
	colors: [WOOL, 0xf6f6f2, 0x6a1a2c, CHARCOAL],
	build(b) {
		buildBody(b);
		buildSleeves(b);
		buildLapels(b);
		buildCollar(b);
		buildShirt(b);
		buildDetails(b);
	}
});
