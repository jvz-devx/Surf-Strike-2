/**
 * CS2 player movement (walk/air only: no water, ladders or noclip) on a fixed 64 tick with subtick
 * input. Built on a Source 2013 CGameMovement port (collision, TryPlayerMove, step move,
 * CategorizePosition) with the CS2 changes documented in docs/physics.md:
 *
 * - Every tick is split at each input change (UserCmd.subtick); each piece runs the full move
 *   (duck, jump check, walk/air move, categorize) for its share of the tick.
 * - Friction, acceleration and gravity are integrated at the midpoint: half before the position
 *   update, half after.
 * - Ground friction uses the 2D speed and a per-tick stashed speed so split ticks do not compound
 *   it; ground speed is clamped to the (landing-penalised) max speed after acceleration.
 * - "Deadstrafe": air acceleration is quartered while rising at 0 < vz <= 140 (not while surfing).
 * - Modern jump (sv_legacy_jump 0): bhop window around a subtick landing time, landing velocity
 *   restore and landing penalty. Legacy jump (1): CS:GO old-buttons rule, no penalty.
 * - CS2 duck amount model (m_flDuckAmount / m_flDuckSpeed / sv_timebetweenducks).
 *
 * The module keeps per-call context in module-level variables (like Source's `mv` / `player`
 * members); playerMove is not re-entrant, which is fine for single-threaded JS.
 */
import type { CollisionWorld, Trace } from '../collision/api.ts';
import { DIST_EPSILON } from '../collision/api.ts';
import { MAX_VELOCITY_HARD, type Cvars } from '../cvars.ts';
import type { Vec3 } from '../types.ts';
import { TICK_INTERVAL } from '../units.ts';
import {
	DUCK_HULL_MAX,
	DUCK_VIEW_HEIGHT,
	HULL_MAX,
	HULL_MIN,
	IN_DUCK,
	IN_JUMP,
	VIEW_HEIGHT,
	type PlayerState,
	type UserCmd
} from './api.ts';

/** CS_PLAYER_SPEED_DUCK_MODIFIER: ground max speed factor when fully ducked. */
const DUCK_SPEED_MULTIPLIER = 0.34;
/** In-air duck lifts the feet by half the hull difference (CS centred shrink): 9 units. */
const DUCK_LIFT = (HULL_MAX.z - DUCK_HULL_MAX.z) * 0.5;
/** CS_PLAYER_DUCK_SPEED_IDEAL: duck amount per second. */
const DUCK_SPEED_IDEAL = 8;
/** Below this duck speed a new duck cannot start; unducking never runs slower. */
const DUCK_SPEED_MIN = 1.5;
/** Duck speed lost each time the duck key changes state. */
const DUCK_SPAM_PENALTY = 2;
/** Standing up drops the ducked flag once the duck amount falls to this. */
const DUCK_UNFLAG_AMOUNT = 0.75;
/** Moving this far from the last full-duck-speed spot recovers duck speed faster. */
const DUCK_SPEED_RECOVERY_DISTANCE = 64;
/** Above this upward speed the player is never on ground (NON_JUMP_VELOCITY). */
const NON_JUMP_VELOCITY = 140;
const MAX_CLIP_PLANES = 5;
/** CS2 PreventBunnyJumping cap (sv_enablebunnyhopping 0): 1.1 × 260, regardless of weapon. */
const BUNNYJUMP_MAX_SPEED = 1.1 * 260;
/** Ground accel scale floor (CS2 Accelerate: max(250, wishspeed)). */
const ACCEL_SCALE_MIN = 250;
/** Air accel factor while airborne and rising at 0 < vz <= 140 ("deadstrafe"). */
const JUMP_SURFACE_FRICTION = 0.25;
/** Modern jump landing penalty (fitted constants, ValveResourceFormat PlayerMovement.cs). */
const LANDING_PENALTY_PER_SPEED = 0.0005;
const LANDING_SPEED_RECOVERY_RATE = 1.1111894;
const LANDING_JUMP_RECOVERY_RATE = 0.6;
/** Jump press times are rounded to 1/64 of a tick before the spam/window checks. */
const JUMP_PRESS_STEPS = 64;
/** Latest subtick fraction (inputs are timestamped at 1/4096 s ≈ 1/64 tick). */
const MAX_WHEN = 1 - 1 / 4096;
const COORD_RESOLUTION = 1 / 32;

export function createPlayer(origin: Vec3): PlayerState {
	return {
		origin: { x: origin.x, y: origin.y, z: origin.z },
		velocity: { x: 0, y: 0, z: 0 },
		onGround: false,
		groundNormalZ: 0,
		ducked: false,
		ducking: false,
		duckAmount: 0,
		duckFlag: false,
		duckSpeed: DUCK_SPEED_IDEAL,
		desiresDuck: false,
		timeSinceDuck: 10,
		duckSpeedX: origin.x,
		duckSpeedY: origin.y,
		oldButtons: 0,
		tick: 0,
		lastJumpPress: -Infinity,
		usableJumpPress: -Infinity,
		landedTime: -Infinity,
		landedVx: 0,
		landedVy: 0,
		landedVz: 0,
		surfaceFriction: 1,
		jumped: false,
		landedSpeed: 0,
		surfing: false
	};
}

export function playerMaxs(p: PlayerState): Vec3 {
	return p.ducked ? DUCK_HULL_MAX : HULL_MAX;
}

/** Eye height above the origin: 64 standing, 46 fully ducked, blended by the duck amount. */
export function eyeHeight(p: PlayerState): number {
	const f = Math.min(1, Math.max(0, p.duckAmount));
	return VIEW_HEIGHT + (DUCK_VIEW_HEIGHT - VIEW_HEIGHT) * f;
}

// ---- per-call context (Source's mv / player) ----
let W!: CollisionWorld;
let P!: PlayerState;
let C!: Cvars;
/** Full tick length (s). */
let TICK_DT = TICK_INTERVAL;
/** Length of the current subtick segment (s). */
let DT = TICK_INTERVAL;
/** Start of the current segment, in ticks (P.tick + when). */
let NOW = 0;
let fmove = 0;
let smove = 0;
let maxspeed = 0;
let buttons = 0;
/** Speed stashed by the first ground friction of the tick (CS2 m_flFrictionStashedSpeed), -1 = none. */
let frictionStash = -1;
/** Touched a non-walkable plane in this segment (no deadstrafe while surfing). */
let touchSurf = false;
const forward: Vec3 = { x: 0, y: 0, z: 0 };
const right: Vec3 = { x: 0, y: 0, z: 0 };

// scratch vectors
const sWishdir: Vec3 = { x: 0, y: 0, z: 0 };
const sDeferred: Vec3 = { x: 0, y: 0, z: 0 };
const sDest: Vec3 = { x: 0, y: 0, z: 0 };
const sEnd: Vec3 = { x: 0, y: 0, z: 0 };
const sStart: Vec3 = { x: 0, y: 0, z: 0 };
const sPos: Vec3 = { x: 0, y: 0, z: 0 };
const sVel: Vec3 = { x: 0, y: 0, z: 0 };
const sDownPos: Vec3 = { x: 0, y: 0, z: 0 };
const sDownVel: Vec3 = { x: 0, y: 0, z: 0 };
const sPrimal: Vec3 = { x: 0, y: 0, z: 0 };
const sOriginal: Vec3 = { x: 0, y: 0, z: 0 };
const sNew: Vec3 = { x: 0, y: 0, z: 0 };
const sDir: Vec3 = { x: 0, y: 0, z: 0 };
const sQMins: Vec3 = { x: 0, y: 0, z: 0 };
const sQMaxs: Vec3 = { x: 0, y: 0, z: 0 };
const sPlanes: Vec3[] = Array.from({ length: MAX_CLIP_PLANES }, () => ({ x: 0, y: 0, z: 0 }));

/**
 * Advance one tick (`dt` seconds). Mutates `p`. The tick is split at every `cmd.subtick` event;
 * each piece runs the whole move with its own share of `dt`.
 */
export function playerMove(world: CollisionWorld, p: PlayerState, cmd: UserCmd, cvars: Cvars, dt = TICK_INTERVAL): void {
	W = world;
	P = p;
	C = cvars;
	TICK_DT = dt;
	p.jumped = false;
	p.landedSpeed = 0;
	p.surfing = false;
	frictionStash = -1;
	setupAngles(cmd);

	const t0 = p.tick;
	let b = cmd.buttons;
	let fm = cmd.forwardmove;
	let sm = cmd.sidemove;
	// A jump press is a rising edge against the buttons at the end of the previous tick.
	let pressed = (b & IN_JUMP) !== 0 && (p.oldButtons & IN_JUMP) === 0;
	let pressTime = t0;
	let segStart = 0;
	const events = cmd.subtick;
	const n = events ? events.length : 0;
	for (let i = 0; i <= n; i++) {
		const ev = i < n ? events![i]! : null;
		let segEnd = 1;
		if (ev) {
			const w = ev.when;
			segEnd = w > segStart ? (w < MAX_WHEN ? w : MAX_WHEN) : segStart;
		}
		if (segEnd > segStart) {
			runSegment(b, fm, sm, pressed, pressTime, t0 + segStart, (segEnd - segStart) * dt);
			pressed = false;
		}
		if (ev) {
			// A press and release at the same instant (mouse wheel) still counts: the press is
			// carried into the next non-empty segment.
			if ((ev.buttons & IN_JUMP) !== 0 && (b & IN_JUMP) === 0) {
				pressed = true;
				pressTime = t0 + Math.round(segEnd * JUMP_PRESS_STEPS) / JUMP_PRESS_STEPS;
			}
			b = ev.buttons;
			fm = ev.forwardmove;
			sm = ev.sidemove;
			segStart = segEnd;
		}
	}
	// CPlayerMove::FinishMove: old buttons = the buttons at the end of this tick.
	p.oldButtons = b;
	p.tick = t0 + 1;
}

/** One subtick move: CS2 runs the full movement code for each piece of a split tick. */
function runSegment(b: number, fm: number, sm: number, pressed: boolean, pressTime: number, now: number, dt: number): void {
	const p = P;
	const v = p.velocity;
	DT = dt;
	NOW = now;
	buttons = b;
	touchSurf = false;
	clampMove(fm, sm);
	const startGround = p.onGround;
	const fall = startGround ? 0 : Math.max(0, -v.z);

	duck();
	maxspeed = computeMaxSpeed();
	if (C.sv_legacy_jump) checkJumpLegacy(pressed);
	else checkJumpModern(pressed, pressTime);
	maxspeed = computeMaxSpeed();

	const airborne = !p.onGround;
	const moveStartZ = p.origin.z;
	const moveStartVz = v.z;
	const wishspeed = wish();

	// Friction, acceleration and gravity act over the whole segment: the move uses the velocity
	// halfway through it and the other half is added after (CS2 midpoint integration).
	const d = sDeferred;
	d.x = d.y = d.z = 0;
	if (p.onGround) {
		v.z = 0;
		const sx = v.x,
			sy = v.y;
		const frictionLeft = friction();
		accelerate(sWishdir, wishspeed, C.sv_accelerate, frictionLeft);
		// Ground speed cap (also what stops a hard landing dead under the landing penalty).
		const spd = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
		if (spd > maxspeed && spd > 0) {
			const f = maxspeed / spd;
			v.x *= f;
			v.y *= f;
			v.z *= f;
		}
		d.x = (v.x - sx) * 0.5;
		d.y = (v.y - sy) * 0.5;
		v.x -= d.x;
		v.y -= d.y;
	} else {
		airAccelerateHalf(sWishdir, wishspeed, C.sv_airaccelerate, d);
		const halfGravity = C.sv_gravity * 0.5 * DT;
		v.z -= halfGravity;
		d.z -= halfGravity;
	}
	checkVelocity();

	const fallMid = airborne ? Math.max(fall, -v.z) : fall;
	if (p.onGround) {
		const ex = v.x + d.x,
			ey = v.y + d.y,
			ez = v.z + d.z;
		if (ex * ex + ey * ey + ez * ez < 1) {
			v.x = v.y = v.z = 0;
		} else {
			walkMove();
		}
	} else {
		tryPlayerMove();
	}
	// A move stopped dead also drops the rest of the segment's acceleration.
	if (v.x !== 0 || v.y !== 0 || v.z !== 0) {
		v.x += d.x;
		v.y += d.y;
		v.z += d.z;
	}
	checkVelocity();
	categorizePosition();
	if (p.onGround) v.z = 0;

	if (!startGround && p.onGround) p.landedSpeed = Math.max(p.landedSpeed, fallMid);
	// Modern-jump landing record: only for a fall that touched down during this move.
	if (airborne && p.onGround && moveStartVz < 0) recordLanding(p.origin.z - moveStartZ, moveStartVz, fallMid);
}

function clampMove(fm: number, sm: number): void {
	const max = C.sv_maxspeed;
	fmove = fm;
	smove = sm;
	const spd = fmove * fmove + smove * smove;
	if (spd !== 0 && spd > max * max) {
		const ratio = max / Math.sqrt(spd);
		fmove *= ratio;
		smove *= ratio;
	}
}

function setupAngles(cmd: UserCmd): void {
	const yaw = (cmd.yaw * Math.PI) / 180;
	const cy = Math.cos(yaw),
		sy = Math.sin(yaw);
	// AngleVectors flattened: movement uses yaw only (pitch is clamped to ±89, so never degenerate).
	forward.x = cy;
	forward.y = sy;
	forward.z = 0;
	right.x = sy;
	right.y = -cy;
	right.z = 0;
}

function trace(start: Vec3, end: Vec3): Trace {
	return W.trace(start, end, HULL_MIN, playerMaxs(P));
}

function setGround(tr: Trace | null): void {
	if (tr) {
		P.onGround = true;
		P.groundNormalZ = tr.plane.normal.z;
		P.velocity.z = 0;
	} else {
		P.onGround = false;
		P.groundNormalZ = 0;
	}
}

/** Max speed for this move: sv_maxspeed, modern landing penalty and the ducked ground slowdown. */
function computeMaxSpeed(): number {
	let m = C.sv_maxspeed;
	if (P.onGround) {
		if (!C.sv_legacy_jump) m *= landingSpeedScale();
		m *= 1 + (DUCK_SPEED_MULTIPLIER - 1) * Math.min(1, Math.max(0, P.duckAmount));
	}
	return m;
}

// ---- duck (CS2 duck amount model) ----

function approach(value: number, target: number, step: number): number {
	if (value < target) return value + step < target ? value + step : target;
	return value - step > target ? value - step : target;
}

function duck(): void {
	const p = P;
	const held = (buttons & IN_DUCK) !== 0;
	if (p.desiresDuck !== held) {
		p.desiresDuck = held;
		p.duckSpeed = Math.max(0, p.duckSpeed - DUCK_SPAM_PENALTY);
	}
	p.timeSinceDuck += DT;
	const canStart = p.duckSpeed >= DUCK_SPEED_MIN && (p.duckFlag || p.timeSinceDuck >= C.sv_timebetweenducks);
	const wantsDuck = held && canStart;

	p.duckSpeed = approach(p.duckSpeed, DUCK_SPEED_IDEAL, DT * 3);
	if (p.duckSpeed >= DUCK_SPEED_IDEAL) {
		p.duckSpeedX = p.origin.x;
		p.duckSpeedY = p.origin.y;
	} else if (
		(p.duckAmount <= 0 || p.duckAmount >= 1) &&
		(p.origin.x - p.duckSpeedX) ** 2 + (p.origin.y - p.duckSpeedY) ** 2 > DUCK_SPEED_RECOVERY_DISTANCE ** 2
	) {
		p.duckSpeed = approach(p.duckSpeed, DUCK_SPEED_IDEAL, DT * 6);
	}

	if (wantsDuck) {
		if (p.duckAmount < 1) p.ducking = true;
		if (p.ducking) {
			// Ducking is a little slower than unducking.
			p.duckAmount = approach(p.duckAmount, 1, p.duckSpeed * 0.8 * DT);
			if (p.duckAmount > 1 - 1e-9 || !p.onGround) finishDuck();
		}
	} else {
		if (p.duckAmount > 0) p.ducking = true;
		if (p.ducking) {
			if (canUnduck()) {
				p.duckAmount = approach(p.duckAmount, 0, Math.max(DUCK_SPEED_MIN, p.duckSpeed) * DT);
				if (p.duckAmount < 1e-9 || !p.onGround) finishUnduck();
				else p.ducked = false; // on the ground the standing hull comes back at once (feet stay)
				if (p.duckAmount <= DUCK_UNFLAG_AMOUNT) p.duckFlag = false;
			} else {
				// Stay fully ducked under the obstruction and try again once clear of it.
				p.duckAmount = 1;
				p.ducked = true;
				p.ducking = false;
				p.duckFlag = true;
			}
		}
	}
}

function finishDuck(): void {
	const p = P;
	const wasDucked = p.ducked;
	p.ducked = true;
	p.ducking = false;
	p.duckFlag = true;
	p.timeSinceDuck = 0;
	p.duckAmount = 1;
	// Airborne, the legs tuck up instead of the head coming down.
	if (!wasDucked && !p.onGround) p.origin.z += DUCK_LIFT;
	categorizePosition();
}

function finishUnduck(): void {
	const p = P;
	const wasDucked = p.ducked;
	const inAir = !p.onGround;
	p.ducked = false;
	p.ducking = false;
	p.duckFlag = false;
	p.duckAmount = 0;
	if (wasDucked && inAir) p.origin.z -= DUCK_LIFT;
	categorizePosition();
}

/** The standing hull must fit: at the feet on the ground, or swept down 9 units in the air. */
function canUnduck(): boolean {
	const p = P;
	if (!p.ducked) return true;
	sEnd.x = p.origin.x;
	sEnd.y = p.origin.y;
	sEnd.z = p.origin.z - (p.onGround ? 0 : DUCK_LIFT);
	const tr = W.trace(p.origin, sEnd, HULL_MIN, HULL_MAX);
	return !tr.startsolid && tr.fraction === 1;
}

// ---- jump ----

/** CS:GO style (sv_legacy_jump 1): a new press (or a held key with autobhop) while on ground. */
function checkJumpLegacy(pressed: boolean): void {
	const held = (buttons & IN_JUMP) !== 0;
	if (!pressed && !(held && C.sv_autobunnyhopping)) return;
	if (!P.onGround) return; // in air: no effect, the press is not remembered
	doJump(1);
}

function inBhopWindow(t: number): boolean {
	const w = (C.sv_bhop_time_window * 0.5) / TICK_DT;
	return t >= P.landedTime - w && t < P.landedTime + w;
}

/** CS2 modern jump (sv_legacy_jump 0). All times in ticks. */
function checkJumpModern(pressed: boolean, pressTime: number): void {
	const p = P;
	if (pressed) {
		const since = pressTime - p.lastJumpPress;
		p.lastJumpPress = pressTime;
		// sv_jump_spam_penalty_time: a press this soon after the previous one is ignored.
		if (since <= C.sv_jump_spam_penalty_time / TICK_DT + 1e-9) pressed = false;
		else if (!inBhopWindow(p.usableJumpPress)) p.usableJumpPress = pressTime;
	}
	if (pressed || (C.sv_autobunnyhopping && (buttons & IN_JUMP) !== 0)) {
		jumpModern();
		return;
	}
	// A press buffered from just before landing, or held back by the landing tick, still jumps.
	const w = (C.sv_bhop_time_window * 0.5) / TICK_DT;
	const u = p.usableJumpPress;
	if (u >= p.landedTime - w && u < p.landedTime + 1) {
		jumpModern();
		return;
	}
	p.usableJumpPress = -Infinity;
}

function jumpModern(): void {
	const p = P;
	if (!p.onGround) return; // the usable press is kept: the player may still land inside the window
	let jumpTime = NOW;
	let useLanding = false;
	if (inBhopWindow(p.usableJumpPress) || (C.sv_autobunnyhopping && NOW <= p.landedTime + 1)) {
		// A bhop keeps the speed it landed with, if that was above the max speed (autobhop: always).
		useLanding = !!C.sv_autobunnyhopping || p.landedVx * p.landedVx + p.landedVy * p.landedVy > maxspeed * maxspeed;
	}
	if (useLanding) {
		jumpTime = p.landedTime;
		p.velocity.x = p.landedVx;
		p.velocity.y = p.landedVy;
	} else if (NOW < p.landedTime + 1) {
		return; // a regular jump can't happen within a tick of the landing
	}
	p.usableJumpPress = -Infinity;
	doJump(jumpVelocityScale(jumpTime));
}

function doJump(scale: number): void {
	const p = P;
	if (!C.sv_enablebunnyhopping) preventBunnyJumping();
	setGround(null);
	// A standing jump loses the first half of the first half-tick of gravity (CS2, midpoint
	// integration); a ducked jump gets the full impulse.
	const g = C.sv_gravity;
	const impulse = p.ducking || p.duckFlag ? C.sv_jump_impulse : C.sv_jump_impulse - g * 0.5 * (TICK_DT * 0.5);
	p.velocity.z = impulse * scale;
	p.jumped = true;
}

/** CCSGameMovement::PreventBunnyJumping: cap total speed to 1.1 × 260 = 286. */
function preventBunnyJumping(): void {
	const v = P.velocity;
	const spd = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
	if (spd <= BUNNYJUMP_MAX_SPEED) return;
	const f = BUNNYJUMP_MAX_SPEED / spd;
	v.x *= f;
	v.y *= f;
	v.z *= f;
}

function recordLanding(dropZ: number, startVz: number, fallSpeed: number): void {
	const p = P;
	const g = C.sv_gravity;
	// When inside the move the fall touched down: solve z0 + v0 t - g t² / 2 = z1.
	let t = DT;
	let speed = fallSpeed;
	const disc = startVz * startVz - 2 * g * dropZ;
	if (dropZ < 0 && startVz < 0 && disc >= 0 && g > 0) {
		t = Math.min(DT, Math.max(0, (startVz + Math.sqrt(disc)) / g));
		speed = g * t - startVz;
	}
	p.landedTime = NOW + t / TICK_DT;
	p.landedVx = p.velocity.x;
	p.landedVy = p.velocity.y;
	p.landedVz = -speed;
}

function landingPenalty(): number {
	const pen = 1 + P.landedVz * LANDING_PENALTY_PER_SPEED;
	return pen < 0.2 ? 0.2 : pen > 1 ? 1 : pen;
}

/** A hard landing caps the max speed, recovering with every whole tick since the landing. */
function landingSpeedScale(): number {
	if (P.landedTime === -Infinity) return 1;
	const ticks = Math.floor(NOW - P.landedTime);
	const pen = landingPenalty();
	return Math.min(ticks * TICK_DT * LANDING_SPEED_RECOVERY_RATE + pen * pen, 1);
}

/** A hard landing also lowers the next jump, recovering over time. */
function jumpVelocityScale(jumpTime: number): number {
	if (P.landedTime === -Infinity) return 1;
	const seconds = (jumpTime - P.landedTime + 1) * TICK_DT;
	return Math.min(landingPenalty() + seconds * LANDING_JUMP_RECOVERY_RATE, 1);
}

// ---- velocity ----

function checkVelocity(): void {
	const v = P.velocity;
	const o = P.origin;
	const max = Math.min(C.sv_maxvelocity, MAX_VELOCITY_HARD);
	if (Number.isNaN(v.x)) v.x = 0;
	if (Number.isNaN(v.y)) v.y = 0;
	if (Number.isNaN(v.z)) v.z = 0;
	if (Number.isNaN(o.x)) o.x = 0;
	if (Number.isNaN(o.y)) o.y = 0;
	if (Number.isNaN(o.z)) o.z = 0;
	if (v.x > max) v.x = max;
	else if (v.x < -max) v.x = -max;
	if (v.y > max) v.y = max;
	else if (v.y < -max) v.y = -max;
	if (v.z > max) v.z = max;
	else if (v.z < -max) v.z = -max;
	// Mode speed cap (hide and seek: 300 u/s while airborne); ground speed is already sv_maxspeed.
	const cap = C.sv_air_speed_cap;
	if (cap > 0 && !P.onGround) {
		const h2 = v.x * v.x + v.y * v.y;
		if (h2 > cap * cap) {
			const f = cap / Math.sqrt(h2);
			v.x *= f;
			v.y *= f;
		}
	}
}

/**
 * Ground friction on the 2D speed. The first ground friction of a tick stashes its speed; later
 * pieces of a split tick take their drop from it, so splitting does not compound friction.
 * Returns how much more friction there was than speed left, which comes off the acceleration.
 */
function friction(): number {
	const v = P.velocity;
	const speed = Math.sqrt(v.x * v.x + v.y * v.y);
	if (speed < 0.1) return 0;
	if (frictionStash < 0) frictionStash = speed;
	const control = frictionStash < C.sv_stopspeed ? C.sv_stopspeed : frictionStash;
	const drop = control * C.sv_friction * DT;
	let newspeed = speed - drop;
	if (newspeed < 0) newspeed = 0;
	if (newspeed !== speed) {
		const f = newspeed / speed;
		v.x *= f;
		v.y *= f;
		v.z *= f;
	}
	return drop > speed ? drop - speed : 0;
}

/** CS2 Accelerate: rate scales with max(250, wishspeed) (0.34× ducked), minus leftover friction. */
function accelerate(wishdir: Vec3, wishspeed: number, accel: number, frictionLeft: number): void {
	const v = P.velocity;
	const currentspeed = v.x * wishdir.x + v.y * wishdir.y + v.z * wishdir.z;
	const addspeed = wishspeed - currentspeed;
	if (addspeed <= 0) return;
	const ducking = (buttons & IN_DUCK) !== 0 || P.ducking || P.duckFlag;
	let scale = wishspeed > ACCEL_SCALE_MIN ? wishspeed : ACCEL_SCALE_MIN;
	if (ducking) scale *= DUCK_SPEED_MULTIPLIER;
	const rate = scale * accel - frictionLeft / DT;
	if (rate <= 0) return;
	let accelspeed = rate * DT;
	if (accelspeed > addspeed) accelspeed = addspeed;
	v.x += accelspeed * wishdir.x;
	v.y += accelspeed * wishdir.y;
	v.z += accelspeed * wishdir.z;
}

/**
 * AirAccelerate: the wish speed is capped at sv_air_max_wishspeed for the projection test only;
 * the rate uses the full wish speed times the surface friction (0.25 deadstrafe). Half is applied
 * now, the other half is written to `deferred` for after the move.
 */
function airAccelerateHalf(wishdir: Vec3, wishspeed: number, accel: number, deferred: Vec3): void {
	const v = P.velocity;
	const cap = C.sv_air_max_wishspeed;
	const wishspd = wishspeed > cap ? cap : wishspeed;
	const currentspeed = v.x * wishdir.x + v.y * wishdir.y + v.z * wishdir.z;
	const addspeed = wishspd - currentspeed;
	if (addspeed <= 0) return;
	const full = accel * wishspeed * P.surfaceFriction * DT;
	const half = full * 0.5;
	if (half > addspeed) {
		v.x += addspeed * wishdir.x;
		v.y += addspeed * wishdir.y;
		v.z += addspeed * wishdir.z;
		return;
	}
	v.x += half * wishdir.x;
	v.y += half * wishdir.y;
	v.z += half * wishdir.z;
	const rest = full > addspeed ? addspeed - half : half;
	deferred.x += rest * wishdir.x;
	deferred.y += rest * wishdir.y;
	deferred.z += rest * wishdir.z;
}

/** Builds the flat wish direction; returns the (maxspeed-clamped) wish speed. */
function wish(): number {
	let wx = forward.x * fmove + right.x * smove;
	let wy = forward.y * fmove + right.y * smove;
	let wishspeed = Math.sqrt(wx * wx + wy * wy);
	if (wishspeed > 0) {
		wx /= wishspeed;
		wy /= wishspeed;
	}
	sWishdir.x = wx;
	sWishdir.y = wy;
	sWishdir.z = 0;
	if (wishspeed !== 0 && wishspeed > maxspeed) wishspeed = maxspeed;
	return wishspeed;
}

// ---- ground move ----

function walkMove(): void {
	const p = P;
	const v = p.velocity;
	v.z = 0;
	// First try moving directly to the destination.
	sDest.x = p.origin.x + v.x * DT;
	sDest.y = p.origin.y + v.y * DT;
	sDest.z = p.origin.z;
	const tr = trace(p.origin, sDest);
	if (tr.fraction === 1) {
		p.origin.x = tr.endpos.x;
		p.origin.y = tr.endpos.y;
		p.origin.z = tr.endpos.z;
		stayOnGround();
		return;
	}
	stepMove();
	stayOnGround();
}

/** Try the plain slide and the slide raised by sv_stepsize; keep whichever went further in XY. */
function stepMove(): void {
	const p = P;
	const o = p.origin;
	const v = p.velocity;
	const step = C.sv_stepsize + DIST_EPSILON;
	sPos.x = o.x;
	sPos.y = o.y;
	sPos.z = o.z;
	sVel.x = v.x;
	sVel.y = v.y;
	sVel.z = v.z;

	// Slide move down.
	tryPlayerMove();
	sDownPos.x = o.x;
	sDownPos.y = o.y;
	sDownPos.z = o.z;
	sDownVel.x = v.x;
	sDownVel.y = v.y;
	sDownVel.z = v.z;

	// Reset, move up a stair height.
	o.x = sPos.x;
	o.y = sPos.y;
	o.z = sPos.z;
	v.x = sVel.x;
	v.y = sVel.y;
	v.z = sVel.z;
	sEnd.x = o.x;
	sEnd.y = o.y;
	sEnd.z = o.z + step;
	let tr = trace(o, sEnd);
	if (!tr.startsolid && !tr.allsolid) {
		o.x = tr.endpos.x;
		o.y = tr.endpos.y;
		o.z = tr.endpos.z;
	}
	// Slide move up.
	tryPlayerMove();

	// Move down a stair (attempt to).
	sEnd.x = o.x;
	sEnd.y = o.y;
	sEnd.z = o.z - step;
	tr = trace(o, sEnd);
	// Not on the ground any more: use the original movement attempt.
	if (tr.plane.normal.z < C.sv_walkable_normal) {
		o.x = sDownPos.x;
		o.y = sDownPos.y;
		o.z = sDownPos.z;
		v.x = sDownVel.x;
		v.y = sDownVel.y;
		v.z = sDownVel.z;
		return;
	}
	if (!tr.startsolid && !tr.allsolid) {
		o.x = tr.endpos.x;
		o.y = tr.endpos.y;
		o.z = tr.endpos.z;
	}
	const downDist = (sDownPos.x - sPos.x) ** 2 + (sDownPos.y - sPos.y) ** 2;
	const upDist = (o.x - sPos.x) ** 2 + (o.y - sPos.y) ** 2;
	if (downDist > upDist) {
		o.x = sDownPos.x;
		o.y = sDownPos.y;
		o.z = sDownPos.z;
		v.x = sDownVel.x;
		v.y = sDownVel.y;
		v.z = sDownVel.z;
	} else {
		v.z = sDownVel.z; // copy z value from slide move
	}
}

/** Keep the player glued to walkable ground when walking down slopes/stairs. */
function stayOnGround(): void {
	const o = P.origin;
	sStart.x = o.x;
	sStart.y = o.y;
	sStart.z = o.z + 2;
	sEnd.x = o.x;
	sEnd.y = o.y;
	sEnd.z = o.z - C.sv_stepsize;
	// See how far up we can go without getting stuck, then trace down from there.
	let tr = trace(o, sStart);
	sStart.x = tr.endpos.x;
	sStart.y = tr.endpos.y;
	sStart.z = tr.endpos.z;
	tr = trace(sStart, sEnd);
	if (tr.fraction > 0 && tr.fraction < 1 && !tr.startsolid && tr.plane.normal.z >= C.sv_walkable_normal) {
		const delta = Math.abs(o.z - tr.endpos.z);
		if (delta > 0.5 * COORD_RESOLUTION) {
			o.x = tr.endpos.x;
			o.y = tr.endpos.y;
			o.z = tr.endpos.z;
		}
	}
}

/** ClipVelocity with the post-clip adjust that removes residual inward velocity. */
function clipVelocity(inp: Vec3, normal: Vec3, out: Vec3, overbounce: number): void {
	const backoff = (inp.x * normal.x + inp.y * normal.y + inp.z * normal.z) * overbounce;
	out.x = inp.x - normal.x * backoff;
	out.y = inp.y - normal.y * backoff;
	out.z = inp.z - normal.z * backoff;
	const adjust = out.x * normal.x + out.y * normal.y + out.z * normal.z;
	if (adjust < 0) {
		out.x -= normal.x * adjust;
		out.y -= normal.y * adjust;
		out.z -= normal.z * adjust;
	}
}

function tryPlayerMove(): number {
	const p = P;
	const o = p.origin;
	const v = p.velocity;
	const walkable = C.sv_walkable_normal;
	const numbumps = 4;
	let blocked = 0;
	let numplanes = 0;
	sOriginal.x = sPrimal.x = v.x;
	sOriginal.y = sPrimal.y = v.y;
	sOriginal.z = sPrimal.z = v.z;
	let allFraction = 0;
	let timeLeft = DT;
	sNew.x = sNew.y = sNew.z = 0;

	for (let bump = 0; bump < numbumps; bump++) {
		if (v.x === 0 && v.y === 0 && v.z === 0) break;
		sEnd.x = o.x + timeLeft * v.x;
		sEnd.y = o.y + timeLeft * v.y;
		sEnd.z = o.z + timeLeft * v.z;
		const pm = trace(o, sEnd);
		allFraction += pm.fraction;

		// Started in solid / solid the whole way: blocked by floor and wall.
		if (pm.allsolid) {
			v.x = v.y = v.z = 0;
			return 4;
		}

		if (pm.fraction > 0) {
			if (pm.fraction === 1) {
				// Swept box may succeed while the end is stuck; re-test unswept.
				const stuck = trace(pm.endpos, pm.endpos);
				if (stuck.startsolid || stuck.fraction !== 1) {
					v.x = v.y = v.z = 0;
					break;
				}
			}
			o.x = pm.endpos.x;
			o.y = pm.endpos.y;
			o.z = pm.endpos.z;
			sOriginal.x = v.x;
			sOriginal.y = v.y;
			sOriginal.z = v.z;
			numplanes = 0;
		}

		if (pm.fraction === 1) break; // moved the entire distance

		const n = pm.plane.normal;
		if (n.z > 0 && n.z < walkable) {
			p.surfing = true;
			touchSurf = true;
		}
		if (n.z > walkable) blocked |= 1; // floor
		if (n.z === 0) blocked |= 2; // step / wall

		timeLeft -= timeLeft * pm.fraction;

		if (numplanes >= MAX_CLIP_PLANES) {
			v.x = v.y = v.z = 0;
			break;
		}
		const pl = sPlanes[numplanes]!;
		pl.x = n.x;
		pl.y = n.y;
		pl.z = n.z;
		numplanes++;

		// Airborne, first impact plane: plain clip (avoids getting stuck in acute corners).
		if (numplanes === 1 && !p.onGround) {
			clipVelocity(sOriginal, sPlanes[0]!, sNew, 1);
			sOriginal.x = sNew.x;
			sOriginal.y = sNew.y;
			sOriginal.z = sNew.z;
			v.x = sNew.x;
			v.y = sNew.y;
			v.z = sNew.z;
		} else {
			let i = 0;
			for (; i < numplanes; i++) {
				clipVelocity(sOriginal, sPlanes[i]!, v, 1);
				let j = 0;
				for (; j < numplanes; j++) {
					if (j !== i) {
						const q = sPlanes[j]!;
						if (v.x * q.x + v.y * q.y + v.z * q.z < 0) break; // moving against this plane
					}
				}
				if (j === numplanes) break; // didn't have to clip: ok
			}
			if (i === numplanes) {
				// Go along the crease.
				if (numplanes !== 2) {
					v.x = v.y = v.z = 0;
					break;
				}
				const a = sPlanes[0]!,
					b = sPlanes[1]!;
				sDir.x = a.y * b.z - a.z * b.y;
				sDir.y = a.z * b.x - a.x * b.z;
				sDir.z = a.x * b.y - a.y * b.x;
				const l = Math.sqrt(sDir.x * sDir.x + sDir.y * sDir.y + sDir.z * sDir.z);
				if (l > 0) {
					sDir.x /= l;
					sDir.y /= l;
					sDir.z /= l;
				}
				const d = sDir.x * v.x + sDir.y * v.y + sDir.z * v.z;
				v.x = sDir.x * d;
				v.y = sDir.y * d;
				v.z = sDir.z * d;
			}
			// Velocity turned against the original: stop dead to avoid oscillation in corners.
			const d = v.x * sPrimal.x + v.y * sPrimal.y + v.z * sPrimal.z;
			if (d <= 0) {
				v.x = v.y = v.z = 0;
				break;
			}
		}
	}
	if (allFraction === 0) v.x = v.y = v.z = 0;
	return blocked;
}

// ---- CategorizePosition ----

/** Sub-box xy extents (minx, miny, maxx, maxy) for TryTouchGroundInQuadrants. */
const QUADRANTS: ReadonlyArray<readonly [number, number, number, number]> = [
	[HULL_MIN.x, HULL_MIN.y, 0, 0],
	[0, 0, HULL_MAX.x, HULL_MAX.y],
	[HULL_MIN.x, 0, 0, HULL_MAX.y],
	[0, HULL_MIN.y, HULL_MAX.x, 0]
];

function hitGround(tr: Trace): boolean {
	return tr.fraction < 1 && tr.plane.normal.z >= C.sv_standable_normal;
}

function categorizePosition(): void {
	groundProbe();
	const p = P;
	// SurfaceFriction resets each call and is quartered while airborne and rising, but only below
	// NON_JUMP_VELOCITY (faster ascents take the early-out). Not while touching a surf plane
	// (CS2 2025-11-04: "air acceleration clamped incorrectly while surfing").
	const vz = p.velocity.z;
	p.surfaceFriction = !p.onGround && vz > 0 && vz <= NON_JUMP_VELOCITY && !touchSurf ? JUMP_SURFACE_FRICTION : 1;
}

function groundProbe(): void {
	const p = P;
	const o = p.origin;
	// Shooting up really fast: definitely not on ground.
	if (p.velocity.z > NON_JUMP_VELOCITY) {
		setGround(null);
		return;
	}
	sEnd.x = o.x;
	sEnd.y = o.y;
	sEnd.z = o.z - 2;
	const maxs = playerMaxs(p);
	let tr = W.trace(o, sEnd, HULL_MIN, maxs);
	if (hitGround(tr)) {
		setGround(tr);
		return;
	}
	if (tr.fraction < 1 && tr.plane.normal.z > 0) {
		p.surfing = true;
		touchSurf = true;
	}
	// TryTouchGroundInQuadrants: a sub-box may find a shallower slope we can stand on.
	for (const q of QUADRANTS) {
		sQMins.x = q[0];
		sQMins.y = q[1];
		sQMins.z = HULL_MIN.z;
		sQMaxs.x = q[2];
		sQMaxs.y = q[3];
		sQMaxs.z = maxs.z;
		tr = W.trace(o, sEnd, sQMins, sQMaxs);
		if (hitGround(tr)) {
			setGround(tr);
			return;
		}
	}
	setGround(null);
}
