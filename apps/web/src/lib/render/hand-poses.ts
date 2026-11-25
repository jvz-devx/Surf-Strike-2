/**
 * Hand poses of the first-person gloves (render/hands.ts): where the wrist is, and how the fingers
 * bend. Plain data and pure functions, no scene objects. The numbers of each gun are solved against the shipped
 * meshes by tools/models/procedural/fit_hands.mjs (hand-pose-data.ts) and checked by hand-contact.test.ts.
 *
 * Hand space (both hands): the wrist at the origin, the straight fingers along −Z, the palm facing −Y; the
 * thumb is on −X of the right hand and on +X of the left one. Lengths are model units of the gun.
 */
import type { WeaponId } from '@surf/shared';
import type { PointName } from './gun-rig.js';
import type { V3 } from './weapon-assets.js';
import { HAND_POSE_DATA } from './hand-pose-data.js';

export type HandSide = 'r' | 'l';
export type Quat = readonly [x: number, y: number, z: number, w: number];

/** Finger bends (rad). The left hand takes the same numbers as the right one: they are mirrored on the bones. */
export interface HandShape {
	/** Index, middle, ring, little finger: sideways (towards the thumb positive), then the bend of the three joints. */
	fingers: readonly number[];
	/** Thumb: turn of its base (Euler XYZ in hand space), then the bend of the two outer joints. */
	thumb: readonly number[];
}

/** A named pose: the wrist in the frame of a point of the gun (`at`; null: the model space of the weapon). */
export interface HandPose extends HandShape {
	side: HandSide;
	at: PointName | null;
	p: V3;
	q: Quat;
}

/** A hand in the model space of the weapon: what the hand model is set to, and what is blended. */
export interface HandPlace extends HandShape {
	p: V3;
	q: Quat;
	/** Where the elbow is (model space): the forearm points at it. */
	elbow: V3;
}

/**
 * Poses a gun has, where it has the part for it: `grip` (right hand, finger on the trigger), `grip_off` (finger
 * straight along the frame), `fore` (left hand under the fore-end; the pistol's second hand), `mag` (left hand on the magazine),
 * `bolt` (hand on the charging handle, slide or bolt knob: `side` says which hand), `cover` (left hand on the feed cover).
 */
export const GUN_POSE_NAMES = ['grip', 'grip_off', 'fore', 'mag', 'bolt', 'cover'] as const;
export type GunPoseName = (typeof GUN_POSE_NAMES)[number];
/** Poses without a gun: an open hand and a fist. */
export const FREE_POSE_NAMES = ['open', 'fist'] as const;
export type FreePoseName = (typeof FREE_POSE_NAMES)[number];
export type PoseName = GunPoseName | FreePoseName | 'knife';

export interface WeaponHands {
	/** Elbows of the right and the left arm (model space). */
	elbow: Readonly<Record<HandSide, V3>>;
	poses: Readonly<Partial<Record<PoseName, HandPose>>>;
	/** What each hand does at rest; null: it is not shown. */
	rest: Readonly<Record<HandSide, PoseName | null>>;
}

/** Relaxed open hand: fingers a little bent and apart. */
export const OPEN: HandShape = {
	fingers: [0.08, 0.22, 0.28, 0.18, 0.02, 0.24, 0.3, 0.2, -0.04, 0.28, 0.34, 0.22, -0.12, 0.32, 0.36, 0.24],
	thumb: [0.05, 0.1, 0, 0.15, 0.15]
};
/** Closed fist, the thumb over the fingers. */
export const FIST: HandShape = {
	fingers: [0.02, 1.4, 1.6, 0.9, 0, 1.45, 1.65, 0.9, -0.02, 1.45, 1.65, 0.95, -0.05, 1.45, 1.6, 0.95],
	thumb: [0.3, -0.35, 0.25, 0.5, 0.6]
};
const FREE: Readonly<Record<FreePoseName, HandShape>> = { open: OPEN, fist: FIST };

/** The hands of a weapon, or null (claws). */
export function weaponHands(id: WeaponId): WeaponHands | null {
	return (HAND_POSE_DATA as Partial<Record<WeaponId, WeaponHands>>)[id] ?? null;
}

/** The finger bends of a free pose. */
export function freeShape(name: FreePoseName): HandShape {
	return FREE[name];
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixAll = (a: readonly number[], b: readonly number[], t: number): number[] => a.map((v, i) => mix(v, b[i]!, t));

/** Spherical blend of two unit quaternions, the short way round. */
export function blendQuat(a: Quat, b: Quat, t: number): Quat {
	let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
	const s = dot < 0 ? -1 : 1;
	dot = Math.min(1, dot * s);
	const ang = Math.acos(dot);
	const sin = Math.sin(ang);
	const ka = sin < 1e-5 ? 1 - t : Math.sin((1 - t) * ang) / sin;
	const kb = (sin < 1e-5 ? t : Math.sin(t * ang) / sin) * s;
	const q = [0, 1, 2, 3].map((i) => a[i]! * ka + b[i]! * kb);
	const l = Math.hypot(...q) || 1;
	return [q[0]! / l, q[1]! / l, q[2]! / l, q[3]! / l];
}

/** Blend of two finger shapes: 0 is `a`, 1 is `b`. */
export function blendShapes(a: HandShape, b: HandShape, t: number): HandShape {
	return { fingers: mixAll(a.fingers, b.fingers, t), thumb: mixAll(a.thumb, b.thumb, t) };
}

/** Blend of two hands in the same model space: 0 is `a`, 1 is `b`. The wrist moves straight and turns the short way round. */
export function blendHands(a: HandPlace, b: HandPlace, t: number): HandPlace {
	return {
		p: [mix(a.p[0], b.p[0], t), mix(a.p[1], b.p[1], t), mix(a.p[2], b.p[2], t)],
		q: blendQuat(a.q, b.q, t),
		elbow: [mix(a.elbow[0], b.elbow[0], t), mix(a.elbow[1], b.elbow[1], t), mix(a.elbow[2], b.elbow[2], t)],
		...blendShapes(a, b, t)
	};
}
