import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { Accounts, AttemptLimiter, hashPassword, tokenHash, verifyPassword, WRONG_LOGIN } from './auth.ts';
import { Db } from './db.ts';

describe('Db', () => {
	it('keeps only the best run per account per map', () => {
		const db = new Db(':memory:');
		const a = db.createAccount('Alice', 'h', 1)!.id;
		const b = db.createAccount('Bob', 'h', 1)!.id;
		assert.deepEqual(db.saveRun(a, 'm', 1000, [400], 10), { pb: true, previous: null });
		assert.deepEqual(db.saveRun(a, 'm', 1200, [500], 11), { pb: false, previous: 1000 });
		assert.deepEqual(db.saveRun(a, 'm', 900, [300], 12), { pb: true, previous: 1000 });
		assert.deepEqual(db.getPb(a, 'm'), { ticks: 900, splits: [300], createdAt: 12 });
		db.saveRun(b, 'm', 950, [], 13);
		db.saveRun(b, 'other', 10, [], 13);
		assert.equal(db.countRuns('m'), 2);
		assert.deepEqual(
			db.top('m').map((r) => [r.name, r.ticks]),
			[
				['Alice', 900],
				['Bob', 950]
			]
		);
		assert.equal(db.rankFor('m', 900), 1);
		assert.equal(db.rankFor('m', 920), 2);
		assert.equal(db.rankFor('m', 2000), 3);
		assert.deepEqual([...db.ranks('m')], [
			[a, { rank: 1, ticks: 900 }],
			[b, { rank: 2, ticks: 950 }]
		]);
		const rows = db.db.prepare('SELECT COUNT(*) AS n FROM account_runs').get() as { n: number };
		assert.equal(rows.n, 3);
		db.close();
	});

	it('usernames are unique case-insensitively and keep their casing', () => {
		const db = new Db(':memory:');
		assert.ok(db.createAccount('Alice', 'h'));
		assert.equal(db.createAccount('aLICE', 'h'), null);
		assert.equal(db.accountByName('ALICE')?.username, 'Alice');
		db.close();
	});

	it('sessions expire and can be deleted', () => {
		const db = new Db(':memory:');
		const id = db.createAccount('Sess', 'h')!.id;
		db.createSession('t1', id, 2000, 1000);
		assert.equal(db.sessionAccount('t1', 1500)?.id, id);
		assert.equal(db.sessionAccount('t1', 2000), null);
		assert.equal(db.sessionAccount('t1', 1500), null, 'expired session was deleted');
		db.createSession('t2', id, 5000, 1000);
		db.deleteSession('t2');
		assert.equal(db.sessionAccount('t2', 1500), null);
		db.close();
	});

	it('migrates an existing database in place; legacy guest runs are kept but not on the leaderboard', () => {
		const dir = mkdtempSync(join(tmpdir(), 'surf-db-'));
		const path = join(dir, 'surf.db');
		try {
			const old = new Database(path);
			old.exec(`
				CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL);
				CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL REFERENCES players(id),
					map TEXT NOT NULL, time_ticks INTEGER NOT NULL, splits_json TEXT NOT NULL, created_at INTEGER NOT NULL,
					UNIQUE (player_id, map));
				INSERT INTO players VALUES ('legacy-uuid', 'Old', 1, 1);
				INSERT INTO runs (player_id, map, time_ticks, splits_json, created_at) VALUES ('legacy-uuid', 'm', 5, '[]', 1);
			`);
			old.close();
			const db = new Db(path);
			assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n, 1);
			assert.deepEqual(db.top('m'), []);
			assert.equal(db.countRuns('m'), 0);
			db.close();
			// Opening again is a no-op.
			new Db(path).close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('auth', () => {
	it('scrypt hashes verify, use a per-user salt and reject wrong passwords', async () => {
		const h1 = await hashPassword('hunter22');
		const h2 = await hashPassword('hunter22');
		assert.match(h1, /^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
		assert.notEqual(h1, h2);
		assert.equal(await verifyPassword('hunter22', h1), true);
		assert.equal(await verifyPassword('hunter23', h1), false);
		assert.equal(await verifyPassword('hunter22', 'garbage'), false);
	});

	it('register/login/resume/logout', async () => {
		const db = new Db(':memory:');
		const acc = new Accounts(db, () => 0);
		assert.deepEqual(await acc.register('has space', 'secret'), { ok: false, error: 'Username cannot contain spaces.' });
		assert.deepEqual(await acc.register('Neo', '1234'), { ok: false, error: 'Password must be at least 5 characters.' });
		const reg = await acc.register('Neo', 'secret');
		assert.equal(reg.ok, true);
		assert.deepEqual(await acc.register('NEO', 'other1'), { ok: false, error: 'That username is taken.' });
		const fails = new AttemptLimiter(5);
		assert.deepEqual(await acc.login('neo', 'wrong!', fails), { ok: false, error: WRONG_LOGIN });
		assert.deepEqual(await acc.login('nobody', 'secret', fails), { ok: false, error: WRONG_LOGIN });
		const ok = await acc.login('nEo', 'secret', fails);
		assert.ok(ok.ok && ok.account.username === 'Neo');
		const s = acc.createSession(ok.account.id);
		assert.equal(s.hash, tokenHash(s.token));
		const stored = db.db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
		assert.deepEqual(stored.map((r) => r.token_hash), [s.hash], 'only the token hash is stored');
		assert.equal(acc.resume(s.token)?.account.username, 'Neo');
		assert.equal(acc.resume('nope'), null);
		acc.logout(s.hash);
		assert.equal(acc.resume(s.token), null);
		db.close();
	});

	it('attempt limiter uses a sliding one-minute window', () => {
		const l = new AttemptLimiter(2);
		l.hit('k', 0);
		l.hit('k', 30_000);
		assert.equal(l.blocked('k', 59_999), true);
		assert.equal(l.blocked('k', 60_000), false);
		assert.equal(l.blocked('other', 0), false);
	});
});
