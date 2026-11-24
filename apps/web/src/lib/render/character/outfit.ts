/**
 * The default clothes (docs/characters.md): surf tee, trousers and sneakers.
 * Also a reference for new `top`, `bottom` and `shoes` items: reuse the
 * weights and tables here so the clothes move with the body.
 */
import { alongArm, armSide, armWeights, legWeights } from './body.js';
import { bone, lerp, mix, PAL, sample, smooth, type PartBuilder, type Ring, type Weights } from './mesh-kit.js';
import { BIND, sideSign, type Side } from './skeleton.js';

const SIDES: readonly Side[] = ['L', 'R'];

/** Torso surface: y, front x, back x, half width. */
export const TORSO_TABLE: readonly (readonly number[])[] = [
	[36, 5.25, -5.6, 8.0],
	[38.6, 4.95, -5.2, 7.55],
	[42, 4.45, -4.5, 6.8],
	[45, 4.75, -4.5, 7.1],
	[48, 5.35, -4.9, 7.8],
	[51, 5.75, -5.3, 8.6],
	[53.2, 5.5, -5.4, 9.0],
	[55.2, 4.7, -5.1, 8.8],
	[56.6, 3.6, -4.5, 7.6],
	[57.7, 2.7, -3.8, 5.2],
	[58.5, 2.3, -3.2, 3.2],
	[59, 1.9, -2.7, 2.4]
];

/** Torso weights by bind height; the shoulders follow the collar bones. */
export function torsoWeights(y: number, z = 0): Weights {
	if (y < 42.5) return mix('pelvis', 'spine', smooth(36, 43, y));
	if (y < 49) return mix('spine', 'chest', smooth(42.5, 48.5, y));
	const side: Side = z > 0 ? 'R' : 'L';
	const k = smooth(4.5, 9, Math.abs(z)) * smooth(50, 55, y) * 0.55;
	if (y > 57.5 && k < 0.05) return mix('chest', 'neck', smooth(57.5, 59.5, y) * 0.35);
	return mix('chest', `clav${side}`, k);
}

/** Torso loft from `y0` up to the collar, with a hem turned inwards. */
export function torsoRings(y0: number, ys: readonly number[], grow = 0): Ring[] {
	const ring = (y: number, d: number): Ring => {
		const r = sample(TORSO_TABLE, y);
		return { c: [0, y, 0], f: r[1]! + d, b: -r[2]! + d, s: r[3]! + d, n: 2.35, w: torsoWeights(y) };
	};
	return [{ ...ring(y0 + 0.8, grow - 1), shade: 0.6 }, { ...ring(y0, grow - 0.25), shade: 0.85 }, ...ys.filter((y) => y > y0).map((y) => ring(y, grow))];
}

export function buildDefaultTop(b: PartBuilder): void {
	const ys = b.pick([38.4, 39.4, 42, 45, 48, 49.4, 51, 53.2, 55.2, 56.6, 57.7, 58.5], [38.4, 42, 46, 48.4, 51, 53.5, 56, 57.6, 58.5], [38.4, 44, 51, 55.5, 58.5]);
	b.loft(torsoRings(37.2, ys, 0.15), {
		seg: b.pick(20, 12, 8),
		capEnd: true,
		weightAt: (p) => torsoWeights(p.y, p.z),
		deform:
			b.lod > 0
				? undefined
				: (p, _t, a) => {
						// Loose cloth: folds gathering at the waist, pecs and shoulder blades.
						const waist = Math.exp(-(((p.y - 42.5) / 3) ** 2));
						const k = 1 + 0.02 * waist * Math.sin(a * 5 + p.y * 0.9) + 0.012 * Math.sin(a * 3 - p.y * 0.7);
						p.x *= k;
						p.z *= k;
						if (p.x > 0) p.x += 0.35 * Math.exp(-(((p.y - 51.5) / 2.2) ** 2) - ((Math.abs(p.z) - 3.6) / 2.4) ** 2);
						else p.x -= 0.3 * Math.exp(-(((p.y - 52.5) / 2.4) ** 2) - ((Math.abs(p.z) - 4.4) / 2.2) ** 2);
					},
		palAt: (i, a) => {
			if (b.lod === 2) return i >= 4 ? PAL.topB : PAL.topA;
			if (i < 2) return PAL.topA;
			const next = ys[i - 2]!; // the first two rings are the turned-in hem
			// Chest stripe, yoke over the shoulders.
			if (next >= 48 && next < 49.2) return PAL.topC;
			if (next >= 57.5) return PAL.topC;
			if (next >= 53.2) return PAL.topB;
			return Math.abs(Math.sin(a)) > 0.985 && next < 48 ? PAL.topB : PAL.topA;
		},
		shadeAt: (p) => lerp(0.84, 1, smooth(37, 44, p.y)) * (Math.abs(p.z) > 6.6 && p.y > 46 && p.y < 54 ? 0.9 : 1)
	});
	buildCollar(b);
	for (const s of SIDES) buildSleeve(b, s, 7.4);
}

/** Collar rim: same weights as the neckline it sits on. */
export function buildCollar(b: PartBuilder, pal: number = PAL.topC): void {
	if (b.lod === 2) return;
	const w = torsoWeights(58.5);
	b.loft(
		[
			{ c: [-0.4, 57.9, 0], f: 3.0, b: 3.5, s: 4.2, w },
			{ c: [-0.4, 58.5, 0], f: 3.0, b: 3.35, s: 3.55, w },
			{ c: [-0.4, 59, 0], f: 2.9, b: 3.1, s: 3.1, w },
			{ c: [-0.4, 59.1, 0], f: 2.5, b: 2.7, s: 2.65, w, shade: 0.85 },
			{ c: [-0.4, 58.2, 0], f: 2.2, b: 2.4, s: 2.4, w, shade: 0.6 }
		],
		{ seg: b.pick(16, 9, 6), pal }
	);
}

/** Short or long sleeve ending `end` units from the shoulder, with a cuff band. */
export function buildSleeve(b: PartBuilder, s: Side, end: number, pals: { sleeve: number; cuff: number } = { sleeve: PAL.topB, cuff: PAL.topC }): void {
	const radius = (t: number): [number, number] => {
		const r = sample(
			[
				[-3.6, 1.4, 1.3],
				[-2.6, 2.7, 2.3],
				[-1.2, 3.3, 2.8],
				[0.6, 3.6, 3.15],
				[3, 3.55, 3.15],
				[5, 3.4, 3.05],
				[7.5, 3.3, 2.95],
				[11, 3.0, 2.85],
				[14, 3.0, 2.8],
				[20.5, 2.3, 2.1]
			],
			t
		);
		return [r[1]!, r[2]!];
	};
	const ring = (t: number, d = 0, pal = pals.sleeve, shade = 1): Ring => {
		const [f, r] = radius(t);
		return { c: alongArm(s, t), f: f + d, s: r + d, w: armWeights(s, t), pal, shade };
	};
	const ts = b.pick([-3.6, -2.6, -1.2, 0.6, 2.6, 4.4, 6, 8, 9.4, 11, 12.6, 14.5, 17], [-3.4, -1.2, 2, 5, 8, 11, 14, 17], [-3, 2, 9, 15]).filter((t) => t < end - 1.2);
	b.loft(
		[...ts.map((t) => ring(t)), ring(end - 1.1), ring(end - 1.1, 0.14, pals.cuff), ring(end, 0.2, pals.cuff), ring(end, -0.2, pals.cuff, 0.7), ring(end - 1, -0.7, pals.cuff, 0.5)],
		{ seg: b.pick(12, 7, 5), v: armSide(s), capStart: true, shadeAt: (p) => lerp(0.86, 1, smooth(0, 3, Math.abs(p.z) - 7)) }
	);
}

/** Trouser leg radii: bind y, front, back, sideways. */
const LEG_TABLE: readonly (readonly number[])[] = [
	[2.4, 3.15, 3.3, 2.95],
	[4.4, 3.25, 3.4, 3.05],
	[7, 3.1, 3.3, 2.95],
	[11, 3.2, 3.65, 3.15],
	[14.5, 3.3, 3.9, 3.3],
	[17.5, 3.45, 3.65, 3.35],
	[19.8, 3.75, 3.55, 3.45],
	[22.5, 3.75, 3.75, 3.55],
	[27, 4.2, 4.3, 3.95],
	[31, 4.7, 4.9, 4.3],
	[34, 4.85, 5.2, 4.3],
	[35.8, 4.5, 5.0, 3.5],
	[37, 3.2, 3.6, 2.2]
];

/** One trouser leg ending at bind height `end`. `fit`: extra radius at a height; `stripe`: sine of the side stripe's edge, `stripeTop`: where it starts. */
export function buildLeg(
	b: PartBuilder,
	s: Side,
	end: number,
	pals: { leg: number; cuff: number; stripe: number } = { leg: PAL.bottomA, cuff: PAL.bottomB, stripe: PAL.bottomB },
	o: { fit?: (y: number) => number; stripe?: number; stripeTop?: number } = {}
): void {
	const edge = o.stripe ?? 0.93;
	const z = BIND[`thigh${s}`][2];
	const out = sideSign(s);
	const ring = (y: number, d = 0, pal?: number, shade = 1): Ring => {
		const r = sample(LEG_TABLE, y);
		d += o.fit?.(y) ?? 0;
		return { c: [-0.2, y, z], f: r[1]! + d, b: r[2]! + d, s: r[3]! + d, n: y > 28 ? 2.5 : 2.15, w: legWeights(s, y), pal, shade };
	};
	const ys = b
		.pick([37, 35.8, 34, 31, 28, 25, 23, 21.5, 19.8, 18.2, 16.5, 14, 11, 8, 6], [37, 35, 31, 27, 23, 19.8, 17, 12, 7], [36.5, 32, 26, 19.8, 14, 6])
		.filter((y) => y > end + 1.2);
	const rows = [...ys.map((y) => ring(y)), ring(end + 1.1), ring(end + 1.1, 0.12, pals.cuff), ring(end, 0.22, pals.cuff), ring(end, -0.3, pals.cuff, 0.6), ring(end + 1.2, -0.9, pals.cuff, 0.45)];
	b.loft(rows, {
		seg: b.pick(12, 8, 5),
		capStart: true,
		pal: pals.leg,
		palAt: (i, a) => {
			if (rows[i]!.pal !== undefined) return rows[i]!.pal;
			// Side stripe down the outside.
			return b.lod < 2 && Math.sin(a) * out > edge && rows[i]!.c[1] < (o.stripeTop ?? 37) ? pals.stripe : pals.leg;
		},
		deform:
			b.lod > 0
				? undefined
				: (p, _t, a) => {
						// Creases behind the knee and bunching above the cuff.
						const knee = Math.exp(-(((p.y - 19) / 2.6) ** 2));
						const cuff = Math.exp(-(((p.y - end - 3.2) / 2.2) ** 2));
						const k = 1 + (0.02 * knee * (a > 2 && a < 4.3 ? 1 : 0.4) + 0.028 * cuff) * Math.sin(p.y * 2.3 + a * 2);
						p.x *= k;
						p.z = z + (p.z - z) * k;
					},
		shadeAt: (p) => lerp(0.78, 1, smooth(0, 3, Math.abs(p.z) + Math.max(0, p.y - 28) * 0.35)) * lerp(0.9, 1, smooth(end, end + 6, p.y))
	});
}

/** Seat and waistband joining the legs. */
export function buildSeat(b: PartBuilder, pals: { seat: number; belt: number; buckle: number } = { seat: PAL.bottomA, belt: PAL.bottomC, buckle: PAL.bottomD }): void {
	const p = bone('pelvis');
	const pel = bone('pelvis');
	b.loft(
		[
			{ c: [-0.4, 30.6, 0], f: 1.6, b: 2.2, s: 2, w: p, shade: 0.74 },
			{ c: [-0.35, 31.8, 0], f: 3.3, b: 4.1, s: 5.2, n: 2.6, w: p, shade: 0.8 },
			{ c: [-0.3, 33, 0], f: 4.35, b: 5, s: 8, n: 2.8, w: p, shade: 0.92 },
			{ c: [-0.2, 34.4, 0], f: 5.0, b: 5.4, s: 8.35, n: 2.7, w: p },
			{ c: [-0.1, 35.8, 0], f: 4.9, b: 5.35, s: 7.95, n: 2.5, w: p },
			{ c: [0, 36.4, 0], f: 4.75, b: 5.15, s: 7.5, n: 2.4, w: pel },
			{ c: [0, 36.4, 0], f: 4.9, b: 5.3, s: 7.6, n: 2.4, w: pel, pal: pals.belt },
			{ c: [0, 38, 0], f: 4.6, b: 4.9, s: 7.1, n: 2.3, w: mix('pelvis', 'spine', 0.15), pal: pals.belt },
			{ c: [0, 39, 0], f: 3.4, b: 3.8, s: 6, n: 2.3, w: mix('pelvis', 'spine', 0.35), pal: pals.belt, shade: 0.7 }
		],
		{
			seg: b.pick(18, 10, 6),
			pal: pals.seat,
			capStart: true,
			capEnd: true,
			// The outer seat follows the thighs.
			weightAt: (q, i) => (i > 5 ? (i > 6 ? mix('pelvis', 'spine', i === 7 ? 0.15 : 0.35) : pel) : mix('pelvis', q.z > 0 ? 'thighHR' : 'thighHL', smooth(1, 6, Math.abs(q.z)) * 0.75))
		}
	);
	if (b.lod === 0) b.box([4.85, 36.9, 0], [0.35, 1.2, 1.8], { w: pel, pal: pals.buckle });
}

export function buildDefaultBottom(b: PartBuilder): void {
	buildSeat(b);
	for (const s of SIDES) buildLeg(b, s, 3.1);
}

/** Sneaker outline: x, sole half width, upper top y, centre shift (the big toe side is fuller). */
export const SHOE_TABLE: readonly (readonly number[])[] = [
	[-4.4, 1.2, 3.2, 0],
	[-4.0, 1.9, 4.6, 0],
	[-2.6, 2.35, 5.3, 0],
	[-0.6, 2.35, 5.4, 0],
	[1.2, 2.3, 4.6, -0.05],
	[3, 2.5, 3.7, -0.15],
	[4.8, 2.7, 3.05, -0.25],
	[6.4, 2.45, 2.6, -0.35],
	[7.5, 1.8, 2.1, -0.45],
	[8.1, 0.9, 1.6, -0.5]
];

/** Weights along a shoe: the sole bends at the ball of the foot. */
export const shoeWeights = (s: Side, x: number): Weights => mix(`foot${s}`, `toe${s}`, smooth(2.6, 5.4, x));

/** Upper and sole of a shoe. `palAt(x)`: palette of the upper; `sole`: its height and how far it stands out. */
export function buildShoeBase(
	b: PartBuilder,
	s: Side,
	o: { table?: readonly (readonly number[])[]; palAt: (x: number) => number; solePal?: number; soleHeight?: (x: number) => number; soleGrow?: number }
): void {
	const z0 = BIND[`foot${s}`][2] + sideSign(s) * 0.15;
	const T = o.table ?? SHOE_TABLE;
	const height = o.soleHeight ?? ((x: number) => lerp(1.5, 1.1, smooth(-2, 4, x)));
	const xs = b.pick([-4.4, -4.0, -2.6, -0.6, 1.2, 3, 4.8, 6.4, 7.5, 8.1], [-4.4, -3.2, -0.6, 2, 4.8, 7, 8.1], [-4.3, 0, 5, 8]);
	const row = (x: number) => {
		const r = sample(T, x);
		return { hw: r[1]!, top: r[2]!, z: z0 + sideSign(s) * r[3]! };
	};
	b.loft(
		xs.map((x): Ring => {
			const r = row(x);
			const lo = 0.9;
			return { c: [x, (r.top + lo) / 2, r.z], f: (r.top - lo) / 2, s: r.hw * 0.97, n: 2.5, w: shoeWeights(s, x) };
		}),
		{
			seg: b.pick(11, 7, 5),
			u: [0, 1, 0],
			v: [0, 0, 1],
			pal: PAL.shoesA,
			capStart: true,
			capEnd: true,
			palAt: (i) => o.palAt(xs[i]!),
			shadeAt: (p) => lerp(0.8, 1, smooth(0.8, 2.4, p.y))
		}
	);
	// Sole: a thicker heel, the toe curls up slightly.
	b.loft(
		xs.map((x): Ring => {
			const r = row(x);
			const lift = x > 6 ? (x - 6) * 0.22 : 0;
			const h = height(x);
			return { c: [x < -4 ? x - 0.2 : x > 7.8 ? x + 0.15 : x, h / 2 + lift, r.z], f: h / 2, s: r.hw + (o.soleGrow ?? 0.22), n: 5, w: shoeWeights(s, x) };
		}),
		{ seg: b.pick(10, 6, 4), u: [0, 1, 0], v: [0, 0, 1], pal: o.solePal ?? PAL.shoesB, capStart: true, capEnd: true }
	);
}

/** Laces across the instep. */
export function buildLaces(b: PartBuilder, s: Side, table = SHOE_TABLE, pal: number = PAL.shoesD, n = 4): void {
	if (b.lod > 0) return;
	const side = sideSign(s);
	const z0 = BIND[`foot${s}`][2] + side * 0.15;
	for (let i = 0; i < n; i++) {
		const x = 1.2 + i * 0.95;
		const y = sample(table, x)[2]! - 0.02;
		b.box([x, y, z0 - side * 0.1], [0.36, 0.3, 2.3], { w: shoeWeights(s, x), pal, rot: [0, 0, -0.45] });
	}
}

export function buildDefaultShoes(b: PartBuilder): void {
	for (const s of SIDES) {
		const z0 = BIND[`foot${s}`][2] + sideSign(s) * 0.15;
		buildShoeBase(b, s, { palAt: (x) => (x >= 4.8 || (b.lod < 2 && x < -2.6 && x > -4.3) ? PAL.shoesC : PAL.shoesA) });
		// Ankle collar and sock.
		const foot = bone(`foot${s}`);
		b.loft(
			[
				{ c: [-1.3, 4.2, z0], f: 2.4, b: 2.6, s: 2.25, w: foot },
				{ c: [-1.2, 5.3, z0], f: 2.35, b: 2.35, s: 2.2, w: foot },
				{ c: [-1.2, 5.4, z0], f: 2.0, b: 2.0, s: 1.9, w: foot, pal: PAL.shoesD },
				{ c: [-0.9, 8, z0], f: 1.95, b: 1.95, s: 1.85, w: mix(`foot${s}`, `shin${s}`, 0.8), pal: PAL.shoesD },
				{ c: [-0.7, 10, z0], f: 1.95, b: 1.95, s: 1.85, w: bone(`shin${s}`), pal: PAL.shoesD }
			],
			{ seg: b.pick(10, 6, 4), pal: PAL.shoesA }
		);
		buildLaces(b, s);
	}
}
