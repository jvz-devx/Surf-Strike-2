import { describe, expect, it } from 'vitest';
import type { Solid } from '../collision/api.ts';
import { buildCollisionWorld } from '../collision/world.ts';
import { SURF_CVARS } from '../cvars.ts';
import { HULL_MAX, HULL_MIN, type PlayerState, type UserCmd } from '../movement/api.ts';
import { createPlayer, playerMove } from '../movement/gamemovement.ts';
import type { Vec3 } from '../types.ts';
import { TICK_INTERVAL } from '../units.ts';
import type { Spawn, Zone } from './types.ts';
import {
	boundsOf,
	brushBounds,
	launchStates,
	rampAngle,
	rampFaceZ,
	simulateTransfer,
	type BoxBrush,
	type Box3,
	type RampBrush,
	type SurfTransfer
} from './helpers.ts';
import { SKYREND_STAGE_GROUPS, SKYREND_TRANSFERS, surf_skyrend as m } from './surf_skyrend.ts';

const GRAVITY = 800;
const HULL_HALF = 16;
const HULL_HEIGHT = 72;
/** The registry lifts spawns this far above the floor (maps/index.ts SPAWN_CLEARANCE). */
const SPAWN_CLEARANCE = 0.25;
/** Speeds every ramp launch must survive (platform drops are tested at 0 and 250). */
const RAMP_SPEEDS = [700, 800, 1000];

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
const yawOf = (r: RampBrush) => (Math.atan2(r.to.y - r.from.y, r.to.x - r.from.x) * 180) / Math.PI;
const turnOf = (t: SurfTransfer) => {
	if (!('ramps' in t.from) || !('ramps' in t.to)) return 0;
	let d = Math.abs(yawOf(t.to.ramps[0]!) - yawOf(t.from.ramps[0]!)) % 360;
	return d > 180 ? 360 - d : d;
};
/** Authored spawns sit on floor tops (integers); the registry may already have lifted them. */
const lifted = (p: Vec3): Vec3 => ({ ...p, z: Math.round(p.z) + SPAWN_CLEARANCE });

type StageZone = Zone & { type: 'stage'; index: number; respawn: Spawn };
const zonesOf = (type: Zone['type']) => m.zones.filter((z) => z.type === type);
const stageZones = m.zones.filter((z): z is StageZone => z.type === 'stage');
const teleports = zonesOf('teleport') as Array<Zone & { type: 'teleport' }>;
const startZone = zonesOf('start')[0]!;
const endZone = zonesOf('end')[0]!;
/** Every stage start: spawn for stage 1, then each stage zone's respawn. */
const stageStarts: Spawn[] = [m.spawn, ...[...stageZones].sort((a, b) => a.index - b.index).map((z) => z.respawn)];

function checkStanding(s: Spawn, what: string) {
	const pos = lifted(s.pos);
	const hull: Box3 = {
		min: { x: pos.x - HULL_HALF, y: pos.y - HULL_HALF, z: pos.z },
		max: { x: pos.x + HULL_HALF, y: pos.y + HULL_HALF, z: pos.z + HULL_HEIGHT }
	};
	for (const b of boxes) expect(overlaps(hull, b), `${what} hull overlaps a box`).toBe(false);
	const ground = boxes.find(
		(b) => Math.abs(b.max.z - pos.z) <= 1 && pos.x >= b.min.x && pos.x <= b.max.x && pos.y >= b.min.y && pos.y <= b.max.y
	);
	expect(ground, `${what} has no ground`).toBeDefined();
}

/** Separating-axis gap between two convex solids (≤ 0 = touching or intersecting). */
function separation(a: Solid, b: Solid): number {
	const verts = (s: Solid) => s.faces.flatMap((f) => f.vertices);
	const edges = (s: Solid) =>
		s.faces.flatMap((f) => f.vertices.map((v, k) => sub(f.vertices[(k + 1) % f.vertices.length]!, v)));
	const va = verts(a);
	const vb = verts(b);
	const axes: Vec3[] = [...a.faces.map((f) => f.normal), ...b.faces.map((f) => f.normal)];
	for (const ea of edges(a)) for (const eb of edges(b)) axes.push(cross(ea, eb));
	let best = -Infinity;
	for (const ax of axes) {
		const l = Math.hypot(ax.x, ax.y, ax.z);
		if (l < 1e-6) continue;
		const n = { x: ax.x / l, y: ax.y / l, z: ax.z / l };
		const pa = va.map((v) => dot(v, n));
		const pb = vb.map((v) => dot(v, n));
		best = Math.max(best, Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb));
	}
	return best;
}
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

describe('surf_skyrend definition', () => {
	it('is a hard staged surf map on the surf physics profile', () => {
		expect(m.id).toBe('surf_skyrend');
		expect(m.kind).toBe('surf');
		expect(m.difficulty).toBe('easy');
		expect(m.layout).toBe('staged');
		expect(m.cvars).toEqual(SURF_CVARS);
	});

	it('has one start, one end and stage zones 2..7 (7 stages), no checkpoints', () => {
		expect(zonesOf('start')).toHaveLength(1);
		expect(zonesOf('end')).toHaveLength(1);
		expect(zonesOf('checkpoint')).toHaveLength(0);
		expect(overlaps(startZone, endZone)).toBe(false);
		expect(stageZones.map((z) => z.index).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7]);
		expect(SKYREND_STAGE_GROUPS).toHaveLength(7);
		for (const z of m.zones) if (z.type !== 'teleport') expect(z.max.z - z.min.z).toBeGreaterThanOrEqual(128 + 16);
		const all = [startZone, ...stageZones, endZone];
		for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i]!, all[j]!)).toBe(false);
	});

	it('each stage starts on its own platform: stage 1 = start zone, the rest have a stage zone over their platform', () => {
		for (const [i, g] of SKYREND_STAGE_GROUPS.entries()) {
			expect(g[0]!.type).toBe('box');
			const pad = brushBounds(g[0]!);
			const zone = i === 0 ? startZone : stageZones.find((z) => z.index === i + 1)!;
			const top = { x: (pad.min.x + pad.max.x) / 2, y: (pad.min.y + pad.max.y) / 2, z: pad.max.z + 1 };
			expect(inBox(top, zone), `stage ${i + 1} zone over its platform`).toBe(true);
		}
	});

	it('spawns standing on ground inside the start zone; respawns stand inside their zones', () => {
		expect(inBox(m.spawn.pos, startZone)).toBe(true);
		checkStanding(m.spawn, 'spawn');
		for (const z of stageZones) {
			expect(inBox(z.respawn.pos, z), `stage ${z.index} respawn outside zone`).toBe(true);
			checkStanding(z.respawn, `stage ${z.index} respawn`);
		}
	});

	it('spawn and respawns are free in the real trace and stand on something', () => {
		const world = buildCollisionWorld(m);
		for (const s of stageStarts) {
			const p = lifted(s.pos);
			expect(world.trace(p, p, HULL_MIN, HULL_MAX).startsolid).toBe(false);
			expect(world.trace(p, { ...p, z: p.z - 2 }, HULL_MIN, HULL_MAX).fraction).toBeLessThan(1);
		}
	});

	it('every material exists; theme uses known effects and deep fog', () => {
		for (const b of m.brushes) expect(m.theme.materials[b.material], b.material).toBeDefined();
		const known = new Set(['aurora', 'embers', 'clouds', 'gridFloor', 'lavaSea', 'snowFloor']);
		for (const e of m.theme.effects) expect(known.has(e.type)).toBe(true);
		expect(m.theme.fogFar).toBeGreaterThanOrEqual(12000);
	});

	it('box brushes do not intersect each other', () => {
		for (let i = 0; i < boxes.length; i++)
			for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!), `boxes ${i} and ${j}`).toBe(false);
	});

	it('every ramp is one free-standing brush: it touches no other brush (no seams, no ramp bug)', () => {
		const solids = buildCollisionWorld(m).solids;
		for (let i = 0; i < solids.length; i++) {
			if (m.brushes[i]!.type !== 'ramp') continue;
			for (let j = 0; j < solids.length; j++) {
				if (j === i) continue;
				expect(separation(solids[i]!, solids[j]!), `ramp ${i} vs brush ${j}`).toBeGreaterThan(8);
			}
		}
	});
});

describe('surf_skyrend difficulty (harder than surf_ember)', () => {
	it('ramps are 63–68° (below 75°) with faces 192–256 wide', () => {
		expect(ramps.length).toBeGreaterThanOrEqual(15);
		for (const r of ramps) {
			expect(rampAngle(r)).toBeGreaterThanOrEqual(63 - 1e-3);
			expect(rampAngle(r)).toBeLessThanOrEqual(68 + 1e-3);
			expect(r.halfWidth).toBeGreaterThanOrEqual(192);
			expect(r.halfWidth).toBeLessThanOrEqual(256);
		}
	});

	it('has ≥ 3 air turns of 60–120°, one of them > 90°', () => {
		const turns = SKYREND_TRANSFERS.map(turnOf).filter((d) => d >= 59 && d <= 121);
		expect(turns.length).toBeGreaterThanOrEqual(3);
		expect(turns.some((d) => d > 91)).toBe(true);
	});

	it('has two up-ramps, each followed by a transfer that lands higher than the up-ramp top', () => {
		const ups = ramps.filter((r) => r.to.z > r.from.z);
		expect(ups.length).toBeGreaterThanOrEqual(2);
		for (const u of ups) {
			expect(SKYREND_TRANSFERS.some((t) => 'ramps' in t.to && t.to.ramps.includes(u))).toBe(true);
			const next = SKYREND_TRANSFERS.find((t) => 'ramps' in t.from && t.from.ramps.includes(u))!;
			expect('ramps' in next.to).toBe(true);
			if ('ramps' in next.to) expect(next.to.ramps[0]!.from.z).toBeGreaterThan(u.to.z);
		}
	});
});

describe('surf_skyrend transfers (ballistic, point mass)', () => {
	const speedsOf = (t: SurfTransfer) => ('platform' in t.from ? [0, 250] : RAMP_SPEEDS);

	it.each(SKYREND_TRANSFERS.map((t) => [t.label, t] as const))('%s lands', (_label, t) => {
		for (const speed of speedsOf(t)) {
			for (const r of simulateTransfer(t, speed, GRAVITY)) {
				expect(r.ok, `${speed} u/s from (${r.start.x.toFixed(0)}, ${r.start.y.toFixed(0)}, ${r.start.z.toFixed(0)}): ${r.reason}`).toBe(true);
			}
		}
	});

	it.each(SKYREND_TRANSFERS.map((t) => [t.label, t] as const))('%s never passes through a teleport before landing', (_label, t) => {
		for (const speed of speedsOf(t)) {
			const results = simulateTransfer(t, speed, GRAVITY);
			launchStates(t.from, speed).forEach(({ p, vel }, i) => {
				for (let time = 0; time <= results[i]!.time; time += 1 / 128) {
					const at = { x: p.x + vel.x * time, y: p.y + vel.y * time, z: p.z + vel.z * time - 0.5 * GRAVITY * time * time };
					for (const tp of teleports) expect(inBox(at, tp), `${speed} u/s at t=${time.toFixed(2)}`).toBe(false);
				}
			});
		}
	});

	it('the long gap needs speed: 600 u/s falls short, 700 and 800 make it', () => {
		const t = SKYREND_TRANSFERS.find((x) => x.label.includes('long gap'))!;
		expect(simulateTransfer(t, 600, GRAVITY).some((r) => !r.ok)).toBe(true);
		expect(simulateTransfer(t, 700, GRAVITY).every((r) => r.ok)).toBe(true);
		expect(simulateTransfer(t, 800, GRAVITY).every((r) => r.ok)).toBe(true);
	});

	it('covers every ramp and ends on the end platform', () => {
		const used = new Set(SKYREND_TRANSFERS.flatMap((t) => ('ramps' in t.to ? t.to.ramps : [])));
		for (const r of ramps) expect(used.has(r)).toBe(true);
		const last = SKYREND_TRANSFERS.at(-1)!;
		expect('platform' in last.to && inBox(last.to.platform.max, endZone)).toBe(true);
	});
});

describe('surf_skyrend teleports', () => {
	it('one teleport (to stage) lies under everything', () => {
		const all = boundsOf(m.brushes);
		const tp = teleports.find(
			(z) => z.max.z <= all.min.z && z.min.x <= all.min.x && z.min.y <= all.min.y && z.max.x >= all.max.x && z.max.y >= all.max.y
		);
		expect(tp).toBeDefined();
		expect(tp!.to).toBe('stage');
	});

	it('each stage has its own catch teleport (to stage) under it', () => {
		for (const [i, g] of SKYREND_STAGE_GROUPS.entries()) {
			const b = boundsOf(g);
			const tp = teleports.find(
				(z) => z.max.z < b.min.z && z.min.x <= b.min.x && z.min.y <= b.min.y && z.max.x >= b.max.x && z.max.y >= b.max.y && z.max.z > b.min.z - 1024
			);
			expect(tp, `stage ${i + 1} catch`).toBeDefined();
			expect(tp!.to).toBe('stage');
		}
	});

	it('teleports touch no brush, spawn or respawn', () => {
		for (const tp of teleports) {
			for (const b of m.brushes) expect(overlaps(tp, brushBounds(b)), 'teleport overlaps a brush').toBe(false);
			for (const s of stageStarts) expect(inBox(s.pos, tp)).toBe(false);
		}
	});
});

describe('surf_skyrend physics bot (real playerMove)', () => {
	const cmd = (c: Partial<UserCmd>): UserCmd => ({ pitch: 0, yaw: 0, forwardmove: 0, sidemove: 0, buttons: 0, ...c });
	const world = buildCollisionWorld(m);
	const inTeleport = (p: PlayerState) => teleports.some((tp) => inBox(p.origin, tp));

	it.each(stageStarts.map((s, i) => [i + 1, s] as const))(
		'stage %i: walks off the platform onto its first ramp and keeps surfing for 1 s holding strafe into it',
		(stage, s) => {
			const r = SKYREND_STAGE_GROUPS[stage - 1]![1] as RampBrush;
			const p = createPlayer(lifted(s.pos));
			const surfTicks = Math.ceil(1 / TICK_INTERVAL);
			const maxTicks = Math.ceil(8 / TICK_INTERVAL);
			let contact = -1;
			let surfed = 0;
			for (let i = 0; i < maxTicks && surfed < surfTicks; i++) {
				// Walk forward drifting slightly right (onto the right face); once airborne, hold strafe left into the face.
				const c = p.onGround ? cmd({ yaw: s.yaw, forwardmove: 450, sidemove: 90 }) : cmd({ yaw: s.yaw, sidemove: -450 });
				playerMove(world, p, c, SURF_CVARS, TICK_INTERVAL);
				expect(inTeleport(p), `stage ${stage}: fell into a teleport at tick ${i}`).toBe(false);
				if (contact < 0 && p.surfing && p.origin.z < s.pos.z - 32) contact = i;
				if (contact >= 0) {
					expect(p.onGround, `stage ${stage}: grounded at tick ${i}`).toBe(false);
					expect(p.surfing, `stage ${stage}: left the ramp ${i - contact} ticks after contact`).toBe(true);
					surfed++;
				}
			}
			expect(contact, `stage ${stage}: never reached the ramp`).toBeGreaterThanOrEqual(0);
			expect(surfed).toBeGreaterThanOrEqual(surfTicks);
			// Still over the first ramp, above its base, and moving fast along it.
			expect(rampFaceZ(r, p.origin.x, p.origin.y), `stage ${stage}: not over its first ramp`).not.toBeNull();
			expect(p.origin.z).toBeGreaterThan(Math.min(r.from.z, r.to.z) - r.height);
			expect(Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z)).toBeGreaterThan(300);
		}
	);
});
