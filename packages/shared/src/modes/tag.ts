/**
 * Tag rules (docs/modes.md#tag). Pure and clock-injected: the server runs one
 * `TagGame` per tag map and feeds it the latest player positions at
 * TAG_TICK_HZ; tests drive it with a fake clock.
 *
 * Round flow: waiting (< 2 players, free roam) → countdown (5 s) → playing
 * (3:00) → countdown → playing ... Leaving below 2 players at any point goes
 * back to waiting.
 */
import type { MapDef, Spawn } from '../maps/types.ts';
import { DUCK_HULL_MAX, HULL_MAX, HULL_MIN } from '../movement/api.ts';
import type { AABB, Vec3 } from '../types.ts';

export const TAG_ROUND_SECS = 180;
/** Pause between rounds (and before the first round once 2 players are in). */
export const TAG_INTERMISSION_SECS = 5;
/** The previous IT cannot be tagged for this long after tagging someone. */
export const TAG_IMMUNITY_SECS = 3;
/** Max horizontal distance between player origins that counts as touching. */
export const TAG_RANGE = 40;
/** From this many players, two players are IT each round. */
export const TAG_TWO_IT_PLAYERS = 8;
export const TAG_MIN_PLAYERS = 2;
/** How often the server checks for tags. */
export const TAG_TICK_HZ = 32;
/** Players shown in the round-end announcement. */
export const TAG_PODIUM = 3;

export type TagPhase = 'waiting' | 'countdown' | 'playing';

/** Feet origin (Source convention) and duck state of a player. */
export interface TagPos {
	x: number;
	y: number;
	z: number;
	ducked: boolean;
}

export interface TagScore {
	id: number;
	/** Seconds not being IT this round. */
	score: number;
}

export type TagEvent =
	| { type: 'waiting'; cancelled: boolean } // dropped below the minimum (cancelled = a round was running)
	| { type: 'countdown'; endsAt: number }
	| { type: 'roundStart'; round: number; it: number[]; endsAt: number }
	| { type: 'tag'; by: number; target: number }
	| { type: 'newIt'; id: number } // an IT left; a runner took over
	| { type: 'roundEnd'; round: number; ranking: TagScore[] };

/** Hull height for a pose. */
function hullHeight(p: TagPos): number {
	return p.ducked ? DUCK_HULL_MAX.z : HULL_MAX.z;
}

/** Hulls touch: horizontal origin distance ≤ range and the vertical extents overlap. */
export function tagTouch(a: TagPos, b: TagPos, range = TAG_RANGE): boolean {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	if (dx * dx + dy * dy > range * range) return false;
	return a.z <= b.z + hullHeight(b) && b.z <= a.z + hullHeight(a);
}

/** The player hull at feet origin `o` overlaps box `b` (teleport triggers). */
export function hullInBox(o: Vec3, ducked: boolean, b: AABB): boolean {
	const top = ducked ? DUCK_HULL_MAX.z : HULL_MAX.z;
	return (
		o.x + HULL_MIN.x < b.max.x &&
		o.x + HULL_MAX.x > b.min.x &&
		o.y + HULL_MIN.y < b.max.y &&
		o.y + HULL_MAX.y > b.min.y &&
		o.z + HULL_MIN.z < b.max.z &&
		o.z + top > b.min.z
	);
}

/** Tag spawn points of a map (`spawns`, else the single `spawn`). */
export function tagSpawns(map: Pick<MapDef, 'spawn' | 'spawns'>): Spawn[] {
	return map.spawns && map.spawns.length > 0 ? map.spawns : [map.spawn];
}

/** A random tag spawn point. */
export function randomSpawn(map: Pick<MapDef, 'spawn' | 'spawns'>, rng: () => number = Math.random): Spawn {
	const list = tagSpawns(map);
	return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;
}

/** How many players are IT at round start. */
export function itCount(players: number): number {
	return players >= TAG_TWO_IT_PLAYERS ? 2 : 1;
}

export interface TagGameOptions {
	now: number; // ms
	rng?: () => number;
	roundSecs?: number;
	intermissionSecs?: number;
	immunitySecs?: number;
	range?: number;
	minPlayers?: number;
}

interface TagPlayer {
	scoreMs: number;
	it: boolean;
	immuneUntil: number;
}

export class TagGame {
	phase: TagPhase = 'waiting';
	round = 0;
	/** ms: round end while playing, round start while counting down, 0 while waiting. */
	endsAt = 0;
	private readonly players = new Map<number, TagPlayer>();
	private readonly rng: () => number;
	private readonly roundMs: number;
	private readonly intermissionMs: number;
	private readonly immunityMs: number;
	private readonly range: number;
	private readonly minPlayers: number;
	private last: number;

	constructor(opts: TagGameOptions) {
		this.rng = opts.rng ?? Math.random;
		this.roundMs = (opts.roundSecs ?? TAG_ROUND_SECS) * 1000;
		this.intermissionMs = (opts.intermissionSecs ?? TAG_INTERMISSION_SECS) * 1000;
		this.immunityMs = (opts.immunitySecs ?? TAG_IMMUNITY_SECS) * 1000;
		this.range = opts.range ?? TAG_RANGE;
		this.minPlayers = opts.minPlayers ?? TAG_MIN_PLAYERS;
		this.last = opts.now;
	}

	/** Ids that are IT, ascending. */
	get it(): number[] {
		const out: number[] = [];
		for (const [id, p] of this.players) if (p.it) out.push(id);
		return out.sort((a, b) => a - b);
	}

	isIt(id: number): boolean {
		return this.players.get(id)?.it ?? false;
	}

	/** Ids with tag-back immunity at `now`. */
	immune(now: number): number[] {
		const out: number[] = [];
		for (const [id, p] of this.players) if (p.immuneUntil > now) out.push(id);
		return out.sort((a, b) => a - b);
	}

	/** Seconds not being IT this round (0 for unknown ids). */
	score(id: number): number {
		return Math.round(this.players.get(id)?.scoreMs ?? 0) / 1000;
	}

	/** All players by score, best first (ties by id). */
	scores(): TagScore[] {
		return [...this.players.keys()]
			.map((id) => ({ id, score: this.score(id) }))
			.sort((a, b) => b.score - a.score || a.id - b.id);
	}

	/** Seconds until `endsAt` (0 while waiting). */
	timeLeft(now: number): number {
		return this.phase === 'waiting' ? 0 : Math.max(0, (this.endsAt - now) / 1000);
	}

	/**
	 * Advance to `now`. `active` holds every non-spectating player in the map
	 * with their latest position (null = no state received yet: counts as a
	 * player but cannot tag or be tagged).
	 */
	update(now: number, active: ReadonlyMap<number, TagPos | null>): TagEvent[] {
		const events: TagEvent[] = [];
		this.accrue(now);
		this.syncPlayers(active, events);

		if (active.size < this.minPlayers) {
			if (this.phase !== 'waiting') {
				const cancelled = this.phase === 'playing';
				this.phase = 'waiting';
				this.endsAt = 0;
				for (const p of this.players.values()) {
					p.it = false;
					p.immuneUntil = 0;
				}
				events.push({ type: 'waiting', cancelled });
			}
			return events;
		}

		if (this.phase === 'waiting') this.startCountdown(now, events);
		if (this.phase === 'countdown' && now >= this.endsAt) this.startRound(now, events);
		if (this.phase === 'playing') {
			if (now >= this.endsAt) {
				events.push({ type: 'roundEnd', round: this.round, ranking: this.scores() });
				for (const p of this.players.values()) {
					p.it = false;
					p.immuneUntil = 0;
				}
				this.startCountdown(now, events);
			} else this.checkTags(now, active, events);
		}
		return events;
	}

	/** Runners earn score for the time since the last update (up to the round end). */
	private accrue(now: number): void {
		const from = this.last;
		this.last = Math.max(this.last, now);
		if (this.phase !== 'playing') return;
		const dt = Math.min(now, this.endsAt) - from;
		if (dt <= 0) return;
		for (const p of this.players.values()) if (!p.it) p.scoreMs += dt;
	}

	private syncPlayers(active: ReadonlyMap<number, TagPos | null>, events: TagEvent[]): void {
		let lostIts = 0;
		for (const [id, p] of this.players) {
			if (active.has(id)) continue;
			if (p.it) lostIts++;
			this.players.delete(id);
		}
		for (const id of active.keys()) {
			if (!this.players.has(id)) this.players.set(id, { scoreMs: 0, it: false, immuneUntil: 0 });
		}
		if (this.phase !== 'playing' || lostIts === 0 || active.size < this.minPlayers) return;
		const runners = [...this.players.keys()].filter((id) => !this.players.get(id)!.it);
		for (let i = 0; i < lostIts && runners.length > 0; i++) {
			const id = this.pick(runners);
			this.players.get(id)!.it = true;
			events.push({ type: 'newIt', id });
		}
	}

	private startCountdown(now: number, events: TagEvent[]): void {
		this.phase = 'countdown';
		this.endsAt = now + this.intermissionMs;
		events.push({ type: 'countdown', endsAt: this.endsAt });
	}

	private startRound(now: number, events: TagEvent[]): void {
		this.phase = 'playing';
		this.round++;
		this.endsAt = now + this.roundMs;
		const ids = [...this.players.keys()];
		for (const p of this.players.values()) {
			p.scoreMs = 0;
			p.it = false;
			p.immuneUntil = 0;
		}
		const n = Math.min(itCount(ids.length), ids.length - 1);
		for (let i = 0; i < n; i++) this.players.get(this.pick(ids))!.it = true;
		events.push({ type: 'roundStart', round: this.round, it: this.it, endsAt: this.endsAt });
	}

	/** Remove and return a random element. */
	private pick(ids: number[]): number {
		const i = Math.min(ids.length - 1, Math.floor(this.rng() * ids.length));
		return ids.splice(i, 1)[0]!;
	}

	private checkTags(now: number, active: ReadonlyMap<number, TagPos | null>, events: TagEvent[]): void {
		// Snapshot: a player tagged this update cannot tag in the same update.
		for (const taggerId of this.it) {
			const tagger = this.players.get(taggerId)!;
			if (!tagger.it) continue;
			const a = active.get(taggerId);
			if (!a) continue;
			let best: number | null = null;
			let bestD = Infinity;
			for (const [id, p] of this.players) {
				if (p.it || p.immuneUntil > now) continue;
				const b = active.get(id);
				if (!b || !tagTouch(a, b, this.range)) continue;
				const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
				if (d < bestD || (d === bestD && best !== null && id < best)) {
					best = id;
					bestD = d;
				}
			}
			if (best === null) continue;
			tagger.it = false;
			tagger.immuneUntil = now + this.immunityMs;
			this.players.get(best)!.it = true;
			events.push({ type: 'tag', by: taggerId, target: best });
		}
	}
}
