/**
 * Cosmetic slots (docs/characters.md): slot ids, the `Loadout` type and the
 * item registry. Data only, so the server can validate loadouts; meshes are
 * registered on the client (`apps/web/src/lib/render/character/items.ts`).
 *
 * Items with a rarity are sold in the shop (docs/economy.md#shop); the price
 * belongs to the rarity. To add an item: one line in SHOP_ITEMS here, and its
 * mesh in `apps/web/src/lib/render/character/` (`shop-items.ts` or `common/`).
 */

/** Every cosmetic slot, in display order. */
export const COSMETIC_SLOTS = ['hat', 'glasses', 'top', 'bottom', 'shoes'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

/** Slot to item id. `null` is the slot's default look (nothing for hat and glasses). */
export type Loadout = Record<CosmeticSlot, string | null>;

export interface Rarity {
	name: string;
	/** CSS colour of the label. */
	color: string;
	/** Price in the shop in tenths of a coin (docs/economy.md); null = not sold, only found in loot boxes. */
	price: number | null;
}

/** Rarity levels, most common first. */
export const RARITIES = Object.freeze({
	basic: { name: 'Basic', color: '#9fc3dc', price: 300 },
	common: { name: 'Common', color: '#b9c2c9', price: null },
	uncommon: { name: 'Uncommon', color: '#6fcf7f', price: null },
	rare: { name: 'Rare', color: '#4f9bff', price: null },
	epic: { name: 'Epic', color: '#b36bff', price: null }
}) satisfies Readonly<Record<string, Rarity>>;
export type RarityId = keyof typeof RARITIES;

/** Loot box (docs/economy.md#loot-box). `odds` are weights: they need not add up to 100 (lootChances). */
export const LOOTBOX = Object.freeze({
	id: 'lootbox',
	name: 'Loot box',
	/** Tenths of a coin. */
	price: 800,
	odds: Object.freeze({ common: 80, uncommon: 10, rare: 5, epic: 1 }) satisfies Partial<Record<RarityId, number>>,
	/** Tenths of a coin given back for an item the player already owns. */
	refund: Object.freeze({ common: 200, uncommon: 400, rare: 600, epic: 800 }) satisfies Partial<Record<RarityId, number>>
});
export type LootRarity = keyof typeof LOOTBOX.odds;
export type LootOdds = Readonly<Partial<Record<RarityId, number>>>;

export interface CosmeticItem {
	/** Unique and stable: it is what gets stored and sent. */
	id: string;
	slot: CosmeticSlot;
	/** Display name. */
	name: string;
	/** Worn when the slot is `null`; never sold. */
	isDefault?: boolean;
	/** Sold in the shop if this rarity has a price; absent = not for sale. */
	rarity?: RarityId;
}

const REGISTRY = new Map<string, CosmeticItem>();

/** Add an item. Throws on a duplicate id. */
export function registerCosmetic(item: CosmeticItem): void {
	if (REGISTRY.has(item.id)) throw new Error(`Duplicate cosmetic "${item.id}"`);
	REGISTRY.set(item.id, Object.freeze({ ...item }));
}

export function getCosmetic(id: string): CosmeticItem | undefined {
	return REGISTRY.get(id);
}

/** All registered items, optionally of one slot. */
export function listCosmetics(slot?: CosmeticSlot): CosmeticItem[] {
	const all = [...REGISTRY.values()];
	return slot ? all.filter((i) => i.slot === slot) : all;
}

/** Price in tenths of a coin, or null when the item is not for sale. */
export function cosmeticPrice(item: CosmeticItem): number | null {
	return item.rarity && !item.isDefault ? RARITIES[item.rarity].price : null;
}

/** Everything the shop sells, in display order. */
export function shopItems(): CosmeticItem[] {
	return listCosmetics().filter((i) => cosmeticPrice(i) !== null);
}

/** Everything a loot box can hold, in display order. */
export function lootItems(): CosmeticItem[] {
	return listCosmetics().filter((i) => !i.isDefault && i.rarity !== undefined && i.rarity in LOOTBOX.odds);
}

/** Chance (0..1) of each rarity that has items, most common first. Rarities without items drop out, the rest share their weight. */
export function lootChances(items: readonly CosmeticItem[] = lootItems(), odds: LootOdds = LOOTBOX.odds): { rarity: RarityId; chance: number; items: CosmeticItem[] }[] {
	const groups = (Object.keys(RARITIES) as RarityId[])
		.map((rarity) => ({ rarity, chance: odds[rarity] ?? 0, items: items.filter((i) => i.rarity === rarity) }))
		.filter((g) => g.chance > 0 && g.items.length > 0);
	const total = groups.reduce((n, g) => n + g.chance, 0);
	return groups.map((g) => ({ ...g, chance: g.chance / total }));
}

/** Pick an item: the rarity by its chance, then any of its items equally. `rand` gives [0, 1). Null when there is nothing to win. */
export function rollLoot(rand: () => number, items: readonly CosmeticItem[] = lootItems(), odds: LootOdds = LOOTBOX.odds): CosmeticItem | null {
	const groups = lootChances(items, odds);
	if (groups.length === 0) return null;
	let r = rand();
	const g = groups.find((x) => (r -= x.chance) < 0) ?? groups[groups.length - 1]!;
	return g.items[Math.min(g.items.length - 1, Math.floor(rand() * g.items.length))]!;
}

/** Nothing is equipped. */
export function isEmptyLoadout(l: Loadout): boolean {
	return COSMETIC_SLOTS.every((s) => l[s] === null);
}

/** The default item of a slot, or null when the slot is empty by default. */
export function defaultItem(slot: CosmeticSlot): CosmeticItem | null {
	for (const i of REGISTRY.values()) if (i.slot === slot && i.isDefault) return i;
	return null;
}

/** The default look: nothing equipped. */
export function emptyLoadout(): Loadout {
	return { hat: null, glasses: null, top: null, bottom: null, shoes: null };
}

/**
 * A valid loadout from untrusted data: unknown slots are dropped, and ids that
 * are unknown or belong to another slot become null.
 */
export function sanitizeLoadout(v: unknown): Loadout {
	const out = emptyLoadout();
	if (typeof v !== 'object' || v === null) return out;
	const src = v as Record<string, unknown>;
	for (const slot of COSMETIC_SLOTS) {
		if (!Object.hasOwn(src, slot)) continue;
		const id = src[slot];
		if (typeof id === 'string' && REGISTRY.get(id)?.slot === slot) out[slot] = id;
	}
	return out;
}

registerCosmetic({ id: 'top_default', slot: 'top', name: 'Surf tee', isDefault: true });
registerCosmetic({ id: 'bottom_default', slot: 'bottom', name: 'Trousers', isDefault: true });
registerCosmetic({ id: 'shoes_default', slot: 'shoes', name: 'Sneakers', isDefault: true });

/** The items: 15 basic ones in the shop, the others for loot boxes. Ids are stored in the database: never rename or reuse one. */
const SHOP_ITEMS: readonly Required<Omit<CosmeticItem, 'isDefault'>>[] = [
	{ id: 'hat_cap', slot: 'hat', name: 'Breakline cap', rarity: 'basic' },
	{ id: 'hat_beanie', slot: 'hat', name: 'Pom beanie', rarity: 'basic' },
	{ id: 'hat_straw', slot: 'hat', name: 'Straw hat', rarity: 'basic' },
	{ id: 'hat_frycook', slot: 'hat', name: 'Fry cook hat', rarity: 'common' },
	{ id: 'glasses_shades', slot: 'glasses', name: 'Glare shades', rarity: 'basic' },
	{ id: 'glasses_round', slot: 'glasses', name: 'Round shades', rarity: 'basic' },
	{ id: 'top_sunset', slot: 'top', name: 'Sunset tee', rarity: 'basic' },
	{ id: 'top_halves', slot: 'top', name: 'Half-and-half tee', rarity: 'basic' },
	{ id: 'top_checker', slot: 'top', name: 'Checker tee', rarity: 'basic' },
	{ id: 'bottom_boardshorts', slot: 'bottom', name: 'Boardshorts', rarity: 'basic' },
	{ id: 'bottom_joggers', slot: 'bottom', name: 'Joggers', rarity: 'basic' },
	{ id: 'bottom_cargo', slot: 'bottom', name: 'Cargo pants', rarity: 'basic' },
	{ id: 'shoes_hightops', slot: 'shoes', name: 'High-tops', rarity: 'basic' },
	{ id: 'shoes_slides', slot: 'shoes', name: 'Beach slides', rarity: 'basic' },
	{ id: 'shoes_boots', slot: 'shoes', name: 'Trail boots', rarity: 'basic' },
	{ id: 'shoes_slipons', slot: 'shoes', name: 'Slip-ons', rarity: 'basic' },
	{ id: 'hat_bucket', slot: 'hat', name: 'Palm bucket hat', rarity: 'common' },
	{ id: 'hat_trilby', slot: 'hat', name: 'Trilby', rarity: 'common' },
	{ id: 'hat_bandana', slot: 'hat', name: 'Wave bandana', rarity: 'common' },
	{ id: 'glasses_aviator', slot: 'glasses', name: 'Gold aviators', rarity: 'common' },
	{ id: 'glasses_wrap', slot: 'glasses', name: 'Sport wraps', rarity: 'common' },
	{ id: 'top_hoodie', slot: 'top', name: 'Zip hoodie', rarity: 'common' },
	{ id: 'top_floral', slot: 'top', name: 'Floral shirt', rarity: 'common' },
	{ id: 'top_varsity', slot: 'top', name: 'Varsity jacket', rarity: 'common' },
	{ id: 'bottom_jeans', slot: 'bottom', name: 'Cuffed jeans', rarity: 'common' },
	{ id: 'bottom_track', slot: 'bottom', name: 'Track pants', rarity: 'common' },
	{ id: 'shoes_runners', slot: 'shoes', name: 'Pulse runners', rarity: 'common' },
	{ id: 'shoes_chelsea', slot: 'shoes', name: 'Chelsea boots', rarity: 'common' }
];
for (const item of SHOP_ITEMS) registerCosmetic(item);
