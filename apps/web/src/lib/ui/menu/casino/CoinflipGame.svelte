<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { COIN_SIDES, formatTenths, type CasinoEntry, type CasinoOutcome, type CoinSide } from '@surf/shared';
	import type { CasinoView, GameApi } from '#lib/game/contract.js';
	import CasinoTable from '#lib/ui/menu/casino/CasinoTable.svelte';

	/** Coinflip (docs/ui.md#casino): pick a side, 50 % wins twice the bet. */
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

	const FLIP_MS = 1900;
	/** Discs that make the edge of the coin. */
	const EDGE = [-6, -4, -2, 0, 2, 4, 6];

	type Phase = 'idle' | 'waiting' | 'flip' | 'done';
	let phase = $state('idle' as Phase);
	let picked: CoinSide = $state('heads');
	let up: CoinSide = $state('heads');
	let result = $state.raw(null as Extract<CasinoOutcome, { game: 'coinflip' }> | null);
	let coin: HTMLDivElement | undefined = $state();
	let toss: HTMLDivElement | undefined = $state();
	let shadow: HTMLDivElement | undefined = $state();
	let running: Animation[] = [];
	/** Degrees the coin lies at. */
	let angle = 0;
	let seen = untrack(() => casino.last?.n ?? 0);
	let errorSeen = untrack(() => casino.error?.n ?? 0);

	const busy = $derived(phase === 'waiting' || phase === 'flip');
	const won = $derived(phase === 'done' && result !== null && result.payout > 0);
	const lost = $derived(phase === 'done' && result !== null && result.payout === 0);

	$effect(() => {
		const last = casino.last;
		if (last && last.n !== seen) {
			seen = last.n;
			const o = last.outcome;
			if (o.game === 'coinflip') untrack(() => flip(o));
		}
	});
	$effect(() => {
		const n = casino.error?.n ?? 0;
		if (n !== errorSeen) {
			errorSeen = n;
			untrack(() => {
				if (phase === 'waiting') reset();
			});
		}
	});
	onDestroy(() => {
		for (const a of running) a.cancel();
		hold(null);
	});

	function reset() {
		phase = 'idle';
		hold(null);
	}

	function play(coins: number) {
		if (busy || casino.busy) return;
		hold(coins);
		phase = 'waiting';
		result = null;
		api.casinoSound('bet');
		api.casinoBet({ type: 'casinoBet', game: 'coinflip', bet: coins, side: picked });
	}

	async function flip(o: NonNullable<typeof result>) {
		result = o;
		phase = 'flip';
		const from = angle;
		// Six turns, landing on the side.
		const to = Math.ceil(from / 360) * 360 + 360 * 6 + (o.side === 'tails' ? 180 : 0);
		angle = to;
		if (coin && toss && shadow && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
			api.casinoSound('flip');
			const timing = { duration: FLIP_MS, fill: 'forwards' as const };
			running = [
				coin.animate([{ transform: `rotateX(${from}deg)` }, { transform: `rotateX(${to}deg)` }], { ...timing, easing: 'cubic-bezier(0.2, 0.55, 0.35, 1)' }),
				toss.animate(
					[
						{ transform: 'translateY(0)', easing: 'cubic-bezier(0.15, 0.6, 0.4, 1)' },
						{ transform: 'translateY(-125px)', offset: 0.38, easing: 'cubic-bezier(0.5, 0, 0.85, 0.5)' },
						{ transform: 'translateY(0)', offset: 0.78, easing: 'ease-out' },
						{ transform: 'translateY(-12px)', offset: 0.87, easing: 'ease-in' },
						{ transform: 'translateY(0)' }
					],
					timing
				),
				shadow.animate(
					[
						{ opacity: 0.55, transform: 'scale(1)' },
						{ opacity: 0.2, transform: 'scale(0.6)', offset: 0.38 },
						{ opacity: 0.55, transform: 'scale(1)', offset: 0.78 },
						{ opacity: 0.55, transform: 'scale(1)' }
					],
					timing
				)
			];
			const landed = setTimeout(() => api.casinoSound('stop'), FLIP_MS * 0.78);
			try {
				await running[0]!.finished;
			} catch {
				clearTimeout(landed);
				return; // closed meanwhile
			}
		}
		for (const a of running) a.cancel();
		running = [];
		up = o.side;
		angle = o.side === 'tails' ? 180 : 0;
		phase = 'done';
		hold(null);
		if (o.payout > 0) api.casinoSound('win');
	}

	function pick(side: CoinSide) {
		if (busy) return;
		picked = side;
		api.casinoSound('tick');
	}

	function keys(e: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
		e.preventDefault();
		e.stopPropagation();
		pick(picked === 'heads' ? 'tails' : 'heads');
		(e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-side="${picked}"]`)?.focus();
	}
</script>

<CasinoTable {api} {casino} game="coinflip" {balance} {recent} {loggedIn} bind:bet locked={busy} onplay={play} action={{ label: busy ? 'Flipping…' : 'Flip' }}>
	{#snippet stage()}
		<div class="scene" class:won class:lost>
			<div class="toss" bind:this={toss}>
				<div class="coin" bind:this={coin} style:transform="rotateX({up === 'tails' ? 180 : 0}deg)">
					{#each EDGE as z (z)}<div class="edge" style:transform="translateZ({z}px)"></div>{/each}
					<div class="face heads">
						<svg viewBox="0 0 120 120" aria-hidden="true">
							<circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="1 5" stroke-linecap="round" />
							<g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round">
								<path d="M60 22v7M36 30l4 6M84 30l-4 6M27 49h7M93 49h-7" />
							</g>
							<path d="M41 58a19 19 0 0 1 38 0Z" fill="currentColor" />
							<path d="M24 64q9-7 18 0t18 0 18 0 18 0v8q-9 7-18 0t-18 0-18 0-18 0Z" fill="currentColor" />
							<text x="60" y="97" text-anchor="middle">HEADS</text>
						</svg>
					</div>
					<div class="face tails">
						<svg viewBox="0 0 120 120" aria-hidden="true">
							<circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="1 5" stroke-linecap="round" />
							<path d="M28 78C36 46 50 26 80 22 72 34 70 44 74 54c4 10 12 18 20 24Z" fill="currentColor" />
							<path d="M46 70c4-14 12-26 22-34" fill="none" stroke="var(--metal)" stroke-width="3.5" stroke-linecap="round" />
							<text x="60" y="97" text-anchor="middle">TAILS</text>
						</svg>
					</div>
				</div>
			</div>
			<div class="shadow" bind:this={shadow}></div>
		</div>
		<p class="verdict" class:good={won} class:bad={lost} role="status">
			{#if won && result}
				<strong>{result.side === 'heads' ? 'Heads' : 'Tails'}!</strong> You win {formatTenths(result.payout - result.bet)} coins.
			{:else if lost && result}
				<strong>{result.side === 'heads' ? 'Heads' : 'Tails'}.</strong> You lose {formatTenths(result.bet)} coins.
			{:else if busy}
				Your coin is on {picked}.
			{:else}
				Pick a side and flip.
			{/if}
		</p>
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div class="sides" role="radiogroup" aria-label="Side" onkeydown={keys}>
			{#each COIN_SIDES as s (s)}
				<button type="button" role="radio" data-side={s} aria-checked={picked === s} tabindex={picked === s ? 0 : -1} class:on={picked === s} disabled={busy && picked !== s} onclick={() => pick(s)}>
					<i class={s}></i>{s === 'heads' ? 'Heads' : 'Tails'}
				</button>
			{/each}
		</div>
	{/snippet}
	{#snippet how()}
		<strong>How it works.</strong> Pick heads or tails. Exactly <b>50 %</b> to win, a win pays <b>2×</b> your bet, so the average payback is <b>100 %</b>. The
		server flips the coin; the animation only shows it.
	{/snippet}
</CasinoTable>

<style>
	.scene {
		flex: 1;
		min-height: 0;
		position: relative;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		perspective: 900px;
		padding-bottom: 44px;
	}
	.scene::before {
		content: '';
		position: absolute;
		left: 50%;
		top: 58%;
		width: 420px;
		height: 420px;
		margin: -210px;
		background: radial-gradient(circle, rgba(95, 224, 122, 0.34), transparent 62%);
		opacity: 0;
		transition: opacity 0.3s;
	}
	.scene.won::before {
		opacity: 1;
	}
	.scene.lost::before {
		opacity: 0.8;
		background: radial-gradient(circle, rgba(255, 90, 78, 0.22), transparent 62%);
	}
	.toss,
	.coin {
		transform-style: preserve-3d;
	}
	.coin {
		--size: clamp(150px, 25vh, 240px);
		position: relative;
		width: var(--size);
		height: var(--size);
	}
	.edge,
	.face {
		position: absolute;
		inset: 0;
		border-radius: 50%;
	}
	.edge {
		background: #a8741f;
	}
	.face {
		display: grid;
		place-items: center;
		backface-visibility: hidden;
		box-sizing: border-box;
	}
	.face svg {
		width: 100%;
		height: 100%;
	}
	.face text {
		font: 700 13px var(--ui-font);
		letter-spacing: 0.16em;
		fill: currentColor;
	}
	.heads {
		--metal: #f3b64a;
		color: #7a4a08;
		background: radial-gradient(circle at 34% 28%, #ffe6a6, #f3b64a 46%, #c9862a 100%);
	}
	.tails {
		--metal: #a9c8d8;
		color: #1f4a60;
		background: radial-gradient(circle at 34% 28%, #eaf7fd, #a9c8d8 46%, #6b95aa 100%);
	}
	.face.heads {
		border: 7px solid #d9952f;
		transform: translateZ(7px);
	}
	.face.tails {
		border: 7px solid #7fa7ba;
		transform: rotateX(180deg) translateZ(7px);
	}
	.shadow {
		position: absolute;
		left: 50%;
		bottom: 12px;
		width: 170px;
		height: 20px;
		margin-left: -85px;
		border-radius: 50%;
		background: radial-gradient(closest-side, #000, transparent);
		opacity: 0.55;
	}
	.verdict {
		margin: 0;
		padding: 4px 12px 10px;
		font-size: 18px;
		text-align: center;
		color: var(--text-dim);
	}
	.verdict.good,
	.verdict.bad {
		font-size: 21px;
		line-height: 1.16;
		animation: pop 0.28s ease-out;
	}
	.verdict.good {
		color: var(--good);
	}
	.verdict.bad {
		color: var(--bad);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0.85);
		}
	}
	.sides {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		padding: 0 16px 16px;
	}
	.sides button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 10px;
		font: 700 18px/1 var(--ui-font);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-dim);
		background: rgba(255, 255, 255, 0.05);
		border: 2px solid var(--panel-border);
		border-radius: var(--radius);
		cursor: pointer;
	}
	.sides button:hover:not(:disabled) {
		color: var(--text);
	}
	.sides button.on {
		color: var(--text);
		background: var(--accent-soft);
		border-color: var(--accent);
	}
	.sides button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.sides i {
		width: 20px;
		height: 20px;
		border-radius: 50%;
	}
	@media (prefers-reduced-motion: reduce) {
		.verdict.good,
		.verdict.bad {
			animation: none;
		}
		.scene::before {
			transition: none;
		}
	}
</style>
