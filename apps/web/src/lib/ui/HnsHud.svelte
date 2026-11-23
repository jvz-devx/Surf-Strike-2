<script lang="ts">
	import type { HnsView } from '#lib/game/contract.js';
	import { hnsPhaseLabel } from '#lib/game/hns-view.js';
	import { fadeOpacity, formatClock } from '#lib/ui/format.js';

	/** `top`: banner under the map info; `screen`: blindfold and kill feed over the whole HUD. */
	let { h, now, part }: { h: HnsView; now: number; part: 'top' | 'screen' } = $props();

	const left = $derived(h.endsAt > 0 ? Math.max(0, (h.endsAt - now) / 1000) : 0);
	const seeker = $derived(h.role === 'seeker');
	const frozenLeft = $derived(h.frozenUntil > now ? (h.frozenUntil - now) / 1000 : 0);
	const flashOpacity = $derived(h.flash ? fadeOpacity(now - h.flash.at, 2200, 900) : 0);
	const seekLine = $derived(
		h.seekerNames.length === 0 ? '' : `${h.seekerNames.length} seeker${h.seekerNames.length === 1 ? '' : 's'}: ${h.seekerNames.join(', ')}`
	);
</script>

{#if part === 'top'}
<div class="hns top" aria-live="polite">
	{#if h.phase === 'solo' || h.phase === 'waiting'}
		<div class="banner ss-panel ss-shadow waiting">
			<span class="role">Hide and Seek</span>
			<span class="msg">Waiting for players — needs 2+{h.phase === 'solo' ? ' (offline: free roam)' : ''}</span>
		</div>
	{:else}
		<div class="banner ss-panel ss-shadow" class:seeker class:hider={!seeker && h.phase !== 'starting'}>
			{#if h.phase !== 'starting'}<span class="role">{seeker ? 'Seeker' : 'Hider'}</span>{/if}
			<span class="phase">{hnsPhaseLabel(h.phase, h.role)}</span>
			<span class="clock ss-num" class:low={h.phase === 'seeking' && left <= 30}>{h.phase === 'seeking' ? formatClock(left) : Math.ceil(left)}</span>
			{#if h.phase === 'hiding' || h.phase === 'seeking'}
				<span class="left"><span class="ss-label">Hiders left</span> <span class="ss-num">{h.hidersLeft}</span></span>
			{/if}
			{#if seeker && h.finds > 0}<span class="left"><span class="ss-label">Found</span> <span class="ss-num">{h.finds}</span></span>{/if}
		</div>
		{#if seekLine && h.phase !== 'ended'}<div class="who">{seekLine}</div>{/if}
		{#if h.summary}
			<div class="summary ss-panel ss-shadow" class:seekers={h.summary.winner === 'seekers'}>
				<div class="win">{h.summary.winner === 'hiders' ? 'Hiders win!' : 'Seekers win!'}</div>
				<div class="detail">
					{h.summary.winner === 'hiders' ? `Survived: ${h.summary.survivors.join(', ')}` : 'Everyone was found.'}
					{#if h.summary.top}<br />Top seeker: {h.summary.top}{/if}
				</div>
			</div>
		{/if}
	{/if}
	{#if h.flash && flashOpacity > 0}
		<div class="flash {h.flash.tone}" style:opacity={flashOpacity}>{h.flash.text}</div>
	{/if}
	{#if frozenLeft > 0 && !h.blindfold}
		<div class="frozen">Frozen <span class="ss-num">{Math.ceil(frozenLeft)}</span></div>
	{/if}
</div>

{:else}
	{#if h.blindfold}
		<div class="blindfold" role="status">
			<div class="bf-title">You are a seeker</div>
			<div class="bf-msg">Blindfolded while the hiders hide</div>
			<div class="bf-clock ss-num">{Math.ceil(left)}</div>
		</div>
	{/if}
	<div class="killfeed">
		{#each h.killFeed as k (k.id)}
			<div class="kill" class:mine={k.mine}>{k.text}</div>
		{/each}
	</div>
{/if}

<style>
	.top {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		font-size: calc(15px * var(--hud-scale));
	}
	.banner {
		display: inline-flex;
		align-items: baseline;
		gap: 14px;
		padding: 6px 18px;
	}
	.banner.seeker {
		background: rgba(170, 20, 20, 0.78);
		border-color: rgba(255, 90, 90, 0.8);
	}
	.banner.hider {
		background: rgba(18, 70, 120, 0.72);
		border-color: rgba(110, 180, 255, 0.7);
	}
	.role {
		font-weight: 700;
		font-size: 1.3em;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	.phase,
	.waiting .msg {
		color: var(--text-dim);
	}
	.clock {
		font-weight: 600;
		font-size: 1.25em;
	}
	.clock.low {
		color: #ff7070;
	}
	.left .ss-num {
		font-weight: 600;
	}
	.who {
		color: #ff9a9a;
		font-weight: 600;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
	}
	.summary {
		padding: 8px 20px;
		text-align: center;
	}
	.summary .win {
		font-size: 1.5em;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: #8fd0ff;
	}
	.summary.seekers .win {
		color: #ff8080;
	}
	.summary .detail {
		color: var(--text-dim);
	}
	.flash {
		margin-top: 6px;
		font-size: 1.5em;
		font-weight: 700;
		letter-spacing: 0.05em;
		color: #fff;
		text-shadow:
			0 0 12px rgba(80, 160, 255, 0.8),
			0 2px 4px rgba(0, 0, 0, 0.9);
	}
	.flash.seeker {
		text-shadow:
			0 0 12px rgba(255, 40, 40, 0.8),
			0 2px 4px rgba(0, 0, 0, 0.9);
	}
	.frozen {
		font-weight: 700;
		color: #bfe4ff;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
	}
	.blindfold {
		position: absolute;
		inset: 0;
		background: #000;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		color: #fff;
		font-size: calc(18px * var(--hud-scale));
	}
	.bf-title {
		font-size: 2em;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #ff7070;
	}
	.bf-msg {
		color: rgba(255, 255, 255, 0.7);
	}
	.bf-clock {
		font-size: 4em;
		font-weight: 700;
	}
	.killfeed {
		position: absolute;
		top: 54px;
		right: 18px;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 3px;
		font-size: calc(13px * var(--hud-scale));
	}
	.kill {
		background: rgba(8, 12, 18, 0.6);
		padding: 2px 8px;
	}
	.kill.mine {
		border: 1px solid rgba(255, 120, 120, 0.7);
	}
</style>
