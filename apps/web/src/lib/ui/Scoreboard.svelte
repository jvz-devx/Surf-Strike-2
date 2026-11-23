<script lang="ts">
	import { gameMode, type GameModeId, type ScoreColumn, type ScoreRow } from '@surf/shared';
	import { deathsLabel, formatClock, formatRunTime, infectedRowRole, scoreText, splitScoreboard, statusText } from '#lib/ui/format.js';

	let {
		rows,
		mapTitle,
		mapId,
		timeLeft,
		playerCount,
		maxPlayers,
		staged,
		mode = 'surf'
	}: {
		rows: ScoreRow[];
		mapTitle: string;
		mapId: string;
		timeLeft: number;
		playerCount: number;
		maxPlayers: number;
		staged: boolean;
		mode?: GameModeId;
	} = $props();

	const columns = $derived(gameMode(mode).scoreColumns);
	const split = $derived(splitScoreboard(rows, columns.includes('score') || columns.includes('kills')));
	const HEAD: Record<ScoreColumn, { label: string; num: boolean; width: number }> = $derived({
		rank: { label: 'Rank', num: true, width: 12 },
		pb: { label: 'PB', num: true, width: 18 },
		score: { label: 'Score', num: true, width: mode === 'infected' ? 13 : 22 },
		kills: { label: 'Kills', num: true, width: mode === 'infected' ? 10 : 14 },
		deaths: { label: deathsLabel(mode), num: true, width: mode === 'infected' ? 11 : 12 },
		status: { label: 'Status', num: false, width: mode === 'infected' ? 16 : 24 },
		ping: { label: 'Ping', num: true, width: mode === 'infected' ? 10 : 12 }
	});
	const nameWidth = $derived(100 - columns.reduce((n, c) => n + HEAD[c].width, 0));
</script>

<div class="backdrop">
	<section class="board ss-panel" aria-label="Scoreboard">
		<header>
			<div class="map">
				<span class="title">{mapTitle || mapId}</span>
				{#if mapTitle && mapTitle !== mapId}<span class="id">{mapId}</span>{/if}
			</div>
			<div class="meta">
				<span><span class="ss-label">Time left</span> <span class="ss-num">{formatClock(timeLeft)}</span></span>
				<span><span class="ss-label">Players</span> <span class="ss-num">{playerCount} / {maxPlayers}</span></span>
			</div>
		</header>
		<div class="scroll">
		<table>
			<thead>
				<tr>
					<th class="name" style:width="{nameWidth}%">Name</th>
					{#each columns as col (col)}
						<th class:num={HEAD[col].num} style:width="{HEAD[col].width}%">{HEAD[col].label}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each split.players as r (r.id)}
					{@const inf = mode === 'infected' ? infectedRowRole(r) : null}
					<tr class:it={r.it} class:infected={inf === 'infected'} class:alpha={inf === 'alpha'}>
						<td class="name">{#if r.it}<span class="it-mark">IT</span> {/if}{#if inf}<span class="inf-mark" class:alpha={inf === 'alpha'}>{inf === 'alpha' ? 'ALPHA' : 'INFECTED'}</span> {/if}{r.name}{#if r.admin} <span class="admin-mark" title="Server admin">ADMIN</span>{/if}</td>
						{#each columns as col (col)}
							{#if col === 'rank'}
								<td class="num ss-num">{r.rank === null ? '—' : `#${r.rank}`}</td>
							{:else if col === 'pb'}
								<td class="num ss-num">{r.pbTicks === null ? '—' : formatRunTime(r.pbTicks)}</td>
							{:else if col === 'score'}
								<td class="num ss-num">{scoreText(r.score, mode)}</td>
							{:else if col === 'kills'}
								<td class="num ss-num">{r.kills ?? 0}</td>
							{:else if col === 'deaths'}
								<td class="num ss-num">{r.deaths ?? 0}</td>
							{:else if col === 'status'}
								<td class="status">{statusText(r, staged)}</td>
							{:else}
								<td class="num ss-num">{r.ping}</td>
							{/if}
						{/each}
					</tr>
				{:else}
					<tr><td colspan={columns.length + 1} class="empty">No players</td></tr>
				{/each}
			</tbody>
		</table>
		</div>
		{#if split.spectators.length > 0}
			<div class="specs">
				<span class="ss-label">Spectators ({split.spectators.length})</span>
				<span class="list">{split.spectators.map((s) => s.name).join(', ')}</span>
			</div>
		{/if}
	</section>
</div>

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(0, 0, 0, 0.25);
		pointer-events: none;
	}
	.board {
		width: min(860px, 88vw);
		max-height: 80vh;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		background: var(--panel-bg-strong);
		font-size: calc(15px * var(--hud-scale));
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		padding: 14px 18px 10px;
		border-bottom: 1px solid var(--panel-border);
	}
	.map {
		display: flex;
		flex-direction: column;
	}
	.title {
		font-size: 1.6em;
		font-weight: 700;
		letter-spacing: 0.02em;
	}
	.id {
		color: var(--text-dim);
		font-size: 0.85em;
	}
	.meta {
		display: flex;
		gap: 20px;
		align-items: baseline;
	}
	.meta .ss-num {
		font-size: 1.2em;
		font-weight: 600;
	}
	.scroll {
		overflow-y: auto;
		min-height: 0;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}
	.admin-mark {
		font-size: 0.7em;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: var(--accent);
	}
	.it-mark {
		display: inline-block;
		padding: 0 6px;
		margin-right: 4px;
		border-radius: 3px;
		background: #d42222;
		color: #fff;
		font-size: 0.8em;
		font-weight: 700;
		letter-spacing: 0.08em;
	}
	tr.it td.name {
		color: #ff9a9a;
	}
	.inf-mark {
		display: inline-block;
		padding: 0 6px;
		margin-right: 4px;
		border-radius: 3px;
		background: #8e1018;
		color: #fff;
		font-size: 0.72em;
		font-weight: 700;
		letter-spacing: 0.08em;
	}
	.inf-mark.alpha {
		background: #d6680c;
		color: #1a0d00;
	}
	tr.infected td {
		background: rgba(142, 16, 24, 0.14);
	}
	tr.infected td.name {
		color: #ff8a8a;
	}
	tr.alpha td {
		background: rgba(214, 104, 12, 0.16);
	}
	tr.alpha td.name {
		color: #ffc27a;
	}
	th {
		position: sticky;
		top: 0;
		background: rgba(12, 14, 18, 0.95);
		font-size: calc(11px * var(--hud-scale));
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-dim);
		text-align: left;
		padding: 8px 18px 6px;
	}
	td {
		padding: 5px 18px;
		border-top: 1px solid rgba(255, 255, 255, 0.05);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	tbody tr:nth-child(odd) td {
		background: rgba(255, 255, 255, 0.025);
	}
	.name {
		font-weight: 600;
	}
	.num {
		text-align: right;
	}
	td.num {
		font-size: 1.1em;
		font-weight: 600;
	}
	.status {
		color: var(--text-dim);
	}
	.empty {
		color: var(--text-faint);
		text-align: center;
	}
	.specs {
		padding: 10px 18px 14px;
		border-top: 1px solid var(--panel-border);
		display: flex;
		gap: 10px;
		align-items: baseline;
	}
	.list {
		color: var(--text-dim);
	}
</style>
