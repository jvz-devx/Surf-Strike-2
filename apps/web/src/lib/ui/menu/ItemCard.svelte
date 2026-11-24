<script lang="ts">
	import type { Snippet } from 'svelte';
	import { RARITIES, type RarityId } from '@surf/shared';
	import type { ItemPictures } from '#lib/ui/menu/item-pictures.svelte.js';

	/** One item in the shop or the inventory: picture, name, rarity and a state on the right. */
	let {
		pictures,
		drawn,
		name,
		rarity,
		selected = false,
		worn = false,
		dim = false,
		onclick,
		children
	}: {
		pictures: ItemPictures;
		/** Item in the picture; null: nothing to draw. */
		drawn: string | null;
		name: string;
		/** null: the default look. */
		rarity: RarityId | null;
		selected?: boolean;
		worn?: boolean;
		dim?: boolean;
		onclick: () => void;
		/** State or price. */
		children?: Snippet;
	} = $props();

	const color = $derived(rarity ? RARITIES[rarity].color : 'var(--text-dim)');
	const url = $derived(drawn === null ? undefined : pictures.urls[drawn]);
</script>

<button type="button" class="item-card" class:selected class:worn class:dim style:--rarity={color} aria-pressed={selected} {onclick} {@attach pictures.watch(drawn)}>
	<span class="thumb">
		{#if url}
			<img src={url} alt="" draggable="false" />
		{:else if drawn === null}
			<svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="13" /><path d="M19 37 37 19" /></svg>
		{/if}
	</span>
	<span class="name">{name}</span>
	<span class="meta">
		<span class="rarity">{rarity ? RARITIES[rarity].name : 'Default'}</span>
		{@render children?.()}
	</span>
</button>

<style>
	.item-card {
		display: grid;
		grid-template-columns: 56px minmax(0, 1fr);
		grid-template-rows: auto auto;
		align-items: center;
		gap: 2px 10px;
		padding: 7px 10px 7px 7px;
		font: 600 15px/1.15 var(--ui-font);
		text-align: left;
		color: var(--text);
		background: linear-gradient(90deg, color-mix(in srgb, var(--rarity) 14%, transparent), rgba(255, 255, 255, 0.03) 60%);
		border: 1px solid var(--panel-border);
		border-left: 3px solid var(--rarity);
		border-radius: var(--radius);
		cursor: pointer;
		content-visibility: auto;
		contain-intrinsic-size: auto 72px;
	}
	.item-card:hover,
	.item-card:focus-visible {
		background-color: rgba(255, 255, 255, 0.07);
	}
	/* Inside, so the scroll area does not cut it off. */
	.item-card:focus-visible {
		outline-offset: -2px;
	}
	.item-card.worn {
		border-color: var(--good);
		border-left-color: var(--rarity);
		box-shadow: inset 0 0 0 1px var(--good);
	}
	.item-card.selected {
		border-color: var(--accent);
		border-left-color: var(--rarity);
		background-color: var(--accent-soft);
	}
	.item-card.dim .thumb,
	.item-card.dim .name {
		opacity: 0.6;
	}
	.thumb {
		grid-row: 1 / 3;
		width: 56px;
		height: 56px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 2px;
	}
	.thumb img,
	.thumb svg {
		display: block;
		width: 100%;
		height: 100%;
	}
	.thumb svg {
		fill: none;
		stroke: var(--text-faint);
		stroke-width: 2;
	}
	.name {
		align-self: end;
		overflow-wrap: anywhere;
	}
	.meta {
		align-self: start;
		display: flex;
		justify-content: space-between;
		gap: 6px;
		font-size: 13px;
	}
	.rarity {
		color: var(--rarity);
	}
</style>
