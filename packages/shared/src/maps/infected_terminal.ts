/**
 * infected_terminal — open map for the Infected mode. A bright, sunlit
 * modernist airport: a terrazzo concourse in the south, a tarmac apron in
 * the north with a parked jetliner, and an upper loop of decks and bridges.
 *
 * Arena 3328 × 3328 (x, y in [-1664, 1664]), ground at z = 0, enclosed by
 * 1024-tall curtain walls (a low solid base, a tall glass clerestory, a thin header) with
 * slate piers and a base band on the inside. Every climbable top is at or
 * under 420. A glass facade (y 352, x -608) separates the concourse and the
 * gate area from the apron, with wide openings.
 *
 *   N   Jetliner: fuselage x [-384, 1280] y [1040, 1264] on landing gear,
 *       belly at 64, cabin floor 72, roof 208. Four 160-wide cabin doors
 *       (front and rear, both sides) so you can run straight through.
 *       A glass jetway (floor 72) rises from the concourse to the front
 *       door; airstairs climb from the apron to the rear door. Swept wings
 *       (176) on both sides, engines hanging under them, and a baggage
 *       loader crate stack (36 per jump) up to the south wing tip; from the
 *       wing root a 32 jump puts you on the fuselage roof.
 *   SW  Upper mezzanine: departure lounge deck at 160 on four columns, open
 *       underneath, glass guardrails (160..200) with vault gaps, escalator
 *       stairs from the east and the north (10 × 16).
 *   C   Security: three metal-detector arches (160 wide, 176 tall) between
 *       waist-high desks, under a glass skylight on columns; two check-in
 *       islands south of it with tall sign panels.
 *   SE  Baggage claim: two stepped carousels (24 / 40) and a baggage-control
 *       booth (roof 128) open underneath on two sides (a dark alcove),
 *       reached by stairs (8 × 16) and a suitcase stack (40 per jump).
 *   NW  Gate lounge: balcony at 176 on four columns with glass rails and a
 *       glass ATC cab, stairs (11 × 16) from the east, a crate climb from
 *       the north, gate counter and benches underneath. A skybridge (176)
 *       links it to the mezzanine: a full upper loop.
 *
 * Brushes never intersect, and side-by-side brushes either touch or leave
 * more than 40 units between them (no player-trapping slots).
 */
import type { MapDef, Spawn, Theme, Zone } from './types.ts';
import type { Box3, BoxBrush } from './helpers.ts';
import { ZOMBIES_CVARS } from '../modes/index.ts';
import { boundsOf, teleportBelow, v3 } from './helpers.ts';
import { block, hall, stairs, yawTowards, type ClimbRoute } from './tag-helpers.ts';

/** Half size of the arena (inner faces of the curtain walls). */
export const ARENA = 1664;
const WALL_T = 64;
export const WALL_TOP = 1024;

const boxes: BoxBrush[] = [];
const climbs: ClimbRoute[] = [];
const add = <T extends BoxBrush>(b: T): T => (boxes.push(b), b);
const addAll = (bs: BoxBrush[]): BoxBrush[] => (boxes.push(...bs), bs);
const area = (x0: number, x1: number, y0: number, y1: number, z: number): Box3 => ({ min: v3(x0, y0, z), max: v3(x1, y1, z) });
/** The whole arena floor as one surface (climb routes start on it; the tiles cover it exactly). */
const FLOOR: Box3 = area(-ARENA, ARENA, -ARENA, ARENA, 0);

// --- Ground: terrazzo concourse, gate carpet, tarmac apron ---------------------------
/**
 * Partition the arena floor (z −64..0) into non-overlapping tiles: every
 * painted rectangle (later ones win) over the base, merged into strips.
 */
function groundTiles(paint: Array<[number, number, number, number, string]>, base: string): BoxBrush[] {
	const cuts = (vals: number[]) => [...new Set([-ARENA, ARENA, ...vals])].filter((v) => v >= -ARENA && v <= ARENA).sort((a, b) => a - b);
	const xs = cuts(paint.flatMap(([x0, x1]) => [x0, x1]));
	const ys = cuts(paint.flatMap(([, , y0, y1]) => [y0, y1]));
	const matAt = (x: number, y: number): string => {
		for (let i = paint.length - 1; i >= 0; i--) {
			const [x0, x1, y0, y1, mat] = paint[i]!;
			if (x > x0 && x < x1 && y > y0 && y < y1) return mat;
		}
		return base;
	};
	const out: BoxBrush[] = [];
	let open = new Map<string, BoxBrush>();
	for (let j = 0; j < ys.length - 1; j++) {
		const y0 = ys[j]!;
		const y1 = ys[j + 1]!;
		const strips: Array<[number, number, string]> = [];
		for (let i = 0; i < xs.length - 1; i++) {
			const mat = matAt((xs[i]! + xs[i + 1]!) / 2, (y0 + y1) / 2);
			const last = strips[strips.length - 1];
			if (last && last[2] === mat && last[1] === xs[i]) last[1] = xs[i + 1]!;
			else strips.push([xs[i]!, xs[i + 1]!, mat]);
		}
		const next = new Map<string, BoxBrush>();
		for (const [x0, x1, mat] of strips) {
			const key = `${x0},${x1},${mat}`;
			const prev = open.get(key);
			if (prev) {
				prev.max = v3(prev.max.x, y1, prev.max.z);
				next.set(key, prev);
			} else {
				const b = block(x0, x1, y0, y1, -64, 0, mat);
				out.push(b);
				next.set(key, b);
			}
		}
		open = next;
	}
	return out;
}
/** Facade lines: the apron starts north of y = 352 and east of x = -592. */
const APRON_Y = 352;
const GATE_X = -592;
const ground = addAll(
	groundTiles(
		[
			[-ARENA, GATE_X, APRON_Y, ARENA, 'carpet'],
			[GATE_X, ARENA, APRON_Y, ARENA, 'tarmac'],
			// Taxiway markings: the nose lead-in line, a stop bar and a service lane edge.
			[1392, ARENA, 1144, 1160, 'taxiStripe'],
			[GATE_X, ARENA, 1600, 1616, 'taxiStripe'],
			[1504, 1520, 448, 1600, 'taxiStripe'],
			// Slate walkway bands across the hall: along the facade and past the check-in islands.
			[-1408, 1536, 96, 224, 'walkway'],
			[-1408, 1536, -608, -480, 'walkway'],
			// Darker terrazzo inlays under the security line and the baggage hall.
			[-704, 704, -320, -192, 'terrazzoDark'],
			[640, 1536, -1536, -896, 'terrazzoDark'],
			// Carpet runners through the outer security arches, from the check-in band to the facade.
			[-448, -320, -480, 96, 'runner'],
			[320, 448, -480, 96, 'runner']
		],
		'terrazzo'
	)
);

// --- Curtain walls -------------------------------------------------------------------
/**
 * Each side: solid base, tall glass clerestory, thin solid header, flush up to
 * WALL_TOP. The solid part stays low (448, 384 on the tarmac side) so the sky
 * and clouds read through the glass; the glass still blocks players and knives.
 */
const BASE_TOP = 448;
const TARMAC_BASE_TOP = 384;
const HEADER_Z = 896;
const TARMAC_HEADER_Z = 960;
const bands = (base: number, header: number): Array<[number, number, string]> => [
	[-64, base, 'curtainWall'],
	[base, header, 'clerestory'],
	[header, WALL_TOP, 'curtainHeader']
];
const perimeter: BoxBrush[] = [];
const sideBoxes: Array<[Box3, Array<[number, number, string]>]> = [
	[area(-ARENA - WALL_T, -ARENA, -ARENA - WALL_T, ARENA + WALL_T, 0), bands(BASE_TOP, HEADER_Z)],
	[area(ARENA, ARENA + WALL_T, -ARENA - WALL_T, ARENA + WALL_T, 0), bands(BASE_TOP, HEADER_Z)],
	[area(-ARENA, ARENA, -ARENA - WALL_T, -ARENA, 0), bands(BASE_TOP, HEADER_Z)],
	[area(-ARENA, ARENA, ARENA, ARENA + WALL_T, 0), bands(TARMAC_BASE_TOP, TARMAC_HEADER_Z)]
];
for (const [{ min, max }, side] of sideBoxes)
	for (const [z0, z1, mat] of side) perimeter.push(add(block(min.x, max.x, min.y, max.y, z0, z1, mat)));
const PIER_TOP = WALL_TOP + 16;
const PIER_D = 32;
const BAND_D = 16;
const BAND_TOP = 80;
const CORNER = 64;
const PIERS = [-1280, -768, -256, 256, 768, 1280];
const wallTrim: BoxBrush[] = [];
/** A box against the inside of a wall: `a0..a1` along it, `depth` into the arena. */
function trimBox(side: 'W' | 'E' | 'S' | 'N', a0: number, a1: number, depth: number, z1: number, mat: string): BoxBrush {
	if (side === 'S' || side === 'N') {
		a0 = Math.max(a0, -ARENA + CORNER);
		a1 = Math.min(a1, ARENA - CORNER);
	}
	if (side === 'W') return block(-ARENA, -ARENA + depth, a0, a1, 0, z1, mat);
	if (side === 'E') return block(ARENA - depth, ARENA, a0, a1, 0, z1, mat);
	if (side === 'S') return block(a0, a1, -ARENA, -ARENA + depth, 0, z1, mat);
	return block(a0, a1, ARENA - depth, ARENA, 0, z1, mat);
}
for (const side of ['W', 'E', 'S', 'N'] as const) {
	const solid: Array<[number, number]> = [[-ARENA, -ARENA + CORNER], ...PIERS.map((c): [number, number] => [c - 32, c + 32]), [ARENA - CORNER, ARENA]];
	for (let i = 0; i < solid.length; i++) {
		const [a0, a1] = solid[i]!;
		const corner = i === 0 || i === solid.length - 1;
		if (!corner || side === 'W' || side === 'E') wallTrim.push(trimBox(side, a0, a1, corner ? CORNER : PIER_D, PIER_TOP, 'pier'));
		const next = solid[i + 1];
		if (next) wallTrim.push(trimBox(side, a1, next[0], BAND_D, BAND_TOP, 'curtainBand'));
	}
}
addAll(wallTrim);
const coping = perimeter.filter((w) => w.max.z === WALL_TOP).map((w) => add(block(w.min.x, w.max.x, w.min.y, w.max.y, WALL_TOP, WALL_TOP + 16, 'coping')));

// --- N: the jetliner ------------------------------------------------------------------
const FUS = { x0: -384, x1: 1280, y0: 1040, y1: 1264 };
const BELLY = 64;
const CABIN_FLOOR = 72;
const CABIN_CEIL = 200;
const FUS_ROOF = 208;
const SKIN = 16;
const frontDoor = { x0: 960, x1: 1120 };
const rearDoor = { x0: -224, x1: -64 };
const cabinSlab = add(block(FUS.x0, FUS.x1, FUS.y0, FUS.y1, BELLY, CABIN_FLOOR, 'belly'));
/** A fuselage side wall segment: silver skin, a cobalt cheatline under a dark window band. */
const skin = (x0: number, x1: number, y0: number, y1: number): BoxBrush[] => [
	add(block(x0, x1, y0, y1, CABIN_FLOOR, 112, 'fuselage')),
	add(block(x0, x1, y0, y1, 112, 128, 'cheatline')),
	add(block(x0, x1, y0, y1, 128, 160, 'windowBand')),
	add(block(x0, x1, y0, y1, 160, CABIN_CEIL, 'fuselage'))
];
const sideSpans: Array<[number, number]> = [
	[FUS.x0, rearDoor.x0],
	[rearDoor.x1, frontDoor.x0],
	[frontDoor.x1, FUS.x1]
];
const cabinWalls: BoxBrush[] = [];
for (const [x0, x1] of sideSpans) {
	cabinWalls.push(...skin(x0, x1, FUS.y0, FUS.y0 + SKIN), ...skin(x0, x1, FUS.y1 - SKIN, FUS.y1));
}
cabinWalls.push(
	add(block(FUS.x0, FUS.x0 + SKIN, FUS.y0 + SKIN, FUS.y1 - SKIN, CABIN_FLOOR, CABIN_CEIL, 'fuselage')),
	add(block(FUS.x1 - SKIN, FUS.x1, FUS.y0 + SKIN, FUS.y1 - SKIN, CABIN_FLOOR, CABIN_CEIL, 'fuselage'))
);
const fuselageRoof = add(block(FUS.x0, FUS.x1, FUS.y0, FUS.y1, CABIN_CEIL, FUS_ROOF, 'fuselageTop'));
// Seat rows (40) along both walls between the doors, a 96-wide aisle, and the galleys up front.
const seats: BoxBrush[] = [];
for (let x = 0; x <= 768; x += 128) {
	seats.push(add(block(x, x + 64, FUS.y0 + SKIN, FUS.y0 + 64, CABIN_FLOOR, CABIN_FLOOR + 40, 'seat')));
	seats.push(add(block(x, x + 64, FUS.y1 - 64, FUS.y1 - SKIN, CABIN_FLOOR, CABIN_FLOOR + 40, 'seat')));
}
const galleys = [
	add(block(1184, FUS.x1 - SKIN, FUS.y0 + SKIN, FUS.y0 + 64, CABIN_FLOOR, 168, 'galley')),
	add(block(1184, FUS.x1 - SKIN, FUS.y1 - 64, FUS.y1 - SKIN, CABIN_FLOOR, 168, 'galley'))
];
// Nose and cockpit, tail cone, fin and stabilisers.
const nose = [add(block(FUS.x1, 1344, FUS.y0 + SKIN, FUS.y1 - SKIN, 80, 192, 'fuselage')), add(block(1344, 1392, 1104, 1200, 96, 176, 'cockpit'))];
const tail = [
	add(block(-448, FUS.x0, FUS.y0, FUS.y1, 96, FUS_ROOF, 'fuselage')),
	add(block(-496, -448, 1104, 1200, 128, 192, 'fuselage')),
	add(block(FUS.x0, -192, 1136, 1168, FUS_ROOF, 400, 'tailFin')),
	add(block(FUS.x0, -256, 976, FUS.y0, 192, FUS_ROOF, 'tailFin')),
	add(block(FUS.x0, -256, FUS.y1, 1328, 192, FUS_ROOF, 'tailFin'))
];
// Landing gear (the belly rests on them; crouch under the plane between them).
const gear = [
	add(block(1216, 1248, 1136, 1168, 0, BELLY, 'gear')),
	add(block(384, 448, 1072, 1104, 0, BELLY, 'gear')),
	add(block(384, 448, 1200, 1232, 0, BELLY, 'gear'))
];
// Swept wings (top 176), three spans each side, tips towards the tail.
const WING_Z0 = 160;
const WING_TOP = 176;
const wingSouth = [
	add(block(256, 640, 912, FUS.y0, WING_Z0, WING_TOP, 'wing')), // root
	add(block(192, 576, 784, 912, WING_Z0, WING_TOP, 'wing')), // mid
	add(block(128, 448, 688, 784, WING_Z0, WING_TOP, 'wing')) // tip
];
const wingNorth = [
	add(block(256, 640, FUS.y1, 1392, WING_Z0, WING_TOP, 'wing')),
	add(block(192, 576, 1392, 1520, WING_Z0, WING_TOP, 'wing')),
	add(block(128, 448, 1520, 1584, WING_Z0, WING_TOP, 'wing'))
];
// Engines on pylons under the mid spans.
const engines = [
	add(block(320, 512, 816, 880, BELLY, 136, 'engine')),
	add(block(384, 448, 832, 864, 136, WING_Z0, 'pylon')),
	add(block(320, 512, 1424, 1488, BELLY, 136, 'engine')),
	add(block(384, 448, 1440, 1472, 136, WING_Z0, 'pylon'))
];
// Glass jetway from the concourse to the front south door: six 12 steps, then a 128-wide tube at 72.
const jetwayFloor = add(block(frontDoor.x0, frontDoor.x1, APRON_Y, FUS.y0, 0, CABIN_FLOOR, 'jetwayFloor'));
const jetwayWalls = [
	add(block(frontDoor.x0, frontDoor.x0 + SKIN, APRON_Y, FUS.y0, CABIN_FLOOR, CABIN_CEIL, 'jetwayGlass')),
	add(block(frontDoor.x1 - SKIN, frontDoor.x1, APRON_Y, FUS.y0, CABIN_FLOOR, CABIN_CEIL, 'jetwayGlass'))
];
const jetwayRoof = add(block(frontDoor.x0, frontDoor.x1, APRON_Y, FUS.y0, CABIN_CEIL, 216, 'jetwayRoof'));
const jetwaySteps = addAll(
	stairs({ foot: { x: 1040, y: APRON_Y - 192 }, dir: '+y', steps: 6, width: 128, rise: 12, run: 32, material: 'jetwayFloor' })
);
// Airstairs up to the rear north door.
const airstairs = addAll(stairs({ foot: { x: -144, y: FUS.y1 + 192 }, dir: '-y', steps: 6, width: 128, rise: 12, run: 32, material: 'airstairs' }));
// Baggage loader crate stack (36 per jump) up to the south wing tip.
const loaderCrates = addAll(stairs({ foot: { x: 288, y: 432 }, dir: '+y', steps: 4, width: 128, rise: 36, run: 64, material: 'loader' }));
const jetwayTube = area(frontDoor.x0 + SKIN, frontDoor.x1 - SKIN, APRON_Y, FUS.y0, CABIN_FLOOR);
const cabinFront = area(frontDoor.x0 + SKIN, frontDoor.x1 - SKIN, FUS.y0, FUS.y1 - SKIN, CABIN_FLOOR);
const cabinRear = area(rearDoor.x0 + SKIN, rearDoor.x1 - SKIN, FUS.y0 + SKIN, FUS.y1, CABIN_FLOOR);
climbs.push({ label: 'jetway steps', how: 'step', surfaces: [FLOOR, ...jetwaySteps, jetwayTube] });
climbs.push({ label: 'jetway → cabin', how: 'step', surfaces: [area(frontDoor.x0 + SKIN, frontDoor.x1 - SKIN, 896, FUS.y0, CABIN_FLOOR), cabinFront] });
climbs.push({ label: 'airstairs', how: 'step', surfaces: [FLOOR, ...airstairs, cabinRear] });
climbs.push({ label: 'loader → wing → fuselage roof', how: 'jump', surfaces: [FLOOR, ...loaderCrates, wingSouth[2]!, wingSouth[1]!, wingSouth[0]!, fuselageRoof] });
climbs.push({ label: 'fuselage roof → jetway roof', how: 'step', surfaces: [area(976, 1104, 1040, 1136, FUS_ROOF), jetwayRoof] });

// --- Glass facade ---------------------------------------------------------------------
const FACADE_TOP = 192;
const facade: BoxBrush[] = [];
const pane = (x0: number, x1: number, y0: number, y1: number) => {
	facade.push(add(block(x0, x1, y0, y1, 0, FACADE_TOP, 'facadeGlass')), add(block(x0, x1, y0, y1, FACADE_TOP, FACADE_TOP + 16, 'facadeFrame')));
};
for (const [x0, x1] of [
	[GATE_X - 16, -352],
	[-128, 160],
	[544, 896],
	[1168, 1408]
] as const)
	pane(x0, x1, APRON_Y, APRON_Y + 16);
for (const [y0, y1] of [
	[APRON_Y + 16, 640],
	[896, 1280]
] as const)
	pane(GATE_X - 16, GATE_X, y0, y1);

// --- SW: upper mezzanine --------------------------------------------------------------
const MEZZ = { x0: -1536, x1: -896, y0: -1408, y1: -768 };
const MEZZ_TOP = 160;
const RAIL_H = 40;
const mezzParts = addAll(hall(MEZZ, MEZZ_TOP - 16, MEZZ_TOP, 64, { roof: 'mezzanine', pillar: 'column' }, false));
const mezzDeck = mezzParts[0]!;
const rail = (x0: number, x1: number, y0: number, y1: number, z: number) => add(block(x0, x1, y0, y1, z, z + RAIL_H, 'glassRail'));
const mezzRails = [
	rail(-1536, -1312, -1408, -1392, MEZZ_TOP), // south (vault gap 96)
	rail(-1216, -896, -1408, -1392, MEZZ_TOP),
	rail(-1536, -1520, -1392, -768, MEZZ_TOP), // west
	rail(-912, -896, -1392, -1184, MEZZ_TOP), // east (escalator landing open)
	rail(-912, -896, -992, -784, MEZZ_TOP),
	rail(-1312, -1184, -784, -768, MEZZ_TOP), // north (skybridge and escalator open)
	rail(-992, -896, -784, -768, MEZZ_TOP)
];
const mezzEastStairs = addAll(stairs({ foot: { x: -576, y: -1088 }, dir: '-x', steps: 10, width: 128, rise: 16, run: 32, material: 'escalator' }));
const mezzNorthStairs = addAll(stairs({ foot: { x: -1088, y: -448 }, dir: '-y', steps: 10, width: 128, rise: 16, run: 32, material: 'escalator' }));
const mezzEastLanding = area(-1024, -896, -1152, -1024, MEZZ_TOP);
const mezzNorthLanding = area(-1152, -1024, -864, -768, MEZZ_TOP);
const mezzSkyLanding = area(-1504, -1376, -864, -768, MEZZ_TOP);
climbs.push({ label: 'mezzanine east escalator', how: 'step', surfaces: [FLOOR, ...mezzEastStairs, mezzEastLanding] });
climbs.push({ label: 'mezzanine north escalator', how: 'step', surfaces: [FLOOR, ...mezzNorthStairs, mezzNorthLanding] });

// --- Skybridge (mezzanine → gate lounge) --------------------------------------------------
const LOUNGE = { x0: -1536, x1: -1024, y0: 448, y1: 960 };
const LOUNGE_TOP = 176;
const skybridge = add(block(-1504, -1376, MEZZ.y1, LOUNGE.y0, MEZZ_TOP, LOUNGE_TOP, 'skybridge'));
const skyRails = [
	add(block(-1520, -1504, MEZZ.y1, LOUNGE.y0, MEZZ_TOP, LOUNGE_TOP + RAIL_H, 'glassRail')),
	add(block(-1376, -1360, MEZZ.y1, LOUNGE.y0, MEZZ_TOP, LOUNGE_TOP + RAIL_H, 'glassRail'))
];
const skyColumns = [add(block(-1472, -1408, -224, -160, 0, MEZZ_TOP, 'column')), add(block(-1472, -1408, 96, 160, 0, MEZZ_TOP, 'column'))];

// --- NW: gate lounge balcony and ATC cab --------------------------------------------------
const loungeParts = addAll(hall(LOUNGE, LOUNGE_TOP - 16, LOUNGE_TOP, 64, { roof: 'mezzanine', pillar: 'column' }, false));
const loungeDeck = loungeParts[0]!;
const loungeRails = [
	rail(-1312, -1040, 448, 464, LOUNGE_TOP), // south (skybridge landing open)
	rail(-1040, -1024, 464, 608, LOUNGE_TOP), // east (stair landing open)
	rail(-1040, -1024, 800, 960, LOUNGE_TOP),
	rail(-1536, -1376, 944, 960, LOUNGE_TOP), // north (crate landing open)
	rail(-1184, -1040, 944, 960, LOUNGE_TOP),
	rail(-1536, -1520, 512, 944, LOUNGE_TOP) // west
];
const atcCab = [
	add(block(-1520, -1392, 784, 944, LOUNGE_TOP, 304, 'atcGlass')),
	add(block(-1520, -1392, 784, 944, 304, 320, 'atcRoof')),
	add(block(-1472, -1440, 848, 880, 320, 352, 'beacon'))
];
const loungeStairs = addAll(stairs({ foot: { x: -672, y: 704 }, dir: '-x', steps: 11, width: 128, rise: 16, run: 32, material: 'escalator' }));
const loungeCrates = addAll(stairs({ foot: { x: -1280, y: 1216 }, dir: '-y', steps: 4, width: 128, rise: 40, run: 64, material: 'loader' }));
const gateCounter = add(block(-1344, -1184, 640, 704, 0, 40, 'checkin'));
const benches = [add(block(-1408, -1280, 800, 832, 0, 32, 'seat')), add(block(-1216, -1088, 800, 832, 0, 32, 'seat'))];
const loungeStairLanding = area(-1120, -1024, 640, 768, LOUNGE_TOP);
const loungeCrateLanding = area(-1344, -1216, 864, 960, LOUNGE_TOP);
const loungeSkyLanding = area(-1504, -1376, 448, 544, LOUNGE_TOP);
climbs.push({ label: 'gate lounge stairs', how: 'step', surfaces: [FLOOR, ...loungeStairs, loungeStairLanding] });
climbs.push({ label: 'gate lounge crate climb', how: 'jump', surfaces: [FLOOR, ...loungeCrates, loungeCrateLanding] });
climbs.push({ label: 'mezzanine → skybridge → gate lounge', how: 'step', surfaces: [mezzSkyLanding, skybridge, loungeSkyLanding] });
climbs.push({ label: 'gate lounge → skybridge → mezzanine', how: 'step', surfaces: [loungeSkyLanding, skybridge, mezzSkyLanding] });

// --- C: security and check-in ---------------------------------------------------------------
const SEC = { y0: -272, y1: -240 };
const ARCH_TOP = 176;
const archCentres = [-384, 0, 384];
const arches: Array<{ posts: BoxBrush[]; header: BoxBrush; opening: Box3 }> = archCentres.map((c) => ({
	posts: [add(block(c - 112, c - 80, SEC.y0, SEC.y1, 0, ARCH_TOP, 'detector')), add(block(c + 80, c + 112, SEC.y0, SEC.y1, 0, ARCH_TOP, 'detector'))],
	header: add(block(c - 112, c + 112, SEC.y0, SEC.y1, ARCH_TOP, ARCH_TOP + 32, 'detectorHead')),
	opening: { min: v3(c - 80, SEC.y0, 0), max: v3(c + 80, SEC.y1, ARCH_TOP) }
}));
const desks = [
	add(block(-656, -496, -288, -224, 0, 40, 'desk')),
	add(block(-272, -112, -288, -224, 0, 40, 'desk')),
	add(block(112, 272, -288, -224, 0, 40, 'desk')),
	add(block(496, 656, -288, -224, 0, 40, 'desk'))
];
// Glass skylight on four columns over the security line.
const skylightColumns = [
	add(block(-704, -640, -448, -384, 0, 400, 'column')),
	add(block(640, 704, -448, -384, 0, 400, 'column')),
	add(block(-704, -640, -128, -64, 0, 400, 'column')),
	add(block(640, 704, -128, -64, 0, 400, 'column'))
];
const skylight = add(block(-704, 704, -448, -64, 400, 416, 'skylight'));
// Check-in islands: a 40 counter in front of a tall sign panel with a coloured header.
const checkin: BoxBrush[] = [];
for (const [x0, x1] of [
	[-512, -192],
	[192, 512]
] as const) {
	checkin.push(
		add(block(x0, x1, -768, -704, 0, 40, 'checkin')),
		add(block(x0, x1, -704, -688, 0, 160, 'signPanel')),
		add(block(x0, x1, -704, -688, 160, 192, 'signage'))
	);
}

// --- SE: baggage claim -------------------------------------------------------------------------
const carousels = [
	{ base: add(block(704, 960, -1120, -928, 0, 24, 'carouselBase')), belt: add(block(752, 912, -1072, -976, 24, 40, 'carousel')) },
	{ base: add(block(704, 960, -1472, -1280, 0, 24, 'carouselBase')), belt: add(block(752, 912, -1424, -1328, 24, 40, 'carousel')) }
];
const BOOTH = { x0: 1216, x1: 1472, y0: -1472, y1: -1216 };
const BOOTH_ROOF = 128;
const boothParts = addAll(hall(BOOTH, BOOTH_ROOF - 16, BOOTH_ROOF, 32, { roof: 'boothRoof', pillar: 'boothWall' }, false));
const boothRoof = boothParts[0]!;
const boothWalls = [
	add(block(BOOTH.x0 + 32, BOOTH.x1 - 32, BOOTH.y0, BOOTH.y0 + 32, 0, BOOTH_ROOF - 16, 'boothWall')),
	add(block(BOOTH.x1 - 32, BOOTH.x1, BOOTH.y0 + 32, BOOTH.y1 - 32, 0, BOOTH_ROOF - 16, 'boothWall'))
];
const boothStairs = addAll(stairs({ foot: { x: 1408, y: -960 }, dir: '-y', steps: 8, width: 128, rise: 16, run: 32, material: 'escalator' }));
const suitcases = addAll(stairs({ foot: { x: 1024, y: -1248 }, dir: '+x', steps: 3, width: 128, rise: 40, run: 64, material: 'suitcase' }));
const boothStairLanding = area(1344, 1472, -1344, -1216, BOOTH_ROOF);
const boothSuitcaseLanding = area(1216, 1312, -1312, -1216, BOOTH_ROOF);
/** The dark alcove under the booth roof (beacon hide), open to the north and the west. */
const boothAlcove: Box3 = { min: v3(BOOTH.x0 + 32, BOOTH.y0 + 32, 0), max: v3(BOOTH.x1 - 32, BOOTH.y1, BOOTH_ROOF - 16) };
climbs.push({ label: 'baggage booth stairs', how: 'step', surfaces: [FLOOR, ...boothStairs, boothStairLanding] });
climbs.push({ label: 'suitcase stack → booth roof', how: 'jump', surfaces: [FLOOR, ...suitcases, boothSuitcaseLanding] });
climbs.push({ label: 'carousel', how: 'jump', surfaces: [FLOOR, carousels[0]!.base] });
climbs.push({ label: 'carousel rim → belt', how: 'step', surfaces: [area(752, 912, -1120, -1072, 24), carousels[0]!.belt] });

// --- Spawns (feet on the floor; the registry lifts them by SPAWN_CLEARANCE) --------------------
const SPAWN_XY: Array<[number, number]> = [
	// NE: apron
	[1472, 1472],
	[1472, 640],
	[768, 512],
	[1344, 224],
	[704, 1472],
	// NW: gate area and apron
	[-1472, 1472],
	[-768, 1472],
	[-1280, 256],
	[-800, 1088],
	[-256, 640],
	// SW: mezzanine and check-in
	[-1472, -1472],
	[-512, -1472],
	[-1216, -256],
	[-640, -640],
	[-256, -1152],
	// SE: baggage claim and concourse
	[1536, -1088],
	[512, -1472],
	[1472, -704],
	[576, -576],
	[256, -1024]
];
const spawns: Spawn[] = SPAWN_XY.map(([x, y]) => {
	const pos = v3(x, y, 0);
	return { pos, yaw: yawTowards(pos, { x: 0, y: 0 }) };
});

// --- Zones ------------------------------------------------------------------------------------
const brushes = [...boxes];
const zones: Zone[] = [teleportBelow(brushes, boundsOf(brushes).min.z, 'start', 512, 2048)];

// --- Theme ------------------------------------------------------------------------------------
const theme: Theme = {
	skyTop: 0x2f86e0,
	skyHorizon: 0xcfe6f7,
	skyBottom: 0xe6edf2,
	fogColor: 0xd8e7f2,
	fogNear: 3000,
	fogFar: 14000,
	sunColor: 0xfff0cc,
	sunIntensity: 0.95,
	sunDir: v3(0.36, 0.44, 0.82),
	ambientSky: 0x9ec0e8,
	ambientGround: 0x525864,
	ambientIntensity: 0.55,
	materials: {
		terrazzo: { color: 0x98a4b0, topColor: 0xa6b2be, noise: 0.14, noiseScale: 64, roughness: 0.4 },
		terrazzoDark: { color: 0x7a8694, topColor: 0x84909c, noise: 0.12, noiseScale: 64, roughness: 0.45 },
		walkway: { color: 0x58687a, topColor: 0x607082, noise: 0.12, noiseScale: 48, roughness: 0.6 },
		runner: { color: 0x44515f, topColor: 0x4c5a6a, noise: 0.16, noiseScale: 24, roughness: 0.9 },
		carpet: { color: 0x3b4f7a, topColor: 0x445a86, noise: 0.18, noiseScale: 24, roughness: 0.95 },
		tarmac: { color: 0x363b42, topColor: 0x3e444c, noise: 0.2, noiseScale: 128, roughness: 0.9 },
		taxiStripe: { color: 0xc89820, topColor: 0xd9a628, noise: 0.1, noiseScale: 32, roughness: 0.8 },
		curtainWall: { color: 0xbcc4cc, topColor: 0xb2bac2, noise: 0.08, noiseScale: 256, roughness: 0.6 },
		clerestory: { color: 0x9cc8e8, edgeColor: 0xd8e8f4, glass: true, opacity: 0.28, roughness: 0.1 },
		curtainHeader: { color: 0xa8b0b8, topColor: 0x9ea6ae, noise: 0.06, noiseScale: 256, roughness: 0.5 },
		pier: { color: 0x5c6670, topColor: 0x66707a, edgeColor: 0x3a424a, noise: 0.1, noiseScale: 128, roughness: 0.55 },
		curtainBand: { color: 0x48505a, topColor: 0x525a64, noise: 0.1, noiseScale: 64, roughness: 0.6 },
		coping: { color: 0x8e959c, topColor: 0x9aa1a8, edgeColor: 0x5a6066, noise: 0.06, noiseScale: 64, roughness: 0.4 },
		belly: { color: 0x8a949e, topColor: 0x96a0aa, noise: 0.06, noiseScale: 96, roughness: 0.35 },
		fuselage: { color: 0xa8b2be, topColor: 0xb2bcc6, edgeColor: 0x7a8490, noise: 0.04, noiseScale: 128, roughness: 0.3 },
		fuselageTop: { color: 0xa8b2be, topColor: 0xb2bcc6, noise: 0.05, noiseScale: 128, roughness: 0.3 },
		windowBand: { color: 0x263242, topColor: 0x263242, edgeColor: 0x4a6a8a, noise: 0.04, noiseScale: 32, roughness: 0.2 },
		cheatline: { color: 0x265496, topColor: 0x265496, noise: 0.03, noiseScale: 32, roughness: 0.25 },
		cockpit: { color: 0x263242, edgeColor: 0x6a8aaa, glass: true, opacity: 0.7, roughness: 0.1 },
		tailFin: { color: 0x265496, topColor: 0x2a5ca4, edgeColor: 0x1a3a6a, noise: 0.05, noiseScale: 64, roughness: 0.3 },
		wing: { color: 0x9aa4ae, topColor: 0xa4aeb8, edgeColor: 0x6a7480, noise: 0.06, noiseScale: 96, roughness: 0.3 },
		engine: { color: 0x9aa2aa, topColor: 0xaab2ba, edgeColor: 0x2a3038, noise: 0.06, noiseScale: 48, roughness: 0.3 },
		pylon: { color: 0x8a929a, topColor: 0x969ea6, noise: 0.06, noiseScale: 48, roughness: 0.35 },
		gear: { color: 0x3a3d40, topColor: 0x46494c, noise: 0.1, noiseScale: 24, roughness: 0.5 },
		seat: { color: 0x24396a, topColor: 0x2e4478, noise: 0.15, noiseScale: 16, roughness: 0.9 },
		galley: { color: 0xa8b0b8, topColor: 0xb2bac2, edgeColor: 0x7a8288, noise: 0.05, noiseScale: 32, roughness: 0.35 },
		jetwayFloor: { color: 0x8a9096, topColor: 0x6e747a, noise: 0.1, noiseScale: 48, roughness: 0.6 },
		jetwayGlass: { color: 0xa8d4f0, edgeColor: 0xd8e8f4, glass: true, opacity: 0.28, roughness: 0.1 },
		jetwayRoof: { color: 0xa0a8b0, topColor: 0x8e969e, edgeColor: 0x6a7076, noise: 0.08, noiseScale: 48, roughness: 0.45 },
		airstairs: { color: 0xa8b0b8, topColor: 0x7a8086, edgeColor: 0xd9a628, noise: 0.08, noiseScale: 32, roughness: 0.5 },
		loader: { color: 0xd8742a, topColor: 0x6f7a3a, edgeColor: 0x3a2a18, noise: 0.18, noiseScale: 24, roughness: 0.7 },
		facadeGlass: { color: 0x9fd0ee, edgeColor: 0xd8e8f4, glass: true, opacity: 0.28, roughness: 0.1 },
		facadeFrame: { color: 0x5c6670, topColor: 0x66707a, noise: 0.06, noiseScale: 64, roughness: 0.45 },
		mezzanine: { color: 0xbcc4cc, topColor: 0xb89466, edgeColor: 0x6a5a48, noise: 0.12, noiseScale: 48, roughness: 0.55 },
		column: { color: 0xc6beae, topColor: 0xbcb4a4, edgeColor: 0x9a9284, noise: 0.05, noiseScale: 128, roughness: 0.4 },
		glassRail: { color: 0xbfe2f6, edgeColor: 0xd8e8f4, glass: true, opacity: 0.25, roughness: 0.1 },
		escalator: { color: 0x7a8088, topColor: 0x9aa0a8, edgeColor: 0xe8b828, noise: 0.08, noiseScale: 24, roughness: 0.4 },
		skybridge: { color: 0xb4bac2, topColor: 0xb08c5e, edgeColor: 0x5a6066, noise: 0.1, noiseScale: 48, roughness: 0.5 },
		atcGlass: { color: 0x6fb2dc, edgeColor: 0xe0f2ff, glass: true, opacity: 0.4, roughness: 0.1 },
		atcRoof: { color: 0x3a424a, topColor: 0x46505a, noise: 0.06, noiseScale: 48, roughness: 0.5 },
		beacon: { color: 0xd8342a, topColor: 0xe89a3a, edgeColor: 0xe89a3a, noise: 0.05, noiseScale: 16, roughness: 0.3 },
		detector: { color: 0xa8aeb4, topColor: 0xb2b8be, edgeColor: 0x2ad07a, noise: 0.05, noiseScale: 32, roughness: 0.3 },
		detectorHead: { color: 0x1f3a6a, topColor: 0x2a4678, edgeColor: 0x2ad07a, noise: 0.05, noiseScale: 32, roughness: 0.35 },
		desk: { color: 0x6a7078, topColor: 0x2a2e34, edgeColor: 0xc8ccd0, noise: 0.08, noiseScale: 32, roughness: 0.5 },
		skylight: { color: 0xcfeaff, edgeColor: 0xd8e8f4, glass: true, opacity: 0.25, roughness: 0.05 },
		checkin: { color: 0xb07a3c, topColor: 0xb8a68a, edgeColor: 0x6a4420, noise: 0.12, noiseScale: 32, roughness: 0.6 },
		signPanel: { color: 0x22324e, topColor: 0x2a3a58, edgeColor: 0xffd060, noise: 0.06, noiseScale: 48, roughness: 0.45 },
		signage: { color: 0xc8202e, topColor: 0xd02a36, edgeColor: 0xe8e0d0, noise: 0.03, noiseScale: 32, roughness: 0.4 },
		carouselBase: { color: 0x5a6068, topColor: 0x8a9098, edgeColor: 0xc8ccd0, noise: 0.08, noiseScale: 32, roughness: 0.4 },
		carousel: { color: 0x2a2e34, topColor: 0x34383e, edgeColor: 0xe8b828, noise: 0.12, noiseScale: 16, roughness: 0.7 },
		suitcase: { color: 0xd8742a, topColor: 0xe08840, edgeColor: 0x6f7a3a, noise: 0.15, noiseScale: 24, roughness: 0.6 },
		boothWall: { color: 0x3e4650, topColor: 0x48505a, noise: 0.1, noiseScale: 48, roughness: 0.6 },
		boothRoof: { color: 0x5a626c, topColor: 0x6a727c, edgeColor: 0xe8b828, noise: 0.08, noiseScale: 48, roughness: 0.5 }
	},
	effects: [{ type: 'clouds', color: 0xfff4e4, count: 20, height: 3800 }]
};

export const infected_terminal: MapDef = {
	id: 'infected_terminal',
	title: 'Terminal',
	kind: 'infected',
	difficulty: 'easy',
	layout: 'open',
	cvars: { ...ZOMBIES_CVARS },
	spawn: spawns[0]!,
	spawns,
	brushes,
	zones,
	theme
};

/** Design data for the map tests. */
export const TERMINAL = {
	climbs,
	floor: FLOOR,
	ground,
	walls: { perimeter, trim: wallTrim, coping, facade },
	plane: {
		slab: cabinSlab,
		walls: cabinWalls,
		roof: fuselageRoof,
		seats,
		galleys,
		nose,
		tail,
		gear,
		wings: [...wingSouth, ...wingNorth],
		wingSouth,
		engines,
		doors: {
			frontSouth: { min: v3(frontDoor.x0, FUS.y0, CABIN_FLOOR), max: v3(frontDoor.x1, FUS.y0 + SKIN, CABIN_CEIL) },
			frontNorth: { min: v3(frontDoor.x0, FUS.y1 - SKIN, CABIN_FLOOR), max: v3(frontDoor.x1, FUS.y1, CABIN_CEIL) },
			rearSouth: { min: v3(rearDoor.x0, FUS.y0, CABIN_FLOOR), max: v3(rearDoor.x1, FUS.y0 + SKIN, CABIN_CEIL) },
			rearNorth: { min: v3(rearDoor.x0, FUS.y1 - SKIN, CABIN_FLOOR), max: v3(rearDoor.x1, FUS.y1, CABIN_CEIL) }
		},
		jetway: { floor: jetwayFloor, walls: jetwayWalls, roof: jetwayRoof, steps: jetwaySteps },
		airstairs,
		loaderCrates
	},
	mezzanine: { deck: mezzDeck, columns: mezzParts.slice(1), rails: mezzRails, eastStairs: mezzEastStairs, northStairs: mezzNorthStairs },
	skybridge: { deck: skybridge, rails: skyRails, columns: skyColumns },
	lounge: { deck: loungeDeck, columns: loungeParts.slice(1), rails: loungeRails, atc: atcCab, stairs: loungeStairs, crates: loungeCrates, counter: gateCounter, benches },
	security: { arches, desks, skylight, skylightColumns, checkin },
	baggage: { carousels, booth: { roof: boothRoof, pillars: boothParts.slice(1), walls: boothWalls, alcove: boothAlcove }, stairs: boothStairs, suitcases }
};
