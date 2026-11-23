/**
 * Cosmetic slots (docs/characters.md): slot ids, the `Loadout` type and the
 * item registry. Data only, so the server can validate loadouts; meshes are
 * registered on the client (`apps/web/src/lib/render/character/items.ts`).
 *
 * The registry holds only the default look. Shop items are added here later.
 */

/** Every cosmetic slot, in display order. */
export const COSMETIC_SLOTS = ['hat', 'glasses', 'top', 'bottom', 'shoes'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

/** Slot to item id. `null` is the slot's default look (nothing for hat and glasses). */
export type Loadout = Record<CosmeticSlot, string | null>;

export interface CosmeticItem {
	/** Unique and stable: it is what gets stored and sent. */
	id: string;
	slot: CosmeticSlot;
	/** Display name. */
	name: string;
	/** Worn when the slot is `null`; never sold. */
	isDefault?: boolean;
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
