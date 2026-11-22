import { describe, expect, it } from 'vitest';
import { buildCollisionWorld } from '../collision/world.ts';
import { SURF_CVARS } from '../cvars.ts';
import { HULL_MAX, HULL_MIN, IN_JUMP, type PlayerState, type UserCmd } from '../movement/api.ts';
import { createPlayer, playerMove } from '../movement/gamemovement.ts';
import type { Vec3 } from '../types.ts';
import { TICK_INTERVAL } from '../units.ts';
import type { Spawn, Zone } from './types.ts';
import { boundsOf, brushBounds, rampAngle, type Box3, type BoxBrush, type RampBrush } from './helpers.ts';
import { bankSpeed, facePoint, locateOnChain, pastEnd, type RampChain } from './surf_ochre-helpers.ts';
import { gateCrossing, newRouteState, runRouteBot, type RouteBotState, type RouteSample, type RouteStep } from './surf-obstacles.ts';
import { OCHRE_CHAINS, OCHRE_CHECKPOINT_CHAINS, OCHRE_LEDGES, OCHRE_OBSTACLES, OCHRE_ROUTE, OCHRE_SCENERY, surf_ochre as m } from './surf_ochre.ts';

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
/** Distance from the player hull at `p` to a box. */
const hullDist = (p: Vec3, b: Box3) => {
	const h = hullAt(p);
	return Math.hypot(Math.max(0, b.min.x - h.max.x, h.min.x - b.max.x), Math.max(0, b.min.y - h.max.y, h.min.y - b.max.y), Math.max(0, b.min.z - h.max.z, h.min.z - b.max.z));
};

type Cp = Zone & { type: 'checkpoint' };
type Tp = Zone & { type: 'teleport' };
const zonesOf = (type: Zone['type']) => m.zones.filter((z) => z.type === type);
const checkpoints = m.zones.filter((z): z is Cp => z.type === 'checkpoint').sort((a, b) => a.index - b.index);
const teleports = m.zones.filter((z): z is Tp => z.type === 'teleport');
const startZ = zonesOf('start')[0]!;
const endZ = zonesOf('end')[0]!;
const respawns = checkpoints.map((z) => z.respawn);
const totalLength = (c: RampChain) => c.dist[c.dist.length - 1]!;
const turnOf = (c: RampChain) => c.yaws[c.yaws.length - 1]! - c.yaws[0]!;
const obstacle = (label: string) => OCHRE_OBSTACLES.find((o) => o.label === label)!;
const gates = OCHRE_OBSTACLES.flatMap((o) => o.gates);
const gate = (label: string) => gates.find((g) => g.label === label)!;
const spiral = OCHRE_CHAINS[2]!;

describe('surf_ochre: definition', () => {
	it('is a hard linear surf map on the surf physics profile', () => {
		expect(m.id).toBe('surf_ochre');
		expect(m.title).toBe('Ochre');
		expect(m.kind).toBe('surf');
		expect(m.difficulty).toBe('hard');
		expect(m.layout).toBe('linear');
		expect(m.cvars).toEqual(SURF_CVARS);
	});

	it('has one start and one end zone, apart, and 7 checkpoints 1..7 (no stages)', () => {
		expect(zonesOf('start')).toHaveLength(1);
		expect(zonesOf('end')).toHaveLength(1);
		expect(overlaps(startZ, endZ)).toBe(false);
		expect(zonesOf('stage')).toHaveLength(0);
		expect(checkpoints.map((z) => z.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		for (const c of checkpoints) {
			expect(overlaps(c, startZ)).toBe(false);
			expect(overlaps(c, endZ)).toBe(false);
			expect(inBox(c.respawn.pos, c), `checkpoint ${c.index} respawn outside its zone`).toBe(true);
		}
	});

	it('zones are generous (≥ 144 tall)', () => {
		for (const z of m.zones) if (z.type !== 'teleport') expect(z.max.z - z.min.z).toBeGreaterThanOrEqual(144);
	});

	it('spawns in the start zone; spawn and respawns stand free on walkable ground in the real trace', () => {
		expect(inBox(m.spawn.pos, startZ)).toBe(true);
		const world = buildCollisionWorld(m);
		for (const s of [m.spawn, ...respawns]) {
			const p = lift(s).pos;
			expect(world.trace(p, p, HULL_MIN, HULL_MAX).startsolid, JSON.stringify(p)).toBe(false);
			const down = world.trace(p, { ...p, z: p.z - 2 }, HULL_MIN, HULL_MAX);
			expect(down.fraction, `no ground under ${JSON.stringify(p)}`).toBeLessThan(1);
			expect(down.plane.normal.z).toBeGreaterThanOrEqual(0.7);
		}
	});

	it('every material exists; effects and fog fit the renderer; glass is see-through', () => {
		for (const b of m.brushes) expect(m.theme.materials[b.material], b.material).toBeDefined();
		const known = ['aurora', 'embers', 'clouds', 'gridFloor', 'lavaSea', 'snowFloor'];
		for (const e of m.theme.effects) expect(known).toContain(e.type);
		expect(m.theme.fogFar).toBeGreaterThanOrEqual(12000);
		const glass = Object.entries(m.theme.materials).filter(([, d]) => d.glass);
		expect(glass.length).toBeGreaterThanOrEqual(2);
		for (const [, d] of glass) {
			expect(d.opacity).toBeGreaterThan(0.15);
			expect(d.opacity).toBeLessThan(0.5);
			expect(d.edgeColor, 'glass needs readable edges').toBeDefined();
		}
	});

	it('box brushes do not intersect each other', () => {
		for (let i = 0; i < boxes.length; i++)
			for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!), `boxes ${i}, ${j}`).toBe(false);
	});

	it('the end pad does not cut into the last ramp', () => {
		const pad = boxes.find((b) => overlaps({ min: endZ.min, max: { ...endZ.max, z: endZ.min.z + 32 } }, b))!;
		for (const r of OCHRE_CHAINS[OCHRE_CHAINS.length - 1]!.ramps) expect(overlaps(pad, brushBounds(r))).toBe(false);
	});
});

describe('surf_ochre: ramps', () => {
	it('every ramp brush belongs to a course chain', () => {
		const all = OCHRE_CHAINS.flatMap((c) => c.ramps);
		expect(new Set(all)).toEqual(new Set(ramps));
		expect(OCHRE_CHAINS).toHaveLength(11);
	});

	it('angles are 45.6–60°, faces 448–768 wide; one ramp is glass', () => {
		for (const r of ramps) {
			expect(rampAngle(r)).toBeGreaterThanOrEqual(45.6);
			expect(rampAngle(r)).toBeLessThanOrEqual(60);
			expect(r.halfWidth).toBeGreaterThanOrEqual(448);
			expect(r.halfWidth).toBeLessThanOrEqual(768);
		}
		expect(ramps.some((r) => m.theme.materials[r.material]!.glass)).toBe(true);
	});

	it('chains are long: all ≥ 3200, the longest ≥ 9000', () => {
		const lens = OCHRE_CHAINS.map(totalLength);
		for (const l of lens) expect(l).toBeGreaterThanOrEqual(3200);
		expect(Math.max(...lens)).toBeGreaterThanOrEqual(9000);
	});

	it('curves bend both ways in steps ≤ 4°, banked with the face inside the bend', () => {
		const bends = OCHRE_CHAINS.filter((c) => Math.abs(turnOf(c)) >= 50);
		expect(bends.some((c) => turnOf(c) > 0)).toBe(true);
		expect(bends.some((c) => turnOf(c) < 0)).toBe(true);
		for (const c of OCHRE_CHAINS)
			for (let i = 1; i < c.yaws.length; i++) {
				const t = c.yaws[i]! - c.yaws[i - 1]!;
				expect(Math.abs(t)).toBeLessThanOrEqual(4 + 1e-9);
				if (t !== 0) expect(Math.sign(t)).toBe(c.side === 'left' ? 1 : -1);
			}
	});

	it('the sinkhole spiral turns 450° downwards, widening (3200 → 4200) so its loops never stack', () => {
		expect(turnOf(spiral)).toBeCloseTo(-450, 6);
		expect(spiral.peak[0]!.z - spiral.peak[spiral.peak.length - 1]!.z).toBeGreaterThan(800);
		for (const g of spiral.grades) expect(g).toBeGreaterThanOrEqual(0);
		// Nothing of the spiral (its lead-in passes over the second loop) comes within 200 above a rider's feet.
		const world = buildCollisionWorld({ brushes: spiral.ramps });
		for (let s = 0; s < spiral.ramps.length; s += 3) {
			const p = facePoint(spiral, s, 10, 0.45);
			const q = { ...p, z: p.z + 2 };
			expect(world.trace(q, { ...q, z: q.z + 200 }, HULL_MIN, HULL_MAX).fraction, `seg ${s}`).toBe(1);
		}
	});

	it('has a wave (dip then rise) and an up-ramp that climbs ≥ 600', () => {
		expect(OCHRE_CHAINS.some((c) => c.grades.some((g) => g > 0.1) && c.grades[c.grades.length - 1]! < -0.1)).toBe(true);
		const up = OCHRE_CHAINS[9]!;
		expect(up.peak[up.peak.length - 1]!.z - Math.min(...up.peak.map((p) => p.z))).toBeGreaterThanOrEqual(600);
	});

	it('seams are flush: each segment starts a hair below the previous end, never above', () => {
		for (const c of OCHRE_CHAINS)
			for (let i = 1; i < c.ramps.length; i++) {
				const a = c.ramps[i - 1]!.to;
				const b = c.ramps[i]!.from;
				expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-9);
				expect(a.z - b.z).toBeGreaterThan(0);
				expect(a.z - b.z).toBeLessThan(0.02);
			}
	});

	it('course chains do not cut into each other', () => {
		for (const [i, c] of OCHRE_CHAINS.entries()) {
			const others = buildCollisionWorld({ brushes: OCHRE_CHAINS.filter((_, j) => j !== i).flatMap((o) => o.ramps) });
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

describe('surf_ochre: obstacles', () => {
	it('declares ≥ 9 hard moments of the expected kinds, all of them in the map', () => {
		const kinds = new Set(OCHRE_OBSTACLES.map((o) => o.kind));
		for (const k of ['slot', 'window', 'glassFloor', 'glassWall', 'ceiling', 'pillar'] as const) expect(kinds.has(k), k).toBe(true);
		expect(OCHRE_OBSTACLES.length).toBeGreaterThanOrEqual(9);
		const inMap = new Set(m.brushes);
		for (const o of OCHRE_OBSTACLES) for (const b of o.brushes) expect(inMap.has(b), o.label).toBe(true);
		// Obstacles are not scenery.
		const scen = new Set<unknown>(OCHRE_SCENERY);
		for (const o of OCHRE_OBSTACLES) for (const b of o.brushes) expect(scen.has(b)).toBe(false);
	});

	it('openings are tight: slot 176 × 304, windows ≤ 352 wide, glass tubes 368 apart, floor hole 520 × 480', () => {
		expect(gate('slot fin').halfW * 2).toBe(176);
		expect(gate('slot fin').halfH * 2).toBe(304);
		expect(gate('speed window').halfW * 2).toBeLessThanOrEqual(352);
		expect(gate('high window').halfW * 2).toBeLessThanOrEqual(352);
		expect(gate('glass tube 1').halfW * 2).toBe(368);
		const fh = gate('glass floor hole');
		expect([fh.halfH * 2, fh.halfW * 2]).toEqual([520, 480]);
		for (const o of OCHRE_OBSTACLES.filter((x) => x.kind.startsWith('glass'))) for (const b of o.brushes) expect(m.theme.materials[b.material]!.glass, o.label).toBe(true);
	});

	it('the floor hole drops onto the under-floor ramp: its peak passes under the hole, 100 below the slab', () => {
		const g = gate('glass floor hole');
		const c = OCHRE_CHAINS[3]!;
		const h = locateOnChain(c, { x: g.center.x + 1, y: g.center.y + 1 })!;
		expect(h).not.toBeNull();
		expect(h.frac).toBeLessThan(0.05);
		expect(g.center.z - 32 - (c.peak[0]!.z - c.grades[0]! * h.along)).toBeGreaterThan(80);
	});
});

describe('surf_ochre: teleports', () => {
	it('one teleport covers everything from below; one catch under each chain; all reset to the start', () => {
		const all = boundsOf(m.brushes);
		const under = teleports.find(
			(z) => z.max.z <= all.min.z && z.min.x <= all.min.x && z.min.y <= all.min.y && z.max.x >= all.max.x && z.max.y >= all.max.y
		);
		expect(under).toBeDefined();
		expect(teleports).toHaveLength(OCHRE_CHAINS.length + 1);
		for (const z of teleports) expect(z.to).toBe('start');
	});

	it('teleports touch no brush, spawn, respawn or other zone', () => {
		for (const tp of teleports) {
			for (const b of m.brushes) expect(overlaps(tp, brushBounds(b))).toBe(false);
			for (const s of [m.spawn, ...respawns]) expect(overlaps(hullAt(s.pos), tp)).toBe(false);
			for (const z of m.zones) if (z.type !== 'teleport') expect(overlaps(z, tp), z.type).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// Real physics (playerMove at TICK_INTERVAL)

const cmd = (c: Partial<UserCmd> = {}): UserCmd => ({ pitch: 0, yaw: 0, forwardmove: 0, sidemove: 0, buttons: 0, ...c });
const fullWorld = buildCollisionWorld(m);
const obstacleWorld = buildCollisionWorld({ brushes: OCHRE_OBSTACLES.flatMap((o) => o.brushes) });
const touches = (p: Vec3, z: Box3) => overlaps(hullAt(p), z, 0);
const stopAtZones = (p: PlayerState) => (touches(p.origin, endZ) ? 'end' : teleports.some((tp) => touches(p.origin, tp)) ? 'teleport' : null);

/** Walk off a spawn until airborne (forward from the start room; strafe towards chain `first`'s face from a ledge). */
function walkOff(s: Spawn, first: number): { p: PlayerState; walk: Vec3[] } {
	const strafe = first === 0 ? 0 : OCHRE_CHAINS[first]!.side === 'left' ? -450 : 450;
	const p = createPlayer(lift(s).pos);
	const walk: Vec3[] = [];
	for (let t = 0; t < 400; t++) {
		playerMove(fullWorld, p, cmd({ yaw: s.yaw, forwardmove: strafe ? 0 : 450, sidemove: strafe }), SURF_CVARS, TICK_INTERVAL);
		walk.push({ ...p.origin });
		if (!p.onGround && p.velocity.z < -50) break;
	}
	return { p, walk };
}

interface Snap {
	k: number;
	p: PlayerState;
	st: RouteBotState;
	tick: number;
}

/** The skilled line from the spawn, with a snapshot of the player at the moment each new route step begins. */
function skilled(route: RouteStep[] = OCHRE_ROUTE) {
	const { p, walk } = walkOff(m.spawn, 0);
	const snaps: Snap[] = [];
	let lastK = 0;
	let tick = 0;
	const r = runRouteBot({
		world: fullWorld,
		move: playerMove,
		cvars: SURF_CVARS,
		dt: TICK_INTERVAL,
		p,
		steps: route,
		seconds: 90,
		stop: (q, st) => {
			tick++;
			if (st.k !== lastK) {
				lastK = st.k;
				snaps.push({ k: st.k, p: structuredClone(q), st: { ...st }, tick });
			}
			return stopAtZones(q);
		}
	});
	return { ...r, walk, snaps };
}

const run = skilled();
const path = run.samples.map((s) => s.pos);

/** Continue from the snapshot that starts route step k, with `tweak` applied, until the bot is on step k (or k + 1) for 1 s, or fails. */
function from(k: number, tweak: (p: PlayerState) => void, route: RouteStep[] = OCHRE_ROUTE, seconds = 8, untilLanded = true) {
	const s = run.snaps.find((x) => x.k === k)!;
	const p = structuredClone(s.p);
	tweak(p);
	let onK = 0;
	const r = runRouteBot({
		world: fullWorld,
		move: playerMove,
		cvars: SURF_CVARS,
		dt: TICK_INTERVAL,
		p,
		steps: route,
		state: { ...s.st },
		seconds,
		stop: (q, st) => {
			const z = stopAtZones(q);
			if (z) return z;
			if (st.k >= k && q.surfing && st.lastSeg >= 0) onK++;
			return untilLanded && onK > 64 ? 'landed' : null;
		}
	});
	return { ...r, path: r.samples.map((x) => x.pos) };
}
const scaleVel = (f: number) => (p: PlayerState) => {
	p.velocity = { x: p.velocity.x * f, y: p.velocity.y * f, z: p.velocity.z * f };
};
const shiftSide = (d: number) => (p: PlayerState) => {
	const h = Math.atan2(p.velocity.y, p.velocity.x);
	p.origin = { x: p.origin.x - Math.sin(h) * d, y: p.origin.y + Math.cos(h) * d, z: p.origin.z };
};

/** Speed, corrected for the height change since the previous tick (constant if only gravity acts). */
const energySpeed = (a: RouteSample, b: RouteSample) => Math.sqrt(Math.max(0, b.speed * b.speed + 2 * G * (b.pos.z - a.pos.z)));

describe('surf_ochre: rampbug test (every chain, alone, ridden end to end)', () => {
	it.each(OCHRE_CHAINS.map((c, i) => [c.label, i] as const))('%s', (_l, i) => {
		const c = OCHRE_CHAINS[i]!;
		const world = buildCollisionWorld({ brushes: c.ramps });
		const entry = run.samples.find((s) => s.k === i && s.seg >= 0)!.speed;
		const p0 = facePoint(c, 0, 96, 0.4);
		const p = createPlayer({ ...p0, z: p0.z + 40 });
		p.onGround = false;
		const d = { x: Math.cos(c.yaws[0]! * DEG), y: Math.sin(c.yaws[0]! * DEG) };
		const vh = entry / Math.hypot(1, c.grades[0]!);
		p.velocity = { x: d.x * vh, y: d.y * vh, z: -c.grades[0]! * vh };
		let ended = false;
		const r = runRouteBot({
			world,
			move: playerMove,
			cvars: SURF_CVARS,
			dt: TICK_INTERVAL,
			p,
			steps: [{ chain: c }],
			seconds: 30,
			stop: (q, st) => (st.exited || (st.lastSeg === c.ramps.length - 1 && pastEnd(c, q.origin) > 0) ? ((ended = true), 'end') : q.origin.z < c.peak[c.peak.length - 1]!.z - 3000 ? 'fell' : null)
		});
		expect(r.reason).toBe('end');
		expect(ended).toBe(true);
		const firstOn = r.samples.findIndex((s) => s.surfing);
		const ride = r.samples.slice(firstOn + 3, r.samples.length - 1);
		const surfing = ride.filter((s) => s.surfing).length / ride.length;
		const onFace = ride.filter((s) => s.seg >= 0).length / ride.length;
		const segs = new Set(ride.map((s) => s.seg).filter((s) => s >= 0));
		let worstTick = 1;
		let worstSeam = 1;
		for (let k = 1; k < ride.length; k++) {
			const ratio = energySpeed(ride[k - 1]!, ride[k]!) / ride[k - 1]!.speed;
			worstTick = Math.min(worstTick, ratio);
			if (ride[k]!.seg !== ride[k - 1]!.seg && ride[k - 1]!.seg >= 0 && ride[k]!.seg >= 0) worstSeam = Math.min(worstSeam, ratio);
		}
		const exit = r.samples[r.samples.length - 1]!;
		console.log(
			`ochre rampbug ${c.label}: ${c.ramps.length} segs, in ${entry.toFixed(0)} → out ${exit.speed.toFixed(0)} u/s, surfing ${(surfing * 100).toFixed(1)}%, worst seam ${(worstSeam * 100).toFixed(2)}%, worst tick ${(worstTick * 100).toFixed(2)}%`
		);
		expect(onFace, 'stays on the ramp').toBeGreaterThanOrEqual(0.97);
		// A steepening crest at ~3000 u/s gives a few ticks of airtime.
		expect(surfing, 'touches the ramp').toBeGreaterThanOrEqual(0.8);
		expect(segs.size, 'visits (nearly) every segment').toBeGreaterThanOrEqual(c.ramps.length - 2);
		expect(worstSeam, 'no speed lost at a seam (> 2%)').toBeGreaterThanOrEqual(0.98);
		expect(worstTick, 'no sudden speed loss anywhere (> 2%)').toBeGreaterThanOrEqual(0.98);
	});
});

describe('surf_ochre: the skilled line (real physics)', () => {
	it('finishes from the spawn, riding every chain and crossing every checkpoint in order', () => {
		expect(run.reason).toBe('end');
		for (let i = 0; i < OCHRE_CHAINS.length; i++) expect(run.samples.some((s) => s.k === i && s.seg >= 0 && s.surfing), OCHRE_CHAINS[i]!.label).toBe(true);
		const firstIn = checkpoints.map((c) => run.samples.findIndex((s) => touches(s.pos, c)));
		for (const [k, t] of firstIn.entries()) expect(t, `checkpoint ${k + 1}`).toBeGreaterThanOrEqual(0);
		expect([...firstIn].sort((a, b) => a - b)).toEqual(firstIn);
		const per = OCHRE_CHAINS.map((c, i) => {
			const on = run.samples.filter((s) => s.k === i && s.seg >= 0);
			return { label: c.label, in: on[0]!.speed, out: on[on.length - 1]!.speed };
		});
		const time = (run.walk.length + run.samples.length) * TICK_INTERVAL;
		console.log(`ochre skilled line: ${time.toFixed(1)} s\n` + per.map((s) => `  ${s.label.padEnd(18)} in ${s.in.toFixed(0).padStart(4)}  out ${s.out.toFixed(0).padStart(4)} u/s`).join('\n'));
		expect(time).toBeGreaterThan(30);
	});

	it('flies through every opening with the whole hull inside it', () => {
		for (const g of gates) {
			const c = gateCrossing(path, g);
			console.log(`ochre gate ${g.label}: lateral ${c.lateral.toFixed(0)}, margin ${c.margin.toFixed(0)}`);
			expect(c.crossed, g.label).toBe(true);
			expect(c.inside, `${g.label}: margin ${c.margin.toFixed(0)}`).toBe(true);
		}
	});

	it('never touches an obstacle (arches, pillars, glass, walls)', () => {
		for (const [i, q] of path.entries()) expect(touching(obstacleWorld, q), `tick ${i}`).toBe(false);
	});

	it('makes a > 120° air-strafe turn after the high window', () => {
		const before = run.samples.findLast((s) => s.k === 9 && s.seg >= 0)!;
		const after = run.samples.find((s) => s.k === 10 && s.seg >= 0)!;
		let d = Math.abs(Math.atan2(after.vel.y, after.vel.x) - Math.atan2(before.vel.y, before.vel.x)) / DEG;
		if (d > 180) d = 360 - d;
		expect(d).toBeGreaterThan(120);
	});

	it('bends and the spiral are banked for the speed carried: hold speed above the rider on every turning segment', () => {
		for (const [i, c] of OCHRE_CHAINS.entries()) {
			let worst = Infinity;
			for (let s = 1; s < c.yaws.length; s++) {
				const t = Math.abs(c.yaws[s]! - c.yaws[s - 1]!);
				if (t === 0) continue;
				const radius = (c.dist[s + 1]! - c.dist[s]!) / (t * DEG);
				const fastest = Math.max(0, ...run.samples.filter((x) => x.k === i && x.seg === s).map((x) => x.speed));
				worst = Math.min(worst, bankSpeed(c.angle, radius) / Math.max(fastest, 1));
			}
			if (worst === Infinity) continue;
			console.log(`ochre bank ${c.label}: hold speed / rider speed ≥ ${worst.toFixed(2)}`);
			expect(worst).toBeGreaterThan(1);
		}
	});

	it('scenery stays ≥ 256 units from the flight path, ledges ≥ 96; no teleport is touched on the way', () => {
		let closest = Infinity;
		let closestLedge = Infinity;
		for (const [k, q] of [...run.walk, ...path].entries()) {
			if (k % 2) continue;
			for (const b of OCHRE_SCENERY) closest = Math.min(closest, hullDist(q, b));
			for (const l of OCHRE_LEDGES) closestLedge = Math.min(closestLedge, hullDist(q, l));
		}
		for (const q of path.slice(0, -1)) for (const tp of teleports) expect(touches(q, tp)).toBe(false);
		console.log(`ochre: closest scenery ${closest.toFixed(0)} (${OCHRE_SCENERY.length} boxes); closest ledge ${closestLedge.toFixed(0)}`);
		expect(closest).toBeGreaterThanOrEqual(256);
		expect(closestLedge).toBeGreaterThanOrEqual(96);
	});
});

describe('surf_ochre: imprecise lines fail (real physics)', () => {
	/** Did the attempt get through opening `label` cleanly (without touching its obstacle) and on to the next chain? */
	const madeIt = (r: ReturnType<typeof from>, label: string) => {
		const g = gate(label);
		const ob = buildCollisionWorld({ brushes: OCHRE_OBSTACLES.find((o) => o.gates.includes(g))!.brushes });
		const clean = !r.path.some((q) => touching(ob, q));
		// A hull stopped by an edge slides on along it (no hit in a tick-to-tick trace): catch it as a sudden loss of horizontal speed.
		const hs = r.samples.map((x) => Math.hypot(x.vel.x, x.vel.y));
		const noBonk = hs.every((v, i) => i === 0 || v >= hs[i - 1]! * 0.75);
		return r.reason === 'landed' && clean && noBonk && gateCrossing(r.path, g).inside;
	};

	it('the skilled launch states get through (control)', () => {
		expect(madeIt(from(1, () => {}), 'slot fin')).toBe(true);
		expect(madeIt(from(3, () => {}), 'glass floor hole')).toBe(true);
		expect(madeIt(from(4, () => {}), 'hoodoo gap')).toBe(true);
		expect(madeIt(from(5, () => {}), 'glass tube 1')).toBe(true);
		expect(madeIt(from(8, () => {}), 'speed window')).toBe(true);
	});

	it('slot fin: leaving the drop-in 100 units off the line hits the fin', () => {
		for (const d of [-100, 100]) expect(madeIt(from(1, shiftSide(d)), 'slot fin'), `${d}`).toBe(false);
	});

	it('glass floor: 15% slower lands on the glass, 15% faster hits the hole’s far edge', () => {
		for (const f of [0.85, 1.15]) expect(madeIt(from(3, scaleVel(f)), 'glass floor hole'), `×${f}`).toBe(false);
	});

	it('pillars: flying the transfer straight (no air strafe) hits the hoodoo', () => {
		const straight = OCHRE_ROUTE.map((s, i) => (i === 4 ? { ...s, air: { kind: 'none' as const } } : s));
		expect(madeIt(from(4, () => {}, straight), 'hoodoo gap')).toBe(false);
	});

	it('glass tube: 90 units higher hits the glass ceiling; 220 to either side hits a glass wall', () => {
		expect(madeIt(from(5, (p) => (p.origin = { ...p.origin, z: p.origin.z + 90 })), 'glass tube 1')).toBe(false);
		for (const d of [-220, 220]) expect(madeIt(from(5, shiftSide(d)), 'glass tube 1'), `${d}`).toBe(false);
	});

	it('speed window: −15% or +15% launch speed off the wave hits the mesa wall', () => {
		for (const f of [0.85, 1.15]) expect(madeIt(from(8, scaleVel(f)), 'speed window'), `×${f}`).toBe(false);
	});

	it('air turn: no turn after the high window misses the final descent', () => {
		const noTurn = OCHRE_ROUTE.map((s, i) => (i === 10 ? { ...s, air: { kind: 'none' as const } } : s));
		const r = from(10, () => {}, noTurn);
		expect(r.reason).not.toBe('landed');
	});

	it('canyon arches: riding the upper face (fraction 0.15) hits a lintel', () => {
		const high = OCHRE_ROUTE.map((s, i) => (i === 1 ? { ...s, target: 0.15 } : s));
		const r = from(1, () => {}, high, 6, false);
		const lintels = buildCollisionWorld({ brushes: obstacle('canyon arches').brushes });
		const hit = r.path.some((q) => touching(lintels, q));
		expect(hit).toBe(true);
	});
});

describe('surf_ochre: checkpoint ledges', () => {
	it.each(checkpoints.map((c) => [c.index, c] as const))('from checkpoint %s, strafing off the ledge drops onto its chain and surfs it', (_i, c) => {
		const k = OCHRE_CHECKPOINT_CHAINS[c.index - 1]!;
		const { p } = walkOff(c.respawn, k);
		// From a standing start the section's speed is not there: this only checks the drop-in (land on the chain and surf it a while).
		const steps = OCHRE_ROUTE.map((s) => ({ ...s, air: { kind: 'none' as const } }));
		const r = runRouteBot({ world: fullWorld, move: playerMove, cvars: SURF_CVARS, dt: TICK_INTERVAL, p, steps, state: newRouteState(k), seconds: 3, stop: stopAtZones });
		const on = r.samples.filter((s) => s.k === k && s.seg >= 0);
		expect(on.length * TICK_INTERVAL).toBeGreaterThanOrEqual(0.35);
	});
});

describe('surf_ochre: no input cannot finish', () => {
	function runFixed(c: UserCmd, seconds: number) {
		const p = createPlayer(lift(m.spawn).pos);
		for (let i = 0; i < Math.round(seconds / TICK_INTERVAL); i++) {
			playerMove(fullWorld, p, c, SURF_CVARS, TICK_INTERVAL);
			const r = stopAtZones(p);
			if (r) return { reason: r, p };
		}
		return { reason: 'timeout', p };
	}

	it('standing still stays in the start room', () => {
		const r = runFixed(cmd(), 10);
		expect(r.reason).toBe('timeout');
		expect(r.p.onGround).toBe(true);
		expect(inBox(r.p.origin, startZ)).toBe(true);
	});

	for (const yaw of [0, 90, 180, 270])
		for (const jump of [false, true])
			it(`holding W${jump ? ' + jump' : ''} at yaw ${yaw} never finishes`, () => {
				const r = runFixed(cmd({ yaw, forwardmove: 450, buttons: jump ? IN_JUMP : 0 }), 40);
				expect(r.reason).not.toBe('end');
			});
});
