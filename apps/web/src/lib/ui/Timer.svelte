<script lang="ts">
	import { formatRunTime, stageText } from '#lib/ui/format.js';

	let {
		ticks,
		phase,
		stage,
		stageCount,
		kind
	}: {
		ticks: number;
		phase: 'start' | 'running' | 'finished' | 'idle';
		stage: number;
		stageCount: number;
		kind: 'stage' | 'checkpoint';
	} = $props();

	const sub = $derived(stageText(phase, stage, stageCount, kind));
</script>

<div class="timer ss-shadow" class:finished={phase === 'finished'} class:idle={phase === 'idle'}>
	<div class="time ss-num">{formatRunTime(phase === 'start' ? 0 : ticks)}</div>
	{#if sub}<div class="sub ss-label">{sub}</div>{/if}
</div>

<style>
	.timer {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}
	.time {
		font-size: calc(26px * var(--hud-scale));
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	.idle .time {
		color: var(--text-faint);
	}
	.finished .time {
		color: var(--accent);
	}
	.sub {
		color: var(--text);
		opacity: 0.8;
	}
</style>
