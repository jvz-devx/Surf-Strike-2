import { decodeSnapshot } from '@surf/shared';
import { arrivalObserver, type Observer } from './adapter.ts';
import { loadV2Adapter } from './adapter-v2.ts';
import { PreviousDelay } from './adaptive-before.ts';
import { ObserverMetrics, type MetricsSummary, type TruthPath } from './metrics.ts';
import { BotPath } from './path.ts';
import type { ClockPong, Welcome } from './session.ts';

export type TraceEvent =
	| [at: number, kind: 'snapshot', data: string]
	| [at: number, kind: 'timing', message: Welcome | ClockPong]
	| [at: number, kind: 'frame', fps: number, dt: number]
	| [at: number, kind: 'clear'];

export interface ProbeTrace {
	schema: 1;
	protocol: number;
	start: number;
	measuredStart: number;
	measuredEnd: number;
	botIds: number[];
	fps: number[];
	events: TraceEvent[];
}

/** Replay the actual callbacks in order, including frames skipped by the real probe. */
export function replayProbe(
	trace: ProbeTrace,
	truth?: ReadonlyMap<number, TruthPath>
): { fps: number; controllers: Record<string, MetricsSummary> }[] {
	if (trace?.schema !== 1 || !Array.isArray(trace.events) || !Array.isArray(trace.botIds)
		|| !Array.isArray(trace.fps) || ![1, 2, 3].includes(trace.protocol)) {
		throw new Error('Expected a netprobe trace recorded with --trace');
	}
	const botIds = new Set(trace.botIds);
	const paths = truth ?? new Map(trace.botIds.map((id, i) => [id, new BotPath(i)]));
	const definitions: Record<string, () => Observer> = trace.protocol === 1 ? {
		fixed: () => arrivalObserver(botIds)
	} : {
		fixed: () => arrivalObserver(botIds, (data) => decodeSnapshot(data)?.entries ?? null),
		previous: () => loadV2Adapter(() => new PreviousDelay(), 50).observer(botIds),
		tuned: () => loadV2Adapter().observer(botIds)
	};
	return trace.fps.map((fps) => {
		const observers = Object.entries(definitions).map(([name, create]) => ({
			name, observer: create(),
			metrics: new ObserverMetrics(paths, trace.measuredStart - trace.start, trace.measuredEnd - trace.start)
		}));
		for (const event of trace.events) {
			const [at, kind, value, dt] = event;
			if (kind === 'frame') {
				if (value !== fps) continue;
				for (const { observer, metrics } of observers) {
					observer.beginFrame?.(at, dt);
					if (at >= trace.measuredStart && at <= trace.measuredEnd) {
						metrics.frame(at - trace.start, (id) => observer.render(id, at));
					}
				}
			} else if (kind === 'snapshot') {
				const bytes = Uint8Array.from(Buffer.from(value, 'base64')).buffer;
				for (const { observer } of observers) {
					if (!observer.snapshot(bytes, at)) throw new Error(`Invalid snapshot at ${at} ms`);
				}
			} else if (kind === 'timing') {
				for (const { observer } of observers) observer.timingMessage?.(value, at);
			} else {
				for (const { observer } of observers) observer.clear();
			}
		}
		return { fps, controllers: Object.fromEntries(observers.map(({ name, metrics }) => [name, metrics.summary()])) };
	});
}
