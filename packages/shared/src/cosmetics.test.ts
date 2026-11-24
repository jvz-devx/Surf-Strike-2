import { describe, expect, it } from 'vitest';
import { COSMETIC_SLOTS, cosmeticPrice, defaultItem, emptyLoadout, getCosmetic, isEmptyLoadout, listCosmetics, LOOTBOX, RARITIES, registerCosmetic, sanitizeLoadout, shopItems, type CosmeticSlot } from './cosmetics.ts';
import { awardLabel, pts } from './economy.ts';

describe('cosmetics', () => {
	it('sells 13 basic items at 75 coins, next to the default look', () => {
		const sold = shopItems();
		const n = (slot: CosmeticSlot) => sold.filter((i) => i.slot === slot).length;
		expect([n('hat'), n('glasses'), n('top'), n('bottom'), n('shoes')]).toEqual([3, 1, 3, 3, 3]);
		expect(new Set(sold.map((i) => i.name)).size).toBe(13);
		for (const i of sold) {
			expect(i.rarity).toBe('basic');
			expect(cosmeticPrice(i)).toBe(pts(75));
			expect(awardLabel(`shop:${i.id}`)).toBe(`Shop: ${i.name}`);
		}
		expect(listCosmetics().filter((i) => i.isDefault).map((i) => i.id)).toEqual(['top_default', 'bottom_default', 'shoes_default']);
		expect(listCosmetics()).toHaveLength(17);
		// Default items are never for sale, whatever their rarity.
		expect(cosmeticPrice({ id: 'x', slot: 'top', name: 'x', isDefault: true, rarity: 'basic' })).toBeNull();
		for (const r of Object.values(RARITIES)) expect((r.price === null || (Number.isInteger(r.price) && r.price > 0)) && /^#[0-9a-f]{6}$/.test(r.color) && r.name !== '').toBe(true);
	});

	it('loot rarities are not sold; the loot box costs 120 coins and is not usable yet', () => {
		expect(Object.keys(RARITIES)).toEqual(['basic', 'common', 'uncommon', 'rare', 'epic']);
		expect(cosmeticPrice(getCosmetic('hat_frycook')!)).toBeNull();
		expect(LOOTBOX).toMatchObject({ price: pts(120), available: false, odds: { common: 80, uncommon: 10, rare: 5, epic: 1 } });
		for (const r of Object.keys(LOOTBOX.odds)) expect(RARITIES[r as keyof typeof RARITIES].price).toBeNull();
	});

	it('keeps the stored ids', () => {
		// These are in players' databases: never rename or remove one.
		expect(listCosmetics().map((i) => i.id)).toEqual(
			expect.arrayContaining([
				'hat_cap', 'hat_beanie', 'hat_straw', 'hat_frycook', 'glasses_shades', 'top_sunset', 'top_halves', 'top_checker',
				'bottom_boardshorts', 'bottom_joggers', 'bottom_cargo', 'shoes_hightops', 'shoes_slides', 'shoes_boots'
			])
		);
	});

	it('has defaults for clothing and none for accessories', () => {
		expect(COSMETIC_SLOTS.map((s) => defaultItem(s)?.id ?? null)).toEqual([null, null, 'top_default', 'bottom_default', 'shoes_default']);
		expect(emptyLoadout()).toEqual({ hat: null, glasses: null, top: null, bottom: null, shoes: null });
	});

	it('refuses duplicate ids', () => {
		expect(() => registerCosmetic({ id: 'top_default', slot: 'top', name: 'x' })).toThrow(/Duplicate/);
		expect(getCosmetic('top_default')?.name).toBe('Surf tee');
	});

	it('sanitizes untrusted loadouts', () => {
		for (const bad of [null, undefined, 3, 'x', []]) expect(sanitizeLoadout(bad)).toEqual(emptyLoadout());
		expect(sanitizeLoadout({ top: 'top_default', hat: 'top_default', shoes: 'nope', bottom: 7, extra: 'x' })).toEqual({
			...emptyLoadout(),
			top: 'top_default'
		});
		expect(sanitizeLoadout({ hat: 'hat_cap', glasses: 'hat_cap' })).toEqual({ ...emptyLoadout(), hat: 'hat_cap' });
		expect(isEmptyLoadout(sanitizeLoadout({ hat: 'hat_of_2030' }))).toBe(true);
		expect(isEmptyLoadout(sanitizeLoadout({ hat: 'hat_cap' }))).toBe(false);
		expect(sanitizeLoadout(Object.create({ top: 'top_default' }))).toEqual(emptyLoadout());
	});
});
