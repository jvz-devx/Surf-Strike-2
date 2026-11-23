/**
 * Record panel data (docs/gameplay.md#personal-bests-and-leaderboard): every
 * message that carries MapRecordInfo, and the `records` push to other players
 * when someone's PB changes the leaderboard.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Status, TICK_RATE, type MapRecordInfo } from '@surf/shared';
import type { GameServer } from './server.ts';
import { startServer } from './server.ts';
import { netState, sleep, TestClient, testMap } from './test-helpers.ts';

const MS = (ticks: number) => (ticks / TICK_RATE) * 1000;
const MAPS = [testMap('surf_a', 'Alpha'), testMap('surf_b', 'Bravo')];

let clock = 1_000_000_000;
let server: GameServer;
const clients: TestClient[] = [];

async function join(name: string) {
	const c = new TestClient(server.port);
	clients.push(c);
	const welcome = await c.hello(name);
	return { c, welcome };
}

/** Valid run of `totalTicks` (same shape as lobby.test.ts). Resolves with runResult or the guest notice. */
async function run(c: TestClient, totalTicks: number) {
	const t0 = 10_000;
	c.sendState(netState(t0 - 2, 150, { status: Status.StartZone }));
	c.send({ type: 'zone', kind: 'start', index: 0, tick: t0 });
	await c.barrier();
	const startClock = clock;
	for (let t = t0; t <= t0 + totalTicks; t += 16) {
		c.sendState(netState(t, 216 + ((t - t0) * 1850) / totalTicks, { vx: 400, runTicks: t - t0 }));
		if (t - t0 === 256) c.send({ type: 'zone', kind: 'stage', index: 2, tick: t });
	}
	clock = startClock + MS(totalTicks);
	const n = c.messages.length;
	c.send({ type: 'zone', kind: 'end', index: 0, tick: t0 + totalTicks });
	return c.until(() =>
		c.messages
			.slice(n)
			.find(
				(m) =>
					m.type === 'runResult' ||
					m.type === 'runRejected' ||
					(m.type === 'chat' && m.system === true && m.text.includes('guest run, not saved'))
			)
	);
}

/** The records without the leaderboard top (checked by itself). */
const own = ({ top: _top, ...r }: MapRecordInfo) => r;

/** Leaderboard top as `rank name ticks`, `*` = the receiver's own. */
const top = (r: MapRecordInfo) => (r.top ?? []).map((e) => `${e.rank} ${e.name} ${e.ticks}${e.self ? ' *' : ''}`);

/** `records` pushes received by `c` since message index `from`. */
const pushes = (c: TestClient, from: number) =>
	c.messages.slice(from).filter((m): m is Extract<typeof m, { type: 'records' }> => m.type === 'records');

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

describe('record panel data', () => {
	let ana: TestClient;
	let bob: TestClient;
	let guest: TestClient;

	it('a new map record is pushed to everyone else on the map', async () => {
		({ c: ana } = await join('Ana'));
		({ c: bob } = await join('Bob'));
		({ c: guest } = await join('Guesty'));
		assert.equal((await ana.auth('register', 'Ana', 'secret1')).ok, true);
		assert.equal((await bob.auth('register', 'Bob', 'secret1')).ok, true);

		// Bob sets the first record.
		let na = ana.messages.length;
		let ng = guest.messages.length;
		const b1 = await run(bob, 640);
		assert.ok(b1.type === 'runResult' && b1.record && b1.records.recordName === 'Bob');
		const a1 = await ana.waitFor('records', () => true, na);
		assert.deepEqual({ ...a1, records: own(a1.records) }, {
			type: 'records',
			map: 'surf_a',
			records: { pbTicks: null, pbSplits: null, rank: null, recordTicks: 640, recordName: 'Bob' }
		});
		const g1 = await guest.waitFor('records', () => true, ng);
		assert.equal(g1.records.recordTicks, 640);
		assert.equal(pushes(bob, 0).length, 0, 'the runner gets runResult, not a push');

		// Ana beats it: Bob's panel shows Ana's record and his rank drops to 2.
		const nb = bob.messages.length;
		ng = guest.messages.length;
		const a2 = await run(ana, 512);
		assert.ok(a2.type === 'runResult');
		if (a2.type !== 'runResult') return;
		assert.equal(a2.record, true);
		assert.deepEqual(own(a2.records), { pbTicks: 512, pbSplits: [256], rank: 1, recordTicks: 512, recordName: 'Ana' });
		const b2 = await bob.waitFor('records', () => true, nb);
		assert.deepEqual(own(b2.records), { pbTicks: 640, pbSplits: [256], rank: 2, recordTicks: 512, recordName: 'Ana' });
		assert.equal((await guest.waitFor('records', () => true, ng)).records.recordName, 'Ana');
	});

	it('a slower run (not a PB) still returns the current records and pushes nothing', async () => {
		await sleep(1100);
		const nb = bob.messages.length;
		const slow = await run(ana, 576);
		assert.ok(slow.type === 'runResult');
		if (slow.type !== 'runResult') return;
		assert.equal(slow.pb, false);
		assert.equal(slow.record, false);
		assert.deepEqual(own(slow.records), { pbTicks: 512, pbSplits: [256], rank: 1, recordTicks: 512, recordName: 'Ana' });
		await sleep(1100);
		await bob.barrier();
		assert.equal(pushes(bob, nb).length, 0);
	});

	it("a guest's finished run changes nothing and pushes nothing", async () => {
		const na = ana.messages.length;
		const g = await run(guest, 448);
		assert.equal(g.type, 'chat');
		await sleep(1100);
		await ana.barrier();
		assert.equal(pushes(ana, na).length, 0);
		assert.equal(server.db.top('surf_a', 1)[0]?.name, 'Ana');
	});

	it('ranks update for others when someone passes them (PB that is not a record)', async () => {
		const carl = (await join('Carl')).c;
		assert.equal((await carl.auth('register', 'Carl', 'secret1')).ok, true);
		const c1 = await run(carl, 700);
		assert.ok(c1.type === 'runResult' && c1.records.rank === 3);
		await sleep(1100);
		// Carl passes Bob (640) but not Ana (512).
		const na = ana.messages.length;
		const nb = bob.messages.length;
		const c2 = await run(carl, 600);
		assert.ok(c2.type === 'runResult' && c2.pb && !c2.record && c2.records.rank === 2);
		const b = await bob.waitFor('records', () => true, nb);
		assert.deepEqual(own(b.records), { pbTicks: 640, pbSplits: [256], rank: 3, recordTicks: 512, recordName: 'Ana' });
		const a = await ana.waitFor('records', () => true, na);
		assert.equal(a.records.rank, 1);
		assert.equal(a.records.recordName, 'Ana');
		assert.deepEqual(top(b.records), ['1 Ana 512', '2 Carl 600', '3 Bob 640 *']);
		assert.deepEqual(top(a.records), ['1 Ana 512 *', '2 Carl 600', '3 Bob 640']);
		assert.deepEqual(top(c2.records), ['1 Ana 512', '2 Carl 600 *', '3 Bob 640']);
		carl.close();
		await sleep(100);
	});

	it("login mid-session sends the account's PB and rank; logout clears them", async () => {
		bob.close();
		await sleep(100);
		const w = (await join('Later')).welcome;
		const later = clients[clients.length - 1];
		assert.deepEqual(own(w.records), { pbTicks: null, pbSplits: null, rank: null, recordTicks: 512, recordName: 'Ana' });
		assert.deepEqual(top(w.records), ['1 Ana 512', '2 Carl 600', '3 Bob 640'], 'nothing is a guest\'s own');
		const auth = await later.auth('login', 'Bob', 'secret1');
		assert.ok(auth.ok && auth.records);
		if (!auth.ok) return;
		assert.deepEqual(own(auth.records), { pbTicks: 640, pbSplits: [256], rank: 3, recordTicks: 512, recordName: 'Ana' });
		const out = await later.auth('logout');
		assert.ok(out.ok);
		if (out.ok) assert.deepEqual(own(out.records!), { pbTicks: null, pbSplits: null, rank: null, recordTicks: 512, recordName: 'Ana' });
		const back = await later.auth('login', 'Bob', 'secret1');
		assert.ok(back.ok && back.records?.pbTicks === 640);
		// Token auto-login (hello) also carries the account's records in welcome.
		const token = back.ok ? back.token! : '';
		const t = new TestClient(server.port);
		clients.push(t);
		const tw = await t.hello('whatever', undefined, token);
		assert.deepEqual(own(tw.records), { pbTicks: 640, pbSplits: [256], rank: 3, recordTicks: 512, recordName: 'Ana' });
		t.close();
		await sleep(100);
	});

	it('records after a map change and after changing back', async () => {
		for (const c of clients) c.close();
		await sleep(200);
		const { c } = await join('Mapper');
		assert.equal((await c.auth('login', 'Ana', 'secret1')).ok, true);
		let n = c.messages.length;
		c.send({ type: 'changeMap', mapId: 'surf_b' });
		const b = await c.waitFor('mapChange', () => true, n);
		assert.equal(b.map, 'surf_b');
		assert.deepEqual(own(b.records), { pbTicks: null, pbSplits: null, rank: null, recordTicks: null, recordName: null });
		n = c.messages.length;
		c.send({ type: 'changeMap', mapId: 'surf_a' });
		const a = await c.waitFor('mapChange', () => true, n);
		assert.equal(a.map, 'surf_a');
		assert.deepEqual(own(a.records), { pbTicks: 512, pbSplits: [256], rank: 1, recordTicks: 512, recordName: 'Ana' });
		c.close();
	});
});
