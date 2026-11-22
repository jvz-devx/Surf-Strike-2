import { describe, expect, it } from 'vitest';
import { buildCollisionWorld } from '../collision/world.ts';
import { BHOP_CVARS, type Cvars } from '../cvars.ts';
import { HULL_MAX, HULL_MIN, IN_JUMP, type PlayerState, type UserCmd } from '../movement/api.ts';
import { createPlayer, playerMove } from '../movement/gamemovement.ts';
import type { Vec3 } from '../types.ts';
import { PRESPEED_CAP } from '../run.ts';
import { TICK_INTERVAL } from '../units.ts';
import { bhop_rimefall, RIMEFALL_FINAL_SECTION, RIMEFALL_PATH, RIMEFALL_SECTIONS } from './bhop_rimefall.ts';
import { boundsOf, brushBounds, gapXY, type Box3, type BoxBrush, type PathNode } from './helpers.ts';
import type { MapDef, Spawn, Zone } from './types.ts';

/** Same lift the registry (index.ts SPAWN_CLEARANCE) applies; this map is not registered here. */
const CLEARANCE = 0.25;
const GRAVITY = 800;
const HULL_HALF = 16;
const HULL_HEIGHT = 72;
const EFFECTS = new Set(['aurora', 'embers', 'clouds', 'gridFloor', 'lavaSea', 'snowFloor']);

const m: MapDef = bhop_rimefall;
const path: PathNode[] = RIMEFALL_PATH;
const boxes = m.brushes.filter((b): b is BoxBrush => b.type === 'box');
const inBox = (p: Vec3, b: Box3) =>
	p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;
const overlaps = (a: Box3, b: Box3, eps = 0.01) =>
	a.min.x < b.max.x - eps &&
	b.min.x < a.max.x - eps &&
	a.min.y < b.max.y - eps &&
	b.min.y < a.max.y - eps &&
	a.min.z < b.max.z - eps &&
	b.min.z < a.max.z - eps;
const lifted = (s: Spawn): Vec3 => ({ ...s.pos, z: s.pos.z + CLEARANCE });

type ZoneOf<T extends Zone['type']> = Zone & { type: T } & (T extends 'stage' | 'checkpoint' ? { index: number; respawn: Spawn } : unknown);
const zonesOf = <T extends Zone['type']>(type: T) => m.zones.filter((z): z is ZoneOf<T> => z.type === type);
const respawns = (): Spawn[] => [m.spawn, ...zonesOf('checkpoint').map((z) => z.respawn)];

/** The hull at `s` touches no box and stands on one (top within 1 unit, under the origin). */
function checkStanding(s: Spawn, what: string) {
	const hull: Box3 = {
		min: { x: s.pos.x - HULL_HALF, y: s.pos.y - HULL_HALF, z: s.pos.z },
		max: { x: s.pos.x + HULL_HALF, y: s.pos.y + HULL_HALF, z: s.pos.z + HULL_HEIGHT }
	};
	for (const b of boxes) expect(overlaps(hull, b), `${what} hull overlaps a box`).toBe(false);
	const ground = boxes.find(
		(b) => Math.abs(b.max.z - s.pos.z) <= 1 && s.pos.x >= b.min.x && s.pos.x <= b.max.x && s.pos.y >= b.min.y && s.pos.y <= b.max.y
	);
	expect(ground, `${what} has no ground`).toBeDefined();
}

const cmd = (c: Partial<UserCmd> = {}): UserCmd => ({ pitch: 0, yaw: 0, forwardmove: 0, sidemove: 0, buttons: 0, ...c });

/**
 * Apex of a sustained autobhop, measured with the real playerMove: hold jump on a flat floor at
 * 400 u/s and take the highest apex after the first few hops. With BHOP_CVARS' modern jump
 * (sv_legacy_jump 0) the landing penalty makes chained hops ~44 units high; with the legacy jump
 * they are ~55.8. The ballistic checks below use whatever the movement code does now.
 */
function measureHopApex(cvars: Cvars): number {
	const world = buildCollisionWorld({
		brushes: [{ type: 'box', min: { x: -1e5, y: -1e5, z: -64 }, max: { x: 1e5, y: 1e5, z: 0 }, material: 'm' }]
	});
	const p = createPlayer({ x: 0, y: 0, z: CLEARANCE });
	for (let i = 0; i < 16; i++) playerMove(world, p, cmd(), cvars);
	p.velocity.x = 400;
	let hops = 0;
	let apex = 0;
	let sustained = Infinity;
	for (let i = 0; i < 20 / TICK_INTERVAL && hops < 8; i++) {
		playerMove(world, p, cmd({ buttons: IN_JUMP }), cvars);
		apex = Math.max(apex, p.origin.z);
		if (p.jumped) {
			if (hops >= 3) sustained = Math.min(sustained, apex);
			hops++;
			apex = 0;
		}
	}
	return sustained;
}
const HOP_APEX = measureHopApex(BHOP_CVARS);

/** Airtime of a hop with apex `apex` that lands `dh` higher (negative = lower); NaN if unreachable. */
function airtime(dh: number, apex = HOP_APEX): number {
	const impulse = Math.sqrt(2 * GRAVITY * apex);
	return (impulse + Math.sqrt(impulse * impulse - 2 * GRAVITY * dh)) / GRAVITY;
}

const finalRange = RIMEFALL_SECTIONS[RIMEFALL_FINAL_SECTION]!;

describe('bhop_rimefall map', () => {
	it('is a hard linear bhop map with the bhop physics profile', () => {
		expect(m.id).toBe('bhop_rimefall');
		expect(m.kind).toBe('bhop');
		expect(m.difficulty).toBe('hard');
		expect(m.layout).toBe('linear');
		expect(m.cvars).toEqual(BHOP_CVARS);
	});

	it('has exactly one start and one end zone, apart', () => {
		expect(zonesOf('start')).toHaveLength(1);
		expect(zonesOf('end')).toHaveLength(1);
		expect(zonesOf('stage')).toHaveLength(0);
		expect(overlaps(zonesOf('start')[0]!, zonesOf('end')[0]!)).toBe(false);
		for (const c of zonesOf('checkpoint')) expect(overlaps(zonesOf('end')[0]!, c)).toBe(false);
	});

	it('numbers checkpoints 1..6 in path order', () => {
		expect(zonesOf('checkpoint').map((z) => z.index)).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('spawns standing on the start pad inside the start zone', () => {
		expect(inBox(m.spawn.pos, zonesOf('start')[0]!)).toBe(true);
		expect(inBox(m.spawn.pos, path[0]!)).toBe(true);
		checkStanding(m.spawn, 'spawn');
	});

	it('respawns stand on ground inside their zones, facing travel', () => {
		for (const z of zonesOf('checkpoint')) {
			expect(inBox(z.respawn.pos, z), `checkpoint ${z.index} respawn outside zone`).toBe(true);
			checkStanding(z.respawn, `checkpoint ${z.index} respawn`);
		}
	});

	it('spawn and respawns are free in the real trace (after the registry lift)', () => {
		const world = buildCollisionWorld(m);
		for (const s of respawns()) {
			const p = lifted(s);
			expect(world.trace(p, p, HULL_MIN, HULL_MAX).startsolid).toBe(false);
			expect(world.trace(p, { ...p, z: p.z - 2 }, HULL_MIN, HULL_MAX).fraction).toBeLessThan(1);
		}
	});

	it('zones are generous (≥ 128 tall)', () => {
		for (const z of m.zones) if (z.type !== 'teleport') expect(z.max.z - z.min.z).toBeGreaterThanOrEqual(128 + 16);
	});

	it('every brush material exists; theme uses known effects and deep fog', () => {
		for (const b of m.brushes) expect(m.theme.materials[b.material], b.material).toBeDefined();
		for (const e of m.theme.effects) expect(EFFECTS.has(e.type), e.type).toBe(true);
		expect(m.theme.effects.map((e) => e.type)).toEqual(expect.arrayContaining(['aurora', 'snowFloor']));
		expect(m.theme.fogFar).toBeGreaterThanOrEqual(12000);
	});

	it('box brushes do not intersect each other', () => {
		for (let i = 0; i < boxes.length; i++)
			for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!), `boxes ${i} and ${j}`).toBe(false);
	});

	it('has a teleport under everything and one under each section, all to the stage', () => {
		const tps = zonesOf('teleport');
		for (const tp of tps) expect(tp.to).toBe('stage');
		const all = boundsOf(m.brushes);
		const under = tps.find(
			(z) => z.max.z <= all.min.z && z.min.x <= all.min.x && z.min.y <= all.min.y && z.max.x >= all.max.x && z.max.y >= all.max.y
		);
		expect(under).toBeDefined();
		expect(RIMEFALL_SECTIONS).toHaveLength(6);
		for (const [first, last] of RIMEFALL_SECTIONS) {
			const sec = boundsOf(m.brushes.slice(first, last + 1));
			const tp = tps.find(
				(z) =>
					z !== under &&
					z.max.z <= sec.min.z &&
					z.min.x <= sec.min.x &&
					z.min.y <= sec.min.y &&
					z.max.x >= sec.max.x &&
					z.max.y >= sec.max.y
			);
			expect(tp, `section ${first}..${last} teleport`).toBeDefined();
		}
	});

	it('teleport zones touch no brush, spawn or respawn', () => {
		for (const tp of zonesOf('teleport')) {
			for (const b of m.brushes) expect(overlaps(tp, brushBounds(b)), 'teleport overlaps a brush').toBe(false);
			for (const s of respawns()) expect(inBox(lifted(s), tp)).toBe(false);
		}
	});
});

describe('bhop_rimefall path', () => {
	it('matches the map brushes', () => {
		expect(boxes.length).toBe(path.length);
		path.forEach((n, i) => {
			expect(boxes[i]!.min).toEqual(n.min);
			expect(boxes[i]!.max).toEqual(n.max);
		});
	});

	it('has ~65 jumps in 6 sections, start to end', () => {
		const jumpable = path.filter((n) => n.kind === 'block' || n.kind === 'strip').length;
		expect(jumpable).toBeGreaterThanOrEqual(62);
		expect(jumpable).toBeLessThanOrEqual(68);
		expect(path.filter((n) => n.kind === 'checkpoint').length + 1).toBe(6);
		expect(path[0]!.kind).toBe('start');
		expect(path[path.length - 1]!.kind).toBe('end');
		// Sections tile the path after the start pad.
		expect(RIMEFALL_SECTIONS[0]![0]).toBe(1);
		for (let s = 1; s < 6; s++) expect(RIMEFALL_SECTIONS[s]![0]).toBe(RIMEFALL_SECTIONS[s - 1]![1] + 1);
		expect(RIMEFALL_SECTIONS[5]![1]).toBe(path.length - 1);
	});

	it('block and strip sizes are in range', () => {
		for (const n of path) {
			const sx = n.max.x - n.min.x;
			const sy = n.max.y - n.min.y;
			if (n.kind === 'block') {
				expect(sx).toBeCloseTo(sy, 3);
				expect(sx).toBeGreaterThanOrEqual(48 - 1e-6);
				expect(sx).toBeLessThanOrEqual(64 + 1e-6);
			} else if (n.kind === 'strip') {
				expect(Math.min(sx, sy)).toBeGreaterThanOrEqual(24 - 1e-6);
				expect(Math.min(sx, sy)).toBeLessThanOrEqual(32 + 1e-6);
				expect(Math.max(sx, sy)).toBeGreaterThanOrEqual(256 - 1e-6);
			} else if (n.kind === 'checkpoint') {
				expect(sx).toBeCloseTo(192, 3);
				expect(sy).toBeCloseTo(192, 3);
			} else {
				expect(Math.min(sx, sy)).toBeGreaterThanOrEqual(256 - 1e-6);
			}
		}
	});

	it('is harder than bhop_circuit: smaller tops, narrower strips, longer gaps', () => {
		const blocks = path.filter((n) => n.kind === 'block');
		expect(blocks.filter((n) => n.max.x - n.min.x < 64 - 1e-6).length).toBeGreaterThan(blocks.length / 2);
		expect(path.some((n) => n.kind === 'strip' && Math.min(n.max.x - n.min.x, n.max.y - n.min.y) < 32 - 1e-6)).toBe(true);
		const gaps = path.slice(1).map((n, i) => gapXY(path[i]!, n));
		expect(Math.max(...gaps)).toBeGreaterThan(240);
	});

	it('measures a sane sustained hop apex', () => {
		console.log(`rimefall: sustained autobhop apex ${HOP_APEX.toFixed(2)} units`);
		expect(HOP_APEX).toBeGreaterThan(38);
		expect(HOP_APEX).toBeLessThan(58);
	});

	it('gaps and height changes are in range and jumpable at 380 u/s with the measured hop', () => {
		for (let i = 1; i < path.length; i++) {
			const a = path[i - 1]!;
			const b = path[i]!;
			const gap = gapXY(a, b);
			const dh = b.max.z - a.max.z;
			expect(gap, `gap ${i}`).toBeGreaterThanOrEqual(128 - 0.01);
			expect(gap, `gap ${i}`).toBeLessThanOrEqual(248 + 0.01);
			expect(dh, `rise ${i}`).toBeLessThanOrEqual(40);
			const t = airtime(dh);
			expect(Number.isNaN(t), `rise ${i} unreachable`).toBe(false);
			expect(380 * t, `jump ${i}: gap ${gap.toFixed(1)}, dh ${dh}`).toBeGreaterThanOrEqual(gap);
		}
	});

	it('the spiral turns 30° every jump for a full turn and climbs up to +32 per block', () => {
		const [first, last] = RIMEFALL_SECTIONS[1]!;
		let turns = 0;
		let climbs = 0;
		for (let i = first; i <= last; i++) {
			const turn = path[i]!.yaw - path[i - 1]!.yaw;
			if (turn !== 0) {
				expect(Math.abs(turn)).toBe(30);
				turns += turn;
			}
			const dh = path[i]!.max.z - path[i - 1]!.max.z;
			expect(dh).toBeLessThanOrEqual(32);
			if (dh === 32) climbs++;
		}
		expect(Math.abs(turns)).toBe(360);
		expect(climbs).toBeGreaterThanOrEqual(6);
	});

	it('the weave is narrow strips joined by 90° turns', () => {
		const [first, last] = RIMEFALL_SECTIONS[2]!;
		const strips = path.slice(first, last + 1).filter((n) => n.kind === 'strip');
		expect(strips.length).toBeGreaterThanOrEqual(8);
		for (let i = first; i <= last; i++) {
			if (path[i]!.kind !== 'strip') continue;
			expect(Math.abs(path[i]!.yaw - path[i - 1]!.yaw), `strip ${i}`).toBe(90);
		}
	});

	it('the serac section alternates up 40 / down 40', () => {
		const [first, last] = RIMEFALL_SECTIONS[3]!;
		for (let i = first; i < last; i++) {
			const dh = path[i]!.max.z - path[i - 1]!.max.z;
			expect(Math.abs(dh), `serac ${i}`).toBe(40);
			if (i > first) expect(Math.sign(dh)).toBe(-Math.sign(path[i - 1]!.max.z - path[i - 2]!.max.z));
		}
	});

	it('the final straight is flat, straight and needs speed: it passes at 420, fails at 300', () => {
		const [first, last] = finalRange;
		// Fails at 300 even with the full legacy-jump hop (55.8), so it stays a speed check if bhop switches.
		const tLegacy = (dh: number) => airtime(dh, 55.8);
		for (let i = first; i <= last; i++) {
			const gap = gapXY(path[i - 1]!, path[i]!);
			const dh = path[i]!.max.z - path[i - 1]!.max.z;
			expect(dh).toBe(0);
			expect(path[i]!.yaw).toBe(path[first - 1]!.yaw);
			expect(420 * airtime(dh), `final ${i}: gap ${gap}`).toBeGreaterThanOrEqual(gap);
			expect(300 * airtime(dh), `final ${i} should need speed: gap ${gap}`).toBeLessThan(gap);
			expect(300 * tLegacy(dh), `final ${i} should need speed (legacy hop): gap ${gap}`).toBeLessThan(gap);
		}
		expect(last - first).toBeGreaterThanOrEqual(9);
		for (let i = first; i < last; i++) expect(path[i]!.max.x - path[i]!.min.x).toBeCloseTo(48, 3);
	});
});

// ---------------------------------------------------------------------------
// Physics bot: real playerMove + collision, scripted strafes, section 1.

const DEG = 180 / Math.PI;
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/** Point of `b` (shrunk by up to 16 per side) nearest to `p`, on its top: land just past the near edge. */
function aimPoint(b: Box3, p: Vec3): Vec3 {
	const ix = Math.min(16, (b.max.x - b.min.x) / 2);
	const iy = Math.min(16, (b.max.y - b.min.y) / 2);
	return {
		x: Math.min(Math.max(p.x, b.min.x + ix), b.max.x - ix),
		y: Math.min(Math.max(p.y, b.min.y + iy), b.max.y - iy),
		z: b.max.z
	};
}

/**
 * One tick of bot input towards `target`: perfect perpendicular strafes (the most speed per tick)
 * while too slow for the landing, a feathered back-press while too fast, and strafes to correct the
 * heading. Velocity is planned for landing at the aim point when the jump comes down to its top.
 */
function botCmd(p: PlayerState, target: Box3, jump: boolean): UserCmd {
	const aim = aimPoint(target, p.origin);
	const dx = aim.x - p.origin.x;
	const dy = aim.y - p.origin.y;
	const dist = Math.hypot(dx, dy);
	const vz = p.onGround ? BHOP_CVARS.sv_jump_impulse : p.velocity.z;
	const disc = vz * vz + 2 * GRAVITY * (p.origin.z - aim.z);
	const tLand = Math.max(TICK_INTERVAL, (vz + Math.sqrt(Math.max(0, disc))) / GRAVITY);
	const need = dist / tLand;
	const s = Math.hypot(p.velocity.x, p.velocity.y);
	const heading = s > 1 ? Math.atan2(p.velocity.y, p.velocity.x) * DEG : Math.atan2(dy, dx) * DEG;
	const bearing = Math.atan2(dy, dx) * DEG;
	const err = wrap(bearing - heading);
	const buttons = jump ? IN_JUMP : 0;
	if (p.onGround) return cmd({ yaw: bearing, forwardmove: 450, buttons });
	// About to land: no input, so nothing is clipped off the landing speed.
	if (vz < 0 && tLand < 3 * TICK_INTERVAL) return cmd({ yaw: heading, buttons });
	const strafe = cmd({ yaw: heading, sidemove: err > 0 ? -450 : 450, buttons });
	if (s < need - 1) return strafe;
	if (Math.abs(err) > 1.5) return strafe;
	if (s > need + 1) {
		// accelspeed = airaccelerate * wishspeed * dt (* surfaceFriction <= 1): pick wishspeed to shed at most the excess.
		const wish = Math.min(250, (s - need) / (BHOP_CVARS.sv_airaccelerate * TICK_INTERVAL));
		return cmd({ yaw: heading, forwardmove: -wish, buttons });
	}
	return cmd({ yaw: heading, buttons });
}

describe('bhop_rimefall physics bot', () => {
	it('bhops section 1 with scripted strafes and reaches checkpoint 1', () => {
		const world = buildCollisionWorld(m);
		const start = path[0]!;
		const [first, last] = RIMEFALL_SECTIONS[0]!;
		const cp1 = zonesOf('checkpoint').find((z) => z.index === 1)!;
		// Start at the back of the pad, run to its front edge, then jump and hold jump (autobhop).
		const startZone = zonesOf('start')[0]!;
		// Targets: one pre-hop onto the front of the start pad, then every node of section 1.
		const preHop: Box3 = { min: { ...start.min, x: start.max.x - 96 }, max: { ...start.max, x: start.max.x - 16 } };
		const targets: Box3[] = [preHop, ...path.slice(first, last + 1)];
		// Start at the back of the pad, run up to speed, then hold jump (autobhop) for the rest.
		const p = createPlayer({ x: start.min.x + 32, y: 0, z: start.max.z + CLEARANCE });
		let ti = 0;
		let jumping = false;
		let reached = false;
		let capped = false;
		const landings: string[] = [];
		for (let tick = 0; tick < 30 / TICK_INTERVAL; tick++) {
			if (!jumping && p.onGround && Math.hypot(p.velocity.x, p.velocity.y) >= 249) jumping = true;
			const wasAir = !p.onGround;
			const c = botCmd(p, targets[ti]!, jumping);
			playerMove(world, p, c, BHOP_CVARS);
			// Run tracker prespeed cap (docs/gameplay.md): leaving the start zone caps speed at 290.
			if (!capped && !inBox(p.origin, startZone)) {
				capped = true;
				const sp = Math.hypot(p.velocity.x, p.velocity.y);
				if (sp > PRESPEED_CAP) {
					p.velocity.x *= PRESPEED_CAP / sp;
					p.velocity.y *= PRESPEED_CAP / sp;
				}
			}
			if (wasAir && p.onGround && jumping) {
				const node = targets[ti]!;
				const on =
					Math.abs(p.origin.z - node.max.z) < 2 &&
					p.origin.x >= node.min.x - HULL_HALF &&
					p.origin.x <= node.max.x + HULL_HALF &&
					p.origin.y >= node.min.y - HULL_HALF &&
					p.origin.y <= node.max.y + HULL_HALF;
				landings.push(`${ti}:${on ? 'ok' : 'MISS'}@${Math.hypot(p.velocity.x, p.velocity.y).toFixed(0)}`);
				expect(on, `landed off target ${ti} at (${p.origin.x.toFixed(1)}, ${p.origin.y.toFixed(1)}, ${p.origin.z.toFixed(1)})`).toBe(true);
				if (ti < targets.length - 1) ti++;
			}
			if (inBox(p.origin, cp1)) {
				reached = true;
				break;
			}
			expect(p.origin.z, `fell at target ${ti}: ${landings.join(' ')}`).toBeGreaterThan(start.max.z - 128);
		}
		console.log(`rimefall bot section 1: ${landings.join(' ')}`);
		expect(reached).toBe(true);
	});
});
