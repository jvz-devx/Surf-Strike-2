<script lang="ts">
	import { formatSpeed } from '#lib/ui/format.js';

	let { speed, trend }: { speed: number; trend: 'up' | 'down' | 'flat' } = $props();
</script>

<div class="speed ss-num ss-shadow" class:up={trend === 'up'} class:down={trend === 'down'}>
	<span class="value">{formatSpeed(speed)}</span><span class="unit">u/s</span>
</div>

<style>
	.speed {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 6px;
		color: var(--text);
		line-height: 1;
		transition: color 120ms linear;
	}
	.value {
		font-size: calc(64px * var(--hud-scale));
		font-weight: 700;
		min-width: 3.2ch;
		text-align: center;
	}
	.unit {
		font-size: calc(16px * var(--hud-scale));
		font-weight: 600;
		color: var(--text-dim);
	}
	.up {
		color: var(--good);
	}
	.down {
		color: var(--bad);
	}
</style>
