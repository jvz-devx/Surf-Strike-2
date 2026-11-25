/**
 * The motion of a player as the server follows it: the animator's eased state
 * (body-pose.ts), stepped from the state packets. It is part of the hit pose
 * (modes/zombies/hitbox.ts) and of the pose history (modes/infected/lagcomp.ts).
 */
import { BODY_HIP_EASE, BODY_TURN_MAX, bodyStands, bodyWalks, newBodyBlend, resetBody, stepBody, type BodyBlend, type BodyInput, type BodyMotion } from './body-pose.ts';

export interface PlayerMotion extends BodyMotion {
	/**
	 * The hips may be this much further to the right and to the left: how far
	 * the feet trail a turn on the spot differs per client (see PlayerBody).
	 */
	turnR: number;
	turnL: number;
}

/** Still, upright, on the ground. */
export function restMotion(): PlayerMotion {
	return { duck: 0, ground: 1, move: 0, speed: 0, dirF: 1, dirR: 0, hip: 0, land: 0, vzS: 0, accF: 0, accR: 0, aim: 0, turnR: 0, turnL: 0 };
}

const KEYS = Object.keys(restMotion()) as readonly (keyof PlayerMotion)[];

export function copyMotion(from: Readonly<PlayerMotion>, out: PlayerMotion): void {
	for (const k of KEYS) out[k] = from[k];
}

/** `out` = the motion `f` (0..1) of the way from `a` to `b`. */
export function lerpMotion(a: Readonly<PlayerMotion>, b: Readonly<PlayerMotion>, f: number, out: PlayerMotion): void {
	const near = f < 0.5 ? a : b;
	// A direction that turned around is one or the other, not something between.
	const turned = a.dirF * b.dirF + a.dirR * b.dirR < 0;
	const dirF = turned ? near.dirF : a.dirF + (b.dirF - a.dirF) * f;
	const dirR = turned ? near.dirR : a.dirR + (b.dirR - a.dirR) * f;
	for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * f;
	const l = Math.hypot(dirF, dirR) || 1;
	out.dirF = dirF / l;
	out.dirR = dirR / l;
}

/**
 * Follows one player. The feet of a standing character stay where they are
 * while it turns, and step around after BODY_TURN_MAX; a client that did not
 * see every turn (the player was off its screen, or it joined later) draws
 * them trailing by another amount. `turnR` and `turnL` hold what is possible:
 * they widen with every turn on the spot and close again on the move.
 */
export class PlayerBody {
	private readonly blend: BodyBlend = newBodyBlend();
	private readonly last: BodyInput = { vx: 0, vy: 0, vz: 0, yaw: NaN, pitch: 0, onGround: true, ducked: false };
	private readonly between: BodyInput = { ...this.last };
	readonly motion = restMotion();

	/**
	 * Spawn or teleport: the next step takes the input as it is, as in the
	 * animator when a player appears.
	 */
	reset(): void {
		resetBody(this.blend);
		this.motion.hip = 0;
		this.motion.turnR = this.motion.turnL = 0;
		this.last.yaw = NaN;
	}

	/**
	 * `steps` steps of `dt` seconds from the last state to `s`, interpolated as
	 * a client draws what happens between two snapshots: the flags change half way.
	 */
	follow(steps: number, dt: number, s: BodyInput): void {
		const a = this.last;
		const o = this.between;
		if (Number.isNaN(a.yaw)) Object.assign(a, s);
		const turn = Math.atan2(Math.sin(((s.yaw - a.yaw) * Math.PI) / 180), Math.cos(((s.yaw - a.yaw) * Math.PI) / 180)) * (180 / Math.PI);
		for (let i = 1; i <= steps; i++) {
			const f = i / steps;
			const near = f - 0.5 / steps < 0.5 ? a : s;
			o.vx = a.vx + (s.vx - a.vx) * f;
			o.vy = a.vy + (s.vy - a.vy) * f;
			o.vz = a.vz + (s.vz - a.vz) * f;
			o.yaw = a.yaw + turn * f;
			o.pitch = a.pitch + (s.pitch - a.pitch) * f;
			o.onGround = near.onGround;
			o.ducked = near.ducked;
			this.step(dt, o);
		}
		Object.assign(a, s);
	}

	private step(dt: number, s: BodyInput): void {
		const b = this.blend;
		const m = this.motion;
		const was = b.lastYaw;
		stepBody(b, dt, s);
		if (bodyWalks(b) || !bodyStands(b)) {
			const keep = Math.exp(-(bodyWalks(b) ? BODY_HIP_EASE.move : BODY_HIP_EASE.air) * dt);
			m.turnR *= keep;
			m.turnL *= keep;
		} else {
			const d = Number.isNaN(was) ? 0 : Math.abs(Math.atan2(Math.sin(b.lastYaw - was), Math.cos(b.lastYaw - was)));
			m.turnR = Math.min(m.turnR + d, Math.max(0, b.hip + BODY_TURN_MAX));
			m.turnL = Math.min(m.turnL + d, Math.max(0, BODY_TURN_MAX - b.hip));
		}
		m.duck = b.duck;
		m.ground = b.ground;
		m.move = b.move;
		m.speed = b.speed;
		m.dirF = b.dirF;
		m.dirR = b.dirR;
		m.hip = b.hip;
		m.land = b.land;
		m.vzS = b.vzS;
		m.accF = b.accF;
		m.accR = b.accR;
		m.aim = b.aim;
	}
}
