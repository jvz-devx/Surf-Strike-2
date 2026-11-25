import { describe, expect, it, vi } from 'vitest';
import type { NetState } from '@surf/shared';
import { Connection } from './connection.js';
import { parseDiscovery, sameOriginWsUrl, serverOverride, toWsUrl } from './discovery.js';
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
	it('reads ?server= and same-origin URLs', () => {
		expect(serverOverride('?server=https%3A%2F%2Fa.b')).toBe('wss://a.b/ws');
		expect(serverOverride('?x=1')).toBeNull();
		expect(sameOriginWsUrl({ origin: 'https://surf.example.com' })).toBe('wss://surf.example.com/ws');
		expect(sameOriginWsUrl({ origin: 'http://localhost:8080' })).toBe('ws://localhost:8080/ws');
		expect(sameOriginWsUrl(null)).toBeNull();
	});
	it('self-hosted Connection connects to sameOrigin without calling /api/server, while ?server= overrides it', () => {
		const fetchSpy = vi.fn();
		const opened: string[] = [];
		const origWs = globalThis.WebSocket;
		class FakeWs {
			binaryType = '';
			constructor(url: string) {
				opened.push(url);
			}
			close() {}
		}
		globalThis.WebSocket = FakeWs as unknown as typeof WebSocket;
		try {
			const noop = () => {};
			const c1 = new Connection(
				{ connecting: noop, open: noop, message: noop, snapshot: noop, closed: noop, idle: noop },
				{ override: null, sameOrigin: 'wss://self.example/ws', dev: false, fetch: fetchSpy as unknown as typeof fetch }
			);
			c1.start();
			c1.dispose();
			expect(opened).toEqual(['wss://self.example/ws']);
			expect(fetchSpy).not.toHaveBeenCalled();

			const c2 = new Connection(
				{ connecting: noop, open: noop, message: noop, snapshot: noop, closed: noop, idle: noop },
				{
					override: 'wss://other.example/ws',
					sameOrigin: 'wss://self.example/ws',
					dev: false,
					fetch: fetchSpy as unknown as typeof fetch
				}
			);
			c2.start();
			c2.dispose();
			expect(opened).toEqual(['wss://self.example/ws', 'wss://other.example/ws']);
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			globalThis.WebSocket = origWs;
		}
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
});
