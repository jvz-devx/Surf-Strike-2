import assert from 'node:assert/strict';
import { it } from 'node:test';
import { PeerRtt } from './peer-rtt.ts';
import { startServer } from './server.ts';
import { TestClient, testMap } from './test-helpers.ts';

it('sends an RTT probe at join and accepts only its first matching pong', async () => {
	const map = testMap();
	const server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', maps: [map], initialMap: map.id, timers: false, log: () => {} });
	const client = new TestClient(server.port);
	try {
		const welcome = await client.hello('Alice');
		const peer = [...server.lobby.clients].find((p) => p.id === welcome.selfId)!;
		const fallback = peer.ping;
		client.send({ type: 'pong', t: performance.now() - 30 });
		await client.barrier();
		assert.equal(peer.ping, fallback);
		assert.ok(fallback > 0);

		const probe = await client.waitFor('ping');
		client.send({ type: 'pong', t: probe.t });
		const measured = await client.until(() => peer.ping !== fallback && peer.ping);
		assert.ok(measured > 0);

		client.send({ type: 'pong', t: probe.t });
		await client.barrier();
		assert.equal(peer.ping, measured);
	} finally {
		client.close();
		await server.close();
	}
});

it('uses the first RTT immediately, rejects a spike and follows a sustained change after two probes', () => {
	const peer = new PeerRtt();
	const sample = (sent: number, rtt: number) => peer.pong(peer.probe(sent), sent + rtt);
	assert.equal(sample(1000, 25), 25);
	assert.equal(sample(1500, 85), 25);
	assert.equal(sample(2000, 25), 25);
	assert.equal(sample(2500, 25), 25);
	assert.equal(sample(3000, 60), 25);
	assert.equal(sample(3500, 60), 60);
});

it('can measure an older pending probe but discards expired echoes', () => {
	const peer = new PeerRtt();
	const first = peer.probe(1000);
	const second = peer.probe(1500);
	assert.equal(peer.pong(first, 1600), 600);
	peer.probe(3600);
	assert.equal(peer.pong(second, 3610), null);
});
