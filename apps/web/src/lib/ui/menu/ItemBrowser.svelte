<script lang="ts">
	import { onDestroy, type Snippet } from 'svelte';
	import type { Loadout } from '@surf/shared';
	import type { GameApi } from '#lib/game/contract.js';
	import type { ItemPictures } from '#lib/ui/menu/item-pictures.svelte.js';

	/** Frame of the shop and the inventory: turntable and details on the left, a toolbar and a scrolling list on the right. */
	let {
		api,
		pictures,
		look,
		onreset,
		panelId,
		labelledby,
		detail,
		toolbar,
		list
	}: {
		api: GameApi;
		pictures: ItemPictures;
		/** What the turntable wears. */
		look: Loadout;
		/** Shows "Reset look" (set while something is only tried on). */
		onreset: (() => void) | null;
		panelId: string;
		labelledby: string;
		detail: Snippet;
		toolbar?: Snippet;
		list: Snippet;
	} = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let preview: ReturnType<GameApi['createPreview']> = $state.raw(null);
	let noPreview = $state(false);

	// The preview lives as long as its canvas.
	$effect(() => {
		if (!canvas) return;
		const p = api.createPreview(canvas);
		preview = p;
		noPreview = p === null;
		pictures.setPreview(p);
		return () => {
			preview = null;
			pictures.setPreview(null);
			p?.dispose();
		};
	});
	$effect(() => {
		preview?.setLoadout(look);
	});
	onDestroy(() => pictures.dispose());
</script>

<div class="wrap">
	<div class="body">
		<section class="side" aria-label="Preview">
			<div class="stage">
				<canvas bind:this={canvas} aria-label="Your character wearing the selected items; drag to turn"></canvas>
				{#if noPreview}<p class="nopreview">No 3D preview in this browser.</p>{/if}
				{#if onreset}<button type="button" class="reset" onclick={onreset}>Reset look</button>{/if}
			</div>
			{@render detail()}
		</section>
		<div class="main">
			{@render toolbar?.()}
			<div class="list" id={panelId} role="tabpanel" aria-labelledby={labelledby}>
				{@render list()}
			</div>
		</div>
	</div>
</div>

<style>
	.wrap {
		user-select: none;
		flex: 1;
		min-height: 0;
		container-type: size;
	}
	.body {
		height: 100%;
		display: grid;
		grid-template-columns: minmax(210px, 30%) minmax(0, 1fr);
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
	.nopreview {
		position: absolute;
		inset: auto 10px 45%;
		margin: 0;
		font-size: 14px;
		text-align: center;
		color: var(--text-dim);
	}
	.main {
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding-right: 4px;
	}
	/* Seven tabs fit in one line at 1280 wide. */
	.main :global(.tabs button) {
		padding-inline: 7px;
		letter-spacing: 0.07em;
	}
	/* Shared by the two menus. */
	.wrap :global(.item-grid) {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(175px, 1fr));
		gap: 8px;
	}
	.wrap :global(.item-detail) {
		min-height: 92px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.wrap :global(.item-title) {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		font-size: 18px;
	}
	.wrap :global(.item-row) {
		display: flex;
		gap: 8px;
	}
	.wrap :global(.item-row > button) {
		flex: 1 0 auto;
		padding-inline: 6px;
		letter-spacing: 0.07em;
	}
	.wrap :global(.ss-button.plain) {
		color: var(--text);
		background: rgba(255, 255, 255, 0.08);
	}
	.wrap :global(.hint) {
		margin: 0;
		font-size: 14px;
		line-height: 1.4;
		color: var(--text-dim);
	}
	.wrap :global(.hint strong) {
		color: var(--text);
	}
	.wrap :global(.good) {
		color: var(--good);
	}
	.wrap :global(.bad) {
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
			flex-wrap: wrap;
			padding-bottom: 6px;
			background: #101318;
		}
		.stage {
			flex: 0 0 38%;
			height: min(210px, 42cqh);
		}
		.side :global(.item-detail) {
			flex: 1;
			min-width: 0;
		}
		.list {
			flex: none;
			overflow: visible;
		}
		.wrap :global(.item-row) {
			flex-wrap: wrap;
		}
	}
</style>
