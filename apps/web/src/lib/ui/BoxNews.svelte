<script lang="ts">
	import { untrack } from 'svelte';
	import { flip } from 'svelte/animate';
	import { fly } from 'svelte/transition';
	import { RARITIES } from '@surf/shared';
	import { newsRarity, NEWS_LOOK, queueNews, stepNews, type NewsEntry } from '#lib/game/box-news.js';
	import type { BoxNews, GameApi } from '#lib/game/contract.js';
	import { itemPicture } from '#lib/ui/menu/item-pictures.svelte.js';

	/** What others got from loot boxes, at the top centre (docs/ui.md#box-news). Takes no input. */
	let {
		news,
		now,
		api,
		enabled,
		hidden,
		menu
	}: {
		news: readonly BoxNews[];
		now: number;
		api: GameApi;
		enabled: boolean;
		/** Something opaque has the screen. */
		hidden: boolean;
		/** The Esc menu is open: the HUD below is not visible. */
		menu: boolean;
	} = $props();

	/** Nothing closer to the crosshair than this (px). */
	const CROSSHAIR = 64;
	const MEASURE_MS = 200;
	const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

	let queue: readonly NewsEntry[] = $state.raw([]);
	const pictures: Record<string, string> = $state({});
	let seen = untrack(() => news.at(-1)?.id ?? 0);
	let top = $state(14);
	/** Shrinks a card that does not fit. */
	let fit = $state(1);
	let measured = 0;

	const shown = $derived(queue.filter((e) => e.shownAt !== null));

	$effect(() => {
		const t = now;
		const fresh = news.filter((n) => n.id > seen);
		untrack(() => step(t, fresh));
	});

	function step(t: number, fresh: readonly BoxNews[]) {
		if (fresh.length > 0) seen = fresh.at(-1)!.id;
		if (!enabled) {
			queue = [];
			return;
		}
		for (const n of fresh) queue = queueNews(queue, n);
		if (queue.length === 0) return;
		const scale = Math.min(1.6, Math.max(0.85, innerHeight / 1080));
		if (t - measured >= MEASURE_MS) {
			measured = t;
			top = below();
		}
		const room = innerHeight / 2 - CROSSHAIR - top;
		const before = queue;
		queue = stepNews(queue, t, room / scale);
		if (queue === before) return;
		const used = queue.reduce((h, e) => (e.shownAt === null ? h : Math.max(h, NEWS_LOOK[newsRarity(e)].height)), 0) * scale;
		fit = used > 0 ? Math.min(1, Math.max(0.6, room / used)) : 1;
		const started = queue.filter((e) => e.shownAt === t);
		for (const { item } of started) {
			if (!(item.id in pictures)) itemPicture(item.id, api, (url) => (pictures[item.id] = url));
		}
		if (started.length > 0) api.boxSound(started.some((e) => newsRarity(e) === 'rare' || newsRarity(e) === 'epic') ? 'newsRare' : 'news');
	}

	/** Below the map name, votes, round info and timers at the top centre. */
	function below(): number {
		if (menu) return 14;
		let y = 8;
		for (const el of document.querySelectorAll('[data-top-hud]')) y = Math.max(y, el.getBoundingClientRect().bottom);
		return Math.round(y + 8);
	}
</script>

<div class="news" class:hidden style:top="{top}px" style:--fit={fit} role="status" aria-live="polite">
	{#each shown as e (e.id)}
		{@const r = newsRarity(e)}
		<div
			class="slot"
			style:height="calc({NEWS_LOOK[r].height}px * var(--hud-scale) * var(--fit))"
			in:fly={{ y: still ? 0 : -50, duration: still ? 0 : 320 }}
			out:fly={{ y: still ? 0 : -30, duration: still ? 0 : 260 }}
			animate:flip={{ duration: still ? 0 : 220 }}
		>
			<div class="card ss-shadow {r}" class:still style:--c={RARITIES[r].color} style:--h="{NEWS_LOOK[r].height}px">
				<div class="picture">{#if pictures[e.item.id]}<img src={pictures[e.item.id]} alt="" draggable="false" />{/if}</div>
				<div class="text">
					<span class="who"><b>{e.name}</b> opened a loot box</span>
					<span class="what">
						<strong>{e.item.name}</strong>
						<span class="rarity">{RARITIES[r].name}</span>
						<span class="tag" class:new={!e.duplicate}>{e.duplicate ? 'Duplicate' : 'New'}</span>
						{#if e.more > 0}<span class="more ss-num">+{e.more} more</span>{/if}
					</span>
				</div>
			</div>
		</div>
	{/each}
</div>

<style>
	.news {
		position: absolute;
		/* Above the Esc menu and its loot box screen. */
		z-index: 4;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		max-width: calc(100vw - 32px);
		pointer-events: none;
		user-select: none;
		color: var(--text);
		font-family: var(--ui-font);
		transition: top 0.2s ease-out;
	}
	.hidden {
		visibility: hidden;
	}
	.slot {
		max-width: 100%;
	}
	.card {
		--u: calc(var(--hud-scale) * var(--fit));
		position: relative;
		display: flex;
		align-items: center;
		gap: calc(10px * var(--u));
		height: 100%;
		max-width: 100%;
		box-sizing: border-box;
		padding: 0 calc(16px * var(--u)) 0 calc(6px * var(--u));
		font-size: calc(14px * var(--u));
		line-height: 1.2;
		background: linear-gradient(90deg, color-mix(in srgb, var(--c) 26%, rgba(12, 14, 18, 0.9)), rgba(12, 14, 18, 0.88) 70%);
		border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
		border-left: 3px solid var(--c);
		border-radius: var(--radius);
	}
	.picture {
		flex: none;
		width: calc((var(--h) - 8px) * var(--u));
		height: calc((var(--h) - 8px) * var(--u));
		background: radial-gradient(circle, color-mix(in srgb, var(--c) 45%, transparent), transparent 72%);
	}
	.picture img {
		display: block;
		width: 100%;
		height: 100%;
		animation: appear 0.2s ease-out;
	}
	.text {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1em;
		white-space: nowrap;
	}
	.who {
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.who b {
		color: var(--text);
		font-weight: 700;
	}
	.what {
		display: flex;
		align-items: baseline;
		gap: 0.5em;
	}
	.what strong {
		font-size: 1.15em;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rarity {
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		font-size: 0.86em;
		color: var(--c);
	}
	.tag {
		font-size: 0.8em;
		color: var(--text-dim);
	}
	.tag.new {
		color: var(--good);
	}
	.more {
		font-size: 0.85em;
		font-weight: 600;
		color: var(--text);
	}
	.uncommon {
		font-size: calc(15px * var(--u));
	}
	.rare {
		padding-right: calc(24px * var(--u));
		font-size: calc(17px * var(--u));
		border-width: 1px 1px 1px 4px;
		border-color: var(--c);
		box-shadow: 0 0 calc(22px * var(--u)) color-mix(in srgb, var(--c) 60%, transparent);
	}
	.rare .what strong {
		font-size: 1.25em;
	}
	.epic {
		padding-right: calc(30px * var(--u));
		font-size: calc(19px * var(--u));
		border: 2px solid var(--c);
		animation: glow 1.1s ease-in-out infinite alternate;
	}
	.epic .what strong {
		font-size: 1.35em;
	}
	.epic::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(100deg, transparent 35%, rgba(255, 255, 255, 0.28) 50%, transparent 65%) no-repeat;
		background-size: 250% 100%;
		animation: shine 2.2s linear infinite;
	}
	.still,
	.still::after {
		animation: none;
	}
	.epic.still {
		box-shadow: 0 0 calc(34px * var(--u)) var(--c);
	}
	.epic.still::after {
		content: none;
	}
	@keyframes appear {
		from {
			opacity: 0;
		}
	}
	@keyframes glow {
		from {
			box-shadow: 0 0 calc(18px * var(--u)) color-mix(in srgb, var(--c) 55%, transparent);
		}
		to {
			box-shadow:
				0 0 calc(44px * var(--u)) var(--c),
				0 0 calc(90px * var(--u)) color-mix(in srgb, var(--c) 45%, transparent);
		}
	}
	@keyframes shine {
		from {
			background-position: 160% 0;
		}
		to {
			background-position: -80% 0;
		}
	}
</style>
