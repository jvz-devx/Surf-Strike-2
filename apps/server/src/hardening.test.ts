import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WebSocket } from 'ws';
import { CLOSE_IP_LIMIT } from '@surf/shared';
import { clientIp, isOriginAllowed, parseAllowedOrigins, parseTrustProxy } from './proxy.ts';
import { startServer } from './server.ts';
import { netState, sleep, TestClient, testMap } from './test-helpers.ts';

const MAPS = [testMap('surf_a', 'Alpha')];

function fakeReq(remoteAddress: string, headers: Record<string, string | string[]> = {}) {
	return { socket: { remoteAddress }, headers };
}

describe('TRUST_PROXY and clientIp', () => {
	it('default (loopback) trusts CF-Connecting-IP and X-Forwarded-For only from loopback', () => {
		const tp = parseTrustProxy(undefined);
		assert.equal(clientIp(fakeReq('127.0.0.1', { 'cf-connecting-ip': '203.0.113.7' }), tp), '203.0.113.7');
		assert.equal(clientIp(fakeReq('::1', { 'x-forwarded-for': '198.51.100.2' }), tp), '198.51.100.2');
		assert.equal(clientIp(fakeReq('10.42.0.9', { 'cf-connecting-ip': '203.0.113.7' }), tp), '10.42.0.9');
	});

	it('private trusts pod hops, picks rightmost untrusted XFF, never returns pod IP', () => {
		const tp = parseTrustProxy('private');
		assert.equal(clientIp(fakeReq('10.42.0.9', { 'cf-connecting-ip': '203.0.113.7' }), tp), '203.0.113.7');
		// Spoofed left entry ignored; trusted pod hop skipped; real visitor returned.
		assert.equal(
			clientIp(fakeReq('10.42.0.9', { 'x-forwarded-for': '1.2.3.4, 198.51.100.42, 10.42.0.2' }), tp),
			'198.51.100.42'
		);
		// No headers from trusted pod -> null so guest ban never bans the tunnel pod.
		assert.equal(clientIp(fakeReq('10.42.0.9'), tp), null);
		// Direct public peer -> headers ignored.
		assert.equal(clientIp(fakeReq('198.51.100.5', { 'cf-connecting-ip': '1.2.3.4' }), tp), '198.51.100.5');
	});

	it('cf mode trusts CF-Connecting-IP from private hops and ignores X-Forwarded-For', () => {
		const tp = parseTrustProxy('cf');
		assert.equal(clientIp(fakeReq('10.42.0.9', { 'cf-connecting-ip': '203.0.113.7' }), tp), '203.0.113.7');
		assert.equal(clientIp(fakeReq('10.42.0.9', { 'x-forwarded-for': '203.0.113.7' }), tp), null);
	});

	it('none ignores all forwarded headers and never returns loopback', () => {
		const tp = parseTrustProxy('none');
		assert.equal(clientIp(fakeReq('127.0.0.1', { 'cf-connecting-ip': '203.0.113.7' }), tp), null);
		assert.equal(clientIp(fakeReq('198.51.100.5', { 'x-forwarded-for': '1.2.3.4' }), tp), '198.51.100.5');
	});

	it('explicit IPv4 and IPv6 CIDRs match accurately and reject invalid entries', () => {
		const tp = parseTrustProxy('10.42.0.0/16, fd00:1234::/32');
		assert.equal(clientIp(fakeReq('10.42.9.8', { 'x-forwarded-for': '203.0.113.10' }), tp), '203.0.113.10');
		assert.equal(clientIp(fakeReq('10.43.0.1', { 'x-forwarded-for': '203.0.113.10' }), tp), '10.43.0.1');
		assert.equal(clientIp(fakeReq('fd00:1234::5', { 'cf-connecting-ip': '2001:db8::9' }), tp), '2001:db8::9');
		assert.throws(() => parseTrustProxy('not-a-cidr'), /Invalid TRUST_PROXY/);
	});
});

describe('ALLOWED_ORIGINS', () => {
	it('parses allow-list and checks origins including same-origin', () => {
		assert.equal(parseAllowedOrigins(undefined), null);
		assert.equal(isOriginAllowed({ headers: {} }, null), true);

		const allowed = parseAllowedOrigins('https://Play.Example.com/, same-origin');
		assert.equal(isOriginAllowed({ headers: { origin: 'https://play.example.com' } }, allowed), true);
		assert.equal(isOriginAllowed({ headers: { origin: 'https://evil.example.com' } }, allowed), false);
		assert.equal(isOriginAllowed({ headers: {} }, allowed), false);
		assert.equal(
			isOriginAllowed({ headers: { origin: 'https://self.example.com:8080', host: 'self.example.com:8080' } }, allowed),
			true
		);
		assert.throws(() => parseAllowedOrigins('ftp://bad.example'), /http or https/);
	});

	it('rejects disallowed WebSocket upgrades with HTTP 403 and accepts allowed origins', async () => {
		const server = await startServer({
			port: 0,
			host: '127.0.0.1',
			dbPath: ':memory:',
			maps: MAPS,
			log: () => {},
			allowedOrigins: 'https://allowed.example'
		});
		try {
			const rejectedStatus = await new Promise<number>((ok, fail) => {
				const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
					headers: { origin: 'https://evil.example' }
				});
				ws.once('unexpected-response', (_req, res) => ok(res.statusCode ?? 0));
				ws.once('open', () => {
					ws.close();
					fail(new Error('should have been rejected'));
				});
			});
			assert.equal(rejectedStatus, 403);

			const c = new TestClient(server.port, { origin: 'https://allowed.example' });
			const w = await c.hello('Good');
			assert.equal(w.map, 'surf_a');
			c.close();
		} finally {
			await server.close();
		}
	});
});

describe('pre-hello caps, hello timeout, metrics, web handler, and graceful shutdown', () => {
	it('pre-hello sockets use a separate cap, never block player slots, and respect per-IP pending cap + short hello timeout', async () => {
		const server = await startServer({
			port: 0,
			host: '127.0.0.1',
			dbPath: ':memory:',
			maps: MAPS,
			log: () => {},
			maxPlayers: 2,
			maxPending: 3,
			maxPerIp: 2,
			helloTimeoutMs: 250
		});
		const open: TestClient[] = [];
		try {
			// Two pending sockets from one IP fill the per-IP pending cap (2), 3rd from same IP is rejected with 4010.
			const ipA = { 'cf-connecting-ip': '198.51.100.10' };
			const p1 = new TestClient(server.port, ipA);
			const p2 = new TestClient(server.port, ipA);
			open.push(p1, p2);
			await Promise.all([p1.open(), p2.open()]);
			assert.equal(server.lobby.pendingCount, 2);
			assert.equal(server.lobby.playerCount, 0);

			const p3SameIp = new TestClient(server.port, ipA);
			open.push(p3SameIp);
			await p3SameIp.until(() => p3SameIp.closed);
			assert.equal(p3SameIp.closeCode, CLOSE_IP_LIMIT);

			// Another IP takes the 3rd pending slot and completes hello even while 2 pending sockets sit open.
			const real1 = new TestClient(server.port, { 'cf-connecting-ip': '198.51.100.11' });
			open.push(real1);
			await real1.hello('Real1');
			assert.equal(server.lobby.playerCount, 1);

			// A second real player also gets the 2nd player slot despite the 2 pending sockets!
			const real2 = new TestClient(server.port, { 'cf-connecting-ip': '198.51.100.12' });
			open.push(real2);
			await real2.hello('Real2');
			assert.equal(server.lobby.playerCount, 2);

			// The 2 silent pending sockets time out with close code 4000 within helloTimeoutMs.
			await Promise.all([p1.until(() => p1.closed), p2.until(() => p2.closed)]);
			assert.equal(p1.closeCode, 4000);
			assert.equal(p2.closeCode, 4000);
			assert.equal(server.lobby.pendingCount, 0);
		} finally {
			for (const c of open) c.close();
			await server.close();
		}
	});

	it('serves /metrics in Prometheus format, mounts webHandler for other paths, and closes sockets with 1001 on shutdown', async () => {
		const server = await startServer({
			port: 0,
			host: '127.0.0.1',
			dbPath: ':memory:',
			maps: MAPS,
			log: () => {},
			webHandler: (req, res) => {
				res.writeHead(200, { 'content-type': 'text/html' }).end(`<html>${req.url}</html>`);
			}
		});
		const c = new TestClient(server.port);
		await c.hello('Watcher');
		c.sendState(netState(1, 100));
		await sleep(80);

		const healthRes = await fetch(`http://127.0.0.1:${server.port}/health`);
		assert.equal(healthRes.status, 200);
		assert.equal((await healthRes.json()).players, 1);

		const webRes = await fetch(`http://127.0.0.1:${server.port}/`);
		assert.equal(webRes.status, 200);
		assert.equal(await webRes.text(), '<html>/</html>');

		const wsHttpRes = await fetch(`http://127.0.0.1:${server.port}/ws`);
		assert.equal(wsHttpRes.status, 426);

		const metricsRes = await fetch(`http://127.0.0.1:${server.port}/metrics`);
		assert.equal(metricsRes.status, 200);
		assert.match(metricsRes.headers.get('content-type') ?? '', /^text\/plain; version=0\.0\.4/);
		const body = await metricsRes.text();
		for (const metric of [
			'surf_players 1',
			'surf_pending_connections 0',
			'surf_event_loop_delay_p50_ms ',
			'surf_event_loop_delay_p99_ms ',
			'surf_event_loop_delay_max_ms ',
			'surf_snapshot_tick_lateness_p50_ms ',
			'surf_snapshot_tick_lateness_p99_ms ',
			'surf_snapshot_tick_lateness_max_ms ',
			'surf_mode_tick_lateness_p50_ms ',
			'surf_mode_tick_lateness_p99_ms ',
			'surf_mode_tick_lateness_max_ms ',
			'surf_bytes_sent_per_second ',
			'surf_socket_buffered_bytes_max ',
			'process_resident_memory_bytes '
		]) {
			assert.ok(body.includes(metric), `missing metric line: ${metric}`);
		}

		// Graceful shutdown delivers close code 1001 quickly (well under 5 s).
		const t0 = performance.now();
		await server.close();
		const elapsedMs = performance.now() - t0;
		await c.until(() => c.closed);
		assert.equal(c.closeCode, 1001);
		assert.ok(elapsedMs < 5_000, `shutdown took ${elapsedMs} ms`);
	});
});
