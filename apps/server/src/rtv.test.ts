/** RTV request flow (docs/gameplay.md#map-rotation-and-voting): modal messages, yes/no votes, decline cooldown. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MapDef } from '@surf/shared';
import { CHANGE_COUNTDOWN, RTV_BLOCK, RTV_DECLINE_COOLDOWN, RTV_REQUEST_DURATION, VOTE_DURATION } from '@surf/shared';
import type { GameServer } from './server.ts';
import { startServer } from './server.ts';
import { sleep, TestClient, testMap } from './test-helpers.ts';

const bhop = (id: string, title: string): MapDef => ({ ...testMap(id, title), kind: 'bhop' });
const MAPS = [
	testMap('surf_a', 'Alpha'),
	testMap('surf_b', 'Bravo'),
	testMap('surf_c', 'Charlie'),
	testMap('surf_d', 'Delta'),
	testMap('surf_e', 'Echo'),
	bhop('bhop_a', 'Meadow'),
	bhop('bhop_b', 'Quarry'),
	bhop('bhop_c', 'Ridge')
];

let clock = 2_000_000_000;
let server: GameServer;
const clients: TestClient[] = [];

async function join(name: string) {
	const c = new TestClient(server.port);
	clients.push(c);
	await c.hello(name);
	return c;
}

before(async () => {
	server = await startServer({
		port: 0,
		host: '127.0.0.1',
		dbPath: ':memory:',
		maps: MAPS,
		initialMap: 'surf_a',
		now: () => clock,
		rng: () => 0,
		log: () => {}
	});
});

after(async () => {
	for (const c of clients) c.close();
	await server.close();
});

describe('rtv request', () => {
	it('modal messages to everyone, yes/no votes, then the map vote with the nominated map', async () => {
		const [a, b, c, d] = [await join('A'), await join('B'), await join('C'), await join('D')];
		const spec = await join('Spec');
		let n = spec.messages.length;
		spec.send({ type: 'chat', text: '!spec' });
		await a.waitFor('spectating', (m) => m.spectating);

		// Blocked for the first 20 s of a map.
		n = a.messages.length;
		a.send({ type: 'rtvRequest', mapId: 'surf_e' });
		await a.waitFor('chat', (m) => m.system === true && m.text.includes('available in'), n);
		clock += (RTV_BLOCK + 1) * 1000;

		// Current map cannot be nominated.
		n = a.messages.length;
		a.send({ type: 'rtvRequest', mapId: 'surf_a' });
		await a.waitFor('chat', (m) => m.system === true && m.text === 'That map is already being played.', n);

		const from = [a, b, c, d, spec].map((x) => x.messages.length);
		a.send({ type: 'rtvRequest', mapId: 'surf_e' });
		for (const [i, x] of [a, b, c, d, spec].entries()) {
			const r = await x.waitFor('rtvRequest', (m) => m.started, from[i]);
			assert.equal(r.initiator, 'A');
			assert.equal(r.mapId, 'surf_e');
			assert.equal(r.yes, 1);
			assert.equal(r.no, 0);
			assert.equal(r.needed, 2, '4 voters (spectator excluded) need 2');
			assert.ok(r.duration <= RTV_REQUEST_DURATION && r.duration > RTV_REQUEST_DURATION - 1);
		}
		await b.waitFor('chat', (m) => m.system === true && m.text.includes('A wants to vote for a new map (Surf · Echo)'), from[1]);

		// Spectators see it but cannot vote.
		n = spec.messages.length;
		spec.send({ type: 'rtvVote', yes: true });
		await spec.waitFor('chat', (m) => m.system === true && m.text === 'Spectators cannot vote.', n);

		n = a.messages.length;
		b.send({ type: 'rtvVote', yes: false });
		await a.waitFor('rtvRequest', (m) => !m.started && m.yes === 1 && m.no === 1, n);

		n = d.messages.length;
		c.send({ type: 'rtvVote', yes: true });
		const end = await d.waitFor('rtvRequestEnd', () => true, n);
		assert.deepEqual(end, { type: 'rtvRequestEnd', passed: true, reason: 'passed', cooldown: 0 });
		const vs = await d.waitFor('voteStart', () => true, n);
		assert.equal(vs.rtv, true);
		assert.equal(vs.options.length, 6);
		assert.equal(vs.options.some((o) => o.kind === 'extend'), false);
		assert.ok(vs.options.some((o) => o.kind === 'map' && o.mapId === 'surf_e'), 'nominated map offered');
		const ids = vs.options.map((o) => (o.kind === 'map' ? o.mapId : ''));
		const kinds = ids.map((id) => id.split('_')[0]);
		assert.ok(kinds.filter((k) => k === 'surf').length >= 2 && kinds.filter((k) => k === 'bhop').length >= 2);
		assert.deepEqual(kinds, [...kinds].sort((x, y) => (x === y ? 0 : x === 'surf' ? -1 : 1)), 'grouped by category');
		await d.waitFor('chat', (m) => m.system === true && m.text.includes('Map vote request passed'), n);
		await d.waitFor('chat', (m) => m.system === true && m.text.includes('1. Surf · '), n);

		// Finish the vote: new map, everyone told the map-start block.
		n = a.messages.length;
		a.send({ type: 'vote', option: 1 });
		await a.waitFor('voteUpdate', (m) => m.counts[0] === 1, n);
		clock += VOTE_DURATION * 1000;
		server.lobby.updateRotation();
		const ve = await a.waitFor('voteEnd', () => true, n);
		assert.deepEqual(ve.winner, vs.options[0]);
		clock += CHANGE_COUNTDOWN * 1000;
		server.lobby.updateRotation();
		await a.waitFor('mapChange', () => true, n);
		const cd = await a.waitFor('rtvCooldown', () => true, n);
		assert.equal(cd.reason, 'mapStart');
		assert.equal(cd.seconds, RTV_BLOCK);
	});

	it('declined request: 60 s cooldown for everyone', async () => {
		const [a, b, c, d] = clients;
		clock += (RTV_BLOCK + 1) * 1000;
		let n = a.messages.length;
		a.send({ type: 'rtv' });
		await a.waitFor('rtvRequest', (m) => m.started && m.mapId === null, n);
		b.send({ type: 'rtvVote', yes: false });
		c.send({ type: 'rtvVote', yes: false });
		await a.waitFor('rtvRequest', (m) => m.no === 2, n);
		d.send({ type: 'rtvVote', yes: false });
		const end = await a.waitFor('rtvRequestEnd', () => true, n);
		assert.deepEqual(end, { type: 'rtvRequestEnd', passed: false, reason: 'rejected', cooldown: RTV_DECLINE_COOLDOWN });
		await a.waitFor('chat', (m) => m.system === true && m.text.includes('declined'), n);
		assert.equal(server.lobby.rotation.vote, null);

		n = b.messages.length;
		b.send({ type: 'rtvRequest', mapId: 'bhop_a' });
		await b.waitFor('chat', (m) => m.system === true && m.text === 'Map vote declined — try again in 60 s.', n);
		clock += 15_000;
		n = c.messages.length;
		c.send({ type: 'chat', text: '!rtv' });
		await c.waitFor('chat', (m) => m.system === true && m.text === 'Map vote declined — try again in 45 s.', n);

		// A newcomer learns the cooldown on join.
		const late = await join('Late');
		const cd = await late.waitFor('rtvCooldown');
		assert.deepEqual(cd, { type: 'rtvCooldown', seconds: 45, reason: 'declined' });

		// After the cooldown, requests work again; a timeout also declines.
		clock += (RTV_DECLINE_COOLDOWN - 15) * 1000;
		n = a.messages.length;
		a.send({ type: 'rtvRequest' });
		await a.waitFor('rtvRequest', (m) => m.started, n);
		clock += RTV_REQUEST_DURATION * 1000;
		server.lobby.updateRotation();
		const t = await a.waitFor('rtvRequestEnd', () => true, n);
		assert.equal(t.reason, 'timeout');
		assert.equal(t.cooldown, RTV_DECLINE_COOLDOWN);
	});

	it('a lone player still changes map directly', async () => {
		for (const c of clients) c.close();
		clients.length = 0;
		await sleep(200);
		const solo = await join('Solo');
		const target = MAPS.find((m) => m.id !== server.lobby.currentMap.id)!.id;
		const n = solo.messages.length;
		solo.send({ type: 'changeMap', mapId: target });
		const mc = await solo.waitFor('mapChange', () => true, n);
		assert.equal(mc.map, target);
		assert.equal(solo.messages.slice(n).some((m) => m.type === 'rtvRequest'), false);
	});
});
