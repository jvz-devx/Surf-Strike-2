<script lang="ts">
	import type { TagView } from '#lib/game/contract.js';
	import { fadeOpacity, formatClock } from '#lib/ui/format.js';

	let { tag, now }: { tag: TagView; now: number } = $props();

	const left = $derived(tag.endsAt > 0 ? Math.max(0, (tag.endsAt - now) / 1000) : 0);
	const flashOpacity = $derived(tag.flash ? fadeOpacity(now - tag.flash.at, 1500, 800) : 0);
	const itLine = $derived(tag.itNames.length === 0 ? '' : `${tag.itNames.join(' & ')} ${tag.itNames.length > 1 ? 'are' : 'is'} IT`);
</script>

<div class="tag" aria-live="polite">
	{#if tag.phase === 'solo' || tag.phase === 'waiting'}
		<div class="banner ss-panel ss-shadow waiting">
			<span class="role">Tag</span>
			<span class="msg">Waiting for players — tag needs 2+{tag.phase === 'solo' ? ' (offline: free roam)' : ''}</span>
		</div>
	{:else if tag.phase === 'countdown'}
		<div class="banner ss-panel ss-shadow">
			<span class="role">Next round</span>
			<span class="clock ss-num">{Math.ceil(left)}</span>
		</div>
	{:else}
		<div class="banner ss-panel ss-shadow" class:it={tag.isIt}>
			<span class="role">{tag.isIt ? 'IT' : 'Runner'}</span>
			<span class="clock ss-num" class:low={left <= 30}>{formatClock(left)}</span>
			<span class="score"><span class="ss-label">Score</span> <span class="ss-num">{tag.score.toFixed(1)}</span></span>
		</div>
		{#if itLine}<div class="who">{itLine}{tag.immune ? ' · you are immune' : ''}</div>{/if}
	{/if}
	{#if tag.flash && flashOpacity > 0}
		<div class="flash" style:opacity={flashOpacity}>{tag.flash.text}</div>
	{/if}
</div>

<style>
	.tag {
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
	.banner.it {
		background: rgba(170, 20, 20, 0.78);
		border-color: rgba(255, 90, 90, 0.8);
	}
	.role {
		font-weight: 700;
		font-size: 1.3em;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
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
	.score .ss-num {
		font-weight: 600;
	}
	.who {
		color: #ff8a8a;
		font-weight: 600;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
	}
	.flash {
		margin-top: 6px;
		font-size: 1.6em;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: #fff;
		text-shadow:
			0 0 12px rgba(255, 40, 40, 0.8),
			0 2px 4px rgba(0, 0, 0, 0.9);
	}
</style>
