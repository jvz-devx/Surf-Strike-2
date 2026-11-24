/** Loot box news on the client (docs/ui.md#box-news): what others got, and the queue at the top of the screen. Pure, unit-tested. */
import { getCosmetic, LOOTBOX, type LootRarity, type ServerMessage } from '@surf/shared';
import type { BoxNews } from './contract.js';

/** Time on screen and height (px at HUD scale 1); `minMs`: while others wait. */
export const NEWS_LOOK: Readonly<Record<LootRarity, { ms: number; minMs: number; height: number }>> = {
	common: { ms: 4000, minMs: 1600, height: 50 },
	uncommon: { ms: 5000, minMs: 2200, height: 60 },
	rare: { ms: 6000, minMs: 4000, height: 84 },
	epic: { ms: 8000, minMs: 6000, height: 104 }
};
export const NEWS_GAP = 6;
export const NEWS_VISIBLE = 3;
/** This many waiting: the next common ones are merged into the last waiting one. */
export const NEWS_MERGE = 3;
/** Kept in the HUD state; the component takes each of them once. */
const NEWS_KEPT = 16;
/** Not shown any more when it waited this long (a hidden tab, a flood). */
export const NEWS_STALE_MS: Readonly<Record<LootRarity, number>> = { common: 10_000, uncommon: 10_000, rare: 20_000, epic: 20_000 };

export const newsRarity = (n: Pick<BoxNews, 'item'>): LootRarity =>
	n.item.rarity !== undefined && n.item.rarity in LOOTBOX.odds ? (n.item.rarity as LootRarity) : 'common';

let nextId = 1;

/** A `boxNews` message of any server version; null when this client cannot show it. */
export function parseBoxNews(m: Extract<ServerMessage, { type: 'boxNews' }>, now: number): BoxNews | null {
	const item = typeof m.item === 'string' ? getCosmetic(m.item) : undefined;
	if (!item || typeof m.name !== 'string') return null;
	return { id: nextId++, at: now, name: m.name, item, duplicate: m.duplicate === true };
}

export function pushBoxNews(list: readonly BoxNews[], n: BoxNews): BoxNews[] {
	return [...list, n].slice(-NEWS_KEPT);
}

export interface NewsEntry extends BoxNews {
	/** null: waiting. */
	shownAt: number | null;
	/** Further openings merged into this one. */
	more: number;
}

/** Add one to the queue (oldest first). */
export function queueNews(queue: readonly NewsEntry[], n: BoxNews): NewsEntry[] {
	const waiting = queue.filter((e) => e.shownAt === null);
	const last = waiting.findLast((e) => newsRarity(e) === 'common');
	if (newsRarity(n) === 'common' && last && waiting.length >= NEWS_MERGE) return queue.map((e) => (e === last ? { ...e, more: e.more + 1 } : e));
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
		const r = newsRarity(e);
		if (e.shownAt === null) return now - e.at < NEWS_STALE_MS[r];
		return now - e.shownAt < (crowded ? NEWS_LOOK[r].minMs : NEWS_LOOK[r].ms);
	});
	let changed = kept.length !== queue.length;
	const shown = kept.filter((e) => e.shownAt !== null);
	let count = shown.length;
	let used = shown.reduce((h, e) => h + NEWS_LOOK[newsRarity(e)].height + NEWS_GAP, 0);
	const next = kept.map((e) => {
		const h = NEWS_LOOK[newsRarity(e)].height;
		if (e.shownAt !== null || count >= NEWS_VISIBLE || (count > 0 && used + h > room)) return e;
		count++;
		used += h + NEWS_GAP;
		changed = true;
		return { ...e, shownAt: now };
	});
	return changed ? next : queue;
}
