import { describe, expect, it } from 'vitest';
import {
	betError,
	CASINO_MAX_BET,
	CASINO_MIN,
	coinflipPayout,
	CRASH,
	crashAt,
	crashChance,
	crashCurve,
	crashPayout,
	crashState,
	crashTime,
	isCrashAuto,
	rollCoin,
	rollCrash,
	rollSlots,
	SLOT_STOPS,
	SLOT_SYMBOLS,
	slotOdds,
	slotPayout,
	slotWin
} from './casino.ts';

/** `n` evenly spaced values: an exact sweep over a uniform source. */
const sweep = (n: number) => Array.from({ length: n }, (_, i) => i / n);

describe('bets', () => {
	it('whole coins between the minimum of the game and the maximum', () => {
		expect(CASINO_MIN).toEqual({ coinflip: 10, crash: 5, slots: 1 });
		expect(CASINO_MAX_BET).toBe(500);
		expect([9, 10, 500, 501].map((b) => betError('coinflip', b))).toEqual(['min', null, null, 'max']);
		expect([4, 5].map((b) => betError('crash', b))).toEqual(['min', null]);
		expect([0, 1, -1].map((b) => betError('slots', b))).toEqual(['min', null, 'min']);
		for (const bad of [10.5, NaN, Infinity, '10', null, undefined, {}, [10]]) expect(betError('slots', bad)).toBe('whole');
	});
});

describe('coinflip', () => {
	it('is exactly 50 % and pays twice the bet', () => {
		const heads = sweep(1000).filter((r) => rollCoin(() => r) === 'heads').length;
		expect(heads).toBe(500);
		expect(coinflipPayout(10, 'heads', 'heads')).toBe(200);
		expect(coinflipPayout(10, 'heads', 'tails')).toBe(0);
	});
});

describe('crash', () => {
	it('reaches m with probability 1/m', () => {
		const n = 1_000_000;
		const rolls = sweep(n).map((r) => rollCrash(() => r));
		for (const m of [101, 110, 150, 200, 300, 1000, 5000, CRASH.cap]) {
			expect(rolls.filter((c) => c >= m).length / n).toBeCloseTo(crashChance(m), 5);
		}
		expect(rolls.filter((c) => c >= 200).length).toBe(n / 2);
		expect(Math.min(...rolls.slice(0, 10))).toBe(100);
		expect(rolls.reduce((a, b) => Math.max(a, b), 0)).toBe(CRASH.cap);
		// Every cash-out value is fair: chance × payout = bet.
		for (const m of [125, 200, 400, 1000]) expect(crashChance(m) * crashPayout(100, m)).toBeCloseTo(1000, 6);
	});

	it('the curve: 1.00× at the start, 2× after 6 s, faster and faster, 100× at the end', () => {
		expect([0, 6000, 12000].map(crashAt)).toEqual([100, 200, 400]);
		expect(crashAt(-5)).toBe(100);
		expect(crashAt(60_000)).toBe(CRASH.cap);
		expect(crashCurve(4000) - crashCurve(3000)).toBeGreaterThan(crashCurve(1000) - crashCurve(0));
		for (const m of [101, 137, 200, 999, 10_000]) expect(crashAt(crashTime(m))).toBe(m);
	});

	it('cashing out, crashing and the automatic cash-out', () => {
		const at = crashTime;
		expect(crashState(250, null, at(249), true)).toEqual({ at: 249 });
		expect(crashState(250, null, at(249))).toBe('running');
		expect(crashState(250, null, at(250), true)).toBe('crashed');
		expect(crashState(250, null, at(250))).toBe('crashed');
		// Late ticks do not change what was decided before.
		expect(crashState(250, 200, at(200))).toEqual({ at: 200 });
		expect(crashState(250, 200, 999_999)).toEqual({ at: 200 });
		expect(crashState(250, 200, at(220), true)).toEqual({ at: 200 });
		expect(crashState(250, 200, at(150), true)).toEqual({ at: 150 });
		// Reaching the value is enough; one hundredth more is not.
		expect(crashState(250, 250, at(250))).toEqual({ at: 250 });
		expect(crashState(250, 251, at(250))).toBe('crashed');
		expect(crashState(100, null, 0, true)).toBe('crashed');
		// The cap cashes out by itself.
		expect(crashState(CRASH.cap, null, at(CRASH.cap))).toEqual({ at: CRASH.cap });
		expect(crashState(CRASH.cap - 1, null, at(CRASH.cap))).toBe('crashed');
	});

	it('pays tenths, rounded down', () => {
		expect([crashPayout(5, 100), crashPayout(5, 137), crashPayout(500, 10_000), crashPayout(10, 101)]).toEqual([50, 68, 500_000, 101]);
	});

	it('accepts automatic values from 1.01× to 100×', () => {
		expect([null, 101, 200, 10_000].every(isCrashAuto)).toBe(true);
		for (const bad of [100, 0, -5, 10_001, 150.5, NaN, '200', undefined, {}]) expect(isCrashAuto(bad)).toBe(false);
	});
});

describe('slots', () => {
	it('about 49 % of all combinations pay, and the payback is about 98 %, counted exactly', () => {
		let total = 0;
		let hits = 0;
		let paid = 0;
		const reel = SLOT_SYMBOLS.flatMap((s) => Array.from({ length: s.weight }, () => s.id));
		expect(reel.length).toBe(SLOT_STOPS);
		for (const a of reel)
			for (const b of reel)
				for (const c of reel) {
					total++;
					const p = slotPayout(1, [a, b, c]) / 10;
					if (p > 0) hits++;
					paid += p;
				}
		expect(total).toBe(32 ** 3);
		expect(hits / total).toBeGreaterThanOrEqual(0.485);
		expect(hits / total).toBeLessThanOrEqual(0.495);
		expect(paid / total).toBeGreaterThanOrEqual(0.97);
		expect(paid / total).toBeLessThanOrEqual(0.99);
		const odds = slotOdds();
		expect(odds.hit).toBeCloseTo(hits / total, 12);
		expect(odds.payback).toBeCloseTo(paid / total, 12);
		expect(odds.profit).toBeCloseTo(0.20679, 4);
	});

	it('two or three of a symbol anywhere pay; three different ones do not', () => {
		expect(slotWin(['wave', 'sun', 'wave'])).toMatchObject({ mult: 1, count: 2, symbol: { id: 'wave' } });
		expect(slotWin(['sun', 'wave', 'sun']).mult).toBe(5);
		expect(slotWin(['pearl', 'pearl', 'pearl']).mult).toBe(250);
		expect(slotWin(['wave', 'shell', 'palm'])).toEqual({ mult: 0, symbol: null, count: 0 });
		expect(slotPayout(500, ['pearl', 'pearl', 'pearl'])).toBe(1_250_000);
	});

	it('rolls every stop equally often', () => {
		const counts = new Map<string, number>();
		for (const r of sweep(3200)) {
			const s = rollSlots(() => r)[0];
			counts.set(s, (counts.get(s) ?? 0) + 1);
		}
		for (const s of SLOT_SYMBOLS) expect(counts.get(s.id)).toBe(s.weight * 100);
		expect(rollSlots(() => 0.999999999)).toEqual(['pearl', 'pearl', 'pearl']);
	});
});
