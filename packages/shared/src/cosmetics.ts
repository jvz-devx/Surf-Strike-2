/**
 * Cosmetic slots (docs/characters.md): slot ids, the `Loadout` type and the
 * item registry. Data only, so the server can validate loadouts; meshes are
 * registered on the client (`apps/web/src/lib/render/character/items.ts`).
 *
 * Items with a rarity are sold in the shop (docs/economy.md#shop); the price
 * belongs to the rarity. To add an item: one line in SHOP_ITEMS here, and its
 * mesh in `apps/web/src/lib/render/character/shop-items.ts`.
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
	/** Tenths of a coin (docs/economy.md). */
	price: number;
}

/** Rarity levels, cheapest first. */
export const RARITIES = Object.freeze({
	basic: { name: 'Basic', color: '#9fc3dc', price: 750 }
}) satisfies Readonly<Record<string, Rarity>>;
export type RarityId = keyof typeof RARITIES;

export interface CosmeticItem {
	/** Unique and stable: it is what gets stored and sent. */
	id: string;
	slot: CosmeticSlot;
	/** Display name. */
	name: string;
	/** Worn when the slot is `null`; never sold. */
	isDefault?: boolean;
	/** Sold in the shop at this rarity's price; absent = not for sale. */
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

/** The shop's stock: 13 basic items. Ids are stored in the database: never rename or reuse one. */
const SHOP_ITEMS: readonly Required<Omit<CosmeticItem, 'isDefault'>>[] = [
	{ id: 'hat_cap', slot: 'hat', name: 'Breakline cap', rarity: 'basic' },
	{ id: 'hat_beanie', slot: 'hat', name: 'Pom beanie', rarity: 'basic' },
	{ id: 'hat_straw', slot: 'hat', name: 'Straw hat', rarity: 'basic' },
	{ id: 'glasses_shades', slot: 'glasses', name: 'Glare shades', rarity: 'basic' },
	{ id: 'top_sunset', slot: 'top', name: 'Sunset tee', rarity: 'basic' },
	{ id: 'top_halves', slot: 'top', name: 'Half-and-half tee', rarity: 'basic' },
	{ id: 'top_checker', slot: 'top', name: 'Checker tee', rarity: 'basic' },
	{ id: 'bottom_boardshorts', slot: 'bottom', name: 'Boardshorts', rarity: 'basic' },
	{ id: 'bottom_joggers', slot: 'bottom', name: 'Joggers', rarity: 'basic' },
	{ id: 'bottom_cargo', slot: 'bottom', name: 'Cargo pants', rarity: 'basic' },
	{ id: 'shoes_hightops', slot: 'shoes', name: 'High-tops', rarity: 'basic' },
	{ id: 'shoes_slides', slot: 'shoes', name: 'Beach slides', rarity: 'basic' },
	{ id: 'shoes_boots', slot: 'shoes', name: 'Trail boots', rarity: 'basic' }
];
for (const item of SHOP_ITEMS) registerCosmetic(item);
