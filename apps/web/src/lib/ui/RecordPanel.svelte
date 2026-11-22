<script lang="ts">
	import { formatRunTime } from '#lib/ui/format.js';

	let {
		pbTicks,
		pbRank,
		recordTicks,
		recordName,
		unofficial
	}: {
		pbTicks: number | null;
		pbRank: number | null;
		recordTicks: number | null;
		recordName: string | null;
		unofficial: boolean;
	} = $props();
</script>

<div class="records ss-panel ss-shadow">
	{#if unofficial}<div class="badge">Unofficial</div>{/if}
	<div class="row">
		<span class="ss-label">Personal best</span>
		<span class="val ss-num">{pbTicks === null ? '—' : formatRunTime(pbTicks)}</span>
		{#if pbRank !== null}<span class="rank ss-num">#{pbRank}</span>{/if}
	</div>
	<div class="row">
		<span class="ss-label">Map record</span>
		<span class="val ss-num">{recordTicks === null ? '—' : formatRunTime(recordTicks)}</span>
		{#if recordName}<span class="who">{recordName}</span>{/if}
	</div>
</div>

<style>
	.records {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 12px;
		min-width: 170px;
		font-size: calc(14px * var(--hud-scale));
	}
	.row {
		display: grid;
		grid-template-columns: 1fr auto;
		column-gap: 8px;
		align-items: baseline;
	}
	.row .ss-label {
		grid-column: 1 / -1;
		font-size: calc(10px * var(--hud-scale));
	}
	.val {
		font-size: 1.25em;
		font-weight: 600;
	}
	.rank {
		color: var(--accent);
		font-weight: 700;
	}
	.who {
		color: var(--text-dim);
		max-width: 130px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge {
		align-self: flex-start;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #14161a;
		background: var(--system);
		padding: 2px 6px;
		border-radius: 2px;
		text-shadow: none;
	}
</style>
