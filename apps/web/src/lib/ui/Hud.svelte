<script lang="ts">
	import { onMount } from 'svelte';
	import type { GameApi, HudStateShape } from '#lib/game/contract.js';
	import { cvarNum } from '#lib/ui/format.js';
	import Speedometer from '#lib/ui/Speedometer.svelte';
	import Timer from '#lib/ui/Timer.svelte';
	import SplitPopup from '#lib/ui/SplitPopup.svelte';
	import MapInfo from '#lib/ui/MapInfo.svelte';
	import ConnectionStatus from '#lib/ui/ConnectionStatus.svelte';
	import Chat from '#lib/ui/Chat.svelte';
	import VotePanel from '#lib/ui/VotePanel.svelte';
	import RtvRequest from '#lib/ui/RtvRequest.svelte';
	import RecordPanel from '#lib/ui/RecordPanel.svelte';
	import Crosshair from '#lib/ui/Crosshair.svelte';
	import KeysDisplay from '#lib/ui/KeysDisplay.svelte';
	import PosReadout from '#lib/ui/PosReadout.svelte';
	import Scoreboard from '#lib/ui/Scoreboard.svelte';
	import SpectatorBar from '#lib/ui/SpectatorBar.svelte';
	import Console from '#lib/ui/Console.svelte';
	import EscMenu from '#lib/ui/menu/EscMenu.svelte';
	import AuthPanel from '#lib/ui/AuthPanel.svelte';
	import DesktopOnly from '#lib/ui/DesktopOnly.svelte';
	import TagHud from '#lib/ui/TagHud.svelte';
	import ZombiesHud from '#lib/ui/ZombiesHud.svelte';

	let { hud, api }: { hud: HudStateShape; api: GameApi } = $props();

	// UI clock for fades and countdowns (same timebase as hud timestamps).
	let now = $state(performance.now());
	onMount(() => {
		let raf = 0;
		const loop = () => {
			now = performance.now();
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});

	const race = $derived(hud.modeFamily === 'race');
	const showFps = $derived(cvarNum(hud.cvars, 'cl_showfps', 0) !== 0);
	const showKeys = $derived(cvarNum(hud.cvars, 'cl_showkeys', 0) !== 0);
	const showPos = $derived(cvarNum(hud.cvars, 'cl_showpos', 0) !== 0);
	const modal = $derived(hud.consoleOpen || hud.settingsOpen || hud.authPanelOpen);
	const clickHint = $derived(!hud.pointerLocked && !modal && !hud.chatOpen && !hud.desktopOnly);
</script>

{#if hud.desktopOnly}
	<DesktopOnly />
{:else}
	<div class="hud" class:under-menu={hud.settingsOpen && !hud.authPanelOpen}>
		<div class="top-centre">
			<MapInfo mapId={hud.mapId} timeLeft={hud.mapTimeLeft} />
			{#if hud.spectating}<SpectatorBar spectating={hud.spectating} />{/if}
			{#if hud.tag}<TagHud tag={hud.tag} {now} />{/if}
			{#if hud.rtvRequest}<RtvRequest request={hud.rtvRequest} {now} interactive={!hud.pointerLocked} onvote={(yes) => api.rtvVote(yes)} />{/if}
		</div>

		<div class="top-right">
			<ConnectionStatus
				online={hud.online}
				connecting={hud.connecting}
				playerCount={hud.playerCount}
				maxPlayers={hud.maxPlayers}
				{showFps}
				fps={hud.fps}
			/>
		</div>

		{#if showPos}
			<div class="top-left"><PosReadout pos={hud.pos} speed={hud.speed} /></div>
		{/if}

		{#if hud.vote}
			<div class="left-middle"><VotePanel vote={hud.vote} {now} /></div>
		{/if}

		{#if race}
			<div class="right-middle">
				<RecordPanel
					pbTicks={hud.pbTicks}
					pbRank={hud.pbRank}
					recordTicks={hud.recordTicks}
					recordName={hud.recordName}
					unofficial={hud.unofficial}
				/>
			</div>
		{/if}

		{#if hud.zombies}<ZombiesHud z={hud.zombies} {now} />{/if}
		{#if !hud.zombies?.scoped}<Crosshair cvars={hud.cvars} />{/if}

		<div class="below-crosshair">
			{#if clickHint}
				<div class="click-hint ss-panel ss-shadow">Click to play</div>
			{/if}
			{#if showKeys}<KeysDisplay keys={hud.keys} />{/if}
		</div>

		<div class="bottom-centre">
			{#if race}<div class="split-slot"><SplitPopup split={hud.splitPopup} {now} /></div>{/if}
			<Speedometer speed={hud.speed} trend={hud.speedTrend} />
			{#if race && (!hud.spectating || !hud.spectating.freeFly)}
				<Timer
					ticks={hud.runTicks}
					phase={hud.runPhase}
					stage={hud.stage}
					stageCount={hud.stageCount}
					kind={hud.stageKind}
				/>
			{/if}
		</div>

		<div class="bottom-left">
			<Chat lines={hud.chat} open={hud.chatOpen} {now} {api} />
		</div>

		{#if hud.scoreboardOpen}
			<Scoreboard
				rows={hud.scoreboard}
				mapTitle={hud.mapTitle}
				mapId={hud.mapId}
				timeLeft={hud.mapTimeLeft}
				playerCount={hud.playerCount}
				maxPlayers={hud.maxPlayers}
				staged={hud.stageKind === 'stage'}
				mode={hud.gameMode}
			/>
		{/if}
	</div>

	{#if hud.settingsOpen && !hud.authPanelOpen}<EscMenu
			cvars={hud.cvars}
			{api}
			account={hud.account}
			online={hud.online}
			maps={hud.maps}
			mapId={hud.mapId}
			canChangeMap={hud.canChangeMap}
			spectating={!!hud.spectating}
			voteOpen={!!hud.vote}
			requestOpen={!!hud.rtvRequest && !hud.rtvRequest.result}
			rtvCooldown={hud.rtvCooldown}
			adminState={hud.adminState}
			adminNotice={hud.adminNotice}
			blocked={hud.consoleOpen}
		/>{/if}
	{#if hud.authPanelOpen}<AuthPanel
			{api}
			online={hud.online}
			connecting={hud.connecting}
			error={hud.authError}
			busy={hud.authBusy}
			guestName={String(hud.cvars.name ?? '')}
		/>{/if}
	{#if hud.consoleOpen}<Console lines={hud.consoleLines} {api} isOpen={() => hud.consoleOpen} />{/if}
{/if}

<style>
	.hud {
		position: absolute;
		inset: 0;
		pointer-events: none;
		user-select: none;
		color: var(--text);
		font-family: var(--ui-font);
	}
	/* Esc menu open: the game stays visible behind it, the HUD does not. */
	.under-menu {
		opacity: 0;
	}
	.top-centre {
		position: absolute;
		top: 14px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}
	.top-right {
		position: absolute;
		top: 14px;
		right: 18px;
	}
	.top-left {
		position: absolute;
		top: 14px;
		left: 18px;
	}
	.left-middle {
		position: absolute;
		left: 18px;
		top: 50%;
		transform: translateY(-50%);
	}
	.right-middle {
		position: absolute;
		right: 18px;
		top: 50%;
		transform: translateY(-50%);
	}
	.below-crosshair {
		position: absolute;
		left: 50%;
		top: calc(50% + 48px);
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
	}
	.click-hint {
		padding: 6px 16px;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		animation: pulse 2.4s ease-in-out infinite;
	}
	.bottom-centre {
		position: absolute;
		left: 50%;
		bottom: 26px;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}
	.split-slot {
		min-height: calc(34px * var(--hud-scale));
		display: flex;
		align-items: flex-end;
		margin-bottom: 4px;
	}
	.bottom-left {
		position: absolute;
		left: 18px;
		bottom: 22px;
	}
	@keyframes pulse {
		50% {
			opacity: 0.6;
		}
	}
</style>
