import { describe, expect, it } from 'vitest';
import { buildCollisionWorld } from '../collision/world.ts';
import { SURF_CVARS } from '../cvars.ts';
import { HULL_MAX, HULL_MIN, type PlayerState, type UserCmd } from '../movement/api.ts';
import { createPlayer, playerMove } from '../movement/gamemovement.ts';
import type { Vec3 } from '../types.ts';
import { TICK_INTERVAL } from '../units.ts';
import type { Spawn, Zone } from './types.ts';
import { boundsOf, brushBounds, rampAngle, topCenter, type Box3, type BoxBrush, type RampBrush } from './helpers.ts';
import { bankSpeed, facePoint, pastEnd } from './surf_ochre-helpers.ts';
import { gateCrossing, runRouteBot, type AirPlan, type RouteBotState, type RouteSample, type RouteStep } from './surf-obstacles.ts';
import {
	KESSLER_CHAINS,
	KESSLER_END_PAD,
	KESSLER_GATES,
	KESSLER_OBSTACLES,
	KESSLER_SPIRAL,
	KESSLER_STAGES,
	SCENERY_CLEARANCE,
	surf_kessler as m,
	type KesslerStage
} from './surf_kessler.ts';

const G = 800;
const DEG = Math.PI / 180;
/** Same lift the map registry applies (index.ts SPAWN_CLEARANCE). */
const SPAWN_CLEARANCE = 0.25;
const lift = (s: Spawn): Spawn => ({ ...s, pos: { ...s.pos, z: s.pos.z + SPAWN_CLEARANCE } });

const boxes = m.brushes.filter((b): b is BoxBrush => b.type === 'box');
const ramps = m.brushes.filter((b): b is RampBrush => b.type === 'ramp');
const inBox = (p: Vec3, b: Box3) => p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;
const overlaps = (a: Box3, b: Box3, eps = 0.01) =>
	a.min.x < b.max.x - eps && b.min.x < a.max.x - eps && a.min.y < b.max.y - eps && b.min.y < a.max.y - eps && a.min.z < b.max.z - eps && b.min.z < a.max.z - eps;
/** Hull grown by 2 units: touching (or stopped against) a brush counts. */
const GROW_MIN = { x: HULL_MIN.x - 2, y: HULL_MIN.y - 2, z: HULL_MIN.z - 2 };
const GROW_MAX = { x: HULL_MAX.x + 2, y: HULL_MAX.y + 2, z: HULL_MAX.z + 2 };
const touching = (w: { trace: (a: Vec3, b: Vec3, mn: Vec3, mx: Vec3) => { startsolid: boolean } }, p: Vec3) => w.trace(p, p, GROW_MIN, GROW_MAX).startsolid;
const hullAt = (p: Vec3): Box3 => ({
	min: { x: p.x + HULL_MIN.x, y: p.y + HULL_MIN.y, z: p.z + HULL_MIN.z },
	max: { x: p.x + HULL_MAX.x, y: p.y + HULL_MAX.y, z: p.z + HULL_MAX.z }
});
const boxGap = (a: Box3, b: Box3) =>
	Math.hypot(Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x), Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y), Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z));

type Stage = Zone & { type: 'stage' };
type Tp = Zone & { type: 'teleport' };
const zonesOf = (type: Zone['type']) => m.zones.filter((z) => z.type === type);
const stageZones = m.zones.filter((z): z is Stage => z.type === 'stage');
const teleports = m.zones.filter((z): z is Tp => z.type === 'teleport');
const startZ = zonesOf('start')[0]!;
const endZ = zonesOf('end')[0]!;
const respawns = stageZones.map((z) => z.respawn);
const scenery = KESSLER_STAGES.flatMap((s) => s.scenery);
const gate = (label: string) => KESSLER_GATES.find((g) => g.label === label)!;
const chainOf = (label: string) => KESSLER_CHAINS.find((c) => c.label === label)!;
const turnOf = (c: (typeof KESSLER_CHAINS)[number]) => c.yaws[c.yaws.length - 1]! - c.yaws[0]!;
const WALL_SURF = new Set(['4b']);

describe('surf_kessler: definition', () => {
	it('is a hard staged surf map on the surf physics profile', () => {
		expect(m.id).toBe('surf_kessler');
		expect(m.title).toBe('Kessler');
		expect(m.kind).toBe('surf');
		expect(m.difficulty).toBe('hard');
		expect(m.layout).toBe('staged');
		expect(m.cvars).toEqual(SURF_CVARS);
	});

	it('has one start and one end zone, stages 2..6 and no checkpoints', () => {
		expect(zonesOf('start')).toHaveLength(1);
		expect(zonesOf('end')).toHaveLength(1);
		expect(zonesOf('checkpoint')).toHaveLength(0);
		expect(stageZones.map((z) => z.index)).toEqual([2, 3, 4, 5, 6]);
		expect(KESSLER_STAGES.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6]);
		const race = m.zones.filter((z) => z.type !== 'teleport');
		for (let i = 0; i < race.length; i++) for (let j = i + 1; j < race.length; j++) expect(overlaps(race[i]!, race[j]!)).toBe(false);
	});

	it('zones are generous (≥ 144 tall) and sit over their platforms', () => {
		for (const z of m.zones) if (z.type !== 'teleport') expect(z.max.z - z.min.z).toBeGreaterThanOrEqual(144);
		for (const s of KESSLER_STAGES.slice(1)) {
			const z = stageZones.find((x) => x.index === s.index)!;
			expect(inBox(z.respawn.pos, z)).toBe(true);
			expect(z.respawn.yaw).toBe(s.yaw);
			expect(z.respawn.pos.z).toBe(s.pad.max.z);
		}
		expect(inBox(KESSLER_END_PAD.max, { min: { ...endZ.min, z: endZ.min.z - 1 }, max: endZ.max })).toBe(true);
	});

	it('spawn is in the start zone; spawn and respawns are free in the real trace and stand on walkable ground', () => {
		expect(inBox(m.spawn.pos, startZ)).toBe(true);
		const world = buildCollisionWorld(m);
		for (const s of [m.spawn, ...respawns]) {
			const p = lift(s).pos;
			expect(world.trace(p, p, HULL_MIN, HULL_MAX).startsolid).toBe(false);
			const down = world.trace(p, { ...p, z: p.z - 2 }, HULL_MIN, HULL_MAX);
			expect(down.fraction, `ground under ${JSON.stringify(s.pos)}`).toBeLessThan(1);
			expect(down.plane.normal.z).toBeGreaterThanOrEqual(0.7);
		}
	});

	it('every material exists; effects are known; ramps and obstacles glow at their edges; glass is see-through', () => {
		for (const b of m.brushes) expect(m.theme.materials[b.material], b.material).toBeDefined();
		const known = ['aurora', 'embers', 'clouds', 'gridFloor', 'lavaSea', 'snowFloor'];
		for (const e of m.theme.effects) expect(known).toContain(e.type);
		expect(m.theme.fogFar).toBeGreaterThanOrEqual(12000);
		for (const r of ramps) expect(m.theme.materials[r.material]!.edgeColor).toBeDefined();
		for (const o of KESSLER_OBSTACLES) for (const b of o.brushes) expect(m.theme.materials[b.material]!.edgeColor, o.label).toBeDefined();
		const glass = Object.values(m.theme.materials).filter((d) => d.glass);
		expect(glass.length).toBeGreaterThanOrEqual(2);
		for (const d of glass) expect(d.opacity!).toBeLessThan(0.5);
	});

	it('each stage has its own ramp material set', () => {
		const sets = KESSLER_STAGES.map((s) => new Set(s.route.flatMap((r) => r.chain.ramps.map((x) => x.material))));
		for (let i = 0; i < sets.length; i++)
			for (let j = i + 1; j < sets.length; j++) for (const mat of sets[i]!) expect(sets[j]!.has(mat), `stages ${i + 1}/${j + 1} share ${mat}`).toBe(false);
	});

	it('box brushes do not intersect each other', () => {
		for (let i = 0; i < boxes.length; i++)
			for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!), `boxes ${i}, ${j}`).toBe(false);
	});
});

describe('surf_kessler: ramps', () => {
	it('every ramp belongs to exactly one chain', () => {
		const listed = KESSLER_CHAINS.flatMap((c) => c.ramps);
		expect(listed).toHaveLength(ramps.length);
		expect(new Set(listed)).toEqual(new Set(ramps));
	});

	it('surf faces are 50–60°; only the wall-surf face is 70–80°; stage 5 is narrow (≤ 256)', () => {
		for (const c of KESSLER_CHAINS)
			for (const r of c.ramps) {
				const [lo, hi] = WALL_SURF.has(c.label) ? [70, 80] : [50, 60];
				expect(rampAngle(r), c.label).toBeGreaterThanOrEqual(lo - 1e-3);
				expect(rampAngle(r), c.label).toBeLessThanOrEqual(hi + 1e-3);
			}
		for (const r of KESSLER_STAGES[4]!.route) expect(r.chain.halfWidth).toBeLessThanOrEqual(256);
	});

	it('curves and the spiral turn ≤ 4° per seam with the face inside the turn; seams step down a hair', () => {
		for (const c of KESSLER_CHAINS) {
			for (let i = 1; i < c.yaws.length; i++) {
				const t = c.yaws[i]! - c.yaws[i - 1]!;
				expect(Math.abs(t)).toBeLessThanOrEqual(4 + 1e-9);
				if (t !== 0) expect(Math.sign(t)).toBe(c.side === 'left' ? 1 : -1);
			}
			for (let i = 1; i < c.ramps.length; i++) {
				const a = c.ramps[i - 1]!.to;
				const b = c.ramps[i]!.from;
				expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-9);
				expect(a.z - b.z).toBeGreaterThan(0);
				expect(a.z - b.z).toBeLessThan(0.02);
			}
		}
		expect(turnOf(chainOf('2a'))).toBeCloseTo(-120, 6);
		expect(turnOf(chainOf('2b'))).toBeCloseTo(90, 6);
	});

	it('stage 3 is a 540° downward spiral, widening 1200 → 2600, whose loops never stack within 200 of a rider', () => {
		const sp = chainOf('3a');
		expect(turnOf(sp)).toBeCloseTo(KESSLER_SPIRAL.turn, 6);
		expect(KESSLER_SPIRAL.turn).toBeGreaterThanOrEqual(540);
		expect(sp.peak[0]!.z - sp.peak[sp.peak.length - 1]!.z).toBeGreaterThan(800);
		const world = buildCollisionWorld({ brushes: sp.ramps });
		for (let s = 0; s < sp.ramps.length; s += 3) {
			const q = facePoint(sp, s, 10, 0.45);
			const p = { ...q, z: q.z + 2 };
			expect(world.trace(p, { ...p, z: p.z + 200 }, HULL_MIN, HULL_MAX).fraction, `seg ${s}`).toBe(1);
		}
	});

	it('course chains do not cut into each other', () => {
		for (const [i, c] of KESSLER_CHAINS.entries()) {
			const others = buildCollisionWorld({ brushes: KESSLER_CHAINS.filter((_, j) => j !== i).flatMap((o) => o.ramps) });
			for (let s = 0; s < c.ramps.length; s++) {
				const len = c.dist[s + 1]! - c.dist[s]!;
				for (let a = 0; a <= len; a += 192)
					for (const f of [0.15, 0.5, 0.85]) {
						const p = facePoint(c, s, a, f);
						const q = { ...p, z: p.z + 40 };
						expect(others.trace(q, q, HULL_MIN, HULL_MAX).startsolid, `${c.label} seg ${s} at ${a}`).toBe(false);
					}
			}
		}
	});
});

describe('surf_kessler: obstacles', () => {
	it('every stage has at least two obstacle types, each with its own signature', () => {
		const kinds = KESSLER_STAGES.map((s) => new Set<string>([...s.obstacles.map((o) => o.kind), ...(s.index === 3 ? ['spiral'] : [])]));
		for (const [i, k] of kinds.entries()) expect(k.size, `stage ${i + 1}: ${[...k].join(', ')}`).toBeGreaterThanOrEqual(2);
		expect([...kinds[1]!]).toEqual(expect.arrayContaining(['window', 'ceiling']));
		expect([...kinds[2]!]).toEqual(expect.arrayContaining(['spiral', 'glassFloor']));
		expect([...kinds[3]!]).toEqual(expect.arrayContaining(['glassWall', 'window']));
		expect([...kinds[4]!]).toEqual(expect.arrayContaining(['window', 'slot']));
		expect([...kinds[5]!]).toEqual(expect.arrayContaining(['pillar', 'window']));
		const inMap = new Set(m.brushes);
		for (const o of KESSLER_OBSTACLES) for (const b of o.brushes) expect(inMap.has(b), o.label).toBe(true);
		const scen = new Set<unknown>(scenery);
		for (const o of KESSLER_OBSTACLES) for (const b of o.brushes) expect(scen.has(b)).toBe(false);
	});

	it('openings are tight', () => {
		const size = (l: string) => [gate(l).halfW * 2, gate(l).halfH * 2];
		expect(size('docking window')).toEqual([352, 288]);
		expect(size('arc window')).toEqual([224, 256]);
		expect(size('reactor glass floor')).toEqual([448, 400]);
		expect(size('wall exit')).toEqual([320, 288]);
		expect(size('needle window 1')).toEqual([288, 256]);
		expect(size('needle slot')).toEqual([160, 288]);
		expect(size('end room hole')).toEqual([384, 320]);
		// The two needle windows are offset along the turn: their walls face ≥ 40° apart.
		let d = Math.abs(gate('needle window 2').yaw - gate('needle window 1').yaw) % 360;
		if (d > 180) d = 360 - d;
		expect(d).toBeGreaterThanOrEqual(40);
	});

	it('the end pad sits inside a closed room whose only way in is the hole', () => {
		const room = KESSLER_OBSTACLES.find((o) => o.label === 'end room hole')!;
		expect(room.brushes.length).toBeGreaterThanOrEqual(8);
		const w = buildCollisionWorld({ brushes: room.brushes });
		const c = topCenter(KESSLER_END_PAD);
		for (const [dx, dy, dz] of [
			[0, 0, 2000],
			[2000, 0, 300],
			[0, 2000, 300],
			[0, -2000, 300]
		] as const) {
			const p = { x: c.x, y: c.y, z: c.z + 200 };
			expect(w.trace(p, { x: p.x + dx, y: p.y + dy, z: p.z + dz }, HULL_MIN, HULL_MAX).fraction).toBeLessThan(1);
		}
	});
});

describe('surf_kessler: teleports', () => {
	it('one teleport covers everything from below; a catch under each stage; all go to the current stage', () => {
		const all = boundsOf(m.brushes);
		const under = teleports.find((z) => z.max.z <= all.min.z && z.min.x <= all.min.x && z.min.y <= all.min.y && z.max.x >= all.max.x && z.max.y >= all.max.y);
		expect(under).toBeDefined();
		expect(teleports).toHaveLength(KESSLER_STAGES.length + 1);
		for (const z of teleports) expect(z.to).toBe('stage');
	});

	it('teleports touch no brush, spawn, respawn or other zone', () => {
		for (const tp of teleports) {
			for (const b of m.brushes) expect(overlaps(tp, brushBounds(b))).toBe(false);
			for (const s of [m.spawn, ...respawns]) expect(overlaps(hullAt(lift(s).pos), tp)).toBe(false);
			for (const z of m.zones) if (z.type !== 'teleport') expect(overlaps(z, tp), z.type).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// Real physics (playerMove + SURF_CVARS at TICK_INTERVAL)

const world = buildCollisionWorld(m);
const NO_INPUT: UserCmd = { pitch: 0, yaw: 0, forwardmove: 0, sidemove: 0, buttons: 0 };
const touchesTp = (p: Vec3) => teleports.some((tp) => overlaps(hullAt(p), tp, 0));
const onPad = (p: Vec3, pad: BoxBrush) => p.x >= pad.min.x && p.x <= pad.max.x && p.y >= pad.min.y && p.y <= pad.max.y && Math.abs(p.z - pad.max.z) < 2;

interface Snap {
	k: number;
	exited: boolean;
	p: PlayerState;
	st: RouteBotState;
}

interface StageRun {
	ok: boolean;
	reason: string;
	seconds: number;
	samples: RouteSample[];
	path: Vec3[];
	snaps: Snap[];
}

/** Walk off the stage platform, then fly the stage's intended line until on ground (the next platform) or teleported. */
function runStage(s: KesslerStage, route: RouteStep[] = s.route, exit: AirPlan = s.exit): StageRun {
	const respawn = s.index === 1 ? m.spawn : stageZones.find((z) => z.index === s.index)!.respawn;
	const p = createPlayer(lift(respawn).pos);
	let walk = 0;
	for (; walk < 640; walk++) {
		playerMove(world, p, { ...NO_INPUT, yaw: s.yaw, forwardmove: 450 }, SURF_CVARS, TICK_INTERVAL);
		if (!p.onGround) break;
	}
	const snaps: Snap[] = [];
	let last = '0';
	const r = runRouteBot({
		world,
		move: playerMove,
		cvars: SURF_CVARS,
		dt: TICK_INTERVAL,
		p,
		steps: route,
		exit,
		seconds: 60,
		stop: (q, st) => {
			const key = `${st.k}${st.exited}`;
			if (key !== last) {
				last = key;
				snaps.push({ k: st.k, exited: st.exited, p: structuredClone(q), st: { ...st } });
			}
			return q.onGround ? 'ground' : touchesTp(q.origin) ? 'teleport' : null;
		}
	});
	const end = r.samples[r.samples.length - 1]!.pos;
	const ok = r.reason === 'ground' && onPad(end, s.target);
	return { ok, reason: r.reason, seconds: (walk + r.samples.length) * TICK_INTERVAL, samples: r.samples, path: r.samples.map((x) => x.pos), snaps };
}

/** Continue a stage run from a snapshot (flight onto step k, or the exit flight), tweaked, until ground / teleport. */
function from(s: KesslerStage, run: StageRun, at: { k: number; exited?: boolean }, tweak: (p: PlayerState) => void, route: RouteStep[] = s.route, exit: AirPlan = s.exit) {
	const snap = run.snaps.find((x) => x.k === at.k && x.exited === (at.exited ?? false))!;
	const p = structuredClone(snap.p);
	tweak(p);
	const r = runRouteBot({
		world,
		move: playerMove,
		cvars: SURF_CVARS,
		dt: TICK_INTERVAL,
		p,
		steps: route,
		exit,
		state: { ...snap.st },
		seconds: 40,
		stop: (q) => (q.onGround ? 'ground' : touchesTp(q.origin) ? 'teleport' : null)
	});
	const end = r.samples[r.samples.length - 1]!.pos;
	return { finished: r.reason === 'ground' && onPad(end, s.target), path: r.samples.map((x) => x.pos), samples: r.samples };
}

/** Got through opening `label` cleanly: finished the stage, hull inside the opening, never touched that obstacle or lost speed to an edge. */
function clean(r: ReturnType<typeof from>, label: string): boolean {
	const g = gate(label);
	const ob = buildCollisionWorld({ brushes: KESSLER_OBSTACLES.find((o) => o.gates.includes(g))!.brushes });
	const touched = r.path.some((q) => touching(ob, q));
	const hs = r.samples.map((x) => (x.onGround ? Infinity : Math.hypot(x.vel.x, x.vel.y)));
	const bonk = hs.some((v, i) => i > 0 && Number.isFinite(hs[i - 1]!) && v < hs[i - 1]! * 0.75);
	return r.finished && !touched && !bonk && gateCrossing(r.path, g).inside;
}
const scaleVel = (f: number) => (p: PlayerState) => {
	p.velocity = { x: p.velocity.x * f, y: p.velocity.y * f, z: p.velocity.z * f };
};
const shiftSide = (d: number) => (p: PlayerState) => {
	const h = Math.atan2(p.velocity.y, p.velocity.x);
	p.origin = { x: p.origin.x - Math.sin(h) * d, y: p.origin.y + Math.cos(h) * d, z: p.origin.z };
};

const runs = new Map<number, StageRun>(KESSLER_STAGES.map((s) => [s.index, runStage(s)]));
const runOf = (i: number) => runs.get(i)!;
const stage = (i: number) => KESSLER_STAGES[i - 1]!;

/** Speed, corrected for the height change since the previous tick (constant if only gravity acts). */
const energySpeed = (a: RouteSample, b: RouteSample) => Math.sqrt(Math.max(0, b.speed * b.speed + 2 * G * (b.pos.z - a.pos.z)));

describe('surf_kessler: rampbug test (every chain, alone, ridden end to end)', () => {
	it.each(KESSLER_CHAINS.map((c, i) => [c.label, i] as const))('%s', (_l, i) => {
		const c = KESSLER_CHAINS[i]!;
		const w = buildCollisionWorld({ brushes: c.ramps });
		const st = KESSLER_STAGES.find((s) => s.route.some((r) => r.chain === c))!;
		const k = st.route.findIndex((r) => r.chain === c);
		const entry = Math.max(700, runOf(st.index).samples.find((s) => s.k === k && s.seg >= 0)!.speed);
		const p0 = facePoint(c, 0, 96, 0.4);
		const p = createPlayer({ ...p0, z: p0.z + Math.max(40, 23 * Math.tan(c.angle * DEG) + 8) });
		p.onGround = false;
		const d = { x: Math.cos(c.yaws[0]! * DEG), y: Math.sin(c.yaws[0]! * DEG) };
		const vh = entry / Math.hypot(1, c.grades[0]!);
		p.velocity = { x: d.x * vh, y: d.y * vh, z: -c.grades[0]! * vh };
		const r = runRouteBot({
			world: w,
			move: playerMove,
			cvars: SURF_CVARS,
			dt: TICK_INTERVAL,
			p,
			steps: [{ chain: c, target: WALL_SURF.has(c.label) ? 0.3 : 0.45 }],
			seconds: 40,
			stop: (q, s) => (s.exited || (s.lastSeg === c.ramps.length - 1 && pastEnd(c, q.origin) > 0) ? 'end' : q.origin.z < c.peak[c.peak.length - 1]!.z - 3000 ? 'fell' : null)
		});
		expect(r.reason).toBe('end');
		const firstOn = r.samples.findIndex((s) => s.surfing);
		const ride = r.samples.slice(firstOn + 3, r.samples.length - 1);
		const surfing = ride.filter((s) => s.surfing).length / ride.length;
		const segs = new Set(ride.map((s) => s.seg).filter((s) => s >= 0));
		let worstTick = 1;
		let worstSeam = 1;
		for (let q = 1; q < ride.length; q++) {
			const ratio = energySpeed(ride[q - 1]!, ride[q]!) / ride[q - 1]!.speed;
			worstTick = Math.min(worstTick, ratio);
			if (ride[q]!.seg !== ride[q - 1]!.seg && ride[q - 1]!.seg >= 0 && ride[q]!.seg >= 0) worstSeam = Math.min(worstSeam, ratio);
		}
		console.log(`kessler rampbug ${c.label}: ${c.ramps.length} segs, in ${entry.toFixed(0)} → out ${r.samples[r.samples.length - 1]!.speed.toFixed(0)} u/s, surfing ${(surfing * 100).toFixed(1)}%, worst seam ${(worstSeam * 100).toFixed(2)}%, worst tick ${(worstTick * 100).toFixed(2)}%`);
		expect(surfing, 'touches the ramp').toBeGreaterThanOrEqual(0.9);
		expect(segs.size, 'visits (nearly) every segment').toBeGreaterThanOrEqual(c.ramps.length - 2);
		expect(worstSeam, 'no speed lost at a seam (> 2%)').toBeGreaterThanOrEqual(0.98);
		expect(worstTick, 'no sudden speed loss anywhere (> 2%)').toBeGreaterThanOrEqual(0.98);
	});
});

describe('surf_kessler: the skilled line, stage by stage (real physics)', () => {
	it.each(KESSLER_STAGES.map((s) => [s.index, s.name, s] as const))('stage %i (%s): walk off, ride every chain, fly every opening, land on the next platform', (_i, name, s) => {
		const r = runOf(s.index);
		const per = s.route.map((step, k) => {
			const on = r.samples.filter((x) => x.k === k && x.seg >= 0 && !x.exited);
			return `${step.chain.label} ${on.length ? `${on[0]!.speed.toFixed(0)} → ${on[on.length - 1]!.speed.toFixed(0)}` : 'never'}`;
		});
		const gs = s.obstacles.flatMap((o) => o.gates).map((g) => `${g.label} margin ${gateCrossing(r.path, g).margin.toFixed(0)}`);
		console.log(`kessler stage ${s.index} ${name}: ${r.ok ? 'ok' : 'FAIL ' + r.reason} in ${r.seconds.toFixed(1)} s; ${per.join(', ')}; ${gs.join(', ')}`);
		expect(r.ok, r.reason).toBe(true);
		for (const [k, step] of s.route.entries()) expect(r.samples.some((x) => x.k === k && x.seg >= 0 && x.surfing), step.chain.label).toBe(true);
		for (const o of s.obstacles)
			for (const g of o.gates) {
				const c = gateCrossing(r.path, g);
				expect(c.crossed, g.label).toBe(true);
				expect(c.inside, `${g.label}: margin ${c.margin.toFixed(0)}`).toBe(true);
			}
		const obs = buildCollisionWorld({ brushes: s.obstacles.flatMap((o) => o.brushes).filter((b) => b !== s.target) });
		for (const [i, q] of r.path.entries()) expect(touching(obs, q), `${name} touches an obstacle at tick ${i}`).toBe(false);
	});

	it('stage 5 makes a > 120° air-strafe turn between 5a and 5b', () => {
		const r = runOf(5);
		const before = r.samples.findLast((x) => x.k === 0 && x.seg >= 0)!;
		const after = r.samples.find((x) => x.k === 1 && x.seg >= 0)!;
		let d = Math.abs(Math.atan2(after.vel.y, after.vel.x) - Math.atan2(before.vel.y, before.vel.x)) / DEG;
		if (d > 180) d = 360 - d;
		expect(d).toBeGreaterThan(120);
	});

	it('curves and the spiral are banked for the speed carried (hold speed above the rider on every turning segment)', () => {
		for (const s of KESSLER_STAGES)
			for (const [k, step] of s.route.entries()) {
				const c = step.chain;
				let worst = Infinity;
				for (let q = 1; q < c.yaws.length; q++) {
					const t = Math.abs(c.yaws[q]! - c.yaws[q - 1]!);
					if (t === 0) continue;
					const radius = (c.dist[q + 1]! - c.dist[q]!) / (t * DEG);
					const fastest = Math.max(1, ...runOf(s.index).samples.filter((x) => x.k === k && x.seg === q).map((x) => x.speed));
					worst = Math.min(worst, bankSpeed(c.angle, radius) / fastest);
				}
				if (worst === Infinity) continue;
				console.log(`kessler bank ${c.label}: hold speed / rider speed ≥ ${worst.toFixed(2)}`);
				expect(worst).toBeGreaterThan(1);
			}
	});

	it(`scenery stays ≥ ${SCENERY_CLEARANCE} units from the riders' real paths and from every playable surface`, () => {
		expect(SCENERY_CLEARANCE).toBeGreaterThanOrEqual(256);
		let worst = Infinity;
		for (const s of KESSLER_STAGES)
			for (const [i, q] of runOf(s.index).path.entries()) {
				if (i % 2) continue;
				const h = hullAt(q);
				for (const c of scenery) worst = Math.min(worst, boxGap(c, h));
			}
		console.log(`kessler: closest scenery to a rider ${worst.toFixed(0)} units (${scenery.length} boxes)`);
		expect(worst).toBeGreaterThanOrEqual(SCENERY_CLEARANCE);
		for (const s of KESSLER_STAGES) expect(s.scenery.length, `stage ${s.index}`).toBeGreaterThanOrEqual(6);
	});

	it('the whole run, stage by stage, takes 60–150 s', () => {
		const total = KESSLER_STAGES.reduce((a, s) => a + runOf(s.index).seconds, 0);
		console.log(`kessler: skilled run ${total.toFixed(1)} s`);
		expect(total).toBeGreaterThanOrEqual(60);
		expect(total).toBeLessThanOrEqual(150);
	});

	it('standing still on any platform never teleports', () => {
		for (const s of [m.spawn, ...respawns]) {
			const p = createPlayer(lift(s).pos);
			for (let i = 0; i < 128; i++) playerMove(world, p, NO_INPUT, SURF_CVARS, TICK_INTERVAL);
			expect(p.onGround).toBe(true);
			expect(touchesTp(p.origin)).toBe(false);
		}
	});
});

describe('surf_kessler: imprecise lines fail (real physics)', () => {
	it('the skilled launch states get through (control)', () => {
		expect(clean(from(stage(1), runOf(1), { k: 1 }, () => {}), 'docking window')).toBe(true);
		expect(clean(from(stage(2), runOf(2), { k: 1 }, () => {}), 'arc window')).toBe(true);
		expect(clean(from(stage(3), runOf(3), { k: 1 }, () => {}), 'reactor glass floor')).toBe(true);
		expect(clean(from(stage(4), runOf(4), { k: 1, exited: true }, () => {}), 'wall exit')).toBe(true);
		expect(clean(from(stage(5), runOf(5), { k: 1 }, () => {}), 'needle window 2')).toBe(true);
		expect(clean(from(stage(6), runOf(6), { k: 1, exited: true }, () => {}), 'end room hole')).toBe(true);
	});

	it('stage 1: leaving 1a 140 units off the line hits the bulkhead', () => {
		for (const d of [-140, 140]) expect(clean(from(stage(1), runOf(1), { k: 1 }, shiftSide(d)), 'docking window'), `${d}`).toBe(false);
	});

	it('stage 2: the narrow window rejects a line 100 units off', () => {
		for (const d of [-100, 100]) expect(clean(from(stage(2), runOf(2), { k: 1 }, shiftSide(d)), 'arc window'), `${d}`).toBe(false);
	});

	it('stage 2: riding the upper face of 2b (fraction 0.25) hits a ceiling rib', () => {
		const high = stage(2).route.map((r, i) => (i === 1 ? { ...r, target: 0.25 } : r));
		const r = from(stage(2), runOf(2), { k: 1 }, () => {}, high);
		const rib = buildCollisionWorld({ brushes: KESSLER_OBSTACLES.find((o) => o.label === 'arc ribs')!.brushes });
		expect(r.path.some((q) => touching(rib, q))).toBe(true);
	});

	it('stage 3: −15% / +15% off the spiral misses the glass floor hole', () => {
		for (const f of [0.85, 1.15]) expect(clean(from(stage(3), runOf(3), { k: 1 }, scaleVel(f)), 'reactor glass floor'), `×${f}`).toBe(false);
	});

	it('stage 4: leaving the wall-surf face 200 units off its line (no correction) hits the exit bulkhead', () => {
		for (const d of [-200, 200]) expect(clean(from(stage(4), runOf(4), { k: 1, exited: true }, shiftSide(d), stage(4).route, { kind: 'none' }), 'wall exit'), `${d}`).toBe(false);
	});

	it('stage 5: stopping the air turn at 90° (or not turning) misses the second window', () => {
		const a = stage(5).route[0]!.chain;
		const ex = a.yaws[a.yaws.length - 1]!;
		for (const air of [{ kind: 'yaw' as const, yaw: ex - 90 }, { kind: 'none' as const }]) {
			const route = stage(5).route.map((r, i) => (i === 1 ? { ...r, air } : r));
			expect(clean(from(stage(5), runOf(5), { k: 1 }, () => {}, route), 'needle window 2'), air.kind).toBe(false);
		}
	});

	it('stage 5: the slot rejects a line 90 units off', () => {
		for (const d of [-90, 90]) expect(clean(from(stage(5), runOf(5), { k: 2 }, shiftSide(d)), 'needle slot'), `${d}`).toBe(false);
	});

	it('stage 6: flying the long gap straight hits a pillar; entering the end room 250 off its line (no correction) hits its wall', () => {
		const straight = stage(6).route.map((r, i) => (i === 1 ? { ...r, air: { kind: 'none' as const } } : r));
		expect(clean(from(stage(6), runOf(6), { k: 1 }, () => {}, straight), 're-entry pillars')).toBe(false);
		for (const d of [-250, 250]) expect(clean(from(stage(6), runOf(6), { k: 1, exited: true }, shiftSide(d), stage(6).route, { kind: 'none' }), 'end room hole'), `${d}`).toBe(false);
	});
});
