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
	sanitizeLoadout,
	shopItems,
	type ClientMessage,
	type CosmeticSlot,
	type Loadout,
	type ServerMessage,
	type ShopOffer
} from '@surf/shared';
import type { Db } from './db.ts';
import type { Economy } from './economy.ts';

export interface ShopPlayer {
	readonly id: number;
	readonly accountId: number | null;
	loadout: Loadout;
}

export interface ShopHost<P extends ShopPlayer> {
	db: Db;
	economy(): Economy;
	send(p: P, msg: ServerMessage): void;
	broadcast(msg: ServerMessage): void;
	log(msg: string): void;
}

export type ShopRequest = Extract<ClientMessage, { type: 'shopBuy' | 'shopEquip' }>;

const ERRORS = {
	guest: 'Log in to buy and wear items.',
	busy: 'Too fast. Try again in a moment.',
	unknown: 'This item is not available on this server.',
	owned: 'You already own this item.',
	poor: 'Not enough coins.',
	notOwned: 'You do not own this item.',
	bad: 'Invalid request.'
};

export class Shop<P extends ShopPlayer> {
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
		this.host.send(p, { type: 'shop', items, owned, loadout: p.loadout });
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
