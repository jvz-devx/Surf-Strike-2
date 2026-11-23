import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '@surf/shared';
import {
	cleanName,
	commonPrefix,
	crosshairRects,
	cvarNum,
	deltaClass,
	fadeOpacity,
	formatClock,
	formatDelta,
	formatRunTime,
	hexToRgb,
	rgbToHex,
	stageText
} from './format.js';

describe('formatDelta', () => {
	it('formats negative as faster with a real minus sign', () => {
		expect(formatDelta(-0.213 * TICK_RATE)).toBe('−0.213');
		expect(deltaClass(-27)).toBe('faster');
	});
	it('formats positive and minutes', () => {
		expect(formatDelta(TICK_RATE)).toBe('+1.000');
		expect(formatDelta(62.5 * TICK_RATE)).toBe('+1:02.500');
		expect(deltaClass(5)).toBe('slower');
	});
	it('formats zero', () => {
		expect(formatDelta(0)).toBe('±0.000');
		expect(deltaClass(0)).toBe('even');
		expect(deltaClass(null)).toBe('even');
	});
});

describe('clock and run time', () => {
	it('formats seconds as mm:ss rounding up', () => {
		expect(formatClock(462)).toBe('07:42');
		expect(formatClock(461.2)).toBe('07:42');
		expect(formatClock(-3)).toBe('00:00');
	});
	it('formats ticks', () => {
		expect(formatRunTime(TICK_RATE * 72.402)).toBe('01:12.402');
		expect(formatRunTime(-5)).toBe('00:00.000');
	});
});

describe('fadeOpacity', () => {
	it('holds then fades', () => {
		expect(fadeOpacity(100, 2000, 500)).toBe(1);
		expect(fadeOpacity(2250, 2000, 500)).toBeCloseTo(0.5);
		expect(fadeOpacity(3000, 2000, 500)).toBe(0);
	});
});

describe('stageText', () => {
	it('covers phases and kinds', () => {
		expect(stageText('start', 0, 6, 'stage')).toBe('Start zone');
		expect(stageText('running', 3, 6, 'stage')).toBe('Stage 3 / 6');
		expect(stageText('running', 2, 5, 'checkpoint')).toBe('Checkpoint 2 / 5');
		expect(stageText('running', 0, 0, 'checkpoint')).toBe('Running');
		expect(stageText('finished', 6, 6, 'stage')).toBe('Finished');
		expect(stageText('idle', 0, 6, 'stage')).toBe('');
	});
});

describe('crosshair', () => {
	it('builds four symmetric lines with CS defaults', () => {
		const r = crosshairRects(5, 1, 1, false);
		expect(r).toHaveLength(4);
		expect(r[0]).toEqual({ x: -0.5, y: -15, w: 1, h: 10 });
		expect(r[3]).toEqual({ x: 5, y: -0.5, w: 10, h: 1 });
	});
	it('adds a dot and clamps', () => {
		const r = crosshairRects(0, -10, 0, true);
		expect(r).toEqual([{ x: -0.5, y: -0.5, w: 1, h: 1 }]);
	});
});

describe('colour and cvars', () => {
	it('round-trips hex', () => {
		expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
		expect(rgbToHex(300, -5, 16.4)).toBe('#ff0010');
		expect(hexToRgb('#12ab9F')).toEqual([0x12, 0xab, 0x9f]);
		expect(hexToRgb('nope')).toBeNull();
	});
	it('reads numeric cvars', () => {
		expect(cvarNum({ a: '2.5', b: 3, c: 'x' }, 'a', 0)).toBe(2.5);
		expect(cvarNum({ b: 3 }, 'b', 0)).toBe(3);
		expect(cvarNum({ c: 'x' }, 'c', 7)).toBe(7);
		expect(cvarNum({}, 'missing', 1)).toBe(1);
	});
});

describe('misc', () => {
	it('common prefix', () => {
		expect(commonPrefix(['cl_showfps', 'cl_showkeys', 'cl_showpos'])).toBe('cl_show');
		expect(commonPrefix([])).toBe('');
	});
	it('cleans names', () => {
		expect(cleanName('  tim  ')).toBe('tim');
		expect(cleanName('   ')).toBeNull();
		expect(cleanName('x'.repeat(30))).toHaveLength(24);
	});
});
