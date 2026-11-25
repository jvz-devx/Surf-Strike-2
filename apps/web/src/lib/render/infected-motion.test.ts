/**
 * The server's player hit capsules against moving characters as drawn
 * (docs/modes.md#infected): the real CharacterModel, animated and skinned,
 * default clothes, LOD 0, next to the body the server follows. At rest:
 * infected-hitbox.test.ts.
 *
 * Two numbers per case, over a whole gait cycle of a settled motion:
 * - the furthest drawn point outside the capsules (COVER), and
 * - the furthest point of the capsules from anything drawn over the cycle (OVERSHOOT).
 * The stride is only known to the client that draws it, so the legs and free
 * arms are covered wherever they are in it.
 *
 * Between two motions the numbers differ by what 32 snapshots a second leave
 * out; those cases have their own limits.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeldAssets } from './character/held.js';
import { ITEMS, legShots, measure, REGIONS, SCRIPTS, transient, type Case, type Look, type Measured, type PerRegion } from './infected-motion-testkit.js';

/** A torso, head or arm is drawn at most this far outside; a leg as little as at rest. */
const COVER: PerRegion = { torso: 1.5, arms: 1.5, legs: 0.4 };
/** At rest: 3.9. */
const OVERSHOOT: PerRegion = { torso: 4, arms: 4, legs: 3.9 };

let assets: HeldAssets;
let seed = 0;
beforeAll(() => {
	assets = new HeldAssets();
	vi.spyOn(Math, 'random').mockImplementation(() => (seed = (seed + 0.37) % 1));
});
// The idle motion starts at a random time: the same in every test, whatever ran before it.
beforeEach(() => void (seed = 0));
afterAll(() => {
	assets.dispose();
	vi.restoreAllMocks();
});

const DIRS = [0, 45, 90, 135, 180, -135, -90, -45];
/** Below and at the run speeds, the cap of a hop (286) and what strafing gains on top. */
const SPEEDS = [0, 120, 190, 250, 265, 286, 340];
const SURVIVOR: Look = { role: 'none', held: 'lmg' };
const INFECTED: Look = { role: 'infected', held: 'claws' };
const LOOKS: Look[] = [
	...[null, ...ITEMS].map((held): Look => ({ role: 'none', held })),
	INFECTED,
	{ role: 'alpha', held: 'claws' }
];
const still = (l: Look): Case => ({ ...l, ducked: false, pitch: 0, speed: 0, dir: 0 });

function check(c: Case, m: Measured): void {
	const label = JSON.stringify(c);
	for (const r of REGIONS) {
		expect(m.out[r], `${r} drawn outside: ${label}`).toBeLessThan(COVER[r]);
		expect(m.over[r], `${r} capsules off: ${label}`).toBeLessThan(OVERSHOOT[r]);
	}
}

describe.each([SURVIVOR, INFECTED])('hit capsules of a moving $role', { timeout: 120_000 }, (look) => {
	it.each(SPEEDS)('running at %i, eight directions', (speed) => {
		for (const [i, dir] of (speed ? DIRS : [0]).entries()) {
			const c = { ...still(look), speed, dir };
			check(c, measure(c, assets, { frames: 24, stride: 2, over: (i + SPEEDS.indexOf(speed)) % 2 === 0 }));
		}
	});

	it.each([0, 60, 85, 190, 250])('ducked at %i, eight directions', (speed) => {
		for (const [i, dir] of (speed ? DIRS : [0]).entries()) {
			const c = { ...still(look), ducked: true, speed, dir };
			check(c, measure(c, assets, { frames: 20, stride: 2, over: i % 3 === speed % 3 }));
		}
	});

	it('a strafe keeps the hips of the way it was reached: from a run forward and from a run backward', () => {
		for (const from of [0, 180]) for (const dir of [90, -90]) check({ ...still(look), speed: 250, dir, from }, measure({ ...still(look), speed: 250, dir, from }, assets, { frames: 24, stride: 2 }));
	});

	it('standing, with the feet trailing a turn on the spot', () => {
		for (const ducked of [false, true]) check({ ...still(look), ducked, turn: true }, measure({ ...still(look), ducked, turn: true }, assets));
	});

	it.each([300, 150, 0, -150, -300, -600])('in the air at %i up, upright and ducked', (vz) => {
		for (const ducked of [false, true]) check({ ...still(look), speed: 250, ducked, vz }, measure({ ...still(look), speed: 250, ducked, vz }, assets, { frames: 12, stride: 2 }));
	});
});

describe('hit capsules of moving arms, torso and head', { timeout: 120_000 }, () => {
	it.each(LOOKS)('$role holding $held, every pitch', (look) => {
		const n = LOOKS.indexOf(look);
		for (const [k, pitch] of [-80, -40, 0, 40, 80].entries()) {
			const run: Case = { ...still(look), pitch, speed: [250, 190, 265, 300, 120][(n + k) % 5]!, dir: DIRS[(n * 3 + k) % 8]! };
			const cases: Case[] = [run, k % 2 === 0 ? { ...still(look), pitch, speed: 85, dir: DIRS[(n + k) % 8]!, ducked: true } : { ...still(look), pitch, speed: 250, vz: n % 2 ? 300 : -300 }];
			for (const c of cases) check(c, measure(c, assets, { frames: 32, stride: 3, regions: [0, 1] }));
		}
	});

	it('an elbow that a bob swings around: a pistol aimed straight up', () => {
		for (const dir of DIRS) {
			for (const [pitch, speed] of [[-80, 190], [-80, 300], [-60, 300]] as const) {
				const c: Case = { role: 'none', held: 'pistol', ducked: false, pitch, speed, dir };
				check(c, measure(c, assets, { frames: 48, stride: 2, regions: [1], over: speed === 190 && dir % 90 !== 0 }));
			}
		}
	});
});

describe('between two motions, over 32 snapshots a second', { timeout: 120_000 }, () => {
	/**
	 * What the change itself may leave outside (torso and head, arms, legs), in
	 * units: pins a measurement (14 phases at 60 fps), not a requirement.
	 */
	const DURING: Record<string, [torso: number, arms: number, legs: number]> = {
		'strafe left and right': [1.6, 1.8, 1.6],
		'look around on the run': [0.7, 4.5, 1.3],
		'turn on the spot': [0.5, 0.5, 1],
		'flick on the spot': [0.5, 0.5, 2.5],
		'duck and up': [4.5, 5.5, 3.1],
		'duck on the run': [3.1, 2.7, 1.6]
	};
	it.each(Object.keys(SCRIPTS))('%s', (name) => {
		const s = SCRIPTS[name]!;
		const limit = DURING[name] ?? [0.5, 1.2, 1.2];
		for (const look of [SURVIVOR, INFECTED])
			for (const phase of [0, 0.1, 0.23]) {
				const t = transient(look, s.run(look.role === 'none' ? 220 : 265), assets, { until: s.until, end: s.end, phase });
				for (const [i, r] of REGIONS.entries()) {
					expect(t.during[r], `${look.role} ${r} during`).toBeLessThan(limit[i]!);
					// Settled again: the arms swing a little wider while the last of a speed-up eases out.
					expect(t.after[r], `${look.role} ${r} after`).toBeLessThan({ torso: 0.4, arms: 1.2, legs: 0.4 }[r]);
				}
			}
	});
});

describe('shots at the legs of a runner at 250 u/s', { timeout: 120_000 }, () => {
	it.each([
		[SURVIVOR, 0],
		[SURVIVOR, 45],
		[SURVIVOR, 90],
		[INFECTED, 0],
		[INFECTED, 45],
		[INFECTED, 90]
	])('every shot that meets a drawn leg hits: %o seen from %i degrees', (look, from) => {
		const s = legShots({ ...still(look), speed: 250 }, from, assets, 6);
		expect(s.leg).toBeGreaterThan(1000);
		expect(s.legHit).toBe(s.leg);
		// The price: between the legs it hits too, wherever the legs pass.
		expect(s.gapHit).toBe(s.gap);
	});
});
