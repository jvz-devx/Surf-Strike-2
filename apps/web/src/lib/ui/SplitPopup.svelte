<script lang="ts">
	import { deltaClass, fadeOpacity, formatDelta, formatRunTime } from '#lib/ui/format.js';

	let {
		split,
		now
	}: { split: { label: string; ticks: number; delta: number | null; at: number } | null; now: number } = $props();

	const opacity = $derived(split ? fadeOpacity(now - split.at, 2000, 500) : 0);
</script>

{#if split && opacity > 0}
	<div class="split ss-panel ss-shadow" style:opacity role="status">
		<span class="label">{split.label}</span>
		<span class="time ss-num">{formatRunTime(split.ticks)}</span>
		{#if split.delta !== null}
			<span class="delta ss-num {deltaClass(split.delta)}">{formatDelta(split.delta)}</span>
		{/if}
	</div>
{/if}

<style>
	.split {
		display: inline-flex;
		align-items: baseline;
		gap: 12px;
		padding: 5px 14px;
		font-size: calc(17px * var(--hud-scale));
	}
	.label {
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.85em;
	}
	.time {
		font-weight: 600;
		font-size: 1.1em;
	}
	.delta {
		font-weight: 700;
		font-size: 1.1em;
	}
	.faster {
		color: var(--good);
	}
	.slower {
		color: var(--bad);
	}
	.even {
		color: var(--text-dim);
	}
</style>
