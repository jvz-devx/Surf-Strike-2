import { FLAG_DUCKED, GhostRecorder } from '@surf/shared';
import { describe, expect, it } from 'vitest';
import { chooseGhost, ghostLabel, GhostPlayback, type GhostSource } from './ghost.js';
import { memoryGhostStore } from './ghost-store.js';

/** Straight line: x = 10 * run tick, ducked from tick 50, 100 ticks long. */
function source(kind: GhostSource['kind'] = 'record', map = 'surf_a', ticks = 100): GhostSource {
	const rec = new GhostRecorder();
	rec.start(1000);
	for (let t = 0; t <= ticks; t++) rec.push(1000 + t, t * 10, 0, 0, 0, 90, t >= 50 ? FLAG_DUCKED : 0);
	return { kind, map, name: kind === 'pb' ? 'Your PB' : 'Alice', ticks, track: rec.finish(1000 + ticks)! };
}

describe('GhostPlayback', () => {
	it('hidden without a ghost and outside a running run', () => {
		const g = new GhostPlayback();
		expect(g.update('running', 10, 0.5)).toBe(false);
		g.set(source());
		expect(g.update('start', 0, 0.5)).toBe(false);
		expect(g.update('idle', 0, 0.5)).toBe(false);
		expect(g.update('finished', 40, 0.5)).toBe(false);
	});

	it('follows the run timer, interpolated by the render fraction', () => {
		const g = new GhostPlayback();
		g.set(source());
		// Start tick: run ticks 0, the view is still between ticks -1 and 0 -> first sample.
		expect(g.update('running', 0, 0.3)).toBe(true);
		expect(g.pose.x).toBe(0);
		expect(g.update('running', 11, 0.25)).toBe(true);
		expect(g.pose.x).toBeCloseTo(102.5, 6);
		expect(g.pose.yaw).toBeCloseTo(90, 2);
		expect(g.update('running', 60, 0)).toBe(true);
		expect(g.pose.flags & FLAG_DUCKED).toBe(FLAG_DUCKED);
	});

	it('restarts from the beginning when the run restarts', () => {
		const g = new GhostPlayback();
		g.set(source());
		g.update('running', 80, 0);
		expect(g.update('start', 0, 0)).toBe(false); // !r / teleport to start
		expect(g.update('running', 3, 0)).toBe(true);
		expect(g.pose.x).toBe(20);
	});

	it('disappears after its finish', () => {
		const g = new GhostPlayback();
		g.set(source());
		expect(g.update('running', 101, 0)).toBe(true); // time 100
		expect(g.pose.x).toBe(1000);
		expect(g.update('running', 101, 0.5)).toBe(false);
		expect(g.update('running', 500, 0)).toBe(false);
	});
});

describe('chooseGhost / ghostLabel', () => {
	it('online prefers the record, falls back to the local PB; solo uses the local PB', () => {
		const rec = source('record');
		const pb = source('pb');
		expect(chooseGhost(true, rec, pb, 'surf_a')).toBe(rec);
		expect(chooseGhost(true, null, pb, 'surf_a')).toBe(pb);
		expect(chooseGhost(false, rec, pb, 'surf_a')).toBe(pb);
		expect(chooseGhost(true, rec, pb, 'surf_b')).toBeNull();
	});

	it('labels', () => {
		expect(ghostLabel({ kind: 'record', name: 'Alice', ticks: 64 * 83.456 })).toBe('Alice · 01:23.456');
		expect(ghostLabel({ kind: 'pb', name: 'x', ticks: 64 })).toBe('Your PB · 00:01.000');
	});
});

describe('memoryGhostStore', () => {
	it('keeps only the fastest run per map', async () => {
		const s = memoryGhostStore();
		const slow = source('pb', 'surf_a', 100);
		const fast = source('pb', 'surf_a', 80);
		expect(await s.saveIfFaster({ map: 'surf_a', ticks: 100, track: slow.track })).toBe(true);
		expect(await s.saveIfFaster({ map: 'surf_a', ticks: 120, track: slow.track })).toBe(false);
		expect(await s.saveIfFaster({ map: 'surf_a', ticks: 80, track: fast.track })).toBe(true);
		const got = await s.get('surf_a');
		expect(got?.ticks).toBe(80);
		expect(got?.track.length).toBe(81);
		expect(await s.get('surf_b')).toBeNull();
	});
});
