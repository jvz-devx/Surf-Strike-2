import { describe, expect, it } from 'vitest';
import { getCosmetic, lootItems, type LootRarity } from '@surf/shared';
import { NEWS_LOOK, NEWS_STALE_MS, NEWS_VISIBLE, parseBoxNews, pushBoxNews, queueNews, stepNews, type NewsEntry } from './box-news.js';
import type { BoxNews } from './contract.js';

const pick = (r: LootRarity) => lootItems().find((i) => i.rarity === r)!;
const news = (r: LootRarity, at = 0): BoxNews => parseBoxNews({ type: 'boxNews', id: 1, name: 'Ana', item: pick(r).id, duplicate: false }, at)!;
const add = (q: readonly NewsEntry[], ...n: BoxNews[]) => n.reduce<NewsEntry[]>((a, x) => queueNews(a, x), [...q]);
const visible = (q: readonly NewsEntry[]) => q.filter((e) => e.shownAt !== null);
const ROOM = 1000;

describe('box news', () => {
	it('parses; unknown items and malformed messages are ignored', () => {
		const item = pick('epic').id;
		expect(parseBoxNews({ type: 'boxNews', id: 3, name: 'Ana', item, duplicate: true }, 7)).toMatchObject({ at: 7, name: 'Ana', item: getCosmetic(item), duplicate: true });
		for (const bad of [{ item: 'hat_2030' }, { item: 5 }, { item: '__proto__' }, { name: undefined }])
			expect(parseBoxNews({ type: 'boxNews', id: 3, name: 'Ana', item, duplicate: true, ...bad } as never, 7)).toBeNull();
		let l: BoxNews[] = [];
		for (let i = 0; i < 40; i++) l = pushBoxNews(l, news('common', i));
		expect(l).toHaveLength(16);
		expect(l.at(-1)!.at).toBe(39);
	});

	it.each(['common', 'uncommon', 'rare', 'epic'] as const)('%s stays as long as its rarity says', (r) => {
		let q: readonly NewsEntry[] = add([], news(r));
		q = stepNews(q, 0, ROOM);
		expect(q[0]!.shownAt).toBe(0);
		expect(stepNews(q, NEWS_LOOK[r].ms - 1, ROOM)).toBe(q);
		expect(stepNews(q, NEWS_LOOK[r].ms, ROOM)).toEqual([]);
	});

	it('at most three visible, no more than fit, always one', () => {
		const all = add([], news('rare'), news('epic'), news('rare'), news('rare'));
		expect(visible(stepNews(all, 0, ROOM))).toHaveLength(NEWS_VISIBLE);
		expect(visible(stepNews(all, 0, NEWS_LOOK.rare.height + NEWS_LOOK.epic.height + 10))).toHaveLength(2);
		expect(visible(stepNews(all, 0, 5))).toHaveLength(1);
	});

	it('commons merge and everything gets shorter when many wait; nothing is lost', () => {
		let q: readonly NewsEntry[] = stepNews(add([], news('common'), news('common'), news('common')), 0, ROOM);
		q = add(q, ...Array.from({ length: 10 }, () => news('common')), news('epic'));
		expect(q).toHaveLength(7);
		expect(q.reduce((n, e) => n + 1 + e.more, 0)).toBe(14);
		q = stepNews(q, NEWS_LOOK.common.minMs, ROOM);
		expect(visible(q)).toHaveLength(3);
		q = stepNews(q, NEWS_LOOK.common.minMs * 2 + 1, ROOM);
		expect(q.some((e) => e.item.rarity === 'epic')).toBe(true);
	});

	it('never lags far behind: a flood is over soon', () => {
		let q: readonly NewsEntry[] = [];
		let t = 0;
		for (; t < 30_000; t += 200) q = stepNews(add(q, news(t % 2000 === 0 ? 'uncommon' : 'common', t)), t, ROOM);
		expect(q.length).toBeLessThan(12);
		for (const end = t + NEWS_STALE_MS.common; t < end; t += 100) q = stepNews(q, t, ROOM);
		expect(q).toEqual([]);
	});

	it('what waited in a hidden tab is dropped', () => {
		const q = add([], news('common'), news('epic'));
		expect(stepNews(q, 60_000, ROOM)).toEqual([]);
	});
});
