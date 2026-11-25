import assert from 'node:assert/strict';
import test from 'node:test';
import { ObserverMetrics, Series } from './metrics.ts';
import { BotPath } from './path.ts';

function near(actual: number | null, expected: number) {
	assert.ok(actual !== null && Math.abs(actual - expected) < 1e-6, `${actual} vs ${expected}`);
}

test('series uses nearest-rank percentiles and root mean square', () => {
	const series = new Series();
	assert.equal(series.summary().p50, null);
	for (const value of [5, 1, 2, 3, 4]) series.add(value);
	assert.deepEqual(series.summary(), { count: 5, rms: Math.sqrt(11), p50: 3, p95: 5, p99: 5, max: 5 });
});

test('position error, effective delay and speed wobble match known translations', () => {
	const path = new BotPath(0);
	const metrics = new ObserverMetrics(new Map([[1, path]]), 0, 2000);
	for (const ms of [500, 520, 540]) {
		metrics.frame(ms, () => ({
			point: { ...path.at(ms - 150), y: 3 },
			delayMs: 100, underrun: false, held: false
		}));
	}
	const data = metrics.summary();
	near(data.positionErrorU.rms, Math.hypot(0.05 * 265, 3));
	near(data.pathErrorU.rms, 3);
	near(data.effectiveDelayMs.p50, 150);
	near(data.speedWobbleUps.rms, 0);
	assert.equal(data.botFrames, 3);
	assert.equal(data.measuredBotMs, 40);
});

test('counts underrun and freeze episodes separately and measures speed during a hold', () => {
	const path = new BotPath(0);
	const metrics = new ObserverMetrics(new Map([[1, path]]), 0, 2000);
	for (let i = 0; i <= 10; i++) {
		const ms = 500 + i * 20;
		metrics.frame(ms, () => ({
			point: path.at(Math.min(ms, 520) - 100),
			delayMs: 100, underrun: i > 0, held: i > 1
		}));
	}
	const data = metrics.summary();
	assert.deepEqual(data.underruns, { frames: 10, totalMs: 200, episodes: 1, over100Ms: 1, maxMs: 200 });
	assert.deepEqual(data.freezes, { frames: 9, totalMs: 180, episodes: 1, over100Ms: 1, maxMs: 180 });
	near(data.speedWobbleUps.rms, 265 * Math.sqrt(0.9));
});

test('classifies a short slide, a long snap and a missed teleport', () => {
	const path = new BotPath(0);
	const metrics = new ObserverMetrics(new Map([[1, path]]), 2000, 20_000);
	const samples = [
		[6000, 0], [6150, 192], [6167, 384],
		[12000, 384], [12150, 1920],
		[16000, 1920], [18_050, 1920]
	];
	for (const [ms, z] of samples) {
		metrics.frame(ms, () => ({
			point: { ...path.at(ms), z },
			delayMs: 100, underrun: false, held: false
		}));
	}
	assert.deepEqual(metrics.summary().teleports, { expected: 3, slides: 1, snaps: 1, missed: 1, unresolved: 0 });
});
