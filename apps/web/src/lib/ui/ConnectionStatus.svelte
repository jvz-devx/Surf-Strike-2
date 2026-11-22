<script lang="ts">
	let {
		online,
		connecting,
		playerCount,
		maxPlayers,
		showFps,
		fps
	}: {
		online: boolean;
		connecting: boolean;
		playerCount: number;
		maxPlayers: number;
		showFps: boolean;
		fps: number;
	} = $props();

	const state = $derived(online ? 'online' : connecting ? 'connecting' : 'offline');
</script>

<div class="conn ss-shadow">
	<div class="status {state}">
		<span class="led" aria-hidden="true"></span>
		{#if state === 'online'}
			Online · <span class="ss-num">{playerCount} / {maxPlayers}</span>
		{:else if state === 'connecting'}
			Connecting…
		{:else}
			Offline — solo
		{/if}
	</div>
	{#if showFps}
		<div class="fps ss-num">{Math.round(fps)} <span class="ss-label">fps</span></div>
	{/if}
</div>

<style>
	.conn {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		font-size: calc(14px * var(--hud-scale));
		font-weight: 600;
		letter-spacing: 0.04em;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.led {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--text-faint);
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
	}
	.online .led {
		background: var(--good);
	}
	.connecting .led {
		background: var(--system);
		animation: blink 1s steps(2, start) infinite;
	}
	.offline {
		color: var(--text-dim);
	}
	.fps {
		font-size: 1.15em;
	}
	@keyframes blink {
		to {
			visibility: hidden;
		}
	}
</style>
