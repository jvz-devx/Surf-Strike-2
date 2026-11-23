/**
 * infected_outpost — compact open map for the Infected mode. A sun-baked
 * desert radar outpost inside a fortified concrete compound.
 *
 * Arena 3200 × 3200 (x, y in [-1600, 1600]), ground at z = 0 (desert sand
 * with slate tarmac roads and concrete aprons linking the landmarks),
 * enclosed by 384-tall compound walls with buttress pilasters, a dark base
 * band, steel coping and two watch posts on top (up to 528) silhouetted
 * against the open sky. The highest climbable top is 240, so a full jump
 * (≈ 295) still stays ~90 under the wall top. An invisible curtain over the
 * wall footprint (400–1024) keeps lobbed knives inside the compound.
 *
 *   NE  Radar dome: a 160-tall concrete pedestal (the catwalk deck) with
 *       waist-high parapets, dark steel edge trim and a stepped foundation
 *       skirt, stair flights from the south and the west, and a stepped
 *       radar mast on gantry legs carrying a tiered dish with a beacon cap.
 *   SW  Ops bunker: interior room behind two 192-wide doorways (north and
 *       east) under dark lintel beams, corner pilasters, roof at 176 with
 *       crenellated parapets, an AC unit and a comms mast; reached by
 *       concrete stairs (west face) or a crate stack (east face, 40 per jump).
 *   SE  Loading dock (64) under a corrugated canopy, four short steps,
 *       shipping containers along 128-wide flank corridors, and a stacked
 *       upper container (240) climbed by crates on the lower container.
 *   NW  Watchtower: steel deck at 192 on four pillars, open underneath, with
 *       edge rails; stairs on its east side and a crate climb on its south side.
 *   C   Courtyard: raised fuel island with hazard curbs and two low stepped
 *       tanks on steel cradles (top 116: the radar dish reads over them), four
 *       jersey barriers, sandbag nooks (beacon hides), and a railed steel
 *       bridge at 176 from the bunker roof to the watchtower, reached from
 *       the courtyard by a crate climb.
 *
 * Brushes never intersect, and side-by-side brushes either touch or leave
 * more than 40 units between them (no player-trapping slots).
 */
import type { MapDef, Spawn, Theme, Zone } from './types.ts';
import type { Box3, BoxBrush } from './helpers.ts';
import { ZOMBIES_CVARS } from '../modes/index.ts';
import { boundsOf, teleportBelow, v3 } from './helpers.ts';
import { block, hall, stairs, yawTowards, type ClimbRoute } from './tag-helpers.ts';

/** Half size of the arena (inner faces of the compound walls). */
export const ARENA = 1600;
/** Compound wall thickness and top. */
const WALL_T = 64;
export const WALL_TOP = 384;
/** Top of the invisible knife curtain over the wall footprint. */
export const CURTAIN_TOP = 1024;
/** Steel coping on the wall tops (pilasters rise to it). */
const COPING_TOP = WALL_TOP + 16;

const boxes: BoxBrush[] = [];
const climbs: ClimbRoute[] = [];
const add = <T extends BoxBrush>(b: T): T => (boxes.push(b), b);
const addAll = (bs: BoxBrush[]): BoxBrush[] => (boxes.push(...bs), bs);
const area = (x0: number, x1: number, y0: number, y1: number, z: number): Box3 => ({ min: v3(x0, y0, z), max: v3(x1, y1, z) });

// --- Ground: sand with tarmac roads and concrete aprons ----------------------------
/**
 * Partition the arena floor (z −64..0) into non-overlapping tiles: every
 * painted rectangle (later ones win) over a sand base, merged into strips.
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
	// Concrete aprons under the landmarks.
	[256, 1280, 512, 1216, 'apron'], // radar dome
	[576, 1536, -1408, -512, 'apron'], // container yard and dock
	[-1216, -320, 320, 1088, 'apron'], // watchtower
	[-1408, -512, -1280, -448, 'apron'], // bunker
	// Tarmac: the courtyard plaza and the roads out of it.
	[-448, 448, -448, 448, 'tarmac'],
	[-640, -256, -896, -704, 'tarmac'], // bunker east door → plaza
	[-448, -256, -704, -448, 'tarmac'],
	[-1088, -832, -576, -256, 'tarmac'], // bunker north door → plaza
	[-1088, -448, -384, -256, 'tarmac'],
	[448, 832, 128, 384, 'tarmac'], // plaza → radar dome
	[640, 832, 384, 512, 'tarmac'],
	[448, 704, -960, -320, 'tarmac'], // plaza → loading dock
	[-448, -256, 448, 768, 'tarmac'], // plaza → watchtower
	[-832, -576, -576, 704, 'tarmac'], // under the bridge
	// Yellow lane stripes along the roads.
	[568, 584, -944, -464, 'stripe'],
	[464, 816, 280, 296, 'stripe'],
	[-712, -696, -560, 688, 'stripe'],
	// Bunker room floor.
	[-1248, -672, -1184, -608, 'bunkerFloor']
];
const ground = addAll(groundTiles(groundPaint, 'sand'));
/** The ground tile under (x, y). */
const groundAt = (x: number, y: number): BoxBrush =>
	ground.find((g) => x >= g.min.x && x < g.max.x && y >= g.min.y && y < g.max.y)!;
/** The ground tile under the centre of a brush standing on it. */
const groundUnder = (b: Box3): BoxBrush => groundAt((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2);

// --- Compound walls and their trim -----------------------------------------------------
const perimeter = [
	add(block(-ARENA - WALL_T, -ARENA, -ARENA - WALL_T, ARENA + WALL_T, -64, WALL_TOP, 'perimeter')),
	add(block(ARENA, ARENA + WALL_T, -ARENA - WALL_T, ARENA + WALL_T, -64, WALL_TOP, 'perimeter')),
	add(block(-ARENA, ARENA, -ARENA - WALL_T, -ARENA, -64, WALL_TOP, 'perimeter')),
	add(block(-ARENA, ARENA, ARENA, ARENA + WALL_T, -64, WALL_TOP, 'perimeter'))
];
/** Pilasters rise to the coping; the base band is too tall to jump onto. */
const PILASTER_TOP = COPING_TOP;
const PILASTER_D = 32;
const BAND_D = 16;
const BAND_TOP = 80;
const CORNER = 64;
/** Pilaster centres along each wall (the east wall skips the container corridor). */
const PILASTERS = [-1216, -704, -192, 192, 704, 1216];
const wallTrim: BoxBrush[] = [];
for (const side of ['W', 'E', 'S', 'N'] as const) {
	const cs = PILASTERS.filter((c) => !(side === 'E' && c === -704));
	// Spans along the wall between corner pilasters and the pilasters.
	const solid: Array<[number, number]> = [[-ARENA, -ARENA + CORNER], ...cs.map((c): [number, number] => [c - 48, c + 48]), [ARENA - CORNER, ARENA]];
	for (let i = 0; i < solid.length; i++) {
		const [a0, a1] = solid[i]!;
		const corner = i === 0 || i === solid.length - 1;
		const depth = corner ? CORNER : PILASTER_D;
		// Corner pilasters belong to the W and E walls only (one box per corner).
		if (!corner || side === 'W' || side === 'E') wallTrim.push(trimBox(side, a0, a1, depth, 0, PILASTER_TOP, 'buttress'));
		const next = solid[i + 1];
		if (next) wallTrim.push(trimBox(side, a1, next[0], BAND_D, 0, BAND_TOP, 'plinth'));
	}
}
/** A box against the inside of a wall: `a0..a1` along it, `depth` into the arena. */
function trimBox(side: 'W' | 'E' | 'S' | 'N', a0: number, a1: number, depth: number, z0: number, z1: number, mat: string): BoxBrush {
	// N/S corner spans are inside the W/E corner pilasters: trim them off.
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
// Steel coping along the wall tops, and two watch posts on the NW and SE corners.
const coping = perimeter.map((w) => add(block(w.min.x, w.max.x, w.min.y, w.max.y, WALL_TOP, COPING_TOP, 'coping')));
const watchPosts: BoxBrush[] = [];
for (const [sx, sy] of [
	[-1, 1],
	[1, -1]
] as const) {
	const x0 = sx < 0 ? -ARENA - WALL_T : ARENA - CORNER;
	const y0 = sy < 0 ? -ARENA - WALL_T : ARENA - CORNER;
	const cabin = add(block(x0, x0 + 128, y0, y0 + 128, COPING_TOP, 480, 'watchpost'));
	const roof = add(block(x0, x0 + 128, y0, y0 + 128, 480, 496, 'coping'));
	const lamp = add(block(x0 + 48, x0 + 80, y0 + 48, y0 + 80, 496, 528, 'beacon'));
	watchPosts.push(cabin, roof, lamp);
}
/**
 * Invisible knife curtain: the wall footprints from the coping top to
 * CURTAIN_TOP, cut flush around the watch posts. A knife lobbed high
 * rebounds off it instead of sailing over the low wall.
 */
function curtainBoxes(): BoxBrush[] {
	const zs = [...new Set([COPING_TOP, CURTAIN_TOP, ...watchPosts.flatMap((b) => [b.min.z, b.max.z])])]
		.filter((z) => z >= COPING_TOP && z <= CURTAIN_TOP)
		.sort((a, b) => a - b);
	const out: BoxBrush[] = [];
	for (let k = 0; k < zs.length - 1; k++) {
		const z0 = zs[k]!;
		const z1 = zs[k + 1]!;
		const holes = watchPosts.filter((b) => b.min.z < z1 && b.max.z > z0);
		for (const w of perimeter) {
			const inW = holes.filter((h) => h.min.x < w.max.x && h.max.x > w.min.x && h.min.y < w.max.y && h.max.y > w.min.y);
			const cut = (lo: number, hi: number, edges: number[]) => [...new Set([lo, hi, ...edges.filter((e) => e > lo && e < hi)])].sort((a, b) => a - b);
			const xs = cut(w.min.x, w.max.x, inW.flatMap((h) => [h.min.x, h.max.x]));
			const ys = cut(w.min.y, w.max.y, inW.flatMap((h) => [h.min.y, h.max.y]));
			const free = (x: number, y: number) => !inW.some((h) => x > h.min.x && x < h.max.x && y > h.min.y && y < h.max.y);
			// Strips along y per x column, merged where free cells run on.
			for (let i = 0; i < xs.length - 1; i++) {
				let start: number | null = null;
				for (let j = 0; j <= ys.length - 1; j++) {
					const ok = j < ys.length - 1 && free((xs[i]! + xs[i + 1]!) / 2, (ys[j]! + ys[j + 1]!) / 2);
					if (ok && start === null) start = ys[j]!;
					if (!ok && start !== null) {
						out.push(block(xs[i]!, xs[i + 1]!, start, ys[j]!, z0, z1, 'curtain'));
						start = null;
					}
				}
			}
		}
	}
	return out;
}
const curtain = addAll(curtainBoxes());

// --- NE: radar dome and catwalk -----------------------------------------------------
const DECK = 160;
const radarDeck = add(block(640, 1216, 576, 1152, 0, DECK, 'concrete'));
const radarSouthStairs = addAll(stairs({ foot: { x: 736, y: 256 }, dir: '+y', steps: 10, width: 128, rise: 16, run: 32, material: 'steel' }));
const radarWestStairs = addAll(stairs({ foot: { x: 320, y: 1056 }, dir: '+x', steps: 10, width: 128, rise: 16, run: 32, material: 'steel' }));
// Waist-high parapets (40) on the deck edges, leaving both stair landings open.
const radarParapets = [
	add(block(640, 1216, 1120, 1152, DECK, DECK + 40, 'rust')),
	add(block(1184, 1216, 576, 1120, DECK, DECK + 40, 'rust')),
	add(block(864, 1088, 576, 608, DECK, DECK + 40, 'rust')),
	add(block(640, 672, 640, 928, DECK, DECK + 40, 'rust'))
];
// Dark steel trim under the deck edges (16 out, hanging 16), leaving the stairs clear.
const radarTrim = [
	add(block(640, 672, 560, 576, DECK - 16, DECK, 'gantry')),
	add(block(800, 1216, 560, 576, DECK - 16, DECK, 'gantry')),
	add(block(1216, 1232, 560, 1168, DECK - 16, DECK, 'gantry')),
	add(block(672, 1216, 1152, 1168, DECK - 16, DECK, 'gantry')),
	add(block(624, 640, 576, 992, DECK - 16, DECK, 'gantry'))
];
// Stepped foundation skirt along the north and east faces (32: jumpable cover).
const radarSkirt = [add(block(704, 1280, 1152, 1216, 0, 32, 'concreteDark')), add(block(1216, 1280, 560, 1152, 0, 32, 'concreteDark'))];
// Stepped mast: a 16 plinth, a 160-tall mast on two gantry legs, and the dish
// assembly on top (front lip, dish, counterweight, upper tier, beacon cap).
const radarPlinth = add(block(832, 1024, 768, 960, DECK, DECK + 16, 'concrete'));
const radarMast = add(block(880, 976, 816, 912, DECK + 16, 336, 'steel'));
const radarLegs = [add(block(808, 832, 852, 876, DECK, 336, 'gantry')), add(block(1024, 1048, 852, 876, DECK, 336, 'gantry'))];
const radarDish = add(block(816, 1040, 840, 888, 336, 368, 'dish'));
const radarDishParts = [
	add(block(840, 1016, 824, 840, 336, 360, 'rust')),
	add(block(896, 960, 888, 904, 336, 352, 'rust')),
	add(block(848, 1008, 848, 880, 368, 384, 'dish'))
];
const radarBeacon = add(block(912, 944, 856, 872, 384, 416, 'beacon'));
// Clear landing areas on the deck (32 clear of the parapets and plinth).
const deckSouthLanding = area(704, 800, 576, 736, DECK);
const deckWestLanding = area(640, 800, 960, 1088, DECK);
climbs.push({ label: 'radar south stairs', how: 'step', surfaces: [groundUnder(radarSouthStairs[0]!), ...radarSouthStairs, deckSouthLanding] });
climbs.push({ label: 'radar west stairs', how: 'step', surfaces: [groundUnder(radarWestStairs[0]!), ...radarWestStairs, deckWestLanding] });
climbs.push({ label: 'radar deck → mast plinth', how: 'step', surfaces: [area(704, 832, 768, 848, DECK), area(832, 880, 768, 848, DECK + 16)] });

// --- SW: concrete ops bunker ---------------------------------------------------------
const BUNKER = { x0: -1280, x1: -640, y0: -1216, y1: -576 };
const BUNKER_WALL = 32;
const BUNKER_CEIL = 160;
const BUNKER_ROOF = 176;
const PARAPET = BUNKER_ROOF + 40;
const northDoor = { x0: -1056, x1: -864 };
const eastDoor = { y0: -896, y1: -704 };
const { x0: bx0, x1: bx1, y0: by0, y1: by1 } = BUNKER;
// South and north walls span the full width; west and east walls fit between them.
add(block(bx0, bx1, by0, by0 + BUNKER_WALL, 0, BUNKER_CEIL, 'concrete'));
add(block(bx0, northDoor.x0, by1 - BUNKER_WALL, by1, 0, BUNKER_CEIL, 'concrete'));
add(block(northDoor.x1, bx1, by1 - BUNKER_WALL, by1, 0, BUNKER_CEIL, 'concrete'));
add(block(bx0, bx0 + BUNKER_WALL, by0 + BUNKER_WALL, by1 - BUNKER_WALL, 0, BUNKER_CEIL, 'concrete'));
add(block(bx1 - BUNKER_WALL, bx1, by0 + BUNKER_WALL, eastDoor.y0, 0, BUNKER_CEIL, 'concrete'));
add(block(bx1 - BUNKER_WALL, bx1, eastDoor.y1, by1 - BUNKER_WALL, 0, BUNKER_CEIL, 'concrete'));
const bunkerRoof = add(block(bx0, bx1, by0, by1, BUNKER_CEIL, BUNKER_ROOF, 'concrete'));
// Corner pilasters (two 16-thick strips wrapping each corner, up past the parapets).
const bunkerPilasters = [
	add(block(bx0 - 16, bx0, by0 - 16, by0 + 48, 0, PARAPET, 'bunkerTrim')), // SW
	add(block(bx0, bx0 + 48, by0 - 16, by0, 0, PARAPET, 'bunkerTrim')),
	add(block(bx1, bx1 + 16, by0 - 16, by0 + 64, 0, PARAPET, 'bunkerTrim')), // SE (touches the crate stack)
	add(block(bx1 - 48, bx1, by0 - 16, by0, 0, PARAPET, 'bunkerTrim')),
	add(block(bx0 - 16, bx0, by1 - 48, by1 + 16, 0, PARAPET, 'bunkerTrim')), // NW
	add(block(bx0, bx0 + 48, by1, by1 + 16, 0, PARAPET, 'bunkerTrim')),
	add(block(bx1, bx1 + 16, by1 - 48, by1 + 16, 0, PARAPET, 'bunkerTrim')), // NE (under the bridge: north strip stops at it)
	add(block(bx1 - 48, bx1, by1, by1 + 16, 0, BUNKER_ROOF - 16, 'bunkerTrim'))
];
// Dark lintel beams over both doorways (outside, clear of the opening).
const lintels = [
	add(block(northDoor.x0 - 32, northDoor.x1 + 32, by1, by1 + 16, 136, BUNKER_ROOF, 'steelDark')),
	add(block(bx1, bx1 + 16, eastDoor.y0 - 32, eastDoor.y1 + 32, 136, BUNKER_ROOF, 'steelDark'))
];
// Crenellated roof parapets (40): merlons with ≥ 64 firing gaps; the stair, crate and bridge landings stay open.
const bunkerParapets = [
	// south edge
	add(block(-1280, -1184, by0, by0 + 32, BUNKER_ROOF, PARAPET, 'parapet')),
	add(block(-1088, -992, by0, by0 + 32, BUNKER_ROOF, PARAPET, 'parapet')),
	add(block(-896, -800, by0, by0 + 32, BUNKER_ROOF, PARAPET, 'parapet')),
	add(block(-736, -640, by0, by0 + 32, BUNKER_ROOF, PARAPET, 'parapet')),
	// west edge
	add(block(bx0, bx0 + 32, -1184, -1088, BUNKER_ROOF, PARAPET, 'parapet')),
	add(block(bx0, bx0 + 32, -992, -896, BUNKER_ROOF, PARAPET, 'parapet')),
	// north edge (west of the bridge landing)
	add(block(-1280, -1184, by1 - 32, by1, BUNKER_ROOF, PARAPET, 'parapet')),
	add(block(-1088, -992, by1 - 32, by1, BUNKER_ROOF, PARAPET, 'parapet')),
	add(block(-928, -832, by1 - 32, by1, BUNKER_ROOF, PARAPET, 'parapet')),
	// east edge (between the crate and the bridge landings)
	add(block(bx1 - 32, bx1, -960, -864, BUNKER_ROOF, PARAPET, 'parapet'))
];
const bunkerSandbags = add(block(-1088, -960, -960, -928, BUNKER_ROOF, BUNKER_ROOF + 40, 'sandbag'));
// Rooftop AC/generator unit (48: jumpable) with a comms mast.
const bunkerAc = add(block(-1184, -1088, -1120, -1056, BUNKER_ROOF, BUNKER_ROOF + 48, 'machinery'));
const bunkerAntenna = add(block(-1144, -1128, -1096, -1080, BUNKER_ROOF + 48, 400, 'steel'));
// Interior cover: the centre crate, a corner crate and a two-step crate pair.
const bunkerCrate = add(block(-1024, -896, -960, -832, 0, 48, 'crate'));
const bunkerCover = [
	add(block(-1184, -1120, -736, -672, 0, 48, 'crate')),
	add(block(-1184, -1120, -1120, -1056, 0, 40, 'crate')),
	add(block(-1120, -1056, -1120, -1056, 0, 80, 'crate'))
];
// Exterior stairs along the west face, climbing north onto the roof.
const bunkerStairs = addAll(stairs({ foot: { x: -1344, y: -1056 }, dir: '+y', steps: 11, width: 128, rise: 16, run: 32, material: 'concrete' }));
// Crate stack on the east face (40 per jump), climbing west.
const bunkerCrates = addAll(stairs({ foot: { x: -384, y: -1088 }, dir: '-x', steps: 4, width: 128, rise: 40, run: 64, material: 'crate' }));
const roofWestLanding = area(bx0, -1152, -800, -640, BUNKER_ROOF);
const roofEastLanding = area(-768, bx1, -1152, -1024, BUNKER_ROOF);
climbs.push({ label: 'bunker stairs', how: 'step', surfaces: [groundUnder(bunkerStairs[0]!), ...bunkerStairs, roofWestLanding] });
climbs.push({ label: 'bunker crate stack', how: 'jump', surfaces: [groundUnder(bunkerCrates[0]!), ...bunkerCrates, roofEastLanding] });
const doorways: Box3[] = [
	{ min: v3(northDoor.x0, by1 - BUNKER_WALL, 0), max: v3(northDoor.x1, by1, BUNKER_CEIL) },
	{ min: v3(bx1 - BUNKER_WALL, eastDoor.y0, 0), max: v3(bx1, eastDoor.y1, BUNKER_CEIL) }
];
const bunkerInterior: Box3 = {
	min: v3(bx0 + BUNKER_WALL, by0 + BUNKER_WALL, 0),
	max: v3(bx1 - BUNKER_WALL, by1 - BUNKER_WALL, BUNKER_CEIL)
};

// --- SE: loading dock and container yard ----------------------------------------------
const dock = add(block(704, 1216, -1088, -640, 0, 64, 'concrete'));
const dockStairs = addAll(stairs({ foot: { x: 576, y: -864 }, dir: '+x', steps: 4, width: 128, rise: 16, run: 32, material: 'steel' }));
// Corrugated canopy on four posts over the dock (clear of the stair landing).
const dockPosts = [
	add(block(768, 800, -1024, -992, 64, 224, 'steel')),
	add(block(1120, 1152, -1024, -992, 64, 224, 'steel')),
	add(block(768, 800, -736, -704, 64, 224, 'steel')),
	add(block(1120, 1152, -736, -704, 64, 224, 'steel'))
];
const dockCanopy = add(block(736, 1184, -1056, -672, 224, 240, 'corrugated'));
const dockCrates = [add(block(960, 1024, -880, -816, 64, 104, 'crate')), add(block(960, 1024, -880, -816, 104, 144, 'crate'))];
const dockLanding = area(704, 768, -960, -768, 64);
climbs.push({ label: 'loading dock steps', how: 'step', surfaces: [groundUnder(dockStairs[0]!), ...dockStairs, dockLanding] });
// Containers: south row (corridor 128 to the dock), east flank (corridors 128 to the
// dock and the wall), and one near the courtyard.
const containerSouth = add(block(704, 1216, -1344, -1216, 0, 128, 'containerOlive'));
const containerEast = add(block(1344, 1472, -1088, -576, 0, 128, 'containerTerra'));
add(block(448, 576, -640, -384, 0, 128, 'containerOlive'));
const upperContainer = add(block(960, 1216, -1344, -1216, 128, 240, 'containerTerra'));
const yardCrates = addAll(stairs({ foot: { x: 512, y: -1280 }, dir: '+x', steps: 3, width: 128, rise: 40, run: 64, material: 'crate' }));
const stackCrates = [add(block(832, 896, -1344, -1216, 128, 168, 'crate')), add(block(896, 960, -1344, -1216, 128, 208, 'crate'))];
const containerSouthLanding = area(704, 832, -1344, -1216, 128);
climbs.push({
	label: 'stacked container',
	how: 'jump',
	surfaces: [groundUnder(yardCrates[0]!), ...yardCrates, containerSouthLanding, ...stackCrates, upperContainer]
});
// Sandbag alcove north of the dock (a beacon hide off the flank).
const dockAlcove = [add(block(704, 832, -512, -480, 0, 48, 'sandbag')), add(block(800, 832, -480, -384, 0, 48, 'sandbag'))];

// --- NW: watchtower ---------------------------------------------------------------------
const TOWER = 192;
const towerParts = addAll(hall({ x0: -1152, x1: -768, y0: 640, y1: 1024 }, TOWER - 16, TOWER, 64, { roof: 'corrugated', pillar: 'steel' }, false));
const towerDeck = towerParts[0]!;
// Edge rails hanging outside the deck's north and west edges.
const towerRails = [add(block(-1152, -768, 1024, 1040, TOWER - 16, TOWER + 24, 'gantry')), add(block(-1168, -1152, 640, 1040, TOWER - 16, TOWER + 24, 'gantry'))];
const towerStairs = addAll(stairs({ foot: { x: -384, y: 832 }, dir: '-x', steps: 12, width: 128, rise: 16, run: 32, material: 'steel' }));
const towerCrates = addAll(stairs({ foot: { x: -960, y: 384 }, dir: '+y', steps: 4, width: 128, rise: 40, run: 64, material: 'crate' }));
climbs.push({ label: 'watchtower stairs', how: 'step', surfaces: [groundUnder(towerStairs[0]!), ...towerStairs, towerDeck] });
climbs.push({ label: 'watchtower crate climb', how: 'jump', surfaces: [groundUnder(towerCrates[0]!), ...towerCrates, towerDeck] });

// --- Centre: courtyard, fuel depot and the steel bridge ---------------------------------
// Fuel island: a concrete core ringed by hazard-striped curbs, all 32 high.
const island = add(block(-160, 160, -160, 160, 0, 32, 'concrete'));
const islandCurbs = [
	add(block(-192, 192, 160, 192, 0, 32, 'hazard')),
	add(block(-192, 192, -192, -160, 0, 32, 'hazard')),
	add(block(-192, -160, -160, 160, 0, 32, 'hazard')),
	add(block(160, 192, -160, 160, 0, 32, 'hazard'))
];
// Two low stepped tanks lying north–south (top 116, so the radar dish reads over
// them): a dark steel skid, a body, an upper step and a red cap strip, red end
// caps, dark steel saddle cradles at both ends, and a steel pipe bar between them.
const ISLAND_TOP = 32;
const fuelTanks: BoxBrush[] = [];
const fuelCradles: BoxBrush[] = [];
for (const cx of [-80, 80]) {
	fuelTanks.push(
		add(block(cx - 44, cx + 44, -104, 104, ISLAND_TOP, 44, 'steelDark')), // skid
		add(block(cx - 44, cx + 44, -88, 88, 44, 92, 'fuel')), // body
		add(block(cx - 44, cx + 44, -96, -88, 44, 92, 'fuelCap')), // end caps
		add(block(cx - 44, cx + 44, 88, 96, 44, 92, 'fuelCap')),
		add(block(cx - 32, cx + 32, -80, 80, 92, 108, 'fuel')), // upper step
		add(block(cx - 20, cx + 20, -72, 72, 108, 116, 'fuelCap')) // cap strip
	);
	for (const side of [-1, 1])
		for (const [y0, y1] of [
			[-88, -64],
			[64, 88]
		] as const) {
			const x0 = side < 0 ? cx - 56 : cx + 44;
			fuelCradles.push(add(block(x0, x0 + 12, y0, y1, ISLAND_TOP, 68, 'steelDark')));
		}
}
const fuelPipe = add(block(-36, 36, -8, 8, 72, 84, 'steel'));
climbs.push({ label: 'fuel island', how: 'jump', surfaces: [groundAt(0, 176), islandCurbs[0]!] });
const barriers = [
	add(block(-128, 128, 256, 288, 0, 40, 'jersey')),
	add(block(-128, 128, -288, -256, 0, 40, 'jersey')),
	add(block(256, 288, -128, 128, 0, 40, 'jersey')),
	add(block(-288, -256, -128, 128, 0, 40, 'jersey')),
	add(block(-320, -192, 480, 512, 0, 40, 'jersey'))
];
// Sandbag nooks off the plaza corners: low L-shaped cover to tuck a beacon behind.
const courtyardNooks = [
	add(block(320, 448, 288, 320, 0, 48, 'sandbag')),
	add(block(416, 448, 320, 416, 0, 48, 'sandbag')),
	add(block(-416, -288, -288, -256, 0, 48, 'sandbag')),
	add(block(-416, -384, -384, -288, 0, 48, 'sandbag')),
	add(block(256, 384, -480, -448, 0, 48, 'sandbag'))
];
// Bridge deck 160–176 from the bunker roof (176) north to the watchtower (192).
const bridge = add(block(-768, -640, -576, 704, BUNKER_ROOF - 16, BUNKER_ROOF, 'steel'));
const bridgeSupports = [add(block(-736, -672, -288, -224, 0, BUNKER_ROOF - 16, 'rust')), add(block(-736, -672, 288, 352, 0, BUNKER_ROOF - 16, 'rust'))];
// Truss side rails beside the deck (outside it), open where the crate climb lands.
const bridgeRails = [
	add(block(-784, -768, by1, 640, BUNKER_ROOF - 16, PARAPET, 'gantry')),
	add(block(-640, -624, by1 + 16, 0, BUNKER_ROOF - 16, PARAPET, 'gantry')),
	add(block(-640, -624, 256, 704, BUNKER_ROOF - 16, PARAPET, 'gantry'))
];
const bridgeCrates = addAll(stairs({ foot: { x: -384, y: 128 }, dir: '-x', steps: 4, width: 128, rise: 40, run: 64, material: 'crate' }));
const roofBridgeLanding = area(-768, bx1, -768, by1, BUNKER_ROOF);
climbs.push({ label: 'bunker roof → bridge → watchtower', how: 'step', surfaces: [roofBridgeLanding, bridge, towerDeck] });
climbs.push({ label: 'watchtower → bridge → bunker roof', how: 'step', surfaces: [towerDeck, bridge, roofBridgeLanding] });
climbs.push({ label: 'courtyard crates → bridge', how: 'jump', surfaces: [groundUnder(bridgeCrates[0]!), ...bridgeCrates, bridge] });

// --- Spawns (feet on the floor; the registry lifts them by SPAWN_CLEARANCE) ------------
/**
 * Spawn positions; each faces the centre unless a yaw override keeps its eye
 * line off a near wall (every spawn sees ≥ 256 clear ahead, ±15°).
 */
const SPAWN_XY: Array<[number, number]> = [
	// NE
	[1408, 1408],
	[448, 1408],
	[1408, 448],
	[512, 512],
	[1024, 320],
	// NW
	[-1408, 1408],
	[-512, 1408],
	[-1408, 320],
	[-1024, 1280],
	[-448, 448],
	// SW
	[-1408, -1408],
	[-800, -1056],
	[-448, -1408],
	[-448, -448],
	[-1408, -320],
	// SE
	[1408, -1408],
	[448, -1408],
	[1024, -448],
	[384, -896],
	[1408, -320]
];
/**
 * Yaw overrides by spawn index: the two south corner spawns look along the
 * wall corridors instead of into the bunker and container corners, and the
 * bunker spawn looks out through the north door.
 */
const SPAWN_YAW: Record<number, number> = { 10: 10, 11: 100, 15: 105 };
const spawns: Spawn[] = SPAWN_XY.map(([x, y], i) => {
	const pos = v3(x, y, 0);
	return { pos, yaw: SPAWN_YAW[i] ?? yawTowards(pos, { x: 0, y: 0 }) };
});

// --- Zones --------------------------------------------------------------------------
const brushes = [...boxes];
const zones: Zone[] = [teleportBelow(brushes, boundsOf(brushes).min.z, 'start', 512, 2048)];

// --- Theme --------------------------------------------------------------------------
const theme: Theme = {
	skyTop: 0x4f87c2,
	skyHorizon: 0xf2d7a4,
	skyBottom: 0xd8b783,
	fogColor: 0xe6cb98,
	fogNear: 2600,
	fogFar: 12500,
	sunColor: 0xffd48a,
	sunIntensity: 1.45,
	sunDir: v3(0.42, -0.32, 0.85),
	ambientSky: 0xf0d9b0,
	ambientGround: 0x9a7448,
	ambientIntensity: 0.7,
	// Clean solid colour fields with subtle noise (≤ 0.15) and no glowing seams:
	// warm sand, slate tarmac, cool limestone concrete, dark steel, rust accents.
	materials: {
		sand: { color: 0xc8a676, topColor: 0xd4b483, noise: 0.12, noiseScale: 256, roughness: 0.95 },
		tarmac: { color: 0x505257, topColor: 0x5b5d62, noise: 0.08, noiseScale: 128, roughness: 0.9 },
		apron: { color: 0x958d80, topColor: 0x9e968a, noise: 0.08, noiseScale: 192, roughness: 0.88 },
		stripe: { color: 0xd8a020, topColor: 0xe4b23a, noise: 0.06, noiseScale: 64, roughness: 0.8 },
		bunkerFloor: { color: 0x6c6a66, topColor: 0x77746e, noise: 0.08, noiseScale: 96, roughness: 0.9 },
		perimeter: { color: 0xb3a998, topColor: 0xbdb3a2, noise: 0.08, noiseScale: 256, roughness: 0.92 },
		buttress: { color: 0x9e9586, topColor: 0xa89f91, noise: 0.08, noiseScale: 128, roughness: 0.92 },
		plinth: { color: 0x6e675d, topColor: 0x787065, noise: 0.08, noiseScale: 96, roughness: 0.92 },
		coping: { color: 0x3e454e, topColor: 0x4a525c, edgeColor: 0x262b31, noise: 0.05, noiseScale: 64, roughness: 0.5 },
		watchpost: { color: 0xa89f91, topColor: 0x8f877b, edgeColor: 0x262b31, noise: 0.06, noiseScale: 64, roughness: 0.8 },
		beacon: { color: 0xd84a2a, topColor: 0xffb040, edgeColor: 0xffb040, noise: 0.04, noiseScale: 16, roughness: 0.3 },
		concrete: { color: 0xa89f91, topColor: 0xb4ab9d, noise: 0.08, noiseScale: 160, roughness: 0.88 },
		concreteDark: { color: 0x857d71, topColor: 0x8f877b, noise: 0.08, noiseScale: 128, roughness: 0.9 },
		bunkerTrim: { color: 0x8d857a, topColor: 0x978f83, edgeColor: 0x4d4840, noise: 0.07, noiseScale: 96, roughness: 0.88 },
		parapet: { color: 0x9c9385, topColor: 0xa89f91, noise: 0.08, noiseScale: 96, roughness: 0.88 },
		machinery: { color: 0x8e959c, topColor: 0x737a82, edgeColor: 0x3e454e, noise: 0.06, noiseScale: 32, roughness: 0.55 },
		steel: { color: 0x7c838b, topColor: 0x8a9199, edgeColor: 0x3e454e, noise: 0.06, noiseScale: 64, roughness: 0.45 },
		steelDark: { color: 0x3e454e, topColor: 0x48505a, edgeColor: 0x262b31, noise: 0.05, noiseScale: 64, roughness: 0.5 },
		gantry: { color: 0x3e454e, topColor: 0x48505a, edgeColor: 0x262b31, noise: 0.05, noiseScale: 48, roughness: 0.5 },
		rust: { color: 0x9e4b30, topColor: 0xa85638, noise: 0.12, noiseScale: 64, roughness: 0.75 },
		dish: { color: 0xe8e4da, topColor: 0xf2eee4, edgeColor: 0x9e4b30, noise: 0.04, noiseScale: 128, roughness: 0.4 },
		containerOlive: { color: 0x66703e, topColor: 0x5a6336, noise: 0.06, noiseScale: 32, roughness: 0.6 },
		containerTerra: { color: 0x9e4b30, topColor: 0x8a412a, noise: 0.06, noiseScale: 32, roughness: 0.6 },
		crate: { color: 0xa98250, topColor: 0xb8915e, edgeColor: 0x5e4122, noise: 0.12, noiseScale: 48, roughness: 0.85 },
		corrugated: { color: 0x8a9098, topColor: 0x9aa0a8, noise: 0.08, noiseScale: 32, roughness: 0.55 },
		sandbag: { color: 0xb89c6e, topColor: 0xc6aa7c, noise: 0.14, noiseScale: 32, roughness: 0.95 },
		jersey: { color: 0xc4bcae, topColor: 0xd0c8ba, edgeColor: 0xd8a020, noise: 0.06, noiseScale: 96, roughness: 0.9 },
		hazard: { color: 0xd8a020, topColor: 0x2e2c28, edgeColor: 0xe0b030, noise: 0.06, noiseScale: 48, roughness: 0.8 },
		fuel: { color: 0xd6d2c8, topColor: 0xc8c4ba, noise: 0.04, noiseScale: 128, roughness: 0.45 },
		fuelCap: { color: 0xb8402e, topColor: 0xc84a34, noise: 0.04, noiseScale: 64, roughness: 0.5 },
		/** Invisible knife curtain over the compound walls (collision only). */
		curtain: { color: 0xffffff, opacity: 0, noise: 0 }
	},
	effects: [{ type: 'clouds', color: 0xfff6e6, count: 18, height: 3600 }]
};

export const infected_outpost: MapDef = {
	id: 'infected_outpost',
	title: 'Outpost',
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
export const OUTPOST = {
	climbs,
	ground,
	/** Wall decoration: pilasters and base band on the inner faces, coping and watch posts on top; the invisible knife curtain above. */
	walls: { perimeter, trim: wallTrim, coping, watchPosts, curtain },
	radar: {
		deck: radarDeck,
		parapets: radarParapets,
		plinth: radarPlinth,
		mast: radarMast,
		dish: radarDish,
		legs: radarLegs,
		dishParts: radarDishParts,
		beacon: radarBeacon,
		trim: radarTrim,
		skirt: radarSkirt
	},
	bunker: {
		roof: bunkerRoof,
		interior: bunkerInterior,
		doorways,
		crate: bunkerCrate,
		cover: bunkerCover,
		sandbags: bunkerSandbags,
		parapets: bunkerParapets,
		pilasters: bunkerPilasters,
		lintels,
		ac: bunkerAc,
		antenna: bunkerAntenna
	},
	dock: { platform: dock, containerSouth, containerEast, upperContainer, canopy: dockCanopy, posts: dockPosts, crates: dockCrates, alcove: dockAlcove },
	watchtower: { deck: towerDeck, pillars: towerParts.slice(1), rails: towerRails },
	courtyard: { island, curbs: islandCurbs, fuelTanks, fuelCradles, fuelPipe, barriers, nooks: courtyardNooks, bridge, supports: bridgeSupports, rails: bridgeRails }
};
