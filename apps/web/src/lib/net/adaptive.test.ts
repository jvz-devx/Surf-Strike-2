import { describe, expect, it } from 'vitest';
import { ADAPTIVE_MAX_MS, ADAPTIVE_MIN_MS, AdaptiveDelay } from './adaptive.js';

describe('AdaptiveDelay', () => {
	it('starts at ~2 snapshot intervals on clean links and respects [min, max]', () => {
		const d32 = new AdaptiveDelay({ snapshotHz: 32 });
		expect(d32.currentMs).toBeCloseTo(62.5, 1);

		const d64 = new AdaptiveDelay({ snapshotHz: 64 });
		expect(d64.currentMs).toBe(ADAPTIVE_MIN_MS);

		d32.observeSnapshot(1000, { jitterMs: 1, rttMs: 20, arrivalGapMs: 31.25, transitExcessMs: 1, seqGap: 0 });
		for (let t = 1016; t <= 2000; t += 16) d32.update(t, 16);
		expect(d32.currentMs).toBeGreaterThanOrEqual(62.5);
		expect(d32.currentMs).toBeLessThan(70);
	});

	it('grows with jitter and TCP loss/retransmit stalls while keeping render time monotonic', () => {
		const d = new AdaptiveDelay({ snapshotHz: 32 });
		let now = 1000;
		let prevRender = now - d.currentMs;

		// Inject a 150 ms TCP retransmit stall on a 45 ms RTT Wi-Fi link.
		d.observeSnapshot(now, { jitterMs: 10, rttMs: 45, arrivalGapMs: 150, transitExcessMs: 120, seqGap: 0 });
		expect(d.targetMs).toBeGreaterThanOrEqual(130);
		expect(d.targetMs).toBeLessThanOrEqual(ADAPTIVE_MAX_MS);

		// Slew over 500 ms at 60 Hz: renderTime = now - delayMs must NEVER move backward.
		for (let i = 0; i < 30; i++) {
			now += 16.67;
			const delay = d.update(now, 16.67);
			const render = now - delay;
			expect(render).toBeGreaterThan(prevRender);
			prevRender = render;
		}
		expect(d.currentMs).toBeCloseTo(d.targetMs, 1);
	});

	it('shrinks slowly after the link stays clean and clamps extreme stalls to maxMs', () => {
		const d = new AdaptiveDelay({ snapshotHz: 32 });
		// Huge 400 ms stall + underrun clamps to ADAPTIVE_MAX_MS.
		d.observeSnapshot(1000, { jitterMs: 20, rttMs: 150, arrivalGapMs: 400, transitExcessMs: 350, seqGap: 2 });
		d.observeUnderrun(1000, 200, 150);
		expect(d.targetMs).toBe(ADAPTIVE_MAX_MS);
		for (let t = 1020; t <= 2000; t += 20) d.update(t, 20);
		expect(d.currentMs).toBe(ADAPTIVE_MAX_MS);

		// Clean link resumes: holds for 3 s, then decays slowly back toward clean floor.
		let now = 2000;
		for (let i = 0; i < 60; i++) {
			now += 31.25;
			d.observeSnapshot(now, { jitterMs: 1, rttMs: 20, arrivalGapMs: 31.25, transitExcessMs: 1, seqGap: 0 });
			d.update(now, 31.25);
		}
		// Still holding near max within the 3 s clean hold window.
		expect(d.currentMs).toBeGreaterThan(180);

		// After 30 more seconds of clean traffic, it decays smoothly down to the clean floor (~66.5 ms).
		for (let i = 0; i < 960; i++) {
			now += 31.25;
			d.observeSnapshot(now, { jitterMs: 1, rttMs: 20, arrivalGapMs: 31.25, transitExcessMs: 1, seqGap: 0 });
			d.update(now, 31.25);
		}
		expect(d.currentMs).toBeLessThan(70);
		expect(d.currentMs).toBeGreaterThanOrEqual(62.5);
	});
});
