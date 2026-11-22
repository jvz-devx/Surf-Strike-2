/**
 * SQLite storage (docs/gameplay.md#personal-bests-and-leaderboard).
 *
 * - `accounts` / `sessions`: username + scrypt password hash, and SHA-256
 *   hashes of session tokens (docs/architecture.md#accounts).
 * - `account_runs`: the leaderboard. Only each account's best run per map is
 *   kept; guests never get rows here.
 * - `players`: guest bookkeeping (localStorage UUID, last name, last seen).
 * - `replays`: record ghosts (docs/gameplay.md#ghosts), one row per map: the
 *   fastest validated account run recorded by the server, deflate-raw packed.
 * - `map_settings`, `bans`, `admin_log`: admin menu state (docs/gameplay.md#admin):
 *   disabled maps, account / guest bans, and an audit log of admin actions.
 * - `runs`: legacy guest runs keyed by the localStorage UUID (and timed at
 *   the old 128 tick). Kept untouched for reference, never read or written.
 *
 * Every table is created with CREATE TABLE IF NOT EXISTS, so an existing
 * database migrates in place on start-up without losing data.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { usernameKey } from '@surf/shared';

export interface RunRow {
	accountId: number;
	name: string;
	ticks: number;
	splits: number[];
	createdAt: number;
}

export interface SaveResult {
	/** True when the run replaced (or created) the account's PB. */
	pb: boolean;
	/** Previous PB ticks, null if none. */
	previous: number | null;
}

export interface ReplayRow {
	accountId: number;
	name: string;
	ticks: number;
	samples: number;
	/** Deflate-raw compressed packGhost() track. */
	data: Buffer;
	createdAt: number;
}

export interface BanRow {
	id: number;
	accountId: number | null;
	playerKey: string | null;
	ip: string | null;
	usernameSnapshot: string;
	reason: string | null;
	createdAt: number;
	createdBy: string;
}

export interface AccountRow {
	id: number;
	username: string;
	passwordHash: string;
}

export class Db {
	readonly db: Database.Database;
	private readonly st: ReturnType<Db['prepare']>;

	constructor(path: string) {
		if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
		this.db = new Database(path);
		this.db.pragma('journal_mode = WAL');
		this.db.pragma('foreign_keys = ON');
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS players (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				first_seen INTEGER NOT NULL,
				last_seen INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS runs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				player_id TEXT NOT NULL REFERENCES players(id),
				map TEXT NOT NULL,
				time_ticks INTEGER NOT NULL,
				splits_json TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				UNIQUE (player_id, map)
			);
			CREATE INDEX IF NOT EXISTS runs_map_time ON runs (map, time_ticks);
			CREATE TABLE IF NOT EXISTS accounts (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				username TEXT NOT NULL,
				username_lower TEXT NOT NULL UNIQUE,
				password_hash TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				last_login INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS sessions (
				token_hash TEXT PRIMARY KEY,
				account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account_id);
			CREATE TABLE IF NOT EXISTS account_runs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				map TEXT NOT NULL,
				time_ticks INTEGER NOT NULL,
				splits_json TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				UNIQUE (account_id, map)
			);
			CREATE INDEX IF NOT EXISTS account_runs_map_time ON account_runs (map, time_ticks);
			CREATE TABLE IF NOT EXISTS replays (
				map TEXT PRIMARY KEY,
				account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				time_ticks INTEGER NOT NULL,
				samples INTEGER NOT NULL,
				data BLOB NOT NULL,
				created_at INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS map_settings (
				map_id TEXT PRIMARY KEY,
				enabled INTEGER NOT NULL DEFAULT 1
			);
			CREATE TABLE IF NOT EXISTS bans (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
				player_key TEXT,
				ip TEXT,
				username_snapshot TEXT NOT NULL,
				reason TEXT,
				created_at INTEGER NOT NULL,
				created_by TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS bans_account ON bans (account_id);
			CREATE INDEX IF NOT EXISTS bans_player_key ON bans (player_key);
			CREATE INDEX IF NOT EXISTS bans_ip ON bans (ip);
			CREATE TABLE IF NOT EXISTS admin_log (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				created_at INTEGER NOT NULL,
				admin_account_id INTEGER,
				admin_username TEXT NOT NULL,
				action TEXT NOT NULL,
				target TEXT,
				detail TEXT
			);
		`);
		this.st = this.prepare();
	}

	private prepare() {
		const d = this.db;
		return {
			upsertPlayer: d.prepare(
				`INSERT INTO players (id, name, first_seen, last_seen) VALUES (?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen`
			),
			rename: d.prepare(`UPDATE players SET name = ? WHERE id = ?`),
			touch: d.prepare(`UPDATE players SET last_seen = ? WHERE id = ?`),

			insertAccount: d.prepare(
				`INSERT INTO accounts (username, username_lower, password_hash, created_at, last_login) VALUES (?, ?, ?, ?, ?)`
			),
			accountByKey: d.prepare(`SELECT id, username, password_hash FROM accounts WHERE username_lower = ?`),
			accountById: d.prepare(`SELECT id, username, password_hash FROM accounts WHERE id = ?`),
			touchAccount: d.prepare(`UPDATE accounts SET last_login = ? WHERE id = ?`),
			insertSession: d.prepare(`INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)`),
			session: d.prepare(
				`SELECT a.id, a.username, a.password_hash, s.expires_at
				 FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?`
			),
			deleteSession: d.prepare(`DELETE FROM sessions WHERE token_hash = ?`),
			pruneSessions: d.prepare(`DELETE FROM sessions WHERE expires_at <= ?`),

			getPb: d.prepare(`SELECT time_ticks, splits_json, created_at FROM account_runs WHERE account_id = ? AND map = ?`),
			upsertRun: d.prepare(
				`INSERT INTO account_runs (account_id, map, time_ticks, splits_json, created_at) VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(account_id, map) DO UPDATE SET
					time_ticks = excluded.time_ticks,
					splits_json = excluded.splits_json,
					created_at = excluded.created_at
				 WHERE excluded.time_ticks < account_runs.time_ticks`
			),
			rankOf: d.prepare(`SELECT COUNT(*) AS n FROM account_runs WHERE map = ? AND time_ticks < ?`),
			count: d.prepare(`SELECT COUNT(*) AS n FROM account_runs WHERE map = ?`),
			top: d.prepare(
				`SELECT r.account_id, a.username, r.time_ticks, r.splits_json, r.created_at
				 FROM account_runs r JOIN accounts a ON a.id = r.account_id
				 WHERE r.map = ? ORDER BY r.time_ticks ASC, r.created_at ASC LIMIT ?`
			),
			getReplay: d.prepare(
				`SELECT r.account_id, a.username, r.time_ticks, r.samples, r.data, r.created_at
				 FROM replays r JOIN accounts a ON a.id = r.account_id WHERE r.map = ?`
			),
			upsertReplay: d.prepare(
				`INSERT INTO replays (map, account_id, time_ticks, samples, data, created_at) VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(map) DO UPDATE SET
					account_id = excluded.account_id,
					time_ticks = excluded.time_ticks,
					samples = excluded.samples,
					data = excluded.data,
					created_at = excluded.created_at
				 WHERE excluded.time_ticks < replays.time_ticks`
			),
			ranks: d.prepare(
				`SELECT account_id, time_ticks FROM account_runs WHERE map = ? ORDER BY time_ticks ASC, created_at ASC`
			),

			disabledMaps: d.prepare(`SELECT map_id FROM map_settings WHERE enabled = 0`),
			setMapEnabled: d.prepare(
				`INSERT INTO map_settings (map_id, enabled) VALUES (?, ?) ON CONFLICT(map_id) DO UPDATE SET enabled = excluded.enabled`
			),
			insertBan: d.prepare(
				`INSERT INTO bans (account_id, player_key, ip, username_snapshot, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`
			),
			deleteBan: d.prepare(`DELETE FROM bans WHERE id = ?`),
			banById: d.prepare(`SELECT * FROM bans WHERE id = ?`),
			listBans: d.prepare(`SELECT * FROM bans ORDER BY created_at DESC, id DESC`),
			banForAccount: d.prepare(`SELECT * FROM bans WHERE account_id = ? ORDER BY id LIMIT 1`),
			banForGuest: d.prepare(
				`SELECT * FROM bans WHERE (player_key IS NOT NULL AND player_key = ?) OR (ip IS NOT NULL AND ip = ?) ORDER BY id LIMIT 1`
			),
			insertAdminLog: d.prepare(
				`INSERT INTO admin_log (created_at, admin_account_id, admin_username, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)`
			)
		};
	}

	// -----------------------------------------------------------------------
	// Guests

	upsertPlayer(id: string, name: string, now = Date.now()): void {
		this.st.upsertPlayer.run(id, name, now, now);
	}

	rename(id: string, name: string): void {
		this.st.rename.run(name, id);
	}

	touch(id: string, now = Date.now()): void {
		this.st.touch.run(now, id);
	}

	// -----------------------------------------------------------------------
	// Accounts and sessions (validation and hashing live in auth.ts)

	/** Create an account; null if the username is taken (case-insensitive). */
	createAccount(username: string, passwordHash: string, now = Date.now()): AccountRow | null {
		try {
			const r = this.st.insertAccount.run(username, usernameKey(username), passwordHash, now, now);
			return { id: Number(r.lastInsertRowid), username, passwordHash };
		} catch (err) {
			if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') return null;
			throw err;
		}
	}

	accountByName(username: string): AccountRow | null {
		return toAccount(this.st.accountByKey.get(usernameKey(username)));
	}

	accountById(id: number): AccountRow | null {
		return toAccount(this.st.accountById.get(id));
	}

	touchAccount(id: number, now = Date.now()): void {
		this.st.touchAccount.run(now, id);
	}

	createSession(tokenHash: string, accountId: number, expiresAt: number, now = Date.now()): void {
		this.st.pruneSessions.run(now);
		this.st.insertSession.run(tokenHash, accountId, now, expiresAt);
	}

	/** Account of a live session; expired sessions are deleted and return null. */
	sessionAccount(tokenHash: string, now = Date.now()): AccountRow | null {
		const r = this.st.session.get(tokenHash) as
			| { id: number; username: string; password_hash: string; expires_at: number }
			| undefined;
		if (!r) return null;
		if (r.expires_at <= now) {
			this.st.deleteSession.run(tokenHash);
			return null;
		}
		return toAccount(r);
	}

	deleteSession(tokenHash: string): void {
		this.st.deleteSession.run(tokenHash);
	}

	// -----------------------------------------------------------------------
	// Leaderboard (accounts only)

	getPb(accountId: number, map: string): { ticks: number; splits: number[]; createdAt: number } | null {
		const r = this.st.getPb.get(accountId, map) as
			| { time_ticks: number; splits_json: string; created_at: number }
			| undefined;
		if (!r) return null;
		return { ticks: r.time_ticks, splits: parseSplits(r.splits_json), createdAt: r.created_at };
	}

	/** Save if better than the account's PB. */
	saveRun(accountId: number, map: string, ticks: number, splits: number[], now = Date.now()): SaveResult {
		return this.db.transaction(() => {
			const prev = this.getPb(accountId, map);
			if (prev && prev.ticks <= ticks) return { pb: false, previous: prev.ticks };
			this.st.upsertRun.run(accountId, map, ticks, JSON.stringify(splits), now);
			return { pb: true, previous: prev?.ticks ?? null };
		})();
	}

	/** 1-based rank a time would have on the map (ties share the better rank). */
	rankFor(map: string, ticks: number): number {
		return (this.st.rankOf.get(map, ticks) as { n: number }).n + 1;
	}

	countRuns(map: string): number {
		return (this.st.count.get(map) as { n: number }).n;
	}

	top(map: string, limit = 10): RunRow[] {
		const rows = this.st.top.all(map, limit) as Array<{
			account_id: number;
			username: string;
			time_ticks: number;
			splits_json: string;
			created_at: number;
		}>;
		return rows.map((r) => ({
			accountId: r.account_id,
			name: r.username,
			ticks: r.time_ticks,
			splits: parseSplits(r.splits_json),
			createdAt: r.created_at
		}));
	}

	/** account id -> { rank, ticks } for a map. */
	ranks(map: string): Map<number, { rank: number; ticks: number }> {
		const rows = this.st.ranks.all(map) as Array<{ account_id: number; time_ticks: number }>;
		const out = new Map<number, { rank: number; ticks: number }>();
		let rank = 0;
		let prevTicks = -1;
		rows.forEach((r, i) => {
			if (r.time_ticks !== prevTicks) rank = i + 1;
			prevTicks = r.time_ticks;
			out.set(r.account_id, { rank, ticks: r.time_ticks });
		});
		return out;
	}

	// -----------------------------------------------------------------------
	// Record ghosts (docs/gameplay.md#ghosts)

	/** The map's record ghost, or null. */
	getReplay(map: string): ReplayRow | null {
		const r = this.st.getReplay.get(map) as
			| { account_id: number; username: string; time_ticks: number; samples: number; data: Buffer; created_at: number }
			| undefined;
		if (!r) return null;
		return { accountId: r.account_id, name: r.username, ticks: r.time_ticks, samples: r.samples, data: r.data, createdAt: r.created_at };
	}

	/** Store a run's replay if it is faster than the map's stored ghost; true when stored. */
	saveReplay(map: string, accountId: number, ticks: number, samples: number, data: Uint8Array, now = Date.now()): boolean {
		return this.st.upsertReplay.run(map, accountId, ticks, samples, Buffer.from(data), now).changes > 0;
	}

	// -----------------------------------------------------------------------
	// Admin (docs/gameplay.md#admin)

	/** Map ids an admin disabled (every other map is enabled). */
	disabledMaps(): Set<string> {
		return new Set((this.st.disabledMaps.all() as Array<{ map_id: string }>).map((r) => r.map_id));
	}

	setMapEnabled(mapId: string, enabled: boolean): void {
		this.st.setMapEnabled.run(mapId, enabled ? 1 : 0);
	}

	addBan(ban: Omit<BanRow, 'id'>): BanRow {
		const r = this.st.insertBan.run(
			ban.accountId,
			ban.playerKey,
			ban.ip,
			ban.usernameSnapshot,
			ban.reason,
			ban.createdAt,
			ban.createdBy
		);
		return { id: Number(r.lastInsertRowid), ...ban };
	}

	/** The removed ban, or null when there was none. */
	removeBan(id: number): BanRow | null {
		const row = toBan(this.st.banById.get(id));
		if (row) this.st.deleteBan.run(id);
		return row;
	}

	bans(): BanRow[] {
		return (this.st.listBans.all() as unknown[]).map((r) => toBan(r)!);
	}

	accountBan(accountId: number): BanRow | null {
		return toBan(this.st.banForAccount.get(accountId));
	}

	/** A ban on this player key or IP (either may be null). */
	guestBan(playerKey: string | null, ip: string | null): BanRow | null {
		if (!playerKey && !ip) return null;
		return toBan(this.st.banForGuest.get(playerKey, ip));
	}

	logAdmin(
		admin: { accountId: number | null; username: string },
		action: string,
		target: string | null,
		detail: string | null,
		now = Date.now()
	): void {
		this.st.insertAdminLog.run(now, admin.accountId, admin.username, action, target, detail);
	}

	close(): void {
		this.db.close();
	}
}

function toBan(r: unknown): BanRow | null {
	if (!r) return null;
	const b = r as {
		id: number;
		account_id: number | null;
		player_key: string | null;
		ip: string | null;
		username_snapshot: string;
		reason: string | null;
		created_at: number;
		created_by: string;
	};
	return {
		id: b.id,
		accountId: b.account_id,
		playerKey: b.player_key,
		ip: b.ip,
		usernameSnapshot: b.username_snapshot,
		reason: b.reason,
		createdAt: b.created_at,
		createdBy: b.created_by
	};
}

function toAccount(r: unknown): AccountRow | null {
	if (!r) return null;
	const a = r as { id: number; username: string; password_hash: string };
	return { id: a.id, username: a.username, passwordHash: a.password_hash };
}

function parseSplits(json: string): number[] {
	try {
		const v = JSON.parse(json);
		return Array.isArray(v) ? v.filter((n) => typeof n === 'number') : [];
	} catch {
		return [];
	}
}
