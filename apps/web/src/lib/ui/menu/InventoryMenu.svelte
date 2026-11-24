<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { emptyLoadout, RARITIES, type CosmeticSlot, type RarityId } from '@surf/shared';
	import type { GameApi, ShopView } from '#lib/game/contract.js';
	import {
		filterInventory,
		inventoryEntries,
		ownedRarities,
		SHOP_CATEGORIES,
		sortInventory,
		type InventoryEntry,
		type InventorySort
	} from '#lib/game/shop.js';
	import ItemBrowser from '#lib/ui/menu/ItemBrowser.svelte';
	import ItemCard from '#lib/ui/menu/ItemCard.svelte';
	import { ItemPictures } from '#lib/ui/menu/item-pictures.svelte.js';
	import Tabs from '#lib/ui/menu/Tabs.svelte';

	/** Inventory submenu (docs/ui.md#inventory): everything the player owns; wear it and take it off. */
	let {
		api,
		shop,
		loggedIn,
		online,
		initial = null,
		onshop
	}: {
		api: GameApi;
		shop: ShopView | null;
		loggedIn: boolean;
		online: boolean;
		/** Selected when it opens (item id). */
		initial?: string | null;
		onshop: () => void;
	} = $props();

	const ALL = 'all';
	const pictures = new ItemPictures();
	let slot: CosmeticSlot | null = $state(null);
	let rarity: RarityId | null = $state(null);
	let query = $state('');
	let sort: InventorySort = $state('rarity');
	let selectedKey: string | null = $state(untrack(() => initial));
	let root: HTMLDivElement | undefined = $state();

	const entries = $derived(shop ? inventoryEntries(shop) : []);
	const owned = $derived(entries.filter((e) => e.wear !== null));
	const rarities = $derived(ownedRarities(entries));
	const shown = $derived(sortInventory(filterInventory(entries, { slot, rarity, query }), sort));
	// Each count is how many owned items picking that filter would show.
	const tabs = $derived.by(() => {
		const match = filterInventory(owned, { rarity, query });
		return [
			{ id: ALL as string, label: 'All', count: match.length },
			...SHOP_CATEGORIES.map((c) => ({ id: c.slot as string, label: c.label, count: match.filter((e) => e.slot === c.slot).length }))
		];
	});
	const chips = $derived.by(() => {
		const match = filterInventory(owned, { slot, query });
		return rarities.map((id) => ({ id, ...RARITIES[id], count: match.filter((e) => e.rarity === id).length }));
	});
	const worn = $derived(SHOP_CATEGORIES.map((c) => ({ ...c, entry: entries.find((e) => e.slot === c.slot && e.worn) ?? null })));
	const selected = $derived(entries.find((e) => e.key === selectedKey) ?? null);
	const look = $derived({ ...emptyLoadout(), ...shop?.loadout, ...(selected ? { [selected.slot]: selected.wear } : {}) });
	const filtered = $derived(slot !== null || rarity !== null || query.trim() !== '');
	// A result of the other menu is not shown again here.
	const oldNotice = untrack(() => shop?.notice ?? null);
	const notice = $derived(shop?.notice && shop.notice !== oldNotice && !shop.notice.ok ? shop.notice : null);

	onMount(async () => {
		if (!initial) return;
		await tick();
		root?.querySelector('[aria-pressed="true"].item-card')?.scrollIntoView({ block: 'center' });
	});

	// Logged out or gone: nothing of this rarity is left to filter by.
	$effect(() => {
		if (rarity !== null && !rarities.includes(rarity)) rarity = null;
	});

	function pick(e: InventoryEntry) {
		// The second click wears it.
		if (selectedKey === e.key && !e.worn) wear(e);
		else selectedKey = e.key;
	}

	function wear(e: InventoryEntry) {
		if (!shop?.busy) api.shopEquip(e.slot, e.wear);
	}

	function takeOff(e: InventoryEntry) {
		if (shop?.busy) return;
		if (selected?.slot === e.slot) selectedKey = null;
		api.shopEquip(e.slot, null);
	}

	function clear() {
		slot = null;
		rarity = null;
		query = '';
	}
</script>

<header class="head">
	<h2 id="ss-menu-title">Inventory</h2>
	{#if shop && loggedIn}
		<span class="counts">
			<strong class="ss-num">{owned.length}</strong> {owned.length === 1 ? 'item' : 'items'} ·
			<strong class="ss-num">{owned.filter((e) => e.worn).length}</strong> worn
		</span>
	{/if}
</header>

{#if !shop}
	<p class="line">{online ? 'The inventory is not available on this server.' : 'Offline: the inventory needs the server.'}</p>
{:else if !loggedIn}
	<p class="line">Guests have no inventory. Log in to see and wear your items.</p>
	<button type="button" class="ss-button login" onclick={() => api.openAuth()}>Log in / Register</button>
{:else}
	<div class="root" bind:this={root}>
		<ItemBrowser
			{api}
			{pictures}
			{look}
			onreset={selected && !selected.worn ? () => (selectedKey = null) : null}
			panelId="ss-inventory-panel"
			labelledby="ss-inventory-tab-{slot ?? ALL}"
		>
			{#snippet toolbar()}
				{#if owned.length > 0}
					<Tabs {tabs} selected={slot ?? ALL} onselect={(id) => (slot = id === ALL ? null : (id as CosmeticSlot))} label="Item categories" idPrefix="ss-inventory" />
					<div class="filters">
						<div class="chips" role="group" aria-label="Rarity">
							{#each chips as c (c.id)}
								<button
									type="button"
									class="chip"
									class:on={rarity === c.id}
									style:--rarity={c.color}
									aria-pressed={rarity === c.id}
									onclick={() => (rarity = rarity === c.id ? null : c.id)}
								>
									{c.name} <span class="ss-num">{c.count}</span>
								</button>
							{/each}
						</div>
						<button type="button" class="chip sort" title="Change the order" onclick={() => (sort = sort === 'rarity' ? 'name' : 'rarity')}>
							Sort: {sort === 'rarity' ? 'Rarity' : 'Name'}
						</button>
						<input class="ss-input search" type="search" placeholder="Search items" aria-label="Search items by name, category or rarity" bind:value={query} />
					</div>
				{/if}
			{/snippet}

			{#snippet detail()}
				<div class="item-detail" aria-live="polite">
					{#if selected}
						<div class="item-title">
							<strong>{selected.name}</strong>
							<span style:color={selected.rarity ? RARITIES[selected.rarity].color : undefined}>
								{selected.rarity ? RARITIES[selected.rarity].name : 'Default'}
							</span>
						</div>
						{#if !selected.worn}
							<button type="button" class="ss-button" disabled={shop.busy} onclick={() => wear(selected)}>{shop.busy ? 'Please wait…' : 'Wear'}</button>
						{:else if selected.wear !== null}
							<button type="button" class="ss-button plain" disabled={shop.busy} onclick={() => takeOff(selected)}>Take off</button>
						{:else}
							<p class="hint good">This is your look now.</p>
						{/if}
					{:else}
						<p class="hint">Pick an item to see it, click again to wear it.</p>
					{/if}
					{#if notice}<p class="hint bad" role="status">{notice.text}</p>{/if}
				</div>
				<ul class="worn" aria-label="Worn now">
					{#each worn as w (w.slot)}
						<li>
							<span class="ss-label">{w.label}</span>
							{#if w.entry && w.entry.wear !== null}
								{@const e = w.entry}
								<button type="button" class="wname" style:color={e.rarity ? RARITIES[e.rarity].color : undefined} title={e.name} onclick={() => (selectedKey = e.key)}>
									{e.name}
								</button>
								<button type="button" class="off" aria-label="Take off {e.name}" title="Take off" disabled={shop.busy} onclick={() => takeOff(e)}>×</button>
							{:else}
								<span class="none">Default</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/snippet}

			{#snippet list()}
				{#if owned.length === 0}
					<div class="empty">
						<p class="hint">You do not own any items yet. Buy your first one in the shop.</p>
						<button type="button" class="ss-button" onclick={onshop}>Go to the shop</button>
					</div>
				{/if}
				{#if shown.length > 0}
					<div class="item-grid">
						{#each shown as e (e.key)}
							<ItemCard
								{pictures}
								drawn={e.drawn}
								name={e.name}
								rarity={e.rarity}
								selected={selectedKey === e.key}
								worn={e.worn}
								onclick={() => pick(e)}
							>
								{#if e.worn}<span class="state">Worn</span>{/if}
							</ItemCard>
						{/each}
					</div>
				{:else}
					<div class="empty">
						<p class="hint">No items match.</p>
						{#if filtered}<button type="button" class="ss-button plain" onclick={clear}>Show all items</button>{/if}
					</div>
				{/if}
			{/snippet}
		</ItemBrowser>
	</div>
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
	.counts {
		font-size: 14px;
		color: var(--text-dim);
	}
	.counts strong {
		font-size: 17px;
		color: var(--accent);
	}
	.line {
		margin: 0;
		color: var(--text-dim);
	}
	.login {
		align-self: flex-start;
	}
	.root {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.filters {
		display: flex;
		align-items: flex-start;
		gap: 6px;
	}
	.chips {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chip {
		padding: 6px 7px;
		font: 600 13px/1.1 var(--ui-font);
		color: var(--rarity, var(--text));
		white-space: nowrap;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--panel-border-strong);
		border-radius: var(--radius);
		cursor: pointer;
	}
	.chip:hover {
		background: rgba(255, 255, 255, 0.09);
	}
	.chip.on {
		color: var(--text);
		background: color-mix(in srgb, var(--rarity) 32%, transparent);
		border-color: var(--rarity);
	}
	.search {
		box-sizing: border-box;
		width: 112px;
		padding: 4px 8px;
		font-size: 14px;
	}
	.worn {
		list-style: none;
		margin: 0;
		padding: 6px 0 0;
		border-top: 1px solid var(--panel-border);
	}
	.worn li {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 24px;
	}
	.worn .ss-label {
		flex: 0 0 84px;
		font-size: 11px;
	}
	.wname,
	.none {
		flex: 1;
		min-width: 0;
		padding: 2px 0;
		font: 600 14px/1.1 var(--ui-font);
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.wname {
		background: none;
		border: none;
		cursor: pointer;
	}
	.wname:hover {
		text-decoration: underline;
	}
	.none {
		color: var(--text-faint);
	}
	.off {
		width: 22px;
		height: 22px;
		padding: 0;
		font: 600 16px/1 var(--ui-font);
		color: var(--text-dim);
		background: none;
		border: 1px solid transparent;
		border-radius: var(--radius);
		cursor: pointer;
	}
	.off:hover {
		color: var(--text);
		border-color: var(--panel-border-strong);
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
	}
	.state {
		padding: 1px 5px;
		font-weight: 700;
		color: #10160f;
		background: var(--good);
		border-radius: 2px;
	}
</style>
