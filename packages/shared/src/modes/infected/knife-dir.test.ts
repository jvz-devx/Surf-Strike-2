/**
 * The direction on a thrown-knife infection (docs/modes.md#infected): the
 * `infect` event of the methods `knife` and `bank` carries `dx`, `dy`, the
 * unit horizontal direction the knife travelled when it hit, for the
 * victim's hit-direction cue.
 */
import { describe, expect, it } from 'vitest';
import { kitPlaying, unit, type Ev } from './testkit.ts';

/** Playing with the LMG: 1 is Patient Zero (still with the gun and a knife), 2 and 3 survive, 3 far away. */
function start() {
	const g = kitPlaying([1, 2, 3], { round: 3 });
	g.put(3, { x: -1000, y: 1000 });
	return g;
}

/** Step until the next infection (or `ms` pass). */
function infection(g: ReturnType<typeof start>, ms = 600): Ev<'infect'> | undefined {
	const from = g.of('infect').length;
	for (let t = 0; t < ms && g.of('infect').length === from; t += 15) g.advance(15);
	return g.of('infect')[from];
}

describe('infected: the direction of a thrown-knife infection', () => {
	it('a direct hit carries the horizontal direction of the throw, unit length, rounded for the wire', () => {
		const g = start();
		g.put(1, { x: -600, y: -100 });
		g.put(2, { x: -300, y: 300 });
		// 3-4-5 in the plane, thrown a little upwards.
		expect(g.game.throwKnife(1, g.eye(1), unit(3, 4, 0.3), g.clock.now).ok).toBe(true);
		const inf = infection(g)!;
		expect(inf).toMatchObject({ id: 2, by: 1, method: 'knife' });
		expect([inf.dx, inf.dy]).toEqual([0.6, 0.8]);
	});

	it('a knife that drops on its arc keeps its horizontal direction', () => {
		const g = start();
		g.put(1, { x: -700, y: 0 });
		g.put(2, { x: 0, y: 0 });
		// 700 units out the knife has fallen about 120: it comes down into the survivor, still along +x.
		expect(g.game.throwKnife(1, g.eye(1), unit(1, 0, 0.19), g.clock.now).ok).toBe(true);
		const inf = infection(g, 1200)!;
		expect(inf).toMatchObject({ id: 2, method: 'knife' });
		expect([inf.dx, inf.dy]).toEqual([1, 0]);
	});

	it('a bank shot carries the direction after the bounce, not the one it was thrown in', () => {
		const g = start();
		// Thrown at the wall (x 400) at an angle: towards +x and +y, it comes back towards -x and still +y.
		g.put(1, { x: 250, y: -150 });
		g.put(2, { x: -1000, y: -1000 });
		expect(g.game.throwKnife(1, g.eye(1), unit(1, 1, 0), g.clock.now).ok).toBe(true);
		g.put(1, { x: 250, y: -400 });
		let b: Ev<'knifeBounce'> | undefined;
		for (let t = 0; t < 300 && !b; t += 15) {
			g.advance(15);
			b = g.of('knifeBounce')[0];
		}
		expect(b!.vx).toBeLessThan(0);
		expect(b!.vy).toBeGreaterThan(0);
		// Survivor 2 stands in the rebound.
		const t = 0.06;
		g.put(2, { x: b!.x + b!.vx * t, y: b!.y + b!.vy * t, z: Math.max(0, b!.z + b!.vz * t - 30) });
		const inf = infection(g, 300)!;
		expect(inf).toMatchObject({ id: 2, by: 1, method: 'bank' });
		const h = Math.hypot(b!.vx, b!.vy);
		expect(inf.dx).toBeCloseTo(b!.vx / h, 2);
		expect(inf.dy).toBeCloseTo(b!.vy / h, 2);
		expect(inf.dx).toBeLessThan(-0.3);
		expect(inf.dy).toBeGreaterThan(0.3);
		expect(Math.hypot(inf.dx!, inf.dy!)).toBeCloseTo(1, 2);
	});

	it('point blank: the direction of the aim', () => {
		const g = start();
		g.put(1, { x: 0, y: 0 });
		g.put(2, { x: 0, y: -18 });
		const r = g.game.throwKnife(1, g.eye(1), unit(0, -1, 0), g.clock.now);
		const inf = r.events.find((e): e is Ev<'infect'> => e.e === 'infect')!;
		expect(inf).toMatchObject({ id: 2, by: 1, method: 'knife' });
		// Never -0 on the wire.
		expect(Object.is(inf.dx, 0)).toBe(true);
		expect(inf.dy).toBe(-1);
	});

	it('a knife that comes straight down has no direction of its own: thrower towards victim, or none when they share a spot', () => {
		const g = start();
		// Straight down at the feet with a survivor 15 away (inside the knife's radius of an arm).
		g.put(1, { x: 0, y: 0 });
		g.put(2, { x: 9, y: -12 });
		const r = g.game.throwKnife(1, g.eye(1), unit(0, 0, -1), g.clock.now);
		const inf = r.events.find((e): e is Ev<'infect'> => e.e === 'infect')!;
		expect(inf).toMatchObject({ id: 2, by: 1, method: 'knife' });
		expect([inf.dx, inf.dy]).toEqual([0.6, -0.8]);
		// On the same spot there is nothing to point along: the fields stay off the event.
		const s = start();
		s.put(1, { x: 0, y: 0 });
		s.put(2, { x: 0, y: 0 });
		const same = s.game.throwKnife(1, s.eye(1), unit(0, 0, -1), s.clock.now).events.find((e): e is Ev<'infect'> => e.e === 'infect')!;
		expect(same).toMatchObject({ id: 2, method: 'knife' });
		expect('dx' in same || 'dy' in same).toBe(false);
	});

	it("claw infections carry no knife direction, Patient Zero's and a plain infected's", () => {
		const g = start();
		g.put(1, { x: -40, y: 0 });
		g.put(2, { x: 0, y: 0 });
		g.advance(50);
		g.fireAt(1, { x: 0, y: 0, z: 64 });
		const zero = g.of('infect').at(-1)!;
		expect(zero).toMatchObject({ id: 2, by: 1, method: 'claws' });
		expect('dx' in zero || 'dy' in zero).toBe(false);
		// Player 2 is a plain infected now: claws on survivor 3.
		g.put(3, { x: 40, y: 0 });
		g.advance(1000);
		g.fireAt(2, { x: 40, y: 0, z: 64 });
		const claws = g.of('infect').at(-1)!;
		expect(claws).toMatchObject({ id: 3, by: 2, method: 'claws' });
		expect('dx' in claws || 'dy' in claws).toBe(false);
	});
});
