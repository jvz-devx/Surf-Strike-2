<script lang="ts">
	import { formatClock } from '#lib/ui/format.js';

	let { mapId, timeLeft }: { mapId: string; timeLeft: number } = $props();
</script>

<div class="mapinfo ss-panel ss-shadow">
	<span class="map">{mapId}</span>
	<span class="dot">·</span>
	<span class="left ss-num" class:low={timeLeft <= 60}>{formatClock(timeLeft)}</span>
</div>

<style>
	.mapinfo {
		display: inline-flex;
		align-items: baseline;
		gap: 8px;
		padding: 4px 14px;
		font-size: calc(15px * var(--hud-scale));
	}
	.map {
		font-weight: 600;
		letter-spacing: 0.04em;
	}
	.dot {
		color: var(--text-faint);
	}
	.left {
		font-weight: 600;
		font-size: 1.12em;
	}
	.low {
		color: var(--bad);
	}
</style>
