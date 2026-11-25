/**
 * Infected practice range (docs/modes.md#infected). Without a round (offline,
 * or online while the server waits for a second player) the local player can
 * still try every gun: a few stationary target dummies stand at map spawns
 * and take the local shots. Client only: nothing here reaches the server.
 *
 * InfectedClient decides when it runs (`start` on the first tick without a
 * round, `stop` before the first server event of a round is applied) and
 * owns the weapon state. This module owns the targets: where they stand, what
 * a shot hits (the shared player hitboxes, resolved like the server's
 * `resolveShot`), their hit points and respawns, and their avatars in the
 * remote-player renderer.
 */
import {
	hitDamage,
	INF_AMMO,
	INF_INFECTED_HP,
	INF_MELEE_LOS_HEIGHT,
	INF_PRESETS,
	meleePlayer,
	playerUp,
	rayPlayer,
	WEAPONS,
	type CollisionWorld,
	type InfEvent,
	type PlayerPose,
	type Spawn,
	type Vec3,
	type WeaponId,
	type WeaponState
} from '@surf/shared';
import { hitFeedback, killFeedback } from './infected-feedback.js';
import type { InfHost } from './infected.js';
import { emptyPose } from '../render/players.js';
import { spreadDir } from './zombies-view.js';

type Ev<K extends InfEvent['e']> = Extract<InfEvent, { e: K }>;
type World = Pick<CollisionWorld, 'trace'>;

/** Scratch pose of the target avatars. */
const AV = emptyPose();

/** Targets on the map at most (fewer on a map with fewer spawns). */
export const PRACTICE_TARGETS = 3;
/** A killed target comes back this long after its death (ms). */
export const PRACTICE_RESPAWN_MS = 3000;
/** Targets stand at least this far from the player when they (re)spawn (units). */
export const PRACTICE_MIN_DIST = 256;
/** Name tag of a target. */
export const PRACTICE_TAG = 'TARGET';
/**
 * Target ids: -1001, -1002, ... Server player ids are 0 or more and the
 * offline self id is -1, so a target id never names a real player.
 */
export const PRACTICE_FIRST_ID = -1001;
/** A target without a free spawn tries again after this long (ms). */
const RETRY_MS = 1000;
/** The player moved this far in one tick: a teleport (fall-out, `!r`), not a run. */
const TELEPORT_DIST = 128;
/** A target this close (horizontally) to where the player was teleported makes room. */
const CLEAR_DIST = 64;

/** A spawn is in sight when the eye sees this height above it. */
const SIGHT_HEIGHT = 40;

export function practiceId(index: number): number {
	return PRACTICE_FIRST_ID - index;
}

export function isPracticeId(id: number): boolean {
	return id <= PRACTICE_FIRST_ID;
}

/** Practice key 4: the preset after `current` in INF_PRESETS, wrapping (the first one for a weapon that is no preset). */
export function nextPrimary(current: WeaponId): WeaponId {
	return INF_PRESETS[(INF_PRESETS.indexOf(current) + 1) % INF_PRESETS.length]!;
}

/** Practice never runs dry: a gun whose reserve is spent gets a fresh one. Returns whether it did. */
export function practiceRefill(ws: WeaponState): boolean {
	if (ws.melee || ws.reserve > 0) return false;
	ws.reserve = INF_AMMO[ws.weapon]?.reserve ?? ws.def.reserve;
	return ws.reserve > 0;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const END = { x: 0, y: 0, z: 0 };

/**
 * Map spawn for a target: not `taken` by another target, not `avoid` (where
 * it just died), at least PRACTICE_MIN_DIST from the player's feet, and in
 * sight of the player's eye when any such spawn is. When no free spawn is that
 * far, the farthest free one. -1 when none is free.
 */
export function pickSpawn(
	spawns: readonly Spawn[],
	taken: (index: number) => boolean,
	avoid: number,
	feet: Vec3 | null,
	eye: Vec3 | null,
	world: World | null,
	rng: () => number
): number {
	const far: number[] = [];
	let farthest = -1;
	let farthestDist = -1;
	for (let i = 0; i < spawns.length; i++) {
		if (i === avoid || taken(i)) continue;
		const p = spawns[i]!.pos;
		const d = feet ? Math.hypot(p.x - feet.x, p.y - feet.y, p.z - feet.z) : Infinity;
		if (d >= PRACTICE_MIN_DIST) far.push(i);
		if (d > farthestDist) {
			farthestDist = d;
			farthest = i;
		}
	}
	if (far.length === 0) return farthest;
	let pool = far;
	if (world && eye) {
		const seen = far.filter((i) => {
			const p = spawns[i]!.pos;
			END.x = p.x;
			END.y = p.y;
			END.z = p.z + SIGHT_HEIGHT;
			return world.trace(eye, END, ZERO, ZERO).fraction >= 1;
		});
		if (seen.length > 0) pool = seen;
	}
	return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!;
}

export interface PracticeTarget {
	readonly id: number;
	/** Feet position, yaw and posture: the hit test and the avatar share it. */
	readonly pose: Readonly<PlayerPose>;
	readonly hp: number;
	readonly alive: boolean;
	/** When a killed target comes back (ms). */
	readonly respawnAt: number;
	/** Index of the map spawn it stands on (-1: none yet). */
	readonly spawn: number;
}

interface Target {
	id: number;
	pose: PlayerPose;
	/** Chest point of the standing model (melee line of sight). */
	chest: Vec3;
	hp: number;
	alive: boolean;
	respawnAt: number;
	spawn: number;
}

/** What one trigger pull did to the targets (the hitmarker). */
export interface PracticeHit {
	head: boolean;
	kill: boolean;
}

export class InfPractice {
	private on = false;
	private readonly list: Target[] = [];
	// One trigger pull, per target index: summed damage, any head hit; one pellet: hit distance (-1: miss), head.
	private readonly dmg: number[] = [];
	private readonly head: boolean[] = [];
	private readonly at: number[] = [];
	private readonly atHead: boolean[] = [];
	private readonly result: PracticeHit = { head: false, kill: false };
	private readonly hitEv: Ev<'hit'> = { e: 'hit', by: 0, targetId: 0, head: false, kill: false };
	private readonly killEv: Ev<'kill'> = { e: 'kill', by: 0, targetId: 0, weapon: 'pistol', head: false, x: 0, y: 0, z: 0, yaw: 0 };
	/** The player's feet at the last tick (teleport check). */
	private readonly last = { x: 0, y: 0, z: 0, known: false };

	constructor(
		private readonly host: InfHost,
		private readonly world: World | null,
		private readonly rng: () => number = Math.random
	) {}

	/** The range is open (even on a map without room for targets). */
	get active(): boolean {
		return this.on;
	}

	/** The targets, living and waiting to respawn (tests and debugging). */
	targets(): readonly PracticeTarget[] {
		return this.list;
	}

	/** Open the range: targets at map spawns away from the player (`feet`, `eye`: null when unknown). */
	start(now: number, feet: Vec3 | null, eye: Vec3 | null): void {
		if (this.on) return;
		this.on = true;
		this.last.known = false;
		const spawns = this.host.spawns?.() ?? [];
		// One spawn stays free, so a killed target always has another place to come back at.
		const n = Math.max(0, Math.min(PRACTICE_TARGETS, spawns.length - 1));
		for (let i = 0; i < n; i++) {
			const t: Target = {
				id: practiceId(i),
				// Drawn holding claws at a level aim (frame()): the hit pose raises the same arms.
				pose: { x: 0, y: 0, z: 0, yaw: 0, ducked: false, hunched: true, held: 'claws', pitch: 0 },
				chest: { x: 0, y: 0, z: 0 },
				hp: 0,
				alive: false,
				respawnAt: now,
				spawn: -1
			};
			this.list.push(t);
			if (!this.place(t, spawns, feet, eye)) t.respawnAt = now + RETRY_MS;
		}
	}

	/** Close the range: the targets and their avatars go. */
	stop(): void {
		if (!this.on) return;
		this.on = false;
		const players = this.host.remotePlayers?.() ?? null;
		for (const t of this.list) players?.remove(t.id);
		this.list.length = 0;
	}

	/** Stand `t` on a free spawn, facing the player, with full hit points. False when no spawn is free. */
	private place(t: Target, spawns: readonly Spawn[], feet: Vec3 | null, eye: Vec3 | null): boolean {
		const list = this.list;
		const i = pickSpawn(spawns, (s) => list.some((o) => o !== t && o.spawn === s), t.spawn, feet, eye, this.world, this.rng);
		if (i < 0) return false;
		const s = spawns[i]!;
		const p = t.pose;
		p.x = s.pos.x;
		p.y = s.pos.y;
		p.z = s.pos.z;
		p.yaw = feet && Math.hypot(feet.x - p.x, feet.y - p.y) > 1 ? (Math.atan2(feet.y - p.y, feet.x - p.x) * 180) / Math.PI : s.yaw;
		const c = playerUp(p, INF_MELEE_LOS_HEIGHT);
		t.chest.x = c.x;
		t.chest.y = c.y;
		t.chest.z = c.z;
		t.spawn = i;
		t.hp = INF_INFECTED_HP;
		t.alive = true;
		return true;
	}

	/**
	 * Per tick: killed targets come back at another spawn, and a target makes
	 * room when the player is teleported onto its spawn (fall-out, `!r`).
	 */
	tick(now: number, feet: Vec3 | null, eye: Vec3 | null): void {
		const list = this.list;
		const last = this.last;
		const jumped = feet !== null && last.known && Math.hypot(feet.x - last.x, feet.y - last.y, feet.z - last.z) > TELEPORT_DIST;
		if (feet) {
			last.x = feet.x;
			last.y = feet.y;
			last.z = feet.z;
			last.known = true;
		}
		for (let i = 0; i < list.length; i++) {
			const t = list[i]!;
			if (t.alive) {
				if (jumped && Math.hypot(feet.x - t.pose.x, feet.y - t.pose.y) < CLEAR_DIST) this.place(t, this.host.spawns?.() ?? [], feet, eye);
				continue;
			}
			if (now < t.respawnAt) continue;
			if (!this.place(t, this.host.spawns?.() ?? [], feet, eye)) t.respawnAt = now + RETRY_MS;
		}
	}

	/**
	 * One trigger pull (or swing) of `weapon` from `eye` along the unit `dir`,
	 * resolved like the server: every pellet (the first dead-centre, the rest
	 * within `cone` degrees), the map stops bullets, a bullet passes through
	 * `pierce` targets, damage adds up per target and a headshot kills. Each
	 * target hit flashes and sounds once; a killed one collapses and is gone
	 * until it respawns. Returns what the hitmarker shows (the same object every
	 * call), or null for a miss.
	 */
	shot(now: number, eye: Vec3, dir: Vec3, weapon: WeaponId, cone: number, me: number): PracticeHit | null {
		const list = this.list;
		const n = list.length;
		const players = this.host.remotePlayers?.() ?? null;
		// `cl_hideplayers` hides the targets: nothing to hit.
		if (n === 0 || players?.isHidden) return null;
		const def = WEAPONS[weapon];
		const melee = def.magazine === 0;
		const world = this.world;
		const { dmg, head, at, atHead } = this;
		for (let i = 0; i < n; i++) {
			dmg[i] = 0;
			head[i] = false;
		}
		const pellets = melee ? 1 : Math.max(1, Math.floor(def.pellets ?? 1));
		for (let k = 0; k < pellets; k++) {
			const d = k === 0 ? dir : spreadDir(dir, cone, this.rng);
			END.x = eye.x + d.x * def.range;
			END.y = eye.y + d.y * def.range;
			END.z = eye.z + d.z * def.range;
			const worldT = (world?.trace(eye, END, ZERO, ZERO).fraction ?? 1) * def.range;
			for (let i = 0; i < n; i++) {
				const t = list[i]!;
				at[i] = -1;
				if (!t.alive) continue;
				const h = melee ? meleePlayer(eye, d, t.pose, def.range, def.coneDeg) : rayPlayer(eye, d, t.pose, worldT);
				if (!h) continue;
				if (melee && world && world.trace(eye, t.chest, ZERO, ZERO).fraction < 1) continue;
				at[i] = h.t;
				atHead[i] = h.head;
			}
			// Nearest first, as many as the bullet pierces.
			for (let taken = 0; taken < def.pierce; taken++) {
				let best = -1;
				for (let i = 0; i < n; i++) if (at[i]! >= 0 && (best < 0 || at[i]! < at[best]!)) best = i;
				if (best < 0) break;
				at[best] = -1;
				dmg[best]! += hitDamage(weapon, atHead[best]!, INF_INFECTED_HP);
				if (atHead[best]) head[best] = true;
			}
		}
		const out = this.result;
		let any = false;
		out.head = false;
		out.kill = false;
		for (let i = 0; i < n; i++) {
			if (!(dmg[i]! > 0)) continue;
			const t = list[i]!;
			t.hp = Math.max(0, t.hp - dmg[i]!);
			const kill = t.hp <= 0;
			any = true;
			if (head[i]) out.head = true;
			if (kill) out.kill = true;
			const hit = this.hitEv;
			hit.by = me;
			hit.targetId = t.id;
			hit.head = head[i]!;
			hit.kill = kill;
			hitFeedback(this.host, hit, now);
			if (!kill) continue;
			t.alive = false;
			t.respawnAt = now + PRACTICE_RESPAWN_MS;
			const ev = this.killEv;
			ev.by = me;
			ev.targetId = t.id;
			ev.weapon = weapon;
			ev.head = head[i]!;
			ev.x = t.pose.x;
			ev.y = t.pose.y;
			ev.z = t.pose.z;
			ev.yaw = t.pose.yaw;
			// The body collapses where the avatar stands; the avatar is gone at once.
			killFeedback(this.host, null, ev, me, me, eye, 'infected', now);
			players?.setPose(t.id, AV, false);
		}
		return any ? out : null;
	}

	/** Every frame: the targets' avatars (made again when a map load or reconnect cleared them). */
	frame(): void {
		const list = this.list;
		if (list.length === 0) return;
		const players = this.host.remotePlayers?.() ?? null;
		if (!players) return;
		for (let i = 0; i < list.length; i++) {
			const t = list[i]!;
			if (!players.has(t.id)) {
				players.upsert(t.id, PRACTICE_TAG);
				players.setTarget(t.id, true);
				players.setInfected(t.id, 'infected');
				players.setHeld(t.id, 'claws');
			}
			const p = t.pose;
			AV.x = p.x;
			AV.y = p.y;
			AV.z = p.z;
			AV.yaw = p.yaw;
			players.setPose(t.id, AV, t.alive);
		}
	}
}
