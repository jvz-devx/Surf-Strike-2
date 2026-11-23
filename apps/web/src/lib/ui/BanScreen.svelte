<script lang="ts">
	import { onMount } from 'svelte';
	import { countdown } from '#lib/game/coins.js';
	import type { BanView, GameApi } from '#lib/game/contract.js';

	/** Banned (docs/ui.md#ban-screen): reason and time left; `Play solo` shrinks it to a line at the top left. */
	let { ban, now, api }: { ban: BanView; now: number; api: GameApi } = $props();

	let button: HTMLButtonElement | undefined = $state();
	const left = $derived(ban.until === null ? null : Math.max(0, (ban.until - now) / 1000));

	onMount(() => button?.focus());
	function keydown(e: KeyboardEvent) {
		if (ban.minimized || e.key !== 'Escape' || e.defaultPrevented) return;
		e.preventDefault();
		api.minimizeBan(true);
	}
</script>

<svelte:window onkeydown={keydown} />

{#if ban.minimized}
	{#if left !== null}
		<div class="strip ss-panel ss-shadow" role="status">
			{#if left > 0}Banned: online again in <span class="ss-num">{countdown(left)}</span>{:else}Ban over: reconnecting…{/if}
		</div>
	{/if}
{:else}
	<div class="backdrop">
		<div class="card ss-panel" role="alertdialog" aria-labelledby="ss-ban-title" aria-describedby="ss-ban-text">
			<h2 id="ss-ban-title">You are banned</h2>
			<p id="ss-ban-text" class="reason">{ban.reason ?? 'No reason was given.'}</p>
			{#if left === null}
				<p class="hint">This ban does not lift by itself.</p>
			{:else if left > 0}
				<div class="time ss-num">{countdown(left)}</div>
				<p class="hint">The ban lifts by itself and you are connected again.</p>
			{:else}
				<div class="time">Reconnecting…</div>
			{/if}
			<button type="button" class="ss-button" bind:this={button} onclick={() => api.minimizeBan(true)}>Play solo{left === null ? '' : ' meanwhile'}</button>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
		color: var(--text);
		font-family: var(--ui-font);
	}
	.card {
		width: min(400px, calc(100vw - 48px));
		box-sizing: border-box;
		padding: 24px 28px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		text-align: center;
		background: var(--panel-bg-strong);
		border-color: rgba(255, 90, 78, 0.5);
	}
	h2 {
		margin: 0;
		font: 700 26px/1 var(--ui-font);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--bad);
	}
	p {
		margin: 0;
	}
	.reason {
		font-size: 16px;
		overflow-wrap: anywhere;
	}
	.time {
		font-size: 46px;
		font-weight: 700;
		line-height: 1.1;
	}
	.hint {
		font-size: 14px;
		color: var(--text-dim);
	}
	.strip {
		padding: 4px 12px;
		font: 600 14px/1.3 var(--ui-font);
		color: var(--text);
		border-color: rgba(255, 90, 78, 0.5);
		pointer-events: none;
	}
</style>
