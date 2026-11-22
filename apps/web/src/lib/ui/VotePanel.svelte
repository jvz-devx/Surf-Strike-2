<script lang="ts">
	import type { VoteView } from '#lib/game/contract.js';

	let { vote, now }: { vote: VoteView; now: number } = $props();

	const total = $derived(vote.counts.reduce((a, b) => a + b, 0));
	const remainingMs = $derived(Math.max(0, vote.endsAt - now));
	const frac = $derived(vote.duration > 0 ? Math.min(1, remainingMs / (vote.duration * 1000)) : 0);
	const changeIn = $derived(vote.result ? Math.max(0, Math.ceil((vote.result.changeAt - now) / 1000)) : 0);
</script>

<div class="vote ss-panel ss-shadow" role="status">
	<div class="head">
		<span class="ss-label">{vote.rtv ? 'Rock the vote' : 'Vote next map'}</span>
		{#if !vote.result}<span class="secs ss-num">{Math.ceil(remainingMs / 1000)}s</span>{/if}
	</div>
	{#if vote.result}
		<div class="result">
			<div class="winner">{vote.result.label}</div>
			<div class="sub">
				{#if changeIn > 0}Changing in <span class="ss-num">{changeIn}</span>s{:else}Changing…{/if}
			</div>
		</div>
	{:else}
		<ol class="options">
			{#each vote.labels as label, i (i)}
				{@const count = vote.counts[i] ?? 0}
				<li class:mine={vote.myVote === i + 1}>
					<span class="key ss-num">{i + 1}</span>
					<span class="label">{label}</span>
					<span class="count ss-num">{count}</span>
					<span class="fill" style:width="{total > 0 ? (count / total) * 100 : 0}%"></span>
				</li>
			{/each}
		</ol>
		<div class="bar" aria-hidden="true"><span style:width="{frac * 100}%"></span></div>
		<div class="hint">Press 1–{vote.labels.length} to vote</div>
	{/if}
</div>

<style>
	.vote {
		/* Fits 7 rows: 6 maps ("Zombies · Title") plus extend. */
		width: calc(270px * var(--hud-scale));
		max-height: calc(100vh - 120px);
		padding: 8px 10px 9px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: calc(14px * var(--hud-scale));
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
	.options {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	li {
		position: relative;
		display: grid;
		grid-template-columns: 22px 1fr auto;
		align-items: center;
		gap: 6px;
		padding: 3px 6px 3px 3px;
		border: 1px solid transparent;
		border-radius: 2px;
		overflow: hidden;
	}
	li.mine {
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
	.label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.count {
		font-weight: 700;
	}
	.fill {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 2px;
		background: rgba(238, 241, 245, 0.45);
		transition: width 200ms ease-out;
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
	.hint,
	.sub {
		font-size: 12px;
		color: var(--text-dim);
	}
	.winner {
		font-size: 1.3em;
		font-weight: 700;
	}
</style>
