/**
 * Accounts (docs/architecture.md#accounts): scrypt password hashes, session
 * tokens and the login/register rate limits. Passwords and tokens are never
 * logged; only SHA-256 hashes of tokens are stored.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { awardLabel, normalizeUsername, passwordError, START_COINS, usernameError, usernameKey, WELCOME_REASON } from '@surf/shared';
import type { AccountRow, Db } from './db.ts';

/** scrypt cost (N = 2^14, r = 8, p = 1: ~16 MiB, tens of ms per hash). */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;
export const SESSION_DAYS = 90;
export const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

/** Per minute: failed logins per connection and per username; register attempts per connection. */
export const AUTH_LIMITS = {
	windowMs: 60_000,
	loginFailsPerConnection: 5,
	loginFailsPerUsername: 5,
	registersPerConnection: 3
} as const;

export const WRONG_LOGIN = 'Wrong username or password.';
export const TOO_MANY = 'Too many attempts. Wait a minute and try again.';

function scryptAsync(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number): Promise<Buffer> {
	return new Promise((ok, fail) => {
		scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? fail(err) : ok(key)));
	});
}

/** `scrypt$N$r$p$salt$hash` (base64url salt and hash). */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_BYTES);
	const { N, r, p, keylen } = SCRYPT;
	const key = await scryptAsync(password, salt, N, r, p, keylen);
	return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const parts = stored.split('$');
	if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
	const [N, r, p] = parts.slice(1, 4).map(Number);
	if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 1 << 20) return false;
	const salt = Buffer.from(parts[4], 'base64url');
	const expected = Buffer.from(parts[5], 'base64url');
	if (expected.length === 0) return false;
	const key = await scryptAsync(password, salt, N, r, p, expected.length);
	return timingSafeEqual(key, expected);
}

/** Hash checked when the username does not exist, so a miss costs the same time as a wrong password. */
let dummyHash: Promise<string> | null = null;

export function newToken(): string {
	return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function tokenHash(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Sliding one-minute windows of event timestamps per key. */
export class AttemptLimiter {
	private readonly hits = new Map<string, number[]>();

	constructor(
		private readonly limit: number,
		private readonly windowMs = AUTH_LIMITS.windowMs
	) {}

	private live(key: string, now: number): number[] {
		const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
		if (list.length === 0) this.hits.delete(key);
		else this.hits.set(key, list);
		return list;
	}

	blocked(key: string, now: number): boolean {
		return this.live(key, now).length >= this.limit;
	}

	hit(key: string, now: number): void {
		const list = this.live(key, now);
		list.push(now);
		this.hits.set(key, list);
		if (this.hits.size > 10_000) this.prune(now);
	}

	private prune(now: number): void {
		for (const k of [...this.hits.keys()]) this.live(k, now);
	}
}

export type AuthOutcome = { ok: true; account: AccountRow } | { ok: false; error: string };

/** Account service on top of Db; one instance per lobby. */
export class Accounts {
	/** Failed logins per username (across all connections). */
	private readonly usernameFails = new AttemptLimiter(AUTH_LIMITS.loginFailsPerUsername);

	constructor(
		private readonly db: Db,
		private readonly now: () => number
	) {}

	async register(username: string, password: string): Promise<AuthOutcome> {
		const u = normalizeUsername(username);
		const bad = usernameError(u) ?? passwordError(password);
		if (bad) return { ok: false, error: bad };
		if (this.db.accountByName(u)) return { ok: false, error: 'That username is taken.' };
		const hash = await hashPassword(password);
		const account = this.db.createAccount(u, hash, Date.now(), { reason: WELCOME_REASON, label: awardLabel(WELCOME_REASON), amount: START_COINS });
		if (!account) return { ok: false, error: 'That username is taken.' };
		return { ok: true, account };
	}

	/** `connFails` is the caller's per-connection limiter (checked and updated here). */
	async login(username: string, password: string, connFails: AttemptLimiter): Promise<AuthOutcome> {
		const now = this.now();
		const key = usernameKey(username).slice(0, 256);
		if (connFails.blocked('conn', now) || this.usernameFails.blocked(key, now)) return { ok: false, error: TOO_MANY };
		const fail = (): AuthOutcome => {
			const t = this.now();
			connFails.hit('conn', t);
			this.usernameFails.hit(key, t);
			return { ok: false, error: WRONG_LOGIN };
		};
		if (typeof password !== 'string' || password.length === 0 || password.length > 1024) return fail();
		const account = usernameError(username) ? null : this.db.accountByName(username);
		if (!account) {
			dummyHash ??= hashPassword('dummy password');
			await verifyPassword(password, await dummyHash);
			return fail();
		}
		if (!(await verifyPassword(password, account.passwordHash))) return fail();
		return { ok: true, account };
	}

	/** New 90-day session for an account. The raw token is only sent to the client; the hash is stored. */
	createSession(accountId: number): { token: string; hash: string } {
		const token = newToken();
		const hash = tokenHash(token);
		const now = Date.now();
		this.db.createSession(hash, accountId, now + SESSION_MS, now);
		this.db.touchAccount(accountId, now);
		return { token, hash };
	}

	/** Account for a hello token; null when unknown or expired. */
	resume(token: string): { account: AccountRow; hash: string } | null {
		if (typeof token !== 'string' || token.length === 0 || token.length > 128) return null;
		const hash = tokenHash(token);
		const account = this.db.sessionAccount(hash, Date.now());
		if (!account) return null;
		this.db.touchAccount(account.id, Date.now());
		return { account, hash };
	}

	logout(hash: string): void {
		this.db.deleteSession(hash);
	}
}
