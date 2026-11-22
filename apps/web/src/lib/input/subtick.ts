/**
 * CS2-style subtick input capture (docs/physics.md#subtick-input). Movement key changes are
 * recorded with their DOM event timestamps; each simulated tick takes the changes that happened
 * inside its wall-clock interval as UserCmd.subtick events (`when` = fraction of the tick,
 * quantised to 1/64 tick ≈ 1/4096 s). View angles are not subticked (sv_subtick_movement_view_angles 0).
 */
import { IN_DUCK, IN_JUMP, type SubtickMove, type UserCmd } from '@surf/shared';

export type MoveAction = 'forward' | 'back' | 'moveleft' | 'moveright' | 'jump' | 'duck';

export const MOVE_ACTIONS: readonly MoveAction[] = ['forward', 'back', 'moveleft', 'moveright', 'jump', 'duck'];

/** Key speed (Source cl_forwardspeed / cl_sidespeed); clamped to sv_maxspeed by the move. */
export const MOVE_SPEED = 450;
/** Subtick timestamp resolution: 1/64 of a tick (1/4096 s at 64 tick). */
export const WHEN_STEPS = 64;
const MAX_WHEN = (WHEN_STEPS - 1) / WHEN_STEPS;

interface KeyEvent {
	t: number;
	action: MoveAction;
	down: boolean;
}

type Held = Record<MoveAction, boolean>;

function noneHeld(): Held {
	return { forward: false, back: false, moveleft: false, moveright: false, jump: false, duck: false };
}

export function isMoveAction(a: string): a is MoveAction {
	return (MOVE_ACTIONS as readonly string[]).includes(a);
}

export class SubtickSampler {
	private queue: KeyEvent[] = [];
	/** State already handed to the simulation (end of the last built tick). */
	private sim: Held = noneHeld();
	/** State after every queued event (to drop redundant changes). */
	private latest: Held = noneHeld();
	private pool: SubtickMove[] = [];
	private moves: SubtickMove[] = [];

	/** Record a movement key change at time `t` (ms, performance.now() / Event.timeStamp clock). */
	push(action: MoveAction, down: boolean, t: number): void {
		if (this.latest[action] === down) return;
		this.latest[action] = down;
		const ev: KeyEvent = { t, action, down };
		// Keep the queue ordered by time (events can arrive slightly out of order).
		let i = this.queue.length;
		while (i > 0 && this.queue[i - 1]!.t > t) i--;
		this.queue.splice(i, 0, ev);
	}

	/** Release every held movement key at `t` (focus loss, pointer unlock). */
	releaseAll(t: number): void {
		for (const a of MOVE_ACTIONS) this.push(a, false, t);
	}

	/** Forget everything (map change); nothing is held afterwards. */
	reset(): void {
		this.queue.length = 0;
		this.sim = noneHeld();
		this.latest = noneHeld();
	}

	/**
	 * Fill `cmd` (buttons/moves at tick start, plus subtick events) for the tick covering the
	 * wall-clock interval [start, end) ms. Events before `start` (delivered late) count at when 0;
	 * events at or after `end` stay queued for a later tick.
	 */
	buildTick(start: number, end: number, cmd: UserCmd): void {
		const s = this.sim;
		writeState(s, cmd);
		this.moves.length = 0;
		const len = end - start;
		let n = 0;
		while (n < this.queue.length && this.queue[n]!.t < end) n++;
		for (let i = 0; i < n; i++) {
			const ev = this.queue[i]!;
			s[ev.action] = ev.down;
			let when = len > 0 ? Math.round(((ev.t - start) / len) * WHEN_STEPS) / WHEN_STEPS : 0;
			if (!(when > 0)) when = 0;
			if (when > MAX_WHEN) when = MAX_WHEN;
			const m = this.pool[i] ?? (this.pool[i] = { when: 0, buttons: 0, forwardmove: 0, sidemove: 0 });
			m.when = when;
			writeState(s, m);
			this.moves.push(m);
		}
		this.queue.splice(0, n);
		cmd.subtick = this.moves.length > 0 ? this.moves : undefined;
	}
}

function writeState(h: Held, out: { buttons: number; forwardmove: number; sidemove: number }): void {
	out.forwardmove = (h.forward ? MOVE_SPEED : 0) - (h.back ? MOVE_SPEED : 0);
	out.sidemove = (h.moveright ? MOVE_SPEED : 0) - (h.moveleft ? MOVE_SPEED : 0);
	out.buttons = (h.jump ? IN_JUMP : 0) | (h.duck ? IN_DUCK : 0);
}
