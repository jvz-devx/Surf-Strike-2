/** Coins on the client (docs/economy.md#wire): popups and the Coins view. Pure, unit-tested. */
import { formatMultiplier, formatTenths, RECENT_AWARDS, type PointLogEntry, type ServerMessage } from '@surf/shared';
import type { AwardPopup, CoinsView } from './contract.js';

/** How long a popup stays (ms). */
export const POPUP_MS = 4_500;
export const NOTICE_MS = 10_000;
/** Popups on screen at most; the oldest goes first. */
export const POPUPS_MAX = 5;

export const popupMs = (p: Pick<AwardPopup, 'tone'>): number => (p.tone === 'award' ? POPUP_MS : NOTICE_MS);

let nextId = 1;

export function awardPopup(m: Extract<ServerMessage, { type: 'award' }>, now: number): AwardPopup {
	return { id: nextId++, at: now, amount: `+${formatTenths(m.amount)}`, text: m.label, mult: formatMultiplier(m.mult), tone: 'award' };
}

export function noticePopup(m: Extract<ServerMessage, { type: 'coinsNotice' }>, now: number): AwardPopup {
	return { id: nextId++, at: now, amount: '', text: m.text, mult: '', tone: m.tone === 'warn' ? 'warn' : 'info' };
}

/** Add a popup; expired ones and the oldest beyond POPUPS_MAX go. */
export function pushPopup(list: readonly AwardPopup[], p: AwardPopup): AwardPopup[] {
	return [...list.filter((x) => p.at - x.at < popupMs(x)), p].slice(-POPUPS_MAX);
}

/** The Coins view after an award. */
export function applyAward(view: CoinsView | null, m: Extract<ServerMessage, { type: 'award' }>): CoinsView {
	const entry: PointLogEntry = { at: m.at, reason: m.reason, label: m.label, amount: m.amount, mult: m.mult };
	return { total: m.total, balance: m.balance, recent: [entry, ...(view?.recent ?? [])].slice(0, RECENT_AWARDS) };
}

/** Seconds → `4:32`, `1:02:03`. */
export function countdown(secs: number): string {
	const t = Math.max(0, Math.ceil(secs));
	const mm = Math.floor(t / 60) % 60;
	const h = Math.floor(t / 3600);
	const ss = String(t % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
