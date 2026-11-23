/** Coins in Tag (docs/economy.md#tag): the real TagMode and economy on fake clocks. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pts, TAG_INTERMISSION_SECS, TAG_ROUND_SECS, type MapDef } from '@surf/shared';
import type { SimPlayer } from './economy-helpers.ts';
import { seeded } from './economy-helpers.ts';
import { TagMode } from './modes/tag.ts';
import { modeWorld } from './payout-helpers.ts';
import { testMap } from './test-helpers.ts';

const MAP = { ...testMap('tag_x'), kind: 'tag', layout: 'open', spawns: [{ pos: { x: 0, y: 0, z: 0 }, yaw: 0 }] } as MapDef;

/** `n` players far apart, the round running; rng 0 makes the first one IT. */
function round(n: number, rng: () => number = () => 0, ip?: (i: number) => string | null) {
	const s = modeWorld(MAP, (h) => new TagMode(h), rng);
	const ps = s.w.join(n, ip);
	ps.forEach((p, i) => s.enter(p, i * 2000));
	s.run(TAG_INTERMISSION_SECS + 0.1);
	assert.equal(s.mode.game.phase, 'playing');
	return { s, ps };
}
type Sim = ReturnType<typeof round>['s'];

/** `it` touches `target` once. */
function tag(s: Sim, it: SimPlayer, target: SimPlayer, x = -5000): void {
	s.run(3.1); // immunity over
	s.put(it, x, 0);
	s.put(target, x + 30, 0);
	s.run(0.1);
	assert.ok(s.mode.game.isIt(target.id), 'tagged');
	s.put(it, x - 3000 - it.id * 2000, 0);
	s.put(target, x + 3000 + target.id * 2000, 0);
}
/** `it` runs 300 behind `runner` for `secs`. */
function chase(s: Sim, it: SimPlayer, runner: SimPlayer, secs: number, gap = 300, moving = true): void {
	const x0 = 1000;
	const y = 9000 + runner.id * 1000; // away from anyone parked
	s.run(secs, (t) => {
		const x = moving ? x0 + t * 250 : x0;
		s.put(it, x, y);
		s.put(runner, x + gap, y);
	});
}
const endRound = (s: Sim) => s.runUntil(() => s.mode.game.phase !== 'playing', TAG_ROUND_SECS + 1);

describe('tag: chases', () => {
	it('1 point per 20 s for the runner only, 3 per round, with the multiplier', () => {
		const { s, ps } = round(3);
		chase(s, ps[0]!, ps[1]!, 19);
		assert.equal(s.paid(ps[1]!, 'tagChased'), 0);
		chase(s, ps[0]!, ps[1]!, 2);
		assert.equal(s.paid(ps[1]!, 'tagChased'), pts(1));
		assert.equal(s.w.db.accountStats(ps[1]!.accountId!).pointsTotal, 12, '×1.2 with three');
		chase(s, ps[0]!, ps[1]!, 90);
		assert.equal(s.paid(ps[1]!, 'tagChased'), pts(3));
		assert.equal(s.paid(ps[0]!, 'tagChased'), 0);
		endRound(s);
		s.run(TAG_INTERMISSION_SECS + 0.1);
		chase(s, ps[0]!, ps[1]!, 21);
		assert.equal(s.paid(ps[1]!, 'tagChased'), pts(4), 'the cap starts over');
	});

	it('nothing when too far, standing, in the countdown, or with two players', () => {
		const { s, ps } = round(3);
		chase(s, ps[0]!, ps[1]!, 30, 600);
		chase(s, ps[0]!, ps[1]!, 30, 300, false);
		assert.equal(s.paid(ps[1]!, 'tagChased'), 0);
		endRound(s);
		chase(s, ps[0]!, ps[1]!, TAG_INTERMISSION_SECS - 1);
		assert.equal(s.paid(ps[1]!, 'tagChased'), 0);
		const two = round(2);
		chase(two.s, two.ps[0]!, two.ps[1]!, 60);
		assert.equal(two.s.paid(two.ps[1]!, 'tagChased'), 0);
	});

	it('a wall between them, and an unfinished 20 s of the last round, do not count', () => {
		const wall = { type: 'box' as const, min: { x: -1e5, y: 9050, z: -10 }, max: { x: 1e5, y: 9060, z: 500 }, material: 'w' };
		const s = modeWorld({ ...MAP, brushes: [wall] } as MapDef, (h) => new TagMode(h));
		const ps = s.w.join(3);
		ps.forEach((p, i) => s.enter(p, i * 2000));
		s.run(TAG_INTERMISSION_SECS + 0.1);
		const it = ps[0]!;
		const run = ps[1]!;
		s.run(40, (t) => {
			s.put(it, t * 250, 9000);
			s.put(run, t * 250, 9200);
		});
		assert.equal(s.paid(run, 'tagChased'), 0);

		const r = round(3);
		chase(r.s, r.ps[0]!, r.ps[1]!, 15);
		endRound(r.s);
		r.s.run(TAG_INTERMISSION_SECS + 0.1);
		chase(r.s, r.ps[0]!, r.ps[1]!, 15);
		assert.equal(r.s.paid(r.ps[1]!, 'tagChased'), 0);
	});
});

describe('tag: tags', () => {
	it('1 point per different runner, 3 per round', () => {
		const { s, ps } = round(5);
		const [a, b, c, d, e] = ps as [SimPlayer, SimPlayer, SimPlayer, SimPlayer, SimPlayer];
		tag(s, a, b);
		assert.equal(s.paid(a, 'tagTag'), pts(1));
		assert.equal(s.paid(b, 'tagTag'), 0);
		tag(s, b, a);
		tag(s, a, b);
		assert.equal(s.paid(a, 'tagTag'), pts(1), 'the same runner again');
		for (const t of [c, d, e]) {
			tag(s, b, a);
			tag(s, a, t);
			tag(s, t, b);
		}
		assert.equal(s.paid(a, 'tagTag'), pts(3), 'four different ones');
		endRound(s);
	});

	it('a runner who reconnects is not a different runner; a tagger keeps the cap', () => {
		const { s, ps } = round(4);
		const [a, b] = ps as [SimPlayer, SimPlayer];
		tag(s, a, b);
		s.leave(b);
		const b2 = s.enter(s.w.rejoin(b), 50_000);
		s.run(0.1);
		const it = ps.find((p) => s.mode.game.isIt(p.id))!;
		if (it !== a) tag(s, it, a);
		tag(s, a, b2);
		assert.equal(s.paid(a, 'tagTag'), pts(1));
	});

	it('every tag is a contact, paid or not: a ping-pong pair gets one harmless signal', () => {
		const { s, ps } = round(5);
		for (let i = 0; i < 4; i++) tag(s, ps[i % 2]!, ps[(i + 1) % 2]!);
		assert.equal(s.w.economy.abuse.strikes(ps[0]!.accountId!), 1);
		assert.deepEqual(s.warnings(), []);
	});
});

describe('tag: placement', () => {
	/** Everyone has met the action; `it` is IT for `secs` in a row. */
	function play(s: Sim, ps: SimPlayer[]): void {
		for (const p of ps) if (!s.mode.game.isIt(p.id)) chase(s, ps.find((o) => s.mode.game.isIt(o.id))!, p, 11 + p.id);
	}

	it('3 / 2 / 1 for the top three of 4 or more', () => {
		const { s, ps } = round(5);
		play(s, ps);
		// P1 stays IT; the others tie on time and differ by how long they were chased.
		endRound(s);
		assert.deepEqual(ps.map((p) => s.paid(p, 'tagPlace')), [0, 0, pts(1), pts(2), pts(3)]);
	});

	it('the time not IT comes first', () => {
		const { s, ps } = round(4);
		play(s, ps);
		tag(s, ps[0]!, ps[3]!); // the one chased longest is IT for the rest
		endRound(s);
		assert.deepEqual(ps.map((p) => s.paid(p, 'tagPlace')), [pts(1), pts(2), pts(3), 0]);
	});

	it('nothing with three players, and nothing for hiding from the action', () => {
		const three = round(3);
		play(three.s, three.ps);
		endRound(three.s);
		assert.deepEqual(three.ps.map((p) => three.s.paid(p, 'tagPlace')), [0, 0, 0]);
		const { s, ps } = round(5);
		for (const p of ps.slice(1, 3)) chase(s, ps[0]!, p, 12);
		endRound(s);
		const paid = ps.map((p) => s.paid(p, 'tagPlace'));
		assert.deepEqual([paid[0], paid[1]! + paid[2]!, paid[3], paid[4]], [pts(1), pts(5), 0, 0], 'the one always IT is third, hiders are out');
	});

	it('joining late, leaving and coming back, and spectating in between lose the placement', () => {
		const { s, ps } = round(5);
		const late = s.enter(s.w.join(1)[0]!, 30_000);
		play(s, ps);
		chase(s, ps[0]!, late, 20);
		s.spectate(ps[4]!, true);
		s.run(0.1);
		s.spectate(ps[4]!, false);
		s.leave(ps[3]!);
		const back = s.enter(s.w.rejoin(ps[3]!), 40_000);
		s.run(1);
		chase(s, ps[0]!, back, 12);
		endRound(s);
		assert.deepEqual([late, back, ps[4]!].map((p) => s.paid(p, 'tagPlace')), [0, 0, 0]);
		assert.deepEqual(ps.slice(0, 3).map((p) => s.paid(p, 'tagPlace')), [pts(1), pts(2), pts(3)]);
	});

	it('a cancelled round pays no placement; what was earned stays', () => {
		const { s, ps } = round(4);
		play(s, ps);
		chase(s, ps[0]!, ps[1]!, 21);
		const earned = s.paid(ps[1]!, 'tagChased');
		assert.ok(earned > 0);
		for (const p of ps.slice(1)) s.leave(p);
		assert.equal(s.mode.game.phase, 'waiting');
		s.run(TAG_ROUND_SECS);
		for (const p of ps) assert.equal(s.paid(p, 'tagPlace'), 0);
		assert.equal(s.paid(ps[1]!, 'tagChased'), earned);
	});

	it('AFK players get none', () => {
		const { s, ps } = round(6);
		play(s, ps);
		s.afk.add(ps[5]!.id);
		s.put(ps[5]!, 70_000, 0);
		endRound(s);
		assert.deepEqual(ps.slice(3).map((p) => s.paid(p, 'tagPlace')), [pts(1), pts(2), 0]);
	});
});

describe('tag: abuse signals', () => {
	it('an IT who runs along next to a friend without trying is a shadow; a close chase is not', () => {
		for (const [gap, flagged] of [[85, true], [60, false]] as const) {
			const { s, ps } = round(5);
			chase(s, ps[0]!, ps[1]!, 60, gap);
			assert.equal(s.w.economy.abuse.strikes(ps[0]!.accountId!) > 0, flagged, `gap ${gap}`);
		}
	});

	for (const n of [3, 4, 5])
		it(`${n} friends on one network playing for half an hour get no warning`, () => {
			const rng = seeded(n);
			const { s, ps } = round(n, rng, () => '203.0.113.7');
			const pos = new Map(ps.map((p) => [p.id, { x: rng() * 1000, y: rng() * 1000, h: rng() * 6 }]));
			s.run(1800, () => {
				const g = s.mode.game;
				for (const p of ps) {
					const b = pos.get(p.id)!;
					const others = ps.filter((o) => o !== p && g.isIt(o.id) !== g.isIt(p.id) && !g.immune(s.w.now).includes(o.id));
					const near = others.sort((o, q) => dist(pos.get(o.id)!, b) - dist(pos.get(q.id)!, b))[0];
					if (near && rng() < 0.2) {
						const o = pos.get(near.id)!;
						const away = g.isIt(p.id) ? 0 : Math.PI;
						if (g.isIt(p.id) || dist(o, b) < 300) b.h = Math.atan2(o.y - b.y, o.x - b.x) + away + (rng() - 0.5);
					} else if (rng() < 0.05) b.h += (rng() - 0.5) * 2;
					const sp = (g.isIt(p.id) ? 280 : 250) / 32;
					b.x = Math.max(-900, Math.min(900, b.x + Math.cos(b.h) * sp));
					b.y = Math.max(-900, Math.min(900, b.y + Math.sin(b.h) * sp));
					s.put(p, b.x, b.y, 0.25, (b.h * 180) / Math.PI);
				}
			});
			assert.deepEqual(s.warnings(), []);
			for (const p of ps) assert.ok(s.paid(p, 'tagTag') > 0 && s.paid(p, 'tagChased') > 0);
		});
});

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
