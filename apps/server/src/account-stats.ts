/**
 * Account totals (docs/gameplay.md#points-and-playtime): time online per
 * account, and the lifetime points (paid by economy.ts). Guests have no totals.
 *
 * Playtime of online accounts is kept in memory and written every
 * PLAYTIME_FLUSH_MS, on disconnect or logout, and at shutdown, so a crash loses
 * at most that interval. An account connected more than once counts once. The
 * clock is monotonic, so a changed system time never adds or removes playtime.
 */
import { performance } from 'node:perf_hooks';
import { POINTS_SCALE } from '@surf/shared';
import type { Db } from './db.ts';

export const PLAYTIME_FLUSH_MS = 60_000;

export interface AccountTotals {
	/** Whole points, rounded down (stored in tenths, docs/economy.md). */
	pointsTotal: number;
	playtimeSecs: number;
}

interface Online {
	/** The account's connections (normally one); empty only while a failed write is retried. */
	conns: Set<object>;
	/** Clock at the last accrual. */
	since: number;
	/** Stored playtime, kept in step with the writes. */
	storedSecs: number;
	/** Counted but not written yet. */
	pendingMs: number;
	/** As stored (tenths). */
	pointsTotal: number;
}

export class AccountStats {
	private readonly online = new Map<number, Online>();

	constructor(
		private readonly db: Pick<Db, 'accountStats' | 'addPlaytime'>,
		private readonly now: () => number = () => performance.now(),
		private readonly log: (msg: string) => void = () => {}
	) {}

	/** A connection is now logged in as this account. */
	join(accountId: number, conn: object): void {
		const o = this.online.get(accountId);
		if (o) {
			if (o.conns.size === 0) o.since = this.now();
			o.conns.add(conn);
			return;
		}
		const row = this.db.accountStats(accountId);
		this.online.set(accountId, {
			conns: new Set([conn]),
			since: this.now(),
			storedSecs: row.playtimeSecs,
			pendingMs: 0,
			pointsTotal: row.pointsTotal
		});
	}

	/** The connection closed or logged out; the account's last one stops and saves its clock. */
	leave(accountId: number, conn: object): void {
		const o = this.online.get(accountId);
		if (!o || !o.conns.delete(conn) || o.conns.size > 0) return;
		this.accrue(o);
		this.flush();
	}

	/** Totals of an online account (playtime up to now), null when it is not online. */
	totals(accountId: number): AccountTotals | null {
		const o = this.online.get(accountId);
		if (!o || o.conns.size === 0) return null;
		const ms = o.pendingMs + Math.max(0, this.now() - o.since);
		return { pointsTotal: Math.floor(o.pointsTotal / POINTS_SCALE), playtimeSecs: o.storedSecs + Math.floor(ms / 1000) };
	}

	/** The account's lifetime points changed (tenths). */
	setPoints(accountId: number, pointsTotal: number): void {
		const o = this.online.get(accountId);
		if (o) o.pointsTotal = pointsTotal;
	}

	private accrue(o: Online): void {
		const now = this.now();
		o.pendingMs += Math.max(0, now - o.since);
		o.since = now;
	}

	/**
	 * Write the whole seconds counted so far (the rest stays pending) and forget
	 * accounts that left. A failed write is logged and tried again next time.
	 */
	flush(): void {
		const due: { accountId: number; secs: number }[] = [];
		for (const [accountId, o] of this.online) {
			if (o.conns.size > 0) this.accrue(o);
			const secs = Math.floor(o.pendingMs / 1000);
			if (secs > 0) due.push({ accountId, secs });
		}
		try {
			if (due.length > 0) this.db.addPlaytime(due);
		} catch (err) {
			this.log(`playtime not saved: ${(err as Error).message}`);
			return;
		}
		for (const d of due) {
			const o = this.online.get(d.accountId)!;
			o.pendingMs -= d.secs * 1000;
			o.storedSecs += d.secs;
		}
		for (const [accountId, o] of this.online) if (o.conns.size === 0) this.online.delete(accountId);
	}

	/** Shutdown: save everyone and stop counting (later `leave`s are ignored). */
	close(): void {
		this.flush();
		this.online.clear();
	}
}
