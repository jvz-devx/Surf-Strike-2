/**
 * Abuse and collusion detection (docs/economy.md#abuse-and-collusion): strikes
 * per account, decay, private warning with an award pause, and a short ban.
 * Pure bookkeeping with an injected clock; economy.ts finds the signals and
 * the lobby carries out warnings and bans.
 *
 * Deliberately slow: one event never bans, weight-1 signals repeat at most as
 * fast as strikes decay (so alone they never even warn), a ban needs an
 * earlier warning and signals from two rounds or of two kinds.
 */
import { ABUSE, type AbuseSignal } from '@surf/shared';

export interface SignalReport {
	signal: AbuseSignal;
	/** Round the signal belongs to (any id that differs between rounds). */
	round: number;
	/** Accounts that get strikes, with their weight (default: the signal's). */
	accounts: readonly { accountId: number; weight?: number }[];
	/** Account ids of everyone involved (awards between them are paused). */
	involved: readonly number[];
	/** Short, without personal data. */
	evidence: string;
}

export interface AbuseHost {
	now(): number;
	isAdmin(accountId: number): boolean;
	/** Private warning; awards are paused for `ABUSE.pauseMs`. */
	warn(accountId: number, strikes: number, evidence: string): void;
	/** Ban for `ABUSE.banMs`. `exempt`: an admin, only to be logged. */
	ban(accountId: number, strikes: number, evidence: string, exempt: boolean): void;
}

interface Suspect {
	strikes: number;
	/** Strikes drop at the next full `decayMs` after this. */
	decayFrom: number;
	warnedAt: number | null;
	pausedUntil: number;
	/** Signals of the current episode. */
	seen: { signal: AbuseSignal; round: number; at: number; evidence: string }[];
}

const pairKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

export class AbuseEngine {
	private readonly suspects = new Map<number, Suspect>();
	/** Signal + account → last time it counted. */
	private readonly last = new Map<string, number>();
	/** Account pairs whose awards from each other are paused. */
	private readonly pairs = new Map<string, number>();

	constructor(private readonly host: AbuseHost) {}

	/** Current strikes of an account. */
	strikes(accountId: number): number {
		const s = this.suspects.get(accountId);
		if (!s) return 0;
		this.decay(s);
		return s.strikes;
	}

	/** Are this account's awards (those earned against `against`, when given) paused? */
	paused(accountId: number, against: number | null = null): boolean {
		const now = this.host.now();
		if ((this.suspects.get(accountId)?.pausedUntil ?? -Infinity) > now) return true;
		return against !== null && (this.pairs.get(pairKey(accountId, against)) ?? -Infinity) > now;
	}

	report(r: SignalReport): void {
		const now = this.host.now();
		for (const a of r.accounts) {
			const key = `${r.signal}|${a.accountId}`;
			if (now - (this.last.get(key) ?? -Infinity) < ABUSE.cooldownMs[r.signal]) continue;
			this.last.set(key, now);
			this.strike(a.accountId, a.weight ?? ABUSE.weight[r.signal], r, now);
		}
	}

	private decay(s: Suspect): void {
		const now = this.host.now();
		const n = Math.floor((now - s.decayFrom) / ABUSE.decayMs);
		if (n <= 0) return;
		s.decayFrom += n * ABUSE.decayMs;
		s.strikes = Math.max(0, s.strikes - n);
		if (s.strikes < ABUSE.warnAt) s.warnedAt = null;
		if (s.strikes === 0) s.seen = [];
	}

	private strike(accountId: number, weight: number, r: SignalReport, now: number): void {
		let s = this.suspects.get(accountId);
		if (!s) this.suspects.set(accountId, (s = { strikes: 0, decayFrom: now, warnedAt: null, pausedUntil: -Infinity, seen: [] }));
		this.decay(s);
		if (s.strikes === 0) s.decayFrom = now;
		s.strikes += weight;
		s.seen.push({ signal: r.signal, round: r.round, at: now, evidence: r.evidence });
		if (s.seen.length > 20) s.seen.shift();
		const evidence = s.seen.map((e) => `${e.signal} (round ${e.round}): ${e.evidence}`).join('; ');
		const varied = new Set(s.seen.map((e) => e.round)).size >= 2 || new Set(s.seen.map((e) => e.signal)).size >= 2;
		if (s.strikes >= ABUSE.banAt && s.warnedAt !== null && now - s.warnedAt >= ABUSE.warnLeadMs && varied) {
			const strikes = s.strikes;
			s.strikes = ABUSE.afterBan;
			s.decayFrom = now + ABUSE.banMs;
			s.warnedAt = null;
			s.seen = [];
			this.host.ban(accountId, strikes, evidence, this.host.isAdmin(accountId));
			return;
		}
		if (s.strikes < ABUSE.warnAt || s.warnedAt !== null) return;
		s.warnedAt = now;
		s.pausedUntil = now + ABUSE.pauseMs;
		for (const o of r.involved) if (o !== accountId) this.pairs.set(pairKey(accountId, o), now + ABUSE.pauseMs);
		this.host.warn(accountId, s.strikes, evidence);
	}

	/** Forget what no longer matters (call now and then). */
	prune(): void {
		const now = this.host.now();
		for (const [id, s] of this.suspects) {
			this.decay(s);
			if (s.strikes === 0 && s.pausedUntil <= now) this.suspects.delete(id);
		}
		for (const [k, t] of this.pairs) if (t <= now) this.pairs.delete(k);
		for (const [k, t] of this.last) if (now - t > ABUSE.decayMs) this.last.delete(k);
	}
}
