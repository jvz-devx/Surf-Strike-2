/**
 * Remote-player interpolation buffer: snapshots are stamped on the server
 * monotonic timeline with per-player `NetState.tick` spacing to remove
 * 64->32 Hz aliasing and uplink jitter (docs/architecture.md#netcode).
 */
import { DUCK_HULL_MAX, FLAG_DUCKED, FLAG_TELEPORTED, HULL_MAX, HULL_MIN, INTERP_DELAY_MS, teleportSeq, TICK_RATE, type CollisionWorld, type NetState } from '@surf/shared';

/** Shared with the server's lag compensation (packages/shared protocol.ts). */
export { INTERP_DELAY_MS };
/** Max velocity extrapolation horizon (ms) when a stall outruns the interpolation buffer. */
export const MAX_EXTRAP_MS = 50;
const CAPACITY = 32;
const TICK_MS = 1000 / TICK_RATE;
const ANCHOR_WINDOW = 32;
/** Discontinuity threshold (ms) between observed `serverTime - tick*TICK_MS` and the current anchor. */
const ANCHOR_JUMP_MS = 250;
const ANCHOR_JUMP_CONFIRM = 3;
/** No sender progress across this much server time indicates a slow or paused sender. */
const SOURCE_STALL_MS = 125;

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

function medianOf(values: readonly number[]): number {
	const sorted = values.slice().sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) * 0.5;
}

interface Entry {
	t: number;
	s: NetState;
}

export class SnapshotBuffer {
	private buf: Entry[] = [];
	/** Local client arrival timestamp (ms) of the last pushed snapshot, used for visibility timeouts. */
	private lastLocalArrival = -Infinity;
	/** Per-player tick spacing state: maps `tick * TICK_MS` onto the server timeline. */
	private lastTick = -1;
	private tickProgressed = false;
	private tickAnchor = 0;
	private readonly obsWin: number[] = [];
	private obsIdx = 0;
	private obsCount = 0;
	private anchorJumpStreak = 0;
	private latestServerTime = -Infinity;
	private tickSeenAt = -Infinity;
	private slowSender = false;

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
	push(state: NetState, serverTimeMs: number, localArrivalMs = serverTimeMs): void {
		this.lastLocalArrival = localArrivalMs;
		this.latestServerTime = Math.max(this.latestServerTime, serverTimeMs);

		let sampleTime = serverTimeMs;
		if (this.lastTick < 0) {
			this.lastTick = state.tick;
			this.resetAnchor(serverTimeMs - state.tick * TICK_MS);
			this.tickSeenAt = serverTimeMs;
		} else {
			const dt = state.tick - this.lastTick;
			if (dt === 0) {
				// Keep constant-tick fixtures working until the source is old enough to be idle.
				if (this.tickProgressed || this.sourceIdle) return;
			} else if (dt < 0) {
				if (dt < -64) {
					// Sender tick counter reset (reconnect/respawn/test reset): re-anchor cleanly.
					this.lastTick = state.tick;
					this.tickSeenAt = serverTimeMs;
					this.slowSender = false;
					this.resetAnchor(serverTimeMs - state.tick * TICK_MS);
				} else {
					// Out-of-order / late tick: drop.
					return;
				}
			} else {
				this.tickProgressed = true;
				this.lastTick = state.tick;
				this.slowSender = serverTimeMs - this.tickSeenAt >= SOURCE_STALL_MS;
				this.tickSeenAt = serverTimeMs;

				const obs = serverTimeMs - state.tick * TICK_MS;
				const err = obs - this.tickAnchor;
				if (Math.abs(err) > ANCHOR_JUMP_MS) {
					this.anchorJumpStreak++;
					if (this.anchorJumpStreak >= ANCHOR_JUMP_CONFIRM || Math.abs(err) > 1000) {
						this.resetAnchor(obs);
					}
				} else {
					this.anchorJumpStreak = 0;
				}

				if (this.anchorJumpStreak === 0) {
					if (this.obsWin.length < ANCHOR_WINDOW) this.obsWin.push(obs);
					else this.obsWin[this.obsIdx] = obs;
					this.obsIdx = (this.obsIdx + 1) % ANCHOR_WINDOW;
					this.obsCount++;

					const med = medianOf(this.obsWin);
					const delta = med - this.tickAnchor;
					if (Math.abs(delta) > 0.01) {
						// Slew faster while priming the first few samples, then cap to <=5% speed skew.
						const priming = this.obsCount <= 8;
						const maxRate = priming ? 0.35 : 0.05;
						const maxStep = Math.min(priming ? 15 : 1.5, dt * TICK_MS * maxRate);
						const gain = priming ? 0.35 : 0.08;
						const step = Math.max(-maxStep, Math.min(maxStep, delta * gain));
						this.tickAnchor += step;
					}
				}
				sampleTime = this.tickAnchor + state.tick * TICK_MS;
			}
		}

		const last = this.buf[this.buf.length - 1];
		if (last && sampleTime < last.t) sampleTime = last.t;
		this.buf.push({ t: sampleTime, s: state });
		if (this.buf.length > CAPACITY) this.buf.shift();
	}

	private resetAnchor(anchor: number): void {
		this.tickAnchor = anchor;
		this.obsWin.length = 0;
		this.obsWin.push(anchor);
		this.obsIdx = 1 % ANCHOR_WINDOW;
		this.obsCount = 1;
		this.anchorJumpStreak = 0;
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
		return this.slowSender || this.latestServerTime - this.tickSeenAt >= SOURCE_STALL_MS;
	}

	clear(): void {
		this.buf.length = 0;
		this.lastLocalArrival = -Infinity;
		this.lastTick = -1;
		this.tickProgressed = false;
		this.tickAnchor = 0;
		this.obsWin.length = 0;
		this.obsIdx = 0;
		this.obsCount = 0;
		this.anchorJumpStreak = 0;
		this.latestServerTime = -Infinity;
		this.tickSeenAt = -Infinity;
		this.slowSender = false;
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
