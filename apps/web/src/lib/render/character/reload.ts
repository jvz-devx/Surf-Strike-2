/**
 * Third-person reloads and the sniper's bolt cycle (docs/characters.md): what
 * the hands, the gun and its parts do over progress 0..1. Data and pure
 * functions; the animator (animator.ts) poses the arms with them, the model
 * (model.ts) places the parts (held-models.ts).
 *
 * A clip moves the left hand (for a rifle's bolt the right one) through keys
 * and tips the gun. A key is a fist (its centre and how it is turned) on the
 * gun (grip space: origin in the right fist, +X along the barrel, +Y up, +Z
 * right) or at the belt (from the pelvis, model axes), so a hand stays on the
 * gun however the player aims. Every clip starts and ends in the rest hold.
 */
import * as THREE from 'three';
import type { HeldItem } from './held.js';
import { heldPoint } from './held-models.js';

type V3 = readonly [x: number, y: number, z: number];

/** How a hand is turned: the way its fingers point and its thumb. The palm of the left hand faces fingers × thumb, the right one's the other way. */
interface Grasp {
	fingers: V3;
	thumb: V3;
	/** Finger bend (rad). */
	curl: number;
}

interface HandKey {
	t: number;
	/** `rest`: where the hand holds the gun. */
	on: 'rest' | 'gun' | 'belt';
	at?: V3;
	grasp?: Grasp;
	/** Passed through without stopping. */
	via?: boolean;
}

/** Gun: muzzle up, rolled to the right (its underside to the left hand) (rad) and moved (aim frame). */
interface GunKey {
	t: number;
	up?: number;
	roll?: number;
	yaw?: number;
	at?: V3;
}

/** Moving part of the gun: how far turned and how far slid (0..1). */
interface ActKey {
	t: number;
	turn?: number;
	slide?: number;
}

/** How the moving part moves (grip space): turned by `angle` about `axis` at `pivot`, then slid. */
interface ActMove {
	pivot: V3;
	axis: V3;
	angle: number;
	slide: V3;
}

/** The magazine (tube, box, drum): leaves the gun at `out`, the hand at `stow`; the new one is in the hand from `fresh` and in the gun from `seat`. */
export interface MagTimes {
	out: number;
	stow: number;
	fresh: number;
	seat: number;
	/** The old one falls to the ground instead of leaving with the hand. */
	drop?: boolean;
}

interface ClipDef {
	left?: HandKey[];
	right?: HandKey[];
	gun: GunKey[];
	act?: ActKey[];
	move?: ActMove;
	mag?: MagTimes;
}

// ---- Grasps ---------------------------------------------------------------

/** Around the fore-end from below, as at rest (the animator's left hand of a long gun). */
const FORE: Grasp = { fingers: [0.62, 0.3, 0.72], thumb: [0.72, 0.25, -0.64], curl: 1.1 };
/** Around an upright magazine from the left: palm to the right, thumb up. */
const FIST: Grasp = { fingers: [0.92, 0.05, 0.3], thumb: [0, 1, 0], curl: 1.15 };
/** Around the magazine of a raked pistol grip. */
const RAKED: Grasp = { fingers: [0.93, -0.3, 0.2], thumb: [0.31, 0.95, 0], curl: 1.2 };
/** Under a box or a drum: palm up, fingers to the right. */
const CUP: Grasp = { fingers: [0.5, 0.1, 0.86], thumb: [0.86, 0, -0.5], curl: 0.75 };
/** Over the top of the gun: palm down, fingers to the right, thumb back. */
const OVER: Grasp = { fingers: [0.3, -0.25, 0.92], thumb: [-0.95, 0, 0.3], curl: 1 };
/** At the pouch on the left hip: fingers down, palm to the body. */
const POUCH: Grasp = { fingers: [0.3, -0.93, 0.15], thumb: [0.94, 0.3, 0.1], curl: 0.9 };
/** At the hip under something wide, held up. */
const POUCH_CUP: Grasp = { fingers: [0.72, -0.25, 0.64], thumb: [0.64, 0.1, -0.76], curl: 0.75 };
/** Right hand over a bolt or charging handle: palm down and in. */
const BOLT_HAND: Grasp = { fingers: [0.9, -0.1, -0.42], thumb: [-0.2, 0.62, -0.6], curl: 1.15 };

// ---- Clips ------------------------------------------------------------------

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** A point riding on the moving part. */
function moved(m: ActMove, p: V3, turn: number, slide: number): V3 {
	const v = new THREE.Vector3(...p).sub(new THREE.Vector3(...m.pivot)).applyAxisAngle(new THREE.Vector3(...m.axis), m.angle * turn);
	return [v.x + m.pivot[0] + m.slide[0] * slide, v.y + m.pivot[1] + m.slide[1] * slide, v.z + m.pivot[2] + m.slide[2] * slide];
}

const SLIDE: ActMove = { pivot: [0, 0, 0], axis: [1, 0, 0], angle: 0, slide: [-2.1, 0, 0] };
const COVER: ActMove = { pivot: heldPoint('lmg', 0, 1.8, -8.8), axis: [0, 0, 1], angle: -0.85, slide: [0, 0, 0] };
const SNIPER_BOLT: ActMove = { pivot: heldPoint('sniper', 0, 0.8, 0), axis: [1, 0, 0], angle: -1.05, slide: [-2.6, 0, 0] };
const BARRETT_HANDLE: ActMove = { pivot: [0, 0, 0], axis: [1, 0, 0], angle: 0, slide: [-2.4, 0, 0] };

const PISTOL_MAG: V3 = [-1.25, -4.5, -0.1];
const PISTOL_WELL: V3 = add(PISTOL_MAG, [-1.5, -4.6, -0.4]);
const PISTOL_SLIDE: V3 = [1.4, 5.7, -0.1];
const LMG_BOX: V3 = [6.2, -3.1, -1.2];
const LMG_COVER: V3 = [1.3, 5.7, -1.1];
const SNIPER_MAG: V3 = [6.9, -1.9, -0.5];
const SNIPER_KNOB = add(heldPoint('sniper', 2.75, -0.05, 2.75), [0, 0.2, 0.6]);
const BARRETT_MAG: V3 = [4.5, -1.5, -0.9];
const BARRETT_KNOB = add(heldPoint('barrett', 2.3, 1.3, 0.2), [-0.2, 0.2, 0.9]);
const DRUM: V3 = [6.4, -4.4, -0.3];
/** Where the left hand holds the tube of the SMG: its rest hold (PLAYER_HOLDS.smg.fore). */
const TUBE: V3 = [8.4, -0.2, -0.4];

const bolt = (m: ActMove, knob: V3, t: readonly [on: number, up: number, back: number]): HandKey[] => [
	{ t: t[0], on: 'gun', at: knob, grasp: BOLT_HAND },
	{ t: t[1], on: 'gun', at: moved(m, knob, 1, 0), grasp: BOLT_HAND, via: true },
	{ t: t[2], on: 'gun', at: moved(m, knob, 1, 1), grasp: BOLT_HAND }
];

const DEFS: Readonly<Record<Exclude<HeldItem, 'knife'>, ClipDef>> = {
	// The magazine drops, the left hand brings one from the belt, seats it and racks the slide.
	pistol: {
		left: [
			{ t: 0, on: 'rest' },
			{ t: 0.05, on: 'rest' },
			{ t: 0.18, on: 'gun', at: [0.5, -7, -7], grasp: RAKED, via: true },
			{ t: 0.3, on: 'belt', at: [0.6, 2.4, -10], grasp: POUCH },
			{ t: 0.35, on: 'belt', at: [0.2, 3.4, -10.2], grasp: POUCH },
			{ t: 0.5, on: 'gun', at: PISTOL_WELL, grasp: RAKED, via: true },
			{ t: 0.58, on: 'gun', at: PISTOL_MAG, grasp: RAKED },
			{ t: 0.62, on: 'gun', at: add(PISTOL_MAG, [0, -0.2, 0]), grasp: RAKED },
			{ t: 0.76, on: 'gun', at: PISTOL_SLIDE, grasp: OVER },
			{ t: 0.83, on: 'gun', at: moved(SLIDE, PISTOL_SLIDE, 0, 1), grasp: OVER },
			{ t: 0.87, on: 'gun', at: add(moved(SLIDE, PISTOL_SLIDE, 0, 1), [-0.6, 0.6, -0.6]), grasp: OVER, via: true },
			{ t: 1, on: 'rest' }
		],
		gun: [
			{ t: 0 },
			{ t: 0.12, up: 0.4, roll: 0.25, at: [-3.6, -0.8, 0.4] },
			{ t: 0.52, up: 0.42, roll: 0.4, at: [-3.8, -1.2, 0.2] },
			{ t: 0.58, up: 0.5, roll: 0.4, at: [-3.8, -0.4, 0.2] },
			{ t: 0.72, up: 0.16, roll: -0.15, at: [-3.2, -1.2, 0] },
			{ t: 0.83, up: 0.2, roll: -0.15, at: [-3.5, -1.2, 0] },
			{ t: 0.87, up: 0.08, roll: -0.1, at: [-2.6, -0.9, 0] },
			{ t: 1 }
		],
		act: [{ t: 0.76 }, { t: 0.83, slide: 1 }, { t: 0.86 }],
		move: SLIDE,
		mag: { out: 0.14, stow: 0.14, fresh: 0.33, seat: 0.58, drop: true }
	},
	// Forward and down off the rails, a new tube from the belt, back on and home.
	smg: {
		left: [
			{ t: 0, on: 'rest' },
			{ t: 0.1, on: 'rest' },
			{ t: 0.2, on: 'gun', at: add(TUBE, [1.8, -0.7, -0.4]), grasp: FORE, via: true },
			{ t: 0.28, on: 'gun', at: add(TUBE, [0.6, -5, -4]), grasp: FORE, via: true },
			{ t: 0.4, on: 'belt', at: [3, 3.4, -12.8], grasp: POUCH_CUP },
			{ t: 0.48, on: 'belt', at: [3.4, 4.4, -12.6], grasp: POUCH_CUP },
			{ t: 0.6, on: 'gun', at: add(TUBE, [1, -4, -2.5]), grasp: FORE, via: true },
			{ t: 0.67, on: 'gun', at: add(TUBE, [1.8, -0.6, -0.2]), grasp: FORE },
			{ t: 0.76, on: 'rest' },
			{ t: 1, on: 'rest' }
		],
		gun: [
			{ t: 0 },
			{ t: 0.12, up: 0.3, roll: 0.3, at: [0, -1.4, 0] },
			{ t: 0.5, up: 0.26, roll: 0.34, at: [0, -2, 0.2] },
			{ t: 0.67, up: 0.2, roll: 0.28, at: [0.4, -1.6, 0] },
			{ t: 0.76, up: 0.26, roll: 0.22, at: [-1, -1.2, 0] },
			{ t: 1 }
		],
		mag: { out: 0.11, stow: 0.41, fresh: 0.46, seat: 0.76 }
	},
	// Feed cover up, the box off and a new one on, cover down.
	lmg: {
		left: [
			{ t: 0, on: 'rest' },
			{ t: 0.08, on: 'gun', at: LMG_COVER, grasp: OVER },
			{ t: 0.1, on: 'gun', at: LMG_COVER, grasp: OVER },
			{ t: 0.18, on: 'gun', at: moved(COVER, LMG_COVER, 0.8, 0), grasp: OVER },
			{ t: 0.24, on: 'gun', at: [5.5, 3, -6.5], grasp: CUP, via: true },
			{ t: 0.3, on: 'gun', at: LMG_BOX, grasp: CUP },
			{ t: 0.33, on: 'gun', at: add(LMG_BOX, [0, -0.2, 0]), grasp: CUP },
			{ t: 0.39, on: 'gun', at: add(LMG_BOX, [0, -4, -3.5]), grasp: CUP, via: true },
			{ t: 0.46, on: 'belt', at: [2.6, 1.6, -12.4], grasp: POUCH_CUP },
			{ t: 0.53, on: 'belt', at: [3, 2.6, -12.2], grasp: POUCH_CUP },
			{ t: 0.62, on: 'gun', at: add(LMG_BOX, [0, -4, -2.5]), grasp: CUP, via: true },
			{ t: 0.68, on: 'gun', at: LMG_BOX, grasp: CUP },
			{ t: 0.71, on: 'gun', at: LMG_BOX, grasp: CUP },
			{ t: 0.76, on: 'gun', at: [5, 5, -5.5], grasp: OVER, via: true },
			{ t: 0.8, on: 'gun', at: moved(COVER, LMG_COVER, 0.8, 0), grasp: OVER },
			{ t: 0.86, on: 'gun', at: LMG_COVER, grasp: OVER },
			{ t: 0.89, on: 'gun', at: LMG_COVER, grasp: OVER },
			{ t: 1, on: 'rest' }
		],
		gun: [
			{ t: 0 },
			{ t: 0.1, up: 0.12, roll: 0.16, at: [0.4, -2.2, 0] },
			{ t: 0.3, up: 0.16, roll: 0.28, at: [0.4, -2.6, 0.2] },
			{ t: 0.66, up: 0.16, roll: 0.28, at: [0.4, -2.6, 0.2] },
			{ t: 0.68, up: 0.2, roll: 0.26, at: [0.4, -2, 0.2] },
			{ t: 0.82, up: 0.12, roll: 0.14, at: [0.4, -2.2, 0] },
			{ t: 0.86, up: 0.06, roll: 0.14, at: [0.4, -2.8, 0] },
			{ t: 1 }
		],
		act: [{ t: 0.1 }, { t: 0.18, turn: 0.8 }, { t: 0.21, turn: 1 }, { t: 0.78, turn: 1 }, { t: 0.8, turn: 0.8 }, { t: 0.86 }],
		move: COVER,
		mag: { out: 0.32, stow: 0.47, fresh: 0.51, seat: 0.69 }
	},
	// Bolt open, a new magazine, bolt closed.
	sniper: {
		left: [
			{ t: 0, on: 'rest' },
			{ t: 0.2, on: 'rest' },
			{ t: 0.28, on: 'gun', at: SNIPER_MAG, grasp: FIST },
			{ t: 0.31, on: 'gun', at: SNIPER_MAG, grasp: FIST },
			{ t: 0.35, on: 'gun', at: add(SNIPER_MAG, [-0.5, -4, -3]), grasp: FIST, via: true },
			{ t: 0.46, on: 'belt', at: [0.6, 2.4, -10], grasp: POUCH },
			{ t: 0.49, on: 'belt', at: [0.4, 3.2, -10.2], grasp: POUCH },
			{ t: 0.61, on: 'gun', at: add(SNIPER_MAG, [-0.5, -3.6, -1.5]), grasp: FIST, via: true },
			{ t: 0.66, on: 'gun', at: SNIPER_MAG, grasp: FIST },
			{ t: 0.69, on: 'gun', at: SNIPER_MAG, grasp: FIST },
			{ t: 0.78, on: 'rest' },
			{ t: 1, on: 'rest' }
		],
		right: [
			{ t: 0.03, on: 'rest' },
			...bolt(SNIPER_BOLT, SNIPER_KNOB, [0.09, 0.12, 0.17]),
			{ t: 0.25, on: 'rest' },
			{ t: 0.76, on: 'rest' },
			...bolt(SNIPER_BOLT, SNIPER_KNOB, [0.92, 0.89, 0.82]).reverse(),
			{ t: 0.99, on: 'rest' }
		],
		gun: [
			{ t: 0 },
			{ t: 0.08, up: 0.1, roll: -0.12, at: [0.3, -1.2, 0] },
			{ t: 0.18, up: 0.14, roll: -0.12, at: [-0.2, -1.2, 0] },
			{ t: 0.3, up: 0.24, roll: 0.3, at: [0, -2, 0] },
			{ t: 0.64, up: 0.24, roll: 0.3, at: [0, -2, 0] },
			{ t: 0.66, up: 0.28, roll: 0.28, at: [0, -1.5, 0] },
			{ t: 0.8, up: 0.14, roll: -0.12, at: [-0.2, -1.2, 0] },
			{ t: 0.89, up: 0.08, roll: -0.1, at: [0.3, -1, 0] },
			{ t: 1 }
		],
		act: [{ t: 0.09 }, { t: 0.12, turn: 1 }, { t: 0.17, turn: 1, slide: 1 }, { t: 0.82, turn: 1, slide: 1 }, { t: 0.89, turn: 1 }, { t: 0.92 }],
		move: SNIPER_BOLT,
		mag: { out: 0.3, stow: 0.465, fresh: 0.485, seat: 0.67 }
	},
	// The big box magazine out and in, then the charging handle on the right.
	barrett: {
		left: [
			{ t: 0, on: 'rest' },
			{ t: 0.04, on: 'rest' },
			{ t: 0.15, on: 'gun', at: BARRETT_MAG, grasp: FIST },
			{ t: 0.2, on: 'gun', at: BARRETT_MAG, grasp: FIST },
			{ t: 0.26, on: 'gun', at: add(BARRETT_MAG, [0.4, -5.5, -3]), grasp: FIST, via: true },
			{ t: 0.39, on: 'belt', at: [0.2, 1.8, -11], grasp: POUCH },
			{ t: 0.44, on: 'belt', at: [0, 2.8, -11.2], grasp: POUCH },
			{ t: 0.58, on: 'gun', at: add(BARRETT_MAG, [0.4, -5.5, -1]), grasp: FIST, via: true },
			{ t: 0.64, on: 'gun', at: BARRETT_MAG, grasp: FIST },
			{ t: 0.67, on: 'gun', at: BARRETT_MAG, grasp: FIST },
			{ t: 0.76, on: 'rest' },
			{ t: 1, on: 'rest' }
		],
		right: [
			{ t: 0.72, on: 'rest' },
			{ t: 0.8, on: 'gun', at: BARRETT_KNOB, grasp: BOLT_HAND },
			{ t: 0.82, on: 'gun', at: BARRETT_KNOB, grasp: BOLT_HAND },
			{ t: 0.87, on: 'gun', at: moved(BARRETT_HANDLE, BARRETT_KNOB, 0, 1), grasp: BOLT_HAND },
			{ t: 0.9, on: 'gun', at: add(moved(BARRETT_HANDLE, BARRETT_KNOB, 0, 1), [-0.3, 0.3, 1.2]), grasp: BOLT_HAND, via: true },
			{ t: 0.99, on: 'rest' }
		],
		gun: [
			{ t: 0 },
			{ t: 0.13, up: 0.16, roll: 0.28, at: [0.3, -2, 0] },
			{ t: 0.62, up: 0.18, roll: 0.3, at: [0.3, -2.4, 0.2] },
			{ t: 0.64, up: 0.23, roll: 0.28, at: [0.3, -1.6, 0.2] },
			{ t: 0.8, up: 0.1, roll: -0.12, at: [0, -1.4, 0] },
			{ t: 0.87, up: 0.12, roll: -0.12, at: [-0.5, -1.4, 0] },
			{ t: 1 }
		],
		act: [{ t: 0.82 }, { t: 0.87, slide: 1 }, { t: 0.89 }],
		move: BARRETT_HANDLE,
		mag: { out: 0.18, stow: 0.395, fresh: 0.43, seat: 0.65 }
	},
	// The drum comes off below, a new one goes on and gets a push.
	striker: {
		left: [
			{ t: 0, on: 'rest' },
			{ t: 0.04, on: 'rest' },
			{ t: 0.16, on: 'gun', at: DRUM, grasp: CUP },
			{ t: 0.2, on: 'gun', at: DRUM, grasp: CUP },
			{ t: 0.26, on: 'gun', at: add(DRUM, [0.4, -4, -2.5]), grasp: CUP, via: true },
			{ t: 0.38, on: 'belt', at: [2.6, 1.2, -13], grasp: POUCH_CUP },
			{ t: 0.46, on: 'belt', at: [3, 2.2, -12.8], grasp: POUCH_CUP },
			{ t: 0.57, on: 'gun', at: add(DRUM, [0.4, -4.5, -1.5]), grasp: CUP, via: true },
			{ t: 0.65, on: 'gun', at: DRUM, grasp: CUP },
			{ t: 0.72, on: 'gun', at: add(DRUM, [-0.2, -1.6, -0.6]), grasp: CUP },
			{ t: 0.77, on: 'gun', at: add(DRUM, [0, -0.2, 0]), grasp: CUP },
			{ t: 0.8, on: 'gun', at: add(DRUM, [0, -0.2, 0]), grasp: CUP },
			{ t: 0.95, on: 'rest' },
			{ t: 1, on: 'rest' }
		],
		gun: [
			{ t: 0 },
			{ t: 0.13, up: 0.26, roll: 0.3, at: [0.2, -1.6, 0] },
			{ t: 0.63, up: 0.24, roll: 0.34, at: [0.2, -2, 0.2] },
			{ t: 0.65, up: 0.3, roll: 0.32, at: [0.2, -1.4, 0.2] },
			{ t: 0.74, up: 0.22, roll: 0.3, at: [0.2, -1.8, 0.2] },
			{ t: 0.77, up: 0.29, roll: 0.28, at: [0.2, -1, 0.2] },
			{ t: 1 }
		],
		mag: { out: 0.18, stow: 0.4, fresh: 0.44, seat: 0.66 }
	}
};

/** Length of the bolt cycle after a shot (s): shorter than the fastest fire interval (1.25 s, 0.85 of it with the specialist perk). */
export const BOLT_SECS = 0.9;
const BOLT_DEF: ClipDef = {
	right: [
		{ t: 0.12, on: 'rest' },
		...bolt(SNIPER_BOLT, SNIPER_KNOB, [0.3, 0.4, 0.55]),
		{ t: 0.58, on: 'gun', at: moved(SNIPER_BOLT, SNIPER_KNOB, 1, 1), grasp: BOLT_HAND },
		...bolt(SNIPER_BOLT, SNIPER_KNOB, [0.84, 0.75, 0.58]).slice(0, 2).reverse(),
		{ t: 1, on: 'rest' }
	],
	gun: [{ t: 0.1 }, { t: 0.3, up: 0.09, roll: -0.14, at: [0.2, -0.8, 0] }, { t: 0.56, up: 0.14, roll: -0.14, at: [-0.3, -0.9, 0] }, { t: 0.75, up: 0.08, roll: -0.12, at: [0.3, -0.7, 0] }, { t: 1 }],
	act: [{ t: 0.3 }, { t: 0.4, turn: 1 }, { t: 0.55, turn: 1, slide: 1 }, { t: 0.58, turn: 1, slide: 1 }, { t: 0.75, turn: 1 }, { t: 0.84 }],
	move: SNIPER_BOLT
};

// ---- Compiled ---------------------------------------------------------------

/** Share of a segment passed at `u`: a stop at both ends, at one, or at none. */
function ease(u: number, from: boolean, to: boolean): number {
	if (from && to) return u * u * (3 - 2 * u);
	if (from) return u * u;
	if (to) return u * (2 - u);
	return u;
}

/** Rows of [t, ...values]; `out` gets the values at `p`, stopping at every row. */
class Table {
	constructor(private readonly rows: readonly (readonly number[])[]) {}

	at(p: number, out: Float64Array): void {
		const r = this.rows;
		let i = 0;
		while (i + 1 < r.length && r[i + 1]![0]! <= p) i++;
		const a = r[i]!;
		const b = r[Math.min(i + 1, r.length - 1)]!;
		const span = b[0]! - a[0]!;
		const u = span > 0 ? ease(Math.max(0, (p - a[0]!) / span), true, true) : 0;
		for (let k = 1; k < a.length; k++) out[k - 1] = a[k]! + (b[k]! - a[k]!) * u;
	}
}

interface Key {
	t: number;
	on: 'rest' | 'gun' | 'belt';
	p: THREE.Vector3;
	q: THREE.Quaternion;
	curl: number;
	stop: boolean;
	free: 0 | 1;
}

function graspQuat(g: Grasp): THREE.Quaternion {
	const x = new THREE.Vector3(...g.fingers).normalize();
	const y = new THREE.Vector3(...g.thumb).addScaledVector(x, -new THREE.Vector3(...g.thumb).dot(x)).normalize();
	return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)));
}

const compileKeys = (keys: readonly HandKey[]): Key[] =>
	keys.map((k) => ({
		t: k.t,
		on: k.on,
		p: new THREE.Vector3(...(k.at ?? [0, 0, 0])),
		q: k.grasp ? graspQuat(k.grasp) : new THREE.Quaternion(),
		curl: k.grasp?.curl ?? 0,
		stop: !k.via,
		free: k.via || k.on === 'belt' ? 1 : 0
	}));

/** Frames the keys are in, in model space (fist centre and turn), filled by the animator every frame. */
export class HandFrames {
	readonly restP = new THREE.Vector3();
	readonly restQ = new THREE.Quaternion();
	restCurl = 1.1;
	readonly gunP = new THREE.Vector3();
	readonly gunQ = new THREE.Quaternion();
	readonly beltP = new THREE.Vector3();
	readonly beltQ = new THREE.Quaternion();
}

const aP = new THREE.Vector3();
const aQ = new THREE.Quaternion();
const bP = new THREE.Vector3();
const bQ = new THREE.Quaternion();
const act = new Float64Array(2);

function resolve(k: Key, f: HandFrames, p: THREE.Vector3, q: THREE.Quaternion): number {
	if (k.on === 'rest') {
		p.copy(f.restP);
		q.copy(f.restQ);
		return f.restCurl;
	}
	const gun = k.on === 'gun';
	const fp = gun ? f.gunP : f.beltP;
	const fq = gun ? f.gunQ : f.beltQ;
	p.copy(k.p).applyQuaternion(fq).add(fp);
	q.copy(fq).multiply(k.q);
	return k.curl;
}

/** One hand's way through its keys. */
export class HandTrack {
	private readonly keys: readonly Key[];
	/** How far the hand of the last `at` is on its way between the gun and the belt (0..1): there it may go around the body. */
	free = 0;

	constructor(keys: readonly HandKey[]) {
		this.keys = compileKeys(keys);
	}

	/** Fist centre and turn at `p` in model space; returns the finger bend. */
	at(p: number, f: HandFrames, outP: THREE.Vector3, outQ: THREE.Quaternion): number {
		const ks = this.keys;
		let i = 0;
		while (i + 1 < ks.length && ks[i + 1]!.t <= p) i++;
		const a = ks[i]!;
		const b = ks[Math.min(i + 1, ks.length - 1)]!;
		const ca = resolve(a, f, aP, aQ);
		if (a === b || p <= a.t) {
			this.free = a.free;
			outP.copy(aP);
			outQ.copy(aQ);
			return ca;
		}
		const cb = resolve(b, f, bP, bQ);
		const u = ease((p - a.t) / (b.t - a.t), a.stop, b.stop);
		outP.lerpVectors(aP, bP, u);
		outQ.slerpQuaternions(aQ, bQ, u);
		this.free = a.free + (b.free - a.free) * u;
		return ca + (cb - ca) * u;
	}

	/** Times of the keys (tests). */
	get times(): number[] {
		return this.keys.map((k) => k.t);
	}

	/** The fist at `t` when that is a key on the gun, in grip space. */
	onGun(t: number): { p: THREE.Vector3; q: THREE.Quaternion } | null {
		const k = this.keys.find((x) => x.on === 'gun' && x.t >= t - 1e-9);
		return k ? { p: k.p, q: k.q } : null;
	}
}

/** Where the magazine is. */
export type MagPlace = 'gun' | 'hand' | 'none';

/** One reload (or the bolt cycle) of one weapon. */
export class Clip {
	readonly left: HandTrack | null;
	readonly right: HandTrack | null;
	readonly mag: MagTimes | null;
	private readonly move: { pivot: THREE.Vector3; axis: THREE.Vector3; angle: number; slide: THREE.Vector3 } | null;
	/** Magazine in the fist: the turn and place of the gun's frame in the hand that takes it off (inverse of the grab). */
	readonly inHandP = new THREE.Vector3();
	readonly inHandQ = new THREE.Quaternion();
	private readonly gunTable: Table;
	private readonly actTable: Table | null;

	constructor(
		readonly item: HeldItem,
		def: ClipDef,
		grab: { p: V3; grasp: Grasp } | null
	) {
		this.left = def.left ? new HandTrack(def.left) : null;
		this.right = def.right ? new HandTrack(def.right) : null;
		this.gunTable = new Table(def.gun.map((k) => [k.t, k.up ?? 0, k.roll ?? 0, k.yaw ?? 0, ...(k.at ?? [0, 0, 0])]));
		this.actTable = def.act ? new Table(def.act.map((k) => [k.t, k.turn ?? 0, k.slide ?? 0])) : null;
		const m = def.move;
		this.move = m ? { pivot: new THREE.Vector3(...m.pivot), axis: new THREE.Vector3(...m.axis), angle: m.angle, slide: new THREE.Vector3(...m.slide) } : null;
		this.mag = def.mag ?? null;
		if (grab) {
			this.inHandQ.copy(graspQuat(grab.grasp)).invert();
			this.inHandP.set(...grab.p).applyQuaternion(this.inHandQ).negate();
		}
	}

	/** Gun tip at `p`: [up, roll, yaw (rad), x, y, z (aim frame)]. */
	gunAt(p: number, out: Float64Array): void {
		this.gunTable.at(p, out);
	}

	/** Moving part at `p`, `weight` of the way from home: its place and turn on the gun (grip space). */
	actAt(p: number, weight: number, outP: THREE.Vector3, outQ: THREE.Quaternion): void {
		outP.set(0, 0, 0);
		outQ.identity();
		const m = this.move;
		if (!m || !this.actTable) return;
		this.actTable.at(p, act);
		outQ.setFromAxisAngle(m.axis, m.angle * act[0]! * weight);
		outP.copy(m.pivot).applyQuaternion(outQ).negate().add(m.pivot).addScaledVector(m.slide, act[1]! * weight);
	}

	magAt(p: number): MagPlace {
		const m = this.mag;
		if (!m || p < m.out || p >= m.seat) return 'gun';
		return p >= m.fresh || (p < m.stow && !m.drop) ? 'hand' : 'none';
	}

	/** Seconds the dropped magazine has been falling at `p` of a reload of `ms`; negative when none falls. */
	fallen(p: number, ms: number): number {
		const m = this.mag;
		return m?.drop && p >= m.out ? ((p - m.out) * ms) / 1000 : -1;
	}
}

const GRABS: Readonly<Record<Exclude<HeldItem, 'knife'>, { p: V3; grasp: Grasp }>> = {
	pistol: { p: PISTOL_MAG, grasp: RAKED },
	smg: { p: TUBE, grasp: FORE },
	lmg: { p: LMG_BOX, grasp: CUP },
	sniper: { p: SNIPER_MAG, grasp: FIST },
	barrett: { p: BARRETT_MAG, grasp: FIST },
	striker: { p: DRUM, grasp: CUP }
};

/** The reload of every gun. */
export const RELOADS: Readonly<Partial<Record<HeldItem, Clip>>> = Object.freeze(
	Object.fromEntries((Object.keys(DEFS) as (keyof typeof DEFS)[]).map((w) => [w, new Clip(w, DEFS[w], GRABS[w])]))
);

/** The bolt cycle after a shot. */
export const BOLTS: Readonly<Partial<Record<HeldItem, Clip>>> = Object.freeze({ sniper: new Clip('sniper', BOLT_DEF, null) });
