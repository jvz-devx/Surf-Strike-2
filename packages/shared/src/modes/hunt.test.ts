import { describe, expect, it } from 'vitest';
import { ABUSE } from '../economy.ts';
import type { BrushDef } from '../maps/types.ts';
import { buildSight, HuntTracker, inViewCone, TimeMeter, type HuntBody, type HuntSample, type Sight } from './hunt.ts';

const OPEN: Sight = { visible: () => true, clear: () => true };
const body = (id: number, x: number, y = 0, p: Partial<HuntBody> = {}): HuntBody => ({ id, x, y, z: 0, yaw: 0, pitch: 0, ...p });
const wall = (x: number, extra: object = {}): BrushDef => ({
	type: 'box',
	min: { x, y: -500, z: -10 },
	max: { x: x + 16, y: 500, z: 500 },
	material: 'w',
	...extra
});
const map = (brushes: BrushDef[]) => ({ brushes, theme: { materials: { w: { color: 0 }, glass: { color: 0, glass: true } } } });

/** Run `secs` at 32 Hz; `at(t)` gives hunters and targets at second t. Sums up the samples. */
function run(t: HuntTracker, secs: number, at: (t: number) => [HuntBody[], HuntBody[]]) {
	const sum = { chased: 0, chasing: 0, seen: 0, shadows: 0, by: new Set<number>() };
	for (let i = 0; i <= secs * 32; i++) {
		const s: HuntSample | null = t.update((i / 32) * 1000, ...at(i / 32));
		if (!s) continue;
		for (const e of s.chased.values()) sum.by.add(e.by);
		sum.chased += s.chased.get(2)?.ms ?? 0;
		sum.chasing += s.chasing.get(1)?.ms ?? 0;
		sum.seen += s.seen.get(2)?.ms ?? 0;
		sum.shadows += s.shadows.length;
	}
	return sum;
}

describe('sight', () => {
	const a = { x: 0, y: 0, z: 64 };
	const b = { x: 200, y: 0, z: 64 };
	it('walls block both, fake walls only the view, glass only the reach', () => {
		expect(buildSight(map([]))).toMatchObject({});
		const s = (brushes: BrushDef[]) => {
			const x = buildSight(map(brushes));
			return [x.visible(a, b), x.clear(a, b)];
		};
		expect(s([])).toEqual([true, true]);
		expect(s([wall(100)])).toEqual([false, false]);
		expect(s([wall(100, { solid: false })])).toEqual([false, true]);
		expect(s([wall(100, { material: 'glass' })])).toEqual([true, false]);
	});
});

describe('view cone', () => {
	it('follows yaw and pitch', () => {
		const h = body(1, 0);
		expect(inViewCone(h, body(2, 500))).toBe(true);
		expect(inViewCone(h, body(2, 0, 500))).toBe(false);
		expect(inViewCone({ ...h, yaw: 90 }, body(2, 0, 500))).toBe(true);
		expect(inViewCone(h, body(2, -500))).toBe(false);
		expect(inViewCone({ ...h, yaw: 720 }, body(2, 500))).toBe(true);
		// Looking straight up does not see someone level.
		expect(inViewCone({ ...h, pitch: -89 }, body(2, 500))).toBe(false);
	});
});

describe('HuntTracker', () => {
	it('a chase: in range, in sight, both moving', () => {
		const s = run(new HuntTracker({ sight: OPEN, chaseRange: 500 }), 10, (t) => [[body(1, t * 250)], [body(2, 300 + t * 250)]]);
		expect(s.chased).toBeGreaterThan(9000);
		expect(s.chased).toBeLessThanOrEqual(10_000);
		expect(s.chasing).toBe(s.chased);
		expect([...s.by]).toEqual([1]);
	});
	it('not when one stands, out of range, or behind a wall', () => {
		const chased = (sight: Sight, at: (t: number) => [HuntBody[], HuntBody[]]) => run(new HuntTracker({ sight, chaseRange: 500 }), 5, at).chased;
		expect(chased(OPEN, (t) => [[body(1, t * 50)], [body(2, 300)]])).toBe(0);
		expect(chased(OPEN, () => [[body(1, 0)], [body(2, 300)]])).toBe(0);
		expect(chased(OPEN, (t) => [[body(1, t * 250)], [body(2, 600 + t * 250)]])).toBe(0);
		const s = buildSight(map([wall(100)]));
		expect(chased(s, (t) => [[body(1, 0, (t * 200) % 300)], [body(2, 200, (t * 200) % 300)]])).toBe(0);
	});
	it('a teleport is not running', () => {
		const s = run(new HuntTracker({ sight: OPEN, chaseRange: 500 }), 2, (t) => [[body(1, t < 1 ? 0 : 3000)], [body(2, t < 1 ? 100 : 3100)]]);
		expect(s.chased).toBe(0);
	});
	it('pursuit: running away from the target is no chase, following is', () => {
		const t1 = new HuntTracker({ sight: OPEN, chaseRange: 600, pursuit: true });
		expect(run(t1, 1, (t) => [[body(1, -t * 250)], [body(2, 50 + t * 250)]]).chased).toBe(0);
		const t2 = new HuntTracker({ sight: OPEN, chaseRange: 600, pursuit: true });
		expect(run(t2, 4, (t) => [[body(1, t * 200)], [body(2, 100 + t * 250)]]).chased).toBeGreaterThan(3500);
	});
	it('the target is credited once with several hunters, by the nearest', () => {
		const s = run(new HuntTracker({ sight: OPEN, chaseRange: 500 }), 5, (t) => [[body(1, t * 250), body(3, 200 + t * 250)], [body(2, 300 + t * 250)]]);
		expect(s.chased).toBeLessThanOrEqual(5000);
		expect([...s.by]).toEqual([3]);
	});
	it('seen: in the cone, in range and in sight, also standing still', () => {
		const seen = (sight: Sight, yaw: number, dist: number) =>
			run(new HuntTracker({ sight, chaseRange: 600, viewRange: 2000 }), 10, () => [[body(1, 0, 0, { yaw })], [body(2, dist)]]).seen;
		expect(seen(OPEN, 0, 1500)).toBeGreaterThan(9000);
		expect(seen(OPEN, 180, 1500)).toBe(0);
		expect(seen(OPEN, 0, 2100)).toBe(0);
		expect(seen(buildSight(map([wall(100, { solid: false })])), 0, 1500)).toBe(0);
	});
	it('shadow: standing next to someone for 20 s without an attempt', () => {
		const near = (): [HuntBody[], HuntBody[]] => [[body(1, 0)], [body(2, 80)]];
		expect(run(new HuntTracker({ sight: OPEN, chaseRange: 500 }), 25, near).shadows).toBe(1);
		// A swing now and then, or looking away, is normal play.
		const t = new HuntTracker({ sight: OPEN, chaseRange: 500 });
		expect(
			run(t, 60, (s) => {
				if (s % 10 === 0) t.attempt(1);
				return near();
			}).shadows
		).toBe(0);
		expect(run(new HuntTracker({ sight: OPEN, chaseRange: 500 }), 60, (s) => [[body(1, 0, 0, { yaw: s % 15 < 3 ? 180 : 0 })], [body(2, 80)]]).shadows).toBe(0);
		// Glass in between: no attempt possible.
		expect(run(new HuntTracker({ sight: { visible: () => true, clear: () => false }, chaseRange: 500 }), 60, near).shadows).toBe(0);
		expect(ABUSE.shadowMs).toBe(20_000);
	});
	it('32 players: the trace budget holds and everyone still gets credit', () => {
		let traces = 0;
		const sight: Sight = { visible: () => (traces++, true), clear: () => true };
		const t = new HuntTracker({ sight, chaseRange: 600, viewRange: 2000, maxTraces: 96 });
		const credit = new Map<number, number>();
		let worst = 0;
		for (let i = 0; i <= 10 * 32; i++) {
			const x = (i / 32) * 250;
			const hunters = Array.from({ length: 16 }, (_, k) => body(k + 1, x, k * 20));
			const targets = Array.from({ length: 16 }, (_, k) => body(k + 101, x + 200, k * 20));
			const s = t.update((i / 32) * 1000, hunters, targets);
			worst = Math.max(worst, t.traces);
			for (const [id, e] of s?.chased ?? []) credit.set(id, (credit.get(id) ?? 0) + e.ms);
		}
		expect(worst).toBeLessThanOrEqual(97);
		expect(traces).toBeLessThanOrEqual(97 * 45);
		expect(credit.size).toBe(16);
		for (const ms of credit.values()) expect(ms).toBeGreaterThan(8500);
	});
});

describe('TimeMeter', () => {
	it('gives whole units and keeps the rest', () => {
		const m = new TimeMeter(20_000);
		expect(m.add(1, 19_999)).toBe(0);
		expect(m.add(1, 1)).toBe(1);
		expect(m.add(1, 45_000)).toBe(2);
		expect(m.value(1)).toBe(5_000);
		expect(m.add(2, 5_000)).toBe(0);
		m.reset(1);
		expect(m.value(1)).toBe(0);
		expect(m.value(2)).toBe(5_000);
		m.reset();
		expect(m.value(2)).toBe(0);
	});
});
