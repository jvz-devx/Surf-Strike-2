import { describe, expect, it } from 'vitest';
import { COSMETIC_SLOTS, defaultItem, emptyLoadout, getCosmetic, listCosmetics, registerCosmetic, sanitizeLoadout } from './cosmetics.ts';

describe('cosmetics', () => {
	it('ships only the default look', () => {
		expect(listCosmetics().map((i) => i.id)).toEqual(['top_default', 'bottom_default', 'shoes_default']);
		expect(listCosmetics().every((i) => i.isDefault)).toBe(true);
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
		expect(sanitizeLoadout(Object.create({ top: 'top_default' }))).toEqual(emptyLoadout());
	});
});
