<script lang="ts">
	import type { ZombiesView } from '#lib/game/contract.js';
	import { ammoText, formatRoundClock, loadoutChoices, reloadProgress } from '#lib/game/zombies-view.js';
	import { fadeOpacity } from '#lib/ui/format.js';

	let { z, now }: { z: ZombiesView; now: number } = $props();

	const choices = loadoutChoices();
	const ammo = $derived(ammoText(z.mag, z.magSize, z.reserve));
	const reload = $derived(z.reloadEndsAt > 0 ? reloadProgress(now, z.reloadEndsAt, z.reloadMs) : 1);
	const left = $derived(z.endsAt > 0 ? Math.max(0, (z.endsAt - now) / 1000) : 0);
	const elapsed = $derived(z.startedAt > 0 ? (now - z.startedAt) / 1000 : 0);
	const gateLeft = $derived(z.gate && z.gate.opensAt > 0 ? Math.max(0, (z.gate.opensAt - now) / 1000) : 0);
	const loadoutLeft = $derived(z.loadoutEndsAt > 0 ? Math.max(0, (z.loadoutEndsAt - now) / 1000) : 0);
	const flashOpacity = $derived(z.flash ? fadeOpacity(now - z.flash.at, 2000, 800) : 0);
	const hitOpacity = $derived(z.hitMarker ? fadeOpacity(now - z.hitMarker.at, 120, 220) : 0);
	const hurtOpacity = $derived(z.hurtAt > 0 ? fadeOpacity(now - z.hurtAt, 80, 420) : 0);
	const rise = $derived(z.respawnAt > 0 ? Math.max(0, Math.ceil((z.respawnAt - now) / 1000)) : 0);
	const zombie = $derived(z.team === 'zombie');
</script>

{#if hurtOpacity > 0}<div class="vignette" style:opacity={hurtOpacity * 0.8}></div>{/if}

{#if z.scoped}
	<div class="scope" aria-hidden="true">
		<div class="lens"></div>
		<div class="hair h"></div>
		<div class="hair v"></div>
	</div>
{/if}

<div class="round" aria-live="polite">
	{#if z.phase === 'countdown'}
		<div class="banner ss-panel ss-shadow">
			<span class="role">Round {z.round}</span>
			<span class="msg">starts in</span>
			<span class="clock ss-num">{Math.ceil(left)}</span>
		</div>
	{:else if z.phase === 'playing'}
		<div class="banner ss-panel ss-shadow" class:zombie>
			<span class="role">{zombie ? 'Zombie' : 'Survivor'}</span>
			<span class="clock ss-num">{formatRoundClock(elapsed)}</span>
			<span class="stat"><span class="ss-label">Zone</span> <span class="ss-num">{(z.gate?.index ?? z.checkpoints) + 1}</span></span>
			<span class="stat"><span class="ss-label">Zombies</span> <span class="ss-num">{z.zombies}</span></span>
			<span class="stat"><span class="ss-label">Kills</span> <span class="ss-num">{z.myKills}</span><span class="dim ss-num"> / {z.teamKills}</span></span>
		</div>
		<div class="progress" title="Route progress"><div class="fill" style:width="{Math.round(z.progress * 100)}%"></div></div>
		{#if z.gate}
			<div class="gate" class:counting={z.gate.state === 'counting'}>
				{#if z.gate.state === 'counting'}
					Gate {z.gate.index + 1}/{z.gate.count} opens in <span class="ss-num">{Math.ceil(gateLeft)}</span> s — hold out!
				{:else if !zombie}
					Gate {z.gate.index + 1}/{z.gate.count}: get half the survivors into the green area
				{:else}
					Survivors are stuck at gate {z.gate.index + 1}
				{/if}
			</div>
		{:else}
			<div class="gate open">All gates open — {zombie ? 'stop them reaching the boat!' : 'get to the evac boat!'}</div>
		{/if}
	{:else if z.phase === 'ended' && z.summary}
		<div class="banner ss-panel ss-shadow summary" class:lost={!z.summary.won}>
			<span class="role">{z.summary.won ? 'Evacuated' : 'Overrun'}</span>
			<span class="msg ss-num">{formatRoundClock(z.summary.secs)} · {z.summary.kills} kills{z.summary.top ? ` · top ${z.summary.top}` : ''}</span>
			<span class="dim">next round in <span class="ss-num">{Math.ceil(left)}</span></span>
		</div>
	{:else if z.phase === 'waiting'}
		<div class="banner ss-panel ss-shadow"><span class="msg">Waiting for players</span></div>
	{/if}
	{#if z.flash && flashOpacity > 0}
		<div class="flash" style:opacity={flashOpacity}>{z.flash.text}</div>
	{/if}
</div>

{#if hitOpacity > 0 && z.hitMarker}
	<div class="hitmarker" class:head={z.hitMarker.head} class:kill={z.hitMarker.kill} style:opacity={hitOpacity} aria-hidden="true">
		<i></i><i></i><i></i><i></i>
	</div>
{/if}

{#if !z.alive && z.phase === 'playing'}
	<div class="down ss-panel ss-shadow">
		<div class="title">{z.team === 'zombie' && z.respawnAt > 0 ? 'You are a zombie now' : 'Down'}</div>
		<div class="msg">Rising at a zombie spawn{rise > 0 ? ` in ${rise}` : '…'} — claw the survivors (mouse1)</div>
	</div>
{:else if z.loadoutOpen && !zombie}
	<div class="loadout ss-panel ss-shadow">
		<div class="head">
			<span class="ss-label">Weapon</span>
			{#if loadoutLeft > 0}<span class="dim ss-num">{Math.ceil(loadoutLeft)} s</span>{/if}
		</div>
		{#each choices as c (c.weapon)}
			<div class="choice" class:on={c.weapon === z.weapon}>
				<span class="key ss-num">{c.slot}</span>
				<span class="name">{c.label}</span>
				<span class="meta ss-num">{c.hits} · {c.speed}</span>
			</div>
		{/each}
	</div>
{/if}

<div class="killfeed">
	{#each z.killFeed as k (k.id)}
		<div class="kill" class:mine={k.mine} class:hs={k.head}>{k.text}</div>
	{/each}
</div>

<div class="status">
	<div class="hp ss-panel ss-shadow" class:zombie>
		<span class="ss-label">{zombie ? 'Zombie' : 'Health'}</span>
		{#if zombie}
			<div class="bar"><div class="fill" style:width="{Math.round((z.hp / z.maxHp) * 100)}%"></div></div>
		{:else}
			<div class="pips">
				{#each Array.from({ length: z.maxHp }, (_, i) => i) as i (i)}<span class="pip" class:full={i < z.hp}></span>{/each}
			</div>
		{/if}
	</div>
	<div class="weapon ss-panel ss-shadow">
		<span class="wname">{z.weaponLabel}</span>
		{#if z.magSize > 0}
			<span class="ammo ss-num"><span class="mag" class:low={ammo.low}>{ammo.mag}</span><span class="res"> / {ammo.reserve}</span></span>
		{/if}
		{#if reload < 1}<div class="reload"><div class="fill" style:width="{Math.round(reload * 100)}%"></div></div>{/if}
	</div>
</div>

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
	.banner.zombie {
		background: rgba(40, 90, 40, 0.8);
		border-color: rgba(120, 220, 120, 0.7);
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
	.clock {
		font-weight: 600;
		font-size: 1.2em;
	}
	.dim,
	.msg {
		color: var(--text-dim);
	}
	.progress {
		width: 260px;
		height: 4px;
		background: rgba(0, 0, 0, 0.45);
	}
	.progress .fill {
		height: 100%;
		background: #9fe08a;
	}
	.gate {
		color: #ffd27a;
		font-weight: 600;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
	}
	.gate.counting {
		color: #fff2a8;
		font-size: 1.15em;
	}
	.gate.open {
		color: #9fe08a;
	}
	.flash {
		margin-top: 4px;
		font-size: 1.5em;
		font-weight: 700;
		color: #fff;
		text-shadow:
			0 0 12px rgba(120, 255, 120, 0.6),
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
	.vignette {
		position: absolute;
		inset: 0;
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
		background: rgba(40, 90, 40, 0.8);
	}
	.down .title {
		font-size: 1.4em;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.loadout {
		position: absolute;
		left: 18px;
		top: 30%;
		padding: 8px 12px;
		min-width: 230px;
		font-size: calc(14px * var(--hud-scale));
	}
	.loadout .head {
		display: flex;
		justify-content: space-between;
		margin-bottom: 4px;
	}
	.choice {
		display: flex;
		gap: 10px;
		align-items: baseline;
		padding: 2px 4px;
	}
	.choice.on {
		background: rgba(255, 255, 255, 0.14);
	}
	.choice .key {
		color: #ffd27a;
		font-weight: 700;
	}
	.choice .name {
		flex: 1;
	}
	.choice .meta {
		color: var(--text-dim);
		font-size: 0.9em;
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
		gap: 10px;
		align-items: stretch;
		font-size: calc(15px * var(--hud-scale));
	}
	.hp,
	.weapon {
		padding: 6px 14px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
	}
	.hp.zombie {
		background: rgba(40, 90, 40, 0.8);
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
		background: #9fe08a;
	}
	.reload .fill {
		height: 100%;
		background: #ffd27a;
	}
	.wname {
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		font-size: 0.85em;
		color: var(--text-dim);
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
</style>
