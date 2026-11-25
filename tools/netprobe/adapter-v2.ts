import type { Adapter, Rendered } from './adapter.ts';
import type { Sample } from '../../apps/web/src/lib/net/interp.ts';
import type { NetState, SnapshotEntry } from './wire-v1.ts';

// The probe branch still has the v1 browser checkout. Load the v2 modules
// only for a v2 endpoint and keep their compatibility types in this file.
interface SnapshotTiming {
	seqGap: number;
	transitExcessMs: number;
	arrivalGapMs: number;
}

interface BrowserClock {
	rtt: number;
	jitter: number;
	setNominalSnapHz(hz: number): void;
	seed(arrivalMs: number, serverTimeMs: number): void;
	observePong(sentMs: number, arrivalMs: number, serverTimeMs: number): number;
	observeSnapshot(arrivalMs: number, serverTimeMs: number, seq: number): SnapshotTiming & { accepted: boolean };
	serverTime(nowMs: number): number;
}

interface BrowserDelay {
	currentMs: number;
	reset(snapshotHz?: number): void;
	update(nowMs: number, dtMs: number): number;
	observeSnapshot(arrivalMs: number, timing: SnapshotTiming & { jitterMs: number; rttMs: number }): void;
	observeUnderrun(nowMs: number, overrunMs: number, rttMs: number): void;
}

interface BrowserBuffer {
	sourceIdle: boolean;
	push(state: NetState, serverTimeMs: number, arrivalMs: number): void;
	sample(serverRenderMs: number, out: Sample): boolean;
	lastArrival: number;
	lastUnderrun: boolean;
	lastOverrunMs: number;
	lastExtrapMs: number;
}

interface V2Codec {
	PROTOCOL_VERSION: number;
	encodeState(state: NetState): ArrayBuffer;
	withTeleportSeq(flags: number, count: number): number;
	decodeSnapshot(data: ArrayBuffer): { entries: SnapshotEntry[]; serverTimeMs: number; seq: number } | null;
}

export async function loadV2Adapter(): Promise<Adapter> {
	const codec = (await import('../../packages/shared/src/protocol.ts')) as unknown as V2Codec;
	if (codec.PROTOCOL_VERSION !== 2 || typeof codec.withTeleportSeq !== 'function') {
		throw new Error('Protocol v2 detected. Run netprobe in a checkout that includes the v2 game client.');
	}
	const { ServerClock } = await import(new URL('../../apps/web/src/lib/net/clock.ts', import.meta.url).href) as {
		ServerClock: new () => BrowserClock;
	};
	const { AdaptiveDelay } = await import(new URL('../../apps/web/src/lib/net/adaptive.ts', import.meta.url).href) as {
		AdaptiveDelay: new () => BrowserDelay;
	};
	const { SnapshotBuffer, emptySample } = (await import('../../apps/web/src/lib/net/interp.ts')) as unknown as {
		SnapshotBuffer: new () => BrowserBuffer;
		emptySample(): Sample;
	};
	return {
		encode(state, teleportCount) {
			return codec.encodeState({ ...state, flags: codec.withTeleportSeq(state.flags, teleportCount) });
		},
		observer(botIds) {
			const clock = new ServerClock();
			const delay = new AdaptiveDelay();
			const rendered = new Map<number, Rendered>();
			const buffers = new Map<number, BrowserBuffer>();
			const pose = emptySample();
			return {
				timingMessage(message, arrivalMs) {
					if (message.type === 'pong') {
						clock.observePong(message.t, arrivalMs, message.serverTime);
					} else {
						delay.reset(message.snapshotHz);
						if (message.snapshotHz) clock.setNominalSnapHz(message.snapshotHz);
						if (message.serverTime !== undefined) clock.seed(arrivalMs, message.serverTime);
					}
				},
				snapshot(data, arrivalMs) {
					const frame = codec.decodeSnapshot(data);
					if (!frame) return false;
					const timing = clock.observeSnapshot(arrivalMs, frame.serverTimeMs, frame.seq);
					if (!timing.accepted) return true;
					delay.observeSnapshot(arrivalMs, { ...timing, jitterMs: clock.jitter, rttMs: clock.rtt });
					for (const entry of frame.entries) {
						if (!botIds.has(entry.id)) continue;
						let buffer = buffers.get(entry.id);
						if (!buffer) buffers.set(entry.id, (buffer = new SnapshotBuffer()));
						buffer.push(entry, frame.serverTimeMs, arrivalMs);
					}
					return true;
				},
				beginFrame(nowMs, dtMs) {
					const delayMs = delay.update(nowMs, dtMs);
					const target = clock.serverTime(nowMs) - delayMs;
					let maxOverrun = 0;
					for (const [id, buffer] of buffers) {
						const visible = buffer.sample(target, pose) && nowMs - buffer.lastArrival < 3000;
						const underrun = !visible || buffer.lastUnderrun;
						if (visible && !buffer.sourceIdle && buffer.lastUnderrun) {
							maxOverrun = Math.max(maxOverrun, buffer.lastOverrunMs);
						}
						rendered.set(id, {
							point: visible ? { x: pose.x, y: pose.y, z: pose.z } : null,
							delayMs,
							underrun,
							held: !visible || (underrun && buffer.lastExtrapMs === 0)
						});
					}
					if (maxOverrun > 0) delay.observeUnderrun(nowMs, maxOverrun, clock.rtt);
				},
				render(id) {
					return rendered.get(id) ?? { point: null, delayMs: delay.currentMs, underrun: true, held: true };
				},
				clear() {
					buffers.clear();
					rendered.clear();
				}
			};
		}
	};
}
