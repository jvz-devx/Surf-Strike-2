/**
 * View kick (gunfeel.ts `ViewKick`, `RECOIL`): a random velocity per axis on
 * every shot, pulled back by the centre speed (one-sixteenth on the way back),
 * stopping on the original point of aim, replaced by the next shot, bounded at
 * 10°, with roll from the yaw; and the on-screen calibration of every gun.
 */
import { WEAPONS, type WeaponId } from '@surf/shared';
import { describe, expect, it } from 'vitest';
import {
	convertKick,
	kickSet,
	RECOIL,
	RECOIL_REF_FOV,
	RECOIL_SOURCE,
	recoilRestMs,
	screenScale,
	screenShare,
	spreadGapPx,
	VIEW_KICK_BOUND,
	VIEW_KICK_RETURN,
	VIEW_KICK_ROLL,
	ViewKick,
	type ViewKickSet
} from './gunfeel.js';

const GUNS = ['pistol', 'smg', 'lmg', 'striker', 'sniper', 'barrett'] as const satisfies readonly WeaponId[];

/** A set for the rules: no reduced shots unless asked. */
const set = (over: Partial<ViewKickSet> = {}): ViewKickSet => ({ pitchMin: -50, pitchMax: 150, yawMin: -100, yawMax: 100, centerSpeed: 1000, reducedShots: 0, reducedPercent: 0, ...over });
/** rng returning the given values in turn (then the last one). */
const seq = (...v: number[]) => {
	let i = 0;
	return () => v[Math.min(i++, v.length - 1)]!;
};
/** rng for a velocity: the share of the range that gives `v` in [min, max]. */
const share = (v: number, min: number, max: number) => (v - min) / (max - min);
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

/** One kick from rest with exact pitch and yaw velocities (deg/s; pitch + = up, yaw + = left). */
function kicked(s: ViewKickSet, pitch: number, yaw: number, t = 0): ViewKick {
	const k = new ViewKick(seq(share(pitch, s.pitchMin, s.pitchMax), share(yaw, s.yawMin, s.yawMax)));
	k.kickWith(s, t);
	return k;
}

describe('view kick data', () => {
	it('every gun has a hip set, an aimed set, and the rifles a scoped set; melee has none', () => {
		for (const w of GUNS) {
			const d = RECOIL[w]!;
			expect(d, w).toBeDefined();
			// The aimed set (aiming down sights): infected-aim.test.ts.
			expect(d.aimed, w).not.toBeNull();
			expect(d.scoped !== null).toBe(WEAPONS[w].zoomFov !== null);
			for (const s of [d.hip, d.scoped, d.aimed].filter((x): x is ViewKickSet => x !== null)) {
				expect(s.pitchMax).toBeGreaterThan(s.pitchMin);
				expect(s.yawMax).toBeGreaterThan(s.yawMin);
				expect(s.centerSpeed).toBeGreaterThan(0);
			}
		}
		expect(RECOIL.knife).toBeUndefined();
		expect(RECOIL.claws).toBeUndefined();
		const k = new ViewKick(() => 0.9);
		k.kick('knife', 0);
		k.update(100);
		expect(k.resting).toBe(true);
	});

	it('hip fire uses the hip set, scoped fire the scoped set; the .50 cal only ever kicks left', () => {
		const pick = (w: WeaponId, scoped: boolean, r: number) => {
			const k = new ViewKick(() => r);
			k.kick(w, 0, scoped);
			return k;
		};
		const d = RECOIL.sniper!;
		expect(pick('sniper', true, 1).velocity('pitch')).toBeCloseTo(d.scoped!.pitchMax, 9);
		expect(pick('sniper', false, 1).velocity('pitch')).toBeCloseTo(d.hip.pitchMax, 9);
		expect(pick('lmg', true, 1).velocity('pitch')).toBeCloseTo(RECOIL.lmg!.hip.pitchMax, 9);
		expect(kickSet(RECOIL.lmg!, true)).toBe(RECOIL.lmg!.hip);
		for (const r of [0, 0.5, 1]) for (const scoped of [false, true]) expect(pick('barrett', scoped, r).velocity('yaw')).toBeGreaterThan(0);
	});
});

describe('view kick rules (G1)', () => {
	it('every shot draws a random velocity inside the range on each axis: no pattern', () => {
		const s = set();
		for (const [rp, ry] of [
			[0, 0],
			[1, 1],
			[0.25, 0.8],
			[0.5, 0.5]
		] as const) {
			const k = new ViewKick(seq(rp, ry));
			k.kickWith(s, 0);
			expect(k.velocity('pitch')).toBeCloseTo(s.pitchMin + (s.pitchMax - s.pitchMin) * rp, 9);
			expect(k.velocity('yaw')).toBeCloseTo(s.yawMin + (s.yawMax - s.yawMin) * ry, 9);
		}
		// A spray from rest each time: the same shot index gets a different kick on every pull.
		const rng = seeded(7);
		const firsts = new Set<number>();
		for (let i = 0; i < 20; i++) {
			const k = new ViewKick(rng);
			k.kickWith(s, 0);
			expect(k.velocity('pitch')).toBeGreaterThanOrEqual(s.pitchMin);
			expect(k.velocity('pitch')).toBeLessThanOrEqual(s.pitchMax);
			expect(Math.abs(k.velocity('yaw'))).toBeLessThanOrEqual(s.yawMax);
			firsts.add(Math.round(k.velocity('pitch')));
		}
		expect(firsts.size).toBeGreaterThan(15);
	});

	it('moving away it slows at the full centre speed; moving back it is pulled by one-sixteenth of it', () => {
		const s = set({ centerSpeed: 1000 });
		const k = kicked(s, 100, 0);
		expect(k.up).toBe(0);
		k.update(50);
		// x = v t − a t² / 2, v − a t
		expect(k.up).toBeCloseTo(100 * 0.05 - 500 * 0.05 ** 2, 9);
		expect(k.velocity('pitch')).toBeCloseTo(50, 9);
		k.update(100);
		expect(k.up).toBeCloseTo(5, 9);
		expect(k.velocity('pitch')).toBe(0);
		// Back: a / 16 = 62.5 deg/s².
		k.update(300);
		expect(VIEW_KICK_RETURN).toBe(1 / 16);
		expect(k.up).toBeCloseTo(5 - 0.5 * 62.5 * 0.2 ** 2, 9);
		expect(k.velocity('pitch')).toBeCloseTo(-62.5 * 0.2, 9);
		// Down works the same way.
		const d = kicked(s, -50, 0);
		d.update(50);
		expect(d.up).toBeCloseTo(-1.25, 9);
		d.update(150);
		expect(d.up).toBeCloseTo(-1.25 + 0.5 * 62.5 * 0.1 ** 2, 9);
	});

	it('stops exactly on the original point of aim, per axis', () => {
		const s = set({ centerSpeed: 1000 });
		const k = kicked(s, 100, -40);
		// Pitch: 0.1 s up to 5°, then sqrt(2 × 5 / 62.5) = 0.4 s back.
		k.update(499);
		expect(k.up).toBeGreaterThan(0);
		k.update(500);
		expect(k.up).toBe(0);
		expect(k.pitch).toBe(0);
		expect(k.velocity('pitch')).toBe(0);
		// Yaw (0.8° right) and its roll were back long before and stayed there.
		expect(k.yaw).toBe(0);
		expect(k.roll).toBe(0);
		k.update(5000);
		expect(k.resting).toBe(true);
		// The yaw stops first while the pitch still recovers: it slides down an invisible wall.
		const w = kicked(s, 100, 40);
		// Yaw: 0.04 s out to 0.8°, sqrt(2 × 0.8 / 62.5) = 0.16 s back.
		w.update(150);
		expect(w.yaw).toBeGreaterThan(0);
		w.update(200.001);
		expect(w.yaw).toBe(0);
		expect(w.up).toBeGreaterThan(4);
	});

	it('a shot off-centre replaces the velocity: in full when it points away, at one-sixteenth when it points back', () => {
		const s = set({ centerSpeed: 1000 });
		// At the top of a 5° kick (velocity 0): a new kick up is used in full.
		const away = new ViewKick(seq(share(100, -50, 150), 0.5, share(80, -50, 150), 0.5));
		away.kickWith(s, 0);
		away.update(100);
		away.kickWith(s, 100);
		expect(away.velocity('pitch')).toBe(80);
		// Coming back down (velocity −12.5): the old velocity is erased, not added to.
		const erased = new ViewKick(seq(share(100, -50, 150), 0.5, share(40, -50, 150), 0.5));
		erased.kickWith(s, 0);
		erased.update(300);
		expect(erased.velocity('pitch')).toBeCloseTo(-12.5, 9);
		erased.kickWith(s, 300);
		expect(erased.velocity('pitch')).toBe(40);
		// A kick down while above the aim point: one-sixteenth.
		const back = new ViewKick(seq(share(100, -50, 150), 0.5, share(-48, -50, 150), 0.5));
		back.kickWith(s, 0);
		back.update(100);
		back.kickWith(s, 100);
		expect(back.velocity('pitch')).toBeCloseTo(-3, 9);
		// From the aim point any direction is away: used in full.
		const rest = kicked(s, -48, 0);
		expect(rest.velocity('pitch')).toBeCloseTo(-48, 9);
	});

	it('never deflects more than 10° on an axis: the bound stops the axis, which then recovers', () => {
		const s = set({ pitchMax: 400, yawMax: 400, centerSpeed: 1000 });
		const k = kicked(s, 300, 0);
		// Free, it would peak at 300² / 2000 = 45°.
		const hit = (300 - Math.sqrt(300 ** 2 - 2 * 1000 * VIEW_KICK_BOUND)) / 1000;
		let top = 0;
		for (let t = 1; t < 200; t++) {
			k.update(t);
			top = Math.max(top, k.up);
			expect(k.up).toBeLessThanOrEqual(VIEW_KICK_BOUND);
		}
		expect(top).toBeGreaterThan(VIEW_KICK_BOUND - 1e-4);
		const at = kicked(s, 300, 0);
		at.update(hit * 1000 + 1e-6);
		expect(at.up).toBe(VIEW_KICK_BOUND);
		expect(at.velocity('pitch')).toBeCloseTo(-62.5 * 1e-9, 6);
		// Another kick outward on the bound: no velocity, recovery goes on.
		const again = new ViewKick(seq(share(300, -50, 400), 0.5, share(300, -50, 400), 0.5));
		again.kickWith(s, 0);
		again.update(hit * 1000);
		expect(again.up).toBeCloseTo(VIEW_KICK_BOUND, 9);
		again.kickWith(s, hit * 1000);
		expect(again.velocity('pitch')).toBeLessThanOrEqual(0);
		again.update(60);
		expect(again.up).toBeLessThan(VIEW_KICK_BOUND);
	});

	it('yaw rolls the view: half the yaw velocity, counter-clockwise for a left kick, back at the yaw rate, bounded on its own', () => {
		const s = set({ yawMin: -400, yawMax: 400, centerSpeed: 1000 });
		const left = kicked(s, 0, 100);
		expect(VIEW_KICK_ROLL).toBe(0.5);
		expect(left.velocity('roll')).toBeCloseTo(50, 9);
		left.update(25);
		expect(left.roll).toBeCloseTo(50 * 0.025 - 500 * 0.025 ** 2, 9);
		expect(left.roll).toBeGreaterThan(0);
		const right = kicked(s, 0, -100);
		right.update(25);
		expect(right.roll).toBeLessThan(0);
		// Off-centre, a yaw kick back is cut to one-sixteenth, and the roll gets half of what the yaw got.
		const toward = new ViewKick(seq(0.5, share(100, -400, 400), 0.5, share(-80, -400, 400)));
		toward.kickWith(s, 0);
		toward.update(30);
		toward.kickWith(s, 30);
		expect(toward.velocity('yaw')).toBeCloseTo(-80 / 16, 9);
		expect(toward.velocity('roll')).toBeCloseTo(-80 / 32, 9);
		// On the yaw bound a kick outward gives the yaw nothing, so the roll gets nothing either.
		const pinned = new ViewKick(seq(0.5, share(300, -400, 400), 0.5, share(300, -400, 400)));
		pinned.kickWith(s, 0);
		const pinAt = ((300 - Math.sqrt(300 ** 2 - 2000 * VIEW_KICK_BOUND)) / 1000) * 1000;
		pinned.update(pinAt);
		expect(pinned.yaw).toBeCloseTo(VIEW_KICK_BOUND, 9);
		expect(pinned.roll).toBeLessThan(VIEW_KICK_BOUND);
		pinned.kickWith(s, pinAt);
		expect(pinned.velocity('yaw')).toBe(0);
		expect(pinned.velocity('roll')).toBe(0);
		// A big kick: yaw hits its bound first, the roll keeps rolling to its own.
		const big = kicked(s, 0, 300);
		const yawHit = (300 - Math.sqrt(300 ** 2 - 2000 * VIEW_KICK_BOUND)) / 1000;
		const rollHit = (150 - Math.sqrt(150 ** 2 - 2000 * VIEW_KICK_BOUND)) / 1000;
		big.update(yawHit * 1000 + 1e-6);
		expect(big.yaw).toBeCloseTo(VIEW_KICK_BOUND, 9);
		expect(big.velocity('yaw')).toBeLessThanOrEqual(0);
		expect(big.roll).toBeLessThan(VIEW_KICK_BOUND);
		big.update(rollHit * 1000 + 1e-6);
		expect(big.roll).toBeCloseTo(VIEW_KICK_BOUND, 9);
		// From the bound both take the same time back: the same rate.
		const back = Math.sqrt((2 * VIEW_KICK_BOUND) / (1000 * VIEW_KICK_RETURN));
		const yawBack = (yawHit + back) * 1000;
		const rollBack = (rollHit + back) * 1000;
		big.update(yawBack - 0.5);
		expect(big.yaw).toBeGreaterThan(0);
		big.update(yawBack + 0.5);
		expect(big.yaw).toBe(0);
		big.update(rollBack - 0.5);
		expect(big.roll).toBeGreaterThan(0);
		big.update(rollBack + 0.5);
		expect(big.roll).toBe(0);
	});

	it('first shots of a trigger pull kick less where a set asks for it', () => {
		const s = set({ reducedShots: 1, reducedPercent: 60 });
		const k = new ViewKick(() => 1);
		k.kickWith(s, 0, 0);
		expect(k.velocity('pitch')).toBeCloseTo(150 * 0.4, 9);
		expect(k.velocity('yaw')).toBeCloseTo(100 * 0.4, 9);
		k.reset();
		k.kickWith(s, 1000, 1);
		expect(k.velocity('pitch')).toBeCloseTo(150, 9);
		// None of the calibrated guns has it.
		for (const w of GUNS) expect(RECOIL[w]!.hip.reducedShots, w).toBe(0);
	});

	it('gives the same offsets whatever the update step', () => {
		for (const w of ['smg', 'lmg', 'pistol'] as const) {
			const coarse = new ViewKick(seeded(3));
			const fine = new ViewKick(seeded(3));
			const gap = WEAPONS[w].fireMs;
			for (let i = 0; i < 15; i++) {
				coarse.kick(w, i * gap, false, i);
				fine.kick(w, i * gap, false, i);
				for (let t = i * gap; t < (i + 1) * gap; t += 0.7) fine.update(t);
			}
			for (const t of [15 * gap + 10, 15 * gap + 90, 15 * gap + 400, 4000]) {
				coarse.update(t);
				for (let u = t - 50; u <= t; u += 1.3) fine.update(u);
				fine.update(t);
				expect(fine.up, w).toBeCloseTo(coarse.up, 9);
				expect(fine.yaw).toBeCloseTo(coarse.yaw, 9);
				expect(fine.roll).toBeCloseTo(coarse.roll, 9);
			}
			expect(coarse.resting).toBe(true);
		}
	});

	it('recoilRestMs bounds the time back to rest after one shot; reset drops the offset at once', () => {
		for (const w of GUNS) {
			for (const scoped of [false, true]) {
				const d = RECOIL[w]!;
				for (const r of [0, 1]) {
					const k = new ViewKick(() => r);
					k.kick(w, 0, scoped);
					k.update(recoilRestMs(d, scoped) + 1e-6);
					expect(k.resting, `${w} ${scoped} ${r}`).toBe(true);
				}
			}
		}
		const k = new ViewKick(seeded(1));
		for (let i = 0; i < 6; i++) k.kick('lmg', i * 80);
		k.update(500);
		expect(k.resting).toBe(false);
		k.reset();
		expect(k.resting).toBe(true);
		expect(k.pitch).toBe(0);
	});
});

describe('on-screen calibration (G1b)', () => {
	it('screenScale makes a small angle cover the same share of the picture at another FOV', () => {
		expect(screenScale(90, 90)).toBe(1);
		expect(screenScale(55, 90)).toBeCloseTo(1 / Math.tan((27.5 * Math.PI) / 180), 12);
		for (const [from, to] of [
			[55, 90],
			[65, 90],
			[15, 40],
			[15, 38],
			[90, 55]
		] as const) {
			expect(screenShare(0.01 * screenScale(from, to), to)).toBeCloseTo(screenShare(0.01, from), 7);
		}
		// Pixels at 1080p: the share times half the picture height (spreadGapPx).
		expect(spreadGapPx(1, 90, 1080)).toBeCloseTo((540 * Math.tan(Math.PI / 180)) / 0.75, 9);
		const c = convertKick({ pitchMin: 10, pitchMax: 20, yawMin: -5, yawMax: 5, centerSpeed: 100, reducedShots: 2, reducedPercent: 50 }, 55, 90);
		const f = screenScale(55, 90);
		expect(c).toEqual({ pitchMin: 10 * f, pitchMax: 20 * f, yawMin: -5 * f, yawMax: 5 * f, centerSpeed: 100 * f, reducedShots: 2, reducedPercent: 50 });
	});

	/** Peak (degrees) of one shot from rest with pitch velocity `v`, run through the model. */
	const peak = (s: ViewKickSet, v: number) => {
		const k = new ViewKick(seq(share(v, s.pitchMin, s.pitchMax), share(0, s.yawMin, s.yawMax)));
		k.kickWith(s, 0);
		let top = 0;
		for (let t = 0; t <= 600; t += 0.25) {
			k.update(t);
			top = Math.max(top, Math.abs(k.up));
		}
		return top;
	};

	it('one shot moves the picture as far as the source shot does aimed (2%), or to the 10° bound', () => {
		for (const w of GUNS) {
			const src = RECOIL_SOURCE[w]!;
			const zoom = WEAPONS[w].zoomFov;
			const fov = zoom ?? RECOIL_REF_FOV;
			const s = kickSet(RECOIL[w]!, zoom !== null);
			const k = screenScale(src.fov, fov);
			for (const share of [0.5, 1]) {
				const vSrc = src.pitchMin + (src.pitchMax - src.pitchMin) * share;
				const srcPeak = (vSrc * vSrc) / (2 * src.centerSpeed);
				const ours = peak(s, vSrc * k);
				if (srcPeak * k >= VIEW_KICK_BOUND) {
					expect(ours, `${w} ${share} bound`).toBeCloseTo(VIEW_KICK_BOUND, 4);
					continue;
				}
				const want = screenShare(srcPeak, src.fov);
				expect(Math.abs(screenShare(ours, fov) / want - 1), `${w} ${share}`).toBeLessThan(0.02);
			}
		}
	});

	it('the calibration reads a constant FOV: the fov cvar never scales the kick', () => {
		expect(RECOIL_REF_FOV).toBe(90);
		for (const w of ['pistol', 'smg', 'lmg', 'striker'] as const) {
			const src = RECOIL_SOURCE[w]!;
			expect(RECOIL[w]!.hip.pitchMax).toBeCloseTo(src.pitchMax * screenScale(src.fov, 90), 9);
		}
		// Rifles: hip fire takes the scoped set's degrees.
		for (const w of ['sniper', 'barrett'] as const) expect(RECOIL[w]!.hip).toEqual(RECOIL[w]!.scoped);
	});
});
