import { describe, expect, it } from 'vitest';
import { buildCollisionWorld } from '../collision/world.ts';
import { BHOP_CVARS } from '../cvars.ts';
import { HULL_MAX, HULL_MIN, IN_JUMP, type PlayerState, type UserCmd } from '../movement/api.ts';
import { createPlayer, playerMove } from '../movement/gamemovement.ts';
import type { Vec3 } from '../types.ts';
import { TICK_INTERVAL } from '../units.ts';
import {
	bhop_reliquary,
	RELIQUARY_LONGJUMPS,
	RELIQUARY_PATH,
	RELIQUARY_SECTIONS,
	RELIQUARY_SECTION_TELEPORTS
} from './bhop_reliquary.ts';
import { boundsOf, brushBounds, gapXY, topCenter, type Box3, type BoxBrush } from './helpers.ts';
import type { MapDef, Spawn, Zone } from './types.ts';

const GRAVITY = 800;
const HULL_HALF = 16;
const HULL_HEIGHT = 72;
/** The registry (index.ts) lifts spawns by SPAWN_CLEARANCE; mirrored here so this test does not depend on registration. */
const CLEARANCE = 0.25;
/** Conservative jump: a 55-unit apex (the simulated standing jump reaches ~55.8). */
const JUMP_VZ = Math.sqrt(2 * GRAVITY * 55);
const NORMAL_SPEED = 380;
const LONGJUMP_SPEED = 420;
const SLOW_SPEED = 300;

/** Copy of the map with spawns lifted as the registry does. */
function lifted(src: MapDef): MapDef {
	const m: MapDef = structuredClone(src);
	m.spawn.pos.z += CLEARANCE;
	for (const z of m.zones) if (z.type === 'stage' || z.type === 'checkpoint') z.respawn.pos.z += CLEARANCE;
	return m;
}
const m = lifted(bhop_reliquary);
const path = RELIQUARY_PATH;

const boxes = (map: MapDef): BoxBrush[] => map.brushes.filter((b): b is BoxBrush => b.type === 'box');
const inBox = (p: Vec3, b: Box3) =>
	p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;
const overlaps = (a: Box3, b: Box3, eps = 0.01) =>
	a.min.x < b.max.x - eps &&
	b.min.x < a.max.x - eps &&
	a.min.y < b.max.y - eps &&
	b.min.y < a.max.y - eps &&
	a.min.z < b.max.z - eps &&
	b.min.z < a.max.z - eps;
type ZoneOf<T extends Zone['type']> = Zone & { type: T } & (T extends 'stage' | 'checkpoint' ? { index: number; respawn: Spawn } : unknown);
const zonesOf = <T extends Zone['type']>(map: MapDef, type: T) =>
	map.zones.filter((z): z is ZoneOf<T> => z.type === type);
const respawns = (map: MapDef): Spawn[] => [map.spawn, ...zonesOf(map, 'checkpoint').map((z) => z.respawn)];

/** Airtime of a jump (launch vz) that lands `dh` higher (negative = lower); NaN if unreachable. */
function airtime(dh: number, vz = JUMP_VZ): number {
	return (vz + Math.sqrt(vz * vz - 2 * GRAVITY * dh)) / GRAVITY;
}
const yawDelta = (a: number, b: number) => {
	let d = Math.abs(b - a) % 360;
	if (d > 180) d = 360 - d;
	return d;
};

describe('bhop_reliquary map', () => {
	it('is a hard linear bhop map on the bhop cvars', () => {
		expect(m.id).toBe('bhop_reliquary');
		expect(m.kind).toBe('bhop');
		expect(m.difficulty).toBe('hard');
		expect(m.layout).toBe('linear');
		expect(m.cvars).toEqual(BHOP_CVARS);
	});

	it('has one start and one end zone, apart', () => {
		expect(zonesOf(m, 'start')).toHaveLength(1);
		expect(zonesOf(m, 'end')).toHaveLength(1);
		expect(zonesOf(m, 'stage')).toHaveLength(0);
		expect(overlaps(zonesOf(m, 'start')[0]!, zonesOf(m, 'end')[0]!)).toBe(false);
		for (const c of zonesOf(m, 'checkpoint')) expect(overlaps(zonesOf(m, 'end')[0]!, c)).toBe(false);
	});

	it('numbers checkpoints 1..7 in path order', () => {
		const cps = zonesOf(m, 'checkpoint');
		expect(cps.map((z) => z.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		// Checkpoints 1..6 sit on the section pads, 7 on the end terrace.
		const pads = path.filter((n) => n.kind === 'checkpoint');
		expect(pads).toHaveLength(6);
		pads.forEach((pad, i) => expect(inBox(topCenter(pad), cps[i]!)).toBe(true));
		expect(inBox(cps[6]!.respawn.pos, zoneBoxOf(path[path.length - 1]!))).toBe(true);
	});

	it('spawns standing inside the start zone; respawns stand inside their zones', () => {
		expect(inBox(m.spawn.pos, zonesOf(m, 'start')[0]!)).toBe(true);
		for (const z of zonesOf(m, 'checkpoint')) expect(inBox(z.respawn.pos, z), `checkpoint ${z.index}`).toBe(true);
		for (const s of respawns(m)) {
			const hull: Box3 = {
				min: { x: s.pos.x - HULL_HALF, y: s.pos.y - HULL_HALF, z: s.pos.z },
				max: { x: s.pos.x + HULL_HALF, y: s.pos.y + HULL_HALF, z: s.pos.z + HULL_HEIGHT }
			};
			for (const b of boxes(m)) expect(overlaps(hull, b)).toBe(false);
			const ground = boxes(m).find(
				(b) =>
					Math.abs(b.max.z - s.pos.z) <= 1 &&
					s.pos.x >= b.min.x &&
					s.pos.x <= b.max.x &&
					s.pos.y >= b.min.y &&
					s.pos.y <= b.max.y
			);
			expect(ground).toBeDefined();
		}
	});

	it('spawn and respawns are free and grounded in the real trace', () => {
		const world = buildCollisionWorld(m);
		for (const { pos } of respawns(m)) {
			expect(world.trace(pos, pos, HULL_MIN, HULL_MAX).startsolid).toBe(false);
			expect(world.trace(pos, { ...pos, z: pos.z - 2 }, HULL_MIN, HULL_MAX).fraction).toBeLessThan(1);
		}
	});

	it('zones are generous (≥ 128 tall)', () => {
		for (const z of m.zones) if (z.type !== 'teleport') expect(z.max.z - z.min.z).toBeGreaterThanOrEqual(144);
	});

	it('uses only existing materials and a far fog', () => {
		for (const b of m.brushes) expect(m.theme.materials[b.material], b.material).toBeDefined();
		expect(m.theme.fogFar).toBeGreaterThanOrEqual(12000);
		const known = new Set(['aurora', 'embers', 'clouds', 'gridFloor', 'lavaSea', 'snowFloor']);
		for (const e of m.theme.effects) expect(known.has(e.type)).toBe(true);
	});

	it('box brushes do not intersect each other', () => {
		const bs = boxes(m);
		for (let i = 0; i < bs.length; i++)
			for (let j = i + 1; j < bs.length; j++) expect(overlaps(bs[i]!, bs[j]!), `boxes ${i} and ${j}`).toBe(false);
	});

	it('has a teleport under each section and one under everything, all to the last checkpoint', () => {
		const tps = zonesOf(m, 'teleport');
		expect(tps.length).toBe(RELIQUARY_SECTIONS.length + 1);
		for (const tp of tps) expect(tp.to).toBe('stage');
		RELIQUARY_SECTIONS.forEach(([first, last], k) => {
			const g = boundsOf(m.brushes.slice(first, last + 1));
			const tp = RELIQUARY_SECTION_TELEPORTS[k]!;
			expect(tp.max.z, `section ${k + 1}`).toBeLessThan(g.min.z);
			expect(tp.min.x <= g.min.x && tp.min.y <= g.min.y && tp.max.x >= g.max.x && tp.max.y >= g.max.y).toBe(true);
		});
		const all = boundsOf(m.brushes);
		const under = tps.find(
			(z) =>
				z.max.z <= all.min.z && z.min.x <= all.min.x && z.min.y <= all.min.y && z.max.x >= all.max.x && z.max.y >= all.max.y
		);
		expect(under).toBeDefined();
	});

	it('teleports touch no brush, spawn or respawn', () => {
		for (const tp of zonesOf(m, 'teleport')) {
			for (const b of m.brushes) expect(overlaps(tp, brushBounds(b)), 'teleport overlaps a brush').toBe(false);
			for (const s of respawns(m)) expect(inBox(s.pos, tp)).toBe(false);
		}
	});
});

/** Zone-like box over a node's top (for respawn containment). */
function zoneBoxOf(n: Box3): Box3 {
	return { min: { ...n.min, z: n.max.z - 16 }, max: { ...n.max, z: n.max.z + 192 } };
}

describe('bhop_reliquary path', () => {
	it('matches the map brushes', () => {
		expect(boxes(m).length).toBe(path.length);
		path.forEach((n, i) => {
			expect(boxes(m)[i]!.min).toEqual(n.min);
			expect(boxes(m)[i]!.max).toEqual(n.max);
		});
	});

	it('has ~70 jumps in 7 sections', () => {
		const jumpable = path.filter((n) => n.kind === 'block' || n.kind === 'strip').length;
		expect(jumpable).toBeGreaterThanOrEqual(64);
		expect(jumpable).toBeLessThanOrEqual(72);
		expect(path.length - 1).toBeGreaterThanOrEqual(70); // jumps = nodes after the start pad
		expect(RELIQUARY_SECTIONS).toHaveLength(7);
		expect(path[0]!.kind).toBe('start');
		expect(path[path.length - 1]!.kind).toBe('end');
		RELIQUARY_SECTIONS.forEach(([, last], k) => expect(path[last]!.kind).toBe(k < 6 ? 'checkpoint' : 'end'));
	});

	it('block, strip and pad sizes are in range', () => {
		const sizes = new Set<number>();
		for (const n of path) {
			const sx = n.max.x - n.min.x;
			const sy = n.max.y - n.min.y;
			if (n.kind === 'block') {
				expect(sx).toBeCloseTo(sy, 3);
				expect([48, 64]).toContain(Math.round(sx));
				sizes.add(Math.round(sx));
			} else if (n.kind === 'strip') {
				expect(Math.min(sx, sy)).toBeGreaterThanOrEqual(24 - 1e-6);
				expect(Math.min(sx, sy)).toBeLessThanOrEqual(32 + 1e-6);
				expect(Math.max(sx, sy)).toBeGreaterThanOrEqual(256 - 1e-6);
				expect(Math.max(sx, sy)).toBeLessThanOrEqual(448 + 1e-6);
			} else if (n.kind === 'checkpoint') {
				expect(sx).toBeCloseTo(192, 3);
				expect(sy).toBeCloseTo(192, 3);
			} else {
				expect(Math.min(sx, sy)).toBeGreaterThanOrEqual(256 - 1e-6);
			}
		}
		expect([...sizes].sort()).toEqual([48, 64]);
	});

	it('gaps and height changes are in range and jumpable at 380 u/s (55-unit apex)', () => {
		const longjumps = new Set(RELIQUARY_LONGJUMPS);
		for (let i = 1; i < path.length; i++) {
			const a = path[i - 1]!;
			const b = path[i]!;
			const gap = gapXY(a, b);
			const dh = b.max.z - a.max.z;
			expect(gap, `gap ${i}`).toBeGreaterThanOrEqual(144 - 0.01);
			expect(gap, `gap ${i}`).toBeLessThanOrEqual(256 + 0.01);
			expect(dh, `rise ${i}`).toBeLessThanOrEqual(40);
			expect(dh, `drop ${i}`).toBeGreaterThanOrEqual(-128);
			const t = airtime(dh);
			expect(Number.isNaN(t), `rise ${i} unreachable`).toBe(false);
			const speed = longjumps.has(i) ? LONGJUMP_SPEED : NORMAL_SPEED;
			expect(speed * t, `jump ${i}: gap ${gap.toFixed(1)}, dh ${dh}`).toBeGreaterThanOrEqual(gap);
		}
	});

	it('longjump gaps need built speed: they fail at 300 u/s', () => {
		expect(RELIQUARY_LONGJUMPS.length).toBeGreaterThanOrEqual(7);
		for (const i of RELIQUARY_LONGJUMPS) {
			const gap = gapXY(path[i - 1]!, path[i]!);
			const t = airtime(path[i]!.max.z - path[i - 1]!.max.z);
			expect(gap).toBeGreaterThanOrEqual(232 - 0.01);
			expect(SLOW_SPEED * t, `longjump ${i}`).toBeLessThan(gap);
			expect(LONGJUMP_SPEED * t, `longjump ${i}`).toBeGreaterThanOrEqual(gap);
		}
	});

	it('has the documented features: sharp alternating turns, +40 climbs, −128 drops, a descending stair', () => {
		const turns = path.slice(1).map((n, i) => {
			const d = n.yaw - path[i]!.yaw;
			return { abs: yawDelta(path[i]!.yaw, n.yaw), sign: Math.sign(d) };
		});
		expect(turns.filter((t) => t.abs >= 90).length).toBeGreaterThanOrEqual(20);
		expect(turns.some((t) => t.abs >= 120)).toBe(true);
		// Consecutive opposite 90°+ turns.
		let alternating = 0;
		for (let i = 1; i < turns.length; i++)
			if (turns[i]!.abs >= 90 && turns[i - 1]!.abs >= 90 && turns[i]!.sign === -turns[i - 1]!.sign) alternating++;
		expect(alternating).toBeGreaterThanOrEqual(8);
		const dhs = path.slice(1).map((n, i) => n.max.z - path[i]!.max.z);
		expect(Math.max(...dhs)).toBe(40);
		expect(Math.min(...dhs)).toBe(-128);
		// Section 5: every node a step down.
		const [first, last] = RELIQUARY_SECTIONS[4]!;
		for (let i = first; i <= last; i++) expect(path[i]!.max.z, `stair node ${i}`).toBeLessThan(path[i - 1]!.max.z);
	});

	it('no jump arc passes through a teleport', () => {
		const tps = zonesOf(m, 'teleport');
		for (let i = 1; i < path.length; i++) {
			const a = topCenter(path[i - 1]!);
			const b = topCenter(path[i]!);
			const t = airtime(b.z - a.z);
			for (let k = 0; k <= 64; k++) {
				const u = (k / 64) * t;
				const p = {
					x: a.x + ((b.x - a.x) * k) / 64,
					y: a.y + ((b.y - a.y) * k) / 64,
					z: a.z + JUMP_VZ * u - 0.5 * GRAVITY * u * u
				};
				for (const tp of tps) expect(inBox(p, tp), `jump ${i}`).toBe(false);
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Physics bot: real playerMove on the real collision world, autobhop held.

const cmdOf = (yaw: number, forwardmove: number, buttons: number): UserCmd => ({ pitch: 0, yaw, forwardmove, sidemove: 0, buttons });
const DEG = 180 / Math.PI;

/**
 * Air steering towards the centre of the target top. By default strafe
 * perpendicular to the velocity (the speed-gaining strafe), on the side of the
 * bearing to the target, so the heading weaves tightly around that bearing.
 * When the predicted landing would pass the target centre by more than
 * `slack`, brake along -velocity just enough to land `slack / 2` past it.
 */
function airCmd(p: PlayerState, target: Vec3, slack: number): UserCmd {
	const { x, y, z } = p.origin;
	const v = p.velocity;
	const disc = v.z * v.z + 2 * GRAVITY * (z - target.z);
	const T = disc > 0 ? (v.z + Math.sqrt(disc)) / GRAVITY : 0;
	const bx = target.x - x;
	const by = target.y - y;
	const dist = Math.hypot(bx, by);
	const speed = Math.hypot(v.x, v.y);
	const vyaw = Math.atan2(v.y, v.x) * DEG;
	if (T > 0.05 && speed * T > dist + slack) {
		const excess = speed - (dist + slack / 2) / T;
		const rate = BHOP_CVARS.sv_airaccelerate * p.surfaceFriction * TICK_INTERVAL;
		return cmdOf(vyaw + 180, Math.min(250, excess / rate), IN_JUMP);
	}
	const cross = v.x * by - v.y * bx; // > 0: target bearing is to the left of the velocity
	return cmdOf(vyaw + (cross > 0 ? 90 : -90), 450, IN_JUMP);
}

describe('bhop_reliquary physics bot', () => {
	it('bhops section 1 with scripted strafes and reaches checkpoint 1', () => {
		const world = buildCollisionWorld(m);
		const cp1 = zonesOf(m, 'checkpoint')[0]!;
		const tps = zonesOf(m, 'teleport');
		const p = createPlayer({ ...m.spawn.pos });
		for (let i = 0; i < 16; i++) playerMove(world, p, cmdOf(0, 0, 0), BHOP_CVARS, TICK_INTERVAL);
		expect(p.onGround).toBe(true);

		const [, cpIndex] = RELIQUARY_SECTIONS[0]!;
		const startPad = path[0]!;
		const nodeAt = (o: Vec3) =>
			path.findIndex(
				(n) =>
					o.x >= n.min.x - HULL_HALF &&
					o.x <= n.max.x + HULL_HALF &&
					o.y >= n.min.y - HULL_HALF &&
					o.y <= n.max.y + HULL_HALF &&
					Math.abs(o.z - n.max.z) < 8
			);
		let target = 1;
		let jumping = false;
		let reached = false;
		let maxSpeed = 0;
		const landings: string[] = [];
		for (let tick = 0; tick < 60 / TICK_INTERVAL && !reached; tick++) {
			const tc = topCenter(path[target]!);
			let c: UserCmd;
			if (!jumping) {
				// Run up to the start pad's front edge, then hold jump.
				jumping = startPad.max.x - p.origin.x < 24;
				c = cmdOf(Math.atan2(tc.y - p.origin.y, tc.x - p.origin.x) * DEG, 450, jumping ? IN_JUMP : 0);
			} else c = p.onGround ? cmdOf(0, 0, IN_JUMP) : airCmd(p, tc, (path[target]!.max.x - path[target]!.min.x) / 2 - 12);
			const wasAir = !p.onGround;
			playerMove(world, p, c, BHOP_CVARS, TICK_INTERVAL);
			maxSpeed = Math.max(maxSpeed, Math.hypot(p.velocity.x, p.velocity.y));
			if (wasAir && (p.onGround || p.jumped)) {
				const at = nodeAt(p.origin);
				landings.push(`${at}@${Math.hypot(p.velocity.x, p.velocity.y).toFixed(0)}`);
				expect(at, `landed off target ${target} at ${JSON.stringify(p.origin)}`).toBe(target);
				target = Math.min(target + 1, cpIndex);
			}
			if (inBox(p.origin, cp1)) reached = true;
			for (const tp of tps) expect(inBox(p.origin, tp), `fell into a teleport (target ${target})`).toBe(false);
		}
		console.log(`reliquary bot: landings ${landings.join(' ')}, max ${maxSpeed.toFixed(0)} u/s`);
		expect(reached).toBe(true);
	});
});
