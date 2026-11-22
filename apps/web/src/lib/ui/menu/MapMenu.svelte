<script lang="ts">
	import type { MapListEntry } from '#lib/game/contract.js';
	import Tabs from '#lib/ui/menu/Tabs.svelte';
	import { filterMaps, groupMapsByMode, mapMenuState, mapRowPickable, modeLabel } from '#lib/ui/menu/menu.js';

	let {
		maps,
		mapId,
		canChangeMap,
		admin = false,
		spectating = false,
		voteOpen = false,
		requestOpen = false,
		rtvCooldown = null,
		onpick
	}: {
		maps: MapListEntry[];
		mapId: string;
		/** Solo or alone online: a pick switches at once; otherwise it starts an RTV request. */
		canChangeMap: boolean;
		/** Admins may pick maps an admin disabled (instant change only). */
		admin?: boolean;
		spectating?: boolean;
		voteOpen?: boolean;
		requestOpen?: boolean;
		rtvCooldown?: { until: number; reason: 'declined' | 'mapStart' } | null;
		onpick: (id: string) => void;
	} = $props();

	// Ticks the cooldown countdown while one applies.
	let now = $state(performance.now());
	$effect(() => {
		if (!rtvCooldown) return;
		now = performance.now();
		const t = setInterval(() => (now = performance.now()), 250);
		return () => clearInterval(t);
	});
	const menu = $derived(
		mapMenuState({
			canChangeMap,
			spectating,
			voteOpen,
			requestOpen,
			cooldown: rtvCooldown
				? { seconds: Math.max(0, Math.ceil((rtvCooldown.until - now) / 1000)), reason: rtvCooldown.reason }
				: null
		})
	);
	const request = $derived(menu.mode === 'request');

	const ALL = '__all';
	const groups = $derived(groupMapsByMode(maps));
	const currentMap = $derived(maps.find((m) => m.id === mapId));
	// Open on the current map's mode; falls back to All when that mode is gone.
	let picked = $state<string | null>(null);
	const category = $derived.by(() => {
		const want = picked ?? currentMap?.kind ?? ALL;
		return want === ALL || groups.some((g) => g.id === want) ? want : ALL;
	});
	let query = $state('');

	const tabs = $derived([
		{ id: ALL, label: 'All', count: maps.length },
		...groups.map((g) => ({ id: g.id, label: g.label, count: g.maps.length }))
	]);
	const shown = $derived(
		groups
			.filter((g) => category === ALL || g.id === category)
			.map((g) => ({ ...g, maps: filterMaps(g.maps, query) }))
			.filter((g) => g.maps.length > 0)
	);
</script>

<header class="head">
	<h2 id="ss-menu-title">Change map</h2>
	{#if currentMap}
		<span class="now">Now playing <strong>{currentMap.title}</strong> · {modeLabel(currentMap.kind)}</span>
	{/if}
</header>

{#if menu.notice}
	<p class="notice" class:blocked={menu.blocked} role="status">{menu.notice}</p>
{/if}

<div class="bar">
	<Tabs {tabs} selected={category} onselect={(id) => (picked = id)} label="Map categories" idPrefix="ss-maps" />
	<input
		class="ss-input search"
		type="search"
		placeholder="Filter maps"
		aria-label="Filter maps by name or id"
		bind:value={query}
	/>
</div>

<div class="body" id="ss-maps-panel" role="tabpanel" aria-labelledby="ss-maps-tab-{category}">
	{#each shown as g (g.id)}
		<section class="group" aria-labelledby="ss-maps-group-{g.id}">
			{#if category === ALL}
				<h3 class="group-title ss-label" id="ss-maps-group-{g.id}">{g.label}</h3>
			{:else}
				<h3 class="sr-only" id="ss-maps-group-{g.id}">{g.label}</h3>
			{/if}
			<ul class="maps">
				{#each g.maps as m (m.id)}
					{@const current = m.id === mapId}
					<li>
						{#if mapRowPickable(m, current, admin, menu)}
							<button
								type="button"
								class="map"
								class:current
								aria-current={current ? 'true' : undefined}
								title={request ? `Request map vote (${m.title})` : undefined}
								onclick={() => onpick(m.id)}
							>
								{@render entry(m, current)}
								{#if request}<span class="act">Request map vote</span>{/if}
							</button>
						{:else}
							<div class="map readonly" class:current class:off={m.disabled} aria-current={current ? 'true' : undefined}>
								{@render entry(m, current)}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{:else}
		<p class="empty">No maps match “{query.trim()}”.</p>
	{/each}
</div>

{#snippet entry(m: MapListEntry, current: boolean)}
	<span class="title">{m.title}</span>
	<span class="id">{m.id}</span>
	{#if current}<span class="tag-now">Current</span>{/if}
	{#if m.disabled}<span class="tag-off">Disabled by admin</span>{/if}
	<span class="diff diff-{m.difficulty.toLowerCase()}">{m.difficulty}</span>
{/snippet}

<style>
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.head h2 {
		margin: 0;
		font: 700 22px/1 var(--ui-font);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.now {
		font-size: 13px;
		color: var(--text-dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.now strong {
		color: var(--accent);
	}
	.notice.blocked {
		color: var(--text-dim);
		background: rgba(255, 255, 255, 0.04);
		border-color: var(--panel-border-strong);
	}
	.act {
		flex-shrink: 0;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-faint);
	}
	button.map:hover .act,
	button.map:focus-visible .act {
		color: var(--accent);
	}
	.notice {
		margin: 0;
		padding: 8px 12px;
		font-size: 14px;
		color: var(--system);
		background: rgba(242, 196, 90, 0.08);
		border: 1px solid rgba(242, 196, 90, 0.3);
		border-radius: var(--radius);
	}
	.bar {
		display: flex;
		align-items: flex-end;
		gap: 12px;
	}
	.bar :global(.tabs) {
		flex: 1;
		min-width: 0;
	}
	.search {
		width: 170px;
		padding: 5px 9px;
		margin-bottom: 4px;
		font-size: 14px;
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-right: 4px;
	}
	.group-title {
		margin: 0 0 4px;
		font-size: 12px;
	}
	.maps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.map {
		box-sizing: border-box;
		width: 100%;
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 8px 12px;
		font: inherit;
		color: var(--text);
		text-align: left;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid transparent;
		border-left: 2px solid transparent;
		border-radius: 2px;
	}
	button.map {
		cursor: pointer;
	}
	button.map:hover,
	button.map:focus-visible {
		background: rgba(255, 255, 255, 0.07);
		border-color: var(--panel-border-strong);
		outline: none;
	}
	.map.current {
		border-left-color: var(--accent);
		background: var(--accent-soft);
	}
	.readonly {
		color: var(--text-dim);
	}
	.title {
		font-size: 16px;
		font-weight: 600;
	}
	.map.current .title {
		color: var(--accent);
	}
	.id {
		flex: 1;
		min-width: 0;
		font-size: 13px;
		color: var(--text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag-now {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.diff {
		flex-shrink: 0;
		min-width: 44px;
		padding: 3px 7px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-align: center;
		text-transform: uppercase;
		color: var(--text-dim);
		border: 1px solid var(--panel-border-strong);
		border-radius: 2px;
	}
	.diff-easy {
		color: var(--good);
		border-color: rgba(95, 224, 122, 0.45);
	}
	.diff-hard {
		color: var(--bad);
		border-color: rgba(255, 90, 78, 0.45);
	}
	.map.off .title {
		color: var(--text-faint);
	}
	.tag-off {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-faint);
	}
	.empty {
		margin: 8px 0;
		color: var(--text-faint);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
