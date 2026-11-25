/**
 * Weapon swap rules of `selectWeapon`: the draw time (`deployMs`) before the
 * new weapon can fire, enforced with the fire tolerance on a lenient (server)
 * game, and what a swap must not change.
 */
import { describe, expect, it } from 'vitest';
import { buildCollisionWorld } from '../../collision/world.ts';
import type { MapDef } from '../../maps/types.ts';
import { VIEW_HEIGHT } from '../../movement/api.ts';
import type { Vec3 } from '../../types.ts';
import { ZM_FIRE_TOLERANCE } from '../zombies/game.ts';
import { WEAPONS, type WeaponId } from '../zombies/weapons.ts';
import { INF_PRESETS, INF_SECONDARY, INF_STEP_MS, InfectedGame } from './index.ts';

const SPAWNS = [
	{ pos: { x: -1000, y: -1000, z: 0.25 }, yaw: 0 },
	{ pos: { x: -1000, y: 1000, z: 0.25 }, yaw: 0 },
	{ pos: { x: 1000, y: -1000, z: 0.25 }, yaw: 180 }
];

/** Flat floor, three spread spawns, a fall-out box far below. */
function testMap(): MapDef {
	return {
		id: 'inf_deploy_test',
		title: 'Test',
		kind: 'tag',
		difficulty: 'easy',
		layout: 'open',
		cvars: {},
		spawn: SPAWNS[0]!,
		spawns: SPAWNS,
		brushes: [{ type: 'box', min: { x: -1200, y: -1200, z: -64 }, max: { x: 1200, y: 1200, z: 0 }, material: 'm' }],
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

const POS: Vec3 = { x: 600, y: 600, z: 0.25 };
const EYE: Vec3 = { x: POS.x, y: POS.y, z: POS.z + VIEW_HEIGHT };
const DIR: Vec3 = { x: 0, y: -1, z: 0 };

/** Round playing with players 1-3 (rng 0: player 1 is Patient Zero); player 2 is a survivor. */
function playing(preset: WeaponId, lenient: boolean) {
	const map = testMap();
	const clock = { now: 1_000_000 };
	const game = new InfectedGame({ map, world: buildCollisionWorld(map), now: clock.now, rng: () => 0, graceSecs: 1, endSecs: 1, lenient });
	game.round = INF_PRESETS.indexOf(preset);
	game.syncPlayers([1, 2, 3], clock.now);
	const advance = (ms: number) => {
		const end = clock.now + ms;
		while (clock.now < end) {
			clock.now = Math.min(end, clock.now + INF_STEP_MS);
			game.update(clock.now);
		}
	};
	advance(1100);
	expect(game.phase).toBe('playing');
	game.setPlayerPos(2, { ...POS, ducked: false, yaw: 0 });
	const fire = (weapon: WeaponId, at = clock.now) => game.fire(2, { weapon, origin: EYE, dir: DIR, tick: game.tick }, at);
	return { game, clock, advance, fire };
}

describe('weapon draw time (selectWeapon)', () => {
	it('every survivor weapon has a draw time', () => {
		for (const w of [...INF_PRESETS, INF_SECONDARY, 'knife'] as const) expect(WEAPONS[w].deployMs, w).toBeGreaterThan(0);
	});

	it('the new weapon cannot fire before its deployMs; the ammo is untouched', () => {
		const g = playing('lmg', false);
		const at = g.clock.now;
		expect(g.game.selectWeapon(2, 'pistol', at)).toEqual([{ e: 'ammo', id: 2, weapon: 'pistol', mag: 12, reserve: 36 }]);
		const ready = at + WEAPONS.pistol.deployMs!;
		const early = g.fire('pistol', ready - 1);
		expect(early).toMatchObject({ ok: false, reason: 'too fast' });
		// The reject resyncs the ammo: nothing was spent.
		expect(early.events).toEqual([{ e: 'ammo', id: 2, weapon: 'pistol', mag: 12, reserve: 36 }]);
		expect(g.fire('pistol', ready).ok).toBe(true);
		expect(g.game.secondaryOf(2)!.mag).toBe(11);
	});

	it('lenient (server): the draw is scaled by the fire tolerance, like the fire rate', () => {
		for (const [weapon, preset] of [
			['pistol', 'lmg'],
			['knife', 'lmg'],
			['lmg', 'lmg'],
			['barrett', 'barrett'],
			['striker', 'striker'],
			['smg', 'smg']
		] as const) {
			const g = playing(preset, true);
			// Leave the weapon first when it is the one held at spawn.
			if (weapon === preset) {
				g.game.selectWeapon(2, 'knife', g.clock.now);
				g.advance(1000);
			}
			const at = g.clock.now;
			expect(g.game.selectWeapon(2, weapon, at), weapon).toHaveLength(1);
			const ready = at + WEAPONS[weapon].deployMs! * ZM_FIRE_TOLERANCE;
			const early = g.fire(weapon, ready - 1);
			expect(early.ok, weapon).toBe(false);
			// (A held-back melee swing is reported as 'empty': it has no magazine.)
			if (WEAPONS[weapon].magazine > 0) expect(early.reason, weapon).toBe('too fast');
			expect(g.fire(weapon, ready).ok, weapon).toBe(true);
			// The fire rate after it uses the same tolerance.
			const next = ready + WEAPONS[weapon].fireMs * ZM_FIRE_TOLERANCE;
			expect(g.fire(weapon, next - 1).ok).toBe(false);
			expect(g.fire(weapon, next).ok).toBe(true);
		}
	});

	it('selecting the held weapon again does not draw it again', () => {
		const g = playing('lmg', false);
		expect(g.fire('lmg').ok).toBe(true);
		g.advance(WEAPONS.lmg.fireMs);
		expect(g.game.selectWeapon(2, 'lmg', g.clock.now)).toHaveLength(1);
		expect(g.fire('lmg').ok).toBe(true);
	});

	it('a swap away and back never shortens the fire interval', () => {
		const g = playing('barrett', false);
		const at = g.clock.now;
		expect(g.fire('barrett', at).ok).toBe(true);
		const prim = g.game.primaryOf(2)!;
		// The interval is longer than nothing here, so stretch it: a quick knife swap must not reset it.
		prim.nextFireAt = at + 5000;
		g.game.selectWeapon(2, 'knife', at + 10);
		g.game.selectWeapon(2, 'barrett', at + 20);
		expect(prim.nextFireAt).toBe(at + 5000);
		expect(g.fire('barrett', at + 20 + WEAPONS.barrett.deployMs!).ok).toBe(false);
		expect(g.fire('barrett', at + 5000).ok).toBe(true);
	});

	it('a refused swap changes nothing', () => {
		const g = playing('lmg', false);
		expect(g.game.selectWeapon(2, 'sniper', g.clock.now)).toEqual([]);
		expect(g.game.selectWeapon(2, 'claws', g.clock.now)).toEqual([]);
		expect(g.game.playerView(2)!.weapon).toBe('lmg');
		expect(g.fire('lmg').ok).toBe(true);
	});
});
