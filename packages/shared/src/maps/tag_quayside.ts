/**
 * tag_quayside — open tag map. A sunny harbour town split by a canal.
 *
 * Arena 6144 × 6144 (x, y in [-3072, 3072]), ground at z = 0, enclosed by
 * 2048-tall sea walls. A 640-wide, 512-deep canal runs along X through the
 * middle (y in [-320, 320]); falling in teleports to a random spawn.
 *
 * South bank — the town:
 *   - Warehouse (256 tall), stairs on its north face.
 *   - Market hall: roof slab at 192 on six pillars, open underneath (chase
 *     loop), crate steps (32 each) on its east side.
 *   - Rooftop bhop line warehouse → market hall roof (3 blocks, gaps 160).
 *   - Clock tower (384 tall), long stairs on its west face; walk off its
 *     north edge onto the "tower slide" surf ramp (55°) that shoots west
 *     under the market hall.
 *   - Fountain plinth with a statue, LOS walls, pillars, a crate pair.
 *
 * North bank — the docks:
 *   - Dock house (320 tall), stairs on its south face; walk off its west edge
 *     into the "slipway", an open surf V (2 × 55° ramps) running 1600 west.
 *   - Net loft (256) and fish market (224) joined by a rooftop walkway; crate
 *     steps (32 each) up to the fish market.
 *   - Shipping containers, a crane gantry, a climbable container.
 *
 * Canal crossings: two bridges, a flat bhop line (2 pontoons, gaps 128) and a
 * raised one (2 pontoons 32 above the banks, gaps 128).
 */
import type { MapDef, Spawn, Theme, Zone } from './types.ts';
import type { BoxBrush, RampBrush } from './helpers.ts';
import { TAG_CVARS } from '../modes/index.ts';
import { boundsOf, ramp, surfV, teleportBelow, v3 } from './helpers.ts';
import { block, hall, pillar, stairs, yawTowards, type BhopChain, type ClimbRoute } from './tag-helpers.ts';

/** Half size of the arena (inner faces of the sea walls). */
export const ARENA = 3072;
/** Canal half width (y) and depth. */
const CANAL = 320;
const CANAL_DEPTH = 512;
/** Sea wall thickness and top. */
const WALL_T = 64;
export const WALL_TOP = 2048;
/** Top of the canal teleport trigger (well under every bridge and pontoon). */
const CANAL_TP_TOP = -160;

const boxes: BoxBrush[] = [];
const ramps: RampBrush[] = [];
const climbs: ClimbRoute[] = [];
const chains: BhopChain[] = [];
const add = <T extends BoxBrush>(b: T): T => (boxes.push(b), b);
const addAll = (bs: BoxBrush[]): BoxBrush[] => (boxes.push(...bs), bs);

// --- Ground, canal, sea walls -------------------------------------------------
const groundS = add(block(-ARENA, ARENA, -ARENA, -CANAL, -CANAL_DEPTH, 0, 'paving'));
const groundN = add(block(-ARENA, ARENA, CANAL, ARENA, -CANAL_DEPTH, 0, 'quay'));
add(block(-ARENA, ARENA, -CANAL, CANAL, -CANAL_DEPTH - 64, -CANAL_DEPTH, 'water'));
const W0 = -CANAL_DEPTH - 64;
add(block(-ARENA - WALL_T, -ARENA, -ARENA - WALL_T, ARENA + WALL_T, W0, WALL_TOP, 'seawall'));
add(block(ARENA, ARENA + WALL_T, -ARENA - WALL_T, ARENA + WALL_T, W0, WALL_TOP, 'seawall'));
add(block(-ARENA, ARENA, -ARENA - WALL_T, -ARENA, W0, WALL_TOP, 'seawall'));
add(block(-ARENA, ARENA, ARENA, ARENA + WALL_T, W0, WALL_TOP, 'seawall'));

// --- Canal crossings ------------------------------------------------------------
add(block(-2176, -1920, -CANAL, CANAL, -32, 0, 'planks'));
add(block(1280, 1536, -CANAL, CANAL, -32, 0, 'planks'));
// Flat pontoon line at x = 0: bank, gap 128, pontoon, gap 128, pontoon, gap 128, bank.
const pontoonA = [add(block(-64, 64, -192, -64, -96, 0, 'pontoon')), add(block(-64, 64, 64, 192, -96, 0, 'pontoon'))];
chains.push({ label: 'canal pontoons (flat)', nodes: [groundS, ...pontoonA, groundN] });
// Raised pontoon line at x = 2560: tops 32 above the banks.
const pontoonB = [add(block(2496, 2624, -192, -64, -96, 32, 'pontoon')), add(block(2496, 2624, 64, 192, -96, 32, 'pontoon'))];
chains.push({ label: 'canal pontoons (raised)', nodes: [groundS, ...pontoonB, groundN] });

// --- South bank: the town -------------------------------------------------------
// Warehouse with stairs climbing south (−y) onto its roof.
const warehouse = add(block(-2688, -1664, -2688, -1920, 0, 256, 'brick'));
const whStairs = addAll(stairs({ foot: { x: -2496, y: -1408 }, dir: '-y', steps: 16, width: 128, rise: 16, run: 32, material: 'stone' }));
climbs.push({ label: 'warehouse stairs', how: 'step', surfaces: [groundS, ...whStairs, warehouse] });

// Market hall: roof slab 176–192 on six 64 × 64 pillars.
const hallParts = addAll(hall({ x0: -640, x1: 640, y0: -2304, y1: -1536 }, 176, 192, 64, { roof: 'roof', pillar: 'stone' }));
const hallRoof = hallParts[0]!;
const hallCrates = addAll(stairs({ foot: { x: 1100, y: -1728 }, dir: '-x', steps: 5, width: 128, rise: 32, run: 92, material: 'crate' }));
climbs.push({ label: 'market hall crate steps', how: 'jump', surfaces: [groundS, ...hallCrates, hallRoof] });

// Rooftop bhop line warehouse (256) → hall roof (192), gaps 160, tops stepping down 16.
const roofHops = [
	add(block(-1504, -1376, -2176, -2048, 0, 240, 'chimney')),
	add(block(-1216, -1088, -2176, -2048, 0, 224, 'chimney')),
	add(block(-928, -800, -2176, -2048, 0, 208, 'chimney'))
];
chains.push({ label: 'rooftop hops warehouse → hall', nodes: [warehouse, ...roofHops, hallRoof] });

// Clock tower with a long stair run climbing east (+x) onto its roof.
const tower = add(block(1792, 2304, -2560, -2048, 0, 384, 'plaster'));
const towerStairs = addAll(stairs({ foot: { x: 1024, y: -2368 }, dir: '+x', steps: 24, width: 128, rise: 16, run: 32, material: 'stone' }));
climbs.push({ label: 'clock tower stairs', how: 'step', surfaces: [groundS, ...towerStairs, tower] });
// Tower slide: one 55° face towards the tower (−y), peak level at 256 along y = −1792,
// base resting on the ground. Walk off the tower's north edge, land on the face, surf west.
const towerSlide = ramp({ from: v3(2304, -1792, 256), to: v3(1152, -1792, 256), angle: 55, height: 256, side: 'left', material: 'slide' });
ramps.push(towerSlide);

// Plaza: fountain plinth (jump up 32) with a statue, LOS walls, pillars, crates.
const plinth = add(block(-160, 160, -1260, -940, 0, 32, 'stone'));
add(block(-48, 48, -1148, -1052, 32, 224, 'statue'));
climbs.push({ label: 'fountain plinth', how: 'jump', surfaces: [groundS, plinth] });
add(block(-1536, -1024, -1312, -1280, 0, 160, 'plaster'));
add(block(1600, 1632, -1280, -768, 0, 160, 'plaster'));
for (const [x, y] of [
	[-2048, -1088],
	[-640, -960],
	[512, -1088],
	[1088, -704],
	[2560, -1152]
] as const)
	add(pillar(x, y, 96, 0, 288, 'stone'));
const crateLow = add(block(2560, 2688, -768, -640, 0, 32, 'crate'));
const crateHigh = add(block(2560, 2688, -896, -768, 0, 64, 'crate'));
climbs.push({ label: 'crate pair', how: 'jump', surfaces: [groundS, crateLow, crateHigh] });

// --- North bank: the docks ------------------------------------------------------
// Dock house with stairs climbing north (+y); its west edge drops into the slipway.
const dockHouse = add(block(1536, 2560, 1792, 2560, 0, 320, 'timber'));
const dockStairs = addAll(stairs({ foot: { x: 1728, y: 1152 }, dir: '+y', steps: 20, width: 128, rise: 16, run: 32, material: 'planks' }));
climbs.push({ label: 'dock house stairs', how: 'step', surfaces: [groundN, ...dockStairs, dockHouse] });
// Slipway: open surf V along −x, centre line y = 2176, peaks 256 from the centre, base
// edges 128 apart (stop surfing and you drop into a walkable channel). Bases rest on z = 0.
const V_HALF = 256;
const V_GAP = 128;
const V_ANGLE = 55;
const V_HEIGHT = Math.round((V_HALF - V_GAP / 2) * Math.tan((V_ANGLE * Math.PI) / 180) * 1000) / 1000;
const slipway = surfV({ from: v3(1472, 2176, V_HEIGHT), to: v3(-128, 2176, V_HEIGHT), angle: V_ANGLE, halfWidth: V_HALF, gap: V_GAP, material: 'slide' });
ramps.push(...slipway);

// Net loft and fish market, joined by a rooftop walkway (16 down / 16 up).
const loft = add(block(-2688, -1920, 1920, 2688, 0, 256, 'timber'));
const loftStairs = addAll(stairs({ foot: { x: -2496, y: 1408 }, dir: '+y', steps: 16, width: 128, rise: 16, run: 32, material: 'planks' }));
climbs.push({ label: 'net loft stairs', how: 'step', surfaces: [groundN, ...loftStairs, loft] });
const fishMarket = add(block(-1536, -1024, 2304, 2816, 0, 224, 'brick'));
const walkway = add(block(-1920, -1536, 2432, 2560, 208, 240, 'planks'));
climbs.push({ label: 'loft → walkway → fish market', how: 'step', surfaces: [loft, walkway, fishMarket] });
climbs.push({ label: 'fish market → walkway → loft', how: 'step', surfaces: [fishMarket, walkway, loft] });
const fishCrates = addAll(stairs({ foot: { x: -1280, y: 1728 }, dir: '+y', steps: 6, width: 128, rise: 32, run: 96, material: 'crate' }));
climbs.push({ label: 'fish market crate steps', how: 'jump', surfaces: [groundN, ...fishCrates, fishMarket] });

// Shipping containers (128 tall: cover, not climbable) and one low one with a crate.
add(block(-2304, -2048, 640, 1152, 0, 128, 'containerRed'));
add(block(384, 896, 704, 960, 0, 128, 'containerBlue'));
add(block(2048, 2304, 704, 1216, 0, 128, 'containerRed'));
const lowContainer = add(block(-1024, -512, 960, 1216, 0, 96, 'containerBlue'));
const containerCrates = addAll(stairs({ foot: { x: -320, y: 1024 }, dir: '-x', steps: 2, width: 128, rise: 32, run: 96, material: 'crate' }));
climbs.push({ label: 'low container', how: 'jump', surfaces: [groundN, ...containerCrates, lowContainer] });

// Crane gantry: two legs and a beam (chase loop under it).
add(block(-256, -192, 1280, 1344, 0, 448, 'crane'));
add(block(192, 256, 1280, 1344, 0, 448, 'crane'));
add(block(-256, 256, 1280, 1344, 448, 512, 'crane'));

// --- Spawns ---------------------------------------------------------------------
const SPAWN_XY: Array<[number, number]> = [
	// South bank
	[-2816, -1280],
	[-1792, -704],
	[-704, -2688],
	[896, -2816],
	[2816, -2816],
	[2816, -1536],
	[1280, -576],
	[-384, -640],
	// North bank
	[-2816, 640],
	[-1536, 576],
	[-640, 1600],
	[0, 640],
	[1280, 1024],
	[2816, 640],
	[2816, 2816],
	[-704, 2816]
];
const spawns: Spawn[] = SPAWN_XY.map(([x, y]) => {
	const pos = v3(x, y, 0);
	return { pos, yaw: yawTowards(pos, { x: 0, y: 0 }) };
});

// --- Zones ----------------------------------------------------------------------
const brushes = [...boxes, ...ramps];
const zones: Zone[] = [
	// The canal: anything that falls in below the bridges and pontoons.
	{ type: 'teleport', min: v3(-ARENA, -CANAL, -CANAL_DEPTH + 8), max: v3(ARENA, CANAL, CANAL_TP_TOP), to: 'start' },
	// Safety net under the whole map.
	teleportBelow(brushes, boundsOf(brushes).min.z, 'start', 1024, 2048)
];

// --- Theme ----------------------------------------------------------------------
const theme: Theme = {
	skyTop: 0x2a7fd8,
	skyHorizon: 0xd2ecff,
	skyBottom: 0x9fc9e6,
	fogColor: 0xd6ebf7,
	fogNear: 4000,
	fogFar: 16000,
	sunColor: 0xfff0d0,
	sunIntensity: 1.3,
	sunDir: v3(-0.35, -0.45, 0.82),
	ambientSky: 0xc4e2ff,
	ambientGround: 0x8a7a62,
	ambientIntensity: 0.72,
	materials: {
		paving: { color: 0xb9ab95, topColor: 0xc9bca4, noise: 0.14, noiseScale: 128, roughness: 0.9 },
		quay: { color: 0x8f8a80, topColor: 0x9c8f7c, noise: 0.16, noiseScale: 160, roughness: 0.9 },
		water: { color: 0x1f6f8f, topColor: 0x2b86a8, noise: 0.22, noiseScale: 320, roughness: 0.2 },
		seawall: { color: 0x7d7a74, topColor: 0x8d8a84, noise: 0.2, noiseScale: 256, roughness: 0.95 },
		planks: { color: 0x8b6440, topColor: 0x9c7149, noise: 0.25, noiseScale: 48, roughness: 0.85 },
		pontoon: { color: 0x3a4a58, topColor: 0xe8c547, edgeColor: 0xffd84a, noise: 0.1, roughness: 0.7 },
		brick: { color: 0xa8553f, topColor: 0x6e6f73, noise: 0.22, noiseScale: 64, roughness: 0.9 },
		plaster: { color: 0xeee2c8, topColor: 0xb4583c, noise: 0.08, noiseScale: 192, roughness: 0.85 },
		roof: { color: 0x9d4a33, topColor: 0xc0623f, noise: 0.15, noiseScale: 96, roughness: 0.8 },
		timber: { color: 0x5f7f8f, topColor: 0x55606a, noise: 0.18, noiseScale: 96, roughness: 0.85 },
		stone: { color: 0xa9a59c, topColor: 0xbab6ad, noise: 0.16, noiseScale: 96, roughness: 0.9 },
		statue: { color: 0x5f9c8a, noise: 0.2, noiseScale: 48, roughness: 0.5 },
		chimney: { color: 0x8c4a3a, topColor: 0x4a4a4e, noise: 0.2, noiseScale: 48, roughness: 0.9 },
		crate: { color: 0xb08850, topColor: 0xc29a5e, edgeColor: 0x6b4a24, noise: 0.25, noiseScale: 32, roughness: 0.85 },
		containerRed: { color: 0xb8402e, topColor: 0x9a3626, noise: 0.12, noiseScale: 24, roughness: 0.6 },
		containerBlue: { color: 0x2f6aa8, topColor: 0x285b90, noise: 0.12, noiseScale: 24, roughness: 0.6 },
		crane: { color: 0xe0a92a, edgeColor: 0x3a3a3a, noise: 0.08, noiseScale: 64, roughness: 0.5 },
		slide: { color: 0x3fa8c8, topColor: 0x56c0de, edgeColor: 0xffffff, noise: 0.1, noiseScale: 128, roughness: 0.4 }
	},
	effects: [
		{ type: 'clouds', color: 0xffffff, count: 45, height: 3200 },
		{ type: 'clouds', color: 0xf2f7ff, count: 20, height: 4200 }
	]
};

export const tag_quayside: MapDef = {
	id: 'tag_quayside',
	title: 'Quayside',
	kind: 'tag',
	difficulty: 'easy',
	layout: 'open',
	cvars: { ...TAG_CVARS },
	spawn: spawns[0]!,
	spawns,
	brushes,
	zones,
	theme
};

/** Design data for the map tests. */
export const QUAYSIDE = {
	climbs,
	chains,
	surfRamps: { towerSlide, slipway },
	tower,
	dockHouse,
	ground: [groundS, groundN],
	canal: { y0: -CANAL, y1: CANAL, depth: CANAL_DEPTH, tpTop: CANAL_TP_TOP }
};
