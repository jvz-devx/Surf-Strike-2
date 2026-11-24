/** Shop state of the client (docs/ui.md#shop), pure: server messages in, what the menu shows out. */
import { formatTenths, getCosmetic, sanitizeLoadout, shopItems, type CosmeticItem, type CosmeticSlot, type ServerMessage } from '@surf/shared';
import type { ShopView } from './contract.js';

/** A `shop` message of any server version: unknown items and malformed entries are dropped. */
export function parseShop(m: Extract<ServerMessage, { type: 'shop' }>): Pick<ShopView, 'items' | 'owned' | 'loadout'> {
	const items = Array.isArray(m.items) ? m.items : [];
	const owned = Array.isArray(m.owned) ? m.owned : [];
	return {
		items: items.filter((i) => i && typeof i.id === 'string' && Number.isFinite(i.price) && getCosmetic(i.id)),
		owned: owned.filter((id) => typeof id === 'string' && getCosmetic(id)),
		loadout: sanitizeLoadout(m.loadout)
	};
}

export function shopNotice(m: Extract<ServerMessage, { type: 'shopResult' }>): ShopView['notice'] {
	if (!m.ok) return { ok: false, text: m.error ?? 'That did not work. Try again.' };
	if (m.action !== 'buy') return null;
	return { ok: true, text: `${(m.item && getCosmetic(m.item)?.name) || 'Item'} bought.` };
}

export type ItemState = 'equipped' | 'owned' | 'buy' | 'poor' | 'guest';

export function itemState(item: CosmeticItem, price: number, shop: ShopView, balance: number, loggedIn: boolean): ItemState {
	if (shop.loadout[item.slot] === item.id) return 'equipped';
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
	{ slot: 'top', label: 'T-shirts' },
	{ slot: 'bottom', label: 'Pants' },
	{ slot: 'shoes', label: 'Shoes' }
];

export interface ShopEntry {
	item: CosmeticItem;
	/** Tenths of a coin, from the server. */
	price: number;
}

/** What the menu lists: items both sides know, in this client's order, at the server's prices. */
export function shopEntries(shop: ShopView): ShopEntry[] {
	const price = new Map(shop.items.map((i) => [i.id, i.price]));
	return shopItems()
		.filter((i) => price.has(i.id))
		.map((item) => ({ item, price: price.get(item.id)! }));
}
