/** Coins in Infected (docs/economy.md#infected): the real InfectedMode and economy on fake clocks. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INFECTED_PAY, pts, VIEW_HEIGHT, type MapDef, type Vec3 } from '@surf/shared';
import type { SimPlayer } from './economy-helpers.ts';
import { InfectedMode, type InfectedModeOptions } from './modes/infected.ts';
import { modeWorld } from './payout-helpers.ts';
import { testMap } from './test-helpers.ts';

const SPAWNS = [-1000, -500, 0, 500, 1000].map((x) => ({ pos: { x, y: -1100, z: 0.25 }, yaw: 0 }));
const MAP = {
	...testMap('inf_x'),
	kind: 'infected',
	layout: 'open',
	spawn: SPAWNS[0]!,
	spawns: SPAWNS,
	brushes: [{ type: 'box', min: { x: -3000, y: -3000, z: -64 }, max: { x: 3000, y: 3000, z: 0 }, material: 'm' }],
	zones: [{ type: 'teleport', min: { x: -9000, y: -9000, z: -3000 }, max: { x: 9000, y: 9000, z: -500 }, to: 'start' }]
} as MapDef;

/** `n` players, the round running; rng 0 makes the first one Patient Zero. */
function round(n: number, opts: InfectedModeOptions = {}) {
	const s = modeWorld(MAP, (h) => new InfectedMode(h, { graceSecs: 2, endSecs: 2, ...opts }));
	const ps = s.w.join(n);
	ps.forEach((p) => s.enter(p));
	const t = { s, ps, g: s.mode.game };
	start(t);
	return t;
}
type T = ReturnType<typeof round>;

function start({ s, ps, g }: { s: T['s']; ps: SimPlayer[]; g: T['g'] }): void {
	s.runUntil(() => g.phase === 'playing', 30);
	ps.forEach((p, i) => s.put(p, -1000 + i * 250, 1000));
	s.run(0.1);
}

function fire({ s, g }: T, by: SimPlayer, d: Vec3): void {
	const pos = by.state!;
	const l = Math.hypot(d.x, d.y, d.z);
	const weapon = g.playerView(by.id)!.weapon;
	const origin = { x: pos.x, y: pos.y, z: pos.z + VIEW_HEIGHT };
	s.send(by, { type: 'fire', weapon, origin, dir: { x: d.x / l, y: d.y / l, z: d.z / l }, tick: g.tick });
}
/** `by` (a survivor with the .50 cal, or any infected) gets `target` at close range. */
function hit(t: T, by: SimPlayer, target: SimPlayer): void {
	const { s, g } = t;
	const infected = g.playerView(by.id)!.team === 'infected';
	s.runUntil(() => g.playerView(by.id)!.alive && g.playerView(target.id)!.alive, 10);
	s.put(by, 0, -2000);
	s.put(target, 40, -2000);
	s.run(1.5); // cooldowns
	const ws = g.weaponOf(by.id)!;
	if (ws.mag <= 0 && ws.weapon !== 'claws' && ws.weapon !== 'knife') {
		g.reload(by.id, s.w.now);
		s.run(5);
	}
	s.put(by, 0, -2000);
	s.put(target, 40, -2000);
	const before = infected ? 'survivor' : true;
	fire(t, by, { x: 1, y: 0, z: 0 });
	const v = g.playerView(target.id)!;
	assert.ok(before === 'survivor' ? v.team === 'infected' : !v.alive, 'hit');
	for (const p of [by, target]) s.put(p, -2500 + p.id * 150, 2500);
}
const survivors = (t: T) => t.ps.filter((p) => t.g.playerView(p.id)?.team === 'survivor');
const toEnd = (t: T) => t.s.runUntil(() => t.g.phase === 'ended', 400);
const all = (t: T, reason: string) => t.ps.map((p) => t.s.paid(p, reason) / 10);

describe('infected: survivors', () => {
	it('1 point per 4 kills, each infected counts 4 times, with the multiplier', () => {
		const t = round(4);
		const [zero, a, b] = t.ps as [SimPlayer, SimPlayer, SimPlayer];
		for (let i = 0; i < 3; i++) hit(t, a, zero);
		assert.equal(t.s.paid(a, 'infKills'), 0);
		hit(t, a, zero);
		assert.equal(t.s.paid(a, 'infKills'), pts(1));
		assert.equal(t.s.w.db.accountStats(a.accountId!).pointsTotal, 13, '×1.3 with four');
		for (let i = 0; i < 4; i++) hit(t, a, zero);
		assert.equal(t.s.paid(a, 'infKills'), pts(1), 'fed kills of one infected');
		hit(t, zero, b);
		for (let i = 0; i < 4; i++) hit(t, a, b);
		assert.equal(t.s.paid(a, 'infKills'), pts(2));
	});

	it('specialist: 7-kill streak of two different infected, once per round', () => {
		const t = round(5);
		const [zero, a, b, c] = t.ps as [SimPlayer, SimPlayer, SimPlayer, SimPlayer];
		for (let i = 0; i < 8; i++) hit(t, a, zero);
		assert.equal(t.s.paid(a, 'infSpecialist'), 0, 'one victim only');
		hit(t, zero, b);
		hit(t, a, b);
		assert.equal(t.s.paid(a, 'infSpecialist'), pts(2));
		hit(t, a, b);
		assert.equal(t.s.paid(a, 'infSpecialist'), pts(2));
		hit(t, zero, c);
		// Infected: keeps it; the streak is over.
		hit(t, zero, a);
		assert.equal(t.s.paid(a, 'infSpecialist'), pts(2));
	});

	it('surviving: 4 when half were infected and the player fought, else 2', () => {
		const t = round(5);
		const [zero, a, b, c] = t.ps as [SimPlayer, SimPlayer, SimPlayer, SimPlayer];
		hit(t, zero, b);
		hit(t, zero, c);
		hit(t, a, b);
		toEnd(t);
		assert.deepEqual(all(t, 'infSurvive'), [0, 4, 0, 0, 2]);
		assert.deepEqual(all(t, 'infLast'), [0, 0, 0, 0, 0]);
		const easy = round(4);
		hit(easy, easy.ps[1]!, easy.ps[0]!);
		toEnd(easy);
		assert.deepEqual(all(easy, 'infSurvive'), [0, 2, 2, 2], 'nobody was infected');
	});

	it('the last survivor gets 3 more; an infected survivor keeps kill points but not the survival', () => {
		const t = round(4);
		const [zero, a, b, c] = t.ps as [SimPlayer, SimPlayer, SimPlayer, SimPlayer];
		for (let i = 0; i < 4; i++) hit(t, b, zero);
		hit(t, zero, b);
		hit(t, b, c);
		hit(t, a, c);
		toEnd(t);
		assert.deepEqual(all(t, 'infSurvive'), [0, 4, 0, 0]);
		assert.deepEqual(all(t, 'infLast'), [0, 3, 0, 0]);
		assert.deepEqual([t.s.paid(b, 'infKills'), t.s.paid(b, 'infInfect')], [pts(1), pts(1)], 'both halves of the round');
		assert.deepEqual(all(t, 'infWin'), [0, 0, 0, 0]);
	});

	it('M.O.A.B.: 8 to the caller, the next ones in the map session 1; its kills pay nothing else and are no contacts', () => {
		const t = round(5, { moabKills: 2, moabCountdownSecs: 1 });
		for (let i = 0; i < 2; i++) {
			const [zero, a, b] = t.ps as [SimPlayer, SimPlayer, SimPlayer];
			const kills = t.s.paid(a, 'infKills');
			hit(t, zero, b);
			hit(t, a, zero);
			hit(t, a, b);
			t.s.runUntil(() => t.g.playerView(zero.id)!.alive && t.g.playerView(b.id)!.alive, 10);
			const contacts: number[] = [];
			const eco = (t.s.mode as unknown as { host: { economy: { contact(a: number, b: number): void } } }).host.economy;
			const contact = eco.contact;
			eco.contact = (by) => void contacts.push(by);
			t.s.send(a, { type: 'callMoab' });
			toEnd(t);
			eco.contact = contact;
			assert.deepEqual(contacts, []);
			assert.equal(t.s.paid(a, 'infMoab'), pts(8 + i));
			assert.equal(t.s.paid(a, 'infKills'), kills);
			assert.deepEqual(all(t, 'infSurvive'), [0, 0, 0, 0, 0], 'it ended the round before the clock');
			if (i === 0) start(t);
		}
	});

	it('beacon: once per round, and only someone else’s', () => {
		const t = round(4);
		const [zero, a, b] = t.ps as [SimPlayer, SimPlayer, SimPlayer];
		const smash = (by: SimPlayer, owner: SimPlayer) => {
			t.s.put(owner, 600, 0);
			t.s.run(1.6);
			t.s.send(owner, { type: 'placeBeacon' });
			t.s.put(owner, 600, 2500);
			t.s.put(by, 400, 0);
			t.s.run(1.6);
			fire(t, by, { x: 200, y: 0, z: 10 - VIEW_HEIGHT });
			assert.equal(t.g.playerView(owner.id)!.hasBeacon, false, 'smashed');
		};
		smash(a, zero);
		assert.equal(t.s.paid(a, 'infBeacon'), pts(1));
		smash(a, zero);
		assert.equal(t.s.paid(a, 'infBeacon'), pts(1));
		(b as { accountId: number | null }).accountId = zero.accountId; // the same account twice
		smash(b, zero);
		assert.equal(t.s.paid(zero, 'infBeacon'), 0);
	});
});

describe('infected: the infected', () => {
	it('1 per infection, 2 for Patient Zero and 1 for others who infected someone when they win', () => {
		const t = round(5);
		const [zero, a, b, c, d] = t.ps as [SimPlayer, SimPlayer, SimPlayer, SimPlayer, SimPlayer];
		hit(t, zero, a);
		hit(t, a, b);
		t.s.run(65);
		hit(t, zero, c);
		hit(t, zero, d);
		toEnd(t);
		assert.deepEqual(all(t, 'infInfect'), [3, 1, 0, 0, 0]);
		assert.deepEqual(all(t, 'infWin'), [2, 1, 0, 0, 0]);
	});

	it('at most 5 infections per round', () => {
		const t = round(8);
		for (const p of t.ps.slice(1)) hit(t, t.ps[0]!, p);
		assert.equal(t.s.paid(t.ps[0]!, 'infInfect'), pts(5));
	});

	it('a bank shot pays 1 more, once per round', () => {
		const t = round(4);
		const pay = (t.s.mode as unknown as { pay(ev: unknown): void }).pay.bind(t.s.mode);
		for (const p of t.ps.slice(1, 3)) pay({ e: 'infect', id: p.id, by: t.ps[0]!.id, method: 'bank', timeAdded: 20 });
		assert.equal(t.s.paid(t.ps[0]!, 'infInfect'), pts(2));
		assert.equal(t.s.paid(t.ps[0]!, 'infBank'), pts(1));
	});

	it('throwing rounds away: no win pay before half the clock, and the infection stock runs dry', () => {
		const t = round(4);
		for (let r = 0; r < 12; r++) {
			const zero = t.ps.find((p) => t.g.playerView(p.id)!.team === 'infected')!;
			for (const p of t.ps) if (p !== zero) hit(t, zero, p);
			toEnd(t);
			start(t);
		}
		assert.deepEqual(all(t, 'infWin'), [0, 0, 0, 0]);
		const n = all(t, 'infInfect').reduce((x, y) => x + y, 0);
		assert.ok(n >= INFECTED_PAY.infectStock.max && n < 30, `${n} of 36 infections paid`);
	});

	it('a late joiner is infected, earns infections and the win; a leaver earns nothing more', () => {
		const t = round(5);
		const late = t.s.enter(t.s.w.join(1)[0]!);
		t.ps.push(late);
		t.s.run(65);
		const [zero, a, b, c, d] = t.ps as [SimPlayer, SimPlayer, SimPlayer, SimPlayer, SimPlayer];
		hit(t, late, a);
		hit(t, late, b);
		t.s.leave(c);
		hit(t, zero, d);
		toEnd(t);
		assert.deepEqual(all(t, 'infWin'), [2, 0, 0, 0, 0, 1]);
		assert.equal(t.s.paid(late, 'infInfect'), pts(2));
	});

	it('a player who reconnects keeps the round’s caps and roles', () => {
		const t = round(5);
		const zero = t.ps[0]!;
		hit(t, zero, t.ps[1]!);
		t.s.leave(zero);
		const back = t.s.enter(t.s.w.rejoin(zero));
		t.s.run(65);
		for (const p of t.ps.slice(2)) hit(t, back, p);
		toEnd(t);
		assert.equal(t.s.paid(back, 'infWin'), pts(2));
		assert.equal(t.s.paid(back, 'infInfect'), pts(4));
	});
});

describe('infected: rounds and activity', () => {
	it('a cancelled round pays no survival or win; three players earn nothing at all', () => {
		const t = round(4);
		hit(t, t.ps[0]!, t.ps[1]!);
		for (const p of t.ps.slice(1)) t.s.leave(p);
		assert.equal(t.g.phase, 'waiting');
		t.s.run(150);
		assert.deepEqual([all(t, 'infSurvive'), all(t, 'infWin')].flat(), [0, 0, 0, 0, 0, 0, 0, 0]);
		const three = round(3);
		hit(three, three.ps[0]!, three.ps[1]!);
		toEnd(three);
		assert.deepEqual([all(three, 'infInfect'), all(three, 'infSurvive')].flat(), [0, 0, 0, 0, 0, 0]);
	});

	it('a survivor who holds an angle and shoots is not AFK; one who only stands there is', () => {
		const t = round(5);
		const [, shooter, idle] = t.ps as [SimPlayer, SimPlayer, SimPlayer];
		t.s.afk.add(shooter.id).add(idle.id);
		for (let i = 0; i < 4; i++) {
			t.s.run(20);
			fire(t, shooter, { x: 0, y: 1, z: 0.2 });
		}
		assert.deepEqual([t.s.w.mode.isActive(shooter.id), t.s.w.mode.isActive(idle.id)], [true, false]);
		// Swinging a knife is no shot.
		t.s.send(shooter, { type: 'loadout', weapon: 'knife' });
		t.s.run(20);
		fire(t, shooter, { x: 0, y: 1, z: 0 });
		t.s.run(12);
		assert.equal(t.s.w.mode.isActive(shooter.id), false);
	});

	for (const n of [4, 5])
		it(`${n} friends killing and infecting each other for half an hour get no warning`, () => {
			const t = round(n);
			for (const end = t.s.w.now + 1_800_000; t.s.w.now < end; ) {
				const zero = t.ps.find((p) => t.g.playerView(p.id)!.team === 'infected')!;
				for (let i = 0; i < 6; i++) hit(t, survivors(t)[i % survivors(t).length]!, zero);
				hit(t, zero, survivors(t)[0]!);
				hit(t, survivors(t)[0]!, zero);
				toEnd(t);
				start(t);
			}
			assert.deepEqual(t.s.warnings(), []);
			for (const p of t.ps) assert.ok(t.s.w.economy.abuse.strikes(p.accountId!) <= 1);
		});
});
