/** Initial RTT estimate until the first pong, in milliseconds. */
export const INITIAL_RTT_MS = 50;

const PROBE_TIMEOUT_MS = 2000;
const SAMPLE_COUNT = 3;

export class PeerRtt {
	private readonly pending = new Set<number>();
	private readonly samples: number[] = [];

	probe(now: number): number {
		for (const sentAt of this.pending) if (now - sentAt >= PROBE_TIMEOUT_MS) this.pending.delete(sentAt);
		this.pending.add(now);
		return now;
	}

	pong(echo: unknown, now: number): number | null {
		if (typeof echo !== 'number' || !this.pending.delete(echo)) return null;
		const rtt = now - echo;
		if (rtt <= 0 || rtt >= PROBE_TIMEOUT_MS) return null;

		this.samples.push(rtt);
		if (this.samples.length > SAMPLE_COUNT) this.samples.shift();
		const sorted = [...this.samples].sort((a, b) => a - b);
		return sorted[Math.floor((sorted.length - 1) / 2)]!;
	}
}
