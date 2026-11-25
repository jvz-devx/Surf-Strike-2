/**
 * Gun feel for the infected weapons (docs/modes.md#infected): view recoil,
 * aim spread (bloom, movement), the scope zoom, the crosshair spread gap,
 * knockback and the viewmodel motion curves. Pure: times are ms on the
 * caller's clock, randomness is injected, nothing here touches the renderer.
 *
 * Feel parameters live here, not in `WeaponDef`: the server never reads them
 * (spread and recoil are client-side, like the fixed spread before).
 */
import { WEAPONS, type WeaponId } from '@surf/shared';
import { verticalFovFromHorizontal43 } from '../render/fov.js';

const RAD = Math.PI / 180;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Smoothstep of `t` clamped to 0..1. */
export function ease(t: number): number {
	const u = clamp(t, 0, 1);
	return u * u * (3 - 2 * u);
}

// ---------------------------------------------------------------------
// View kick

/**
 * One set of view-kick parameters. On every shot each axis gets a random
 * velocity drawn evenly between its min and max (deg/s; pitch + = up, yaw
 * + = left); `centerSpeed` (deg/s²) pulls the view back to the original point
 * of aim. The first `reducedShots` shots of a trigger pull kick
 * `reducedPercent` % less (0 = off).
 */
export interface ViewKickSet {
	pitchMin: number;
	pitchMax: number;
	yawMin: number;
	yawMax: number;
	centerSpeed: number;
	reducedShots: number;
	reducedPercent: number;
}

/**
 * View kick of one gun: hip fire, scoped (rifles with a scope; null = the hip
 * set), and aimed down sights (null = the hip set). A shot blends hip and
 * aimed by the aim progress (`aimKickSet`).
 */
export interface RecoilDef {
	hip: ViewKickSet;
	scoped: ViewKickSet | null;
	aimed: ViewKickSet | null;
}

/** The view never deflects further than this from the original point of aim, per axis (degrees). */
export const VIEW_KICK_BOUND = 10;
/** Share of `centerSpeed` that pulls the view back while it already moves back, and of a new velocity that points back. */
export const VIEW_KICK_RETURN = 1 / 16;
/** Roll velocity per yaw velocity of a shot (deg/s of roll per deg/s of yaw). */
export const VIEW_KICK_ROLL = 0.5;
/** The field of view the recoil is calibrated for (horizontal at 4:3): the `fov` cvar's default, never the live cvar. */
export const RECOIL_REF_FOV = 90;

/**
 * Factor that makes an angle look the same on screen at `toFov` as it does at
 * `fromFov` (both horizontal at 4:3, degrees). A small angle moves the picture
 * by tan(angle) / tan(fov / 2) of its half-width, so the factor is
 * tan(to / 2) / tan(from / 2).
 */
export function screenScale(fromFov: number, toFov: number): number {
	return Math.tan((toFov * RAD) / 2) / Math.tan((fromFov * RAD) / 2);
}

/** Share of the half picture (0..1 at the edge) an angle `deg` off the centre covers at `fov` (horizontal at 4:3). */
export function screenShare(deg: number, fov: number): number {
	return Math.tan(deg * RAD) / Math.tan((fov * RAD) / 2);
}

/**
 * A view-kick set measured at `fromFov` (an aimed view) converted to `toFov`:
 * velocities and centre speed scale by `screenScale`, so the view follows the
 * same path in time and every shot moves the picture as far on screen.
 */
export function convertKick(set: ViewKickSet, fromFov: number, toFov: number): ViewKickSet {
	const k = screenScale(fromFov, toFov);
	return {
		pitchMin: set.pitchMin * k,
		pitchMax: set.pitchMax * k,
		yawMin: set.yawMin * k,
		yawMax: set.yawMax * k,
		centerSpeed: set.centerSpeed * k,
		reducedShots: set.reducedShots,
		reducedPercent: set.reducedPercent
	};
}

/** Aimed view kick of the source weapon each gun is calibrated on, and the aimed FOV it was measured at. */
export interface KickSource extends ViewKickSet {
	fov: number;
}

const source = (pitchMin: number, pitchMax: number, yawMin: number, yawMax: number, centerSpeed: number, fov: number): KickSource => ({
	pitchMin,
	pitchMax,
	yawMin,
	yawMax,
	centerSpeed,
	reducedShots: 0,
	reducedPercent: 0,
	fov
});

/**
 * Calibration source: aimed view kick from a published community spreadsheet
 * of weapon statistics for a 2011 console shooter, one row per gun (the row of
 * the same weapon class). None of these rows has a reduced first shot (the
 * sheet notes it for two assault rifles only).
 *
 * | Id      | Source row (class)    | Pitch (deg/s) | Yaw (deg/s)   | Centre | Aimed FOV |
 * | ------- | --------------------- | ------------- | ------------- | ------ | --------- |
 * | smg     | compact SMG           | -45 to 60     | -65 to 65     | 1650   | 55        |
 * | lmg     | magazine-fed LMG      | -10 to 50     | -80 to 80     | 1500   | 55        |
 * | striker | automatic shotgun     | 85 to 95      | -55 to 55     | 1000   | 55        |
 * | barrett | semi-auto .50 cal     | 80 to 95      | 80 to 95      | 1000   | 15        |
 * | sniper  | bolt-action rifle     | 30 to 85      | -75 to 70     | 500    | 15        |
 * | pistol  | service pistol        | 25 to 45      | -55 to 55     | 750    | 65        |
 *
 * The .50 cal kicks to one side only (yaw + = left).
 */
export const RECOIL_SOURCE: Readonly<Partial<Record<WeaponId, KickSource>>> = Object.freeze({
	smg: source(-45, 60, -65, 65, 1650, 55),
	lmg: source(-10, 50, -80, 80, 1500, 55),
	striker: source(85, 95, -55, 55, 1000, 55),
	barrett: source(80, 95, 80, 95, 1000, 15),
	sniper: source(30, 85, -75, 70, 500, 15),
	pistol: source(25, 45, -55, 55, 750, 65)
});

// ---------------------------------------------------------------------
// Aiming down sights

/** Unaimed FOV of the calibration source: its aimed FOVs are measured against it. */
export const AIM_SOURCE_FOV = 65;

export interface AimDef {
	/** Time to come up to the sights, and the same to go back down (ms). */
	aimMs: number;
	/**
	 * Aimed FOV of the source (degrees, against `AIM_SOURCE_FOV`): only the
	 * magnification is used (`aimFov`). The rifles zoom to their scope's
	 * `zoomFov` instead.
	 */
	sourceFov: number;
	/** Move speed factor when fully aimed: the source's aimed / unaimed move speed. */
	move: number;
}

/**
 * Aim per gun. Calibration source: the spreadsheet named at
 * `RECOIL_SOURCE`, the same rows.
 *
 * | Id      | Aim time | Source aimed FOV | Move, hip / aimed (source) | Move factor |
 * | ------- | -------- | ---------------- | -------------------------- | ----------- |
 * | pistol  | 200 ms   | 65 (no zoom)     | 1 / 0.8                    | 0.8         |
 * | smg     | 200 ms   | 55               | 1 / 0.8                    | 0.8         |
 * | lmg     | 379 ms   | 55               | 0.8 / 0.32                 | 0.4         |
 * | striker | 200 ms   | 55               | 1 / 0.4                    | 0.4         |
 * | sniper  | 400 ms   | 15 (scope 40)    | 0.9 / 0.36                 | 0.4         |
 * | barrett | 400 ms   | 15 (scope 38)    | 0.8 / 0.32                 | 0.4         |
 *
 * Melee has no aim.
 */
export const AIM: Readonly<Partial<Record<WeaponId, AimDef>>> = Object.freeze({
	pistol: { aimMs: 200, sourceFov: 65, move: 0.8 / 1 },
	smg: { aimMs: 200, sourceFov: 55, move: 0.8 / 1 },
	lmg: { aimMs: 379, sourceFov: 55, move: 0.32 / 0.8 },
	striker: { aimMs: 200, sourceFov: 55, move: 0.4 / 1 },
	sniper: { aimMs: 400, sourceFov: 15, move: 0.36 / 0.9 },
	barrett: { aimMs: 400, sourceFov: 15, move: 0.32 / 0.8 }
});

/**
 * Aimed FOV (horizontal at 4:3, degrees) of `weapon` for a player whose FOV
 * is `fov`: the scope's `zoomFov` for the rifles, else the source's
 * magnification, tan(65° / 2) / tan(aimed / 2), applied to `fov`. Guns without
 * an aim, and melee, stay at `fov`.
 */
export function aimFov(fov: number, weapon: WeaponId): number {
	const zoom = WEAPONS[weapon].zoomFov;
	if (zoom !== null) return zoom;
	const a = AIM[weapon];
	if (!a) return fov;
	const mag = Math.tan((AIM_SOURCE_FOV * RAD) / 2) / Math.tan((a.sourceFov * RAD) / 2);
	return (2 * Math.atan(Math.tan((fov * RAD) / 2) / mag)) / RAD;
}

/** The FOV changes over the last ZOOM_MS of the aim (the gun comes up first), or the whole aim when it is shorter. */
export const ZOOM_MS = 180;

/** Zoom progress 0..1 (linear; ease it with `ease`) at aim progress `t` of a gun that takes `aimMs` to come up. */
export function zoomStep(t: number, aimMs: number): number {
	const from = Math.max(0, 1 - ZOOM_MS / Math.max(1, aimMs));
	return clamp((t - from) / (1 - from), 0, 1);
}

/** Aim progress 0..1 after `dtMs` more towards aimed (1) or not (0), over `aimMs` either way; linear, ease it with `ease`. */
export function aimStep(t: number, aiming: boolean, dtMs: number, aimMs: number): number {
	const d = Math.max(0, dtMs) / Math.max(1, aimMs);
	return aiming ? Math.min(1, t + d) : Math.max(0, t - d);
}

/** Move speed factor of `weapon` at aim progress `aim` (eased): 1 at the hip, the gun's `move` fully aimed. */
export function aimMoveFactor(weapon: WeaponId, aim: number): number {
	const a = AIM[weapon];
	return a ? 1 + (a.move - 1) * clamp(aim, 0, 1) : 1;
}

/**
 * View kick per gun, converted from `RECOIL_SOURCE` with `convertKick` so one
 * shot moves the picture as far on screen as the source's aimed shot:
 *
 * | Id      | Set    | FOV | Factor | Pitch (deg/s)  | Yaw (deg/s)     | Centre (deg/s²) | Biggest climb, ours / source |
 * | ------- | ------ | --- | ------ | -------------- | --------------- | --------------- | ---------------------------- |
 * | pistol  | hip    | 90  | 1.570  | 39.2 to 70.6   | -86.3 to 86.3   | 1177            | 2.12° / 1.35° at 65          |
 * | smg     | hip    | 90  | 1.921  | -86.4 to 115.3 | -124.9 to 124.9 | 3170            | 2.10° / 1.09° at 55          |
 * | lmg     | hip    | 90  | 1.921  | -19.2 to 96.0  | -153.7 to 153.7 | 2882            | 1.60° / 0.83° at 55          |
 * | striker | hip    | 90  | 1.921  | 163.3 to 182.5 | -105.7 to 105.7 | 1921            | 8.67° / 4.51° at 55          |
 * | sniper  | scoped | 40  | 2.765  | 82.9 to 235.0  | -207.3 to 193.5 | 1382            | 10° (bound) / 7.22° at 15    |
 * | barrett | scoped | 38  | 2.615  | 209.2 to 248.5 | 209.2 to 248.5  | 2615            | 10° (bound) / 4.51° at 15    |
 *
 * Biggest climb: one shot from rest at the top of the pitch range, v² / (2 ×
 * centre). Scoped, the bolt-action rifle reaches the 10° bound from about 60%
 * of its pitch range up and the .50 cal from the middle of its range, so their
 * biggest shots look smaller on screen than the source's. Hip
 * fire with a rifle uses the scoped set in degrees: converting the source's
 * 15° scope view to a 90° hip view would throw every shot to the bound on both
 * axes.
 *
 * Aimed: the same source values converted to the gun's aimed FOV at the
 * reference FOV (`aimFov(RECOIL_REF_FOV, id)`), so an aimed shot moves the
 * zoomed picture as far as the source's aimed shot. Every unscoped source was
 * measured aimed, so the factor is tan(45°) / tan(32.5°) = 1.570 for all of
 * them (the pistol's aimed set equals its hip set). The rifles aim through
 * their scope: aimed = scoped.
 */
export const RECOIL: Readonly<Partial<Record<WeaponId, RecoilDef>>> = Object.freeze(
	Object.fromEntries(
		Object.entries(RECOIL_SOURCE).map(([id, s]) => {
			const zoom = WEAPONS[id as WeaponId].zoomFov;
			const scoped = zoom === null ? null : convertKick(s, s.fov, zoom);
			const aimed = scoped ?? convertKick(s, s.fov, aimFov(RECOIL_REF_FOV, id as WeaponId));
			return [id, { hip: scoped ?? convertKick(s, s.fov, RECOIL_REF_FOV), scoped, aimed } satisfies RecoilDef];
		})
	)
);

/** Kick set of `def` while scoped or not. */
export function kickSet(def: RecoilDef, scoped: boolean): ViewKickSet {
	return (scoped ? def.scoped : null) ?? def.hip;
}

/** Kick set of `def` at aim progress `aim` (0 = hip, 1 = aimed): every value blends linearly; 0 is the hip set itself. */
export function aimKickSet(def: RecoilDef, aim: number): ViewKickSet {
	const t = clamp(aim, 0, 1);
	const a = def.hip;
	const b = def.aimed ?? a;
	if (!(t > 0) || b === a) return a;
	const mix = (x: number, y: number) => x + (y - x) * t;
	return {
		pitchMin: mix(a.pitchMin, b.pitchMin),
		pitchMax: mix(a.pitchMax, b.pitchMax),
		yawMin: mix(a.yawMin, b.yawMin),
		yawMax: mix(a.yawMax, b.yawMax),
		centerSpeed: mix(a.centerSpeed, b.centerSpeed),
		reducedShots: a.reducedShots,
		reducedPercent: a.reducedPercent
	};
}

/**
 * Longest time (ms) one axis needs from a shot at rest with any velocity up to
 * `v` until it is back at rest. Past the bound a faster shot gets there sooner,
 * so the slowest is the one that just reaches it.
 */
function axisRestMs(v: number, a: number): number {
	const s = Math.min(Math.abs(v), Math.sqrt(2 * a * VIEW_KICK_BOUND));
	if (!(s > 0) || !(a > 0)) return 0;
	const peak = (s * s) / (2 * a);
	return 1000 * (s / a + Math.sqrt((2 * peak) / (a * VIEW_KICK_RETURN)));
}

/** Longest time (ms) after one shot from rest until the view is back on the original point of aim. */
export function recoilRestMs(def: RecoilDef, scoped = false): number {
	const k = kickSet(def, scoped);
	const yaw = Math.max(Math.abs(k.yawMin), Math.abs(k.yawMax));
	return Math.max(
		axisRestMs(Math.max(Math.abs(k.pitchMin), Math.abs(k.pitchMax)), k.centerSpeed),
		axisRestMs(yaw, k.centerSpeed),
		axisRestMs(yaw * VIEW_KICK_ROLL, k.centerSpeed)
	);
}

const PITCH = 0;
const YAW = 1;
const ROLL = 2;

/**
 * View kick: the camera turns away from the original point of aim (where the
 * player aims; mouse movement moves that point and is never undone) and the
 * shots follow the kicked view. Per axis, independently:
 *
 * - every shot draws a random velocity in the set's range: no pattern;
 * - moving away, the view is slowed by the full centre speed; moving back, it
 *   is pulled by one-sixteenth of it, so it peaks fast and coasts back;
 * - it stops exactly on the original point of aim;
 * - a shot while off-centre replaces the velocity: in full when it points
 *   away, at one-sixteenth when it points back;
 * - it never deflects more than `VIEW_KICK_BOUND`; reaching it stops the axis,
 *   which then recovers.
 *
 * Yaw also rolls the view: each shot gives roll half the yaw velocity (a left
 * kick rolls counter-clockwise), recovering at the same rate as the yaw, with
 * its own 10° bound. The caller fires along the offset it reads before
 * `kick()`, so a first shot from rest goes to the aim point.
 *
 * `update(now)` solves the motion in closed form: any step size gives the same
 * offsets. No allocation per frame.
 */
export class ViewKick {
	/** Offsets (degrees): pitch + = up, yaw + = left, roll + = counter-clockwise. */
	private readonly x = [0, 0, 0];
	/** Velocities (deg/s), same signs. */
	private readonly v = [0, 0, 0];
	/** Centre speed of the last shot's set (deg/s²). */
	private center = 0;
	private at = -Infinity;

	constructor(private readonly rng: () => number = Math.random) {}

	/** View-angle offsets in Source terms (degrees): pitch + = down, yaw + = left. */
	get pitch(): number {
		return this.x[PITCH] === 0 ? 0 : -this.x[PITCH]!;
	}

	get yaw(): number {
		return this.x[YAW]!;
	}

	/** Camera roll (degrees, + = counter-clockwise). */
	get roll(): number {
		return this.x[ROLL]!;
	}

	/** Offset up and to the left (degrees). */
	get up(): number {
		return this.x[PITCH]!;
	}

	/** Velocities (deg/s): up, left, counter-clockwise. */
	velocity(axis: 'pitch' | 'yaw' | 'roll'): number {
		return this.v[axis === 'pitch' ? PITCH : axis === 'yaw' ? YAW : ROLL]!;
	}

	/** On the original point of aim and not moving. */
	get resting(): boolean {
		const { x, v } = this;
		return x[0] === 0 && x[1] === 0 && x[2] === 0 && v[0] === 0 && v[1] === 0 && v[2] === 0;
	}

	/** Advance to `now` (ms). */
	update(now: number): void {
		if (!(now > this.at)) {
			if (this.at === -Infinity) this.at = now;
			return;
		}
		const dt = (now - this.at) / 1000;
		this.at = now;
		if (!Number.isFinite(dt) || this.resting) return;
		for (let i = 0; i < 3; i++) this.advance(i, dt);
	}

	/** Exact motion of one axis over `dt` seconds: constant acceleration in each phase. */
	private advance(i: number, dt: number): void {
		const a = this.center;
		let x = this.x[i]!;
		let v = this.v[i]!;
		const ar = a * VIEW_KICK_RETURN;
		while (dt > 0) {
			if (v === 0) {
				if (x === 0 || !(ar > 0)) break;
				// From rest off-centre: pulled back at the return rate, stopping on the aim point.
				const s = -Math.sign(x);
				const reach = Math.sqrt((2 * Math.abs(x)) / ar);
				if (dt >= reach) x = 0;
				else {
					x += 0.5 * s * ar * dt * dt;
					v = s * ar * dt;
				}
				break;
			}
			const sv = Math.sign(v);
			if (x === 0 || sv === Math.sign(x)) {
				// Moving away: slowed by the full centre speed; stops at its peak or at the bound.
				const stop = a > 0 ? Math.abs(v) / a : Infinity;
				const t = Math.min(dt, stop);
				const nx = x + v * t - 0.5 * sv * a * t * t;
				if (Math.abs(nx) > VIEW_KICK_BOUND) {
					const room = VIEW_KICK_BOUND - Math.abs(x);
					const hit = a > 0 ? (Math.abs(v) - Math.sqrt(Math.max(0, v * v - 2 * a * room))) / a : room / Math.abs(v);
					x = sv * VIEW_KICK_BOUND;
					v = 0;
					dt -= hit;
					continue;
				}
				x = nx;
				v = t === stop ? 0 : v - sv * a * t;
				dt -= t;
				continue;
			}
			// Moving back: pulled by the return rate, stopping exactly on the aim point.
			const s = Math.abs(v);
			const reach = ar > 0 ? (Math.sqrt(s * s + 2 * ar * Math.abs(x)) - s) / ar : Math.abs(x) / s;
			if (dt >= reach) {
				x = 0;
				v = 0;
			} else {
				x += v * dt + 0.5 * sv * ar * dt * dt;
				v += sv * ar * dt;
			}
			break;
		}
		this.x[i] = x;
		this.v[i] = v;
	}

	/**
	 * A shot left at `now` with `set`. `shot`: 0-based index of the shot in the
	 * current trigger pull (the reduced first shots).
	 */
	kickWith(set: ViewKickSet, now: number, shot = 0): void {
		this.update(now);
		this.at = Math.max(this.at, now);
		this.center = set.centerSpeed;
		const cut = shot < set.reducedShots ? 1 - clamp(set.reducedPercent, 0, 100) / 100 : 1;
		const pitch = (set.pitchMin + (set.pitchMax - set.pitchMin) * this.rng()) * cut;
		const yaw = (set.yawMin + (set.yawMax - set.yawMin) * this.rng()) * cut;
		this.v[PITCH] = this.launch(PITCH, pitch);
		this.v[YAW] = this.launch(YAW, yaw);
		// Roll gets half the velocity the yaw was given (after the one-sixteenth rule), stopped only by its own bound.
		const roll = this.v[YAW]! * VIEW_KICK_ROLL;
		const r = this.x[ROLL]!;
		this.v[ROLL] = Math.abs(r) >= VIEW_KICK_BOUND - 1e-9 && Math.sign(roll) === Math.sign(r) ? 0 : roll;
	}

	/**
	 * A shot of `weapon` left at `now` (guns without a `RECOIL` entry have
	 * none). `aim`: scoped or not (true / false), or the aim progress 0..1
	 * (`aimKickSet`).
	 */
	kick(weapon: WeaponId, now: number, aim: boolean | number = false, shot = 0): void {
		const def = RECOIL[weapon];
		if (!def) {
			this.update(now);
			return;
		}
		this.kickWith(typeof aim === 'number' ? aimKickSet(def, aim) : kickSet(def, aim), now, shot);
	}

	/** The velocity a shot gives axis `i`: the new one replaces the old, cut to one-sixteenth when it points back. */
	private launch(i: number, v: number): number {
		const x = this.x[i]!;
		// On the bound (within rounding) a kick outward has nowhere to go.
		if (Math.abs(x) >= VIEW_KICK_BOUND - 1e-9 && Math.sign(v) === Math.sign(x)) return 0;
		return x !== 0 && Math.sign(v) === -Math.sign(x) ? v * VIEW_KICK_RETURN : v;
	}

	/** Back to rest at once (death, respawn). */
	reset(): void {
		this.x.fill(0);
		this.v.fill(0);
	}
}

/** Pitch limit of the view (game.ts clamps the mouse to the same). */
export const MAX_PITCH = 89;

/** `pitch` plus a recoil offset, kept inside the view's pitch range (degrees). */
export function kickedPitch(pitch: number, kick: number): number {
	return clamp(pitch + kick, -MAX_PITCH, MAX_PITCH);
}

// ---------------------------------------------------------------------
// Aim spread

export interface SpreadDef {
	/** Hip cone half-angle (degrees): at rest and fully grown standing, and the same crouched on the ground. */
	min: number;
	max: number;
	duckMin: number;
	duckMax: number;
	/** Share of the way from min to max one shot adds, its recovery (share/s) and the wait before it recovers (ms). */
	fire: number;
	recover: number;
	holdMs: number;
}

/**
 * Hip cone per gun (half-angle, degrees): from `min` at rest it grows to
 * `max` with firing (`fire` per shot, `Bloom`) and movement (full at run
 * speed, and while airborne), and starts from the crouched pair when ducked
 * on the ground. Steady Aim halves it. Aimed, the cone shrinks with the aim
 * progress to nothing: fully aimed, shots go where the sights point.
 *
 * Calibration source: the spreadsheet named at `RECOIL_SOURCE`, hip spread
 * standing and crouched. The shotgun's source cone (5 to 5) is its pellet
 * scatter; ours comes from the server's `pelletSpread` (4°) on top of the aim
 * cone, so its aim cone is the rest, 1°.
 *
 * | Id      | Source standing | Source crouched | Ours standing | Ours crouched | Shots to max |
 * | ------- | --------------- | --------------- | ------------- | ------------- | ------------ |
 * | pistol  | 3 to 6          | 2.5 to 5        | 3 to 6        | 2.5 to 5      | 3            |
 * | smg     | 3 to 5          | 2 to 4.5        | 3 to 5        | 2 to 4.5      | 9            |
 * | lmg     | 4 to 10         | 3.5 to 8        | 4 to 10       | 3.5 to 8      | 13           |
 * | striker | 5 to 5          | 5 to 5          | 1 (+4 pellets)| 1 (+4 pellets)| —            |
 * | sniper  | 10 to 15        | 9.5 to 14       | 10 to 15      | 9.5 to 14     | never (1)    |
 * | barrett | 10 to 15        | 9.5 to 14       | 10 to 15      | 9.5 to 14     | 3            |
 *
 * Shots to max: at the gun's own fire rate, standing still. (1) The bolt
 * action's cone grows halfway per shot and is back at rest before the bolt
 * has cycled. The growth per shot and the recovery are ours (the sheet has
 * none).
 * Melee has no spread.
 */
export const SPREAD: Readonly<Partial<Record<WeaponId, SpreadDef>>> = Object.freeze({
	pistol: { min: 3, max: 6, duckMin: 2.5, duckMax: 5, fire: 0.35, recover: 2.5, holdMs: 150 },
	smg: { min: 3, max: 5, duckMin: 2, duckMax: 4.5, fire: 0.12, recover: 2, holdMs: 100 },
	lmg: { min: 4, max: 10, duckMin: 3.5, duckMax: 8, fire: 0.08, recover: 1.5, holdMs: 120 },
	striker: { min: 1, max: 1, duckMin: 1, duckMax: 1, fire: 0, recover: 0, holdMs: 0 },
	sniper: { min: 10, max: 15, duckMin: 9.5, duckMax: 14, fire: 0.5, recover: 1, holdMs: 200 },
	barrett: { min: 10, max: 15, duckMin: 9.5, duckMax: 14, fire: 0.4, recover: 1.5, holdMs: 400 }
});

/** Below this share of the gun's run speed the player counts as standing still. */
export const STILL_SPEED_SHARE = 0.15;

/** Movement penalty share 0..1 for a horizontal speed (u/s) with a gun whose run speed is `runSpeed`. */
export function moveShare(speed: number, runSpeed: number): number {
	if (!(runSpeed > 0)) return 0;
	return clamp((speed / runSpeed - STILL_SPEED_SHARE) / (1 - STILL_SPEED_SHARE), 0, 1);
}

/** Bloom of sustained fire: grows per shot up to 1 (the full hip cone) and recovers over time. */
export class Bloom {
	/** Current bloom: share 0..1 of the way from the hip cone's min to its max. */
	value = 0;
	private at = 0;
	private recoverAt = 0;
	private rate = 0;

	/** Advance to `now` (ms). */
	update(now: number): void {
		const from = Math.max(this.at, this.recoverAt);
		if (now > this.at) this.at = now;
		if (this.value > 0 && now > from) this.value = Math.max(0, this.value - (this.rate * (now - from)) / 1000);
	}

	/** A shot of `weapon` left at `now`. */
	add(weapon: WeaponId, now: number): void {
		this.update(now);
		const f = SPREAD[weapon];
		if (!f || f.fire <= 0) return;
		this.value = Math.min(1, this.value + f.fire);
		this.rate = f.recover;
		this.recoverAt = now + f.holdMs;
	}

	reset(): void {
		this.value = 0;
	}
}

export interface AimInput {
	/** Bloom now (share 0..1, `Bloom.value`). */
	bloom: number;
	/** Aim progress 0..1 (eased; 1 = fully aimed). */
	aim: number;
	/** Horizontal speed (u/s). */
	speed: number;
	onGround: boolean;
	ducked: boolean;
	/** Perk factor on the hip cone (Steady Aim: INF_STEADY_SPREAD_FACTOR). */
	factor: number;
}

/** Hip cone half-angle (degrees) of `weapon` right now, whatever the aim: what the crosshair shows. 0 for melee. */
export function hipSpread(weapon: WeaponId, a: AimInput): number {
	const def = WEAPONS[weapon];
	const f = SPREAD[weapon];
	if (def.magazine === 0 || !f) return 0;
	const duck = a.onGround && a.ducked;
	const lo = duck ? f.duckMin : f.min;
	const hi = duck ? f.duckMax : f.max;
	const heat = clamp(Math.max(0, a.bloom) + (a.onGround ? moveShare(a.speed, def.moveSpeed) : 1), 0, 1);
	return (lo + (hi - lo) * heat) * a.factor;
}

/** Aim spread half-angle (degrees) a shot gets now: the hip cone, shrinking with the aim progress to 0 fully aimed. */
export function aimSpread(weapon: WeaponId, a: AimInput): number {
	return hipSpread(weapon, a) * (1 - clamp(a.aim, 0, 1));
}

/** Crosshair opacity at aim progress `aim` (eased): it fades as the sights come up and is gone fully aimed. */
export function crosshairOpacity(aim: number | undefined): number {
	return 1 - clamp(aim ?? 0, 0, 1);
}

// ---------------------------------------------------------------------
// Zoom

/**
 * FOV (horizontal at 4:3, degrees) at zoom progress `t` between the player's
 * `fov` and the scope's `zoom`. Interpolates tan(fov / 2), so the picture
 * grows at an even rate.
 */
export function zoomFov(fov: number, zoom: number, t: number): number {
	const a = Math.tan((fov * RAD) / 2);
	const b = Math.tan((zoom * RAD) / 2);
	return (2 * Math.atan(a + (b - a) * clamp(t, 0, 1))) / RAD;
}

/**
 * Mouse sensitivity factor while zoomed: `ratio` × tan(current / 2) / tan(fov / 2),
 * with both FOVs horizontal at 4:3 (render/fov.ts). At ratio 1 a mouse move
 * shifts the picture as far on screen as unzoomed. `t` (zoom progress) fades the
 * ratio in, so the factor is 1 at `t` = 0 whatever the ratio.
 */
export function zoomSensitivity(fov: number, current: number, ratio: number, t: number): number {
	const base = Math.tan((fov * RAD) / 2);
	if (!(base > 0)) return 1;
	return (1 + (ratio - 1) * clamp(t, 0, 1)) * (Math.tan((current * RAD) / 2) / base);
}

// ---------------------------------------------------------------------
// Crosshair

/**
 * Screen distance (CSS px) from the centre to the edge of a cone of half-angle
 * `deg`, for a view of `fov` (horizontal at 4:3) on a viewport `viewportH` px
 * high. The vertical FOV is the same for every aspect (render/fov.ts).
 */
export function spreadGapPx(deg: number, fov: number, viewportH: number): number {
	if (!(deg > 0) || !(viewportH > 0)) return 0;
	const half = (verticalFovFromHorizontal43(fov) * RAD) / 2;
	return (Math.tan(Math.min(deg, 60) * RAD) / Math.tan(half)) * (viewportH / 2);
}

// ---------------------------------------------------------------------
// Knockback

/** Knockback never pushes the player past this speed along the hit direction (u/s). */
export const KNOCKBACK_CAP = 300;

/**
 * Knockback as an impulse: adds the push (kx, ky) to the horizontal velocity
 * `v` in place. The speed along the push direction is capped at `cap`: a hit
 * adds at most what is missing up to the cap, and nothing when the player
 * already moves that fast that way. So a hit head-on takes speed away, hits
 * from behind and stacked hits cannot launch anyone, and the sideways part of
 * the velocity is never touched.
 */
export function addKnockback(v: { x: number; y: number }, kx: number, ky: number, cap = KNOCKBACK_CAP): void {
	const k = Math.hypot(kx, ky);
	if (!(k > 0) || !Number.isFinite(k)) return;
	const nx = kx / k;
	const ny = ky / k;
	const add = Math.max(0, Math.min(k, cap - (v.x * nx + v.y * ny)));
	v.x += nx * add;
	v.y += ny * add;
}

// ---------------------------------------------------------------------
// Weapon swaps

/**
 * The server answers every accepted `loadout` with an `ammo` event. The client
 * waits this long for it (a refused swap gets no answer), and remembers at most
 * this many swaps at once.
 */
export const SWAP_ACK_MS = 1500;
export const MAX_PENDING_SWAPS = 8;

// ---------------------------------------------------------------------
// Viewmodel motion (render/zombies.ts applies these to the gun model)

/**
 * Push-back envelope of the viewmodel (the visual recoil), `t` ms after a
 * shot: an ease-out attack from `from` (where the last shot left the gun) to 1
 * over `attackMs`, then a critically damped return that is back at 0 at `ms`.
 * Fast fire pushes again before the return ends, so an automatic gun stays
 * pushed back. The gun's rotation is `GunKick`.
 */
export function vmKick(t: number, attackMs: number, ms: number, from = 0): number {
	if (!(t >= 0) || t >= ms) return 0;
	if (t < attackMs) {
		const u = 1 - t / attackMs;
		return from + (1 - from) * (1 - u * u);
	}
	const u = (t - attackMs) / Math.max(1e-6, ms - attackMs);
	const a = 6;
	const end = (1 + a) * Math.exp(-a);
	return ((1 + a * u) * Math.exp(-a * u) - end) / (1 - end);
}

/**
 * Gun kick of the first-person weapon model: random velocities per shot that
 * rotate the gun about its grip, pulled back to centre. Purely visual (hip
 * fire has no sights): the camera and the shots never see it. Angles in
 * degrees, pitch + = muzzle up, yaw + = muzzle left.
 */
export interface GunKickDef {
	/** Velocity range a shot adds (deg/s). */
	pitchMin: number;
	pitchMax: number;
	yawMin: number;
	yawMax: number;
	/** Constant pull back to centre (deg/s²). */
	accel: number;
	/** Taken off `accel` once the gun stops moving away from centre (deg/s²). */
	staticDecay: number;
	/** Linear drag against the motion (1/s): deceleration = speedDecay × speed. */
	speedDecay: number;
	/** Largest speed per axis after a shot (deg/s). */
	speedMax: number;
	/** Largest deflection (degrees). */
	maxPitch: number;
	maxYaw: number;
}

/**
 * Gun kick per gun. One shot from rest (middle of the range) peaks at about:
 * pistol 4.6°, SMG 0.9°, LMG 1.3°, shotgun 10°, bolt-action rifle 12°,
 * .50 cal 16° of muzzle climb, back in 0.12 to 0.6 s. Automatic fire adds
 * the velocities up, so the SMG and the LMG climb and shake during a spray.
 */
export const GUN_KICK: Readonly<Partial<Record<WeaponId, GunKickDef>>> = Object.freeze({
	pistol: { pitchMin: 150, pitchMax: 190, yawMin: -30, yawMax: 30, accel: 1400, staticDecay: 700, speedDecay: 16, speedMax: 500, maxPitch: 11, maxYaw: 3 },
	smg: { pitchMin: 50, pitchMax: 80, yawMin: -45, yawMax: 45, accel: 1100, staticDecay: 500, speedDecay: 26, speedMax: 300, maxPitch: 5, maxYaw: 2.5 },
	lmg: { pitchMin: 55, pitchMax: 85, yawMin: -60, yawMax: 60, accel: 1000, staticDecay: 450, speedDecay: 20, speedMax: 350, maxPitch: 7, maxYaw: 3 },
	striker: { pitchMin: 260, pitchMax: 300, yawMin: -50, yawMax: 50, accel: 1500, staticDecay: 700, speedDecay: 14, speedMax: 600, maxPitch: 15, maxYaw: 4 },
	sniper: { pitchMin: 250, pitchMax: 290, yawMin: -30, yawMax: 30, accel: 1000, staticDecay: 450, speedDecay: 11, speedMax: 600, maxPitch: 15, maxYaw: 3 },
	barrett: { pitchMin: 330, pitchMax: 380, yawMin: -60, yawMax: 60, accel: 1200, staticDecay: 500, speedDecay: 11, speedMax: 700, maxPitch: 20, maxYaw: 4 }
});

/**
 * Share of the gun kick that turns the point of aim while aimed through iron
 * sights (eased in with the aim; the shown kick shrinks to the same share, so
 * the shots follow the sights). From the hip the gun kick is only seen. Ours:
 * the calibration source has no aimed gun-kick values, and `GUN_KICK` is
 * tuned for the hip look (a full pistol follow-up would land 3 to 4° off).
 * Through a scope the model is hidden and the scoped view kick carries it all.
 */
export const AIM_GUN_KICK = 0.25;

/** Gun kick integration step (ms), on the model's own clock grid. */
export const GUN_KICK_STEP_MS = 1;
/** Within this angle (degrees) and under this speed (deg/s) the gun snaps to centre. */
export const GUN_KICK_DEAD_ANGLE = 0.25;
export const GUN_KICK_DEAD_SPEED = 1;
/** A gap longer than this (ms) puts the gun straight back to rest. */
const GUN_KICK_MAX_GAP_MS = 5000;

/**
 * Gun kick state. Every shot adds a random velocity to what the gun already
 * has (kicks add up, and can cancel). A constant pull brings it back to
 * centre, weaker by `staticDecay` once it stops moving away; a linear drag
 * opposes the motion; the speed is capped; it may swing past centre; near
 * centre and slow it snaps to rest; per-gun limits bound it.
 *
 * Integrated in fixed `GUN_KICK_STEP_MS` steps on a grid of the caller's
 * clock, so any update step gives the same pose. No allocation per frame.
 */
export class GunKick {
	/** Muzzle up / left (degrees). */
	pitch = 0;
	yaw = 0;
	private vPitch = 0;
	private vYaw = 0;
	/** Grid time the state is at (ms). */
	private at = -Infinity;
	private def: GunKickDef | null = null;

	constructor(private readonly rng: () => number = Math.random) {}

	get resting(): boolean {
		return this.pitch === 0 && this.yaw === 0 && this.vPitch === 0 && this.vYaw === 0;
	}

	/** Velocities (deg/s): muzzle up, left. */
	get speedPitch(): number {
		return this.vPitch;
	}

	get speedYaw(): number {
		return this.vYaw;
	}

	/** Advance to `now` (ms). */
	update(now: number): void {
		const grid = Math.floor(now / GUN_KICK_STEP_MS) * GUN_KICK_STEP_MS;
		if (!(grid > this.at)) {
			if (this.at === -Infinity && Number.isFinite(grid)) this.at = grid;
			return;
		}
		const steps = Math.round((grid - this.at) / GUN_KICK_STEP_MS);
		this.at = grid;
		const def = this.def;
		if (!def || this.resting) return;
		if (!(steps * GUN_KICK_STEP_MS <= GUN_KICK_MAX_GAP_MS)) {
			this.reset();
			return;
		}
		const dt = GUN_KICK_STEP_MS / 1000;
		for (let n = 0; n < steps && !this.resting; n++) {
			let p = this.pitch;
			let vp = this.step(def, p, this.vPitch, dt);
			p += vp * dt;
			if (Math.abs(p) > def.maxPitch) {
				p = Math.sign(p) * def.maxPitch;
				vp = 0;
			}
			if (Math.abs(p) < GUN_KICK_DEAD_ANGLE && Math.abs(vp) < GUN_KICK_DEAD_SPEED) p = vp = 0;
			let y = this.yaw;
			let vy = this.step(def, y, this.vYaw, dt);
			y += vy * dt;
			if (Math.abs(y) > def.maxYaw) {
				y = Math.sign(y) * def.maxYaw;
				vy = 0;
			}
			if (Math.abs(y) < GUN_KICK_DEAD_ANGLE && Math.abs(vy) < GUN_KICK_DEAD_SPEED) y = vy = 0;
			this.pitch = p;
			this.vPitch = vp;
			this.yaw = y;
			this.vYaw = vy;
		}
	}

	/** New velocity of one axis after `dt` s: pull to centre (full while moving away) and drag. */
	private step(def: GunKickDef, x: number, v: number, dt: number): number {
		if (x === 0 && v === 0) return 0;
		const away = x === 0 || Math.sign(v) === Math.sign(x);
		const pull = away ? def.accel : Math.max(0, def.accel - def.staticDecay);
		const dir = x !== 0 ? -Math.sign(x) : -Math.sign(v);
		return v + (dir * pull - def.speedDecay * v) * dt;
	}

	/** A shot with `def` at `now`: add its random velocity, capped at `speedMax`. */
	kickWith(def: GunKickDef, now: number): void {
		this.update(now);
		this.def = def;
		const cap = def.speedMax;
		this.vPitch = clamp(this.vPitch + def.pitchMin + (def.pitchMax - def.pitchMin) * this.rng(), -cap, cap);
		this.vYaw = clamp(this.vYaw + def.yawMin + (def.yawMax - def.yawMin) * this.rng(), -cap, cap);
	}

	/** A shot of `weapon` (guns without a `GUN_KICK` entry have none). */
	kick(weapon: WeaponId, now: number): void {
		const def = GUN_KICK[weapon];
		if (def) this.kickWith(def, now);
		else this.update(now);
	}

	/** Back to rest at once (weapon switch); the clock starts again at the next call. */
	reset(): void {
		this.pitch = this.yaw = this.vPitch = this.vYaw = 0;
		this.at = -Infinity;
	}
}

/**
 * Draw animation: how far the gun is still lowered (1 = out of view, 0 = up)
 * at progress `p` of the draw. Eases out with a small overshoot, so the gun
 * comes up fast and settles as the draw time ends.
 */
export function vmDraw(p: number): number {
	if (!(p > 0)) return 1;
	if (p >= 1) return 0;
	const c = 1.4;
	const u = p - 1;
	return -((c + 1) * u * u * u + c * u * u);
}

/** One-shot bump 0..1 at progress `u` (0..1): up fast, back slowly (landing dip, dry-fire nudge). */
export function vmBump(u: number): number {
	if (!(u > 0) || u >= 1) return 0;
	return Math.sin(Math.PI * Math.sqrt(u));
}

/** Landing dip length (ms), the fall speed (u/s) of a full dip, and the slowest landing that dips at all. */
export const VM_LAND_MS = 260;
export const VM_LAND_SPEED = 600;
export const VM_LAND_MIN_SPEED = 120;
/** Dry-fire nudge length (ms). */
export const VM_DRY_MS = 140;
/** Sway smoothing time constant (ms). */
export const VM_SWAY_MS = 90;
/** Share of the sway and the walk bob taken away when fully aimed. */
export const VM_AIM_STEADY = 0.85;

/** Extra viewmodel motion for one frame; all zero except `draw` = 1 is the rest pose. */
export interface VmFeel {
	/** Sway: right / up (viewmodel units), roll, yaw and pitch (rad). */
	x: number;
	y: number;
	roll: number;
	yaw: number;
	pitch: number;
	/** Landing dip 0..1. */
	land: number;
	/** Dry-fire nudge 0..1. */
	dry: number;
	/** How far the gun is still lowered by the draw (1 = out of view). */
	lower: number;
	/** Aim down sights progress 0..1 (eased): the gun moves to its aimed pose, sights on the view axis. */
	aim: number;
	/**
	 * Gun kick to show instead of the renderer's own (degrees, muzzle up /
	 * left): the infected client owns it, because aimed it moves the shots.
	 */
	gun?: { pitch: number; yaw: number };
}

export function restVmFeel(): VmFeel {
	return { x: 0, y: 0, roll: 0, yaw: 0, pitch: 0, land: 0, dry: 0, lower: 0, aim: 0 };
}

/**
 * Viewmodel sway: the gun lags behind the view when the mouse turns it and
 * leans with the player's movement, smoothed so it trails and settles.
 */
export class VmSway {
	x = 0;
	y = 0;
	roll = 0;
	yaw = 0;
	pitch = 0;

	/**
	 * `turnYaw`, `turnPitch`: view turn rates (deg/s, Source signs: yaw + = left,
	 * pitch + = down); `side`: strafe speed (u/s, + = right); `vz`: vertical speed (u/s).
	 */
	update(dtMs: number, turnYaw: number, turnPitch: number, side: number, vz: number): void {
		const a = 1 - Math.exp(-Math.max(0, dtMs) / VM_SWAY_MS);
		const turn = clamp(turnYaw / 360, -1, 1);
		const nod = clamp(turnPitch / 360, -1, 1);
		const strafe = clamp(side / 250, -1, 1);
		const rise = clamp(vz / 400, -1, 1);
		// The gun trails the view: turning left leaves it on the right, still pointing where the view was.
		// Strafing shifts it against the move and leans it; rising or falling leaves it behind vertically.
		this.x += (turn * 0.9 - strafe * 0.35 - this.x) * a;
		this.y += (nod * 0.6 - rise * 0.6 - this.y) * a;
		this.roll += (-strafe * 0.05 + turn * 0.04 - this.roll) * a;
		this.yaw += (-turn * 0.06 - this.yaw) * a;
		this.pitch += (nod * 0.05 - this.pitch) * a;
	}

	reset(): void {
		this.x = this.y = this.roll = this.yaw = this.pitch = 0;
	}
}
