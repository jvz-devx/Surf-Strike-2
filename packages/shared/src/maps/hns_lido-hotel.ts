/**
 * hns_lido — the Grand Hotel (north-west) and its grounds.
 *
 * Footprint x [-4224, -1152], y [1792, 3264]; 24-thick outer walls, three
 * storeys (floor tops 0, 192, 384; 16-thick slabs; 176 clear), a roof at 576
 * with a 48 parapet, and a basement (floor -192) under the west half. Seven
 * 432-wide columns; south block, a 224-wide corridor, north block.
 *
 * Secrets: lobby fireplace teleporter → sealed roof penthouse (and back
 * through its wardrobe); fake bookcase into a secret study; three hollow
 * wardrobes; a linen store behind a fake corridor wall; a duck-only void
 * above the 1F corridor's dropped ceiling (crouch-jump in through a fake
 * tile); a wine cask teleporter → chapel crypt; a hollow roof water tank
 * (teleport destination from the car park); the entrance canopy roof
 * (crouch-jump from a taxi).
 */
import {
	armchair,
	barrel,
	basin,
	bathtub,
	bed,
	bench,
	boiler,
	bush,
	car,
	chair,
	counter,
	crate,
	desk,
	dish,
	dumpster,
	fakeShelf,
	fence,
	flight,
	flowerBed,
	fridge,
	gap,
	kitchen,
	lamp,
	lockers,
	officeDesk,
	pallet,
	palm,
	piano,
	pine,
	plant,
	poolTable,
	put,
	putC,
	rect,
	sofa,
	shelf,
	stool,
	stove,
	table,
	toilet,
	tree,
	tv,
	v,
	van,
	wall,
	wardrobe,
	washer,
	waterTank,
	acUnit,
	container,
	door,
	fakeHole,
	slab,
	win,
	type Face,
	type Hole,
	type MapBuilder,
	type Prop,
	type Rect
} from './hns-props.ts';

export const HOTEL = rect(-4224, -1152, 1792, 3264);
const T = 24;
const IX0 = -4200;
const IX1 = -1176;
const IY0 = 1816;
const IY1 = 3240;
/** Column boundaries x_i = -4200 + 432 i (i = 0..7). */
const X = (i: number) => IX0 + 432 * i;
const SY1 = 2400; // south block north face (corridor wall at [2400, 2416])
const CY0 = 2416;
const CY1 = 2640;
const NY0 = 2656;
const FLOORS = [0, 192, 384];
export const HOTEL_ROOF = 576;
const H = 176;
const BZ = -192;
/** Basement covers columns 0..2. */
const BX1 = X(3) - 8; // -2912

const WALL = 'hotel_wall';
const INNER = 'hotel_inner';
const FLOOR_MAT = ['marble', 'carpet_red', 'carpet_blue'];

/** Stair-core flight footprints (x0 = core interior west face). */
function core(cx0: number) {
	return {
		A: rect(cx0 + 16, cx0 + 112, 2688, 2976),
		Ahole: rect(cx0 + 16, cx0 + 112, 2672, 2976),
		B: rect(cx0 + 256, cx0 + 352, 2888, 3176),
		Bhole: rect(cx0 + 256, cx0 + 352, 2888, 3192),
		door: cx0 + 136
	};
}
const CORE_W = core(IX0);
const CORE_E = core(X(6) + 8);
const GRAND = rect(-2320, -2192, 1880, 2168);

/** Place a prop in a room of the south (yy from the outer wall, +yy = north) or north block (+yy = south). */
function placer(b: MapBuilder, block: 'S' | 'N', z: number) {
	return (p: Prop, x: number, yy: number, face: Face) => {
		const sy = face === 's' || face === 'n' ? p.d : p.w;
		if (block === 'S') return put(b, p, x, IY0 + yy, z, face);
		const flip: Record<Face, Face> = { n: 's', s: 'n', e: 'e', w: 'w' };
		return put(b, p, x, IY1 - yy - sy, z, flip[face]);
	};
}

/** World y range of a block-local yy range. */
function yr(block: 'S' | 'N', a: number, c: number): [number, number] {
	return block === 'S' ? [IY0 + a, IY0 + c] : [IY1 - c, IY1 - a];
}

/** A guest room (bedroom + bathroom) between partitions [rx0, rx1]. */
function guestRoom(b: MapBuilder, rx0: number, rx1: number, block: 'S' | 'N', z: number, seed: number, hollow: boolean, name: string): void {
	const at = placer(b, block, z);
	// Bathroom walls (corridor side, east of the entry passage).
	const [w0, w1] = yr(block, 408, 424);
	b.box(rx0 + 112, w0, z, rx1, w1, z + H, INNER);
	const [p0, p1] = yr(block, 424, 584);
	const dz: [number, number] = block === 'S' ? [IY0 + 456, IY0 + 520] : [IY1 - 520, IY1 - 456];
	wall(b, 'y', p0, p1, rx0 + 112, rx0 + 128, z, z + H, INNER, [door(dz[0], z, 64, 100)]);
	b.room(`${name} bedroom`, `${name} bathroom`);
	b.as('prop', () => {
		at(bathtub(), rx1 - 64, 552, 's');
		at(toilet(), rx0 + 136, 554, 's');
		at(basin(), rx0 + 200, 566, 's');
		const cx = Math.round((rx0 + rx1) / 2);
		at(bed(96, 128, 'linen', seed % 2 ? 'fabric_blue' : 'fabric_red'), cx - 8, 0, 'n');
		at(table(24, 24, 24, 'wood', 'wood'), cx - 40, 4, 'n');
		at(table(24, 24, 24, 'wood', 'wood'), cx + 96, 4, 'n');
		at(lamp(), rx0 + 144, 300, 'n');
		at(wardrobe(hollow), rx0, 200, 'e');
		at(desk(), rx1 - 48, 180, 'w');
		at(chair(), rx1 - 84, 214, 'e');
		at(tv(), rx1 - 20, 300, 'w');
		at(armchair(seed % 3 === 0 ? 'fabric_green' : 'fabric_red'), rx0 + 96, 300, 'e');
		at(plant(40), rx1 - 24, 380, 'n');
		if (seed % 2 === 0) at(crate(32, 'suitcase'), rx0 + 160, 140, 'n');
	});
}

export function buildHotel(b: MapBuilder, holes: Rect[]): void {
	holes.push(HOTEL);
	b.buildings.push('Grand Hotel');

	// --- Outer walls (basement to parapet) -----------------------------------
	const ZB = -208;
	const ZT = HOTEL_ROOF + 48;
	const sHoles: Hole[] = [];
	const nHoles: Hole[] = [];
	for (let i = 0; i < 7; i++) {
		const xm = X(i) + 216;
		// Ground floor south: restaurant (0-1), lobby (2-4), bar (5), library (6).
		if (i <= 1) sHoles.push(win(xm - 144, 0, 96), win(xm + 48, 0, 96));
		else if (i === 2) sHoles.push(win(xm - 152, 0, 256, 24, 152));
		else if (i === 3) sHoles.push(door(xm - 64, 0, 128, 128));
		else if (i === 4) sHoles.push(win(xm - 104, 0, 256, 24, 152));
		else sHoles.push(win(xm - 48, 0));
		for (const z of [192, 384]) sHoles.push(win(xm - 48, z));
		// North: core windows small, rooms normal, kitchen back door.
		if (i === 2) nHoles.push(door(xm - 64, 0, 64, 104));
		else if (i !== 0 && i !== 6) nHoles.push(win(xm - 48, 0));
		for (const z of [192, 384]) nHoles.push(i === 0 || i === 6 ? win(xm + 64, z, 64, 64, 144) : win(xm - 48, z));
	}
	// Crawl pipe from the laundry to the sewer.
	sHoles.push(gap(-3584, BZ, 64, BZ + 56));
	wall(b, 'x', HOTEL.x0, HOTEL.x1, HOTEL.y0, IY0, ZB, ZT, WALL, sHoles);
	wall(b, 'x', HOTEL.x0, HOTEL.x1, IY1, HOTEL.y1, ZB, ZT, WALL, nHoles);
	const sideHoles = (east: boolean): Hole[] => {
		const hs: Hole[] = [door(2496, 0, 64, 104)];
		for (const z of [192, 384]) hs.push(win(2496, z, 64, 64, 136));
		if (!east) hs.push(door(2048, 0, 96, 112), win(1928, 192, 96), win(1928, 384, 96), win(2800, 0, 96));
		else hs.push(win(2160, 0, 96), win(1928, 192, 96), win(1928, 384, 96), win(2800, 0, 96));
		return hs;
	};
	wall(b, 'y', IY0, IY1, HOTEL.x0, IX0, ZB, ZT, WALL, sideHoles(false));
	wall(b, 'y', IY0, IY1, IX1, HOTEL.x1, ZB, ZT, WALL, sideHoles(true));

	// --- Slabs ----------------------------------------------------------------
	const inner = rect(IX0, IX1, IY0, IY1);
	slab(b, inner, -16, 0, FLOOR_MAT[0]!, [CORE_W.Bhole]);
	slab(b, inner, 176, 192, FLOOR_MAT[1]!, [CORE_W.Ahole, CORE_E.Ahole, rect(GRAND.x0, GRAND.x1, GRAND.y0 - 16, GRAND.y1)]);
	slab(b, inner, 368, 384, FLOOR_MAT[2]!, [CORE_W.Bhole, CORE_E.Bhole]);
	slab(b, inner, HOTEL_ROOF - 16, HOTEL_ROOF, 'roof_tar', [CORE_W.Ahole, CORE_E.Ahole]);
	slab(b, rect(IX0, BX1, IY0, IY1), BZ - 16, BZ, 'concrete');

	// --- Stairs -----------------------------------------------------------------
	for (const c of [CORE_W, CORE_E]) {
		flight(b, { x: (c.A.x0 + c.A.x1) / 2, y: 2688 }, '+y', 12, 96, 0, 'stair');
		flight(b, { x: (c.B.x0 + c.B.x1) / 2, y: 3176 }, '-y', 12, 96, 192, 'stair');
		flight(b, { x: (c.A.x0 + c.A.x1) / 2, y: 2688 }, '+y', 12, 96, 384, 'stair');
	}
	flight(b, { x: (CORE_W.B.x0 + CORE_W.B.x1) / 2, y: 3176 }, '-y', 12, 96, BZ, 'concrete_stair');
	flight(b, { x: -2256, y: GRAND.y0 }, '+y', 12, 128, 0, 'marble');

	// --- Partitions and corridor walls per storey -------------------------------
	const partS = [[2, 5, 6], [1, 2, 5, 6], [1, 2, 3, 4, 5, 6]];
	const partN = [[1, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]];
	for (let s = 0; s < 3; s++) {
		const z = FLOORS[s]!;
		for (const i of partS[s]!) b.box(X(i) - 8, IY0, z, X(i) + 8, SY1, z + H, INNER);
		for (const i of partN[s]!) b.box(X(i) - 8, NY0, z, X(i) + 8, IY1, z + H, INNER);
		const sDoors: Hole[] = [];
		const nDoors: Hole[] = [];
		if (s === 0) {
			sDoors.push(door(-3700, z, 96), door(-4000, z, 64), door(-3200, z, 128, 128), door(-2560, z, 128, 128), door(-2400, z, 128, 128));
			sDoors.push(door(X(5) + 12, z), door(X(6) + 40, z));
			nDoors.push(door(CORE_W.door, z, 96), door(-3600, z, 64), door(-3100, z, 64), door(X(3) + 40, z), door(X(4) + 40, z), door(X(5) + 40, z), door(CORE_E.door, z, 96));
		} else {
			for (let i = 0; i < 7; i++) {
				const mezz = s === 1 && i >= 2 && i <= 4;
				if (!mezz) sDoors.push(door(X(i) + 32, z, 64, s === 1 ? 96 : 104));
				if (i > 0 && i < 6) {
					// 2F col3 north: the linen store behind a fake wall section.
					if (s === 2 && i === 3) nDoors.push(fakeHole(X(i) + 32, z, 64, 104, INNER));
					else nDoors.push(door(X(i) + 32, z, 64, s === 1 ? 96 : 104));
				}
			}
			if (s === 1) sDoors.push(door(-3200, z, 128, 96), door(-2560, z, 128, 96));
			nDoors.push(door(CORE_W.door, z, 96, s === 1 ? 96 : 104), door(CORE_E.door, z, 96, s === 1 ? 96 : 104));
		}
		wall(b, 'x', IX0, IX1, SY1, CY0, z, z + H, INNER, sDoors);
		wall(b, 'x', IX0, IX1, CY1, NY0, z, z + H, INNER, nDoors);
	}

	// --- Ground floor -----------------------------------------------------------
	groundFloor(b);
	// --- Upper floors: guest rooms ------------------------------------------------
	let seed = 1;
	for (let s = 1; s < 3; s++) {
		const z = FLOORS[s]!;
		for (let i = 0; i < 7; i++) {
			const rx0 = i === 0 ? IX0 : X(i) + 8;
			const rx1 = i === 6 ? IX1 : X(i + 1) - 8;
			const mezz = s === 1 && i >= 2 && i <= 4;
			if (!mezz) {
				const hollow = (s === 1 && i === 0) || (s === 2 && i === 5);
				guestRoom(b, rx0, rx1, 'S', z, seed++, hollow, `${s}F room S${i}`);
				if (hollow) b.spot(`hotel-wardrobe-${s}S${i}`, `Hotel ${s}F room S${i}: inside the wardrobe`, v(rx0 + 32, IY0 + 236, z + 4), 'prop', 'fake');
			}
			if (i > 0 && i < 6) {
				if (s === 2 && i === 3) linenStore(b, rx0, rx1, z);
				else {
					const hollow = s === 2 && i === 2;
					guestRoom(b, rx0, rx1, 'N', z, seed++, hollow, `${s}F room N${i}`);
					if (hollow) b.spot(`hotel-wardrobe-${s}N${i}`, `Hotel ${s}F room N${i}: inside the wardrobe`, v(rx0 + 32, IY1 - 236, z + 4), 'prop', 'fake');
				}
			}
		}
		b.room(`${s}F corridor`, `${s}F west stairs`, `${s}F east stairs`);
	}
	mezzanine(b);
	corridorVoid(b);
	basement(b);
	roof(b);
	grounds(b);
	b.loops.push(
		'Hotel corridor: west end door → corridor → east end door → round the hotel outside',
		'Hotel stairs: west core up to 2F → corridor → east core down → lobby',
		'Hotel lobby: grand stair up to the mezzanine → 1F corridor → west core down → restaurant → lobby'
	);
}

function groundFloor(b: MapBuilder): void {
	const z = 0;
	b.room('restaurant', 'lobby', 'bar', 'library', 'kitchen', 'staff office', 'luggage room', 'washrooms', 'G corridor', 'G west stairs', 'G east stairs');
	b.as('prop', () => {
		// Restaurant x [-4200, -3344].
		for (let r = 0; r < 3; r++)
			for (let c = 0; c < 4; c++) {
				const x = -4136 + c * 200;
				const y = 1880 + r * 168;
				put(b, table(64, 64, 30, 'linen', 'wood_dark'), x, y, z);
				put(b, chair(), x + 18, y - 30, z, 'n');
				put(b, chair(), x + 18, y + 66, z, 's');
			}
		put(b, counter(160, 40, 'marble', 'wood'), -3560, 2368, z, 'n');
		put(b, plant(56), -4196, 1820, z);
		put(b, plant(56), -3372, 1820, z);
		// Lobby x [-3328, -2048].
		put(b, counter(256, 42, 'marble', 'wood_dark'), -2880, 2300, z, 's');
		put(b, shelf(256, 96, 3, 'boxes', 7), -2880, 2352, z, 's');
		put(b, sofa(128, 'fabric_blue'), -3200, 1880, z, 'n');
		put(b, sofa(128, 'fabric_blue'), -3200, 2040, z, 's');
		put(b, table(96, 48, 18, 'marble', 'brass'), -3184, 1960, z);
		put(b, armchair('fabric_red'), -2560, 1900, z, 'w');
		put(b, armchair('fabric_red'), -2560, 1980, z, 'w');
		put(b, plant(64), -2416, 1830, z);
		put(b, plant(64), -2416, 2360, z);
		put(b, plant(64), -3100, 2360, z);
		put(b, crate(32, 'suitcase'), -2620, 2250, z);
		// Marble columns, a central planter with a palm, more seating, luggage trolley.
		for (const x of [-3040, -2920, -2420])
			for (const y of [1900, 2200]) b.box(x, y, z, x + 32, y + 32, z + H, 'marble', true, 'struct');
		b.box(-2800, 2060, z, -2672, 2124, z + 24, 'marble');
		put(b, plant(80), -2748, 2080, z + 24);
		put(b, sofa(112, 'fabric_red'), -2860, 1840, z, 'n');
		put(b, sofa(112, 'fabric_red'), -2620, 1840, z, 'n');
		put(b, table(64, 48, 18, 'glass_dark', 'brass'), -2780, 1900, z);
		put(b, armchair('fabric_blue'), -3300, 2260, z, 'e');
		put(b, lamp(), -3300, 2320, z);
		b.box(-2500, 2000, z + 8, -2436, 2040, z + 12, 'brass');
		b.box(-2500, 2000, z, -2496, 2004, z + 8, 'iron');
		b.box(-2440, 2036, z, -2436, 2040, z + 8, 'iron');
		b.box(-2500, 2036, z + 12, -2496, 2040, z + 64, 'brass');
		b.box(-2440, 2000, z + 12, -2436, 2004, z + 64, 'brass');
		b.box(-2496, 2004, z + 12, -2440, 2036, z + 40, 'suitcase');
		put(b, crate(32, 'suitcase', 24), -2580, 2250, z);
		// Bar / lounge x [-2032, -1616].
		put(b, counter(256, 44, 'wood', 'wood_dark'), -1940, 2330, z, 's');
		put(b, shelf(256, 32, 1, 'goods', 3, 12), -1940, 2388, z, 's');
		for (let k = 0; k < 5; k++) put(b, stool(), -1920 + k * 50, 2290, z);
		put(b, piano(), -2020, 1840, z, 'n');
		put(b, poolTable(), -1760, 1900, z);
		put(b, sofa(112, 'leather'), -1900, 2120, z, 's');
		put(b, table(48, 48, 18), -1868, 2060, z);
		// Library x [-1600, -1176]; secret study x [-1336, -1176] y [1816, 2000].
		wall(b, 'y', IY0, 2000, -1352, -1336, z, z + H, INNER, [{ a: 1880, b: 1944, z0: z, z1: z + 104 }]);
		b.box(-1352, 2000, z, IX1, 2016, z + H, INNER);
		put(b, fakeShelf(64, 104, 4, 11, 16), -1368, 1880, z, 'w');
		put(b, shelf(64, 104, 4, 'books', 12, 16), -1368, 1816, z, 'w');
		put(b, shelf(64, 104, 4, 'books', 13, 16), -1368, 1944, z, 'w');
		put(b, shelf(128, 128, 5, 'books', 14), -1600, 2272, z, 'e');
		put(b, shelf(128, 128, 5, 'books', 15), -1600, 2112, z, 'e');
		put(b, shelf(128, 128, 5, 'books', 16), -1328, 2376, z, 'n');
		put(b, table(128, 64, 30, 'wood_dark', 'wood_dark'), -1520, 2040, z);
		put(b, chair(), -1500, 2010, z, 'n');
		put(b, chair(), -1440, 2010, z, 'n');
		put(b, armchair('leather'), -1568, 1840, z, 'n');
		put(b, lamp(), -1520, 1840, z);
		// Secret study.
		put(b, desk('wood_dark'), -1300, 1820, z, 'n');
		put(b, chair('wood_dark', 'leather'), -1266, 1872, z, 's');
		put(b, crate(40, 'safe'), -1220, 1950, z);
		put(b, lamp('lampglow'), -1192, 1830, z);
	});
	b.room('secret study');
	b.spot('hotel-study', 'Hotel library: secret study behind the bookcase', v(-1256, 1930, z), 'fake', 'room');

	// Fireplace on the lobby's west wall (teleporter in the firebox).
	const fx0 = -3328;
	b.box(fx0, 2000, z, fx0 + 64, 2064, z + H, 'brick');
	b.box(fx0, 2128, z, fx0 + 64, 2192, z + H, 'brick');
	b.box(fx0, 2064, z, fx0 + 8, 2128, z + 64, 'brick_dark');
	b.box(fx0, 2064, z + 64, fx0 + 64, 2128, z + H, 'brick');
	b.box(fx0 + 64, 1992, z + 72, fx0 + 72, 2200, z + 80, 'wood_dark', true, 'prop');
	b.fake(fx0 + 10, 2076, z, fx0 + 40, 2116, z + 6, 'wood_dark', 'prop');
	b.fake(fx0 + 14, 2084, z + 6, fx0 + 34, 2108, z + 7, 'ember', 'prop');

	// Kitchen x [-3760, -2912] (north cols 1-2) with a walk-in freezer.
	b.as('prop', () => {
		put(b, kitchen(344), -3540, 3208, z, 's');
		put(b, kitchen(184), -3100, 3208, z, 's');
		put(b, counter(256, 36, 'steel', 'steel', 64), -3500, 2880, z);
		put(b, counter(256, 36, 'steel', 'steel', 64), -3500, 2760, z);
		for (let k = 0; k < 3; k++) put(b, fridge(), -2944, 2700 + k * 40, z, 'w');
		put(b, stove(), -3000, 3000, z, 'w');
		put(b, stove(), -3000, 3032, z, 'w');
		put(b, shelf(128, 96, 3, 'goods', 21), -3400, 2660, z, 'n');
		put(b, crate(40), -2960, 2900, z);
	});
	wall(b, 'x', -3760, -3552, 3032, 3048, z, z + H, INNER);
	wall(b, 'y', 3048, IY1, -3568, -3552, z, z + H, INNER, [door(3080, z, 64)]);
	b.box(-3760, 3048, z + 120, -3568, IY1, z + H, 'ice', true, 'struct');
	b.as('prop', () => {
		put(b, shelf(96, 112, 3, 'boxes', 22), -3760, 3200, z, 's');
		put(b, crate(48, 'ice'), -3700, 3080, z);
		put(b, crate(40, 'ice'), -3640, 3090, z);
	});
	b.room('walk-in freezer');

	// Staff office (col 3 north), luggage (col 4), washrooms (col 5).
	b.as('prop', () => {
		put(b, officeDesk(), X(3) + 32, 3180, z, 's');
		put(b, officeDesk(), X(3) + 200, 3180, z, 's');
		put(b, chair('plastic_black', 'fabric_blue'), X(3) + 66, 3140, z, 'n');
		put(b, chair('plastic_black', 'fabric_blue'), X(3) + 234, 3140, z, 'n');
		put(b, lockers(8), X(4) - 28, 2700, z, 'w');
		put(b, shelf(96, 96, 3, 'boxes', 31), X(3) + 300, 2700, z, 'w');
		for (let k = 0; k < 4; k++) put(b, shelf(160, 112, 3, 'boxes', 40 + k), X(4) + 24 + (k % 2) * 200, 2720 + Math.floor(k / 2) * 240, z, 's');
		put(b, crate(40, 'suitcase'), X(4) + 40, 3180, z);
		put(b, crate(32, 'suitcase'), X(4) + 90, 3180, z);
		put(b, crate(48, 'suitcase', 32), X(4) + 300, 3170, z);
	});
	// Washroom stalls.
	for (let k = 0; k < 4; k++) {
		const x0 = X(5) + 24 + k * 96;
		b.box(x0, 3104, z, x0 + 4, IY1, z + 88, 'stall');
		put(b, toilet(), x0 + 38, 3210, z, 'n');
	}
	b.box(X(5) + 408, 3104, z, X(5) + 412, IY1, z + 88, 'stall');
	b.as('prop', () => {
		for (let k = 0; k < 4; k++) put(b, basin(), X(5) + 120 + k * 64, NY0 + 4, z, 'n');
	});
}

function linenStore(b: MapBuilder, rx0: number, rx1: number, z: number): void {
	b.room('linen store');
	b.as('prop', () => {
		put(b, shelf(160, 144, 4, 'boxes', 51), rx0, IY1 - 24, z, 's');
		put(b, shelf(160, 144, 4, 'boxes', 52), rx0 + 200, IY1 - 24, z, 's');
		put(b, shelf(160, 144, 4, 'boxes', 53), rx1 - 24, 2800, z, 'w');
		put(b, table(96, 48, 40, 'linen', 'steel'), rx0 + 40, 2860, z);
		put(b, crate(40, 'linen'), rx0 + 300, 2700, z);
	});
	b.spot('hotel-linen', 'Hotel 2F: linen store behind a fake corridor wall', v(rx0 + 120, 2760, z), 'fake', 'room');
}

function mezzanine(b: MapBuilder): void {
	const z = 192;
	b.room('1F mezzanine');
	b.as('prop', () => {
		put(b, sofa(128, 'fabric_green'), -3200, 1830, z, 'n');
		put(b, sofa(128, 'fabric_green'), -3000, 1830, z, 'n');
		put(b, table(192, 96, 30, 'wood_dark', 'wood_dark'), -2900, 2040, z);
		for (let k = 0; k < 4; k++) {
			put(b, chair(), -2880 + k * 44, 2008, z, 'n');
			put(b, chair(), -2880 + k * 44, 2140, z, 's');
		}
		put(b, piano(), -2560, 1830, z, 'n');
		put(b, plant(64), -3320, 2370, z);
		put(b, plant(64), -2080, 1830, z);
	});
	// Rail round the grand stair hole.
	b.box(GRAND.x0 - 4, GRAND.y0 - 16, z, GRAND.x0, GRAND.y1, z + 40, 'brass', true, 'prop');
	b.box(GRAND.x1, GRAND.y0 - 16, z, GRAND.x1 + 4, GRAND.y1, z + 40, 'brass', true, 'prop');
	b.box(GRAND.x0 - 4, GRAND.y0 - 20, z, GRAND.x1 + 4, GRAND.y0 - 16, z + 40, 'brass', true, 'prop');
}

/** 1F corridor: dropped ceiling at 288..296; the void above (296..368, 72 clear) is a duck-only crawlspace. */
function corridorVoid(b: MapBuilder): void {
	const z = 192;
	const tiles = [rect(-3232, -3104, 2512, 2640), rect(-1792, -1728, 2416, 2480)];
	slab(b, rect(IX0, IX1, CY0, CY1), z + 96, z + 104, 'ceiling_tile', tiles);
	for (const t of tiles) b.fake(t.x0, t.y0, z + 96, t.x1, t.y1, z + 104, 'ceiling_tile');
	// Luggage cabinet under the west fake tile (56 tall): crouch on it and jump up through the tile.
	b.box(-3216, 2584, z, -3120, 2640, z + 56, 'wood_dark', true, 'prop');
	// Suitcases in front of it: the first step (24).
	b.box(-3200, 2552, z, -3152, 2584, z + 24, 'suitcase', true, 'prop');
	// Sofa under the east tile (a way down / up).
	put(b, sofa(96, 'fabric_red'), -1808, 2420, z, 'n');
	b.box(-3184, 2440, z + 104, -3120, 2456, z + 112, 'pipe', true, 'prop');
	b.crawl('hotel-void', v(-3400, 2528, z + 104), v(-2000, 2528, z + 104));
	b.spot('hotel-void', 'Hotel 1F: inside the ceiling void above the corridor', v(-2600, 2528, z + 104), 'crawl', 'fake', 'crouchjump');
}

function basement(b: MapBuilder): void {
	const z = BZ;
	const top = -16;
	// East end wall of the basement.
	b.box(BX1, IY0, z, BX1 + 16, IY1, top, INNER);
	for (const i of [1, 2]) b.box(X(i) - 8, IY0, z, X(i) + 8, SY1, top, INNER);
	for (const i of [1, 2]) b.box(X(i) - 8, NY0, z, X(i) + 8, IY1, top, INNER);
	wall(b, 'x', IX0, BX1, SY1, CY0, z, top, INNER, [door(-4000, z), door(-3600, z), door(-3200, z, 96)]);
	wall(b, 'x', IX0, BX1, CY1, NY0, z, top, INNER, [door(CORE_W.door, z, 96), door(-3600, z), door(-3150, z)]);
	b.room('boiler room', 'laundry', 'wine cellar', 'basement storage W', 'basement storage E', 'basement corridor', 'basement stairs');
	b.as('prop', () => {
		put(b, boiler(), -4180, 1840, z);
		put(b, boiler(), -4080, 1840, z);
		put(b, waterTank(), -3920, 1840, z);
		b.box(-4200, 2360, z + 120, -3776, 2376, z + 136, 'pipe');
		b.box(-3990, 1904, z, -3974, 2360, z + 16, 'pipe');
		// Laundry.
		for (let k = 0; k < 6; k++) put(b, washer(), k < 3 ? -3740 + k * 36 : -3480 + (k - 3) * 36, IY0, z, 'n');
		put(b, shelf(160, 112, 4, 'boxes', 61), -3540, 2376, z, 's');
		put(b, table(96, 48, 32, 'linen', 'steel'), -3700, 2100, z);
		put(b, crate(40, 'linen'), -3420, 2000, z);
		// Wine cellar: barrel racks.
		for (let r = 0; r < 3; r++)
			for (let c = 0; c < 4; c++) put(b, barrel('cask', 'iron'), -3312 + c * 44, 2100 + r * 80, z);
		put(b, shelf(192, 120, 5, 'goods', 71), -3120, 2376, z, 's');
		// Storage.
		for (let k = 0; k < 3; k++) put(b, shelf(160, 120, 3, 'boxes', 81 + k), -3740 + (k % 2) * 200, 2700 + k * 160, z, 's');
		put(b, crate(48), -3200, 2700, z);
		put(b, crate(48), -3200, 2748, z);
		put(b, crate(40), -3000, 2700, z);
		put(b, crate(64, 'crate_dark'), -3080, 3100, z);
		put(b, pallet(true), -3000, 3150, z);
	});
	// Big hollow wine cask: teleporter to the chapel crypt inside.
	const cx0 = -3104;
	const cy0 = 1840;
	const s = 96;
	b.fake(cx0, cy0, z, cx0 + s, cy0 + 4, z + s, 'cask', 'prop');
	b.fake(cx0, cy0 + s - 4, z, cx0 + s, cy0 + s, z + s, 'cask', 'prop');
	b.fake(cx0, cy0 + 4, z, cx0 + 4, cy0 + s - 4, z + s, 'cask', 'prop');
	b.fake(cx0 + s - 4, cy0 + 4, z, cx0 + s, cy0 + s - 4, z + s, 'cask', 'prop');
	b.fake(cx0 + 4, cy0 + 4, z + s - 4, cx0 + s - 4, cy0 + s - 4, z + s, 'cask', 'prop');
	for (const bz of [12, 48, 84]) b.fake(cx0 - 2, cy0 - 2, z + bz, cx0 + s + 2, cy0, z + bz + 4, 'iron', 'prop');
	b.crawl('hotel-pipe', v(-3552, 1440, z), v(-3552, 1760, z));
}

function roof(b: MapBuilder): void {
	const z = HOTEL_ROOF;
	// Rails at the stair openings.
	for (const c of [CORE_W, CORE_E]) {
		b.box(c.Ahole.x1, c.Ahole.y0, z, c.Ahole.x1 + 4, c.Ahole.y1, z + 40, 'iron', true, 'prop');
		b.box(c.Ahole.x0, c.Ahole.y0 - 4, z, c.Ahole.x1 + 4, c.Ahole.y0, z + 40, 'iron', true, 'prop');
	}
	// Sealed penthouse (only reachable by the fireplace teleporter).
	const p = rect(-3008, -2688, 2880, 3200);
	wall(b, 'x', p.x0, p.x1, p.y0, p.y0 + 16, z, z + 128, 'plaster_white');
	wall(b, 'x', p.x0, p.x1, p.y1 - 16, p.y1, z, z + 128, 'plaster_white');
	wall(b, 'y', p.y0 + 16, p.y1 - 16, p.x0, p.x0 + 16, z, z + 128, 'plaster_white');
	wall(b, 'y', p.y0 + 16, p.y1 - 16, p.x1 - 16, p.x1, z, z + 128, 'plaster_white');
	b.box(p.x0, p.y0, z + 128, p.x1, p.y1, z + 144, 'roof_tar');
	b.room('roof penthouse');
	b.as('prop', () => {
		put(b, sofa(112, 'fabric_red'), -2960, 3140, z, 's');
		put(b, tv(), -2948, 2900, z, 'n');
		put(b, table(64, 48, 18, 'glass_dark', 'chrome'), -2944, 3040, z);
		put(b, bed(96, 128, 'linen', 'gold'), -2800, 3050, z, 's');
		put(b, lamp('lampglow'), -2760, 2900, z);
		put(b, plant(56), -2730, 2900, z);
		// "Narnia" wardrobe with the return teleporter inside.
		put(b, wardrobe(true, 'wood_light'), -2860, 2900, z, 'n');
	});
	b.spot('hotel-penthouse', 'Hotel roof: sealed penthouse (fireplace teleporter)', v(-2900, 2980, z), 'teleport', 'room');

	b.as('prop', () => {
		put(b, waterTank(true), -3500, 2200, z, 's');
		put(b, waterTank(), -3300, 2200, z);
		put(b, waterTank(), -2200, 2900, z);
		for (let k = 0; k < 6; k++) put(b, acUnit(), -4100 + k * 120, 3100, z, 's');
		for (let k = 0; k < 4; k++) put(b, acUnit(), -1900 + k * 120, 1900, z);
		put(b, dish(), -1500, 3100, z);
		put(b, dish(), -1600, 3150, z);
		put(b, chair('plastic_white', 'plastic_white'), -2300, 2300, z);
		put(b, table(48, 48, 28, 'plastic_white', 'plastic_white'), -2340, 2340, z);
	});
	b.spot('hotel-tank', 'Hotel roof: inside the water tank', v(-3436, 2264, z + 20), 'prop', 'fake', 'teleport');
	// LIDO letters on the south parapet edge, neon.
	const y0 = IY0 + 8;
	const lz = z;
	const L = (x: number) => {
		b.box(x, y0, lz, x + 16, y0 + 16, lz + 128, 'neon_pink', true, 'prop');
		b.box(x + 16, y0, lz, x + 80, y0 + 16, lz + 16, 'neon_pink', true, 'prop');
	};
	const I = (x: number) => b.box(x, y0, lz, x + 16, y0 + 16, lz + 128, 'neon_pink', true, 'prop');
	const D = (x: number) => {
		b.box(x, y0, lz, x + 16, y0 + 16, lz + 128, 'neon_pink', true, 'prop');
		b.box(x + 16, y0, lz, x + 64, y0 + 16, lz + 16, 'neon_pink', true, 'prop');
		b.box(x + 16, y0, lz + 112, x + 64, y0 + 16, lz + 128, 'neon_pink', true, 'prop');
		b.box(x + 64, y0, lz + 16, x + 80, y0 + 16, lz + 112, 'neon_pink', true, 'prop');
	};
	const O = (x: number) => {
		b.box(x, y0, lz, x + 16, y0 + 16, lz + 128, 'neon_pink', true, 'prop');
		b.box(x + 64, y0, lz, x + 80, y0 + 16, lz + 128, 'neon_pink', true, 'prop');
		b.box(x + 16, y0, lz, x + 64, y0 + 16, lz + 16, 'neon_pink', true, 'prop');
		b.box(x + 16, y0, lz + 112, x + 64, y0 + 16, lz + 128, 'neon_pink', true, 'prop');
	};
	L(-2900);
	I(-2780);
	D(-2720);
	O(-2600);
	b.spot('hotel-sign', 'Hotel roof: behind the LIDO sign', v(-2700, IY0 + 64, z), 'roof');
}

function grounds(b: MapBuilder): void {
	// Entrance canopy (porte-cochère) on four pillars; its roof is a crouch-jump from the taxi.
	const c = rect(-2816, -2560, 1536, 1792);
	b.box(c.x0, c.y0, 120, c.x1, c.y1, 128, 'canopy');
	for (const [x, y] of [
		[c.x0, c.y0],
		[c.x1 - 16, c.y0]
	] as const)
		b.box(x, y, 0, x + 16, y + 16, 120, 'brass');
	b.as('prop', () => {
		put(b, car('car_yellow'), -2960, 1600, 0, 'w');
		put(b, car('car_black'), -2400, 1580, 0, 'w');
		put(b, van('car_white'), -3500, 1560, 0, 'e');
		for (let k = 0; k < 5; k++) put(b, palm(224 + (k % 2) * 48), -4500 + k * 300, 1440, 0);
		put(b, flowerBed(256, 96, 'flower_pink'), -3400, 1680, 0);
		put(b, flowerBed(256, 96, 'flower_yellow'), -2200, 1680, 0);
		for (let k = 0; k < 4; k++) put(b, bench(), -4100 + k * 140, 1720, 0, 'n');
	});
	b.spot('hotel-canopy', 'Hotel entrance: on top of the canopy', v(-2688, 1664, 128), 'roof', 'crouchjump');

	// West garden x [-4608, -4224]: pines, a shed, a hedge.
	b.as('prop', () => {
		for (let k = 0; k < 5; k++) put(b, pine(64 + (k % 3) * 24), -4560, 1840 + k * 300, 0);
		put(b, bench(72), -4400, 2600, 0, 'w');
		put(b, bush(64), -4320, 2200, 0);
		put(b, bush(48), -4320, 2900, 0);
	});
	// Service yard north of the hotel y [3264, 3840].
	b.as('prop', () => {
		put(b, container('container_red', true, false), -3800, 3400, 0, 'w');
		put(b, dumpster(false), -3200, 3740, 0, 's');
		put(b, dumpster(true), -3080, 3740, 0, 's');
		put(b, pallet(true), -2900, 3700, 0);
		put(b, pallet(false), -2840, 3700, 0);
		put(b, crate(48), -2660, 3720, 0);
		put(b, crate(48), -2660, 3768, 0);
		put(b, van('car_blue'), -2400, 3400, 0, 'n');
		put(b, car('car_red'), -2200, 3400, 0, 'n');
		for (let k = 0; k < 4; k++) put(b, barrel('gas', 'steel'), -1800 + k * 44, 3760, 0);
		for (let k = 0; k < 6; k++) put(b, tree(112 + (k % 2) * 32, 72), -4500 + k * 560, 3660, 0);
		put(b, fence(512, 56), -1700, 3500, 0);
	});
	b.spot('hotel-dumpster', 'Hotel service yard: inside the dumpster', v(-3032, 3768, 0), 'prop', 'fake', 'crawl');
	b.spot('hotel-container', 'Hotel service yard: inside the open container', v(-3520, 3448, 4), 'prop');
}
