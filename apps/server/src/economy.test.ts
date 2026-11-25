/** Ledger, activity, playtime and the mode handle (docs/economy.md). Abuse detection: abuse.test.ts. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FLAG_ON_GROUND, FLAG_TELEPORTED, pts, type MapDef } from '@surf/shared';
import { Db, POINT_LOG_KEEP, POINT_LOG_RULES_MS } from './db.ts';
import { world } from './economy-helpers.ts';
import { testMap } from './test-helpers.ts';

const TAG = { ...testMap('tag_x'), kind: 'tag' } as MapDef;
const HNS = { ...testMap('hns_x'), kind: 'hns' } as MapDef;
const SURF = testMap('surf_x');

describe('ledger', () => {
	it('applies the multiplier, updates total and balance and logs the award', () => {
		const w = world(TAG);
		const [a] = w.join(6);
		w.active();
		assert.deepEqual(w.mode.award(a!.id, pts(3), 'tagTag'), { paid: 45 });
		assert.deepEqual(w.db.accountStats(a!.accountId!), { playtimeSecs: 0, pointsTotal: 45, pointsBalance: 45 });
		assert.deepEqual(w.db.db.prepare('SELECT account_id, created_at, mode, map, reason, base, counted, multiplier, amount FROM point_log').all(), [
			{ account_id: a!.accountId, created_at: w.now, mode: 'tag', map: 'tag_x', reason: 'tagTag', base: 30, counted: 30, multiplier: 15, amount: 45 }
		]);
		const msg = w.sent(a!, 'award').at(-1);
		assert.deepEqual(msg, { type: 'award', at: w.now, reason: 'tagTag', label: 'Tag', base: 30, mult: 15, amount: 45, total: 45, balance: 45 });
		assert.equal(w.totals.get(a!.accountId!), 45);
	});

	it('no multiplier in race modes', () => {
		const w = world(SURF);
		const [a] = w.join(8);
		w.active();
		assert.deepEqual(w.mode.award(a!.id, pts(15), 'raceFinish'), { paid: 150 });
		assert.equal(w.mode.multiplier(), 10);
	});

	it('guests earn nothing and are told once per session', () => {
		const w = world(TAG);
		w.join(3);
		const g = w.guest();
		w.active();
		for (let i = 0; i < 3; i++) assert.equal(w.mode.award(g.id, pts(1), 'tagTag').refused, 'guest');
		assert.equal(w.sent(g, 'coinsNotice').length, 1);
		assert.equal((w.db.db.prepare('SELECT COUNT(*) AS n FROM point_log').get() as { n: number }).n, 0);
		// Reconnect under the same browser key.
		w.leave(g);
		const g2 = w.guest(g.playerId);
		w.active();
		w.mode.award(g2.id, pts(1), 'tagTag');
		assert.equal(w.sent(g2, 'coinsNotice').length, 0);
	});

	it('AFK, spectating, unknown players and too few players earn nothing', () => {
		const w = world(HNS);
		const ps = w.join(3);
		w.active();
		const p = ps[0]!;
		w.run(31, (id) => id !== p.id);
		assert.equal(w.mode.award(p.id, pts(3), 'hnsFind').refused, 'afk');
		assert.equal(w.mode.award(ps[1]!.id, pts(3), 'hnsFind').refused, 'minPlayers', 'the AFK player does not count');
		w.active();
		p.spectating = true;
		w.economy.spectate(p);
		assert.equal(w.mode.award(p.id, pts(3), 'hnsFind').refused, 'spectating');
		assert.equal(w.mode.award(999, pts(3), 'hnsFind').refused, 'gone');
		assert.equal(w.mode.award(ps[1]!.id, 0, 'hnsFind').refused, 'nothing');
		assert.equal(w.mode.award(ps[1]!.id, NaN, 'hnsFind').refused, 'nothing');
	});

	it('a reason can need more players than its mode (tag placement)', () => {
		const w = world(TAG);
		const [a] = w.join(3);
		w.active();
		assert.equal(w.mode.enoughPlayers(), true);
		assert.equal(w.mode.enoughPlayers('tagPlace'), false);
		assert.equal(w.mode.award(a!.id, pts(3), 'tagPlace').refused, 'minPlayers');
		assert.equal(w.mode.award(a!.id, pts(1), 'tagTag').paid, 12);
	});

	it('round and session caps hold, also across a reconnect', () => {
		const w = world(TAG);
		const [a] = w.join(3);
		w.active();
		w.mode.roundStart();
		assert.equal(w.mode.award(a!.id, pts(2), 'tagTag').paid, 24);
		assert.equal(w.mode.award(a!.id, pts(2), 'tagTag').paid, 12, 'cut to the cap of 3');
		assert.equal(w.mode.award(a!.id, pts(1), 'tagTag').refused, 'cap');
		assert.equal(w.mode.earned(a!.id, 'tagTag', 'round'), 30);
		assert.equal(w.mode.tally(a!.id, 'win', 'session'), 1);
		w.leave(a!);
		const back = w.rejoin(a!);
		w.active();
		assert.equal(w.mode.award(back.id, pts(1), 'tagTag').refused, 'cap');
		assert.equal(w.mode.tallied(back.id, 'win', 'session'), 1);
		w.mode.roundEnd();
		w.mode.roundStart();
		assert.equal(w.mode.earned(back.id, 'tagTag', 'round'), 0);
		assert.equal(w.mode.earned(back.id, 'tagTag', 'session'), 30);
		assert.equal(w.mode.award(back.id, pts(1), 'tagTag').paid, 12);
		// A new map is a new session; the old handle is dead.
		const old = w.mode;
		w.changeMap(SURF);
		assert.equal(old.award(back.id, pts(1), 'tagTag').refused, 'gone');
		w.active();
		assert.equal(w.mode.award(back.id, pts(2), 'racePb').paid, 20);
	});

	it('backstop: 250 base points per rolling hour, exempt reasons and other accounts aside', () => {
		const w = world(SURF);
		const [a, b] = w.join(2);
		w.active();
		for (let i = 0; i < 16; i++) w.mode.award(a!.id, pts(15), 'raceFinish');
		assert.equal(w.db.accountStats(a!.accountId!).pointsTotal, pts(240));
		assert.equal(w.mode.award(a!.id, pts(15), 'raceFinish').paid, pts(10), 'only the rest');
		assert.equal(w.mode.award(a!.id, pts(15), 'raceFinish').refused, 'backstop');
		assert.equal(w.mode.award(a!.id, pts(15), 'raceFinish').refused, 'backstop');
		const told = () => w.sent(a!, 'coinsNotice').map((m) => m.text);
		assert.deepEqual(told(), ['Hourly coin limit reached (250 per hour). More is paid in 60 min.'], 'told once per hour');
		assert.equal(w.mode.award(a!.id, pts(15), 'raceFirst').paid, pts(15));
		assert.equal(w.mode.award(b!.id, pts(15), 'raceFinish').paid, pts(15));
		// Counted before the multiplier.
		w.now += 3600_001;
		assert.equal(w.mode.award(a!.id, pts(15), 'raceFinish').paid, pts(15));
		for (let i = 0; i < 17; i++) w.mode.award(a!.id, pts(15), 'raceFinish');
		assert.equal(told().length, 2, 'and again an hour later');
		assert.equal(w.sent(b!, 'coinsNotice').length, 0);
	});

	it('remembers when a reason was last paid on this map (record rule)', () => {
		const w = world(SURF);
		const [a, b] = w.join(2);
		w.active();
		assert.equal(w.mode.sinceLastPaid(a!.id, 'raceRecord'), null);
		w.mode.award(a!.id, pts(5), 'raceRecord');
		w.now += 5000;
		assert.equal(w.mode.sinceLastPaid(a!.id, 'raceRecord'), 5000);
		assert.equal(w.mode.sinceLastPaid(b!.id, 'raceRecord'), null);
		w.changeMap(testMap('surf_y'));
		assert.equal(w.mode.sinceLastPaid(a!.id, 'raceRecord'), null);
	});

	it('counts how often a reason was paid on this map lately, across map sessions', () => {
		const w = world(SURF);
		const [a, b] = w.join(2);
		w.active();
		w.mode.award(a!.id, pts(1), 'zombiesGate', { label: 'Gate 1' });
		w.mode.award(a!.id, pts(2), 'zombiesGate', { label: 'Gate 2' });
		w.now += 5000;
		w.changeMap(testMap('surf_y'));
		assert.equal(w.mode.paidWithin(a!.id, 'zombiesGate', 60_000), 0);
		w.changeMap(SURF);
		assert.equal(w.mode.paidWithin(a!.id, 'zombiesGate', 60_000), 2);
		assert.equal(w.mode.paidWithin(a!.id, 'zombiesGate', 60_000, 'Gate 2'), 1);
		assert.equal(w.mode.paidWithin(a!.id, 'zombiesGate', 5000), 0);
		assert.equal(w.mode.paidWithin(a!.id, 'zombiesEvac', 60_000), 0);
		assert.equal(w.mode.paidWithin(b!.id, 'zombiesGate', 60_000), 0);
		assert.equal(w.mode.paidWithin(w.guest().id, 'zombiesGate', 60_000), 0);
	});

	it('spend never goes below zero, keeps the lifetime total and is logged', () => {
		const w = world(SURF);
		const [a] = w.join(1);
		w.active();
		w.mode.award(a!.id, pts(10), 'raceFinish');
		const id = a!.accountId!;
		assert.equal(w.economy.spend(id, 101, 'hat'), false);
		assert.equal(w.economy.spend(id, -5, 'hat'), false);
		assert.equal(w.economy.spend(id, 0, 'hat'), false);
		assert.equal(w.economy.spend(id, 1.5, 'hat'), false);
		assert.equal(w.economy.spend(id, 75, 'hat'), true);
		assert.equal(w.economy.spend(id, 75, 'hat'), false);
		assert.deepEqual(w.db.accountStats(id), { playtimeSecs: 0, pointsTotal: 100, pointsBalance: 25 });
		const coins = w.sent(a!, 'coins').at(-1)!;
		assert.deepEqual([coins.total, coins.balance, coins.recent[0]!.amount, coins.recent[0]!.label], [100, 25, -75, 'Shop: hat']);
		assert.equal(w.economy.spend(9999, 1, 'hat'), false, 'no such account');
	});

	it('a failing database refuses the award and the game goes on', () => {
		const w = world(SURF);
		const [a] = w.join(1);
		w.active();
		const pay = w.db.payPoints.bind(w.db);
		w.db.payPoints = () => {
			throw new Error('disk full');
		};
		assert.equal(w.mode.award(a!.id, pts(1), 'raceFinish').refused, 'error');
		w.db.payPoints = pay;
		assert.equal(w.mode.award(a!.id, pts(1), 'raceFinish').paid, 10);
	});

	it('only the newest log rows per account are kept, older ones are summed up, the totals stay', () => {
		const w = world(TAG);
		const [a, b] = w.join(3);
		const add = (id: number, n: number) => {
			for (let i = 0; i < n; i++) w.db.payPoints({ accountId: id, at: w.now, mode: 'tag', map: 'm', reason: 'tagTag', label: 'x', base: 10, counted: 0, mult: 12, amount: 12 });
		};
		const rows = (id: number) => (w.db.db.prepare('SELECT COUNT(*) AS n FROM point_log WHERE account_id = ?').get(id) as { n: number }).n;
		add(a!.accountId!, POINT_LOG_KEEP + 5);
		add(b!.accountId!, 4);
		const before = w.db.accountStats(a!.accountId!);
		w.clock += 11 * 60_000;
		w.economy.tick();
		assert.equal(rows(a!.accountId!), POINT_LOG_KEEP + 5, 'the limits on repeats still need them');
		w.now += POINT_LOG_RULES_MS + 1;
		w.clock += 11 * 60_000;
		w.economy.tick();
		assert.deepEqual([rows(a!.accountId!), rows(b!.accountId!)], [POINT_LOG_KEEP, 4]);
		assert.deepEqual(w.db.db.prepare('SELECT * FROM point_rollup').all(), [
			{ account_id: a!.accountId, mode: 'tag', reason: 'tagTag', entries: 5, base: 50, amount: 60 }
		]);
		assert.equal(w.db.rollUpPoints(w.now + 1, POINT_LOG_KEEP - 1), 1, 'adds to the sums');
		assert.equal((w.db.db.prepare('SELECT amount FROM point_rollup WHERE account_id = ?').get(a!.accountId) as { amount: number }).amount, 72);
		assert.deepEqual(w.db.accountStats(a!.accountId!), before);
	});
});

describe('activity', () => {
	it('moving keeps a player active for 30 s; looking around does not', () => {
		const w = world(TAG);
		const [a, b] = w.join(2);
		assert.equal(w.economy.activePlayers(), 0, 'not before the first movement');
		w.active();
		assert.equal(w.economy.activePlayers(), 2);
		w.run(29, (id) => id === b!.id);
		assert.equal(w.mode.isActive(a!.id), true);
		w.run(2, (id) => id === b!.id, { look: [a!.id] });
		assert.equal(w.mode.isActive(a!.id), false);
		assert.equal(w.economy.activePlayers(), 1);
		// Client that stopped sending altogether.
		w.run(31, () => false, { silent: true });
		assert.equal(w.economy.activePlayers(), 0);
	});

	it('hiders stay active by looking around, held players by being held', () => {
		const w = world(HNS);
		const [hider, seeker, lazy] = w.join(3);
		w.active();
		w.stillness.set(hider!.id, 'look');
		w.stillness.set(seeker!.id, 'held');
		w.stillness.set(lazy!.id, 'look');
		w.run(60, () => false, { look: [hider!.id] });
		assert.deepEqual([hider, seeker, lazy].map((p) => w.mode.isActive(p!.id)), [true, true, false]);
		w.stillness.clear();
		w.run(31, () => false);
		assert.equal(w.economy.activePlayers(), 0);
	});

	it('a teleport or respawn is no movement', () => {
		const w = world(TAG);
		const [a] = w.join(1);
		w.active();
		w.run(20, () => false);
		a!.x += 500;
		w.run(11, () => false, { flags: FLAG_TELEPORTED | FLAG_ON_GROUND });
		assert.equal(w.mode.isActive(a!.id), false);
	});

	it('the map change holds the clock until the first packet', () => {
		const w = world(TAG);
		w.join(2);
		w.active();
		w.run(25, () => false);
		w.changeMap(HNS);
		w.run(10, () => false, { silent: true });
		assert.equal(w.economy.activePlayers(), 2);
		w.run(10, () => false);
		assert.equal(w.economy.activePlayers(), 0);
	});

	it('a guest counts as a player, an account connected twice counts once', () => {
		const w = world(TAG);
		const [a] = w.join(1);
		w.rejoin(a!); // second connection of the same account
		w.guest();
		w.active();
		assert.equal(w.economy.activePlayers(), 2);
	});

	it('tells everyone the multiplier and the active players when they change', () => {
		const w = world(TAG);
		const [a] = w.join(4);
		w.active();
		assert.deepEqual(w.sent(a!, 'multiplier').at(-1), { type: 'multiplier', mult: 13, active: 4, need: 3 });
		const n = w.sent(a!, 'multiplier').length;
		w.run(5, () => true);
		assert.equal(w.sent(a!, 'multiplier').length, n, 'not repeated');
		w.changeMap(SURF);
		w.active();
		assert.deepEqual(w.sent(a!, 'multiplier').at(-1), { type: 'multiplier', mult: 10, active: 4, need: 0 });
	});

	it('an impossible jump or speed blocks awards for 5 s; spawns do not', () => {
		const w = world(HNS);
		const ps = w.join(5);
		w.active();
		const p = ps[0]!;
		assert.equal(w.mode.award(p.id, pts(3), 'hnsFind').refused, undefined);
		p.x += 3000;
		w.run(0.1, () => true);
		assert.equal(w.mode.award(p.id, pts(3), 'hnsFind').refused, 'suspect');
		w.run(5, () => true);
		assert.equal(w.mode.award(p.id, pts(3), 'hnsFind').refused, undefined);
		// The mode moved the player: announced by its spawn event.
		w.economy.sent(p, { type: 'hns', ev: { e: 'spawn', id: p.id, role: 'seeker', pos: { x: 0, y: 0, z: 0 }, yaw: 0, freezeSecs: 3 } });
		p.x += 3000;
		w.run(0.1, () => true);
		assert.equal(w.mode.award(p.id, pts(3), 'hnsFind').refused, undefined);
		// Back to a map spawn (fall-out trigger).
		w.run(6, () => true);
		p.x = 110;
		p.y = 0;
		w.run(0.1, () => true, { flags: FLAG_TELEPORTED });
		assert.equal(w.mode.award(p.id, pts(3), 'hnsFind').refused, undefined);
		// Bhop chains and falls are fine, an impossible speed is not.
		w.run(0.5, () => true, { speed: { [p.id]: 590 } });
		assert.equal(w.mode.award(p.id, pts(3), 'hnsFind').refused, undefined);
		w.run(0.5, () => true, { speed: { [p.id]: 700 } });
		assert.equal(w.mode.award(p.id, pts(3), 'hnsFind').refused, 'suspect');
	});
});

describe('playtime points', () => {
	const total = (w: ReturnType<typeof world>, id: number) => w.db.accountStats(id).pointsTotal;

	it('10 per 15 active minutes at ×1.0, carried over between sessions and maps', () => {
		const w = world(TAG);
		const [a] = w.join(5);
		const id = a!.accountId!;
		w.run(10 * 60, () => true, { hz: 8 });
		assert.equal(total(w, id), 0);
		w.leave(a!);
		w.economy.leaveAccount(id, a!);
		const saved = w.db.activeMs(id);
		assert.ok(saved > 9.8 * 60_000 && saved <= 10 * 60_000, `${saved}`);
		w.now += 86_400_000;
		w.changeMap(SURF);
		w.rejoin(a!);
		w.run(5.3 * 60, () => true, { hz: 8 });
		assert.equal(total(w, id), pts(10));
		assert.ok(w.db.activeMs(id) < 30_000);
		assert.deepEqual(w.sent(a!, 'award').map((m) => [m.reason, m.amount, m.mult]), []);
	});

	it('AFK, a held key and a repeated input do not count; varied input does', () => {
		for (const [kind, earns] of [
			['still', false],
			['heldKey', false],
			['spin', false],
			['macro', false],
			['human', true]
		] as const) {
			const w = world(SURF);
			const [a] = w.join(1);
			w.run(21 * 60, () => kind !== 'still', { hz: 16, input: kind });
			assert.equal(total(w, a!.accountId!), earns ? pts(10) : 0, kind);
		}
	});

	it('spectating counts for 5 minutes in a row', () => {
		const w = world(SURF);
		const [a] = w.join(1);
		w.run(60, () => true);
		const before = () => w.activeMs(a!);
		const t0 = before();
		a!.spectating = true;
		w.economy.spectate(a!);
		w.run(20 * 60, () => false, { silent: true, hz: 8 });
		const spent = before() - t0;
		assert.ok(spent > 4.8 * 60_000 && spent <= 5 * 60_000 + 300, `${spent}`);
	});

	it('a stalled or suspended server adds at most a few seconds', () => {
		const w = world(SURF);
		const [a] = w.join(1);
		w.run(10, () => true);
		const t0 = w.activeMs(a!);
		w.clock += 8 * 3600_000;
		w.economy.tick();
		assert.ok(w.activeMs(a!) - t0 <= 5000);
	});

	it('is kept when the payout fails and paid the next time', () => {
		const w = world(SURF);
		const [a] = w.join(1);
		const pay = w.db.payPoints.bind(w.db);
		w.db.payPoints = () => {
			throw new Error('locked');
		};
		w.run(16 * 60, () => true, { hz: 8 });
		assert.equal(total(w, a!.accountId!), 0);
		w.db.payPoints = pay;
		w.run(1, () => true);
		assert.equal(total(w, a!.accountId!), pts(10));
	});

	it('close writes the remaining active time', () => {
		const w = world(SURF);
		const [a] = w.join(1);
		w.run(50, () => true);
		assert.equal(w.db.activeMs(a!.accountId!), 0);
		w.economy.close();
		assert.ok(w.db.activeMs(a!.accountId!) > 45_000);
	});
});

describe('Db points', () => {
	it('an account deleted meanwhile is not paid', () => {
		const db = new Db(':memory:');
		const id = db.createAccount('Ana', 'h')!.id;
		const e = { accountId: id, at: 1, mode: 'tag', map: 'm', reason: 'tagTag', label: 'Tag', base: 10, counted: 10, mult: 10, amount: 10 };
		assert.equal(db.payPoints(e)?.pointsTotal, 10);
		db.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
		assert.equal(db.payPoints(e), null);
		assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM point_log').get() as { n: number }).n, 0);
		db.close();
	});
});
