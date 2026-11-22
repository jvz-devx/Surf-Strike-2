import { describe, expect, it } from 'vitest';
import {
	buildCollisionWorld,
	createPlayer,
	IN_JUMP,
	playerMove,
	SURF_CVARS,
	TICK_INTERVAL,
	TICK_RATE,
	type UserCmd,
	type Vec3
} from '@surf/shared';
import { FixedStep } from '../game/loop.js';
import { SubtickSampler, type MoveAction } from './subtick.js';

const STEP_MS = 1000 / TICK_RATE;
const world = buildCollisionWorld({
	brushes: [{ type: 'box', min: { x: -20000, y: -20000, z: -64 }, max: { x: 20000, y: 20000, z: 0 }, material: 'm' }]
});

interface LogEvent {
	t: number;
	action: MoveAction;
	down: boolean;
}

/** Runs the game's frame loop (FixedStep + sampler) at `fps` over a timestamped key log. */
function drive(fps: number, log: LogEvent[], durationMs: number) {
	const step = new FixedStep(TICK_RATE, 8);
	const sampler = new SubtickSampler();
	const p = createPlayer({ x: 0, y: 0, z: 1 });
	const cmd: UserCmd = { pitch: 0, yaw: 0, forwardmove: 0, sidemove: 0, buttons: 0 };
	const out: Vec3[] = [];
	const cmds: string[] = [];
	let jumps = 0;
	let next = 0;
	let last = 0;
	const frameMs = 1000 / fps;
	for (let f = 1; f * frameMs <= durationMs + frameMs; f++) {
		const now = f * frameMs;
		// The browser delivers every event that happened before this frame.
		while (next < log.length && log[next]!.t < now) {
			const e = log[next++]!;
			sampler.push(e.action, e.down, e.t);
		}
		const n = step.advance(now - last);
		last = now;
		let end = now - step.accMs - (n - 1) * step.stepMs;
		for (let i = 0; i < n; i++, end += step.stepMs) {
			sampler.buildTick(end - step.stepMs, end, cmd);
			cmds.push(JSON.stringify(cmd));
			playerMove(world, p, cmd, SURF_CVARS, TICK_INTERVAL);
			if (p.jumped) jumps++;
			out.push({ ...p.origin });
		}
	}
	return { out, cmds, jumps };
}

describe('subtick sampler', () => {
	it('splits a tick at key events with 1/64-tick timestamps', () => {
		const s = new SubtickSampler();
		const cmd: UserCmd = { pitch: 0, yaw: 0, forwardmove: 0, sidemove: 0, buttons: 0 };
		s.push('forward', true, 100 + STEP_MS * 0.3);
		s.push('jump', true, 100 + STEP_MS * 0.8);
		s.push('jump', false, 100 + STEP_MS * 0.8);
		s.push('moveleft', true, 100 + STEP_MS * 1.5); // next tick
		s.buildTick(100, 100 + STEP_MS, cmd);
		expect(cmd.forwardmove).toBe(0);
		expect(cmd.subtick).toEqual([
			{ when: Math.round(0.3 * 64) / 64, buttons: 0, forwardmove: 450, sidemove: 0 },
			{ when: Math.round(0.8 * 64) / 64, buttons: IN_JUMP, forwardmove: 450, sidemove: 0 },
			{ when: Math.round(0.8 * 64) / 64, buttons: 0, forwardmove: 450, sidemove: 0 }
		]);
		s.buildTick(100 + STEP_MS, 100 + 2 * STEP_MS, cmd);
		expect(cmd.forwardmove).toBe(450);
		expect(cmd.subtick).toEqual([{ when: 0.5, buttons: 0, forwardmove: 450, sidemove: -450 }]);
		s.buildTick(100 + 2 * STEP_MS, 100 + 3 * STEP_MS, cmd);
		expect(cmd.subtick).toBeUndefined();
		expect(cmd.sidemove).toBe(-450);
	});

	it('a press and release between two ticks (within one frame) still reaches the simulation', () => {
		const log: LogEvent[] = [
			{ t: 500.2, action: 'jump', down: true },
			{ t: 503.1, action: 'jump', down: false }
		];
		for (const fps of [30, 60, 144, 240]) {
			const r = drive(fps, log, 1000);
			expect(r.jumps).toBe(1);
		}
	});

	it('the same key log gives identical ticks and positions at 60, 144 and 240 FPS', () => {
		const log: LogEvent[] = [];
		const actions: MoveAction[] = ['forward', 'moveleft', 'moveright', 'jump', 'duck', 'back'];
		const held = new Map<MoveAction, boolean>();
		// Deterministic pseudo-random key mashing over 3 s, timestamps at 0.01 ms resolution.
		let seed = 12345;
		const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
		for (let t = 20; t < 3000; t += 5 + rnd() * 60) {
			const a = actions[Math.floor(rnd() * actions.length)]!;
			const down = !held.get(a);
			held.set(a, down);
			log.push({ t: Math.round(t * 100) / 100, action: a, down });
		}
		const a = drive(60, log, 3200);
		const b = drive(144, log, 3200);
		const c = drive(240, log, 3200);
		const ticks = Math.min(a.out.length, b.out.length, c.out.length);
		expect(ticks).toBeGreaterThan(200);
		expect(b.cmds.slice(0, ticks)).toEqual(a.cmds.slice(0, ticks));
		expect(c.cmds.slice(0, ticks)).toEqual(a.cmds.slice(0, ticks));
		expect(b.out.slice(0, ticks)).toEqual(a.out.slice(0, ticks));
		expect(c.out.slice(0, ticks)).toEqual(a.out.slice(0, ticks));
		expect(a.cmds.some((s) => s.includes('subtick'))).toBe(true);
		const lastPos = a.out[ticks - 1]!;
		expect(Math.hypot(lastPos.x, lastPos.y)).toBeGreaterThan(50);
	});
});
