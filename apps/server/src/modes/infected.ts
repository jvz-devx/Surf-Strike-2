/**
 * Infected gamemode (docs/modes.md#infected). Server-authoritative: the shared
 * `InfectedGame` (round flow, teams, limited ammo, lag-compensated hits,
 * throwing-knife projectiles, UAV pulses) runs here on the latest state
 * packets; clients send `fire`/`reload`/`loadout`/`throwKnife`/`placeBeacon`/`callMoab`
 * and display the results.
 */
import type { InfEvent, InfPerkId, InfPhase, MapRecordInfo, NetState, ScoreRow, ServerMessage, WeaponId } from '@surf/shared';
import {
	buildCollisionWorld,
	FLAG_DUCKED,
	INF_SECONDARY,
	INF_SIM_HZ,
	INF_UAV_INTERVAL_MS,
	InfectedGame,
	infEventRoute,
	Status,
	WEAPONS,
	type InfectedGameOptions
} from '@surf/shared';
import type { Command } from '../commands.ts';
import type { ModeClientMessage, ModeHost, ModePlayer, ServerMode } from './types.ts';
import { EMPTY_RECORDS } from './types.ts';

/** Mode state is re-sent at least this often (ms), and at most this often on minor changes. */
export const INF_STATE_MS = 1000;
export const INF_STATE_MIN_MS = 250;
/** Grace countdown chat lines at these remaining seconds. */
const GRACE_COUNTDOWN = new Set([5, 3, 2, 1]);

export type InfectedModeOptions = Pick<
	InfectedGameOptions,
	'graceSecs' | 'roundSecs' | 'endSecs' | 'respawnSecs' | 'minPlayers' | 'moabKills' | 'moabCountdownSecs'
>;

/** Events that change what everyone sees right away: state goes out immediately. */
const URGENT = new Set<InfEvent['e']>([
	'phase',
	'alpha',
	'infect',
	'end',
	'knifeThrow',
	'knifeBounce',
	'knifeStick',
	'knifePickup',
	'knifeRemove',
	'beaconPlace',
	'beaconDestroy',
	'beaconUse',
	'perk',
	'moabReady',
	'moabCall',
	'moabDetonate'
]);

const PERK_NAMES: Readonly<Record<InfPerkId, string>> = {
	hardline: 'Hardline',
	sleight: 'Sleight of Hand (faster reloads)',
	scavenger: 'Scavenger (full ammo refills from kills, pistol too)',
	steady: 'Steady Aim (tighter spread, faster movement)',
	specialist: 'Specialist Bonus (faster fire, harder knockback, 6 HP)'
};

const weaponName = (w: WeaponId) => WEAPONS[w].label.toLowerCase();

function clock(secs: number): string {
	const m = Math.floor(secs / 60);
	const s = secs - m * 60;
	return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export class InfectedMode implements ServerMode {
	readonly id = 'infected' as const;
	readonly game: InfectedGame;
	private lastSent = -Infinity;
	private dirty = true;
	private urgent = false;
	/** Last grace countdown second announced (per round). */
	private graceSaid = -1;
	/** Last survivor already announced this round. */
	private lastSurvivorSaid: number | null = null;
	/** Active player ids of the last tick (a roster change re-sends state at once). */
	private roster = '';
	/** "Patient Zero drops the gun" already said this round. */
	private gunDropSaid = false;
	/** Phase of the last `phase` event (a drop to waiting only says "cancelled" mid-round). */
	private phaseSaid: InfPhase = 'waiting';

	constructor(
		private readonly host: ModeHost,
		opts: InfectedModeOptions = {}
	) {
		const map = host.map;
		this.game = new InfectedGame({
			...opts,
			map,
			world: buildCollisionWorld(map),
			now: host.now(),
			rng: () => host.rng(),
			lenient: true
		});
	}

	join(p: ModePlayer): void {
		this.tick();
		this.host.send(p, this.stateMessage());
		this.host.systemTo(
			p,
			'Infected: during the grace period everyone spreads out, then one player becomes Patient Zero and keeps their gun until the first infection. ' +
				'Survivors hold out until the clock runs out (each infection adds 20 s); infected use claws and a right-click throwing knife that bounces once and can be picked up again. ' +
				'Infected can press [E] to drop a Respawn Beacon: their next respawn is on it, unless a survivor shoots or knifes it first. ' +
				'Survivors: 1-3 switches primary/pistol/knife, R reloads. Kill streaks unlock perks (1, 3, 5, 7 kills); a long enough streak earns a M.O.A.B., press [N] to call it.'
		);
		if (this.game.phase === 'waiting') this.host.systemTo(p, 'Waiting for more players: Infected needs 2+ to start a round.');
	}

	leave(): void {
		this.tick();
	}

	spectate(): void {
		this.tick();
	}

	state(p: ModePlayer, s: NetState): void {
		this.game.setPlayerPos(p.id, { x: s.x, y: s.y, z: s.z, ducked: (s.flags & FLAG_DUCKED) !== 0, yaw: s.yaw });
	}

	zone(): void {}

	records(): MapRecordInfo {
		return { ...EMPTY_RECORDS };
	}

	/** fire / reload / loadout (weapon switch) / throwKnife / placeBeacon / callMoab from a player. */
	message(p: ModePlayer, msg: ModeClientMessage): void {
		if (p.spectating || !this.game.hasPlayer(p.id)) return;
		const now = this.host.now();
		switch (msg.type) {
			case 'fire': {
				const rawTick = Number(msg.tick);
				// Live clients send 2^31-1 because infected has no binary sim-tick frame:
				// rewind by half-RTT (clamped to INF_HISTORY_MS inside InfectedGame).
				const tick =
					!Number.isFinite(rawTick) || rawTick >= 0x7fffffff
						? this.game.tick - Math.round(((Math.max(0, p.ping) * 0.5) / 1000) * INF_SIM_HZ)
						: rawTick;
				const res = this.game.fire(p.id, { weapon: msg.weapon, origin: msg.origin, dir: msg.dir, tick }, now);
				this.dispatch(res.events);
				break;
			}
			case 'reload':
				this.game.reload(p.id, now);
				return;
			case 'loadout':
				this.dispatch(this.game.selectWeapon(p.id, msg.weapon, now));
				this.dirty = true;
				break;
			case 'throwKnife': {
				const res = this.game.throwKnife(p.id, msg.origin, msg.dir, now);
				this.dispatch(res.events);
				break;
			}
			case 'placeBeacon': {
				const res = this.game.placeBeacon(p.id, now);
				this.dispatch(res.events);
				break;
			}
			case 'callMoab': {
				const res = this.game.callMoab(p.id, now);
				this.dispatch(res.events);
				break;
			}
		}
		this.flushState(now);
	}

	command(p: ModePlayer, cmd: Command): boolean {
		if (cmd.cmd !== 'top' && cmd.cmd !== 'pb') return false;
		const v = this.game.playerView(p.id);
		this.host.systemTo(
			p,
			`No leaderboard in infected. This round: ${v?.score ?? 0} points, ${v?.kills ?? 0} kills, ${v?.deaths ?? 0} deaths.`
		);
		return true;
	}

	scoreRows(): ScoreRow[] {
		const rows: ScoreRow[] = [];
		for (const p of this.host.players()) {
			const v = p.spectating ? null : this.game.playerView(p.id);
			rows.push({
				id: p.id,
				name: p.name,
				rank: null,
				pbTicks: null,
				status: !v ? Status.Spectating : v.alpha ? Status.Alpha : v.team === 'infected' ? Status.Infected : Status.Alive,
				stage: 0,
				ping: Math.round(p.ping),
				spectating: p.spectating,
				score: v?.score ?? 0,
				kills: v?.kills ?? 0,
				deaths: v?.deaths ?? 0
			});
		}
		rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.kills ?? 0) - (a.kills ?? 0) || a.name.localeCompare(b.name));
		return rows;
	}

	tick(): void {
		const now = this.host.now();
		const ids: number[] = [];
		// Stable identities: a rejoin (spectate toggle or reconnect) gets its round stats
		// back, and an id the lobby hands to someone else starts fresh.
		const keys = new Map<number, string>();
		for (const p of this.host.players()) {
			if (p.spectating) continue;
			ids.push(p.id);
			keys.set(p.id, p.playerId);
		}
		this.game.syncPlayers(ids, now, keys);
		const roster = ids.sort((a, b) => a - b).join(',');
		if (roster !== this.roster) {
			this.roster = roster;
			this.urgent = true;
		}
		this.dispatch(this.game.update(now));
		this.graceCountdown(now);
		this.lastSurvivorAlert(now);
		this.flushState(now);
	}

	stateMessage(): Extract<ServerMessage, { type: 'modeState' }> {
		return { type: 'modeState', mode: 'infected', ...this.game.view(this.host.now()) };
	}

	private flushState(now: number): void {
		if (this.urgent || (this.dirty && now - this.lastSent >= INF_STATE_MIN_MS) || now - this.lastSent >= INF_STATE_MS) {
			this.lastSent = now;
			this.dirty = false;
			this.urgent = false;
			this.host.broadcast(this.stateMessage());
		}
	}

	private name(id: number | null): string {
		for (const p of this.host.players()) if (p.id === id) return p.name;
		return `Player ${id}`;
	}

	private dispatch(events: InfEvent[]): void {
		const h = this.host;
		for (const ev of events) {
			const route = infEventRoute(ev);
			const msg: ServerMessage = { type: 'inf', ev };
			if (route.to !== undefined) {
				for (const p of h.players()) if (p.id === route.to) h.send(p, msg);
			} else if (route.except !== undefined) {
				for (const p of h.players()) if (p.id !== route.except) h.send(p, msg);
			} else h.broadcast(msg);
			if (URGENT.has(ev.e)) this.urgent = true;
			else if (ev.e !== 'shot') this.dirty = true;
			this.announce(ev);
		}
	}

	private graceCountdown(now: number): void {
		const g = this.game;
		if (g.phase !== 'grace') return;
		const secs = Math.ceil((g.endsAt - now) / 1000);
		if (secs === this.graceSaid || !GRACE_COUNTDOWN.has(secs)) return;
		this.graceSaid = secs;
		this.host.system(`Patient Zero is picked in ${secs}...`);
	}

	/** One survivor left against 2+ infected: announced once per survivor per round. */
	private lastSurvivorAlert(now: number): void {
		const g = this.game;
		if (g.phase !== 'playing') return;
		const v = g.view(now);
		if (v.survivors !== 1 || v.infected < 2) return;
		const last = v.players.find((p) => p.team === 'survivor' && p.alive);
		if (!last || last.id === this.lastSurvivorSaid) return;
		this.lastSurvivorSaid = last.id;
		this.host.system(
			`${this.name(last.id)} is the LAST SURVIVOR! A UAV reveals their position every ${INF_UAV_INTERVAL_MS / 1000} s. Hunt them down!`
		);
	}

	private announce(ev: InfEvent): void {
		const h = this.host;
		const g = this.game;
		switch (ev.e) {
			case 'phase': {
				const was = this.phaseSaid;
				this.phaseSaid = ev.phase;
				this.graceSaid = -1;
				this.lastSurvivorSaid = null;
				this.gunDropSaid = false;
				if (ev.phase === 'waiting')
					h.system(
						was === 'grace' || was === 'playing'
							? 'Not enough players: round cancelled. Infected needs 2+ players.'
							: 'Not enough players: waiting for 2+ to start the next round.'
					);
				else if (ev.phase === 'grace')
					h.system(
						`Round ${ev.round}: ${Math.round(g.view(h.now()).timeLeft)} s grace period, spread out! Loadout: ${weaponName(ev.loadout)} + ${weaponName(INF_SECONDARY)} + knife (1-3 to switch).`
					);
				else if (ev.phase === 'playing') h.log(`infected round ${ev.round} start`);
				break;
			}
			case 'alpha':
				h.system(`${this.name(ev.id)} is Patient Zero! They keep the ${weaponName(g.roundLoadout)} until the first infection. Survive!`);
				h.log(`infected round ${g.round} alpha=${ev.id}`);
				break;
			case 'infect': {
				const victim = this.name(ev.id);
				const bonus = ev.timeAdded > 0 ? ` +${ev.timeAdded} s` : '';
				if (ev.by === null) h.system(`${victim} turned: the infected need a host.`);
				else if (ev.method === 'bank')
					h.system(`BANK SHOT! ${this.name(ev.by)} infected ${victim} with a throwing knife off the wall!${bonus}`);
				else if (ev.method === 'knife') h.system(`${this.name(ev.by)} infected ${victim} with a throwing knife!${bonus}`);
				else if (ev.method === 'gun') h.system(`${this.name(ev.by)} shot ${victim}: infected!${bonus}`);
				else h.system(`${this.name(ev.by)} infected ${victim}!${bonus}`);
				if (ev.timeAdded > 0 && !this.gunDropSaid && g.alphaId !== null) {
					this.gunDropSaid = true;
					h.system(`${this.name(g.alphaId)} drops the gun and goes for the claws.`);
				}
				break;
			}
			case 'perk': {
				if (ev.perk === 'specialist') h.system(`${this.name(ev.id)} earned the Specialist Bonus with a ${ev.streak}-kill streak!`);
				else for (const o of h.players()) if (o.id === ev.id) h.systemTo(o, `${ev.streak}-kill streak: ${PERK_NAMES[ev.perk]} unlocked.`);
				break;
			}
			case 'moabReady':
				for (const o of h.players()) if (o.id === ev.id) h.systemTo(o, 'M.O.A.B. ready! Press [N] to call it in.');
				break;
			case 'moabCall':
				h.system(`M.O.A.B. INBOUND! Detonating in ${ev.secs} s! Called in by ${this.name(ev.by)}.`);
				h.log(`infected round ${g.round} moab called by ${ev.by}`);
				break;
			case 'moabDetonate':
				h.system(`M.O.A.B. detonated! ${this.name(ev.by)} wiped out ${ev.kills} infected.`);
				h.log(`infected round ${g.round} moab detonated by ${ev.by} kills=${ev.kills}`);
				break;
			case 'beaconDestroy': {
				// Only the owner hears about it (chat stays uncluttered); clean-ups stay silent.
				if (ev.by === null) break;
				for (const o of h.players()) {
					if (o.id === ev.ownerId) h.systemTo(o, `${this.name(ev.by)} destroyed your Respawn Beacon.`);
				}
				break;
			}
			case 'end': {
				const top = ev.topId !== null ? ` Top player: ${this.name(ev.topId)} (${ev.topScore}).` : '';
				h.system(
					ev.winner === 'survivors'
						? `Survivors win round ${ev.round}! ${ev.survivorsLeft} held out for ${clock(ev.secs)}.${top}`
						: `Infected win round ${ev.round}: everyone turned after ${clock(ev.secs)}.${top}`
				);
				h.log(`infected round ${ev.round} ${ev.winner} ${ev.secs}s left=${ev.survivorsLeft}`);
				break;
			}
		}
	}

	dispose(): void {}
}
