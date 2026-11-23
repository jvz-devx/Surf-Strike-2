import { describe, expect, it } from 'vitest';
import { RECENT_AWARDS, type ServerMessage } from '@surf/shared';
import { applyAward, awardPopup, countdown, NOTICE_MS, noticePopup, POPUP_MS, POPUPS_MAX, pushPopup } from './coins.js';

const award = (p: Partial<Extract<ServerMessage, { type: 'award' }>> = {}): Extract<ServerMessage, { type: 'award' }> => ({
	type: 'award',
	at: 1,
	reason: 'hnsFind',
	label: 'Found a hider',
	base: 30,
	mult: 15,
	amount: 45,
	total: 1045,
	balance: 345,
	...p
});

describe('award popups', () => {
	it('amount, reason and multiplier', () => {
		expect(awardPopup(award(), 7)).toMatchObject({ at: 7, amount: '+4.5', text: 'Found a hider', mult: '×1.5', tone: 'award' });
		expect(awardPopup(award({ amount: 100, mult: 10 }), 0)).toMatchObject({ amount: '+10', mult: '×1.0' });
	});
	it('stack, at most POPUPS_MAX, expired ones go', () => {
		let l = pushPopup([], awardPopup(award(), 0));
		l = pushPopup(l, noticePopup({ type: 'coinsNotice', text: 'paused', tone: 'warn' }, 0));
		l = pushPopup(l, awardPopup(award(), POPUP_MS));
		expect(l.map((p) => p.tone)).toEqual(['warn', 'award']);
		l = pushPopup(l, awardPopup(award(), NOTICE_MS));
		expect(l.map((p) => p.tone)).toEqual(['award']);
		for (let i = 0; i < 9; i++) l = pushPopup(l, awardPopup(award({ label: `n${i}` }), NOTICE_MS));
		expect(l).toHaveLength(POPUPS_MAX);
		expect(l.at(-1)!.text).toBe('n8');
		expect(new Set(l.map((p) => p.id)).size).toBe(POPUPS_MAX);
	});
});

describe('coins view', () => {
	it('takes totals from the server and keeps the newest awards', () => {
		let v = applyAward(null, award());
		expect(v).toMatchObject({ total: 1045, balance: 345 });
		for (let i = 0; i < 30; i++) v = applyAward(v, award({ label: `n${i}` }));
		expect(v.recent).toHaveLength(RECENT_AWARDS);
		expect(v.recent[0]!.label).toBe('n29');
	});
	it('countdown', () => {
		expect([0, -3, 0.2, 59.5, 272, 3723].map(countdown)).toEqual(['0:00', '0:00', '0:01', '1:00', '4:32', '1:02:03']);
	});
});
