<script lang="ts">
	import { buildScorePanel, gameMode, type GameModeId, type ScorePanelInput } from '@surf/shared';
	import { cssLen, fitPanel, panelArea, PANEL_HEAD, PANEL_LINE, PANEL_ROW } from '#lib/ui/score-panel.js';

	let { mode, input, unofficial }: { mode: GameModeId; input: ScorePanelInput; unofficial: boolean } = $props();

	let width = $state(0);
	let height = $state(0);

	const def = $derived(gameMode(mode));
	const area = $derived(panelArea(mode));
	// The summary decides how many rows fit, so it is built before the list is cut.
	const all = $derived(buildScorePanel(def.score, def.label, input));
	const fit = $derived(fitPanel(width, height, mode, all.summary.length + (unofficial ? 1 : 0)));
	const view = $derived(buildScorePanel(def.score, def.label, input, fit.rows));
	const heads = $derived(view.heads.map((h, i) => ({ ...h, i })).filter((h) => fit.size === 'full' || !h.minor));
</script>

<svelte:window bind:innerWidth={width} bind:innerHeight={height} />

{#if !fit.hidden}
	<div
		class="area"
		style:top={cssLen(area.top)}
		style:bottom={cssLen(area.bottom)}
		style:--row="{PANEL_ROW}px"
		style:--line="{PANEL_LINE}px"
		style:--head="{PANEL_HEAD}px"
	>
		<section class="panel ss-panel ss-shadow {fit.size}" aria-label="Score panel">
			<header>
				<span class="title">{view.title}</span>
				<span class="sub ss-num">{view.subtitle}</span>
			</header>
			{#if view.empty}
				<div class="empty">{view.empty}</div>
			{:else if view.rows.length > 0}
				<table>
					<thead>
						<tr>
							<th class="place" aria-label="Position"></th>
							<th class="name">Name</th>
							{#each heads as h (h.id)}<th class:num={h.num}>{h.label}</th>{/each}
						</tr>
					</thead>
					<tbody>
						{#each view.rows as r, i (r.key)}
							<tr class={r.mark?.tone ?? ''} class:self={r.self} class:gap={r.gap && i > 0}>
								<td class="place ss-num">{r.place}</td>
								<td class="name"
									><span class="clip">{#if r.mark?.short}<span class="chip">{r.mark.short}</span>{/if}{r.name}</span></td
								>
								{#each heads as h (h.id)}<td class:num={h.num} class:ss-num={h.num}>{r.cells[h.i]}</td>{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			{#if view.summary.length > 0 || unofficial}
				<div class="summary" class:alone={view.rows.length === 0 && !view.empty}>
					{#each view.summary as l (l.id)}
						<div class="line">
							<span class="ss-label">{l.label}</span>
							<span class="value ss-num {l.tone ?? ''}">{l.text}{#if l.note}<span class="note">{l.note}</span>{/if}</span>
						</div>
					{/each}
					{#if unofficial}<div class="line"><span class="badge">Unofficial</span></div>{/if}
				</div>
			{/if}
		</section>
	</div>
{/if}

<style>
	.area {
		position: absolute;
		right: 18px;
		display: flex;
		align-items: center;
		overflow: hidden;
	}
	.panel {
		width: calc(250px * var(--hud-scale));
		box-shadow: none;
		padding: 5px 0 6px;
		font-size: calc(14px * var(--hud-scale));
	}
	.compact {
		width: calc(205px * var(--hud-scale));
	}
	.mini {
		width: calc(180px * var(--hud-scale));
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
		padding: 0 10px;
		height: calc(var(--head) * 0.55 * var(--hud-scale));
		line-height: calc(var(--head) * 0.55 * var(--hud-scale));
		white-space: nowrap;
	}
	.title {
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		font-size: 0.93em;
	}
	.sub {
		color: var(--text-dim);
		font-weight: 600;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th {
		height: calc(var(--head) * 0.45 * var(--hud-scale));
		line-height: 1;
		padding: 0 4px;
		font-size: calc(10px * var(--hud-scale));
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		text-align: left;
		color: var(--text-dim);
		white-space: nowrap;
	}
	td {
		height: calc(var(--row) * var(--hud-scale));
		line-height: 1;
		padding: 0 4px;
		box-sizing: border-box;
		white-space: nowrap;
	}
	th:last-child,
	td:last-child {
		padding-right: 10px;
	}
	.place {
		padding-left: 10px;
		width: 1.3em;
		text-align: right;
		color: var(--text-dim);
	}
	td.name {
		width: 100%;
		max-width: 0;
		font-weight: 600;
	}
	.clip {
		display: block;
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.num {
		text-align: right;
		font-weight: 600;
	}
	tr.gap td {
		border-top: 1px dashed var(--panel-border-strong);
	}
	tr.self td {
		background: var(--accent-soft);
	}
	tr.self td.place {
		color: var(--accent);
		box-shadow: inset 2px 0 0 var(--accent);
	}
	.chip {
		display: inline-block;
		margin-right: 5px;
		padding: 0 4px;
		border-radius: 2px;
		font-size: 0.75em;
		font-weight: 700;
		line-height: 1.35;
		letter-spacing: 0.06em;
		text-shadow: none;
	}
	.it .name {
		color: #ff9a9a;
	}
	.it .chip {
		background: #d42222;
		color: #fff;
	}
	.infected .name {
		color: #ff8a8a;
	}
	.infected .chip {
		background: #8e1018;
		color: #fff;
	}
	.alpha .name {
		color: #ffc27a;
	}
	.alpha .chip {
		background: #d6680c;
		color: #1a0d00;
	}
	.zombie .name {
		color: #9fe08a;
	}
	.zombie .chip {
		background: #2f6b2f;
		color: #fff;
	}
	.seeker .name {
		color: #ff9a9a;
	}
	.empty {
		padding: 2px 10px 4px;
		color: var(--text-dim);
	}
	.summary {
		margin-top: 4px;
		padding: 3px 10px 0;
		border-top: 1px solid var(--panel-border);
	}
	.summary.alone {
		margin-top: 0;
	}
	.line {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		height: calc(var(--line) * var(--hud-scale));
		white-space: nowrap;
	}
	.line .ss-label {
		font-size: calc(10px * var(--hud-scale));
		letter-spacing: 0.1em;
	}
	.value {
		font-weight: 600;
	}
	.value.good {
		color: var(--good);
	}
	.value.bad {
		color: var(--bad);
	}
	.note {
		margin-left: 6px;
		font-weight: 700;
		color: var(--accent);
	}
	/* The list's own row already shows the rank. */
	.mini .note {
		display: none;
	}
	.badge {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #14161a;
		background: var(--system);
		padding: 2px 6px;
		border-radius: 2px;
		text-shadow: none;
	}
</style>
