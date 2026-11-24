/**
 * Casino (docs/economy.md#casino): rolls, charges and pays the three games. The
 * odds and rules are in `packages/shared/src/casino.ts`. Only the coin balance
 * changes: no points, no point log, no backstop, no activity.
 */
import { randomInt } from 'node:crypto';
import {
	betError,
	CASINO_MAX_BET,
	CASINO_MIN,
	CASINO_RECENT,
	coinflipPayout,
	crashPayout,
	crashState,
	isCasinoGame,
	isCoinSide,
	isCrashAuto,
	formatTenths,
	pts,
	rollCoin,
	rollCrash,
	rollSlots,
	slotPayout,
	type CasinoEntry,
	type CasinoGame,
	type CasinoOutcome,
	type ClientMessage,
	type RandomSource,
	type ServerMessage
} from '@surf/shared';
import type { Db } from './db.ts';

export interface CasinoPlayer {
	readonly id: number;
	readonly accountId: number | null;
}

export interface CasinoHost<P extends CasinoPlayer> {
	db: Db;
	/** Wall clock (ms): log times. */
	now(): number;
	/** Monotonic clock (ms): crash rounds. */
	clock(): number;
	players(): Iterable<P>;
	send(p: P, msg: ServerMessage): void;
	/** The account's balance changed. */
	balance(accountId: number): void;
	log(msg: string): void;
}

export type CasinoRequest = Extract<ClientMessage, { type: 'casinoBet' | 'crashCashout' }>;

/** Unpredictable, uniform in [0, 1). */
export const secureRandom: RandomSource = () => randomInt(2 ** 40) / 2 ** 40;

/** A result that could not be written is tried again after this long (ms). */
const RETRY_MS = 1000;

const ERRORS = {
	guest: 'Log in to play.',
	busy: 'Too fast. Try again in a moment.',
	poor: 'Not enough coins.',
	whole: 'Bet whole coins.',
	open: 'Your crash round is still running.',
	none: 'No crash round is running.',
	bad: 'Invalid request.',
	failed: 'That did not work. Nothing was taken.'
};

interface CrashRound {
	id: number;
	/** Whole coins. */
	bet: number;
	auto: number | null;
	/** Where it crashes (hundredths): never leaves the server before the end. */
	crash: number;
	startedAt: number;
	/** Decided, but not written yet. */
	result?: { at: number | null; retryAt: number };
}

export class Casino<P extends CasinoPlayer> {
	/** Running crash rounds by account: they go on without a connection. */
	private readonly rounds = new Map<number, CrashRound>();
	/** Bets given back at the start, until the account hears about it. */
	private readonly refunds: Map<number, number>;

	constructor(
		private readonly host: CasinoHost<P>,
		private readonly rand: RandomSource = secureRandom
	) {
		// Rounds that were open when the server stopped.
		this.refunds = host.db.refundCrashes();
		if (this.refunds.size > 0) host.log(`casino: ${this.refunds.size} open crash bets given back`);
	}

	/** Limits, results and a running round (on join, login and logout). */
	send(p: P): void {
		const { db } = this.host;
		const id = p.accountId;
		const round = id === null ? undefined : this.rounds.get(id);
		this.host.send(p, {
			type: 'casino',
			min: CASINO_MIN,
			max: CASINO_MAX_BET,
			net: id === null ? 0 : db.casinoNet(id),
			recent: id === null ? [] : db.recentCasino(id, CASINO_RECENT).filter((r): r is CasinoEntry => isCasinoGame(r.game)),
			...(round ? { crash: { bet: pts(round.bet), auto: round.auto, elapsed: this.host.clock() - round.startedAt } } : {})
		});
		const refund = id === null ? undefined : this.refunds.get(id);
		if (id === null || refund === undefined) return;
		this.refunds.delete(id);
		this.host.send(p, { type: 'coinsNotice', text: `The server restarted: your crash bet of ${formatTenths(refund)} coins was given back.`, tone: 'info' });
	}

	/** `busy`: over the rate limit, refuse. */
	handle(p: P, msg: CasinoRequest, busy = false): void {
		const game = msg.type === 'crashCashout' ? 'crash' : isCasinoGame(msg.game) ? msg.game : null;
		const fail = (error: string) => this.host.send(p, { type: 'casinoResult', ok: false, game, error });
		if (game === null) return fail(ERRORS.bad);
		if (busy) return fail(ERRORS.busy);
		if (p.accountId === null) return fail(ERRORS.guest);
		let error: string | null;
		try {
			error = msg.type === 'crashCashout' ? this.cashout(p.accountId) : this.bet(p, p.accountId, game, msg);
		} catch (err) {
			this.host.log(`casino ${game} for account ${p.accountId} failed: ${(err as Error).message}`);
			error = ERRORS.failed;
		}
		if (error !== null) fail(error);
	}

	private bet(p: P, accountId: number, game: CasinoGame, msg: Extract<CasinoRequest, { type: 'casinoBet' }>): string | null {
		const bet: unknown = msg.bet;
		const bad = betError(game, bet);
		if (bad === 'whole') return ERRORS.whole;
		if (bad === 'min') return `The smallest bet is ${CASINO_MIN[game]} ${CASINO_MIN[game] === 1 ? 'coin' : 'coins'}.`;
		if (bad === 'max') return `The largest bet is ${CASINO_MAX_BET} coins.`;
		const coins = bet as number;
		const stake = { bet: pts(coins) };
		if (msg.game === 'crash') return this.startCrash(p, accountId, coins, msg.auto ?? null);
		if (msg.game === 'coinflip') {
			const picked: unknown = msg.side;
			if (!isCoinSide(picked)) return ERRORS.bad;
			const side = rollCoin(this.rand);
			return this.play(p, accountId, { game: 'coinflip', ...stake, payout: coinflipPayout(coins, picked, side), picked, side });
		}
		const reels = rollSlots(this.rand);
		return this.play(p, accountId, { game: 'slots', ...stake, payout: slotPayout(coins, reels), reels });
	}

	/** Charge and pay a bet that is decided at once. */
	private play(p: P, accountId: number, o: CasinoOutcome): string | null {
		const { db } = this.host;
		if (!db.casinoPlay(accountId, { at: this.host.now(), game: o.game, bet: o.bet, payout: o.payout })) return ERRORS.poor;
		this.host.balance(accountId);
		this.host.send(p, { type: 'casinoResult', ok: true, net: db.casinoNet(accountId), ...o });
		return null;
	}

	// -----------------------------------------------------------------------
	// Crash

	private startCrash(p: P, accountId: number, bet: number, auto: unknown): string | null {
		if (!isCrashAuto(auto)) return ERRORS.bad;
		if (this.rounds.has(accountId)) return ERRORS.open;
		const id = this.host.db.crashOpen(accountId, this.host.now(), pts(bet));
		if (typeof id === 'string') return ERRORS[id];
		this.rounds.set(accountId, { id, bet, auto, crash: rollCrash(this.rand), startedAt: this.host.clock() });
		this.host.balance(accountId);
		this.host.send(p, { type: 'crashStart', bet: pts(bet), auto });
		return null;
	}

	private cashout(accountId: number): string | null {
		const round = this.rounds.get(accountId);
		if (!round || round.result) return ERRORS.none;
		this.advance(accountId, round, true);
		return null;
	}

	/** End rounds that crashed or reached their automatic cash-out (call often). */
	tick(): void {
		for (const [accountId, round] of this.rounds) this.advance(accountId, round, false);
	}

	private advance(accountId: number, round: CrashRound, cashout: boolean): void {
		const clock = this.host.clock();
		if (!round.result) {
			const s = crashState(round.crash, round.auto, clock - round.startedAt, cashout);
			if (s === 'running') return;
			round.result = { at: s === 'crashed' ? null : s.at, retryAt: clock };
		}
		if (clock < round.result.retryAt) return;
		const { at } = round.result;
		const payout = at === null ? 0 : crashPayout(round.bet, at);
		try {
			// Not open any more (given back by another process): nothing is paid.
			if (!this.host.db.crashClose(round.id, this.host.now(), payout)) {
				this.rounds.delete(accountId);
				this.host.log(`casino: crash round of account ${accountId} was already closed`);
				for (const p of this.host.players()) if (p.accountId === accountId) this.send(p);
				return;
			}
		} catch (err) {
			round.result.retryAt = clock + RETRY_MS;
			this.host.log(`casino: crash result for account ${accountId} not saved: ${(err as Error).message}`);
			return;
		}
		this.rounds.delete(accountId);
		this.host.balance(accountId);
		const net = this.host.db.casinoNet(accountId);
		for (const p of this.host.players()) {
			if (p.accountId !== accountId) continue;
			this.host.send(p, { type: 'casinoResult', ok: true, net, game: 'crash', bet: pts(round.bet), payout, at, crash: round.crash });
		}
	}
}
