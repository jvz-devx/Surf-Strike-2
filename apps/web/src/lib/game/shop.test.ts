import { COSMETIC_SLOTS, cosmeticPrice, emptyLoadout, getCosmetic, listCosmetics, shopItems } from '@surf/shared';
import { describe, expect, it } from 'vitest';
import type { ShopView } from './contract.js';
import {
	filterInventory,
	inventoryEntries,
	itemState,
	missingCoins,
	ownedRarities,
	parseShop,
	SHOP_CATEGORIES,
	shopEntries,
	shopNotice,
	sortInventory
} from './shop.js';

const view = (o: Partial<ShopView> = {}): ShopView => ({
	items: shopItems().map((i) => ({ id: i.id, price: cosmeticPrice(i)! })),
	owned: [],
	loadout: emptyLoadout(),
	busy: false,
	notice: null,
	...o
});
const cap = getCosmetic('hat_cap')!;

describe('shop view', () => {
	it('drops what it does not know and survives malformed messages', () => {
		expect(
			parseShop({
				type: 'shop',
				items: [{ id: 'hat_cap', price: 750 }, { id: 'hat_2030', price: 1 }, { id: 'hat_beanie', price: 'x' as never }, null as never],
				owned: ['hat_cap', 'hat_2030', 'hat_cap', 5 as never],
				loadout: { ...emptyLoadout(), hat: 'hat_2030', top: 'top_sunset' }
			})
		).toEqual({ items: [{ id: 'hat_cap', price: 750 }], owned: ['hat_cap'], loadout: { ...emptyLoadout(), top: 'top_sunset' } });
		expect(parseShop({ type: 'shop' } as never)).toEqual({ items: [], owned: [], loadout: emptyLoadout() });
	});

	it('lists what both sides know at the server price, every slot in a category', () => {
		expect(shopEntries(view())).toHaveLength(shopItems().length);
		// Loot is never listed, even if it is owned or an older server still sells it.
		expect(shopEntries(view({ items: [{ id: 'hat_frycook', price: 2000 }], owned: ['hat_frycook'] }))).toEqual([]);
		expect(shopEntries(view({ items: [], owned: ['hat_cap'] }))).toEqual([]);
		expect(shopEntries(view({ items: [{ id: 'hat_cap', price: 10 }] }))).toEqual([{ item: cap, price: 10 }]);
		expect(shopItems().every((i) => SHOP_CATEGORIES.some((c) => c.slot === i.slot))).toBe(true);
	});

	it('lists owned items after the others, in the same order', () => {
		const all = shopEntries(view()).map((e) => e.item.id);
		const owned = ['hat_beanie', 'hat_cap', 'hat_frycook'];
		const ids = shopEntries(view({ owned })).map((e) => e.item.id);
		expect(ids).toEqual([...all.filter((id) => !owned.includes(id)), 'hat_cap', 'hat_beanie']);
	});

	it('item states', () => {
		expect(itemState(cap, 750, view(), 750, true)).toBe('buy');
		expect(itemState(cap, 750, view(), 749, true)).toBe('poor');
		expect(itemState(cap, 750, view(), 0, false)).toBe('guest');
		expect(itemState(cap, 750, view({ owned: ['hat_cap'] }), 0, true)).toBe('owned');
		expect(itemState(cap, 750, view({ owned: ['hat_cap'], loadout: { ...emptyLoadout(), hat: 'hat_cap' } }), 0, true)).toBe('owned');
		expect(missingCoins(750, 749)).toBe('0.1');
	});

	it('notices', () => {
		expect(shopNotice({ type: 'shopResult', action: 'buy', item: 'hat_cap', ok: true })).toEqual({ ok: true, text: 'Breakline cap bought.', bought: 'hat_cap' });
		expect(shopNotice({ type: 'shopResult', action: 'equip', item: 'hat_cap', ok: true })).toBeNull();
		expect(shopNotice({ type: 'shopResult', action: 'buy', item: null, ok: false, error: 'No.' })).toEqual({ ok: false, text: 'No.' });
		expect(shopNotice({ type: 'shopResult', action: 'buy', item: null, ok: false })?.ok).toBe(false);
	});
});

describe('inventory', () => {
	const owned = ['top_sunset', 'hat_frycook', 'hat_cap', 'glasses_shades'];
	const all = inventoryEntries(view({ owned, loadout: { ...emptyLoadout(), hat: 'hat_frycook' } }));
	const keys = (list: { key: string }[]) => list.map((e) => e.key);

	it('lists the default look of every slot and every owned item, loot included', () => {
		expect(all).toHaveLength(COSMETIC_SLOTS.length + owned.length);
		expect(all.filter((e) => e.wear === null).map((e) => e.slot)).toEqual([...COSMETIC_SLOTS]);
		expect(all.filter((e) => e.wear !== null).map((e) => e.wear)).toEqual(expect.arrayContaining(owned));
		expect(keys(inventoryEntries(view()))).toEqual(COSMETIC_SLOTS.map((s) => `default:${s}`));
		// In the inventory, not in the shop; and nothing of the stock that is not owned.
		expect(shopEntries(view({ owned })).some((e) => e.item.id === 'hat_frycook')).toBe(false);
		expect(keys(all)).not.toContain('hat_beanie');
		// Owned stays listed when the server no longer sells it.
		expect(keys(inventoryEntries(view({ items: [], owned: ['hat_cap'] })))).toContain('hat_cap');
	});

	it('marks one worn entry per slot', () => {
		expect(keys(all.filter((e) => e.worn))).toEqual(['default:glasses', 'default:top', 'default:bottom', 'default:shoes', 'hat_frycook']);
	});

	it('filters by slot, rarity and text', () => {
		expect(keys(filterInventory(all, {}))).toEqual(keys(all));
		expect(keys(filterInventory(all, { slot: 'hat' })).sort()).toEqual(['default:hat', 'hat_cap', 'hat_frycook']);
		expect(keys(filterInventory(all, { rarity: 'common' }))).toEqual(['hat_frycook']);
		expect(keys(filterInventory(all, { slot: 'hat', rarity: 'basic' }))).toEqual(['hat_cap']);
		expect(keys(filterInventory(all, { query: ' COOK  fry ' }))).toEqual(['hat_frycook']);
		expect(keys(filterInventory(all, { query: 'hats basic' }))).toEqual(['hat_cap']);
		expect(keys(filterInventory(all, { query: 'default', slot: 'top' }))).toEqual(['default:top']);
		expect(filterInventory(all, { query: 'nothing like this' })).toEqual([]);
	});

	it('offers only rarities the player has', () => {
		expect(ownedRarities(all)).toEqual(['basic', 'common']);
		expect(ownedRarities(inventoryEntries(view()))).toEqual([]);
	});

	it('sorts by rarity or name without changing the list', () => {
		const before = keys(all);
		const items = all.filter((e) => e.wear !== null);
		expect(keys(sortInventory(items, 'rarity'))).toEqual(['hat_frycook', 'hat_cap', 'glasses_shades', 'top_sunset']);
		expect(keys(sortInventory(items, 'name'))).toEqual(['hat_cap', 'hat_frycook', 'glasses_shades', 'top_sunset']);
		// The default look comes last by rarity.
		expect(sortInventory(all, 'rarity').slice(-COSMETIC_SLOTS.length).every((e) => e.wear === null)).toBe(true);
		const names = sortInventory(all, 'name').map((e) => e.name);
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
		expect(keys(all)).toEqual(before);
	});

	it('holds everything there is', () => {
		const every = listCosmetics().filter((i) => !i.isDefault);
		expect(inventoryEntries(view({ owned: every.map((i) => i.id) }))).toHaveLength(every.length + COSMETIC_SLOTS.length);
	});
});
