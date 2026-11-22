<script lang="ts">
	let { spectating }: { spectating: { targetName: string; freeFly: boolean } } = $props();
</script>

<div class="spec ss-panel ss-shadow">
	<div class="title">
		{#if spectating.freeFly}
			<span class="ss-label">Free cam</span>
		{:else}
			<span class="ss-label">Spectating</span>
			<span class="name">{spectating.targetName}</span>
		{/if}
	</div>
	<div class="hint">Mouse1/Mouse2: next/prev · Space: free cam · M: back to play</div>
</div>

<style>
	.spec {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 6px 18px 7px;
	}
	.title {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.title .ss-label {
		color: var(--accent);
	}
	.name {
		font-size: calc(18px * var(--hud-scale));
		font-weight: 700;
	}
	.hint {
		font-size: 12px;
		color: var(--text-dim);
		letter-spacing: 0.03em;
	}
</style>
