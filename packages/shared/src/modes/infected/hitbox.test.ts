import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../types.ts';
import { PlayerBody, restMotion } from '../../body-motion.ts';
import type { BodyInput } from '../../body-pose.ts';
import { SURF_CVARS } from '../../cvars.ts';
import { SPEED_LIMIT } from '../../economy.ts';
import {
	meleePlayer,
	PLAYER_BOUNDS,
	PLAYER_HOLDS,
	PLAYER_LEG_BOUNDS,
	PLAYER_PARTS,
	PLAYER_RADII,
	playerCapsules,
	playerPoint,
	playerUp,
	rayPlayer,
	rayZombie,
	sweepPlayer,
	type PlayerPart,
	type PlayerPose
} from '../zombies/hitbox.ts';
import { WEAPONS, type WeaponId } from '../zombies/weapons.ts';
import { clampInfVelocity, INF_KNIFE_HIT_RADIUS, INF_SPEED_LIMIT, INF_STEP_MS, type InfectedGame } from './game.ts';
import { kitPlaying, unit } from './testkit.ts';

/**
 * Joints of the drawn character at rest, measured from the animator (idle,
 * averaged over the breathing), typed in here on purpose: model space
 * [forward, up, right] from the feet. The web test infected-hitbox.test.ts
 * measures the whole skinned mesh.
 */
const DRAWN = [
	{ hunched: false, held: null, ducked: false, pitch: 0, neck: [-0.8, 57.6, -0.01], head: [-0.4, 60.8, -0.01], shoulderR: [-0.27, 53.5, 8.49], elbowR: [0.17, 42.6, 9.92], wristR: [3.4, 33.39, 10.7], shoulderL: [-0.27, 53.5, -8.51], elbowL: [0.17, 42.6, -9.94], wristL: [3.4, 33.39, -10.72], kneeR: [1.55, 19.5, 4.98], ankleR: [-1.56, 3.8, 4.55], kneeL: [2.76, 19.66, -5], ankleL: [0.64, 3.8, -4.55] },
	{ hunched: false, held: null, ducked: false, pitch: 40, neck: [0.87, 57.58, 0], head: [2.49, 60.36, 0], shoulderR: [0.86, 53.44, 8.5], elbowR: [-0.13, 42.58, 9.92], wristR: [1.88, 33.02, 10.71], shoulderL: [0.86, 53.44, -8.5], elbowL: [-0.13, 42.58, -9.93], wristL: [1.88, 33.02, -10.72], kneeR: [1.54, 19.5, 4.98], ankleR: [-1.56, 3.8, 4.55], kneeL: [2.75, 19.66, -5], ankleL: [0.64, 3.8, -4.55] },
	{ hunched: false, held: null, ducked: true, pitch: 0, neck: [5.48, 40.08, -0.01], head: [6.75, 43.05, -0.01], shoulderR: [4.17, 36.13, 8.48], elbowR: [2.43, 25.36, 9.91], wristR: [8.19, 17.44, 9.75], shoulderL: [4.17, 36.13, -8.51], elbowL: [2.43, 25.36, -9.93], wristL: [8.19, 17.44, -9.78], kneeR: [10.8, 13.09, 10.87], ankleR: [-2.77, 6.43, 5.58], kneeL: [12.54, 17.8, -10.1], ankleL: [5.32, 4.38, -5.2] },
	{ hunched: false, held: null, ducked: true, pitch: 40, neck: [6.95, 39.3, 0], head: [9.28, 41.52, 0], shoulderR: [5.13, 35.55, 8.5], elbowR: [2, 25.1, 9.92], wristR: [6.68, 16.49, 9.77], shoulderL: [5.13, 35.55, -8.49], elbowL: [2, 25.1, -9.92], wristL: [6.68, 16.49, -9.76], kneeR: [10.8, 13.08, 10.88], ankleR: [-2.77, 6.43, 5.58], kneeL: [12.54, 17.81, -10.08], ankleL: [5.32, 4.38, -5.2] },
	{ hunched: false, held: 'pistol', ducked: false, pitch: 0, neck: [-0.8, 57.6, 0.01], head: [-0.4, 60.8, 0.01], shoulderR: [-0.27, 53.5, 8.51], elbowR: [8.21, 46.66, 6.97], wristR: [11.2, 54, 1.21], shoulderL: [-0.27, 53.5, -8.49], elbowL: [7.26, 45.61, -7.1], wristL: [11.33, 52.6, -1.58], kneeR: [1.55, 19.49, 4.98], ankleR: [-1.56, 3.8, 4.55], kneeL: [2.76, 19.66, -5], ankleL: [0.64, 3.8, -4.55] },
	{ hunched: false, held: 'pistol', ducked: false, pitch: 40, neck: [2.37, 57.38, 0], head: [4.17, 60.05, 0], shoulderR: [1.87, 53.28, 8.5], elbowR: [5.47, 42.89, 8.44], wristR: [10.8, 46.8, 1.2], shoulderL: [1.87, 53.28, -8.5], elbowL: [4.41, 42.59, -9.01], wristL: [10.05, 45.61, -1.58], kneeR: [1.55, 19.49, 4.98], ankleR: [-1.56, 3.8, 4.55], kneeL: [2.77, 19.66, -5], ankleL: [0.64, 3.8, -4.55] },
	{ hunched: false, held: 'pistol', ducked: true, pitch: 0, neck: [5.48, 40.08, 0.01], head: [6.75, 43.05, 0.01], shoulderR: [4.17, 36.13, 8.51], elbowR: [12.76, 29.42, 7.03], wristR: [15.98, 36.61, 1.21], shoulderL: [4.17, 36.13, -8.48], elbowL: [11.83, 28.36, -7.12], wristL: [16.12, 35.21, -1.57], kneeR: [10.8, 13.08, 10.89], ankleR: [-2.77, 6.43, 5.58], kneeL: [12.54, 17.81, -10.08], ankleL: [5.32, 4.38, -5.2] },
	{ hunched: false, held: 'pistol', ducked: true, pitch: 40, neck: [8.19, 38.44, 0.01], head: [10.67, 40.51, 0.01], shoulderR: [5.94, 34.93, 8.51], elbowR: [9.73, 24.61, 8.43], wristR: [15.21, 28.35, 1.21], shoulderL: [5.94, 34.93, -8.48], elbowL: [8.67, 24.29, -8.94], wristL: [14.45, 27.16, -1.57], kneeR: [10.8, 13.08, 10.89], ankleR: [-2.77, 6.43, 5.58], kneeL: [12.54, 17.81, -10.08], ankleL: [5.32, 4.38, -5.2] },
	{ hunched: true, held: 'claws', ducked: false, pitch: 0, neck: [3.43, 57.07, 0.01], head: [4.42, 60.14, 0.01], shoulderR: [3.05, 53.13, 8.51], elbowR: [5.73, 43.87, 13.79], wristR: [14.82, 40.71, 11.94], shoulderL: [3.05, 53.13, -8.49], elbowL: [5.73, 43.87, -13.76], wristL: [14.82, 40.71, -11.91], kneeR: [1.08, 19.58, 5], ankleR: [-1.56, 3.8, 4.55], kneeL: [2.03, 19.74, -4.95], ankleL: [0.64, 3.8, -4.55] },
	{ hunched: true, held: 'claws', ducked: false, pitch: 40, neck: [5, 56.53, 0.01], head: [6.78, 59.22, 0.01], shoulderR: [4.11, 52.68, 8.51], elbowR: [5.57, 43.14, 13.78], wristR: [14.17, 38.83, 11.94], shoulderL: [4.11, 52.68, -8.49], elbowL: [5.57, 43.14, -13.76], wristL: [14.17, 38.83, -11.92], kneeR: [1.1, 19.58, 5.01], ankleR: [-1.56, 3.8, 4.55], kneeL: [2.05, 19.74, -4.95], ankleL: [0.64, 3.8, -4.55] },
	{ hunched: true, held: 'claws', ducked: true, pitch: 0, neck: [8.94, 37.36, -0.01], head: [10.75, 40.03, -0.01], shoulderR: [6.77, 34.13, 8.5], elbowR: [4.74, 24.98, 14.25], wristR: [11.19, 17.77, 12.68], shoulderL: [6.77, 34.13, -8.51], elbowL: [4.74, 24.98, -14.26], wristL: [11.19, 17.77, -12.69], kneeR: [10.24, 14.22, 10.72], ankleR: [-2.77, 6.43, 5.58], kneeL: [11.49, 18.32, -10.08], ankleL: [5.32, 4.38, -5.2] },
	{ hunched: true, held: 'claws', ducked: true, pitch: 40, neck: [10.09, 36.16, -0.01], head: [12.55, 38.25, -0.01], shoulderR: [7.52, 33.25, 8.5], elbowR: [4.32, 24.44, 14.25], wristR: [9.76, 16.45, 12.68], shoulderL: [7.52, 33.25, -8.51], elbowL: [4.32, 24.44, -14.26], wristL: [9.76, 16.45, -12.69], kneeR: [10.24, 14.22, 10.72], ankleR: [-2.77, 6.43, 5.58], kneeL: [11.49, 18.32, -10.08], ankleL: [5.32, 4.38, -5.2] }
] as const;

type Look = 'survivor' | 'infected';
const pose = (look: Look, ducked: boolean, yaw = 0, x = 0, y = 0, z = 0): PlayerPose => ({ x, y, z, yaw, ducked, hunched: look !== 'survivor' });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);

const HELD: readonly (WeaponId | null)[] = [null, 'claws', ...(Object.keys(PLAYER_HOLDS) as WeaponId[])];
/** A hunched body has claws, never an item. */
const real = (p: { hunched: boolean; held?: WeaponId | null }) => !p.hunched || !p.held || p.held === 'claws';
/** Every hold, stance, posture and some pitches, at a spot and yaw of its own. */
const POSES: PlayerPose[] = HELD.flatMap((held, i) =>
	[false, true].flatMap((ducked) => [false, true].flatMap((hunched) => [-75, -25, 0, 40, 90].map((pitch, k) => ({ x: 100 * i, y: -40 * k, z: 8, yaw: 37 * i + 100 * k, ducked, hunched, held, pitch }))))
).filter(real);

/** Deterministic random numbers. */
function rng(seed: number): () => number {
	return () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 4294967296;
	};
}
function direction(r: () => number): Vec3 {
	const z = r() * 2 - 1;
	const a = r() * Math.PI * 2;
	const s = Math.sqrt(1 - z * z);
	return { x: Math.cos(a) * s, y: Math.sin(a) * s, z };
}
/** Distance from a point to the axis of a capsule. */
function toAxis(p: Vec3, c: { a: Vec3; b: Vec3 }): number {
	const ba = sub(c.b, c.a);
	const pa = sub(p, c.a);
	const l = ba.x * ba.x + ba.y * ba.y + ba.z * ba.z;
	const h = l > 1e-9 ? Math.max(0, Math.min(1, (pa.x * ba.x + pa.y * ba.y + pa.z * ba.z) / l)) : 0;
	return len({ x: pa.x - ba.x * h, y: pa.y - ba.y * h, z: pa.z - ba.z * h });
}

describe('player capsules stand where the character is drawn', () => {
	it.each(DRAWN)('joints within 0.9 units: hunched $hunched, holding $held, ducked $ducked, pitch $pitch', (d) => {
		const p: PlayerPose = { x: 0, y: 0, z: 0, yaw: 0, ducked: d.ducked, hunched: d.hunched, held: d.held, pitch: d.pitch };
		const at = (part: PlayerPart, end: 0 | 1): [number, number, number] => {
			const w = playerPoint(p, part, end);
			return [w.x, w.z, -w.y];
		};
		const got = {
			neck: at('neck', 0),
			head: at('neck', 1),
			shoulderR: at('upperArmR', 0),
			elbowR: at('upperArmR', 1),
			wristR: at('foreArmR', 1),
			shoulderL: at('upperArmL', 0),
			elbowL: at('upperArmL', 1),
			wristL: at('foreArmL', 1),
			kneeR: at('thighR', 1),
			ankleR: at('shinR', 1),
			kneeL: at('thighL', 1),
			ankleL: at('shinL', 1)
		};
		for (const [joint, g] of Object.entries(got)) {
			const w = d[joint as keyof typeof got];
			expect(Math.hypot(g[0] - w[0], g[1] - w[1], g[2] - w[2]), joint).toBeLessThan(0.9);
		}
	});

	it('turns with the yaw about the feet and moves with the position', () => {
		const a = playerPoint({ ...pose('survivor', false), held: 'lmg' }, 'handL', 1);
		const b = playerPoint({ ...pose('survivor', false, 90, 10, 20, 30), held: 'lmg' }, 'handL', 1);
		expect(b.x).toBeCloseTo(10 - a.y, 9);
		expect(b.y).toBeCloseTo(20 + a.x, 9);
		expect(b.z).toBeCloseTo(30 + a.z, 9);
	});

	it('one size for every player; the head is the only headshot part', () => {
		for (const p of POSES) {
			const caps = playerCapsules(p);
			expect(caps.map((c) => c.part)).toEqual(PLAYER_PARTS);
			for (const c of caps) {
				expect(c.r).toBe(PLAYER_RADII[c.part]);
				expect(Number.isFinite(c.a.x + c.a.y + c.a.z + c.b.x + c.b.y + c.b.z)).toBe(true);
			}
		}
	});

	it('a pitch that is not a number is level; past 80 degrees it follows no further', () => {
		const p = { ...pose('survivor', false), held: 'lmg' as const };
		expect(playerPoint({ ...p, pitch: NaN }, 'handL')).toEqual(playerPoint(p, 'handL'));
		expect(playerPoint({ ...p, pitch: 89 }, 'handL')).toEqual(playerPoint({ ...p, pitch: 80 }, 'handL'));
	});

	it('the arms never stretch: upper arm 11, forearm 9.8 in every held pose', () => {
		for (const p of POSES) {
			if (!p.held || p.held === 'claws') continue;
			for (const c of playerCapsules(p)) {
				const l = len(sub(c.b, c.a));
				if (c.part === 'upperArmR') expect(l).toBeCloseTo(11, 6);
				if (c.part === 'foreArmR') expect(l).toBeCloseTo(9.8, 6);
				if (PLAYER_HOLDS[p.held].hold !== 'one' && c.part === 'foreArmL') expect(l).toBeCloseTo(9.8, 6);
			}
		}
	});
});

/** A state packet's motion. */
const input = (over: Partial<BodyInput> = {}): BodyInput => ({ vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, ducked: false, ...over });
/** The pose of a body after `seconds` of a motion. */
function moving(look: Look, held: WeaponId | null, over: Partial<BodyInput>, seconds = 1.5): PlayerPose {
	const body = new PlayerBody();
	body.follow(Math.round(seconds * 64), 1 / 64, input(over));
	return { ...pose(look, over.ducked ?? false), held, pitch: over.pitch ?? 0, motion: { ...body.motion } };
}
/** A body of every kind, in the middle of doing something. */
function anyPose(r: () => number): PlayerPose {
	const body = new PlayerBody();
	const at = (n: number) => (r() - 0.5) * 2 * n;
	for (let k = 0; k < 4; k++) body.follow(1 + Math.floor(r() * 40), 1 / 64, input({ vx: at(330), vy: at(330), vz: at(r() < 0.2 ? 3000 : 400), yaw: at(180), pitch: at(89), onGround: r() < 0.5, ducked: r() < 0.5 }));
	const p: PlayerPose = { x: at(50), y: at(50), z: at(20), yaw: at(180), ducked: false, hunched: r() < 0.5, held: HELD[Math.floor(r() * HELD.length)]!, motion: { ...body.motion } };
	return real(p) ? p : { ...p, held: 'claws' };
}

describe('player capsules follow the motion', () => {
	it('standing still is the pose without a motion', () => {
		const p = moving('survivor', 'lmg', {});
		expect(playerCapsules(p)).toEqual(playerCapsules({ ...p, motion: undefined }));
		expect(playerCapsules({ ...p, motion: restMotion() })).toEqual(playerCapsules({ ...p, motion: undefined }));
	});

	it('a run leans the torso, the head and the arms its way: forward, back and sideways', () => {
		const still = moving('survivor', 'lmg', {});
		const lean = (over: Partial<BodyInput>, part: PlayerPart) => sub(playerPoint(moving('survivor', 'lmg', over), part), playerPoint(still, part));
		expect(lean({ vx: 250 }, 'head').x).toBeGreaterThan(3);
		expect(lean({ vx: -250 }, 'head').x).toBeLessThan(-3);
		expect(lean({ vy: 250 }, 'head').y).toBeGreaterThan(2);
		expect(lean({ vy: -250 }, 'head').y).toBeLessThan(-2);
		expect(lean({ vx: 250 }, 'handR').x).toBeGreaterThan(1);
		// An infected hardly leans: the head keeps to its place.
		const infected = sub(playerPoint(moving('infected', 'claws', { vx: 265 }), 'head'), playerPoint(moving('infected', 'claws', {}), 'head'));
		expect(infected.x).toBeLessThan(2.5);
	});

	it('running legs are hit all along their stride, standing legs only where they stand', () => {
		const side = (p: PlayerPose, x: number, z: number) => rayPlayer({ x, y: -300, z }, { x: 0, y: 1, z: 0 }, p, 1000) !== null;
		for (const [look, held, reach] of [['survivor', 'lmg', 15], ['infected', 'claws', 12]] as const) {
			const run = moving(look, held, { vx: 250 });
			const stand = moving(look, held, {});
			for (const x of [-reach, reach]) {
				expect(side(run, x, 6)).toBe(true);
				expect(side(stand, x, 6)).toBe(false);
			}
			// Not further than the stride, and not where no leg comes.
			expect(side(run, 32, 6)).toBe(false);
			expect(side(run, -32, 6)).toBe(false);
			expect(side(run, -14, 28)).toBe(false);
		}
	});

	it('legs in the air are tucked up, whichever is in front', () => {
		const jump = moving('survivor', 'lmg', { onGround: false, vz: 300 });
		const under = (p: PlayerPose) => rayPlayer({ x: 4, y: -300, z: 1 }, { x: 0, y: 1, z: 0 }, p, 1000);
		expect(under(moving('survivor', 'lmg', {}))).not.toBeNull();
		expect(under(jump)).toBeNull();
	});

	it('feet that trail a turn on the spot are hit, up to where they step around; a run brings them back', () => {
		const body = new PlayerBody();
		const widest = () => {
			const ankles = playerCapsules({ ...pose('survivor', false), held: 'lmg', motion: body.motion }).filter((c) => c.part === 'footR');
			return Math.max(...ankles.map((c) => c.b.x)) - Math.min(...ankles.map((c) => c.b.x));
		};
		body.follow(10, 1 / 64, input());
		expect(widest()).toBe(0);
		for (let yaw = 0; yaw <= 400; yaw += 4) body.follow(1, 1 / 64, input({ yaw }));
		expect(body.motion.turnL + body.motion.turnR).toBeCloseTo(1.5, 6);
		expect(widest()).toBeGreaterThan(4);
		body.follow(90, 1 / 64, input({ yaw: 400, vx: 120 }));
		expect(body.motion.turnL + body.motion.turnR).toBeLessThan(0.02);
	});

	it('a spawn takes the first state as it is', () => {
		const body = new PlayerBody();
		body.follow(60, 1 / 64, input({ vx: 250, yaw: 100, ducked: true }));
		body.reset();
		body.follow(1, 1 / 64, input({ yaw: -90, pitch: 30 }));
		expect(body.motion.duck).toBeCloseTo(0, 9);
		expect(body.motion).toMatchObject({ ground: 1, speed: 0, turnR: 0, turnL: 0 });
		expect(body.motion.aim).toBeCloseTo(Math.PI / 6, 9);
	});

	it('every capsule is inside the bounds the hit tests skip by', () => {
		const r = rng(5);
		let ball = 0;
		let wide = 0;
		let low = Infinity;
		let high = 0;
		for (let n = 0; n < 4000; n++) {
			const p = anyPose(r);
			for (const c of playerCapsules(p)) {
				for (const e of [c.a, c.b]) {
					ball = Math.max(ball, len({ x: e.x - p.x, y: e.y - p.y, z: e.z - p.z - PLAYER_BOUNDS.y }) + c.r);
					if (!/thigh|shin|foot/.test(c.part)) continue;
					wide = Math.max(wide, Math.hypot(e.x - p.x, e.y - p.y) + c.r);
					low = Math.min(low, e.z - p.z - c.r);
					high = Math.max(high, e.z - p.z + c.r);
				}
			}
		}
		expect(ball).toBeLessThan(PLAYER_BOUNDS.r);
		expect(wide).toBeLessThan(PLAYER_LEG_BOUNDS.r);
		expect(low).toBeGreaterThan(PLAYER_LEG_BOUNDS.y0);
		expect(high).toBeLessThan(PLAYER_LEG_BOUNDS.y1);
	}, 30_000);

	it('rays against a moving body: the first point inside a capsule, and nothing otherwise', () => {
		const r = rng(6);
		let hits = 0;
		let misses = 0;
		for (let n = 0; n < 150; n++) {
			const p = anyPose(r);
			const caps = playerCapsules(p);
			for (let k = 0; k < 4; k++) {
				const d = direction(r);
				const aim = { x: p.x + (r() - 0.5) * 70, y: p.y + (r() - 0.5) * 70, z: p.z + r() * 80 };
				const o = { x: aim.x - d.x * 120, y: aim.y - d.y * 120, z: aim.z - d.z * 120 };
				let first = -1;
				let nearest = Infinity;
				for (let t = 0; t <= 240 && first < 0; t += 0.2) {
					const q = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
					const gap = Math.min(...caps.map((c) => toAxis(q, c) - c.r));
					nearest = Math.min(nearest, gap);
					if (gap <= 0) first = t;
				}
				const h = rayPlayer(o, d, p, 240);
				// More rays at the same pose find it as it was left.
				expect(rayPlayer(o, d, p, 240, true)).toEqual(h);
				expect(rayPlayer(o, d, p, 240, true)).toEqual(h);
				if (first >= 0) {
					hits++;
					// The walk can step over a corner that the ray grazes: the hit is on a surface, and nothing comes before it.
					expect(h!.t).toBeLessThan(first + 1e-6);
					const q = { x: o.x + d.x * h!.t, y: o.y + d.y * h!.t, z: o.z + d.z * h!.t };
					expect(Math.min(...caps.map((c) => toAxis(q, c) - c.r))).toBeCloseTo(0, 4);
				} else if (nearest > 0.1) {
					misses++;
					expect(h).toBeNull();
				}
			}
		}
		expect(hits).toBeGreaterThan(100);
		expect(misses).toBeGreaterThan(100);
	}, 30_000);

	it('the point up the body follows its lean: on the line to the neck, three quarters as high ducked', () => {
		const at = (p: PlayerPose) => playerUp(p, 40);
		expect(len(at(moving('survivor', 'lmg', {})))).toBeCloseTo(40, 6);
		expect(len(at(moving('survivor', 'lmg', { ducked: true })))).toBeCloseTo(30, 4);
		expect(at(moving('infected', 'claws', {})).x).toBeGreaterThan(2);
		expect(at(moving('survivor', 'lmg', { vx: 250 })).x).toBeGreaterThan(at(moving('survivor', 'lmg', {})).x + 2);
	});
});

describe('rays, sweeps and swings against the capsules', () => {
	it('a ray through any point inside a capsule hits, before that point', () => {
		const r = rng(1);
		for (const p of POSES) {
			for (const c of playerCapsules(p)) {
				const f = r();
				const d = direction(r);
				const k = c.r * 0.98 * r();
				const e = direction(r);
				const at = { x: c.a.x + (c.b.x - c.a.x) * f + e.x * k, y: c.a.y + (c.b.y - c.a.y) * f + e.y * k, z: c.a.z + (c.b.z - c.a.z) * f + e.z * k };
				const o = { x: at.x - d.x * 300, y: at.y - d.y * 300, z: at.z - d.z * 300 };
				const h = rayPlayer(o, d, p, 1000);
				expect(h).not.toBeNull();
				expect(h!.t).toBeLessThanOrEqual(300 + 1e-6);
				expect(rayPlayer(o, d, p, h!.t - 0.01)).toBeNull();
				expect(sweepPlayer(o, d, p, 1000, 0)).toBeCloseTo(h!.t, 6);
			}
		}
	});

	it('agrees with a walk along the ray: the first point inside a capsule, and nothing otherwise', () => {
		const r = rng(2);
		let hits = 0;
		let misses = 0;
		for (const p of POSES.filter((_, i) => i % 3 === 0)) {
			const caps = playerCapsules(p);
			for (let n = 0; n < 8; n++) {
				const d = direction(r);
				const aim = { x: p.x + (r() - 0.5) * 60, y: p.y + (r() - 0.5) * 60, z: p.z + r() * 80 };
				const o = { x: aim.x - d.x * 90, y: aim.y - d.y * 90, z: aim.z - d.z * 90 };
				let first = -1;
				let nearest = Infinity;
				for (let t = 0; t <= 180; t += 0.1) {
					const q = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
					let gap = Infinity;
					for (const c of caps) gap = Math.min(gap, toAxis(q, c) - c.r);
					nearest = Math.min(nearest, gap);
					if (gap <= 0) {
						first = t;
						break;
					}
				}
				const h = rayPlayer(o, d, p, 180);
				if (first >= 0) {
					hits++;
					expect(h).not.toBeNull();
					expect(Math.abs(h!.t - first)).toBeLessThan(0.11);
				} else if (nearest > 0.1) {
					misses++;
					expect(h).toBeNull();
				}
			}
		}
		expect(hits).toBeGreaterThan(50);
		expect(misses).toBeGreaterThan(50);
	});

	it('the head counts when the ray reaches it before the body', () => {
		const p = { ...pose('survivor', false), held: 'lmg' as const };
		const head = playerPoint(p, 'head');
		expect(rayPlayer({ x: 300, y: 0, z: head.z }, { x: -1, y: 0, z: 0 }, p, 1000)).toMatchObject({ head: true });
		// From above into the crown, and from below through the body.
		expect(rayPlayer({ x: head.x, y: 0, z: 300 }, { x: 0, y: 0, z: -1 }, p, 1000)).toMatchObject({ head: true });
		expect(rayPlayer({ x: 0, y: 0, z: -300 }, { x: 0, y: 0, z: 1 }, p, 1000)).toMatchObject({ head: false });
		// Arms raised in front of the face (a pistol aimed up) take the bullet.
		const up: PlayerPose = { ...pose('survivor', false), held: 'pistol', pitch: -25 };
		const hand = playerPoint(up, 'handR', 1);
		expect(rayPlayer({ x: 300, y: hand.y, z: hand.z }, { x: -1, y: 0, z: 0 }, up, 1000)).toMatchObject({ head: false });
	});

	it('fits where the AI-zombie hitbox does not: a hunched head, a ducked head', () => {
		const infected: PlayerPose = { ...pose('infected', false), held: 'claws' };
		const hand = playerPoint(infected, 'handR', 1);
		const o = { x: hand.x, y: -300, z: hand.z };
		expect(rayPlayer(o, { x: 0, y: 1, z: 0 }, infected, 1000)).not.toBeNull();
		expect(rayZombie(o, { x: 0, y: 1, z: 0 }, infected, 1000)).toBeNull();
		const low: PlayerPose = { ...pose('survivor', true), held: 'lmg' };
		const head = playerPoint(low, 'head');
		expect(head.z).toBeLessThan(50);
		expect(rayPlayer({ x: 300, y: 0, z: head.z }, { x: -1, y: 0, z: 0 }, low, 1000)).toMatchObject({ head: true });
		expect(rayPlayer({ x: 300, y: 0, z: 62 }, { x: -1, y: 0, z: 0 }, low, 1000)).toBeNull();
	});

	it('the hands follow the item and the pitch: where one hold has an arm, another has none', () => {
		const at = (held: WeaponId | null, pitch = 0): PlayerPose => ({ ...pose('survivor', false), held, pitch });
		const ahead = playerPoint(at('lmg'), 'handL', 1);
		expect(ahead.x).toBeGreaterThan(15);
		const side = (p: PlayerPose, q: Vec3) => rayPlayer({ x: q.x, y: -300, z: q.z }, { x: 0, y: 1, z: 0 }, p, 1000);
		expect(side(at('lmg'), ahead)).not.toBeNull();
		expect(side(at(null), ahead)).toBeNull();
		expect(side(at('lmg', -50), ahead)).toBeNull();
		// The knife leaves the left arm hanging.
		const hip = playerPoint(at('knife'), 'handL', 1);
		expect(hip.z).toBeLessThan(32);
		expect(rayPlayer({ x: 300, y: hip.y, z: hip.z }, { x: -1, y: 0, z: 0 }, at('knife'), 1000)).not.toBeNull();
		expect(rayPlayer({ x: 300, y: hip.y, z: hip.z }, { x: -1, y: 0, z: 0 }, at('pistol'), 1000)).toBeNull();
	});
});

describe('melee and the throwing knife use the player hitboxes', () => {
	const claws = WEAPONS.claws;
	const eye = { x: 0, y: 0, z: 64 };
	const fwd = unit(1, 0, 0);
	/** Distance from the eye to the nearest capsule surface. */
	const gap = (p: PlayerPose) => Math.min(...playerCapsules(p).map((c) => toAxis(eye, c) - c.r));

	it('melee reach is measured to the nearest surface of the model', () => {
		for (const held of HELD) {
			for (const yaw of [180, 90, 0]) {
				const at = (dist: number): PlayerPose => ({ ...pose('survivor', false, yaw, dist), held });
				let near = claws.range;
				while (gap(at(near)) < claws.range) near += 0.25;
				expect(meleePlayer(eye, fwd, at(near - 0.25), claws.range, claws.coneDeg)).not.toBeNull();
				expect(meleePlayer(eye, fwd, at(near), claws.range, claws.coneDeg)).toBeNull();
				expect(meleePlayer(eye, fwd, at(near - 0.25), claws.range, claws.coneDeg)!.t).toBeCloseTo(gap(at(near - 0.25)), 5);
			}
		}
	});

	it('melee needs the target in the aim cone, wider when it is very close', () => {
		const p = pose('survivor', false, 180, 50, 0, 0);
		expect(meleePlayer(eye, fwd, p, claws.range, claws.coneDeg)).not.toBeNull();
		expect(meleePlayer(eye, unit(-1, 0, 0), p, claws.range, claws.coneDeg)).toBeNull();
		expect(meleePlayer(eye, unit(0, 1, 0), p, claws.range, claws.coneDeg)).toBeNull();
		// 64 degrees off the aim: outside the 45 degree cone at arm's length, inside the widened one up close.
		const off = unit(Math.cos((64 * Math.PI) / 180), Math.sin((64 * Math.PI) / 180), 0);
		expect(meleePlayer(eye, off, pose('survivor', false, 180, 50, 0, 0), claws.range, claws.coneDeg)).toBeNull();
		expect(meleePlayer(eye, off, pose('survivor', false, 180, 16, 0, 0), claws.range, claws.coneDeg)).not.toBeNull();
	});

	it('melee follows the duck and the hunch; the head flag comes from the aim ray', () => {
		// A ducked survivor under a level swing at head height: the top of the ducked head is about 56.
		const low = pose('survivor', true, 180, 40, 0, 0);
		expect(meleePlayer(eye, fwd, low, claws.range, claws.coneDeg)).toMatchObject({ head: false });
		const down = sub(playerPoint(low, 'head'), eye);
		expect(meleePlayer(eye, unit(down.x, down.y, down.z), low, claws.range, claws.coneDeg)).toMatchObject({ head: true });
		// A hunched infected facing away carries the head further off than an upright survivor.
		const knife = WEAPONS.knife;
		const away = (look: Look) => meleePlayer(eye, fwd, pose(look, false, 0, knife.range - 14), knife.range, knife.coneDeg)!.t;
		expect(away('infected')).toBeGreaterThan(away('survivor') + 2);
	});

	it('the knife sweep grows the capsules by the knife radius', () => {
		const r = INF_KNIFE_HIT_RADIUS;
		const from = { x: -200, y: 0, z: 50 };
		const at = (off: number, yaw: number): PlayerPose => ({ ...pose('survivor', false, yaw, 0, off), held: 'lmg' });
		let touched = 0;
		for (const yaw of [180, 90, -90])
			for (let off = -40; off <= 40; off += 1) {
				const caps = playerCapsules(at(off, yaw));
				let near = Infinity;
				for (let x = -60; x <= 60; x += 0.25) near = Math.min(near, ...caps.map((c) => toAxis({ x, y: 0, z: 50 }, c) - c.r));
				const t = sweepPlayer(from, fwd, at(off, yaw), 400, r);
				if (near < r - 0.05) {
					touched++;
					// The distance is where the knife first touches.
					const q = { x: from.x + t, y: 0, z: 50 };
					expect(Math.min(...caps.map((c) => toAxis(q, c) - c.r))).toBeCloseTo(r, 4);
				} else if (near > r) expect(t).toBe(-1);
			}
		expect(touched).toBeGreaterThan(60);
		// It is bounded by the segment.
		expect(sweepPlayer(from, fwd, at(0, 180), 100, r)).toBe(-1);
	});

	it('melee and the knife sweep reach the hands on an item', () => {
		// A survivor aiming a pistol at the attacker: the hands are about 18 in front of the feet, the chest only 7.
		const aiming = (dist: number): PlayerPose => ({ ...pose('survivor', false, 180, dist), held: 'pistol' });
		const empty = (dist: number): PlayerPose => pose('survivor', false, 180, dist);
		expect(meleePlayer(eye, fwd, empty(claws.range + 15), claws.range, claws.coneDeg)).toBeNull();
		expect(meleePlayer(eye, fwd, aiming(claws.range + 15), claws.range, claws.coneDeg)).not.toBeNull();
		expect(meleePlayer(eye, fwd, aiming(claws.range + 19), claws.range, claws.coneDeg)).toBeNull();
		// The arms are still inside the cone rules: a swing the other way misses them.
		expect(meleePlayer(eye, unit(-1, 0, 0), aiming(40), claws.range, claws.coneDeg)).toBeNull();
		// The knife sweep: a knife passing 8 in front of the hands of a survivor in profile touches them, not an empty-handed one.
		const r = INF_KNIFE_HIT_RADIUS;
		const profile: PlayerPose = { ...pose('survivor', false, -90), held: 'pistol' };
		const grip = playerPoint(profile, 'handR', 1);
		const from = { x: -200, y: grip.y - 8, z: grip.z };
		expect(sweepPlayer(from, fwd, profile, 400, r)).toBeGreaterThan(0);
		expect(sweepPlayer(from, fwd, { ...profile, held: null }, 400, r)).toBe(-1);
		expect(sweepPlayer({ ...from, y: grip.y - 15 }, fwd, profile, 400, r)).toBe(-1);
	});
});

describe('the game resolves hits against the player hitboxes', () => {
	/** The body the game poses a player with. */
	const bodyOf = (game: InfectedGame, id: number): PlayerBody => (game as unknown as { players: Map<number, { body: PlayerBody }> }).players.get(id)!.body;
	/** Playing with the LMG: survivor 2 in front of Patient Zero (1, claws), side-on; 3 survives far away. */
	const start = () => {
		const g = kitPlaying([1, 2, 3], { round: 3 });
		g.put(1, { x: 0, y: 0 });
		g.put(2, { x: 0, y: -300 });
		g.put(3, { x: 1000, y: 1000 });
		g.advance(50);
		return g;
	};
	/** Patient Zero as the game poses it. */
	const zero = (ducked = false, yaw = 0): PlayerPose => ({ ...pose('infected', ducked, yaw), held: 'claws' });
	/** As `start`, then Patient Zero claws 2: 2 is a plain infected at the origin, Patient Zero at (0, -300), 3 survives. */
	const withInfected = () => {
		const g = start();
		g.put(2, { x: 0, y: 0 });
		g.put(1, { x: -40, y: 0 });
		g.fireAt(1, { x: 0, y: 0, z: 64 });
		expect(g.game.playerView(2)).toMatchObject({ team: 'infected', alpha: false });
		g.put(1, { x: 0, y: -300 });
		g.advance(200);
		return g;
	};

	it("bullets: Patient Zero's shoulder is hit", () => {
		const g = start();
		const r = g.fireAt(2, playerPoint(zero(), 'upperArmR', 0.1));
		expect(g.of('hit', r.events)).toEqual([{ e: 'hit', by: 2, targetId: 1, head: false, kill: false }]);
	});

	it('bullets: over a ducked infected is a miss, the ducked head is a headshot', () => {
		const g = start();
		g.put(1, { x: 0, y: 0, ducked: true });
		// The body goes down as it is drawn (0.2 s).
		g.advance(400);
		const over = g.fireAt(2, { x: 5, y: 0, z: 62 });
		expect(over.ok).toBe(true);
		expect(g.of('hit', over.events)).toEqual([]);
		g.advance(200);
		const head = g.fireAt(2, playerPoint(zero(true), 'head'));
		expect(g.of('hit', head.events)).toEqual([{ e: 'hit', by: 2, targetId: 1, head: true, kill: true }]);
	});

	it("bullets: the front of a hunched infected's head is a headshot", () => {
		const g = withInfected();
		g.put(3, { x: 0, y: -300 });
		g.put(1, { x: -1000, y: 1000 });
		g.advance(50);
		// 4 further forward than the axis of the head: the face.
		const at = playerPoint(zero(), 'head');
		const r = g.fireAt(3, { ...at, x: at.x + 4 });
		expect(g.of('hit', r.events)).toEqual([{ e: 'hit', by: 3, targetId: 2, head: true, kill: true }]);
	});

	it('a yaw that is not a number keeps the last yaw: the hitboxes stay on the model', () => {
		const g = start();
		// Patient Zero faces +y: seen from survivor 2 (at y -300) the shoulders stick out along x.
		g.put(1, { x: 0, y: 0, yaw: 90 });
		g.advance(50);
		g.game.setPlayerPos(1, { x: 0, y: 0, z: 0, ducked: false, yaw: NaN });
		g.advance(50);
		const shoulder = playerPoint(zero(false, 90), 'upperArmL', 0.1);
		expect(shoulder.x).toBeLessThan(-7);
		const arm = g.fireAt(2, shoulder);
		expect(g.of('hit', arm.events)).toEqual([{ e: 'hit', by: 2, targetId: 1, head: false, kill: false }]);
		// With yaw 0 nothing of the model is there.
		g.put(1, { x: 0, y: 0, yaw: 0 });
		g.advance(200);
		expect(g.of('hit', g.fireAt(2, shoulder).events)).toEqual([]);
	});

	it('bullets: the raised forearm of an infected is hit side-on; where the arm would hang is a miss', () => {
		const g = start();
		// Patient Zero faces +x; survivor 2 looks along +y from (0, -300).
		const r = g.fireAt(2, playerPoint(zero(), 'foreArmR', 0.8));
		expect(g.of('hit', r.events)).toEqual([{ e: 'hit', by: 2, targetId: 1, head: false, kill: false }]);
		// Turned to face survivor 2: beside the hip, where an empty-handed arm hangs, there is nothing.
		g.put(1, { x: 0, y: 0, yaw: -90 });
		g.advance(200);
		const miss = g.fireAt(2, { x: 10.5, y: 0, z: 32 });
		expect(miss.ok).toBe(true);
		expect(g.of('hit', miss.events)).toEqual([]);
	});

	/** The chin of an infected looking down: in front of everything of one that looks level. */
	const chin = () => {
		const at = playerPoint({ ...zero(), pitch: 80 }, 'head', 1);
		return { ...at, x: at.x + 4 };
	};
	const look = (pitch: number) => ({ x: 0, y: 0, z: 0, ducked: false, yaw: 0, pitch });

	it('bullets: the body follows the view pitch of the state packets', () => {
		const g = start();
		expect(g.of('hit', g.fireAt(2, chin()).events)).toEqual([]);
		g.game.setPlayerPos(1, look(80));
		g.advance(200);
		// A pitch that is not a number keeps the last one.
		g.game.setPlayerPos(1, look(NaN));
		g.advance(200);
		expect(g.of('hit', g.fireAt(2, chin()).events)).toMatchObject([{ targetId: 1, head: true }]);
	});

	it('lag compensation: the rewound pose has the pitch of its time', () => {
		const lowered = () => {
			const g = start();
			g.game.setPlayerPos(1, look(80));
			g.advance(400);
			g.game.setPlayerPos(1, look(0));
			g.advance(200);
			return g;
		};
		const now = lowered();
		expect(now.of('hit', now.fireAt(2, chin()).events)).toEqual([]);
		const then = lowered();
		expect(then.of('hit', then.fireAt(2, chin(), { rewindMs: 300 }).events)).toMatchObject([{ targetId: 1, head: true }]);
	});

	it('claws: the reach follows the weapon held and the view pitch, also the rewound ones', () => {
		const dist = WEAPONS.claws.range + 20;
		const facing = { x: dist, y: 0, z: 0, ducked: false, yaw: 180, pitch: 0 };
		/** Patient Zero swings at survivor 2, whose hands on the LMG are just in reach; `before`: what 2 does first. */
		const swing = (before: (g: ReturnType<typeof start>) => void, shot: { rewindMs?: number } = {}) => {
			const g = start();
			g.put(1, { x: 0, y: 0 });
			g.game.setPlayerPos(2, facing);
			g.advance(600);
			before(g);
			expect(g.fireAt(1, { x: dist, y: 0, z: 64 }, shot).ok).toBe(true);
			return g.game.playerView(2)!.team === 'infected';
		};
		expect(swing(() => {})).toBe(true);
		// The knife out: the hands are further back. 200 ms after the swap a 400 ms old screen still shows the LMG.
		const knife = (g: ReturnType<typeof start>) => {
			expect(g.game.selectWeapon(2, 'knife', g.clock.now)).toHaveLength(1);
			g.advance(200);
		};
		expect(swing(knife)).toBe(false);
		expect(swing(knife, { rewindMs: 400 })).toBe(true);
		// Looking almost straight up, with the hands above the reach.
		const up = (g: ReturnType<typeof start>) => {
			g.game.setPlayerPos(2, { ...facing, pitch: -80 });
			g.advance(200);
		};
		expect(swing(up)).toBe(false);
		expect(swing(up, { rewindMs: 400 })).toBe(true);
	});

	it('ducking takes time: the body is hit where it is drawn on the way down and up', () => {
		const head = (ducked: boolean) => playerPoint(zero(ducked), 'head', 1);
		const hitAt = (ms: number, at: Vec3) => {
			const g = start();
			g.put(1, { x: 0, y: 0, ducked: true });
			g.advance(ms);
			return g.of('hit', g.fireAt(2, at).events).length;
		};
		const half = { x: (head(true).x + head(false).x) / 2, y: 0, z: (head(true).z + head(false).z) / 2 };
		expect(hitAt(16, head(false))).toBe(1);
		expect(hitAt(60, head(false))).toBe(0);
		expect(hitAt(60, half)).toBe(1);
		expect(hitAt(300, head(true))).toBe(1);
	});

	/** In front of where the head of an infected stands, where a run at 250 u/s leans it to. */
	const runFace = () => {
		const at = playerPoint(moving('infected', 'claws', { vx: 250 }), 'head', 1);
		return { ...at, x: at.x + 6.75 };
	};

	it('the body moves with the velocity of the state packets: a run leans it, and stopping stands it up', () => {
		const g = start();
		const run = { x: 0, y: 0, z: 0, ducked: false, yaw: 0, pitch: 0, vx: 250, vy: 0, vz: 0, onGround: true };
		const face = runFace();
		expect(g.of('hit', g.fireAt(2, face).events)).toEqual([]);
		g.game.setPlayerPos(1, run);
		g.advance(800);
		expect(g.of('hit', g.fireAt(2, face).events)).toMatchObject([{ targetId: 1, head: true }]);
		const h = start();
		h.game.setPlayerPos(1, run);
		h.advance(800);
		h.game.setPlayerPos(1, { ...run, vx: 0 });
		h.advance(1000);
		expect(h.of('hit', h.fireAt(2, face).events)).toEqual([]);
		// The pose history has the run: 400 ms back it is hit again, 900 ms after stopping it is not.
		const k = start();
		k.game.setPlayerPos(1, run);
		k.advance(800);
		k.game.setPlayerPos(1, { ...run, vx: 0 });
		k.advance(350);
		expect(k.of('hit', k.fireAt(2, face, { rewindMs: 375 }).events)).toHaveLength(1);
	});

	it('an untrusted velocity never breaks the body: not a number keeps the last one, too fast is as fast as the mode allows', () => {
		expect(INF_SPEED_LIMIT).toBe(SPEED_LIMIT.infected);
		const g = start();
		const run = { x: 0, y: 0, z: 0, ducked: false, yaw: 0, vx: 250, vy: 0, vz: 0, onGround: true };
		g.game.setPlayerPos(1, run);
		g.advance(800);
		for (const bad of [NaN, Infinity, -Infinity]) g.game.setPlayerPos(1, { ...run, vx: bad, vy: bad, vz: bad });
		g.advance(500);
		expect(g.of('hit', g.fireAt(2, runFace()).events)).toHaveLength(1);
		for (const fast of [1e9, -1e9, 1e308]) {
			const f = start();
			f.game.setPlayerPos(1, { ...run, vx: fast, vy: fast, vz: fast, onGround: false });
			f.advance(500);
			f.game.setPlayerPos(1, { ...run, vx: 0 });
			f.advance(1500);
			// Back on its feet, where it stands.
			expect(f.of('hit', f.fireAt(2, playerPoint(zero(), 'head')).events)).toMatchObject([{ targetId: 1, head: true }]);
		}
	});

	it('the body of a too fast claim moves at the limits of the mode, on every axis', () => {
		for (const fast of [5000, 1e9, -1e9]) {
			const f = start();
			for (let i = 0; i < 20; i++) {
				f.game.setPlayerPos(1, { x: 0, y: 0, z: 0, ducked: false, yaw: 0, vx: fast, vy: fast, vz: fast, onGround: false });
				f.advance(50);
			}
			const m = bodyOf(f.game, 1).motion;
			expect(m.speed).toBeGreaterThan(INF_SPEED_LIMIT * 0.98);
			expect(m.speed).toBeLessThanOrEqual(INF_SPEED_LIMIT + 1e-6);
			expect(Math.abs(m.vzS)).toBeLessThanOrEqual(SURF_CVARS.sv_maxvelocity + 1e-6);
			expect(Math.abs(m.vzS)).toBeGreaterThan(Math.min(Math.abs(fast), SURF_CVARS.sv_maxvelocity) * 0.98);
		}
		// The client draws with the same clamp.
		const v = { vx: 3e38, vy: 0, vz: -3e38 };
		clampInfVelocity(v);
		expect(v).toEqual({ vx: INF_SPEED_LIMIT, vy: 0, vz: -SURF_CVARS.sv_maxvelocity });
		const slow = { vx: 200, vy: -100, vz: 301 };
		clampInfVelocity(slow);
		expect(slow).toEqual({ vx: 200, vy: -100, vz: 301 });
	});

	it('a spawn starts the body over: one that ran ducked and looked down stands up straight at once', () => {
		const g = start();
		g.game.setPlayerPos(1, { x: 0, y: 0, z: 0, ducked: true, yaw: 0, pitch: 70, vx: 250, vy: 0, vz: 0, onGround: true });
		g.advance(800);
		expect(bodyOf(g.game, 1).motion.duck).toBeGreaterThan(0.9);
		g.game.setPlayerPos(1, { x: 0, y: 0, z: -1000, ducked: true, yaw: 0, pitch: 70, vx: 250, vy: 0, vz: 0, onGround: true });
		g.advance(INF_STEP_MS);
		const fall = g.of('spawn').at(-1)!;
		expect(fall).toMatchObject({ id: 1, reason: 'fall' });
		g.game.setPlayerPos(1, { x: fall.x, y: fall.y, z: fall.z, ducked: false, yaw: fall.yaw, pitch: 0, vx: 0, vy: 0, vz: 0, onGround: true });
		g.advance(INF_STEP_MS * 2);
		const m = bodyOf(g.game, 1).motion;
		expect(m.duck).toBeLessThan(0.01);
		expect(m.speed).toBeLessThan(1);
		expect(Math.abs(m.aim)).toBeLessThan(0.01);
	});

	it('melee line of sight follows the lean: a hunched body just past the end of a wall can be hit', () => {
		const g = withInfected();
		// The thin wall (x 400..404) ends at y 300. Survivor 3 (knife) stands just past its end, infected 2 behind it:
		// the point half way up is hidden at the feet, and clear of the wall on a body leaning towards +y.
		g.game.selectWeapon(3, 'knife', g.clock.now);
		g.put(3, { x: 380, y: 310 });
		g.put(1, { x: -1000, y: 1000 });
		const at = (yaw: number): PlayerPose => ({ ...pose('infected', false, yaw, 425, 291), held: 'claws' });
		expect(playerUp(at(90), 40).y - playerUp(at(-90), 40).y).toBeGreaterThan(4);
		g.put(2, { x: 425, y: 291, yaw: -90 });
		g.advance(600);
		const away = g.fireAt(3, playerPoint(at(-90), 'chest'));
		expect(away.ok).toBe(true);
		expect(g.of('hit', away.events)).toEqual([]);
		g.put(2, { x: 425, y: 291, yaw: 90 });
		g.advance(600);
		const out = g.fireAt(3, playerPoint(at(90), 'chest'));
		expect(g.of('hit', out.events)).toEqual([{ e: 'hit', by: 3, targetId: 2, head: false, kill: true }]);
	});

	it('melee needs a clear line to the body: one past the end of a wall can be hit, one behind it not', () => {
		const g = withInfected();
		// The thin wall (x 400..404) ends at y 300. Survivor 3 (knife) stands just past its end.
		g.game.selectWeapon(3, 'knife', g.clock.now);
		g.put(3, { x: 380, y: 310 });
		g.put(1, { x: -1000, y: 1000 });
		const at = (y: number): PlayerPose => ({ ...pose('infected', false, 90, 425, y), held: 'claws' });
		g.put(2, { x: 425, y: 276, yaw: 90 });
		g.advance(600);
		const behind = g.fireAt(3, playerPoint(at(276), 'chest'));
		expect(behind.ok).toBe(true);
		expect(g.of('hit', behind.events)).toEqual([]);
		g.put(2, { x: 425, y: 306, yaw: 90 });
		g.advance(600);
		const out = g.fireAt(3, playerPoint(at(306), 'chest'));
		expect(g.of('hit', out.events)).toEqual([{ e: 'hit', by: 3, targetId: 2, head: false, kill: true }]);
	});

	it('claws: reach is measured to the model, not to a cylinder around the feet', () => {
		const g = withInfected();
		const reach = WEAPONS.claws.range;
		// Facing the claws at 26 past the reach, the LMG up: the left hand on the gun is about 24 closer, still short.
		g.put(2, { x: 0, y: 0 });
		g.put(3, { x: reach + 26, y: 0, yaw: 180 });
		g.advance(1000);
		g.fireAt(2, { x: reach + 26, y: 0, z: 64 });
		expect(g.game.playerView(3)!.team).toBe('survivor');
		// At 20 past the reach the hand is in it, the chest is not.
		g.put(3, { x: reach + 20, y: 0, yaw: 180 });
		g.advance(1000);
		g.fireAt(2, { x: reach + 20, y: 0, z: 64 });
		expect(g.of('infect').at(-1)).toMatchObject({ id: 3, by: 2, method: 'claws' });
	});

	it('throwing knife: grazes the arm of a survivor facing it, passes one further off in profile', () => {
		// 17 to the side: the knife's 10 unit radius reaches the left arm raised to the LMG (its elbow is about 8 out).
		const facing = withInfected();
		facing.put(2, { x: 0, y: 0 });
		facing.put(3, { x: 300, y: 17, yaw: 180 });
		facing.advance(50);
		expect(facing.game.throwKnife(2, facing.eye(2), unit(1, 0, 0), facing.clock.now).ok).toBe(true);
		facing.advance(500);
		expect(facing.of('infect').at(-1)).toMatchObject({ id: 3, by: 2, method: 'knife' });

		const profile = withInfected();
		profile.put(2, { x: 0, y: 0 });
		profile.put(3, { x: 300, y: 19, yaw: 90 });
		profile.advance(50);
		expect(profile.game.throwKnife(2, profile.eye(2), unit(1, 0, 0), profile.clock.now).ok).toBe(true);
		profile.advance(500);
		expect(profile.game.playerView(3)!.team).toBe('survivor');
	});
});
