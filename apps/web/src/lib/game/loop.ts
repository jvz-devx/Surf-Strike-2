/**
 * Fixed-step accumulator (docs/physics.md#loop-and-determinism): 64 Hz
 * ticks (CS2 tick rate), at most `maxTicks` per frame; excess time is dropped so the
 * simulation slows down instead of spiralling.
 */
export class FixedStep {
	private acc = 0;
	readonly stepMs: number;

	constructor(
		rate: number,
		private maxTicks: number
	) {
		this.stepMs = 1000 / rate;
	}

	/** Add elapsed frame time; returns the number of ticks to run now. */
	advance(dtMs: number): number {
		if (!(dtMs > 0)) return 0;
		this.acc += Math.min(dtMs, 1000);
		let n = Math.floor(this.acc / this.stepMs);
		if (n > this.maxTicks) {
			n = this.maxTicks;
			// Drop the backlog: keep only a fraction of one step.
			this.acc = this.acc % this.stepMs;
			return n;
		}
		this.acc -= n * this.stepMs;
		return n;
	}

	/** Time (ms) accumulated past the end of the last tick run. */
	get accMs(): number {
		return this.acc;
	}

	/** Interpolation fraction between the previous and current tick (0..1). */
	get alpha(): number {
		return Math.min(1, Math.max(0, this.acc / this.stepMs));
	}

	reset(): void {
		this.acc = 0;
	}
}
