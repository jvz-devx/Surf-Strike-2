/**
 * surf_kessler — hard (CS tier 4–5 feel) staged surf. A derelict orbital
 * station at night: six neon-lit modules adrift in a debris field, a
 * navigation grid far below, stars (embers) all around.
 *
 * An original layout. It uses the obstacle vocabulary of hard surf maps
 * (holes in thick walls, downward spirals, glass, ceilings, pillars, offset
 * hole sequences, big air turns) but copies no existing map's layout.
 *
 * Staged: every stage starts on its own platform (stage zone + respawn) and
 * ends by landing on the next stage's platform (the ground speed clamp acts
 * like a CS stage teleport's velocity reset); a miss teleports back to the
 * current stage start. Every obstacle is visible from the stage platform or the
 * ramp before it, openings are lined with glowing edges and glass panels have
 * bright edges, and each stage has one clear intended line (the tests' skilled
 * route bot flies it with the real physics).
 *
 * Stages (KESSLER_STAGES; obstacles in KESSLER_OBSTACLES, per stage):
 *  1 Docking Ring (cyan)   +X  wide 50–52° drop-in → WINDOW (352 × 288 in a
 *                              128-thick bulkhead) → 1b → twin PILLARS on the
 *                              flight to the stage 2 platform: strafe through
 *                              the 320 gap beside them
 *  2 Arc Gallery (violet)  +Y  120° right-bending curve → NARROW WINDOW
 *                              (224 × 256) → 90° left curve under three LOW
 *                              CEILING ribs (ride below face fraction 0.28)
 *  3 Reactor Well (amber)  +X  DOWNWARD SPIRAL: 540° left, banked 56°, radius
 *                              1200 → 2600 around the reactor core, then a GLASS
 *                              FLOOR with a 400 × 448 hole: drop through onto the
 *                              ramp below (its peak runs 100 under the glass)
 *  4 Wall Spine (green)    -Y  entry ramp → a 70° WALL-SURF face inside a GLASS
 *                              CORRIDOR (glass wall beside it, glass lid over its
 *                              top) → HOLE EXIT (320 × 288 window in the end
 *                              bulkhead)
 *  5 Needle Array (red)    +X  narrow 58° ramp → a 130° right AIR TURN through
 *                              two OFFSET WINDOWS (288 × 256, the second turned
 *                              ~60° from the first) → narrow ramp → SLOT
 *                              (160 × 288) → narrow ramp
 *  6 Re-entry (white-blue) +X  5120-long steep downhill → PILLARS in the long
 *                              gap (route round them) → final ramp → the END
 *                              ROOM: fly in through a 384 × 320 HOLE in its wall
 *
 * Construction rules (as before): faces 50–60° (wall-surf 70–80°), curves and
 * spirals turn ≤ 4° per seam with every seam stepping DOWN by SEAM_DROP (no
 * rampbugs; tested on every chain), banked curves stay under their hold speed,
 * landings come in diagonally in the travel direction, scenery (station frames)
 * keeps ≥ 256 from every flight path. Obstacle positions come from each
 * transfer's design flight plus measured corrections (TUNE) so the skilled line
 * crosses every opening near its middle; the tests show sloppier lines fail.
 */
import { SURF_CVARS } from '../cvars.ts';
import type { Vec3 } from '../types.ts';
import type { BrushDef, MapDef, Spawn, Theme, Zone } from './types.ts';
import { box, boundsOf, brushBounds, dirXY, endZone, landingPoint, platform, stageZone, startZone, teleportBelow, topCenter, v3, zoneOver, type BoxBrush } from './helpers.ts';
import { bend, chainExit, facePoint, gradeBlend, rampChain, straight, type PeakStep, type RampChain } from './surf_ochre-helpers.ts';
import { airTurnFlight, faceOut, yawDelta } from './surf_kessler-helpers.ts';
import {
	catchUnder,
	chainAfterTurn,
	flightPoint,
	floorWithHole,
	glassPanel,
	leg,
	legFlight,
	orientedBox,
	spiralSteps,
	wallWithHole,
	type AirPlan,
	type Gate,
	type Leg,
	type Obstacle,
	type RouteStep
} from './surf-obstacles.ts';

const DEG = Math.PI / 180;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Peak height of the first ramp. */
const TOP = 24000;
/** Stage platforms: square size; top height below the launching ramp's exit. */
const PAD_SIZE = 1280;
const PAD_DROP = 384;
/** Platform edge overhang over the next ramp's start, and peak depth below the platform top. */
const OVERHANG = 64;
const PEAK_BELOW_PAD = 160;

/** Measured corrections (sideways, up) of obstacle openings against the skilled route bot. */
const TUNE: Record<string, [number, number]> = {
	w1: [22, 37],
	p1: [0, 0],
	w2: [34, 38],
	floor3: [40, 0],
	w4: [-117, -471],
	o5a: [0, 54],
	o5b: [33, 60],
	s5: [0, 0],
	p6: [0, 0],
	end6: [243, -485]
};
/** Measured landing-spot corrections (x, y) of stage platforms, keyed by the stage that lands on them. */
const PAD_TUNE: Record<number, [number, number]> = { 1: [0, 0], 2: [0, 0], 3: [0, 0], 4: [-129, 967], 5: [0, 0], 6: [-1000, 168] };

export interface KesslerStage {
	index: number;
	name: string;
	/** Heading of the platform's walk-off edge (axis-aligned). */
	yaw: number;
	pad: BoxBrush;
	/** The stage's chains in riding order, with the intended line. */
	route: RouteStep[];
	/** How the last chain's exit is flown (onto the next platform). */
	exit: AirPlan;
	/** Where the stage ends: the next stage's platform, or the end platform. */
	target: BoxBrush;
	obstacles: Obstacle[];
	scenery: BoxBrush[];
}

const brushes: BrushDef[] = [];
const zones: Zone[] = [];
const stages: KesslerStage[] = [];
const dir = (yaw: number) => ({ x: Math.cos(yaw * DEG), y: Math.sin(yaw * DEG) });

/**
 * Peak start for the first chain off a platform: the ramp starts OVERHANG back
 * under the walk-off edge, its peak PEAK_BELOW_PAD below the top, shifted
 * sideways so the platform's centre line runs over the face at `latFrac`.
 */
function firstFrom(pad: BoxBrush, yaw: number, side: 'left' | 'right', hw: number, latFrac = 0.35): Vec3 {
	const c = topCenter(pad);
	const d = dir(yaw);
	const half = Math.abs(d.x) > 0.5 ? (pad.max.x - pad.min.x) / 2 : (pad.max.y - pad.min.y) / 2;
	const o = faceOut(yaw, side);
	return v3(r3(c.x + d.x * (half - OVERHANG) - o.x * hw * latFrac), r3(c.y + d.y * (half - OVERHANG) - o.y * hw * latFrac), r3(c.z - PEAK_BELOW_PAD));
}

/** Stage platform where a launch off `prev` at `speed` (along its exit, plus `drift` degrees) lands, PAD_DROP (+ dropExtra) below its exit. */
function padAfter(prev: RampChain, speed: number, material: string, dropExtra = 0, drift = 0, nudge: [number, number] = [0, 0]): BoxBrush {
	const ex = chainExit(prev);
	const vh = speed / Math.sqrt(1 + ex.grade * ex.grade);
	const d = dir(ex.yaw + drift);
	const top = Math.round(ex.point.z - PAD_DROP - dropExtra);
	const hit = landingPoint(ex.point, v3(d.x * vh, d.y * vh, -ex.grade * vh), top);
	return platform(v3(Math.round(hit.x + nudge[0]), Math.round(hit.y + nudge[1]), top), PAD_SIZE, PAD_SIZE, material);
}

const chainLeg = (prev: RampChain, l: Leg) => leg(prev, l, l.material ?? 'dock');
const gateIn = (o: Obstacle) => o.gates[0]!;
const routeOf = (chains: RampChain[], plans: Array<Partial<RouteStep>> = []): RouteStep[] => chains.map((chain, i) => ({ chain, target: 0.45, air: { kind: 'none' }, ...plans[i] }));

/** Two pillars across a flight `a` ahead: one on the line, one `gap + 160` to the left; the gate is the gap between them. */
function pillarPair(label: string, f: ReturnType<typeof legFlight>, a: number, tune: [number, number], material: string, gap = 320, side = 1): Obstacle {
	const p0 = flightPoint(f, a);
	const z0 = Math.round(p0.z - 1400);
	const z1 = Math.round(p0.z + 900);
	const col = (lat: number) => orientedBox({ center: flightPoint(f, a, lat), yaw: f.yaw, along: 160, across: 160, z0, z1, material });
	const g = flightPoint(f, a, side * (80 + gap / 2) + tune[0]);
	return {
		label,
		kind: 'pillar',
		brushes: [col(0), col(side * (160 + gap))],
		gates: [{ label, type: 'wall', center: v3(g.x, g.y, g.z + tune[1]), yaw: f.yaw, halfW: gap / 2, halfH: 900 }]
	};
}

/** A window wall `a` ahead on a flight (hull centred in the hole on the design flight, plus TUNE). */
function windowOn(label: string, f: ReturnType<typeof legFlight>, a: number, tune: [number, number], o: { w: number; h: number; thick: number; width: number; material: string; kind?: Obstacle['kind'] }): Obstacle {
	const h = flightPoint(f, a, tune[0]);
	return wallWithHole({ label, kind: o.kind ?? 'window', hole: v3(h.x, h.y, h.z + 36 + tune[1]), yaw: f.yaw, holeW: o.w, holeH: o.h, thickness: o.thick, width: o.width, z0: h.z - 1400, z1: h.z + 1000, material: o.material });
}

/** Low ribs across a chain at the given distances: riding above face fraction `clearFrac` hits them. */
function ribs(label: string, c: RampChain, at: number[], clearFrac: number, material: string): Obstacle {
	const out: BrushDef[] = [];
	for (const a of at) {
		let seg = 0;
		while (seg < c.ramps.length - 1 && c.dist[seg + 1]! < a) seg++;
		const s = a - c.dist[seg]!;
		const p = facePoint(c, seg, s, clearFrac);
		const back = facePoint(c, seg, s, -0.4);
		const front = facePoint(c, seg, s, 1.3);
		const z0 = Math.round(p.z + 72);
		const mid = { x: (back.x + front.x) / 2, y: (back.y + front.y) / 2 };
		out.push(orientedBox({ center: mid, yaw: c.yaws[seg]!, along: 96, across: Math.hypot(front.x - back.x, front.y - back.y), z0, z1: z0 + 96, material }));
	}
	return { label, kind: 'ceiling', brushes: out, gates: [] };
}

// ---------------------------------------------------------------------------
// Stage 1 — Docking Ring (+X): drop-in, window, 1b, pillars onto the stage 2 platform.

const startPad = platform(v3(0, 0, TOP + PEAK_BELOW_PAD), 768, 768, 'dockPad');
{
	const a = rampChain({ label: '1a', start: firstFrom(startPad, 0, 'right', 512), yaw: 0, side: 'right', angle: 50, halfWidth: 512, material: 'dock', steps: straight(3328, 0.12) });
	const L1b: Leg = { label: '1b', side: 'left', angle: 52, halfWidth: 448, steps: straight(3072, 0.1), speed: 1150, approach: 'peak', delta: 4, ahead: 900, back: 420, extra: 100, drift: 0, material: 'dockAlt' };
	const b = chainLeg(a, L1b);
	const w1 = windowOn('docking window', legFlight(a, L1b), 300, TUNE.w1!, { w: 352, h: 288, thick: 128, width: 2400, material: 'dockWall' });
	const ex = { drift: 0, speed: 1400 };
	const p1 = pillarPair('docking pillars', legFlight(b, ex), 700, TUNE.p1!, 'dockWall');
	const pad2 = padAfter(b, ex.speed, 'arcPad', 0, 0, PAD_TUNE[1]);
	stages.push({ index: 1, name: 'Docking Ring', yaw: 0, pad: startPad, route: routeOf([a, b]), exit: { kind: 'via', gates: [gateIn(p1)] }, target: pad2, obstacles: [w1, p1], scenery: [] });
}

// ---------------------------------------------------------------------------
// Stage 2 — Arc Gallery (+Y): 120° right curve, narrow window, 90° left curve under ribs.

{
	const pad = stages[0]!.target;
	const a = rampChain({
		label: '2a',
		start: firstFrom(pad, 90, 'right', 448),
		yaw: 90,
		side: 'right',
		angle: 54,
		halfWidth: 448,
		material: 'arc',
		steps: [...straight(640, 0.07), ...bend(-120, 4290, 0.07), ...straight(384, 0.07)]
	});
	const L2b: Leg = { label: '2b', side: 'left', angle: 55, halfWidth: 416, steps: [...straight(700, 0.07), ...bend(90, 2815, 0.07), ...straight(512, 0.07)], speed: 1100, approach: 'peak', delta: 4, ahead: 800, back: 380, extra: 100, drift: 0, material: 'arcAlt' };
	const b = chainLeg(a, L2b);
	const w2 = windowOn('arc window', legFlight(a, L2b), 300, TUNE.w2!, { w: 224, h: 256, thick: 160, width: 2200, material: 'arcWall' });
	const c2 = ribs('arc ribs', b, [2500, 2800, 3050], 0.28, 'arcWall');
	const pad3 = padAfter(b, 1150, 'wavePad', 0, 0, PAD_TUNE[2]);
	stages.push({ index: 2, name: 'Arc Gallery', yaw: 90, pad, route: routeOf([a, b]), exit: { kind: 'none' }, target: pad3, obstacles: [w2, c2], scenery: [] });
}

// ---------------------------------------------------------------------------
// Stage 3 — Reactor Well (+X): 540° downward spiral around the core, glass floor hole, under-floor ramp.

export const KESSLER_SPIRAL = { turn: 540, r0: 1200, r1: 2600, angle: 56, halfWidth: 384, grade: 0.05 };
{
	const pad = stages[1]!.target;
	const S = KESSLER_SPIRAL;
	const a = rampChain({
		label: '3a',
		start: firstFrom(pad, 0, 'left', S.halfWidth),
		yaw: 0,
		side: 'left',
		angle: S.angle,
		halfWidth: S.halfWidth,
		material: 'wave',
		steps: [...straight(1200, 0.06), ...spiralSteps(S.turn, S.r0, S.r1, S.grade), ...straight(500, 0.05)]
	});
	// Glass floor: the flight off the spiral crosses it FLOOR_AT ahead; the hole sits just past that.
	const fl = legFlight(a, { drift: 0, speed: 1200 });
	const [dl, dz] = TUNE.floor3!;
	const FLOOR_AT = 700;
	const HOLE = { along: 400, across: 448 };
	const hz = Math.round(flightPoint(fl, FLOOR_AT).z + dz);
	const hc = flightPoint(fl, FLOOR_AT + 200 + dl);
	const hole = v3(hc.x, hc.y, hz);
	const floor = floorWithHole({ label: 'reactor glass floor', hole, yaw: fl.yaw, holeAlong: HOLE.along, holeAcross: HOLE.across, before: 500, beyond: 800, side: 640, thickness: 32, material: 'waveGlass' });
	floor.kind = 'glassFloor';
	// Under-floor ramp: a right face (its peak right under the hole centre, 100 below the glass), turned 3° left of the flight.
	const yaw = fl.yaw + 3;
	const d = dirXY(yaw);
	const back = HOLE.along / 2;
	const g = 0.1;
	const b = rampChain({ label: '3b', start: v3(hole.x - d.x * back, hole.y - d.y * back, hole.z - 132 + g * back), yaw, side: 'right', angle: 52, halfWidth: 448, material: 'waveAlt', steps: straight(3000, g) });
	b.aim = facePoint(b, 0, back + 160, 0.15);
	const pad4 = padAfter(b, 1300, 'wallPad', 0, 0, PAD_TUNE[3]);
	stages.push({ index: 3, name: 'Reactor Well', yaw: 0, pad, route: routeOf([a, b]), exit: { kind: 'none' }, target: pad4, obstacles: [floor], scenery: [] });
}

// ---------------------------------------------------------------------------
// Stage 4 — Wall Spine (-Y): entry ramp, wall-surf face in a glass corridor, hole exit.

{
	const pad = stages[2]!.target;
	const a = rampChain({ label: '4a', start: firstFrom(pad, -90, 'left', 384), yaw: -90, side: 'left', angle: 56, halfWidth: 384, material: 'wall', steps: [...straight(1800, 0.12), ...gradeBlend(0.12, 0, 400), ...straight(500, 0)] });
	const L4b: Leg = { label: '4b', side: 'right', angle: 70, halfWidth: 320, steps: straight(1800, 0.03), speed: 750, approach: 'peak', delta: 2, ahead: 300, back: 140, extra: -30, drift: 0, frac: 0.15, material: 'wallAlt' };
	const b = chainLeg(a, L4b);
	// Glass corridor: a glass wall 224 out from the wall face's base edge, and a glass lid 64 over its peak.
	const t = Math.tan(L4b.angle * DEG);
	const len = 1800;
	const yaw = b.yaws[0]!;
	const sideDir = faceOut(yaw, 'right');
	const p0 = b.peak[0]!;
	const mid = (lat: number) => ({ x: p0.x + dir(yaw).x * (len / 2 - 100) + sideDir.x * lat, y: p0.y + dir(yaw).y * (len / 2 - 100) + sideDir.y * lat });
	const peakMid = p0.z - 0.03 * (len / 2);
	const wallLat = 320 + 224;
	const lid = Math.round(p0.z + 64);
	const corridor: Obstacle = {
		label: 'wall-surf glass corridor',
		kind: 'glassWall',
		brushes: [
			glassPanel({ center: mid(wallLat + 16), yaw, along: len - 400, across: 32, z0: Math.round(peakMid - 320 * t - 500), z1: lid, material: 'wallGlass' }),
			glassPanel({ center: mid((wallLat + 32) / 2 - 40), yaw, along: len - 400, across: wallLat + 32 + 80, z0: lid, z1: lid + 24, material: 'wallGlass' })
		],
		gates: []
	};
	const ex = { drift: 0, speed: 1250 };
	const w4 = windowOn('wall exit', legFlight(b, ex), 360, TUNE.w4!, { w: 320, h: 288, thick: 128, width: 2000, material: 'wallBulk' });
	const pad5 = padAfter(b, ex.speed, 'needlePad', 200, 0, PAD_TUNE[4]);
	stages.push({ index: 4, name: 'Wall Spine', yaw: -90, pad, route: routeOf([a, b], [{}, { target: 0.4 }]), exit: { kind: 'via', gates: [gateIn(w4)] }, target: pad5, obstacles: [corridor, w4], scenery: [] });
}

// ---------------------------------------------------------------------------
// Stage 5 — Needle Array (+X): narrow ramp, 130° right air turn through two offset windows, slot, narrow ramp.

export const KESSLER_TURN = { speed: 740, turn: -130 };
{
	const pad = stages[3]!.target;
	const a = rampChain({ label: '5a', start: firstFrom(pad, 0, 'left', 240), yaw: 0, side: 'left', angle: 58, halfWidth: 240, material: 'needle', steps: straight(2048, 0.12) });
	const ex = chainExit(a);
	const aimYaw = ex.yaw + KESSLER_TURN.turn;
	const b = chainAfterTurn(a, { label: '5b', speed: KESSLER_TURN.speed, aimYaw, settle: 0.08, yaw: aimYaw - 18, side: 'right', angle: 57, halfWidth: 240, steps: straight(2304, 0.1), back: 520, frac: 0.35, drop: -250, material: 'needleAlt' });
	// The offset windows sit on the full-rate turn's flight, 30% and 75% through the turn.
	const vh = KESSLER_TURN.speed / Math.sqrt(1 + ex.grade * ex.grade);
	const d0 = dir(ex.yaw);
	const path = airTurnFlight(ex.point, v3(d0.x * vh, d0.y * vh, -ex.grade * vh), aimYaw, { dt: 1 / 256 });
	const done = path.findIndex((s) => Math.abs(yawDelta(Math.atan2(s.v.y, s.v.x) / DEG, aimYaw)) <= 1.5);
	const onTurn = (label: string, frac: number, tune: [number, number]): Obstacle => {
		const s = path[Math.round(done * frac)]!;
		const h = Math.atan2(s.v.y, s.v.x) / DEG;
		const l = { x: -Math.sin(h * DEG), y: Math.cos(h * DEG) };
		const c = v3(s.p.x + l.x * tune[0], s.p.y + l.y * tune[0], s.p.z + 36 + tune[1]);
		return wallWithHole({ label, kind: 'window', hole: c, yaw: h, holeW: 288, holeH: 256, thickness: 96, width: 1100, z0: c.z - 1000, z1: c.z + 700, material: 'needleWall' });
	};
	const o1 = onTurn('needle window 1', 0.3, TUNE.o5a!);
	const o2 = onTurn('needle window 2', 0.75, TUNE.o5b!);
	const L5c: Leg = { label: '5c', side: 'left', angle: 58, halfWidth: 224, steps: straight(1792, 0.12), speed: 800, approach: 'base', delta: 6, ahead: 800, back: 460, extra: -300, drift: 0, frac: 0.3, material: 'needle' };
	const c = chainLeg(b, L5c);
	const s5 = windowOn('needle slot', legFlight(b, L5c), 320, TUNE.s5!, { w: 160, h: 288, thick: 160, width: 1600, material: 'needleWall', kind: 'slot' });
	const pad6 = padAfter(c, 1250, 'reentryPad', 0, 0, PAD_TUNE[5]);
	stages.push({
		index: 5,
		name: 'Needle Array',
		yaw: 0,
		pad,
		route: routeOf([a, b, c], [{}, { air: { kind: 'yaw', yaw: aimYaw } }, {}]),
		exit: { kind: 'none' },
		target: pad6,
		obstacles: [o1, o2, s5],
		scenery: []
	});
}

// ---------------------------------------------------------------------------
// Stage 6 — Re-entry (+X): long steep downhill, pillars in the long gap, final ramp, hole into the end room.

{
	const pad = stages[4]!.target;
	const a = rampChain({ label: '6a', start: firstFrom(pad, 0, 'right', 448), yaw: 0, side: 'right', angle: 56, halfWidth: 448, material: 'reentry', steps: straight(5120, 0.26) });
	const L6b: Leg = { label: '6b', side: 'left', angle: 54, halfWidth: 448, steps: straight(2560, 0.08), speed: 1550, approach: 'peak', delta: 3, ahead: 1700, back: 1000, extra: -350, frac: 0.1, shift: 200, drift: 0, material: 'reentryAlt' };
	const b = chainLeg(a, L6b);
	const p6 = pillarPair('re-entry pillars', legFlight(a, L6b), 800, TUNE.p6!, 'reentryWall', 320, 1);
	// End room: the end pad inside four walls and a roof; fly in through a hole in its front wall.
	const ex = { drift: 0, speed: 1800 };
	const f = legFlight(b, ex);
	const endPad = padAfter(b, ex.speed, 'endPad', 700, 0, PAD_TUNE[6]);
	const frontX = endPad.min.x;
	const a0 = frontX - f.p.x;
	const ch = flightPoint(f, a0 / Math.cos(f.yaw * DEG), TUNE.end6![0]);
	const H = 900;
	const top = endPad.max.z;
	const holeC = v3(frontX - 32, ch.y, ch.z + 36 + TUNE.end6![1]);
	const front = wallWithHole({ label: 'end room hole', kind: 'window', hole: holeC, yaw: 0, holeW: 384, holeH: 320, thickness: 64, width: endPad.max.y - endPad.min.y + 128, z0: top - 64, z1: top + H, material: 'endFrame', shift: (endPad.min.y + endPad.max.y) / 2 - holeC.y });
	const room: BrushDef[] = [
		box(v3(endPad.min.x, endPad.min.y - 64, top - 64), v3(endPad.max.x + 64, endPad.min.y, top + H), 'endFrame'),
		box(v3(endPad.min.x, endPad.max.y, top - 64), v3(endPad.max.x + 64, endPad.max.y + 64, top + H), 'endFrame'),
		box(v3(endPad.max.x, endPad.min.y, top), v3(endPad.max.x + 64, endPad.max.y, top + H), 'endFrame'),
		box(v3(endPad.min.x - 64, endPad.min.y - 64, top + H), v3(endPad.max.x + 64, endPad.max.y + 64, top + H + 64), 'endFrame')
	];
	front.brushes.push(...room);
	stages.push({
		index: 6,
		name: 'Re-entry',
		yaw: 0,
		pad,
		route: routeOf([a, b], [{}, { air: { kind: 'via', gates: [gateIn(p6)], then: 'aim' } }]),
		exit: { kind: 'via', gates: [gateIn(front)] },
		target: endPad,
		obstacles: [p6, front],
		scenery: []
	});
}

const endPad = stages[5]!.target;
for (const st of stages) {
	brushes.push(st.pad);
	for (const r of st.route) brushes.push(...r.chain.ramps);
	for (const o of st.obstacles) brushes.push(...o.brushes);
}
brushes.push(endPad);

// ---------------------------------------------------------------------------
// Scenery: a station module frame around each stage (pillars, hull plates,
// overhead ribs), kept ≥ SCENERY_CLEARANCE from every playable surface,
// obstacle and transfer line.

export const SCENERY_CLEARANCE = 256;
const FRAME_MARGIN = 896;

type Box3 = { min: Vec3; max: Vec3 };
const boxGap = (a: Box3, b: Box3) =>
	Math.hypot(
		Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x),
		Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y),
		Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z)
	);

/** Stage frame scaffold (frame boxes around the stage's bounds). */
function stageFrame(st: KesslerStage, material: string): BoxBrush[] {
	const ramps = st.route.flatMap((l) => l.chain.ramps);
	const b = boundsOf([st.pad, ...ramps]);
	const x0 = Math.round(b.min.x - FRAME_MARGIN);
	const x1 = Math.round(b.max.x + FRAME_MARGIN);
	const y0 = Math.round(b.min.y - FRAME_MARGIN);
	const y1 = Math.round(b.max.y + FRAME_MARGIN);
	const zb = Math.round(boundsOf(ramps).min.z - 192);
	const zt = Math.round(b.max.z + 896);
	const P = 160; // pillar size
	const out: BoxBrush[] = [];
	const bx = (ax: number, ay: number, az: number, cx: number, cy: number, cz: number) =>
		out.push({ type: 'box', min: v3(Math.min(ax, cx), Math.min(ay, cy), Math.min(az, cz)), max: v3(Math.max(ax, cx), Math.max(ay, cy), Math.max(az, cz)), material });
	// Corner pillars and pillars every ~2048 along each side.
	const xs = spread(x0, x1, 2048);
	const ys = spread(y0, y1, 2048);
	const posts: Array<[number, number]> = [];
	for (const x of xs) posts.push([x, y0], [x, y1]);
	for (const y of ys.slice(1, -1)) posts.push([x0, y], [x1, y]);
	for (const [x, y] of posts) bx(x - P / 2, y - P / 2, zb, x + P / 2, y + P / 2, zt - 96);
	// Overhead ribs across the short axis at each post pair, and the two long top rails.
	const longX = x1 - x0 >= y1 - y0;
	if (longX) {
		for (const x of xs) bx(x - 48, y0 - P / 2, zt - 96, x + 48, y1 + P / 2, zt);
		for (const y of [y0, y1]) for (let k = 0; k < xs.length - 1; k++) bx(xs[k]! + 48, y - 48, zt - 96, xs[k + 1]! - 48, y + 48, zt);
	} else {
		for (const y of ys) bx(x0 - P / 2, y - 48, zt - 96, x1 + P / 2, y + 48, zt);
		for (const x of [x0, x1]) for (let k = 0; k < ys.length - 1; k++) bx(x - 48, ys[k]! + 48, zt - 96, x + 48, ys[k + 1]! - 48, zt);
	}
	// Hull plates: a low skirt between neighbouring posts on the long sides (gaps keep it a lattice).
	const plate = (ax: number, ay: number, cx: number, cy: number) => bx(ax, ay, zb, cx, cy, zb + 320);
	if (longX) {
		for (const y of [y0, y1]) for (let k = 0; k < xs.length - 1; k++) plate(xs[k]! + 384, y - 24, xs[k + 1]! - 384, y + 24);
	} else {
		for (const x of [x0, x1]) for (let k = 0; k < ys.length - 1; k++) plate(x - 24, ys[k]! + 384, x + 24, ys[k + 1]! - 384);
	}
	return out;
}

function spread(a: number, b: number, step: number): number[] {
	const n = Math.max(1, Math.round((b - a) / step));
	return Array.from({ length: n + 1 }, (_, i) => Math.round(a + ((b - a) * i) / n));
}

const STAGE_FRAME_MATERIAL = ['dockFrame', 'arcFrame', 'waveFrame', 'wallFrame', 'needleFrame', 'reentryFrame'];

/** Sample points of the course: every chain face, every transfer line, the turn flight. */
const coursePts: Vec3[] = [];
for (const [si, st] of stages.entries()) {
	const cs = st.route.map((r) => r.chain);
	for (const c of cs)
		for (let s = 0; s < c.ramps.length; s++) {
			const len = c.dist[s + 1]! - c.dist[s]!;
			for (let a = 0; a <= len; a += 128) for (const f of [-0.2, 0.5, 1.1]) coursePts.push(facePoint(c, s, a, f));
		}
	const ends: Vec3[] = [topCenter(st.pad), ...cs.flatMap((c) => [c.peak[0]!, chainExit(c).point]), topCenter(st.target)];
	for (let i = 0; i + 1 < ends.length; i++) {
		const p = ends[i]!;
		const q = ends[i + 1]!;
		for (let t = 0; t <= 1; t += 0.05) coursePts.push(v3(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, p.z + (q.z - p.z) * t + 200));
	}
	void si;
}
{
	const a = stages[4]!.route[0]!.chain;
	const ex = chainExit(a);
	const d0 = dir(ex.yaw);
	const vh = KESSLER_TURN.speed;
	for (const s of airTurnFlight(ex.point, v3(d0.x * vh, d0.y * vh, -ex.grade * vh), ex.yaw + KESSLER_TURN.turn, { dt: 1 / 32, maxTime: 2.5 })) coursePts.push(s.p);
}
{
	const solids = brushes.map((b) => brushBounds(b));
	const near = (c: BoxBrush) =>
		solids.some((s) => boxGap(c, { min: v3(s.min.x - 72, s.min.y - 72, s.min.z - 72), max: v3(s.max.x + 72, s.max.y + 72, s.max.z + 144) }) < SCENERY_CLEARANCE) ||
		coursePts.some((p) => boxGap(c, { min: v3(p.x - 16, p.y - 16, p.z - 300), max: v3(p.x + 16, p.y + 16, p.z + 372) }) < SCENERY_CLEARANCE);
	const placed: BoxBrush[] = [];
	stages.forEach((st, i) => {
		for (const c of stageFrame(st, STAGE_FRAME_MATERIAL[i]!)) {
			if (near(c)) continue;
			if (placed.some((o) => overlapStrict(o, c))) continue;
			placed.push(c);
			st.scenery.push(c);
		}
	});
}

function overlapStrict(a: Box3, b: Box3): boolean {
	const e = 0.01;
	return a.min.x < b.max.x - e && b.min.x < a.max.x - e && a.min.y < b.max.y - e && b.min.y < a.max.y - e && a.min.z < b.max.z - e && b.min.z < a.max.z - e;
}

// The start platform's airlock wall (behind the spawn) and the reactor core in the spiral's middle.
const airlock = platform(v3(startPad.min.x - 32, 0, startPad.max.z + 384), 64, 768, 'dockFrame', 384);
export const KESSLER_SPIRAL_CENTER: { x: number; y: number } = (() => {
	const c = stages[2]!.route[0]!.chain;
	const i = c.yaws.findIndex((_, k) => k > 0 && c.yaws[k] !== c.yaws[k - 1]);
	const d = dir(c.yaws[0]!);
	const s = c.peak[i]!;
	return { x: Math.round(s.x - d.y * KESSLER_SPIRAL.r0), y: Math.round(s.y + d.x * KESSLER_SPIRAL.r0) };
})();
const core: BoxBrush[] = (() => {
	const c = stages[2]!.route[0]!.chain;
	const b = boundsOf(c.ramps);
	const k = KESSLER_SPIRAL_CENTER;
	const h = 420;
	const zTop = Math.round(c.peak[0]!.z + 600);
	const zLow = Math.round(b.min.z - 400);
	return [box(v3(k.x - h, k.y - h, zLow), v3(k.x + h, k.y + h, zTop), 'waveFrame'), box(v3(k.x - h - 64, k.y - h - 64, zTop), v3(k.x + h + 64, k.y + h + 64, zTop + 96), 'waveCore')];
})();
stages[2]!.scenery.push(...core);

brushes.push(...stages.flatMap((s) => s.scenery), airlock);

// ---------------------------------------------------------------------------
// Zones

const spawn: Spawn = { pos: topCenter(startPad), yaw: 0 };
zones.push(startZone(zoneOver(startPad, 256)));
for (const st of stages.slice(1)) zones.push(stageZone(st.index, zoneOver(st.pad, 640), { pos: topCenter(st.pad), yaw: st.yaw }));
zones.push(endZone(zoneOver(endPad, 640)));
{
	const avoid: Box3[] = [...brushes.map((b) => brushBounds(b)), ...zones.map((z) => ({ min: z.min, max: z.max }))];
	const catches: Zone[] = [];
	for (const st of stages) catches.push(catchUnder(st.route.flatMap((r) => r.chain.ramps), [...avoid, ...catches], 'stage', 512, 320, 1536));
	zones.push(...catches);
}
const all = boundsOf(brushes);
const FLOOR_Z = Math.round(all.min.z - 2048);
zones.push(teleportBelow(brushes, all.min.z - 256, 'stage', 8192, 4096));

// ---------------------------------------------------------------------------
// Theme: night orbit. Each module has its own neon set; bulkheads with holes
// glow at their edges, glass is tinted in the module's colour.

const theme: Theme = {
	skyTop: 0x02030a,
	skyHorizon: 0x10173a,
	skyBottom: 0x060818,
	fogColor: 0x0a0f26,
	fogNear: 3000,
	fogFar: 22000,
	sunColor: 0xa8c0ff,
	sunIntensity: 0.45,
	sunDir: v3(0.35, -0.5, 0.8),
	ambientSky: 0x5a6aa8,
	ambientGround: 0x140c2a,
	ambientIntensity: 0.55,
	materials: {
		// 1 Docking Ring: steel-blue hull with cyan edges.
		dock: { color: 0x16263a, edgeColor: 0x4ff0ff, seamColor: 0x2bb8ff, noise: 0.16, noiseScale: 192, roughness: 0.5 },
		dockAlt: { color: 0x1a2f45, edgeColor: 0x9ff8ff, seamColor: 0x4ff0ff, noise: 0.16, noiseScale: 192, roughness: 0.5 },
		dockPad: { color: 0x1c2a3c, topColor: 0x2a4058, edgeColor: 0x7ff6ff, noise: 0.12, noiseScale: 128, roughness: 0.8 },
		dockFrame: { color: 0x0c1420, edgeColor: 0x2a9cc8, noise: 0.2, noiseScale: 256, roughness: 0.9 },
		// 2 Arc Gallery: violet.
		arc: { color: 0x1e1438, edgeColor: 0xb57bff, seamColor: 0x8a5cff, noise: 0.18, noiseScale: 160, roughness: 0.45 },
		arcAlt: { color: 0x281a48, edgeColor: 0xe0b8ff, seamColor: 0xb57bff, noise: 0.18, noiseScale: 160, roughness: 0.45 },
		arcPad: { color: 0x221a36, topColor: 0x34284e, edgeColor: 0xc89cff, noise: 0.12, noiseScale: 128, roughness: 0.8 },
		arcFrame: { color: 0x120c22, edgeColor: 0x7a4ccc, noise: 0.2, noiseScale: 256, roughness: 0.9 },
		// 3 Reactor Well: amber.
		wave: { color: 0x2e1e0e, edgeColor: 0xffb547, seamColor: 0xff8a2a, noise: 0.18, noiseScale: 176, roughness: 0.5 },
		waveAlt: { color: 0x3a2610, edgeColor: 0xffd890, seamColor: 0xffb547, noise: 0.18, noiseScale: 176, roughness: 0.5 },
		wavePad: { color: 0x2c2216, topColor: 0x44331e, edgeColor: 0xffc870, noise: 0.12, noiseScale: 128, roughness: 0.8 },
		waveFrame: { color: 0x1a1208, edgeColor: 0xc07a28, noise: 0.2, noiseScale: 256, roughness: 0.9 },
		// 4 Wall Spine: acid green.
		wall: { color: 0x0e2a1a, edgeColor: 0x5dff9a, seamColor: 0x2ee07a, noise: 0.18, noiseScale: 160, roughness: 0.5 },
		wallAlt: { color: 0x123622, edgeColor: 0xb4ffd0, seamColor: 0x5dff9a, noise: 0.2, noiseScale: 144, roughness: 0.45 },
		wallPad: { color: 0x15281c, topColor: 0x20402c, edgeColor: 0x8affb8, noise: 0.12, noiseScale: 128, roughness: 0.8 },
		wallFrame: { color: 0x08160e, edgeColor: 0x2aa860, noise: 0.2, noiseScale: 256, roughness: 0.9 },
		// 5 Needle Array: hot red / magenta.
		needle: { color: 0x2e0c16, edgeColor: 0xff4d6d, seamColor: 0xff2a55, noise: 0.18, noiseScale: 144, roughness: 0.45 },
		needleAlt: { color: 0x3a0e22, edgeColor: 0xff9ab8, seamColor: 0xff4dc4, noise: 0.18, noiseScale: 144, roughness: 0.45 },
		needlePad: { color: 0x2a141a, topColor: 0x42202a, edgeColor: 0xff7a92, noise: 0.12, noiseScale: 128, roughness: 0.8 },
		needleFrame: { color: 0x18080c, edgeColor: 0xb02a48, noise: 0.2, noiseScale: 256, roughness: 0.9 },
		// 6 Re-entry: white-hot blue.
		reentry: { color: 0x1a2236, edgeColor: 0xe8f0ff, seamColor: 0x7aa8ff, noise: 0.16, noiseScale: 224, roughness: 0.4 },
		reentryAlt: { color: 0x202a42, edgeColor: 0xffffff, seamColor: 0xa8c8ff, noise: 0.16, noiseScale: 224, roughness: 0.4 },
		reentryPad: { color: 0x1e2434, topColor: 0x303a52, edgeColor: 0xd0e0ff, noise: 0.12, noiseScale: 128, roughness: 0.8 },
		reentryFrame: { color: 0x0e1220, edgeColor: 0x6a88c8, noise: 0.2, noiseScale: 256, roughness: 0.9 },
		// Obstacles: bulkheads (holes, pillars, ribs) with bright edges; tinted glass.
		dockWall: { color: 0x14283c, edgeColor: 0x9ff8ff, noise: 0.14, noiseScale: 160, roughness: 0.6 },
		arcWall: { color: 0x241840, edgeColor: 0xe0b8ff, noise: 0.14, noiseScale: 160, roughness: 0.6 },
		waveGlass: { color: 0xffb547, topColor: 0xffe0a0, edgeColor: 0xffd890, glass: true, opacity: 0.24, noise: 0.03, roughness: 0.1 },
		waveCore: { color: 0x3a2610, edgeColor: 0xffb547, seamColor: 0xff8a2a, noise: 0.2, noiseScale: 128, roughness: 0.5 },
		wallGlass: { color: 0x5dff9a, topColor: 0xb4ffd0, edgeColor: 0xb4ffd0, glass: true, opacity: 0.22, noise: 0.03, roughness: 0.1 },
		wallBulk: { color: 0x123622, edgeColor: 0xb4ffd0, noise: 0.14, noiseScale: 160, roughness: 0.6 },
		needleWall: { color: 0x3a0e22, edgeColor: 0xff9ab8, noise: 0.14, noiseScale: 144, roughness: 0.6 },
		reentryWall: { color: 0x202a42, edgeColor: 0xffffff, noise: 0.14, noiseScale: 224, roughness: 0.6 },
		// End dock.
		endPad: { color: 0x1a1a2a, topColor: 0x2c2c48, edgeColor: 0xfff07a, noise: 0.12, noiseScale: 128, roughness: 0.8 },
		endFrame: { color: 0x10101c, edgeColor: 0xffd84a, noise: 0.2, noiseScale: 256, roughness: 0.9 }
	},
	effects: [
		// Navigation grid far below, a violet nebula layer, stars all around, debris glints near the modules.
		{ type: 'gridFloor', color: 0x3a5cff, z: FLOOR_Z, size: 120000 },
		{ type: 'clouds', color: 0x2a1648, count: 140, height: FLOOR_Z + 1200 },
		{
			type: 'embers',
			color: 0xe8eeff,
			count: 2600,
			area: { min: v3(all.min.x - 12000, all.min.y - 12000, FLOOR_Z), max: v3(all.max.x + 12000, all.max.y + 12000, all.max.z + 8000) }
		},
		{
			type: 'embers',
			color: 0x7ff6ff,
			count: 700,
			area: { min: v3(all.min.x - 1024, all.min.y - 1024, all.min.z - 1024), max: v3(all.max.x + 1024, all.max.y + 1024, all.max.z + 1024) }
		}
	]
};

export const surf_kessler: MapDef = {
	id: 'surf_kessler',
	title: 'Kessler',
	kind: 'surf',
	difficulty: 'hard',
	layout: 'staged',
	cvars: { ...SURF_CVARS },
	spawn,
	brushes,
	zones,
	theme
};

/** Stages in order: platform, intended line (chains + air plans), obstacles, scenery. */
export const KESSLER_STAGES: KesslerStage[] = stages;
/** Every ramp chain in riding order. */
export const KESSLER_CHAINS: RampChain[] = stages.flatMap((s) => s.route.map((r) => r.chain));
/** Every obstacle (on the intended line), in riding order. */
export const KESSLER_OBSTACLES: Obstacle[] = stages.flatMap((s) => s.obstacles);
/** Every opening the intended line passes through. */
export const KESSLER_GATES: Gate[] = KESSLER_OBSTACLES.flatMap((o) => o.gates);
/** End platform (inside the end zone, in the end room). */
export const KESSLER_END_PAD: BoxBrush = endPad;
export type { PeakStep };
