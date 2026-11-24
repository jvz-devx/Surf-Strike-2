/** Account playtime and points: counting, storage, wire fields (docs/gameplay.md#points-and-playtime). */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { ScoreRow } from '@surf/shared';
import { AccountStats } from './account-stats.ts';
import { Db } from './db.ts';
import { startServer, type GameServer } from './server.ts';
import { sleep, TestClient, testMap } from './test-helpers.ts';

describe('AccountStats', () => {
	function setup() {
		const db = new Db(':memory:');
		const a = db.createAccount('Ana', 'h')!.id;
		const b = db.createAccount('Bob', 'h')!.id;
		const clock = { ms: 1000 };
		return { db, a, b, clock, stats: new AccountStats(db, () => clock.ms) };
	}

	it('counts time online, writes on flush and leave, and adds up across sessions', () => {
		const { db, a, clock, stats } = setup();
		const c1 = {};
		stats.join(a, c1);
		assert.deepEqual(stats.totals(a), { pointsTotal: 0, playtimeSecs: 0 });
		clock.ms += 59_900;
		assert.equal(stats.totals(a)?.playtimeSecs, 59);
		assert.equal(db.accountStats(a).playtimeSecs, 0, 'nothing written before the flush');
		stats.flush();
		assert.equal(db.accountStats(a).playtimeSecs, 59);
		clock.ms += 100; // the 900 ms left over plus 100 ms
		assert.equal(stats.totals(a)?.playtimeSecs, 60);
		clock.ms += 30_000;
		stats.leave(a, c1);
		assert.equal(db.accountStats(a).playtimeSecs, 90);
		assert.equal(stats.totals(a), null);
		clock.ms += 500_000; // offline
		const c2 = {};
		stats.join(a, c2);
		assert.equal(stats.totals(a)?.playtimeSecs, 90);
		clock.ms += 10_000;
		stats.close();
		assert.equal(db.accountStats(a).playtimeSecs, 100);
		stats.leave(a, c2); // late socket close after shutdown
		assert.equal(db.accountStats(a).playtimeSecs, 100);
		db.close();
	});

	it('counts an account connected twice once', () => {
		const { db, a, b, clock, stats } = setup();
		const [c1, c2, c3] = [{}, {}, {}];
		stats.join(a, c1);
		stats.join(b, c3);
		clock.ms += 10_000;
		stats.join(a, c2);
		clock.ms += 10_000;
		stats.leave(a, c1);
		stats.leave(a, c1);
		assert.equal(stats.totals(a)?.playtimeSecs, 20, 'still online on the other connection');
		clock.ms += 10_000;
		stats.leave(a, c2);
		stats.flush();
		assert.equal(db.accountStats(a).playtimeSecs, 30);
		assert.equal(db.accountStats(b).playtimeSecs, 30);
		db.close();
	});

	it('a clock going backwards never removes playtime', () => {
		const { db, a, clock, stats } = setup();
		stats.join(a, {});
		clock.ms += 5_000;
		stats.flush();
		clock.ms -= 60_000;
		stats.flush();
		assert.equal(stats.totals(a)?.playtimeSecs, 5);
		clock.ms += 5_000;
		stats.close();
		assert.equal(db.accountStats(a).playtimeSecs, 10);
		db.close();
	});

	it('a failed write is kept and retried, also after the player left', () => {
		const { db, a, clock } = setup();
		let fail = true;
		const logs: string[] = [];
		const stats = new AccountStats(
			{
				accountStats: (id) => db.accountStats(id),
				addPlaytime: (e) => {
					if (fail) throw new Error('disk full');
					db.addPlaytime(e);
				}
			},
			() => clock.ms,
			(m) => logs.push(m)
		);
		const c = {};
		stats.join(a, c);
		clock.ms += 60_000;
		stats.flush();
		clock.ms += 10_000;
		stats.leave(a, c);
		assert.deepEqual(logs, ['playtime not saved: disk full', 'playtime not saved: disk full']);
		clock.ms += 100_000; // offline time is not counted
		fail = false;
		stats.flush();
		assert.equal(db.accountStats(a).playtimeSecs, 70);
		db.close();
	});

	it('an account deleted while online does not fail the others; points are separate and untouched', () => {
		const { db, a, b, clock, stats } = setup();
		db.db.prepare('INSERT INTO account_stats (account_id, playtime_secs, points_total, points_balance) VALUES (?, 7, 509, 120)').run(b);
		stats.join(a, {});
		stats.join(b, {});
		assert.deepEqual(stats.totals(b), { pointsTotal: 50, playtimeSecs: 7 });
		db.db.prepare('DELETE FROM accounts WHERE id = ?').run(a);
		clock.ms += 3_000;
		stats.flush();
		assert.deepEqual(db.accountStats(b), { playtimeSecs: 10, pointsTotal: 509, pointsBalance: 120 });
		assert.deepEqual(db.accountStats(a), { playtimeSecs: 0, pointsTotal: 0, pointsBalance: 0 });
		db.close();
	});
});

describe('account totals on the scoreboard', () => {
	const dir = mkdtempSync(join(tmpdir(), 'surf-stats-'));
	const dbPath = join(dir, 'surf.db');
	let clock = 5000;
	let server: GameServer;
	const start = async () =>
		startServer({ port: 0, host: '127.0.0.1', dbPath, maps: [testMap()], playClock: () => clock, log: () => {} });
	const row = (name: string): ScoreRow => server.lobby.scoreRows().find((r) => r.name === name)!;

	before(async () => {
		server = await start();
	});
	after(async () => {
		await server.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('accounts have totals, guests null; logout and a second login behave; shutdown saves', async () => {
		const ana = new TestClient(server.port);
		await ana.hello('Ana');
		const guest = new TestClient(server.port);
		await guest.hello('Guesty');
		assert.deepEqual([row('Ana').playtimeSecs, row('Ana').pointsTotal], [null, null], 'a guest before registering');
		clock += 50_000; // as a guest: not counted
		const reg = await ana.auth('register', 'Ana', 'secret1');
		assert.ok(reg.ok);
		assert.deepEqual([row('Ana').playtimeSecs, row('Ana').pointsTotal], [0, 0]);
		assert.deepEqual([row('Ana').coins, row('Guesty').coins], [100, null], 'the welcome coins');
		server.lobby.economy.adjust(server.db.accountByName('Ana')!.id, -305);
		assert.equal(row('Ana').coins, 69, 'falls at once, rounded down');
		assert.deepEqual(server.lobby.richest(), [{ name: 'Ana', coins: 69, online: true }]);
		const rich = server.db.createAccount('Rich', 'h')!.id;
		server.db.adjustBalance({ accountId: rich, at: 1, reason: 'admin', label: 'x' }, 9000);
		server.db.createAccount('Broke', 'h');
		for (let i = 0; i < 6; i++) server.db.adjustBalance({ accountId: server.db.createAccount(`Mid${i}`, 'h')!.id, at: 1, reason: 'admin', label: 'x' }, 1000 + i * 10);
		const top = await ana.waitFor('scoreboard', (m) => m.richest?.length === 5);
		assert.deepEqual(top.richest!.map((r) => [r.name, r.coins, r.online]), [['Rich', 900, false], ['Mid5', 105, false], ['Mid4', 104, false], ['Mid3', 103, false], ['Mid2', 102, false]]);
		clock += 90_000;
		const sb = await ana.waitFor('scoreboard', (m) => m.rows.some((r) => r.name === 'Ana' && r.playtimeSecs === 90));
		assert.equal(sb.rows.find((r) => r.name === 'Guesty')?.playtimeSecs, null);

		// Second tab with the same account: the first is dropped, time counts once.
		const tab = new TestClient(server.port);
		await tab.hello('x', undefined, reg.ok ? reg.token : undefined);
		clock += 10_000;
		assert.equal(row('Ana').playtimeSecs, 100);
		const accountId = server.db.accountByName('Ana')!.id;
		await ana.until(() => ana.closed);
		assert.equal(server.db.accountStats(accountId).playtimeSecs, 90, 'saved when the first connection was dropped');

		// Spectating is online time too; logout stops the clock.
		tab.send({ type: 'spectate', targetId: -1 });
		clock += 5_000;
		await tab.auth('logout');
		assert.equal(server.db.accountStats(accountId).playtimeSecs, 105);
		clock += 60_000;
		await tab.auth('login', 'Ana', 'secret1');
		clock += 15_000;
		tab.close();
		await sleep(100);
		assert.equal(server.db.accountStats(accountId).playtimeSecs, 120);

		// Shutdown with the player online, then the next server run.
		const again = new TestClient(server.port);
		await again.hello('Ana2');
		await again.auth('login', 'Ana', 'secret1');
		clock += 40_000;
		await server.close();
		clock = 0; // a new process starts a new monotonic clock
		server = await start();
		const back = new TestClient(server.port);
		await back.hello('y');
		await back.auth('login', 'Ana', 'secret1');
		assert.equal(row('Ana').playtimeSecs, 160);
		back.close();
		guest.close();
	});
});
