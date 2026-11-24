<script lang="ts">
	import { untrack } from 'svelte';
	import { emptyLoadout, formatTenths, formatWhole, LOOTBOX, RARITIES, type CosmeticSlot, type Loadout, type RarityId } from '@surf/shared';
	import type { GameApi, ShopView } from '#lib/game/contract.js';
	import { itemState, missingCoins, SHOP_CATEGORIES, shopEntries, type ItemState, type ShopEntry } from '#lib/game/shop.js';
	import ItemBrowser from '#lib/ui/menu/ItemBrowser.svelte';
	import ItemCard from '#lib/ui/menu/ItemCard.svelte';
	import { ItemPictures } from '#lib/ui/menu/item-pictures.svelte.js';
	import Tabs from '#lib/ui/menu/Tabs.svelte';

	/** Shop submenu (docs/ui.md#shop): what can be bought, with try-on and a two-step purchase. Wearing is in the inventory. */
	let {
		api,
		shop,
		balance,
		loggedIn,
		online,
		oninventory
	}: {
		api: GameApi;
		shop: ShopView | null;
		/** Tenths of a coin. */
		balance: number;
		loggedIn: boolean;
		online: boolean;
		/** Open the inventory on this item. */
		oninventory: (item: string) => void;
	} = $props();

	const ALL = 'all';
	const pictures = new ItemPictures();
	let category: CosmeticSlot | typeof ALL = $state(ALL);
	let selectedId: string | null = $state(null);
	/** Tried on, not worn: slot to item id. */
	let tried: Partial<Loadout> = $state({});
	let confirming = $state(false);
	let confirmButton: HTMLButtonElement | undefined = $state();
	let boughtButton: HTMLButtonElement | undefined = $state();

	const entries = $derived(shop ? shopEntries(shop) : []);
	const groups = $derived(
		SHOP_CATEGORIES.map((c) => ({ ...c, entries: entries.filter((e) => e.item.slot === c.slot) })).filter((g) => g.entries.length > 0)
	);
	const tabs = $derived([
		{ id: ALL as string, label: 'All', count: entries.length },
		...groups.map((g) => ({ id: g.slot as string, label: g.label, count: g.entries.length }))
	]);
	const selected = $derived(entries.find((e) => e.item.id === selectedId) ?? null);
	const look = $derived({ ...emptyLoadout(), ...shop?.loadout, ...tried });
	const trying = $derived(shop !== null && Object.entries(tried).some(([slot, id]) => shop.loadout[slot as CosmeticSlot] !== id));
	const stateOf = (e: ShopEntry): ItemState => (shop ? itemState(e.item, e.price, shop, balance, loggedIn) : 'guest');
	const selectedState = $derived(selected ? stateOf(selected) : null);
	// A result of the other menu is not shown again here.
	const oldNotice = untrack(() => shop?.notice ?? null);
	const notice = $derived(shop?.notice && shop.notice !== oldNotice ? shop.notice : null);
	const bought = $derived(notice?.bought !== undefined && notice.bought === selectedId);

	// Keyboard: the buy button is gone after a purchase, and the focus with it.
	$effect(() => {
		if (bought && document.activeElement === document.body) boughtButton?.focus();
	});

	function select(e: ShopEntry) {
		confirming = false;
		if (selectedId === e.item.id && tried[e.item.slot] === e.item.id && shop?.loadout[e.item.slot] !== e.item.id) {
			// Second click takes the tried item off again.
			const { [e.item.slot]: _, ...rest } = tried;
			tried = rest;
			selectedId = null;
			return;
		}
		selectedId = e.item.id;
		tried = { ...tried, [e.item.slot]: e.item.id };
	}

	function reset() {
		confirming = false;
		tried = {};
	}

	function wear(e: ShopEntry) {
		const { [e.item.slot]: _, ...rest } = tried;
		tried = rest;
		api.shopEquip(e.item.slot, e.item.id);
	}

	function askBuy() {
		confirming = true;
		queueMicrotask(() => confirmButton?.focus());
	}

	function buy(e: ShopEntry) {
		confirming = false;
		api.shopBuy(e.item.id);
	}

	const LOOT_RARITIES = Object.keys(LOOTBOX.odds) as RarityId[];
</script>

<header class="head">
	<h2 id="ss-menu-title">Shop</h2>
	{#if shop && loggedIn}
		<span class="balance"><span class="ss-label">Coins</span> <strong class="ss-num">{formatWhole(balance)}</strong></span>
	{/if}
</header>

{#if shop && entries.length > 0}
	<ItemBrowser {api} {pictures} {look} onreset={trying ? reset : null} panelId="ss-shop-panel" labelledby="ss-shop-tab-{category}">
		{#snippet toolbar()}
			<Tabs {tabs} selected={category} onselect={(id) => (category = id as typeof category)} label="Shop categories" idPrefix="ss-shop" />
		{/snippet}

		{#snippet detail()}
			<div class="item-detail" aria-live="polite">
				{#if selected && selectedState}
					{@const r = RARITIES[selected.item.rarity ?? 'basic']}
					<div class="item-title">
						<strong>{selected.item.name}</strong>
						<span style:color={r.color}>{r.name}</span>
					</div>
					{#if selectedState === 'owned'}
						{#if bought && notice}
							<p class="hint good" role="status">{notice.text}</p>
						{:else}
							<p class="hint">You own this.{shop.loadout[selected.item.slot] === selected.item.id ? ' You wear it now.' : ''}</p>
						{/if}
						<div class="item-row">
							{#if bought}
								<button type="button" class="ss-button" disabled={shop.busy} bind:this={boughtButton} onclick={() => wear(selected)}>Wear it</button>
							{/if}
							<button type="button" class="ss-button plain" onclick={() => oninventory(selected.item.id)}>Go to inventory</button>
						</div>
					{:else if selectedState === 'guest'}
						<p class="hint">Guests can look around. Log in to buy items.</p>
						<button type="button" class="ss-button" onclick={() => api.openAuth()}>Log in / Register</button>
					{:else if selectedState === 'poor'}
						<button type="button" class="ss-button" disabled>Buy · {formatTenths(selected.price)} coins</button>
						<p class="hint bad">You are {missingCoins(selected.price, balance)} coins short.</p>
					{:else if confirming}
						<p class="hint">Buy for <strong>{formatTenths(selected.price)} coins</strong>? There are no refunds.</p>
						<div class="item-row">
							<button type="button" class="ss-button" disabled={shop.busy} bind:this={confirmButton} onclick={() => buy(selected)}>Confirm</button>
							<button type="button" class="ss-button plain" onclick={() => (confirming = false)}>Cancel</button>
						</div>
					{:else}
						<button type="button" class="ss-button" disabled={shop.busy} onclick={askBuy}>
							{shop.busy ? 'Please wait…' : `Buy · ${formatTenths(selected.price)} coins`}
						</button>
					{/if}
				{:else}
					<p class="hint">Pick an item to try it on.</p>
				{/if}
				{#if notice && !notice.ok}<p class="hint bad" role="status">{notice.text}</p>{/if}
			</div>
		{/snippet}

		{#snippet list()}
			{#if category === ALL}
				<section>
					<h3 class="ss-label">Loot boxes</h3>
					<button
						type="button"
						class="lootbox"
						disabled
						aria-label="{LOOTBOX.name}, {formatTenths(LOOTBOX.price)} coins, coming soon"
						{@attach pictures.watch(LOOTBOX.id)}
					>
						<span class="thumb">{#if pictures.urls[LOOTBOX.id]}<img src={pictures.urls[LOOTBOX.id]} alt="" />{/if}</span>
						<span>{LOOTBOX.name}</span>
						<span class="meta">
							<span class="price ss-num">{formatTenths(LOOTBOX.price)}<span class="unit">coins</span></span>
							<span class="soon">Coming soon</span>
						</span>
						<span class="odds">
							{#each LOOT_RARITIES as r (r)}<span style:color={RARITIES[r].color}>{RARITIES[r].name}</span>{/each}
						</span>
					</button>
				</section>
			{/if}
			{#each groups as g (g.slot)}
				{#if category === ALL || category === g.slot}
					<section>
						{#if category === ALL}<h3 class="ss-label">{g.label}</h3>{/if}
						<div class="item-grid">
							{#each g.entries as e (e.item.id)}
								{@const st = stateOf(e)}
								<ItemCard
									{pictures}
									drawn={e.item.id}
									name={e.item.name}
									rarity={e.item.rarity ?? 'basic'}
									selected={selectedId === e.item.id}
									dim={st === 'owned'}
									onclick={() => select(e)}
								>
									{#if st === 'owned'}
										<span class="state">Owned</span>
									{:else}
										<span class="price ss-num" class:poor={st === 'poor'} title={st === 'poor' ? 'Not enough coins' : undefined}>
											{formatTenths(e.price)}<span class="unit">coins</span>
										</span>
									{/if}
								</ItemCard>
							{/each}
						</div>
					</section>
				{/if}
			{/each}
		{/snippet}
	</ItemBrowser>
{:else if !online}
	<p class="hint">Offline: the shop needs the server.</p>
{:else}
	<p class="hint">The shop is not available on this server.</p>
{/if}

<style>
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.head h2 {
		margin: 0;
		font: 700 22px/1 var(--ui-font);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.balance strong {
		font-size: 24px;
		line-height: 1;
		color: var(--accent);
	}
	h3 {
		margin: 0 0 6px;
		font-size: 12px;
	}
	.lootbox {
		width: 100%;
		display: grid;
		grid-template-columns: 96px 1fr;
		grid-template-rows: auto auto auto;
		align-items: center;
		gap: 2px 10px;
		padding: 7px 10px 7px 7px;
		font: 600 15px/1.15 var(--ui-font);
		text-align: left;
		color: var(--text);
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--panel-border);
		border-left: 3px solid var(--panel-border-strong);
		border-radius: var(--radius);
		filter: grayscale(0.85);
		opacity: 0.55;
		cursor: not-allowed;
	}
	.lootbox .thumb {
		grid-row: 1 / 4;
		width: 96px;
		height: 96px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 2px;
	}
	.thumb img {
		display: block;
		width: 100%;
		height: 100%;
	}
	.meta {
		display: flex;
		justify-content: space-between;
		gap: 6px;
		font-size: 13px;
	}
	.soon {
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.odds {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 10px;
		font-size: 13px;
	}
	.price {
		font-weight: 700;
		color: var(--accent);
		white-space: nowrap;
	}
	.price.poor {
		color: var(--bad);
	}
	.unit {
		margin-left: 3px;
		font-weight: 500;
	}
	.state {
		color: var(--text-dim);
	}
	.hint {
		margin: 0;
		font-size: 14px;
		line-height: 1.4;
		color: var(--text-dim);
	}
	.hint.good {
		color: var(--good);
	}
	.hint.bad {
		color: var(--bad);
	}
	.hint strong {
		color: var(--text);
	}
</style>
