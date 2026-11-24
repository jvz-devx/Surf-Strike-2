<script lang="ts">
	import { INF_MOAB_KILLS, INF_PERK_KILLS, type InfPerkId } from '@surf/shared';
	import type { InfectedView } from '#lib/game/contract.js';
	import { INF_PERK_INFO } from '#lib/game/infected.js';
	import { ammoText, reloadProgress } from '#lib/game/zombies-view.js';
	import { fadeOpacity, formatClock } from '#lib/ui/format.js';

	let { inf, now }: { inf: InfectedView; now: number } = $props();

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
	const flashOpacity = $derived(inf.flash ? fadeOpacity(now - inf.flash.at, 2000, 800) : 0);
	const hitOpacity = $derived(!watching && inf.hitMarker ? fadeOpacity(now - inf.hitMarker.at, 120, 220) : 0);
	const hurtOpacity = $derived(!watching && inf.hurtAt > 0 ? fadeOpacity(now - inf.hurtAt, 80, 420) : 0);
	const bonus = $derived(inf.timeBonusAt > 0 && now - inf.timeBonusAt < 1800);
	const scavenger = $derived(!watching && inf.scavengerAt > 0 && now - inf.scavengerAt < 1500);
	const uav = $derived(inf.phase === 'playing' && inf.uavAt > 0 && now - inf.uavAt < 3000);
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
	const fresh = $derived(!spec && inf.perkFlash && now - inf.perkFlash.at < 1600 ? inf.perkFlash.perk : null);
	const moabReady = $derived(spec ? spec.moabReady : inf.moabReady);
	const moabLeft = $derived(inf.moab ? Math.max(0, (inf.moab.endsAt - now) / 1000) : 0);
	/** M.O.A.B. detonation: a blinding white-to-amber flash fading over 2.4 s. */
	const NUKE_MS = 2400;
	const nukeT = $derived(inf.moabDetonatedAt > 0 ? (now - inf.moabDetonatedAt) / NUKE_MS : 1);
	const nukeOpacity = $derived(nukeT >= 0 && nukeT < 1 ? Math.pow(1 - nukeT, 1.6) : 0);
</script>

{#if infected && (!watching || spec)}<div class="tint" aria-hidden="true"></div>{/if}
{#if hurtOpacity > 0}<div class="vignette" style:opacity={hurtOpacity * 0.8} aria-hidden="true"></div>{/if}
{#if nukeOpacity > 0}
	<div class="nuke" style:opacity={nukeOpacity} style:--warm={Math.min(1, nukeT * 2.2)} aria-hidden="true"></div>
{/if}

{#if inf.scoped && !watching}
	<div class="scope" aria-hidden="true">
		<div class="lens"></div>
		<div class="hair h"></div>
		<div class="hair v"></div>
	</div>
{/if}

<div class="round" data-top-hud class:watching aria-live="polite">
	{#if inf.phase === 'waiting' || inf.phase === 'solo'}
		<div class="banner ss-panel ss-shadow">
			<span class="role">Infected</span>
			<span class="msg">Waiting for players — infected needs 2+</span>
		</div>
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
				{#if bonus}<span class="pop bonus ss-num">+20s</span>{/if}
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
			<div class="uav" class:hunted={!watching && !infected}>
				{uavText}{#if uavMetres !== null}<span class="dist ss-num">{uavMetres}m</span>{/if}
			</div>
		{/if}
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

{#if hitOpacity > 0 && inf.hitMarker}
	<div class="hitmarker" class:head={inf.hitMarker.head} class:kill={inf.hitMarker.kill} style:opacity={hitOpacity} aria-hidden="true">
		<i></i><i></i><i></i><i></i>
	</div>
{/if}

{#if !watching && !inf.alive && inf.phase === 'playing'}
	<div class="down ss-panel ss-shadow">
		<div class="title">Infected · Respawning{respawn > 0 ? ` in ${respawn}` : ''}…</div>
		<div class="msg">Left-click: Claws · Right-click: Throwing Knife</div>
	</div>
{/if}

<div class="killfeed">
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
	<div class="perktrack ss-panel ss-shadow" class:specialist>
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
			<div class="perktoast" class:gold={fresh === 'specialist'}>
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
					{#if scavenger}<span class="pop ammo-pop">+AMMO</span>{/if}
				</span>
				{#if armed}
					<span class="slots">
						<span class="slot" class:active={activeSlot === 1}><span class="cap">1</span>{inf.loadoutLabel}</span>
						<span class="slot" class:active={activeSlot === 2}><span class="cap">2</span>{inf.secondaryLabel}</span>
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
	.hitmarker {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 28px;
		height: 28px;
		transform: translate(-50%, -50%);
	}
	.hitmarker i {
		position: absolute;
		width: 9px;
		height: 2px;
		background: #fff;
		box-shadow: 0 0 2px #000;
	}
	.hitmarker.head i {
		background: #ffd24a;
	}
	.hitmarker.kill i {
		background: #ff5a5a;
		width: 12px;
	}
	.hitmarker i:nth-child(1) {
		left: 0;
		top: 4px;
		transform: rotate(45deg);
	}
	.hitmarker i:nth-child(2) {
		right: 0;
		top: 4px;
		transform: rotate(-45deg);
	}
	.hitmarker i:nth-child(3) {
		left: 0;
		bottom: 4px;
		transform: rotate(-45deg);
	}
	.hitmarker i:nth-child(4) {
		right: 0;
		bottom: 4px;
		transform: rotate(45deg);
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
	.lens {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 80vmin;
		height: 80vmin;
		transform: translate(-50%, -50%);
		border-radius: 50%;
		box-shadow: 0 0 0 200vmax #000;
	}
	.hair {
		position: absolute;
		background: rgba(0, 0, 0, 0.9);
	}
	.hair.h {
		left: 10%;
		right: 10%;
		top: 50%;
		height: 1px;
	}
	.hair.v {
		top: 10%;
		bottom: 10%;
		left: 50%;
		width: 1px;
	}
	.down {
		position: absolute;
		left: 50%;
		top: 58%;
		transform: translateX(-50%);
		padding: 10px 22px;
		text-align: center;
		background: rgba(80, 14, 18, 0.84);
		border-color: rgba(150, 230, 90, 0.55);
		font-size: calc(15px * var(--hud-scale));
	}
	.down .title {
		font-size: 1.4em;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.killfeed {
		position: absolute;
		top: 54px;
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
	.round.watching {
		top: 104px;
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
	.perktoast {
		position: absolute;
		right: 18px;
		bottom: calc(22px + 128px * var(--hud-scale));
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
		animation: pop 1.6s ease-out forwards;
	}
	.perktoast.gold {
		color: #ffe07a;
		background: rgba(50, 34, 0, 0.82);
		border-color: rgba(255, 200, 60, 0.95);
		text-shadow: 0 0 12px rgba(255, 190, 40, 0.85);
	}
</style>
