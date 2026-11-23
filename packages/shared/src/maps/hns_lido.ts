/**
 * hns_lido — "Lido Bay", a hide and seek map (docs/research/hide-and-seek-maps.md).
 *
 * An original seaside holiday resort in a cove, 9216 × 7680 playable
 * (x [-4608, 4608], y [-3840, 3840]), ground at z = 0, enclosed by cliffs on
 * three sides and an invisible sea wall in the south (2048 tall; nothing
 * climbable reaches 800). North = +y.
 *
 *   north:  Grand Hotel (W) · hedge maze gardens (centre) · car park (E)
 *   avenue: road with parked cars, the sewer underneath
 *   middle: old town + chapel (W) · plaza with the seekers' office (centre) · pool club (E)
 *   south:  promenade · beach (huts, lifeguard tower, bar, boathouse) · pier · sea · lighthouse rocks (SW)
 *
 * Area modules: ./hns_lido-hotel.ts, ./hns_lido-town.ts, ./hns_lido-centre.ts,
 * ./hns_lido-east.ts, ./hns_lido-coast.ts; furniture and wall builders in
 * ./hns-props.ts. Secrets, teleporters, crawlspaces, rooms and loops are
 * recorded in `LIDO` / `LIDO_MEDIUM` for the tests and docs.
 *
 * Two sizes share all of it (./hns_lido-variant.ts): `hns_lido` is the whole
 * resort (Large), `hns_lido_m` its western quarters closed at x = 1280
 * (Medium; edges in ./hns_lido-medium.ts): hotel, old town, plaza, maze,
 * beach, pier, lighthouse and sewer, without pool club, car park and boathouse.
 */
import { HNS_CVARS } from '../modes/index.ts';
import type { MapDef, Spawn, Theme, Zone } from './types.ts';
import { MapBuilder, pine, put, rect, rng, slab, v, type Rect, type Teleporter } from './hns-props.ts';
import { buildHotel } from './hns_lido-hotel.ts';
import { buildTown, WELL } from './hns_lido-town.ts';
import { buildCentre, CAGE_INNER, PLINTH } from './hns_lido-centre.ts';
import { buildAvenue, buildEast, CUBICLE_POOL, DRAIN, PHONE_ROOF, SHAFT } from './hns_lido-east.ts';
import { buildMediumEdges, PHONE_HOTEL } from './hns_lido-medium.ts';
import { LARGE, MEDIUM, type LidoVariant } from './hns_lido-variant.ts';
import { ARCADE, buildCoast, HUT_X0, HUT_Y0, HUT_FLOOR, PHONE_PROM, TP_CRATE } from './hns_lido-coast.ts';

export const WALL_TOP = 2048;

const m = (color: number, o: Partial<Theme['materials'][string]> = {}) => ({ color, noise: 0.12, noiseScale: 96, roughness: 0.85, ...o });
const theme: Theme = {
	skyTop: 0x2f7fd6,
	skyHorizon: 0xffe2c2,
	skyBottom: 0xa9cbe0,
	fogColor: 0xf3e0cc,
	fogNear: 3500,
	fogFar: 15000,
	sunColor: 0xfff0d6,
	sunIntensity: 1.25,
	sunDir: v(-0.45, -0.55, 0.7),
	ambientSky: 0xcfe4ff,
	ambientGround: 0x9a8466,
	ambientIntensity: 0.74,
	materials: {
		// Ground and terrain.
		sand: m(0xe3cf9f, { topColor: 0xecd9a8, noise: 0.14, noiseScale: 160, roughness: 0.95 }),
		sandwet: m(0xb9a273, { noise: 0.12, noiseScale: 160 }),
		seabed: m(0xc9b382, { topColor: 0xbfa877, noise: 0.18, noiseScale: 200 }),
		water: m(0x2a8fb0, { topColor: 0x3aa7c8, opacity: 0.55, roughness: 0.15, noise: 0.18, noiseScale: 320 }),
		water_far: m(0x2582a6, { topColor: 0x2f95b8, roughness: 0.15, noise: 0.2, noiseScale: 600 }),
		poolwater: m(0x3fc4e0, { topColor: 0x5fd8f0, opacity: 0.45, roughness: 0.1, noise: 0.15, noiseScale: 128 }),
		well_water: m(0x1c4a52, { roughness: 0.1 }),
		sewage: m(0x4f5a2e, { opacity: 0.8, roughness: 0.2 }),
		paving: m(0xc4b7a0, { topColor: 0xd2c6ae, noiseScale: 64 }),
		plaza: m(0xd8cdb8, { topColor: 0xe2d8c4, noiseScale: 48, noise: 0.1 }),
		cobble: m(0x9c9286, { topColor: 0xa39686, noise: 0.25, noiseScale: 32 }),
		deck: m(0xb07a4d, { topColor: 0xbd8656, noise: 0.2, noiseScale: 40 }),
		asphalt: m(0x4a4b50, { topColor: 0x55565b, noise: 0.15, noiseScale: 128 }),
		grass: m(0x5e9a45, { topColor: 0x6fae4f, noise: 0.22, noiseScale: 128, roughness: 0.95 }),
		soil: m(0x5a3f2a, { noise: 0.25 }),
		rock: m(0x8a8178, { topColor: 0x968c80, noise: 0.28, noiseScale: 160, roughness: 0.95 }),
		rock_top: m(0x9c9284, { topColor: 0xa49a88, noise: 0.25, noiseScale: 128 }),
		cliff: m(0x8f8478, { topColor: 0x6f9a52, noise: 0.3, noiseScale: 300, roughness: 0.95 }),
		clip: m(0x000000, { opacity: 0 }),
		court: m(0x3f7fb0, { topColor: 0x3a7cb2, noise: 0.05 }),
		paint: m(0xf4f4f0, { noise: 0.02 }),
		// Buildings.
		hotel_wall: m(0xf1e4cf, { topColor: 0xb9a990, noiseScale: 192, noise: 0.08 }),
		hotel_inner: m(0xe9dcc6, { noise: 0.06, noiseScale: 192 }),
		plaster_white: m(0xf2efe8, { noise: 0.06 }),
		plaster_cream: m(0xefdfb8, { noise: 0.08 }),
		plaster_pink: m(0xe8b5a8, { noise: 0.08 }),
		plaster_blue: m(0x9fc3d8, { noise: 0.08 }),
		plaster_ochre: m(0xd9a75c, { noise: 0.08 }),
		brick: m(0xa4523d, { topColor: 0x8a4434, noise: 0.22, noiseScale: 48 }),
		brick_dark: m(0x3a2622, { noise: 0.2, noiseScale: 32 }),
		stone: m(0xb0a898, { topColor: 0xbab2a2, noise: 0.18, noiseScale: 80 }),
		stone_dark: m(0x6e6860, { noise: 0.2, noiseScale: 64 }),
		stone_floor: m(0x9a9488, { topColor: 0xa49e92, noise: 0.15, noiseScale: 64 }),
		timber: m(0x7a5a3c, { topColor: 0x6a4e34, noise: 0.25, noiseScale: 48 }),
		marble: m(0xe8e4dc, { topColor: 0xf0ece4, noise: 0.1, noiseScale: 64, roughness: 0.35 }),
		// Floor slabs: topColor is the floor, color the ceiling below and the slab edges.
		carpet_red: m(0xece4d6, { topColor: 0x9a3439, noise: 0.08, noiseScale: 32 }),
		carpet_blue: m(0xece4d6, { topColor: 0x34518a, noise: 0.08, noiseScale: 32 }),
		floorboards: m(0xe8dcc4, { topColor: 0xa8774b, noise: 0.18, noiseScale: 32 }),
		ceiling_tile: m(0xe6e2d8, { noise: 0.05, noiseScale: 32 }),
		tile_white: m(0xe8eef0, { noise: 0.05, noiseScale: 24, roughness: 0.4 }),
		pooltile: m(0x6cc6dc, { topColor: 0x82d2e4, noise: 0.06, noiseScale: 24, roughness: 0.35 }),
		roof_tar: m(0xe6e0d4, { topColor: 0x6a6662, noise: 0.12, noiseScale: 96 }),
		roof_tile: m(0xb4583c, { topColor: 0xc0623f, noise: 0.15, noiseScale: 48 }),
		roof_slate: m(0x4d545e, { topColor: 0x55606c, noise: 0.15, noiseScale: 48 }),
		thatch: m(0xc8a45c, { topColor: 0xd2ae62, noise: 0.3, noiseScale: 24 }),
		concrete: m(0xa9a7a2, { topColor: 0xb3b1ac, noise: 0.14, noiseScale: 128 }),
		concrete_core: m(0xc9c3b4, { noise: 0.1, noiseScale: 128 }),
		concrete_deck: m(0xb8b6b0, { topColor: 0x8f8e8a, noise: 0.14, noiseScale: 128 }),
		concrete_ramp: m(0x8a8a86, { topColor: 0xc9a43a, noise: 0.14 }),
		concrete_stair: m(0xa09e98, { topColor: 0xb2b0aa, noise: 0.1 }),
		stair: m(0x7a5638, { topColor: 0x8a6440, noise: 0.18, noiseScale: 32 }),
		canopy: m(0x2c4f6b, { topColor: 0x3a5f7c, noise: 0.05 }),
		glass: m(0xbfe6f2, { glass: true, edgeColor: 0xe8f8ff, roughness: 0.05 }),
		glass_stained: m(0xc0603a, { glass: true, opacity: 0.6, edgeColor: 0xffd27a }),
		glass_dark: m(0x24323a, { roughness: 0.1, noise: 0.04 }),
		mirror: m(0xcfe0e8, { roughness: 0.05, noise: 0.02 }),
		mesh: m(0x6a7a6a, { opacity: 0.35 }),
		net: m(0xf0f0f0, { opacity: 0.5 }),
		bars: m(0x3a3a3c, { opacity: 0.85 }),
		hut_red: m(0xd8584a, { topColor: 0xf0e8dc, noise: 0.1 }),
		hut_blue: m(0x4a8ed8, { topColor: 0xf0e8dc, noise: 0.1 }),
		hut_yellow: m(0xf0c840, { topColor: 0xf0e8dc, noise: 0.1 }),
		hut_green: m(0x5ab878, { topColor: 0xf0e8dc, noise: 0.1 }),
		hut_white: m(0xf4f1ea, { noise: 0.08 }),
		lh_red: m(0xc83a32, { noise: 0.08 }),
		lh_white: m(0xf4f2ee, { noise: 0.06 }),
		sewer_brick: m(0x5a4a3e, { topColor: 0x4a3e34, noise: 0.25, noiseScale: 32 }),
		sewer_floor: m(0x4a4640, { topColor: 0x55504a, noise: 0.2, noiseScale: 64 }),
		duct: m(0x9ea4a8, { noise: 0.06, noiseScale: 32, roughness: 0.4 }),
		hedge: m(0x2f6b2c, { topColor: 0x3a7c34, noise: 0.35, noiseScale: 24, roughness: 0.95 }),
		// Wood, fabric, metal, plastic.
		wood: m(0x9a6a40, { topColor: 0xa8744a, noise: 0.2, noiseScale: 24 }),
		wood_dark: m(0x5c3c24, { topColor: 0x66442a, noise: 0.2, noiseScale: 24 }),
		wood_light: m(0xc89c68, { topColor: 0xd2a872, noise: 0.18, noiseScale: 24 }),
		planks: m(0x8e6a46, { topColor: 0xa07850, noise: 0.25, noiseScale: 24 }),
		bamboo: m(0xc8b070, { noise: 0.2, noiseScale: 16 }),
		bark: m(0x5a4232, { noise: 0.3, noiseScale: 16 }),
		leaf: m(0x4e8f3a, { topColor: 0x5ea044, noise: 0.35, noiseScale: 24, roughness: 0.95 }),
		leaf_dark: m(0x3a7a30, { topColor: 0x488a38, noise: 0.35, noiseScale: 24, roughness: 0.95 }),
		pine: m(0x2f5e36, { topColor: 0x3a6c3e, noise: 0.3, noiseScale: 24 }),
		palm: m(0x5f9c3a, { topColor: 0x6cae44, noise: 0.25, noiseScale: 16 }),
		palm_trunk: m(0x8a6e4e, { noise: 0.3, noiseScale: 12 }),
		flower_pink: m(0xe86fa8, { noise: 0.2 }),
		flower_red: m(0xd8343a, { noise: 0.2 }),
		flower_yellow: m(0xf2d03a, { noise: 0.2 }),
		terracotta: m(0xb8643c, { noise: 0.15 }),
		linen: m(0xf2efe6, { noise: 0.05, noiseScale: 32 }),
		fabric_red: m(0xa8343a, { noise: 0.1, noiseScale: 16 }),
		fabric_blue: m(0x34588e, { noise: 0.1, noiseScale: 16 }),
		fabric_green: m(0x3e7a52, { noise: 0.1, noiseScale: 16 }),
		leather: m(0x5a3422, { noise: 0.12, roughness: 0.5 }),
		felt: m(0x2f7a46, { noise: 0.06 }),
		curtain: m(0xc84a6a, { noise: 0.15, noiseScale: 16 }),
		canvas_red: m(0xd8443a, { noise: 0.08 }),
		canvas_blue: m(0x3a72c8, { noise: 0.08 }),
		canvas_yellow: m(0xf0c234, { noise: 0.08 }),
		canvas_green: m(0x3aa860, { noise: 0.08 }),
		canvas_white: m(0xf4f2ea, { noise: 0.06 }),
		lampshade: m(0xf2e2b0, { noise: 0.05 }),
		brass: m(0xc8a040, { roughness: 0.3, noise: 0.08 }),
		bronze: m(0x8a6a34, { roughness: 0.35, noise: 0.12 }),
		gold: m(0xe0b830, { roughness: 0.25, noise: 0.08 }),
		iron: m(0x3a3c40, { roughness: 0.5, noise: 0.1 }),
		steel: m(0x9aa0a6, { roughness: 0.35, noise: 0.08 }),
		steel_door: m(0xb4bac0, { roughness: 0.3, noise: 0.05 }),
		chrome: m(0xd0d6dc, { roughness: 0.15, noise: 0.04 }),
		rust: m(0x8a4a2a, { noise: 0.3 }),
		pipe: m(0x6a7a6e, { roughness: 0.4, noise: 0.15 }),
		vent: m(0x5a5e62, { noise: 0.08 }),
		tank: m(0xd4d8d2, { topColor: 0xbcc0ba, noise: 0.1 }),
		chain: m(0x5a5a5e, { noise: 0.05 }),
		locker: m(0x6a8a9e, { noise: 0.05, roughness: 0.5 }),
		stall: m(0x8aa0b0, { noise: 0.05 }),
		porcelain: m(0xf4f6f6, { roughness: 0.2, noise: 0.03 }),
		ice: m(0xd8eef6, { noise: 0.08, roughness: 0.2 }),
		plastic_white: m(0xeeeeea, { roughness: 0.4, noise: 0.04 }),
		plastic_black: m(0x2a2a2e, { roughness: 0.4, noise: 0.04 }),
		plastic_red: m(0xd8342e, { roughness: 0.4, noise: 0.04 }),
		plastic_blue: m(0x2e6ad8, { roughness: 0.4, noise: 0.04 }),
		plastic_green: m(0x3aa84a, { roughness: 0.4, noise: 0.04 }),
		plastic_yellow: m(0xf2c82e, { roughness: 0.4, noise: 0.04 }),
		plastic_orange: m(0xf27a1e, { roughness: 0.4, noise: 0.04 }),
		plastic_pink: m(0xf29ac0, { roughness: 0.4, noise: 0.04 }),
		screen: m(0x2a5a8a, { roughness: 0.1, noise: 0.1, seamColor: 0x5ad0ff }),
		screen_green: m(0x2a7a4a, { roughness: 0.1, noise: 0.1, seamColor: 0x7aff9a }),
		lampglow: m(0xfff2c0, { edgeColor: 0xffe08a, noise: 0.02, roughness: 0.2 }),
		neon_pink: m(0xff5ab4, { edgeColor: 0xff8ad0, noise: 0.02 }),
		neon_cyan: m(0x4ae0f0, { edgeColor: 0x8af4ff, noise: 0.02 }),
		ember: m(0xff7a2a, { seamColor: 0xffc04a, noise: 0.3 }),
		taillight: m(0xc8202a, { noise: 0.02 }),
		tyre: m(0x222226, { roughness: 0.9, noise: 0.05 }),
		cartint: m(0x1e262e, { roughness: 0.1, noise: 0.03 }),
		car_red: m(0xc8282e, { roughness: 0.3, noise: 0.03 }),
		car_blue: m(0x2a58b8, { roughness: 0.3, noise: 0.03 }),
		car_white: m(0xeef0f0, { roughness: 0.3, noise: 0.03 }),
		car_black: m(0x1e1e22, { roughness: 0.3, noise: 0.03 }),
		car_yellow: m(0xf2c21e, { roughness: 0.3, noise: 0.03 }),
		car_green: m(0x2e7a48, { roughness: 0.3, noise: 0.03 }),
		car_silver: m(0xa8b0b8, { roughness: 0.3, noise: 0.03 }),
		boat: m(0xf0ece2, { topColor: 0x9a6a40, noise: 0.08 }),
		boat_blue: m(0x2a5a9a, { topColor: 0x9a6a40, noise: 0.08 }),
		buoy: m(0xf26a1e, { noise: 0.05 }),
		phone_red: m(0xc8201e, { roughness: 0.4, noise: 0.05 }),
		dumpster: m(0x2e6a3e, { noise: 0.15, roughness: 0.6 }),
		container_red: m(0xb0402e, { topColor: 0x983828, noise: 0.12, noiseScale: 24, roughness: 0.6 }),
		container_blue: m(0x2f6aa8, { topColor: 0x285b90, noise: 0.12, noiseScale: 24, roughness: 0.6 }),
		container_green: m(0x3a7a4a, { topColor: 0x326a40, noise: 0.12, noiseScale: 24, roughness: 0.6 }),
		container_orange: m(0xd07a2a, { topColor: 0xb86a24, noise: 0.12, noiseScale: 24, roughness: 0.6 }),
		crate: m(0xb08850, { topColor: 0xc29a5e, noise: 0.25, noiseScale: 24 }),
		crate_dark: m(0x7a5a34, { topColor: 0x86643a, noise: 0.25, noiseScale: 24 }),
		cardboard: m(0xb89a6a, { noise: 0.12, noiseScale: 16 }),
		barrel: m(0x2e5a8a, { noise: 0.1 }),
		cask: m(0x8a5e38, { noise: 0.22, noiseScale: 16 }),
		chem: m(0xe8d23a, { noise: 0.06 }),
		gas: m(0xd8d8d0, { noise: 0.06 }),
		tin: m(0xb8bcc0, { noise: 0.06 }),
		suitcase: m(0x7a3a5a, { noise: 0.1 }),
		safe: m(0x4a5048, { roughness: 0.4, noise: 0.06 }),
		flour: m(0xeee6d4, { noise: 0.1 }),
		mannequin: m(0xe8d0b8, { noise: 0.05 }),
		organ: m(0x5a3420, { noise: 0.18 }),
		drum: m(0xc83a3a, { noise: 0.05 }),
		gnome: m(0xd8342e, { noise: 0.1 }),
		compost: m(0x4a6a3a, { noise: 0.2 }),
		shed: m(0x6a8a5a, { topColor: 0x8a4a34, noise: 0.18 }),
		transformer: m(0x7a8a7a, { noise: 0.08 }),
		statue: m(0x5f9c8a, { noise: 0.2, noiseScale: 48, roughness: 0.5 }),
		book_red: m(0x9a2a2a, { noise: 0.06 }),
		book_blue: m(0x2a3e7a, { noise: 0.06 }),
		book_green: m(0x2a5a3a, { noise: 0.06 }),
		book_cream: m(0xe0d2b0, { noise: 0.06 }),
		book_brown: m(0x6a4428, { noise: 0.06 })
	},
	effects: [
		{ type: 'clouds', color: 0xffffff, count: 40, height: 3400 },
		{ type: 'clouds', color: 0xffe8d4, count: 18, height: 4400 }
	]
};

/** Hider spawns [x, y, z, yaw]. */
const LARGE_SPAWNS: Array<[number, number, number, number]> = [
	[0, -900, 0, 90],
	[-1000, -320, 0, 0],
	[800, -200, 0, 180],
	[-400, -1100, 0, 90],
	[400, -1000, 0, 90],
	[1450, 0, 0, 180],
	[-1600, -600, 0, 0],
	[-320, 300, 0, 270],
	[640, 640, 0, 270],
	[1450, -1250, 0, 90],
	[-1680, 1000, 0, 270],
	[0, 1300, 0, 270],
	[500, -2000, 0, 90],
	[-1500, -2300, 0, 90],
	[2000, -1500, 0, 90],
	[-2000, 1280, 0, 0],
];
const MEDIUM_SPAWNS: Array<[number, number, number, number]> = [
	[0, -900, 0, 90],
	[-1000, -320, 0, 0],
	[800, -200, 0, 180],
	[-400, -1100, 0, 90],
	[400, -1000, 0, 90],
	[-1600, -600, 0, 0],
	[-320, 300, 0, 270],
	[640, 640, 0, 270],
	[-1680, 1000, 0, 270],
	[0, 1300, 0, 270],
	[500, -2000, 0, 90],
	[-1500, -2300, 0, 90],
	[-2000, 1280, 0, 0],
	[-3100, -600, 0, 90],
	[-1200, -2600, 0, 90],
	[-3264, 1290, 0, 0],
	[-2700, -1530, 0, 0],
];

export interface LidoDesign {
	arena: Rect;
	wallTop: number;
	kinds: MapBuilder['kinds'];
	spots: MapBuilder['spots'];
	teleports: Teleporter[];
	crawls: MapBuilder['crawls'];
	rooms: string[];
	buildings: string[];
	loops: string[];
	hiderSpawns: Spawn[];
	seekerSpawns: Spawn[];
}

function buildLido(variant: LidoVariant): { map: MapDef; design: LidoDesign } {
	const medium = variant.size === 'medium';
	const ARENA = variant.arena;
	const b = new MapBuilder();
	const holes: Rect[] = [];
	b.clip = medium ? ARENA : null;
	buildHotel(b, holes);
	buildTown(b, holes);
	buildCentre(b, holes, variant);
	if (medium) buildAvenue(b, variant);
	else buildEast(b, holes, variant);
	buildCoast(b, variant);
	if (medium) buildMediumEdges(b);

	// --- Ground (top 0, 32 thick) by region, minus the holes areas cut ----------
	const regions: Array<[Rect, string]> = [
		[rect(-4608, 4608, -2976, -1664), 'sand'],
		[rect(-4608, 4608, -1664, -1408), 'paving'],
		[rect(-4608, -1792, -1408, 1152), 'cobble'],
		[rect(-1792, 1664, -1408, 1152), 'plaza'],
		[rect(1664, 4608, -1408, 1152), 'deck'],
		[rect(-4608, 4608, 1152, 1408), 'asphalt'],
		[rect(-4608, -896, 1408, 1792), 'paving'],
		[rect(-4608, -896, 1792, 3840), 'grass'],
		[rect(-896, 1280, 1408, 3840), 'grass'],
		[rect(1280, 4608, 1408, 3840), 'asphalt']
	];
	b.as('ground', () => {
		for (const [r, m] of regions) slab(b, r, -32, 0, m, holes);
	});

	b.clip = null;
	// --- Boundary: terraced cliffs W/N/E (an invisible clip wall above the first
	// terrace keeps players in up to 2048), an invisible sea wall S, sea to the horizon.
	b.as('ground', () => {
		const z0 = -256;
		const tiers: Array<[number, number, number]> = [
			[0, 256, 640],
			[256, 768, 1024],
			[768, 1792, 1408]
		];
		for (const [i0, i1, top] of tiers) {
			b.box(ARENA.x0 - i1, ARENA.y0 - 256, z0, ARENA.x0 - i0, ARENA.y1 + i0, top, 'cliff');
			b.box(ARENA.x1 + i0, ARENA.y0 - 256, z0, ARENA.x1 + i1, ARENA.y1 + i0, top, 'cliff');
			b.box(ARENA.x0 - i1, ARENA.y1 + i0, z0, ARENA.x1 + i1, ARENA.y1 + i1, top, 'cliff');
		}
		b.box(ARENA.x0 - 256, ARENA.y0 - 256, 640, ARENA.x0, ARENA.y1, WALL_TOP, 'clip');
		b.box(ARENA.x1, ARENA.y0 - 256, 640, ARENA.x1 + 256, ARENA.y1, WALL_TOP, 'clip');
		b.box(ARENA.x0 - 256, ARENA.y1, 640, ARENA.x1 + 256, ARENA.y1 + 256, WALL_TOP, 'clip');
		b.box(ARENA.x0, ARENA.y0 - 256, z0, ARENA.x1, ARENA.y0, WALL_TOP, 'clip');
		b.box(-20000, -20000, -96, 20000, ARENA.y0 - 256, -16, 'water_far');
	});
	// Pines on the cliff terraces (scenery out of reach; no collision so they may overlap).
	const scenery0 = b.brushes.length;
	b.as('prop', () => {
		const r = rng(77);
		for (let k = 0; k < 40; k++) {
			const side = k % 3;
			const t = 0.05 + r() * 0.9;
			const tier = r() < 0.6 ? 1 : 2;
			const inset = tier === 1 ? 256 + 16 + r() * 352 : 768 + 16 + r() * 860;
			const top = tier === 1 ? 1024 : 1408;
			const s = putFar(side, t, inset);
			put(b, pine(48 + Math.floor(r() * 48)), s.x - 64, s.y - 64, top);
		}
	});
	for (let i = scenery0; i < b.brushes.length; i++) b.brushes[i]!.solid = false;
	function putFar(side: number, t: number, inset: number): { x: number; y: number } {
		if (side === 0) return { x: ARENA.x0 - inset - 64, y: ARENA.y0 + t * (ARENA.y1 - ARENA.y0) };
		if (side === 1) return { x: ARENA.x1 + inset + 64, y: ARENA.y0 + t * (ARENA.y1 - ARENA.y0) };
		return { x: ARENA.x0 + t * (ARENA.x1 - ARENA.x0), y: ARENA.y1 + inset + 64 };
	}

	// --- Teleporters ----------------------------------------------------------------
	const tp = (t: Teleporter) => b.teleport(t);
	const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => ({ min: v(x0, y0, z0), max: v(x1, y1, z1) });
	const sp = (x: number, y: number, z: number, yaw: number): Spawn => ({ pos: v(x, y, z), yaw });
	tp({ id: 'fireplace', zone: box(-3318, 2068, 8, -3300, 2124, 48), dest: sp(-2900, 3000, 576, 0), hidden: true, back: 'penthouse-wardrobe', note: 'Hotel lobby fireplace (duck in) → sealed roof penthouse' });
	tp({ id: 'penthouse-wardrobe', zone: box(-2848, 2912, 580, -2800, 2944, 680), dest: sp(-3232, 2140, 0, 0), hidden: true, back: 'fireplace', note: 'Penthouse wardrobe → hotel lobby' });
	tp({ id: 'cask', zone: box(-3096, 1848, -188, -3016, 1928, -104), dest: sp(-2160, 150, -192, 270), hidden: true, back: 'crypt-portal', note: 'Hotel wine cellar: inside the big cask → chapel crypt' });
	tp({ id: 'crypt-portal', zone: box(-2000, -610, -188, -1960, -570, -120), dest: sp(-3150, 2000, -192, 0), hidden: true, back: 'cask', note: 'Crypt, dark south-east corner → hotel wine cellar' });
	tp({ id: 'well', zone: box(WELL.x - 24, WELL.y - 24, -150, WELL.x + 24, WELL.y + 24, -80), dest: sp(-4200, 1216, -192, 0), hidden: true, back: 'drain', note: 'Back-yard well (drop in) → sewer west end' });
	tp({ id: 'drain', zone: box(-4312, 1424, -188, -4264, 1464, -110), dest: sp(-4160, 860, 0, 90), hidden: true, back: 'well', note: 'Sewer drain alcove behind fake bars → back yards by the well' });
	const hx = HUT_X0(0);
	if (medium) {
		const hx7 = HUT_X0(7);
		const prom = PHONE_PROM;
		const hotel = PHONE_HOTEL;
		tp({ id: 'phone-prom', zone: box(prom.x + 20, prom.y + 28, 8, prom.x + 52, prom.y + 56, 90), dest: sp(hotel.x + 36, hotel.y - 40, 0, 270), hidden: false, back: 'phone-hotel', note: 'Promenade phone box ↔ hotel forecourt phone box' });
		tp({ id: 'phone-hotel', zone: box(hotel.x + 20, hotel.y + 16, 8, hotel.x + 52, hotel.y + 44, 90), dest: sp(prom.x + 36, prom.y + 112, 0, 90), hidden: false, back: 'phone-prom', note: 'Hotel forecourt phone box ↔ promenade phone box' });
		const cubicle = (x: number) => box(x + 100, HUT_Y0 + 80, HUT_FLOOR + 4, x + 140, HUT_Y0 + 124, HUT_FLOOR + 80);
		const inHut = (x: number) => sp(x + 56, HUT_Y0 + 30, HUT_FLOOR, 90);
		tp({ id: 'hut-cubicle', zone: cubicle(hx), dest: inHut(hx7), hidden: false, back: 'hut7-cubicle', note: 'Beach hut 0 changing cubicle ↔ beach hut 7 changing cubicle' });
		tp({ id: 'hut7-cubicle', zone: cubicle(hx7), dest: inHut(hx), hidden: false, back: 'hut-cubicle', note: 'Beach hut 7 changing cubicle ↔ beach hut 0' });
	} else {
		tp({ id: 'phone-prom', zone: box(PHONE_PROM.x + 20, PHONE_PROM.y + 28, 8, PHONE_PROM.x + 52, PHONE_PROM.y + 56, 90), dest: sp(PHONE_ROOF.x + 36, PHONE_ROOF.y - 40, 384, 270), hidden: false, back: 'phone-roof', note: 'Promenade phone box ↔ car park roof phone box' });
		tp({ id: 'phone-roof', zone: box(PHONE_ROOF.x + 20, PHONE_ROOF.y + 16, 392, PHONE_ROOF.x + 52, PHONE_ROOF.y + 44, 474), dest: sp(PHONE_PROM.x + 36, PHONE_PROM.y + 112, 0, 90), hidden: false, back: 'phone-prom', note: 'Car park roof phone box ↔ promenade phone box' });
		tp({ id: 'hut-cubicle', zone: box(hx + 100, HUT_Y0 + 80, HUT_FLOOR + 4, hx + 140, HUT_Y0 + 124, HUT_FLOOR + 80), dest: sp(2880, 720, 0, 270), hidden: false, back: 'pool-cubicle', note: 'Beach hut 0 changing cubicle ↔ pool house changing cubicle' });
		tp({ id: 'pool-cubicle', zone: box(CUBICLE_POOL.x0 + 12, CUBICLE_POOL.y0 + 12, 4, CUBICLE_POOL.x1 - 12, CUBICLE_POOL.y1 - 12, 90), dest: sp(hx + 56, HUT_Y0 + 30, HUT_FLOOR, 90), hidden: false, back: 'hut-cubicle', note: 'Pool house changing cubicle ↔ beach hut 0' });
		tp({ id: 'boathouse-crate', zone: box(TP_CRATE.x0 + 8, TP_CRATE.y0 + 8, 8, TP_CRATE.x1 - 8, TP_CRATE.y1 - 8, 80), dest: sp(-4224, -3680, 576, 90), hidden: true, note: 'Boathouse: the hollow crate in the corner → lighthouse gallery (walk back down the spiral)' });
	}
	tp({ id: 'plinth', zone: box(PLINTH.x0 + 8, PLINTH.y0 + 8, 8, PLINTH.x1 - 12, PLINTH.y1 - 8, 80), dest: sp(-2112, 440, 480, 90), hidden: true, back: 'bell', note: 'Maze statue plinth (fake east face) → chapel belfry' });
	tp({ id: 'bell', zone: box(-2196, 500, 484, -2156, 524, 530), dest: sp(300, 2560, 0, 0), hidden: true, back: 'plinth', note: 'Belfry: duck under the bell → maze centre' });
	if (!medium) tp({ id: 'elevator', zone: box(SHAFT.x0 + 24, SHAFT.y0 + 24, 8, SHAFT.x1 - 24, SHAFT.y1 - 24, 80), dest: sp(-3436, 2264, 596, 270), hidden: true, note: 'Car park: through the fake elevator doors → inside the hotel roof water tank' });
	tp({ id: 'arcade', zone: box(ARCADE.x0 + 6, ARCADE.y0 + 8, 54, ARCADE.x0 + 34, ARCADE.y0 + 38, 128), dest: sp(-3800, -3450, -48, 0), approach: v(ARCADE.x0 + 20, ARCADE.y0 + 76, 48), hidden: true, note: 'Pier arcade: the hollow cabinet → sea cave (walk out through the fake rock face)' });
	if (!medium) tp({ id: 'pool-drain', zone: box(DRAIN.x0 + 4, DRAIN.y0 + 4, -158, DRAIN.x1 - 4, DRAIN.y1 - 4, -110), dest: sp(4180, -400, -192, 180), hidden: true, note: 'Pool drain (deep end) → pump room (stairs up through a fake trapdoor)' });

	// --- Spawns ------------------------------------------------------------------------
	const hiderSpawns: Spawn[] = (medium ? MEDIUM_SPAWNS : LARGE_SPAWNS).map((p) => sp(...p));

	const seekerSpawns: Spawn[] = [sp(-96, 560, 0, 270), sp(96, 560, 0, 270), sp(-96, 660, 0, 270), sp(96, 660, 0, 270)];

	const zones: Zone[] = b.teleports.map((t) => ({ type: 'teleport', min: t.zone.min, max: t.zone.max, to: 'start', dest: t.dest }));
	// Fall-out safety net under everything: respawn at a spawn of the player's team.
	zones.push({ type: 'teleport', min: v(-24000, -24000, -4096), max: v(24000, 24000, -512), to: 'start' });


	const map: MapDef = {
		id: medium ? 'hns_lido_m' : 'hns_lido',
		title: 'Lido Bay',
		kind: 'hns',
		difficulty: 'easy',
		size: variant.size,
		layout: 'open',
		cvars: { ...HNS_CVARS },
		spawn: hiderSpawns[0]!,
		spawns: hiderSpawns,
		hns: { hiderSpawns, seekerSpawns, seekerCage: { min: v(CAGE_INNER.x0, CAGE_INNER.y0, 0), max: v(CAGE_INNER.x1, CAGE_INNER.y1, 176) } },
		brushes: b.brushes,
		zones,
		theme
	};
	const design: LidoDesign = {
		arena: ARENA,
		wallTop: WALL_TOP,
		kinds: b.kinds,
		spots: b.spots,
		teleports: b.teleports,
		crawls: b.crawls,
		rooms: b.rooms,
		buildings: b.buildings,
		loops: b.loops,
		hiderSpawns,
		seekerSpawns
	};
	return { map, design };
}

const large = buildLido(LARGE);
const mediumBuild = buildLido(MEDIUM);
/** Large: the whole resort. */
export const hns_lido = large.map;
/** Medium: the western quarters. */
export const hns_lido_m = mediumBuild.map;
/** Design data for tests and docs: secrets, teleporters, crawlspaces, rooms, loops, brush kinds. */
export const LIDO = large.design;
export const LIDO_MEDIUM = mediumBuild.design;
