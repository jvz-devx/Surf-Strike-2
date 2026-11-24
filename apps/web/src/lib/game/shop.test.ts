import { cosmeticPrice, emptyLoadout, getCosmetic, shopItems } from '@surf/shared';
import { describe, expect, it } from 'vitest';
import type { ShopView } from './contract.js';
import { itemState, missingCoins, parseShop, SHOP_CATEGORIES, shopEntries, shopNotice } from './shop.js';

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
				owned: ['hat_cap', 'hat_2030', 5 as never],
				loadout: { ...emptyLoadout(), hat: 'hat_2030', top: 'top_sunset' }
			})
		).toEqual({ items: [{ id: 'hat_cap', price: 750 }], owned: ['hat_cap'], loadout: { ...emptyLoadout(), top: 'top_sunset' } });
		expect(parseShop({ type: 'shop' } as never)).toEqual({ items: [], owned: [], loadout: emptyLoadout() });
	});

	it('lists what both sides know at the server price, every slot in a category', () => {
		expect(shopEntries(view())).toHaveLength(14);
		expect(shopEntries(view({ items: [{ id: 'hat_cap', price: 10 }] }))).toEqual([{ item: cap, price: 10 }]);
		expect(shopItems().every((i) => SHOP_CATEGORIES.some((c) => c.slot === i.slot))).toBe(true);
	});

	it('item states', () => {
		expect(itemState(cap, 750, view(), 750, true)).toBe('buy');
		expect(itemState(cap, 750, view(), 749, true)).toBe('poor');
		expect(itemState(cap, 750, view(), 0, false)).toBe('guest');
		expect(itemState(cap, 750, view({ owned: ['hat_cap'] }), 0, true)).toBe('owned');
		expect(itemState(cap, 750, view({ owned: ['hat_cap'], loadout: { ...emptyLoadout(), hat: 'hat_cap' } }), 0, true)).toBe('equipped');
		expect(missingCoins(750, 749)).toBe('0.1');
	});

	it('notices', () => {
		expect(shopNotice({ type: 'shopResult', action: 'buy', item: 'hat_cap', ok: true })).toEqual({ ok: true, text: 'Breakline cap bought.' });
		expect(shopNotice({ type: 'shopResult', action: 'equip', item: 'hat_cap', ok: true })).toBeNull();
		expect(shopNotice({ type: 'shopResult', action: 'buy', item: null, ok: false, error: 'No.' })).toEqual({ ok: false, text: 'No.' });
		expect(shopNotice({ type: 'shopResult', action: 'buy', item: null, ok: false })?.ok).toBe(false);
	});
});
