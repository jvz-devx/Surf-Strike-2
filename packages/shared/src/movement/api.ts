import type { Vec3 } from '../types.ts';

/** Player hull and view (docs/physics.md). Origin is at the feet. */
export const HULL_MIN: Vec3 = { x: -16, y: -16, z: 0 };
export const HULL_MAX: Vec3 = { x: 16, y: 16, z: 72 };
export const DUCK_HULL_MAX: Vec3 = { x: 16, y: 16, z: 54 };
export const VIEW_HEIGHT = 64;
export const DUCK_VIEW_HEIGHT = 46;

export const IN_JUMP = 1 << 1;
export const IN_DUCK = 1 << 2;

/**
 * One input change inside a tick (CS2 CSubtickMoveStep). The fields are the input state AFTER
 * the change; the tick is simulated in pieces split at every event.
 */
export interface SubtickMove {
	/** Fraction of the tick in [0, 1) at which the change happened (client quantises to 1/64). */
	when: number;
	buttons: number;
	forwardmove: number;
	sidemove: number;
}

/** One tick of input, as in CS2's CUserCmd. The top-level fields are the state at tick start. */
export interface UserCmd {
	/** Degrees. pitch: + looks down, clamped ±89. yaw: 0 = +X, counter-clockwise. Used for the whole tick
	 * (CS2 surf servers run sv_subtick_movement_view_angles 0). */
	pitch: number;
	yaw: number;
	forwardmove: number; // ±450 from keys, clamped to sv_maxspeed inside the move
	sidemove: number; // + = right
	buttons: number; // IN_JUMP | IN_DUCK
	/** Input changes inside this tick, ascending `when`. Absent/empty = constant input for the tick. */
	subtick?: SubtickMove[];
}

export interface PlayerState {
	origin: Vec3;
	velocity: Vec3;
	onGround: boolean;
	/** Ground plane normal z when on ground (for surf/ramp sound), else 0. */
	groundNormalZ: number;
	ducked: boolean; // hull is the duck hull
	ducking: boolean; // duck/unduck transition in progress
	/** CS2 m_flDuckAmount: 0 standing .. 1 fully ducked (view and ground speed blend with it). */
	duckAmount: number;
	/** CS2 m_bDucked: fully ducked flag (ducked jump impulse); drops at duckAmount 0.75 when standing up. */
	duckFlag: boolean;
	/** CS2 m_flDuckSpeed: duck amount per second (8 ideal), lowered by duck spam. */
	duckSpeed: number;
	/** CS2 m_bDesiresDuck. */
	desiresDuck: boolean;
	/** Seconds since the last completed duck (sv_timebetweenducks). */
	timeSinceDuck: number;
	/** Horizontal position where duckSpeed was last at full speed (faster recovery once 64 units away). */
	duckSpeedX: number;
	duckSpeedY: number;
	/** Input buttons at the end of the previous tick (legacy jump old-buttons rule, edge detection). */
	oldButtons: number;
	/** Simulation time in ticks (incremented by every playerMove). Modern-jump timestamps use it. */
	tick: number;
	/** Modern jump (sv_legacy_jump 0): times in ticks; -Infinity = none. */
	lastJumpPress: number;
	usableJumpPress: number;
	landedTime: number;
	/** Horizontal velocity and vertical velocity (negative = falling) at the last recorded landing. */
	landedVx: number;
	landedVy: number;
	landedVz: number;
	/** 0.25 while airborne and rising at up to 140 u/s (CS2 "deadstrafe"), else 1. */
	surfaceFriction: number;
	/** True for the tick in which the player left the ground by jumping. */
	jumped: boolean;
	/** Set for the tick the player landed; value = fall speed (u/s). 0 otherwise. */
	landedSpeed: number;
	/** True while touching a non-walkable (surf) plane this tick. */
	surfing: boolean;
}

// Implemented in ./gamemovement.ts:
//   export function createPlayer(origin: Vec3): PlayerState
//   export function playerMove(world: CollisionWorld, p: PlayerState, cmd: UserCmd, cvars: Cvars, dt?: number): void
//   export function eyeHeight(p: PlayerState): number   // 64 - 18 * duckAmount
//   export function playerMaxs(p: PlayerState): Vec3
