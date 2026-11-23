import { describe, expect, it } from 'vitest';
import { buildCollisionWorld } from '../../collision/world.ts';
import type { MapDef } from '../../maps/types.ts';
import { VIEW_HEIGHT } from '../../movement/api.ts';
import type { Vec3 } from '../../types.ts';
import { headCentre } from '../zombies/hitbox.ts';
import { WEAPONS } from '../zombies/weapons.ts';
import {
	INF_AMMO,
	INF_BEACON_COOLDOWN_MS,
	INF_BEACON_HIT_Z,
	INF_INFECTED_HP,
	INF_INFECTED_SPEED,
	INF_INFECTION_BONUS_SECS,
	INF_KNIFE_LIFETIME_SECS,
	INF_KNIFE_REST_SPEED,
	INF_KNIFE_WALL_REACH,
	INF_MOAB_COUNTDOWN_SECS,
	INF_MOAB_KILLS,
	INF_PERK_KILLS,
	INF_PRESETS,
	INF_SCORE_MOAB,
	INF_SCORE_SPECIALIST,
	INF_SECONDARY,
	INF_SLEIGHT_RELOAD_FACTOR,
	INF_SPECIALIST_CADENCE_FACTOR,
	INF_SPECIALIST_HP,
	INF_SPECIALIST_KNOCKBACK_FACTOR,
	INF_STEADY_SPEED_FACTOR,
	INF_SCORE_INFECT,
	INF_SCORE_KILL,
	INF_SCORE_KNIFE_BONUS,
	INF_SCORE_BANK_BONUS,
	INF_SCORE_BEACON_DESTROY,
	INF_SCORE_SURVIVE_TICK,
	INF_SCORE_SURVIVE_WIN,
	INF_STEP_MS,
	InfectedGame,
	infEventRoute,
	infLoadout,
	infPerksForStreak,
	type InfectedGameOptions,
	type InfEvent
} from './index.ts';

type Ev<K extends InfEvent['e']> = Extract<InfEvent, { e: K }>;

const unit = (x: number, y: number, z: number): Vec3 => {
	const l = Math.hypot(x, y, z);
	return { x: x / l, y: y / l, z: z / l };
};

const SPAWNS = [
	{ pos: { x: -1000, y: -1000, z: 0.25 }, yaw: 0 },
	{ pos: { x: -1000, y: 1000, z: 0.25 }, yaw: 0 },
	{ pos: { x: 1000, y: -1000, z: 0.25 }, yaw: 180 },
	{ pos: { x: 1000, y: 1000, z: 0.25 }, yaw: 180 },
	{ pos: { x: 0, y: -1000, z: 0.25 }, yaw: 90 }
];

/** Floor, one thin wall at x 400..404, a fall-out box far below, five spread spawns. */
function testMap(): MapDef {
	return {
		id: 'inf_test',
		title: 'Test',
		kind: 'tag',
		difficulty: 'easy',
		layout: 'open',
		cvars: {},
		spawn: SPAWNS[0]!,
		spawns: SPAWNS,
		brushes: [
			{ type: 'box', min: { x: -1200, y: -1200, z: -64 }, max: { x: 1200, y: 1200, z: 0 }, material: 'm' },
			{ type: 'box', min: { x: 400, y: -300, z: 0 }, max: { x: 404, y: 300, z: 256 }, material: 'm' }
		],
		zones: [{ type: 'teleport', min: { x: -5000, y: -5000, z: -3000 }, max: { x: 5000, y: 5000, z: -500 }, to: 'start' }],
		theme: {
			skyTop: 0,
			skyHorizon: 0,
			skyBottom: 0,
			fogColor: 0,
			fogNear: 0,
			fogFar: 1,
			sunColor: 0,
			sunIntensity: 1,
			sunDir: { x: 0, y: 0, z: 1 },
			ambientSky: 0,
			ambientGround: 0,
			ambientIntensity: 1,
			materials: { m: { color: 0 } },
			effects: []
		}
	};
}

/** Harness options: `round` is the first round played (its preset: infLoadout(round)). */
type Opts = Partial<InfectedGameOptions> & { round?: number };
/** First round with the LMG preset (generic gun mechanics tests). */
const LMG: Opts = { round: 3 };

function newGame(ids: number[], opts: Opts = {}, map: MapDef = testMap()) {
	const clock = { now: 1_000_000 };
	const { round, ...gameOpts } = opts;
	const game = new InfectedGame({ map, world: buildCollisionWorld(map), now: clock.now, rng: () => 0, graceSecs: 1, endSecs: 1, ...gameOpts });
	if (round !== undefined) game.round = round - 1;
	const events: InfEvent[] = [];
	const advance = (ms: number) => {
		const end = clock.now + ms;
		while (clock.now < end) {
			clock.now = Math.min(end, clock.now + INF_STEP_MS);
			events.push(...game.update(clock.now));
		}
	};
	/** Step until an event matches (returns it) or `maxMs` passes. */
	const advanceUntil = <K extends InfEvent['e']>(e: K, maxMs: number): Ev<K> | null => {
		const end = clock.now + maxMs;
		while (clock.now < end) {
			clock.now += INF_STEP_MS;
			const out = game.update(clock.now);
			events.push(...out);
			const hit = out.find((ev) => ev.e === e);
			if (hit) return hit as Ev<K>;
		}
		return null;
	};
	const place = (id: number, x: number, y: number, z = 0, yaw = 0) => game.setPlayerPos(id, { x, y, z, ducked: false, yaw });
	const eye = (id: number): Vec3 => {
		const p = posOf(id);
		return { x: p.x, y: p.y, z: p.z + VIEW_HEIGHT };
	};
	const posOf = (id: number): Vec3 => {
		const ev = [...events].reverse().find((e): e is Ev<'spawn'> => e.e === 'spawn' && e.id === id);
		return placed.get(id) ?? (ev ? { x: ev.x, y: ev.y, z: ev.z } : { x: 0, y: 0, z: 0 });
	};
	const placed = new Map<number, Vec3>();
	const put = (id: number, x: number, y: number, z = 0, yaw = 0) => {
		placed.set(id, { x, y, z });
		place(id, x, y, z, yaw);
	};
	/** Fire at a point (head: head centre of a yaw-0 pose at `t`; body: 30 above feet). */
	const shoot = (id: number, t: Vec3, head: boolean, tick = game.tick) => {
		const o = eye(id);
		const aim = head ? headCentre({ ...t, yaw: 0 }) : { x: t.x, y: t.y, z: t.z + 30 };
		const weapon = game.weaponOf(id)!.weapon;
		const r = game.fire(id, { weapon, origin: o, dir: unit(aim.x - o.x, aim.y - o.y, aim.z - o.z), tick }, clock.now);
		events.push(...r.events);
		return r;
	};
	const of = <K extends InfEvent['e']>(e: K, list: InfEvent[] = events): Ev<K>[] => list.filter((ev): ev is Ev<K> => ev.e === e);
	game.syncPlayers(ids, clock.now);
	return { game, clock, events, advance, advanceUntil, put, eye, shoot, of };
}

/** A game in 'playing' with player 1 as Patient Zero (rng 0 picks the first id). */
function playing(ids: number[], opts: Opts = {}, map?: MapDef) {
	const g = newGame(ids, opts, map);
	g.advance(1100);
	expect(g.game.phase).toBe('playing');
	expect(g.game.alphaId).toBe(ids[0]);
	return g;
}

describe('rules data', () => {
	it('presets rotate barrett → striker → lmg → smg and limit ammo; the pistol is the secondary', () => {
		expect([1, 2, 3, 4, 5, 6].map(infLoadout)).toEqual(['barrett', 'striker', 'lmg', 'smg', 'barrett', 'striker']);
		expect(INF_PRESETS).toEqual(['barrett', 'striker', 'lmg', 'smg']);
		expect(INF_SECONDARY).toBe('pistol');
		expect(INF_AMMO.barrett).toEqual({ mag: 10, reserve: 20, scavenger: 10 });
		expect(INF_AMMO.striker).toEqual({ mag: 12, reserve: 24, scavenger: 12 });
		expect(INF_AMMO.lmg).toEqual({ mag: 100, reserve: 100, scavenger: 50 });
		expect(INF_AMMO.smg).toEqual({ mag: 36, reserve: 72, scavenger: 36 });
		expect(INF_AMMO.pistol).toEqual({ mag: 12, reserve: 36, scavenger: 12 });
	});

	it('routes private events to one player', () => {
		const o = { x: 0, y: 0, z: 0 };
		expect(infEventRoute({ e: 'ammo', id: 3, weapon: 'lmg', mag: 1, reserve: 1 })).toEqual({ to: 3 });
		expect(infEventRoute({ e: 'hurt', id: 4, hp: 1, stacks: 1, kx: 0, ky: 0 })).toEqual({ to: 4 });
		expect(infEventRoute({ e: 'hit', by: 5, targetId: 2, head: false, kill: false })).toEqual({ to: 5 });
		expect(infEventRoute({ e: 'shot', by: 6, weapon: 'lmg', o, d: o, len: 1 })).toEqual({ except: 6 });
		expect(infEventRoute({ e: 'infect', id: 1, by: 2, method: 'claws', timeAdded: 20 })).toEqual({});
		expect(infEventRoute({ e: 'knifePickup', id: 1, ownerId: 2 })).toEqual({});
		const spawn = { e: 'spawn', id: 7, x: 0, y: 0, z: 0, yaw: 0, hp: 5, team: 'survivor', alpha: false, weapon: 'lmg', mag: 1, reserve: 1, hasKnife: false, reason: 'round' } as const;
		expect(infEventRoute(spawn)).toEqual({ to: 7 });
	});
});

describe('round flow (fake clock)', () => {
	it('waits for 2 players, then a grace period with distinct spawns and the preset', () => {
		const g = newGame([1]);
		g.advance(3000);
		expect(g.game.phase).toBe('waiting');
		g.game.syncPlayers([1, 2, 3, 4], g.clock.now);
		g.advance(100);
		expect(g.game.phase).toBe('grace');
		expect(g.of('phase').at(-1)).toEqual({ e: 'phase', phase: 'grace', round: 1, loadout: 'barrett' });
		const spawns = g.of('spawn').filter((s) => s.reason === 'round');
		expect(spawns).toHaveLength(4);
		expect(new Set(spawns.map((s) => `${s.x},${s.y}`)).size).toBe(4);
		for (const s of spawns) {
			expect(s).toMatchObject({ team: 'survivor', alpha: false, weapon: 'barrett', mag: 10, reserve: 20, hasKnife: false, hp: 5 });
		}
	});

	it('picks Patient Zero at the end of grace: gun with fresh ammo, knife, 2:00 clock', () => {
		const g = newGame([1, 2, 3]);
		g.advance(500);
		g.shoot(1, { x: 0, y: 0, z: 0 }, false); // spend a round during grace
		expect(g.game.primaryOf(1)!.mag).toBe(9);
		g.game.selectWeapon(1, 'pistol', g.clock.now);
		g.shoot(1, { x: 0, y: 0, z: 0 }, false);
		expect(g.game.secondaryOf(1)!.mag).toBe(11);
		g.advance(600);
		expect(g.game.phase).toBe('playing');
		expect(g.of('alpha')).toEqual([{ e: 'alpha', id: 1 }]);
		expect(g.game.playerView(1)).toMatchObject({ team: 'infected', alpha: true, hp: INF_INFECTED_HP, weapon: 'barrett', hasKnife: true });
		expect(g.game.primaryOf(1)!.mag).toBe(10);
		expect(g.game.secondaryOf(1)!.mag).toBe(12);
		expect(g.game.view(g.clock.now).timeLeft).toBeCloseTo(120, 0);
		expect(g.game.view(g.clock.now)).toMatchObject({ survivors: 2, infected: 1, alphaId: 1, loadout: 'barrett', secondary: 'pistol', moab: null });
	});

	it('rotates the preset over four rounds', () => {
		const g = newGame([1, 2], { roundSecs: 1 });
		g.advance(16_000);
		const loadouts = g.of('phase').filter((p) => p.phase === 'grace').map((p) => p.loadout);
		expect(loadouts.slice(0, 5)).toEqual(['barrett', 'striker', 'lmg', 'smg', 'barrett']);
		const s = g.of('spawn').filter((e) => e.reason === 'round' && e.weapon === 'striker');
		expect(s[0]).toMatchObject({ mag: 12, reserve: 24 });
		const smg = g.of('spawn').filter((e) => e.reason === 'round' && e.weapon === 'smg');
		expect(smg[0]).toMatchObject({ mag: 36, reserve: 72 });
	});

	it('survivors win when the clock runs out: +250 each and the end summary', () => {
		const g = playing([1, 2, 3], { roundSecs: 2 });
		g.put(2, -1000, 1000);
		g.put(3, 1000, 1000);
		g.advance(2100);
		const end = g.of('end')[0]!;
		expect(end).toMatchObject({ winner: 'survivors', round: 1, survivorsLeft: 2, topScore: INF_SCORE_SURVIVE_WIN });
		expect([2, 3]).toContain(end.topId);
		expect(g.game.playerView(2)!.score).toBe(INF_SCORE_SURVIVE_WIN);
		expect(g.game.playerView(1)!.score).toBe(0);
		expect(g.game.phase).toBe('ended');
		g.advance(1100);
		expect(g.game.phase).toBe('grace');
		expect(g.game.round).toBe(2);
		expect(g.game.playerView(1)).toMatchObject({ team: 'survivor', alpha: false, score: 0, weapon: 'striker' });
	});

	it('infected win when the last survivor is infected', () => {
		const g = playing([1, 2]);
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		const r = g.shoot(1, { x: -300, y: 0, z: 0 }, true);
		expect(r.ok).toBe(true);
		g.advance(50);
		expect(g.of('end')[0]).toMatchObject({ winner: 'infected', survivorsLeft: 0, topId: 1, topScore: INF_SCORE_INFECT });
	});

	it('drops back to waiting below 2 players: knives cleared, everyone a survivor again', () => {
		const g = playing([1, 2]);
		g.put(1, -600, 600);
		g.put(2, 600, -600);
		expect(g.game.throwKnife(1, g.eye(1), unit(0, 0, -1), g.clock.now).ok).toBe(true);
		g.game.syncPlayers([1], g.clock.now);
		g.advance(50);
		expect(g.game.phase).toBe('waiting');
		expect(g.of('knifeRemove')).toHaveLength(1);
		expect(g.game.view(g.clock.now).knives).toEqual([]);
		expect(g.of('phase').at(-1)).toMatchObject({ phase: 'waiting' });
		expect(g.game.playerView(1)).toMatchObject({ team: 'survivor', alpha: false });
		expect(g.of('spawn').at(-1)).toMatchObject({ id: 1, team: 'survivor', x: -600, y: 600 });
	});

	it('late joiners: survivors during grace, infected (claws + knife) far from survivors while playing', () => {
		const g = newGame([1, 2]);
		g.advance(300);
		g.game.syncPlayers([1, 2, 7], g.clock.now);
		g.advance(20);
		expect(g.game.playerView(7)).toMatchObject({ team: 'survivor', weapon: 'barrett' });
		g.advance(1000);
		expect(g.game.phase).toBe('playing');
		g.put(2, -1000, -1000);
		g.put(7, -1000, -900);
		g.game.syncPlayers([1, 2, 7, 9], g.clock.now);
		g.advance(20);
		expect(g.game.playerView(9)).toMatchObject({ team: 'infected', alpha: false, weapon: 'claws', hasKnife: true });
		expect(g.of('spawn').find((s) => s.id === 9)).toMatchObject({ reason: 'join', x: 1000, y: 1000, team: 'infected' });
	});

	it('teleports players who fall into a teleport zone', () => {
		const g = playing([1, 2]);
		g.put(2, 0, 0, -1000);
		g.advance(50);
		const fall = g.of('spawn').find((s) => s.reason === 'fall');
		expect(fall).toMatchObject({ id: 2, team: 'survivor' });
	});
});

describe('Patient Zero', () => {
	it('body hits hurt survivors (slow + knockback); the fifth infects (gun) and costs the gun', () => {
		const g = playing([1, 2, 3], LMG);
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		g.put(3, 1000, 1000);
		const endsAt = g.game.endsAt;
		const r = g.shoot(1, { x: -300, y: 0, z: 0 }, false);
		expect(r.ok).toBe(true);
		expect(r.events.find((e) => e.e === 'hurt')).toMatchObject({ id: 2, hp: 4, stacks: 1, kx: WEAPONS.lmg.knockback });
		for (let i = 0; i < 4; i++) {
			g.advance(100);
			g.shoot(1, { x: -300, y: 0, z: 0 }, false);
		}
		const inf = g.of('infect');
		expect(g.events.filter((e) => e.e === 'hurt' && e.id === 2)).toHaveLength(4);
		expect(inf).toEqual([{ e: 'infect', id: 2, by: 1, method: 'gun', timeAdded: INF_INFECTION_BONUS_SECS }]);
		expect(g.game.endsAt).toBe(endsAt + INF_INFECTION_BONUS_SECS * 1000);
		expect(g.game.playerView(2)).toMatchObject({ team: 'infected', hp: INF_INFECTED_HP, weapon: 'claws', hasKnife: true, deaths: 1 });
		expect(g.game.playerView(1)).toMatchObject({ alpha: false, weapon: 'claws', score: INF_SCORE_INFECT, kills: 1, hasKnife: true });
		expect(g.game.playerView(3)!.score).toBe(INF_SCORE_SURVIVE_TICK);
		expect(g.game.selectWeapon(1, 'lmg', g.clock.now)).toEqual([]);
		const gun = g.game.fire(1, { weapon: 'lmg', origin: g.eye(1), dir: unit(1, 0, 0), tick: g.game.tick }, g.clock.now);
		expect(gun).toMatchObject({ ok: false, reason: 'wrong weapon' });
	});

	it('a headshot infects at once', () => {
		const g = playing([1, 2, 3]);
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		g.put(3, 1000, 1000);
		g.shoot(1, { x: -300, y: 0, z: 0 }, true);
		expect(g.of('infect')).toEqual([{ e: 'infect', id: 2, by: 1, method: 'gun', timeAdded: INF_INFECTION_BONUS_SECS }]);
		expect(g.of('hurt')).toEqual([]);
		expect(g.game.playerView(2)!.team).toBe('infected');
	});

	it('killed before the first infection: respawns in 3 s still as the Alpha with gun and knife', () => {
		const g = playing([1, 2, 3]);
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		g.put(3, 1000, 1000);
		g.shoot(2, { x: -600, y: 0, z: 0 }, true);
		expect(g.game.playerView(1)!.alive).toBe(false);
		g.advance(2900);
		expect(g.game.playerView(1)!.alive).toBe(false);
		g.advance(200);
		expect(g.game.playerView(1)).toMatchObject({ alive: true, alpha: true, weapon: 'barrett', hasKnife: true });
		expect(g.of('spawn').find((s) => s.id === 1 && s.reason === 'respawn')).toMatchObject({ alpha: true, weapon: 'barrett', mag: 10 });
	});

	it('the Alpha may swap to the knife; a knife swipe infects outright', () => {
		const g = playing([1, 2, 3]);
		g.put(1, -340, 0);
		g.put(2, -300, 0);
		g.put(3, 1000, 1000);
		expect(g.game.selectWeapon(1, 'knife', g.clock.now)).toEqual([{ e: 'ammo', id: 1, weapon: 'knife', mag: 0, reserve: 0 }]);
		g.shoot(1, { x: -300, y: 0, z: 0 }, false);
		expect(g.of('infect')[0]).toMatchObject({ id: 2, by: 1, method: 'claws' });
	});

	it('every infected leaving: a survivor takes over (Alpha before the first infection, else plain infected)', () => {
		const a = playing([1, 2, 3]);
		a.game.syncPlayers([2, 3], a.clock.now);
		a.advance(20);
		expect(a.of('alpha').at(-1)).toEqual({ e: 'alpha', id: 2 });
		expect(a.game.playerView(2)).toMatchObject({ team: 'infected', alpha: true, weapon: 'barrett', hasKnife: true });
		expect(a.game.alphaId).toBe(2);

		const b = playing([1, 2, 3, 4]);
		b.put(1, -600, 0);
		b.put(2, -300, 0);
		b.put(3, 1000, 1000);
		b.put(4, 1000, -1000);
		b.shoot(1, { x: -300, y: 0, z: 0 }, true);
		b.game.syncPlayers([3, 4], b.clock.now);
		b.advance(20);
		expect(b.of('infect').at(-1)).toEqual({ e: 'infect', id: 3, by: null, method: 'claws', timeAdded: 0 });
		expect(b.game.playerView(3)).toMatchObject({ team: 'infected', alpha: false, weapon: 'claws' });
		expect(b.game.phase).toBe('playing');
	});
});

describe('infected and survivors', () => {
	function withInfected(opts: Opts = LMG) {
		// 1 infects 2 (headshot): 1 and 2 are plain infected, 3 and 4 survive.
		const g = playing([1, 2, 3, 4], opts);
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		g.put(3, 1000, 1000);
		g.put(4, 1000, -1000);
		g.shoot(1, { x: -300, y: 0, z: 0 }, true);
		g.advance(20);
		expect(g.game.playerView(2)!.team).toBe('infected');
		return g;
	}

	it('claws infect in one swipe, but not through a wall', () => {
		const g = withInfected();
		g.put(2, 370, 0);
		g.put(3, 430, 0); // behind the thin wall at x 400
		g.shoot(2, { x: 430, y: 0, z: 0 }, false);
		expect(g.game.playerView(3)!.team).toBe('survivor');
		g.put(3, 340, 0);
		g.advance(1000);
		g.shoot(2, { x: 340, y: 0, z: 0 }, false);
		expect(g.of('infect').at(-1)).toMatchObject({ id: 3, by: 2, method: 'claws' });
		expect(g.game.playerView(4)!.score).toBe(2 * INF_SCORE_SURVIVE_TICK);
	});

	it('survivor fire: 5 LMG body hits or one headshot kill; kill score and scavenger ammo', () => {
		const g = withInfected();
		g.put(3, -600, 600);
		g.put(2, -600, 300);
		for (let i = 0; i < 4; i++) {
			g.shoot(3, { x: -600, y: 300, z: 0 }, false);
			g.advance(100);
		}
		expect(g.game.playerView(2)).toMatchObject({ alive: true, hp: 1 });
		const r = g.shoot(3, { x: -600, y: 300, z: 0 }, false);
		expect(r.events.find((e) => e.e === 'kill')).toMatchObject({ by: 3, targetId: 2, weapon: 'lmg', head: false });
		// Before the scavenger perk (3 kills): an emergency refill of 40 % of INF_AMMO.lmg.scavenger.
		expect(r.events.find((e) => e.e === 'ammo')).toEqual({ e: 'ammo', id: 3, weapon: 'lmg', mag: 95, reserve: 120, scavenger: true });
		expect(g.game.playerView(2)).toMatchObject({ alive: false, deaths: 2 });
		expect(g.game.playerView(3)).toMatchObject({ kills: 1, score: INF_SCORE_KILL + INF_SCORE_SURVIVE_TICK });

		g.put(1, -300, 600);
		g.game.primaryOf(3)!.reserve = 280;
		g.advance(100);
		const h = g.shoot(3, { x: -300, y: 600, z: 0 }, true);
		expect(h.events.find((e) => e.e === 'hit')).toMatchObject({ targetId: 1, head: true, kill: true });
		expect(g.game.primaryOf(3)!.reserve).toBe(WEAPONS.lmg.reserve);
	});

	it('killed infected respawn after 3 s at the spawn farthest from the survivors', () => {
		const g = withInfected();
		g.put(3, -1000, -1000);
		g.put(4, -1000, -900);
		g.put(2, -600, -1000);
		g.shoot(3, { x: -600, y: -1000, z: 0 }, true);
		g.advance(3100);
		expect(g.of('spawn').find((s) => s.id === 2 && s.reason === 'respawn')).toMatchObject({ x: 1000, y: 1000, team: 'infected', weapon: 'claws', hasKnife: true });
	});

	it('weapon swap keeps magazine and reserve, and cancels a reload', () => {
		const g = withInfected();
		g.put(3, 1000, 1000);
		for (let i = 0; i < 3; i++) {
			g.shoot(3, { x: 1000, y: 0, z: 0 }, false);
			g.advance(100);
		}
		expect(g.game.reload(3, g.clock.now)).toBe(true);
		expect(g.game.selectWeapon(3, 'knife', g.clock.now)).toEqual([{ e: 'ammo', id: 3, weapon: 'knife', mag: 0, reserve: 0 }]);
		expect(g.game.selectWeapon(3, 'lmg', g.clock.now)).toEqual([{ e: 'ammo', id: 3, weapon: 'lmg', mag: 97, reserve: 100 }]);
		expect(g.game.weaponOf(3)!.reloading(g.clock.now)).toBe(false);
		expect(g.game.selectWeapon(3, 'sniper', g.clock.now)).toEqual([]);
		expect(g.game.selectWeapon(2, 'knife', g.clock.now)).toEqual([]);
	});

	it('move speed: claws vs held gun', () => {
		const g = withInfected();
		expect(g.game.moveSpeed(2)).toBe(INF_INFECTED_SPEED);
		expect(g.game.moveSpeed(3)).toBe(WEAPONS.lmg.moveSpeed);
		g.game.selectWeapon(3, 'knife', g.clock.now);
		expect(g.game.moveSpeed(3)).toBe(WEAPONS.knife.moveSpeed);
	});

	it('lag compensation: an old tick hits where the target was; beyond 400 ms it clamps', () => {
		const g = withInfected();
		g.put(3, -600, -600);
		g.put(2, 0, -600);
		g.advance(500);
		const tickA = g.game.tick;
		g.put(2, 0, -900);
		g.advance(100);
		const hit = g.shoot(3, { x: 0, y: -600, z: 0 }, false, tickA);
		expect(hit.events.find((e) => e.e === 'hit')).toMatchObject({ targetId: 2 });
		g.advance(600);
		const miss = g.shoot(3, { x: 0, y: -600, z: 0 }, false, tickA);
		expect(miss.ok).toBe(true);
		expect(miss.events.find((e) => e.e === 'hit')).toBeUndefined();
		const now = g.shoot(3, { x: 0, y: -600, z: 0 }, false);
		expect(now.events.find((e) => e.e === 'hit')).toBeUndefined();
	});

	it('UAV pulses the last survivor every 5 s while 2+ infected hunt', () => {
		const g = playing([1, 2, 3]);
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		g.put(3, 1000, 1000);
		g.advance(1000);
		expect(g.of('uav')).toEqual([]);
		g.shoot(1, { x: -300, y: 0, z: 0 }, true);
		g.advance(20);
		expect(g.of('uav')).toEqual([{ e: 'uav', targetId: 3, x: 1000, y: 1000, z: 0 }]);
		g.advance(4900);
		expect(g.of('uav')).toHaveLength(1);
		g.advance(200);
		expect(g.of('uav')).toHaveLength(2);
	});
});

describe('throwing knife', () => {
	it('only an infected player holding a knife can throw, while playing', () => {
		const g = newGame([1, 2]);
		g.advance(300);
		expect(g.game.throwKnife(1, g.eye(1), unit(1, 0, 0), g.clock.now)).toMatchObject({ ok: false, reason: 'not infected' });
		g.advance(800);
		g.put(1, -600, 600);
		g.put(2, 600, -600);
		expect(g.game.throwKnife(2, g.eye(2), unit(1, 0, 0), g.clock.now)).toMatchObject({ ok: false, reason: 'not infected' });
		expect(g.game.throwKnife(1, { x: 0, y: 0, z: 64 }, unit(1, 0, 0), g.clock.now)).toMatchObject({ ok: false, reason: 'bad origin' });
		expect(g.game.throwKnife(1, g.eye(1), { x: 3, y: 0, z: 0 }, g.clock.now)).toMatchObject({ ok: false, reason: 'bad direction' });
		const r = g.game.throwKnife(1, g.eye(1), unit(0, 1, 0), g.clock.now);
		expect(r.ok).toBe(true);
		expect(r.events[0]).toMatchObject({ e: 'knifeThrow', ownerId: 1, x: -600, y: 616, z: 64, vy: 1150 });
		expect(g.game.playerView(1)!.hasKnife).toBe(false);
		expect(g.game.throwKnife(1, g.eye(1), unit(0, 1, 0), g.clock.now)).toMatchObject({ ok: false, reason: 'no knife' });
	});

	it('never spawns inside a wall', () => {
		const g = playing([1, 2]);
		g.put(1, 390, 0);
		g.put(2, -1000, -1000);
		const r = g.game.throwKnife(1, g.eye(1), unit(1, 0, 0), g.clock.now);
		const t = r.events[0] as Ev<'knifeThrow'>;
		expect(t.x).toBeLessThan(400 - 1.9);
	});

	it('a direct hit infects instantly (+200)', () => {
		const g = playing([1, 2, 3]);
		g.put(1, -600, 0);
		g.put(2, -400, 0);
		g.put(3, 1000, 1000);
		g.game.throwKnife(1, g.eye(1), unit(1, 0, 0), g.clock.now);
		const inf = g.advanceUntil('infect', 500);
		expect(inf).toEqual({ e: 'infect', id: 2, by: 1, method: 'knife', timeAdded: INF_INFECTION_BONUS_SECS });
		expect(g.of('knifeRemove')).toHaveLength(1);
		expect(g.of('knifeBounce')).toHaveLength(0);
		expect(g.game.playerView(1)!.score).toBe(INF_SCORE_INFECT + INF_SCORE_KNIFE_BONUS);
	});

	it('bounces once off the floor, sticks on the second contact, and can be picked up', () => {
		const g = playing([1, 2]);
		g.put(1, -600, 600);
		g.put(2, 600, -600);
		g.game.throwKnife(1, g.eye(1), unit(0, 0, -1), g.clock.now);
		g.put(1, -600, 900); // step away so the pickup waits
		const b = g.advanceUntil('knifeBounce', 500)!;
		expect(b.vz).toBeGreaterThan(400);
		expect(Math.abs(b.vx) + Math.abs(b.vy)).toBeLessThan(1e-6);
		const s = g.advanceUntil('knifeStick', 3000)!;
		expect(s).toMatchObject({ ownerId: 1 });
		expect(s.z).toBeGreaterThan(1.9);
		expect(s.z).toBeLessThan(4);
		expect(g.of('knifeBounce')).toHaveLength(1);
		const k = g.game.view(g.clock.now).knives[0]!;
		expect(k).toMatchObject({ stuck: true, vx: 0, vy: 0, vz: 0 });
		g.advance(200);
		expect(g.game.view(g.clock.now).knives).toHaveLength(1);
		g.put(1, k.x + 20, k.y);
		g.advance(20);
		expect(g.of('knifePickup')).toEqual([{ e: 'knifePickup', id: k.id, ownerId: 1 }]);
		expect(g.game.playerView(1)!.hasKnife).toBe(true);
		expect(g.game.view(g.clock.now).knives).toEqual([]);
	});

	it('a bank shot off a wall still infects (+250)', () => {
		const g = playing([1, 2, 3]);
		g.put(1, 300, 0);
		g.put(2, -1000, 1000);
		g.put(3, 1000, 1000);
		g.game.throwKnife(1, g.eye(1), unit(1, 0, 0), g.clock.now);
		g.put(1, 300, -200);
		const b = g.advanceUntil('knifeBounce', 300)!;
		expect(b.vx).toBeLessThan(0);
		expect(b.x).toBeLessThan(400);
		const t = 0.06;
		g.put(2, b.x + b.vx * t, b.y + b.vy * t, b.z + b.vz * t - 30);
		const inf = g.advanceUntil('infect', 300);
		expect(inf).toEqual({ e: 'infect', id: 2, by: 1, method: 'bank', timeAdded: INF_INFECTION_BONUS_SECS });
		expect(g.game.playerView(1)!.score).toBe(INF_SCORE_INFECT + INF_SCORE_KNIFE_BONUS + INF_SCORE_BANK_BONUS);
	});

	it('a knife in flight still infects after its owner dies; the Alpha comes back as plain infected', () => {
		const g = playing([1, 2, 3]);
		g.put(1, -800, 0);
		g.put(2, -400, 0);
		g.put(3, -800, 300);
		g.game.throwKnife(1, g.eye(1), unit(1, 0, 0), g.clock.now);
		g.shoot(3, { x: -800, y: 0, z: 0 }, true);
		expect(g.game.playerView(1)!.alive).toBe(false);
		const inf = g.advanceUntil('infect', 600);
		expect(inf).toMatchObject({ id: 2, by: 1, method: 'knife' });
		expect(g.game.playerView(1)).toMatchObject({ alive: false, alpha: false, weapon: 'claws' });
		g.advance(3100);
		expect(g.game.playerView(1)).toMatchObject({ alive: true, alpha: false, weapon: 'claws', hasKnife: true });
	});

	it('respawning removes the owner’s stuck knives; knives expire after their lifetime', () => {
		const g = playing([1, 2, 3]);
		g.put(1, -600, 600);
		g.put(2, 600, -600);
		g.put(3, 600, -300);
		g.game.throwKnife(1, g.eye(1), unit(0, 0, -1), g.clock.now);
		g.put(1, -600, 300);
		const s = g.advanceUntil('knifeStick', 3000)!;
		g.put(2, -600, 0);
		g.shoot(2, { x: -600, y: 300, z: 0 }, true);
		g.advance(2000);
		expect(g.game.view(g.clock.now).knives).toHaveLength(1);
		g.advance(1200);
		expect(g.of('knifeRemove')).toEqual([{ e: 'knifeRemove', id: s.id }]);
		expect(g.game.playerView(1)).toMatchObject({ alive: true, hasKnife: true });

		g.put(1, 600, 600);
		g.game.throwKnife(1, g.eye(1), unit(0, 0, -1), g.clock.now);
		g.put(1, 600, 1000);
		g.advanceUntil('knifeStick', 3000);
		expect(g.game.view(g.clock.now).knives).toHaveLength(1);
		g.advance((INF_KNIFE_LIFETIME_SECS + 1) * 1000);
		expect(g.game.view(g.clock.now).knives).toEqual([]);
		expect(g.of('knifeRemove')).toHaveLength(2);
	});

	it('a knife falling into a teleport zone is removed', () => {
		const map = testMap();
		map.brushes = []; // no floor
		const clock = { now: 0 };
		const game = new InfectedGame({ map, world: buildCollisionWorld(map), now: 0, rng: () => 0, graceSecs: 1 });
		game.syncPlayers([1, 2], 0);
		const events: InfEvent[] = [];
		const step = (ms: number) => {
			const end = clock.now + ms;
			while (clock.now < end) events.push(...game.update((clock.now += INF_STEP_MS)));
		};
		step(1100);
		game.setPlayerPos(1, { x: 0, y: 0, z: 0, ducked: false });
		game.setPlayerPos(2, { x: 900, y: 900, z: 0, ducked: false });
		expect(game.throwKnife(1, { x: 0, y: 0, z: 64 }, unit(0, 0, -1), clock.now).ok).toBe(true);
		step(2000);
		expect(events.some((e) => e.e === 'knifeRemove')).toBe(true);
		expect(events.some((e) => e.e === 'knifeStick')).toBe(false);
	});
});

/** testMap plus extra brushes. */
function mapWith(...extra: MapDef['brushes']): MapDef {
	const m = testMap();
	m.brushes = [...m.brushes, ...extra];
	return m;
}
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): MapDef['brushes'][number] => ({
	type: 'box',
	min: { x: x0, y: y0, z: z0 },
	max: { x: x1, y: y1, z: z1 },
	material: 'm'
});

describe('throwing knife edge cases', () => {
	it('thrown point-blank into a wall: spawns outside it, rebounds and lands where the owner can pick it up', () => {
		const g = playing([1, 2]);
		g.put(1, 384, 0); // hull pressed against the wall face at x 400
		g.put(2, -1000, -1000);
		const r = g.game.throwKnife(1, g.eye(1), unit(1, 0, 0), g.clock.now);
		expect(r.ok).toBe(true);
		const t = r.events[0] as Ev<'knifeThrow'>;
		expect(t.x).toBeLessThanOrEqual(398);
		expect(g.game.world.trace(t, t, { x: -2, y: -2, z: -2 }, { x: 2, y: 2, z: 2 }).startsolid).toBe(false);
		const b = g.advanceUntil('knifeBounce', 100)!;
		expect(b.vx).toBeLessThan(-400);
		const s = g.advanceUntil('knifeStick', 2000)!;
		expect(s.x).toBeLessThan(398);
		expect(s.z).toBeLessThan(4);
		g.put(1, s.x - 30, s.y);
		g.advance(20);
		expect(g.of('knifePickup')).toEqual([{ e: 'knifePickup', id: t.id, ownerId: 1 }]);
		expect(g.game.playerView(1)!.hasKnife).toBe(true);
	});

	it('an origin whose knife hull touches the wall falls back to the known eye; an origin in or behind the wall is refused', () => {
		const g = playing([1, 2]);
		g.put(1, 384, 0);
		g.put(2, -1000, -1000);
		expect(g.game.throwKnife(1, { x: 402, y: 0, z: 64 }, unit(1, 0, 0), g.clock.now)).toMatchObject({ ok: false, reason: 'bad origin' });
		expect(g.game.throwKnife(1, { x: 430, y: 0, z: 64 }, unit(-1, 0, 0), g.clock.now)).toMatchObject({ ok: false, reason: 'bad origin' });
		expect(g.game.playerView(1)!.hasKnife).toBe(true);
		const r = g.game.throwKnife(1, { x: 399, y: 0, z: 64 }, unit(1, 0, 0), g.clock.now);
		expect(r.ok).toBe(true);
		expect((r.events[0] as Ev<'knifeThrow'>).x).toBeLessThanOrEqual(398);
	});

	it('guns and claws cannot reach through a wall with the origin slack', () => {
		const g = playing([1, 2, 3], LMG);
		g.put(1, 1000, 1000);
		g.put(2, 384, 0); // survivor west of the wall
		g.put(3, 440, 0); // infected Alpha? no: 1 is the Alpha; 3 is a survivor east of the wall
		// Survivor 2 claims an origin behind the wall to shoot the Alpha standing east of it.
		g.put(1, 460, 0);
		const r = g.game.fire(2, { weapon: 'lmg', origin: { x: 420, y: 0, z: 64 }, dir: unit(1, 0, 0), tick: g.game.tick }, g.clock.now);
		expect(r).toMatchObject({ ok: false, reason: 'bad origin' });
		expect(g.game.playerView(1)!.hp).toBe(INF_INFECTED_HP);
	});

	it('a floor bank shot in front of a survivor bounces up into them and infects as a bank shot', () => {
		const g = playing([1, 2, 3]);
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		g.put(3, 1000, 1000);
		g.game.throwKnife(1, g.eye(1), unit(150, 0, -64), g.clock.now);
		const inf = g.advanceUntil('infect', 600);
		const b = g.of('knifeBounce');
		expect(b).toHaveLength(1);
		expect(b[0]!.z).toBeLessThan(4);
		expect(b[0]!.x).toBeLessThan(-300);
		expect(inf).toEqual({ e: 'infect', id: 2, by: 1, method: 'bank', timeAdded: INF_INFECTION_BONUS_SECS });
		expect(g.game.playerView(1)!.score).toBe(INF_SCORE_INFECT + INF_SCORE_KNIFE_BONUS + INF_SCORE_BANK_BONUS);
	});

	it('two survivors in one step of the flight: the closer one along the knife is infected', () => {
		const g = playing([1, 2, 3, 4]);
		g.put(1, -800, 0);
		g.put(2, 1000, 1000);
		g.put(3, 1000, -1000);
		g.put(4, -1000, 1000);
		g.game.throwKnife(1, g.eye(1), unit(1, 0, 0), g.clock.now);
		const k = g.game.knifeViews()[0]!;
		// Both bodies (radius 13 + 10) overlap the next 18-unit step; 3 is nearer.
		g.put(2, k.x + 36, 4, k.z - 30);
		g.put(3, k.x + 28, -4, k.z - 30);
		g.advance(INF_STEP_MS);
		expect(g.of('infect')).toEqual([{ e: 'infect', id: 3, by: 1, method: 'knife', timeAdded: INF_INFECTION_BONUS_SECS }]);
		expect(g.game.playerView(2)!.team).toBe('survivor');
	});

	it('point blank: a survivor in front of the eye is infected by the throw itself', () => {
		const g = playing([1, 2, 3]);
		g.put(1, -600, 0);
		g.put(2, -580, 0);
		g.put(3, 1000, 1000);
		const r = g.game.throwKnife(1, g.eye(1), unit(1, 0, 0), g.clock.now);
		expect(r.events.map((e) => e.e)).toEqual(expect.arrayContaining(['knifeThrow', 'knifeRemove', 'infect']));
		expect(r.events.find((e) => e.e === 'infect')).toMatchObject({ id: 2, by: 1, method: 'knife' });
	});

	it('Alpha killed with a knife in flight: the knife infects, the Alpha turns plain, +20 s, the round goes on', () => {
		const g = playing([1, 2, 3, 4]);
		g.put(1, -800, 0);
		g.put(2, -400, 0);
		g.put(3, -800, 300);
		g.put(4, 1000, 1000);
		g.game.throwKnife(1, g.eye(1), unit(1, 0, 0), g.clock.now);
		g.shoot(3, { x: -800, y: 0, z: 0 }, true);
		const endsAt = g.game.endsAt;
		const inf = g.advanceUntil('infect', 600);
		expect(inf).toMatchObject({ id: 2, by: 1, method: 'knife', timeAdded: INF_INFECTION_BONUS_SECS });
		expect(g.game.endsAt).toBe(endsAt + INF_INFECTION_BONUS_SECS * 1000);
		expect(g.game.alphaId).toBe(1);
		expect(g.game.playerView(1)).toMatchObject({ alive: false, alpha: false, weapon: 'claws', kills: 1 });
		expect(g.of('ammo').filter((a) => a.id === 1).at(-1)).toMatchObject({ weapon: 'claws' });
		g.advance(3100);
		expect(g.game.phase).toBe('playing');
		expect(g.of('spawn').filter((s) => s.id === 1 && s.reason === 'respawn').at(-1)).toMatchObject({ alpha: false, weapon: 'claws', hasKnife: true });
		expect(g.game.selectWeapon(1, 'lmg', g.clock.now)).toEqual([]);
	});

	it('a knife of an earlier life still flies but cannot be retrieved: one knife per owner', () => {
		const g = playing([1, 2, 3]);
		g.put(1, -600, 0);
		g.put(2, 600, 600);
		g.put(3, -600, 300);
		g.game.throwKnife(1, g.eye(1), unit(0, 0, 1), g.clock.now); // straight up: ~3.5 s of flight
		g.shoot(3, { x: -600, y: 0, z: 0 }, true);
		g.advance(3100);
		expect(g.game.playerView(1)).toMatchObject({ alive: true, hasKnife: true });
		expect(g.game.view(g.clock.now).knives).toHaveLength(1);
		g.advance(4000); // up, bounce off the floor, down again
		expect(g.of('knifePickup')).toEqual([]);
		expect(g.game.view(g.clock.now).knives).toEqual([]);
		expect(g.of('knifeRemove')).toHaveLength(1);
	});

	it('a lob into a high ceiling is too slow to rebound: it drops harmlessly and sticks on the floor', () => {
		// Apex of a straight-up throw from the eye is ~1097: the ceiling stops it at ~150 u/s.
		const g = playing([1, 2], {}, mapWith(box(-1200, -1200, 1085, 1200, 1200, 1101)));
		g.put(1, -600, 0);
		g.put(2, 600, 600);
		g.game.throwKnife(1, g.eye(1), unit(0, 0, 1), g.clock.now);
		const drop = g.advanceUntil('knifeBounce', 3000)!;
		expect(drop.z).toBeGreaterThan(1000);
		expect(drop.vz).toBeLessThanOrEqual(0);
		expect(Math.hypot(drop.vx, drop.vy, drop.vz)).toBeLessThan(INF_KNIFE_REST_SPEED);
		// Harmless while dropping: a survivor right under it is not infected.
		g.put(2, -600, 0);
		g.put(1, -600, 400);
		const s = g.advanceUntil('knifeStick', 4000)!;
		expect(s.z).toBeLessThan(4);
		expect(g.of('infect')).toEqual([]);
		expect(g.game.playerView(2)!.team).toBe('survivor');
		g.put(2, 600, 600);
		g.put(1, s.x + 20, s.y);
		g.advance(20);
		expect(g.of('knifePickup')).toHaveLength(1);
	});

	it('a fast throw into a ceiling still bounces (and stays lethal)', () => {
		const g = playing([1, 2], {}, mapWith(box(-1200, -1200, 300, 1200, 1200, 316)));
		g.put(1, -600, 0);
		g.put(2, 600, 600);
		g.game.throwKnife(1, g.eye(1), unit(0.2, 0, 1), g.clock.now);
		const b = g.advanceUntil('knifeBounce', 1000)!;
		expect(b.vz).toBeLessThan(-INF_KNIFE_REST_SPEED);
		const s = g.advanceUntil('knifeStick', 2000)!;
		expect(s.z).toBeLessThan(4);
	});

	it('after its bounce a knife sticks in a wall low down but drops from high up, so it stays retrievable', () => {
		// A second wall at x 296..300: the knife bounces off one wall into the other.
		const g = playing([1, 2], {}, mapWith(box(296, -300, 0, 300, 300, 512)));
		g.put(2, -1000, -1000);
		g.put(1, 350, 0);
		g.game.throwKnife(1, g.eye(1), unit(1, 0, 1.2), g.clock.now);
		g.put(1, 350, 200);
		const first = g.advanceUntil('knifeBounce', 500)!;
		expect(first.x).toBeGreaterThan(396);
		const drop = g.advanceUntil('knifeBounce', 1000)!;
		expect(drop.x).toBeLessThan(304);
		expect(drop.z).toBeGreaterThan(INF_KNIFE_WALL_REACH);
		expect(drop.vx).toBeGreaterThan(0);
		const s = g.advanceUntil('knifeStick', 3000)!;
		expect(s.z).toBeLessThan(4);
		expect(s.x).toBeGreaterThan(300);
		expect(s.x).toBeLessThan(400);

		// Low: thrown flat at the near wall it bounces into the far one at eye height and sticks there.
		const h = playing([1, 2], {}, mapWith(box(296, -300, 0, 300, 300, 512)));
		h.put(2, -1000, -1000);
		h.put(1, 350, 0);
		h.game.throwKnife(1, h.eye(1), unit(1, 0, 0), h.clock.now);
		h.put(1, 350, 200);
		h.advanceUntil('knifeBounce', 500);
		const stick = h.advanceUntil('knifeStick', 1000)!;
		expect(stick.x).toBeLessThan(304);
		expect(stick.z).toBeGreaterThan(30);
		expect(stick.z).toBeLessThan(INF_KNIFE_WALL_REACH);
		// Walking up to the wall picks it up.
		h.put(1, 317, stick.y);
		h.advance(20);
		expect(h.of('knifePickup')).toHaveLength(1);
	});

	it('a knife on a waist-high top is picked up from the ground beside it', () => {
		const g = playing([1, 2], {}, mapWith(box(-620, -64, 0, -580, 64, 40)));
		g.put(2, -1000, -1000);
		g.put(1, -600, 0, 40);
		g.game.throwKnife(1, g.eye(1), unit(0, 0, -1), g.clock.now);
		g.put(1, -600, 300);
		const s = g.advanceUntil('knifeStick', 3000)!;
		expect(s.z).toBeGreaterThan(40);
		g.put(1, -620 - 17, s.y); // on the ground against the box's side (the sight line from z 36 would hit it)
		g.advance(20);
		expect(g.of('knifePickup')).toHaveLength(1);
	});

	it('cannot be picked up through a wall', () => {
		const g = playing([1, 2]);
		g.put(2, -1000, -1000);
		g.put(1, 440, 0);
		g.game.throwKnife(1, g.eye(1), unit(0, 0, -1), g.clock.now);
		g.put(1, 440, 200);
		const s = g.advanceUntil('knifeStick', 3000)!;
		g.put(1, 386, s.y); // within the reach radius, but the wall is in between
		g.advance(200);
		expect(g.of('knifePickup')).toEqual([]);
		g.put(1, s.x + 30, s.y);
		g.advance(20);
		expect(g.of('knifePickup')).toHaveLength(1);
	});
});

describe('anti-exploit and robustness', () => {
	it('spectating and rejoining mid-round: still infected, no free knife, no Alpha, stats kept', () => {
		const g = playing([1, 2, 3, 4]);
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		g.put(3, 1000, 1000);
		g.put(4, 1000, -1000);
		g.shoot(1, { x: -300, y: 0, z: 0 }, true); // 2 is infected; 1 drops the gun
		g.put(2, -600, 600);
		g.game.throwKnife(2, g.eye(2), unit(0, 0, -1), g.clock.now);
		expect(g.game.playerView(2)!.hasKnife).toBe(false);
		g.game.syncPlayers([1, 3, 4], g.clock.now);
		g.advance(20);
		expect(g.game.view(g.clock.now).knives).toEqual([]);
		g.game.syncPlayers([1, 2, 3, 4], g.clock.now);
		g.advance(20);
		expect(g.game.playerView(2)).toMatchObject({ team: 'infected', alpha: false, weapon: 'claws', hasKnife: false, deaths: 1 });
		// The Alpha leaving and rejoining comes back as plain infected (claws, no gun).
		g.game.syncPlayers([2, 3, 4], g.clock.now);
		g.game.syncPlayers([1, 2, 3, 4], g.clock.now);
		expect(g.game.playerView(1)).toMatchObject({ team: 'infected', alpha: false, weapon: 'claws', hasKnife: true, kills: 1, score: INF_SCORE_INFECT });
		// A survivor who spectates comes back infected (not counted as an infection).
		const endsAt = g.game.endsAt;
		g.game.syncPlayers([1, 2, 4], g.clock.now);
		g.game.syncPlayers([1, 2, 3, 4], g.clock.now);
		expect(g.game.playerView(3)).toMatchObject({ team: 'infected', alpha: false, weapon: 'claws', hasKnife: true, score: INF_SCORE_SURVIVE_TICK });
		expect(g.game.endsAt).toBe(endsAt);
		expect(g.game.infections).toBe(1);
	});

	it('the Alpha spectating before any infection hands Patient Zero to a survivor and cannot take it back', () => {
		const g = playing([1, 2, 3]);
		g.game.syncPlayers([2, 3], g.clock.now);
		expect(g.game.alphaId).toBe(2);
		g.game.syncPlayers([1, 2, 3], g.clock.now);
		g.advance(20);
		expect(g.game.alphaId).toBe(2);
		expect(g.game.playerView(1)).toMatchObject({ team: 'infected', alpha: false, weapon: 'claws' });
		expect(g.game.playerView(2)).toMatchObject({ team: 'infected', alpha: true, weapon: 'barrett', hasKnife: true });
	});

	it('a dead infected who rejoins gets the knife they were due; stats follow the key, not the id', () => {
		const g = playing([1, 2, 3]);
		const keys = new Map([
			[1, 'p-one'],
			[2, 'p-two'],
			[3, 'p-three']
		]);
		g.game.syncPlayers([1, 2, 3], g.clock.now, keys); // adopts the keys
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		g.put(3, 1000, 1000);
		g.game.throwKnife(1, g.eye(1), unit(0, 0, -1), g.clock.now);
		g.shoot(2, { x: -600, y: 0, z: 0 }, true);
		expect(g.game.playerView(1)).toMatchObject({ alive: false, hasKnife: false });
		g.game.syncPlayers([2, 3], g.clock.now, keys);
		// Reconnect under a new id with the same key: restored deaths, knife due.
		keys.set(9, 'p-one');
		g.game.syncPlayers([2, 3, 9], g.clock.now, keys);
		expect(g.game.playerView(9)).toMatchObject({ team: 'infected', alive: true, hasKnife: true, deaths: 1 });
		// Another player reusing id 1 starts fresh.
		keys.set(1, 'someone-else');
		g.game.syncPlayers([1, 2, 3, 9], g.clock.now, keys);
		expect(g.game.playerView(1)).toMatchObject({ team: 'infected', hasKnife: true, deaths: 0, score: 0 });
		// An id handed to someone else within one sync: the old player leaves, the new one is fresh.
		keys.set(9, 'p-new');
		g.game.syncPlayers([1, 2, 3, 9], g.clock.now, keys);
		expect(g.game.playerView(9)).toMatchObject({ team: 'infected', deaths: 0 });
		keys.set(4, 'p-one');
		g.game.syncPlayers([1, 2, 3, 4, 9], g.clock.now, keys);
		expect(g.game.playerView(4)).toMatchObject({ deaths: 1 });
	});

	it('friendly fire never hurts: survivor on survivor, infected on infected (gun, claws, knife)', () => {
		const g = playing([1, 2, 3, 4]);
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		g.put(3, 600, 0);
		g.put(4, 900, 0);
		// Survivor 3 shoots survivor 4 in the head; the Alpha shoots nothing infected.
		const r = g.shoot(3, { x: 900, y: 0, z: 0 }, true);
		expect(r.ok).toBe(true);
		expect(r.events.filter((e) => e.e === 'hit' || e.e === 'hurt' || e.e === 'infect')).toEqual([]);
		expect(g.game.playerView(4)!.hp).toBe(5);
		g.shoot(1, { x: -300, y: 0, z: 0 }, true); // 2 infected
		g.put(2, -560, 0);
		g.advance(500);
		const claws = g.shoot(1, { x: -560, y: 0, z: 0 }, false);
		expect(claws.ok).toBe(true);
		expect(claws.events.filter((e) => e.e === 'hit')).toEqual([]);
		g.put(2, -400, 0);
		g.game.throwKnife(1, g.eye(1), unit(1, 0, 0), g.clock.now);
		g.advance(600);
		expect(g.game.playerView(2)).toMatchObject({ alive: true, hp: INF_INFECTED_HP });
		expect(g.of('infect')).toHaveLength(1);
		// Survivor knife on a survivor.
		g.game.selectWeapon(3, 'knife', g.clock.now);
		g.put(4, 640, 0);
		const knife = g.shoot(3, { x: 640, y: 0, z: 0 }, false);
		expect(knife.events.filter((e) => e.e === 'hit')).toEqual([]);
	});

	it('malformed fire/throw input is refused without side effects', () => {
		const g = playing([1, 2, 3], LMG);
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		g.put(3, 1000, 1000);
		const o = g.eye(2);
		const mag = () => g.game.primaryOf(2)!.mag;
		const before = mag();
		const fire = (shot: Partial<Parameters<InfectedGame['fire']>[1]>) =>
			g.game.fire(2, { weapon: 'lmg', origin: o, dir: unit(1, 0, 0), tick: g.game.tick, ...shot } as Parameters<InfectedGame['fire']>[1], g.clock.now);
		expect(fire({ dir: { x: NaN, y: 0, z: 0 } })).toMatchObject({ ok: false, reason: 'bad shot' });
		expect(fire({ dir: { x: 0, y: 0, z: 0 } })).toMatchObject({ ok: false, reason: 'bad direction' });
		expect(fire({ origin: { x: Infinity, y: 0, z: 64 } })).toMatchObject({ ok: false, reason: 'bad shot' });
		expect(fire({ origin: { x: 1e12, y: 0, z: 64 } })).toMatchObject({ ok: false, reason: 'bad origin' });
		expect(fire({ origin: null as unknown as Vec3 })).toMatchObject({ ok: false, reason: 'bad shot' });
		expect(fire({ weapon: 'bfg' as never })).toMatchObject({ ok: false, reason: 'wrong weapon' });
		expect(fire({ weapon: 'sniper' })).toMatchObject({ ok: false, reason: 'wrong weapon' });
		expect(fire({ tick: NaN }).ok).toBe(true);
		expect(mag()).toBe(before - 1);
		expect(g.game.throwKnife(1, g.eye(1), { x: NaN, y: 1, z: 0 }, g.clock.now)).toMatchObject({ ok: false, reason: 'bad shot' });
		expect(g.game.throwKnife(1, g.eye(1), { x: 0, y: 0, z: 0 }, g.clock.now)).toMatchObject({ ok: false, reason: 'bad direction' });
		expect(g.game.playerView(1)!.hasKnife).toBe(true);
		// A NaN position update is ignored (it would disable the origin check).
		g.game.setPlayerPos(2, { x: NaN, y: 0, z: 0, ducked: false });
		expect(fire({ origin: { x: 5000, y: 0, z: 64 } })).toMatchObject({ ok: false, reason: 'bad origin' });
		expect(g.game.selectWeapon(2, 'bfg', g.clock.now)).toEqual([]);
		expect(g.game.selectWeapon(2, null, g.clock.now)).toEqual([]);
	});

	it('no knife throws outside playing; no firing while dead; reload rules', () => {
		const g = newGame([1, 2], { roundSecs: 60, ...LMG });
		expect(g.game.throwKnife(1, g.eye(1), unit(1, 0, 0), g.clock.now)).toMatchObject({ ok: false });
		g.advance(1100);
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		// Survivor shoots the Alpha dead: no firing or throwing while dead.
		g.shoot(2, { x: -600, y: 0, z: 0 }, true);
		expect(g.game.fire(1, { weapon: 'lmg', origin: g.eye(1), dir: unit(1, 0, 0), tick: g.game.tick }, g.clock.now)).toMatchObject({ ok: false, reason: 'dead' });
		expect(g.game.throwKnife(1, g.eye(1), unit(1, 0, 0), g.clock.now)).toMatchObject({ ok: false, reason: 'dead' });
		expect(g.game.reload(1, g.clock.now)).toBe(false);
		// Reload: not on the knife; a swap mid-reload cancels it without ammo.
		g.advance(200);
		g.shoot(2, { x: 1000, y: 0, z: 0 }, false);
		g.advance(200);
		g.game.selectWeapon(2, 'knife', g.clock.now);
		expect(g.game.reload(2, g.clock.now)).toBe(false);
		g.game.selectWeapon(2, 'lmg', g.clock.now);
		const { mag, reserve } = g.game.primaryOf(2)!;
		expect(mag).toBeLessThan(WEAPONS.lmg.magazine);
		expect(g.game.reload(2, g.clock.now)).toBe(true);
		g.advance(100);
		g.game.selectWeapon(2, 'knife', g.clock.now);
		g.advance(WEAPONS.lmg.reloadMs * 2);
		g.game.selectWeapon(2, 'lmg', g.clock.now);
		expect(g.game.primaryOf(2)).toMatchObject({ mag, reserve });
		expect(g.game.weaponOf(2)!.reloading(g.clock.now)).toBe(false);
		// Ended: throws refused.
		const e = playing([1, 2], { roundSecs: 1 });
		e.advance(1100);
		expect(e.game.phase).toBe('ended');
		expect(e.game.playerView(1)!.team).toBe('infected');
		expect(e.game.throwKnife(1, e.eye(1), unit(1, 0, 0), e.clock.now)).toMatchObject({ ok: false, reason: 'no round' });
	});

	it('infected claws cannot reload or swap to a gun', () => {
		const g = playing([1, 2, 3]);
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		g.put(3, 1000, 1000);
		g.shoot(1, { x: -300, y: 0, z: 0 }, true);
		expect(g.game.weaponOf(2)!.weapon).toBe('claws');
		expect(g.game.reload(2, g.clock.now)).toBe(false);
		expect(g.game.selectWeapon(2, 'lmg', g.clock.now)).toEqual([]);
		expect(g.game.selectWeapon(2, 'knife', g.clock.now)).toEqual([]);
	});

	it('the last infected leaving after the first infection: a survivor turns (claws + knife), alphaId stays sane', () => {
		const g = playing([1, 2, 3, 4]);
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		g.put(3, 1000, 1000);
		g.put(4, 1000, -1000);
		g.shoot(1, { x: -300, y: 0, z: 0 }, true);
		g.game.syncPlayers([2, 3, 4], g.clock.now);
		expect(g.game.alphaId).toBeNull();
		g.game.syncPlayers([3, 4], g.clock.now);
		g.advance(20);
		const turned = g.of('infect').at(-1)!;
		expect(turned).toMatchObject({ by: null, method: 'claws', timeAdded: 0 });
		expect(g.game.playerView(turned.id)).toMatchObject({ team: 'infected', alpha: false, weapon: 'claws', hasKnife: true });
		expect(g.game.alphaId).toBeNull();
		expect(g.game.phase).toBe('playing');
		expect(g.of('alpha')).toHaveLength(1);
		// The new infected can throw and infect normally.
		const other = turned.id === 3 ? 4 : 3;
		g.put(turned.id, 0, 0);
		g.put(other, 300, 0);
		g.game.throwKnife(turned.id, g.eye(turned.id), unit(1, 0, 0), g.clock.now);
		g.advance(400);
		expect(g.of('end').at(-1)).toMatchObject({ winner: 'infected' });
	});

	it('a fall into the teleport zone respawns safely: no infection or death, stale positions ignored for a second', () => {
		const g = playing([1, 2]);
		g.put(2, 0, 0, -1000);
		g.advance(50);
		const falls = () => g.of('spawn').filter((s) => s.reason === 'fall');
		expect(falls()).toHaveLength(1);
		expect(falls()[0]).toMatchObject({ id: 2, team: 'survivor', hp: 5, weapon: 'barrett' });
		expect(g.game.playerView(2)).toMatchObject({ alive: true, team: 'survivor', deaths: 0 });
		expect(g.of('infect')).toEqual([]);
		g.put(2, 0, 0, -1000); // a stale packet from before the teleport
		g.advance(500);
		expect(falls()).toHaveLength(1);
		g.advance(600);
		expect(falls()).toHaveLength(2);
		// Falling during waiting also teleports.
		const w = newGame([1]);
		w.advance(1100); // past the join teleport grace
		w.put(1, 0, 0, -1000);
		w.advance(50);
		expect(w.of('spawn').filter((s) => s.reason === 'fall')).toHaveLength(1);
	});

	it('lag compensation at the 400 ms clamp uses the oldest pose, not the current one', () => {
		const g = playing([1, 2, 3]);
		g.put(1, 0, -600);
		g.put(2, -600, -600);
		g.put(3, 1000, 1000);
		g.advance(500);
		g.put(1, 0, -900);
		g.advance(1000);
		const now = g.game.tick;
		g.put(1, 0, -600); // the target is back where it was
		const r = g.shoot(2, { x: 0, y: -900, z: 0 }, false, now - 10_000);
		expect(r.events.find((e) => e.e === 'hit')).toMatchObject({ targetId: 1 });
	});
});

describe('multi-round cycle', () => {
	it('rounds 1 → 5 rotate barrett → striker → lmg → smg → barrett and reset knives, UAV, stats, HP, perks and the Alpha', () => {
		const g = newGame([1, 2, 3], { roundSecs: 3 });
		const loadouts: string[] = [];
		for (let round = 1; round <= 5; round++) {
			while (g.game.phase !== 'playing') g.advance(INF_STEP_MS);
			expect(g.game.phase).toBe('playing');
			expect(g.game.round).toBe(round);
			loadouts.push(g.game.roundLoadout);
			const a = g.game.alphaId!;
			const [s1, s2] = [1, 2, 3].filter((i) => i !== a) as [number, number];
			expect(g.game.view(g.clock.now)).toMatchObject({ survivors: 2, infected: 1, knives: [] });
			// Infect one survivor with the gun, then leave a stuck knife lying around.
			g.put(a, -600, 0);
			g.put(s1, -300, 0);
			g.put(s2, 1000, 1000);
			g.shoot(a, { x: -300, y: 0, z: 0 }, true);
			g.game.throwKnife(a, g.eye(a), unit(0, 0, -1), g.clock.now);
			g.put(a, -900, 0);
			g.advanceUntil('knifeStick', 3000);
			expect(g.of('uav').filter((u) => u.targetId === s2).length).toBeGreaterThan(0);
			const n = g.events.length;
			const end = g.advanceUntil('end', 30_000)!;
			expect(end).toMatchObject({ winner: 'survivors', round, survivorsLeft: 1 });
			expect(g.of('knifeRemove', g.events.slice(n))).toHaveLength(1);
			expect(g.game.view(g.clock.now).knives).toEqual([]);
			const phase = () => g.game.phase;
			while (phase() === 'ended') g.advance(INF_STEP_MS);
			expect(g.game.phase).toBe('grace');
			for (const id of [1, 2, 3]) {
				expect(g.game.playerView(id)).toMatchObject({
					team: 'survivor',
					alpha: false,
					hp: 5,
					alive: true,
					score: 0,
					kills: 0,
					deaths: 0,
					hasKnife: false,
					streak: 0,
					perks: ['hardline'],
					moabReady: false
				});
			}
			expect(g.game.alphaId).toBeNull();
			expect(g.game.infections).toBe(0);
		}
		expect(loadouts).toEqual(['barrett', 'striker', 'lmg', 'smg', 'barrett']);
	});

	it('a cancelled grace period does not use up a round or its preset', () => {
		const g = newGame([1, 2]);
		g.advance(300);
		expect(g.game.round).toBe(1);
		g.game.syncPlayers([1], g.clock.now);
		g.advance(50);
		expect(g.game.phase).toBe('waiting');
		expect(g.of('phase').at(-1)).toMatchObject({ phase: 'waiting', round: 0, loadout: 'barrett' });
		g.game.syncPlayers([1, 2], g.clock.now);
		g.advance(50);
		expect(g.of('phase').at(-1)).toEqual({ e: 'phase', phase: 'grace', round: 1, loadout: 'barrett' });
	});
});

describe('respawn beacon (Tactical Insertion)', () => {
	/** Aim from `id`'s eye at a beacon's hit centre. */
	const atBeacon = (g: ReturnType<typeof playing>, id: number, b: { x: number; y: number; z: number }) => {
		const o = g.eye(id);
		const weapon = g.game.weaponOf(id)!.weapon;
		const r = g.game.fire(id, { weapon, origin: o, dir: unit(b.x - o.x, b.y - o.y, b.z + INF_BEACON_HIT_Z - o.z), tick: g.game.tick }, g.clock.now);
		g.events.push(...r.events);
		return r;
	};
	/** 1 (Alpha, infected) and survivors 2, 3 spread out. */
	const setup = () => {
		const g = playing([1, 2, 3], LMG);
		g.put(1, -600, 600, 0, 90);
		g.put(2, -1000, 0);
		g.put(3, 1000, 1000);
		return g;
	};

	it('routes beacon events to everyone', () => {
		expect(infEventRoute({ e: 'beaconPlace', id: 1, ownerId: 2, x: 0, y: 0, z: 0, yaw: 0 })).toEqual({});
		expect(infEventRoute({ e: 'beaconDestroy', id: 1, ownerId: 2, by: 3, x: 0, y: 0, z: 0 })).toEqual({});
		expect(infEventRoute({ e: 'beaconUse', id: 1, ownerId: 2, x: 0, y: 0, z: 0 })).toEqual({});
	});

	it('a living infected places one on the ground; it shows in the view', () => {
		const g = setup();
		const r = g.game.placeBeacon(1, g.clock.now);
		expect(r.ok).toBe(true);
		const ev = r.events.find((e): e is Ev<'beaconPlace'> => e.e === 'beaconPlace')!;
		expect(ev).toMatchObject({ ownerId: 1, x: -600, y: 600, yaw: 90 });
		expect(ev.z).toBeCloseTo(0, 0);
		const v = g.game.view(g.clock.now);
		expect(v.beacons).toEqual([{ id: ev.id, ownerId: 1, x: -600, y: 600, z: ev.z, yaw: 90 }]);
		expect(g.game.playerView(1)!.hasBeacon).toBe(true);
		expect(g.game.playerView(2)!.hasBeacon).toBe(false);
	});

	it('refuses survivors, mid-air, the grace period, the dead and spam (cooldown); a new one replaces the old', () => {
		const pre = newGame([1, 2, 3]);
		pre.advance(300);
		pre.put(1, -600, 600);
		expect(pre.game.placeBeacon(1, pre.clock.now)).toMatchObject({ ok: false, reason: 'not infected' });

		const g = setup();
		expect(g.game.placeBeacon(2, g.clock.now)).toMatchObject({ ok: false, reason: 'not infected', events: [] });
		g.put(1, -600, 600, 100);
		expect(g.game.placeBeacon(1, g.clock.now)).toMatchObject({ ok: false, reason: 'not grounded', events: [] });
		g.put(1, -600, 600);
		const first = g.game.placeBeacon(1, g.clock.now);
		expect(first.ok).toBe(true);
		const firstId = first.events.find((e): e is Ev<'beaconPlace'> => e.e === 'beaconPlace')!.id;
		g.put(1, -500, 600);
		expect(g.game.placeBeacon(1, g.clock.now)).toMatchObject({ ok: false, reason: 'cooldown' });
		g.advance(INF_BEACON_COOLDOWN_MS);
		const second = g.game.placeBeacon(1, g.clock.now);
		expect(second.ok).toBe(true);
		expect(second.events.map((e) => e.e)).toEqual(['beaconDestroy', 'beaconPlace']);
		expect(second.events[0]).toMatchObject({ e: 'beaconDestroy', id: firstId, ownerId: 1, by: null, x: -600, y: 600 });
		expect(second.events[1]).toMatchObject({ e: 'beaconPlace', ownerId: 1, x: -500, y: 600 });
		expect(g.game.view(g.clock.now).beacons).toHaveLength(1);

		// Dead: no placing.
		g.put(2, -500, 300);
		g.shoot(2, { x: -500, y: 600, z: 0 }, true);
		expect(g.game.playerView(1)!.alive).toBe(false);
		g.advance(INF_BEACON_COOLDOWN_MS);
		expect(g.game.placeBeacon(1, g.clock.now)).toMatchObject({ ok: false, reason: 'dead' });
	});

	it('the next respawn uses it up: on the beacon, facing its yaw; the one after is a map spawn', () => {
		const g = setup();
		const placed = g.game.placeBeacon(1, g.clock.now).events.find((e): e is Ev<'beaconPlace'> => e.e === 'beaconPlace')!;
		g.put(1, 600, -600);
		g.put(2, 600, -900);
		g.shoot(2, { x: 600, y: -600, z: 0 }, true);
		expect(g.game.playerView(1)!.alive).toBe(false);
		const sp = g.advanceUntil('spawn', 3200)!;
		expect(sp).toMatchObject({ id: 1, reason: 'beacon', x: -600, y: 600, yaw: 90, team: 'infected', hp: INF_INFECTED_HP, hasKnife: true });
		expect(sp.z).toBeCloseTo(placed.z + 0.25, 5);
		expect(g.of('beaconUse')).toEqual([{ e: 'beaconUse', id: placed.id, ownerId: 1, x: -600, y: 600, z: placed.z }]);
		expect(g.game.view(g.clock.now).beacons).toEqual([]);
		expect(g.game.playerView(1)!.hasBeacon).toBe(false);

		g.put(1, 600, -600);
		g.advance(200);
		g.shoot(2, { x: 600, y: -600, z: 0 }, true);
		const again = g.advanceUntil('spawn', 3200)!;
		expect(again).toMatchObject({ id: 1, reason: 'respawn' });
	});

	it('one survivor bullet destroys it (+50, hitmarker); the owner then respawns at a map spawn', () => {
		const g = setup();
		const b = g.game.placeBeacon(1, g.clock.now).events.find((e): e is Ev<'beaconPlace'> => e.e === 'beaconPlace')!;
		g.put(1, 600, -600);
		g.put(2, -600, 200);
		const before = g.game.playerView(2)!.score;
		const r = atBeacon(g, 2, b);
		expect(r.ok).toBe(true);
		expect(r.events).toContainEqual({ e: 'hit', by: 2, targetId: 0, head: false, kill: true });
		expect(r.events).toContainEqual({ e: 'beaconDestroy', id: b.id, ownerId: 1, by: 2, x: b.x, y: b.y, z: b.z });
		expect(g.game.playerView(2)!.score).toBe(before + INF_SCORE_BEACON_DESTROY);
		expect(g.game.view(g.clock.now).beacons).toEqual([]);
		expect(g.game.playerView(1)!.hasBeacon).toBe(false);

		g.put(2, 600, -900);
		g.advance(200);
		g.shoot(2, { x: 600, y: -600, z: 0 }, true);
		expect(g.advanceUntil('spawn', 3200)).toMatchObject({ id: 1, reason: 'respawn' });
		expect(g.of('beaconUse')).toEqual([]);
	});

	it('a missed shot or one stopped by a wall leaves it standing', () => {
		const g = setup();
		g.put(1, 500, 0);
		const b = g.game.placeBeacon(1, g.clock.now).events.find((e): e is Ev<'beaconPlace'> => e.e === 'beaconPlace')!;
		g.put(1, 600, -1000);
		g.put(2, 200, 0); // the thin wall at x 400 is in between
		atBeacon(g, 2, b);
		g.advance(200);
		g.put(2, 450, 300);
		const o = g.eye(2);
		g.game.fire(2, { weapon: 'lmg', origin: o, dir: unit(1, 0, 0), tick: g.game.tick }, g.clock.now);
		expect(g.game.view(g.clock.now).beacons).toHaveLength(1);
		expect(g.game.playerView(2)!.score).toBe(0);
	});

	it('a survivor knife swing destroys it', () => {
		const g = setup();
		const b = g.game.placeBeacon(1, g.clock.now).events.find((e): e is Ev<'beaconPlace'> => e.e === 'beaconPlace')!;
		g.put(1, 600, -600);
		g.game.selectWeapon(2, 'knife', g.clock.now);
		g.put(2, -650, 600);
		const r = atBeacon(g, 2, b);
		expect(r.ok).toBe(true);
		expect(r.events).toContainEqual({ e: 'beaconDestroy', id: b.id, ownerId: 1, by: 2, x: b.x, y: b.y, z: b.z });
		expect(g.game.playerView(2)!.score).toBe(INF_SCORE_BEACON_DESTROY);
	});

	it('infected cannot destroy their own or a teammate’s beacon', () => {
		const g = playing([1, 2, 3, 4], LMG);
		g.put(1, -600, 600);
		g.put(3, 1000, 1000);
		g.put(4, 1000, -1000);
		g.put(2, -1000, -1000);
		const own = g.game.placeBeacon(1, g.clock.now).events.find((e): e is Ev<'beaconPlace'> => e.e === 'beaconPlace')!;
		g.put(1, -600, 400);
		atBeacon(g, 1, own); // the Alpha's gun
		expect(g.game.view(g.clock.now).beacons).toHaveLength(1);
		// 1 infects 2; 2 places a beacon, 1 claws at it.
		g.put(1, -1000, -700);
		g.advance(200);
		g.shoot(1, { x: -1000, y: -1000, z: 0 }, true);
		expect(g.game.playerView(2)!.team).toBe('infected');
		g.advance(200);
		expect(g.game.placeBeacon(2, g.clock.now).ok).toBe(true);
		g.put(1, -1040, -1000);
		const mate = g.game.view(g.clock.now).beacons.find((b) => b.ownerId === 2)!;
		atBeacon(g, 1, mate);
		expect(g.game.view(g.clock.now).beacons).toHaveLength(2);
		expect(g.of('beaconDestroy')).toEqual([]);
	});

	it('leaving clears the beacon (a rejoin has none); round end and dropping to waiting clear all', () => {
		const g = playing([1, 2, 3], { roundSecs: 2 });
		g.put(1, -600, 600);
		g.put(2, -1000, 0);
		g.put(3, 1000, 1000);
		const b = g.game.placeBeacon(1, g.clock.now).events.find((e): e is Ev<'beaconPlace'> => e.e === 'beaconPlace')!;
		g.game.syncPlayers([2, 3], g.clock.now);
		g.advance(20);
		expect(g.of('beaconDestroy')).toEqual([{ e: 'beaconDestroy', id: b.id, ownerId: 1, by: null, x: b.x, y: b.y, z: b.z }]);
		g.game.syncPlayers([1, 2, 3], g.clock.now);
		g.advance(20);
		expect(g.game.playerView(1)!.hasBeacon).toBe(false);
		expect(g.game.view(g.clock.now).beacons).toEqual([]);

		// The replacement infected places one; the round ends on the clock and it goes.
		const inf = g.game.view(g.clock.now).players.filter((p) => p.team === 'infected' && p.alive).map((p) => p.id);
		g.put(1, -600, 600);
		expect(inf.length).toBeGreaterThan(0);
		for (const id of inf) expect(g.game.placeBeacon(id, g.clock.now)).toMatchObject({ ok: true });
		const n = g.of('beaconDestroy').length;
		g.advanceUntil('end', 3000);
		expect(g.of('beaconDestroy').length).toBe(n + inf.length);
		expect(g.game.view(g.clock.now).beacons).toEqual([]);

		// Next round: placed, then dropping below 2 players clears it.
		const h = playing([1, 2]);
		h.put(1, -600, 600);
		expect(h.game.placeBeacon(1, h.clock.now).ok).toBe(true);
		h.game.syncPlayers([1], h.clock.now);
		h.advance(50);
		expect(h.game.phase).toBe('waiting');
		expect(h.of('beaconDestroy')).toHaveLength(1);
		expect(h.game.view(h.clock.now).beacons).toEqual([]);
	});
});

/** Deterministic rng for pellet scatter. */
const lcg = (seed: number) => () => {
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
	return seed / 4294967296;
};

describe('MW3 primaries and the three-slot loadout', () => {
	/** A shot along `dir` from the eye. */
	const fireDir = (g: ReturnType<typeof playing>, id: number, dir: Vec3, origin = g.eye(id)) => {
		const r = g.game.fire(id, { weapon: g.game.weaponOf(id)!.weapon, origin, dir, tick: g.game.tick }, g.clock.now);
		g.events.push(...r.events);
		return r;
	};

	it('Barrett .50cal: one body shot kills or infects, and a bullet pierces lined-up infected', () => {
		const g = playing([1, 2, 3, 4]);
		expect(g.game.roundLoadout).toBe('barrett');
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		g.put(3, 1000, 1000);
		g.put(4, 1000, -1000);
		g.shoot(1, { x: -300, y: 0, z: 0 }, false); // Patient Zero's body shot: 8 damage
		expect(g.of('infect')).toEqual([{ e: 'infect', id: 2, by: 1, method: 'gun', timeAdded: INF_INFECTION_BONUS_SECS }]);
		g.put(3, -900, 600);
		g.put(1, -600, 600);
		g.put(2, -300, 600);
		const r = fireDir(g, 3, unit(1, 0, 0), { x: -900, y: 600, z: 40 });
		expect(r.ok).toBe(true);
		expect(r.events.filter((e) => e.e === 'shot')).toHaveLength(1);
		expect(r.events.filter((e) => e.e === 'kill').map((e) => (e as Ev<'kill'>).targetId)).toEqual([1, 2]);
		expect(r.events.filter((e) => e.e === 'hit').every((e) => (e as Ev<'hit'>).kill && !(e as Ev<'hit'>).head)).toBe(true);
		expect(g.game.primaryOf(3)!.mag).toBe(9);
		expect(fireDir(g, 3, unit(1, 0, 0))).toMatchObject({ ok: false, reason: 'too fast' });
		g.advance(WEAPONS.barrett.fireMs);
		expect(fireDir(g, 3, unit(0, 1, 0)).ok).toBe(true);
	});

	it('Striker: 8 pellets per shell add up to one hit per target; close range one-shots, long range only hurts', () => {
		let rng = () => 0;
		const g = playing([1, 2, 3], { round: 2, rng: () => rng() });
		expect(g.game.roundLoadout).toBe('striker');
		expect(WEAPONS.striker).toMatchObject({ pellets: 8, pelletSpread: 4, damage: 1, magazine: 12 });
		rng = lcg(7);
		g.put(1, -600, 0);
		g.put(2, -600, 1100); // long range: the scatter misses most pellets
		g.put(3, 1000, 1000);
		const far = g.shoot(2, { x: -600, y: 0, z: 0 }, false);
		expect(far.ok).toBe(true);
		expect(far.events.filter((e) => e.e === 'shot')).toHaveLength(1);
		expect(far.events.filter((e) => e.e === 'hit')).toEqual([{ e: 'hit', by: 2, targetId: 1, head: false, kill: false }]);
		const hurt = far.events.filter((e): e is Ev<'hurt'> => e.e === 'hurt');
		expect(hurt).toHaveLength(1);
		expect(hurt[0]!.hp).toBeGreaterThan(0);
		expect(hurt[0]!.hp).toBeLessThan(INF_INFECTED_HP);
		// Knockback adds up per pellet that hit.
		const pelletsHit = INF_INFECTED_HP - hurt[0]!.hp;
		expect(Math.hypot(hurt[0]!.kx, hurt[0]!.ky)).toBeCloseTo(pelletsHit * WEAPONS.striker.knockback, 6);
		g.advance(WEAPONS.striker.fireMs);
		g.put(2, -600, 100);
		const near = g.shoot(2, { x: -600, y: 0, z: 0 }, false);
		expect(near.events.filter((e) => e.e === 'hit')).toEqual([{ e: 'hit', by: 2, targetId: 1, head: false, kill: true }]);
		expect(near.events.filter((e) => e.e === 'kill')).toHaveLength(1);
		expect(near.events.filter((e) => e.e === 'shot')).toHaveLength(1);
		expect(g.game.primaryOf(2)!.mag).toBe(10); // one shell per trigger pull
	});

	it('Striker pellets smash a respawn beacon (one shell, one hitmarker)', () => {
		let rng = () => 0;
		const g = playing([1, 2, 3], { round: 2, rng: () => rng() });
		rng = lcg(3);
		g.put(1, -600, 600, 0, 90);
		g.put(3, 1000, 1000);
		const b = g.game.placeBeacon(1, g.clock.now).events.find((e): e is Ev<'beaconPlace'> => e.e === 'beaconPlace')!;
		g.put(1, 600, -600);
		g.put(2, -600, 450);
		const o = g.eye(2);
		const r = fireDir(g, 2, unit(b.x - o.x, b.y - o.y, b.z + INF_BEACON_HIT_Z - o.z));
		expect(r.ok).toBe(true);
		expect(r.events.filter((e) => e.e === 'hit')).toEqual([{ e: 'hit', by: 2, targetId: 0, head: false, kill: true }]);
		expect(r.events).toContainEqual({ e: 'beaconDestroy', id: b.id, ownerId: 1, by: 2, x: b.x, y: b.y, z: b.z });
		expect(g.game.playerView(2)!.score).toBe(INF_SCORE_BEACON_DESTROY);
		expect(g.game.primaryOf(2)!.mag).toBe(11);
	});

	it('SMG: automatic at 65 ms, a 36-round magazine, 1.75 s reload', () => {
		const g = playing([1, 2, 3], { round: 4 });
		expect(g.game.roundLoadout).toBe('smg');
		expect(WEAPONS.smg.automatic).toBe(true);
		g.put(1, -1000, -1000);
		g.put(2, 1000, 1000);
		g.put(3, 1000, -1000);
		expect(fireDir(g, 2, unit(0, -1, 0)).ok).toBe(true);
		expect(fireDir(g, 2, unit(0, -1, 0))).toMatchObject({ ok: false, reason: 'too fast' });
		let ok = 1;
		for (let i = 0; i < 40; i++) {
			g.advance(70);
			if (fireDir(g, 2, unit(0, -1, 0)).ok) ok++;
		}
		expect(ok).toBe(36);
		expect(fireDir(g, 2, unit(0, -1, 0))).toMatchObject({ ok: false, reason: 'empty' });
		expect(g.game.reload(2, g.clock.now)).toBe(true);
		g.advance(WEAPONS.smg.reloadMs - 100);
		expect(g.game.weaponOf(2)!.reloading(g.clock.now)).toBe(true);
		g.advance(150);
		expect(g.game.primaryOf(2)!.reloading(g.clock.now)).toBe(false);
		expect(g.game.primaryOf(2)).toMatchObject({ mag: 36, reserve: 36 });
	});

	it('three slots: primary, pistol and knife keep their own ammo; a swap cancels a reload', () => {
		const g = playing([1, 2, 3], LMG);
		g.put(1, -1000, -1000);
		g.put(2, 1000, 1000);
		g.put(3, 1000, -1000);
		for (let i = 0; i < 3; i++) {
			fireDir(g, 2, unit(0, -1, 0));
			g.advance(100);
		}
		expect(g.game.selectWeapon(2, 'pistol', g.clock.now)).toEqual([{ e: 'ammo', id: 2, weapon: 'pistol', mag: 12, reserve: 36 }]);
		expect(g.game.moveSpeed(2)).toBe(WEAPONS.pistol.moveSpeed);
		for (let i = 0; i < 2; i++) {
			expect(fireDir(g, 2, unit(0, -1, 0)).ok).toBe(true);
			g.advance(200);
		}
		expect(g.game.secondaryOf(2)).toMatchObject({ weapon: 'pistol', mag: 10, reserve: 36 });
		expect(g.game.primaryOf(2)).toMatchObject({ weapon: 'lmg', mag: 97, reserve: 100 });
		// A pistol reload cut short by a swap gives nothing.
		expect(g.game.reload(2, g.clock.now)).toBe(true);
		expect(g.game.selectWeapon(2, 'knife', g.clock.now)).toEqual([{ e: 'ammo', id: 2, weapon: 'knife', mag: 0, reserve: 0 }]);
		g.advance(WEAPONS.pistol.reloadMs * 2);
		expect(g.game.selectWeapon(2, 'pistol', g.clock.now)).toEqual([{ e: 'ammo', id: 2, weapon: 'pistol', mag: 10, reserve: 36 }]);
		expect(g.game.weaponOf(2)!.reloading(g.clock.now)).toBe(false);
		// A finished pistol reload fills only the pistol.
		expect(g.game.reload(2, g.clock.now)).toBe(true);
		g.advance(WEAPONS.pistol.reloadMs + 50);
		expect(g.game.secondaryOf(2)!.reloading(g.clock.now)).toBe(false);
		expect(g.game.secondaryOf(2)).toMatchObject({ mag: 12, reserve: 34 });
		expect(g.game.selectWeapon(2, 'lmg', g.clock.now)).toEqual([{ e: 'ammo', id: 2, weapon: 'lmg', mag: 97, reserve: 100 }]);
		// Only this round's primary, the pistol and the knife.
		for (const w of ['sniper', 'smg', 'barrett', 'striker', 'claws'] as const) expect(g.game.selectWeapon(2, w, g.clock.now)).toEqual([]);
		// The Alpha carries all three until the first infection.
		expect(g.game.selectWeapon(1, 'pistol', g.clock.now)).toEqual([{ e: 'ammo', id: 1, weapon: 'pistol', mag: 12, reserve: 36 }]);
	});

	it('the Alpha drops the pistol too at the first infection', () => {
		const g = playing([1, 2, 3], LMG);
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		g.put(3, 1000, 1000);
		g.game.selectWeapon(1, 'pistol', g.clock.now);
		g.shoot(1, { x: -300, y: 0, z: 0 }, true);
		expect(g.game.playerView(1)).toMatchObject({ alpha: false, weapon: 'claws' });
		expect(g.game.selectWeapon(1, 'pistol', g.clock.now)).toEqual([]);
		expect(g.game.selectWeapon(2, 'pistol', g.clock.now)).toEqual([]);
	});
});

describe('kill streak perks and the M.O.A.B.', () => {
	/** 1 infects 2: infected 1 and 2; survivor 3 at (-600, 600) does the killing; 4 hides. */
	function streakGame(opts: Opts = {}) {
		const g = playing([1, 2, 3, 4], { ...LMG, ...opts });
		g.put(1, -600, 0);
		g.put(2, -300, 0);
		g.put(3, 1000, 1000);
		g.put(4, 1000, -1000);
		g.shoot(1, { x: -300, y: 0, z: 0 }, true);
		g.advance(20);
		expect(g.game.playerView(2)!.team).toBe('infected');
		g.put(3, -600, 600);
		return g;
	}
	/** Survivor 3 headshots whichever infected is alive (waits for a respawn); returns that shot's events. */
	function killOne(g: ReturnType<typeof streakGame>): InfEvent[] {
		for (let i = 0; i < 1000; i++) {
			const v = [1, 2].find((id) => g.game.playerView(id)!.alive);
			if (v !== undefined && g.game.weaponOf(3)!.canFire(g.clock.now)) {
				g.put(v, -600, 300);
				const r = g.shoot(3, { x: -600, y: 300, z: 0 }, true);
				expect(r.events.find((e) => e.e === 'kill')).toMatchObject({ by: 3, targetId: v });
				return r.events;
			}
			g.advance(INF_STEP_MS);
		}
		throw new Error('no infected to kill');
	}
	const perkEvents = (evs: InfEvent[]) => evs.filter((e): e is Ev<'perk'> => e.e === 'perk');

	it('perk table and helper', () => {
		expect(INF_PERK_KILLS).toEqual({ hardline: 0, sleight: 1, scavenger: 3, steady: 5, specialist: 7 });
		expect(infPerksForStreak(0)).toEqual(['hardline']);
		expect(infPerksForStreak(1)).toEqual(['hardline', 'sleight']);
		expect(infPerksForStreak(4)).toEqual(['hardline', 'sleight', 'scavenger']);
		expect(infPerksForStreak(6)).toEqual(['hardline', 'sleight', 'scavenger', 'steady']);
		expect(infPerksForStreak(30)).toEqual(['hardline', 'sleight', 'scavenger', 'steady', 'specialist']);
		expect(INF_MOAB_KILLS).toBe(24);
		expect(INF_MOAB_COUNTDOWN_SECS).toBe(10);
		expect(infEventRoute({ e: 'moabReady', id: 3 })).toEqual({ to: 3 });
		expect(infEventRoute({ e: 'perk', id: 3, perk: 'sleight', streak: 1 })).toEqual({});
		expect(infEventRoute({ e: 'moabCall', by: 3, secs: 10 })).toEqual({});
		expect(infEventRoute({ e: 'moabDetonate', by: 3, kills: 2 })).toEqual({});
	});

	it('1 kill: sleight of hand halves reload time (the survivor without a streak reloads at full time)', () => {
		const g = streakGame();
		expect(g.game.playerView(3)).toMatchObject({ streak: 0, perks: ['hardline'], moabReady: false });
		expect(g.game.playerView(1)).toMatchObject({ streak: 0, perks: [] });
		const evs = killOne(g);
		expect(perkEvents(evs)).toEqual([{ e: 'perk', id: 3, perk: 'sleight', streak: 1 }]);
		expect(g.game.playerView(3)).toMatchObject({ streak: 1, perks: ['hardline', 'sleight'] });
		g.advance(100);
		expect(g.game.reload(3, g.clock.now)).toBe(true);
		const ws = g.game.weaponOf(3)!;
		expect(ws.reloadEndsAt - g.clock.now).toBe(WEAPONS.lmg.reloadMs * INF_SLEIGHT_RELOAD_FACTOR);
		g.advance(WEAPONS.lmg.reloadMs / 4);
		expect(ws.reloadProgress(g.clock.now)).toBeCloseTo(0.5, 1);
		g.advance(WEAPONS.lmg.reloadMs / 4 + 20);
		expect(ws.reloading(g.clock.now)).toBe(false);
		expect(ws.mag).toBe(100);
		// Survivor 4 (no kills): full reload time.
		g.put(4, 1000, -1000);
		g.shoot(4, { x: 1000, y: 0, z: 0 }, false);
		expect(g.game.reload(4, g.clock.now)).toBe(true);
		expect(g.game.weaponOf(4)!.reloadEndsAt - g.clock.now).toBe(WEAPONS.lmg.reloadMs);
	});

	it('before 3 kills an emergency refill (primary only); at 3 the scavenger perk refills primary (cap x1.5) and pistol', () => {
		const g = streakGame();
		const ammo = (evs: InfEvent[]) => evs.filter((e): e is Ev<'ammo'> => e.e === 'ammo' && e.scavenger === true);
		const first = ammo(killOne(g));
		expect(first).toHaveLength(1);
		expect(first[0]).toMatchObject({ weapon: 'lmg', reserve: 100 + Math.ceil(INF_AMMO.lmg!.scavenger * 0.4) });
		killOne(g);
		g.game.primaryOf(3)!.reserve = 280;
		g.game.secondaryOf(3)!.reserve = 30;
		const third = killOne(g);
		expect(perkEvents(third)).toEqual([{ e: 'perk', id: 3, perk: 'scavenger', streak: 3 }]);
		expect(ammo(third)).toEqual([
			{ e: 'ammo', id: 3, weapon: 'lmg', mag: 97, reserve: 280 + INF_AMMO.lmg!.scavenger, scavenger: true },
			{ e: 'ammo', id: 3, weapon: 'pistol', mag: 12, reserve: 30 + INF_AMMO.pistol!.scavenger, scavenger: true }
		]);
		g.game.primaryOf(3)!.reserve = 440;
		g.game.secondaryOf(3)!.reserve = 90;
		killOne(g);
		expect(g.game.primaryOf(3)!.reserve).toBe(Math.round(WEAPONS.lmg.reserve * 1.5));
		expect(g.game.secondaryOf(3)!.reserve).toBe(WEAPONS.pistol.reserve);
	});

	it('5 kills: steady aim (+12 % speed); 7 kills: specialist bonus (cadence, knockback, 6 HP, +250); infection resets it all', () => {
		const g = streakGame();
		for (let i = 0; i < 4; i++) killOne(g);
		expect(g.game.moveSpeed(3)).toBe(WEAPONS.lmg.moveSpeed);
		expect(perkEvents(killOne(g))).toEqual([{ e: 'perk', id: 3, perk: 'steady', streak: 5 }]);
		expect(g.game.moveSpeed(3, g.clock.now)).toBeCloseTo(WEAPONS.lmg.moveSpeed * INF_STEADY_SPEED_FACTOR, 6);
		killOne(g);
		const before = g.game.playerView(3)!.score;
		const seventh = killOne(g);
		expect(perkEvents(seventh)).toEqual([{ e: 'perk', id: 3, perk: 'specialist', streak: 7 }]);
		expect(g.game.playerView(3)).toMatchObject({ streak: 7, hp: INF_SPECIALIST_HP, kills: 7, perks: ['hardline', 'sleight', 'scavenger', 'steady', 'specialist'] });
		expect(g.game.playerView(3)!.score - before).toBe(INF_SCORE_KILL + INF_SCORE_SPECIALIST);
		// Stronger knockback on a body hit that does not kill.
		const v = [1, 2].find((id) => g.game.playerView(id)!.alive) ?? (g.advanceUntil('spawn', 4000), [1, 2].find((id) => g.game.playerView(id)!.alive)!);
		g.advance(100);
		g.put(v, -600, 300);
		const hit = g.shoot(3, { x: -600, y: 300, z: 0 }, false);
		const hurt = hit.events.find((e): e is Ev<'hurt'> => e.e === 'hurt')!;
		expect(Math.hypot(hurt.kx, hurt.ky)).toBeCloseTo(WEAPONS.lmg.knockback * INF_SPECIALIST_KNOCKBACK_FACTOR, 6);
		// Faster cadence from the first shot after the unlock.
		const ws = g.game.weaponOf(3)!;
		expect(ws.nextFireAt - g.clock.now).toBeCloseTo(WEAPONS.lmg.fireMs * INF_SPECIALIST_CADENCE_FACTOR, 6);
		// Infected: streak and perks gone.
		g.put(v, -640, 600);
		for (let i = 0; i < 100 && g.game.playerView(3)!.team === 'survivor'; i++) {
			g.advance(100);
			g.shoot(v, { x: -600, y: 600, z: 0 }, false);
		}
		expect(g.game.playerView(3)).toMatchObject({ team: 'infected', streak: 0, perks: [], moabReady: false, weapon: 'claws' });
		expect(g.game.moveSpeed(3)).toBe(INF_INFECTED_SPEED);
	});

	it('steady aim tightens the Striker scatter on the server', () => {
		// Same rng sequence: the steady shot lands at least as many pellets at long range.
		const pellets = (streak: number) => {
			let rng = () => 0;
			const g = playing([1, 2, 3], { round: 2, rng: () => rng() });
			g.put(1, -600, 0);
			g.put(2, -600, 1100);
			g.put(3, 1000, 1000);
			// Build the streak by killing the respawning Alpha.
			for (let i = 0; i < streak; i++) {
				g.advanceUntil('spawn', 4000);
				g.put(1, -600, 1000);
				g.advance(300);
				g.shoot(2, { x: -600, y: 1000, z: 0 }, true);
			}
			expect(g.game.playerView(2)!.streak).toBe(streak);
			g.advanceUntil('spawn', 4000);
			g.put(1, -600, 0);
			g.advance(300);
			rng = lcg(11);
			const r = g.shoot(2, { x: -600, y: 0, z: 0 }, false);
			const hurt = r.events.find((e): e is Ev<'hurt'> => e.e === 'hurt');
			const kill = r.events.some((e) => e.e === 'kill');
			return kill ? INF_INFECTED_HP : INF_INFECTED_HP - (hurt?.hp ?? INF_INFECTED_HP);
		};
		const loose = pellets(0);
		const steady = pellets(5);
		expect(steady).toBeGreaterThan(loose);
	});

	it('M.O.A.B.: unlocks at moabKills, 10 s countdown, stays inbound when the caller turns, wipes the infected, survivors win', () => {
		const g = streakGame({ moabKills: 3 });
		expect(g.game.callMoab(3, g.clock.now)).toMatchObject({ ok: false, reason: 'not earned' });
		killOne(g);
		killOne(g);
		const ready = killOne(g);
		expect(ready.filter((e) => e.e === 'moabReady')).toEqual([{ e: 'moabReady', id: 3 }]);
		expect(g.game.playerView(3)!.moabReady).toBe(true);
		expect(g.game.callMoab(1, g.clock.now)).toMatchObject({ ok: false, reason: 'not a survivor' });
		expect(g.game.callMoab(4, g.clock.now)).toMatchObject({ ok: false, reason: 'not earned' });
		const call = g.game.callMoab(3, g.clock.now);
		expect(call).toEqual({ ok: true, events: [{ e: 'moabCall', by: 3, secs: INF_MOAB_COUNTDOWN_SECS }] });
		expect(g.game.playerView(3)!.moabReady).toBe(false);
		expect(g.game.view(g.clock.now).moab).toEqual({ callerId: 3, timeLeft: INF_MOAB_COUNTDOWN_SECS });
		expect(g.game.callMoab(3, g.clock.now)).toMatchObject({ ok: false });
		// The next kill does not re-arm it.
		expect(killOne(g).filter((e) => e.e === 'moabReady')).toEqual([]);
		const kills = g.game.playerView(3)!.kills;
		const score = g.game.playerView(3)!.score;
		// The caller turns mid-countdown: it still comes.
		const v = [1, 2].find((id) => g.game.playerView(id)!.alive) ?? (g.advanceUntil('spawn', 4000), [1, 2].find((id) => g.game.playerView(id)!.alive)!);
		g.put(v, -640, 600);
		g.advance(1000);
		g.shoot(v, { x: -600, y: 600, z: 0 }, false);
		expect(g.game.playerView(3)!.team).toBe('infected');
		expect(g.game.view(g.clock.now).moab?.callerId).toBe(3);
		g.advance(4000); // every infected is alive again
		const alive = [1, 2, 3].filter((id) => g.game.playerView(id)!.alive).length;
		expect(alive).toBe(3);
		const s4 = g.game.playerView(4)!.score;
		const det = g.advanceUntil('moabDetonate', 6000)!;
		expect(det).toEqual({ e: 'moabDetonate', by: 3, kills: 3 });
		expect(g.of('end').at(-1)).toMatchObject({ winner: 'survivors', survivorsLeft: 1 });
		expect(g.game.phase).toBe('ended');
		expect([1, 2, 3].every((id) => !g.game.playerView(id)!.alive)).toBe(true);
		// The turned caller still gets the credit.
		expect(g.game.playerView(3)).toMatchObject({ kills: kills + 3, score: score + INF_SCORE_MOAB });
		expect(g.game.playerView(4)!.score).toBe(s4 + INF_SCORE_SURVIVE_WIN);
		expect(g.game.view(g.clock.now).moab).toBeNull();
		g.advance(1100);
		expect(g.game.phase).toBe('grace');
		expect(g.game.view(g.clock.now).moab).toBeNull();
	});

	it('M.O.A.B. defaults to a 24-kill streak and is refused outside playing', () => {
		const g = streakGame({ roundSecs: 600 });
		for (let i = 1; i < INF_MOAB_KILLS; i++) expect(killOne(g).filter((e) => e.e === 'moabReady')).toEqual([]);
		expect(g.game.playerView(3)!.moabReady).toBe(false);
		expect(killOne(g).filter((e) => e.e === 'moabReady')).toEqual([{ e: 'moabReady', id: 3 }]);
		expect(g.game.playerView(3)).toMatchObject({ streak: 24, moabReady: true });
		const w = newGame([1]);
		w.advance(100);
		expect(w.game.callMoab(1, w.clock.now)).toMatchObject({ ok: false, reason: 'no round' });
	});
});
