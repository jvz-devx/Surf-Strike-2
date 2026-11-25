/**
 * Gun kick of the first-person weapon (gunfeel.ts `GunKick`, `GUN_KICK`):
 * shots add velocities, a pull brings the gun back (weaker on the way back),
 * linear drag, a speed cap, a dead zone at centre, per-gun limits, and the
 * same pose for any update step.
 */
import { WEAPONS } from '@surf/shared';
import { describe, expect, it } from 'vitest';
import { GUN_KICK, GUN_KICK_DEAD_ANGLE, GUN_KICK_DEAD_SPEED, GunKick, type GunKickDef } from './gunfeel.js';

/** Small deterministic PRNG (mulberry32). */
function seeded(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const GUNS = ['pistol', 'smg', 'lmg', 'striker', 'sniper', 'barrett'] as const;

/** Pitch-only def; rng 1 gives `pitchMax`, yaw stays 0. */
const def = (over: Partial<GunKickDef> = {}): GunKickDef => ({
	pitchMin: 0,
	pitchMax: 100,
	yawMin: 0,
	yawMax: 0,
	accel: 0,
	staticDecay: 0,
	speedDecay: 0,
	speedMax: 10000,
	maxPitch: 90,
	maxYaw: 90,
	...over
});

describe('gun kick (G5)', () => {
	it('every gun has its own values; melee has none', () => {
		for (const w of GUNS) {
			const d = GUN_KICK[w]!;
			expect(d, w).toBeDefined();
			expect(d.pitchMax).toBeGreaterThanOrEqual(d.pitchMin);
			expect(d.accel).toBeGreaterThan(d.staticDecay);
			expect(d.speedDecay).toBeGreaterThan(0);
			expect(d.maxPitch).toBeGreaterThan(0);
		}
		expect(GUN_KICK.lmg).not.toEqual(GUN_KICK.pistol);
		expect(GUN_KICK.knife).toBeUndefined();
		expect(GUN_KICK.claws).toBeUndefined();
		const g = new GunKick(() => 1);
		g.kick('knife', 0);
		g.update(50);
		expect(g.resting).toBe(true);
	});

	it('a shot adds its velocity to the one the gun already has', () => {
		const g = new GunKick(() => 1);
		g.kickWith(def(), 0);
		expect(g.speedPitch).toBe(100);
		g.update(10);
		g.kickWith(def(), 10);
		expect(g.speedPitch).toBe(200);
		// Opposite kicks cancel.
		const c = new GunKick((() => {
			const v = [1, 0.5, 0, 0.5];
			let i = 0;
			return () => v[i++]!;
		})());
		c.kickWith(def({ pitchMin: -100 }), 0);
		c.kickWith(def({ pitchMin: -100 }), 0);
		expect(c.speedPitch).toBe(0);
	});

	it('caps the speed at speedMax', () => {
		const g = new GunKick(() => 1);
		const d = def({ speedMax: 150 });
		g.kickWith(d, 0);
		g.kickWith(d, 0);
		expect(g.speedPitch).toBe(150);
	});

	it('linear drag slows it in proportion to its speed', () => {
		const free = new GunKick(() => 1);
		free.kickWith(def(), 0);
		free.update(100);
		expect(free.speedPitch).toBe(100);
		const drag = new GunKick(() => 1);
		drag.kickWith(def({ speedDecay: 10 }), 0);
		drag.update(100);
		// v(t) = v0 e^(−b t): 100 e^−1 after 0.1 s (1 ms steps, within 1%).
		expect(Math.abs(drag.speedPitch / (100 * Math.exp(-1)) - 1)).toBeLessThan(0.01);
	});

	it('the pull is full while moving away and weaker by staticDecay on the way back; it may swing past centre', () => {
		const g = new GunKick(() => 1);
		const d = def({ accel: 1000, staticDecay: 600 });
		g.kickWith(d, 0);
		g.update(50);
		expect(g.speedPitch).toBeCloseTo(100 - 1000 * 0.05, 6);
		g.update(200);
		// Turned at 0.1 s, then 0.1 s back at 400 deg/s².
		expect(g.speedPitch).toBeCloseTo(-400 * 0.1, 0);
		// Without drag nothing stops it at centre: it goes past.
		let low = 0;
		for (let t = 200; t < 800; t += 5) {
			g.update(t);
			low = Math.min(low, g.pitch);
		}
		expect(low).toBeLessThan(-1);
	});

	it('snaps to centre inside the dead zone', () => {
		const g = new GunKick(() => 1);
		g.kickWith(def({ pitchMax: GUN_KICK_DEAD_SPEED * 0.5 }), 0);
		expect(g.resting).toBe(false);
		g.update(1);
		expect(g.resting).toBe(true);
		// Just outside it the gun keeps moving.
		const out = new GunKick(() => 1);
		out.kickWith(def({ pitchMax: GUN_KICK_DEAD_SPEED * 2 }), 0);
		out.update(1);
		expect(out.resting).toBe(false);
		expect(GUN_KICK_DEAD_ANGLE).toBe(0.25);
	});

	it('stays inside the gun limits', () => {
		const g = new GunKick(() => 1);
		const d = def({ maxPitch: 3, accel: 200 });
		g.kickWith(d, 0);
		let top = 0;
		for (let t = 0; t < 300; t++) {
			g.update(t);
			top = Math.max(top, g.pitch);
		}
		expect(top).toBe(3);
	});

	it('every gun comes back to rest after a spray, and the pose is the same for any update step', () => {
		for (const w of GUNS) {
			const a = new GunKick(seeded(5));
			const b = new GunKick(seeded(5));
			const gap = WEAPONS[w].fireMs;
			let top = 0;
			for (let i = 0; i < 8; i++) {
				a.kick(w, 1000 + i * gap);
				b.kick(w, 1000 + i * gap);
				for (let t = 1000 + i * gap; t < 1000 + (i + 1) * gap; t += 16.7) {
					a.update(t);
					top = Math.max(top, a.pitch);
				}
				for (let t = 1000 + i * gap; t < 1000 + (i + 1) * gap; t += 0.9) b.update(t);
			}
			for (const t of [1000 + 8 * gap + 3, 1000 + 8 * gap + 120]) {
				a.update(t);
				b.update(t);
				expect(b.pitch, w).toBe(a.pitch);
				expect(b.yaw).toBe(a.yaw);
			}
			expect(top, w).toBeGreaterThan(0.5);
			a.update(1000 + 8 * gap + 3000);
			expect(a.resting, w).toBe(true);
		}
	});
});
