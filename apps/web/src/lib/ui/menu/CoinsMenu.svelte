<script lang="ts">
	import { formatMultiplier, formatTenths, formatWhole } from '@surf/shared';
	import type { CoinsView, GameApi } from '#lib/game/contract.js';

	/** Coins submenu (docs/ui.md#coins): balance, lifetime points, latest awards and purchases. */
	let {
		api,
		coins,
		multiplier,
		loggedIn,
		online
	}: {
		api: GameApi;
		coins: CoinsView | null;
		multiplier: { mult: number; active: number; need: number } | null;
		loggedIn: boolean;
		online: boolean;
	} = $props();

	const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
</script>

<header class="head">
	<h2 id="ss-menu-title">Coins</h2>
	{#if multiplier}
		<span class="mult">
			{#if multiplier.active < multiplier.need}
				Needs {multiplier.need} active players ({multiplier.active} now)
			{:else}
				<strong class="ss-num">{formatMultiplier(multiplier.mult)}</strong> · {multiplier.active} active
			{/if}
		</span>
	{/if}
</header>

<div class="body">
	{#if coins}
		<div class="cards">
			<div class="card">
				<span class="ss-label">Coins</span>
				<span class="value ss-num">{formatWhole(coins.balance)}</span>
			</div>
			<div class="card">
				<span class="ss-label">Points earned in total</span>
				<span class="value ss-num dim">{formatWhole(coins.total)}</span>
			</div>
		</div>
		<h3 class="ss-label">Latest</h3>
		<ul class="rows">
			{#each coins.recent as e, i (`${e.at}:${i}`)}
				<li class="row">
					<span class="amount ss-num" class:spent={e.amount < 0}>{e.amount < 0 ? '' : '+'}{formatTenths(e.amount)}</span>
					<span class="what">{e.label}</span>
					{#if e.amount >= 0 && e.reason !== 'admin' && e.reason !== 'welcome' && !e.reason.startsWith('shop:')}<span class="dim ss-num">{formatMultiplier(e.mult)}</span>{/if}
					<span class="dim time">{when(e.at)}</span>
				</li>
			{:else}
				<li class="hint">Nothing earned yet.</li>
			{/each}
		</ul>
		<p class="hint">
			Every point you earn is also a coin. 15 minutes of active play pay 10; each mode pays for playing well. With more active
			players Zombie Run, Infected, Hide and Seek and Tag pay up to twice as much.
		</p>
	{:else if !online}
		<p class="hint">Offline: coins are only earned on the server.</p>
	{:else if loggedIn}
		<p class="hint">This server does not pay coins.</p>
	{:else}
		<p class="hint">Guests play everything but earn no coins.</p>
		<div><button type="button" class="ss-button" onclick={() => api.openAuth()}>Log in / Register</button></div>
	{/if}
</div>

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
	.mult {
		font-size: 14px;
		color: var(--text-dim);
	}
	.mult strong {
		color: var(--text);
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
	.cards {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px 16px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--panel-border);
		border-radius: var(--radius);
	}
	.value {
		font-size: 34px;
		font-weight: 700;
		line-height: 1;
		color: var(--accent);
	}
	.value.dim {
		color: var(--text);
	}
	h3 {
		margin: 4px 0 0;
		font-size: 12px;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.row {
		display: flex;
		align-items: baseline;
		gap: 12px;
		padding: 5px 10px;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 2px;
	}
	.amount {
		width: 4.2em;
		text-align: right;
		font-weight: 700;
		color: var(--good);
	}
	.amount.spent {
		color: var(--bad);
	}
	.what {
		flex: 1;
		min-width: 0;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dim {
		color: var(--text-dim);
	}
	.time {
		font-size: 13px;
		white-space: nowrap;
	}
	.hint {
		margin: 0;
		font-size: 14px;
		line-height: 1.45;
		color: var(--text-dim);
		list-style: none;
	}
</style>
