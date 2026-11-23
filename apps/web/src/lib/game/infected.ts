/**
 * Infected client (docs/modes.md#infected). Online it predicts the local
 * weapons (fire rate, ammo, reload), sends `fire`/`reload`/`loadout`/
 * `throwKnife`, steps throwing knives smoothly between server events and
 * shows the server's events. Offline there is no round (infected needs a
 * server and 2+ players): free roam with a waiting banner.
 * game.ts owns the player, camera and input; this module owns everything
 * infected-specific behind a small host interface.
 *
 * Server rules this mirrors (packages/shared/src/modes/infected/game.ts):
 * - A survivor is infected in place: `infect` for me, then `ammo` 'claws'.
 * - Patient Zero loses the gun through an `ammo` 'claws' event only.
 * - `ammo` with `scavenger: true` names the primary (or, with the scavenger
 *   perk, the pistol) even while another slot is held: a reserve update only.
 * - Survivors carry three slots: [1] the round preset, [2] the pistol
 *   (INF_SECONDARY, its own INF_AMMO), [3] the knife. `spawn` only carries the
 *   held gun, so the pistol starts from INF_AMMO wherever the server hands out
 *   fresh guns (round and join spawns as a survivor, becoming the Alpha).
 * - Kill streak perks (INF_PERK_KILLS) come from `perk` events and the state;
 *   the client mirrors their prediction factors (reload, cadence, spread,
 *   speed). A M.O.A.B. is earned with `moabReady`, called with `callMoab`,
 *   counts down (`moabCall`) and ends the round (`moabDetonate`, then `end`).
 * - Remote roles come from `players[].alpha`, not `alphaId` (which stays set).
 * - Respawn beacons: one per infected; placing again replaces it
 *   (`beaconDestroy` with `by: null`, then `beaconPlace`). The next respawn
 *   consumes it (`beaconUse`, then `spawn` reason 'beacon').
 */
import {
	INF_AMMO,
	INF_BEACON_COOLDOWN_MS,
	INF_BEACON_HIT_Z,
	INF_INFECTED_HP,
	INF_INFECTED_SPEED,
	INF_KNIFE_GRAVITY,
	INF_PRESETS,
	INF_RESPAWN_SECS,
	INF_SECONDARY,
	INF_SLEIGHT_RELOAD_FACTOR,
	INF_SPECIALIST_CADENCE_FACTOR,
	INF_SPECIALIST_HP,
	INF_STEADY_SPEED_FACTOR,
	INF_STEADY_SPREAD_FACTOR,
	INF_SURVIVOR_HP,
	infPerksForStreak,
	isWeaponId,
	WEAPONS,
	WeaponState,
	ZM_SLOW_MS,
	zmSlowFactor,
	type ClientMessage,
	type CollisionWorld,
	type InfBeaconView,
	type InfEvent,
	type InfKnifeView,
	type InfMethod,
	type InfPerkId,
	type InfStateView,
	type InfTeam,
	type Vec3,
	type WeaponId
} from '@surf/shared';
import type { BeaconRenderPose, InfectedRenderer, KnifeRenderPose } from '../render/infected.js';
import type { ZombieRenderer } from '../render/zombies.js';
import type { InfectedView, InfSpecView, KillFeedLine } from './contract.js';
import { FIRE_BUFFER_MS, forwardDir, liveKillFeed, pushKillFeed, spreadDir } from './zombies-view.js';

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
/**
 * `fire.tick`: the client never learns the infected sim tick, and the server
 * clamps it into its history window, so a huge tick means "no rewind".
 */
export const INF_FIRE_TICK_NOW = 2 ** 31 - 1;
/** Stale `modeState.hasKnife` is ignored this long after a local throw or pickup. */
const KNIFE_GRACE_MS = 600;
/** Flying knives snap to `modeState` only when this far off (units). */
const KNIFE_SNAP_DIST = 160;
/** A knife missing from `modeState` is kept this long after its event (ordering slack). */
const KNIFE_KEEP_MS = 500;
const FLASH_MS = 3000;
/** Hammer units per metre (HUD beacon distance). */
const UNITS_PER_M = 39.37;
const HIT_MS = 400;
/** Cosmetic pellet tracers per shotgun trigger pull (the server resolves every pellet). */
const PELLET_TRACERS_MIN = 5;
const PELLET_TRACERS_MAX = 8;

export type InfSound =
	| 'shot-pistol'
	| 'shot-lmg'
	| 'shot-sniper'
	| 'shot-barrett'
	| 'shot-striker'
	| 'shot-smg'
	| 'knife'
	| 'claws'
	| 'throw'
	| 'reload'
	| 'hit'
	| 'hurt'
	| 'round'
	| 'alpha'
	| 'uav'
	| 'beacon'
	| 'perk'
	| 'moabReady'
	| 'moab'
	| 'moabDetonate';

/** Kill streak perk names and their unlock toast (hardline is the base perk). */
export const INF_PERK_INFO: Readonly<Record<InfPerkId, { name: string; toast: string }>> = Object.freeze({
	hardline: { name: 'Hardline', toast: 'HARDLINE · Streaks need one kill less' },
	sleight: { name: 'Sleight', toast: 'SLEIGHT OF HAND · 2× Reload' },
	scavenger: { name: 'Scavenger', toast: 'SCAVENGER PRO · Full Resupply' },
	steady: { name: 'Steady Aim', toast: 'STEADY AIM · Tight Spread + Speed' },
	specialist: { name: 'Specialist', toast: 'SPECIALIST BONUS! All Perks Active +250' }
});

/** Max HP: the specialist unlock raises a survivor to INF_SPECIALIST_HP. */
export function infMaxHp(team: InfTeam, perks: readonly InfPerkId[]): number {
	if (team === 'infected') return INF_INFECTED_HP;
	return perks.includes('specialist') ? INF_SPECIALIST_HP : INF_SURVIVOR_HP;
}

/** Cosmetic tracers per trigger pull: 1, or 5-8 for a shotgun. */
export function pelletTracers(weapon: WeaponId): number {
	const n = Math.floor(WEAPONS[weapon].pellets ?? 1);
	return n > 1 ? Math.max(PELLET_TRACERS_MIN, Math.min(PELLET_TRACERS_MAX, n)) : 1;
}

/** Mode ammo (INF_AMMO) for a fresh weapon state. */
function limitAmmo(ws: WeaponState): void {
	const a = INF_AMMO[ws.weapon];
	if (!a) return;
	ws.mag = a.mag;
	ws.reserve = a.reserve;
}

function samePerks(a: readonly InfPerkId[], b: readonly InfPerkId[]): boolean {
	return a.length === b.length && a.every((p, i) => p === b[i]);
}

/** Role shown on remote players. */
export type InfRole = 'none' | 'infected' | 'alpha';

export interface InfHost {
	online(): boolean;
	selfId(): number;
	send(msg: ClientMessage): void;
	/** Viewmodel and tracers. */
	zombieRenderer(): ZombieRenderer | null;
	/** Throwing knives and UAV pulses. */
	infectedRenderer(): InfectedRenderer | null;
	name(id: number): string;
	notice(text: string): void;
	/** Teleport the local player (spawn, fall-out). */
	teleport(x: number, y: number, z: number, yaw: number): void;
	voteOpen(): boolean;
	sound(name: InfSound, at?: Vec3): void;
	/** Zoom: horizontal FOV at 4:3, or null for the cvar FOV. */
	setZoom(fov: number | null): void;
	/** Knockback on the local player (hit by a bullet). */
	push(vx: number, vy: number): void;
}

interface LocalKnife extends KnifeRenderPose {
	/** Last event or state update that touched it (ms). */
	at: number;
}

/** Remote role from a player view (the Alpha only while it still holds the gun). */
export function infRole(p: { team: InfTeam; alpha: boolean } | undefined): InfRole {
	if (!p || p.team !== 'infected') return 'none';
	return p.alpha ? 'alpha' : 'infected';
}

/** Kill feed text of an infection. */
export function infectText(victim: string, by: string | null, method: InfMethod): string {
	if (by === null) return `${victim} turned`;
	const how = method === 'bank' ? 'bank-shot knife' : method === 'knife' ? 'throwing knife' : method === 'gun' ? 'gun' : 'claws';
	return `${by} · ${how} › ${victim}`;
}

/** Step a flying knife by `dt` seconds (gravity only; the server sends bounces and sticks). */
export function stepKnife(k: { x: number; y: number; z: number; vx: number; vy: number; vz: number }, dt: number): void {
	k.x += k.vx * dt;
	k.y += k.vy * dt;
	k.z += k.vz * dt - 0.5 * INF_KNIFE_GRAVITY * dt * dt;
	k.vz -= INF_KNIFE_GRAVITY * dt;
}

export class InfectedClient {
	private readonly solo: boolean;
	private state: InfStateView | null = null;
	private stateAt = 0;
	/** Local round clock end (bumped by +20 s infections before the next state). */
	private endsAt = 0;
	private phase: InfectedView['phase'];
	private round = 0;
	private loadout: WeaponId = INF_PRESETS[0]!;
	/** Round preset gun (survivors and the Alpha); ammo only from server events. */
	private primaryWs: WeaponState;
	/** Pistol (slot 2): its own magazine and reserve. */
	private secondaryWs = new WeaponState(INF_SECONDARY);
	/** Knife (survivors, Alpha) or claws (infected). */
	private meleeWs = new WeaponState('knife');
	private ws: WeaponState;
	private team: InfTeam = 'survivor';
	private alpha = false;
	private hp = INF_SURVIVOR_HP;
	private alive = true;
	private hasKnife = false;
	/** Local throw or pickup time (stale state grace). */
	private knifeAt = -Infinity;
	private respawnAt = 0;
	private slowUntil = 0;
	private slowStacks = 0;
	private fireHeld = false;
	private firePressAt = -Infinity;
	private throwPending = false;
	private scoped = false;
	private hitMarker: InfectedView['hitMarker'] = null;
	private feed: KillFeedLine[] = [];
	private feedId = 0;
	private flash: InfectedView['flash'] = null;
	private timeBonusAt = 0;
	private scavengerAt = 0;
	private hurtAt = 0;
	private uavAt = 0;
	private summary: InfectedView['summary'] = null;
	/** Distance from me to the latest UAV ping (infected), null when unknown. */
	private uavDist: number | null = null;
	/** Last eye position from `tick` (UAV distance). */
	private eye: Vec3 | null = null;
	/** Last feet origin from `tick` (beacon distance). */
	private feet: Vec3 | null = null;
	/** Spectating (free-fly or a target): local input and first-person visuals are off. */
	private spectating = false;
	private specId: number | null = null;
	private knives = new Map<number, LocalKnife>();
	private knifeList: KnifeRenderPose[] = [];
	/** Planted respawn beacons by beacon id (state + events). */
	private beacons = new Map<number, BeaconRenderPose>();
	private beaconList: BeaconRenderPose[] = [];
	/** My respawn beacon is planted. */
	private hasBeacon = false;
	/** Earliest local time of the next placement request (mirrors the server cooldown). */
	private nextBeaconAt = 0;
	/** Survivor kill streak this life and the perks it unlocked. */
	private streak = 0;
	private perks: InfPerkId[] = [];
	/** A M.O.A.B. is earned and not called yet. */
	private moabReady = false;
	/** A called M.O.A.B.: caller and local detonation time. */
	private moab: { callerId: number; endsAt: number } | null = null;
	private moabDetonatedAt = 0;
	private perkFlash: InfectedView['perkFlash'] = null;
	private lastFrame = 0;
	private viewKey = '';
	private view: InfectedView | null = null;

	constructor(
		private readonly host: InfHost,
		now: number,
		/** Map collision for cosmetic tracer length (optional in tests). */
		private readonly world: Pick<CollisionWorld, 'trace'> | null = null
	) {
		this.solo = !host.online();
		this.phase = this.solo ? 'solo' : 'waiting';
		this.primaryWs = new WeaponState(this.loadout);
		limitAmmo(this.primaryWs);
		limitAmmo(this.secondaryWs);
		this.ws = this.primaryWs;
		this.lastFrame = now;
		this.host.zombieRenderer()?.setWeapon(this.ws.weapon);
	}

	get me(): number {
		return this.host.selfId();
	}

	get isSolo(): boolean {
		return this.solo;
	}

	get weapon(): WeaponId {
		return this.ws.weapon;
	}

	get isInfected(): boolean {
		return this.team === 'infected';
	}

	get isAlpha(): boolean {
		return this.alpha;
	}

	get knifeReady(): boolean {
		return this.hasKnife;
	}

	get beaconPlanted(): boolean {
		return this.hasBeacon;
	}

	get isSpectating(): boolean {
		return this.spectating;
	}

	/** Earned M.O.A.B. waiting to be called. */
	get moabAvailable(): boolean {
		return this.moabReady;
	}

	/** Active kill streak perks (survivors). */
	get activePerks(): readonly InfPerkId[] {
		return this.perks;
	}

	private has(perk: InfPerkId): boolean {
		return this.team === 'survivor' && this.perks.includes(perk);
	}

	/** Sleight of hand: reload duration factor. */
	private get reloadFactor(): number {
		return this.has('sleight') ? INF_SLEIGHT_RELOAD_FACTOR : 1;
	}

	/** Specialist: wait-between-shots factor. */
	private get cadenceFactor(): number {
		return this.has('specialist') ? INF_SPECIALIST_CADENCE_FACTOR : 1;
	}

	/** Steady aim: spread factor (aim spread and shotgun pellets). */
	private get spreadFactor(): number {
		return this.has('steady') ? INF_STEADY_SPREAD_FACTOR : 1;
	}

	/**
	 * game.ts, every frame: spectating (free-fly or `targetId`) hides the local
	 * viewmodel, scope and hurt feedback and ignores local weapon input; the HUD
	 * shows the target's role, HP, score and weapon instead.
	 */
	setSpectate(spectating: boolean, targetId: number | null): void {
		const id = spectating ? targetId : null;
		if (spectating === this.spectating && id === this.specId) return;
		this.spectating = spectating;
		this.specId = id;
		if (spectating) {
			this.setScoped(false);
			this.fireHeld = false;
			this.firePressAt = -Infinity;
			this.throwPending = false;
		}
	}

	/** Down: no movement while waiting to respawn. */
	get down(): boolean {
		return !this.alive;
	}

	/** No server round: game.ts handles fall-outs (the server skips them while waiting). */
	get localFallouts(): boolean {
		return this.solo || this.phase === 'waiting';
	}

	/** Player max speed: claws speed, or the held weapon (CS-style weapon speed); hit slows. */
	maxSpeed(now = performance.now()): number {
		const slow = zmSlowFactor(now < this.slowUntil ? this.slowStacks : 0);
		if (this.team === 'infected' && !this.alpha) return INF_INFECTED_SPEED * slow;
		const steady = this.has('steady') ? INF_STEADY_SPEED_FACTOR : 1;
		return WEAPONS[this.ws.weapon].moveSpeed * steady * slow;
	}

	/** Remote player role (look and name tag). */
	roleOf(id: number): InfRole {
		return infRole(this.state?.players.find((p) => p.id === id));
	}

	/** Remote players not in play (respawning) are hidden. */
	isDown(id: number): boolean {
		return this.state?.players.some((p) => p.id === id && !p.alive) ?? false;
	}

	private get playing(): boolean {
		return this.phase === 'playing';
	}

	/** Survivors and the Alpha swap guns; infected only have claws. */
	private get armed(): boolean {
		return this.team === 'survivor' || this.alpha;
	}

	// ---------------------------------------------------------------------
	// Input

	press(action: 'attack' | 'attack2', down: boolean, now: number): void {
		if (this.spectating) return;
		if (action === 'attack') {
			this.fireHeld = down;
			if (down) this.firePressAt = now;
			return;
		}
		if (!down || !this.alive) return;
		if (this.team === 'infected' && this.hasKnife && this.playing) {
			this.throwPending = true;
			return;
		}
		const zoom = WEAPONS[this.ws.weapon].zoomFov;
		this.setScoped(zoom !== null && !this.scoped);
	}

	private setScoped(on: boolean): void {
		if (on === this.scoped) return;
		this.scoped = on;
		this.host.setZoom(on ? WEAPONS[this.ws.weapon].zoomFov : null);
	}

	/**
	 * Keys 1-4: [1] round preset, [2] pistol, [3] knife, [4] call an earned
	 * M.O.A.B. (same as N). Returns false when the key should go to the map vote.
	 */
	slot(n: number, now: number): boolean {
		if (this.host.voteOpen() || this.spectating) return false;
		if (n === 4) {
			if (this.moabReady) this.callMoab(now);
			return true;
		}
		if (!this.alive || !this.armed || this.meleeWs.weapon !== 'knife') return true;
		const want = n === 1 ? this.primaryWs : n === 2 ? this.secondaryWs : n === 3 ? this.meleeWs : null;
		if (!want || want === this.ws) return true;
		this.hold(want);
		if (!this.solo) this.host.send({ type: 'loadout', weapon: want.weapon });
		return true;
	}

	/** Swap the held weapon (a swap cancels a reload, like the server). */
	private hold(next: WeaponState): void {
		if (next === this.ws) return;
		this.ws.reloadEndsAt = 0;
		this.ws = next;
		this.setScoped(false);
		this.host.zombieRenderer()?.setWeapon(next.weapon);
	}

	reload(now: number): void {
		if (this.spectating || !this.alive) return;
		if (this.ws !== this.primaryWs && this.ws !== this.secondaryWs) return;
		if (!this.ws.startReload(now, this.reloadFactor)) return;
		this.setScoped(false);
		this.host.sound('reload');
		if (!this.solo) this.host.send({ type: 'reload' });
	}

	/**
	 * E: plant a respawn beacon at my feet (living infected, round playing).
	 * The server checks ground and cooldown and answers with `beaconPlace`.
	 * Returns whether a request was sent.
	 */
	placeBeacon(now: number): boolean {
		if (this.solo || this.spectating || !this.alive || this.team !== 'infected' || !this.playing) return false;
		if (now < this.nextBeaconAt) return false;
		this.nextBeaconAt = now + INF_BEACON_COOLDOWN_MS;
		this.host.send({ type: 'placeBeacon' });
		return true;
	}

	/**
	 * N or 4 (`moab`): call the earned M.O.A.B. (living survivor, round
	 * playing, none inbound). Optimistic: the ready badge goes at once; a
	 * rejected call comes back with the next state. Returns whether it was sent.
	 */
	callMoab(_now: number): boolean {
		if (this.solo || this.spectating || !this.alive || this.team !== 'survivor' || !this.playing) return false;
		if (!this.moabReady || this.moab) return false;
		this.moabReady = false;
		this.host.send({ type: 'callMoab' });
		return true;
	}

	// ---------------------------------------------------------------------
	// Simulation tick (64 Hz, after the local player moved)

	tick(now: number, origin: Vec3, eyeZ: number, pitch: number, yaw: number, _ducked: boolean): void {
		this.primaryWs.update(now);
		this.secondaryWs.update(now);
		this.eye = { x: origin.x, y: origin.y, z: eyeZ };
		this.feet = { x: origin.x, y: origin.y, z: origin.z };
		if (!this.alive || this.spectating) {
			this.fireHeld = false;
			this.throwPending = false;
			return;
		}
		const eye = { x: origin.x, y: origin.y, z: eyeZ };
		if (this.throwPending) {
			this.throwPending = false;
			if (this.team === 'infected' && this.hasKnife && this.playing) this.throwKnife(now, eye, pitch, yaw);
		}
		if (this.solo || this.phase === 'waiting') return;
		const def = WEAPONS[this.ws.weapon];
		const want = (this.fireHeld && def.automatic) || now - this.firePressAt < FIRE_BUFFER_MS;
		if (!want) return;
		if (!this.ws.melee && this.ws.mag <= 0) {
			this.firePressAt = -Infinity;
			if (!this.ws.reloading(now)) this.reload(now);
			return;
		}
		if (!this.ws.fire(now, this.cadenceFactor)) return;
		this.firePressAt = -Infinity;
		this.shoot(now, eye, pitch, yaw);
		// Bolt action: unscope after the shot. The semi-auto Barrett stays scoped (Mouse2 toggles).
		if (this.ws.weapon === 'sniper') this.setScoped(false);
	}

	private throwKnife(now: number, eye: Vec3, pitch: number, yaw: number): void {
		this.hasKnife = false;
		this.knifeAt = now;
		this.setScoped(false);
		this.host.zombieRenderer()?.thrown(now);
		this.host.sound('throw');
		this.host.send({ type: 'throwKnife', origin: eye, dir: forwardDir(pitch, yaw) });
	}

	private shoot(now: number, eye: Vec3, pitch: number, yaw: number): void {
		const def = WEAPONS[this.ws.weapon];
		const fwd = forwardDir(pitch, yaw);
		const spread = this.spreadFactor;
		const dir = spreadDir(fwd, (this.scoped ? def.scopedSpread : def.spread) * spread);
		const r = this.host.zombieRenderer();
		r?.fired(now);
		this.host.sound(def.id === 'knife' || def.id === 'claws' ? def.id : (`shot-${def.id}` as InfSound));
		if (def.magazine > 0 && r) {
			// Cosmetic tracers from the muzzle to the first wall (players are resolved by the server).
			// Shotguns: the centre pellet plus a scatter within the (steady-aim tightened) pellet cone.
			const yr = (yaw * Math.PI) / 180;
			const muzzle = { x: eye.x + fwd.x * 18 + Math.sin(yr) * 7, y: eye.y + fwd.y * 18 - Math.cos(yr) * 7, z: eye.z + fwd.z * 18 - 6 };
			const n = pelletTracers(def.id);
			const cone = (def.pelletSpread ?? 0) * spread;
			for (let i = 0; i < n; i++) {
				const d = i === 0 ? dir : spreadDir(dir, cone);
				const end = { x: eye.x + d.x * def.range, y: eye.y + d.y * def.range, z: eye.z + d.z * def.range };
				const t = (this.world?.trace(eye, end, ZERO, ZERO).fraction ?? 1) * def.range;
				r.tracer(muzzle, { x: eye.x + d.x * t, y: eye.y + d.y * t, z: eye.z + d.z * t }, now);
			}
		}
		this.host.send({ type: 'fire', weapon: def.id, origin: eye, dir, tick: INF_FIRE_TICK_NOW });
	}

	// ---------------------------------------------------------------------
	// Server input

	onModeState(m: InfStateView, now: number): void {
		if (this.solo) return;
		this.state = m;
		this.stateAt = now;
		this.phase = m.phase;
		this.round = m.round;
		this.loadout = m.loadout;
		this.endsAt = m.phase === 'waiting' ? 0 : now + m.timeLeft * 1000;
		if (m.phase !== 'ended') this.summary = null;
		const me = m.players.find((p) => p.id === this.me);
		if (me) {
			this.hp = me.hp;
			if (me.team !== this.team || me.alpha !== this.alpha) this.setRole(me.team, me.alpha, me.weapon);
			if (me.alive !== this.alive) {
				this.alive = me.alive;
				if (!me.alive) {
					this.setScoped(false);
					if (this.respawnAt <= now) this.respawnAt = now + INF_RESPAWN_SECS * 1000;
				}
			}
			if (me.hasKnife !== this.hasKnife && now - this.knifeAt > KNIFE_GRACE_MS) this.hasKnife = me.hasKnife;
			this.hasBeacon = me.hasBeacon;
			this.streak = me.streak;
			if (!samePerks(this.perks, me.perks)) this.perks = [...me.perks];
			this.moabReady = me.moabReady;
		}
		const mb = m.moab;
		if (!mb) this.moab = null;
		// Anchored once per call: the state's timeLeft is rounded (re-anchoring jitters).
		else if (!this.moab || this.moab.callerId !== mb.callerId) this.moab = { callerId: mb.callerId, endsAt: now + mb.timeLeft * 1000 };
		this.syncKnives(m.knives, now);
		this.syncBeacons(m.beacons ?? []);
	}

	/** Beacons from the state replace the local set (events keep it current in between). */
	private syncBeacons(list: readonly InfBeaconView[]): void {
		this.beacons.clear();
		for (const b of list) this.beacons.set(b.id, { id: b.id, ownerId: b.ownerId, x: b.x, y: b.y, z: b.z, yaw: b.yaw });
	}

	/** Drop every beacon (round reset, map switch). */
	private clearBeacons(): void {
		this.beacons.clear();
		this.beaconList.length = 0;
		this.hasBeacon = false;
	}

	/** My planted beacon, if any. */
	private myBeacon(): BeaconRenderPose | null {
		for (const b of this.beacons.values()) if (b.ownerId === this.me) return b;
		return null;
	}

	/** Knives from the state: add unknown ones, drop missing ones, snap only on a large error. */
	private syncKnives(list: readonly InfKnifeView[], now: number): void {
		const seen = new Set<number>();
		for (const k of list) {
			seen.add(k.id);
			const local = this.knives.get(k.id);
			if (!local || k.stuck !== local.stuck || Math.hypot(k.x - local.x, k.y - local.y, k.z - local.z) > KNIFE_SNAP_DIST) {
				this.knives.set(k.id, { ...k, at: now });
			}
		}
		for (const [id, k] of this.knives) if (!seen.has(id) && now - k.at > KNIFE_KEEP_MS) this.knives.delete(id);
	}

	/** Team/role change from the state (missed events): equip what the server says is held. */
	private setRole(team: InfTeam, alpha: boolean, weapon: WeaponId): void {
		this.team = team;
		this.alpha = team === 'infected' && alpha;
		if (team === 'infected') this.clearStreak();
		if (weapon === 'claws') this.holdClaws();
		else this.hold(this.slotFor(weapon));
	}

	/**
	 * The slot that holds `weapon` (knife → melee, pistol → secondary, else the
	 * primary), re-equipped with mode ammo when it held something else.
	 */
	private slotFor(weapon: WeaponId): WeaponState {
		const ws = weapon === 'knife' || weapon === 'claws' ? this.meleeWs : weapon === INF_SECONDARY ? this.secondaryWs : this.primaryWs;
		if (ws.weapon !== weapon) {
			ws.equip(weapon);
			limitAmmo(ws);
		}
		return ws;
	}

	/** Fresh pistol (the server hands out fresh guns: survivor round/join spawns, the Alpha). */
	private freshSecondary(): void {
		this.secondaryWs.equip(INF_SECONDARY);
		limitAmmo(this.secondaryWs);
	}

	/** Kill streak, perks and an uncalled M.O.A.B. end with the survivor life. */
	private clearStreak(): void {
		this.streak = 0;
		if (this.perks.length) this.perks = [];
		this.moabReady = false;
	}

	private holdClaws(): void {
		if (this.meleeWs.weapon !== 'claws') {
			this.meleeWs.equip('claws');
			if (this.ws === this.meleeWs) this.host.zombieRenderer()?.setWeapon('claws');
		}
		this.primaryWs.reloadEndsAt = 0;
		this.secondaryWs.reloadEndsAt = 0;
		this.hold(this.meleeWs);
	}

	/** Become an infected (in place): claws, throwing knife, infected HP. */
	private turn(now: number, text: string): void {
		this.team = 'infected';
		this.alpha = false;
		this.alive = true;
		this.hasKnife = true;
		this.knifeAt = now;
		this.hp = INF_INFECTED_HP;
		this.slowUntil = 0;
		this.clearStreak();
		this.holdClaws();
		this.flash = { text, at: now, tone: 'infected' };
	}

	onEvent(ev: InfEvent, now: number): void {
		if (!this.solo) this.apply(ev, now);
	}

	private name(id: number | null): string {
		if (id === null) return '';
		return id === this.me ? 'You' : this.host.name(id);
	}

	private line(text: string, mine: boolean, head: boolean, now: number): void {
		this.feed = pushKillFeed(this.feed, { id: ++this.feedId, text, head, mine, at: now }, now);
	}

	private apply(ev: InfEvent, now: number): void {
		const me = this.me;
		const r = this.host.zombieRenderer();
		switch (ev.e) {
			case 'phase':
				this.phase = ev.phase;
				this.round = ev.round;
				this.loadout = ev.loadout;
				if (this.state) this.state = { ...this.state, phase: ev.phase, round: ev.round, loadout: ev.loadout };
				// The server drops a running M.O.A.B. on every phase change (no event for that).
				this.moab = null;
				if (ev.phase === 'grace') {
					this.moabDetonatedAt = 0;
					this.perkFlash = null;
					this.clearStreak();
					this.feed = [];
					this.summary = null;
					this.knives.clear();
					this.clearBeacons();
					this.nextBeaconAt = 0;
					this.uavAt = 0;
					this.uavDist = null;
					this.slowUntil = 0;
					this.slowStacks = 0;
					this.hurtAt = 0;
					this.hitMarker = null;
					this.timeBonusAt = 0;
					this.scavengerAt = 0;
					this.host.infectedRenderer()?.clear();
					this.flash = { text: `Round ${ev.round} · ${WEAPONS[ev.loadout].label} · find a holdout`, at: now, tone: 'survivor' };
					this.host.sound('round');
				} else if (ev.phase === 'playing') {
					if (!this.flash || now - this.flash.at > 200) this.flash = { text: 'Patient Zero is loose!', at: now, tone: 'infected' };
				} else if (ev.phase === 'waiting') {
					this.knives.clear();
					this.clearBeacons();
					this.summary = null;
				} else if (ev.phase === 'ended') {
					this.knives.clear();
					this.clearBeacons();
				}
				break;
			case 'spawn': {
				if (ev.id !== me) break;
				this.host.teleport(ev.x, ev.y, ev.z, ev.yaw);
				this.hp = ev.hp;
				this.alive = true;
				this.respawnAt = 0;
				this.team = ev.team;
				this.alpha = ev.team === 'infected' && ev.alpha;
				this.hasKnife = ev.hasKnife;
				this.knifeAt = now;
				this.slowUntil = 0;
				this.setScoped(false);
				// A fall-out keeps the life (streak, perks, ammo); every other spawn starts a fresh one.
				if (ev.reason !== 'fall') this.clearStreak();
				// Fresh guns like the server: survivor round/join spawns, and every Alpha (re)spawn.
				if (ev.reason !== 'fall' && (ev.team === 'survivor' || ev.alpha)) this.freshSecondary();
				if (ev.weapon === 'claws') this.holdClaws();
				else {
					const ws = this.slotFor(ev.weapon);
					if (!ws.melee) {
						ws.mag = ev.mag;
						ws.reserve = ev.reserve;
						ws.reloadEndsAt = 0;
					}
					if (this.meleeWs.weapon !== 'knife' && this.team === 'survivor') this.meleeWs.equip('knife');
					this.hold(ws);
				}
				if (ev.reason === 'respawn') this.flash = { text: 'Respawned · hunt the survivors', at: now, tone: 'infected' };
				else if (ev.reason === 'beacon') {
					this.hasBeacon = false;
					this.flash = { text: 'Respawned at your beacon!', at: now, tone: 'bonus' };
				}
				r?.setWeapon(this.ws.weapon);
				break;
			}
			case 'alpha':
				if (ev.id === me) {
					this.team = 'infected';
					this.alpha = true;
					this.hasKnife = true;
					this.knifeAt = now;
					this.hp = INF_INFECTED_HP;
					this.clearStreak();
					this.freshSecondary();
					if (this.meleeWs.weapon !== 'knife') this.meleeWs.equip('knife');
					this.flash = { text: 'You are Patient Zero · infect a survivor', at: now, tone: 'infected' };
				} else {
					this.flash = { text: `${this.host.name(ev.id)} is Patient Zero · run!`, at: now, tone: 'survivor' };
				}
				this.line(`${this.name(ev.id)} · Patient Zero`, ev.id === me, false, now);
				this.host.sound('alpha');
				break;
			case 'infect': {
				if (ev.timeAdded > 0) {
					this.timeBonusAt = now;
					if (this.endsAt > 0) this.endsAt += ev.timeAdded * 1000;
				}
				if (ev.id === me) {
					const by = ev.by === null ? null : this.host.name(ev.by);
					this.turn(now, by ? `Infected by ${by} · hunt the survivors` : 'You turned · hunt the survivors');
				} else if (ev.by === me) {
					this.flash = { text: `You infected ${this.host.name(ev.id)}`, at: now, tone: 'bonus' };
				}
				const victim = this.name(ev.id).replace(/^You$/, 'you');
				const by = ev.by === null ? null : this.name(ev.by);
				this.line(infectText(victim, by, ev.method), ev.by === me, false, now);
				if (by !== null && (ev.method === 'knife' || ev.method === 'bank')) this.feed[0]!.badge = { kind: ev.method, by, victim };
				break;
			}
			case 'hit':
				if (ev.by !== me) break;
				this.hitMarker = { at: now, head: ev.head, kill: ev.kill };
				this.host.sound('hit');
				break;
			case 'kill': {
				const victim = ev.targetId === me ? 'you' : this.host.name(ev.targetId);
				this.line(`${this.name(ev.by)} · ${WEAPONS[ev.weapon].label}${ev.head ? ' · headshot' : ''} › ${victim}`, ev.by === me, ev.head, now);
				// My survivor streak counts live (perk events and the state confirm it).
				if (ev.by === me && this.team === 'survivor') this.streak++;
				if (ev.targetId === me) {
					this.alive = false;
					this.respawnAt = now + INF_RESPAWN_SECS * 1000;
					this.fireHeld = false;
					this.setScoped(false);
					this.flash = { text: `Killed by ${this.host.name(ev.by)} · respawning`, at: now, tone: 'infected' };
				}
				break;
			}
			case 'shot':
				if (ev.by === me) break;
				if (ev.len > 0) {
					const o = ev.o;
					r?.tracer({ x: o.x, y: o.y, z: o.z - 6 }, { x: o.x + ev.d.x * ev.len, y: o.y + ev.d.y * ev.len, z: o.z + ev.d.z * ev.len }, now);
				}
				this.host.sound(ev.weapon === 'knife' || ev.weapon === 'claws' ? ev.weapon : (`shot-${ev.weapon}` as InfSound), ev.o);
				break;
			case 'hurt':
				if (ev.id !== me) break;
				this.hp = ev.hp;
				this.hurtAt = now;
				this.slowStacks = ev.stacks;
				this.slowUntil = now + ZM_SLOW_MS;
				this.host.push(ev.kx, ev.ky);
				this.host.sound('hurt');
				break;
			case 'ammo':
				if (ev.id !== me || !isWeaponId(ev.weapon)) break;
				if (ev.scavenger) {
					// Names the primary or the pistol even while another slot is held: a reserve refill only.
					const ws = ev.weapon === this.primaryWs.weapon ? this.primaryWs : ev.weapon === this.secondaryWs.weapon ? this.secondaryWs : null;
					if (ws) {
						ws.reserve = ev.reserve;
						if (this.ws === ws) ws.mag = ev.mag;
					}
					this.scavengerAt = now;
					break;
				}
				if (ev.weapon === 'claws') {
					// Infected in place, or Patient Zero lost the gun (no other event for that).
					this.team = 'infected';
					this.alpha = false;
					this.clearStreak();
					this.holdClaws();
				} else {
					const ws = this.slotFor(ev.weapon);
					if (!ws.melee) {
						ws.mag = ev.mag;
						ws.reserve = ev.reserve;
					}
					if (this.meleeWs.weapon !== 'knife') this.meleeWs.equip('knife');
					this.hold(ws);
				}
				break;
			case 'knifeThrow':
				this.knives.set(ev.id, { id: ev.id, ownerId: ev.ownerId, x: ev.x, y: ev.y, z: ev.z, vx: ev.vx, vy: ev.vy, vz: ev.vz, pitch: 0, yaw: 0, stuck: false, at: now });
				if (ev.ownerId === me) {
					this.hasKnife = false;
					this.knifeAt = now;
				}
				break;
			case 'knifeBounce': {
				this.host.infectedRenderer()?.spark({ x: ev.x, y: ev.y, z: ev.z }, 'bounce', now, { x: ev.vx, y: ev.vy, z: ev.vz });
				const k = this.knives.get(ev.id);
				if (!k) break;
				Object.assign(k, { x: ev.x, y: ev.y, z: ev.z, vx: ev.vx, vy: ev.vy, vz: ev.vz, at: now });
				break;
			}
			case 'knifeStick': {
				const prev = this.knives.get(ev.id);
				// The glint backs out along the flight direction (unknown when the throw was missed).
				const dir = prev && !prev.stuck ? { x: prev.vx, y: prev.vy, z: prev.vz } : undefined;
				this.host.infectedRenderer()?.spark({ x: ev.x, y: ev.y, z: ev.z }, 'stick', now, dir);
				const k = prev ?? { id: ev.id, ownerId: ev.ownerId, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, pitch: 0, yaw: 0, stuck: true, at: now };
				Object.assign(k, { x: ev.x, y: ev.y, z: ev.z, vx: 0, vy: 0, vz: 0, pitch: ev.pitch, yaw: ev.yaw, stuck: true, at: now });
				this.knives.set(ev.id, k);
				break;
			}
			case 'knifePickup':
				this.knives.delete(ev.id);
				if (ev.ownerId === me) {
					this.hasKnife = true;
					this.knifeAt = now;
					this.flash = { text: 'Throwing knife retrieved', at: now, tone: 'infected' };
				}
				break;
			case 'knifeRemove':
				this.knives.delete(ev.id);
				break;
			case 'beaconPlace':
				this.beacons.set(ev.id, { id: ev.id, ownerId: ev.ownerId, x: ev.x, y: ev.y, z: ev.z, yaw: ev.yaw });
				if (ev.ownerId === me) {
					this.hasBeacon = true;
					this.flash = { text: 'Respawn beacon planted', at: now, tone: 'bonus' };
					this.host.sound('beacon', { x: ev.x, y: ev.y, z: ev.z });
				}
				break;
			case 'beaconDestroy':
				this.beacons.delete(ev.id);
				// Cleanups (replaced, owner left, round over) vanish quietly; a smash bursts.
				if (ev.by === null) break;
				this.host.infectedRenderer()?.spark({ x: ev.x, y: ev.y, z: ev.z + INF_BEACON_HIT_Z }, 'beacon', now);
				if (ev.by === me) {
					this.flash = { text: 'Beacon destroyed! +50', at: now, tone: 'survivor' };
					this.line(`You · Destroyed ${this.host.name(ev.ownerId)}'s beacon (+50)`, true, false, now);
				} else if (ev.ownerId === me) {
					this.hasBeacon = false;
					this.flash = { text: 'Your respawn beacon was destroyed!', at: now, tone: 'infected' };
				}
				break;
			case 'beaconUse':
				this.beacons.delete(ev.id);
				this.host.infectedRenderer()?.spark({ x: ev.x, y: ev.y, z: ev.z + INF_BEACON_HIT_Z }, 'beacon', now);
				if (ev.ownerId === me) {
					this.hasBeacon = false;
					this.flash = { text: 'Respawned at your beacon!', at: now, tone: 'bonus' };
				}
				break;
			case 'uav':
				this.uavAt = now;
				this.uavDist = this.team === 'infected' && this.eye ? Math.hypot(ev.x - this.eye.x, ev.y - this.eye.y, ev.z - this.eye.z) : null;
				if (this.team === 'infected') this.host.infectedRenderer()?.uavPulse({ x: ev.x, y: ev.y, z: ev.z }, now);
				if (this.team === 'infected' || ev.targetId === me) this.host.sound('uav');
				break;
			case 'perk':
				if (ev.id !== me) {
					if (ev.perk === 'specialist') this.line(`${this.host.name(ev.id)} · SPECIALIST`, false, false, now);
					break;
				}
				this.streak = Math.max(this.streak, ev.streak);
				this.perks = infPerksForStreak(this.streak);
				if (ev.perk === 'specialist') {
					this.hp = Math.max(this.hp, INF_SPECIALIST_HP);
					this.line('You · SPECIALIST (+250)', true, false, now);
				}
				this.perkFlash = { perk: ev.perk, at: now };
				this.flash = { text: INF_PERK_INFO[ev.perk].toast, at: now, tone: ev.perk === 'specialist' ? 'bonus' : 'survivor' };
				this.host.sound('perk');
				break;
			case 'moabReady':
				if (ev.id !== me) break;
				this.moabReady = true;
				this.flash = { text: 'M.O.A.B. READY! Press [N] to call it in', at: now, tone: 'bonus' };
				this.host.sound('moabReady');
				break;
			case 'moabCall':
				this.moab = { callerId: ev.by, endsAt: now + ev.secs * 1000 };
				if (ev.by === me) this.moabReady = false;
				this.flash = { text: 'M.O.A.B. INBOUND!', at: now, tone: 'infected' };
				this.line(`${this.name(ev.by)} · called in a M.O.A.B.`, ev.by === me, false, now);
				this.host.sound('moab');
				break;
			case 'moabDetonate':
				this.moab = null;
				this.moabDetonatedAt = now;
				this.flash = { text: `M.O.A.B. DETONATED! ${ev.kills} eliminated`, at: now, tone: 'bonus' };
				this.line(`${this.name(ev.by)} · M.O.A.B. › ${ev.kills} infected`, ev.by === me, false, now);
				if (this.team === 'infected' && this.alive) {
					// Every living infected dies (the round ends right after).
					this.alive = false;
					this.respawnAt = now + INF_RESPAWN_SECS * 1000;
					this.fireHeld = false;
					this.setScoped(false);
				}
				this.host.sound('moabDetonate');
				break;
			case 'end': {
				const top = ev.topId !== null ? `${this.name(ev.topId)} (${ev.topScore})` : null;
				this.summary = { winner: ev.winner, secs: ev.secs, survivorsLeft: ev.survivorsLeft, top };
				const won = (ev.winner === 'survivors') === (this.team === 'survivor');
				// A M.O.A.B. ends the round in the same flush: keep its detonation flash.
				if (!(this.moabDetonatedAt > 0 && now - this.moabDetonatedAt < FLASH_MS)) {
					this.flash = { text: ev.winner === 'survivors' ? 'Survivors held out!' : 'Everyone is infected!', at: now, tone: won ? 'bonus' : 'neutral' };
				}
				this.moab = null;
				this.knives.clear();
				this.clearBeacons();
				this.setScoped(false);
				this.host.sound('round');
				break;
			}
		}
	}

	// ---------------------------------------------------------------------
	// Frame

	/** Knives this frame (stepped smoothly between server events). */
	knivesNow(): readonly KnifeRenderPose[] {
		return this.knifeList;
	}

	/** Step knives, draw them and the viewmodel; returns the HUD view (same object while nothing changed). */
	frame(now: number, viewmodel: boolean, speed: number): InfectedView {
		const dt = Math.max(0, Math.min(0.1, (now - this.lastFrame) / 1000));
		this.lastFrame = now;
		this.knifeList.length = 0;
		for (const k of this.knives.values()) {
			if (!k.stuck && dt > 0) stepKnife(k, dt);
			this.knifeList.push(k);
		}
		const ir = this.host.infectedRenderer();
		ir?.syncKnives(this.knifeList, this.me, now);
		this.beaconList.length = 0;
		for (const b of this.beacons.values()) this.beaconList.push(b);
		ir?.syncBeacons(this.beaconList, this.viewId(), this.viewTeam(), now);
		const r = this.host.zombieRenderer();
		if (r) {
			r.setWeapon(this.ws.weapon);
			// Throwing knife ready in the left claw (back on pickup / respawn, gone on a throw).
			r.setOffhandKnife(this.team === 'infected' && this.ws.weapon === 'claws' && this.hasKnife && this.alive, now);
			r.updateViewmodel(now, viewmodel && !this.spectating && this.alive && !this.scoped, this.ws.reloadProgress(now), speed);
		}
		return this.buildView(now);
	}

	/** The player whose eyes the HUD and beacons follow (spectate target or me). */
	private viewId(): number {
		return this.spectating && this.specId !== null ? this.specId : this.me;
	}

	private viewTeam(): InfTeam {
		const id = this.viewId();
		if (id === this.me) return this.team;
		return this.state?.players.find((p) => p.id === id)?.team ?? 'survivor';
	}

	/** Metres from my feet to my planted beacon, null when none or my position is unknown. */
	private beaconDistance(): number | null {
		const f = this.feet;
		if (!this.hasBeacon || !f) return null;
		const b = this.myBeacon();
		if (!b) return null;
		return Math.round(Math.hypot(b.x - f.x, b.y - f.y, b.z - f.z) / UNITS_PER_M);
	}

	/** Beacons this frame (tests and debugging). */
	beaconsNow(): readonly BeaconRenderPose[] {
		return this.beaconList;
	}

	private lastSurvivor(): boolean {
		const s = this.state;
		return !!s && this.playing && this.team === 'survivor' && this.alive && s.survivors === 1 && s.infected >= 2;
	}

	private buildView(now: number): InfectedView {
		const s = this.state;
		const ws = this.ws;
		const reloading = ws.reloading(now);
		if (this.hitMarker && now - this.hitMarker.at > HIT_MS) this.hitMarker = null;
		if (this.flash && now - this.flash.at > FLASH_MS) this.flash = null;
		const feed = liveKillFeed(this.feed, now);
		if (feed.length !== this.feed.length) this.feed = feed;
		let knifeOut = false;
		if (!this.hasKnife) for (const k of this.knives.values()) if (k.ownerId === this.me) knifeOut = true;
		const me = s?.players.find((p) => p.id === this.me);
		const hasBeacon = this.team === 'infected' && this.hasBeacon;
		const beaconDist = hasBeacon ? this.beaconDistance() : null;
		const key = [
			this.phase,
			this.round,
			this.stateAt,
			this.endsAt,
			this.team,
			this.alpha,
			this.hp,
			this.alive,
			this.respawnAt,
			ws.weapon,
			ws.mag,
			ws.reserve,
			reloading,
			this.hasKnife,
			knifeOut,
			hasBeacon,
			beaconDist,
			this.hitMarker?.at,
			this.feed.length && this.feed[0]!.id,
			this.feed.length,
			this.flash?.at,
			this.timeBonusAt,
			this.scavengerAt,
			this.hurtAt,
			this.uavAt,
			this.scoped,
			this.summary ? 1 : 0,
			this.spectating,
			this.specId,
			this.secondaryWs.mag,
			this.secondaryWs.reserve,
			this.streak,
			this.perks.join(','),
			this.moabReady,
			this.moab?.callerId,
			this.moab?.endsAt,
			this.moabDetonatedAt,
			this.perkFlash?.at
		].join('|');
		if (key === this.viewKey && this.view) return this.view;
		this.viewKey = key;
		const def = WEAPONS[ws.weapon];
		this.view = {
			phase: this.phase,
			round: this.round,
			endsAt: this.phase === 'waiting' || this.phase === 'solo' ? 0 : this.endsAt,
			team: this.team,
			alpha: this.alpha,
			lastSurvivor: this.lastSurvivor(),
			loadout: this.loadout,
			loadoutLabel: WEAPONS[this.loadout].label,
			survivors: s?.survivors ?? 0,
			infected: s?.infected ?? 0,
			hp: this.hp,
			maxHp: infMaxHp(this.team, this.perks),
			alive: this.alive,
			respawnAt: this.alive ? 0 : this.respawnAt,
			weapon: ws.weapon,
			weaponLabel: def.label,
			mag: ws.mag,
			magSize: def.magazine,
			reserve: ws.reserve,
			reloadEndsAt: reloading ? ws.reloadEndsAt : 0,
			reloadMs: reloading && ws.reloadDurationMs > 0 ? ws.reloadDurationMs : def.reloadMs,
			hasKnife: this.team === 'infected' && this.hasKnife,
			knifeOut,
			hasBeacon,
			beaconDist,
			myScore: me?.score ?? 0,
			myKills: me?.kills ?? 0,
			myDeaths: me?.deaths ?? 0,
			hitMarker: this.hitMarker,
			killFeed: this.feed,
			flash: this.flash,
			timeBonusAt: this.timeBonusAt,
			scavengerAt: this.scavengerAt,
			hurtAt: this.hurtAt,
			uavAt: this.uavAt,
			scoped: this.scoped,
			summary: this.summary,
			spectating: this.spectating,
			spec: this.specView(),
			uavDist: this.uavDist,
			secondary: this.secondaryWs.weapon,
			secondaryLabel: WEAPONS[this.secondaryWs.weapon].label,
			streak: this.team === 'survivor' ? this.streak : 0,
			perks: this.team === 'survivor' ? this.perks : [],
			moabReady: this.team === 'survivor' && this.moabReady,
			moab: this.moab ? { callerName: this.name(this.moab.callerId), endsAt: this.moab.endsAt } : null,
			moabDetonatedAt: this.moabDetonatedAt,
			perkFlash: this.perkFlash
		};
		return this.view;
	}

	/** The spectated player from the latest state (null in free-fly or when unknown). */
	private specView(): InfSpecView | null {
		const id = this.specId;
		if (id === null || id === this.me) return null;
		const p = this.state?.players.find((q) => q.id === id);
		if (!p) return null;
		return {
			id,
			name: this.host.name(id),
			team: p.team,
			alpha: p.team === 'infected' && p.alpha,
			hp: p.hp,
			maxHp: infMaxHp(p.team, p.perks),
			alive: p.alive,
			score: p.score,
			weapon: p.weapon,
			weaponLabel: WEAPONS[p.weapon].label,
			hasKnife: p.team === 'infected' && p.hasKnife,
			hasBeacon: p.team === 'infected' && p.hasBeacon,
			streak: p.team === 'survivor' ? p.streak : 0,
			perks: p.team === 'survivor' ? [...p.perks] : [],
			moabReady: p.team === 'survivor' && p.moabReady
		};
	}

	/** Solo scoreboard row values. */
	soloRow(): { kills: number; deaths: number; score: number } {
		return { kills: 0, deaths: 0, score: 0 };
	}

	dispose(): void {
		this.setScoped(false);
		this.knives.clear();
		this.knifeList.length = 0;
		this.clearBeacons();
		this.host.zombieRenderer()?.setOffhandKnife(false);
		this.host.infectedRenderer()?.clear();
		this.host.zombieRenderer()?.clear();
	}
}

