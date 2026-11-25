/**
 * Test harness for the infected rules: a flat map with one thin wall and a
 * game on a fake clock. Not a test file; used by the tests in this folder.
 */
import { buildCollisionWorld } from '../../collision/world.ts';
import type { MapDef } from '../../maps/types.ts';
import { VIEW_HEIGHT } from '../../movement/api.ts';
import type { Vec3 } from '../../types.ts';
import { INF_STEP_MS, InfectedGame, type InfectedGameOptions, type InfEvent } from './game.ts';

export type Ev<K extends InfEvent['e']> = Extract<InfEvent, { e: K }>;

export const unit = (x: number, y: number, z: number): Vec3 => {
	const l = Math.hypot(x, y, z);
	return { x: x / l, y: y / l, z: z / l };
};

export const KIT_SPAWNS = [
	{ pos: { x: -1000, y: -1000, z: 0.25 }, yaw: 0 },
	{ pos: { x: -1000, y: 1000, z: 0.25 }, yaw: 0 },
	{ pos: { x: 1000, y: -1000, z: 0.25 }, yaw: 180 },
	{ pos: { x: 1000, y: 1000, z: 0.25 }, yaw: 180 },
	{ pos: { x: 0, y: -1000, z: 0.25 }, yaw: 90 }
];

/** Floor (top at z 0), one thin wall at x 400..404, a fall-out box far below, five spread spawns. */
export function kitMap(): MapDef {
	return {
		id: 'inf_kit',
		title: 'Kit',
		kind: 'infected',
		difficulty: 'easy',
		layout: 'open',
		cvars: {},
		spawn: KIT_SPAWNS[0]!,
		spawns: KIT_SPAWNS,
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

/** `round`: the first round played (its preset: infLoadout(round)). */
export type KitOpts = Partial<InfectedGameOptions> & { round?: number };

export interface KitPose {
	x: number;
	y: number;
	z?: number;
	yaw?: number;
	ducked?: boolean;
}

/** A game with players `ids` on a fake clock (grace 1 s, summary 1 s, rng 0). */
export function kitGame(ids: number[], opts: KitOpts = {}) {
	const map = kitMap();
	const clock = { now: 1_000_000 };
	const { round, ...gameOpts } = opts;
	const game = new InfectedGame({ map, world: buildCollisionWorld(map), now: clock.now, rng: () => 0, graceSecs: 1, endSecs: 1, ...gameOpts });
	if (round !== undefined) game.round = round - 1;
	const events: InfEvent[] = [];
	const poses = new Map<number, Required<KitPose>>();
	/** Advance the clock in sim steps, feeding the placed poses before each one. */
	const advance = (ms: number, stepMs = INF_STEP_MS) => {
		const end = clock.now + ms;
		while (clock.now < end) {
			clock.now = Math.min(end, clock.now + stepMs);
			events.push(...game.update(clock.now));
		}
	};
	const put = (id: number, p: KitPose) => {
		const full = { x: p.x, y: p.y, z: p.z ?? 0, yaw: p.yaw ?? 0, ducked: p.ducked ?? false };
		poses.set(id, full);
		game.setPlayerPos(id, full);
	};
	const eye = (id: number): Vec3 => {
		const p = poses.get(id)!;
		return { x: p.x, y: p.y, z: p.z + VIEW_HEIGHT };
	};
	/** Fire the held weapon from the eye at a world point. */
	const fireAt = (id: number, aim: Vec3, shot: { tick?: number; rewindMs?: number } = {}) => {
		const o = eye(id);
		const weapon = game.weaponOf(id)!.weapon;
		const r = game.fire(id, { weapon, origin: o, dir: unit(aim.x - o.x, aim.y - o.y, aim.z - o.z), tick: shot.tick ?? game.tick, ...shot }, clock.now);
		events.push(...r.events);
		return r;
	};
	const of = <K extends InfEvent['e']>(e: K, list: InfEvent[] = events): Ev<K>[] => list.filter((ev): ev is Ev<K> => ev.e === e);
	game.syncPlayers(ids, clock.now);
	return { game, map, clock, events, advance, put, eye, fireAt, of };
}

/** A game in 'playing' with the first id as Patient Zero (rng 0 picks it). */
export function kitPlaying(ids: number[], opts: KitOpts = {}) {
	const g = kitGame(ids, opts);
	g.advance(1100);
	if (g.game.phase !== 'playing' || g.game.alphaId !== ids[0]) throw new Error('kit: not playing with the first id as Patient Zero');
	return g;
}
