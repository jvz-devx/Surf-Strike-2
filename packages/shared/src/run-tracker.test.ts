import { describe, expect, it } from 'vitest';
import type { MapDef } from './maps/types.ts';
import type { PlayerState } from './movement/api.ts';
import { createPlayer } from './movement/gamemovement.ts';
import type { RunEvent } from './run.ts';
import { FINISH_RESET_DELAY_TICKS, PRESPEED_CAP } from './run.ts';
import { RunTracker } from './run-tracker.ts';
import { TICK_RATE } from './units.ts';

const theme = {
	skyTop: 0,
	skyHorizon: 0,
	skyBottom: 0,
	fogColor: 0,
	fogNear: 0,
	fogFar: 1,
	sunColor: 0,
	sunIntensity: 1,
	sunDir: { x: 0, y: 0, z: 1 },
	ambientSky: 0,
	ambientGround: 0,
	ambientIntensity: 1,
	materials: {},
	effects: []
};

/** A corridor along +X: start [0,200], stage/checkpoint 2 at 1000, end at 2000, pit below z = -100. */
function makeMap(layout: 'staged' | 'linear', pitTo: 'stage' | 'start' = 'stage'): MapDef {
	const progressKind = layout === 'staged' ? 'stage' : 'checkpoint';
	const index = layout === 'staged' ? 2 : 1;
	return {
		id: 'test_map',
		title: 'Test',
		kind: 'surf',
		difficulty: 'easy',
		layout,
		cvars: {},
		spawn: { pos: { x: 100, y: 0, z: 0 }, yaw: 0 },
		brushes: [],
		zones: [
			{ type: 'start', min: { x: 0, y: -100, z: 0 }, max: { x: 200, y: 100, z: 100 } },
			{
				type: progressKind,
				index,
				min: { x: 1000, y: -100, z: 0 },
				max: { x: 1100, y: 100, z: 100 },
				respawn: { pos: { x: 1050, y: 0, z: 0 }, yaw: 0 }
			},
			{ type: 'end', min: { x: 2000, y: -100, z: 0 }, max: { x: 2100, y: 100, z: 100 } },
			{ type: 'teleport', min: { x: -5000, y: -5000, z: -1000 }, max: { x: 5000, y: 5000, z: -100 }, to: pitTo }
		],
		theme
	} as MapDef;
}

function player(x: number, z = 0): PlayerState {
	return { ...createPlayer({ x, y: 0, z }), onGround: true, groundNormalZ: 1 };
}

const types = (ev: RunEvent[]) => ev.map((e) => (e.type === 'zone' ? `zone:${e.kind}` : e.type));

describe('RunTracker', () => {
	it('starts idle and enters start once', () => {
		const rt = new RunTracker(makeMap('staged'));
		expect(rt.state.phase).toBe('idle');
		expect(rt.state.stage).toBe(1);
		const p = player(100);
		expect(types(rt.update(p, 1))).toEqual(['enterStart']);
		expect(rt.state.phase).toBe('start');
		expect(rt.update(p, 2)).toEqual([]);
	});

	it('caps prespeed and starts the timer when leaving start', () => {
		const rt = new RunTracker(makeMap('staged'));
		const p = player(100);
		rt.update(p, 1);
		p.origin.x = 300; // hull min x = 284 > 200
		p.velocity = { x: 600, y: 800, z: 50 };
		const ev = rt.update(p, 2);
		expect(ev).toEqual([{ type: 'zone', kind: 'start', index: 0, tick: 2 }]);
		expect(Math.hypot(p.velocity.x, p.velocity.y)).toBeCloseTo(PRESPEED_CAP, 6);
		expect(p.velocity.x / p.velocity.y).toBeCloseTo(0.75, 6);
		expect(p.velocity.z).toBe(50);
		expect(rt.state.phase).toBe('running');
		expect(rt.state.ticks).toBe(0);
		rt.update(p, 3);
		rt.update(p, 4);
		expect(rt.state.ticks).toBe(2);
	});

	it('uses the player AABB for overlap', () => {
		const rt = new RunTracker(makeMap('staged'));
		const p = player(215); // hull min x = 199 < 200: still overlapping
		rt.update(p, 1);
		expect(rt.state.phase).toBe('start');
		p.origin.x = 217;
		expect(types(rt.update(p, 2))).toEqual(['zone:start']);
	});

	it('records stage split, respawn and finish on a staged map', () => {
		const rt = new RunTracker(makeMap('staged'));
		const p = player(100);
		rt.update(p, 0);
		p.origin.x = 300;
		rt.update(p, 1); // run starts, ticks 0
		for (let t = 2; t <= 10; t++) rt.update(p, t); // ticks 9
		p.origin.x = 1050;
		const ev = rt.update(p, 11);
		expect(ev).toEqual([
			{ type: 'zone', kind: 'stage', index: 2, tick: 11 },
			{ type: 'split', index: 2, ticks: 10 }
		]);
		expect(rt.state.stage).toBe(2);
		expect(rt.state.respawn.pos.x).toBe(1050);
		// Same zone again: no new split.
		expect(rt.update(p, 12)).toEqual([]);
		p.origin.x = 2050;
		const fin = rt.update(p, 13);
		expect(fin).toEqual([
			{ type: 'zone', kind: 'end', index: 0, tick: 13 },
			{ type: 'finish', ticks: 12, splits: [10] }
		]);
		expect(rt.state.phase).toBe('finished');
		expect(rt.update(p, 14)).toEqual([]);
		expect(rt.state.ticks).toBe(12);
	});

	it('does not record stages or finish when not running', () => {
		const rt = new RunTracker(makeMap('staged'));
		const p = player(1050);
		expect(rt.update(p, 1)).toEqual([]);
		p.origin.x = 2050;
		expect(rt.update(p, 2)).toEqual([]);
		expect(rt.state.phase).toBe('idle');
	});

	it('teleport to stage keeps the timer and zeroes velocity', () => {
		const rt = new RunTracker(makeMap('staged'));
		const p = player(100);
		rt.update(p, 0);
		p.origin.x = 300;
		rt.update(p, 1);
		p.origin.x = 1050;
		rt.update(p, 2);
		p.origin = { x: 1500, y: 0, z: -500 };
		p.velocity = { x: 1000, y: 0, z: -900 };
		p.onGround = true;
		const ev = rt.update(p, 3);
		expect(ev).toEqual([{ type: 'teleport', reason: 'trigger' }]);
		expect(p.origin).toEqual({ x: 1050, y: 0, z: 0 });
		expect(p.velocity).toEqual({ x: 0, y: 0, z: 0 });
		expect(p.onGround).toBe(false);
		expect(rt.state.phase).toBe('running');
		expect(rt.state.ticks).toBe(2);
	});

	it('fixed-destination teleport moves to dest, keeps the timer and reports the yaw', () => {
		const map = makeMap('staged');
		map.zones.unshift({ type: 'teleport', min: { x: 500, y: -100, z: 0 }, max: { x: 600, y: 100, z: 100 }, to: 'start', dest: { pos: { x: 1800, y: 50, z: 10 }, yaw: 180 } });
		const rt = new RunTracker(map);
		const p = player(100);
		rt.update(p, 0);
		p.origin.x = 300;
		rt.update(p, 1);
		p.origin.x = 550;
		p.velocity = { x: 600, y: 0, z: 0 };
		const ev = rt.update(p, 2);
		expect(ev).toEqual([{ type: 'teleport', reason: 'trigger', dest: { pos: { x: 1800, y: 50, z: 10 }, yaw: 180 } }]);
		expect(p.origin).toEqual({ x: 1800, y: 50, z: 10 });
		expect(p.velocity).toEqual({ x: 0, y: 0, z: 0 });
		expect(rt.state.phase).toBe('running');
	});

	it('teleport to stage before any stage goes to spawn', () => {
		const rt = new RunTracker(makeMap('staged'));
		const p = player(100);
		rt.update(p, 0);
		p.origin.x = 300;
		rt.update(p, 1);
		p.origin.z = -500;
		rt.update(p, 2);
		expect(p.origin).toEqual({ x: 100, y: 0, z: 0 });
	});

	it('linear map: checkpoints split, teleport to start resets', () => {
		const rt = new RunTracker(makeMap('linear', 'start'));
		expect(rt.state.stage).toBe(0);
		const p = player(100);
		rt.update(p, 0);
		p.origin.x = 300;
		rt.update(p, 1);
		p.origin.x = 1050;
		expect(types(rt.update(p, 2))).toEqual(['zone:checkpoint', 'split']);
		expect(rt.state.stage).toBe(1);
		p.origin.z = -500;
		const ev = rt.update(p, 3);
		expect(types(ev)).toEqual(['enterStart', 'teleport']);
		expect(p.origin).toEqual({ x: 100, y: 0, z: 0 });
		expect(rt.state.phase).toBe('start');
		expect(rt.state.ticks).toBe(0);
		expect(rt.state.splits).toEqual([]);
		expect(rt.state.stage).toBe(0);
	});

	it('restart resets to spawn; back goes to respawn', () => {
		const rt = new RunTracker(makeMap('staged'));
		const p = player(100);
		rt.update(p, 0);
		p.origin.x = 300;
		rt.update(p, 1);
		p.origin.x = 1050;
		rt.update(p, 2);
		p.origin.x = 1500;
		p.velocity.x = 700;
		rt.back(p);
		expect(p.origin.x).toBe(1050);
		expect(p.velocity.x).toBe(0);
		expect(rt.state.phase).toBe('running');
		rt.restart(p);
		expect(p.origin.x).toBe(100);
		expect(rt.state.phase).toBe('start');
		expect(rt.state.stage).toBe(1);
		// Leaving start again starts a fresh run.
		p.origin.x = 300;
		expect(types(rt.update(p, 5))).toEqual(['zone:start']);
	});

	it('re-entering start during a run resets', () => {
		const rt = new RunTracker(makeMap('staged'));
		const p = player(100);
		rt.update(p, 0);
		p.origin.x = 300;
		rt.update(p, 1);
		rt.update(p, 2);
		p.origin.x = 100;
		expect(types(rt.update(p, 3))).toEqual(['enterStart']);
		expect(rt.state.phase).toBe('start');
		expect(rt.state.ticks).toBe(0);
	});

	it('returns to start FINISH_RESET_DELAY after finishing, once', () => {
		expect(FINISH_RESET_DELAY_TICKS).toBe(3 * TICK_RATE);
		const rt = new RunTracker(makeMap('staged'));
		const p = player(100);
		rt.update(p, 0);
		p.origin.x = 300;
		rt.update(p, 1);
		p.origin.x = 1050;
		rt.update(p, 2);
		p.origin.x = 2050;
		p.velocity.x = 500;
		rt.update(p, 3);
		expect(rt.state.phase).toBe('finished');
		const at = 3 + FINISH_RESET_DELAY_TICKS;
		expect(rt.state.resetAt).toBe(at);
		// Leaving the end zone early does not cancel it.
		p.origin.x = 2500;
		const all: RunEvent[] = [];
		for (let t = 4; t < at; t++) all.push(...rt.update(p, t));
		expect(all).toEqual([]);
		expect(p.origin.x).toBe(2500);
		const ev = rt.update(p, at);
		expect(ev).toEqual([{ type: 'enterStart' }, { type: 'teleport', reason: 'finish' }]);
		expect(p.origin).toEqual({ x: 100, y: 0, z: 0 });
		expect(p.velocity).toEqual({ x: 0, y: 0, z: 0 });
		expect(rt.state.phase).toBe('start');
		expect(rt.state.stage).toBe(1);
		expect(rt.state.splits).toEqual([]);
		expect(rt.state.resetAt).toBeNull();
		for (let t = at + 1; t < at + 2 * FINISH_RESET_DELAY_TICKS; t++) {
			expect(rt.update(p, t).some((e) => e.type === 'teleport')).toBe(false);
		}
	});

	it('manual restart during the finish delay cancels the auto reset', () => {
		const rt = new RunTracker(makeMap('linear'));
		const p = player(100);
		rt.update(p, 0);
		p.origin.x = 300;
		rt.update(p, 1);
		p.origin.x = 2050;
		rt.update(p, 2);
		expect(rt.state.resetAt).not.toBeNull();
		rt.restart(p);
		expect(rt.state.resetAt).toBeNull();
		const all: RunEvent[] = [];
		for (let t = 3; t < 3 + 2 * FINISH_RESET_DELAY_TICKS; t++) all.push(...rt.update(p, t));
		expect(all.filter((e) => e.type === 'teleport')).toEqual([]);
	});

	it('ducked hull is shorter', () => {
		const rt = new RunTracker(makeMap('staged'));
		const p = player(100, -60); // top at z = 12 standing, -6 ducked
		rt.update(p, 0);
		expect(rt.state.phase).toBe('start');
		const rt2 = new RunTracker(makeMap('staged'));
		const q = player(100, -60);
		q.ducked = true;
		rt2.update(q, 0);
		expect(rt2.state.phase).toBe('idle');
	});
});
