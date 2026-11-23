/** Coins of Zombie Run (docs/economy.md#zombie-run) on the real map and rules. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getMap, pts, REPEAT_MS, Status, VIEW_HEIGHT, ZM_PLAYER_HP, type ServerMessage, type Vec3 } from '@surf/shared';
import { modeHost, paid } from './coins-helpers.ts';
import { world, type SimPlayer } from './economy-helpers.ts';
import { ZombiesMode } from './modes/zombies.ts';
import { netState } from './test-helpers.ts';

const MAP = getMap('zombies_lowtide')!;
const GATES = MAP.zombies!.gates;
const START: Vec3 = { x: 256, y: 0, z: 0.25 };
const EVAC: Vec3 = { x: 6144, y: 4928, z: 0.25 };
/** In the creek: a fall-out. */
const CREEK: Vec3 = { x: 3800, y: 2000, z: -300 };
const PASSED: Vec3[] = [
	{ x: 3200, y: 420, z: 0.25 },
	{ x: 3200, y: 1590, z: 0.25 },
	{ x: 3200, y: 2400, z: 0.25 },
	{ x: 5000, y: 3328, z: 0.25 },
	{ x: 6144, y: 3700, z: 0.25 }
];
const unlock = (n: number): Vec3 => {
	const u = GATES[n - 1]!.unlock;
	return { x: (u.min.x + u.max.x) / 2, y: (u.min.y + u.max.y) / 2, z: 0.25 };
};

function setup(n: number) {
	const w = world(MAP);
	const players = w.join(n);
	const s = {
		w,
		players,
		mode: null as unknown as ZombiesMode,
		out: [] as ServerMessage[],
		newSession() {
			if (s.mode) w.changeMap(MAP);
			s.mode = new ZombiesMode(modeHost(w, s.out), { countdownSecs: 1, endSecs: 1, spawnIntervalScale: 1e9 });
			s.mode.tick();
			s.ticks(1200);
			assert.equal(s.mode.game.phase, 'playing');
		},
		ticks(ms: number) {
			for (let t = 0; t < ms; t += 1000 / 32) {
				w.now += 1000 / 32;
				s.mode.tick();
			}
		},
		at(p: SimPlayer, pos: Vec3) {
			s.mode.state(p as never, netState(1, pos.x, { y: pos.y, z: pos.z, status: Status.Alive }));
		},
		/** Stand somewhere for a moment (longer than the grace after a teleport). */
		stand(ps: SimPlayer[], pos: Vec3, ms = 1200) {
			w.active();
			for (const p of ps) s.at(p, pos);
			s.ticks(ms);
		},
		/** `ps` open gate n together (the rest has to be few enough) without passing it. */
		open(ps: SimPlayer[], n: number) {
			s.stand(ps, unlock(n), 31_500);
			assert.equal(s.mode.game.gateState(n - 1), 'open', `gate ${n}`);
			w.active();
		},
		/** Open gates `from`..`to` and pass them. */
		pass(ps: SimPlayer[], from: number, to: number) {
			for (let n = from; n <= to; n++) {
				s.open(ps, n);
				s.stand(ps, PASSED[n - 1]!);
			}
		},
		/** A fall costs 1 HP: fall until down. */
		turn(p: SimPlayer) {
			for (let i = 1; i <= ZM_PLAYER_HP; i++) s.stand([p], CREEK, i < ZM_PLAYER_HP ? 1200 : 100);
			assert.equal(s.mode.game.playerView(p.id)!.team, 'zombie');
		},
		evac(p: SimPlayer) {
			s.stand([p], EVAC, 100);
			assert.equal(s.mode.game.phase, 'ended');
		},
		nextRound() {
			s.ticks(2500);
			assert.equal(s.mode.game.phase, 'playing');
		},
		rejoin(p: SimPlayer): SimPlayer {
			w.leave(p);
			s.mode.tick();
			const q = w.rejoin(p);
			s.mode.tick();
			s.ticks(1200);
			return q;
		},
		late(): SimPlayer {
			const [q] = w.join(1);
			s.mode.tick();
			s.ticks(1200);
			return q!;
		},
		paid: (p: SimPlayer, from = 0) => paid(w, p, from)
	};
	s.newSession();
	return s;
}

describe('Zombie Run coins', () => {
	it('gate n pays n to everyone who passes it alive, once; the evac pays gates + 3', () => {
		const s = setup(2);
		const [a, b] = s.players as [SimPlayer, SimPlayer];
		s.open([a, b], 1);
		assert.deepEqual(s.paid(a), [], 'an open gate alone pays nothing');
		s.stand([a], PASSED[0]!);
		assert.deepEqual(s.paid(a), ['Gate 1 1']);
		assert.deepEqual(s.paid(b), []);
		s.stand([a], unlock(1));
		s.stand([a, b], PASSED[0]!);
		assert.deepEqual(s.paid(a), ['Gate 1 1']);
		assert.deepEqual(s.paid(b), ['Gate 1 1']);
		s.pass([a, b], 2, 5);
		s.evac(b);
		for (const p of [a, b]) assert.deepEqual(s.paid(p), ['Gate 1 1', 'Gate 2 2', 'Gate 3 3', 'Gate 4 4', 'Gate 5 5', 'zombiesEvac 8']);
		assert.equal(s.w.db.accountStats(a.accountId!).pointsTotal, pts(23));
		assert.equal(s.out.some((m) => m.type === 'zm' && m.ev.e === 'pass'), false, 'passing is not sent to clients');
	});

	it('the multiplier applies', () => {
		const s = setup(4);
		s.pass(s.players, 1, 1);
		assert.deepEqual(s.w.sent(s.players[0]!, 'award').map((m) => [m.base, m.mult, m.amount]), [[10, 13, 13]]);
	});

	it('evac: living survivors who passed the last gate, not those behind it', () => {
		const s = setup(4);
		const [a, b, c, d] = s.players as [SimPlayer, SimPlayer, SimPlayer, SimPlayer];
		s.pass([a, b, c, d], 1, 4);
		s.turn(d);
		s.open([a, b, c], 5);
		s.stand([a, b], PASSED[4]!);
		s.evac(a);
		assert.ok(s.paid(a).includes('zombiesEvac 8'));
		assert.ok(s.paid(b).includes('zombiesEvac 8'), 'behind the last gate, on the way');
		assert.equal(s.paid(c).includes('zombiesEvac 8'), false, 'still before the last gate');
		assert.deepEqual(s.paid(d), ['Gate 1 1', 'Gate 2 2', 'Gate 3 3', 'Gate 4 4'], 'turned: keeps the gates only');
	});

	it('reaching the evac without passing the gates pays nothing', () => {
		const s = setup(1);
		s.evac(s.players[0]!);
		assert.deepEqual(s.paid(s.players[0]!), []);
	});

	it('a late joiner at a checkpoint gets later gates only, and the evac only with half of them', () => {
		const s = setup(2);
		const [a, b] = s.players as [SimPlayer, SimPlayer];
		s.pass([a, b], 1, 2);
		s.stand([a, b], { x: 3200, y: 2144, z: 0.25 }); // checkpoint 3, before gate 3
		const early = s.late();
		assert.deepEqual(s.paid(early), [], 'gates 1 and 2 were never passed');
		// Back through the open gates and forward again: still nothing.
		s.stand([early], unlock(2));
		s.stand([early], PASSED[1]!);
		assert.deepEqual(s.paid(early), []);
		s.pass([a, b, early], 3, 4);
		s.stand([a], { x: 6144, y: 3360, z: 0.25 }); // checkpoint 5
		const late = s.late();
		s.stand([late], PASSED[3]!);
		assert.deepEqual(s.paid(late), []);
		s.pass([a, b, early, late], 5, 5);
		s.evac(a);
		assert.deepEqual(s.paid(early), ['Gate 3 3', 'Gate 4 4', 'Gate 5 5', 'zombiesEvac 8']);
		assert.deepEqual(s.paid(late), ['Gate 5 5']);
	});

	it('falling out never pays a gate again, nor one it was teleported past', () => {
		const s = setup(3);
		const [a, b, c] = s.players as [SimPlayer, SimPlayer, SimPlayer];
		s.stand([a], { x: 2816, y: 0, z: 0.25 }); // checkpoint 1
		s.pass([a, b, c], 1, 2);
		s.stand([c], CREEK);
		s.stand([c], PASSED[0]!);
		s.stand([c], PASSED[1]!);
		assert.deepEqual(s.paid(c), ['Gate 1 1', 'Gate 2 2']);
		s.pass([a, b], 3, 3);
		s.stand([a], { x: 4800, y: 3328, z: 0.25 }); // checkpoint 4, behind gate 3
		s.stand([c], CREEK); // → checkpoint 4
		s.stand([c], PASSED[2]!);
		assert.deepEqual(s.paid(c), ['Gate 1 1', 'Gate 2 2']);
		s.pass([a, b, c], 4, 4);
		assert.deepEqual(s.paid(c), ['Gate 1 1', 'Gate 2 2', 'Gate 4 4']);
	});

	it('a gap in the packets: a checkpoint behind the gate counts as passing it', () => {
		const s = setup(1);
		const [a] = s.players as [SimPlayer];
		s.open([a], 1);
		s.stand([a], { x: 3200, y: 1400, z: 0.25 }); // checkpoint 2, 1000 units on
		assert.deepEqual(s.paid(a), ['Gate 1 1']);
	});

	it('being behind a closed gate skips it', () => {
		const s = setup(2);
		const [a, b] = s.players as [SimPlayer, SimPlayer];
		s.stand([a], PASSED[0]!);
		s.open([b], 1);
		s.stand([a, b], PASSED[0]!);
		assert.deepEqual(s.paid(a), []);
		assert.deepEqual(s.paid(b), ['Gate 1 1']);
	});

	it('reconnecting: no gate twice, and the gates passed before still count for the evac', () => {
		const s = setup(2);
		const [a, b] = s.players as [SimPlayer, SimPlayer];
		s.pass([a, b], 1, 4);
		const b2 = s.rejoin(b);
		s.stand([a], { x: 6144, y: 3360, z: 0.25 }); // checkpoint 5
		s.stand([b2], CREEK); // → checkpoint 5
		s.pass([a, b2], 5, 5);
		s.evac(a);
		assert.deepEqual(s.paid(b2), ['Gate 5 5', 'zombiesEvac 8']);
		assert.equal(s.w.db.accountStats(b.accountId!).pointsTotal, pts(23));
	});

	it('a turned player who comes back as a survivor earns nothing more that round', () => {
		const s = setup(2);
		const [a, b] = s.players as [SimPlayer, SimPlayer];
		s.pass([a, b], 1, 2);
		s.turn(b);
		const b2 = s.rejoin(b);
		assert.equal(s.mode.game.playerView(b2.id)!.team, 'survivor');
		s.pass([a, b2], 3, 5);
		s.evac(a);
		assert.deepEqual(s.paid(b2), []);
		// The next round is a new one.
		s.nextRound();
		s.pass([a, b2], 1, 1);
		assert.deepEqual(s.paid(b2), ['Gate 1 1']);
	});

	it('player-zombies: 1 per survivor, each survivor once, at most 3 per run; every catch is a contact', () => {
		const s = setup(7);
		const [z, ...rest] = s.players as [SimPlayer, ...SimPlayer[]];
		const contacts: [number, number][] = [];
		const contact = s.w.mode.contact;
		s.w.mode.contact = (by, t) => (contacts.push([by, t]), contact(by, t));
		s.turn(z);
		s.ticks(3200); // rises
		const claw = (target: SimPlayer) => {
			s.stand([z], { x: 300, y: 0, z: 0.25 });
			for (let i = 0; i < ZM_PLAYER_HP; i++) {
				s.at(target, { x: 340, y: 0, z: 0.25 });
				s.w.now += 1000;
				s.mode.message(z as never, { type: 'fire', weapon: 'claws', origin: { x: 300, y: 0, z: 0.25 + VIEW_HEIGHT }, dir: { x: 1, y: 0, z: -0.3 }, tick: 0 });
			}
			assert.equal(s.mode.game.playerView(target.id)!.team, 'zombie');
		};
		for (const p of rest) s.at(p, { x: 0, y: 300, z: 0.25 });
		claw(rest[0]!);
		assert.deepEqual(s.paid(z), ['zombiesKill 1']);
		const again = s.rejoin(rest[0]!);
		claw(again);
		assert.deepEqual(s.paid(z), ['zombiesKill 1'], 'the same survivor again');
		claw(rest[1]!);
		claw(rest[2]!);
		claw(rest[3]!);
		assert.deepEqual(s.paid(z), ['zombiesKill 1', 'zombiesKill 1', 'zombiesKill 1']);
		assert.equal(contacts.length, 5);
	});

	it('a loss ends the round for the caps too, and pays nothing', () => {
		const s = setup(2);
		const [a, b] = s.players as [SimPlayer, SimPlayer];
		s.pass([a, b], 1, 1);
		s.turn(a);
		s.turn(b);
		s.ticks(100);
		assert.equal(s.mode.game.phase, 'ended');
		assert.deepEqual(s.paid(a), ['Gate 1 1']);
		s.nextRound();
		s.pass([a, b], 1, 2);
		assert.deepEqual(s.paid(a), ['Gate 1 1', 'Gate 1 1', 'Gate 2 2']);
	});

	it('repeats of a gate and of the evac: 100, 50, 25, then 10 %, across map sessions within the hour', () => {
		const s = setup(1);
		const [a] = s.players as [SimPlayer];
		const round = () => {
			const from = s.w.sent(a, 'award').length;
			s.pass([a], 1, 5);
			s.evac(a);
			return s.paid(a, from).map((l) => Number(l.split(' ').at(-1)));
		};
		assert.deepEqual(round(), [1, 2, 3, 4, 5, 8]);
		s.nextRound();
		assert.deepEqual(round(), [1, 1, 2, 2, 3, 4]);
		s.newSession();
		assert.deepEqual(round(), [1, 1, 1, 1, 2, 2]);
		s.nextRound();
		assert.deepEqual(round(), [1, 1, 1, 1, 1, 1]);
		s.w.now += REPEAT_MS;
		s.newSession();
		assert.deepEqual(round(), [1, 2, 3, 4, 5, 8]);
	});

	it('everyone leaving ends the round; a new one starts fresh', () => {
		const s = setup(1);
		const [a] = s.players as [SimPlayer];
		s.pass([a], 1, 1);
		s.w.leave(a);
		s.mode.tick();
		assert.equal(s.mode.game.phase, 'waiting');
		const a2 = s.w.rejoin(a);
		s.mode.tick();
		s.ticks(1200);
		s.pass([a2], 1, 1);
		assert.deepEqual(s.paid(a2), ['Gate 1 1']);
	});

	it('guests get the login hint at the first gate; spectators get nothing', () => {
		const s = setup(1);
		const [a] = s.players as [SimPlayer];
		const g = s.w.guest();
		s.mode.tick();
		s.ticks(1200);
		s.pass([a, g], 1, 2);
		assert.equal(s.w.sent(g, 'coinsNotice').length, 1);
		assert.equal(s.w.sent(g, 'award').length, 0);
	});
});
