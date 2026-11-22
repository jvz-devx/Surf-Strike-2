import { describe, expect, it } from 'vitest';
import type { CollisionWorld } from '../collision/api.ts';
import { buildCollisionWorld } from '../collision/world.ts';
import { BHOP_CVARS, MAX_VELOCITY_HARD, SURF_CVARS, type Cvars } from '../cvars.ts';

/** CS2's modern jump (vanilla / SharpTimer bhop cfg); the shipped profiles use the legacy jump. */
const MODERN_CVARS: Cvars = { ...BHOP_CVARS, sv_legacy_jump: 0 };
import type { BrushDef } from '../maps/types.ts';
import type { Vec3 } from '../types.ts';
import { TICK_INTERVAL, TICK_RATE } from '../units.ts';
import { DUCK_HULL_MAX, HULL_MAX, IN_DUCK, IN_JUMP, type PlayerState, type SubtickMove, type UserCmd } from './api.ts';
import { createPlayer, eyeHeight, playerMaxs, playerMove } from './gamemovement.ts';

const TICK = TICK_INTERVAL;
const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
const box = (min: Vec3, max: Vec3): BrushDef => ({ type: 'box', min, max, material: 'm' });
const FLOOR = box(v3(-20000, -20000, -64), v3(20000, 20000, 0));
const cmd = (c: Partial<UserCmd> = {}): UserCmd => ({ pitch: 0, yaw: 0, forwardmove: 0, sidemove: 0, buttons: 0, ...c });
const sub = (when: number, buttons = 0, forwardmove = 0, sidemove = 0): SubtickMove => ({ when, buttons, forwardmove, sidemove });
const hspeed = (p: PlayerState) => Math.hypot(p.velocity.x, p.velocity.y);
const yawOf = (p: PlayerState) => (Math.atan2(p.velocity.y, p.velocity.x) * 180) / Math.PI;
const world = (...brushes: BrushDef[]): CollisionWorld => buildCollisionWorld({ brushes });
const clone = (p: PlayerState): PlayerState => structuredClone(p);

/** Spawn on the floor and let the player land/settle. */
function settled(w: CollisionWorld, origin: Vec3, cvars: Cvars = SURF_CVARS): PlayerState {
	const p = createPlayer(origin);
	for (let i = 0; i < 16; i++) playerMove(w, p, cmd(), cvars);
	expect(p.onGround).toBe(true);
	return p;
}

describe('gamemovement (CS2, 64 tick)', () => {
	it('runs at 64 tick', () => {
		expect(TICK_RATE).toBe(64);
		expect(TICK).toBe(0.015625);
	});

	it('runs forward on flat ground and settles at 250 u/s (sv_accelerate 6.5, sv_friction 5.2)', () => {
		const w = world(FLOOR);
		const p = settled(w, v3(0, 0, 1));
		const speeds: number[] = [];
		for (let i = 0; i < 128; i++) {
			playerMove(w, p, cmd({ forwardmove: 450 }), SURF_CVARS);
			speeds.push(hspeed(p));
		}
		const t90 = speeds.findIndex((s) => s >= 225);
		console.log(`run: speed after 1 tick ${speeds[0]!.toFixed(2)}, after 0.25s ${speeds[15]!.toFixed(2)}, 90% at tick ${t90 + 1}, after 2s ${speeds[127]!.toFixed(4)}`);
		expect(p.onGround).toBe(true);
		expect(speeds[127]).toBeCloseTo(250, 6);
		expect(Math.max(...speeds)).toBeLessThanOrEqual(250 + 1e-9);
		expect(p.origin.z).toBeGreaterThan(0);
		expect(p.origin.z).toBeLessThan(0.07);
		// Stops again via friction.
		let stopTick = -1;
		for (let i = 0; i < 64; i++) {
			playerMove(w, p, cmd(), SURF_CVARS);
			if (stopTick < 0 && hspeed(p) === 0) stopTick = i;
		}
		console.log(`run: stops from 250 in ${stopTick + 1} ticks`);
		expect(hspeed(p)).toBe(0);
	});

	function jumpApex(duck: 'none' | 'air' | 'ground', cvars: Cvars = SURF_CVARS) {
		const w = world(FLOOR);
		const p = settled(w, v3(0, 0, 1), cvars);
		if (duck === 'ground') for (let i = 0; i < 64; i++) playerMove(w, p, cmd({ buttons: IN_DUCK }), cvars);
		const z0 = p.origin.z;
		let apex = z0;
		let airTicks = 0;
		let jumpedTicks = 0;
		for (let i = 0; i < 200; i++) {
			const buttons = (i === 0 ? IN_JUMP : 0) | ((duck === 'air' && i > 0) || duck === 'ground' ? IN_DUCK : 0);
			playerMove(w, p, cmd({ buttons }), cvars);
			if (p.jumped) jumpedTicks++;
			apex = Math.max(apex, p.origin.z);
			if (!p.onGround) airTicks++;
			else if (i > 0) break;
		}
		return { apex: apex - z0, airTicks, jumpedTicks, p };
	}

	it('standing jump apex is about 55.8 units (CS2), lands at ~300 u/s', () => {
		const r = jumpApex('none');
		console.log(`standing jump apex ${r.apex.toFixed(3)}, air ${r.airTicks} ticks, landed at ${r.p.landedSpeed.toFixed(1)} u/s`);
		expect(r.jumpedTicks).toBe(1);
		expect(r.apex).toBeGreaterThan(55.5);
		expect(r.apex).toBeLessThan(56);
		expect(r.p.landedSpeed).toBeGreaterThan(280);
		const m = jumpApex('none', MODERN_CVARS);
		console.log(`standing jump apex (modern jump, bhop cvars) ${m.apex.toFixed(3)}`);
		expect(m.apex).toBeCloseTo(r.apex, 6);
	});

	it('crouch jump (duck in the air) apex = standing + 9; ducked jump uses the full impulse', () => {
		const stand = jumpApex('none').apex;
		const r = jumpApex('air');
		const g = jumpApex('ground');
		console.log(`crouch jump apex ${r.apex.toFixed(3)} (standing ${stand.toFixed(3)}), jump while ducked ${g.apex.toFixed(3)}`);
		expect(r.apex - stand).toBeCloseTo(9, 6);
		expect(r.p.ducked).toBe(true);
		expect(g.apex).toBeGreaterThan(stand);
		expect(g.apex).toBeLessThan(57.1);
	});

	it('air strafe with perfect sync for 1 s gains speed above 250 (sv_airaccelerate 150)', () => {
		const w = world();
		const p = createPlayer(v3(0, 0, 10000));
		p.velocity.x = 250;
		let last = hspeed(p);
		for (let i = 0; i < 64; i++) {
			// Wish direction = right vector of the velocity yaw: perpendicular to velocity, the optimum
			// when air accel (150*250/64) exceeds the 30 u/s cap.
			playerMove(w, p, cmd({ yaw: yawOf(p), sidemove: 450 }), SURF_CVARS);
			const s = hspeed(p);
			expect(s).toBeGreaterThan(last);
			last = s;
		}
		console.log(`air strafe 1s: ${last.toFixed(2)} u/s`);
		// Each tick adds the full 30 u/s at right angles: sqrt(250² + 64·30²) ≈ 346.6 at 64 tick.
		expect(last).toBeCloseTo(Math.sqrt(250 * 250 + 64 * 900), 0);
	});

	it('deadstrafe: air accel is ×0.25 while rising at 0 < vz <= 140, full otherwise', () => {
		const w = world();
		// Low air accel so the 30 u/s cap does not hide the factor.
		const cv: Cvars = { ...SURF_CVARS, sv_airaccelerate: 1 };
		const gain = (vz: number) => {
			const p = createPlayer(v3(0, 0, 10000));
			p.velocity = v3(0, 0, vz);
			playerMove(w, p, cmd(), cv); // categorize sets the surface friction for the next tick
			const sf = p.surfaceFriction;
			const vy = p.velocity.y;
			playerMove(w, p, cmd({ sidemove: -450 }), cv); // yaw 0: left = +Y
			return { sf, dv: p.velocity.y - vy };
		};
		const full = 1 * 250 * TICK;
		const rising = gain(100);
		const fast = gain(300);
		const falling = gain(-50);
		console.log(`deadstrafe: dv rising ${rising.dv.toFixed(4)} fast ${fast.dv.toFixed(4)} falling ${falling.dv.toFixed(4)}`);
		expect(rising.sf).toBe(0.25);
		expect(rising.dv).toBeCloseTo(full * 0.25, 9);
		expect(fast.sf).toBe(1);
		expect(fast.dv).toBeCloseTo(full, 9);
		expect(falling.dv).toBeCloseTo(full, 9);
	});

	// A ramp along X with its peak at z=0, slope angle `deg` on both sides (left slope descends to +Y).
	const slopeWorld = (deg: number) =>
		world({ type: 'ramp', from: v3(-5000, 0, 0), to: v3(5000, 0, 0), height: 2000 * Math.tan((deg * Math.PI) / 180), halfWidth: 2000, side: 'both', material: 'm' });
	const slopeNormal = (deg: number) => v3(0, Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180));
	/** Gap between the slope and the box's support corner (y - 16, z). */
	const slopeGap = (p: PlayerState, n: Vec3) => (p.origin.y - 16) * n.y + p.origin.z * n.z;

	it('no deadstrafe while touching a surf ramp (rising along it at 0 < vz <= 140)', () => {
		const deg = 60;
		const w = slopeWorld(deg);
		const n = slopeNormal(deg);
		const t = Math.tan((deg * Math.PI) / 180);
		const p = createPlayer(v3(0, 300, -(300 - 16) * t + 0.5));
		// Moving up the slope (−Y) with a small upward component, along the face.
		const along = v3(0, -n.z, n.y); // unit vector up the slope
		p.velocity = v3(500, along.y * 100, along.z * 100);
		playerMove(w, p, cmd(), SURF_CVARS);
		console.log(`surf rising: vz ${p.velocity.z.toFixed(2)} surfing ${p.surfing} surfaceFriction ${p.surfaceFriction}`);
		expect(p.surfing).toBe(true);
		expect(p.velocity.z).toBeGreaterThan(0);
		expect(p.velocity.z).toBeLessThanOrEqual(140);
		expect(p.surfaceFriction).toBe(1);
		expect(p.onGround).toBe(false);
	});

	it('a 45° slope (normal z 0.707 >= sv_standable_normal 0.7) is still walkable ground', () => {
		const w = slopeWorld(45);
		const p = createPlayer(v3(0, 300, -282));
		for (let i = 0; i < 16; i++) playerMove(w, p, cmd(), SURF_CVARS);
		expect(p.onGround).toBe(true);
		expect(p.groundNormalZ).toBeCloseTo(Math.SQRT1_2, 6);
	});

	for (const deg of [46, 60]) {
		it(`slides down a ${deg}° ramp without input: stays on it, speeds up, never grounded`, () => {
			const w = slopeWorld(deg);
			const n = slopeNormal(deg);
			const t = Math.tan((deg * Math.PI) / 180);
			const p = createPlayer(v3(0, 300, -(300 - 16) * t + 4));
			let contact = -1;
			let last = 0;
			for (let i = 0; i < 64; i++) {
				playerMove(w, p, cmd(), SURF_CVARS);
				expect(p.onGround).toBe(false);
				// Contact = first tick sliding down-slope (velocity already clipped by the face).
				if (contact < 0 && p.surfing && p.velocity.y > 0) contact = i;
				if (contact >= 0) {
					const gap = slopeGap(p, n);
					expect(gap).toBeGreaterThanOrEqual(0);
					expect(gap).toBeLessThan(2);
					expect(p.surfing).toBe(true);
					const s = Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z);
					expect(s).toBeGreaterThan(last);
					last = s;
				}
			}
			const ideal = 800 * Math.sin((deg * Math.PI) / 180) * (1 - contact / 64);
			console.log(`ramp ${deg}°: contact at tick ${contact}, speed after 1s ${last.toFixed(2)} u/s (frictionless ideal ~${ideal.toFixed(0)})`);
			expect(contact).toBeGreaterThanOrEqual(0);
			expect(contact).toBeLessThan(10);
			expect(last).toBeGreaterThan(0.9 * ideal);
			expect(p.velocity.x).toBe(0);
			expect(p.velocity.y).toBeGreaterThan(0);
		});
	}

	it('surf: strafing into a 60° ramp at 1000 u/s keeps the player on it and gains speed downhill', () => {
		const deg = 60;
		const w = slopeWorld(deg);
		const t = Math.tan((deg * Math.PI) / 180);
		const p = createPlayer(v3(0, 300, -(300 - 16) * t + 1));
		p.velocity = v3(1000, 0, 0);
		for (let i = 0; i < 128; i++) {
			// Hold "into the ramp" (−Y is up-slope = left when facing +X).
			playerMove(w, p, cmd({ yaw: 0, sidemove: -450 }), SURF_CVARS);
			expect(p.onGround).toBe(false);
		}
		const s = Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z);
		console.log(`surf 2s holding into a 60° ramp from 1000 u/s: speed ${s.toFixed(1)}, vx ${p.velocity.x.toFixed(1)}, surfing ${p.surfing}`);
		expect(p.surfing).toBe(true);
		expect(s).toBeGreaterThan(1000);
		expect(p.velocity.x).toBeGreaterThan(900);
	});

	it('hitting a ramp from above at speed clips velocity along the plane without stopping', () => {
		const deg = 55;
		const w = slopeWorld(deg);
		const n = slopeNormal(deg);
		const p = createPlayer(v3(0, 300, -150));
		p.velocity = v3(600, 200, -900);
		let hitTick = -1;
		for (let i = 0; i < 32; i++) {
			const pre = { ...p.velocity };
			playerMove(w, p, cmd(), SURF_CVARS);
			if (p.surfing && hitTick < 0) {
				hitTick = i;
				const vn = p.velocity.y * n.y + p.velocity.z * n.z;
				const clipped = v3(pre.x, pre.y - n.y * (pre.y * n.y + pre.z * n.z), pre.z - n.z * (pre.y * n.y + pre.z * n.z));
				console.log(`ramp impact tick ${i}: in ${JSON.stringify(pre)} out ${JSON.stringify(p.velocity)} v·n=${vn.toFixed(3)} ideal clip ${JSON.stringify(clipped)}`);
				expect(pre.z).toBeLessThan(-800);
				// Only the deferred half-step of gravity after the clip remains along -n.
				expect(Math.abs(vn)).toBeLessThan(8);
				expect(p.velocity.x).toBeCloseTo(600, 6);
				expect(Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z)).toBeGreaterThan(0.95 * Math.hypot(clipped.x, clipped.y, clipped.z));
			}
		}
		expect(hitTick).toBeGreaterThan(0);
		expect(p.onGround).toBe(false);
		expect(p.velocity.y).toBeGreaterThan(0); // sliding down the slope (+Y), still moving
		expect(slopeGap(p, n)).toBeLessThan(2);
	});

	function bhop(cvars: Cvars, hops: number) {
		const w = world(FLOOR);
		const p = settled(w, v3(0, 0, 1), cvars);
		p.velocity.x = 250;
		let jumps = 0;
		const landingSpeeds: number[] = [];
		const apexes: number[] = [];
		let apex = 0;
		let prev = hspeed(p);
		let minDelta = Infinity;
		for (let i = 0; i < 4000 && jumps < hops; i++) {
			const wasAir = !p.onGround;
			playerMove(w, p, cmd({ yaw: yawOf(p), sidemove: 450, buttons: IN_JUMP }), cvars);
			const s = hspeed(p);
			apex = Math.max(apex, p.origin.z);
			if (p.jumped) {
				jumps++;
				if (jumps > 1) apexes.push(apex);
				apex = 0;
			}
			if (wasAir && p.onGround) landingSpeeds.push(s);
			minDelta = Math.min(minDelta, s - prev);
			prev = s;
		}
		return { jumps, landingSpeeds, apexes, final: prev, minDelta };
	}

	it('modern jump + autobhop (bhop cvars): 10 hops with perfect strafes, no horizontal speed loss on landing', () => {
		const r = bhop(MODERN_CVARS, 10);
		console.log(
			`bhop (modern): ${r.jumps} jumps, landing speeds ${r.landingSpeeds.map((s) => s.toFixed(1)).join(', ')}; apexes ${r.apexes.map((a) => a.toFixed(2)).join(', ')}`
		);
		expect(r.jumps).toBe(10);
		expect(r.landingSpeeds.length).toBeGreaterThanOrEqual(9);
		// Never loses horizontal speed: not on landing ticks nor on jump ticks.
		expect(r.minDelta).toBeGreaterThanOrEqual(-1e-9);
		expect(r.final).toBeGreaterThan(500);
		// The modern landing penalty lowers repeated hops below the 55.8 standing jump.
		// (The first hop comes off a soft spawn landing: no penalty.)
		for (const a of r.apexes.slice(1)) expect(a).toBeLessThan(50);
	});

	it('legacy jump + autobhop (surf cvars): 10 hops, no speed loss, full-height hops', () => {
		const r = bhop(SURF_CVARS, 10);
		console.log(`bhop (legacy): ${r.jumps} jumps, final ${r.final.toFixed(1)}, apexes ${r.apexes.map((a) => a.toFixed(2)).join(', ')}`);
		expect(r.jumps).toBe(10);
		expect(r.minDelta).toBeGreaterThanOrEqual(-1e-9);
		for (const a of r.apexes) expect(a).toBeGreaterThan(55.5);
	});

	/** Drop onto the floor at `vx` horizontal speed from `h` units; returns the state on the landing tick. */
	function landAt(cvars: Cvars, vx: number, h = 56) {
		const w = world(FLOOR);
		const p = createPlayer(v3(0, 0, h));
		p.velocity.x = vx;
		for (let i = 0; i < 200 && !p.onGround; i++) playerMove(w, p, cmd(), cvars);
		expect(p.onGround).toBe(true);
		return { w, p };
	}

	it('modern jump: a missed bhop is clamped by the landing penalty; a press inside the window restores the landing speed', () => {
		const cv: Cvars = { ...MODERN_CVARS, sv_autobunnyhopping: 0 };
		// No jump: the first ground move clamps to the lowered max speed (~0.75 × 250).
		const a = landAt(cv, 275);
		const landed = a.p.landedVz;
		playerMove(a.w, a.p, cmd(), cv);
		const clamped = hspeed(a.p);
		const pen = 1 + landed * 0.0005;
		console.log(`landing at 275 u/s, vz ${landed.toFixed(1)}: first ground tick ${clamped.toFixed(2)} u/s (250·pen² = ${(250 * pen * pen).toFixed(2)})`);
		expect(clamped).toBeLessThan(200);
		expect(clamped).toBeGreaterThan(170);
		// Recovers to 250 within ~0.25 s.
		for (let i = 0; i < 64; i++) playerMove(a.w, a.p, cmd({ forwardmove: 450 }), cv);
		expect(hspeed(a.p)).toBeCloseTo(250, 3);

		// Jump pressed in the next tick, 0.1 tick after the landing (inside ±0.25 tick): the walk move
		// before it clamps, the jump restores the landing speed. Pick a drop that lands late in a tick.
		let b = landAt(cv, 275);
		for (let h = 56; b.p.tick - b.p.landedTime > 0.12 && h < 80; h += 0.5) b = landAt(cv, 275, h);
		expect(b.p.tick - b.p.landedTime).toBeLessThan(0.12);
		const when = b.p.landedTime + 0.1 - b.p.tick;
		playerMove(b.w, b.p, cmd({ subtick: [sub(when, IN_JUMP), sub(when, 0)] }), cv);
		console.log(`landed at t=${b.p.landedTime.toFixed(3)}, press at +${when.toFixed(3)} of the next tick: jumped ${b.p.jumped}, speed ${hspeed(b.p).toFixed(2)}`);
		expect(b.p.jumped).toBe(true);
		expect(hspeed(b.p)).toBeGreaterThan(274);

		// Pressed half a tick after the window: the walk move clamp sticks, the jump is a full tick late.
		const c = landAt(cv, 275);
		const late = c.p.landedTime + 0.5 - c.p.tick;
		const pressAt = Math.max(0, Math.min(0.99, late));
		playerMove(c.w, c.p, cmd({ subtick: [sub(pressAt, IN_JUMP)] }), cv);
		const jumpedLate = c.p.jumped;
		for (let i = 0; i < 3 && !c.p.jumped; i++) playerMove(c.w, c.p, cmd({ buttons: IN_JUMP }), cv);
		console.log(`late press: jumped in the press tick ${jumpedLate}, speed ${hspeed(c.p).toFixed(2)}`);
		expect(hspeed(c.p)).toBeLessThan(200);
	});

	it('modern jump: the jump after a hard landing is lowered, recovering over time', () => {
		const cv: Cvars = { ...MODERN_CVARS, sv_autobunnyhopping: 0 };
		const apexAfter = (waitTicks: number) => {
			const { w, p } = landAt(cv, 0, 120);
			for (let i = 0; i < waitTicks; i++) playerMove(w, p, cmd(), cv);
			const z0 = p.origin.z;
			let apex = 0;
			playerMove(w, p, cmd({ buttons: IN_JUMP }), cv);
			expect(p.jumped).toBe(true);
			for (let i = 0; i < 100 && !p.onGround; i++) {
				playerMove(w, p, cmd(), cv);
				apex = Math.max(apex, p.origin.z - z0);
			}
			return apex;
		};
		const soon = apexAfter(1);
		const later = apexAfter(64);
		console.log(`jump apex 2 ticks after a 120-unit drop: ${soon.toFixed(2)}, after 1 s: ${later.toFixed(2)}`);
		expect(soon).toBeLessThan(later - 5);
		expect(later).toBeGreaterThan(55.5);
	});

	it('modern jump: presses within sv_jump_spam_penalty_time (1 tick) of the previous one are ignored', () => {
		const cv: Cvars = { ...MODERN_CVARS, sv_autobunnyhopping: 0 };
		const w = world(FLOOR);
		const p = settled(w, v3(0, 0, 1), cv);
		for (let i = 0; i < 64; i++) playerMove(w, p, cmd(), cv);
		// Press (in the air? no: on ground) at 0.5 of a tick, then again exactly one tick later.
		const q = clone(p);
		playerMove(w, q, cmd({ subtick: [sub(0.5, IN_JUMP), sub(0.6, 0)] }), cv);
		expect(q.jumped).toBe(true);
		// Same press preceded by one exactly a tick earlier: ignored.
		const r = clone(p);
		r.lastJumpPress = r.tick - 0.5;
		playerMove(w, r, cmd({ subtick: [sub(0.5, IN_JUMP), sub(0.6, 0)] }), cv);
		expect(r.jumped).toBe(false);
		// A gap of 1 + 1/64 tick passes.
		const s = clone(p);
		s.lastJumpPress = s.tick - 0.5 - 1 / 64;
		playerMove(w, s, cmd({ subtick: [sub(0.5, IN_JUMP), sub(0.6, 0)] }), cv);
		expect(s.jumped).toBe(true);
	});

	it('legacy jump without autobhop: holding jump does not re-jump', () => {
		const cv: Cvars = { ...SURF_CVARS, sv_autobunnyhopping: 0 };
		const w = world(FLOOR);
		const p = settled(w, v3(0, 0, 1), cv);
		let jumps = 0;
		for (let i = 0; i < 128; i++) {
			playerMove(w, p, cmd({ buttons: IN_JUMP }), cv);
			if (p.jumped) jumps++;
		}
		expect(jumps).toBe(1);
	});

	it('sv_enablebunnyhopping 0 caps the jump speed at 286 (1.1 × 260)', () => {
		const w = world(FLOOR);
		for (const base of [SURF_CVARS, BHOP_CVARS]) {
			const cv: Cvars = { ...base, sv_enablebunnyhopping: 0 };
			const p = settled(w, v3(0, 0, 1), cv);
			p.velocity.x = 600;
			p.landedTime = -Infinity;
			playerMove(w, p, cmd({ buttons: IN_JUMP }), cv);
			expect(p.jumped).toBe(true);
			// Capped before the jump impulse is set, like CS:GO.
			expect(hspeed(p)).toBeLessThanOrEqual(286 + 1e-6);
			expect(hspeed(p)).toBeGreaterThan(285);
		}
	});

	it('subtick: an input change at when=0 is identical to the same input at tick start', () => {
		const w = world(FLOOR);
		for (const cv of [SURF_CVARS, BHOP_CVARS]) {
			const p0 = settled(w, v3(0, 0, 1), cv);
			for (let i = 0; i < 40; i++) playerMove(w, p0, cmd(), cv);
			const a = clone(p0);
			const b = clone(p0);
			const inputs: Array<[UserCmd, UserCmd]> = [
				[cmd({ forwardmove: 450, buttons: IN_JUMP }), cmd({ subtick: [sub(0, IN_JUMP, 450)] })],
				[cmd({ forwardmove: 450, sidemove: 450, buttons: IN_JUMP }), cmd({ forwardmove: 450, buttons: IN_JUMP, subtick: [sub(0, IN_JUMP, 450, 450)] })],
				[cmd({ forwardmove: 450 }), cmd({ forwardmove: 450, sidemove: 450, buttons: IN_JUMP, subtick: [sub(0, 0, 450)] })]
			];
			for (let i = 0; i < 60; i++) {
				const [x, y] = inputs[i % inputs.length]!;
				playerMove(w, a, x, cv);
				playerMove(w, b, y, cv);
				expect(b).toEqual(a);
			}
		}
	});

	it('subtick: a key pressed half way through the tick accelerates for half the tick', () => {
		const w = world(FLOOR);
		const p = settled(w, v3(0, 0, 1));
		const full = clone(p);
		const half = clone(p);
		playerMove(w, full, cmd({ forwardmove: 450 }), SURF_CVARS);
		playerMove(w, half, cmd({ subtick: [sub(0.5, 0, 450)] }), SURF_CVARS);
		console.log(`subtick half press: ${hspeed(half).toFixed(4)} vs full tick ${hspeed(full).toFixed(4)}`);
		expect(hspeed(half)).toBeCloseTo(hspeed(full) * 0.5, 6);
		expect(half.origin.x).toBeLessThan(full.origin.x);
	});

	it('subtick: a mouse-wheel jump (press and release at the same instant) jumps; mid-tick jumps start mid-tick', () => {
		const w = world(FLOOR);
		const p = settled(w, v3(0, 0, 1));
		const a = clone(p);
		playerMove(w, a, cmd({ subtick: [sub(0.5, IN_JUMP), sub(0.5, 0)] }), SURF_CVARS);
		expect(a.jumped).toBe(true);
		const b = clone(p);
		playerMove(w, b, cmd({ buttons: IN_JUMP }), SURF_CVARS);
		expect(b.jumped).toBe(true);
		// Jumping half a tick later means half a tick less rise in this tick.
		console.log(`jump at tick start z=${b.origin.z.toFixed(4)}, at when 0.5 z=${a.origin.z.toFixed(4)}`);
		expect(a.origin.z).toBeLessThan(b.origin.z);
		expect(a.origin.z).toBeGreaterThan(p.origin.z);
	});

	it('subtick: splitting a tick does not compound ground friction', () => {
		const w = world(FLOOR);
		const p = settled(w, v3(0, 0, 1));
		p.velocity.x = 200;
		const a = clone(p);
		const b = clone(p);
		playerMove(w, a, cmd(), SURF_CVARS);
		playerMove(w, b, cmd({ subtick: [sub(0.25, IN_DUCK), sub(0.5, 0), sub(0.75, 0)] }), SURF_CVARS);
		expect(hspeed(b)).toBeCloseTo(hspeed(a), 9);
	});

	it('subtick: the same input log gives identical results at 60 and 240 FPS', () => {
		const w = world(
			FLOOR,
			box(v3(400, -200, 0), v3(600, 200, 18)),
			{ type: 'ramp', from: v3(800, -2000, 400), to: v3(800, 2000, 300), height: 400, halfWidth: 400, side: 'both', material: 'm' }
		);
		const ticks = 3 * 64;
		const inputs: UserCmd[] = [];
		for (let t = 0; t < ticks; t++) {
			const f = t % 97 < 70 ? 450 : 0;
			const s = t % 50 < 25 ? 450 : -450;
			const b = (t % 32 < 2 ? IN_JUMP : 0) | (t % 75 > 60 ? IN_DUCK : 0);
			inputs.push(
				cmd({
					yaw: Math.sin(t / 20) * 60,
					forwardmove: f,
					sidemove: s,
					buttons: b,
					subtick: t % 3 === 0 ? [sub(((t * 37) % 64) / 64, b ^ IN_JUMP, f, -s), sub(0.9, b, f, s)] : undefined
				})
			);
		}

		function drive(fps: number): Vec3[] {
			const p = createPlayer(v3(0, 0, 1));
			const out: Vec3[] = [];
			let acc = 0;
			let tick = 0;
			// Integer microsecond frame times so 60 and 240 FPS sum to exactly the same duration.
			const frameUs = Math.round(1e6 / fps);
			const tickUs = 15625;
			const totalUs = ticks * tickUs;
			for (let t = 0; t < totalUs; t += frameUs) {
				acc += frameUs;
				let steps = 0;
				while (acc >= tickUs && steps < 8 && tick < ticks) {
					playerMove(w, p, inputs[tick]!, SURF_CVARS, TICK);
					out.push({ ...p.origin });
					acc -= tickUs;
					tick++;
					steps++;
				}
			}
			while (tick < ticks) {
				playerMove(w, p, inputs[tick]!, SURF_CVARS, TICK);
				out.push({ ...p.origin });
				tick++;
			}
			return out;
		}
		const a = drive(60);
		const b = drive(240);
		expect(a.length).toBe(ticks);
		expect(b).toEqual(a);
		// Sanity: the input actually moved the player around.
		expect(Math.hypot(a[ticks - 1]!.x, a[ticks - 1]!.y)).toBeGreaterThan(100);
	});

	it('walks up an 18-unit step; a 19-unit step blocks', () => {
		for (const h of [18, 19]) {
			const w = world(FLOOR, box(v3(100, -500, 0), v3(600, 500, h)));
			const p = settled(w, v3(0, 0, 1));
			for (let i = 0; i < 64; i++) playerMove(w, p, cmd({ forwardmove: 450 }), SURF_CVARS);
			console.log(`step ${h}: x=${p.origin.x.toFixed(2)} z=${p.origin.z.toFixed(4)} onGround=${p.onGround}`);
			expect(p.onGround).toBe(true);
			if (h === 18) {
				expect(p.origin.z).toBeGreaterThan(18);
				expect(p.origin.z).toBeLessThan(18.1);
				expect(p.origin.x).toBeGreaterThan(200);
			} else {
				expect(p.origin.z).toBeLessThan(0.1);
				expect(p.origin.x).toBeLessThan(84);
				expect(p.origin.x).toBeGreaterThan(83.9);
			}
		}
	});

	it('slides along the crease between two surf ramps (V trough)', () => {
		// Two 60° slopes meeting at y=0, z=0: normals (0, ±.866, .5); crease along X.
		const hw = 500;
		const ht = hw * Math.tan(Math.PI / 3);
		const w = world(
			{ type: 'ramp', from: v3(-5000, -hw, ht), to: v3(5000, -hw, ht), height: ht, halfWidth: hw, side: 'both', material: 'm' },
			{ type: 'ramp', from: v3(-5000, hw, ht), to: v3(5000, hw, ht), height: ht, halfWidth: hw, side: 'both', material: 'm' }
		);
		const p = createPlayer(v3(0, 10, 200));
		p.velocity = v3(400, 0, -300);
		for (let i = 0; i < 128; i++) {
			playerMove(w, p, cmd(), SURF_CVARS);
			expect(p.onGround).toBe(false);
		}
		console.log(`crease: origin ${JSON.stringify(p.origin)} vel ${JSON.stringify(p.velocity)}`);
		expect(p.velocity.x).toBeGreaterThan(390);
		expect(Math.abs(p.origin.y)).toBeLessThan(1);
		expect(Math.abs(p.velocity.y)).toBeLessThan(5);
		expect(Math.abs(p.velocity.z)).toBeLessThan(15);
		// Resting in the V: box corners at y=±16 sit on the slopes => z ≈ 16*tan60.
		expect(p.origin.z).toBeGreaterThan(16 * Math.tan(Math.PI / 3) - 0.5);
		expect(p.origin.z).toBeLessThan(16 * Math.tan(Math.PI / 3) + 3);
	});

	it('slides along a wall when running into it at 45°, stops in a 90° corner', () => {
		const w = world(FLOOR, box(v3(200, -1000, 0), v3(264, 3000, 200)), box(v3(-1000, 1500, 0), v3(1000, 1564, 200)));
		const p = settled(w, v3(0, 0, 1));
		for (let i = 0; i < 128; i++) playerMove(w, p, cmd({ yaw: 45, forwardmove: 450 }), SURF_CVARS);
		const wallX = 200 - 16;
		expect(p.origin.x).toBeGreaterThan(wallX - 0.1);
		const y0 = p.origin.y;
		for (let i = 0; i < 20; i++) playerMove(w, p, cmd({ yaw: 45, forwardmove: 450 }), SURF_CVARS);
		expect(p.origin.y).toBeGreaterThan(y0 + 10); // slid along +Y
		expect(p.origin.x).toBeCloseTo(wallX, 1);
		for (let i = 0; i < 1000; i++) playerMove(w, p, cmd({ yaw: 45, forwardmove: 450 }), SURF_CVARS);
		expect(p.origin.x).toBeCloseTo(wallX, 1);
		expect(p.origin.y).toBeCloseTo(1500 - 16, 1);
		expect(p.origin.x).toBeLessThan(wallX);
		expect(p.origin.y).toBeLessThan(1500 - 16);
		expect(hspeed(p)).toBeLessThan(1);
	});

	it('clamps each velocity axis to sv_maxvelocity, and never past 16384', () => {
		const w = world();
		const p = createPlayer(v3(0, 0, 0));
		p.velocity = v3(20000, -12000, -30000);
		playerMove(w, p, cmd(), SURF_CVARS);
		expect(p.velocity.x).toBe(9876);
		expect(p.velocity.y).toBe(-9876);
		expect(p.velocity.z).toBe(-9876);
		const q = createPlayer(v3(0, 0, 0));
		q.velocity = v3(20000, -12000, -30000);
		playerMove(w, q, cmd(), BHOP_CVARS);
		expect(BHOP_CVARS.sv_maxvelocity).toBe(99999);
		expect(q.velocity.x).toBe(MAX_VELOCITY_HARD);
		expect(q.velocity.y).toBe(-12000);
		expect(q.velocity.z).toBe(-MAX_VELOCITY_HARD);
	});

	it('CS2 duck: hull switches when the duck amount reaches 1, 0.34× ground speed, unduck needs room', () => {
		const w = world(FLOOR, box(v3(100, -500, 60), v3(800, 500, 100)));
		const p = settled(w, v3(0, 0, 1));
		const z = p.origin.z;
		let switchTick = -1;
		for (let i = 0; i < 40; i++) {
			playerMove(w, p, cmd({ buttons: IN_DUCK }), SURF_CVARS);
			if (p.ducked && switchTick < 0) switchTick = i;
		}
		console.log(`duck: hull switch after ${switchTick + 1} ticks (${((switchTick + 1) * TICK * 1000).toFixed(1)} ms)`);
		// First press costs 2 duck speed (8 → 6, recovering 3/s): 0.8 × ~6.2/s ≈ 0.2 s.
		expect(switchTick + 1).toBeGreaterThanOrEqual(12);
		expect(switchTick + 1).toBeLessThanOrEqual(14);
		expect(p.origin.z).toBe(z);
		expect(playerMaxs(p)).toBe(DUCK_HULL_MAX);
		expect(eyeHeight(p)).toBe(46);
		for (let i = 0; i < 128; i++) playerMove(w, p, cmd({ forwardmove: 450, buttons: IN_DUCK }), SURF_CVARS);
		expect(hspeed(p)).toBeCloseTo(85, 4);
		expect(p.origin.x).toBeGreaterThan(130); // walked under the 60-unit ceiling
		playerMove(w, p, cmd({ forwardmove: 0 }), SURF_CVARS);
		expect(p.ducked).toBe(true); // can't stand up under the ceiling
		const w2 = world(FLOOR);
		const p2 = settled(w2, v3(0, 0, 1));
		for (let i = 0; i < 30; i++) playerMove(w2, p2, cmd({ buttons: IN_DUCK }), SURF_CVARS);
		playerMove(w2, p2, cmd(), SURF_CVARS);
		expect(p2.ducked).toBe(false); // standing hull back at once
		expect(playerMaxs(p2)).toBe(HULL_MAX);
		expect(eyeHeight(p2)).toBeGreaterThan(46);
		expect(eyeHeight(p2)).toBeLessThan(64);
		let up = 1;
		for (; up < 30 && p2.duckAmount > 0; up++) playerMove(w2, p2, cmd(), SURF_CVARS);
		console.log(`unduck: eye back to 64 after ${up} ticks`);
		expect(eyeHeight(p2)).toBe(64);
	});

	it('CS2 duck: spamming duck slows it down; sv_timebetweenducks delays a new duck', () => {
		const w = world(FLOOR);
		const p = settled(w, v3(0, 0, 1));
		for (let i = 0; i < 20; i++) playerMove(w, p, cmd({ buttons: i % 2 ? IN_DUCK : 0 }), SURF_CVARS);
		console.log(`duck spam: duck speed ${p.duckSpeed.toFixed(3)} after 10 toggles`);
		expect(p.duckSpeed).toBeLessThan(1.5);
		// Too slow to start a new duck now.
		const amount = p.duckAmount;
		playerMove(w, p, cmd({ buttons: IN_DUCK }), SURF_CVARS);
		expect(p.duckAmount).toBeLessThanOrEqual(amount);

		// A completed duck blocks the next one for 0.4 s (surf), not on bhop (0).
		for (const [cv, blocked] of [
			[SURF_CVARS, true],
			[BHOP_CVARS, false]
		] as const) {
			const q = settled(w, v3(0, 0, 1), cv);
			for (let i = 0; i < 64; i++) playerMove(w, q, cmd({ buttons: IN_DUCK }), cv);
			for (let i = 0; i < 16 && q.duckAmount > 0; i++) playerMove(w, q, cmd(), cv);
			for (let i = 0; i < 64; i++) playerMove(w, q, cmd(), cv); // let duck speed recover
			q.timeSinceDuck = 0.1;
			playerMove(w, q, cmd({ buttons: IN_DUCK }), cv);
			expect(q.duckAmount > 0).toBe(!blocked);
		}
	});
});
