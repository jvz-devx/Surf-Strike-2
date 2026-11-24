/** Casino on the client (docs/ui.md#casino), pure and unit-tested: server messages in, what the menu shows out. */
import {
	CASINO_GAMES,
	CASINO_MAX_BET,
	CASINO_MIN,
	CASINO_RECENT,
	CRASH,
	crashCurve,
	formatTenths,
	isCasinoGame,
	isCrashAuto,
	POINTS_SCALE,
	rollSlots,
	SLOT_SYMBOLS,
	slotSymbol,
	slotWin,
	type CasinoEntry,
	type CasinoGame,
	type CasinoOutcome,
	type RandomSource,
	type ServerMessage,
	type SlotSymbolId
} from '@surf/shared';
import type { CasinoView } from './contract.js';

/** A `casino` message of any server version. `baseline`: the net when the session began; `old`: what was shown before. */
export function parseCasino(m: Extract<ServerMessage, { type: 'casino' }>, now: number, baseline: number, old: CasinoView | null = null): CasinoView {
	const min = { ...CASINO_MIN };
	for (const g of CASINO_GAMES) if (Number.isInteger(m.min?.[g]) && m.min[g] > 0) min[g] = m.min[g];
	const recent = Array.isArray(m.recent) ? m.recent.filter((r) => r && isCasinoGame(r.game) && Number.isFinite(r.bet) && Number.isFinite(r.payout)) : [];
	const c = m.crash;
	return {
		min,
		max: Number.isInteger(m.max) && m.max > 0 ? m.max : CASINO_MAX_BET,
		net: Number(m.net) || 0,
		baseline,
		recent,
		crash: c && Number.isFinite(c.elapsed) ? { bet: c.bet, auto: c.auto, startedAt: now - c.elapsed } : null,
		last: old?.last ?? null,
		busy: false,
		error: null
	};
}

export function crashStarted(v: CasinoView, m: { bet: number; auto: number | null }, now: number): CasinoView {
	return { ...v, busy: false, error: null, crash: { bet: m.bet, auto: m.auto, startedAt: now } };
}

export function casinoResult(v: CasinoView, m: { net: number } & CasinoOutcome, at: number): CasinoView {
	const entry: CasinoEntry = { at, game: m.game, bet: m.bet, payout: m.payout };
	return {
		...v,
		// The end of a crash round is no answer to another bet.
		busy: m.game === 'crash' && !v.crash ? v.busy : false,
		error: null,
		net: m.net,
		crash: m.game === 'crash' ? null : v.crash,
		recent: [entry, ...v.recent].slice(0, CASINO_RECENT),
		last: { n: (v.last?.n ?? 0) + 1, outcome: m }
	};
}

export function casinoError(v: CasinoView, text: string): CasinoView {
	return { ...v, busy: false, error: { n: (v.error?.n ?? 0) + 1, text } };
}

// ---------------------------------------------------------------------------
// Bets

export interface BetLimits {
	min: number;
	max: number;
	/** Tenths. */
	balance: number;
}

/** Whole coins of the bet box, or null. */
export function parseBet(text: string | number | null | undefined): number | null {
	const s = String(text ?? '').trim();
	return /^\d{1,6}$/.test(s) ? Number(s) : null;
}

/** Why this bet cannot be placed, for display; null: it can. */
export function betHint(bet: number | null, l: BetLimits): string | null {
	if (bet === null) return 'Bet whole coins.';
	if (bet < l.min) return `The smallest bet is ${l.min} ${l.min === 1 ? 'coin' : 'coins'}.`;
	if (bet > l.max) return `The largest bet is ${l.max} coins.`;
	if (bet * POINTS_SCALE > l.balance) return `You have ${formatTenths(Math.max(0, l.balance))} coins.`;
	return null;
}

/** The quick buttons: always a whole bet inside the limits, never more than the balance allows (but at least the minimum). */
export function quickBet(kind: 'min' | 'half' | 'double' | 'max', bet: number | null, l: BetLimits): number {
	const top = Math.max(l.min, Math.min(l.max, Math.floor(l.balance / POINTS_SCALE)));
	const b = bet ?? l.min;
	const want = kind === 'min' ? l.min : kind === 'max' ? top : kind === 'half' ? Math.floor(b / 2) : b * 2;
	return Math.min(top, Math.max(l.min, want));
}

/** `12.5`, `+3`, `-8`: a result with its sign. */
export const signed = (tenths: number): string => `${tenths > 0 ? '+' : ''}${formatTenths(tenths)}`;

/** Results of one game, newest first: what it changed and the multiplier paid. */
export function gameResults(recent: readonly CasinoEntry[], game: CasinoGame, n: number): { net: number; mult: number; at: number }[] {
	return recent
		.filter((r) => r.game === game)
		.slice(0, n)
		.map((r) => ({ net: r.payout - r.bet, mult: r.bet > 0 ? r.payout / r.bet : 0, at: r.at }));
}

/** Share → `48.9 %`. */
export const percent = (share: number): string => `${Math.round(share * 1000) / 10} %`;

// ---------------------------------------------------------------------------
// Crash

/** Hundredths → `2.00×`. */
export const formatMult = (m: number): string => `${(Math.floor(m + 1e-9) / CRASH.one).toFixed(2)}×`;

/** The auto cash-out box: hundredths, null when empty, undefined when it is no value the server takes. */
export function parseAuto(text: string): number | null | undefined {
	const s = text.trim().replace(',', '.');
	if (s === '') return null;
	const match = /^(\d{1,3}(?:\.\d{1,2})?)[x×]?$/i.exec(s);
	if (!match) return undefined;
	const m = Math.round(Number(match[1]) * CRASH.one);
	return isCrashAuto(m) ? m : undefined;
}

export interface CrashFrame {
	/** Axis ends: ms and hundredths. */
	ms: number;
	mult: number;
	/** Horizontal lines, hundredths. */
	lines: number[];
	/** SVG path of the curve, and its end. */
	path: string;
	x: number;
	y: number;
}

const CURVE_POINTS = 60;
const STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

/** The graph `ms` into a round, drawn into `w` × `h` pixels. */
export function crashFrame(ms: number, w: number, h: number): CrashFrame {
	const now = crashCurve(ms);
	const endMs = Math.max(CRASH.doubleMs, ms * 1.08);
	const top = Math.max(200, CRASH.one + (now - CRASH.one) * 1.2);
	const px = (t: number) => (t / endMs) * w;
	const py = (m: number) => h - ((m - CRASH.one) / (top - CRASH.one)) * h;
	let path = '';
	for (let i = 0; i <= CURVE_POINTS; i++) {
		const t = (ms * i) / CURVE_POINTS;
		path += `${i === 0 ? 'M' : 'L'}${px(t).toFixed(1)} ${py(crashCurve(t)).toFixed(1)}`;
	}
	const step = STEPS.find((s) => (top - CRASH.one) / s <= 5) ?? STEPS.at(-1)!;
	const lines: number[] = [];
	for (let m = CRASH.one; m <= top; m += step) lines.push(m);
	return { ms: endMs, mult: top, lines, path, x: px(ms), y: py(now) };
}

// ---------------------------------------------------------------------------
// Slots

/** Symbols that pass by while reel `reel` spins; drawn with the real weights. */
export function slotFiller(n: number, rand: RandomSource = Math.random): SlotSymbolId[] {
	return Array.from({ length: n }, () => rollSlots(rand)[0]);
}

/** A result line the client knows, else null (a newer server). */
export function knownReels(reels: unknown): SlotSymbolId[] | null {
	return Array.isArray(reels) && reels.length === 3 && reels.every((r) => typeof r === 'string' && slotSymbol(r)) ? (reels as SlotSymbolId[]) : null;
}

export const SLOT_START: readonly SlotSymbolId[] = ['board', 'wave', 'sun'];

/** `2 × Sun`. */
export function slotLabel(reels: readonly string[]): string {
	const w = slotWin(reels);
	return w.symbol ? `${w.count} × ${w.symbol.name}` : 'No pair';
}

export const PAY_TABLE = [...SLOT_SYMBOLS].reverse();
