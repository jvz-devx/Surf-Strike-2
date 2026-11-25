/**
 * The combat sound listener while spectating (infected-listener.ts): which
 * point the infected and zombies sounds are heard from, and which of them
 * count as the spectated player's own. Levels and pans are the real ones of
 * the mix (combat.ts, mix.ts).
 */
import { INF_INFECTED_SPEED, INTERP_DELAY_MS, type Vec3 } from '@surf/shared';
import { describe, expect, it } from 'vitest';
import { combatDb, INFECTED_SOUNDS, ZOMBIES_SOUNDS, type CombatSound } from '../audio/combat.js';
import { PAN_MAX, panFor } from '../audio/mix.js';
import { OWN_SOUND_RADIUS, soundListener, soundSource, type DrawnPlayer, type SpecCamera } from './infected-listener.js';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const drawn = (vx = 0, vy = 0, vz = 0, hasSample = true): DrawnPlayer => ({ hasSample, sample: { vx, vy, vz } });
const players = (id: number, p: DrawnPlayer): Map<number, DrawnPlayer> => new Map([[id, p]]);
const NOBODY = new Map<number, DrawnPlayer>();

/** What GameAudio.combat does with a sound: level (dB, null = silent) and pan. */
function heard(s: CombatSound, at: Vec3 | undefined, listener: Vec3, yaw: number): { db: number | null; pan: number } {
	const positional = at !== undefined;
	return { db: combatDb(s, positional ? dist(at, listener) : undefined), pan: positional && s.range !== null ? panFor(listener, at, yaw) : 0 };
}

/** My body stopped here when I started spectating. */
const PARKED = v(0, 0, 64);
/** The spectated survivor's drawn eye, 3000 units away, looking along +y. */
const CAMERA = v(3000, 0, 64);
const YAW = 90;
const TARGET = 7;

describe('soundListener: sounds are heard from the camera', () => {
	it('my eye while playing; the spectator camera while spectating a player, in free-fly and before the target has a sample', () => {
		const spec: SpecCamera = { targetId: TARGET, freeFly: false, pos: CAMERA };
		expect(soundListener(null, PARKED)).toBe(PARKED);
		expect(soundListener(spec, PARKED)).toBe(CAMERA);
		expect(soundListener({ targetId: null, freeFly: true, pos: CAMERA }, PARKED)).toBe(CAMERA);
		expect(soundListener({ targetId: TARGET, freeFly: true, pos: CAMERA }, PARKED)).toBe(CAMERA);
		// The camera object itself: game.ts moves it every frame, and nothing is allocated per sound.
		spec.pos.x += 10;
		expect(soundListener(spec, PARKED).x).toBe(3010);
		spec.pos.x -= 10;
	});

	for (const [mode, sounds] of [
		['infected', INFECTED_SOUNDS],
		['zombies', ZOMBIES_SOUNDS]
	] as const) {
		it(`${mode}: a fight around the spectated player is heard at its real level and side, not from my parked body`, () => {
			const spec: SpecCamera = { targetId: TARGET, freeFly: false, pos: CAMERA };
			const shot = sounds['shot-lmg']!;
			// Another survivor fires 300 units to the camera's right (the camera looks along +y, so right is +x).
			const at = v(3300, 0, 64);
			// The finding: heard from the parked eye it is 3300 units away, some 18 dB down and nearly centred.
			const wrong = heard(shot, at, PARKED, YAW);
			expect(wrong.db!).toBeLessThan(combatDb(shot)! - 15);
			// From the camera it is close: full level, on the right.
			const right = heard(shot, at, soundListener(spec, PARKED), YAW);
			expect(right.db).toBe(combatDb(shot, 300));
			expect(right.db!).toBeGreaterThan(wrong.db! + 15);
			expect(right.pan).toBeCloseTo(PAN_MAX, 5);
			// Free-fly: the same from wherever the camera flew.
			const fly: SpecCamera = { targetId: null, freeFly: true, pos: v(3300, -400, 64) };
			expect(heard(shot, at, soundListener(fly, PARKED), YAW).pan).toBeCloseTo(0, 5); // straight ahead
			expect(heard(shot, at, soundListener(fly, PARKED), YAW).db).toBe(combatDb(shot, 400));
		});
	}

	it('infected: deaths and impacts next to the spectated player were silent from the parked body', () => {
		const spec: SpecCamera = { targetId: TARGET, freeFly: false, pos: CAMERA };
		for (const name of ['death', 'impact', 'infect', 'knifeStick', 'beaconSmash']) {
			const s = INFECTED_SOUNDS[name]!;
			const at = v(2900, 150, 40);
			expect(heard(s, at, PARKED, YAW).db, name).toBeNull();
			const h = heard(s, at, soundListener(spec, PARKED), YAW);
			expect(h.db, name).not.toBeNull();
			expect(h.pan, name).toBeLessThan(0); // on the camera's left
		}
	});
});

describe('soundSource: own sounds stay centred and at full level', () => {
	it('a sound without a position is my own in every state', () => {
		const spec: SpecCamera = { targetId: TARGET, freeFly: false, pos: CAMERA };
		for (const s of [null, spec, { targetId: null, freeFly: true, pos: CAMERA }]) {
			expect(soundSource(undefined, s, players(TARGET, drawn()))).toBeUndefined();
			const shot = INFECTED_SOUNDS['shot-lmg']!;
			expect(heard(shot, soundSource(undefined, s, NOBODY), soundListener(s, PARKED), YAW)).toEqual({ db: combatDb(shot), pan: 0 });
		}
	});

	it('playing: every positioned sound keeps its position, however close', () => {
		const at = v(4, 0, 64);
		expect(soundSource(at, null, NOBODY)).toBe(at);
		expect(soundSource(PARKED, null, players(TARGET, drawn(0, 300)))).toBe(PARKED);
	});

	it('spectating a player: their shots come from a little ahead of the drawn eye, and are heard as my own', () => {
		const spec: SpecCamera = { targetId: TARGET, freeFly: false, pos: CAMERA };
		const shot = INFECTED_SOUNDS['shot-lmg']!;
		// The target strafes right (+x at yaw 90) at infected speed. Remote players are drawn INTERP_DELAY_MS
		// late, so the shot origin (their eye now) is that far ahead of the camera, plus up to a snapshot.
		for (const lagMs of [INTERP_DELAY_MS, INTERP_DELAY_MS + 31, INTERP_DELAY_MS + 60]) {
			const at = v(CAMERA.x + (INF_INFECTED_SPEED * lagMs) / 1000, 0, 64);
			// The problem: taken as a position it is panned well to the side (it is the player I am watching).
			expect(heard(shot, at, CAMERA, YAW).pan, `${lagMs} ms`).toBeGreaterThan(0.4);
			const src = soundSource(at, spec, players(TARGET, drawn(INF_INFECTED_SPEED, 0)));
			expect(src, `${lagMs} ms`).toBeUndefined();
			expect(heard(shot, src, soundListener(spec, PARKED), YAW)).toEqual({ db: combatDb(shot), pan: 0 });
		}
		// A bunny-hopping target at 600 u/s, rising: still on the stretch they covered.
		expect(soundSource(v(CAMERA.x - 70, 0, 64 + 28), spec, players(TARGET, drawn(-600, 0, 240)))).toBeUndefined();
		// Standing still: at the eye, and their body sounds (death, infection) at chest height, feet included.
		expect(soundSource(v(3000, 0, 64), spec, players(TARGET, drawn()))).toBeUndefined();
		expect(soundSource(v(3004, -3, 40), spec, players(TARGET, drawn()))).toBeUndefined();
		expect(soundSource(v(3000, 0, 0), spec, players(TARGET, drawn()))).toBeUndefined();
		// No sample yet: only what is at the camera.
		expect(soundSource(v(3010, 0, 64), spec, players(TARGET, drawn(999, 0, 0, false)))).toBeUndefined();
		expect(soundSource(v(3010, 0, 64), spec, NOBODY)).toBeUndefined();
	});

	it('spectating a player: everyone else keeps their position, also right next to the target', () => {
		const spec: SpecCamera = { targetId: TARGET, freeFly: false, pos: CAMERA };
		const claws = INFECTED_SOUNDS.claws!;
		const moving = players(TARGET, drawn(0, INF_INFECTED_SPEED)); // running straight ahead (+y)
		// An infected swinging 64 units to the target's left: on the left, not centred.
		const beside = v(CAMERA.x - 64, 20, 64);
		expect(soundSource(beside, spec, moving)).toBe(beside);
		expect(heard(claws, soundSource(beside, spec, moving), soundListener(spec, PARKED), YAW).pan).toBeLessThan(-0.7);
		// Just outside the body's width, beside the stretch.
		const near = v(CAMERA.x + OWN_SOUND_RADIUS + 1, 10, 64);
		expect(soundSource(near, spec, moving)).toBe(near);
		// Further along the path than they can have come, behind them, above and below them.
		for (const at of [v(3000, 120, 64), v(3000, -40, 64), v(3000, 0, 64 + 40), v(3000, 0, 64 - 120)]) expect(soundSource(at, spec, moving)).toBe(at);
		// The stretch follows the velocity: what is theirs while strafing right is not while running ahead.
		const ahead = v(CAMERA.x + 40, 0, 64);
		expect(soundSource(ahead, spec, players(TARGET, drawn(INF_INFECTED_SPEED, 0)))).toBeUndefined();
		expect(soundSource(ahead, spec, moving)).toBe(ahead);
	});

	it('free-fly: nothing is my own, whatever passes the camera', () => {
		const at = v(3000, 0, 64);
		expect(soundSource(at, { targetId: null, freeFly: true, pos: CAMERA }, NOBODY)).toBe(at);
		// Free-fly keeps the last target id: still not theirs.
		expect(soundSource(at, { targetId: TARGET, freeFly: true, pos: CAMERA }, players(TARGET, drawn()))).toBe(at);
		expect(soundSource(at, { targetId: null, freeFly: false, pos: CAMERA }, NOBODY)).toBe(at);
	});
});
