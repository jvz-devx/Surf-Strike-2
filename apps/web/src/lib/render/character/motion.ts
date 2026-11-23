/** Velocity from positions, for characters whose velocity is not sent (ghost, AI zombies). */
import type { MotionState } from './animator.js';

/** Larger jumps are teleports, not motion. */
const MAX_STEP = 400;

export class VelocityTracker {
	private x = NaN;
	private y = 0;
	private z = 0;

	reset(): void {
		this.x = NaN;
	}

	/** Track a new position `dt` seconds after the last one; smoothed into `out`. */
	push(x: number, y: number, z: number, dt: number, out: MotionState): void {
		const dx = x - this.x;
		const dy = y - this.y;
		const dz = z - this.z;
		const ok = !Number.isNaN(this.x) && dx * dx + dy * dy + dz * dz < MAX_STEP * MAX_STEP;
		if (dt > 1e-4 || !ok) {
			const k = ok ? 1 - Math.exp(-18 * dt) : 1;
			out.vx += ((ok ? dx / dt : 0) - out.vx) * k;
			out.vy += ((ok ? dy / dt : 0) - out.vy) * k;
			out.vz += ((ok ? dz / dt : 0) - out.vz) * k;
			this.x = x;
			this.y = y;
			this.z = z;
		}
	}
}
