/**
 * surf_ochre — linear surf, rated hard (CS tier 4–5 feel). Golden hour over a
 * desert canyon: sandstone ramps with teal edge lines, canyon fins, glass
 * bridges, a sinkhole, hoodoo pillars, mesas and floating rock islands.
 *
 * An original layout: it uses the genre's building blocks and the obstacle
 * vocabulary of hard surf maps (holes in walls, spirals, glass, ceilings,
 * pillars, speed windows, big air turns), not any existing map's layout.
 *
 * Linear: checkpoints are splits only, and ANY fall resets the run to the
 * start. That alone makes it hard, so every obstacle is visible well before it
 * matters, every hole is lined with glowing edges, and there is one clear
 * intended line (the tests' "skilled" route bot flies it with the real physics).
 *
 * Course (OCHRE_CHAINS, riding order) and its hard moments (OCHRE_OBSTACLES):
 *  0 drop-in         straight, 52°, 5200 long. Walk out of the start room.
 *    (1) SLOT FIN    a 192-thick canyon fin across the transfer with a narrow
 *                    slot (176 wide × 304 tall). Exit the drop-in at the right
 *                    face height and line, fly straight through.
 *  1 canyon bend     left bend 60°, 52°                                    [cp 1]
 *    (2) ARCHES      three low lintels over the bend: ride the upper face
 *                    (fraction < 0.33) and your head hits them.
 *  2 sinkhole spiral right spiral 450° (radius 3200 → 4200, banked 57°) around
 *                    a rock column above a sinkhole                        [cp 2]
 *    (3) GLASS FLOOR a glass floor under the spiral's exit with a 520 × 480
 *                    hole: drop through it onto the ramp below, whose peak runs
 *                    100 under the glass (a speed window: −15% lands on the
 *                    glass, +15% bonks the hole's far edge)
 *  3 under-floor     straight, under the glass floor (a ceiling)            [cp 3]
 *    (4) PILLARS     a hoodoo pillar (160 square) stands on the straight
 *                    transfer line 1400 ahead; air-strafe left through the
 *                    320 gap beside it
 *  4/5/6 switches    three switch ramps; the middle one is GLASS           [cp 4]
 *    (5) GLASS TUBES both switch transfers fly through glass corridors (walls
 *                    368 apart and a glass ceiling): no drifting, no high exits
 *  7 wave            dips, then climbs at 0.24 and launches you up          [cp 5]
 *    (6) SPEED WINDOW a window (320 × 256) in a 256-thick mesa wall 3000 ahead:
 *                    only the speed of a clean wave gets you through (±15%
 *                    hits the wall below / above it)
 *  8 mesa bend       right bend 68°
 *  9 up-ramp         climbs at 0.3 and slows you                           [cp 6]
 *    (7) HIGH WINDOW the up-ramp launches you up into a 352 × 288 window
 *    (8) AIR TURN    straight after the window: a 130° right air-strafe turn
 *                    onto the final ramp (no turn = a long fall)
 * 10 final descent   grade steepens to 0.3, 54°                           [cp 7]
 *    (9) ARCHES      three more lintels on the steep descent (clear only below
 *                    face fraction 0.4)
 *  → end pad
 *
 * The skilled line (tests): ~52 s, 860 → 3100 u/s. Obstacle positions come
 * from each transfer's design flight plus measured corrections (TUNE), so the
 * skilled route bot crosses every opening near its middle; the tests also show
 * that offset, slower/faster or unsteered lines hit the obstacles.
 *
 * Fairness rules: landings come in diagonally in
 * the travel direction (never into end caps), ramp ends are open, faces are
 * 50–57° and 448–768 wide, curves step ≤ 4° per seam with every
 * seam stepping DOWN by SEAM_DROP (no rampbugs; tested on every chain,
 * including the spiral), banked bends stay under their hold speed, and
 * scenery keeps ≥ 256 from every flight path (obstacles are on the path by
 * design and are declared separately).
 */
import { SURF_CVARS } from '../cvars.ts';
import type { Vec3 } from '../types.ts';
import type { BrushDef, MapDef, Spawn, Theme, Zone } from './types.ts';
import { box, boundsOf, brushBounds, checkpointZone, dirXY, endZone, platform, startZone, teleportBelow, v3, type BoxBrush, type Box3 } from './helpers.ts';
import {
	bend,
	chainExit,
	facePoint,
	gradeBlend,
	locateOnChain,
	rampChain,
	straight,
	type RampChain
} from './surf_ochre-helpers.ts';
import { airTurnFlight } from './surf_kessler-helpers.ts';
import {
	catchUnder,
	chainAfterTurn as turnChain,
	flightPoint,
	floorWithHole,
	glassPanel,
	leg as legChain,
	legFlight,
	orientedBox,
	spiralSteps,
	wallWithHole,
	type AirPlan,
	type Gate,
	type Leg,
	type Obstacle,
	type RouteStep,
	type TurnLanding
} from './surf-obstacles.ts';

export type { Leg };
export { legFlight };

const DEG = Math.PI / 180;
/** Materials. */
const SAND = 'sandstone';
const STONE = 'stone';
const WALL = 'wall';
const MESA = 'mesa';
const CAP = 'mesaCap';
const GLOW = 'glow';
const FIN = 'fin';
const LINTEL = 'lintel';
const GLASS = 'glass';
const GLASS_RAMP = 'glassRamp';
const TOP = 15000;

export const R1 = rampChain({
	label: '0 drop-in',
	start: v3(0, 0, TOP),
	yaw: 0,
	side: 'right',
	angle: 52,
	halfWidth: 704,
	material: SAND,
	steps: [...gradeBlend(0, 0.14, 600), ...straight(4600, 0.14)]
});

/** Ochre's legs: sandstone unless a leg names its material. */
export const leg = (prev: RampChain, l: Leg): RampChain => legChain(prev, l, SAND);
const chainAfterTurn = (prev: RampChain, o: Omit<TurnLanding, 'material'>): RampChain => turnChain(prev, { ...o, material: SAND });

/** Sinkhole spiral radius at its start and end. */
export const SPIRAL_R0 = 3200;
export const SPIRAL_R1 = 4200;

/** Legs 1..9 (chains after the drop-in, before the air turn), in riding order. */
export const OCHRE_LEGS: Leg[] = [
	{
		label: '1 canyon bend',
		side: 'left',
		angle: 52,
		halfWidth: 704,
		steps: [{ length: 1400, grade: 0.08 }, ...bend(60, 3770, 0.045), ...straight(900, 0.06)],
		speed: 1150,
		approach: 'peak',
		delta: 4,
		ahead: 1000,
		back: 400,
		extra: 150,
		drift: -2
	},
	{
		label: '2 sinkhole spiral',
		side: 'right',
		angle: 57,
		halfWidth: 448,
		steps: [{ length: 3200, grade: 0.04 }, ...spiralSteps(-450, SPIRAL_R0, SPIRAL_R1, 0.03), { length: 600, grade: 0.04 }],
		speed: 1500,
		approach: 'base',
		delta: 4,
		ahead: 900,
		extra: 200,
		drift: -8
	},
	{
		// Placed by underFloor(): its peak runs right under the glass floor's hole.
		label: '3 under-floor',
		side: 'left',
		angle: 50,
		halfWidth: 576,
		steps: [{ length: 3600, grade: 0.12 }],
		speed: 1900,
		delta: 3,
		ahead: 0,
		drift: 0
	},
	{
		label: '4 switch a',
		side: 'right',
		angle: 55,
		halfWidth: 576,
		steps: [{ length: 3200, grade: 0.1 }],
		speed: 2000,
		approach: 'base',
		delta: 8,
		ahead: 1800,
		back: 600,
		extra: 300,
		drift: 0
	},
	{
		label: '5 glass switch',
		side: 'left',
		angle: 55,
		halfWidth: 576,
		steps: [{ length: 3200, grade: 0.1 }],
		speed: 2050,
		approach: 'base',
		delta: 8,
		ahead: 1200,
		back: 500,
		extra: 300,
		drift: 0,
		material: GLASS_RAMP
	},
	{
		label: '6 switch c',
		side: 'right',
		angle: 55,
		halfWidth: 576,
		steps: [{ length: 3200, grade: 0.1 }],
		speed: 2150,
		approach: 'base',
		delta: 8,
		ahead: 1200,
		back: 500,
		extra: 300,
		drift: 0
	},
	{
		label: '7 wave',
		side: 'left',
		angle: 50,
		halfWidth: 704,
		steps: [{ length: 2400, grade: 0.2 }, ...gradeBlend(0.2, -0.24, 1100), { length: 1100, grade: -0.24 }],
		speed: 2250,
		approach: 'base',
		delta: 8,
		ahead: 1000,
		extra: 250,
		drift: 0
	},
	{
		label: '8 mesa bend',
		side: 'right',
		angle: 56,
		halfWidth: 704,
		steps: [{ length: 1400, grade: 0.08 }, ...bend(-68, 9000, 0.05), { length: 700, grade: 0.06 }],
		speed: 2700,
		approach: 'base',
		delta: 4,
		ahead: 3800,
		back: 500,
		extra: 680,
		shift: 193,
		drift: 6
	},
	{
		label: '9 up-ramp',
		side: 'left',
		angle: 50,
		halfWidth: 576,
		steps: [{ length: 900, grade: 0.05 }, ...gradeBlend(0.05, -0.3, 900), { length: 2400, grade: -0.3 }],
		speed: 2300,
		approach: 'base',
		delta: 8,
		ahead: 900,
		extra: -270,
		shift: 181,
		frac: 0.4,
		drift: 0
	}
];

/** Tunables of the air turn (measured against the route bot's launch off the up-ramp). */
export const OCHRE_TURN = { speed: 2520, turn: -130, settle: 0.15 };

/** Glass floor hole: design-flight crossing FLOOR_AT ahead of the spiral's exit, plus measured corrections (along, up). */
const FLOOR_AT = 1000;
const FLOOR_TUNE: [number, number] = [365, 0];
/** Hole size along / across the flight. */
const FLOOR_HOLE = { along: 520, across: 480 };
function floorHole(prev: RampChain, l: Leg): { hole: Vec3; yaw: number } {
	const f = legFlight(prev, l);
	const h = flightPoint(f, FLOOR_AT + FLOOR_TUNE[0]);
	return { hole: v3(h.x, h.y, Math.round(flightPoint(f, FLOOR_AT).z + FLOOR_TUNE[1])), yaw: f.yaw };
}

/**
 * The under-floor chain: its peak line passes right under the floor hole's
 * centre, 100 below the slab's underside, so a rider dropping through lands
 * near the peak; the slab beyond the hole is a ceiling over it.
 */
function underFloor(prev: RampChain, l: Leg): RampChain {
	const { hole, yaw: fy } = floorHole(prev, l);
	const yaw = fy - l.delta; // a left face: turned right of the flight, so the rider drifts down-face
	const d = dirXY(yaw);
	const g = l.steps[0]!.grade ?? 0;
	const back = FLOOR_HOLE.along / 2;
	const start = v3(hole.x - d.x * back, hole.y - d.y * back, hole.z - 32 - 100 + g * back);
	const c = rampChain({ label: l.label, start, yaw, side: l.side, angle: l.angle, halfWidth: l.halfWidth, material: SAND, steps: l.steps });
	c.aim = facePoint(c, 0, back + 160, 0.15);
	return c;
}

/** The course chains (the map uses OCHRE_LEGS). */
export function buildChains(legs: Leg[]): RampChain[] {
	const out: RampChain[] = [R1];
	for (const [i, l] of legs.entries()) out.push(i === 2 ? underFloor(out[out.length - 1]!, l) : leg(out[out.length - 1]!, l));
	const up = out[out.length - 1]!;
	const exYaw = chainExit(up).yaw;
	const aimYaw = exYaw + OCHRE_TURN.turn;
	out.push(
		chainAfterTurn(up, {
			label: '10 final descent',
			speed: OCHRE_TURN.speed,
			aimYaw,
			settle: OCHRE_TURN.settle,
			yaw: aimYaw - 14,
			side: 'right',
			angle: 54,
			halfWidth: 768,
			steps: [{ length: 1600, grade: 0.08 }, ...gradeBlend(0.08, 0.3, 3000, 1.5), { length: 3600, grade: 0.3 }],
			back: 500,
			frac: 0.25,
			drop: 100
		})
	);
	return out;
}
const chains = buildChains(OCHRE_LEGS);
const LAST = chains[chains.length - 1]!;

export const OCHRE_CHAINS: RampChain[] = chains;
const legOf = (i: number) => OCHRE_LEGS[i - 1]!;
const flightOf = (i: number) => legFlight(chains[i - 1]!, legOf(i));

const brushes: BrushDef[] = [];
const zones: Zone[] = [];
for (const c of chains) brushes.push(...c.ramps);

// ---------------------------------------------------------------------------
// Obstacles (on the intended line). Positions come from the design flight of
// each transfer plus measured corrections (TUNE: sideways, up), so the skilled
// route bot flies through the middle of every opening.

export const OCHRE_OBSTACLES: Obstacle[] = [];
const TUNE: Record<string, [number, number]> = {
	slot: [10, 71],
	pillar: [0, 0],
	tube5: [90, 150],
	tube6: [90, -100],
	speed: [198, -563],
	high: [132, -165]
};

/** Face height of chain c at horizontal chain distance `along` and face fraction `frac`, plus the segment there. */
function faceAt(c: RampChain, along: number, frac: number): { p: Vec3; seg: number } {
	let seg = 0;
	while (seg < c.ramps.length - 1 && c.dist[seg + 1]! < along) seg++;
	return { p: facePoint(c, seg, along - c.dist[seg]!, frac), seg };
}

/** Low lintels across a chain at the given distances: riding above face fraction `clearFrac` hits them. Pillars off both edges. */
function arches(label: string, c: RampChain, at: number[], clearFrac: number): Obstacle {
	const out: BrushDef[] = [];
	const t = Math.tan(c.angle * DEG);
	for (const a of at) {
		const { p, seg } = faceAt(c, a, clearFrac);
		const yaw = c.yaws[seg]!;
		const z0 = Math.round(p.z + 72);
		const back = faceAt(c, a, -0.45).p;
		const front = faceAt(c, a, 1.3).p;
		const mid = { x: (back.x + front.x) / 2, y: (back.y + front.y) / 2 };
		const span = Math.hypot(front.x - back.x, front.y - back.y) + 200;
		out.push(orientedBox({ center: mid, yaw, along: 160, across: span, z0, z1: z0 + 192, material: LINTEL }));
		for (const q of [faceAt(c, a, -0.62).p, faceAt(c, a, 1.48).p]) {
			const foot = Math.round(p.z - c.halfWidth * t * 1.6);
			out.push(orientedBox({ center: q, yaw, along: 200, across: 200, z0: foot, z1: z0, material: MESA }));
		}
	}
	return { label, kind: 'ceiling', brushes: out, gates: [] };
}

// (1) Slot fin across the drop-in → canyon bend transfer.
{
	const f = flightOf(1);
	const [dl, dz] = TUNE.slot!;
	const h = flightPoint(f, 420, dl);
	OCHRE_OBSTACLES.push(
		wallWithHole({ label: 'slot fin', kind: 'slot', hole: v3(h.x, h.y, h.z + 36 + dz), yaw: f.yaw, holeW: 176, holeH: 304, thickness: 192, width: 4200, z0: h.z - 2200, z1: h.z + 1400, material: FIN })
	);
}
// (2) Arches over the canyon bend.
OCHRE_OBSTACLES.push(arches('canyon arches', chains[1]!, [2300, 3300, 4300], 0.33));

// (3) Glass floor with a hole under the spiral's exit flight.
{
	const { hole, yaw } = floorHole(chains[2]!, legOf(3));
	const ob = floorWithHole({ label: 'glass floor hole', hole, yaw, holeAlong: FLOOR_HOLE.along, holeAcross: FLOOR_HOLE.across, before: 600, beyond: 900, side: 800, thickness: 32, material: GLASS });
	ob.kind = 'glassFloor';
	OCHRE_OBSTACLES.push(ob);
}
// (4) Pillar on the straight under-floor → switch a line; the gap beside it is the way.
export const PILLAR_AT = 1400;
{
	const f = flightOf(4);
	const [dl, dz] = TUNE.pillar!;
	const p0 = flightPoint(f, PILLAR_AT);
	const z0 = Math.round(p0.z - 1800);
	const z1 = Math.round(p0.z + 900);
	const col = (lat: number) => orientedBox({ center: flightPoint(f, PILLAR_AT, lat), yaw: f.yaw, along: 160, across: 160, z0, z1, material: MESA });
	const g = flightPoint(f, PILLAR_AT, 240 + dl);
	OCHRE_OBSTACLES.push({
		label: 'hoodoo pillars',
		kind: 'pillar',
		brushes: [col(0), col(480)],
		gates: [{ label: 'hoodoo gap', type: 'wall', center: v3(g.x, g.y, g.z + dz), yaw: f.yaw, halfW: 160, halfH: 900 }]
	});
}
// (5) Glass tubes over the two switch transfers: side walls 368 apart and a glass ceiling.
for (const [i, key] of [
	[5, 'tube5'],
	[6, 'tube6']
] as const) {
	const f = flightOf(i);
	const [dl, dz] = TUNE[key]!;
	const a0 = 150;
	const a1 = 650;
	const top = flightPoint(f, a0, dl);
	const low = flightPoint(f, a1, dl);
	const ceil = Math.round(top.z + 150 + dz);
	const floor = Math.round(low.z - 600);
	const mid = flightPoint(f, (a0 + a1) / 2, dl);
	const len = a1 - a0;
	const brs = [
		glassPanel({ center: flightPoint(f, (a0 + a1) / 2, dl + 208), yaw: f.yaw, along: len, across: 48, z0: floor, z1: ceil, material: GLASS }),
		glassPanel({ center: flightPoint(f, (a0 + a1) / 2, dl - 208), yaw: f.yaw, along: len, across: 48, z0: floor, z1: ceil, material: GLASS }),
		glassPanel({ center: mid, yaw: f.yaw, along: len, across: 464, z0: ceil, z1: ceil + 32, material: GLASS })
	];
	OCHRE_OBSTACLES.push({
		label: `glass tube ${i - 4}`,
		kind: 'glassWall',
		brushes: brs,
		gates: [{ label: `glass tube ${i - 4}`, type: 'wall', center: v3(mid.x, mid.y, (ceil + floor) / 2), yaw: f.yaw, halfW: 184, halfH: (ceil - floor) / 2 }]
	});
}
// (6) Speed window: a window in a mesa wall 1850 ahead of the wave's launch.
const SPEED_AT = 3000;
{
	const f = flightOf(8);
	const [dl, dz] = TUNE.speed!;
	const h = flightPoint(f, SPEED_AT, dl);
	OCHRE_OBSTACLES.push(
		wallWithHole({ label: 'speed window', kind: 'window', hole: v3(h.x, h.y, h.z + 36 + dz), yaw: f.yaw, holeW: 320, holeH: 256, thickness: 256, width: 5200, z0: h.z - 2600, z1: h.z + 1500, material: FIN })
	);
}
// (7) High window right after the up-ramp; (8) the air turn follows it.
{
	const ex = chainExit(chains[9]!);
	const f = legFlight(chains[9]!, { drift: 0, speed: OCHRE_TURN.speed });
	const [dl, dz] = TUNE.high!;
	const h = flightPoint(f, 420, dl);
	OCHRE_OBSTACLES.push(
		wallWithHole({ label: 'high window', kind: 'window', hole: v3(h.x, h.y, h.z + 36 + dz), yaw: ex.yaw, holeW: 352, holeH: 288, thickness: 192, width: 2400, z0: h.z - 1600, z1: h.z + 900, material: FIN })
	);
}
// (9) Arches over the final descent.
OCHRE_OBSTACLES.push(arches('descent arches', LAST, [3000, 4500, 6000], 0.4));
for (const o of OCHRE_OBSTACLES) brushes.push(...o.brushes);

const gateOf = (label: string): Gate => OCHRE_OBSTACLES.flatMap((o) => o.gates).find((g) => g.label === label)!;

/** The intended line: per chain, the riding height and how the transfer onto it is flown. */
export const OCHRE_ROUTE: RouteStep[] = chains.map((chain, i): RouteStep => {
	const air: AirPlan =
		i === 4
			? { kind: 'via', gates: [gateOf('hoodoo gap')], then: 'aim' }
			: i === 10
				? { kind: 'via', gates: [gateOf('high window')], then: { yaw: chainExit(chains[9]!).yaw + OCHRE_TURN.turn } }
				: { kind: 'none' };
	return { chain, air, target: 0.45 };
});

// ---------------------------------------------------------------------------
// Start room: floor 64 above the drop-in's peak, walls on three sides and a
// roof; the open +X side looks straight down the first ramp at the slot fin.

const FLOOR_TOP = TOP + 64;
const ROOM_H = 384;
const start = box(v3(-1024, -672, FLOOR_TOP - 64), v3(0, 96, FLOOR_TOP), STONE);
const startRoom: BoxBrush[] = [
	start,
	box(v3(-1088, -736, FLOOR_TOP - 64), v3(-1024, 160, FLOOR_TOP + ROOM_H), WALL), // back
	box(v3(-1024, 96, FLOOR_TOP - 64), v3(0, 160, FLOOR_TOP + ROOM_H), WALL), // left
	box(v3(-1024, -736, FLOOR_TOP - 64), v3(0, -672, FLOOR_TOP + ROOM_H), WALL), // right
	box(v3(-1088, -736, FLOOR_TOP + ROOM_H), v3(0, 160, FLOOR_TOP + ROOM_H + 64), WALL), // roof
	box(v3(-64, -672, FLOOR_TOP + ROOM_H - 48), v3(0, 96, FLOOR_TOP + ROOM_H), GLOW) // lit lintel over the exit
];
brushes.push(...startRoom);
zones.push(startZone({ min: v3(-1024, -672, FLOOR_TOP - 16), max: v3(0, 96, FLOOR_TOP + 256) }));
const spawn: Spawn = { pos: v3(-640, -288, FLOOR_TOP), yaw: 0 };

// ---------------------------------------------------------------------------
// Checkpoints (splits only: a fall still resets to the start). Each sits at the
// start of a section; its respawn ledge sits beside that chain's peak, just past
// where transfers land (strafe towards the face to drop in).

/** Chains that start a checkpointed section. */
export const OCHRE_CHECKPOINT_CHAINS = [1, 2, 3, 4, 7, 9, 10];
export const OCHRE_LEDGES: BoxBrush[] = [];
for (const [n, ci] of OCHRE_CHECKPOINT_CHAINS.entries()) {
	const c = chains[ci]!;
	const landAlong = locateOnChain(c, c.aim!)!.along;
	const at = facePoint(c, 0, landAlong + 600, -205 / c.halfWidth);
	const top = v3(Math.round(at.x), Math.round(at.y), Math.round(c.peak[0]!.z - c.grades[0]! * (landAlong + 600) + 96));
	const ledge = platform(top, 256, 256, STONE, 32);
	OCHRE_LEDGES.push(ledge);
	brushes.push(ledge);
	const mid = facePoint(c, 0, landAlong + 300, 0.5);
	zones.push(
		checkpointZone(
			n + 1,
			{ min: v3(mid.x - 800, mid.y - 800, mid.z - 480), max: v3(mid.x + 800, mid.y + 800, top.z + 256) },
			{ pos: top, yaw: Math.round(((((c.yaws[0]! + 180) % 360) + 360) % 360) - 180) }
		)
	);
}

// ---------------------------------------------------------------------------
// End: a big landing pad past the final descent, closed by walls.

const endExit = chainExit(LAST);
const ed = dirXY(endExit.yaw);
const el = { x: -ed.y, y: ed.x };
const END_TOP = Math.round(endExit.point.z - 760);
const endCorners = [600, 4600].flatMap((a) => [-1400, 1400].map((s) => ({ x: endExit.point.x + ed.x * a + el.x * s, y: endExit.point.y + ed.y * a + el.y * s })));
const ex0 = Math.round(Math.min(...endCorners.map((p) => p.x)));
const ex1 = Math.round(Math.max(...endCorners.map((p) => p.x)));
const ey0 = Math.round(Math.min(...endCorners.map((p) => p.y)));
const ey1 = Math.round(Math.max(...endCorners.map((p) => p.y)));
const end = box(v3(ex0, ey0, END_TOP - 128), v3(ex1, ey1, END_TOP), STONE);
// Walls on the sides the descent heads towards.
const endRoom: BoxBrush[] = [end];
if (ed.y < 0) endRoom.push(box(v3(ex0, ey0 - 64, END_TOP - 128), v3(ex1, ey0, END_TOP + 768), WALL));
else endRoom.push(box(v3(ex0, ey1, END_TOP - 128), v3(ex1, ey1 + 64, END_TOP + 768), WALL));
if (ed.x > 0) endRoom.push(box(v3(ex1, ey0 - 64, END_TOP - 128), v3(ex1 + 64, ey1 + 64, END_TOP + 768), WALL));
else endRoom.push(box(v3(ex0 - 64, ey0 - 64, END_TOP - 128), v3(ex0, ey1 + 64, END_TOP + 768), WALL));
brushes.push(...endRoom);
zones.push(endZone({ min: v3(ex0, ey0, END_TOP - 16), max: v3(ex1, ey1, END_TOP + 640) }));

// ---------------------------------------------------------------------------
// Catch triggers: one under each chain (a miss resets fast instead of a long
// fall), trimmed around anything below, then the canyon floor under everything.

const CANYON_Z = 2560;
const avoid: Box3[] = [...brushes.map(brushBounds), ...zones.map((z) => ({ min: z.min, max: z.max }))];
const catches: Zone[] = [];
for (const c of chains) {
	const z = catchUnder(c.ramps, [...avoid, ...catches], 'start', 256, 1200, 1200);
	catches.push(z);
}

// ---------------------------------------------------------------------------
// Scenery (non-course boxes; every brush collides, so all of it keeps clear of
// the course): hoodoo pillars and mesas rising from the canyon floor, floating
// rock islands, the sinkhole's rock column and rim.

export const OCHRE_SCENERY: BoxBrush[] = [];
const overlapsBox = (a: Box3, b: Box3, pad = 0) =>
	a.min.x < b.max.x + pad && b.min.x < a.max.x + pad && a.min.y < b.max.y + pad && b.min.y < a.max.y + pad && a.min.z < b.max.z + pad && b.min.z < a.max.z + pad;
const reserved: Box3[] = [...brushes.filter((b) => b.type !== 'ramp').map(brushBounds), ...catches, ...zones.filter((z) => z.type !== 'teleport')];

/** Course corridor: points along every chain's peak and base edge plus each transfer line (and the air turn). */
const corridor: Vec3[] = [];
for (const [i, c] of chains.entries()) {
	for (let s = 0; s < c.ramps.length; s++) {
		const len = c.dist[s + 1]! - c.dist[s]!;
		for (let a = 0; a <= len; a += 256) for (const f of [0, 0.5, 1]) corridor.push(facePoint(c, s, a, f));
	}
	if (i > 0) {
		const e = chainExit(chains[i - 1]!).point;
		const p = c.peak[0]!;
		for (let t = 0; t <= 1; t += 0.1) corridor.push(v3(e.x + (p.x - e.x) * t, e.y + (p.y - e.y) * t, e.z + (p.z - e.z) * t));
	}
}
{
	const ex = chainExit(chains[9]!);
	const d0 = dirXY(ex.yaw);
	const vh = OCHRE_TURN.speed;
	for (const s of airTurnFlight(ex.point, v3(d0.x * vh, d0.y * vh, -ex.grade * vh), ex.yaw + OCHRE_TURN.turn, { maxTime: 4, dt: 1 / 16 })) corridor.push(s.p);
}
const corridorDist = (x: number, y: number) => Math.min(...corridor.map((p) => Math.hypot(p.x - x, p.y - y)));

function addScenery(b: BoxBrush): boolean {
	if (reserved.some((r) => overlapsBox(b, r, 64)) || OCHRE_SCENERY.some((s) => overlapsBox(b, s, 1))) return false;
	OCHRE_SCENERY.push(b);
	return true;
}

/** Stepped hoodoo pillar: 3 stacked boxes narrowing upwards from the canyon floor to `topZ`. */
function hoodoo(x: number, y: number, w: number, topZ: number, mat = MESA): boolean {
	const h = (topZ - CANYON_Z) / 3;
	const parts = [0, 1, 2].map((k) => {
		const half = Math.round((w * (1 - k * 0.22)) / 2);
		return box(v3(x - half, y - half, Math.round(CANYON_Z + h * k)), v3(x + half, y + half, Math.round(CANYON_Z + h * (k + 1))), k === 2 ? CAP : mat);
	});
	if (parts.some((p) => reserved.some((r) => overlapsBox(p, r, 64)) || OCHRE_SCENERY.some((s) => overlapsBox(p, s, 1)))) return false;
	OCHRE_SCENERY.push(...parts);
	return true;
}

// The sinkhole: a rock column in the middle of the spiral and a low rim far below it.
export const OCHRE_SPIRAL_CENTER: { x: number; y: number } = (() => {
	const c = chains[2]!;
	const i = c.yaws.findIndex((_, k) => k > 0 && c.yaws[k] !== c.yaws[k - 1]);
	const d = dirXY(c.yaws[0]!);
	const r0 = SPIRAL_R0;
	const s = c.peak[i]!;
	return { x: Math.round(s.x + d.y * r0), y: Math.round(s.y - d.x * r0) };
})();
{
	const c = chains[2]!;
	const sc = OCHRE_SPIRAL_CENTER;
	const top = Math.round(c.peak[0]!.z + 700);
	hoodoo(sc.x, sc.y, 2000, top, MESA);
	const low = Math.round(boundsOf(c.ramps).min.z - 2600);
	const R = SPIRAL_R1 + 1400;
	for (const [x0, y0, x1, y1] of [
		[-R, -R, R, -R + 400],
		[-R, R - 400, R, R],
		[-R, -R + 400, -R + 400, R - 400],
		[R - 400, -R + 400, R, R - 400]
	] as const)
		addScenery(box(v3(sc.x + x0, sc.y + y0, CANYON_Z), v3(sc.x + x1, sc.y + y1, low), MESA));
}

// Deterministic jittered grid of pillars, mesas and floating islands around the course.
let seed = 20261122;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const cb = boundsOf(chains.flatMap((c) => c.ramps));
for (let gx = cb.min.x - 6000; gx <= cb.max.x + 6000; gx += 3200) {
	for (let gy = cb.min.y - 6000; gy <= cb.max.y + 6000; gy += 3200) {
		const x = Math.round(gx + (rnd() - 0.5) * 1400);
		const y = Math.round(gy + (rnd() - 0.5) * 1400);
		const d = corridorDist(x, y);
		const kind = rnd();
		if (d < 1600) continue;
		if (d > 5200 && kind < 0.35) {
			// Mesa: wide, flat-topped, lower than the course.
			const w = Math.round(1800 + rnd() * 1600);
			const topZ = Math.round(5200 + rnd() * 2400);
			if (addScenery(box(v3(x - w / 2, y - w / 2, CANYON_Z), v3(x + w / 2, y + w / 2, topZ - 96), MESA)))
				addScenery(box(v3(x - w / 2, y - w / 2, topZ - 96), v3(x + w / 2, y + w / 2, topZ), CAP));
		} else if (kind < 0.8) {
			hoodoo(x, y, Math.round(520 + rnd() * 520), Math.round(9000 + rnd() * 9000));
		} else if (d > 2000) {
			// Floating rock island near course height, with a lit rim underneath.
			const w = Math.round(500 + rnd() * 500);
			const z = Math.round(9500 + rnd() * 6500);
			if (addScenery(box(v3(x - w / 2, y - w / 2, z), v3(x + w / 2, y + w / 2, z + 256), MESA)))
				addScenery(box(v3(x - w / 2 + 64, y - w / 2 + 64, z - 48), v3(x + w / 2 - 64, y + w / 2 - 64, z), GLOW));
		}
	}
}
brushes.push(...OCHRE_SCENERY);

zones.push(...catches);
const all = boundsOf(brushes);
zones.push(teleportBelow(brushes, Math.min(CANYON_Z, all.min.z) - 64, 'start', 6000, 4096));

// ---------------------------------------------------------------------------
// Theme: golden hour. Low warm sun, violet-blue zenith, amber haze; sandstone
// ramps with teal edge lines; canyon fins with gold-lit edges so their holes
// read from afar; pale teal glass; dust motes; a sand floor far below.

const theme: Theme = {
	skyTop: 0x34467f,
	skyHorizon: 0xffa65c,
	skyBottom: 0x7a4128,
	fogColor: 0xe0a06a,
	fogNear: 6000,
	fogFar: 34000,
	sunColor: 0xffb46a,
	sunIntensity: 1.25,
	sunDir: v3(-0.62, 0.52, 0.2),
	ambientSky: 0xffd6a8,
	ambientGround: 0x6e3b26,
	ambientIntensity: 0.62,
	materials: {
		[SAND]: { color: 0xc8733f, topColor: 0xe9b27c, edgeColor: 0x46f2dc, seamColor: 0x2fd6c2, noise: 0.2, noiseScale: 320, roughness: 0.85 },
		[STONE]: { color: 0x9c5c39, topColor: 0xdba673, edgeColor: 0x46f2dc, noise: 0.14, noiseScale: 256, roughness: 0.9 },
		[WALL]: { color: 0x8a4e31, topColor: 0xc9915f, noise: 0.18, noiseScale: 192, roughness: 0.95 },
		[MESA]: { color: 0xa45634, topColor: 0xd99560, noise: 0.24, noiseScale: 640, roughness: 0.95 },
		[CAP]: { color: 0xd38a52, topColor: 0xf0c48e, noise: 0.16, noiseScale: 384, roughness: 0.9 },
		[GLOW]: { color: 0x1f6f68, edgeColor: 0x6ffff0, seamColor: 0x46f2dc, noise: 0.1, roughness: 0.4 },
		[FIN]: { color: 0x9a5532, topColor: 0xd8a06c, edgeColor: 0xffd27a, noise: 0.22, noiseScale: 288, roughness: 0.92 },
		[LINTEL]: { color: 0xb8683c, topColor: 0xe9b27c, edgeColor: 0xffd27a, noise: 0.18, noiseScale: 256, roughness: 0.9 },
		[GLASS]: { color: 0x5fd8e8, topColor: 0xbff8ff, edgeColor: 0x9ffcff, glass: true, opacity: 0.26, noise: 0.03, roughness: 0.1 },
		[GLASS_RAMP]: { color: 0x48c8d8, topColor: 0xa8f4ff, edgeColor: 0x46f2dc, seamColor: 0x9ffcff, glass: true, opacity: 0.38, noise: 0.05, noiseScale: 320, roughness: 0.15 }
	},
	effects: [
		{ type: 'snowFloor', color: 0xc98a55, z: CANYON_Z, size: 200000 },
		{ type: 'clouds', color: 0xffc896, count: 90, height: 22000 },
		{
			type: 'embers',
			color: 0xffd58a,
			count: 2500,
			area: { min: v3(cb.min.x - 3000, cb.min.y - 3000, 6000), max: v3(cb.max.x + 3000, cb.max.y + 3000, 17000) }
		}
	]
};

export const surf_ochre: MapDef = {
	id: 'surf_ochre',
	title: 'Ochre',
	kind: 'surf',
	difficulty: 'hard',
	layout: 'linear',
	cvars: { ...SURF_CVARS },
	spawn,
	brushes,
	zones,
	theme
};
