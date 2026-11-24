<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { CasinoEntry, CasinoGame } from '@surf/shared';
	import type { CasinoView, GameApi } from '#lib/game/contract.js';
	import { betHint, gameResults, parseBet, quickBet, signed } from '#lib/game/casino.js';

	/** Frame of a casino game: the game, the bet box with the last results beside it, and how it works below. */
	let {
		api,
		casino,
		game,
		balance,
		recent,
		loggedIn,
		bet = $bindable(),
		locked,
		action,
		onplay,
		blocked = null,
		mults = false,
		stage,
		extra,
		how
	}: {
		api: GameApi;
		casino: CasinoView;
		game: CasinoGame;
		/** Tenths. */
		balance: number;
		recent: readonly CasinoEntry[];
		loggedIn: boolean;
		bet: string;
		/** A bet is running: the bet box is fixed. */
		locked: boolean;
		/** Main button; `null` bet hint: `onplay` is called with the bet. `free`: usable while locked. */
		action: { label: string; disabled?: boolean; free?: boolean; tone?: 'cash' };
		onplay: (bet: number) => void;
		/** Why the game itself cannot start. */
		blocked?: string | null;
		/** Results as multipliers instead of coins. */
		mults?: boolean;
		stage: Snippet;
		extra?: Snippet;
		how: Snippet;
	} = $props();

	const QUICK = [
		{ kind: 'min', label: 'Min' },
		{ kind: 'half', label: '½' },
		{ kind: 'double', label: '2×' },
		{ kind: 'max', label: 'Max' }
	] as const;

	const limits = $derived({ min: casino.min[game], max: casino.max, balance });
	const parsed = $derived(parseBet(bet));
	const hint = $derived(locked ? null : (blocked ?? betHint(parsed, limits)));
	const off = $derived(action.disabled || (locked ? !action.free : hint !== null));
	const results = $derived(gameResults(recent, game, 12));

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!off && loggedIn) onplay(parsed ?? 0);
	}
</script>

<div class="table">
	<div class="left">
		<div class="stage">{@render stage()}</div>
		<section class="how" aria-label="How it works">{@render how()}</section>
	</div>
	<form class="side" onsubmit={submit}>
		{#if loggedIn}
			<label class="ss-label" for="casino-bet">Bet · {limits.min} to {limits.max} coins</label>
			<input
				id="casino-bet"
				class="ss-input ss-num"
				inputmode="numeric"
				autocomplete="off"
				maxlength="4"
				bind:value={bet}
				readonly={locked}
				onfocus={(e) => e.currentTarget.select()}
			/>
			<div class="quick" role="group" aria-label="Change the bet">
				{#each QUICK as q (q.kind)}
					<button
						type="button"
						disabled={locked}
						onclick={() => {
							bet = String(quickBet(q.kind, parsed, limits));
							api.casinoSound('tick');
						}}>{q.label}</button
					>
				{/each}
			</div>
			{@render extra?.()}
			<!-- aria-disabled: the button keeps the focus while a bet runs. -->
			<button type="submit" class="ss-button main" class:cash={action.tone === 'cash'} aria-disabled={off}>{action.label}</button>
			<p class="note" role="status">
				{#if hint}<span class="bad">{hint}</span>{:else if casino.error && !locked}<span class="bad">{casino.error.text}</span>{/if}
			</p>
			<h3 class="ss-label">Last results</h3>
			<ul class="results">
				{#each results as r, i (`${r.at}:${results.length - i}`)}
					<li class="ss-num" class:good={r.net > 0} class:bad={r.net < 0}>{mults ? (r.mult > 0 ? `${r.mult.toFixed(2)}×` : 'Crash') : signed(r.net)}</li>
				{:else}
					<li class="none">None yet</li>
				{/each}
			</ul>
		{:else}
			<p class="guest">Guests can look around. Log in to play with your coins.</p>
			<button type="button" class="ss-button main" onclick={() => api.openAuth()}>Log in / Register</button>
			<p class="guest">A new account starts with coins, and every mode pays more.</p>
		{/if}
		<p class="fine">Coins are earned by playing and have no real value.</p>
	</form>
</div>

<style>
	.table {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 236px;
		gap: 18px;
	}
	.left {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.stage {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: radial-gradient(circle at 50% 35%, #1d2a36 0%, #10161d 58%, #0b0e12 100%);
		border: 1px solid var(--panel-border);
		border-radius: var(--radius);
	}
	.how {
		flex: none;
		font-size: 14px;
		line-height: 1.4;
		color: var(--text-dim);
	}
	.side {
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 2px;
	}
	input {
		width: 100%;
		box-sizing: border-box;
		font-size: 24px;
		font-weight: 700;
		color: var(--accent);
	}
	input:read-only {
		opacity: 0.6;
	}
	.quick {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 4px;
	}
	.quick button {
		padding: 7px 0;
		font: 600 14px/1 var(--ui-font);
		color: var(--text);
		background: rgba(255, 255, 255, 0.07);
		border: 1px solid var(--panel-border);
		border-radius: var(--radius);
		cursor: pointer;
	}
	.quick button:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.14);
	}
	.quick button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.main {
		margin-top: 4px;
		padding: 14px 10px;
		font-size: 16px;
	}
	.main[aria-disabled='true'] {
		opacity: 0.45;
		cursor: default;
		filter: none;
	}
	.main.cash {
		background: var(--good);
	}
	.note {
		min-height: 1.35em;
		margin: 0;
		font-size: 14px;
		line-height: 1.35;
	}
	h3 {
		margin: 2px 0 0;
		font-size: 12px;
	}
	.results {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.results li {
		padding: 3px 7px;
		font-size: 14px;
		font-weight: 600;
		line-height: 1.1;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 2px;
	}
	.results li.none {
		padding-left: 0;
		font-weight: 400;
		color: var(--text-faint);
		background: none;
	}
	.good {
		color: var(--good);
	}
	.bad {
		color: var(--bad);
	}
	.guest {
		margin: 0;
		line-height: 1.4;
		color: var(--text-dim);
	}
	.fine {
		margin: auto 0 0;
		font-size: 12px;
		line-height: 1.3;
		color: var(--text-faint);
	}
</style>
