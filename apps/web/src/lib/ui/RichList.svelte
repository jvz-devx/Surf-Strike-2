<script lang="ts">
	import { formatPoints, type RichEntry } from '@surf/shared';

	/** The accounts with the most coins (docs/gameplay.md#tab-scoreboard): a row under the Tab scoreboard, a column in the Coins menu. */
	let {
		richest,
		account,
		column = false
	}: {
		/** Richest first. */
		richest: readonly RichEntry[];
		/** The local player's account (highlighted). */
		account: string | null;
		column?: boolean;
	} = $props();
</script>

<section class="rich" class:column aria-label="Richest players">
	<h3 class="ss-label">Richest players</h3>
	<ol>
		{#each richest as r, i (r.name)}
			<li class="place{i + 1}" class:own={r.name === account}>
				<span class="pos ss-num">{i + 1}</span>
				<span class="who"><span class="dot" class:on={r.online} title={r.online ? 'Online' : 'Offline'}></span><span class="nick">{r.name}</span></span>
				<span class="sum ss-num">{formatPoints(r.coins)}<span class="unit">coins</span></span>
			</li>
		{:else}
			<li class="none">Nobody has coins yet.</li>
		{/each}
	</ol>
</section>

<style>
	h3 {
		margin: 0;
		font-size: 12px;
	}
	ol {
		list-style: none;
		margin: 7px 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 7px;
	}
	.column ol {
		grid-template-columns: minmax(0, 1fr);
	}
	li {
		--medal: var(--text-faint);
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		column-gap: 9px;
		align-items: center;
		padding: 6px 10px;
		background: rgba(255, 255, 255, 0.04);
		border-left: 3px solid var(--medal);
		border-radius: 2px;
	}
	.place1 {
		--medal: #f3c14b;
	}
	.place2 {
		--medal: #c3ccd6;
	}
	.place3 {
		--medal: #cd8a52;
	}
	.own {
		background: var(--accent-soft);
	}
	.none {
		grid-column: 1 / -1;
		display: block;
		color: var(--text-dim);
	}
	.pos {
		grid-row: 1 / 3;
		font-size: 1.5em;
		font-weight: 700;
		color: var(--medal);
	}
	.who {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
	}
	.nick {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dot {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--text-faint);
	}
	.dot.on {
		background: var(--good);
	}
	.sum {
		font-weight: 700;
		color: var(--accent);
	}
	.unit {
		margin-left: 4px;
		font-size: 0.8em;
		font-weight: 500;
		color: var(--text-dim);
	}
	@media (max-width: 860px) {
		.rich:not(.column) ol {
			grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		}
	}
</style>
