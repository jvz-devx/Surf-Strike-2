/**
 * The `reload` event (docs/modes.md#infected): the other players hear and see
 * a reload, so a reload that starts is an event to everyone except the
 * reloader, whose client plays its own sound. It carries how long the reload
 * takes; one a swap ends early is an event with `ms: 0`.
 */
import { describe, expect, it } from 'vitest';
import { ZM_RELOAD_TOLERANCE } from '../zombies/game.ts';
import { WEAPONS } from '../zombies/weapons.ts';
import { infEventRoute, infReloadMs, INF_RELOAD_MAX_MS, INF_SECONDARY, type InfEvent } from './game.ts';
import { kitPlaying, type Ev } from './testkit.ts';

/** Playing with the LMG: 1 is Patient Zero, 2 and 3 survive; 2 has fired 5 rounds. */
function start() {
	const g = kitPlaying([1, 2, 3], { round: 3 });
	g.put(1, { x: -800, y: 0 });
	g.put(2, { x: 0, y: 0 });
	g.put(3, { x: 800, y: 0 });
	g.advance(50);
	for (let i = 0; i < 5; i++) {
		expect(g.fireAt(2, { x: 0, y: 500, z: 64 }).ok).toBe(true);
		g.advance(120);
	}
	g.game.takeEvents();
	return g;
}

const reloads = (events: InfEvent[]) => events.filter((e): e is Ev<'reload'> => e.e === 'reload');

describe('infected: the reload event', () => {
	it('a reload that starts queues one event with the player, the weapon and its time, for everyone but the reloader', () => {
		const g = start();
		expect(g.game.reload(2, g.clock.now)).toBe(true);
		const events = g.game.takeEvents();
		expect(events).toEqual([{ e: 'reload', id: 2, weapon: 'lmg', ms: 4200 }]);
		expect(infEventRoute(events[0]!)).toEqual({ except: 2 });
		// Taken once: the next update does not send it again.
		expect(g.game.takeEvents()).toEqual([]);
		g.advance(100);
		expect(reloads(g.events)).toEqual([]);
	});

	it('without takeEvents the next update returns it', () => {
		const g = start();
		expect(g.game.reload(2, g.clock.now)).toBe(true);
		g.advance(20);
		expect(reloads(g.events)).toEqual([{ e: 'reload', id: 2, weapon: 'lmg', ms: 4200 }]);
	});

	it('a refused reload is silent: already reloading, a full magazine, a knife in hand, a dead or unknown player', () => {
		const g = start();
		expect(g.game.reload(2, g.clock.now)).toBe(true);
		expect(g.game.reload(2, g.clock.now + 10)).toBe(false); // already reloading
		expect(g.game.reload(3, g.clock.now)).toBe(false); // full magazine
		expect(g.game.selectWeapon(3, 'knife', g.clock.now)).toHaveLength(1);
		expect(g.game.reload(3, g.clock.now)).toBe(false); // nothing to reload
		expect(g.game.reload(99, g.clock.now)).toBe(false);
		expect(reloads(g.game.takeEvents())).toEqual([{ e: 'reload', id: 2, weapon: 'lmg', ms: 4200 }]);
	});

	it('names the weapon in hand: the pistol after a swap; Patient Zero has claws and nothing to reload', () => {
		const g = start();
		expect(g.game.selectWeapon(2, INF_SECONDARY, g.clock.now)).toHaveLength(1);
		g.advance(600); // the draw
		expect(g.fireAt(2, { x: 0, y: 500, z: 64 }).ok).toBe(true);
		g.advance(200);
		g.game.takeEvents();
		expect(g.game.reload(2, g.clock.now)).toBe(true);
		expect(reloads(g.game.takeEvents())).toEqual([{ e: 'reload', id: 2, weapon: INF_SECONDARY, ms: 1500 }]);
		// Patient Zero swings into the air; a reload is refused and silent.
		expect(g.fireAt(1, { x: -800, y: 500, z: 64 }).ok).toBe(true);
		g.advance(200);
		g.game.takeEvents();
		expect(g.game.reload(1, g.clock.now)).toBe(false);
		expect(reloads(g.game.takeEvents())).toEqual([]);
	});
});

describe('infected: how long the reload event says the reload takes', () => {
	it('the time on the reloader\'s screen, also on the lenient server, which accepts the next shot a little sooner', () => {
		const g = start();
		const lenient = kitPlaying([1, 2, 3], { round: 3, lenient: true });
		lenient.put(2, { x: 0, y: 0 });
		lenient.advance(50);
		expect(lenient.fireAt(2, { x: 0, y: 500, z: 64 }).ok).toBe(true);
		lenient.game.takeEvents();
		for (const k of [g, lenient]) {
			expect(k.game.reload(2, k.clock.now)).toBe(true);
			expect(reloads(k.game.takeEvents())).toEqual([{ e: 'reload', id: 2, weapon: 'lmg', ms: WEAPONS.lmg.reloadMs }]);
		}
		// The server itself is done earlier (jitter).
		lenient.advance(WEAPONS.lmg.reloadMs * ZM_RELOAD_TOLERANCE + 20);
		expect(lenient.fireAt(2, { x: 0, y: 500, z: 64 }).ok).toBe(true);
	});

	it('sleight of hand halves it', () => {
		const g = start();
		// 2 kills Patient Zero with a headshot (1 kill: sleight).
		g.put(1, { x: 0, y: 200 });
		g.advance(50);
		const head = 64;
		expect(g.fireAt(2, { x: 0, y: 200, z: head }).ok).toBe(true);
		expect(g.game.playerView(2)!.perks).toContain('sleight');
		g.game.takeEvents();
		expect(g.game.reload(2, g.clock.now)).toBe(true);
		expect(reloads(g.game.takeEvents())).toEqual([{ e: 'reload', id: 2, weapon: 'lmg', ms: WEAPONS.lmg.reloadMs / 2 }]);
	});

	it('a swap that ends a running reload is an event with ms 0; a swap without one, or after it, is not', () => {
		const g = start();
		expect(g.game.reload(2, g.clock.now)).toBe(true);
		g.game.takeEvents();
		const swap = g.game.selectWeapon(2, 'knife', g.clock.now + 500);
		expect(swap.map((e) => e.e)).toEqual(['ammo', 'reload']);
		expect(reloads(swap)).toEqual([{ e: 'reload', id: 2, weapon: 'lmg', ms: 0 }]);
		expect(infEventRoute(swap[1]!)).toEqual({ except: 2 });
		expect(reloads(g.game.selectWeapon(2, 'lmg', g.clock.now + 600))).toEqual([]);
		// Finished before the swap: nothing ended early.
		g.advance(1500);
		expect(g.game.reload(2, g.clock.now)).toBe(true);
		g.game.takeEvents();
		g.advance(WEAPONS.lmg.reloadMs + 20);
		expect(reloads(g.game.selectWeapon(2, 'knife', g.clock.now))).toEqual([]);
	});

	it('infReloadMs reads any event: a missing or malformed time is the weapon\'s own, 0 ends the reload, a weapon without a magazine has none', () => {
		expect(infReloadMs({ weapon: 'smg' })).toBe(WEAPONS.smg.reloadMs);
		expect(infReloadMs({ weapon: 'smg', ms: 875 })).toBe(875);
		expect(infReloadMs({ weapon: 'smg', ms: 0 })).toBe(0);
		for (const ms of [-1, NaN, Infinity, INF_RELOAD_MAX_MS + 1, '900', null, {}]) expect(infReloadMs({ weapon: 'smg', ms })).toBe(WEAPONS.smg.reloadMs);
		for (const weapon of ['knife', 'claws', 'nope', undefined, 7]) expect(infReloadMs({ weapon, ms: 900 })).toBe(0);
	});
});
