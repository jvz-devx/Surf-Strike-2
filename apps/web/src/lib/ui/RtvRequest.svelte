<script lang="ts">
	import type { RtvRequestView } from '#lib/game/contract.js';

	/**
	 * RTV request modal (docs/ui.md#rtv-request): CS2-style vote notice at the
	 * top centre. Keys 1 / 2 answer (routed by the engine); the buttons work
	 * with a free cursor (`interactive`).
	 */
	let {
		request,
		now,
		interactive = false,
		onvote
	}: { request: RtvRequestView; now: number; interactive?: boolean; onvote: (yes: boolean) => void } = $props();

	const remainingMs = $derived(Math.max(0, request.endsAt - now));
	const frac = $derived(request.duration > 0 ? Math.min(1, remainingMs / (request.duration * 1000)) : 0);
	const result = $derived(request.result);
</script>

<div class="rtv ss-panel ss-shadow" role="status" aria-live="polite" class:passed={result?.passed} class:declined={result && !result.passed}>
	<div class="head">
		<span class="ss-label">Map vote request</span>
		{#if !result}<span class="secs ss-num">{Math.ceil(remainingMs / 1000)}s</span>{/if}
	</div>
	<div class="text">
		<strong>{request.initiator}</strong> wants to vote for a new map{#if request.mapLabel}&nbsp;(<span class="map">{request.mapLabel}</span>){/if}
	</div>
	{#if result}
		<div class="outcome">{result.passed ? 'Passed: map vote starting' : 'Declined'}</div>
	{:else}
		<div class="choices">
			<button
				type="button"
				class="choice yes"
				class:mine={request.myChoice === 'yes'}
				disabled={!request.canVote || !interactive}
				tabindex={interactive ? 0 : -1}
				onclick={() => onvote(true)}
			>
				<span class="key ss-num">1</span><span class="lbl">Yes</span><span class="count ss-num">{request.yes}</span>
			</button>
			<button
				type="button"
				class="choice no"
				class:mine={request.myChoice === 'no'}
				disabled={!request.canVote || !interactive}
				tabindex={interactive ? 0 : -1}
				onclick={() => onvote(false)}
			>
				<span class="key ss-num">2</span><span class="lbl">No</span><span class="count ss-num">{request.no}</span>
			</button>
		</div>
		<div class="bar" aria-hidden="true"><span style:width="{frac * 100}%"></span></div>
		<div class="hint">
			{#if request.canVote}1 = Yes · 2 = No{:else}Spectating: you cannot vote{/if}
			<span class="need">· <span class="ss-num">{request.yes}</span>/<span class="ss-num">{request.needed}</span> yes needed</span>
		</div>
	{/if}
</div>

<style>
	.rtv {
		width: calc(320px * var(--hud-scale));
		max-width: calc(100vw - 32px);
		box-sizing: border-box;
		padding: 8px 12px 9px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: calc(14px * var(--hud-scale));
		border-top: 2px solid var(--accent);
	}
	.rtv.passed {
		border-top-color: var(--good);
	}
	.rtv.declined {
		border-top-color: var(--bad);
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.head .ss-label {
		color: var(--accent);
	}
	.secs {
		font-weight: 700;
		font-size: 1.1em;
	}
	.text {
		line-height: 1.3;
	}
	.text strong {
		color: var(--accent);
		font-weight: 700;
	}
	.map {
		font-weight: 600;
	}
	.choices {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}
	.choice {
		display: grid;
		grid-template-columns: 22px 1fr auto;
		align-items: center;
		gap: 6px;
		padding: 3px 8px 3px 3px;
		font: inherit;
		color: var(--text);
		text-align: left;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid transparent;
		border-radius: 2px;
		pointer-events: auto;
	}
	.choice:not(:disabled) {
		cursor: pointer;
	}
	.choice:not(:disabled):hover,
	.choice:focus-visible {
		background: rgba(255, 255, 255, 0.1);
		outline: none;
	}
	.choice:disabled {
		cursor: default;
	}
	.choice.mine {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.key {
		display: grid;
		place-items: center;
		height: 20px;
		font-weight: 700;
		background: rgba(255, 255, 255, 0.1);
		border-radius: 2px;
	}
	.mine .key {
		background: var(--accent);
		color: #14161a;
		text-shadow: none;
	}
	.yes .count {
		color: var(--good);
	}
	.no .count {
		color: var(--bad);
	}
	.count {
		font-weight: 700;
	}
	.bar {
		height: 3px;
		background: rgba(255, 255, 255, 0.1);
		border-radius: 2px;
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	.hint {
		font-size: 12px;
		color: var(--text-dim);
	}
	.need {
		color: var(--text-faint);
	}
	.outcome {
		font-size: 1.15em;
		font-weight: 700;
	}
	.passed .outcome {
		color: var(--good);
	}
	.declined .outcome {
		color: var(--bad);
	}
</style>
