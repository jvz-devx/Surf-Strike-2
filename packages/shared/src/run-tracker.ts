/**
 * Run tracker (docs/gameplay.md#runs-and-timer). Contract in ./run.ts.
 *
 * Zone event indices: start = 0, end = 0, stage = 2..N, checkpoint = 1..N.
 * The first `zone { kind: 'start' }` event of a run is emitted on the tick the
 * player leaves the start zone (timer start), not when entering it.
 */
import type { MapDef, Spawn, Zone } from './maps/types.ts';
import type { PlayerState } from './movement/api.ts';
import { DUCK_HULL_MAX, HULL_MAX, HULL_MIN } from './movement/api.ts';
import type { RunEvent, RunState } from './run.ts';
import { FINISH_RESET_DELAY_TICKS, PRESPEED_CAP } from './run.ts';
import type { Vec3 } from './types.ts';

interface Box {
	min: Vec3;
	max: Vec3;
}

interface RespawnZone extends Box {
	respawn: Spawn;
}

interface TeleportZone extends Box {
	to: 'stage' | 'start';
	dest?: Spawn;
}

function overlaps(origin: Vec3, maxs: Vec3, z: Box): boolean {
	return (
		origin.x + HULL_MIN.x < z.max.x &&
		origin.x + maxs.x > z.min.x &&
		origin.y + HULL_MIN.y < z.max.y &&
		origin.y + maxs.y > z.min.y &&
		origin.z + HULL_MIN.z < z.max.z &&
		origin.z + maxs.z > z.min.z
	);
}

function anyOverlap(origin: Vec3, maxs: Vec3, zones: Box[]): boolean {
	for (let i = 0; i < zones.length; i++) if (overlaps(origin, maxs, zones[i])) return true;
	return false;
}

function cloneSpawn(s: Spawn): Spawn {
	return { pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z }, yaw: s.yaw };
}

export class RunTracker {
	state: RunState;
	private readonly map: MapDef;
	private readonly staged: boolean;
	private readonly starts: Box[] = [];
	private readonly ends: Box[] = [];
	/** stage zones by index (staged maps) or checkpoint zones by index. */
	private readonly progress = new Map<number, RespawnZone[]>();
	private readonly progressKind: 'stage' | 'checkpoint';
	private readonly teleports: TeleportZone[] = [];
	private inStart = false;

	constructor(map: MapDef) {
		this.map = map;
		this.staged = map.layout === 'staged';
		this.progressKind = this.staged ? 'stage' : 'checkpoint';
		for (const z of map.zones as Zone[]) {
			if (z.type === 'start') this.starts.push(z);
			else if (z.type === 'end') this.ends.push(z);
			else if (z.type === 'teleport') this.teleports.push(z);
			else if (z.type === this.progressKind) {
				const list = this.progress.get(z.index) ?? [];
				list.push(z);
				this.progress.set(z.index, list);
			}
		}
		this.state = this.freshState();
	}

	private initialStage(): number {
		return this.staged ? 1 : 0;
	}

	private freshState(): RunState {
		return {
			phase: 'idle',
			ticks: 0,
			stage: this.initialStage(),
			splits: [],
			respawn: cloneSpawn(this.map.spawn),
			resetAt: null
		};
	}

	private resetRun(): void {
		const s = this.state;
		s.ticks = 0;
		s.stage = this.initialStage();
		s.splits = [];
		s.respawn = cloneSpawn(this.map.spawn);
		s.resetAt = null;
	}

	private teleportTo(player: PlayerState, spawn: Spawn): void {
		player.origin.x = spawn.pos.x;
		player.origin.y = spawn.pos.y;
		player.origin.z = spawn.pos.z;
		player.velocity.x = 0;
		player.velocity.y = 0;
		player.velocity.z = 0;
		player.onGround = false;
		player.groundNormalZ = 0;
	}

	/** To spawn, run reset. Returns whether the spawn lies in a start zone. */
	private toSpawn(player: PlayerState): boolean {
		this.teleportTo(player, this.map.spawn);
		this.resetRun();
		const maxs = player.ducked ? DUCK_HULL_MAX : HULL_MAX;
		this.inStart = anyOverlap(player.origin, maxs, this.starts);
		this.state.phase = this.inStart ? 'start' : 'idle';
		return this.inStart;
	}

	update(player: PlayerState, tick: number): RunEvent[] {
		const events: RunEvent[] = [];
		const s = this.state;
		const o = player.origin;
		const maxs = player.ducked ? DUCK_HULL_MAX : HULL_MAX;

		// Pending return to start after a finish. Any reset (restart, start
		// zone, teleport to start) clears resetAt, so this fires at most once.
		if (s.resetAt !== null && tick >= s.resetAt) {
			if (this.toSpawn(player)) events.push({ type: 'enterStart' });
			events.push({ type: 'teleport', reason: 'finish' });
		}

		if (s.phase === 'running') s.ticks++;

		// Start zone.
		const nowInStart = anyOverlap(o, maxs, this.starts);
		if (nowInStart) {
			if (!this.inStart) events.push({ type: 'enterStart' });
			s.phase = 'start';
			this.resetRun();
		} else if (this.inStart && s.phase === 'start') {
			const vx = player.velocity.x;
			const vy = player.velocity.y;
			const sp = Math.hypot(vx, vy);
			if (sp > PRESPEED_CAP) {
				const k = PRESPEED_CAP / sp;
				player.velocity.x = vx * k;
				player.velocity.y = vy * k;
			}
			s.phase = 'running';
			s.ticks = 0;
			events.push({ type: 'zone', kind: 'start', index: 0, tick });
		}
		this.inStart = nowInStart;

		// Next stage / checkpoint.
		if (s.phase === 'running') {
			const next = this.progress.get(s.stage + 1);
			if (next) {
				for (const z of next) {
					if (overlaps(o, maxs, z)) {
						s.stage++;
						s.splits.push(s.ticks);
						s.respawn = cloneSpawn(z.respawn);
						events.push({ type: 'zone', kind: this.progressKind, index: s.stage, tick });
						events.push({ type: 'split', index: s.stage, ticks: s.ticks });
						break;
					}
				}
			}
		}

		// End zone.
		const nowInEnd = this.ends.length > 0 && anyOverlap(o, maxs, this.ends);
		if (nowInEnd && s.phase === 'running') {
			s.phase = 'finished';
			s.resetAt = tick + FINISH_RESET_DELAY_TICKS;
			events.push({ type: 'zone', kind: 'end', index: 0, tick });
			events.push({ type: 'finish', ticks: s.ticks, splits: s.splits.slice() });
		}

		// Teleport triggers.
		for (const t of this.teleports) {
			if (!overlaps(o, maxs, t)) continue;
			if (t.dest) {
				// Fixed-destination teleporter: the run keeps going.
				this.teleportTo(player, t.dest);
				events.push({ type: 'teleport', reason: 'trigger', dest: cloneSpawn(t.dest) });
				break;
			}
			if (t.to === 'start') {
				if (this.toSpawn(player)) events.push({ type: 'enterStart' });
			} else {
				this.teleportTo(player, s.respawn);
			}
			events.push({ type: 'teleport', reason: 'trigger' });
			break;
		}

		return events;
	}

	/** !r / !restart: to spawn, timer reset. */
	restart(player: PlayerState): void {
		this.toSpawn(player);
	}

	/** !back: to current stage/checkpoint respawn (spawn if none). Timer keeps running. */
	back(player: PlayerState): void {
		this.teleportTo(player, this.state.respawn);
		const maxs = player.ducked ? DUCK_HULL_MAX : HULL_MAX;
		// Back to spawn inside the start zone: treat as being in the start zone
		// so leaving it starts a fresh run.
		if (anyOverlap(player.origin, maxs, this.starts)) {
			this.inStart = true;
			this.state.phase = 'start';
			this.resetRun();
		}
	}
}
