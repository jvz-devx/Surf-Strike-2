/**
 * Cosmetics shop (docs/economy.md#shop): what an account owns and wears. The
 * prices and the stock are in `packages/shared/src/cosmetics.ts`, the coins in
 * `economy.ts`.
 */
import {
	COSMETIC_SLOTS,
	cosmeticPrice,
	emptyLoadout,
	getCosmetic,
	LOOTBOX,
	RARITIES,
	lootItems,
	rollLoot,
	sanitizeLoadout,
	shopItems,
	type ClientMessage,
	type CosmeticItem,
	type CosmeticSlot,
	type Loadout,
	type ServerMessage,
	type ShopOffer
} from '@surf/shared';
import { secureRandom } from './casino.ts';
import type { Db } from './db.ts';
import type { Economy } from './economy.ts';

export interface ShopPlayer {
	readonly id: number;
	readonly name: string;
	readonly accountId: number | null;
	loadout: Loadout;
}

export interface ShopHost<P extends ShopPlayer> {
	db: Db;
	economy(): Economy;
	send(p: P, msg: ServerMessage): void;
	broadcast(msg: ServerMessage): void;
	/** Chat line to everyone. */
	system(text: string): void;
	/** ms, for the fallback of the box announcement. */
	now(): number;
	log(msg: string): void;
}

export type ShopRequest = Extract<ClientMessage, { type: 'shopBuy' | 'shopEquip' }>;

/** A result the opener never reported as seen is announced after this long (the reel takes about 7 s). */
export const BOX_NEWS_MS = 12_000;

const ERRORS = {
	guest: 'Log in to buy and wear items.',
	busy: 'Too fast. Try again in a moment.',
	unknown: 'This item is not available on this server.',
	owned: 'You already own this item.',
	poor: 'Not enough coins.',
	notOwned: 'You do not own this item.',
	complete: 'You already own everything in this box.',
	bad: 'Invalid request.'
};

export class Shop<P extends ShopPlayer> {
	/** Results of opened boxes that were not announced yet, one per connection. */
	private readonly unseen = new Map<P, { name: string; item: CosmeticItem; duplicate: boolean; at: number }>();

	constructor(private readonly host: ShopHost<P>) {}

	/** Worn items of an account: only known items the account owns (the default look for guests). */
	loadoutOf(accountId: number | null): Loadout {
		if (accountId === null) return emptyLoadout();
		return sanitizeLoadout(this.host.db.equipped(accountId));
	}

	/** Stock, owned and worn items. */
	send(p: P): void {
		const items: ShopOffer[] = shopItems().map((i) => ({ id: i.id, price: cosmeticPrice(i)! }));
		const owned = p.accountId === null ? [] : this.host.db.ownedItems(p.accountId).filter((id) => getCosmetic(id));
		this.host.send(p, {
			type: 'shop',
			items,
			owned,
			loadout: p.loadout,
			box: { price: LOOTBOX.price, odds: LOOTBOX.odds, items: lootItems().map((i) => i.id) }
		});
	}

	/** The player logged in or out. */
	account(p: P): void {
		this.wear(p);
		this.send(p);
	}

	/** Read the worn items again; everyone hears about a change. */
	private wear(p: P): void {
		const next = this.loadoutOf(p.accountId);
		const changed = COSMETIC_SLOTS.some((s) => next[s] !== p.loadout[s]);
		p.loadout = next;
		if (changed) this.host.broadcast({ type: 'cosmetics', id: p.id, loadout: next });
	}

	/** `busy`: over the rate limit, refuse. */
	handle(p: P, msg: ShopRequest, busy = false): void {
		const buy = msg.type === 'shopBuy';
		const item: unknown = msg.item;
		const id = typeof item === 'string' ? item.slice(0, 64) : null;
		const error = busy ? ERRORS.busy : p.accountId === null ? ERRORS.guest : buy ? this.buy(p.accountId, id) : this.equip(p.accountId, msg.slot, item);
		if (error === null) {
			if (buy) this.host.log(`shop: account ${p.accountId} bought ${id}`);
			else this.wear(p);
			this.send(p);
		}
		this.host.send(p, { type: 'shopResult', action: buy ? 'buy' : 'equip', item: id, ok: error === null, ...(error === null ? {} : { error }) });
	}

	/** Buy and open a loot box. The item is rolled here, never by the client. `busy`: over the rate limit, refuse. */
	openBox(p: P, busy = false): void {
		const fail = (error: string) => this.host.send(p, { type: 'boxResult', ok: false, error });
		if (busy) return fail(ERRORS.busy);
		if (p.accountId === null) return fail(ERRORS.guest);
		const owned = new Set(this.host.db.ownedItems(p.accountId));
		if (lootItems().every((i) => owned.has(i.id))) return fail(ERRORS.complete);
		const item = rollLoot(secureRandom);
		if (!item) return fail(ERRORS.unknown);
		const r = this.host.economy().openBox(p.accountId, item);
		if (r === 'poor') return fail(ERRORS.poor);
		this.announce(p);
		this.unseen.set(p, { name: p.name, item, duplicate: r.duplicate, at: this.host.now() });
		this.host.log(`shop: account ${p.accountId} opened a loot box: ${item.id}${r.duplicate ? ' (duplicate)' : ''}`);
		this.send(p);
		this.host.send(p, { type: 'boxResult', ok: true, item: item.id, ...r });
	}

	/** Tell everyone what this player got, once: they have seen it, left, or opened another box. Without a result: nothing. */
	announce(p: P): void {
		const r = this.unseen.get(p);
		if (!r) return;
		this.unseen.delete(p);
		this.host.broadcast({ type: 'boxNews', id: p.id, name: r.name, item: r.item.id, duplicate: r.duplicate });
		const rarity = r.item.rarity;
		if (rarity === 'rare' || rarity === 'epic') this.host.system(`${r.name} found ${r.item.name} (${RARITIES[rarity].name}) in a loot box.`);
	}

	/** Announce results whose opener stayed silent for too long (older clients, hidden tabs). */
	tick(): void {
		if (this.unseen.size === 0) return;
		const now = this.host.now();
		for (const [p, r] of this.unseen) if (now - r.at >= BOX_NEWS_MS) this.announce(p);
	}

	/** Give an item for free (admin). False when it is already owned. */
	give(p: P, itemId: string, at: number): boolean {
		if (p.accountId === null || !this.host.db.giveItem(p.accountId, itemId, at)) return false;
		this.send(p);
		this.host.send(p, { type: 'coinsNotice', text: `An admin gave you an item: ${getCosmetic(itemId)?.name ?? itemId}.`, tone: 'info' });
		return true;
	}

	/** Take an item away (admin), also when it is worn. False when it is not owned. */
	take(p: P, itemId: string): boolean {
		if (p.accountId === null || !this.host.db.takeItem(p.accountId, itemId)) return false;
		this.account(p);
		this.host.send(p, { type: 'coinsNotice', text: `An admin removed an item: ${getCosmetic(itemId)?.name ?? itemId}.`, tone: 'info' });
		return true;
	}

	private buy(accountId: number, id: string | null): string | null {
		const item = id === null ? undefined : getCosmetic(id);
		if (!item) return ERRORS.unknown;
		const r = this.host.economy().buy(accountId, item);
		return r === 'ok' ? null : ERRORS[r];
	}

	private equip(accountId: number, slot: unknown, item: unknown): string | null {
		if (!COSMETIC_SLOTS.includes(slot as CosmeticSlot)) return ERRORS.bad;
		if (item !== null) {
			if (typeof item !== 'string') return ERRORS.bad;
			const def = getCosmetic(item);
			if (!def) return ERRORS.unknown;
			if (def.slot !== slot) return ERRORS.bad;
		}
		return this.host.db.equip(accountId, slot as CosmeticSlot, item) ? null : ERRORS.notOwned;
	}
}
