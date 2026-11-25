import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../types.ts';
import { WEAPONS } from '../zombies/weapons.ts';
import { infEventRoute } from './game.ts';
import { kitGame, kitPlaying, unit, type Ev } from './testkit.ts';

function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const DEG = Math.PI / 180;
const threeDecimals = (v: number) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6;

/** The pellets of a shot event as [{ d, len }]. */
function pellets(shot: Ev<'shot'>): Array<{ d: Vec3; len: number }> {
	const p = shot.pellets!;
	const out: Array<{ d: Vec3; len: number }> = [];
	for (let i = 0; i < p.length; i += 4) out.push({ d: { x: p[i]!, y: p[i + 1]!, z: p[i + 2]! }, len: p[i + 3]! });
	return out;
}

describe('shot event: per-pellet data', () => {
	/** Auto shotgun round with a real scatter (seeded rng); returns the game in 'playing' and a survivor's id. */
	function shotgunRound(seed = 7) {
		const g = kitGame([1, 2, 3], { round: 2, rng: rng(seed) });
		g.advance(1100);
		expect(g.game.phase).toBe('playing');
		const survivor = [1, 2, 3].find((id) => id !== g.game.alphaId)!;
		const other = [1, 2, 3].find((id) => id !== g.game.alphaId && id !== survivor)!;
		return { g, survivor, other, zero: g.game.alphaId! };
	}

	it('a shotgun shot carries every pellet after the first: unit directions in the cone, lengths to the wall', () => {
		const { g, survivor, other, zero } = shotgunRound();
		g.put(survivor, { x: 100, y: 0 });
		g.put(other, { x: -1000, y: 1000 });
		g.put(zero, { x: -1000, y: -1000 });
		const o = g.eye(survivor);
		// Level at the thin wall (x 400): every pellet ends on it.
		const r = g.fireAt(survivor, { x: 400, y: 0, z: o.z });
		const shot = g.of('shot', r.events)[0]!;
		expect(shot).toMatchObject({ by: survivor, weapon: 'striker', d: { x: 1, y: 0, z: 0 } });
		// (The world trace stops a hair before the surface.)
		expect(shot.len).toBeCloseTo(300, 0);
		expect(shot.pellets).toHaveLength((WEAPONS.striker.pellets! - 1) * 4);
		expect(shot.pellets!.every(threeDecimals)).toBe(true);
		const cone = Math.cos((WEAPONS.striker.pelletSpread! + 0.05) * DEG);
		const list = pellets(shot);
		for (const p of list) {
			expect(Math.hypot(p.d.x, p.d.y, p.d.z)).toBeCloseTo(1, 2);
			expect(p.d.x).toBeGreaterThanOrEqual(cone);
			// The wall is 300 ahead of the eye along +x.
			expect(p.len).toBeCloseTo(300 / p.d.x, 0);
		}
		// A real scatter: the pellets differ from each other and from the centre.
		expect(new Set(list.map((p) => `${p.d.y},${p.d.z}`)).size).toBe(list.length);
		expect(list.every((p) => p.d.y !== 0 || p.d.z !== 0)).toBe(true);
	});

	it('a pellet that hits a player ends on them; the others fly on to the wall', () => {
		// A seed whose pellets go past the target too: at this distance most volleys land whole.
		const { g, survivor, other, zero } = shotgunRound(5);
		// Patient Zero 100 units ahead of the muzzle, in profile; the wall 500 behind.
		g.put(survivor, { x: -200, y: 0 });
		g.put(zero, { x: -100, y: 0, yaw: 90 });
		g.put(other, { x: -1000, y: 1000 });
		g.advance(50);
		const o = g.eye(survivor);
		const r = g.fireAt(survivor, { x: -100, y: 0, z: 47 });
		const shot = g.of('shot', r.events)[0]!;
		expect(g.of('hit', r.events)).toHaveLength(1);
		const list = pellets(shot);
		const ends = list.map((p) => ({ p, end: { x: o.x + p.d.x * p.len, y: o.y + p.d.y * p.len, z: o.z + p.d.z * p.len } }));
		const onTarget = ends.filter((e) => e.p.len < 130);
		const past = ends.filter((e) => e.p.len >= 130);
		expect(onTarget.length).toBeGreaterThan(0);
		expect(past.length).toBeGreaterThan(0);
		for (const { end } of onTarget) {
			// The end point lies on the target's hit boxes: within 20 units of its axis, between feet and head.
			expect(Math.hypot(end.x + 100, end.y)).toBeLessThan(20);
			expect(end.z).toBeGreaterThan(-2);
			expect(end.z).toBeLessThan(76);
		}
		// The pellets that passed the target end on the floor (z 0) or on the wall (x 400).
		for (const { end } of past) expect(Math.min(Math.abs(end.z), Math.abs(end.x - 400))).toBeLessThan(0.5);
		// The centre pellet stops on the target too.
		expect(shot.len).toBeLessThan(130);
	});

	it('single-bullet guns and melee swings carry no pellets; the shot goes to everyone but the shooter', () => {
		const g = kitPlaying([1, 2, 3], { round: 3 });
		g.put(2, { x: 100, y: 0 });
		const gun = g.of('shot', g.fireAt(2, { x: 400, y: 0, z: 64 }).events)[0]!;
		expect(gun.weapon).toBe('lmg');
		expect('pellets' in gun).toBe(false);
		expect(infEventRoute(gun)).toEqual({ except: 2 });
		g.game.selectWeapon(2, 'knife', g.clock.now);
		g.advance(300); // past any draw time
		const swing = g.of('shot', g.fireAt(2, { x: 400, y: 0, z: 64 }).events)[0]!;
		expect(swing).toMatchObject({ weapon: 'knife', len: 0 });
		expect('pellets' in swing).toBe(false);
	});

	it('the shot event carries a copy of the origin: nothing else the caller put on it', () => {
		const g = kitPlaying([1, 2, 3], { round: 3 });
		g.put(2, { x: 100, y: 0 });
		const origin = { ...g.eye(2), extra: 'x', nested: { a: 1 } } as Vec3;
		const r = g.game.fire(2, { weapon: 'lmg', origin, dir: unit(1, 0, 0), tick: g.game.tick }, g.clock.now);
		const shot = g.of('shot', r.events)[0]!;
		expect(Object.keys(shot.o).sort()).toEqual(['x', 'y', 'z']);
		expect(shot.o).not.toBe(origin);
	});
});

describe('hurt event: direction of the hit', () => {
	it('dx, dy are the unit horizontal direction of the shot, beside the knockback', () => {
		const g = kitPlaying([1, 2, 3], { round: 3 });
		// Survivor 2 (LMG) shoots Patient Zero from above and to the side.
		g.put(2, { x: -300, y: -400, z: 200 });
		g.put(1, { x: 0, y: 0 });
		g.put(3, { x: 1000, y: -1000 });
		g.advance(50);
		const r = g.fireAt(2, { x: 0, y: 0, z: 47 });
		const hurt = g.of('hurt', r.events)[0]!;
		expect(hurt).toMatchObject({ id: 1, hp: 4 });
		expect([hurt.dx, hurt.dy]).toEqual([0.6, 0.8]);
		expect(Math.hypot(hurt.dx!, hurt.dy!)).toBeCloseTo(1, 3);
		// The knockback points the same way, with the weapon's strength.
		expect(Math.hypot(hurt.kx, hurt.ky)).toBeCloseTo(WEAPONS.lmg.knockback, 6);
		expect(hurt.kx / WEAPONS.lmg.knockback).toBeCloseTo(hurt.dx!, 3);
		expect(hurt.ky / WEAPONS.lmg.knockback).toBeCloseTo(hurt.dy!, 3);
		expect(infEventRoute(hurt)).toEqual({ to: 1 });
	});

	it('a shot straight down has no horizontal part: attacker towards victim instead', () => {
		const g = kitPlaying([1, 2, 3], { round: 3 });
		// Survivor 2 hangs 200 above and 50 beside Patient Zero; the shot leaves from right above the shoulder.
		g.put(2, { x: 30, y: 53.5, z: 200 });
		g.put(1, { x: 0, y: 0 });
		g.put(3, { x: 1000, y: -1000 });
		g.advance(50);
		const origin = { x: 3, y: 8.5, z: 264 };
		const r = g.game.fire(2, { weapon: 'lmg', origin, dir: unit(0, 0, -1), tick: g.game.tick }, g.clock.now);
		expect(g.of('hit', r.events)).toEqual([{ e: 'hit', by: 2, targetId: 1, head: false, kill: false }]);
		const hurt = g.of('hurt', r.events)[0]!;
		// From (30, 53.5) to (0, 0): 30-40-50 scaled.
		expect([hurt.dx, hurt.dy]).toEqual([-0.489, -0.872]);
		expect([hurt.kx, hurt.ky]).toEqual([0, 0]);
	});

	it('is left out when there is no direction at all', () => {
		const g = kitPlaying([1, 2, 3], { round: 3 });
		// Right above Patient Zero, shooting straight down through their shoulder (8.5 to the side of the muzzle's player).
		g.put(2, { x: 0, y: 0, z: 200 });
		g.put(1, { x: 0, y: 0 });
		g.put(3, { x: 1000, y: -1000 });
		g.advance(50);
		const r = g.game.fire(2, { weapon: 'lmg', origin: { x: 3, y: 8.5, z: 264 }, dir: unit(0, 0, -1), tick: g.game.tick }, g.clock.now);
		const hurt = g.of('hurt', r.events)[0]!;
		expect(hurt).toMatchObject({ id: 1, kx: 0, ky: 0 });
		expect('dx' in hurt || 'dy' in hurt).toBe(false);
	});
});
