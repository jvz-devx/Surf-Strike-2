/**
 * Remote-player interpolation buffer on the server's monotonic timeline
 * (docs/architecture.md#netcode). Untimed snapshots use the sender's tick
 * spacing to remove aliasing and uplink jitter.
 */
import { DUCK_HULL_MAX, FLAG_DUCKED, FLAG_TELEPORTED, HULL_MAX, HULL_MIN, INTERP_DELAY_MS, teleportSeq, SnapshotTimeline, type CollisionWorld, type NetState, type SnapshotEntry } from '@surf/shared';

/** Shared with the server's lag compensation (packages/shared protocol.ts). */
export { INTERP_DELAY_MS };
/** Max velocity extrapolation horizon (ms) when a stall outruns the interpolation buffer. */
export const MAX_EXTRAP_MS = 90;
const CAPACITY = 32;

export interface Sample {
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	pitch: number;
	yaw: number;
	flags: number;
	status: number;
	stage: number;
	runTicks: number;
}

export function emptySample(): Sample {
	return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, pitch: 0, yaw: 0, flags: 0, status: 0, stage: 0, runTicks: 0 };
}

/** Shortest-path angle lerp in degrees. */
export function lerpAngle(a: number, b: number, t: number): number {
	let d = (b - a) % 360;
	if (d > 180) d -= 360;
	else if (d < -180) d += 360;
	return a + d * t;
}

interface Entry {
	t: number;
	s: NetState;
}

export class SnapshotBuffer {
	private buf: Entry[] = [];
	/** Local client arrival timestamp (ms) of the last pushed snapshot, used for visibility timeouts. */
	private lastLocalArrival = -Infinity;
	private readonly timeline = new SnapshotTimeline();
	private serverSourceIdle: boolean | undefined;

	/** Teleport threshold: larger jumps snap instead of interpolating. */
	snapDistance = 1024;
	/** Max linear velocity extrapolation past the newest buffered sample (ms). */
	maxExtrapMs = MAX_EXTRAP_MS;
	/** True when the last `sample` ran past the newest buffered snapshot. */
	lastUnderrun = false;
	/** How many ms the last `sample` actively extrapolated past the newest snapshot (0 when holding/frozen past cap). */
	lastExtrapMs = 0;
	/** How many ms `renderMs` exceeded the newest buffered snapshot on the last `sample`. */
	lastOverrunMs = 0;

	/**
	 * Push a remote player's state from a snapshot stamped `serverTimeMs`.
	 * Pass `localArrivalMs` when `serverTimeMs` is on the server timeline so
	 * `lastArrival` stays in the caller's local clock domain.
	 */
	push(state: Omit<SnapshotEntry, 'id'>, serverTimeMs: number, localArrivalMs = serverTimeMs): void {
		this.lastLocalArrival = localArrivalMs;
		this.serverSourceIdle = state.sourceIdle;
		const t = state.sampleTimeMs ?? this.timeline.push(state.tick, serverTimeMs, true);
		if (t === null) return;
		if (state.sampleTimeMs !== undefined) {
			const last = this.buf.at(-1);
			if (last && t <= last.t) {
				if (t === last.t) last.s = state;
				return;
			}
		}
		this.buf.push({ t, s: state });
		if (this.buf.length > CAPACITY) this.buf.shift();
	}

	get size(): number {
		return this.buf.length;
	}

	/** Local arrival timestamp (ms) of the latest snapshot containing this player. */
	get lastArrival(): number {
		return this.lastLocalArrival;
	}

	/** True when this remote player's sim tick has stopped advancing (e.g. backgrounded tab). */
	get sourceIdle(): boolean {
		return this.serverSourceIdle ?? this.timeline.sourceIdle;
	}

	clear(): void {
		this.buf.length = 0;
		this.lastLocalArrival = -Infinity;
		this.timeline.clear();
		this.serverSourceIdle = undefined;
		this.lastUnderrun = false;
		this.lastExtrapMs = 0;
		this.lastOverrunMs = 0;
	}

	/** Sample at `renderMs` (server time, already delayed). Returns false when empty. */
	sample(renderMs: number, out: Sample, world?: CollisionWorld): boolean {
		const n = this.buf.length;
		if (n === 0) {
			this.lastUnderrun = false;
			this.lastExtrapMs = 0;
			this.lastOverrunMs = 0;
			return false;
		}
		let a = this.buf[0]!;
		let b = a;
		this.lastUnderrun = false;
		this.lastExtrapMs = 0;
		this.lastOverrunMs = 0;
		let extrapSec = 0;
		if (renderMs <= a.t) {
			b = a;
		} else if (renderMs >= this.buf[n - 1]!.t) {
			a = b = this.buf[n - 1]!;
			const over = renderMs - b.t;
			if (over > 0) {
				this.lastUnderrun = true;
				this.lastOverrunMs = over;
				if (!this.sourceIdle) {
					const clamped = Math.min(over, this.maxExtrapMs);
					extrapSec = clamped / 1000;
					// Past the cap the avatar holds at the capped pose.
					this.lastExtrapMs = over <= this.maxExtrapMs ? clamped : 0;
				}
			}
		} else {
			for (let i = 1; i < n; i++) {
				if (this.buf[i]!.t >= renderMs) {
					a = this.buf[i - 1]!;
					b = this.buf[i]!;
					break;
				}
			}
		}
		const span = b.t - a.t;
		let t = span > 0 ? (renderMs - a.t) / span : 1;
		const sa = a.s;
		const sb = b.s;
		const dx = sb.x - sa.x;
		const dy = sb.y - sa.y;
		const dz = sb.z - sa.z;
		if (
			a !== b &&
			(teleportSeq(sa.flags) !== teleportSeq(sb.flags) ||
				(sb.flags & FLAG_TELEPORTED) !== 0 ||
				dx * dx + dy * dy + dz * dz > this.snapDistance * this.snapDistance)
		) {
			t = 1;
		}
		out.x = sa.x + dx * t + (extrapSec > 0 ? sb.vx * extrapSec : 0);
		out.y = sa.y + dy * t + (extrapSec > 0 ? sb.vy * extrapSec : 0);
		out.z = sa.z + dz * t + (extrapSec > 0 ? sb.vz * extrapSec : 0);
		if (world && extrapSec > 0) {
			const hull = (sb.flags & FLAG_DUCKED) !== 0 ? DUCK_HULL_MAX : HULL_MAX;
			const trace = world.trace(sb, out, HULL_MIN, hull);
			const end = trace.startsolid ? sb : trace.endpos;
			out.x = end.x;
			out.y = end.y;
			out.z = end.z;
		}
		out.vx = sa.vx + (sb.vx - sa.vx) * t;
		out.vy = sa.vy + (sb.vy - sa.vy) * t;
		out.vz = sa.vz + (sb.vz - sa.vz) * t;
		out.pitch = sa.pitch + (sb.pitch - sa.pitch) * t;
		out.yaw = lerpAngle(sa.yaw, sb.yaw, t);
		const disc = t < 0.5 ? sa : sb;
		out.flags = disc.flags;
		out.status = disc.status;
		out.stage = disc.stage;
		out.runTicks = Math.round(sa.runTicks + (sb.runTicks - sa.runTicks) * t);
		// Drop entries no longer needed (keep one before renderMs).
		let drop = 0;
		while (drop + 1 < this.buf.length - 1 && this.buf[drop + 1]!.t <= renderMs) drop++;
		if (drop > 0) this.buf.splice(0, drop);
		return true;
	}
}
