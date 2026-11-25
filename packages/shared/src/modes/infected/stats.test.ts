import { describe, expect, it } from 'vitest';
import { playerPoint, type PlayerPose } from '../zombies/hitbox.ts';
import { INF_SCORE_INFECT, INF_SCORE_KILL, INF_SCORE_SURVIVE_TICK, infLoadout, type InfRoundStat } from './game.ts';
import { infRoundStat, newInfTally } from './stats.ts';
import { kitGame, kitPlaying, unit, type Ev } from './testkit.ts';

const at = (x: number, y: number, hunched = false): PlayerPose => ({ x, y, z: 0, yaw: 0, ducked: false, hunched });
const shin = (x: number, y: number) => ({ x, y, z: 12 });

describe('infRoundStat', () => {
	it('copies the tallies; a survivor at the end survived the whole round', () => {
		const t = { ...newInfTally(), shots: 9, hits: 4, headshots: 2, kills: 3, infections: 1, bestStreak: 3, survivedMs: 12_340, alpha: true };
		expect(infRoundStat({ id: 7, team: 'infected', score: 450, deaths: 2 }, t, 60.5)).toEqual({
			id: 7,
			team: 'infected',
			alpha: true,
			score: 450,
			kills: 3,
			infections: 1,
			deaths: 2,
			shots: 9,
			hits: 4,
			headshots: 2,
			bestStreak: 3,
			survivedSecs: 12.3
		});
		expect(infRoundStat({ id: 7, team: 'survivor', score: 0, deaths: 0 }, t, 60.5).survivedSecs).toBe(60.5);
		// Never longer than the round.
		expect(infRoundStat({ id: 7, team: 'infected', score: 0, deaths: 0 }, { ...t, survivedMs: 99_000 }, 60.5).survivedSecs).toBe(60.5);
	});
});

describe('round stats', () => {
	/**
	 * LMG round, 20 s: Patient Zero (1) swings at nothing once and claws 2
	 * after 5 s; survivor 3 kills 2 with five body hits and misses
	 * twice; 4 never fires. Returns the game right before the clock runs out.
	 */
	function round(opts: Parameters<typeof kitPlaying>[1] = {}) {
		const g = kitPlaying([1, 2, 3, 4], { round: 3, roundSecs: 20, ...opts });
		g.put(1, { x: -600, y: 0 });
		g.put(2, { x: -300, y: 0 });
		g.put(3, { x: -300, y: 600 });
		g.put(4, { x: 1000, y: -1000 });
		g.advance(4000);
		g.fireAt(1, { x: -600, y: 0, z: 500 });
		g.advance(1200);
		g.put(1, { x: -340, y: 0 });
		g.fireAt(1, { x: -300, y: 0, z: 64 });
		expect(g.game.playerView(2)!.team).toBe('infected');
		const infectedAt = g.clock.now;
		g.put(1, { x: -600, y: 0 });
		g.advance(1000);
		for (let i = 0; i < 2; i++) {
			g.fireAt(3, { x: -300, y: 600, z: 500 });
			g.advance(200);
		}
		for (let i = 0; i < 5; i++) {
			g.fireAt(3, shin(-300, 0));
			g.advance(200);
		}
		return Object.assign(g, { infectedAt });
	}
	/** Seconds into the round at time `t` (to the 0.1 s of the stats; the sim clock is up to a step behind). */
	const secsAt = (g: { game: { startedAt: number } }, t: number) => (t - g.game.startedAt) / 1000;
	const end = (g: ReturnType<typeof round>): Ev<'end'> => {
		while (g.game.phase === 'playing') g.advance(100);
		return g.of('end').at(-1)!;
	};
	const row = (ev: Ev<'end'>, id: number): InfRoundStat => ev.stats!.find((s) => s.id === id)!;

	it('the end event carries one row per player: shots, hits, headshots, kills, infections, streak, survived time', () => {
		const g = round();
		const ev = end(g);
		expect(ev.winner).toBe('survivors');
		expect(ev.stats).toHaveLength(4);
		expect(row(ev, 1)).toEqual({
			id: 1,
			team: 'infected',
			alpha: true,
			score: INF_SCORE_INFECT,
			kills: 0,
			infections: 1,
			deaths: 0,
			shots: 0,
			hits: 0,
			headshots: 0,
			bestStreak: 0,
			survivedSecs: 0
		});
		// Survived until Patient Zero's claws, a good 5 s into the round.
		expect(row(ev, 2)).toMatchObject({ team: 'infected', alpha: false, kills: 0, infections: 0, deaths: 2, shots: 0, hits: 0, bestStreak: 0 });
		expect(secsAt(g, g.infectedAt)).toBeGreaterThan(5);
		expect(Math.abs(row(ev, 2).survivedSecs - secsAt(g, g.infectedAt))).toBeLessThan(0.11);
		expect(row(ev, 3)).toMatchObject({ team: 'survivor', alpha: false, kills: 1, infections: 0, deaths: 0, shots: 7, hits: 5, headshots: 0, bestStreak: 1 });
		expect(row(ev, 3).survivedSecs).toBe(ev.secs);
		expect(row(ev, 4)).toMatchObject({ team: 'survivor', shots: 0, hits: 0, kills: 0, bestStreak: 0, survivedSecs: ev.secs });
		expect(ev.secs).toBeGreaterThan(20);
	});

	it('rows are in scoreboard order and agree with the scoreboard; the next loadout is named', () => {
		const g = round();
		const ev = end(g);
		const view = g.game.view(g.clock.now);
		expect(ev.stats!.map((s) => s.id)).toEqual(view.players.map((p) => p.id));
		for (const p of view.players) {
			const s = row(ev, p.id);
			expect([s.score, s.deaths, s.team]).toEqual([p.score, p.deaths, p.team]);
			// The scoreboard's kills are infected killed plus survivors infected.
			expect(s.kills + s.infections).toBe(p.kills);
		}
		expect(row(ev, 3).score).toBe(view.players.find((p) => p.id === 3)!.score);
		expect(ev.nextLoadout).toBe(infLoadout(ev.round + 1));
		expect(ev.nextLoadout).toBe('smg');
	});

	it('shots before the round is being played and melee swings are not counted', () => {
		const g = kitGame([1, 2, 3], { round: 3, roundSecs: 5 });
		g.advance(200);
		expect(g.game.phase).toBe('grace');
		g.put(1, { x: -600, y: 0 });
		g.put(2, { x: -300, y: 0 });
		g.put(3, { x: 1000, y: -1000 });
		expect(g.fireAt(2, { x: 0, y: 0, z: 500 }).ok).toBe(true);
		g.advance(1000);
		expect(g.game.phase).toBe('playing');
		g.game.selectWeapon(2, 'knife', g.clock.now);
		g.advance(300); // past any draw time
		expect(g.fireAt(2, { x: 0, y: 0, z: 64 }).ok).toBe(true);
		while (g.game.phase === 'playing') g.advance(100);
		const ev = g.of('end').at(-1)!;
		expect(ev.stats!.find((s) => s.id === 2)).toMatchObject({ shots: 0, hits: 0 });
	});

	it('one shotgun shell is one shot and one hit, however many pellets land', () => {
		const g = kitPlaying([1, 2, 3], { round: 2, roundSecs: 5 });
		g.put(1, { x: 0, y: 0 });
		g.put(2, { x: 0, y: -120 });
		g.put(3, { x: 1000, y: -1000 });
		g.advance(100);
		const r = g.fireAt(2, { x: 0, y: 0, z: 47 });
		expect(g.of('hit', r.events)).toHaveLength(1);
		while (g.game.phase === 'playing') g.advance(100);
		expect(g.of('end').at(-1)!.stats!.find((s) => s.id === 2)).toMatchObject({ shots: 1, hits: 1, headshots: 0 });
	});

	it('stats follow a player through a leave and rejoin; a survivor who left stopped surviving then', () => {
		const g = round();
		// Survivor 3 (7 shots, 5 hits, 1 kill) leaves 2 s later and comes back as an infected.
		g.advance(2000);
		const left = g.clock.now;
		g.game.syncPlayers([1, 2, 4], g.clock.now);
		g.advance(1000);
		g.game.syncPlayers([1, 2, 3, 4], g.clock.now);
		g.advance(100);
		expect(g.game.playerView(3)).toMatchObject({ team: 'infected', kills: 1, score: INF_SCORE_KILL + INF_SCORE_SURVIVE_TICK });
		const ev = end(g);
		expect(row(ev, 3)).toMatchObject({ team: 'infected', kills: 1, shots: 7, hits: 5, bestStreak: 1 });
		// Survived until they left, not until the end.
		expect(secsAt(g, left)).toBeGreaterThan(9);
		expect(Math.abs(row(ev, 3).survivedSecs - secsAt(g, left))).toBeLessThan(0.11);
		expect(row(ev, 3).survivedSecs).toBeLessThan(ev.secs - 5);
	});

	it('a player who is gone at the end has no row; the next round starts every tally at zero', () => {
		const g = round();
		g.game.syncPlayers([1, 2, 4], g.clock.now);
		const ev = end(g);
		expect(ev.stats!.map((s) => s.id).sort()).toEqual([1, 2, 4]);
		// Round 4 (SMG): nobody fires; survivors hold out.
		g.game.syncPlayers([1, 2, 3, 4], g.clock.now);
		while (g.game.phase !== 'playing') g.advance(100);
		g.put(1, { x: -600, y: 0 });
		g.put(2, { x: -300, y: 0 });
		g.put(3, { x: -300, y: 600 });
		g.put(4, { x: 1000, y: -1000 });
		const next = end(g);
		expect(next.round).toBe(ev.round + 1);
		expect(next.stats).toHaveLength(4);
		for (const s of next.stats!) {
			expect(s).toMatchObject({ kills: 0, infections: 0, deaths: 0, shots: 0, hits: 0, headshots: 0, bestStreak: 0 });
			expect(s.alpha).toBe(s.id === g.game.alphaId);
		}
	});

	it('a M.O.A.B. wipe counts as kills of the caller, as on the scoreboard', () => {
		const g = round({ moabKills: 1, moabCountdownSecs: 1 });
		// Survivor 3 earned it with the kill of 2; 2 has respawned by the time it lands.
		g.advance(3200);
		expect(g.game.callMoab(3, g.clock.now).ok).toBe(true);
		const ev = end(g);
		expect(g.of('moabDetonate').at(-1)).toMatchObject({ by: 3, kills: 2 });
		expect(row(ev, 3)).toMatchObject({ kills: 3, bestStreak: 1 });
		expect(g.game.playerView(3)!.kills).toBe(3);
	});

	it('a survivor who takes over as Patient Zero is marked, with the time survived until then', () => {
		const g = kitPlaying([1, 2, 3], { round: 3, roundSecs: 20 });
		g.put(2, { x: -300, y: 0 });
		g.put(3, { x: 300, y: 600 });
		g.advance(4000);
		// Patient Zero leaves before any infection: a survivor takes over.
		const tookOver = g.clock.now;
		g.game.syncPlayers([2, 3], g.clock.now);
		g.advance(100);
		const zero = g.game.alphaId!;
		expect([2, 3]).toContain(zero);
		while (g.game.phase === 'playing') g.advance(100);
		const ev = g.of('end').at(-1)!;
		const z = ev.stats!.find((s) => s.id === zero)!;
		expect(z).toMatchObject({ alpha: true, team: 'infected' });
		expect(Math.abs(z.survivedSecs - secsAt(g, tookOver))).toBeLessThan(0.11);
		expect(z.survivedSecs).toBeGreaterThan(3.9);
		expect(ev.stats!.find((s) => s.id !== zero)).toMatchObject({ alpha: false, team: 'survivor', survivedSecs: ev.secs });
	});

	it('a bullet through two heads is one shot, one hit and one headshot', () => {
		// .50 cal rifle round: one bullet through the heads of two infected in a line.
		const g = kitPlaying([1, 2, 3, 4], { round: 1, roundSecs: 20 });
		g.put(1, { x: -600, y: 0 });
		g.put(2, { x: -300, y: 0 });
		g.put(3, { x: 0, y: -600 });
		g.put(4, { x: 1000, y: -1000 });
		g.advance(500);
		g.put(1, { x: -340, y: 0 });
		g.fireAt(1, { x: -300, y: 0, z: 64 });
		expect(g.game.playerView(2)!.team).toBe('infected');
		g.advance(500);
		// 1 (Patient Zero no more, hunched) and 2 stand so that the line through 1's head goes on through 2's.
		g.put(1, { x: 0, y: -300 });
		g.put(2, { x: 10, y: -100 });
		g.advance(100);
		const h1 = playerPoint(at(0, -300, true), 'head');
		const o = g.eye(3);
		const d = unit(h1.x - o.x, h1.y - o.y, h1.z - o.z);
		const r = g.game.fire(3, { weapon: 'barrett', origin: o, dir: d, tick: g.game.tick }, g.clock.now);
		expect(g.of('hit', r.events).map((h) => [h.targetId, h.head])).toEqual([
			[1, true],
			[2, true]
		]);
		while (g.game.phase === 'playing') g.advance(100);
		expect(g.of('end').at(-1)!.stats!.find((s) => s.id === 3)).toMatchObject({ shots: 1, hits: 1, headshots: 1, kills: 2, bestStreak: 2 });
	});
});
