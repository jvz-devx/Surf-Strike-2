/** Loot box and casino news on the client (docs/ui.md#box-news): what others got, and the queue at the top of the screen. Pure, unit-tested. */
import { casinoNewsTier, formatTenths, getCosmetic, isCasinoGame, LOOTBOX, type CasinoNewsTier, type LootRarity, type ServerMessage } from '@surf/shared';
import type { BoxNews, CasinoNews } from './contract.js';

export type News = BoxNews | CasinoNews;

export interface NewsSize {
	/** Time on screen; `minMs`: while others wait. */
	ms: number;
	minMs: number;
	/** px at HUD scale 1. */
	height: number;
	/** Not shown any more when it waited this long (a hidden tab, a flood). */
	staleMs: number;
	/** The louder sound. */
	big: boolean;
}

export const NEWS_LOOK: Readonly<Record<LootRarity, NewsSize>> = {
	common: { ms: 4000, minMs: 1600, height: 50, staleMs: 10_000, big: false },
	uncommon: { ms: 5000, minMs: 2200, height: 60, staleMs: 10_000, big: false },
	rare: { ms: 6000, minMs: 4000, height: 84, staleMs: 20_000, big: true },
	epic: { ms: 8000, minMs: 6000, height: 104, staleMs: 20_000, big: true }
};
/** Casino wins, by the tier reached. */
export const CASINO_LOOK: Readonly<Record<CasinoNewsTier, NewsSize & { color: string }>> = {
	5: { ms: 4000, minMs: 1600, height: 50, staleMs: 10_000, big: false, color: '#5fe07a' },
	10: { ms: 5000, minMs: 2200, height: 62, staleMs: 10_000, big: false, color: '#4fb3ff' },
	20: { ms: 6000, minMs: 4000, height: 80, staleMs: 20_000, big: true, color: '#c07bff' },
	50: { ms: 7000, minMs: 5000, height: 98, staleMs: 20_000, big: true, color: '#ff8a3d' },
	100: { ms: 9000, minMs: 7000, height: 120, staleMs: 20_000, big: true, color: '#ffd24a' }
};
export const NEWS_GAP = 6;
export const NEWS_VISIBLE = 3;
/** This many waiting: the next common ones are merged into the last waiting one. */
export const NEWS_MERGE = 3;
/** Kept in the HUD state; the component takes each of them once. */
const NEWS_KEPT = 16;

export const newsRarity = (n: Pick<BoxNews, 'item'>): LootRarity =>
	n.item.rarity !== undefined && n.item.rarity in LOOTBOX.odds ? (n.item.rarity as LootRarity) : 'common';

export const newsLook = (n: News): NewsSize => ('item' in n ? NEWS_LOOK[newsRarity(n)] : CASINO_LOOK[n.tier]);

let nextId = 1;

/** A `boxNews` message of any server version; null when this client cannot show it. */
export function parseBoxNews(m: Extract<ServerMessage, { type: 'boxNews' }>, now: number): BoxNews | null {
	const item = typeof m.item === 'string' ? getCosmetic(m.item) : undefined;
	if (!item || typeof m.name !== 'string') return null;
	return { id: nextId++, at: now, name: m.name, item, duplicate: m.duplicate === true };
}

/** A `casinoNews` message of any server version; null when this client cannot show it. */
export function parseCasinoNews(m: Extract<ServerMessage, { type: 'casinoNews' }>, now: number): CasinoNews | null {
	if (typeof m.name !== 'string' || !isCasinoGame(m.game) || !Number.isFinite(m.bet) || !Number.isFinite(m.payout)) return null;
	const tier = casinoNewsTier(m.bet, m.payout);
	if (tier === null) return null;
	return { id: nextId++, at: now, name: m.name, game: m.game, tier, mult: `${formatTenths(Math.floor((m.payout * 10) / m.bet))}×`, payout: m.payout };
}

export function pushBoxNews(list: readonly News[], n: News): News[] {
	return [...list, n].slice(-NEWS_KEPT);
}

export type NewsEntry = News & {
	/** null: waiting. */
	shownAt: number | null;
	/** Further openings merged into this one. */
	more: number;
};

/** Add one to the queue (oldest first). */
export function queueNews(queue: readonly NewsEntry[], n: News): NewsEntry[] {
	const common = (e: News) => 'item' in e && newsRarity(e) === 'common';
	const waiting = queue.filter((e) => e.shownAt === null);
	const last = waiting.findLast(common);
	if (common(n) && last && waiting.length >= NEWS_MERGE) return queue.map((e) => (e === last ? { ...e, more: e.more + 1 } : e));
	return [...queue, { ...n, shownAt: null, more: 0 }];
}

/**
 * The queue at `now`: expired and stale ones go, waiting ones start while there is room
 * (`room` in px at HUD scale 1; one is always shown). Returns the same array when nothing changed.
 */
export function stepNews(queue: readonly NewsEntry[], now: number, room: number): readonly NewsEntry[] {
	if (queue.length === 0) return queue;
	const crowded = queue.filter((e) => e.shownAt === null).length >= 2;
	const kept = queue.filter((e) => {
		const look = newsLook(e);
		if (e.shownAt === null) return now - e.at < look.staleMs;
		return now - e.shownAt < (crowded ? look.minMs : look.ms);
	});
	let changed = kept.length !== queue.length;
	const shown = kept.filter((e) => e.shownAt !== null);
	let count = shown.length;
	let used = shown.reduce((h, e) => h + newsLook(e).height + NEWS_GAP, 0);
	const next = kept.map((e) => {
		const h = newsLook(e).height;
		if (e.shownAt !== null || count >= NEWS_VISIBLE || (count > 0 && used + h > room)) return e;
		count++;
		used += h + NEWS_GAP;
		changed = true;
		return { ...e, shownAt: now };
	});
	return changed ? next : queue;
}
