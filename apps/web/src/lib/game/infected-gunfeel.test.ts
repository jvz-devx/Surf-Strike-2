/** Gun feel helpers (gunfeel.ts): spread, scope, crosshair gap, knockback, viewmodel curves. */
import { INF_PRESETS, INF_SECONDARY, INF_STEADY_SPREAD_FACTOR, WEAPONS, type WeaponId } from '@surf/shared';
import { describe, expect, it } from 'vitest';
import { verticalFovFromHorizontal43 } from '../render/fov.js';
import {
	addKnockback,
	aimSpread,
	Bloom,
	ease,
	kickedPitch,
	hipSpread,
	KNOCKBACK_CAP,
	moveShare,
	SPREAD,
	spreadGapPx,
	vmBump,
	vmDraw,
	vmKick,
	VmSway,
	zoomFov,
	zoomSensitivity,
	type AimInput
} from './gunfeel.js';

/** Every gun of the mode: the round presets and the pistol. */
const GUNS: readonly WeaponId[] = [...INF_PRESETS, INF_SECONDARY];

const still = (over: Partial<AimInput> = {}): AimInput => ({ bloom: 0, aim: 0, speed: 0, onGround: true, ducked: false, factor: 1, ...over });

describe('view kick helpers (G1)', () => {
	// The view-kick model and its calibration: infected-viewkick.test.ts; the gun kick: infected-gunkick.test.ts.
	it('kickedPitch stays inside the pitch range', () => {
		expect(kickedPitch(10, -3)).toBe(7);
		expect(kickedPitch(-88, -5)).toBe(-89);
		expect(kickedPitch(88, 5)).toBe(89);
	});
});

describe('hip cone (G2)', () => {
	it('first shot standing at rest is the cone minimum; melee has none', () => {
		for (const w of [...GUNS, 'sniper'] as const) expect(aimSpread(w, still()), w).toBeCloseTo(SPREAD[w]!.min, 9);
		expect(aimSpread('knife', still({ speed: 300, onGround: false }))).toBe(0);
		expect(aimSpread('claws', still())).toBe(0);
	});

	it('matches the documented table: standing, crouched, running, airborne, sustained', () => {
		const row = (w: WeaponId) => [
			aimSpread(w, still()),
			aimSpread(w, still({ ducked: true })),
			aimSpread(w, still({ speed: WEAPONS[w].moveSpeed })),
			aimSpread(w, still({ speed: WEAPONS[w].moveSpeed, onGround: false })),
			aimSpread(w, still({ bloom: 1 }))
		];
		const table: Array<[WeaponId, number[]]> = [
			['pistol', [3, 2.5, 6, 6, 6]],
			['smg', [3, 2, 5, 5, 5]],
			['lmg', [4, 3.5, 10, 10, 10]],
			// The shotgun's pellet cone (4°, the server's) comes on top.
			['striker', [1, 1, 1, 1, 1]],
			['sniper', [10, 9.5, 15, 15, 15]],
			['barrett', [10, 9.5, 15, 15, 15]]
		];
		for (const [w, want] of table) row(w).forEach((v, i) => expect(v, `${w} ${i}`).toBeCloseTo(want[i]!, 6));
	});

	it('firing grows the cone from min to max, it holds while firing and shrinks back after', () => {
		for (const w of ['pistol', 'lmg', 'smg', 'barrett'] as const) {
			const f = SPREAD[w]!;
			const b = new Bloom();
			b.add(w, 0);
			expect(b.value).toBeCloseTo(f.fire, 9);
			expect(aimSpread(w, still({ bloom: b.value }))).toBeCloseTo(f.min + (f.max - f.min) * f.fire, 9);
			let t = 0;
			for (let i = 1; i < 40; i++) {
				t = i * WEAPONS[w].fireMs;
				b.add(w, t);
				expect(b.value).toBeLessThanOrEqual(1 + 1e-9);
			}
			// Sustained fire at the gun's own rate reaches the maximum.
			expect(b.value).toBeCloseTo(1, 9);
			expect(aimSpread(w, still({ bloom: b.value }))).toBeCloseTo(f.max, 9);
			b.update(t + f.holdMs);
			expect(b.value).toBeCloseTo(1, 9);
			b.update(t + f.holdMs + 100);
			expect(b.value).toBeCloseTo(1 - f.recover * 0.1, 9);
			b.update(t + 5000);
			expect(b.value).toBe(0);
		}
		// The bolt action grows halfway per shot and is back at rest before the bolt has cycled.
		const bolt = new Bloom();
		bolt.add('sniper', 0);
		expect(bolt.value).toBe(0.5);
		bolt.update(WEAPONS.sniper.fireMs);
		expect(bolt.value).toBe(0);
		// Spaced taps give the cone time to shrink in between.
		const taps = new Bloom();
		for (let i = 0; i < 10; i++) taps.add('pistol', i * 600);
		expect(taps.value).toBeCloseTo(SPREAD.pistol!.fire, 9);
		// The shotgun's cone does not grow; melee has none.
		const none = new Bloom();
		for (const w of ['striker', 'knife'] as const) none.add(w, 0);
		expect(none.value).toBe(0);
	});

	it('movement grows it to the maximum at run speed, airborne is the maximum; crouched it starts lower', () => {
		for (const w of GUNS) {
			const f = SPREAD[w]!;
			const run = WEAPONS[w].moveSpeed;
			const base = aimSpread(w, still());
			expect(aimSpread(w, still({ speed: run * 0.1 })), w).toBe(base);
			if (f.max > f.min) expect(aimSpread(w, still({ speed: run * 0.6 }))).toBeGreaterThan(base);
			expect(aimSpread(w, still({ speed: run }))).toBeCloseTo(f.max, 9);
			expect(aimSpread(w, still({ speed: run * 3 }))).toBeCloseTo(f.max, 9);
			expect(aimSpread(w, still({ onGround: false }))).toBeCloseTo(f.max, 9);
			// Firing and moving add up, but never past the maximum.
			expect(aimSpread(w, still({ speed: run * 0.6, bloom: 0.8 }))).toBeCloseTo(f.max, 9);
			expect(aimSpread(w, still({ ducked: true }))).toBeCloseTo(f.duckMin, 9);
			expect(aimSpread(w, still({ ducked: true, speed: run }))).toBeCloseTo(f.duckMax, 9);
			expect(f.duckMin).toBeLessThanOrEqual(f.min);
			expect(f.duckMax).toBeLessThanOrEqual(f.max);
			// A crouch jump gets no duck bonus.
			expect(aimSpread(w, still({ ducked: true, onGround: false }))).toBeCloseTo(f.max, 9);
		}
		expect(moveShare(0, 200)).toBe(0);
		expect(moveShare(200, 200)).toBe(1);
		expect(moveShare(100, 0)).toBe(0);
	});

	it('Steady Aim halves the hip cone', () => {
		const a = still({ bloom: 0.3, speed: 100 });
		for (const w of GUNS) {
			expect(hipSpread(w, { ...a, factor: INF_STEADY_SPREAD_FACTOR })).toBeCloseTo(hipSpread(w, a) * INF_STEADY_SPREAD_FACTOR, 9);
			expect(aimSpread(w, { ...a, factor: INF_STEADY_SPREAD_FACTOR })).toBeCloseTo(aimSpread(w, a) * INF_STEADY_SPREAD_FACTOR, 9);
		}
		expect(INF_STEADY_SPREAD_FACTOR).toBe(0.5);
	});

	it('aimed: the cone shrinks with the aim progress and is gone fully aimed, whatever the movement', () => {
		for (const w of GUNS) {
			for (const a of [still(), still({ speed: 300 }), still({ onGround: false }), still({ bloom: 1, ducked: true })]) {
				const hip = hipSpread(w, a);
				expect(aimSpread(w, { ...a, aim: 0 }), w).toBe(hip);
				expect(aimSpread(w, { ...a, aim: 0.25 }), w).toBeCloseTo(hip * 0.75, 9);
				expect(aimSpread(w, { ...a, aim: 0.5 }), w).toBeCloseTo(hip * 0.5, 9);
				expect(aimSpread(w, { ...a, aim: 1 }), w).toBe(0);
				// The crosshair keeps showing the hip cone.
				expect(hipSpread(w, { ...a, aim: 1 }), w).toBe(hip);
			}
		}
	});
});

describe('zoom (G4)', () => {
	it('ease is a smoothstep', () => {
		expect(ease(0)).toBe(0);
		expect(ease(0.5)).toBe(0.5);
		expect(ease(1)).toBe(1);
		expect(ease(2)).toBe(1);
		expect(ease(0.25)).toBeLessThan(0.25);
	});

	it('eases the FOV between the cvar FOV and the scope FOV', () => {
		expect(zoomFov(90, 38, 0)).toBeCloseTo(90, 9);
		expect(zoomFov(90, 38, 1)).toBeCloseTo(38, 9);
		const mid = zoomFov(90, 38, 0.5);
		expect(mid).toBeGreaterThan(38);
		expect(mid).toBeLessThan(90);
		// Even in tan(fov / 2): the magnification changes at a steady rate.
		const tan = (d: number) => Math.tan((d * Math.PI) / 360);
		expect(tan(mid)).toBeCloseTo((tan(90) + tan(38)) / 2, 9);
		expect(zoomFov(90, 38, 5)).toBeCloseTo(38, 9);
	});

	it('scales the sensitivity by ratio × tan(zoomFov / 2) / tan(fov / 2)', () => {
		const tan = (d: number) => Math.tan((d * Math.PI) / 360);
		expect(zoomSensitivity(90, 90, 1, 0)).toBeCloseTo(1, 9);
		expect(zoomSensitivity(90, 38, 1, 1)).toBeCloseTo(tan(38) / tan(90), 9);
		expect(zoomSensitivity(90, 38, 1, 1)).toBeCloseTo(0.3443, 4);
		expect(zoomSensitivity(90, 38, 1.5, 1)).toBeCloseTo((1.5 * tan(38)) / tan(90), 9);
		expect(zoomSensitivity(106, 40, 0.8, 1)).toBeCloseTo((0.8 * tan(40)) / tan(106), 9);
		// Unzoomed the ratio does nothing; half-way it is half applied to the current FOV.
		expect(zoomSensitivity(90, 90, 2, 0)).toBeCloseTo(1, 9);
		const half = zoomFov(90, 38, 0.5);
		expect(zoomSensitivity(90, half, 2, 0.5)).toBeCloseTo((1.5 * tan(half)) / tan(90), 9);
		// The same ratio in vertical FOV terms (the 4:3 convention scales both tangents alike).
		expect(tan(verticalFovFromHorizontal43(38)) / tan(verticalFovFromHorizontal43(90))).toBeCloseTo(zoomSensitivity(90, 38, 1, 1), 9);
	});
});

describe('crosshair spread gap (G3)', () => {
	it('converts degrees to pixels from the FOV and the viewport height', () => {
		expect(spreadGapPx(0, 90, 1080)).toBe(0);
		expect(spreadGapPx(-1, 90, 1080)).toBe(0);
		expect(spreadGapPx(1, 90, 0)).toBe(0);
		// fov 90 at 4:3 is 73.74° vertical: tan(half) = 0.75.
		expect(spreadGapPx(1, 90, 1080)).toBeCloseTo((Math.tan(Math.PI / 180) / 0.75) * 540, 9);
		expect(spreadGapPx(1, 90, 1080)).toBeCloseTo(12.57, 2);
		// Twice the viewport, twice the pixels; a wider FOV shrinks the gap.
		expect(spreadGapPx(1, 90, 2160)).toBeCloseTo(2 * spreadGapPx(1, 90, 1080), 9);
		expect(spreadGapPx(1, 110, 1080)).toBeLessThan(spreadGapPx(1, 90, 1080));
		// The edge of the vertical FOV is the edge of the screen.
		expect(spreadGapPx(verticalFovFromHorizontal43(90) / 2, 90, 1080)).toBeCloseTo(540, 6);
	});
});

describe('knockback (G8)', () => {
	it('adds the push to the velocity instead of replacing it', () => {
		const v = { x: -265, y: 30 };
		addKnockback(v, 40, 0);
		expect(v).toEqual({ x: -225, y: 30 });
		// The sideways part is never touched, whatever the direction.
		const w = { x: 0, y: 200 };
		addKnockback(w, 80, 0);
		expect(w).toEqual({ x: 80, y: 200 });
		const d = { x: 10, y: 10 };
		addKnockback(d, 30, 40);
		expect(d.x).toBeCloseTo(40, 9);
		expect(d.y).toBeCloseTo(50, 9);
	});

	it('caps the speed along the push direction', () => {
		const v = { x: 0, y: 0 };
		for (let i = 0; i < 20; i++) addKnockback(v, 140, 0);
		expect(v).toEqual({ x: KNOCKBACK_CAP, y: 0 });
		// Already faster that way: left alone (a hit from behind is no boost).
		const fast = { x: 500, y: -20 };
		addKnockback(fast, 200, 0);
		expect(fast).toEqual({ x: 500, y: -20 });
		// Only what is missing up to the cap.
		const near = { x: 280, y: 0 };
		addKnockback(near, 100, 0);
		expect(near.x).toBeCloseTo(300, 9);
		const own = { x: 0, y: 0 };
		addKnockback(own, 0, -500, 120);
		expect(own).toEqual({ x: 0, y: -120 });
	});

	it('ignores empty and broken pushes', () => {
		const v = { x: 12, y: -7 };
		addKnockback(v, 0, 0);
		addKnockback(v, NaN, 5);
		addKnockback(v, Infinity, 0);
		expect(v).toEqual({ x: 12, y: -7 });
	});
});

describe('viewmodel curves (G5)', () => {
	it('kick: fast attack, damped return, back at rest at the end', () => {
		expect(vmKick(-1, 20, 200)).toBe(0);
		expect(vmKick(0, 20, 200)).toBe(0);
		expect(vmKick(10, 20, 200)).toBeCloseTo(0.75, 9);
		expect(vmKick(20, 20, 200)).toBeCloseTo(1, 9);
		expect(vmKick(200, 20, 200)).toBe(0);
		expect(vmKick(199.99, 20, 200)).toBeCloseTo(0, 3);
		// The return falls monotonically and has spent most of the kick by half-time.
		let prev = 1;
		for (let t = 21; t < 200; t += 1) {
			const k = vmKick(t, 20, 200);
			expect(k).toBeLessThanOrEqual(prev + 1e-12);
			expect(k).toBeGreaterThanOrEqual(0);
			prev = k;
		}
		expect(vmKick(110, 20, 200)).toBeLessThan(0.25);
		// A re-kick starts from where the gun is: no snap back to rest.
		expect(vmKick(0, 20, 200, 0.6)).toBeCloseTo(0.6, 9);
		expect(vmKick(20, 20, 200, 0.6)).toBeCloseTo(1, 9);
	});

	it('draw: starts out of view, comes up with a small overshoot and ends at rest', () => {
		expect(vmDraw(0)).toBe(1);
		expect(vmDraw(-0.5)).toBe(1);
		expect(vmDraw(1)).toBe(0);
		expect(vmDraw(2)).toBe(0);
		expect(vmDraw(0.001)).toBeCloseTo(1, 1);
		expect(vmDraw(0.3)).toBeLessThan(0.5);
		let min = 1;
		for (let p = 0; p <= 1; p += 0.01) min = Math.min(min, vmDraw(p));
		expect(min).toBeLessThan(0);
		expect(min).toBeGreaterThan(-0.15);
	});

	it('bump: quick up, slow back (landing dip, dry-fire nudge)', () => {
		expect(vmBump(0)).toBe(0);
		expect(vmBump(1)).toBe(0);
		expect(vmBump(0.25)).toBeCloseTo(1, 9);
		expect(vmBump(0.6)).toBeGreaterThan(0);
		expect(vmBump(0.6)).toBeLessThan(vmBump(0.25));
	});

	it('sway: the gun trails a turn and a strafe and settles back', () => {
		const s = new VmSway();
		// Turning left (yaw rising): the gun is left behind on the right.
		for (let i = 0; i < 30; i++) s.update(16, 300, 0, 0, 0);
		expect(s.x).toBeGreaterThan(0.5);
		expect(s.yaw).toBeLessThan(0);
		for (let i = 0; i < 60; i++) s.update(16, 0, 0, 0, 0);
		expect(Math.abs(s.x)).toBeLessThan(0.01);
		// Strafing right leans it; rising leaves it low; looking down leaves it high.
		for (let i = 0; i < 30; i++) s.update(16, 0, 0, 250, 0);
		expect(s.x).toBeLessThan(-0.3);
		expect(s.roll).toBeLessThan(0);
		s.reset();
		for (let i = 0; i < 30; i++) s.update(16, 0, 0, 0, 300);
		expect(s.y).toBeLessThan(-0.3);
		s.reset();
		for (let i = 0; i < 30; i++) s.update(16, 0, 200, 0, 0);
		expect(s.y).toBeGreaterThan(0.2);
		// Bounded however hard the mouse is flicked; a zero step changes nothing.
		for (let i = 0; i < 100; i++) s.update(16, 1e6, -1e6, 1e6, -1e6);
		expect(Math.abs(s.x)).toBeLessThanOrEqual(1.25);
		expect(Math.abs(s.y)).toBeLessThanOrEqual(1.2);
		const x = s.x;
		s.update(0, -500, 0, 0, 0);
		expect(s.x).toBe(x);
	});
});
