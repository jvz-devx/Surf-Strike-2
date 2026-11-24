<script lang="ts">
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { formatTenths, formatWhole, getCosmetic, LOOTBOX, RARITIES, type BoxOffer, type CosmeticItem } from '@surf/shared';
	import type { GameApi, ShopView } from '#lib/game/contract.js';
	import { boxContents, boxReel, chanceLabel, missingCoins } from '#lib/game/shop.js';
	import ItemCard from '#lib/ui/menu/ItemCard.svelte';
	import type { ItemPictures } from '#lib/ui/menu/item-pictures.svelte.js';

	/**
	 * Loot box (docs/ui.md#lootbox), over the shop: what is inside, then the reel.
	 * The server rolls the item; the reel only shows it, so closing early loses nothing.
	 */
	let {
		api,
		shop,
		box,
		balance,
		loggedIn,
		pictures,
		onclose,
		oninventory
	}: {
		api: GameApi;
		shop: ShopView;
		box: BoxOffer;
		/** Tenths of a coin. */
		balance: number;
		loggedIn: boolean;
		pictures: ItemPictures;
		onclose: () => void;
		oninventory: (item: string) => void;
	} = $props();

	const CARDS = 48;
	const WIN = 41;
	const SPIN_MS = 6200;
	/** Card width plus gap (px). */
	const STEP = 138;
	const TICK_MIN_MS = 40;

	type Phase = 'contents' | 'waiting' | 'spin' | 'done';
	let phase = $state('contents' as Phase);
	/** Coins shown here: a refund must not give the result away. */
	let shownBalance = $state(untrack(() => balance));
	let reel: CosmeticItem[] = $state.raw([]);
	let won = $state.raw(null as CosmeticItem | null);
	let result: { duplicate: boolean; refund: number } = $state({ duplicate: false, refund: 0 });
	let windowEl: HTMLDivElement | undefined = $state();
	let strip: HTMLDivElement | undefined = $state();
	let mainButton: HTMLButtonElement | undefined = $state();
	let raf = 0;
	/** Between the stop of the reel and the reveal. */
	let pause: ReturnType<typeof setTimeout> | undefined;
	/** Put the reel where it stops. */
	let settle = () => {};
	let seen = untrack(() => shop.opened?.n ?? 0);
	const oldNotice = untrack(() => shop.notice);

	const contents = $derived(boxContents(box, shop.owned));
	const rarity = $derived(won ? RARITIES[won.rarity ?? 'common'] : null);
	const worn = $derived(won !== null && shop.loadout[won.slot] === won.id);
	const error = $derived(shop.notice && shop.notice !== oldNotice && !shop.notice.ok ? shop.notice.text : null);
	const busy = $derived(phase === 'waiting' || phase === 'spin');

	$effect(() => {
		if (!busy) shownBalance = balance;
	});
	// The answer: spin to the item, or back with the error under the button.
	$effect(() => {
		const o = shop.opened;
		if (o && o.n !== seen) {
			seen = o.n;
			untrack(() => void spin(o));
		} else if (phase === 'waiting' && !shop.busy) phase = 'contents';
	});

	onMount(() => {
		pictures.want([LOOTBOX.id, ...box.items]);
		mainButton?.focus();
	});
	onDestroy(stopReel);

	function open() {
		if (busy || shop.busy) return;
		phase = 'waiting';
		shownBalance = balance - box.price;
		api.boxSound('open');
		api.boxOpen();
	}

	async function spin(o: NonNullable<ShopView['opened']>) {
		const item = getCosmetic(o.item);
		if (!item) {
			// A newer server: the item exists, this page just cannot draw it.
			phase = 'contents';
			return;
		}
		won = item;
		result = { duplicate: o.duplicate, refund: o.refund };
		reel = boxReel(box, item, CARDS, WIN);
		phase = 'spin';
		await tick();
		// Stops anywhere on the card, not always in its middle.
		const stop = (Math.random() - 0.5) * 0.78;
		const place = (at: number) => {
			if (strip && windowEl) strip.style.transform = `translate3d(${windowEl.clientWidth / 2 - (at + 0.5) * STEP}px, 0, 0)`;
		};
		settle = () => place(WIN + stop);
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
		const start = performance.now();
		let last = -1;
		let lastTick = 0;
		const frame = (now: number) => {
			const t = Math.min(1, (now - start) / SPIN_MS);
			// In cards: which one is under the marker.
			const at = 2 + (WIN + stop - 2) * (1 - (1 - t) ** 4);
			place(at);
			const card = Math.floor(at + 0.5);
			if (card !== last && now - lastTick >= TICK_MIN_MS) {
				if (last >= 0) api.boxSound('tick');
				last = card;
				lastTick = now;
			}
			if (t < 1) raf = requestAnimationFrame(frame);
			else pause = setTimeout(finish, 450);
		};
		raf = requestAnimationFrame(frame);
	}

	function stopReel() {
		cancelAnimationFrame(raf);
		clearTimeout(pause);
	}

	function finish() {
		if (phase !== 'spin') return;
		stopReel();
		settle();
		phase = 'done';
		api.boxSound(won?.rarity === 'rare' || won?.rarity === 'epic' ? 'rare' : 'reveal');
		void tick().then(() => mainButton?.focus());
	}

	function keydown(e: KeyboardEvent) {
		if (e.key !== 'Escape' || e.repeat) return;
		e.preventDefault();
		e.stopPropagation();
		// The first Esc skips the reel, the next one closes.
		if (phase === 'spin') finish();
		else if (phase !== 'waiting') onclose();
	}
</script>

<svelte:window onkeydowncapture={keydown} />

<div class="box" role="group" aria-label={LOOTBOX.name} style:--rarity={rarity?.color ?? 'var(--accent)'}>
	<header class="head">
		<h2>{LOOTBOX.name}</h2>
		{#if loggedIn}<span class="balance"><span class="ss-label">Coins</span> <strong class="ss-num">{formatWhole(shownBalance)}</strong></span>{/if}
	</header>

	{#if phase === 'contents' || phase === 'waiting'}
		<div class="intro">
			<div class="chest" class:shake={phase === 'waiting'}>
				{#if pictures.urls[LOOTBOX.id]}<img src={pictures.urls[LOOTBOX.id]} alt="" draggable="false" />{/if}
			</div>
			<div class="buy">
				<p class="odds">
					{#each contents.groups as g (g.rarity)}
						<span style:color={RARITIES[g.rarity].color}>{RARITIES[g.rarity].name} <strong class="ss-num">{chanceLabel(g.chance)}</strong></span>
					{/each}
				</p>
				{#if !loggedIn}
					<p class="hint">Guests can look inside. Log in to open loot boxes.</p>
					<button type="button" class="ss-button" bind:this={mainButton} onclick={() => api.openAuth()}>Log in / Register</button>
				{:else}
					<button type="button" class="ss-button" bind:this={mainButton} disabled={phase === 'waiting' || contents.complete || balance < box.price} onclick={open}>
						{phase === 'waiting' ? 'Opening…' : `Open · ${formatTenths(box.price)} coins`}
					</button>
					{#if contents.complete}
						<p class="hint">You already own everything in this box.</p>
					{:else if balance < box.price && phase !== 'waiting'}
						<p class="hint bad">You are {missingCoins(box.price, balance)} coins short.</p>
					{:else}
						<p class="hint">An item you already own gives part of the coins back.</p>
					{/if}
				{/if}
				{#if error}<p class="hint bad" role="status">{error}</p>{/if}
			</div>
		</div>
		<h3 class="ss-label">Contains one of these</h3>
		<div class="inside">
			<div class="grid">
				{#each contents.items as i (i.id)}
					<ItemCard {pictures} drawn={i.id} name={i.name} rarity={i.rarity ?? 'common'} dim={shop.owned.includes(i.id)} onclick={() => {}}>
						{#if shop.owned.includes(i.id)}<span class="owned">Owned</span>{/if}
					</ItemCard>
				{/each}
			</div>
		</div>
		<button type="button" class="ss-button plain back" disabled={phase === 'waiting'} onclick={onclose}>Back to the shop</button>
	{:else}
		<div class="reel" class:done={phase === 'done'} bind:this={windowEl} aria-hidden="true">
			<div class="strip" bind:this={strip}>
				{#each reel as i, n (n)}
					<div class="card" class:win={phase === 'done' && n === WIN} style:--c={RARITIES[i.rarity ?? 'common'].color}>
						{#if pictures.urls[i.id]}<img src={pictures.urls[i.id]} alt="" draggable="false" />{/if}
						<span>{i.name}</span>
					</div>
				{/each}
			</div>
			<div class="marker"></div>
		</div>
		{#if phase === 'spin'}
			<button type="button" class="ss-button plain back" onclick={finish}>Skip</button>
		{:else if won && rarity}
			<div class="prize" role="status">
				<div class="picture">{#if pictures.urls[won.id]}<img src={pictures.urls[won.id]} alt="" draggable="false" />{/if}</div>
				<div class="what">
					<span class="rarity">{rarity.name}</span>
					<strong class="name">{won.name}</strong>
					{#if result.duplicate}
						<p class="hint">You already own this: {formatTenths(result.refund)} coins back.</p>
					{:else}
						<p class="hint good">New! It is in your inventory.</p>
					{/if}
					<div class="row">
						{#if worn}
							<button type="button" class="ss-button plain" onclick={() => oninventory(won!.id)}>Go to inventory</button>
						{:else}
							<button type="button" class="ss-button plain" disabled={shop.busy} onclick={() => api.shopEquip(won!.slot, won!.id)}>Wear it</button>
						{/if}
						<button type="button" class="ss-button" bind:this={mainButton} disabled={shop.busy || contents.complete || balance < box.price} onclick={open}>
							Open another · {formatTenths(box.price)} coins
						</button>
					</div>
					{#if contents.complete}
						<p class="hint">You now own everything in this box.</p>
					{:else if balance < box.price}
						<p class="hint bad">You are {missingCoins(box.price, balance)} coins short for another one.</p>
					{/if}
					{#if error}<p class="hint bad" role="status">{error}</p>{/if}
				</div>
			</div>
			<button type="button" class="ss-button plain back" onclick={onclose}>Back to the shop</button>
		{/if}
	{/if}
</div>

<style>
	.box {
		position: absolute;
		inset: 0;
		z-index: 3;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 20px 22px 16px;
		box-sizing: border-box;
		/* Opaque: the shop stays mounted below it (its turntable draws the pictures). */
		background: #101318;
		user-select: none;
		overflow: hidden;
	}
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
		margin: 0;
		font-size: 12px;
	}
	.intro {
		display: flex;
		align-items: center;
		gap: 22px;
	}
	.chest {
		flex: 0 0 170px;
		height: 170px;
		background: radial-gradient(circle at 50% 55%, rgba(226, 170, 69, 0.28), transparent 68%);
	}
	.chest img {
		display: block;
		width: 100%;
		height: 100%;
	}
	.shake {
		animation: shake 0.16s linear infinite;
	}
	@keyframes shake {
		0%,
		100% {
			transform: none;
		}
		25% {
			transform: translate(-2px, 1px) rotate(-1.6deg);
		}
		75% {
			transform: translate(2px, -1px) rotate(1.6deg);
		}
	}
	.buy {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
	}
	.odds {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 16px;
		font-size: 15px;
	}
	.hint {
		margin: 0;
		font-size: 14px;
		line-height: 1.4;
		color: var(--text-dim);
	}
	.good {
		color: var(--good);
	}
	.bad {
		color: var(--bad);
	}
	.inside {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding-right: 4px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(175px, 1fr));
		gap: 8px;
	}
	.grid :global(.item-card) {
		cursor: default;
		pointer-events: none;
	}
	.owned {
		color: var(--text-dim);
	}
	.plain {
		color: var(--text);
		background: rgba(255, 255, 255, 0.08);
	}
	.back {
		align-self: flex-start;
	}
	.reel {
		position: relative;
		flex: none;
		height: 172px;
		margin: auto 0;
		overflow: hidden;
		background: rgba(0, 0, 0, 0.35);
		border: 1px solid var(--panel-border);
		border-radius: var(--radius);
		mask-image: linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent);
	}
	.reel.done {
		margin: 6px 0;
	}
	.strip {
		position: absolute;
		left: 0;
		top: 12px;
		display: flex;
		will-change: transform;
	}
	/* 130 wide + 4 + 4 = STEP. */
	.card {
		flex: none;
		width: 130px;
		height: 148px;
		margin: 0 4px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: space-between;
		box-sizing: border-box;
		padding: 4px 6px 8px;
		font: 600 13px/1.15 var(--ui-font);
		text-align: center;
		background: linear-gradient(0deg, color-mix(in srgb, var(--c) 38%, transparent), rgba(255, 255, 255, 0.05) 75%);
		border-bottom: 4px solid var(--c);
		border-radius: 2px;
	}
	.card span {
		margin-top: auto;
	}
	.card img {
		width: 100px;
		height: 100px;
	}
	.reel.done .card:not(.win) {
		opacity: 0.35;
	}
	.card.win {
		box-shadow: 0 0 22px var(--c);
	}
	.marker {
		position: absolute;
		left: 50%;
		top: 0;
		bottom: 0;
		width: 3px;
		margin-left: -1.5px;
		background: var(--accent);
		box-shadow: 0 0 8px rgba(0, 0, 0, 0.8);
	}
	.prize {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: center;
		gap: 26px;
		animation: pop 0.28s ease-out;
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0.92);
		}
	}
	.picture {
		flex: 0 0 auto;
		width: min(230px, 34%);
		aspect-ratio: 1;
		background: radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--rarity) 45%, transparent), transparent 70%);
	}
	.picture img {
		display: block;
		width: 100%;
		height: 100%;
	}
	.what {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.rarity {
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--rarity);
	}
	.name {
		font-size: 28px;
		line-height: 1.1;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 6px;
	}
	@media (prefers-reduced-motion: reduce) {
		.shake,
		.prize {
			animation: none;
		}
	}
</style>
