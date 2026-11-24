/** Shop and inventory state of the client (docs/ui.md#shop), pure: server messages in, what the menus show out. */
import {
	COSMETIC_SLOTS,
	cosmeticPrice,
	defaultItem,
	formatTenths,
	getCosmetic,
	listCosmetics,
	lootChances,
	RARITIES,
	rollLoot,
	sanitizeLoadout,
	type BoxOffer,
	type CosmeticItem,
	type CosmeticSlot,
	type RarityId,
	type ServerMessage
} from '@surf/shared';
import type { ShopView } from './contract.js';

/** A `shop` message of any server version: unknown items and malformed entries are dropped. */
export function parseShop(m: Extract<ServerMessage, { type: 'shop' }>): Pick<ShopView, 'items' | 'owned' | 'loadout' | 'box'> {
	const items = Array.isArray(m.items) ? m.items : [];
	const owned = Array.isArray(m.owned) ? m.owned : [];
	return {
		items: items.filter((i) => i && typeof i.id === 'string' && Number.isFinite(i.price) && getCosmetic(i.id)),
		owned: [...new Set(owned)].filter((id) => typeof id === 'string' && getCosmetic(id)),
		loadout: sanitizeLoadout(m.loadout),
		box: parseBox(m.box)
	};
}

function parseBox(b: unknown): BoxOffer | null {
	const { price, items, odds } = (b ?? {}) as Partial<BoxOffer>;
	if (typeof price !== 'number' || !Number.isFinite(price) || !Array.isArray(items) || typeof odds !== 'object' || odds === null) return null;
	const known = items.filter((id) => typeof id === 'string' && getCosmetic(id));
	const weights = Object.fromEntries(Object.entries(odds).filter(([r, w]) => Object.hasOwn(RARITIES, r) && typeof w === 'number' && w > 0));
	return known.length > 0 ? { price, items: known, odds: weights } : null;
}

export interface BoxContents {
	/** Rarities that can drop, rarest last, with their real chance. */
	groups: ReturnType<typeof lootChances>;
	items: CosmeticItem[];
	/** Everything in it is owned. */
	complete: boolean;
}

export function boxContents(box: BoxOffer, owned: readonly string[]): BoxContents {
	const items = box.items.map((id) => getCosmetic(id)).filter((i) => i !== undefined);
	const groups = lootChances(items, box.odds);
	return { groups, items: groups.flatMap((g) => g.items), complete: items.every((i) => owned.includes(i.id)) };
}

/** Cards that pass by on the reel; the won item is at `win`. Every card is drawn with the real odds. */
export function boxReel(box: BoxOffer, won: CosmeticItem, length: number, win: number, rand: () => number = Math.random): CosmeticItem[] {
	const items = box.items.map((id) => getCosmetic(id)).filter((i) => i !== undefined);
	return Array.from({ length }, (_, i) => (i === win ? won : (rollLoot(rand, items, box.odds) ?? won)));
}

/** `83.3 %`; more digits for small chances. */
export function chanceLabel(chance: number): string {
	const p = chance * 100;
	return `${p >= 10 ? Math.round(p * 10) / 10 : Math.round(p * 100) / 100} %`;
}

export function shopNotice(m: Extract<ServerMessage, { type: 'shopResult' }>): ShopView['notice'] {
	if (!m.ok) return { ok: false, text: m.error ?? 'That did not work. Try again.' };
	if (m.action !== 'buy') return null;
	return { ok: true, text: `${(m.item && getCosmetic(m.item)?.name) || 'Item'} bought.`, ...(m.item ? { bought: m.item } : {}) };
}

export type ItemState = 'owned' | 'buy' | 'poor' | 'guest';

export function itemState(item: CosmeticItem, price: number, shop: ShopView, balance: number, loggedIn: boolean): ItemState {
	if (shop.owned.includes(item.id)) return 'owned';
	if (!loggedIn) return 'guest';
	return balance >= price ? 'buy' : 'poor';
}

/** Coins still missing, for display (never shows 0 while something is missing). */
export function missingCoins(price: number, balance: number): string {
	return formatTenths(Math.max(0, price - balance));
}

export const SHOP_CATEGORIES: readonly { slot: CosmeticSlot; label: string }[] = [
	{ slot: 'hat', label: 'Hats' },
	{ slot: 'glasses', label: 'Sunglasses' },
	{ slot: 'top', label: 'Tops' },
	{ slot: 'bottom', label: 'Pants' },
	{ slot: 'shoes', label: 'Shoes' }
];

export interface ShopEntry {
	item: CosmeticItem;
	/** Tenths of a coin, from the server. */
	price: number;
}

/**
 * What the shop lists: items both sides know and sell, in this client's order, at the
 * server's prices. Owned ones come last. Loot-only items never appear here.
 */
export function shopEntries(shop: ShopView): ShopEntry[] {
	const price = new Map(shop.items.map((i) => [i.id, i.price]));
	const owned = new Set(shop.owned);
	const entries = listCosmetics()
		.filter((i) => cosmeticPrice(i) !== null && price.has(i.id))
		.map((item) => ({ item, price: price.get(item.id)! }));
	return [...entries.filter((e) => !owned.has(e.item.id)), ...entries.filter((e) => owned.has(e.item.id))];
}

// ---------------------------------------------------------------------------
// Inventory

export interface InventoryEntry {
	/** Item id, or `default:<slot>`. */
	key: string;
	slot: CosmeticSlot;
	/** Drawn on the card; null: nothing to draw (no hat, no glasses). */
	drawn: string | null;
	/** Sent when worn; null is the slot's default look. */
	wear: string | null;
	name: string;
	/** null: the default look. */
	rarity: RarityId | null;
	worn: boolean;
}

const NO_ITEM: Partial<Record<CosmeticSlot, string>> = { hat: 'No hat', glasses: 'No glasses' };
/** Most common first. */
const RARITY_ORDER = Object.keys(RARITIES) as RarityId[];
const rarityRank = (r: RarityId | null) => (r === null ? -1 : RARITY_ORDER.indexOf(r));

/** The default look of every slot, then every owned item this client knows. */
export function inventoryEntries(shop: ShopView): InventoryEntry[] {
	const defaults = COSMETIC_SLOTS.map((slot): InventoryEntry => {
		const item = defaultItem(slot);
		const worn = shop.loadout[slot] === null || shop.loadout[slot] === item?.id;
		return { key: `default:${slot}`, slot, drawn: item?.id ?? null, wear: null, name: item?.name ?? NO_ITEM[slot] ?? 'Nothing', rarity: null, worn };
	});
	const owned = new Set(shop.owned);
	const items = listCosmetics()
		.filter((i) => !i.isDefault && owned.has(i.id))
		.map((i): InventoryEntry => ({
			key: i.id,
			slot: i.slot,
			drawn: i.id,
			wear: i.id,
			name: i.name,
			rarity: i.rarity ?? 'basic',
			worn: shop.loadout[i.slot] === i.id
		}));
	return [...defaults, ...items];
}

/** Rarities the player has an item of, most common first. */
export function ownedRarities(entries: readonly InventoryEntry[]): RarityId[] {
	return RARITY_ORDER.filter((r) => entries.some((e) => e.rarity === r));
}

export type InventorySort = 'rarity' | 'name';

export interface InventoryFilter {
	slot?: CosmeticSlot | null;
	rarity?: RarityId | null;
	/** Every word must match the name, category or rarity. */
	query?: string;
}

/** The entries that match; does not sort. The default look has no rarity, so a rarity filter hides it. */
export function filterInventory(entries: readonly InventoryEntry[], f: InventoryFilter): InventoryEntry[] {
	const words = (f.query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
	return entries.filter((e) => {
		if (f.slot && e.slot !== f.slot) return false;
		if (f.rarity && e.rarity !== f.rarity) return false;
		if (words.length === 0) return true;
		const label = SHOP_CATEGORIES.find((c) => c.slot === e.slot)?.label ?? '';
		const hay = `${e.name} ${label} ${e.rarity ? RARITIES[e.rarity].name : 'default'}`.toLowerCase();
		return words.every((w) => hay.includes(w));
	});
}

/** By rarity (rarest first, default look last) or by name; ties by slot and name. Does not mutate. */
export function sortInventory(entries: readonly InventoryEntry[], by: InventorySort): InventoryEntry[] {
	const slot = (e: InventoryEntry) => COSMETIC_SLOTS.indexOf(e.slot);
	const name = (a: InventoryEntry, b: InventoryEntry) => a.name.localeCompare(b.name);
	return [...entries].sort((a, b) => {
		if (by === 'name') return name(a, b) || slot(a) - slot(b);
		return rarityRank(b.rarity) - rarityRank(a.rarity) || slot(a) - slot(b) || name(a, b);
	});
}
