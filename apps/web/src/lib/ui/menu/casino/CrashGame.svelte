<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { CRASH, crashAt, crashChance, crashCurve, crashPayout, crashTime, formatTenths, POINTS_SCALE, type CasinoEntry, type CasinoOutcome } from '@surf/shared';
	import type { CasinoView, GameApi } from '#lib/game/contract.js';
	import { crashFrame, formatMult, parseAuto, percent } from '#lib/game/casino.js';
	import CasinoTable from '#lib/ui/menu/casino/CasinoTable.svelte';

	/** Crash (docs/ui.md#casino): the multiplier climbs on the server's clock; cash out before it crashes. */
	let {
		api,
		casino,
		balance,
		recent,
		loggedIn,
		bet = $bindable()
	}: {
		api: GameApi;
		casino: CasinoView;
		balance: number;
		recent: readonly CasinoEntry[];
		loggedIn: boolean;
		bet: string;
	} = $props();

	/** A double click on "Bet" must not cash out at once. */
	const CASHOUT_AFTER_MS = 350;
	/** A cash-out that comes too late must not place the next bet. */
	const BET_AFTER_MS = 1000;
	const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	let autoText = $state('');
	let end = $state.raw(null as Extract<CasinoOutcome, { game: 'crash' }> | null);
	let ms = $state(0);
	let w = $state(600);
	let h = $state(300);
	/** Cashed out, and the round goes on to its crash: what the player misses. */
	let tail = $state(false);
	/** When the last round began. */
	let startedAt: number | null = null;
	/** Just after a round. */
	let cooling = $state(false);
	let coolTimer: ReturnType<typeof setTimeout> | undefined;
	let raf = 0;
	let seen = untrack(() => casino.last?.n ?? 0);
	/** Whole multiplier of the last tick sound. */
	let ticked = 1;

	const round = $derived(casino.crash);
	const running = $derived(round !== null);
	const auto = $derived(parseAuto(autoText));
	const mult = $derived(end && !tail ? end.crash : crashCurve(ms));
	const frame = $derived(crashFrame(ms, w, h));
	const betCoins = $derived(round ? round.bet / POINTS_SCALE : 0);
	/** Tenths more than was paid, at the multiplier shown. */
	const missed = $derived(end ? Math.max(0, crashPayout(end.bet / POINTS_SCALE, Math.floor(mult + 1e-9)) - end.payout) : 0);
	/** `tail`: cashed out, still climbing; `missed`: it then crashed; `won`: nothing more was to be had. */
	const mood = $derived.by(() => {
		if (!end) return running ? 'running' : 'idle';
		if (end.payout === 0) return 'lost';
		if (tail) return 'tail';
		return missed > 0 ? 'missed' : 'won';
	});
	const action = $derived.by(() => {
		if (round) return { label: `Cash out · ${formatTenths(crashPayout(betCoins, crashAt(ms)))}`, free: true, tone: 'cash' as const, disabled: casino.busy };
		return { label: casino.busy ? 'Starting…' : 'Place bet', disabled: casino.busy || cooling };
	});

	function climb(from: number, top: number) {
		ms = Math.min(crashTime(top), Math.max(0, performance.now() - from));
		const whole = Math.floor(crashCurve(ms) / CRASH.one);
		if (whole <= ticked) return;
		ticked = whole;
		api.casinoSound('tick');
	}

	/** After a cash-out: on to where it crashes. The next bet cuts it short. */
	function follow(o: Extract<CasinoOutcome, { game: 'crash' }>, from: number) {
		tail = true;
		const step = () => {
			climb(from, o.crash);
			if (ms < crashTime(o.crash)) {
				raf = requestAnimationFrame(step);
				return;
			}
			tail = false;
			api.casinoSound('crash');
		};
		step();
	}

	// A running round (also one that started before the menu was opened).
	$effect(() => {
		const r = casino.crash;
		if (!r) return;
		cancelAnimationFrame(raf);
		end = null;
		tail = false;
		ticked = 1;
		startedAt = r.startedAt;
		const step = () => {
			climb(r.startedAt, CRASH.cap);
			raf = requestAnimationFrame(step);
		};
		untrack(step);
		return () => cancelAnimationFrame(raf);
	});
	$effect(() => {
		const last = casino.last;
		if (!last || last.n === seen) return;
		seen = last.n;
		const o = last.outcome;
		if (o.game !== 'crash') return;
		untrack(() => {
			end = o;
			cooling = true;
			clearTimeout(coolTimer);
			coolTimer = setTimeout(() => (cooling = false), BET_AFTER_MS);
			api.casinoSound(o.payout === 0 ? 'crash' : o.payout >= o.bet * 10 ? 'big' : 'win');
			cancelAnimationFrame(raf);
			if (o.at !== null && o.crash > o.at && startedAt !== null) follow(o, startedAt);
			else ms = crashTime(o.crash);
			startedAt = null;
		});
	});
	onDestroy(() => {
		cancelAnimationFrame(raf);
		clearTimeout(coolTimer);
	});

	function play(coins: number) {
		if (casino.busy || (!round && cooling)) return;
		if (round) {
			if (performance.now() - round.startedAt >= CASHOUT_AFTER_MS) api.crashCashout();
			return;
		}
		if (auto === undefined) return;
		api.casinoSound('bet');
		api.casinoBet({ type: 'casinoBet', game: 'crash', bet: coins, auto });
	}
</script>

<CasinoTable
	{api}
	{casino}
	game="crash"
	{balance}
	{recent}
	{loggedIn}
	bind:bet
	locked={running}
	onplay={play}
	{action}
	blocked={auto === undefined ? 'Auto cash-out: 1.01 to 100, or empty.' : null}
	mults
>
	{#snippet stage()}
		<div class="graph {mood}" class:calm={reduced}>
			<div class="area" bind:clientWidth={w} bind:clientHeight={h}>
				<svg viewBox="0 0 {w} {h}" width={w} height={h} aria-hidden="true">
					<defs>
						<linearGradient id="crash-fill" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0" stop-color="var(--line)" stop-opacity="0.42" />
							<stop offset="1" stop-color="var(--line)" stop-opacity="0.03" />
						</linearGradient>
					</defs>
					{#each frame.lines as l (l)}
						{@const y = h - ((l - CRASH.one) / (frame.mult - CRASH.one)) * h}
						<line x1="0" x2={w} y1={y} y2={y} class="grid" />
						<text x="4" y={y - 5} class="tick">{formatMult(l)}</text>
					{/each}
					{#if round && round.auto !== null && round.auto <= frame.mult}
						{@const y = h - ((round.auto - CRASH.one) / (frame.mult - CRASH.one)) * h}
						<line x1="0" x2={w} y1={y} y2={y} class="autoline" />
						<text x={w - 6} y={y - 5} class="tick autotext">auto {formatMult(round.auto)}</text>
					{/if}
					{#if end && end.at !== null && mood !== 'won'}
						{@const y = h - ((end.at - CRASH.one) / (frame.mult - CRASH.one)) * h}
						<line x1="0" x2={w} y1={y} y2={y} class="outline" />
						<text x={w - 6} y={y - 5} class="tick outtext">out {formatMult(end.at)}</text>
					{/if}
					{#if mood !== 'idle'}
						<path d="{frame.path}L{frame.x.toFixed(1)} {h}L0 {h}Z" fill="url(#crash-fill)" />
						<path d={frame.path} class="curve" />
						<g transform="translate({frame.x.toFixed(1)} {frame.y.toFixed(1)})" class="tip">
							{#if mood === 'lost' || mood === 'missed'}
								{#each [0, 45, 90, 135, 180, 225, 270, 315] as a (a)}<line x1="0" y1="-9" x2="0" y2="-24" transform="rotate({a})" class="burst" />{/each}
							{:else}
								<circle r="13" class="halo" />
								<circle r="6" class="dot" />
							{/if}
						</g>
					{/if}
				</svg>
				<div class="readout" role="status">
					<span class="mult ss-num" aria-hidden={mood === 'running'}>{formatMult(mult)}</span>
					{#if end && end.at !== null && mood !== 'lost'}
						<span class="msg">Cashed out at {formatMult(end.at)}: <b>+{formatTenths(end.payout - end.bet)}</b> coins</span>
						{#if mood === 'tail'}
							<span class="sub regret" aria-hidden="true">Still climbing… you are missing <b class="ss-num">{formatTenths(missed)}</b> coins</span>
						{:else if mood === 'missed'}
							<span class="sub regret">{end.crash >= CRASH.cap ? 'It went all the way to 100×' : `Crashed at ${formatMult(end.crash)}`}. You missed <b class="ss-num">{formatTenths(missed)}</b> coins.</span>
						{:else}
							<span class="sub">{end.crash >= CRASH.cap ? 'It went all the way to 100×!' : 'Perfect timing: nothing more was to be had.'}</span>
						{/if}
					{:else if mood === 'lost' && end}
						<span class="msg">Crashed. You lose <b>{formatTenths(end.bet)}</b> coins.</span>
					{:else if running}
						<span class="sub">Cash out before it crashes</span>
					{:else}
						<span class="sub">Place a bet to start a round</span>
					{/if}
				</div>
			</div>
		</div>
	{/snippet}
	{#snippet extra()}
		<label class="ss-label" for="casino-auto">Auto cash-out (optional)</label>
		<div class="auto">
			<input id="casino-auto" class="ss-input ss-num" inputmode="decimal" autocomplete="off" maxlength="6" placeholder="off" bind:value={autoText} readonly={running} />
			<span>×</span>
			<button type="button" disabled={running} onclick={() => (autoText = '2')}>2×</button>
			<button type="button" disabled={running} onclick={() => (autoText = '')}>Off</button>
		</div>
		{#if auto}<p class="chance">Chance to get there: <b>{percent(crashChance(auto))}</b></p>{/if}
	{/snippet}
	{#snippet how()}
		<strong>How it works.</strong> The chance to reach a multiplier is 1 divided by it: <b>1.5×</b> 66.7 %, <b>2×</b> 50 %, <b>5×</b> 20 %, <b>10×</b> 10 %,
		<b>100×</b> 1 % (paid out by itself). Average payback <b>100 %</b>; payouts are rounded down to 0.1 coin. The server's clock decides when you cashed out. If
		you disconnect, the auto cash-out still counts; without one the bet is lost at the crash.
	{/snippet}
</CasinoTable>

<style>
	.graph {
		--line: var(--accent);
		flex: 1;
		min-height: 0;
		display: flex;
		padding: 18px 18px 14px;
		transition: background 0.25s;
	}
	.graph.won {
		--line: var(--good);
		background: rgba(95, 224, 122, 0.06);
	}
	.graph.lost {
		--line: var(--bad);
		background: rgba(255, 90, 78, 0.1);
	}
	.graph.tail {
		--line: #ffb13d;
	}
	.graph.missed {
		--line: var(--bad);
	}
	.graph.missed:not(.calm),
	.graph.lost:not(.calm) {
		animation: shake 0.32s linear;
	}
	@keyframes shake {
		0%,
		100% {
			transform: none;
		}
		20% {
			transform: translate(-7px, 3px);
		}
		40% {
			transform: translate(6px, -4px);
		}
		60% {
			transform: translate(-4px, 2px);
		}
		80% {
			transform: translate(3px, -1px);
		}
	}
	.area {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
		border-bottom: 1px solid var(--panel-border-strong);
	}
	svg {
		position: absolute;
		inset: 0;
		overflow: visible;
	}
	.grid {
		stroke: rgba(255, 255, 255, 0.08);
	}
	.tick {
		font: 500 12px var(--num-font);
		fill: var(--text-faint);
	}
	.autoline {
		stroke: var(--info);
		stroke-dasharray: 5 5;
		opacity: 0.7;
	}
	.autotext {
		text-anchor: end;
		fill: var(--info);
	}
	.outline {
		stroke: var(--good);
		stroke-dasharray: 5 5;
		opacity: 0.8;
	}
	.outtext {
		text-anchor: end;
		fill: var(--good);
	}
	.curve {
		fill: none;
		stroke: var(--line);
		stroke-width: 4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.dot {
		fill: #fff;
	}
	.halo {
		fill: var(--line);
		opacity: 0.45;
	}
	.tail:not(.calm) .halo,
	.running:not(.calm) .halo {
		animation: pulse 0.9s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			r: 18px;
			opacity: 0.2;
		}
	}
	.burst {
		stroke: var(--bad);
		stroke-width: 4;
		stroke-linecap: round;
	}
	.missed:not(.calm) .burst,
	.lost:not(.calm) .burst {
		animation: burst 0.4s ease-out;
	}
	@keyframes burst {
		from {
			stroke-dasharray: 0 24;
		}
		to {
			stroke-dasharray: 24 0;
		}
	}
	.readout {
		position: absolute;
		left: 0;
		right: 0;
		top: 12%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		pointer-events: none;
		text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
	}
	.mult {
		font-size: clamp(54px, 10vh, 92px);
		font-weight: 700;
		line-height: 1;
		color: var(--text);
	}
	.idle .mult {
		color: var(--text-faint);
	}
	.won .mult,
	.won .msg,
	.tail .msg,
	.missed .msg {
		color: var(--good);
	}
	.missed .mult,
	.lost .mult,
	.lost .msg {
		color: var(--bad);
	}
	.msg {
		font-size: 20px;
	}
	.sub {
		font-size: 15px;
		color: var(--text-dim);
	}
	.regret {
		font-size: 17px;
		color: #ffb13d;
	}
	.auto {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.auto input {
		flex: 1;
		min-width: 0;
		font-size: 18px;
	}
	.auto button {
		padding: 8px 9px;
		font: 600 13px/1 var(--ui-font);
		color: var(--text);
		background: rgba(255, 255, 255, 0.07);
		border: 1px solid var(--panel-border);
		border-radius: var(--radius);
		cursor: pointer;
	}
	.auto button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.chance {
		margin: 0;
		font-size: 14px;
		color: var(--text-dim);
	}
</style>
