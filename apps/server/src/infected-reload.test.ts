/**
 * Other players hear a reload (docs/modes.md#infected): through the server
 * mode, a `reload` message that starts a reload sends the `reload` event
 * to everyone except the reloader, at once.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VIEW_HEIGHT } from '@surf/shared';
import { infectedHost, type FakePlayer } from './infected-test-host.ts';

const LIVE_TICK = 0x7fffffff;

/** Round 1 (.50 cal rifle): Zero is Patient Zero, Ben and Cat survive, far apart. */
function stage() {
	const h = infectedHost(['Zero', 'Ben', 'Cat']);
	const [zero, ben, cat] = h.players as [FakePlayer, FakePlayer, FakePlayer];
	h.state(zero, -800, 0);
	h.state(ben, 0, 0);
	h.state(cat, 800, 0);
	h.run(300);
	const fire = (p: FakePlayer) =>
		h.send(p, { type: 'fire', weapon: 'barrett', origin: { x: p.state!.x, y: p.state!.y, z: VIEW_HEIGHT }, dir: { x: 0, y: 1, z: 0 }, tick: LIVE_TICK });
	return { h, zero, ben, cat, fire };
}

describe('infected mode: other players hear a reload', () => {
	it('a reload that starts reaches everyone but the reloader, without waiting for the next tick', () => {
		const { h, zero, ben, cat, fire } = stage();
		fire(ben);
		h.run(100);
		const at = [zero, ben, cat].map((p) => p.inbox.length);
		const states = () => [zero, ben, cat].map((p) => p.inbox.filter((m) => m.type === 'modeState').length);
		const before = states();
		h.send(ben, { type: 'reload' });
		assert.deepEqual(h.events(zero, 'reload', at[0]), [{ e: 'reload', id: ben.id, weapon: 'barrett', ms: 3200 }]);
		assert.deepEqual(h.events(cat, 'reload', at[2]), [{ e: 'reload', id: ben.id, weapon: 'barrett', ms: 3200 }]);
		assert.deepEqual(h.events(ben, 'reload', at[1]), []);
		// Nothing the mode state shows changed: no extra broadcast.
		assert.deepEqual(states(), before);
		// And not a second time with the next ticks.
		h.run(200);
		assert.equal(h.events(zero, 'reload', at[0]).length, 1);
		assert.equal(h.events(ben, 'reload', at[1]).length, 0);
	});

	it('a refused reload sends nothing: a full magazine, a reload already running, a spectator', () => {
		const { h, zero, ben, cat, fire } = stage();
		const n = zero.inbox.length;
		h.send(cat, { type: 'reload' }); // full magazine
		fire(ben);
		h.run(100);
		ben.spectating = true;
		h.send(ben, { type: 'reload' });
		ben.spectating = false;
		assert.equal(h.events(zero, 'reload', n).length, 0);
		h.send(ben, { type: 'reload' });
		h.send(ben, { type: 'reload' }); // already reloading
		assert.equal(h.events(zero, 'reload', n).length, 1);
		assert.equal(h.events(cat, 'reload', 0).length, 1);
	});

	it('Patient Zero has claws: a gun shot and a reload are refused, and nobody hears one', () => {
		const { h, zero, ben, fire } = stage();
		const n = ben.inbox.length;
		fire(zero);
		h.run(100);
		h.send(zero, { type: 'reload' });
		h.run(100);
		assert.equal(h.events(ben, 'shot', n).length, 0);
		assert.equal(h.events(ben, 'reload', n).length, 0);
		assert.equal(h.events(zero, 'ammo', 0).at(-1)!.weapon, 'claws');
	});

	it('a swap ends a running reload for the others at once; the reloader is not told', () => {
		const { h, zero, ben, fire } = stage();
		fire(ben);
		h.run(100);
		h.send(ben, { type: 'reload' });
		const n = zero.inbox.length;
		const m = ben.inbox.length;
		h.send(ben, { type: 'loadout', weapon: 'knife' });
		assert.deepEqual(h.events(zero, 'reload', n), [{ e: 'reload', id: ben.id, weapon: 'barrett', ms: 0 }]);
		assert.equal(h.events(ben, 'reload', m).length, 0);
		// Back to the gun, no reload running: nothing.
		h.send(ben, { type: 'loadout', weapon: 'barrett' });
		assert.equal(h.events(zero, 'reload', n).length, 1);
	});
});
