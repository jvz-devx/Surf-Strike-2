import { describe, expect, it } from 'vitest';
import { crashCurve, pts, slotWin, SLOT_SYMBOLS, type ServerMessage } from '@surf/shared';
import {
	betHint,
	casinoError,
	casinoResult,
	crashFrame,
	crashStarted,
	formatMult,
	gameResults,
	knownReels,
	parseAuto,
	parseBet,
	parseCasino,
	percent,
	quickBet,
	signed,
	slotFiller,
	slotLabel
} from './casino.js';

const msg = (p: Partial<Extract<ServerMessage, { type: 'casino' }>> = {}): Extract<ServerMessage, { type: 'casino' }> => ({
	type: 'casino',
	min: { coinflip: 10, crash: 5, slots: 1 },
	max: 500,
	net: 250,
	recent: [],
	...p
});

describe('casino state', () => {
	it('takes the limits, the net and a running round; bad fields fall back', () => {
		const v = parseCasino(msg({ crash: { bet: 100, auto: 200, elapsed: 1500 } }), 10_000, 50);
		expect(v).toMatchObject({ max: 500, net: 250, baseline: 50, busy: false, crash: { bet: 100, auto: 200, startedAt: 8500 } });
		const bad = parseCasino({ type: 'casino', recent: [null, { game: 'dice' }] } as never, 0, 0);
		expect(bad).toMatchObject({ min: { coinflip: 10, crash: 5, slots: 1 }, max: 500, net: 0, recent: [], crash: null });
	});

	it('crash: start, then the end; results go into the list and count up', () => {
		let v = { ...parseCasino(msg(), 0, 250), busy: true };
		v = { ...crashStarted(v, { bet: 100, auto: null }, 500) };
		expect(v).toMatchObject({ busy: false, crash: { bet: 100, auto: null, startedAt: 500 } });
		v = casinoResult(v, { net: 350, game: 'crash', bet: 100, payout: 200, at: 200, crash: 310 }, 9);
		expect(v).toMatchObject({ crash: null, net: 350, recent: [{ at: 9, game: 'crash', bet: 100, payout: 200 }], last: { n: 1 } });
		v = casinoResult({ ...v, crash: { bet: 50, auto: null, startedAt: 1 } }, { net: 250, game: 'slots', bet: 100, payout: 0, reels: ['wave', 'sun', 'fin'] }, 10);
		expect(v.crash).not.toBeNull();
		expect(v.last?.n).toBe(2);
		expect(gameResults(v.recent, 'crash', 5)).toEqual([{ net: 100, mult: 2, at: 9 }]);
		v = casinoError({ ...v, busy: true }, 'no');
		expect(v).toMatchObject({ busy: false, error: { n: 1, text: 'no' } });
	});
});

describe('bets', () => {
	const l = { min: 10, max: 500, balance: pts(123) + 4 };
	it('reads whole coins only', () => {
		expect([' 12 ', 12, '007'].map(parseBet)).toEqual([12, 12, 7]);
		for (const bad of ['', '1.5', '-3', '1e2', 'x', null, undefined, '12345678']) expect(parseBet(bad)).toBeNull();
	});
	it('says why a bet cannot be placed', () => {
		expect(betHint(10, l)).toBeNull();
		expect(betHint(123, l)).toBeNull();
		expect(betHint(124, l)).toBe('You have 123.4 coins.');
		expect(betHint(9, l)).toMatch(/smallest bet is 10 coins/);
		expect(betHint(501, { ...l, balance: 1e6 })).toMatch(/largest/);
		expect(betHint(null, l)).toMatch(/whole/);
		expect(betHint(0, { ...l, min: 1 })).toMatch(/is 1 coin\./);
	});
	it('quick buttons stay inside the limits and the balance', () => {
		expect((['min', 'half', 'double', 'max'] as const).map((k) => quickBet(k, 50, l))).toEqual([10, 25, 100, 123]);
		expect(quickBet('double', 100, l)).toBe(123);
		expect(quickBet('half', 15, l)).toBe(10);
		expect(quickBet('max', 1, { ...l, balance: pts(9999) })).toBe(500);
		expect(quickBet('max', 1, { ...l, balance: 0 })).toBe(10);
		expect(quickBet('double', null, l)).toBe(20);
	});
	it('formats', () => {
		expect([pts(5), -125, 0].map(signed)).toEqual(['+5', '-12.5', '0']);
		expect(percent(0.48950195)).toBe('49 %');
		expect(percent(0.2068)).toBe('20.7 %');
	});
});

describe('crash', () => {
	it('multipliers and the auto box', () => {
		expect([100, 199.99, 200, 10_000].map(formatMult)).toEqual(['1.00×', '1.99×', '2.00×', '100.00×']);
		expect(['', ' ', '2', '1.01', '2,5', '1.5x', '100'].map(parseAuto)).toEqual([null, null, 200, 101, 250, 150, 10_000]);
		for (const bad of ['1', '1.00', '0.5', '100.01', 'x', '1.234', '-2']) expect(parseAuto(bad)).toBeUndefined();
	});
	it('the curve starts bottom left and stays inside the graph', () => {
		const a = crashFrame(0, 600, 300);
		expect([a.x, a.y, a.ms, a.mult]).toEqual([0, 300, 6000, 200]);
		for (const ms of [500, 6000, 20_000, 39_863]) {
			const f = crashFrame(ms, 600, 300);
			expect(f.x).toBeGreaterThan(0);
			expect(f.x).toBeLessThanOrEqual(600);
			expect(f.y).toBeGreaterThanOrEqual(0);
			expect(f.y).toBeLessThan(300);
			expect(f.mult).toBeGreaterThan(crashCurve(ms));
			expect(f.lines.length).toBeGreaterThan(1);
			expect(f.lines.length).toBeLessThanOrEqual(6);
			expect(f.path).not.toContain('NaN');
		}
	});
});

describe('slots', () => {
	it('filler, labels and unknown results', () => {
		expect(slotFiller(40).every((s) => SLOT_SYMBOLS.some((d) => d.id === s))).toBe(true);
		expect(slotLabel(['sun', 'wave', 'sun'])).toBe('2 × Sun');
		expect(slotLabel(['sun', 'wave', 'fin'])).toBe('No pair');
		expect(knownReels(['sun', 'wave', 'fin'])).toEqual(['sun', 'wave', 'fin']);
		for (const bad of [null, [], ['sun', 'wave'], ['sun', 'wave', 'cherry'], [1, 2, 3]]) expect(knownReels(bad)).toBeNull();
		expect(slotWin(['sun', 'sun', 'sun']).mult).toBe(50);
	});
});
