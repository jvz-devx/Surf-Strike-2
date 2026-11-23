/**
 * infected_foundry — compact vertical map for the Infected mode. A steelworks
 * hall at dusk: poured-concrete mill floor with amber safety lanes, weathered
 * brick walls with gunmetal steel pilasters and a warm glazed clerestory band,
 * roof trusses overhead, and a molten slag trench down the middle.
 *
 * Arena 3072 × 3072 (x, y in [-1536, 1536]), mill floor at z = 0, enclosed
 * by 1024-tall hall walls. Every climbable top is at or under 192 (the
 * gantry); roofs, the upper container and the furnace stacks are sheer.
 *
 *   C   Molten trench: x in [-192, 192], y in [-768, 768], slag at -128
 *       with a teleport trigger at -112..-32. Three 192-wide footbridges
 *       (y = -480, 0, 480) cross it at floor level; both ends (|y| > 800)
 *       stay open floor. Waist-high hazard railings line the edges.
 *   C   Overhead crane gantry (192, y in [160, 288]): spans from the
 *       control room (W) to the furnace catwalk (E), one 16 step up at
 *       each end, girder rails along both sides, a hook over the slag.
 *   W   Smelter control room (160): an elevated room on two concrete piers
 *       (open underneath), glass viewing bays facing the trench, a rear
 *       door off a 10 × 16 concrete stair, north and south doorways (the
 *       south one over a 4 × 40 crate climb) and the gantry opening east.
 *   E   Blast furnace: twin stepped stacks (to 480) with glowing vents,
 *       wrapped by a continuous 160 catwalk ring; stairs from the south and
 *       the north plus the gantry from the west.
 *   S   Coil yards: SW container (128) with crate climbs at both ends,
 *       steel coils and a hydraulic press; SE container (128) with two
 *       ground crate climbs and a stacked upper container (256) on its
 *       east half as roof cover; a slag ladle car between the yards.
 *   N   Pipe gallery: a covered tunnel (192 walkway, 128 clear, side door)
 *       under a 144 maintenance deck; stairs at its west end, crates east.
 *
 * Brushes never intersect, and side-by-side brushes either touch or leave
 * more than 40 units between them (no player-trapping slots).
 */
import type { MapDef, Spawn, Theme, Zone } from './types.ts';
import type { Box3, BoxBrush } from './helpers.ts';
import { ZOMBIES_CVARS } from '../modes/index.ts';
import { teleportBelow, v3 } from './helpers.ts';
import { block, stairs, yawTowards, type ClimbRoute } from './tag-helpers.ts';

/** Half size of the arena (inner faces of the hall walls). */
export const ARENA = 1536;
const WALL_T = 64;
export const WALL_TOP = 1024;

const boxes: BoxBrush[] = [];
const climbs: ClimbRoute[] = [];
const add = <T extends BoxBrush>(b: T): T => (boxes.push(b), b);
const addAll = (bs: BoxBrush[]): BoxBrush[] => (boxes.push(...bs), bs);
const area = (x0: number, x1: number, y0: number, y1: number, z: number): Box3 => ({ min: v3(x0, y0, z), max: v3(x1, y1, z) });

// --- The molten trench (its footprint is cut out of the mill floor) ---------------
export const TRENCH = { x0: -192, x1: 192, y0: -768, y1: 768 };
const SLAG_Z = -128;
/** Slag teleport trigger: well under the footbridges (bottoms at -16), above the slag. */
const SLAG_TP = { z0: -112, z1: -32 };
const HOLE = '#hole';

// --- Ground: mill floor with painted lanes, cut open over the trench ---------------
/**
 * Partition the arena floor (z −64..0) into non-overlapping tiles: every
 * painted rectangle (later ones win) over the base, merged into strips;
 * the HOLE paint leaves no tile.
 */
function groundTiles(paint: Array<[number, number, number, number, string]>, base: string): BoxBrush[] {
	const xs = [...new Set([-ARENA, ARENA, ...paint.flatMap(([x0, x1]) => [x0, x1])])].filter((x) => x >= -ARENA && x <= ARENA).sort((a, b) => a - b);
	const ys = [...new Set([-ARENA, ARENA, ...paint.flatMap(([, , y0, y1]) => [y0, y1])])].filter((y) => y >= -ARENA && y <= ARENA).sort((a, b) => a - b);
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
			if (mat === HOLE) continue;
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
const groundPaint: Array<[number, number, number, number, string]> = [
	// Steel-plate aprons under the coil yards and the pipe gallery.
	[-1472, -320, -1472, -896, 'yardFloor'],
	[320, 1472, -1472, -896, 'yardFloor'],
	[-768, 768, 1024, 1344, 'gratingFloor'],
	// Amber safety walkways along both sides of the trench and across its ends.
	[-288, -256, -832, 832, 'safetyLane'],
	[256, 288, -832, 832, 'safetyLane'],
	[-256, 256, 832, 864, 'safetyLane'],
	[-256, 256, -864, -832, 'safetyLane'],
	// Glowing slag runnel from the furnace stacks to the trench.
	[288, 704, 352, 416, 'slagRunnel'],
	// Ladle car rail track across the south plaza.
	[-448, 448, -1232, -1216, 'rail'],
	[-448, 448, -1088, -1072, 'rail'],
	// The trench itself: no floor.
	[TRENCH.x0, TRENCH.x1, TRENCH.y0, TRENCH.y1, HOLE]
];
const ground = addAll(groundTiles(groundPaint, 'millFloor'));
/** The ground tile under (x, y). */
const groundAt = (x: number, y: number): BoxBrush => ground.find((g) => x >= g.min.x && x < g.max.x && y >= g.min.y && y < g.max.y)!;
/** The ground tile under the centre of a brush standing on it. */
const groundUnder = (b: Box3): BoxBrush => groundAt((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2);

// Trench: slag pool, liner walls under the floor tiles around it, the trigger.
const slag = add(block(TRENCH.x0, TRENCH.x1, TRENCH.y0, TRENCH.y1, SLAG_Z - 32, SLAG_Z, 'slag'));
const trenchLiners = [
	add(block(TRENCH.x0 - 32, TRENCH.x0, TRENCH.y0 - 32, TRENCH.y1 + 32, SLAG_Z - 32, -64, 'trenchWall')),
	add(block(TRENCH.x1, TRENCH.x1 + 32, TRENCH.y0 - 32, TRENCH.y1 + 32, SLAG_Z - 32, -64, 'trenchWall')),
	add(block(TRENCH.x0, TRENCH.x1, TRENCH.y1, TRENCH.y1 + 32, SLAG_Z - 32, -64, 'trenchWall')),
	add(block(TRENCH.x0, TRENCH.x1, TRENCH.y0 - 32, TRENCH.y0, SLAG_Z - 32, -64, 'trenchWall'))
];
const slagZone: Zone = {
	type: 'teleport',
	min: v3(TRENCH.x0, TRENCH.y0, SLAG_TP.z0),
	max: v3(TRENCH.x1, TRENCH.y1, SLAG_TP.z1),
	to: 'start'
};

// Footbridges: 192-wide grated decks (16 thick) with hazard rails on both sides.
export const BRIDGE_Y = [-480, 0, 480];
const BRIDGE_HW = 96;
const bridges = BRIDGE_Y.map((yc) => add(block(TRENCH.x0, TRENCH.x1, yc - BRIDGE_HW, yc + BRIDGE_HW, -16, 0, 'bridgeDeck')));
const bridgeRails = BRIDGE_Y.flatMap((yc) => [
	add(block(TRENCH.x0, TRENCH.x1, yc + BRIDGE_HW, yc + BRIDGE_HW + 16, -16, 40, 'hazardRail')),
	add(block(TRENCH.x0, TRENCH.x1, yc - BRIDGE_HW - 16, yc - BRIDGE_HW, -16, 40, 'hazardRail'))
]);
// Waist-high railings along the trench edges (open at each bridge) and across both ends.
const edgeSpans: Array<[number, number]> = [
	[TRENCH.y0, BRIDGE_Y[0]! - BRIDGE_HW],
	[BRIDGE_Y[0]! + BRIDGE_HW, BRIDGE_Y[1]! - BRIDGE_HW],
	[BRIDGE_Y[1]! + BRIDGE_HW, BRIDGE_Y[2]! - BRIDGE_HW],
	[BRIDGE_Y[2]! + BRIDGE_HW, TRENCH.y1]
];
const trenchRails = [
	...edgeSpans.flatMap(([y0, y1]) => [
		add(block(TRENCH.x0 - 32, TRENCH.x0, y0, y1, 0, 40, 'hazardRail')),
		add(block(TRENCH.x1, TRENCH.x1 + 32, y0, y1, 0, 40, 'hazardRail'))
	]),
	add(block(TRENCH.x0 - 32, TRENCH.x1 + 32, TRENCH.y1, TRENCH.y1 + 32, 0, 40, 'hazardRail')),
	add(block(TRENCH.x0 - 32, TRENCH.x1 + 32, TRENCH.y0 - 32, TRENCH.y0, 0, 40, 'hazardRail'))
];

// --- Hall walls and their architecture ---------------------------------------------
const perimeter = [
	add(block(-ARENA - WALL_T, -ARENA, -ARENA - WALL_T, ARENA + WALL_T, -64, WALL_TOP, 'perimeter')),
	add(block(ARENA, ARENA + WALL_T, -ARENA - WALL_T, ARENA + WALL_T, -64, WALL_TOP, 'perimeter')),
	add(block(-ARENA, ARENA, -ARENA - WALL_T, -ARENA, -64, WALL_TOP, 'perimeter')),
	add(block(-ARENA, ARENA, ARENA, ARENA + WALL_T, -64, WALL_TOP, 'perimeter'))
];
const PILASTER_TOP = WALL_TOP + 16;
const PILASTER_D = 32;
const CORNER = 64;
/** Concrete dado along the foot of the walls: too tall to jump onto. */
const DADO_D = 16;
const DADO_TOP = 64;
/** Glowing clerestory window band high up between the pilasters. */
const CLERESTORY = { d: 8, z0: 576, z1: 704 };
/** Pilaster centres along each wall; the roof trusses spring from the W/E ones. */
export const PILASTERS = [-1024, -512, 0, 512, 1024];
const wallTrim: BoxBrush[] = [];
for (const side of ['W', 'E', 'S', 'N'] as const) {
	const solid: Array<[number, number]> = [[-ARENA, -ARENA + CORNER], ...PILASTERS.map((c): [number, number] => [c - 48, c + 48]), [ARENA - CORNER, ARENA]];
	for (let i = 0; i < solid.length; i++) {
		const [a0, a1] = solid[i]!;
		const corner = i === 0 || i === solid.length - 1;
		const depth = corner ? CORNER : PILASTER_D;
		// Corner pilasters belong to the W and E walls only (one box per corner).
		if (!corner || side === 'W' || side === 'E') wallTrim.push(trimBox(side, a0, a1, depth, 0, PILASTER_TOP, 'pilaster'));
		const next = solid[i + 1];
		if (next) {
			wallTrim.push(trimBox(side, a1, next[0], DADO_D, 0, DADO_TOP, 'dado'));
			wallTrim.push(trimBox(side, a1, next[0], CLERESTORY.d, CLERESTORY.z0, CLERESTORY.z1, 'clerestory'));
		}
	}
}
/** A box against the inside of a wall: `a0..a1` along it, `depth` into the arena. */
function trimBox(side: 'W' | 'E' | 'S' | 'N', a0: number, a1: number, depth: number, z0: number, z1: number, mat: string): BoxBrush {
	if (side === 'S' || side === 'N') {
		a0 = Math.max(a0, -ARENA + CORNER);
		a1 = Math.min(a1, ARENA - CORNER);
	}
	if (side === 'W') return block(-ARENA, -ARENA + depth, a0, a1, z0, z1, mat);
	if (side === 'E') return block(ARENA - depth, ARENA, a0, a1, z0, z1, mat);
	if (side === 'S') return block(a0, a1, -ARENA, -ARENA + depth, z0, z1, mat);
	return block(a0, a1, ARENA - depth, ARENA, z0, z1, mat);
}
addAll(wallTrim.filter((b) => b.max.x > b.min.x && b.max.y > b.min.y));
const coping = perimeter.map((w) => add(block(w.min.x, w.max.x, w.min.y, w.max.y, WALL_TOP, WALL_TOP + 16, 'coping')));
/** Roof trusses: a bottom chord between each W/E pilaster pair, with a top chord on posts. */
const TRUSS = { z0: 864, z1: 896, top0: 960, top1: 976 };
const trusses: BoxBrush[] = [];
for (const c of PILASTERS) {
	const x0 = -ARENA + PILASTER_D;
	const x1 = ARENA - PILASTER_D;
	trusses.push(add(block(x0, x1, c - 24, c + 24, TRUSS.z0, TRUSS.z1, 'truss')));
	for (const px of [-1024, -512, 0, 512, 1024]) trusses.push(add(block(px - 12, px + 12, c - 12, c + 12, TRUSS.z1, TRUSS.top0, 'truss')));
	trusses.push(add(block(x0, x1, c - 16, c + 16, TRUSS.top0, TRUSS.top1, 'truss')));
}

// --- Overhead crane gantry (192) -----------------------------------------------------
const GANTRY = { x0: -480, x1: 480, y0: 160, y1: 288, z: 192 };
const gantry = add(block(GANTRY.x0, GANTRY.x1, GANTRY.y0, GANTRY.y1, GANTRY.z - 16, GANTRY.z, 'gantryDeck'));
const gantryStepW = add(block(-512, GANTRY.x0, GANTRY.y0, GANTRY.y1, 144, 176, 'gantryDeck'));
const gantryStepE = add(block(GANTRY.x1, 512, GANTRY.y0, GANTRY.y1, 144, 176, 'gantryDeck'));
const gantryRails = [
	add(block(-512, 512, GANTRY.y0 - 16, GANTRY.y0, 176, 232, 'craneGirder')),
	add(block(-512, 512, GANTRY.y1, GANTRY.y1 + 16, 176, 232, 'craneGirder'))
];
const gantryLegs = [
	add(block(-416, -384, GANTRY.y0, GANTRY.y0 + 32, 0, 176, 'craneLeg')),
	add(block(-416, -384, GANTRY.y1 - 32, GANTRY.y1, 0, 176, 'craneLeg')),
	add(block(384, 416, GANTRY.y0, GANTRY.y0 + 32, 0, 176, 'craneLeg')),
	add(block(384, 416, GANTRY.y1 - 32, GANTRY.y1, 0, 176, 'craneLeg'))
];
// The crane hook hangs over the slag between the middle and north bridges.
const craneHook = [add(block(-16, 16, 208, 240, 96, 176, 'craneCable')), add(block(-40, 40, 192, 256, 48, 96, 'craneHook'))];

// --- W: smelter control room (160) ---------------------------------------------------
const ROOM = { x0: -896, x1: -512, y0: 64, y1: 448, floor: 160, ceil: 288 };
const roomSlab = add(block(ROOM.x0, ROOM.x1, ROOM.y0, 512, 144, ROOM.floor, 'controlFloor'));
const roomPiers = [add(block(ROOM.x0, ROOM.x0 + 32, 96, 416, 0, 144, 'pier')), add(block(ROOM.x1 - 32, ROOM.x1, 96, 416, 0, 144, 'pier'))];
const rearDoor = { y0: 192, y1: 320 };
const southDoor = { x0: -784, x1: -624 };
const northDoor = { x0: -832, x1: -672 };
const glassOpen = { y0: GANTRY.y0, y1: GANTRY.y1 };
const F = ROOM.floor;
const C = ROOM.ceil;
const roomWalls = [
	// West wall with the rear door.
	add(block(ROOM.x0, ROOM.x0 + 32, ROOM.y0, rearDoor.y0, F, C, 'brick')),
	add(block(ROOM.x0, ROOM.x0 + 32, rearDoor.y1, ROOM.y1, F, C, 'brick')),
	// South wall with its doorway (between the west wall and the east bays).
	add(block(ROOM.x0 + 32, southDoor.x0, ROOM.y0, ROOM.y0 + 32, F, C, 'brick')),
	add(block(southDoor.x1, ROOM.x1 - 32, ROOM.y0, ROOM.y0 + 32, F, C, 'brick')),
	// North wall with its doorway.
	add(block(ROOM.x0 + 32, northDoor.x0, ROOM.y1 - 32, ROOM.y1, F, C, 'brick')),
	add(block(northDoor.x1, ROOM.x1 - 32, ROOM.y1 - 32, ROOM.y1, F, C, 'brick'))
];
// East viewing bays: a 40 sill under smoked glass, open where the gantry steps in.
const roomBays = [
	add(block(ROOM.x1 - 32, ROOM.x1, ROOM.y0, glassOpen.y0, F, F + 40, 'sill')),
	add(block(ROOM.x1 - 32, ROOM.x1, ROOM.y0, glassOpen.y0, F + 40, C, 'glass')),
	add(block(ROOM.x1 - 32, ROOM.x1, glassOpen.y1, ROOM.y1, F, F + 40, 'sill')),
	add(block(ROOM.x1 - 32, ROOM.x1, glassOpen.y1, ROOM.y1, F + 40, C, 'glass'))
];
const roomRoof = add(block(ROOM.x0, ROOM.x1, ROOM.y0, ROOM.y1, C, C + 16, 'roofSteel'));
const roomConsole = add(block(-656, -592, ROOM.y1 - 64, ROOM.y1 - 32, F, F + 40, 'console'));
// Rear concrete stairs (10 × 16) up to the west door; crate climb (4 × 40) to the south door.
const roomStairs = addAll(stairs({ foot: { x: ROOM.x0 - 320, y: 256 }, dir: '+x', steps: 10, width: 128, rise: 16, run: 32, material: 'concreteStairs' }));
const roomCrates = addAll(stairs({ foot: { x: -704, y: -192 }, dir: '+y', steps: 4, width: 128, rise: 40, run: 64, material: 'crate' }));
const roomRearLanding = area(ROOM.x0, ROOM.x0 + 128, rearDoor.y0, rearDoor.y1, F);
const roomSouthLanding = area(-768, -640, ROOM.y0, ROOM.y0 + 160, F);
const roomEastLanding = area(ROOM.x1 - 128, ROOM.x1, glassOpen.y0, glassOpen.y1, F);
const catwalkWestLanding = area(512, 640, GANTRY.y0, GANTRY.y1, 160);
climbs.push({ label: 'control room rear stairs', how: 'step', surfaces: [groundUnder(roomStairs[0]!), ...roomStairs, roomRearLanding] });
climbs.push({ label: 'control room crate climb', how: 'jump', surfaces: [groundUnder(roomCrates[0]!), ...roomCrates, roomSouthLanding] });
climbs.push({ label: 'control room → gantry → furnace catwalk', how: 'step', surfaces: [roomEastLanding, gantryStepW, gantry, gantryStepE, catwalkWestLanding] });
climbs.push({ label: 'furnace catwalk → gantry → control room', how: 'step', surfaces: [catwalkWestLanding, gantryStepE, gantry, gantryStepW, roomEastLanding] });
const roomDoorways: Box3[] = [
	{ min: v3(ROOM.x0, rearDoor.y0, F), max: v3(ROOM.x0 + 32, rearDoor.y1, C) },
	{ min: v3(southDoor.x0, ROOM.y0, F), max: v3(southDoor.x1, ROOM.y0 + 32, C) },
	{ min: v3(northDoor.x0, ROOM.y1 - 32, F), max: v3(northDoor.x1, ROOM.y1, C) },
	{ min: v3(ROOM.x1 - 32, glassOpen.y0, F), max: v3(ROOM.x1, glassOpen.y1, C) }
];

// --- E: blast furnace and the catwalk ring (160) ---------------------------------------
const CAT = 160;
const stackYs: Array<[number, number]> = [
	[128, 320],
	[448, 640]
];
const furnaceStacks = stackYs.map(([y0, y1]) => add(block(704, 928, y0, y1, 0, 320, 'furnace')));
const furnaceUpper = stackYs.map(([y0, y1]) => add(block(736, 896, y0 + 32, y1 - 32, 320, 448, 'furnaceUpper')));
const furnaceCaps = stackYs.map(([y0, y1]) => add(block(768, 864, y0 + 64, y1 - 64, 448, 480, 'furnaceCap')));
const furnaceVents = stackYs.flatMap(([y0, y1]) => [
	add(block(688, 704, y0 + 48, y1 - 48, 16, 112, 'furnaceVent')),
	add(block(928, 944, y0 + 48, y1 - 48, 16, 112, 'furnaceVent'))
]);
const catwalk = {
	w: add(block(512, 704, 0, 768, CAT - 16, CAT, 'catwalk')),
	e: add(block(928, 1120, 0, 768, CAT - 16, CAT, 'catwalk')),
	s: add(block(704, 928, 0, 128, CAT - 16, CAT, 'catwalk')),
	m: add(block(704, 928, 320, 448, CAT - 16, CAT, 'catwalk')),
	n: add(block(704, 928, 640, 768, CAT - 16, CAT, 'catwalk'))
};
const catwalkPosts = [
	add(block(512, 544, 0, 32, 0, CAT - 16, 'steelBeam')),
	add(block(512, 544, 368, 400, 0, CAT - 16, 'steelBeam')),
	add(block(512, 544, 736, 768, 0, CAT - 16, 'steelBeam')),
	add(block(1088, 1120, 0, 32, 0, CAT - 16, 'steelBeam')),
	add(block(1088, 1120, 368, 400, 0, CAT - 16, 'steelBeam')),
	add(block(1088, 1120, 736, 768, 0, CAT - 16, 'steelBeam'))
];
const catwalkRail = add(block(1104, 1120, 32, 736, CAT, CAT + 40, 'hazardRail'));
const furnaceSouthStairs = addAll(stairs({ foot: { x: 816, y: -320 }, dir: '+y', steps: 10, width: 128, rise: 16, run: 32, material: 'steelStairs' }));
const furnaceNorthStairs = addAll(stairs({ foot: { x: 1024, y: 1088 }, dir: '-y', steps: 10, width: 128, rise: 16, run: 32, material: 'steelStairs' }));
climbs.push({ label: 'furnace south stairs', how: 'step', surfaces: [groundUnder(furnaceSouthStairs[0]!), ...furnaceSouthStairs, area(752, 880, 0, 96, CAT)] });
climbs.push({ label: 'furnace north stairs', how: 'step', surfaces: [groundUnder(furnaceNorthStairs[0]!), ...furnaceNorthStairs, area(960, 1088, 640, 768, CAT)] });
/** The catwalk ring inside the east rail. */
const catwalkEastLane = area(928, 1104, 0, 768, CAT);
climbs.push({ label: 'furnace catwalk loop', how: 'step', surfaces: [catwalk.w, catwalk.s, catwalkEastLane, catwalk.n, catwalk.w] });

// --- N: pipe gallery and maintenance deck (144) ----------------------------------------
const TUN = { x0: -768, x1: 768, y0: 1024, y1: 1344, ceil: 128, deck: 144 };
const sideDoor = { x0: -96, x1: 96 };
const tunnelWalls = [
	add(block(TUN.x0, sideDoor.x0, TUN.y0, TUN.y0 + 32, 0, TUN.ceil, 'brick')),
	add(block(sideDoor.x1, TUN.x1, TUN.y0, TUN.y0 + 32, 0, TUN.ceil, 'brick')),
	add(block(TUN.x0, TUN.x1, TUN.y1 - 32, TUN.y1, 0, TUN.ceil, 'brick'))
];
const tunnelDeck = add(block(TUN.x0, TUN.x1, TUN.y0, TUN.y1, TUN.ceil, TUN.deck, 'deckPlate'));
const tunnelPipes = add(block(TUN.x0, TUN.x1, TUN.y1 - 96, TUN.y1 - 32, 0, 48, 'pipe'));
const deckRail = add(block(TUN.x0, TUN.x1, TUN.y1 - 32, TUN.y1, TUN.deck, TUN.deck + 40, 'hazardRail'));
const deckVents = [add(block(-288, -224, 1184, 1248, TUN.deck, TUN.deck + 48, 'pipeHot')), add(block(224, 288, 1184, 1248, TUN.deck, TUN.deck + 48, 'pipeHot'))];
const tunnelStairs = addAll(stairs({ foot: { x: -512, y: TUN.y0 - 9 * 32 }, dir: '+y', steps: 9, width: 128, rise: 16, run: 32, material: 'steelStairs' }));
/**
 * Crate climb at the deck's east end: 160 wide (x 352..512), so the lane past
 * the NE trench railing corner (x 224) stays 128 wide, and its east side
 * touches the catwalk post corner (x 512) instead of leaving a slot.
 */
const tunnelCrates = addAll(stairs({ foot: { x: 432, y: TUN.y0 - 4 * 64 }, dir: '+y', steps: 4, width: 160, rise: 36, run: 64, material: 'crate' }));
climbs.push({ label: 'pipe deck stairs', how: 'step', surfaces: [groundUnder(tunnelStairs[0]!), ...tunnelStairs, area(-576, -448, TUN.y0, TUN.y0 + 96, TUN.deck)] });
climbs.push({ label: 'pipe deck crates', how: 'jump', surfaces: [groundUnder(tunnelCrates[0]!), ...tunnelCrates, area(352, 512, TUN.y0, TUN.y0 + 96, TUN.deck)] });
/** Walkway through the tunnel (between the south wall and the pipe bundle). */
const tunnelWalkway: Box3 = { min: v3(TUN.x0, TUN.y0 + 32, 0), max: v3(TUN.x1, TUN.y1 - 96, TUN.ceil) };

// --- SW: coil yard ---------------------------------------------------------------------
const containerSW = add(block(-1216, -768, -1280, -1152, 0, 128, 'containerRust'));
const swWestCrates = addAll(stairs({ foot: { x: -1408, y: -1216 }, dir: '+x', steps: 3, width: 128, rise: 40, run: 64, material: 'crate' }));
const swEastCrates = addAll(stairs({ foot: { x: -576, y: -1216 }, dir: '-x', steps: 3, width: 128, rise: 40, run: 64, material: 'crate' }));
climbs.push({ label: 'SW container west crates', how: 'jump', surfaces: [groundUnder(swWestCrates[0]!), ...swWestCrates, area(-1216, -1088, -1280, -1152, 128)] });
climbs.push({ label: 'SW container east crates', how: 'jump', surfaces: [groundUnder(swEastCrates[0]!), ...swEastCrates, area(-896, -768, -1280, -1152, 128)] });
const swCoils = [add(block(-1152, -1056, -1024, -928, 0, 48, 'coil')), add(block(-992, -896, -1024, -928, 0, 48, 'coil')), add(block(-1152, -1056, -800, -704, 0, 48, 'coil'))];
const press = {
	base: add(block(-512, -384, -1152, -1024, 0, 32, 'pressBase')),
	column: add(block(-480, -416, -1120, -1056, 32, 224, 'press')),
	head: add(block(-512, -384, -1152, -1024, 224, 256, 'pressHead'))
};

// --- SE: container stack (the upper container is a sheer sightline blocker on the roof) --
const containerSE = add(block(640, 1280, -1280, -1152, 0, 128, 'containerBlue'));
const containerTop = add(block(1024, 1280, -1280, -1152, 128, 256, 'containerRust'));
const seWestCrates = addAll(stairs({ foot: { x: 448, y: -1216 }, dir: '+x', steps: 3, width: 128, rise: 40, run: 64, material: 'crate' }));
const seNorthCrates = addAll(stairs({ foot: { x: 768, y: -960 }, dir: '-y', steps: 3, width: 128, rise: 40, run: 64, material: 'crate' }));
const seRoof = area(640, 832, -1280, -1152, 128);
climbs.push({ label: 'SE container west crates', how: 'jump', surfaces: [groundUnder(seWestCrates[0]!), ...seWestCrates, seRoof] });
climbs.push({ label: 'SE container north crates', how: 'jump', surfaces: [groundUnder(seNorthCrates[0]!), ...seNorthCrates, area(704, 832, -1280, -1152, 128)] });
const seCoils = [add(block(1152, 1248, -1024, -928, 0, 48, 'coil')), add(block(1312, 1408, -1024, -928, 0, 48, 'coil'))];

// --- Mill floor cover ---------------------------------------------------------------------
const ladle = { car: add(block(-96, 96, -1216, -1088, 0, 48, 'ladle')), bowl: add(block(-64, 64, -1184, -1120, 48, 112, 'ladleBowl')) };
const ingots = [
	add(block(-448, -384, -352, -224, 0, 40, 'ingot')),
	add(block(384, 448, -352, -224, 0, 40, 'ingot')),
	add(block(-384, -320, 576, 704, 0, 40, 'ingot')),
	add(block(-1152, -1056, 704, 800, 0, 48, 'coil')),
	add(block(-1152, -1056, 864, 960, 0, 48, 'coil')),
	add(block(1280, 1376, 448, 544, 0, 48, 'coil'))
];

// --- Spawns (feet on the floor; the registry lifts them by SPAWN_CLEARANCE) --------------
/** Floor positions; each faces the arena centre unless it names its own look-at point. */
const SPAWN_XY: Array<[number, number] | [number, number, { x: number; y: number }]> = [
	// NE
	[1280, 1280],
	[1280, 896],
	[1312, 256],
	[352, 640],
	// Behind the pipe gallery: look along the flank lane, not into the gallery wall.
	[768, 1408, { x: 0, y: 1408 }],
	// NW
	[-1280, 1280],
	[-768, 1408, { x: 0, y: 1408 }],
	[-320, 448],
	[-1056, 640],
	[-1344, 384],
	// SW
	// South alley behind the containers: look along it, not into the container side.
	[-1088, -1408, { x: 0, y: -1408 }],
	[-1344, -768],
	[-320, -640],
	[-704, -384],
	[-1344, -256],
	// SE
	[1088, -1408, { x: 0, y: -1408 }],
	[1344, -640],
	[320, -640],
	[576, -896],
	[1344, -192]
];
const spawns: Spawn[] = SPAWN_XY.map(([x, y, look]) => {
	const pos = v3(x, y, 0);
	return { pos, yaw: yawTowards(pos, look ?? { x: 0, y: 0 }) };
});

// --- Zones --------------------------------------------------------------------------
const brushes = [...boxes];
const zones: Zone[] = [slagZone, teleportBelow(brushes, -256, 'start', 512, 2048)];

// --- Theme --------------------------------------------------------------------------
const theme: Theme = {
	skyTop: 0x1b1a36,
	skyHorizon: 0xb8582a,
	skyBottom: 0x2a1c18,
	fogColor: 0x2c3442,
	fogNear: 1800,
	fogFar: 9000,
	sunColor: 0xffaa62,
	sunIntensity: 1.15,
	sunDir: v3(-0.62, 0.38, 0.42),
	ambientSky: 0x6f8eb8,
	ambientGround: 0x524034,
	ambientIntensity: 0.85,
	materials: {
		millFloor: { color: 0x66625e, topColor: 0x706c66, noise: 0.2, noiseScale: 160, roughness: 0.92 },
		yardFloor: { color: 0x5a5c62, topColor: 0x64666c, noise: 0.16, noiseScale: 64, roughness: 0.7 },
		gratingFloor: { color: 0x525760, topColor: 0x5c626b, edgeColor: 0x3a3e45, noise: 0.18, noiseScale: 24, roughness: 0.6 },
		safetyLane: { color: 0xd48c28, topColor: 0xd48c28, edgeColor: 0xe09c38, noise: 0.06, noiseScale: 32, roughness: 0.85 },
		slagRunnel: { color: 0xff5a12, topColor: 0xff741e, edgeColor: 0xffbe3b, noise: 0.08, noiseScale: 48, roughness: 0.4 },
		rail: { color: 0x6a5a4c, topColor: 0x8a8c90, noise: 0.1, noiseScale: 32, roughness: 0.4 },
		perimeter: { color: 0x64544c, topColor: 0x726258, noise: 0.16, noiseScale: 96, roughness: 0.95 },
		pilaster: { color: 0x4d5968, topColor: 0x5d6b7c, edgeColor: 0x343c46, noise: 0.08, noiseScale: 64, roughness: 0.5 },
		dado: { color: 0x7a766f, topColor: 0x86817a, noise: 0.16, noiseScale: 96, roughness: 0.9 },
		clerestory: { color: 0xd9944a, topColor: 0xd9944a, edgeColor: 0x403832, noise: 0.04, noiseScale: 32, roughness: 0.3 },
		coping: { color: 0x4d5968, topColor: 0x5d6b7c, edgeColor: 0x343c46, noise: 0.06, noiseScale: 64, roughness: 0.5 },
		truss: { color: 0x4d5968, topColor: 0x5d6b7c, edgeColor: 0x343c46, noise: 0.08, noiseScale: 48, roughness: 0.5 },
		slag: { color: 0xff5a12, topColor: 0xff741e, edgeColor: 0xffa030, seamColor: 0xffbe3b, noise: 0.12, noiseScale: 64, roughness: 0.3 },
		trenchWall: { color: 0x4a4440, topColor: 0x544c46, edgeColor: 0x2e2a28, noise: 0.16, noiseScale: 48, roughness: 0.9 },
		bridgeDeck: { color: 0x4d5968, topColor: 0x5d6b7c, edgeColor: 0x343c46, noise: 0.14, noiseScale: 16, roughness: 0.55 },
		hazardRail: { color: 0xe0ad2b, topColor: 0xecbc3c, edgeColor: 0x3a3020, noise: 0.08, noiseScale: 24, roughness: 0.7 },
		gantryDeck: { color: 0x4d5968, topColor: 0x5d6b7c, edgeColor: 0x343c46, noise: 0.14, noiseScale: 16, roughness: 0.55 },
		craneGirder: { color: 0xe0ad2b, topColor: 0xecbc3c, edgeColor: 0x3a3020, noise: 0.08, noiseScale: 48, roughness: 0.6 },
		craneLeg: { color: 0xe0ad2b, topColor: 0xecbc3c, edgeColor: 0x3a3020, noise: 0.08, noiseScale: 48, roughness: 0.6 },
		craneCable: { color: 0x3e444c, topColor: 0x4a5058, noise: 0.05, noiseScale: 16, roughness: 0.4 },
		craneHook: { color: 0x5d6b7c, topColor: 0xecbc3c, edgeColor: 0xe0ad2b, noise: 0.08, noiseScale: 16, roughness: 0.4 },
		controlFloor: { color: 0x5c6470, topColor: 0x6a727e, noise: 0.1, noiseScale: 64, roughness: 0.7 },
		pier: { color: 0x86807a, topColor: 0x908a82, noise: 0.16, noiseScale: 96, roughness: 0.92 },
		brick: { color: 0x7a5a4c, topColor: 0x846456, edgeColor: 0x4a3a32, noise: 0.18, noiseScale: 48, roughness: 0.95 },
		sill: { color: 0x4d5968, topColor: 0x5d6b7c, edgeColor: 0x343c46, noise: 0.08, noiseScale: 32, roughness: 0.55 },
		glass: { color: 0x6a7c8c, topColor: 0x7a8c9c, edgeColor: 0xffb060, glass: true, opacity: 0.32, noise: 0.02, noiseScale: 256, roughness: 0.1 },
		roofSteel: { color: 0x4d5968, topColor: 0x5d6b7c, edgeColor: 0x343c46, noise: 0.1, noiseScale: 32, roughness: 0.6 },
		console: { color: 0x2c3034, topColor: 0x1a2a30, edgeColor: 0x4ae0ff, noise: 0.08, noiseScale: 16, roughness: 0.4 },
		concreteStairs: { color: 0x7c766e, topColor: 0x8a847a, noise: 0.2, noiseScale: 64, roughness: 0.9 },
		steelStairs: { color: 0x4d5968, topColor: 0x5d6b7c, edgeColor: 0xe0ad2b, noise: 0.12, noiseScale: 16, roughness: 0.55 },
		crate: { color: 0x7a5a36, topColor: 0x8a6a40, edgeColor: 0x3a2814, noise: 0.25, noiseScale: 32, roughness: 0.85 },
		furnace: { color: 0x48525e, topColor: 0x525c68, edgeColor: 0x2e343c, noise: 0.06, noiseScale: 64, roughness: 0.6 },
		furnaceUpper: { color: 0x48525e, topColor: 0x525c68, edgeColor: 0x2e343c, noise: 0.06, noiseScale: 48, roughness: 0.6 },
		furnaceCap: { color: 0xff7a1a, topColor: 0xff7a1a, edgeColor: 0xffc454, noise: 0.04, noiseScale: 24, roughness: 0.3 },
		furnaceVent: { color: 0xff7a1a, topColor: 0xff7a1a, edgeColor: 0xffc454, noise: 0.04, noiseScale: 16, roughness: 0.3 },
		catwalk: { color: 0x4d5968, topColor: 0x5d6b7c, edgeColor: 0xe0ad2b, noise: 0.14, noiseScale: 16, roughness: 0.55 },
		steelBeam: { color: 0x4d5968, topColor: 0x5d6b7c, edgeColor: 0x343c46, noise: 0.08, noiseScale: 48, roughness: 0.5 },
		deckPlate: { color: 0x4d5968, topColor: 0x5d6b7c, edgeColor: 0x343c46, noise: 0.14, noiseScale: 24, roughness: 0.6 },
		pipe: { color: 0x5a6a72, topColor: 0x6a7a82, edgeColor: 0x2a3236, noise: 0.1, noiseScale: 32, roughness: 0.45 },
		pipeHot: { color: 0x7a5040, topColor: 0x86584a, edgeColor: 0xff7a1a, noise: 0.1, noiseScale: 24, roughness: 0.5 },
		containerRust: { color: 0x8a3e22, topColor: 0x7a3620, noise: 0.18, noiseScale: 24, roughness: 0.7 },
		containerBlue: { color: 0x2e4a66, topColor: 0x28405a, noise: 0.14, noiseScale: 24, roughness: 0.65 },
		coil: { color: 0x7a7e84, topColor: 0x8c9096, edgeColor: 0x3a3c40, noise: 0.12, noiseScale: 16, roughness: 0.35 },
		pressBase: { color: 0x4d5968, topColor: 0xd48c28, edgeColor: 0x343c46, noise: 0.12, noiseScale: 32, roughness: 0.6 },
		press: { color: 0x8a8e94, topColor: 0x9a9ea4, edgeColor: 0x3a3c40, noise: 0.08, noiseScale: 32, roughness: 0.35 },
		pressHead: { color: 0xe0ad2b, topColor: 0x5d6b7c, edgeColor: 0x3a3020, noise: 0.08, noiseScale: 32, roughness: 0.6 },
		ingot: { color: 0x6a6c70, topColor: 0x7e8084, edgeColor: 0x2c2e32, noise: 0.15, noiseScale: 16, roughness: 0.4 },
		ladle: { color: 0x48525e, topColor: 0x525c68, edgeColor: 0x2e343c, noise: 0.12, noiseScale: 32, roughness: 0.8 },
		ladleBowl: { color: 0xff5a12, topColor: 0xff741e, edgeColor: 0x2e343c, seamColor: 0xffbe3b, noise: 0.12, noiseScale: 24, roughness: 0.4 }
	},
	effects: [{ type: 'embers', color: 0xff8c2a, count: 140, area: { min: v3(-1500, -1500, 0), max: v3(1500, 1500, 560) } }]
};

export const infected_foundry: MapDef = {
	id: 'infected_foundry',
	title: 'Foundry',
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
export const FOUNDRY = {
	climbs,
	ground,
	walls: { perimeter, trim: wallTrim, coping, trusses },
	trench: { slag, liners: trenchLiners, zone: slagZone, bridges, bridgeRails, rails: trenchRails },
	gantry: { deck: gantry, steps: [gantryStepW, gantryStepE], rails: gantryRails, legs: gantryLegs, hook: craneHook },
	control: {
		slab: roomSlab,
		piers: roomPiers,
		walls: roomWalls,
		bays: roomBays,
		roof: roomRoof,
		console: roomConsole,
		doorways: roomDoorways,
		interior: { min: v3(ROOM.x0 + 32, ROOM.y0 + 32, F), max: v3(ROOM.x1 - 32, ROOM.y1 - 32, C) } as Box3
	},
	furnace: { stacks: furnaceStacks, upper: furnaceUpper, caps: furnaceCaps, vents: furnaceVents, catwalk, posts: catwalkPosts, rail: catwalkRail },
	gallery: { walls: tunnelWalls, deck: tunnelDeck, pipes: tunnelPipes, rail: deckRail, vents: deckVents, walkway: tunnelWalkway, sideDoor },
	yards: { containerSW, swCoils, press, containerSE, containerTop, seCoils },
	cover: { ladle, ingots }
};
