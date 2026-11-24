import { describe, expect, it } from 'vitest';
import { COSMETIC_SLOTS, cosmeticPrice, defaultItem, emptyLoadout, getCosmetic, isEmptyLoadout, listCosmetics, LOOTBOX, lootChances, lootItems, RARITIES, registerCosmetic, rollLoot, sanitizeLoadout, shopItems, type CosmeticSlot } from './cosmetics.ts';
import { awardLabel, pts } from './economy.ts';

describe('cosmetics', () => {
	it('sells 18 basic items at 30 coins, next to the default look', () => {
		const sold = shopItems();
		const n = (slot: CosmeticSlot) => sold.filter((i) => i.slot === slot).length;
		expect([n('hat'), n('glasses'), n('top'), n('bottom'), n('shoes')]).toEqual([3, 3, 3, 3, 6]);
		expect(new Set(sold.map((i) => i.name)).size).toBe(18);
		for (const i of sold) {
			expect(i.rarity).toBe('basic');
			expect(cosmeticPrice(i)).toBe(pts(30));
			expect(awardLabel(`shop:${i.id}`)).toBe(`Shop: ${i.name}`);
		}
		expect(listCosmetics().filter((i) => i.isDefault).map((i) => i.id)).toEqual(['top_default', 'bottom_default', 'shoes_default']);
		expect(listCosmetics()).toHaveLength(79);
		// Default items are never for sale, whatever their rarity.
		expect(cosmeticPrice({ id: 'x', slot: 'top', name: 'x', isDefault: true, rarity: 'basic' })).toBeNull();
		for (const r of Object.values(RARITIES)) expect((r.price === null || (Number.isInteger(r.price) && r.price > 0)) && /^#[0-9a-f]{6}$/.test(r.color) && r.name !== '').toBe(true);
	});

	it('loot rarities are not sold; the loot box costs 80 coins', () => {
		expect(Object.keys(RARITIES)).toEqual(['basic', 'common', 'uncommon', 'rare', 'epic']);
		expect(cosmeticPrice(getCosmetic('hat_frycook')!)).toBeNull();
		expect(LOOTBOX).toMatchObject({ price: pts(80), odds: { common: 80, uncommon: 10, rare: 5, epic: 1 } });
		for (const r of Object.keys(LOOTBOX.odds)) expect(RARITIES[r as keyof typeof RARITIES].price).toBeNull();
	});

	it('a loot box holds every common or better item, never basic or default ones', () => {
		const items = lootItems();
		expect(items).toHaveLength(58);
		expect(items.every((i) => i.rarity !== 'basic' && !i.isDefault)).toBe(true);
		expect(items.filter((i) => i.slot === 'effect').map((i) => i.rarity)).toEqual([...Array<string>(10).fill('rare'), 'epic']);
		for (const r of Object.keys(LOOTBOX.odds) as (keyof typeof LOOTBOX.odds)[]) expect(LOOTBOX.refund[r]).toBeLessThanOrEqual(LOOTBOX.price);
		expect(lootChances().map((g) => [g.rarity, g.items.length])).toEqual([['common', 31], ['uncommon', 10], ['rare', 14], ['epic', 3]]);
	});

	it('rolls by weight, whatever the odds add up to', () => {
		const items = (['common', 'uncommon', 'rare', 'epic', 'basic'] as const).flatMap((rarity) =>
			[1, 2].map((n) => ({ id: `${rarity}${n}`, slot: 'hat' as const, name: 'x', rarity }))
		);
		const chances = lootChances(items);
		expect(chances.map((g) => g.rarity)).toEqual(['common', 'uncommon', 'rare', 'epic']);
		expect(chances.reduce((n, g) => n + g.chance, 0)).toBeCloseTo(1);
		expect(chances[0]!.chance).toBeCloseTo(80 / 96);
		const seq = (...v: number[]) => () => v.shift()!;
		expect(rollLoot(seq(0, 0), items)?.id).toBe('common1');
		expect(rollLoot(seq(0.83, 0.99), items)?.id).toBe('common2');
		expect(rollLoot(seq(0.84, 0), items)?.id).toBe('uncommon1');
		expect(rollLoot(seq(0.95, 0.5), items)?.id).toBe('rare2');
		expect(rollLoot(seq(0.9999999999, 0.9999999999), items)?.id).toBe('epic2');
		// Measured with a fixed generator.
		let s = 1;
		const rand = () => (s = (s * 48271) % 2147483647) / 2147483647;
		const n = 50_000;
		const hits: Record<string, number> = {};
		for (let i = 0; i < n; i++) {
			const r = rollLoot(rand, items)!.rarity!;
			hits[r] = (hits[r] ?? 0) + 1;
		}
		for (const g of chances) expect(hits[g.rarity]! / n).toBeCloseTo(g.chance, 1.9);
		expect(hits.basic).toBeUndefined();
		expect(rollLoot(rand, [])).toBeNull();
	});

	it('keeps the stored ids', () => {
		// These are in players' databases: never rename or remove one.
		expect(listCosmetics().map((i) => i.id)).toEqual(
			expect.arrayContaining([
				'hat_cap', 'hat_beanie', 'hat_straw', 'hat_frycook', 'glasses_shades', 'glasses_round', 'top_sunset', 'top_halves', 'top_checker',
				'bottom_boardshorts', 'bottom_joggers', 'bottom_cargo', 'shoes_hightops', 'shoes_slides', 'shoes_boots', 'shoes_slipons',
				'glasses_slim', 'shoes_canvas', 'shoes_clogs',
				'hat_bucket', 'hat_trilby', 'hat_bandana', 'glasses_aviator', 'glasses_wrap', 'top_hoodie',
				'top_floral', 'top_varsity', 'bottom_jeans', 'bottom_track', 'shoes_runners', 'shoes_chelsea',
				'hat_newsboy', 'hat_snapback', 'hat_headphones', 'glasses_cateye', 'glasses_reading', 'top_denim',
				'top_flannel', 'top_rugby', 'bottom_corduroy', 'bottom_court', 'shoes_loafers', 'shoes_skate',
				'hat_shark', 'hat_propeller', 'glasses_pixel', 'top_skeleton', 'bottom_lava', 'shoes_duck',
				'glasses_suit', 'top_suit', 'bottom_suit', 'shoes_suit', 'hat_darkhelm', 'hat_joker',
				'effect_blue', 'effect_yellow', 'effect_red', 'effect_purple', 'effect_black', 'effect_orange', 'effect_pink', 'effect_white', 'effect_green', 'effect_gray', 'effect_fire',
				'hat_trapper', 'glasses_shutter', 'top_puffer', 'bottom_plaid', 'bottom_patch', 'shoes_rain',
				'glasses_googly', 'top_astronaut', 'bottom_robot', 'shoes_rocket'
			])
		);
	});

	it('has defaults for clothing and none for accessories', () => {
		expect(COSMETIC_SLOTS.map((s) => defaultItem(s)?.id ?? null)).toEqual([null, null, 'top_default', 'bottom_default', 'shoes_default', null]);
		expect(emptyLoadout()).toEqual({ hat: null, glasses: null, top: null, bottom: null, shoes: null, effect: null });
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
