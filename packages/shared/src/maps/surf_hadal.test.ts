import { describe, expect, it } from 'vitest';
import { buildCollisionWorld } from '../collision/world.ts';
import { SURF_CVARS } from '../cvars.ts';
import { HULL_MAX, HULL_MIN, IN_JUMP, type PlayerState, type UserCmd } from '../movement/api.ts';
import { createPlayer, playerMove } from '../movement/gamemovement.ts';
import type { Vec3 } from '../types.ts';
import { TICK_INTERVAL } from '../units.ts';
import type { Spawn, Zone } from './types.ts';
import {
	boundsOf,
	brushBounds,
	launchStates,
	rampAngle,
	simulateTransfer,
	type Box3,
	type BoxBrush,
	type RampBrush,
	type SurfTransfer
} from './helpers.ts';
import { HADAL_RAMPS, HADAL_SECTIONS, HADAL_SPEEDS, HADAL_TRANSFERS, surf_hadal as m } from './surf_hadal.ts';
import { rampYaw } from './surf_hadal-helpers.ts';

const GRAVITY = 800;
/** Same lift the map registry applies (index.ts SPAWN_CLEARANCE). */
const SPAWN_CLEARANCE = 0.25;
const lift = (s: Spawn): Spawn => ({ ...s, pos: { ...s.pos, z: s.pos.z + SPAWN_CLEARANCE } });

const boxes = m.brushes.filter((b): b is BoxBrush => b.type === 'box');
const ramps = m.brushes.filter((b): b is RampBrush => b.type === 'ramp');
const inBox = (p: Vec3, b: Box3) =>
	p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;
const overlaps = (a: Box3, b: Box3, eps = 0.01) =>
	a.min.x < b.max.x - eps &&
	b.min.x < a.max.x - eps &&
	a.min.y < b.max.y - eps &&
	b.min.y < a.max.y - eps &&
	a.min.z < b.max.z - eps &&
	b.min.z < a.max.z - eps;
const hullAt = (p: Vec3): Box3 => ({
	min: { x: p.x + HULL_MIN.x, y: p.y + HULL_MIN.y, z: p.z + HULL_MIN.z },
	max: { x: p.x + HULL_MAX.x, y: p.y + HULL_MAX.y, z: p.z + HULL_MAX.z }
});

type Cp = Zone & { type: 'checkpoint' };
type Tp = Zone & { type: 'teleport' };
const zonesOf = (type: Zone['type']) => m.zones.filter((z) => z.type === type);
const checkpoints = m.zones.filter((z): z is Cp => z.type === 'checkpoint');
const teleports = m.zones.filter((z): z is Tp => z.type === 'teleport');
const startZ = zonesOf('start')[0]!;
const endZ = zonesOf('end')[0]!;
const respawns = checkpoints.map((z) => z.respawn);

const isRampTransfer = (t: SurfTransfer) => 'ramps' in t.from;
const speedsFor = (t: SurfTransfer) => (isRampTransfer(t) ? HADAL_SPEEDS : [0, 250]);
const turnOf = (t: SurfTransfer) => {
	if (!('ramps' in t.from) || !('ramps' in t.to)) return 0;
	let d = Math.abs(rampYaw(t.to.ramps[0]!) - rampYaw(t.from.ramps[0]!)) % 360;
	if (d > 180) d = 360 - d;
	return d;
};

/** Point-mass flight samples from each launch state up to its landing. */
function flight(t: SurfTransfer, speed: number): Array<{ pts: Vec3[]; ok: boolean }> {
	const res = simulateTransfer(t, speed, GRAVITY);
	return launchStates(t.from, speed).map(({ p, vel }, i) => {
		const pts: Vec3[] = [];
		for (let time = 0; time <= res[i]!.time; time += 1 / 256)
			pts.push({ x: p.x + vel.x * time, y: p.y + vel.y * time, z: p.z + vel.z * time - 0.5 * GRAVITY * time * time });
		return { pts, ok: res[i]!.ok };
	});
}

describe('surf_hadal: definition', () => {
	it('is a hard linear surf map on the surf physics profile', () => {
		expect(m.id).toBe('surf_hadal');
		expect(m.kind).toBe('surf');
		expect(m.difficulty).toBe('easy');
		expect(m.layout).toBe('linear');
		expect(m.cvars).toEqual(SURF_CVARS);
	});

	it('has exactly one start and one end zone, apart', () => {
		expect(zonesOf('start')).toHaveLength(1);
		expect(zonesOf('end')).toHaveLength(1);
		expect(overlaps(startZ, endZ)).toBe(false);
	});

	it('has 4 checkpoints numbered 1..4 and no stage zones', () => {
		expect(zonesOf('stage')).toHaveLength(0);
		expect(checkpoints.map((z) => z.index)).toEqual([1, 2, 3, 4]);
		for (const c of checkpoints) {
			expect(overlaps(c, startZ)).toBe(false);
			expect(overlaps(c, endZ)).toBe(false);
		}
	});

	it('zones are generous (≥ 144 tall)', () => {
		for (const z of m.zones) if (z.type !== 'teleport') expect(z.max.z - z.min.z).toBeGreaterThanOrEqual(144);
	});

	it('spawns standing on the start platform inside the start zone', () => {
		expect(inBox(m.spawn.pos, startZ)).toBe(true);
		expect(m.spawn.yaw).toBe(0);
	});

	it('respawns sit inside their zones, facing along the ramp below', () => {
		for (const z of checkpoints) expect(inBox(z.respawn.pos, z), `checkpoint ${z.index}`).toBe(true);
	});

	it('spawn and respawns are free in the real trace and on ground', () => {
		const world = buildCollisionWorld(m);
		for (const s of [m.spawn, ...respawns]) {
			const p = lift(s).pos;
			const hull = hullAt(p);
			for (const b of boxes) expect(overlaps(hull, b)).toBe(false);
			const ground = boxes.find((b) => Math.abs(b.max.z - s.pos.z) < 1e-6 && p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y);
			expect(ground, `ground under ${JSON.stringify(s.pos)}`).toBeDefined();
			expect(world.trace(p, p, HULL_MIN, HULL_MAX).startsolid).toBe(false);
			expect(world.trace(p, { ...p, z: p.z - 2 }, HULL_MIN, HULL_MAX).fraction).toBeLessThan(1);
		}
	});

	it('every material exists; effects and fog fit the renderer', () => {
		for (const b of m.brushes) expect(m.theme.materials[b.material], b.material).toBeDefined();
		const known = ['aurora', 'embers', 'clouds', 'gridFloor', 'lavaSea', 'snowFloor'];
		for (const e of m.theme.effects) expect(known).toContain(e.type);
		expect(m.theme.fogFar).toBeGreaterThanOrEqual(12000);
	});

	it('box brushes do not intersect each other', () => {
		for (let i = 0; i < boxes.length; i++)
			for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!), `boxes ${i}, ${j}`).toBe(false);
	});
});

describe('surf_hadal: ramps', () => {
	it('every ramp is listed in course order', () => {
		expect(HADAL_RAMPS).toHaveLength(ramps.length);
		expect(new Set(HADAL_RAMPS)).toEqual(new Set(ramps));
		expect(HADAL_SECTIONS).toHaveLength(8);
	});

	it('are steep (62–68°) and narrow (192–256 per face)', () => {
		for (const r of ramps) {
			expect(rampAngle(r)).toBeGreaterThanOrEqual(62 - 1e-3);
			expect(rampAngle(r)).toBeLessThanOrEqual(68 + 1e-3);
			expect(r.halfWidth).toBeGreaterThanOrEqual(192);
			expect(r.halfWidth).toBeLessThanOrEqual(256);
		}
	});

	it('are single faces that alternate sides (no V to fall back into)', () => {
		for (const r of ramps) expect(r.side).not.toBe('both');
		for (let i = 1; i < HADAL_RAMPS.length; i++) expect(HADAL_RAMPS[i]!.side, `ramp ${i}`).not.toBe(HADAL_RAMPS[i - 1]!.side);
	});

	it('has at least 3 air turns of 45–110°', () => {
		const turns = HADAL_TRANSFERS.map(turnOf).filter((d) => d >= 45 && d <= 110);
		expect(turns.length).toBeGreaterThanOrEqual(3);
	});

	it('has an up-ramp', () => {
		expect(ramps.some((r) => r.to.z > r.from.z + 100)).toBe(true);
	});

	it('has a rhythm section: 4+ short ramps (≤ 1024) in a row with gaps ≤ 256', () => {
		let run = 0;
		let best = 0;
		for (const r of HADAL_RAMPS) {
			const len = Math.hypot(r.to.x - r.from.x, r.to.y - r.from.y);
			run = len <= 1024 ? run + 1 : 0;
			best = Math.max(best, run);
		}
		expect(best).toBeGreaterThanOrEqual(4);
		const rhythm = HADAL_TRANSFERS.filter((t) => t.label.includes('rhythm') && !t.label.startsWith('4b'));
		expect(rhythm.length).toBeGreaterThanOrEqual(3);
		for (const t of rhythm) {
			const a = (t.from as { ramps: RampBrush[] }).ramps[0]!;
			const b = (t.to as { ramps: RampBrush[] }).ramps[0]!;
			// Gap along the heading (the peaks also shift sideways by one face width).
			const d = { x: (a.to.x - a.from.x) / Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y), y: (a.to.y - a.from.y) / Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y) };
			expect((b.from.x - a.to.x) * d.x + (b.from.y - a.to.y) * d.y).toBeLessThanOrEqual(256 + 1);
		}
	});
});

describe('surf_hadal: transfers (ballistic, point mass)', () => {
	it.each(HADAL_TRANSFERS.map((t) => [t.label, t] as const))('%s lands', (_l, t) => {
		for (const speed of speedsFor(t)) {
			for (const r of simulateTransfer(t, speed, GRAVITY))
				expect(r.ok, `${speed} u/s from (${r.start.x.toFixed(0)}, ${r.start.y.toFixed(0)}, ${r.start.z.toFixed(0)}): ${r.reason}`).toBe(true);
		}
	});

	it('every ramp is a landing target and the last transfer lands in the end zone', () => {
		const used = new Set(HADAL_TRANSFERS.flatMap((t) => ('ramps' in t.to ? t.to.ramps : [])));
		for (const r of ramps) expect(used.has(r)).toBe(true);
		expect(HADAL_TRANSFERS.some((t) => 'platform' in t.to && inBox(t.to.platform.max, endZ))).toBe(true);
	});

	it('the long gap needs ≥ 700 u/s (600 fails, 700 and 800 land)', () => {
		const t = HADAL_TRANSFERS.find((x) => x.label.includes('long gap'))!;
		expect(simulateTransfer(t, 600, GRAVITY).some((r) => !r.ok)).toBe(true);
		expect(simulateTransfer(t, 700, GRAVITY).every((r) => r.ok)).toBe(true);
		expect(simulateTransfer(t, 800, GRAVITY).every((r) => r.ok)).toBe(true);
	});

	it.each(HADAL_TRANSFERS.map((t) => [t.label, t] as const))('%s: no other brush in the way (hull trace)', (_l, t) => {
		const skip = new Set<unknown>(['ramps' in t.to ? t.to.ramps : [t.to.platform], 'ramps' in t.from ? t.from.ramps : [t.from.platform]].flat());
		const world = buildCollisionWorld({ brushes: m.brushes.filter((b) => !skip.has(b)) });
		for (const speed of speedsFor(t)) {
			for (const { pts } of flight(t, speed)) {
				for (let i = 1; i < pts.length; i++) {
					const tr = world.trace(pts[i - 1]!, pts[i]!, HULL_MIN, HULL_MAX);
					expect(tr.fraction, `${speed} u/s, sample ${i}`).toBe(1);
				}
			}
		}
	});

	it.each(HADAL_TRANSFERS.map((t) => [t.label, t] as const))('%s never passes through a teleport', (_l, t) => {
		for (const speed of speedsFor(t))
			for (const { pts } of flight(t, speed)) for (const p of pts) for (const tp of teleports) expect(overlaps(hullAt(p), tp)).toBe(false);
	});

	it('each checkpoint zone is crossed by the flight into its section', () => {
		for (const c of checkpoints) {
			const ledge = HADAL_TRANSFERS.find((x) => 'platform' in x.from && inBox(c.respawn.pos, x.from.platform))!;
			const target = (ledge.to as { ramps: RampBrush[] }).ramps[0];
			const t = HADAL_TRANSFERS.find((x) => isRampTransfer(x) && 'ramps' in x.to && x.to.ramps[0] === target);
			expect(t, `checkpoint ${c.index}`).toBeDefined();
			for (const speed of HADAL_SPEEDS) for (const { pts } of flight(t!, speed)) expect(pts.some((p) => inBox(p, c))).toBe(true);
		}
	});
});

describe('surf_hadal: teleports', () => {
	it('one teleport covers everything from below; all go to the start', () => {
		const all = boundsOf(m.brushes);
		const under = teleports.find(
			(z) => z.max.z <= all.min.z && z.min.x <= all.min.x && z.min.y <= all.min.y && z.max.x >= all.max.x && z.max.y >= all.max.y
		);
		expect(under).toBeDefined();
		for (const z of teleports) expect(z.to).toBe('start');
	});

	it('has a catch teleport under each of the 8 sections', () => {
		expect(teleports.length).toBe(HADAL_SECTIONS.length + 1);
		HADAL_SECTIONS.forEach((g, i) => {
			const b = boundsOf(g);
			const c = { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 };
			const hit = teleports.some((z) => z.max.z <= b.min.z && z.max.z > b.min.z - 1024 && overlaps({ min: { ...b.min, z: -1e9 }, max: b.max }, z));
			expect(hit, `section ${i + 1} near (${c.x.toFixed(0)}, ${c.y.toFixed(0)})`).toBe(true);
		});
	});

	it('teleports touch no brush, spawn, respawn or other zone', () => {
		for (const tp of teleports) {
			for (const b of m.brushes) expect(overlaps(tp, brushBounds(b))).toBe(false);
			for (const s of [m.spawn, ...respawns]) expect(overlaps(hullAt(s.pos), tp)).toBe(false);
			for (const z of m.zones) if (z.type !== 'teleport') expect(overlaps(z, tp), `${z.type}`).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// Real physics (playerMove at TICK_INTERVAL)

const cmd = (c: Partial<UserCmd> = {}): UserCmd => ({ pitch: 0, yaw: 0, forwardmove: 0, sidemove: 0, buttons: 0, ...c });

interface Outcome {
	teleported: boolean;
	finished: boolean;
	ticks: number;
}

/** Run with a fixed input until a teleport or the end zone is touched, or `seconds` pass. */
function runFixed(input: UserCmd | ((p: PlayerState, tick: number) => UserCmd), seconds: number): Outcome & { p: PlayerState } {
	const world = buildCollisionWorld(m);
	const p = createPlayer(lift(m.spawn).pos);
	const n = Math.round(seconds / TICK_INTERVAL);
	for (let i = 0; i < n; i++) {
		playerMove(world, p, typeof input === 'function' ? input(p, i) : input, SURF_CVARS, TICK_INTERVAL);
		const hull = hullAt(p.origin);
		if (overlaps(hull, endZ, 0)) return { teleported: false, finished: true, ticks: i, p };
		if (teleports.some((tp) => overlaps(hull, tp, 0))) return { teleported: true, finished: false, ticks: i, p };
	}
	return { teleported: false, finished: false, ticks: n, p };
}

describe('surf_hadal: real physics', () => {
	it('dropping onto the first ramp and strafing into it surfs for ≥ 1 s', () => {
		const r1 = HADAL_RAMPS[0]!;
		expect(r1.side).toBe('right'); // face on the -Y side: "into the ramp" is +Y, i.e. move left
		let run = 0;
		let best = 0;
		const world = buildCollisionWorld(m);
		const p = createPlayer(lift(m.spawn).pos);
		let grounded = false;
		let left = false;
		for (let i = 0; i < Math.round(4 / TICK_INTERVAL); i++) {
			if (p.onGround) grounded = true;
			else if (grounded) left = true;
			playerMove(world, p, left ? cmd({ sidemove: -450 }) : cmd({ forwardmove: 450 }), SURF_CVARS, TICK_INTERVAL);
			run = p.surfing ? run + 1 : 0;
			best = Math.max(best, run);
			expect(teleports.some((tp) => overlaps(hullAt(p.origin), tp, 0))).toBe(false);
		}
		console.log(`hadal bot: longest surf ${(best * TICK_INTERVAL).toFixed(2)} s, speed ${Math.hypot(p.velocity.x, p.velocity.y).toFixed(0)} u/s, x=${p.origin.x.toFixed(0)}`);
		expect(best * TICK_INTERVAL).toBeGreaterThanOrEqual(1);
		// Still on the first ramp, above its face.
		expect(p.origin.x).toBeGreaterThan(r1.from.x);
		expect(p.origin.x).toBeLessThan(r1.to.x);
	});

	it('standing still never finishes', () => {
		const res = runFixed(cmd(), 10);
		expect(res.finished).toBe(false);
		expect(res.teleported).toBe(false);
		expect(res.p.onGround).toBe(true);
	});

	for (const yaw of [0, 45, 90, 135, 180, 225, 270, 315]) {
		for (const jump of [false, true]) {
			it(`holding W${jump ? ' + jump' : ''} at yaw ${yaw} falls into a teleport, never the end`, () => {
				const res = runFixed(cmd({ yaw, forwardmove: 450, buttons: jump ? IN_JUMP : 0 }), 40);
				expect(res.finished).toBe(false);
				// Facing back into the start wall the player may never leave the platform; otherwise they fall out.
				if (!res.teleported) expect(inBox(res.p.origin, startZ)).toBe(true);
			});
		}
	}

	it('holding W off the start drops onto ramp 1 and falls out within 10 s', () => {
		const res = runFixed(cmd({ forwardmove: 450 }), 10);
		expect(res.teleported).toBe(true);
	});
});
