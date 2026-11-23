/**
 * hns_lido — the old town (west of the plaza): two rows of 2-storey shop
 * houses on a market lane, back yards with sheds and a well, a chapel with a
 * bell tower, a crypt and a graveyard.
 *
 * Region x [-4608, -1792], y [-1408, 1152]. West row x [-3968, -3456], lane
 * x [-3456, -3072], east row x [-3072, -2560], chapel x [-2432, -1920]
 * y [-640, 384] with its tower y [384, 640]. Houses i = 0..4 at
 * y [-1344 + 512 i, -896 + 512 i] (64-wide alleys between them).
 *
 * Secrets: bookshop's fake bookcase → hidden reading room; a walled alley
 * whose lane-end wall has a fake section; a hollow dumpster and a hollow
 * wardrobe; the well (drop in → sewer teleporter); a fake floor in the chapel
 * over the crypt stairs; a hollow sarcophagus in the crypt; the belfry
 * (teleport destination from the maze statue).
 */
import {
	armchair,
	barrel,
	bed,
	bench,
	bin,
	bush,
	chair,
	chimney,
	counter,
	crate,
	desk,
	dumpster,
	fakeShelf,
	fence,
	flight,
	fridge,
	grave,
	kitchen,
	lamp,
	pallet,
	pew,
	plant,
	put,
	rect,
	shelf,
	sofa,
	stall,
	stove,
	streetlamp,
	table,
	tree,
	tv,
	umbrella,
	v,
	wall,
	wardrobe,
	acUnit,
	waterTank,
	dish,
	door,
	fakeHole,
	slab,
	win,
	gap,
	type Face,
	type Hole,
	type MapBuilder,
	type Prop,
	type Rect
} from './hns-props.ts';

export const HOUSE_Y0 = (i: number) => -1344 + 512 * i;
const HT = 16;
const ROOF = 384;
const PARAPET = 400;
export const CHAPEL = rect(-2432, -1920, -640, 384);
export const TOWER = rect(-2304, -2048, 384, 640);
export const WELL = { x: -4288, y: 928 };
export const BELFRY_Z = 480;
export const CRYPT_Z = -192;

type Variant = 'bakery' | 'cafe' | 'bookshop' | 'grocer' | 'home' | 'pharmacy' | 'tailor' | 'bar' | 'antiques' | 'florist';

interface House {
	row: 'W' | 'E';
	i: number;
	variant: Variant;
	terrace: boolean;
	hollowWardrobe?: boolean;
}

const HOUSES: House[] = [
	{ row: 'W', i: 0, variant: 'bakery', terrace: false },
	{ row: 'W', i: 1, variant: 'bookshop', terrace: false },
	{ row: 'W', i: 2, variant: 'cafe', terrace: true },
	{ row: 'W', i: 3, variant: 'home', terrace: false, hollowWardrobe: true },
	{ row: 'W', i: 4, variant: 'grocer', terrace: false },
	{ row: 'E', i: 0, variant: 'pharmacy', terrace: false },
	{ row: 'E', i: 1, variant: 'tailor', terrace: false },
	{ row: 'E', i: 2, variant: 'antiques', terrace: false },
	{ row: 'E', i: 3, variant: 'bar', terrace: true },
	{ row: 'E', i: 4, variant: 'florist', terrace: false }
];

const PLASTER = ['plaster_cream', 'plaster_pink', 'plaster_blue', 'plaster_ochre', 'plaster_white'];

/**
 * House-local coordinates: u = depth from the lane-side front wall (0..512),
 * w = along +y from the house's south wall (0..448).
 */
function houseFrame(b: MapBuilder, h: House) {
	const y0 = HOUSE_Y0(h.i);
	const front = h.row === 'W' ? -3456 : -3072;
	const X = (u: number) => (h.row === 'W' ? front - u : front + u);
	const xr = (u0: number, u1: number): [number, number] => {
		const a = X(u0);
		const c = X(u1);
		return [Math.min(a, c), Math.max(a, c)];
	};
	const faces: Record<'front' | 'back' | 'left' | 'right', Face> =
		h.row === 'W' ? { front: 'e', back: 'w', left: 's', right: 'n' } : { front: 'w', back: 'e', left: 's', right: 'n' };
	/** Place a prop with its footprint at local [u, u + su] × [w, w + sw]. */
	const at = (p: Prop, u: number, w: number, face: keyof typeof faces, z = 0) => {
		const f = faces[face];
		const su = f === 'e' || f === 'w' ? p.d : p.w;
		const [x0] = xr(u, u + su);
		return put(b, p, x0, y0 + w, z, f);
	};
	const box = (u0: number, w0: number, z0: number, u1: number, w1: number, z1: number, mat: string, solid = true) => {
		const [x0, x1] = xr(u0, u1);
		b.box(x0, y0 + w0, z0, x1, y0 + w1, z1, mat, solid);
	};
	const r = (u0: number, u1: number, w0: number, w1: number): Rect => {
		const [x0, x1] = xr(u0, u1);
		return rect(x0, x1, y0 + w0, y0 + w1);
	};
	return { y0, X, xr, at, box, r };
}

function house(b: MapBuilder, h: House): void {
	const hf = houseFrame(b, h);
	const { y0, xr, at, box, r } = hf;
	const mat = PLASTER[(h.i + (h.row === 'E' ? 2 : 0)) % PLASTER.length]!;
	const name = `${h.row}${h.i} ${h.variant}`;
	b.buildings.push(`house ${name}`);
	b.room(`${name} shop`, `${name} upstairs`);
	const [fx0, fx1] = xr(0, 512);
	// Front wall (lane side) and back wall: openings along y.
	const frontHoles: Hole[] = [door(y0 + 192, 0, 64, 104), win(y0 + 48, 0, 112, 32, 144), win(y0 + 288, 0, 112, 32, 144), win(y0 + 64, 192, 96), win(y0 + 288, 192, 96)];
	const backHoles: Hole[] = [door(y0 + 352, 0, 64, 104), win(y0 + 200, 0, 96), win(y0 + 64, 192, 96)];
	const [bf0, bf1] = xr(0, HT);
	const [bb0, bb1] = xr(512 - HT, 512);
	wall(b, 'y', y0, y0 + 448, bf0, bf1, 0, PARAPET, mat, frontHoles);
	wall(b, 'y', y0, y0 + 448, bb0, bb1, 0, PARAPET, mat, backHoles);
	const [sx0, sx1] = xr(HT, 512 - HT);
	const sideHoles: Hole[] = [win(sx0 + 160, 192, 96)];
	wall(b, 'x', sx0, sx1, y0, y0 + HT, 0, PARAPET, mat, sideHoles);
	wall(b, 'x', sx0, sx1, y0 + 448 - HT, y0 + 448, 0, PARAPET, mat, sideHoles);
	// Slabs: 1F (hole over the stairs), roof (hole over the terrace stairs).
	const stairHole = r(400, 480, 32, 336);
	const roofHole = r(304, 384, 96, 400);
	slab(b, r(HT, 512 - HT, HT, 448 - HT), 176, 192, 'floorboards', [stairHole]);
	slab(b, r(HT, 512 - HT, HT, 448 - HT), ROOF - 16, ROOF, 'roof_tar', h.terrace ? [roofHole] : []);
	// Stairs (local +w).
	const [su0, su1] = xr(400, 480);
	flight(b, { x: (su0 + su1) / 2, y: y0 + 48 }, '+y', 12, 80, 0, 'wood_dark');
	if (h.terrace) {
		const [tu0, tu1] = xr(304, 384);
		flight(b, { x: (tu0 + tu1) / 2, y: y0 + 400 }, '-y', 12, 80, 192, 'wood_dark');
	}
	void fx0;
	void fx1;
	// Furniture.
	b.as('prop', () => {
		shop(b, h, hf);
		// Upstairs: bedroom and living.
		const z = 192;
		at(bed(80, 120, 'linen', h.i % 2 ? 'fabric_red' : 'fabric_green'), 24, 24, 'back', z);
		at(wardrobe(!!h.hollowWardrobe), 16, 200, 'back', z);
		at(sofa(112, 'fabric_blue'), 200, 24, 'right', z);
		at(table(64, 48, 18), 224, 96, 'right', z);
		at(tv(), 224, 160, 'left', z);
		at(lamp(), 160, 24, 'right', z);
		at(plant(40), 260, 400, 'left', z);
		if (h.terrace) {
			at(table(64, 64, 30, 'plastic_white', 'plastic_white'), 120, 340, 'left', ROOF);
			at(chair('plastic_white', 'plastic_white'), 90, 360, 'front', ROOF);
			at(chair('plastic_white', 'plastic_white'), 190, 330, 'back', ROOF);
			at(umbrella('canvas_yellow'), 100, 220, 'left', ROOF);
			at(plant(48), 40, 400, 'left', ROOF);
			at(plant(48), 440, 30, 'left', ROOF);
		}
		at(chimney(80), 200, 380, 'left', ROOF);
		if (h.i % 2 === 0) at(acUnit(), 40, 40, 'left', ROOF);
		else at(waterTank(), 40, 40, 'left', ROOF);
		if (h.i === 3) at(dish(), 420, 380, 'left', ROOF);
	});
	if (h.hollowWardrobe) {
		const p = hf.r(16, 72, 200, 272);
		b.spot(`town-wardrobe-${h.row}${h.i}`, `Old town house ${name}: inside the upstairs wardrobe`, v((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, 196), 'prop', 'fake');
	}
	if (h.i === 2 || h.i === 0) b.spot(`town-roof-${h.row}${h.i}`, `Old town house ${name}: behind the chimney on the roof`, v(hf.X(224), y0 + 300, ROOF), 'roof');
}

function shop(b: MapBuilder, h: House, hf: ReturnType<typeof houseFrame>): void {
	// Keep clear: stairs u [400, 480] × w [32, 336]; the path from the back door (w [352, 416]) round them.
	const { at, box } = hf;
	switch (h.variant) {
		case 'bakery':
			at(counter(160, 42, 'wood', 'wood'), 140, 260, 'front');
			at(shelf(160, 96, 3, 'goods', 101), 200, 16, 'right');
			at(stove(), 60, 16, 'right');
			at(stove(), 100, 16, 'right');
			at(crate(48, 'flour'), 300, 80, 'right');
			at(table(64, 48, 32), 200, 100, 'right');
			break;
		case 'bookshop': {
			// Hidden reading room u [256, 384] × w [16, 176] behind a fake bookcase.
			box(240, 16, 0, 256, 72, 176, 'plaster_cream');
			box(240, 136, 0, 256, 192, 176, 'plaster_cream');
			box(240, 72, 104, 256, 136, 176, 'plaster_cream');
			box(256, 176, 0, 400, 192, 176, 'plaster_cream');
			box(384, 16, 0, 400, 176, 176, 'plaster_cream');
			at(fakeShelf(80, 104, 4, 102), 216, 64, 'front');
			at(shelf(48, 104, 4, 'books', 103), 216, 16, 'front');
			at(shelf(48, 104, 4, 'books', 104), 216, 144, 'front');
			at(shelf(160, 120, 5, 'books', 105), 40, 408, 'left');
			at(counter(96, 40), 120, 280, 'front');
			at(table(64, 64, 30), 40, 300, 'front');
			at(armchair('leather'), 300, 32, 'right');
			at(lamp('lampglow'), 352, 32, 'right');
			at(shelf(96, 120, 5, 'books', 106), 270, 152, 'left');
			b.room(`${h.row}${h.i} reading room`);
			const p = hf.r(316, 348, 84, 116);
			b.spot('town-reading-room', 'Old town bookshop: reading room behind the fake bookcase', v((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, 0), 'fake', 'room');
			break;
		}
		case 'cafe':
			for (let k = 0; k < 3; k++) {
				at(table(48, 48, 30, 'marble', 'iron'), 80 + k * 100, 60, 'front');
				at(chair(), 84 + k * 100, 24, 'right');
				at(chair(), 84 + k * 100, 116, 'left');
			}
			at(counter(128, 44, 'marble', 'wood_dark'), 120, 290, 'front');
			at(shelf(160, 64, 2, 'goods', 107, 16), 240, 416, 'left');
			break;
		case 'grocer':
			for (let k = 0; k < 3; k++) at(crate(48, k % 2 ? 'crate' : 'crate_dark'), 60 + k * 56, 32, 'right');
			at(shelf(192, 96, 3, 'goods', 108), 120, 408, 'left');
			at(counter(96, 40), 200, 260, 'front');
			at(barrel(), 300, 40, 'right');
			at(barrel(), 344, 40, 'right');
			break;
		case 'home':
			at(kitchen(192), 120, 400, 'left');
			at(fridge(), 330, 400, 'left');
			at(table(96, 64, 30), 200, 60, 'front');
			at(chair(), 205, 30, 'right');
			at(chair(), 235, 30, 'right');
			at(sofa(96, 'fabric_red'), 290, 24, 'right');
			break;
		case 'pharmacy':
			at(counter(128, 42, 'plastic_white', 'plastic_white'), 180, 40, 'front');
			at(shelf(192, 112, 4, 'goods', 109), 40, 408, 'left');
			at(shelf(160, 112, 4, 'goods', 110), 220, 16, 'right');
			break;
		case 'tailor':
			at(table(128, 64, 34, 'wood', 'wood'), 120, 40, 'front');
			for (let k = 0; k < 4; k++) at(crate(24, 'mannequin', 72), 80 + k * 56, 330, 'left');
			at(shelf(160, 112, 4, 'boxes', 111), 200, 408, 'left');
			break;
		case 'antiques':
			at(wardrobe(false, 'wood'), 80, 24, 'right');
			at(wardrobe(false, 'wood_dark'), 170, 24, 'right');
			at(armchair('fabric_green'), 100, 340, 'left');
			at(table(64, 64, 30, 'wood_dark', 'wood_dark'), 200, 330, 'left');
			at(lamp(), 280, 340, 'left');
			at(crate(48, 'crate_dark'), 300, 40, 'right');
			at(barrel('cask', 'iron'), 340, 380, 'left');
			break;
		case 'bar':
			at(counter(256, 44, 'wood', 'wood_dark'), 260, 64, 'back');
			for (let k = 0; k < 3; k++) at(table(48, 48, 30), 60 + k * 64, 300, 'left');
			at(barrel('cask', 'iron'), 300, 380, 'left');
			at(barrel('cask', 'iron'), 344, 380, 'left');
			break;
		case 'florist':
			for (let k = 0; k < 5; k++) at(plant(40 + (k % 3) * 12), 40 + k * 40, 24, 'right');
			for (let k = 0; k < 4; k++) at(plant(56), 40 + k * 40, 400, 'left');
			at(counter(128, 40), 200, 260, 'front');
			at(table(96, 48, 30, 'wood', 'wood'), 300, 120, 'front');
			break;
	}
}

export function buildTown(b: MapBuilder, holes: Rect[]): void {
	for (const h of HOUSES) house(b, h);
	lane(b);
	alleys(b);
	yards(b, holes);
	chapel(b, holes);
	graveyard(b);
	b.loops.push(
		'Old town: through a shop (front door → back door) → back yards → next alley → lane',
		'Old town rooftops: café terrace stairs → jump the 64 alleys from roof to roof',
		'Old town lane: round the market stalls',
		'Chapel: south door → nave → east door → graveyard → south door'
	);
}

function lane(b: MapBuilder): void {
	b.as('prop', () => {
		const stripes: Array<[string, string]> = [
			['canvas_red', 'canvas_white'],
			['canvas_blue', 'canvas_white'],
			['canvas_yellow', 'canvas_white'],
			['canvas_green', 'canvas_white']
		];
		for (let k = 0; k < 8; k++) {
			const y = -1280 + k * 300;
			put(b, stall(stripes[k % 4]!), -3328 + (k % 2) * 128 - 64, y, 0, k % 2 ? 'e' : 'w');
		}
		for (let k = 0; k < 6; k++) {
			put(b, streetlamp(), -3448, -1200 + k * 448, 0);
			put(b, streetlamp(), -3096, -1000 + k * 448, 0);
		}
		for (let k = 0; k < 5; k++) {
			put(b, barrel(), -3440, -1100 + k * 512, 0);
			put(b, bin(), -3130, -1250 + k * 512, 0);
			put(b, crate(40), -3440, -1050 + k * 512, 0);
		}
		put(b, bench(), -3240, -1390, 0, 'n');
		put(b, bench(), -3240, 1110, 0, 's');
	});
}

/** Alleys between houses (64 wide). The one between east houses 3 and 4 is walled with a fake section. */
function alleys(b: MapBuilder): void {
	// Walled alley y [640, 704] between E3 and E4: lane end wall (fake middle), far end wall.
	const y0 = HOUSE_Y0(3) + 448;
	const y1 = HOUSE_Y0(4);
	wall(b, 'y', y0, y1, -3072, -3056, 0, 176, 'brick', [fakeHole(y0, 0, 64, 104, 'brick')]);
	b.box(-2576, y0, 0, -2560, y1, 176, 'brick');
	b.as('prop', () => {
		put(b, crate(48), -2900, y0 + 8, 0);
		put(b, bench(48), -2760, y0 + 8, 0, 'n');
		put(b, barrel(), -2680, y0 + 12, 0);
	});
	b.room('walled alley');
	b.spot('town-alley', 'Old town: walled alley behind a fake brick wall', v(-2830, y0 + 32, 0), 'fake', 'room');
	// Hollow dumpster in the back yard of W1 (front faces east, towards the house).
	const dy = HOUSE_Y0(1) + 150;
	b.as('prop', () => {
		put(b, dumpster(true), -4100, dy, 0, 'e');
		put(b, bin('plastic_blue'), -3700, HOUSE_Y0(0) + 468, 0);
		put(b, crate(40), -3600, HOUSE_Y0(0) + 460, 0);
	});
	b.spot('town-dumpster', 'Old town back yard: inside the dumpster', v(-4100 + 28, dy + 48, 4), 'prop', 'fake', 'crawl');
}

function yards(b: MapBuilder, holes: Rect[]): void {
	// Fences between yards (with a gap near the house so yards connect).
	b.as('prop', () => {
		for (let i = 0; i < 5; i++) {
			const y = HOUSE_Y0(i) - 32;
			if (i > 0) put(b, fence(384, 48, 'wood_light'), -4608 + 32, y, 0);
			// Shed, washing line, tree.
			if (i % 2 === 0) put(b, crate(64, 'shed', 112), -4560, HOUSE_Y0(i) + 40, 0);
			put(b, tree(120, 72), -4600, HOUSE_Y0(i) + 240, 0);
			b.box(-4320, HOUSE_Y0(i) + 100, 0, -4316, HOUSE_Y0(i) + 104, 96, 'wood');
			b.box(-4320, HOUSE_Y0(i) + 300, 0, -4316, HOUSE_Y0(i) + 304, 96, 'wood');
			b.box(-4319, HOUSE_Y0(i) + 104, 92, -4317, HOUSE_Y0(i) + 300, 93, 'chain');
			for (let k = 0; k < 3; k++) b.box(-4320, HOUSE_Y0(i) + 130 + k * 56, 60, -4316, HOUSE_Y0(i) + 170 + k * 56, 92, k % 2 ? 'linen' : 'fabric_blue');
			put(b, bin(), -4000, HOUSE_Y0(i) + 380, 0);
		}
		put(b, pallet(true), -4200, -1380, 0);
		put(b, bush(64), -4100, 1080, 0);
	});
	// The well: rim (40 tall) around a 64 × 64 shaft down to -160; a teleporter at the bottom.
	const { x, y } = WELL;
	const hole = rect(x - 32, x + 32, y - 32, y + 32);
	holes.push(hole);
	b.box(x - 64, y - 64, 0, x + 64, y - 32, 40, 'stone');
	b.box(x - 64, y + 32, 0, x + 64, y + 64, 40, 'stone');
	b.box(x - 64, y - 32, 0, x - 32, y + 32, 40, 'stone');
	b.box(x + 32, y - 32, 0, x + 64, y + 32, 40, 'stone');
	// Shaft below ground.
	b.box(x - 48, y - 48, -176, x + 48, y - 32, 0 - 32, 'stone_dark');
	b.box(x - 48, y + 32, -176, x + 48, y + 48, -32, 'stone_dark');
	b.box(x - 48, y - 32, -176, x - 32, y + 32, -32, 'stone_dark');
	b.box(x + 32, y - 32, -176, x + 48, y + 32, -32, 'stone_dark');
	b.box(x - 32, y - 32, -176, x + 32, y + 32, -160, 'stone_dark');
	b.fake(x - 32, y - 32, -160, x + 32, y + 32, -150, 'well_water');
	// Ground-level ring under the rim to close the slab hole edges.
	b.as('prop', () => {
		for (const [px, py] of [
			[x - 64, y - 64],
			[x + 60, y - 64],
			[x - 64, y + 60],
			[x + 60, y + 60]
		] as const)
			b.box(px, py, 40, px + 4, py + 4, 160, 'wood');
		b.box(x - 72, y - 72, 160, x + 72, y + 72, 168, 'roof_tile');
		b.box(x - 4, y - 64, 120, x + 4, y + 64, 124, 'wood');
	});
}

function chapel(b: MapBuilder, holes: Rect[]): void {
	const c = CHAPEL;
	holes.push(c, TOWER);
	b.buildings.push('chapel');
	b.room('chapel nave', 'crypt', 'tower base', 'belfry');
	const t = 24;
	const top = 320;
	const zb = CRYPT_Z - 16;
	// South facade: door; long walls: tall stained windows; east side door.
	const sH: Hole[] = [door(-2224, 0, 96, 144), win(-2368, 0, 64, 96, 256), win(-2048, 0, 64, 96, 256)];
	wall(b, 'x', c.x0, c.x1, c.y0, c.y0 + t, zb, top, 'stone', sH.map((h) => (h.fill === 'glass' ? { ...h, mat: 'glass_stained' } : h)));
	// North wall (to the tower base): door into the tower.
	wall(b, 'x', c.x0, c.x1, c.y1 - t, c.y1, zb, top, 'stone', [door(-2208, 0, 64, 112)]);
	const longHoles = (east: boolean): Hole[] => {
		const hs: Hole[] = [];
		for (let k = 0; k < 4; k++) hs.push(win(-560 + k * 224, 0, 64, 96, 256));
		if (east) hs.push(door(-160, 0, 64, 112));
		return hs;
	};
	wall(b, 'y', c.y0 + t, c.y1 - t, c.x0, c.x0 + t, zb, top, 'stone', longHoles(false));
	wall(b, 'y', c.y0 + t, c.y1 - t, c.x1 - t, c.x1, zb, top, 'stone', longHoles(true));
	const inner = rect(c.x0 + t, c.x1 - t, c.y0 + t, c.y1 - t);
	// Nave floor with a hole over the crypt stairs, covered by a fake floor panel.
	const stair = rect(-2408, -2312, 64, 352);
	slab(b, inner, -16, 0, 'stone_floor', [stair]);
	b.fake(stair.x0, stair.y0, -16, stair.x1, stair.y1, 0, 'stone_floor');
	flight(b, { x: (stair.x0 + stair.x1) / 2, y: stair.y0 }, '+y', 12, 96, CRYPT_Z, 'stone_dark');
	slab(b, inner, zb, CRYPT_Z, 'stone_dark');
	slab(b, c, top, top + 16, 'stone');
	// Pitched roof on the flat roof.
	b.brushes.push({ type: 'ramp', from: v((c.x0 + c.x1) / 2, c.y0, top + 160), to: v((c.x0 + c.x1) / 2, c.y1, top + 160), height: 144, halfWidth: 256, side: 'both', material: 'roof_slate' });
	b.kinds.push('struct');
	b.as('prop', () => {
		for (let r = 0; r < 6; r++) {
			const y = -500 + r * 96;
			put(b, pew(160), -2380, y, 0, 'n');
			put(b, pew(160), -2132, y, 0, 'n');
		}
		// Altar platform and altar.
		b.box(-2304, 200, 0, -2048, 320, 16, 'marble');
		b.box(-2224, 260, 16, -2128, 300, 52, 'marble');
		b.box(-2232, 252, 52, -2120, 308, 56, 'gold');
		for (const x of [-2290, -2070]) {
			b.box(x, 290, 16, x + 8, 298, 80, 'brass');
			b.box(x - 2, 288, 80, x + 10, 300, 84, 'lampglow');
		}
		put(b, crate(48, 'organ', 112), -2000, 200, 0);
	});
	b.spot('chapel-crypt-stairs', 'Chapel: under the fake floor, on the crypt stairs', v(-2360, 128, CRYPT_Z + 64), 'fake', 'under');
	// Crypt: pillars, tombs, a hollow sarcophagus (fake side, duck inside).
	b.as('prop', () => {
		for (let r = 0; r < 3; r++)
			for (const x of [-2240, -2112]) b.box(x, -480 + r * 256, CRYPT_Z, x + 32, -448 + r * 256, -16, 'stone_dark');
		for (let k = 0; k < 3; k++) {
			b.box(-2400, -560 + k * 200, CRYPT_Z, -2336, -432 + k * 200, CRYPT_Z + 40, 'stone_dark');
			b.box(-2016, -560 + k * 200, CRYPT_Z, -1952, -432 + k * 200, CRYPT_Z + 40, 'stone_dark');
		}
		for (let k = 0; k < 4; k++) put(b, barrel('cask', 'iron'), -1990, 100 + k * 44, CRYPT_Z);
		put(b, crate(48, 'crate_dark'), -2200, 280, CRYPT_Z);
		put(b, lamp('lampglow'), -2300, -600, CRYPT_Z);
	});
	// Sarcophagus x [-2196, -2132] y [-200, -72]: 4-thick shell, fake west side, 60 tall inside.
	const sx = -2196;
	const sy = -200;
	b.box(sx, sy, CRYPT_Z, sx + 64, sy + 128, CRYPT_Z + 4, 'marble');
	b.box(sx, sy, CRYPT_Z + 4, sx + 64, sy + 4, CRYPT_Z + 64, 'marble');
	b.box(sx, sy + 124, CRYPT_Z + 4, sx + 64, sy + 128, CRYPT_Z + 64, 'marble');
	b.box(sx + 60, sy + 4, CRYPT_Z + 4, sx + 64, sy + 124, CRYPT_Z + 64, 'marble');
	b.fake(sx, sy + 4, CRYPT_Z + 4, sx + 4, sy + 124, CRYPT_Z + 64, 'marble');
	b.box(sx - 4, sy - 4, CRYPT_Z + 64, sx + 68, sy + 132, CRYPT_Z + 72, 'marble');
	b.spot('crypt-sarcophagus', 'Chapel crypt: inside the sarcophagus', v(sx + 32, sy + 64, CRYPT_Z + 4), 'prop', 'fake', 'crawl');
	b.spot('crypt', 'Chapel crypt: behind the tombs', v(-1980, -400, CRYPT_Z), 'room');

	// Tower: base room (door from the nave), belfry at 480 (teleport destination).
	const tw = TOWER;
	const ttop = 656;
	wall(b, 'x', tw.x0, tw.x1, tw.y1 - t, tw.y1, 0, ttop, 'stone', [gap(-2224, BELFRY_Z + 32, 96, BELFRY_Z + 128)]);
	wall(b, 'y', tw.y0, tw.y1 - t, tw.x0, tw.x0 + t, 0, ttop, 'stone', [gap(464, BELFRY_Z + 32, 96, BELFRY_Z + 128)]);
	wall(b, 'y', tw.y0, tw.y1 - t, tw.x1 - t, tw.x1, 0, ttop, 'stone', [gap(464, BELFRY_Z + 32, 96, BELFRY_Z + 128)]);
	// South side of the tower above the chapel roof.
	wall(b, 'x', tw.x0 + t, tw.x1 - t, tw.y0, tw.y0 + t, top + 16, ttop, 'stone', [gap(-2224, BELFRY_Z + 32, 96, BELFRY_Z + 128)]);
	const tin = rect(tw.x0 + t, tw.x1 - t, tw.y0, tw.y1 - t);
	slab(b, tin, -16, 0, 'stone_floor');
	slab(b, rect(tin.x0, tin.x1, tw.y0 + t, tin.y1), BELFRY_Z - 16, BELFRY_Z, 'floorboards');
	slab(b, tw, ttop, ttop + 16, 'roof_slate');
	b.box(tw.x0 + 96, tw.y0 + 96, ttop + 16, tw.x1 - 96, tw.y1 - 96, ttop + 128, 'roof_slate');
	b.as('prop', () => {
		// Bell on a beam.
		b.box(tw.x0 + t, 508, 600, tw.x1 - t, 516, 608, 'wood_dark');
		b.box(-2208, 488, 560, -2144, 536, 600, 'bronze');
		b.box(-2200, 496, 540, -2152, 528, 560, 'bronze');
		put(b, crate(40), -2260, 420, 0);
		put(b, barrel(), -2120, 560, 0);
		put(b, crate(32, 'crate_dark'), -2270, 420, BELFRY_Z);
	});
	b.spot('belfry', 'Chapel tower: the belfry (teleporter from the maze)', v(-2112, 440, BELFRY_Z), 'teleport', 'roof');
}

function graveyard(b: MapBuilder): void {
	b.as('prop', () => {
		for (let r = 0; r < 4; r++)
			for (let c = 0; c < 6; c++) {
				if ((r + c) % 5 === 4) continue;
				put(b, grave(), -2420 + c * 84, -1320 + r * 150, 0, 'n');
			}
		put(b, tree(160, 88, 'leaf_dark'), -1990, -1000, 0);
		put(b, tree(140, 80, 'leaf_dark'), -2540, -800, 0);
		put(b, bench(), -2400, -720, 0, 's');
		put(b, fence(512, 40, 'iron'), -2432, -1400, 0);
		put(b, bush(64), -1900, -1300, 0);
		put(b, bush(48), -1880, 900, 0);
		put(b, tree(128, 72), -2500, 800, 0);
		put(b, tree(128, 72), -1960, 700, 0);
		put(b, plant(48), -2420, 1080, 0);
	});
}
