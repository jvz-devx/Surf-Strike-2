/**
 * Malformed infected client messages (docs/modes.md#infected): the parser
 * drops them, and fed through the server mode they neither throw nor change
 * the game. Well-formed ones still work and reach the other clients clean.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Vec3 } from '@surf/shared';
import { INF_STEP_MS, infLoadout, infRewindMs, playerPoint, VIEW_HEIGHT, WEAPONS } from '@surf/shared';
import { infectedHost, type FakePlayer } from './infected-test-host.ts';
import { clampFireTick, INF_FIRE_TICK_LIVE, INF_FIRE_TICK_SLACK, parseInfInput } from './modes/infected-input.ts';

const O = { x: 0, y: -300, z: VIEW_HEIGHT };
const D = { x: 0, y: 1, z: 0 };

/** Values that are not a vector of three numbers in range. */
const BAD_VECS: unknown[] = [
	undefined,
	null,
	0,
	7,
	'1,2,3',
	true,
	[],
	[0, 1, 0],
	{},
	{ x: 0, y: 1 },
	{ x: '0', y: 1, z: 0 },
	{ x: null, y: 1, z: 0 },
	{ x: NaN, y: 1, z: 0 },
	{ x: 0, y: Infinity, z: 0 },
	{ x: 0, y: 1, z: -Infinity },
	{ x: 1e300, y: 1, z: 0 },
	{ x: {}, y: [], z: 0 },
	{ x: { valueOf: () => 1 }, y: 1, z: 0 }
];
const BAD_WEAPONS: unknown[] = [undefined, null, 0, 3, true, '', 'bfg', 'LMG', 'constructor', 'toString', '__proto__', 'hasOwnProperty', ['lmg'], { id: 'lmg' }];

/** Every malformed message of the six types (and some that are no message at all). */
function malformed(): unknown[] {
	const out: unknown[] = [null, undefined, 0, 'fire', [], ['fire'], {}, { type: null }, { type: 5 }, { type: 'knife', origin: O, dir: D }, { type: 'Fire' }, { type: 'fire ' }];
	for (const w of BAD_WEAPONS) {
		out.push({ type: 'fire', weapon: w, origin: O, dir: D, tick: INF_FIRE_TICK_LIVE });
		out.push({ type: 'loadout', weapon: w });
	}
	for (const v of BAD_VECS) {
		out.push({ type: 'fire', weapon: 'lmg', origin: v, dir: D, tick: INF_FIRE_TICK_LIVE });
		out.push({ type: 'fire', weapon: 'lmg', origin: O, dir: v, tick: INF_FIRE_TICK_LIVE });
		out.push({ type: 'throwKnife', origin: v, dir: D });
		out.push({ type: 'throwKnife', origin: O, dir: v });
	}
	// A direction far from unit length is not a direction.
	out.push({ type: 'fire', weapon: 'lmg', origin: O, dir: { x: 0, y: 50, z: 0 }, tick: 0 });
	out.push({ type: 'fire', weapon: 'lmg', origin: { x: 2e6, y: 0, z: 0 }, dir: D, tick: 0 });
	out.push({ type: 'fire' }, { type: 'loadout' }, { type: 'throwKnife' });
	return out;
}

describe('parseInfInput', () => {
	it('drops every malformed message', () => {
		for (const m of malformed()) assert.equal(parseInfInput(m), null, JSON.stringify(m) ?? String(m));
	});

	it('returns fresh, typed copies of well-formed messages', () => {
		const origin = { ...O, extra: 1 };
		const dir = { ...D, w: 2 };
		const fire = parseInfInput({ type: 'fire', weapon: 'lmg', origin, dir, tick: 123, junk: { a: 1 } });
		assert.deepEqual(fire, { type: 'fire', weapon: 'lmg', origin: O, dir: D, tick: 123 });
		assert.ok(fire?.type === 'fire' && fire.origin !== origin && fire.dir !== dir);
		assert.deepEqual(parseInfInput({ type: 'throwKnife', origin, dir, more: [] }), { type: 'throwKnife', origin: O, dir: D });
		assert.deepEqual(parseInfInput({ type: 'loadout', weapon: 'knife', x: 1 }), { type: 'loadout', weapon: 'knife' });
		for (const type of ['reload', 'placeBeacon', 'callMoab']) assert.deepEqual(parseInfInput({ type, origin: 'x', n: NaN }), { type });
	});

	it('a tick that names no sim tick marks a live client', () => {
		const tick = (t: unknown) => {
			const m = parseInfInput({ type: 'fire', weapon: 'lmg', origin: O, dir: D, tick: t });
			return m?.type === 'fire' ? m.tick : 'dropped';
		};
		for (const t of [INF_FIRE_TICK_LIVE, INF_FIRE_TICK_LIVE + 1, 1e300, Infinity, NaN, undefined, null, '12', {}, [], true]) assert.equal(tick(t), null, String(t));
		for (const t of [0, 12, 4096.5, -3, -1e12]) assert.equal(tick(t), t);
	});
});

describe('clampFireTick', () => {
	it('keeps a named tick inside the rewind window of the shooter', () => {
		// Ping 0: the screen is 116 ms old, 8 sim ticks (rounded up), plus the slack.
		const window = Math.ceil(infRewindMs(0) / INF_STEP_MS) + INF_FIRE_TICK_SLACK;
		assert.equal(window, 9);
		assert.equal(clampFireTick(1000, 1000, infRewindMs(0)), 1000);
		assert.equal(clampFireTick(1000 - window, 1000, infRewindMs(0)), 1000 - window);
		for (const t of [1000 - window - 1, 500, 0, -3, -1e12, 4.5]) assert.equal(clampFireTick(t, 1000, infRewindMs(0)), 1000 - window, String(t));
		// A tick from the future is the current one.
		assert.equal(clampFireTick(1001, 1000, infRewindMs(0)), 1000);
		assert.equal(clampFireTick(2 ** 31 - 2, 1000, infRewindMs(0)), 1000);
		// Fractions inside the window pass through (the game rounds them).
		assert.equal(clampFireTick(996.5, 1000, infRewindMs(0)), 996.5);
		// A longer ping opens the window, up to the whole history and no further.
		assert.equal(clampFireTick(0, 1000, infRewindMs(150)), 1000 - Math.ceil(infRewindMs(150) / INF_STEP_MS) - INF_FIRE_TICK_SLACK);
		assert.equal(clampFireTick(0, 1000, infRewindMs(5000)), clampFireTick(0, 1000, infRewindMs(400)));
		assert.equal(clampFireTick(0, 1000, -50), 1000 - INF_FIRE_TICK_SLACK);
	});
});

describe('infected mode: client messages', () => {
	/** Playing with the .50 cal rifle: Zero (Patient Zero) 300 in front of survivor Ben; Cat far away. */
	function stage() {
		const h = infectedHost(['Zero', 'Ben', 'Cat']);
		const [zero, ben, cat] = h.players as [FakePlayer, FakePlayer, FakePlayer];
		h.state(zero, 0, 0);
		h.state(ben, 0, -300);
		h.state(cat, 1800, 1800);
		h.run(500);
		return { h, zero, ben, cat };
	}
	/** Everything a message could change. */
	const snapshot = (h: ReturnType<typeof stage>['h']) =>
		JSON.stringify({
			view: h.game.view(h.now),
			tick: h.game.tick,
			weapons: h.players.map((p) => {
				const g = h.game;
				return [g.weaponOf(p.id), g.primaryOf(p.id), g.secondaryOf(p.id)].map((w) => w && [w.weapon, w.mag, w.reserve, w.reloadEndsAt, w.nextFireAt]);
			}),
			inboxes: h.players.map((p) => p.inbox.length),
			logs: h.logs.length
		});
	const chest = (x: number, y: number): Vec3 => playerPoint({ x, y, z: 0, yaw: 0, ducked: false, hunched: true }, 'ribs');

	it('malformed messages neither throw nor change anything, from a survivor and from an infected', () => {
		const { h, zero, ben } = stage();
		const before = snapshot(h);
		let n = 0;
		for (const from of [ben, zero])
			for (const m of malformed()) {
				assert.doesNotThrow(() => h.send(from, m), JSON.stringify(m) ?? String(m));
				n++;
			}
		assert.ok(n > 200);
		assert.equal(snapshot(h), before);
		// Nor does it count as playing (economy.acted): only the real shot below does.
		assert.deepEqual(h.acted, []);
		// The game still runs and still takes a real shot.
		h.run(100);
		const at = ben.inbox.length;
		const o = { x: 0, y: -300, z: VIEW_HEIGHT };
		const aim = chest(0, 0);
		const l = Math.hypot(aim.x - o.x, aim.y - o.y, aim.z - o.z);
		h.send(ben, { type: 'fire', weapon: 'barrett', origin: o, dir: { x: (aim.x - o.x) / l, y: (aim.y - o.y) / l, z: (aim.z - o.z) / l }, tick: h.game.tick });
		assert.deepEqual(
			h.events(ben, 'hit', at).map((e) => [e.targetId, e.kill]),
			[[zero.id, true]]
		);
		assert.deepEqual(h.acted, [ben.id]);
	});

	it('messages from a spectator or a player the game does not know are ignored', () => {
		const { h, ben } = stage();
		const before = snapshot(h);
		ben.spectating = true;
		h.send(ben, { type: 'fire', weapon: 'barrett', origin: { x: 0, y: -300, z: VIEW_HEIGHT }, dir: D, tick: h.game.tick });
		ben.spectating = false;
		const ghost: FakePlayer = { ...ben, id: 99, inbox: [] };
		h.send(ghost, { type: 'fire', weapon: 'barrett', origin: { x: 0, y: -300, z: VIEW_HEIGHT }, dir: D, tick: h.game.tick });
		h.send(ghost, { type: 'callMoab' });
		assert.equal(snapshot(h), before);
	});

	it('well-formed but against the rules: refused by the game without side effects', () => {
		const { h, zero, ben } = stage();
		const mags = () => JSON.stringify(h.players.map((p) => [h.game.primaryOf(p.id)!.mag, h.game.secondaryOf(p.id)!.mag]));
		const view = () => JSON.stringify(h.game.view(h.now));
		const before = [mags(), view()];
		const o = { x: 0, y: -300, z: VIEW_HEIGHT };
		// Wrong weapon, an origin that is not at the eye, a survivor's knife throw, beacon and M.O.A.B. without the right to.
		h.send(ben, { type: 'fire', weapon: 'lmg', origin: o, dir: D, tick: h.game.tick });
		h.send(ben, { type: 'fire', weapon: 'barrett', origin: { x: 500, y: 500, z: VIEW_HEIGHT }, dir: D, tick: h.game.tick });
		h.send(ben, { type: 'fire', weapon: 'barrett', origin: o, dir: { x: 0, y: 0.5, z: 0 }, tick: h.game.tick });
		h.send(ben, { type: 'throwKnife', origin: o, dir: D });
		h.send(ben, { type: 'placeBeacon' });
		h.send(ben, { type: 'callMoab' });
		h.send(ben, { type: 'loadout', weapon: 'smg' });
		h.send(zero, { type: 'callMoab' });
		h.send(ben, { type: 'reload' });
		assert.deepEqual([mags(), view()], before);
		assert.equal(h.game.playerView(zero.id)!.hasKnife, true);
		assert.deepEqual(h.acted, [], 'a refused shot is no act');
	});

	it('extra keys in a message never reach the other clients', () => {
		const { h, ben, cat } = stage();
		const at = cat.inbox.length;
		h.send(ben, {
			type: 'fire',
			weapon: 'barrett',
			origin: { x: 0, y: -300, z: VIEW_HEIGHT, name: 'x'.repeat(5000), __proto__: { admin: true } },
			dir: { ...D, payload: [1, 2, 3] },
			tick: h.game.tick,
			extra: { deep: { deeper: 1 } }
		});
		const shot = h.events(cat, 'shot', at)[0]!;
		assert.deepEqual(Object.keys(shot).sort(), ['by', 'd', 'e', 'len', 'o', 'weapon']);
		assert.deepEqual(Object.keys(shot.o).sort(), ['x', 'y', 'z']);
		assert.deepEqual(Object.keys(shot.d).sort(), ['x', 'y', 'z']);
		assert.ok(JSON.stringify(shot).length < 200);
	});

	it('a fire without a usable tick is a live shot (rewound by the ping); a named tick inside the rewind window is used as given', () => {
		const aim = (h: ReturnType<typeof stage>['h'], ben: FakePlayer, at: Vec3, tick: unknown) => {
			const o = { x: 0, y: -300, z: VIEW_HEIGHT };
			const l = Math.hypot(at.x - o.x, at.y - o.y, at.z - o.z);
			const n = ben.inbox.length;
			h.send(ben, { type: 'fire', weapon: 'barrett', origin: o, dir: { x: (at.x - o.x) / l, y: (at.y - o.y) / l, z: (at.z - o.z) / l }, tick });
			return h.events(ben, 'hit', n).length;
		};
		// Patient Zero stepped 150 to the side 200 ms ago; Ben's ping makes his screen 316 ms old.
		const moved = () => {
			const s = stage();
			s.h.state(s.zero, 150, 0);
			s.h.run(200);
			s.ben.ping = 200;
			return s;
		};
		for (const tick of [INF_FIRE_TICK_LIVE, 'abc', null, undefined, {}, 1e300]) {
			const a = moved();
			assert.equal(aim(a.h, a.ben, chest(0, 0), tick), 1, `live ${String(tick)}: the seen pose`);
			const b = moved();
			assert.equal(aim(b.h, b.ben, chest(150, 0), tick), 0, `live ${String(tick)}: not the current pose`);
		}
		const c = moved();
		assert.equal(aim(c.h, c.ben, chest(150, 0), c.h.game.tick), 1, 'named tick: the current pose');
		const d = moved();
		assert.equal(aim(d.h, d.ben, chest(0, 0), d.h.game.tick), 0);
	});

	it('a named tick cannot reach outside the rewind window: tick 0 is not a pass to the whole history', () => {
		const aim = (h: ReturnType<typeof stage>['h'], ben: FakePlayer, at: Vec3, tick: number) => {
			const o = { x: 0, y: -300, z: VIEW_HEIGHT };
			const l = Math.hypot(at.x - o.x, at.y - o.y, at.z - o.z);
			const n = ben.inbox.length;
			h.send(ben, { type: 'fire', weapon: 'barrett', origin: o, dir: { x: (at.x - o.x) / l, y: (at.y - o.y) / l, z: (at.z - o.z) / l }, tick });
			return h.events(ben, 'hit', n).length;
		};
		// Patient Zero stepped 150 to the side 300 ms ago: the old pose is still in the 400 ms history.
		const moved = (ping: number) => {
			const s = stage();
			s.h.state(s.zero, 150, 0);
			s.h.run(300);
			s.ben.ping = ping;
			return s;
		};
		// Ping 0: a real screen is 116 ms old. Naming an old tick gets the pose at the edge of that window, not the one from 300 ms ago.
		for (const tick of [0, -5, 1]) {
			const a = moved(0);
			assert.equal(aim(a.h, a.ben, chest(0, 0), tick), 0, `tick ${tick}: the pose of 300 ms ago is out of reach`);
			const b = moved(0);
			assert.equal(aim(b.h, b.ben, chest(150, 0), tick), 1, `tick ${tick}: the pose at the edge of the window`);
		}
		const old = moved(0);
		assert.equal(aim(old.h, old.ben, chest(0, 0), old.h.game.tick - 19), 0, 'a tick 300 ms back');
		// A ping that covers it: that shooter's screen can be this old, so the tick is allowed.
		const c = moved(250);
		assert.equal(aim(c.h, c.ben, chest(0, 0), 0), 1, 'ping 250: 366 ms back is inside the window');
		// Inside the window a named tick still picks its own pose.
		const d = moved(250);
		assert.equal(aim(d.h, d.ben, chest(150, 0), d.h.game.tick - 4), 1);
	});
});

describe('infected mode: shot and round data over the wire', () => {
	it('a shotgun shot reaches the other clients with its pellets; the shooter gets none', () => {
		// Round 2 is the auto shotgun.
		const h = infectedHost(['Zero', 'Ben', 'Cat'], { roundSecs: 2 });
		const [zero, ben, cat] = h.players as [FakePlayer, FakePlayer, FakePlayer];
		while (h.game.round < 2 || h.game.phase !== 'playing') h.run(1000 / 32);
		assert.equal(h.game.roundLoadout, 'striker');
		const shooter = h.game.alphaId === ben.id ? cat : ben;
		const other = shooter === ben ? cat : ben;
		h.state(shooter, 0, -300);
		h.run(100);
		const [a, b, c] = [shooter.inbox.length, other.inbox.length, zero.inbox.length];
		h.send(shooter, { type: 'fire', weapon: 'striker', origin: { x: 0, y: -300, z: VIEW_HEIGHT }, dir: D, tick: INF_FIRE_TICK_LIVE });
		assert.equal(h.events(shooter, 'shot', a).length, 0);
		for (const [p, from] of [
			[other, b],
			[zero, c]
		] as const) {
			const shot = h.events(p, 'shot', from)[0]!;
			assert.equal(shot.by, shooter.id);
			assert.equal(shot.pellets!.length, (WEAPONS.striker.pellets! - 1) * 4);
			assert.ok(shot.pellets!.every((v) => Number.isFinite(v) && Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6));
		}
	});

	it('the end event carries the round stats and the next loadout', () => {
		const h = infectedHost(['Zero', 'Ben', 'Cat'], { roundSecs: 2 });
		const [zero, ben, cat] = h.players as [FakePlayer, FakePlayer, FakePlayer];
		h.state(zero, 0, 0);
		h.state(ben, 0, -300);
		h.state(cat, 1800, 1800);
		h.run(200);
		h.send(ben, { type: 'fire', weapon: 'barrett', origin: { x: 0, y: -300, z: VIEW_HEIGHT }, dir: { x: 1, y: 0, z: 0 }, tick: INF_FIRE_TICK_LIVE });
		while (h.game.phase === 'playing') h.run(1000 / 32);
		for (const p of [zero, ben, cat]) {
			const end = h.events(p, 'end')[0]!;
			assert.equal(end.winner, 'survivors');
			assert.equal(end.nextLoadout, infLoadout(2));
			assert.deepEqual(end.stats!.map((s) => s.id).sort(), [1, 2, 3]);
			assert.deepEqual(
				end.stats!.find((s) => s.id === ben.id),
				{ id: ben.id, team: 'survivor', alpha: false, score: 250, kills: 0, infections: 0, deaths: 0, shots: 1, hits: 0, headshots: 0, bestStreak: 0, survivedSecs: end.secs }
			);
			assert.equal(end.stats!.find((s) => s.id === zero.id)!.alpha, true);
		}
	});
});
