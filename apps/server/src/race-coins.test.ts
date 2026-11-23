/** Coins of surf and bhop (docs/economy.md#race-modes). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pts, RACE_PAY, REPEAT_MS, Status, TICK_RATE, type MapDef } from '@surf/shared';
import { modeHost, paid } from './coins-helpers.ts';
import { world, type SimPlayer } from './economy-helpers.ts';
import { RaceMode } from './modes/race.ts';
import { netState, testMap } from './test-helpers.ts';

const EASY = testMap('surf_x');
const HARD = { ...testMap('bhop_x'), kind: 'bhop', difficulty: 'hard' } as MapDef;

function setup(map: MapDef = EASY) {
	const w = world(map);
	const s = {
		w,
		mode: null as unknown as RaceMode,
		start(m: MapDef) {
			if (s.mode) w.changeMap(m);
			s.mode = new RaceMode(modeHost(w));
			for (const p of w.players) s.mode.join(p as never);
		},
		join(n: number): SimPlayer[] {
			const ps = w.join(n);
			for (const p of ps) s.mode.join(p as never);
			return ps;
		},
		/** A valid run of `ticks`; returns what it paid. */
		run(p: SimPlayer, ticks: number, o: { teleport?: boolean } = {}): string[] {
			w.active();
			const from = w.sent(p, 'award').length;
			const mp = p as never;
			const t0 = 10_000;
			s.mode.state(mp, netState(t0 - 2, 150, { status: Status.StartZone }));
			s.mode.zone(mp, 'start', 0, t0);
			for (let t = t0; t <= t0 + ticks; t += 16) {
				const x = o.teleport && t - t0 === 128 ? -3000 : 216 + ((t - t0) * 1850) / ticks;
				s.mode.state(mp, netState(t, x, { vx: 400, runTicks: t - t0 }));
				if (t - t0 === 256) s.mode.zone(mp, 'stage', 2, t);
			}
			w.now += (ticks / TICK_RATE) * 1000;
			s.mode.zone(mp, 'end', 0, t0 + ticks);
			return paid(w, p, from);
		}
	};
	s.start(map);
	return s;
}

describe('race coins', () => {
	it('first finish ever pays twice; repeats pay 100, 50, 25 %, then nothing', () => {
		const s = setup();
		const [a] = s.join(1);
		assert.deepEqual(s.run(a!, 640), ['raceFinish 4', 'raceFirst 4']);
		assert.deepEqual(s.run(a!, 640), ['raceFinish 2']);
		assert.deepEqual(s.run(a!, 640), ['raceFinish 1']);
		assert.deepEqual(s.run(a!, 640), []);
		assert.deepEqual(s.run(a!, 640), []);
		assert.equal(s.w.db.accountStats(a!.accountId!).pointsTotal, pts(11));
	});

	it('hard bhop: 12, 6, 3, never with a multiplier', () => {
		const s = setup(HARD);
		const [a] = s.join(8);
		assert.deepEqual(s.run(a!, 640), ['raceFinish 12', 'raceFirst 12']);
		assert.deepEqual(s.run(a!, 640), ['raceFinish 6']);
		assert.deepEqual(s.run(a!, 640), ['raceFinish 3']);
		assert.equal(s.w.sent(a!, 'award').every((m) => m.mult === 10), true);
	});

	it('a run stored before coins existed is not a first finish', () => {
		const s = setup();
		const [a] = s.join(1);
		s.w.db.saveRun(a!.accountId!, EASY.id, 700, [256]);
		assert.deepEqual(s.run(a!, 640), ['raceFinish 4', 'racePb 2']);
	});

	it('personal best: not on the first run, once per map session, not for a tie', () => {
		const s = setup();
		const [a] = s.join(1);
		s.run(a!, 704);
		assert.deepEqual(s.run(a!, 704), ['raceFinish 2']);
		assert.deepEqual(s.run(a!, 688), ['raceFinish 1', 'racePb 2']);
		assert.deepEqual(s.run(a!, 640), []);
	});

	it('record: only against another account, first or not', () => {
		const s = setup();
		const [a, b] = s.join(2);
		assert.deepEqual(s.run(a!, 704), ['raceFinish 4', 'raceFirst 4'], 'the first time on a map beats nobody');
		assert.deepEqual(s.run(a!, 688), ['raceFinish 2', 'racePb 2'], 'own record');
		assert.deepEqual(s.run(b!, 688), ['raceFinish 4', 'raceFirst 4'], 'a tie beats nothing');
		assert.deepEqual(s.run(b!, 640), ['raceFinish 2', 'racePb 2', 'raceRecord 5'], "the older of two equal times is a's");
		assert.deepEqual(s.run(a!, 624), ['raceFinish 1', 'raceRecord 5']);
	});

	it('record: once per map and account in 24 hours, also in a later session; hard pays 15', () => {
		const s = setup(HARD);
		const [a, b] = s.join(2);
		s.run(a!, 704);
		assert.ok(s.run(b!, 688).includes('raceRecord 15'));
		s.run(a!, 672);
		s.start(HARD);
		assert.equal(s.run(b!, 656).includes('raceRecord 15'), false);
		s.run(a!, 640);
		s.w.now += RACE_PAY.recordEveryMs;
		assert.ok(s.run(b!, 624).includes('raceRecord 15'));
	});

	it('a new map session within the hour does not reset the decay or the PB', () => {
		const s = setup();
		const [a] = s.join(1);
		s.run(a!, 704);
		s.run(a!, 688); // 50 % and PB
		s.start(HARD);
		s.run(a!, 704);
		s.start(EASY);
		assert.deepEqual(s.run(a!, 672), ['raceFinish 1']);
		assert.deepEqual(s.run(a!, 656), []);
		s.start(EASY);
		s.w.now += REPEAT_MS;
		assert.deepEqual(s.run(a!, 640), ['raceFinish 4', 'racePb 2']);
	});

	it('a long session does not start over after an hour', () => {
		const s = setup();
		const [a] = s.join(1);
		for (let i = 0; i < 3; i++) s.run(a!, 640);
		s.w.now += REPEAT_MS;
		assert.deepEqual(s.run(a!, 640), []);
	});

	it('reconnecting does not reset the decay', () => {
		const s = setup();
		const [a] = s.join(1);
		s.run(a!, 640);
		s.mode.leave(a! as never);
		s.w.leave(a!);
		const a2 = s.w.rejoin(a!);
		s.mode.join(a2 as never);
		assert.deepEqual(s.run(a2, 640), ['raceFinish 2']);
	});

	it('rejected runs pay nothing and count for nothing', () => {
		const s = setup();
		const [a] = s.join(1);
		assert.deepEqual(s.run(a!, 640, { teleport: true }), []);
		assert.deepEqual(s.run(a!, 640), ['raceFinish 4', 'raceFirst 4']);
	});

	it('guests get the login hint once and leave no record behind', () => {
		const s = setup();
		const [a] = s.join(1);
		const g = s.w.guest();
		s.mode.join(g as never);
		assert.deepEqual(s.run(g, 576), []);
		assert.deepEqual(s.run(g, 576), []);
		assert.equal(s.w.sent(g, 'coinsNotice').length, 1);
		assert.deepEqual(s.run(a!, 640), ['raceFinish 4', 'raceFirst 4']);
	});
});
