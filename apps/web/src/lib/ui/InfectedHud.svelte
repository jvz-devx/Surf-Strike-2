<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';
	import { INF_MOAB_KILLS, INF_PERK_KILLS, type InfPerkId } from '@surf/shared';
	import type { InfectedView } from '#lib/game/contract.js';
	import { INF_PERK_INFO } from '#lib/game/infected.js';
	import { ammoText, reloadProgress } from '#lib/game/zombies-view.js';
	import { fadeOpacity, formatClock } from '#lib/ui/format.js';
	import {
		accuracyText,
		ammoPrompt,
		arcClear,
		CALM_FLASH,
		CALM_HIT,
		CALM_VIGNETTE,
		calmCueOpacity,
		CalmLevel,
		emptySlotHints,
		hitKind,
		hitOpacity,
		hurtArcPath,
		hurtDirOpacity,
		nukeOpacity,
		nukeWarm,
		popOpacity,
		CROSSHAIR_LINE_CLEAR_PX,
		popRowTop,
		RING_BOX,
		RING_HALF_DEG,
		RING_RADIUS,
		RING_THICKNESS,
		ringKeepOut,
		scopeOverlay,
		summaryLayout,
		vignetteStrength,
		type RingRect
	} from '#lib/ui/infected-hud.js';
	import { practiceHint } from '#lib/ui/infected-practice.js';

	let { inf, now }: { inf: InfectedView; now: number } = $props();

	/** How long the timed labels show (ms): +20s, +AMMO, the UAV line, the perk toast. */
	const BONUS_MS = 1800;
	const SCAVENGER_MS = 1500;
	const UAV_MS = 3000;
	const PERK_TOAST_MS = 1600;

	/** Spectating (free-fly or a target): local-only feedback is hidden. */
	const watching = $derived(inf.spectating ?? false);
	/** The spectated player, else null (the HUD shows the local player). */
	const spec = $derived(watching ? (inf.spec ?? null) : null);
	const team = $derived(spec ? spec.team : inf.team);
	const alpha = $derived(spec ? spec.alpha : inf.alpha);
	const infected = $derived(team === 'infected');
	/** Survivors carry guns, health pips and the 1/2 swap (patient zero too on older servers). */
	const armed = $derived(!infected || (alpha && (spec ? spec.weapon : inf.weapon) !== 'claws'));
	const hp = $derived(spec ? spec.hp : inf.hp);
	const maxHp = $derived(spec ? spec.maxHp : inf.maxHp);
	const hasKnife = $derived(spec ? spec.hasKnife : inf.hasKnife);
	const hasBeacon = $derived(spec ? spec.hasBeacon : inf.hasBeacon);
	/** Metres to my planted beacon (local player only). */
	const beaconDist = $derived(!spec && inf.beaconDist != null ? inf.beaconDist : null);
	const weaponLabel = $derived(spec ? spec.weaponLabel : inf.weaponLabel);
	const held = $derived(spec ? spec.weapon : inf.weapon);
	/** Active slot pill: [1] preset, [2] pistol, [3] knife. */
	const activeSlot = $derived(held === 'knife' ? 3 : held === inf.secondary ? 2 : 1);
	const score = $derived(spec ? spec.score : inf.myScore);
	const lastSurvivor = $derived(spec ? spec.team === 'survivor' && spec.alive && inf.survivors === 1 && inf.infected >= 2 : inf.lastSurvivor);
	const role = $derived(
		watching && !spec
			? { text: 'Spectating', cls: 'survivor' }
			: alpha
				? { text: 'Patient Zero', cls: 'alpha' }
				: infected
					? { text: 'Infected', cls: 'infected' }
					: lastSurvivor
						? { text: 'Last Survivor', cls: 'last' }
						: { text: 'Survivor', cls: 'survivor' }
	);
	const left = $derived(inf.endsAt > 0 ? Math.max(0, (inf.endsAt - now) / 1000) : 0);
	/** Final seconds of a round: the clock pulses. */
	const urgent = $derived(inf.phase === 'playing' && inf.endsAt > 0 && left <= 15);
	const ammo = $derived(ammoText(inf.mag, inf.magSize, inf.reserve));
	const reload = $derived(inf.reloadEndsAt > 0 ? reloadProgress(now, inf.reloadEndsAt, inf.reloadMs) : 1);
	/**
	 * prefers-reduced-motion: no pulsing, popping or flashing. The animations are off (CSS below) and
	 * every event cue eases in and out instead of jumping (the calm helpers of infected-hud.ts).
	 */
	const reduced = $derived(prefersReducedMotion.current);
	/** Reduced motion: the cues with one slot follow their events at a limited rate (once per frame, from `now`). */
	const calmHurt = new CalmLevel(CALM_VIGNETTE);
	const calmHit = new CalmLevel(CALM_HIT);
	const calmFlash = new CalmLevel(CALM_FLASH);
	const flashOpacity = $derived(inf.flash ? (reduced ? calmFlash.at(now, inf.flash.at) : fadeOpacity(now - inf.flash.at, 2000, 800)) : 0);
	const hit = $derived(!watching && inf.hitMarker ? hitKind(inf.hitMarker) : null);
	const hitShown = $derived(hit && inf.hitMarker ? (reduced ? calmHit.at(now, inf.hitMarker.at) : hitOpacity(now - inf.hitMarker.at, hit)) : 0);
	/** Red edge when hit: there at once and fading, or a softer edge that eases in with reduced motion. */
	const hurtOpacity = $derived(
		watching || !(inf.hurtAt > 0) ? 0 : reduced ? calmHurt.at(now, inf.hurtAt) : fadeOpacity(now - inf.hurtAt, 80, 420) * vignetteStrength(false)
	);
	/** Where recent hits came from (local player only). */
	const hurtDirs = $derived(!watching ? (inf.hurtDirs ?? []) : []);
	/** Score popups of the viewed player (the client sends none in free-fly). */
	const pops = $derived(inf.scorePops ?? []);
	const reloading = $derived(inf.reloadEndsAt > 0 && now < inf.reloadEndsAt);
	const prompt = $derived(
		ammoPrompt({
			phase: inf.phase,
			team: inf.team,
			alive: inf.alive,
			spectating: watching,
			mag: inf.mag,
			magSize: inf.magSize,
			reserve: inf.reserve,
			reloading
		})
	);
	const bonus = $derived(inf.timeBonusAt > 0 && now - inf.timeBonusAt < BONUS_MS);
	const scavenger = $derived(!watching && inf.scavengerAt > 0 && now - inf.scavengerAt < SCAVENGER_MS);
	const uav = $derived(inf.phase === 'playing' && inf.uavAt > 0 && now - inf.uavAt < UAV_MS);
	/** UAV distance in metres (1 unit ≈ 2.54 cm), infected only. */
	const uavMetres = $derived(!watching && inf.uavDist != null ? Math.max(1, Math.round(inf.uavDist * 0.0254)) : null);
	const uavText = $derived(
		watching
			? 'UAV sweep · last survivor pinged'
			: infected
				? 'UAV sweep · last survivor detected'
				: inf.lastSurvivor
					? 'UAV sweep · your position was pinged'
					: ''
	);
	const respawn = $derived(inf.respawnAt > 0 ? Math.max(0, Math.ceil((inf.respawnAt - now) / 1000)) : 0);
	const hpFrac = $derived(maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0);
	const BADGE = { knife: 'Throwing knife', bank: 'Bank shot!' } as const;

	/** Kill streak perks that unlock (hardline is the base perk, shown apart). */
	const TRACK: readonly InfPerkId[] = ['sleight', 'scavenger', 'steady', 'specialist'];
	const perks = $derived(spec ? spec.perks : inf.perks);
	const streak = $derived(spec ? spec.streak : inf.streak);
	const specialist = $derived(perks.includes('specialist'));
	/** Survivors in a round see their perk track (or the spectated survivor's). */
	const showTrack = $derived(!infected && (inf.phase === 'playing' || inf.phase === 'grace') && (!watching || spec !== null));
	/** Freshly unlocked perk (pops in the track for 1.6 s). */
	const fresh = $derived(!spec && inf.perkFlash && now - inf.perkFlash.at < PERK_TOAST_MS ? inf.perkFlash.perk : null);
	const moabReady = $derived(spec ? spec.moabReady : inf.moabReady);
	const moabLeft = $derived(inf.moab ? Math.max(0, (inf.moab.endsAt - now) / 1000) : 0);
	/** M.O.A.B. detonation: a white-to-amber flash, or a dim amber wash with reduced motion. */
	const nuke = $derived(inf.moabDetonatedAt > 0 ? nukeOpacity(now - inf.moabDetonatedAt, reduced) : 0);
	const scope = $derived(watching ? null : scopeOverlay(inf.scopeT, inf.scoped));
	/** Where to go with an empty gun: the other slots that still work. */
	const emptyHints = $derived(prompt === 'empty' ? emptySlotHints(activeSlot, inf.slotAmmo, inf.secondaryLabel) : []);
	/** Round summary table (server stats); null: the one-line summary. */
	const summaryRows = $derived(inf.phase === 'ended' && inf.summary ? (inf.summaryRows ?? null) : null);
	const layout = $derived(summaryRows && summaryRows.length > 0 ? summaryLayout(summaryRows, inf.focusId) : null);
	/** Two columns use short headers. */
	const compact = $derived(layout !== null && layout.columns.length > 1);
	/** Hit arc shape in the ring box: straight ahead, rotated per hit. */
	const ARC = hurtArcPath(RING_RADIUS, RING_HALF_DEG, RING_THICKNESS);

	let roundEl = $state<HTMLDivElement>();
	let ringEl = $state<SVGSVGElement>();
	let trackEl = $state<HTMLDivElement>();
	/**
	 * The round header stack as the area the hit arcs stay out of (ring units). On a small screen a
	 * deep stack (M.O.A.B. banner, UAV line, flash) ends inside the ring: an arc that would reach
	 * into it is not drawn. Measured when the stack or the ring changes size, never per frame.
	 */
	let stackKeepOut = $state.raw<RingRect | null>(null);
	/** Lower edge of that stack in the HUD (px): the scope's vertical hair starts below it. */
	let stackBottom = $state(0);
	/** What the perk track takes from the bottom of the HUD (px) where it reaches under the crosshair column, else 0: the hair ends above it. */
	let trackReach = $state(0);
	$effect(() => {
		const round = roundEl;
		const ring = ringEl;
		const track = trackEl;
		// Moves without a resize: the ring with the screen centre, the header when spectating starts or ends.
		void innerWidth.current;
		void innerHeight.current;
		void watching;
		if (!round || !ring) {
			stackKeepOut = null;
			stackBottom = 0;
			trackReach = 0;
			return;
		}
		const measure = () => {
			stackKeepOut = ringKeepOut(round.getBoundingClientRect(), ring.getBoundingClientRect());
			stackBottom = round.offsetTop + round.offsetHeight;
			const hud = round.offsetParent;
			trackReach = track && hud && track.offsetLeft <= hud.clientWidth / 2 ? hud.clientHeight - track.offsetTop : 0;
		};
		const observer = new ResizeObserver(measure);
		observer.observe(round);
		observer.observe(ring);
		if (track) observer.observe(track);
		measure();
		return () => observer.disconnect();
	});
	/** Practice range (no round): the banner says so and names the keys. */
	const practice = $derived(practiceHint(inf));
</script>

{#if infected && (!watching || spec)}<div class="tint" aria-hidden="true"></div>{/if}
{#if hurtOpacity > 0}<div class="vignette" style:opacity={hurtOpacity} aria-hidden="true"></div>{/if}
{#if nuke > 0}
	<div class="nuke" class:calm={reduced} style:opacity={nuke} style:--warm={nukeWarm(now - inf.moabDetonatedAt, reduced)} aria-hidden="true"></div>
{/if}

{#if scope}
	<div
		class="scope"
		style:opacity={scope.opacity}
		style:--hair-top="{stackBottom + 6}px"
		style:--hair-bottom="{trackReach > 0 ? trackReach + 6 : 0}px"
		aria-hidden="true"
	>
		<div class="lens" style:--lens={scope.scale}></div>
		<div class="hair h"></div>
		<div class="hair v"></div>
	</div>
{/if}

<!-- Not over the summary table: the round is over. Always there otherwise, so the ring can be measured. -->
{#if !layout}
	<svg class="dmg" bind:this={ringEl} viewBox="{-RING_BOX / 2} {-RING_BOX / 2} {RING_BOX} {RING_BOX}" aria-hidden="true">
		{#each hurtDirs as h (h.id)}
			{#if arcClear(h.bearing, stackKeepOut)}
				<path d={ARC} class:lethal={h.lethal} transform="rotate({h.bearing})" style:opacity={hurtDirOpacity(now - h.at, h.lethal, reduced)} />
			{/if}
		{/each}
	</svg>
{/if}

<div class="round" data-top-hud class:watching bind:this={roundEl} aria-live="polite">
	{#if inf.phase === 'waiting' || inf.phase === 'solo'}
		<div class="banner ss-panel ss-shadow">
			<span class="role">Infected</span>
			<span class="msg">{practice ? practice.title : 'Waiting for players — infected needs 2+'}</span>
		</div>
		{#if practice}
			<div class="practice">
				{#each practice.keys as k (k.key)}<span><b>{k.key}</b>{k.label}</span>{/each}
			</div>
		{/if}
	{:else if inf.phase === 'grace'}
		<div class="banner ss-panel ss-shadow">
			<span class="role">Round {inf.round}</span>
			<span class="msg">Find a holdout!</span>
			<span class="clock ss-num">{formatClock(left)}</span>
		</div>
		{#if inf.loadoutLabel}<div class="badge loadout"><span class="ss-label">Loadout</span> {inf.loadoutLabel}</div>{/if}
	{:else if inf.phase === 'playing'}
		<div class="banner ss-panel ss-shadow {role.cls}">
			<span class="role">{role.text}</span>
			<span class="clock-wrap">
				<span class="clock ss-num" class:low={left <= 30} class:urgent>{formatClock(left)}</span>
				{#if bonus}<span class="pop bonus ss-num" style:opacity={reduced ? calmCueOpacity(now - inf.timeBonusAt, BONUS_MS) : null}>+20s</span>{/if}
			</span>
			<span class="stat"><span class="ss-label">Survivors</span> <span class="ss-num cyan">{inf.survivors}</span></span>
			<span class="vs">vs</span>
			<span class="stat"><span class="ss-label">Infected</span> <span class="ss-num red">{inf.infected}</span></span>
			{#if !watching || spec}<span class="stat"><span class="ss-label">Score</span> <span class="ss-num">{score}</span></span>{/if}
		</div>
		{#if inf.moab}
			<div class="moab-inbound" role="alert">
				<span class="rad" aria-hidden="true">☢</span>
				<span class="mtitle">M.O.A.B. inbound</span>
				<span class="mclock ss-num">{moabLeft.toFixed(1)}s</span>
				<span class="mcaller">{inf.moab.callerName}</span>
			</div>
		{/if}
		{#if uav && uavText}
			<div class="uav" class:hunted={!watching && !infected} style:opacity={reduced ? calmCueOpacity(now - inf.uavAt, UAV_MS) : null}>
				{uavText}{#if uavMetres !== null}<span class="dist ss-num">{uavMetres}m</span>{/if}
			</div>
		{/if}
	{:else if inf.phase === 'ended' && inf.summary && layout}
		<div class="sumpanel ss-panel ss-shadow" class:lost={inf.summary.winner === 'infected'} class:two={compact}>
			<div class="sumhead">
				<span class="role">{inf.summary.winner === 'survivors' ? 'Survivors win' : 'Infected win'}</span>
				<span class="stat"><span class="ss-label">Time</span> <span class="ss-num">{formatClock(inf.summary.secs)}</span></span>
				<span class="stat"><span class="ss-label">Survived</span> <span class="ss-num cyan">{inf.summary.survivorsLeft}</span></span>
				<span class="sumnext">
					{#if inf.nextLoadoutLabel}<span class="badge loadout"><span class="ss-label">Next</span> {inf.nextLoadoutLabel}</span>{/if}
					<span class="dim">next round in <span class="ss-num cd">{Math.ceil(left)}</span></span>
				</span>
			</div>
			<div class="sumcols">
				{#each layout.columns as col, ci (ci)}
					<table class="sumtable">
						<thead>
							<tr>
								<th class="nm" scope="col">Player</th>
								<th class="c-score" scope="col">Score</th>
								<th class="c-kills" scope="col">{#if compact}<abbr title="Kills">K</abbr>{:else}Kills{/if}</th>
								<th class="c-inf" scope="col">{#if compact}<abbr title="Infections">Inf</abbr>{:else}Infections{/if}</th>
								<th class="c-deaths" scope="col">{#if compact}<abbr title="Deaths">D</abbr>{:else}Deaths{/if}</th>
								<th class="c-acc" scope="col">{#if compact}<abbr title="Accuracy">Acc</abbr>{:else}Accuracy{/if}</th>
								<th class="c-streak" scope="col">{#if compact}<abbr title="Best streak">Str</abbr>{:else}Best streak{/if}</th>
							</tr>
						</thead>
						<tbody>
							{#each col as r (r.id)}
								<tr class:me={r.id === inf.focusId} class:inf={r.team === 'infected'}>
									<td class="nm">
										<div class="nmwrap">
											<span class="pname">{r.name}</span>
											{#if r.alpha}<span class="pz" title="Patient Zero">{compact ? 'P. Zero' : 'Patient Zero'}</span>{/if}
										</div>
									</td>
									<td class="ss-num score">{r.score}</td>
									<td class="ss-num" class:zero={r.kills === 0}>{r.kills}</td>
									<td class="ss-num" class:zero={r.infections === 0}>{r.infections}</td>
									<td class="ss-num" class:zero={r.deaths === 0}>{r.deaths}</td>
									<td class="ss-num" class:zero={r.accuracy === null}>{accuracyText(r.accuracy)}</td>
									<td class="ss-num" class:zero={r.bestStreak === 0}>{r.bestStreak}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/each}
			</div>
			{#if layout.more > 0}<div class="summore dim">+{layout.more} more players</div>{/if}
		</div>
	{:else if inf.phase === 'ended' && inf.summary}
		<div class="banner ss-panel ss-shadow summary" class:lost={inf.summary.winner === 'infected'}>
			<span class="role">{inf.summary.winner === 'survivors' ? 'Survivors win' : 'Infected win'}</span>
			<span class="msg ss-num"
				>{formatClock(inf.summary.secs)} · {inf.summary.survivorsLeft} survived{inf.summary.top ? ` · top ${inf.summary.top}` : ''}</span
			>
			<span class="dim">next round in <span class="ss-num">{Math.ceil(left)}</span></span>
		</div>
	{/if}
	{#if inf.flash && flashOpacity > 0 && !watching}
		<div class="flash {inf.flash.tone ?? 'neutral'}" style:opacity={flashOpacity}>{inf.flash.text}</div>
	{/if}
</div>

{#if hit && hitShown > 0 && inf.hitMarker}
	{#key inf.hitMarker.at}
		<div class="hitmarker hm-{hit}" style:opacity={hitShown} aria-hidden="true">
			<i></i><i></i><i></i><i></i>{#if inf.hitMarker.head}<b></b>{/if}
		</div>
	{/key}
{/if}

{#if prompt}
	<div class="ammo-prompt ap-{prompt}" style:--clear="{CROSSHAIR_LINE_CLEAR_PX}px">
		{#if prompt === 'reload'}
			<span class="pline"><span class="pkey">R</span>Reload</span>
		{:else if prompt === 'low'}
			<span class="pline">Low ammo</span>
		{:else}
			<span class="pline">No ammo</span>
			<span class="palts">
				{#each emptyHints as h (h.key)}<span class="palt"><span class="pkey">{h.key}</span>{h.label}</span>{/each}
			</span>
		{/if}
	</div>
{/if}

{#if pops.length > 0}
	<div class="pops" style:--clear="{CROSSHAIR_LINE_CLEAR_PX}px" aria-hidden="true">
		{#each pops as p, i (p.id)}
			<div class="spop" class:big={p.points >= 250} style:--rowtop={popRowTop(pops.length - 1 - i)} style:opacity={popOpacity(now - p.at, reduced)}>
				<span class="spin"><span class="pts ss-num">+{p.points}</span>{p.label}</span>
			</div>
		{/each}
	</div>
{/if}

{#if !watching && !inf.alive && inf.phase === 'playing'}
	<div class="down ss-panel ss-shadow">
		<div class="title">Infected · Respawning{respawn > 0 ? ` in ${respawn}` : ''}…</div>
		<div class="msg">Left-click: Claws · Right-click: Throwing Knife</div>
	</div>
{/if}

<!-- The stats summary covers the round: the feed makes room for it. -->
<div class="killfeed" class:hidden={layout !== null}>
	{#each inf.killFeed as k (k.id)}
		<div class="kill" class:mine={k.mine} class:hs={k.head} class:knifed={k.badge?.kind === 'knife'} class:banked={k.badge?.kind === 'bank'}>
			{#if k.badge}
				{k.badge.by} <span class="kbadge {k.badge.kind}">{BADGE[k.badge.kind]}</span> {k.badge.victim}
			{:else}
				{k.text}
			{/if}
		</div>
	{/each}
</div>

{#if showTrack}
	<div class="perktrack ss-panel ss-shadow" class:specialist bind:this={trackEl}>
		<span class="streak" class:gold={specialist}>
			{#if specialist}Specialist{:else}<span class="ss-label">Streak</span> <span class="ss-num">{streak}</span>{/if}
		</span>
		<span class="perk base lit" title="Base perk"><span class="pk ss-num">✓</span>Hardline</span>
		{#each TRACK as p (p)}
			<span class="perk" class:lit={perks.includes(p)} class:gold={p === 'specialist'} class:fresh={fresh === p}
				><span class="pk ss-num">{INF_PERK_KILLS[p]}</span>{INF_PERK_INFO[p].name}</span
			>
		{/each}
		{#if moabReady}
			<span class="moab-ready">M.O.A.B. ready{#if !spec}<span class="mkey">N</span>Call{/if}</span>
		{:else}
			<span class="moab-goal"><span class="ss-num">{Math.min(streak, INF_MOAB_KILLS)}/{INF_MOAB_KILLS}</span> M.O.A.B.</span>
		{/if}
	</div>
	{#if fresh}
		{#key inf.perkFlash?.at}
			<div
				class="perktoast"
				class:gold={fresh === 'specialist'}
				style:opacity={reduced && inf.perkFlash ? calmCueOpacity(now - inf.perkFlash.at, PERK_TOAST_MS) : null}
			>
				<span class="ss-label">Perk unlocked</span>
				{INF_PERK_INFO[fresh].toast}
			</div>
		{/key}
	{/if}
{/if}

{#if !watching || spec}
	<div class="status">
		{#if infected}
			<div class="status-row">
				<div class="knife ss-panel ss-shadow" class:ready={hasKnife} class:out={!spec && !hasKnife && inf.knifeOut} class:empty={!hasKnife && (spec !== null || !inf.knifeOut)}>
					<span class="ss-label">Throwing knife</span>
					{#if hasKnife}
						<span class="kstate">{#if !spec}<span class="key">RMB</span>{/if} Ready</span>
					{:else if spec}
						<span class="kstate">Thrown</span>
					{:else if inf.knifeOut}
						<span class="kstate">Knife thrown · walk over to retrieve</span>
					{:else}
						<span class="kstate">No knife · respawn for new</span>
					{/if}
				</div>
				<div class="beacon ss-panel ss-shadow" class:active={hasBeacon} class:ready={!hasBeacon && !spec}>
					<span class="ss-label">Respawn beacon</span>
					{#if hasBeacon}
						<span class="kstate"
							><span class="dot" aria-hidden="true"></span>Active{#if beaconDist !== null}<span class="ss-num"> · {beaconDist}m</span>{/if}</span
						>
						{#if !spec}<span class="bhint"><span class="key">E</span> Re-plant</span>{/if}
					{:else if spec}
						<span class="kstate">None planted</span>
					{:else}
						<span class="kstate"><span class="key">E</span> Plant</span>
						<span class="bhint">Plant forward respawn</span>
					{/if}
				</div>
			</div>
		{/if}
		<div class="status-row">
			<div class="hp ss-panel ss-shadow" class:infected={infected && !alpha} class:alpha>
				<span class="ss-label">{spec ? spec.name : alpha ? 'Patient zero' : infected ? 'Infected' : 'Health'}</span>
				{#if armed}
					<div class="pips">
						{#each Array.from({ length: maxHp }, (_, i) => i) as i (i)}<span class="pip" class:full={i < hp}></span>{/each}
					</div>
				{:else}
					<div class="bar"><div class="fill" style:width="{Math.round(hpFrac * 100)}%"></div></div>
				{/if}
			</div>
			<div class="weapon ss-panel ss-shadow">
				<span class="whead">
					<span class="wname">{weaponLabel}</span>
					{#if scavenger}<span class="pop ammo-pop" style:opacity={reduced ? calmCueOpacity(now - inf.scavengerAt, SCAVENGER_MS) : null}>+AMMO</span>{/if}
				</span>
				{#if armed}
					<span class="slots">
						<span class="slot" class:active={activeSlot === 1} class:dry={!spec && inf.slotAmmo?.[0] === 0}><span class="cap">1</span>{inf.loadoutLabel}</span>
						<span class="slot" class:active={activeSlot === 2} class:dry={!spec && inf.slotAmmo?.[1] === 0}><span class="cap">2</span>{inf.secondaryLabel}</span>
						<span class="slot" class:active={activeSlot === 3}><span class="cap">3</span>Knife</span>
					</span>
				{:else}
					<span class="hint"
						><span class="hk"><b>LMB</b> Claws</span>{#if !spec}{#if hasKnife}<span class="sep">·</span><span class="hk"><b>RMB</b> Throw</span>{/if}<span
								class="sep">·</span
							><span class="hk"><b>E</b> Beacon</span>{/if}</span
					>
				{/if}
				{#if !spec && inf.magSize > 0}
					<span class="ammo ss-num"><span class="mag" class:low={ammo.low}>{ammo.mag}</span><span class="res"> / {ammo.reserve}</span></span>
				{/if}
				{#if !spec && reload < 1}<div class="reload"><div class="fill" style:width="{Math.round(reload * 100)}%"></div></div>{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.round {
		position: absolute;
		top: 64px;
		left: 50%;
		transform: translateX(-50%);
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
		white-space: nowrap;
	}
	.banner.infected {
		background: rgba(70, 14, 18, 0.82);
		border-color: rgba(150, 230, 90, 0.6);
	}
	.banner.alpha {
		background: rgba(130, 34, 8, 0.85);
		border-color: rgba(255, 160, 60, 0.85);
		box-shadow: 0 0 18px rgba(255, 110, 30, 0.45);
	}
	.banner.last {
		border-color: rgba(255, 210, 80, 0.9);
		animation: last-pulse 1.1s ease-in-out infinite;
	}
	.banner.last .role {
		color: #ffd24a;
	}
	.banner.alpha .role {
		color: #ffb347;
		text-shadow: 0 0 8px rgba(255, 90, 20, 0.8);
	}
	.banner.infected .role {
		color: #b8f070;
	}
	@keyframes last-pulse {
		0%,
		100% {
			box-shadow: 0 0 6px rgba(255, 200, 60, 0.25);
		}
		50% {
			box-shadow: 0 0 22px rgba(255, 200, 60, 0.75);
		}
	}
	.summary {
		background: rgba(20, 70, 90, 0.8);
	}
	.summary.lost {
		background: rgba(140, 20, 20, 0.78);
	}
	.role {
		font-weight: 700;
		font-size: 1.25em;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	.clock-wrap {
		position: relative;
	}
	.clock {
		font-weight: 600;
		font-size: 1.2em;
	}
	.clock.low {
		color: #ff7070;
	}
	.vs,
	.dim,
	.msg {
		color: var(--text-dim);
	}
	.cyan {
		color: #7fe8ff;
		font-weight: 600;
	}
	.red {
		color: #ff7a6a;
		font-weight: 600;
	}
	.badge {
		padding: 2px 10px;
		background: rgba(8, 12, 18, 0.65);
		border: 1px solid rgba(255, 210, 120, 0.55);
		color: #ffd27a;
		font-weight: 600;
		letter-spacing: 0.04em;
	}
	.practice {
		display: inline-flex;
		align-items: baseline;
		gap: 14px;
		padding: 3px 12px;
		background: rgba(8, 12, 18, 0.65);
		border: 1px solid var(--panel-border);
		font-size: 0.85em;
		color: var(--text-dim);
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.practice b {
		margin-right: 5px;
		padding: 0 4px;
		color: #ffd27a;
		border: 1px solid rgba(255, 210, 122, 0.45);
		font-weight: 600;
	}
	.pop {
		position: absolute;
		left: 100%;
		top: -0.9em;
		margin-left: 4px;
		font-weight: 800;
		font-size: 0.85em;
		white-space: nowrap;
		animation: pop 1.6s ease-out forwards;
	}
	.pop.bonus {
		color: #ffd24a;
		text-shadow:
			0 0 8px rgba(255, 200, 60, 0.8),
			0 1px 2px #000;
	}
	@keyframes pop {
		0% {
			transform: scale(0.4) translateY(6px);
			opacity: 0;
		}
		12% {
			transform: scale(1.25) translateY(0);
			opacity: 1;
		}
		24% {
			transform: scale(1);
		}
		75% {
			opacity: 1;
		}
		100% {
			transform: translateY(-8px);
			opacity: 0;
		}
	}
	.uav {
		padding: 3px 14px;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #ffb0a0;
		background: rgba(120, 10, 10, 0.55);
		border: 1px solid rgba(255, 80, 60, 0.75);
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
		animation: blink 0.5s steps(2, jump-none) infinite alternate;
	}
	.uav.hunted {
		color: #ffd24a;
		border-color: rgba(255, 200, 60, 0.85);
		background: rgba(90, 60, 0, 0.55);
	}
	@keyframes blink {
		from {
			opacity: 1;
		}
		to {
			opacity: 0.65;
		}
	}
	.flash {
		margin-top: 4px;
		font-size: 1.5em;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: #fff;
		text-shadow:
			0 0 12px rgba(255, 255, 255, 0.4),
			0 2px 4px rgba(0, 0, 0, 0.9);
	}
	.flash.infected {
		color: #ff9a8a;
		text-shadow:
			0 0 14px rgba(255, 30, 30, 0.85),
			0 2px 4px rgba(0, 0, 0, 0.9);
	}
	.flash.survivor {
		color: #bff4ff;
		text-shadow:
			0 0 14px rgba(60, 210, 255, 0.8),
			0 2px 4px rgba(0, 0, 0, 0.9);
	}
	.flash.bonus {
		color: #ffe07a;
		text-shadow:
			0 0 14px rgba(255, 190, 40, 0.85),
			0 2px 4px rgba(0, 0, 0, 0.9);
	}
	/*
	 * Hit marker, three states told apart by colour, size and weight: short white
	 * ticks for a body hit, longer and heavier gold ticks for a headshot, a wide
	 * red cross for a kill (with a gold pip when the kill was a headshot).
	 */
	.hitmarker {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 26px;
		height: 26px;
		transform: translate(-50%, -50%);
		--len: 8px;
		--th: 2px;
		--col: #fff;
	}
	.hitmarker.hm-head {
		width: 30px;
		height: 30px;
		--len: 11px;
		--th: 3px;
		--col: #ffd24a;
	}
	.hitmarker.hm-kill {
		width: 44px;
		height: 44px;
		--len: 14px;
		--th: 3px;
		--col: #ff5a5a;
		animation: hit-kill 140ms ease-out;
	}
	.hitmarker i {
		position: absolute;
		width: var(--len);
		height: var(--th);
		background: var(--col);
		box-shadow: 0 0 2px #000;
	}
	.hitmarker.hm-head i {
		box-shadow:
			0 0 2px #000,
			0 0 6px rgba(255, 200, 60, 0.8);
	}
	.hitmarker.hm-kill i {
		box-shadow:
			0 0 2px #000,
			0 0 7px rgba(255, 60, 40, 0.85);
	}
	/* Each tick lies on a diagonal of the box, starting at its corner. */
	.hitmarker i:nth-child(1) {
		left: 0;
		top: calc((var(--len) - var(--th)) / 2);
		transform: rotate(45deg);
	}
	.hitmarker i:nth-child(2) {
		right: 0;
		top: calc((var(--len) - var(--th)) / 2);
		transform: rotate(-45deg);
	}
	.hitmarker i:nth-child(3) {
		left: 0;
		bottom: calc((var(--len) - var(--th)) / 2);
		transform: rotate(-45deg);
	}
	.hitmarker i:nth-child(4) {
		right: 0;
		bottom: calc((var(--len) - var(--th)) / 2);
		transform: rotate(45deg);
	}
	.hitmarker b {
		display: none;
		position: absolute;
		left: 50%;
		top: 50%;
		width: 6px;
		height: 6px;
		margin: -3px 0 0 -3px;
		background: #ffd24a;
		box-shadow: 0 0 2px #000;
		transform: rotate(45deg);
	}
	.hitmarker.hm-kill b {
		display: block;
	}
	@keyframes hit-kill {
		from {
			transform: translate(-50%, -50%) scale(0.6);
		}
		to {
			transform: translate(-50%, -50%) scale(1);
		}
	}
	/*
	 * Hit direction ring: outside the ammo prompt and the score popups, clear of the panels.
	 * An arc that would reach into the round header stack is left out (arcClear).
	 */
	.dmg {
		position: absolute;
		left: 50%;
		top: 50%;
		width: calc(400px * var(--hud-scale));
		height: calc(400px * var(--hud-scale));
		transform: translate(-50%, -50%);
		overflow: visible;
		pointer-events: none;
	}
	.dmg path {
		fill: rgba(255, 70, 50, 0.9);
		stroke: rgba(40, 0, 0, 0.6);
		stroke-width: 1;
		filter: drop-shadow(0 0 5px rgba(255, 40, 20, 0.7));
	}
	.dmg path.lethal {
		fill: #ff2c1c;
	}
	/* Beside the crosshair: ammo prompt on the left, score popups on the right. */
	.ammo-prompt {
		position: absolute;
		right: calc(50% + 52px * var(--hud-scale));
		top: 50%;
		/* Above the line of the crosshair arms and the scope's hair (below it are the keys). */
		transform: translateY(calc(-100% - var(--clear)));
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 3px;
		font-size: calc(13px * var(--hud-scale));
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		white-space: nowrap;
		color: #ffd27a;
		text-shadow: var(--shadow-text);
	}
	.ammo-prompt.ap-low {
		color: #ffb347;
	}
	.ammo-prompt.ap-empty {
		color: #ff7a6a;
	}
	.pline,
	.palt {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.pkey {
		min-width: 1.4em;
		padding: 0 3px;
		text-align: center;
		font-weight: 800;
		letter-spacing: 0;
		color: #0b0f14;
		background: #ffd27a;
		box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.35);
		text-shadow: none;
	}
	/* One slot per line: the prompt stays narrow enough to end inside the hit ring. */
	.palts {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		font-size: 0.8em;
		letter-spacing: 0.04em;
		color: var(--text);
	}
	.pops {
		position: absolute;
		left: calc(50% + 52px * var(--hud-scale));
		top: 50%;
		font-size: calc(13px * var(--hud-scale));
	}
	/* One row per popup (--rowtop: popRowTop), stacked upwards from just above the crosshair line (the arms and the scope's hair). */
	.spop {
		position: absolute;
		left: 0;
		top: 0;
		height: 1.5em;
		line-height: 1.5em;
		transform: translateY(calc(var(--rowtop) * 1.5em - var(--clear)));
		transition: transform 160ms ease-out;
		white-space: nowrap;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: #fff;
		text-shadow: var(--shadow-text);
	}
	/* Grows into place from its left edge: it never reaches past its own box (keys display on the left, hit ring on the right). */
	.spin {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4em;
		transform-origin: left center;
		animation: spop-in 200ms ease-out;
	}
	.spop .pts {
		font-size: 1.2em;
		font-weight: 700;
		line-height: 1;
		color: #ffd24a;
	}
	.spop.big .pts {
		text-shadow:
			0 0 8px rgba(255, 200, 60, 0.8),
			0 1px 2px #000;
	}
	@keyframes spop-in {
		from {
			opacity: 0;
			transform: scale(0.75);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	/* Round summary (server stats): a header line over one table, or two above 8 players. */
	.sumpanel {
		display: flex;
		flex-direction: column;
		gap: 6px;
		box-sizing: border-box;
		width: calc(600px * var(--hud-scale));
		padding: 8px 12px 10px;
		background: var(--panel-bg-strong);
		border-top: 2px solid #7fe8ff;
	}
	/* Two tables: still clear of the vote panel on the left at 1280 wide. */
	.sumpanel.two {
		width: calc(640px * var(--hud-scale));
	}
	.sumpanel.lost {
		border-top-color: #ff7a6a;
	}
	/* Wraps onto a second line when a long loadout label meets the countdown; each part stays whole. */
	.sumhead {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 2px 16px;
		white-space: nowrap;
	}
	.sumhead .role {
		color: #bff4ff;
	}
	.sumpanel.lost .sumhead .role {
		color: #ff9a8a;
	}
	.sumnext {
		margin-left: auto;
		display: inline-flex;
		align-items: baseline;
		gap: 10px;
	}
	/* One width for every digit (the number font has no tabular figures), so the header never rewraps as it counts down. */
	.sumnext .cd {
		display: inline-block;
		width: 0.75em;
		text-align: right;
	}
	.sumcols {
		display: flex;
		align-items: flex-start;
		gap: 14px;
	}
	.sumtable {
		flex: 1 1 0;
		min-width: 0;
		table-layout: fixed;
		border-collapse: collapse;
		font-size: 0.85em;
	}
	.sumtable th {
		padding: 0 5px 3px;
		text-align: right;
		font-size: calc(10px * var(--hud-scale));
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		white-space: nowrap;
		color: var(--text-dim);
	}
	.sumtable abbr {
		text-decoration: none;
	}
	.sumtable td {
		height: 1.5em;
		padding: 0 5px;
		text-align: right;
		white-space: nowrap;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}
	.sumtable th.nm,
	.sumtable td.nm {
		text-align: left;
	}
	/* Team bar: cyan survivors, red infected (the colours of the round header counts). */
	.sumtable td.nm {
		border-left: 2px solid #7fe8ff;
	}
	.sumtable tr.inf td.nm {
		border-left-color: #ff7a6a;
	}
	.nmwrap {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.pname {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pz {
		flex: none;
		padding: 0 4px;
		font-size: 0.72em;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #ffb347;
		border: 1px solid rgba(255, 160, 60, 0.7);
	}
	.sumtable td.score {
		font-weight: 700;
	}
	.sumtable td.zero {
		color: var(--text-faint);
	}
	/* The local player (or the spectated one). */
	.sumtable tr.me td {
		color: #fff;
		background: rgba(255, 210, 122, 0.16);
	}
	.sumtable tr.me td.nm {
		font-weight: 700;
		color: #ffd27a;
	}
	.c-score {
		width: calc(56px * var(--hud-scale));
	}
	.c-kills {
		width: calc(48px * var(--hud-scale));
	}
	.c-inf {
		width: calc(84px * var(--hud-scale));
	}
	.c-deaths {
		width: calc(58px * var(--hud-scale));
	}
	.c-acc {
		width: calc(74px * var(--hud-scale));
	}
	.c-streak {
		width: calc(92px * var(--hud-scale));
	}
	.two .c-score {
		width: calc(44px * var(--hud-scale));
	}
	.two .c-kills,
	.two .c-deaths {
		width: calc(26px * var(--hud-scale));
	}
	.two .c-inf,
	.two .c-streak {
		width: calc(30px * var(--hud-scale));
	}
	.two .c-acc {
		width: calc(40px * var(--hud-scale));
	}
	.summore {
		font-size: 0.8em;
		text-align: right;
	}
	.tint {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background:
			radial-gradient(ellipse at center, transparent 62%, rgba(120, 0, 10, 0.28) 100%),
			linear-gradient(to top, rgba(90, 200, 40, 0.08), transparent 18%);
	}
	.vignette {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(ellipse at center, transparent 45%, rgba(200, 0, 0, 0.6) 100%);
	}
	.scope {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}
	/* --lens: 1.35 while the zoom starts, 1 when it is in (the surround closes in). */
	.lens {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 80vmin;
		height: 80vmin;
		transform: translate(-50%, -50%) scale(var(--lens, 1));
		border-radius: 50%;
		box-shadow: 0 0 0 200vmax #000;
	}
	.hair {
		position: absolute;
		background: rgba(0, 0, 0, 0.9);
	}
	/*
	 * Both hairs end inside the lens (radius 40vmin), 5vmin short of its edge: the vertical one
	 * stays clear of the speedometer at 720p, the horizontal one of the panels at the sides. The
	 * vertical one also starts below the round header stack (--hair-top), however deep that is,
	 * and ends above the perk track where that reaches under the crosshair (--hair-bottom).
	 */
	.hair.h {
		left: calc(50% - 35vmin);
		right: calc(50% - 35vmin);
		top: 50%;
		height: 1px;
	}
	.hair.v {
		top: max(calc(50% - 35vmin), var(--hair-top, 0px));
		bottom: max(calc(50% - 35vmin), var(--hair-bottom, 0px));
		left: 50%;
		width: 1px;
	}
	/* Below the hit ring: clear of the arcs at every bearing, the score popups and the keys display. */
	.down {
		position: absolute;
		left: 50%;
		top: calc(50% + 200px * var(--hud-scale));
		transform: translateX(-50%);
		padding: 8px 16px;
		text-align: center;
		white-space: nowrap;
		background: rgba(80, 14, 18, 0.84);
		border-color: rgba(150, 230, 90, 0.55);
		font-size: calc(15px * var(--hud-scale));
	}
	/* Narrow enough to stay right of the chat column at 1280 wide. */
	.down .title {
		font-size: 1.2em;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.down .msg {
		font-size: 0.85em;
	}
	/* Under the connection status, which grows with the HUD scale. */
	.killfeed {
		position: absolute;
		top: max(54px, calc(14px + 44px * var(--hud-scale)));
		right: 18px;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 3px;
		font-size: calc(13px * var(--hud-scale));
	}
	.kill {
		background: rgba(8, 12, 18, 0.6);
		padding: 2px 8px;
	}
	.killfeed.hidden {
		display: none;
	}
	.kill.mine {
		border: 1px solid rgba(255, 210, 120, 0.7);
	}
	.kill.hs {
		color: #ffd24a;
	}
	.status {
		position: absolute;
		right: 18px;
		bottom: 22px;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 8px;
		font-size: calc(15px * var(--hud-scale));
	}
	.status-row {
		display: flex;
		gap: 10px;
		align-items: stretch;
	}
	.hp,
	.weapon,
	.knife,
	.beacon {
		padding: 6px 14px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
	}
	.hp.infected {
		background: rgba(80, 14, 18, 0.82);
	}
	.hp.alpha {
		background: rgba(130, 34, 8, 0.82);
	}
	.pips {
		display: flex;
		gap: 4px;
	}
	.pip {
		width: 16px;
		height: 16px;
		border: 1px solid rgba(255, 255, 255, 0.6);
		background: rgba(0, 0, 0, 0.3);
	}
	.pip.full {
		background: #e8f0e0;
	}
	.bar,
	.reload {
		width: 110px;
		height: 6px;
		background: rgba(0, 0, 0, 0.45);
	}
	.bar .fill {
		height: 100%;
		background: linear-gradient(to right, #c8ff6a, #ff5a4a);
	}
	.reload .fill {
		height: 100%;
		background: #ffd27a;
	}
	.whead {
		position: relative;
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.wname {
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		font-size: 0.85em;
		color: var(--text-dim);
	}
	.ammo-pop {
		position: static;
		margin: 0;
		color: #9fe08a;
		font-size: 0.8em;
		letter-spacing: 0.08em;
		text-shadow:
			0 0 8px rgba(120, 255, 120, 0.7),
			0 1px 2px #000;
		animation-duration: 1.4s;
	}
	.hint {
		font-size: 0.75em;
		color: var(--text-dim);
		letter-spacing: 0.04em;
	}
	.hint {
		display: inline-flex;
		align-items: baseline;
		flex-wrap: nowrap;
		white-space: nowrap;
	}
	.hint .sep {
		margin: 0 6px;
		opacity: 0.5;
	}
	.hint b {
		margin-right: 3px;
		padding: 0 3px;
		color: #ffd27a;
		border: 1px solid rgba(255, 210, 122, 0.45);
	}
	.ammo {
		font-size: 1.6em;
		font-weight: 700;
	}
	.ammo .res {
		font-size: 0.6em;
		color: var(--text-dim);
	}
	.mag.low {
		color: #ff7070;
	}
	.knife {
		min-width: 150px;
	}
	.kstate {
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		font-size: 0.85em;
	}
	.knife.ready {
		border-color: rgba(120, 240, 255, 0.8);
		box-shadow: 0 0 12px rgba(80, 220, 255, 0.35);
	}
	.knife.ready .kstate {
		color: #bff4ff;
	}
	.knife .key {
		padding: 0 4px;
		margin-right: 2px;
		border: 1px solid rgba(191, 244, 255, 0.7);
		font-size: 0.85em;
	}
	.knife.out .kstate {
		color: #e0a85a;
	}
	.knife.empty {
		opacity: 0.6;
	}
	.knife.empty .kstate {
		color: var(--text-dim);
	}
	.beacon {
		min-width: 150px;
		opacity: 0.85;
	}
	.beacon .key {
		padding: 0 4px;
		margin-right: 2px;
		border: 1px solid rgba(255, 190, 150, 0.7);
		font-size: 0.85em;
	}
	.bhint {
		font-size: 0.72em;
		color: var(--text-dim);
		letter-spacing: 0.04em;
	}
	.beacon.ready {
		opacity: 1;
	}
	.beacon.ready .kstate {
		color: #ffd0b8;
	}
	.beacon.active {
		opacity: 1;
		background: rgba(70, 14, 10, 0.84);
		border-color: rgba(255, 90, 50, 0.85);
		box-shadow:
			0 0 14px rgba(255, 70, 30, 0.4),
			inset 0 0 0 1px rgba(80, 240, 190, 0.25);
	}
	.beacon.active .kstate {
		color: #ff9a72;
		text-shadow: 0 0 8px rgba(255, 70, 30, 0.6);
	}
	.beacon .dot {
		display: inline-block;
		width: 0.55em;
		height: 0.55em;
		margin-right: 6px;
		border-radius: 50%;
		background: #ff4422;
		box-shadow: 0 0 6px #ff4422;
		animation: flare 0.9s ease-in-out infinite alternate;
	}
	@keyframes flare {
		from {
			opacity: 1;
			transform: scale(1);
		}
		to {
			opacity: 0.55;
			transform: scale(0.8);
		}
	}
	/* Below the spectator bar, which grows with the HUD scale. */
	.round.watching {
		top: max(112px, calc(18px + 94px * var(--hud-scale)));
	}
	.clock.urgent {
		display: inline-block;
		color: #ffb347;
		animation: urgent 0.9s ease-in-out infinite;
	}
	@keyframes urgent {
		0%,
		100% {
			color: #ffb347;
			transform: scale(1);
			text-shadow: 0 0 4px rgba(255, 150, 40, 0.4);
		}
		50% {
			color: #ff4a3a;
			transform: scale(1.12);
			text-shadow:
				0 0 14px rgba(255, 50, 30, 0.9),
				0 1px 2px #000;
		}
	}
	.uav .dist {
		margin-left: 10px;
		padding: 0 6px;
		border: 1px solid currentColor;
		letter-spacing: 0.04em;
	}
	.kill.knifed {
		border-left: 3px solid #6fe3ff;
	}
	.kill.banked {
		border-left: 3px solid #ffc83a;
		background: rgba(60, 40, 0, 0.7);
	}
	.kbadge {
		display: inline-block;
		margin: 0 4px;
		padding: 0 6px;
		font-weight: 800;
		font-size: 0.82em;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #081016;
	}
	.kbadge.knife {
		background: #8fe9ff;
	}
	.kbadge.bank {
		background: linear-gradient(to right, #ffe27a, #ffad2a);
		box-shadow: 0 0 10px rgba(255, 190, 50, 0.7);
	}
	.slots {
		display: flex;
		gap: 6px;
		font-size: 0.75em;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.slot {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 1px 7px 1px 1px;
		border: 1px solid rgba(255, 255, 255, 0.18);
		color: var(--text-dim);
	}
	.slot.active {
		color: #fff;
		border-color: rgba(255, 210, 122, 0.85);
		background: rgba(255, 210, 122, 0.14);
	}
	.cap {
		min-width: 1.4em;
		padding: 0 3px;
		text-align: center;
		font-weight: 800;
		color: #0b0f14;
		background: rgba(255, 255, 255, 0.45);
		box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.35);
	}
	.slot.active .cap {
		background: #ffd27a;
	}
	/* No round left in this slot. */
	.slot.dry {
		color: var(--text-faint);
	}
	.slot.dry .cap {
		background: #ff7a6a;
	}
	/* M.O.A.B. detonation: white core warming to amber as it fades (--warm 0 → 1). */
	.nuke {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(
			ellipse at center,
			rgb(255 255 255) 0%,
			rgb(255 calc(255 - var(--warm) * 50) calc(240 - var(--warm) * 170)) 45%,
			rgb(255 calc(200 - var(--warm) * 60) calc(90 - var(--warm) * 60)) 100%
		);
	}
	/* Reduced motion: flat amber, no white core (the opacity eases in and out once). */
	.nuke.calm {
		background: rgb(255 170 60);
	}
	.moab-inbound {
		display: inline-flex;
		align-items: baseline;
		gap: 10px;
		padding: 4px 16px;
		font-weight: 800;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #ffe2a0;
		background: linear-gradient(to right, rgba(150, 16, 8, 0.85), rgba(170, 80, 0, 0.85));
		border: 1px solid rgba(255, 170, 60, 0.95);
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
		animation: inbound 0.8s ease-in-out infinite;
	}
	.moab-inbound .rad {
		color: #ffd24a;
		font-size: 1.2em;
	}
	.moab-inbound .mclock {
		min-width: 3.6em;
		text-align: right;
		color: #fff;
		font-size: 1.2em;
	}
	.moab-inbound .mcaller {
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: none;
		color: #ffd0a0;
	}
	@keyframes inbound {
		0%,
		100% {
			box-shadow: 0 0 8px rgba(255, 60, 20, 0.45);
		}
		50% {
			box-shadow: 0 0 26px rgba(255, 150, 30, 0.95);
		}
	}
	.perktrack {
		position: absolute;
		right: 18px;
		bottom: calc(22px + 92px * var(--hud-scale));
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		font-size: calc(12px * var(--hud-scale));
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.perktrack.specialist {
		border-color: rgba(255, 200, 60, 0.85);
		box-shadow: 0 0 14px rgba(255, 190, 40, 0.35);
	}
	.streak {
		margin-right: 4px;
		font-weight: 800;
	}
	.streak.gold {
		color: #ffd24a;
		text-shadow: 0 0 8px rgba(255, 190, 40, 0.8);
	}
	.perk {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 1px 6px 1px 1px;
		border: 1px solid rgba(255, 255, 255, 0.14);
		color: rgba(255, 255, 255, 0.38);
	}
	.perk .pk {
		min-width: 1.3em;
		padding: 0 3px;
		text-align: center;
		font-weight: 800;
		color: #0b0f14;
		background: rgba(255, 255, 255, 0.22);
	}
	.perk.lit {
		color: #e8fbff;
		border-color: rgba(120, 230, 255, 0.75);
		background: rgba(60, 190, 255, 0.14);
	}
	.perk.lit .pk {
		background: #8fe9ff;
	}
	.perk.base {
		opacity: 0.8;
	}
	.perk.gold.lit {
		color: #fff4c8;
		border-color: rgba(255, 200, 60, 0.95);
		background: rgba(255, 190, 40, 0.18);
	}
	.perk.gold.lit .pk {
		background: #ffd24a;
	}
	.perk.fresh {
		animation: perk-pop 1.6s ease-out;
	}
	@keyframes perk-pop {
		0% {
			transform: scale(0.6);
			box-shadow: 0 0 0 rgba(255, 255, 255, 0);
		}
		15% {
			transform: scale(1.3);
			box-shadow: 0 0 18px rgba(160, 240, 255, 0.95);
		}
		35% {
			transform: scale(1);
		}
		100% {
			box-shadow: 0 0 0 rgba(160, 240, 255, 0);
		}
	}
	.moab-goal {
		margin-left: 4px;
		color: var(--text-dim);
	}
	.moab-ready {
		margin-left: 4px;
		padding: 1px 8px;
		font-weight: 800;
		color: #1a1000;
		background: linear-gradient(to right, #ffe27a, #ffad2a);
		box-shadow: 0 0 12px rgba(255, 190, 50, 0.8);
		animation: last-pulse 0.9s ease-in-out infinite;
	}
	.mkey {
		margin: 0 3px 0 8px;
		padding: 0 4px;
		border: 1px solid rgba(26, 16, 0, 0.7);
	}
	/* Its pop starts a little low: 2 px more than the track needs. */
	.perktoast {
		position: absolute;
		right: 18px;
		bottom: calc(22px + 130px * var(--hud-scale));
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		padding: 4px 12px;
		font-size: calc(14px * var(--hud-scale));
		font-weight: 800;
		letter-spacing: 0.06em;
		color: #bff4ff;
		background: rgba(8, 30, 44, 0.78);
		border: 1px solid rgba(120, 230, 255, 0.8);
		text-shadow: 0 0 10px rgba(60, 210, 255, 0.7);
		/* Pops from its anchored corner, so the overshoot never crosses the screen edge. */
		transform-origin: right bottom;
		animation: pop 1.6s ease-out forwards;
	}
	.perktoast.gold {
		color: #ffe07a;
		background: rgba(50, 34, 0, 0.82);
		border-color: rgba(255, 200, 60, 0.95);
		text-shadow: 0 0 12px rgba(255, 190, 40, 0.85);
	}
	@keyframes arc-in {
		from {
			opacity: 0;
		}
	}
	/*
	 * prefers-reduced-motion: nothing pulses, pops or blinks. The elements keep
	 * their static look (their lifetimes are set in the script, not by the
	 * animations), and the steady glows below stand in for the pulses. The
	 * script eases every event cue in and out instead (inline opacity: hurt
	 * vignette, hit marker, hit arcs, score popups, flash, UAV line, perk
	 * toast, +20s, +AMMO).
	 */
	@media (prefers-reduced-motion: reduce) {
		.banner.last,
		.pop,
		.uav,
		.beacon .dot,
		.clock.urgent,
		.moab-inbound,
		.moab-ready,
		.perk.fresh,
		.perktoast,
		.hitmarker.hm-kill,
		.spin {
			animation: none;
		}
		.spop {
			transition: none;
		}
		/* An arc that comes out from behind the header stack (the view turned, a row went) fades in like a new one. */
		.dmg path {
			animation: arc-in 120ms linear;
		}
		.banner.last {
			box-shadow: 0 0 12px rgba(255, 200, 60, 0.5);
		}
		.moab-inbound {
			box-shadow: 0 0 14px rgba(255, 110, 30, 0.7);
		}
	}
</style>
