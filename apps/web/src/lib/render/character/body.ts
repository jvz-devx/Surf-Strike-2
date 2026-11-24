/**
 * Body parts that belong to the person, not to clothing (docs/characters.md):
 * head, face, ears, hair, neck, arms, hands, shins. Each region is a separate
 * part, so a cosmetic can hide the ones it covers.
 */
import * as THREE from 'three';
import { bone, lerp, mix, PAL, sample, smooth, type PartBuilder, type Ring, type Weights } from './mesh-kit.js';
import { ANKLE_Y, armDir, BIND, FOREARM, KNEE_Y, sideSign, UPPER_ARM, type Side, type V3 } from './skeleton.js';

/** Regions a cosmetic item may hide. `hair` swaps to the flat under-hat hair. */
export const BODY_REGIONS = ['hair', 'neck', 'upperArms', 'forearms', 'hands', 'shins'] as const;
export type BodyRegion = (typeof BODY_REGIONS)[number];

export const HAIR_STYLES = ['swept', 'crop', 'bob', 'curls', 'ponytail'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

const SIDES: readonly Side[] = ['L', 'R'];
const HEAD = bone('head');

/** Head profile: y, front x, back x, half width, exponent. */
const HEAD_TABLE: readonly (readonly number[])[] = [
	[60.3, 2.9, -0.4, 1.2, 2],
	[60.7, 4.0, -1.4, 2.0, 2.1],
	[61.5, 4.55, -2.7, 2.75, 2.2],
	[62.6, 4.6, -3.7, 3.25, 2.3],
	[64.0, 4.5, -4.4, 3.7, 2.35],
	[65.4, 4.45, -4.9, 4.05, 2.4],
	[66.6, 4.4, -5.15, 4.1, 2.35],
	[67.8, 4.6, -5.2, 4.15, 2.3],
	[69.0, 4.3, -5.0, 4.0, 2.2],
	[70.2, 3.5, -4.3, 3.45, 2.1],
	[71.0, 2.3, -3.3, 2.6, 2],
	[71.5, 1.0, -2.0, 1.4, 2]
];
const HEAD_TOP = 71.65;
const HEAD_C = new THREE.Vector3(-0.35, 66.4, 0);

const st: number[] = [];
/** Point on the head surface; `a` = 0 front, π/2 right (+Z), π back. */
export function headPoint(a: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
	sample(HEAD_TABLE, y, st);
	const n = 2 / st[4]!;
	const c = Math.cos(a);
	const s = Math.sin(a);
	const ca = Math.sign(c) * Math.abs(c) ** n;
	const sa = Math.sign(s) * Math.abs(s) ** n;
	const x = ca >= 0 ? st[1]! * ca : -st[2]! * ca;
	return out.set(x, y, st[3]! * sa);
}

export function buildHead(b: PartBuilder): void {
	const seg = b.pick(16, 10, 6);
	const ys = b.pick(
		[60.3, 60.7, 61.5, 62.6, 63.4, 64.2, 65, 65.8, 66.6, 67.4, 68.2, 69, 70.2, 71, 71.5],
		[60.3, 61.2, 62.8, 64.6, 66.6, 68, 69.6, 71, 71.5],
		[60.4, 62.4, 66, 69.2, 71.3]
	);
	const rings: Ring[] = ys.map((y) => {
		const r = sample(HEAD_TABLE, y);
		return { c: [0, y, 0], f: r[1]!, b: -r[2]!, s: r[3]!, n: r[4]!, w: HEAD };
	});
	b.loft(rings, {
		seg,
		pal: PAL.skin,
		capStart: true,
		capEnd: true,
		deform:
			b.lod > 0
				? undefined
				: (p) => {
						if (p.x < 2) return;
						// Eye sockets and the hollow under the cheekbones.
						const ez = (Math.abs(p.z) - 1.75) / 1.1;
						const ey = (p.y - 66.3) / 0.95;
						p.x -= 0.55 * Math.exp(-ez * ez - ey * ey);
						const cz = (Math.abs(p.z) - 2.9) / 0.9;
						const cy = (p.y - 63.2) / 1.1;
						p.x -= 0.3 * Math.exp(-cz * cz - cy * cy);
					},
		shadeAt: (p) => lerp(0.82, 1, smooth(60.4, 62.4, p.y)) * (p.x > 3 && b.lod === 0 ? 1 - 0.12 * Math.exp(-(((Math.abs(p.z) - 1.75) / 1.2) ** 2) - ((p.y - 66.4) / 1) ** 2) : 1)
	});
	for (const s of SIDES) {
		const z = sideSign(s);
		// Ears.
		if (b.lod < 2) {
			b.ball([-0.7, 65.7, z * 4.15], [0.85, 1.35, 0.5], { w: HEAD, pal: PAL.skin, seg: b.pick(7, 5, 4), rings: b.pick(5, 4, 3), rot: [0, z * -0.35, 0.15] });
			if (b.lod === 0) b.ball([-0.55, 65.7, z * 4.5], [0.4, 0.8, 0.25], { w: HEAD, pal: PAL.skinDark, seg: 6, rings: 4, rot: [0, z * -0.35, 0.15] });
		}
		// Eyes: white, iris, upper lid, brow.
		if (b.lod === 0) {
			b.ball([3.75, 66.25, z * 1.72], [0.75, 0.78, 0.98], { w: HEAD, pal: PAL.eyeWhite, seg: 9, rings: 5 });
			b.ball([4.28, 66.22, z * 1.62], [0.32, 0.56, 0.52], { w: HEAD, pal: PAL.iris, seg: 8, rings: 4 });
			b.ball([3.78, 66.95, z * 1.74], [0.8, 0.34, 1.05], { w: HEAD, pal: PAL.skin, seg: 8, rings: 5, shade: 0.9, rot: [z * 0.08, 0, 0] });
			b.box([4.42, 67.75, z * 1.85], [0.45, 0.42, 1.9], { w: HEAD, pal: PAL.brow, rot: [z * 0.06, z * -0.24, 0] });
		} else if (b.lod === 1) {
			b.ball([3.95, 66.25, z * 1.75], [0.6, 0.7, 0.9], { w: HEAD, pal: PAL.eyeWhite, seg: 6, rings: 4 });
			b.box([4.5, 66.2, z * 1.62], [0.2, 0.9, 0.75], { w: HEAD, pal: PAL.iris });
			b.box([4.5, 67.6, z * 1.8], [0.5, 0.5, 1.9], { w: HEAD, pal: PAL.brow });
		} else b.box([4.35, 66.3, z * 1.75], [0.5, 1.1, 1.3], { w: HEAD, pal: PAL.iris });
	}
	if (b.lod === 0) {
		// Nose: a wedge from the bridge to a rounded tip, with nostril wings.
		b.loft(
			[
				{ c: [4.3, 66.9, 0], f: 0.3, s: 0.45, w: HEAD },
				{ c: [4.5, 66, 0], f: 0.55, s: 0.5, w: HEAD },
				{ c: [4.75, 65, 0], f: 0.85, s: 0.68, w: HEAD },
				{ c: [4.75, 64.35, 0], f: 0.95, s: 0.85, w: HEAD },
				{ c: [4.5, 63.95, 0], f: 0.55, s: 0.6, w: HEAD, shade: 0.8 }
			],
			{ seg: 8, pal: PAL.skin, capStart: true, capEnd: true }
		);
		// Mouth and lower lip.
		for (const z of [-1, 1]) b.ball([4.42, 62.75, z * 0.5], [0.3, 0.16, 0.85], { w: HEAD, pal: PAL.mouth, seg: 6, rings: 4, rot: [z * -0.14, 0, 0] });
		b.ball([4.5, 62.35, 0], [0.26, 0.2, 0.8], { w: HEAD, pal: PAL.skinDark, seg: 8, rings: 4 });
	} else if (b.lod === 1) {
		b.box([4.9, 65, 0], [1, 1.8, 1.1], { w: HEAD, pal: PAL.skin, shade: 0.94 });
		b.box([4.5, 62.6, 0], [0.25, 0.35, 2.2], { w: HEAD, pal: PAL.mouth });
	}
}

interface HairDef {
	/** Hairline height at an angle (0 front … π back). */
	line: (a: number) => number;
	/** Thickness at angle `a`, height fraction `t` (0 hairline, 1 crown). */
	thick: (a: number, t: number) => number;
}

const HAIR: Record<HairStyle, HairDef> = {
	swept: {
		line: (a) => hairline(a, 69.3, 66.6, 62.6),
		thick: (a, t) => 0.45 + 0.55 * smooth(0, 0.35, t) + 1.0 * Math.max(0, Math.cos(a * 0.9 - 0.25)) * smooth(0.05, 0.35, t) * (1 - smooth(0.5, 1, t)) + 0.16 * Math.sin(a * 9 + t * 4)
	},
	crop: {
		line: (a) => hairline(a, 69.4, 67, 63.4),
		thick: (_a, t) => 0.18 + 0.2 * smooth(0, 0.6, t)
	},
	bob: {
		line: (a) => hairline(a, 69.2, 61.2, 59.6),
		thick: (a, t) => 0.55 + 0.6 * smooth(0, 0.12, t) * (1 - 0.35 * smooth(0.5, 1, t)) + 0.1 * Math.sin(a * 11)
	},
	curls: {
		line: (a) => hairline(a, 68.9, 66.2, 62.6),
		thick: (a, t) => 0.9 + 0.75 * smooth(0, 0.4, t) * (1 - 0.4 * smooth(0.6, 1, t)) + 0.4 * Math.sin(a * 7 + Math.sin(t * 9) * 2) * Math.sin(t * 11 + a * 2)
	},
	ponytail: {
		line: (a) => hairline(a, 69.5, 66.4, 62.8),
		thick: (a, t) => 0.4 + 0.3 * smooth(0, 0.4, t) + 0.08 * Math.sin(a * 13 + t * 3)
	}
};

function hairline(a: number, front: number, temple: number, back: number): number {
	const t = Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) / Math.PI; // 0 front, 1 back
	if (t < 0.36) return lerp(front, front + 0.15, smooth(0, 0.28, t)) - (front - temple) * smooth(0.27, 0.39, t);
	// Around the ear (t ≈ 0.5-0.6), then down to the nape.
	const ear = 1.1 * Math.exp(-(((t - 0.53) / 0.09) ** 2));
	return temple + ear * (temple > 65 ? 1 : 0) - (temple - back) * smooth(0.56, 0.75, t);
}

const EDGE = new THREE.Vector3();

/** Hair shell of a style. `flat`: pressed down for a hat, only the rim below the band shows. */
export function buildHair(b: PartBuilder, style: HairStyle, flat: boolean): void {
	const def = HAIR[style];
	const seg = b.pick(30, 14, 8);
	const rows = b.pick(8, 4, 2);
	const pts: THREE.Vector3[][] = [];
	const row = (t: number, full: number) => {
		const line: THREE.Vector3[] = [];
		for (let j = 0; j < seg; j++) {
			const a = (j / seg) * Math.PI * 2;
			const y = lerp(def.line(a), HEAD_TOP - 0.15, t);
			const p = headPoint(a, y);
			EDGE.copy(p).sub(HEAD_C);
			EDGE.y *= 0.55;
			EDGE.normalize();
			let h = full === 0 ? -0.25 : def.thick(a, t) * full;
			// Long styles hang straight below the jaw instead of following it.
			if (y < 63.4) {
				const q = headPoint(a, 63.4);
				p.x = lerp(p.x, q.x, 0.9);
				p.z = lerp(p.z, q.z, 0.9);
			}
			if (flat && y > 67) h *= lerp(1, 0.1, smooth(67, 68.2, y));
			if (b.lod === 2) h *= 1.15;
			p.addScaledVector(EDGE, h);
			line.push(p);
		}
		pts.push(line);
	};
	row(0, 0);
	if (b.lod === 0) row(0.012, 0.6);
	for (let i = 0; i <= rows; i++) row(Math.max(0.05, i / rows), 1);
	b.grid(pts, { w: HEAD, pal: PAL.hair, wrap: true, flip: true, shadeAt: (p) => lerp(0.8, 1.05, smooth(62, 71, p.y)) });
	// Crown cap.
	const top = pts[pts.length - 1]!;
	const c = new THREE.Vector3();
	for (const p of top) c.add(p);
	c.divideScalar(seg);
	c.y += flat ? 0 : 0.2;
	b.grid([top, top.map(() => c)], { w: HEAD, pal: PAL.hair, wrap: true, flip: true });

	if (style === 'ponytail') {
		const seg2 = b.pick(10, 6, 4);
		// Lower under a hat.
		const d = flat ? 1.3 : 0;
		b.ball([-5.6, 67.2 - d, 0], [0.7, 1.2, 1.2], { w: HEAD, pal: PAL.brow, seg: seg2, rings: b.pick(6, 4, 3) });
		b.loft(
			[
				{ c: [-5.6, 67.5 - d, 0], f: 0.6, s: 0.6, w: HEAD },
				{ c: [-7.0, 67.0 - d, 0], f: 1.2, s: 1.5, w: HEAD },
				{ c: [-7.6, 64.6, 0], f: 1.3, s: 1.7, w: HEAD },
				{ c: [-7.4, 61.6, 0], f: 1.0, s: 1.4, w: mix('head', 'neck', 0.4) },
				{ c: [-6.9, 59.2, 0], f: 0.3, s: 0.5, w: mix('head', 'neck', 0.6) }
			],
			{ seg: seg2, pal: PAL.hair, capStart: true, capEnd: true, shadeAt: (p) => lerp(0.8, 1, smooth(59, 67, p.y)) }
		);
	}
	if (style === 'swept' && !flat && b.lod === 0) {
		// Quiff: overlapping locks combed up and to one side from the hairline.
		for (let i = 0; i < 5; i++) {
			const k = i / 4 - 0.5;
			const z = k * 5.2;
			const tall = 1.5 - Math.abs(k) * 0.9;
			b.loft(
				[
					{ c: [3.7 - Math.abs(k) * 1.6, 69.2, z], f: 0.7, s: 0.95, w: HEAD },
					{ c: [4.3 - Math.abs(k) * 1.6, 70.3, z + 0.2], f: 0.9, s: 1.1, w: HEAD },
					{ c: [3.5 - Math.abs(k) * 1.2, 70.8 + tall * 0.7, z + 0.6], f: 0.95, s: 1.0, w: HEAD },
					{ c: [1.5, 71 + tall * 0.75, z * 0.9 + 1.0], f: 0.7, s: 0.8, w: HEAD },
					{ c: [-0.6, 71.3, z * 0.8 + 1.2], f: 0.2, s: 0.3, w: HEAD }
				],
				{ seg: 7, pal: PAL.hair, capStart: true, capEnd: true, shadeAt: () => 1 + (i % 2) * 0.08 }
			);
		}
	}
	if (style === 'curls' && !flat && b.lod === 0) {
		// Loose curls along the fringe.
		for (let i = 0; i < 7; i++) {
			const a = (i / 6 - 0.5) * 2.1;
			const p = headPoint(a, 69.3 + (i % 2) * 0.5);
			b.ball([p.x + 0.35, p.y, p.z], [1.0, 0.95, 1.05], { w: HEAD, pal: PAL.hair, seg: 7, rings: 5, shade: 0.94 + (i % 3) * 0.05 });
		}
	}
}

export function buildNeck(b: PartBuilder): void {
	const w = (t: number): Weights => (t < 0.5 ? mix('chest', 'neck', t * 2) : mix('neck', 'head', (t - 0.5) * 2));
	b.loft(
		[
			{ c: [-0.6, 56, 0], f: 2.7, s: 3.1, w: w(0.1) },
			{ c: [-0.6, 58.2, 0], f: 2.4, s: 2.55, w: w(0.35) },
			{ c: [-0.4, 59.8, 0], f: 2.3, s: 2.4, w: w(0.65), shade: 0.9 },
			{ c: [-0.2, 61.6, 0], f: 2.5, s: 2.5, w: w(1), shade: 0.75 }
		],
		{ seg: b.pick(14, 8, 6), pal: PAL.skin }
	);
}

/** Point along an arm of the bind pose. */
export function alongArm(s: Side, t: number): V3 {
	const p = BIND[`upper${s}`];
	const d = armDir(s);
	return [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
}

/** Sideways axis of an arm (perpendicular to it and to X, pointing outwards). */
export function armSide(s: Side): V3 {
	const d = armDir(s);
	return s === 'R' ? [0, d[2], -d[1]] : [0, -d[2], d[1]];
}

/** Weights along the arm: shoulder helper, upper arm, elbow helper, forearm, hand. */
export function armWeights(s: Side, t: number): Weights {
	const U = UPPER_ARM;
	if (t < 0) return mix(`clav${s}`, `upperH${s}`, smooth(-4, 0, t));
	if (t < 3.4) return mix(`upperH${s}`, `upper${s}`, smooth(0, 3.4, t));
	if (t < U) return mix(`upper${s}`, `foreH${s}`, smooth(U - 2.6, U, t));
	const W = U + FOREARM;
	if (t < W - 1.6) return mix(`foreH${s}`, `fore${s}`, smooth(U, U + 2.6, t));
	return mix(`fore${s}`, `hand${s}`, smooth(W - 1.6, W + 0.4, t));
}

const ARM_TABLE: readonly (readonly number[])[] = [
	// t, radius along X, radius sideways
	[0, 2.9, 2.8],
	[4, 2.75, 2.7],
	[7.5, 2.5, 2.45],
	[10, 2.15, 2.15],
	[11, 2.2, 2.15],
	[13.5, 2.45, 2.25],
	[16.5, 2.0, 1.9],
	[19.6, 1.55, 1.35],
	[21.6, 1.55, 1.25]
];

function armRings(s: Side, ts: readonly number[]): Ring[] {
	return ts.map((t) => {
		const r = sample(ARM_TABLE, t);
		return { c: alongArm(s, t), f: r[1]!, s: r[2]!, w: armWeights(s, t), shade: lerp(0.86, 1, smooth(3, 7, t)) };
	});
}

const UPPER_TS = (b: PartBuilder) => b.pick([2.5, 5, 8.2, 9.6, 11], [3, 7, 11], [2, 7, 11]);
const FORE_TS = (b: PartBuilder) => b.pick([11, 12.4, 14.5, 17, 19.6, 21.6], [11, 14, 18, 21.6], [11, 15, 21.6]);

function buildArm(b: PartBuilder, ts: readonly number[]): void {
	for (const s of SIDES) b.loft(armRings(s, ts), { seg: b.pick(10, 6, 4), v: armSide(s), pal: PAL.skin });
}

export function buildUpperArms(b: PartBuilder): void {
	buildArm(b, UPPER_TS(b));
}

export function buildForearms(b: PartBuilder): void {
	buildArm(b, FORE_TS(b));
}

/** Both arm regions in one piece: no shading seam at the elbow. */
export function buildWholeArms(b: PartBuilder): void {
	buildArm(b, [...UPPER_TS(b), ...FORE_TS(b).slice(1)]);
}

export function buildHands(b: PartBuilder): void {
	const W = UPPER_ARM + FOREARM;
	for (const s of SIDES) {
		const v = armSide(s);
		const at = (t: number, x: number, o = 0): V3 => {
			const p = alongArm(s, t);
			return [p[0] + x, p[1] + v[1] * o, p[2] + v[2] * o];
		};
		const hand = bone(`hand${s}`);
		// Palm.
		b.loft(
			[
				{ c: at(W - 0.4, 0), f: 1.45, s: 1.15, n: 2.4, w: mix(`fore${s}`, `hand${s}`, 0.6) },
				{ c: at(W + 1, 0.1), f: 1.75, s: 1.1, n: 2.8, w: hand },
				{ c: at(W + 2.6, 0.1), f: 2.05, s: 1.1, n: 3, w: hand },
				{ c: at(W + 3.7, 0), f: 2.0, s: 0.95, n: 3, w: mix(`hand${s}`, `fingers${s}`, 0.5) },
				{ c: at(W + 4.1, 0), f: 1.8, s: 0.75, n: 3, w: mix(`hand${s}`, `fingers${s}`, 0.7) }
			],
			{ seg: b.pick(10, 6, 4), v, pal: PAL.skin, capStart: true, capEnd: true }
		);
		if (b.lod < 2) {
			const count = b.pick(4, 2, 0);
			for (let i = 0; i < count; i++) {
				const k = count === 4 ? 1.5 - i : (0.5 - i) * 1.9;
				const x = k * 1.02;
				const len = count === 4 ? [3.0, 3.3, 3.1, 2.5][i]! : 3.1;
				const f = count === 4 ? 0.5 : 0.95;
				const root = W + 3.5;
				b.loft(
					[
						{ c: at(root, x), f, s: 0.62, w: mix(`hand${s}`, `fingers${s}`, 0.6) },
						{ c: at(root + 1.4, x), f: f * 0.98, s: 0.58, w: mix(`fingers${s}`, `tips${s}`, 0.4) },
						{ c: at(root + len * 0.75, x), f: f * 0.9, s: 0.52, w: bone(`tips${s}`) },
						{ c: at(root + len, x), f: f * 0.55, s: 0.34, w: bone(`tips${s}`) }
					],
					{ seg: b.pick(5, 4, 4), v, pal: PAL.skin, capEnd: true, shadeAt: (p) => (b.lod === 0 ? lerp(0.9, 1, smooth(0.35, 0.5, Math.abs(p.x - at(0, x)[0]))) : 1) }
				);
			}
			// Thumb: from the base of the palm, forward and down.
			b.loft(
				[
					{ c: at(W + 1.1, 1.3), f: 0.75, s: 0.7, w: hand },
					{ c: at(W + 2.4, 2.35, -0.25), f: 0.62, s: 0.62, w: hand },
					{ c: at(W + 3.6, 2.75, -0.45), f: 0.52, s: 0.52, w: hand },
					{ c: at(W + 4.4, 2.85, -0.6), f: 0.3, s: 0.32, w: hand }
				],
				{ seg: b.pick(6, 5, 4), v, pal: PAL.skin, capEnd: true }
			);
		} else
			b.loft(
				[
					{ c: at(W + 3.6, 0), f: 1.8, s: 0.9, w: bone(`fingers${s}`) },
					{ c: at(W + 6.4, 0), f: 1.2, s: 0.6, w: bone(`tips${s}`) }
				],
				{ seg: 5, v, pal: PAL.skin, capEnd: true }
			);
	}
}

/** Dark talons over the fingertips (infected with claws). */
export function buildClaws(b: PartBuilder): void {
	const W = UPPER_ARM + FOREARM;
	for (const s of SIDES) {
		const v = armSide(s);
		const w = bone(`tips${s}`);
		for (let i = 0; i < 4; i++) {
			const x = (1.5 - i) * 1.02;
			const at = (t: number, o: number): V3 => {
				const p = alongArm(s, t);
				return [p[0] + x, p[1] + v[1] * o, p[2] + v[2] * o];
			};
			b.loft(
				[
					{ c: at(W + 5.8, 0.1), f: 0.5, s: 0.55, w },
					{ c: at(W + 7.4, 0), f: 0.36, s: 0.4, w },
					{ c: at(W + 9.2, -0.6), f: 0.06, s: 0.06, w }
				],
				{ seg: b.pick(5, 4, 3), v, pal: PAL.mouth, capStart: true, capEnd: true }
			);
		}
	}
}

/** Bare shins, for bottoms that end above them (hidden by the default trousers). */
export function buildShins(b: PartBuilder): void {
	for (const s of SIDES) {
		const z = BIND[`thigh${s}`][2];
		const ring = (y: number, f: number, r: number): Ring => ({ c: [-0.2, y, z], f, b: f * 1.05, s: r, w: legWeights(s, y) });
		b.loft(
			[ring(30, 4.3, 4.0), ring(25, 3.5, 3.3), ring(21.5, 2.9, 2.75), ring(KNEE_Y, 2.95, 2.7), ring(17, 2.7, 2.55), ring(14, 2.85, 2.7), ring(9, 2.1, 1.95), ring(ANKLE_Y + 0.5, 1.8, 1.65)],
			{ seg: b.pick(10, 7, 5), pal: PAL.skin }
		);
	}
}

/** Weights down a leg by bind height: hip helper, thigh, knee helper, shin, foot. */
export function legWeights(s: Side, y: number): Weights {
	if (y > 36) return mix('pelvis', `thighH${s}`, 1 - smooth(36, 40, y) * 0.75);
	if (y > 29) return mix(`thigh${s}`, `thighH${s}`, smooth(29, 36, y));
	if (y > KNEE_Y) return mix(`shinH${s}`, `thigh${s}`, smooth(KNEE_Y, KNEE_Y + 4, y));
	if (y > 8) return mix(`shin${s}`, `shinH${s}`, smooth(KNEE_Y - 4, KNEE_Y, y));
	return mix(`foot${s}`, `shin${s}`, 0.25 + 0.75 * smooth(2.5, 6, y));
}
