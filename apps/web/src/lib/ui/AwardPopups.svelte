<script lang="ts">
	import type { AwardPopup } from '#lib/game/contract.js';
	import { popupMs } from '#lib/game/coins.js';

	/** Award popups and coins notices (docs/ui.md#award-popups), newest at the bottom. */
	let { popups, now, max }: { popups: readonly AwardPopup[]; now: number; max: number } = $props();

	const FADE_MS = 400;
	const shown = $derived(popups.filter((p) => now - p.at < popupMs(p)).slice(-max));
	const opacity = (p: AwardPopup) => Math.min(1, (popupMs(p) - (now - p.at)) / FADE_MS);
</script>

<div class="popups" role="status" aria-live="polite">
	{#each shown as p (p.id)}
		<div class="popup ss-panel ss-shadow {p.tone}" style:opacity={opacity(p)}>
			{#if p.amount}<span class="amount ss-num">{p.amount} coins</span>{/if}
			<span class="text">{p.text}</span>
			{#if p.mult}<span class="mult ss-num">{p.mult}</span>{/if}
		</div>
	{/each}
</div>

<style>
	.popups {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		/* Stays left of the banners at the top centre. */
		width: clamp(190px, calc(50vw - 270px), 340px);
		font-size: calc(14px * var(--hud-scale));
	}
	.popup {
		display: flex;
		align-items: baseline;
		column-gap: 8px;
		max-width: 100%;
		box-sizing: border-box;
		padding: 4px 10px;
		line-height: 1.25;
		box-shadow: none;
		border-left: 2px solid var(--accent);
		animation: in 0.15s ease-out;
	}
	.amount {
		font-weight: 700;
		font-size: 1.15em;
		color: var(--accent);
		white-space: nowrap;
	}
	.text {
		font-weight: 600;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.info .text,
	.warn .text {
		white-space: normal;
		font-size: 0.93em;
	}
	.mult {
		color: var(--text-dim);
		font-weight: 600;
	}
	.info {
		border-left-color: var(--info);
	}
	.warn {
		border-left-color: var(--bad);
	}
	@keyframes in {
		from {
			transform: translateX(-10px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.popup {
			animation: none;
		}
	}
</style>
