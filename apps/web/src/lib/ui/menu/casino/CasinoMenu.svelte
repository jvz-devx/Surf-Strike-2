<script lang="ts">
	import { untrack } from 'svelte';
	import { CASINO_GAMES, formatWhole, pts, type CasinoGame } from '@surf/shared';
	import type { CasinoView, GameApi } from '#lib/game/contract.js';
	import { signed } from '#lib/game/casino.js';
	import Tabs from '#lib/ui/menu/Tabs.svelte';
	import CoinflipGame from '#lib/ui/menu/casino/CoinflipGame.svelte';
	import CrashGame from '#lib/ui/menu/casino/CrashGame.svelte';
	import SlotsGame from '#lib/ui/menu/casino/SlotsGame.svelte';

	/**
	 * Casino submenu (docs/ui.md#casino): three games in tabs. The server rolls; the
	 * games only show it, so closing the menu early loses nothing.
	 */
	let {
		api,
		casino,
		balance,
		loggedIn,
		online
	}: {
		api: GameApi;
		casino: CasinoView | null;
		/** Tenths of a coin. */
		balance: number;
		loggedIn: boolean;
		online: boolean;
	} = $props();

	const TABS: { id: CasinoGame; label: string }[] = [
		{ id: 'coinflip', label: 'Coinflip' },
		{ id: 'crash', label: 'Crash' },
		{ id: 'slots', label: 'Slots' }
	];

	function devStart(): CasinoGame {
		if (!import.meta.env.DEV || typeof location === 'undefined') return 'coinflip';
		const p = new URLSearchParams(location.search);
		return (p.has('mockhud') && CASINO_GAMES.find((g) => g === p.get('tab'))) || 'coinflip';
	}

	let game: CasinoGame = $state(devStart());
	const bets: Record<CasinoGame, string> = $state({ coinflip: '10', crash: '10', slots: '5' });
	/** A game is showing a result: the numbers up here must not give it away. */
	let held = $state(false);
	let shown = $state.raw(untrack(() => ({ balance, net: casino?.net ?? 0, recent: casino?.recent ?? [] })));

	$effect(() => {
		const next = { balance, net: casino?.net ?? 0, recent: casino?.recent ?? [] };
		if (!held) shown = next;
	});

	/** Whole coins that are in play until the result is shown; null: show everything again. */
	function hold(bet: number | null) {
		held = bet !== null;
		if (bet !== null) shown = { ...shown, balance: shown.balance - pts(bet) };
	}

	const session = $derived(shown.net - (casino?.baseline ?? 0));
</script>

<header class="head">
	<h2 id="ss-menu-title">Casino</h2>
	{#if casino && loggedIn}
		<div class="stats">
			<span><span class="ss-label">Session</span> <strong class="ss-num" class:good={session > 0} class:bad={session < 0}>{signed(session)}</strong></span>
			<span><span class="ss-label">All time</span> <strong class="ss-num" class:good={shown.net > 0} class:bad={shown.net < 0}>{signed(shown.net)}</strong></span>
			<span class="balance"><span class="ss-label">Coins</span> <strong class="ss-num">{formatWhole(shown.balance)}</strong></span>
		</div>
	{/if}
</header>

{#if !online}
	<p class="hint">Offline: the casino needs the server.</p>
{:else if !casino}
	<p class="hint">The casino is not available on this server.</p>
{:else}
	<Tabs
		tabs={TABS}
		selected={game}
		onselect={(id) => {
			hold(null);
			game = id as CasinoGame;
		}}
		label="Casino games"
		idPrefix="casino"
	/>
	<div class="panel" id="casino-panel" role="tabpanel" aria-labelledby="casino-tab-{game}">
		{#if game === 'coinflip'}
			<CoinflipGame {api} {casino} balance={shown.balance} recent={shown.recent} {loggedIn} {hold} bind:bet={bets.coinflip} />
		{:else if game === 'crash'}
			<CrashGame {api} {casino} balance={shown.balance} recent={shown.recent} {loggedIn} bind:bet={bets.crash} />
		{:else}
			<SlotsGame {api} {casino} balance={shown.balance} recent={shown.recent} {loggedIn} {hold} bind:bet={bets.slots} />
		{/if}
	</div>
{/if}

<style>
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 4px 18px;
	}
	.head h2 {
		margin: 0;
		font: 700 22px/1 var(--ui-font);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.stats {
		display: flex;
		align-items: baseline;
		gap: 22px;
	}
	.stats strong {
		font-size: 18px;
		line-height: 1;
	}
	.stats .balance strong {
		font-size: 24px;
		color: var(--accent);
	}
	.good {
		color: var(--good);
	}
	.bad {
		color: var(--bad);
	}
	.hint {
		margin: 0;
		color: var(--text-dim);
	}
	.panel {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
</style>
