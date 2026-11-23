<script lang="ts">
	import { onMount } from 'svelte';
	import type { GameHandle } from '#lib/game/contract.js';
	import Hud from '#lib/ui/Hud.svelte';

	let canvas: HTMLCanvasElement;
	let handle: GameHandle | null = $state(null);
	let error: string | null = $state(null);

	onMount(() => {
		let destroyed = false;
		let h: GameHandle | null = null;
		let stopGallery: (() => void) | null = null;
		const params = new URLSearchParams(location.search);

		(async () => {
			try {
				// Dev-only character viewer (docs/characters.md).
				if (import.meta.env.DEV && params.has('characters')) {
					const { startGallery } = await import('#lib/render/character/gallery.js');
					if (destroyed) return;
					stopGallery = startGallery(canvas);
					return;
				}
				let created: GameHandle;
				if (import.meta.env.DEV && params.has('mockhud')) {
					const { createMockGame } = await import('#lib/ui/mock.svelte.js');
					created = createMockGame(canvas, params.get('open'));
				} else {
					const { createGame } = await import('#lib/game/index.js');
					// Unmounted while loading (navigation, HMR): the canvas is gone.
					if (destroyed) return;
					created = createGame(canvas);
				}
				if (destroyed) created.destroy();
				else handle = h = created;
			} catch (e) {
				console.error(e);
				error = e instanceof Error ? e.message : String(e);
			}
		})();

		return () => {
			destroyed = true;
			h?.destroy();
			stopGallery?.();
			handle = null;
		};
	});

	function onclick() {
		const hud = handle?.hud;
		if (!hud || hud.pointerLocked) return;
		if (hud.chatOpen || hud.consoleOpen || hud.settingsOpen || hud.authPanelOpen || hud.desktopOnly || (hud.ban && !hud.ban.minimized)) return;
		handle?.api.lockPointer();
	}
</script>

<svelte:head>
	<title>Surf Strike 2</title>
</svelte:head>

<main class="game">
	<!-- The canvas is the game surface; keyboard input is handled globally by the engine. -->
	<canvas bind:this={canvas} {onclick}></canvas>
	{#if handle}
		<Hud hud={handle.hud} api={handle.api} />
	{:else if error}
		<div class="boot ss-panel" role="alert">Failed to start: {error}</div>
	{/if}
</main>

<style>
	.game {
		position: fixed;
		inset: 0;
		overflow: hidden;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
	.boot {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		padding: 14px 18px;
		color: var(--bad);
	}
</style>
