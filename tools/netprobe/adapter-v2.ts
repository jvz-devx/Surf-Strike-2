import type { Adapter, Rendered } from './adapter.ts';
import { decodeSnapshot, encodeState, withTeleportSeq, type NetState } from '@surf/shared';
import { ServerClock } from '../../apps/web/src/lib/net/clock.ts';
import { AdaptiveDelay } from '../../apps/web/src/lib/net/adaptive.ts';
import { SnapshotBuffer, emptySample } from '../../apps/web/src/lib/net/interp.ts';

export function loadV2Adapter(): Adapter {
	return {
		encode(state, teleportCount) {
			return encodeState({ ...state, flags: withTeleportSeq(state.flags, teleportCount) } as NetState);
		},
		observer(botIds) {
			const clock = new ServerClock();
			const delay = new AdaptiveDelay();
			const rendered = new Map<number, Rendered>();
			const buffers = new Map<number, SnapshotBuffer>();
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
					const frame = decodeSnapshot(data);
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
					const target = clock.renderTime(nowMs, delayMs);
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
