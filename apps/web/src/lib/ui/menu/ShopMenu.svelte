<script lang="ts">
	import { untrack } from 'svelte';
	import { emptyLoadout, formatTenths, formatWhole, LOOTBOX, RARITIES, type CosmeticSlot, type Loadout, type RarityId } from '@surf/shared';
	import type { CharacterPreviewHandle, GameApi, ShopView } from '#lib/game/contract.js';
	import { itemState, missingCoins, SHOP_CATEGORIES, shopEntries, type ItemState, type ShopEntry } from '#lib/game/shop.js';

	/** Shop submenu (docs/ui.md#shop): items by category, live try-on, two-step purchase. */
	let {
		api,
		shop,
		balance,
		loggedIn,
		online
	}: {
		api: GameApi;
		shop: ShopView | null;
		/** Tenths of a coin. */
		balance: number;
		loggedIn: boolean;
		online: boolean;
	} = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let preview: CharacterPreviewHandle | null = $state.raw(null);
	let noPreview = $state(false);
	let thumbs: Record<string, string> = $state({});
	let selectedId: string | null = $state(null);
	/** Tried on, not worn: slot to item id (null: taken off). */
	let tried: Partial<Loadout> = $state({});
	let confirming = $state(false);
	let confirmButton: HTMLButtonElement | undefined = $state();

	const entries = $derived(shop ? shopEntries(shop) : []);
	const groups = $derived(
		SHOP_CATEGORIES.map((c) => ({ ...c, entries: entries.filter((e) => e.item.slot === c.slot) })).filter((g) => g.entries.length > 0)
	);
	const selected = $derived(entries.find((e) => e.item.id === selectedId) ?? null);
	const look = $derived({ ...emptyLoadout(), ...shop?.loadout, ...tried });
	const trying = $derived(shop !== null && Object.entries(tried).some(([slot, id]) => shop.loadout[slot as CosmeticSlot] !== id));
	const stateOf = (e: ShopEntry): ItemState => (shop ? itemState(e.item, e.price, shop, balance, loggedIn) : 'guest');
	const selectedState = $derived(selected ? stateOf(selected) : null);
	const rarity = (e: ShopEntry) => RARITIES[e.item.rarity ?? 'basic'];

	// The preview lives as long as its canvas.
	$effect(() => {
		if (!canvas) return;
		const p = api.createPreview(canvas);
		preview = p;
		noPreview = p === null;
		// The list does not change while the shop is open.
		const ids = untrack(() => [LOOTBOX.id, ...entries.map((e) => e.item.id)]);
		p?.thumbnails(ids, (id, url) => (thumbs[id] = url));
		return () => {
			preview = null;
			p?.dispose();
		};
	});
	$effect(() => {
		preview?.setLoadout(look);
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

	function equip(e: ShopEntry, on: boolean) {
		const { [e.item.slot]: _, ...rest } = tried;
		tried = rest;
		api.shopEquip(e.item.slot, on ? e.item.id : null);
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
	const STATE_LABEL: Record<ItemState, string> = { equipped: 'Equipped', owned: 'Owned', buy: '', poor: '', guest: '' };
</script>

<header class="head">
	<h2 id="ss-menu-title">Shop</h2>
	{#if shop && loggedIn}
		<span class="balance"><span class="ss-label">Coins</span> <strong class="ss-num">{formatWhole(balance)}</strong></span>
	{/if}
</header>

{#if shop && entries.length > 0}
	<div class="wrap">
		<div class="body">
			<section class="side" aria-label="Preview">
				<div class="stage">
					<canvas bind:this={canvas} aria-label="Your character wearing the selected items; drag to turn"></canvas>
					{#if noPreview}<p class="hint center">No 3D preview in this browser.</p>{/if}
					{#if trying}<button type="button" class="reset" onclick={reset}>Reset look</button>{/if}
				</div>
				<div class="detail" aria-live="polite">
					{#if selected && selectedState}
						<div class="title">
							<strong>{selected.item.name}</strong>
							<span class="rarity" style:color={rarity(selected).color}>{rarity(selected).name}</span>
						</div>
						{#if selectedState === 'equipped'}
							<button type="button" class="ss-button plain" disabled={shop.busy} onclick={() => equip(selected, false)}>Take off</button>
						{:else if selectedState === 'owned'}
							<button type="button" class="ss-button" disabled={shop.busy} onclick={() => equip(selected, true)}>Equip</button>
						{:else if selectedState === 'guest'}
							<p class="hint">Guests can look around. Log in to buy items.</p>
							<button type="button" class="ss-button" onclick={() => api.openAuth()}>Log in / Register</button>
						{:else if selectedState === 'poor'}
							<button type="button" class="ss-button" disabled>Buy · {formatTenths(selected.price)} coins</button>
							<p class="hint bad">You need {missingCoins(selected.price, balance)} more coins.</p>
						{:else if confirming}
							<p class="hint">Buy for <strong>{formatTenths(selected.price)} coins</strong>? There are no refunds.</p>
							<div class="row">
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
					{#if shop.notice}<p class="hint" class:bad={!shop.notice.ok} class:good={shop.notice.ok} role="status">{shop.notice.text}</p>{/if}
				</div>
			</section>

			<div class="list">
				<section>
					<h3 class="ss-label">Loot boxes</h3>
					<button type="button" class="card lootbox" disabled aria-label="{LOOTBOX.name}, {formatTenths(LOOTBOX.price)} coins, coming soon">
						<span class="thumb">{#if thumbs[LOOTBOX.id]}<img src={thumbs[LOOTBOX.id]} alt="" />{/if}</span>
						<span class="name">{LOOTBOX.name}</span>
						<span class="meta">
							<span class="price ss-num">{formatTenths(LOOTBOX.price)}<span class="unit">coins</span></span>
							<span class="soon">Coming soon</span>
						</span>
						<span class="odds">
							{#each LOOT_RARITIES as r (r)}<span style:color={RARITIES[r].color}>{RARITIES[r].name}</span>{/each}
						</span>
					</button>
				</section>
				{#each groups as g (g.slot)}
					<section>
						<h3 class="ss-label">{g.label}</h3>
						<div class="grid">
							{#each g.entries as e (e.item.id)}
								{@const st = stateOf(e)}
								<button
									type="button"
									class="card"
									class:selected={selectedId === e.item.id}
									class:worn={st === 'equipped'}
									class:poor={st === 'poor'}
									style:--rarity={rarity(e).color}
									aria-pressed={selectedId === e.item.id}
									onclick={() => select(e)}
								>
									<span class="thumb">{#if thumbs[e.item.id]}<img src={thumbs[e.item.id]} alt="" />{/if}</span>
									<span class="name">{e.item.name}</span>
									<span class="meta">
										<span class="rarity" style:color={rarity(e).color}>{rarity(e).name}</span>
										{#if STATE_LABEL[st]}
											<span class="state" class:good={st === 'equipped'}>{STATE_LABEL[st]}</span>
										{:else}
											<span class="price ss-num" title={st === 'poor' ? 'Not enough coins' : undefined}>{formatTenths(e.price)}<span class="unit">coins</span></span>
										{/if}
									</span>
								</button>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		</div>
	</div>
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
	.wrap {
		user-select: none;
		flex: 1;
		min-height: 0;
		container-type: size;
	}
	.body {
		height: 100%;
		display: grid;
		grid-template-columns: minmax(230px, 34%) 1fr;
		gap: 16px;
	}
	.side {
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.stage {
		position: relative;
		flex: 1;
		min-height: 120px;
		background: radial-gradient(ellipse at 50% 85%, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.02) 70%);
		border: 1px solid var(--panel-border);
		border-radius: var(--radius);
		overflow: hidden;
	}
	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		cursor: grab;
		touch-action: none;
	}
	.reset {
		position: absolute;
		right: 6px;
		bottom: 6px;
		padding: 5px 9px;
		font: 600 12px/1 var(--ui-font);
		color: var(--text);
		background: rgba(0, 0, 0, 0.5);
		border: 1px solid var(--panel-border-strong);
		border-radius: var(--radius);
		cursor: pointer;
	}
	.detail {
		min-height: 92px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.title {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		font-size: 18px;
	}
	.row {
		display: flex;
		gap: 8px;
	}
	.row > button {
		flex: 1;
		padding-inline: 8px;
	}
	.ss-button.plain {
		color: var(--text);
		background: rgba(255, 255, 255, 0.08);
	}
	.list {
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding-right: 4px;
	}
	h3 {
		margin: 0 0 6px;
		font-size: 12px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 8px;
	}
	.card {
		display: grid;
		grid-template-columns: 56px 1fr;
		grid-template-rows: auto auto;
		align-items: center;
		gap: 2px 10px;
		padding: 7px 10px 7px 7px;
		font: 600 15px/1.15 var(--ui-font);
		text-align: left;
		color: var(--text);
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--panel-border);
		border-left: 3px solid var(--rarity);
		border-radius: var(--radius);
		cursor: pointer;
	}
	.card:hover,
	.card:focus-visible {
		background: rgba(255, 255, 255, 0.09);
	}
	.card.selected {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.thumb {
		grid-row: 1 / 3;
		width: 56px;
		height: 56px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 2px;
	}
	.thumb img {
		display: block;
		width: 100%;
		height: 100%;
	}
	.lootbox {
		width: 100%;
		grid-template-columns: 96px 1fr;
		grid-template-rows: auto auto auto;
		--rarity: var(--panel-border-strong);
		filter: grayscale(0.85);
		opacity: 0.55;
		cursor: not-allowed;
	}
	.card.lootbox:hover {
		background: rgba(255, 255, 255, 0.03);
	}
	.lootbox .thumb {
		grid-row: 1 / 4;
		width: 96px;
		height: 96px;
	}
	.soon {
		color: var(--text);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.odds {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 10px;
		font-size: 13px;
	}
	.name {
		align-self: end;
	}
	.meta {
		align-self: start;
		display: flex;
		justify-content: space-between;
		gap: 6px;
		font-size: 13px;
	}
	.price {
		font-weight: 700;
		color: var(--accent);
		white-space: nowrap;
	}
	.unit {
		margin-left: 3px;
		font-weight: 500;
	}
	.card.poor .price {
		color: var(--bad);
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
	.hint strong {
		color: var(--text);
	}
	.center {
		position: absolute;
		inset: auto 10px 45%;
		text-align: center;
	}
	.good,
	.state.good {
		color: var(--good);
	}
	.bad {
		color: var(--bad);
	}
	/* Narrow: preview and details side by side, the list scrolls below them. */
	@container (max-width: 560px) {
		.body {
			display: flex;
			flex-direction: column;
			overflow-y: auto;
		}
		.side {
			position: sticky;
			top: 0;
			z-index: 1;
			flex: none;
			flex-direction: row;
			padding-bottom: 6px;
			background: #101318;
		}
		.stage {
			flex: 0 0 38%;
			height: min(210px, 42cqh);
		}
		.detail {
			flex: 1;
			min-width: 0;
		}
		.list {
			overflow: visible;
		}
		.row {
			flex-wrap: wrap;
		}
	}
</style>
