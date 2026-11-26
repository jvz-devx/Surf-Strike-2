import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeSnapshot, Status } from '@surf/shared';
import { BotPath } from './path.ts';
import { replayProbe, type ProbeTrace } from './trace.ts';

test('replays the same arrivals at each recorded frame rate', () => {
	const path = new BotPath(0);
	const trace: ProbeTrace = {
		schema: 1, protocol: 3, start: 1000, measuredStart: 1100, measuredEnd: 1300,
		botIds: [1], fps: [60, 144],
		events: [[1000, 'timing', { type: 'welcome', selfId: 2, map: 'surf_test', serverTime: 500 }]]
	};
	for (let i = 0; i < 4; i++) {
		const t = i * 31.25;
		const payload = encodeSnapshot([{
			id: 1, tick: i * 2, ...path.at(t), sampleTimeMs: 500 + t,
			pitch: 0, yaw: 0, flags: 0, status: Status.Running, stage: 0, runTicks: 0
		}], 500 + t, i);
		trace.events.push([1000 + t, 'snapshot', Buffer.from(payload).toString('base64')]);
	}
	trace.events.push([1100, 'frame', 60, 16], [1125, 'frame', 144, 7], [1230, 'frame', 60, 130]);
	const [slow, fast] = replayProbe(trace);
	assert.equal(slow.controllers.fixed.frames, 2);
	assert.equal(slow.controllers.fixed.configuredDelayMs.p50, 100);
	assert.equal(slow.controllers.fixed.freezes.totalMs, 130);
	assert.equal(slow.controllers.previous.freezes.totalMs, 130);
	assert.equal(fast.controllers.fixed.frames, 1);
	assert.equal(fast.controllers.tuned.frames, 1);
});

test('rejects summaries that have no raw trace', () => {
	assert.throws(() => replayProbe({ schema: 1 } as ProbeTrace), /recorded with --trace/);
});
