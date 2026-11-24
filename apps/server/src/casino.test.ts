/** Casino (docs/economy.md#casino): charging, paying, refusals, crash rounds, restart; and the welcome bonus. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { CASINO_RECENT, crashTime, pts, START_COINS, type ServerMessage } from '@surf/shared';
import { hashPassword } from './auth.ts';
import { Casino, secureRandom, type CasinoPlayer } from './casino.ts';
import { Db } from './db.ts';
import { world } from './economy-helpers.ts';
import type { GameServer } from './server.ts';
import { startServer } from './server.ts';
import { TestClient, testMap } from './test-helpers.ts';

/** A casino with a fake clock and scripted rolls. */
function table(coins = 1000, path = ':memory:') {
	const db = new Db(path);
	const account = db.accountByName('Ana')?.id ?? db.createAccount('Ana', 'h', 1, { reason: 'x', label: 'x', amount: pts(coins) })!.id;
	const sent: ServerMessage[] = [];
	const me: CasinoPlayer = { id: 1, accountId: account };
	const t = {
		db,
		account,
		me,
		sent,
		now: 1_700_000_000_000,
		clock: 500,
		rolls: [] as number[],
		online: true,
		casino: null as unknown as Casino<CasinoPlayer>,
		balance: () => db.accountStats(account).pointsBalance,
		/** Send a request; returns the messages it caused. */
		ask(msg: unknown, busy = false): ServerMessage[] {
			const n = sent.length;
			t.casino.handle(me, msg as never, busy);
			return sent.slice(n);
		},
		result(msg: unknown): Extract<ServerMessage, { type: 'casinoResult' }> {
			return t.ask(msg).find((m) => m.type === 'casinoResult') as never;
		},
		error(msg: unknown): string {
			const r = t.result(msg);
			assert.equal(r.ok, false);
			return r.ok ? '' : r.error;
		},
		/** Let ms pass, then tick. */
		run(ms: number): ServerMessage[] {
			const n = sent.length;
			t.clock += ms;
			t.casino.tick();
			return sent.slice(n);
		}
	};
	t.casino = new Casino<CasinoPlayer>(
		{
			db,
			now: () => t.now,
			clock: () => t.clock,
			players: () => (t.online ? [me] : []),
			send: (_, m) => void sent.push(m),
			balance: () => {},
			log: () => {}
		},
		() => t.rolls.shift() ?? 0
	);
	return t;
}

/** Source value that makes a round crash at `m` hundredths. */
const crashRoll = (m: number) => 1 - 100 / (m + 0.5);

describe('casino: coinflip and slots', () => {
	it('takes the bet and pays the result in one go; only the balance changes', () => {
		const t = table(100);
		t.rolls = [0.2, 0.7];
		assert.deepEqual(t.result({ type: 'casinoBet', game: 'coinflip', bet: 10, side: 'heads' }), {
			type: 'casinoResult', ok: true, net: pts(10), game: 'coinflip', bet: pts(10), payout: pts(20), picked: 'heads', side: 'heads'
		});
		assert.equal(t.balance(), pts(110));
		assert.equal(t.result({ type: 'casinoBet', game: 'coinflip', bet: 50, side: 'heads' }).ok, true);
		assert.equal(t.balance(), pts(60));
		t.rolls = [0.99, 0.99, 0];
		const s = t.result({ type: 'casinoBet', game: 'slots', bet: 2 });
		assert.ok(s.ok && s.game === 'slots' && s.payout === pts(20));
		assert.deepEqual(s.ok && s.game === 'slots' && s.reels, ['pearl', 'pearl', 'wave']);
		assert.equal(t.balance(), pts(78));
		t.rolls = [0, 0.4, 0.99];
		assert.ok(t.result({ type: 'casinoBet', game: 'slots', bet: 1 }).ok);
		assert.equal(t.balance(), pts(77));

		// Nothing else: no points, no point log (only the starting coins), nothing counted.
		assert.equal(t.db.accountStats(t.account).pointsTotal, 0);
		assert.equal(t.db.recentPoints(t.account, 50).length, 1);
		assert.equal(t.db.countedSince(t.account, 0), 0);
		assert.deepEqual(t.db.recentCasino(t.account, 10).map((r) => [r.game, r.bet, r.payout]), [
			['slots', 10, 0],
			['slots', 20, 200],
			['coinflip', 500, 0],
			['coinflip', 100, 200]
		]);
		assert.equal(t.db.casinoNet(t.account), pts(-23));
	});

	it('refuses guests, missing coins, bad bets, floods and nonsense without taking anything', () => {
		const t = table(20);
		const flip = (bet: unknown, side: unknown = 'heads') => t.error({ type: 'casinoBet', game: 'coinflip', bet, side });
		assert.match(flip(9), /smallest bet is 10/);
		assert.match(flip(501), /largest bet is 500/);
		assert.match(flip(21), /Not enough/);
		for (const bad of [10.5, '10', null, undefined, NaN, {}, -10.5]) assert.match(flip(bad), /whole coins/);
		for (const bad of ['edge', null, 1]) assert.match(flip(10, bad), /Invalid/);
		assert.match(t.error({ type: 'casinoBet', game: 'slots', bet: 0 }), /smallest bet is 1 coin\./);
		assert.match(t.error({ type: 'casinoBet', game: 'crash', bet: 4, auto: null }), /smallest bet is 5/);
		for (const auto of [100, 50, 10_001, 1.5, '200', {}]) assert.match(t.error({ type: 'casinoBet', game: 'crash', bet: 5, auto }), /Invalid/);
		for (const game of ['roulette', '__proto__', null, 5]) assert.match(t.error({ type: 'casinoBet', game, bet: 10 }), /Invalid/);
		assert.match(t.error({ type: 'crashCashout' }), /No crash round/);
		const busy = t.ask({ type: 'casinoBet', game: 'slots', bet: 1 }, true)[0]!;
		assert.ok(busy.type === 'casinoResult' && !busy.ok && /Too fast/.test(busy.error));
		Object.assign(t.me, { accountId: null });
		for (const game of ['coinflip', 'crash', 'slots']) assert.match(t.error({ type: 'casinoBet', game, bet: 10, side: 'heads', auto: null }), /Log in/);
		assert.equal(t.balance(), pts(20));
		assert.equal(t.db.recentCasino(t.account, 10).length, 0);
	});

	it('the balance never goes below zero, and a failing write takes nothing', () => {
		const t = table(10);
		assert.equal(t.result({ type: 'casinoBet', game: 'coinflip', bet: 10, side: 'tails' }).ok, true); // roll 0: heads
		assert.equal(t.balance(), 0);
		assert.match(t.error({ type: 'casinoBet', game: 'slots', bet: 1 }), /Not enough/);
		const u = table(10);
		u.db.db.exec(`CREATE TRIGGER boom BEFORE INSERT ON casino_log BEGIN SELECT RAISE(ABORT, 'boom'); END`);
		assert.match(u.error({ type: 'casinoBet', game: 'slots', bet: 5 }), /Nothing was taken/);
		assert.equal(u.balance(), pts(10));
		assert.equal(u.db.casinoNet(u.account), 0);
	});

	it('the real random source is uniform in [0, 1)', () => {
		const n = 20_000;
		const rolls = Array.from({ length: n }, secureRandom);
		assert.ok(rolls.every((r) => r >= 0 && r < 1));
		assert.ok(Math.abs(rolls.filter((r) => r < 0.5).length / n - 0.5) < 0.02);
	});

	it('keeps the newest bets per account and all sums; the Coins view shows bets among the rest', () => {
		const t = table(400);
		for (let i = 0; i < CASINO_RECENT + 4; i++) t.db.casinoPlay(t.account, { at: t.now + i, game: 'slots', bet: pts(1), payout: i % 3 === 0 ? pts(1) : 0 });
		const n = t.db.db.prepare('SELECT COUNT(*) AS n FROM casino_log').get() as { n: number };
		assert.equal(n.n, CASINO_RECENT);
		assert.equal(t.db.casinoNet(t.account), -pts(CASINO_RECENT + 4) + pts(Math.ceil((CASINO_RECENT + 4) / 3)));
		t.now += 10_000;
		t.db.casinoPlay(t.account, { at: t.now, game: 'coinflip', bet: pts(10), payout: pts(20) });
		t.db.spendPoints({ accountId: t.account, at: t.now + 1, reason: 'shop:hat_cap', label: 'Shop: Breakline cap', amount: pts(30) });
		t.db.casinoPlay(t.account, { at: t.now + 2, game: 'crash', bet: pts(5), payout: 0 });
		const recent = t.db.recentMoney(t.account, 30);
		assert.equal(recent.length, 30);
		assert.deepEqual(recent.slice(0, 5).map((r) => [r.reason, r.label, r.amount]), [
			['casino:crash', 'Crash lost', -pts(5)],
			['shop:hat_cap', 'Shop: Breakline cap', -pts(30)],
			['casino:coinflip', 'Coinflip won', pts(10)],
			['casino:slots', 'Slots bet returned', 0],
			['casino:slots', 'Slots lost', -pts(1)]
		]);
		assert.deepEqual(Object.keys(recent[0]!).sort(), ['amount', 'at', 'label', 'mult', 'reason']);
	});
});

describe('casino: crash', () => {
	const bet = (b: number, auto: number | null = null) => ({ type: 'casinoBet', game: 'crash', bet: b, auto });

	it('takes the bet at the start, never shows the crash point, pays at the multiplier on the server clock', () => {
		const t = table(100);
		t.rolls = [crashRoll(300)];
		const started = t.ask(bet(20));
		assert.deepEqual(started, [{ type: 'crashStart', bet: pts(20), auto: null }]);
		assert.equal(t.balance(), pts(80));
		assert.deepEqual(t.run(6000), [], 'nothing is sent while it runs');
		assert.deepEqual(t.ask({ type: 'crashCashout' }), [
			{ type: 'casinoResult', ok: true, net: pts(20), game: 'crash', bet: pts(20), payout: pts(40), at: 200, crash: 300 }
		]);
		assert.equal(t.balance(), pts(120));
		assert.match(t.error({ type: 'crashCashout' }), /No crash round/);
		assert.deepEqual(t.run(60_000), []);
	});

	it('a cash-out after the crash is too late, also before the server ticked', () => {
		const t = table(100);
		t.rolls = [crashRoll(150)];
		t.ask(bet(20));
		t.clock += crashTime(150) + 1;
		const [r] = t.ask({ type: 'crashCashout' });
		assert.ok(r?.type === 'casinoResult' && r.ok && r.game === 'crash');
		assert.deepEqual(r.ok && r.game === 'crash' && [r.at, r.payout, r.crash], [null, 0, 150]);
		assert.equal(t.balance(), pts(80));
		assert.deepEqual(t.db.recentCasino(t.account, 5).map((x) => [x.game, x.bet, x.payout]), [['crash', 200, 0]]);
	});

	it('a moment before the crash still counts', () => {
		const t = table(100);
		t.rolls = [crashRoll(150)];
		t.ask(bet(20));
		t.clock += crashTime(150) - 1;
		const [r] = t.ask({ type: 'crashCashout' });
		assert.ok(r?.type === 'casinoResult' && r.ok && r.game === 'crash' && r.at === 149 && r.payout === 298);
		assert.equal(t.balance(), pts(80) + 298);
	});

	it('the automatic cash-out pays its own value however late the tick, and loses when the crash comes first', () => {
		const t = table(100);
		t.rolls = [crashRoll(400), crashRoll(199), crashRoll(9_999_999)];
		t.ask(bet(10, 200));
		assert.deepEqual(t.run(crashTime(200) - 5), []);
		const [won] = t.run(30_000);
		assert.ok(won?.type === 'casinoResult' && won.ok && won.game === 'crash' && won.at === 200 && won.payout === pts(20));
		t.ask(bet(10, 200));
		const [lost] = t.run(30_000);
		assert.ok(lost?.type === 'casinoResult' && lost.ok && lost.game === 'crash' && lost.at === null && lost.payout === 0);
		// 100× is cashed out by itself.
		t.ask(bet(10));
		assert.deepEqual(t.run(39_000), []);
		const [cap] = t.run(1000);
		assert.ok(cap?.type === 'casinoResult' && cap.ok && cap.game === 'crash' && cap.at === 10_000 && cap.payout === pts(1000) && cap.crash === 10_000);
	});

	it('one open round per account; the other games go on', () => {
		const t = table(100);
		t.rolls = [crashRoll(300)];
		t.ask(bet(20));
		assert.match(t.error(bet(20)), /still running/);
		assert.equal(t.balance(), pts(80));
		assert.equal(t.db.crashOpen(t.account, 1, pts(5)), 'open', 'the database says so too');
		assert.equal(t.balance(), pts(80));
		assert.ok(t.result({ type: 'casinoBet', game: 'slots', bet: 1 }).ok);
	});

	it('goes on without a connection; whoever comes back gets the running round or finds the result', () => {
		const t = table(100);
		t.rolls = [crashRoll(300), crashRoll(150)];
		t.ask(bet(10, 200));
		t.run(1000);
		t.casino.send(t.me);
		const again = t.sent.at(-1)!;
		assert.ok(again.type === 'casino');
		assert.deepEqual(again.type === 'casino' && again.crash, { bet: pts(10), auto: 200, elapsed: 1000 });
		assert.equal(JSON.stringify(again).includes('300'), false, 'no crash point');
		t.online = false;
		assert.deepEqual(t.run(30_000), []);
		assert.equal(t.balance(), pts(110), 'the automatic cash-out was applied');
		t.ask(bet(10));
		t.run(30_000);
		assert.equal(t.balance(), pts(100), 'without one the bet is lost');
		t.casino.send(t.me);
		const back = t.sent.at(-1)!;
		assert.ok(back.type === 'casino' && back.crash === undefined && back.net === 0);
		assert.deepEqual(back.type === 'casino' && back.recent.map((r) => r.payout), [0, pts(20)]);
	});

	it('a result that cannot be written is kept and tried again', () => {
		const t = table(100);
		t.rolls = [crashRoll(300)];
		t.ask(bet(10));
		t.db.db.exec(`CREATE TRIGGER boom BEFORE INSERT ON casino_log BEGIN SELECT RAISE(ABORT, 'boom'); END`);
		t.clock += 6000;
		assert.deepEqual(t.ask({ type: 'crashCashout' }), []);
		assert.equal(t.balance(), pts(90));
		t.db.db.exec('DROP TRIGGER boom');
		const [r] = t.run(5000);
		assert.ok(r?.type === 'casinoResult' && r.ok && r.game === 'crash' && r.at === 200);
		assert.equal(t.balance(), pts(110));
	});

	it('a restart gives open bets back, once', () => {
		const dir = mkdtempSync(join(tmpdir(), 'surf-casino-'));
		try {
			const path = join(dir, 'surf.db');
			const t = table(100, path);
			t.ask(bet(40));
			assert.equal(t.balance(), pts(60));
			const u = table(0, path); // the next start
			assert.equal(u.balance(), pts(100));
			// The old process can no longer pay it.
			t.clock += 3000;
			assert.equal(t.ask({ type: 'crashCashout' }).some((m) => m.type === 'casinoResult'), false);
			assert.equal(u.balance(), pts(100));
			u.casino.send(u.me);
			u.casino.send(u.me);
			const notices = u.sent.filter((m) => m.type === 'coinsNotice');
			assert.equal(notices.length, 1);
			assert.match(notices[0]!.type === 'coinsNotice' ? notices[0]!.text : '', /40 coins/);
			assert.equal(table(0, path).balance(), pts(100));
			t.db.close();
			u.db.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('welcome bonus and limits (database, economy)', () => {
	it('is written with the account: balance only, one log row, not counted', () => {
		const db = new Db(':memory:');
		const id = db.createAccount('Ana', 'h', 5, { reason: 'welcome', label: 'Welcome bonus', amount: START_COINS })!.id;
		assert.deepEqual(db.accountStats(id), { playtimeSecs: 0, pointsTotal: 0, pointsBalance: pts(100) });
		assert.deepEqual(db.recentPoints(id, 5), [{ at: 5, reason: 'welcome', label: 'Welcome bonus', amount: pts(100), mult: 10 }]);
		assert.equal(db.countedSince(id, 0), 0);
		// Taken name: nothing is written. Failing log: no account either.
		assert.equal(db.createAccount('ANA', 'h', 5, { reason: 'welcome', label: 'x', amount: START_COINS }), null);
		db.db.exec(`CREATE TRIGGER boom BEFORE INSERT ON point_log BEGIN SELECT RAISE(ABORT, 'boom'); END`);
		assert.throws(() => db.createAccount('Bob', 'h', 5, { reason: 'welcome', label: 'x', amount: START_COINS }), /boom/);
		assert.equal(db.accountByName('Bob'), null);
		db.close();
	});

	it('casino bets leave the backstop and playtime alone', () => {
		const w = world(testMap());
		const [a] = w.join(1);
		w.db.adjustBalance({ accountId: a!.accountId!, at: 1, reason: 'x', label: 'x' }, pts(400));
		w.db.casinoPlay(a!.accountId!, { at: w.now, game: 'slots', bet: pts(300), payout: pts(5000) });
		assert.equal(w.db.countedSince(a!.accountId!, 0), 0);
		assert.equal(w.activeMs(a!), 0);
	});
});

describe('casino (real server)', () => {
	let server: GameServer;
	let dir: string;
	let now = 1_700_000_000_000;
	const rolls: number[] = [];
	const clients: TestClient[] = [];
	const boot = () =>
		startServer({
			port: 0, host: '127.0.0.1', dbPath: join(dir, 'surf.db'), maps: [testMap()], initialMap: 'surf_test', log: () => {}, timers: false,
			now: () => now,
			casinoRandom: () => rolls.shift() ?? 0
		});
	const connect = async (token?: string) => {
		const c = new TestClient(server.port);
		clients.push(c);
		await c.hello('Guest', undefined, token);
		return c;
	};
	const register = async (name: string) => {
		const c = await connect();
		const a = await c.auth('register', name, 'secret1');
		assert.ok(a.ok);
		return { c, id: server.db.accountByName(name)!.id, token: a.ok ? a.token! : '' };
	};
	const ask = async (c: TestClient, msg: unknown) => {
		const n = c.messages.length;
		c.send(msg);
		return c.waitFor('casinoResult', () => true, n);
	};

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'surf-casino-'));
		server = await boot();
	});
	after(async () => {
		for (const c of clients) c.close();
		await server.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('registering pays 100 coins with a notice; old accounts and logins get nothing', async () => {
		const { c, id } = await register('Fresh');
		await c.barrier();
		assert.match(c.of('coinsNotice').at(-1)!.text, /start with 100 coins/);
		const coins = c.of('coins').at(-1)!;
		assert.deepEqual([coins.total, coins.balance, coins.recent.map((r) => r.reason)], [0, pts(100), ['welcome']]);
		await c.auth('logout');
		const n = c.messages.length;
		await c.auth('login', 'Fresh', 'secret1');
		await c.barrier();
		assert.equal(c.messages.slice(n).some((m) => m.type === 'coinsNotice'), false);
		assert.equal(server.db.accountStats(id).pointsBalance, pts(100));
		// An account of before.
		const old = server.db.createAccount('Veteran', await hashPassword('secret1'))!.id;
		const v = await connect();
		await v.auth('login', 'Veteran', 'secret1');
		await v.barrier();
		assert.equal(server.db.accountStats(old).pointsBalance, 0);
	});

	it('is announced to everyone, guests can only look', async () => {
		const g = await connect();
		const m = await g.waitFor('casino');
		assert.deepEqual(m, { type: 'casino', min: { coinflip: 10, crash: 5, slots: 1 }, max: 500, net: 0, recent: [] });
		const r = await ask(g, { type: 'casinoBet', game: 'slots', bet: 1 });
		assert.ok(!r.ok && /Log in/.test(r.error));
	});

	it('a bet reports the new balance; a flood is refused', async () => {
		const { c, id } = await register('Flood');
		rolls.push(0.9);
		const r = await ask(c, { type: 'casinoBet', game: 'coinflip', bet: 10, side: 'tails' });
		assert.ok(r.ok && r.payout === pts(20));
		assert.equal(c.of('coins').at(-1)!.balance, pts(110));
		await new Promise((ok) => setTimeout(ok, 1100));
		const n = c.messages.length;
		for (let i = 0; i < 20; i++) c.send({ type: 'casinoBet', game: 'coinflip', bet: 10, side: 'tails' }); // roll 0: heads
		const results = () => c.messages.slice(n).flatMap((m) => (m.type === 'casinoResult' ? [m] : []));
		await c.until(() => results().length === 20);
		assert.equal(results().filter((m) => m.ok).length, 5);
		assert.ok(results().slice(5).every((m) => !m.ok && /Too fast/.test(m.error)));
		assert.equal(server.db.accountStats(id).pointsBalance, pts(60));
	});

	it('two tabs of one account share the crash round; the round survives a disconnect', async () => {
		const { c, id, token } = await register('Twin');
		rolls.push(crashRoll(300));
		c.send({ type: 'casinoBet', game: 'crash', bet: 10, auto: null });
		await c.waitFor('crashStart');
		const second = await connect(token);
		const st = await second.waitFor('casino');
		assert.deepEqual([st.crash?.bet, st.crash?.auto, typeof st.crash?.elapsed], [pts(10), null, 'number']);
		const r = await ask(second, { type: 'casinoBet', game: 'crash', bet: 10, auto: null });
		assert.ok(!r.ok && /still running/.test(r.error));
		assert.equal(server.db.accountStats(id).pointsBalance, pts(90));
		now += 6000;
		const won = await ask(second, { type: 'crashCashout' });
		assert.ok(won.ok && won.game === 'crash' && won.at === 200 && won.payout === pts(20));

		rolls.push(crashRoll(300));
		second.send({ type: 'casinoBet', game: 'crash', bet: 10, auto: 150 });
		await second.waitFor('crashStart');
		second.close();
		await second.until(() => second.closed);
		now += 30_000;
		server.lobby.tickMode();
		assert.equal(server.db.accountStats(id).pointsBalance, pts(115));
	});

	it('logging out ends nothing; a restart gives the bet back', async () => {
		const { c, id, token } = await register('Leaver');
		c.send({ type: 'casinoBet', game: 'crash', bet: 30, auto: null });
		rolls.push(crashRoll(5000));
		await c.waitFor('crashStart');
		await c.auth('logout');
		assert.equal(server.db.accountStats(id).pointsBalance, pts(70));
		for (const x of clients) x.close();
		await server.close();
		server = await boot();
		assert.equal(server.db.accountStats(id).pointsBalance, pts(100));
		const again = new TestClient(server.port);
		clients.push(again);
		await again.hello('x');
		await again.auth('login', 'Leaver', 'secret1');
		await again.barrier();
		assert.match(again.of('coinsNotice').at(-1)!.text, /given back/);
		assert.ok(token);
	});
});
