<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { formatTenths, slotOdds, SLOT_STOPS, slotWin, type CasinoEntry, type CasinoOutcome, type SlotSymbolId } from '@surf/shared';
	import type { CasinoView, GameApi } from '#lib/game/contract.js';
	import { knownReels, PAY_TABLE, percent, SLOT_START, slotFiller, slotLabel } from '#lib/game/casino.js';
	import CasinoTable from '#lib/ui/menu/casino/CasinoTable.svelte';
	import SlotSymbol from '#lib/ui/menu/casino/SlotSymbol.svelte';

	/** Slots (docs/ui.md#casino): three reels that stop one after another; two or three of a symbol pay. */
	let {
		api,
		casino,
		balance,
		recent,
		loggedIn,
		hold,
		bet = $bindable()
	}: {
		api: GameApi;
		casino: CasinoView;
		balance: number;
		recent: readonly CasinoEntry[];
		loggedIn: boolean;
		hold: (bet: number | null) => void;
		bet: string;
	} = $props();

	/** Symbols that pass on the first reel; each next one has more and stops later. */
	const FILL = 18;
	const FILL_MORE = 9;
	const SPIN_MS = 1000;
	const SPIN_MORE_MS = 430;
	/** The last reel takes longer when the first two match. */
	const TENSE_MS = 750;
	const COUNT_MS = 700;
	const TICK_MIN_MS = 70;
	const ROWS = 3;

	type Phase = 'idle' | 'waiting' | 'spin' | 'done';
	let phase = $state('idle' as Phase);
	let result = $state.raw(null as Extract<CasinoOutcome, { game: 'slots' }> | null);
	/** Rows of each reel, top to bottom; at rest the first three are in the window. */
	let reels: SlotSymbolId[][] = $state.raw(SLOT_START.map((s) => [slotFiller(1)[0]!, s, slotFiller(1)[0]!]));
	/** Rows each reel is pulled up. */
	let offset = $state([0, 0, 0]);
	let stopped = $state([true, true, true]);
	let counted = $state(0);
	let raf = 0;
	let seen = untrack(() => casino.last?.n ?? 0);
	let errorSeen = untrack(() => casino.error?.n ?? 0);

	const odds = slotOdds();
	const busy = $derived(phase === 'waiting' || phase === 'spin');
	const win = $derived(result && phase === 'done' ? slotWin(result.reels) : null);
	const tone = $derived(!win ? '' : win.mult > 1 ? 'good' : win.mult === 1 ? 'even' : 'bad');
	const big = $derived((win?.mult ?? 0) >= 10);

	$effect(() => {
		const last = casino.last;
		if (last && last.n !== seen) {
			seen = last.n;
			const o = last.outcome;
			if (o.game === 'slots') untrack(() => spin(o));
		}
	});
	$effect(() => {
		const n = casino.error?.n ?? 0;
		if (n !== errorSeen) {
			errorSeen = n;
			untrack(() => {
				if (phase !== 'waiting') return;
				phase = 'idle';
				hold(null);
			});
		}
	});
	onDestroy(() => {
		cancelAnimationFrame(raf);
		hold(null);
	});

	function play(coins: number) {
		if (busy || casino.busy) return;
		cancelAnimationFrame(raf);
		hold(coins);
		phase = 'waiting';
		result = null;
		api.casinoSound('bet');
		api.casinoBet({ type: 'casinoBet', game: 'slots', bet: coins });
	}

	function spin(o: NonNullable<typeof result>) {
		const line = knownReels(o.reels);
		result = o;
		if (!line) {
			// A newer server: the result counts, this page just cannot draw it.
			phase = 'done';
			return hold(null);
		}
		// The window's rows now at the bottom, the result at the top: reels run downwards.
		reels = line.map((s, i) => [slotFiller(1)[0]!, s, slotFiller(1)[0]!, ...slotFiller(FILL + FILL_MORE * i), ...reels[i]!.slice(0, ROWS)]);
		const travel = reels.map((r) => r.length - ROWS);
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return finish(o);
		offset = travel;
		stopped = [false, false, false];
		phase = 'spin';
		const tense = line[0] === line[1] ? TENSE_MS : 0;
		const times = [0, 1, 2].map((i) => SPIN_MS + SPIN_MORE_MS * i + (i === 2 ? tense : 0));
		const start = performance.now();
		let lastRow = -1;
		let lastTick = 0;
		const frame = (now: number) => {
			offset = travel.map((rows, i) => {
				const t = Math.min(1, Math.max(0, now - start) / times[i]!);
				// A little past the stop and back.
				const back = 1 + 1.35 * (t - 1) ** 3 + 0.35 * (t - 1) ** 2;
				return rows * (1 - back);
			});
			const moving = stopped.findIndex((s) => !s);
			const row = moving < 0 ? -1 : Math.floor(offset[moving]!);
			if (row !== lastRow && now - lastTick >= TICK_MIN_MS) {
				lastRow = row;
				lastTick = now;
				api.casinoSound('tick');
			}
			for (let i = 0; i < 3; i++) {
				if (stopped[i] || now - start < times[i]!) continue;
				stopped[i] = true;
				api.casinoSound('stop');
			}
			if (stopped.every(Boolean)) finish(o);
			else raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);
	}

	function finish(o: NonNullable<typeof result>) {
		offset = [0, 0, 0];
		stopped = [true, true, true];
		phase = 'done';
		hold(null);
		const { mult } = slotWin(o.reels);
		if (mult >= 10) api.casinoSound('big');
		else if (mult > 1) api.casinoSound('win');
		const net = o.payout - o.bet;
		counted = net;
		if (mult <= 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const start = performance.now();
		const count = (now: number) => {
			const t = Math.min(1, Math.max(0, now - start) / COUNT_MS);
			counted = Math.round((net * t) / 10) * 10;
			if (t < 1) raf = requestAnimationFrame(count);
			else counted = net;
		};
		raf = requestAnimationFrame(count);
	}
</script>

<CasinoTable {api} {casino} game="slots" {balance} {recent} {loggedIn} bind:bet locked={busy} onplay={play} action={{ label: busy ? 'Spinning…' : 'Spin' }}>
	{#snippet stage()}
		<div class="machine" class:big>
			<div class="reels" class:spinning={phase === 'spin'}>
				{#each reels as r, i (i)}
					<div class="reel" class:moving={!stopped[i]}>
						<div class="strip" style:transform="translate3d(0, calc({-offset[i]!} * var(--cell)), 0)">
							{#each r as s, n (n)}
								<div class="cell" class:line={n === 1 && stopped[i]} class:hit={n === 1 && win?.symbol?.id === s}><SlotSymbol id={s} /></div>
							{/each}
						</div>
					</div>
				{/each}
				<div class="payline"></div>
			</div>
			<p class="verdict {tone}" role="status">
				{#if result && win}
					{#if win.mult > 1}
						{slotLabel(result.reels)} · {win.mult}× · <strong class="ss-num">+{formatTenths(counted)}</strong> coins
					{:else if win.mult === 1}
						{slotLabel(result.reels)}: you get your bet back.
					{:else}
						No pair. You lose {formatTenths(result.bet)} {result.bet === 10 ? 'coin' : 'coins'}.
					{/if}
				{:else if busy}
					Good luck!
				{:else}
					Two or three of the same on the line pay.
				{/if}
			</p>
		</div>
	{/snippet}
	{#snippet how()}
		<div class="pays" role="table" aria-label="Pay table">
			{#each PAY_TABLE as s (s.id)}
				<div class="pay" class:hit={win?.symbol?.id === s.id} role="row" title="{s.name}: {s.weight} of {SLOT_STOPS} stops per reel">
					<span class="icon" role="cell"><SlotSymbol id={s.id} /></span>
					<span role="cell"><b>3</b> {s.three}×</span>
					<span role="cell"><b>2</b> {s.two}×</span>
				</div>
			{/each}
		</div>
		<strong>How it works.</strong> Two or three equal symbols anywhere on the line pay a multiple of the bet. <b>{percent(odds.hit)}</b> of spins pay something,
		<b>{percent(odds.profit)}</b> more than the bet; average payback <b>{percent(odds.payback)}</b>.
	{/snippet}
</CasinoTable>

<style>
	.machine {
		--cell: clamp(66px, 13.6vh, 118px);
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 10px;
	}
	.reels {
		position: relative;
		display: grid;
		grid-template-columns: repeat(3, calc(var(--cell) * 1.25));
		gap: 8px;
		padding: 10px;
		background: linear-gradient(180deg, #d88f2c, #8f5a14);
		border-radius: 10px;
		box-shadow:
			0 10px 30px rgba(0, 0, 0, 0.55),
			inset 0 1px 0 rgba(255, 255, 255, 0.35);
	}
	.reel {
		height: calc(var(--cell) * 2.5);
		overflow: hidden;
		background: linear-gradient(180deg, #b9c2cc 0%, #f6f3ea 28%, #fffdf6 50%, #f6f3ea 72%, #b9c2cc 100%);
		border-radius: 5px;
		box-shadow: inset 0 0 14px rgba(0, 0, 0, 0.35);
	}
	.strip {
		margin-top: calc(var(--cell) * -0.25);
		will-change: transform;
	}
	.cell {
		height: var(--cell);
		display: grid;
		place-items: center;
		opacity: 0.4;
	}
	.cell > :global(svg) {
		width: calc(var(--cell) * 0.76);
		height: calc(var(--cell) * 0.76);
	}
	.moving .cell,
	.cell.line {
		opacity: 1;
	}
	.cell.hit > :global(svg) {
		animation: hop 0.55s ease-in-out 3;
		filter: drop-shadow(0 0 8px #ffb62e);
	}
	@keyframes hop {
		50% {
			transform: scale(1.2) rotate(-4deg);
		}
	}
	.payline {
		position: absolute;
		left: 2px;
		right: 2px;
		top: calc(50% - var(--cell) / 2);
		height: var(--cell);
		border: 2px solid rgba(210, 60, 40, 0.75);
		border-width: 2px 0;
		pointer-events: none;
	}
	.payline::before,
	.payline::after {
		content: '';
		position: absolute;
		top: calc(50% - 8px);
		border: 8px solid transparent;
	}
	.payline::before {
		left: -2px;
		border-left-color: #d23c28;
	}
	.payline::after {
		right: -2px;
		border-right-color: #d23c28;
	}
	.machine.big .reels {
		animation: glow 0.6s ease-in-out 4 alternate;
	}
	@keyframes glow {
		to {
			box-shadow:
				0 0 50px #ffcf5a,
				inset 0 1px 0 rgba(255, 255, 255, 0.35);
		}
	}
	.verdict {
		min-height: 1.2em;
		margin: 0;
		font-size: 19px;
		line-height: 1.2;
		color: var(--text-dim);
	}
	.verdict.good {
		color: var(--good);
	}
	.verdict.bad {
		color: var(--bad);
	}
	.verdict.even {
		color: var(--text);
	}
	.pays {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 4px;
		margin-bottom: 8px;
	}
	.pay {
		display: grid;
		grid-template-columns: 26px 1fr;
		grid-template-rows: 1fr 1fr;
		align-items: center;
		column-gap: 4px;
		padding: 4px;
		font: 600 13px/1.25 var(--num-font);
		color: var(--text);
		white-space: nowrap;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid transparent;
		border-radius: var(--radius);
	}
	.pay.hit {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.pay b {
		font-weight: 500;
		color: var(--text-faint);
	}
	.icon {
		grid-row: 1 / 3;
		width: 26px;
		height: 26px;
	}
	@media (prefers-reduced-motion: reduce) {
		.cell.hit > :global(svg),
		.machine.big .reels {
			animation: none;
		}
	}
</style>
