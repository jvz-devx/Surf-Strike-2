import { describe, expect, it } from 'vitest';
import type { NetState } from '@surf/shared';
import { parseDiscovery, serverOverride, toWsUrl } from './discovery.js';
import { emptySample, lerpAngle, SnapshotBuffer } from './interp.js';

describe('discovery URLs', () => {
	it('converts http(s) to ws(s) and appends /ws', () => {
		expect(toWsUrl('https://abc.trycloudflare.com')).toBe('wss://abc.trycloudflare.com/ws');
		expect(toWsUrl('http://localhost:27015')).toBe('ws://localhost:27015/ws');
		expect(toWsUrl('wss://x.example/ws')).toBe('wss://x.example/ws');
		expect(toWsUrl('ws://x.example/custom')).toBe('ws://x.example/custom');
		expect(toWsUrl('abc.trycloudflare.com')).toBe('wss://abc.trycloudflare.com/ws');
		expect(toWsUrl('localhost:27015')).toBe('ws://localhost:27015/ws');
		expect(toWsUrl('ftp://nope')).toBeNull();
		expect(toWsUrl('')).toBeNull();
	});
	it('reads ?server=', () => {
		expect(serverOverride('?server=https%3A%2F%2Fa.b')).toBe('wss://a.b/ws');
		expect(serverOverride('?x=1')).toBeNull();
	});
	it('parses discovery responses', () => {
		const now = Date.parse('2026-11-21T12:00:00Z');
		expect(parseDiscovery({ url: null }, now)).toBeNull();
		expect(parseDiscovery(null, now)).toBeNull();
		expect(parseDiscovery({ url: 'https://a.trycloudflare.com' }, now)).toBe('wss://a.trycloudflare.com/ws');
		expect(parseDiscovery({ url: 'https://a.b', lastSeen: now - 60_000 }, now)).toBe('wss://a.b/ws');
		expect(parseDiscovery({ url: 'https://a.b', lastSeen: now - 4 * 60_000 }, now)).toBeNull();
		expect(parseDiscovery({ url: 'https://a.b', lastSeen: '2026-11-21T11:59:00Z' }, now)).toBe('wss://a.b/ws');
	});
});

function st(x: number, yaw = 0): NetState {
	return { tick: 0, x, y: 0, z: 0, vx: x, vy: 0, vz: 0, pitch: 0, yaw, flags: 0, status: 1, stage: 1, runTicks: x };
}

describe('snapshot interpolation', () => {
	it('lerps angles the short way', () => {
		expect(lerpAngle(170, -170, 0.5)).toBeCloseTo(180);
		expect(lerpAngle(-10, 10, 0.25)).toBeCloseTo(-5);
	});
	it('interpolates between samples by arrival time', () => {
		const b = new SnapshotBuffer();
		const out = emptySample();
		expect(b.sample(0, out)).toBe(false);
		b.push(st(0, 350), 1000);
		b.push(st(100, 10), 1031.25);
		b.push(st(200, 30), 1062.5);
		expect(b.sample(1015.625, out)).toBe(true);
		expect(out.x).toBeCloseTo(50);
		expect(out.yaw).toBeCloseTo(360);
		b.sample(1046.875, out);
		expect(out.x).toBeCloseTo(150);
		expect(out.yaw).toBeCloseTo(20);
	});
	it('clamps outside the buffered range', () => {
		const b = new SnapshotBuffer();
		const out = emptySample();
		b.push(st(10), 100);
		b.push(st(20), 200);
		b.sample(50, out);
		expect(out.x).toBe(10);
		b.sample(500, out);
		expect(out.x).toBe(20);
	});
	it('snaps across teleports', () => {
		const b = new SnapshotBuffer();
		const out = emptySample();
		b.push(st(0), 0);
		b.push(st(5000), 100);
		b.sample(10, out);
		expect(out.x).toBe(5000);
	});
	it('keeps arrival times monotonic', () => {
		const b = new SnapshotBuffer();
		const out = emptySample();
		b.push(st(0), 100);
		b.push(st(10), 90);
		b.sample(100, out);
		expect(out.x).toBe(0);
		expect(b.size).toBe(2);
	});
	it('de-aliases 64->32 Hz tick spacing and drops duplicate ticks', () => {
		const b = new SnapshotBuffer();
		const out = emptySample();
		const speed = 640; // 10 u per 64 Hz tick (15.625 ms)
		const atTick = (tick: number): NetState => ({
			...st(tick * 10),
			tick,
			vx: speed
		});
		// Snapshots arrive at uniform 31.25 ms server intervals, but sender ticks arrive as 2, 1, 3, 0 (dup), 4.
		b.push(atTick(100), 1000, 5000);
		b.push(atTick(102), 1031.25, 5031.25);
		b.push(atTick(103), 1062.5, 5062.5);
		b.push(atTick(106), 1093.75, 5093.75);
		b.push(atTick(106), 1125.0, 5125.0); // duplicate tick: must be dropped while keeping lastArrival fresh
		b.push(atTick(110), 1156.25, 5156.25);

		expect(b.lastArrival).toBe(5156.25);
		// Sample across the 1-tick/3-tick/dup region: velocity should stay constant at 640 u/s (10 u per 15.625 ms).
		for (let t = 1005; t <= 1150; t += 10) {
			expect(b.sample(t, out)).toBe(true);
			const expectedX = 1000 + ((t - 1000) / 1000) * speed;
			expect(Math.abs(out.x - expectedX)).toBeLessThan(1.5);
		}
	});
	it('separates local arrival time from server timeline and detects idle sources', () => {
		const b = new SnapshotBuffer();
		b.push({ ...st(0), tick: 1 }, 1000, 9000);
		b.push({ ...st(10), tick: 2 }, 1031.25, 9031.25);
		expect(b.sourceIdle).toBe(false);
		for (let i = 0; i < 8; i++) {
			b.push({ ...st(10), tick: 2 }, 1062.5 + i * 31.25, 9062.5 + i * 31.25);
		}
		expect(b.sourceIdle).toBe(true);
		expect(b.lastArrival).toBeCloseTo(9062.5 + 7 * 31.25);
	});
});
