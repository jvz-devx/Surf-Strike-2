/**
 * zombies_lowtide — Zombies map (docs/modes.md#zombies). An abandoned seaside
 * town at dusk in thick sea fog; the team escapes from the beach car park to
 * a rescue boat at the end of the harbour pier. Ground at z = 0, the route
 * runs roughly +x, then north, then east and north again (~7000 units):
 *
 *   A  Beach car park (start)    x [-320, 1024]   y [-640, 640]   wrecked cars, kiosk
 *   B  Main street               x [1024, 3328]   y [-320, 320]   house rows with side
 *      pockets (zombie spawns), a barricade chokepoint (gap 160) → checkpoint 1, gate 1 at the alley mouth
 *   C  Alley (north)             x [3072, 3328]   y [320, 1536]   256 wide, two crates
 *      → checkpoint 2 and gate 2 at its exit
 *   D  Promenade + creek bridge  promenade y [1536, 1792], bridge x [3072, 3328]
 *      over the creek y [1792, 2304] (falling in: teleport, −1 HP) → checkpoint 3 on the bridge, gate 3 at its end
 *   E  Cannery yard              x [2304, 4864]   y [2304, 3840]  warehouse, containers,
 *      a loading dock with steps → checkpoint 4 and gate 4 at the harbour road
 *   F  Harbour road + pier       road y [3072, 3584] east to x 6464, pier x [5888, 6400]
 *      north into the basin → checkpoint 5 on the road, gate 5 at the pier base, evac (end zone) at its tip
 *
 * The zombie route (`zombies.path`) follows the street centre lines; the
 * straight line between consecutive waypoints is clear for the hull (map
 * tests walk it). Spawn areas sit in side pockets and corners next to it.
 */
import type { MapDef, Spawn, Theme, Zone, ZombieGate, ZombieSpawnZone } from './types.ts';
import type { BoxBrush } from './helpers.ts';
import { boundsOf, teleportBelow, v3 } from './helpers.ts';
import { block, pillar, stairs } from './tag-helpers.ts';

const boxes: BoxBrush[] = [];
const add = (b: BoxBrush): BoxBrush => (boxes.push(b), b);
const addAll = (bs: BoxBrush[]): void => void boxes.push(...bs);

/** Railings and low walls: too tall to jump (57) or crouch-jump (~66) over. */
const RAIL = 72;
/** Creek and basin: water surface top, and the fall-out trigger above it. */
const WATER_TOP = -384;
const FALL_TP_TOP = -160;

// --- A: beach car park ----------------------------------------------------------
add(block(-320, 1024, -640, 640, -64, 0, 'asphalt'));
add(block(-384, -320, -704, 704, 0, 320, 'seawall'));
add(block(-320, 1024, -704, -640, 0, 320, 'brick'));
add(block(-320, 1024, 640, 704, 0, 320, 'brick'));
for (const [x0, y0, x1, y1] of [
	[352, 256, 544, 352],
	[576, -400, 768, -304],
	[96, -352, 288, -256],
	[800, 384, 992, 480]
] as const)
	add(block(x0, x1, y0, y1, 0, 56, 'car'));
add(block(480, 608, -224, -128, 0, 112, 'plaster')); // kiosk
add(pillar(0, 224, 12, 0, 192, 'lamp'));
add(pillar(704, -192, 12, 0, 192, 'lamp'));

// --- B: main street ---------------------------------------------------------------
add(block(1024, 3328, -320, 320, -64, 0, 'asphalt'));
// Side pockets (zombie spawns): floors and back walls.
const POCKETS_S = [1536, 2432];
const POCKETS_N = [1920, 2560];
for (const x of POCKETS_S) {
	add(block(x, x + 128, -512, -320, -64, 0, 'pavement'));
	add(block(x, x + 128, -704, -512, 0, 288, 'brick'));
}
for (const x of POCKETS_N) {
	add(block(x, x + 128, 320, 512, -64, 0, 'pavement'));
	add(block(x, x + 128, 512, 704, 0, 288, 'brick'));
}
// South house row (y −704..−320) between the pockets.
add(block(1024, 1536, -704, -320, 0, 288, 'plaster'));
add(block(1664, 2432, -704, -320, 0, 352, 'brick'));
add(block(2560, 3328, -704, -320, 0, 320, 'plaster'));
// North house row (y 320..704), then the tall corner building at the alley.
add(block(1024, 1920, 320, 704, 0, 320, 'brick'));
add(block(2048, 2560, 320, 704, 0, 288, 'plaster'));
add(block(2688, 2880, 320, 704, 0, 352, 'timber'));
add(block(2880, 3072, 320, 1088, 0, 384, 'brick'));
// East end of the street and the alley's east side.
add(block(3328, 3520, -704, 1088, 0, 384, 'plaster'));
// Street props: an abandoned car, a dumpster, a barricade with a 160-wide gap.
add(block(1704, 1896, 112, 208, 0, 56, 'car'));
add(block(2240, 2336, -300, -236, 0, 64, 'container'));
add(block(2600, 2632, -320, -80, 0, 48, 'crate'));
add(block(2600, 2632, 80, 320, 0, 48, 'crate'));
add(pillar(1300, 290, 12, 0, 192, 'lamp'));
add(pillar(2200, -290, 12, 0, 192, 'lamp'));

// --- C: alley -------------------------------------------------------------------
add(block(3072, 3328, 320, 1536, -64, 0, 'cobble'));
add(block(3072, 3152, 768, 848, 0, 48, 'crate'));
add(block(3248, 3328, 1088, 1168, 0, 48, 'crate'));

// --- D: promenade, creek, bridge --------------------------------------------------
// Promenade floor is deep: its north side is the creek bank.
add(block(2304, 4864, 1536, 1792, WATER_TOP, 0, 'pavement'));
add(block(2304, 3072, 1088, 1536, 0, 320, 'timber'));
add(block(3328, 4864, 1088, 1536, 0, 320, 'brick'));
add(block(2304, 3072, 1776, 1792, 0, RAIL, 'rail'));
add(block(3328, 4864, 1776, 1792, 0, RAIL, 'rail'));
add(block(2304, 4864, 1792, 2304, -448, WATER_TOP, 'water'));
add(block(3072, 3328, 1792, 2304, -32, 0, 'planks'));
add(block(3040, 3072, 1792, 2304, -32, RAIL, 'rail'));
add(block(3328, 3360, 1792, 2304, -32, RAIL, 'rail'));
add(pillar(2700, 1600, 12, 0, 192, 'lamp'));
add(pillar(3900, 1600, 12, 0, 192, 'lamp'));
// End walls: west (promenade, creek, yard) and east (promenade, creek, yard up to the road gate).
add(block(2240, 2304, 1536, 3904, -448, 384, 'seawall'));
add(block(4864, 4928, 1536, 3072, -448, 384, 'seawall'));

// --- E: cannery yard ------------------------------------------------------------
add(block(2304, 4864, 2304, 3840, WATER_TOP, 0, 'concrete'));
add(block(2304, 3072, 2304, 2320, 0, RAIL, 'rail'));
add(block(3328, 4864, 2304, 2320, 0, RAIL, 'rail'));
add(block(2304, 4864, 3840, 3904, 0, 384, 'corrugated'));
add(block(2432, 3008, 2688, 3456, 0, 320, 'corrugated')); // cannery warehouse
add(block(3456, 3712, 2432, 2560, 0, 128, 'container'));
add(block(4096, 4352, 3584, 3712, 0, 128, 'containerBlue'));
add(block(3328, 3456, 3200, 3456, 0, 128, 'containerBlue'));
const dock = add(block(3968, 4608, 2432, 2816, 0, 64, 'concrete'));
addAll(stairs({ foot: { x: 4288, y: 2944 }, dir: '-y', steps: 4, width: 192, rise: 16, run: 32, material: 'concrete' }));
add(block(2800, 2880, 3600, 3680, 0, 72, 'container')); // forklift
add(pillar(3800, 3700, 12, 0, 192, 'lamp'));

// --- F: harbour road, basin, pier ----------------------------------------------
add(block(4864, 6464, 3072, 3584, -64, 0, 'asphalt'));
add(block(4928, 6464, 3008, 3072, 0, 320, 'brick'));
add(block(6464, 6528, 3008, 3648, 0, 320, 'brick'));
add(block(4928, 5888, 3584, 3648, 0, 96, 'seawall'));
add(block(6400, 6464, 3584, 3648, 0, 96, 'seawall'));
// Basin: water and walls around it (the yard's north-east corner is its west wall).
add(block(4928, 7168, 3584, 5632, -448, WATER_TOP, 'water'));
add(block(4864, 4928, 3584, 5696, -448, 384, 'seawall'));
add(block(4928, 7232, 5632, 5696, -448, 256, 'seawall'));
add(block(7168, 7232, 3584, 5632, -448, 256, 'seawall'));
add(block(5888, 6400, 3584, 5120, -32, 0, 'planks')); // pier
add(block(5888, 6400, 5120, 5152, -32, 48, 'rail'));
for (const y of [4000, 4416, 4832]) {
	add(pillar(5912, y, 24, 0, 40, 'rail'));
	add(pillar(6376, y, 24, 0, 40, 'rail'));
}
// Rescue boat moored beside the pier tip (scenery).
add(block(6464, 6848, 4480, 5184, -128, 64, 'boat'));
add(block(6592, 6784, 4672, 4928, 64, 192, 'cabin'));
add(pillar(6688, 4800, 16, 192, 448, 'lamp'));

// --- Spawns, route, zones ---------------------------------------------------------
const spawns: Spawn[] = [
	[160, -96],
	[160, 96],
	[288, -96],
	[288, 96],
	[64, -224],
	[64, 224],
	[384, -32],
	[384, 160]
].map(([x, y]) => ({ pos: v3(x!, y!, 0), yaw: 0 }));

const path = [
	v3(256, 0, 0),
	v3(1024, 0, 0),
	v3(2048, 0, 0),
	v3(3200, 0, 0),
	v3(3200, 768, 0),
	v3(3200, 1536, 0),
	v3(3200, 2048, 0),
	v3(3200, 2560, 0),
	v3(3584, 3072, 0),
	v3(4352, 3328, 0),
	v3(5120, 3328, 0),
	v3(6144, 3328, 0),
	v3(6144, 4096, 0),
	v3(6144, 4928, 0)
];

const sz = (x0: number, x1: number, y0: number, y1: number, node: number): ZombieSpawnZone => ({
	min: v3(x0, y0, 0),
	max: v3(x1, y1, 128),
	node
});
const spawnZones: ZombieSpawnZone[] = [
	sz(-256, -128, -576, -448, 0), // beach steps behind the start
	sz(POCKETS_S[0]! + 16, POCKETS_S[0]! + 112, -496, -336, 1),
	sz(POCKETS_N[0]! + 16, POCKETS_N[0]! + 112, 336, 496, 1),
	sz(POCKETS_S[1]! + 16, POCKETS_S[1]! + 112, -496, -336, 2),
	sz(POCKETS_N[1]! + 16, POCKETS_N[1]! + 112, 336, 496, 2),
	sz(2368, 2560, 1600, 1728, 5), // promenade west end
	sz(4608, 4800, 1600, 1728, 5), // promenade east end
	sz(2368, 2560, 3584, 3776, 7), // yard north-west corner
	sz(3328, 3520, 3648, 3776, 7), // yard north wall
	sz(4640, 4768, 2400, 2528, 8), // yard east, by the loading dock
	sz(5376, 5568, 3136, 3264, 10), // harbour road
	sz(6208, 6400, 3136, 3264, 11), // harbour road east end
	sz(5952, 6080, 4352, 4480, 12) // mid-pier (climbing out of the water)
];

const cp = (index: number, x0: number, x1: number, y0: number, y1: number, at: [number, number], yaw: number): Zone => ({
	type: 'checkpoint',
	index,
	min: v3(x0, y0, 0),
	max: v3(x1, y1, 256),
	respawn: { pos: v3(at[0], at[1], 0), yaw }
});

/**
 * Gates between the zones (glowing barriers drawn by the mode, not brushes).
 * Each opens 30 s after half the living survivors stood in its unlock area.
 */
const gate = (x0: number, x1: number, y0: number, y1: number, h: number, unlock: [number, number, number, number], node: number): ZombieGate => ({
	min: v3(x0, y0, 0),
	max: v3(x1, y1, h),
	unlock: { min: v3(unlock[0], unlock[2], 0), max: v3(unlock[1], unlock[3], 160) },
	node
});
const gates: ZombieGate[] = [
	gate(3072, 3328, 336, 352, 192, [2944, 3328, -256, 320], 3), // 1: street → alley
	gate(3072, 3328, 1504, 1520, 192, [3072, 3328, 1216, 1488], 4), // 2: alley → promenade
	gate(3072, 3328, 2304, 2320, 192, [3072, 3328, 1856, 2288], 6), // 3: bridge → cannery yard
	gate(4880, 4896, 3072, 3584, 224, [4480, 4864, 3136, 3520], 9), // 4: yard → harbour road
	gate(5888, 6400, 3600, 3616, 224, [5888, 6400, 3136, 3584], 11) // 5: road → pier and the evac boat
];

const brushes = [...boxes];
const zones: Zone[] = [
	cp(1, 2752, 2880, -320, 320, [2816, 0], 0),
	cp(2, 3072, 3328, 1344, 1472, [3200, 1408], 90),
	cp(3, 3072, 3328, 2048, 2240, [3200, 2144], 90), // on the bridge, before gate 3
	cp(4, 4736, 4864, 3072, 3584, [4800, 3328], 0),
	cp(5, 5888, 6400, 3200, 3520, [6144, 3360], 90), // harbour road, before the pier gate
	{ type: 'end', min: v3(5952, 4800, 0), max: v3(6336, 5056, 256) },
	// Creek and harbour basin: fall in → back to the checkpoint, −1 HP.
	{ type: 'teleport', min: v3(2304, 1792, WATER_TOP + 8), max: v3(4864, 2304, FALL_TP_TOP), to: 'stage' },
	{ type: 'teleport', min: v3(4928, 3584, WATER_TOP + 8), max: v3(7168, 5632, FALL_TP_TOP), to: 'stage' },
	teleportBelow(brushes, boundsOf(brushes).min.z, 'stage', 1024, 2048)
];

// --- Theme: dusk, thick sea fog -------------------------------------------------
const theme: Theme = {
	skyTop: 0x241f38,
	skyHorizon: 0xc77a5a,
	skyBottom: 0x5a4a58,
	fogColor: 0x6e6470,
	fogNear: 500,
	fogFar: 5200,
	sunColor: 0xffa070,
	sunIntensity: 0.85,
	sunDir: v3(0.62, -0.42, 0.2),
	ambientSky: 0x8a86a8,
	ambientGround: 0x4a3c34,
	ambientIntensity: 0.62,
	materials: {
		asphalt: { color: 0x3c3d42, topColor: 0x46474c, noise: 0.16, noiseScale: 96, roughness: 0.95 },
		pavement: { color: 0x77726a, topColor: 0x86807a, noise: 0.14, noiseScale: 64, roughness: 0.9 },
		cobble: { color: 0x5d5852, topColor: 0x6c665e, noise: 0.28, noiseScale: 24, roughness: 0.95 },
		concrete: { color: 0x7d7b76, topColor: 0x8a8782, noise: 0.15, noiseScale: 128, roughness: 0.9 },
		brick: { color: 0x7a3f32, topColor: 0x4a4648, noise: 0.22, noiseScale: 48, roughness: 0.9 },
		plaster: { color: 0xa69d8c, topColor: 0x6a4a40, noise: 0.12, noiseScale: 160, roughness: 0.9 },
		timber: { color: 0x4e5a5e, topColor: 0x3e4246, noise: 0.2, noiseScale: 80, roughness: 0.9 },
		corrugated: { color: 0x6a6f70, topColor: 0x5a5e60, noise: 0.18, noiseScale: 24, roughness: 0.7 },
		seawall: { color: 0x5f5d58, topColor: 0x6c6a64, noise: 0.22, noiseScale: 192, roughness: 0.95 },
		water: { color: 0x1b3640, topColor: 0x24485a, noise: 0.25, noiseScale: 320, roughness: 0.2 },
		planks: { color: 0x5e4630, topColor: 0x6e5238, noise: 0.25, noiseScale: 40, roughness: 0.9 },
		rail: { color: 0x2e3236, topColor: 0x3a3e42, noise: 0.1, noiseScale: 64, roughness: 0.6 },
		car: { color: 0x6b2a24, topColor: 0x56514c, noise: 0.18, noiseScale: 32, roughness: 0.6 },
		crate: { color: 0x7c6040, topColor: 0x8c6e4a, edgeColor: 0x3a2a18, noise: 0.25, noiseScale: 32, roughness: 0.9 },
		container: { color: 0x8a3c22, topColor: 0x74321c, noise: 0.15, noiseScale: 24, roughness: 0.7 },
		containerBlue: { color: 0x2c4a6a, topColor: 0x263f5a, noise: 0.15, noiseScale: 24, roughness: 0.7 },
		boat: { color: 0xd8d2c4, topColor: 0x8a6a44, edgeColor: 0xff6a2a, noise: 0.08, noiseScale: 128, roughness: 0.5 },
		cabin: { color: 0xe8e2d4, topColor: 0xc04030, noise: 0.06, noiseScale: 128, roughness: 0.5 },
		lamp: { color: 0x2a2a2e, edgeColor: 0xffb060, noise: 0.05, noiseScale: 64, roughness: 0.5 }
	},
	effects: [{ type: 'clouds', color: 0x8a7a86, count: 30, height: 2600 }]
};

export const zombies_lowtide: MapDef = {
	id: 'zombies_lowtide',
	title: 'Low Tide',
	kind: 'zombies',
	difficulty: 'easy',
	layout: 'linear',
	cvars: {},
	spawn: spawns[0]!,
	spawns,
	zombies: { path, spawnZones, gates },
	brushes,
	zones,
	theme
};

/** Design data for the map tests. */
export const LOWTIDE = { dock, pocketsS: POCKETS_S, pocketsN: POCKETS_N, waterTop: WATER_TOP, fallTop: FALL_TP_TOP };
