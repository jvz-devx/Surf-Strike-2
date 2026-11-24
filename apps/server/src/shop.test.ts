/** Cosmetics shop (docs/economy.md#shop): purchases, equipping, guests, persistence, loadout broadcast. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Worker } from 'node:worker_threads';
import { COSMETIC_SLOTS, emptyLoadout, getCosmetic, pts, shopItems } from '@surf/shared';
import { Db } from './db.ts';
import { world } from './economy-helpers.ts';
import type { GameServer } from './server.ts';
import { startServer } from './server.ts';
import { sleep, TestClient, testMap } from './test-helpers.ts';

const PRICE = pts(75);
const give = (db: Db, accountId: number, tenths: number) =>
	db.payPoints({ accountId, at: 1, mode: 'surf', map: 'm', reason: 'playtime', label: 'x', base: tenths, counted: 0, mult: 10, amount: tenths });
const buyArgs = (accountId: number, item: string, amount = PRICE) => ({ accountId, at: 5, reason: `shop:${item}`, label: 'x', amount });

describe('buying (database)', () => {
	it('deducts, logs and grants together; refuses duplicates and missing coins', () => {
		const db = new Db(':memory:');
		const id = db.createAccount('Ana', 'h')!.id;
		assert.equal(db.buyItem(buyArgs(id, 'hat_cap'), 'hat_cap'), 'poor', 'no stats row yet');
		give(db, id, PRICE * 2 - 1);
		assert.equal(db.buyItem(buyArgs(id, 'hat_cap'), 'hat_cap'), 'ok');
		assert.equal(db.buyItem(buyArgs(id, 'hat_cap'), 'hat_cap'), 'owned');
		assert.equal(db.buyItem(buyArgs(id, 'hat_straw'), 'hat_straw'), 'poor', '0.1 coin short');
		assert.deepEqual(db.ownedItems(id), ['hat_cap']);
		assert.deepEqual(db.accountStats(id), { playtimeSecs: 0, pointsTotal: PRICE * 2 - 1, pointsBalance: PRICE - 1 });
		const log = db.recentPoints(id, 10).filter((r) => r.reason.startsWith('shop:'));
		assert.deepEqual(log.map((r) => [r.reason, r.amount]), [['shop:hat_cap', -PRICE]]);
		assert.equal(db.buyItem(buyArgs(999, 'hat_cap'), 'hat_cap'), 'poor', 'no such account');
		db.close();
	});

	it('nothing is taken when granting fails', () => {
		const db = new Db(':memory:');
		const id = db.createAccount('Ana', 'h')!.id;
		give(db, id, PRICE);
		db.db.exec(`CREATE TRIGGER boom BEFORE INSERT ON owned_items BEGIN SELECT RAISE(ABORT, 'boom'); END`);
		assert.throws(() => db.buyItem(buyArgs(id, 'hat_cap'), 'hat_cap'), /boom/);
		assert.equal(db.accountStats(id).pointsBalance, PRICE);
		assert.equal(db.recentPoints(id, 10).length, 1);
		db.close();
	});

	it('concurrent buyers on separate connections: one purchase, one payment', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'surf-shop-'));
		const path = join(dir, 'surf.db');
		try {
			const db = new Db(path);
			const id = db.createAccount('Ana', 'h')!.id;
			give(db, id, PRICE * 3);
			const gate = new Int32Array(new SharedArrayBuffer(4));
			const code = `
				import { workerData, parentPort } from 'node:worker_threads';
				const { Db } = await import(workerData.db);
				const db = new Db(workerData.path);
				parentPort.postMessage('ready');
				Atomics.wait(workerData.gate, 0, 0);
				const out = [];
				for (let i = 0; i < 20; i++) out.push(db.buyItem(workerData.args, 'hat_cap'));
				db.close();
				parentPort.postMessage(out);`;
			const results: string[] = [];
			const workers = Array.from(
				{ length: 3 },
				() =>
					new Worker(new URL(`data:text/javascript,${encodeURIComponent(code)}`), {
						workerData: { db: new URL('./db.ts', import.meta.url).href, path, gate, args: buyArgs(id, 'hat_cap') }
					})
			);
			const done = workers.map(
				(w) =>
					new Promise<void>((ok, fail) => {
						w.on('message', (m: string | string[]) => {
							if (Array.isArray(m)) results.push(...m);
						});
						w.on('error', fail);
						w.on('exit', () => ok());
					})
			);
			await Promise.race([Promise.all(workers.map((w) => new Promise((ok) => w.once('message', ok)))), Promise.all(done)]);
			Atomics.store(gate, 0, 1);
			Atomics.notify(gate, 0);
			await Promise.all(done);
			assert.equal(results.length, 60);
			assert.equal(results.filter((r) => r === 'ok').length, 1);
			assert.equal(results.filter((r) => r === 'owned').length, 59);
			assert.equal(db.accountStats(id).pointsBalance, PRICE * 2);
			assert.deepEqual(db.ownedItems(id), ['hat_cap']);
			db.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('equips owned items only, one per slot; rows go with the account', () => {
		const db = new Db(':memory:');
		const id = db.createAccount('Ana', 'h')!.id;
		give(db, id, PRICE * 2);
		assert.equal(db.equip(id, 'hat', 'hat_cap'), false);
		db.buyItem(buyArgs(id, 'hat_cap'), 'hat_cap');
		db.buyItem(buyArgs(id, 'hat_straw'), 'hat_straw');
		assert.equal(db.equip(id, 'hat', 'hat_cap'), true);
		assert.equal(db.equip(id, 'hat', 'hat_straw'), true);
		assert.deepEqual(db.equipped(id), { hat: 'hat_straw' });
		assert.equal(db.equip(id, 'hat', null), true);
		assert.deepEqual(db.equipped(id), {});
		db.equip(id, 'hat', 'hat_cap');
		db.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
		assert.deepEqual(db.ownedItems(id), []);
		assert.deepEqual(db.equipped(id), {});
		db.close();
	});

	it('a database of the previous schema gets the new tables and keeps its coins', () => {
		const dir = mkdtempSync(join(tmpdir(), 'surf-shop-'));
		const path = join(dir, 'surf.db');
		try {
			// The previous schema is this one without the two tables.
			const old = new Db(path);
			const id = old.createAccount('Ana', 'h')!.id;
			give(old, id, PRICE);
			old.db.exec('DROP TABLE equipped; DROP TABLE owned_items;');
			const rows = old.db.prepare('SELECT * FROM point_log').all();
			old.close();
			for (let i = 0; i < 2; i++) {
				const db = new Db(path);
				assert.deepEqual(db.db.prepare('SELECT * FROM point_log').all(), rows);
				assert.equal(db.accountStats(id).pointsBalance, PRICE);
				assert.deepEqual(db.ownedItems(id), []);
				db.close();
			}
			const db = new Db(path);
			assert.equal(db.buyItem(buyArgs(id, 'hat_cap'), 'hat_cap'), 'ok');
			db.equip(id, 'hat', 'hat_cap');
			assert.equal(db.db.pragma('integrity_check', { simple: true }), 'ok');
			assert.deepEqual(db.db.pragma('foreign_key_check'), []);
			db.close();
			const again = new Db(path);
			assert.deepEqual(again.equipped(id), { hat: 'hat_cap' });
			again.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('Economy.buy takes the price of the rarity and refuses unsold items', () => {
		const w = world(testMap());
		const [p] = w.join(1);
		give(w.db, p!.accountId!, PRICE * 2);
		assert.equal(w.economy.buy(p!.accountId!, getCosmetic('top_default')!), 'unknown');
		const before = w.sent(p!, 'coins').length;
		assert.equal(w.economy.buy(p!.accountId!, getCosmetic('top_sunset')!), 'ok');
		const coins = w.sent(p!, 'coins').slice(before);
		assert.equal(coins.length, 1);
		assert.equal(coins[0]!.balance, PRICE);
		assert.equal(coins[0]!.recent[0]!.label, 'Shop: Sunset tee');
	});
});

describe('shop on the server', () => {
	let server: GameServer;
	let dir: string;
	const clients: TestClient[] = [];
	const boot = () => startServer({ port: 0, host: '127.0.0.1', dbPath: join(dir, 'surf.db'), maps: [testMap()], initialMap: 'surf_test', log: () => {} });
	const connect = async (name: string, token?: string) => {
		const c = new TestClient(server.port);
		clients.push(c);
		const welcome = await c.hello(name, undefined, token);
		return { c, welcome };
	};
	const register = async (name: string, coins: number) => {
		const { c, welcome } = await connect(`${name}Guest`);
		const a = await c.auth('register', name, 'secret1');
		assert.ok(a.ok);
		const account = server.db.accountByName(name)!;
		if (coins) give(server.db, account.id, coins);
		return { c, id: welcome.selfId, accountId: account.id, token: a.ok ? a.token! : '' };
	};
	const request = async (c: TestClient, msg: unknown) => {
		const n = c.messages.length;
		c.send(msg);
		return c.waitFor('shopResult', () => true, n);
	};

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'surf-shop-'));
		server = await boot();
	});
	after(async () => {
		for (const c of clients) c.close();
		await server.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('guests see the stock but cannot buy or equip', async () => {
		const { c, welcome } = await connect('Guesty');
		const shop = await c.waitFor('shop');
		assert.deepEqual(shop.items, shopItems().map((i) => ({ id: i.id, price: PRICE })));
		assert.deepEqual(shop.owned, []);
		assert.deepEqual(shop.loadout, emptyLoadout());
		assert.equal('loadout' in welcome.players.find((p) => p.id === welcome.selfId)!, false);
		for (const msg of [
			{ type: 'shopBuy', item: 'hat_cap' },
			{ type: 'shopEquip', slot: 'hat', item: 'hat_cap' }
		]) {
			const r = await request(c, msg);
			assert.equal(r.ok, false);
			assert.match(r.error!, /Log in/);
		}
		c.close();
	});

	it('buy, equip, broadcast to others, welcome and join, unequip, reconnect, logout', async () => {
		const { c: other } = await connect('Watcher');
		const { c, id, token } = await register('Buyer', PRICE * 2);
		let r = await request(c, { type: 'shopEquip', slot: 'hat', item: 'hat_cap' });
		assert.match(r.error!, /do not own/);
		r = await request(c, { type: 'shopBuy', item: 'hat_cap' });
		assert.equal(r.ok, true);
		assert.equal(c.of('coins').at(-1)!.balance, PRICE);
		assert.deepEqual(c.of('shop').at(-1)!.owned, ['hat_cap']);
		assert.equal(other.of('cosmetics').length, 0, 'owning is not wearing');

		r = await request(c, { type: 'shopEquip', slot: 'hat', item: 'hat_cap' });
		assert.equal(r.ok, true);
		const seen = await other.waitFor('cosmetics');
		assert.deepEqual(seen, { type: 'cosmetics', id, loadout: { ...emptyLoadout(), hat: 'hat_cap' } });
		// Wearing it again changes nothing for the others.
		await request(c, { type: 'shopEquip', slot: 'hat', item: 'hat_cap' });
		await other.barrier();
		assert.equal(other.of('cosmetics').length, 1);

		// A player who joins later gets it with the player list.
		const { c: late, welcome } = await connect('Late');
		assert.equal(welcome.players.find((p) => p.id === id)!.loadout?.hat, 'hat_cap');
		late.close();

		// Reconnect with the session: still owned and worn; others hear it with `join`.
		c.close();
		await other.waitFor('leave', (m) => m.id === id);
		const n = other.messages.length;
		const back = await connect('x', token);
		assert.equal(back.welcome.players.find((p) => p.id === back.welcome.selfId)!.loadout?.hat, 'hat_cap');
		const shop = await back.c.waitFor('shop');
		assert.deepEqual([shop.owned, shop.loadout.hat], [['hat_cap'], 'hat_cap']);
		const joined = await other.waitFor('join', (m) => m.player.id === back.welcome.selfId, n);
		assert.equal(joined.player.loadout?.hat, 'hat_cap');

		r = await request(back.c, { type: 'shopEquip', slot: 'hat', item: null });
		assert.equal(r.ok, true);
		assert.deepEqual((await other.waitFor('cosmetics', () => true, n)).loadout, emptyLoadout());
		await request(back.c, { type: 'shopEquip', slot: 'hat', item: 'hat_cap' });
		await other.barrier();

		// Logging out takes it off, logging in puts it on.
		let m = other.messages.length;
		await back.c.auth('logout');
		assert.equal((await other.waitFor('cosmetics', () => true, m)).loadout.hat, null);
		await back.c.barrier();
		assert.deepEqual(back.c.of('shop').at(-1)!.owned, []);
		m = other.messages.length;
		await back.c.auth('login', 'Buyer', 'secret1');
		assert.equal((await other.waitFor('cosmetics', () => true, m)).loadout.hat, 'hat_cap');
		back.c.close();
		other.close();
	});

	it('refuses too few coins, duplicates, unknown and malformed requests without taking coins', async () => {
		const { c, accountId } = await register('Strict', PRICE * 2 - 1);
		const bad = async (msg: unknown, re: RegExp) => {
			const r = await request(c, msg);
			assert.equal(r.ok, false);
			assert.match(r.error!, re);
			await sleep(150); // below the rate limit
		};
		assert.equal((await request(c, { type: 'shopBuy', item: 'shoes_boots' })).ok, true);
		await bad({ type: 'shopBuy', item: 'shoes_boots' }, /already own/);
		await bad({ type: 'shopBuy', item: 'hat_cap' }, /Not enough/);
		for (const item of ['nope', 'top_default', '__proto__', 5, null, {}]) await bad({ type: 'shopBuy', item }, /not available/);
		await bad({ type: 'shopEquip', slot: 'hat', item: 'shoes_boots' }, /Invalid/);
		await bad({ type: 'shopEquip', slot: 'cape', item: null }, /Invalid/);
		await bad({ type: 'shopEquip', slot: 'shoes', item: 7 }, /Invalid/);
		await bad({ type: 'shopEquip', slot: 'shoes', item: 'shoes_slides' }, /do not own/);
		assert.equal(server.db.accountStats(accountId).pointsBalance, PRICE - 1);
		assert.deepEqual(server.db.ownedItems(accountId), ['shoes_boots']);
		c.close();
	});

	it('a double click buys once; a flood is refused', async () => {
		const { c, accountId } = await register('Clicker', PRICE * 20);
		const n = c.messages.length;
		for (let i = 0; i < 30; i++) c.send({ type: 'shopBuy', item: 'top_halves' });
		const results = () => c.messages.slice(n).flatMap((m) => (m.type === 'shopResult' ? [m] : []));
		await c.until(() => results().length === 30);
		assert.equal(results().filter((m) => m.ok).length, 1);
		assert.ok(results().some((m) => /Too fast/.test(m.error ?? '')));
		assert.equal(server.db.accountStats(accountId).pointsBalance, PRICE * 19);
		c.close();
	});

	it('two tabs of one account: one purchase', async () => {
		const { c, accountId, token } = await register('Twin', PRICE * 5);
		const second = new TestClient(server.port);
		clients.push(second);
		await second.open();
		second.send({ type: 'hello', playerId: crypto.randomUUID(), name: 'y', version: 1, token });
		for (const x of [c, second]) x.send({ type: 'shopBuy', item: 'bottom_cargo' });
		await second.waitFor('shopResult');
		assert.equal(server.db.accountStats(accountId).pointsBalance, PRICE * 4);
		assert.deepEqual(server.db.ownedItems(accountId), ['bottom_cargo']);
		second.close();
	});

	it('items of a newer version are ignored and kept; everything survives a restart', async () => {
		const { c, accountId, token } = await register('Future', PRICE);
		await request(c, { type: 'shopBuy', item: 'glasses_shades' });
		await request(c, { type: 'shopEquip', slot: 'glasses', item: 'glasses_shades' });
		const raw = server.db.db;
		raw.prepare('INSERT INTO owned_items VALUES (?, ?, 1, 750)').run(accountId, 'hat_2030');
		raw.prepare('INSERT INTO equipped VALUES (?, ?, ?), (?, ?, ?)').run(accountId, 'hat', 'hat_2030', accountId, 'cape', 'hat_2030');
		for (const x of clients) x.close();
		await server.close();
		server = await boot();
		const { c: again, welcome } = await connect('z', token);
		const me = welcome.players.find((p) => p.id === welcome.selfId)!;
		assert.deepEqual(me.loadout, { ...emptyLoadout(), glasses: 'glasses_shades' });
		assert.deepEqual(Object.keys(me.loadout!), [...COSMETIC_SLOTS]);
		assert.deepEqual((await again.waitFor('shop')).owned, ['glasses_shades']);
		assert.ok(server.db.ownedItems(accountId).includes('hat_2030'), 'kept for when the server knows it');
		again.close();
	});
});
