/**
 * hns_lido — the coast (south): sea (knee-deep water over a sandy seabed),
 * shore steps, the beach with beach huts on stilts, a lifeguard tower,
 * umbrellas and sunbeds, a volleyball court, the beach bar, the boathouse,
 * the pier with its arcade pavilion, the rocks with the lighthouse and a
 * sea cave, and the promenade.
 *
 * Sea y [-3840, -3072] (seabed top -48, water surface -16); shore steps
 * y [-3072, -2976]; beach y [-2976, -1664] (sand at 0); promenade
 * y [-1664, -1408]. Rocks x [-4608, -3584], y [-3840, -2976], top 64.
 *
 * Secrets: crawlspace under the beach huts; a hut with a hidden back
 * compartment; the hut changing cubicle (visible teleporter pair with the
 * pool house); the lifeguard cabin roof (crouch-jump); the beach bar roof
 * (crate chain + crouch-jump); a hollow covered boat and a hollow crate
 * (teleporter → lighthouse gallery) in the boathouse; under the pier; a
 * hollow arcade cabinet (teleporter → sea cave); the sea cave behind a fake
 * rock face; the lighthouse gallery.
 */
import type { LidoVariant } from './hns_lido-variant.ts';
import {
	barrel,
	bench,
	bin,
	boat,
	chair,
	counter,
	crate,
	flight,
	keg,
	lifebuoy,
	palm,
	phoneBox,
	plant,
	poolTable,
	put,
	putC,
	rect,
	railing,
	shelf,
	stool,
	streetlamp,
	sunbed,
	surfboard,
	table,
	umbrella,
	arcade,
	v,
	wall,
	door,
	fakeHole,
	gap,
	slab,
	win,
	type Hole,
	type MapBuilder,
	type Rect
} from './hns-props.ts';

export const SEA = rect(-3584, 4608, -3840, -3072);
export const ROCKS = rect(-4608, -3584, -3840, -2976);
export const CAVE = rect(-3968, -3616, -3712, -3392);
export const LIGHTHOUSE = rect(-4352, -4096, -3648, -3392);
export const LAMP_Z = 576;
export const PIER = rect(896, 1088, -3520, -2856);
export const PAVILION = rect(800, 1184, -3776, -3520);
export const BOATHOUSE = rect(3584, 4416, -2944, -2368);
export const HUT_X0 = (i: number) => -3456 + 224 * i;
export const HUT_Y0 = -2176;
export const HUT_FLOOR = 72;
export const PHONE_PROM = { x: -704, y: -1600 };
const SEABED = -48;
const DECK = 48;

export function buildCoast(b: MapBuilder, variant: LidoVariant): void {
	const medium = variant.size === 'medium';
	sea(b);
	rocks(b);
	lighthouse(b);
	huts(b, medium);
	lifeguard(b);
	beachProps(b, medium);
	if (!medium) {
		beachBar(b);
		boathouse(b);
	}
	pier(b);
	promenade(b);
	b.loops.push(
		'Beach: under the hut row (duck) → round the huts → up a hut and out',
		'Pier: deck → pavilion → jump down into the sea → under the pier → shore',
		'Lighthouse: spiral up → gallery → drop to the rocks → stairs to the beach'
	);
}

function sea(b: MapBuilder): void {
	b.as('ground', () => {
		b.box(SEA.x0, SEA.y0, SEABED - 32, SEA.x1, SEA.y1, SEABED, 'seabed');
		b.fake(SEA.x0, SEA.y0, SEABED, SEA.x1, SEA.y1, -16, 'water');
		const tops = [-36, -24, -12];
		for (let k = 0; k < 3; k++) {
			const y0 = -3072 + 32 * k;
			b.box(SEA.x0, y0, SEABED - 32, SEA.x1, y0 + 32, tops[k]!, k === 2 ? 'sandwet' : 'seabed');
			if (tops[k]! < -16) b.fake(SEA.x0, y0, tops[k]!, SEA.x1, y0 + 32, -16, 'water');
		}
	});
	b.as('prop', () => {
		put(b, boat(false, 'boat_blue'), 2400, -3500, SEABED, 'w');
		put(b, boat(false, 'boat'), -2400, -3360, SEABED, 'e');
		for (const [x, y] of [
			[-1200, -3600],
			[1800, -3700],
			[3400, -3400]
		] as const)
			b.box(x, y, SEABED, x + 24, y + 24, 8, 'buoy');
	});
	b.spot('sea-boat', 'Sea: crouched behind the moored boat', v(2480, -3400, SEABED), 'water');
}

function rocks(b: MapBuilder): void {
	const r = ROCKS;
	const face = rect(-3616, -3584, -3616, -3488);
	b.as('ground', () => {
		b.box(r.x0, r.y0, -80, r.x1, r.y1, SEABED, 'rock');
		slab(b, r, SEABED, 48, 'rock', [CAVE, face]);
		b.fake(face.x0, face.y0, SEABED, face.x1, face.y1, 48, 'rock');
		b.box(r.x0, r.y0, 48, r.x1, r.y1, 64, 'rock_top');
	});
	b.room('sea cave');
	// Boulders on the rock top.
	b.as('prop', () => {
		for (const [x, y, s] of [
			[-3700, -3100, 64],
			[-3660, -3760, 80],
			[-4560, -3060, 96],
			[-3900, -3200, 48]
		] as const)
			b.box(x, y, 64, x + s, y + s, 64 + s * 0.6, 'rock');
		// Smugglers' stash in the cave.
		put(b, crate(48), -3940, -3700, SEABED);
		put(b, crate(48), -3940, -3652, SEABED);
		put(b, barrel(), -3880, -3700, SEABED);
		put(b, crate(40, 'gold'), -3700, -3440, SEABED);
		put(b, barrel(), -3760, -3436, SEABED);
	});
	flight(b, { x: -3800, y: -2904 }, '-y', 3, 128, 0, 'rock');
	b.spot('sea-cave', 'Sea cave behind the fake rock face (walk in from the sea)', v(-3800, -3560, SEABED), 'fake', 'room');
}

function lighthouse(b: MapBuilder): void {
	const L = LIGHTHOUSE;
	const z0 = 64;
	const t = 16;
	b.buildings.push('lighthouse');
	b.room('lighthouse stairs', 'lamp room');
	// Striped walls in 64-tall bands; entrance on the east, small windows.
	const holesE: Hole[] = [door(-3552, z0, 64, 104), win(-3552, 320, 64, 0, 64)];
	const holesW: Hole[] = [win(-3552, 200, 64, 0, 64), win(-3552, 440, 64, 0, 64)];
	const holesN: Hole[] = [win(-4256, 260, 64, 0, 64)];
	const holesS: Hole[] = [win(-4256, 380, 64, 0, 64)];
	for (let z = z0, k = 0; z < LAMP_Z; z += 64, k++) {
		const mat = k % 2 ? 'lh_red' : 'lh_white';
		const z1 = Math.min(LAMP_Z, z + 64);
		wall(b, 'x', L.x0, L.x1, L.y0, L.y0 + t, z, z1, mat, holesS);
		wall(b, 'x', L.x0, L.x1, L.y1 - t, L.y1, z, z1, mat, holesN);
		wall(b, 'y', L.y0 + t, L.y1 - t, L.x0, L.x0 + t, z, z1, mat, holesW);
		wall(b, 'y', L.y0 + t, L.y1 - t, L.x1 - t, L.x1, z, z1, mat, holesE);
	}
	// Spiral: 8 ring cells round a 64 core; cell c holds steps k with (k + 1) % 8 = c.
	const ix0 = L.x0 + t;
	const iy0 = L.y0 + t;
	const cells: Rect[] = [
		rect(ix0 + 144, ix0 + 224, iy0 + 80, iy0 + 144), // 0 E (entrance)
		rect(ix0 + 144, ix0 + 224, iy0 + 144, iy0 + 224), // 1 NE
		rect(ix0 + 80, ix0 + 144, iy0 + 144, iy0 + 224), // 2 N
		rect(ix0, ix0 + 80, iy0 + 144, iy0 + 224), // 3 NW
		rect(ix0, ix0 + 80, iy0 + 80, iy0 + 144), // 4 W
		rect(ix0, ix0 + 80, iy0, iy0 + 80), // 5 SW
		rect(ix0 + 80, ix0 + 144, iy0, iy0 + 80), // 6 S
		rect(ix0 + 144, ix0 + 224, iy0, iy0 + 80) // 7 SE
	];
	const core = rect(ix0 + 80, ix0 + 144, iy0 + 80, iy0 + 144);
	b.box(core.x0, core.y0, z0, core.x1, core.y1, LAMP_Z, 'lh_white');
	const steps = (LAMP_Z - z0) / 16;
	const openCells = new Set<number>();
	for (let k = 0; k < steps; k++) {
		const c = cells[(k + 1) % 8]!;
		const top = z0 + 16 * (k + 1);
		b.box(c.x0, c.y0, top - 16, c.x1, c.y1, top, 'stair');
		if (top + 72 > LAMP_Z - 16 && top < LAMP_Z) openCells.add((k + 1) % 8);
	}
	// Lamp room floor: core top + the cells not open to the stairwell.
	for (let i = 0; i < 8; i++) if (!openCells.has(i) && i !== 0) b.box(cells[i]!.x0, cells[i]!.y0, LAMP_Z - 16, cells[i]!.x1, cells[i]!.y1, LAMP_Z, 'floorboards');
	// Lamp room: glass walls above the tower, door north to the gallery.
	const lz1 = LAMP_Z + 128;
	wall(b, 'x', L.x0, L.x1, L.y0, L.y0 + t, LAMP_Z, lz1, 'glass');
	wall(b, 'x', L.x0, L.x1, L.y1 - t, L.y1, LAMP_Z, lz1, 'glass', [door(-4240, LAMP_Z, 64, 104)]);
	wall(b, 'y', L.y0 + t, L.y1 - t, L.x0, L.x0 + t, LAMP_Z, lz1, 'glass');
	wall(b, 'y', L.y0 + t, L.y1 - t, L.x1 - t, L.x1, LAMP_Z, lz1, 'glass');
	b.box(L.x0 - 16, L.y0 - 16, lz1, L.x1 + 16, L.y1 + 16, lz1 + 16, 'lh_red');
	b.box(L.x0 + 64, L.y0 + 64, lz1 + 16, L.x1 - 64, L.y1 - 64, lz1 + 64, 'lh_red');
	b.box(core.x0 + 16, core.y0 + 16, LAMP_Z, core.x1 - 16, core.y1 - 16, LAMP_Z + 56, 'lampglow', true, 'prop');
	// Gallery ring with a railing.
	const g = rect(L.x0 - 64, L.x1 + 64, L.y0 - 64, L.y1 + 64);
	slab(b, g, LAMP_Z - 16, LAMP_Z, 'iron', [L]);
	railing(b, 'x', g.x0, g.x1, g.y0 + 2, LAMP_Z, 'iron');
	railing(b, 'x', g.x0, g.x1, g.y1 - 2, LAMP_Z, 'iron');
	railing(b, 'y', g.y0 + 4, g.y1 - 4, g.x0 + 2, LAMP_Z, 'iron');
	railing(b, 'y', g.y0 + 4, g.y1 - 4, g.x1 - 2, LAMP_Z, 'iron');
	b.spot('lighthouse-gallery', 'Lighthouse: the gallery round the lamp room', v(L.x0 - 32, (L.y0 + L.y1) / 2, LAMP_Z), 'roof', 'teleport');
	b.spot('lighthouse-lamp', 'Lighthouse: lamp room behind the lamp', v(ix0 + 112, iy0 + 184, LAMP_Z), 'roof');
}

function huts(b: MapBuilder, medium: boolean): void {
	const mats = ['hut_red', 'hut_blue', 'hut_yellow', 'hut_green', 'hut_white', 'hut_red', 'hut_blue', 'hut_yellow'];
	for (let i = 0; i < 8; i++) {
		const x0 = HUT_X0(i);
		const x1 = x0 + 160;
		const y0 = HUT_Y0;
		const y1 = y0 + 160;
		const m = mats[i]!;
		const fz = HUT_FLOOR;
		const cubicle = i === 0 || (medium && i === 7);
		b.buildings.push(`beach hut ${i}`);
		b.room(`beach hut ${i}`);
		// Stilts (duck-only crawlspace under the floor: 60 clear).
		for (const px of [x0, x0 + 72, x1 - 16])
			for (const py of [y0, y1 - 16]) b.box(px, py, 0, px + 16, py + 16, fz - 12, 'wood_dark');
		b.box(x0, y0, fz - 12, x1, y1, fz, 'planks');
		wall(b, 'x', x0, x1, y0, y0 + 8, fz, fz + 112, m, [door(x0 + 48, fz, 64, 104)]);
		wall(b, 'x', x0, x1, y1 - 8, y1, fz, fz + 112, m, [win(x0 + 56, fz, 48, 56, 88)]);
		b.box(x0, y0 + 8, fz, x0 + 8, y1 - 8, fz + 112, m);
		b.box(x1 - 8, y0 + 8, fz, x1, y1 - 8, fz + 112, m);
		b.box(x0 - 8, y0 - 8, fz + 112, x1 + 8, y1 + 8, fz + 120, 'roof_tile');
		b.brushes.push({ type: 'ramp', from: v(x0 - 8, (y0 + y1) / 2, fz + 168), to: v(x1 + 8, (y0 + y1) / 2, fz + 168), height: 48, halfWidth: 88, side: 'both', material: 'roof_tile' });
		b.kinds.push('struct');
		flight(b, { x: x0 + 80, y: y0 - 96 }, '+y', 4, 64, 0, 'planks', 18);
		b.as('prop', () => {
			if (i !== 5) put(b, bench(cubicle ? 56 : 112, 'wood_light'), x0 + 24, y1 - 32, fz, 's');
			put(b, surfboard(i % 2 ? 'plastic_yellow' : 'plastic_blue'), x0 + 8, y0 + 40, fz, 'e');
			if (i % 3 === 1) put(b, crate(24, 'plastic_red'), x1 - 40, y0 + 20, fz);
		});
		if (cubicle) {
			// Changing cubicle with a teleporter (large: to the pool house; medium: first hut ↔ last hut).
			b.box(x0 + 84, y1 - 88, fz, x0 + 88, y1 - 8, fz + 112, 'wood_light');
			wall(b, 'x', x0 + 88, x1 - 8, y1 - 92, y1 - 88, fz, fz + 112, 'wood_light', [{ a: x0 + 88, b: x1 - 8, z0: fz, z1: fz + 104, fill: 'fake', mat: 'curtain' }]);
		}
		if (i === 5) {
			// Hidden back compartment (48 deep) behind a partition with a fake section.
			wall(b, 'x', x0 + 8, x1 - 8, y1 - 64, y1 - 56, fz, fz + 112, m, [fakeHole(x0 + 48, fz, 64, 104, m)]);
			b.spot('hut-compartment', 'Beach hut 5: hidden compartment behind the back panel', v(x0 + 112, y1 - 32, fz), 'fake', 'room');
		}
	}
	b.crawl('huts', v(HUT_X0(2) + 44, HUT_Y0 + 140, 0), v(HUT_X0(2) + 44, HUT_Y0 + 24, 0));
	b.spot('under-huts', 'Beach: crawlspace under hut 3', v(HUT_X0(3) + 44, HUT_Y0 + 80, 0), 'crawl', 'under');
}

function lifeguard(b: MapBuilder): void {
	const p = rect(-928, -736, -2592, -2400);
	const z = 160;
	b.buildings.push('lifeguard tower');
	for (const [x, y] of [
		[p.x0, p.y0],
		[p.x1 - 16, p.y0],
		[p.x0, p.y1 - 16],
		[p.x1 - 16, p.y1 - 16]
	] as const)
		b.box(x, y, 0, x + 16, y + 16, z - 16, 'wood_light');
	b.box(p.x0, p.y0, z - 16, p.x1, p.y1, z, 'planks');
	flight(b, { x: -688, y: -2712 }, '+y', 10, 96, 0, 'planks');
	const c = rect(-896, -800, -2560, -2464);
	wall(b, 'x', c.x0, c.x1, c.y0, c.y0 + 8, z, z + 84, 'hut_white', [door(c.x0 + 16, z, 64, 80)]);
	wall(b, 'x', c.x0, c.x1, c.y1 - 8, c.y1, z, z + 84, 'hut_white', [win(c.x0 + 16, z, 64, 40, 72)]);
	b.box(c.x0, c.y0 + 8, z, c.x0 + 8, c.y1 - 8, z + 84, 'hut_white');
	b.box(c.x1 - 8, c.y0 + 8, z, c.x1, c.y1 - 8, z + 84, 'hut_white');
	b.box(c.x0, c.y0, z + 84, c.x1, c.y1, z + 96, 'plastic_red');
	b.room('lifeguard cabin');
	b.as('prop', () => {
		// Cool box: the step for a crouch-jump onto the cabin roof (196 → 256).
		b.box(-792, -2520, z, -756, -2484, z + 36, 'plastic_blue');
		put(b, chair('plastic_white', 'plastic_white'), -880, -2540, z);
		put(b, lifebuoy(), -776, -2420, z, 's');
	});
	b.spot('lifeguard-roof', 'Lifeguard tower: on the cabin roof', v(-848, -2512, z + 96), 'roof', 'crouchjump');
}

function beachProps(b: MapBuilder, medium: boolean): void {
	const avoid = [
		rect(-960, -620, -2740, -2380),
		rect(840, 1150, -2976, -2600),
		rect(1500, 2340, -2600, -2140),
		rect(2650, 3300, -2280, -1700),
		rect(3540, 4460, -2990, -2330),
		rect(-3900, -3700, -2990, -2880)
	];
	// The rocks at the medium size's cut-off beach end.
	if (medium) avoid.push(rect(1040, 1280, -2990, -1664));
	const free = (r: Rect) => !avoid.some((a) => r.x0 < a.x1 && a.x0 < r.x1 && r.y0 < a.y1 && a.y0 < r.y1);
	const canv = ['canvas_red', 'canvas_blue', 'canvas_yellow', 'canvas_green'];
	let k = 0;
	b.as('prop', () => {
		for (const y of [-2760, -2440])
			for (let x = -3400; x <= 3200; x += 352) {
				const r = rect(x, x + 96, y, y + 96);
				const s = rect(x + 104, x + 168, y, y + 80);
				if (!free(r) || !free(s)) continue;
				put(b, umbrella(canv[k % 4]!), x, y, 0);
				put(b, sunbed('plastic_white', k % 2 ? 'fabric_red' : 'fabric_blue'), x + 104, y + 4, 0, 'n');
				put(b, sunbed('plastic_white', 'fabric_green'), x + 140, y + 4, 0, 'n');
				k++;
			}
		// Volleyball court.
		b.box(1600, -2372, 0, 1608, -2364, 128, 'iron');
		b.box(2232, -2372, 0, 2240, -2364, 128, 'iron');
		b.box(1608, -2370, 88, 2232, -2366, 128, 'net');
		for (const [x0, y0, x1, y1] of [
			[1560, -2560, 2280, -2552],
			[1560, -2184, 2280, -2176],
			[1560, -2552, 1568, -2184],
			[2272, -2552, 2280, -2184]
		] as const)
			b.box(x0, y0, 0, x1, y1, 1, 'paint');
		for (let i = 0; i < 6; i++) put(b, palm(220 + (i % 3) * 40), -3200 + i * 1100, -1880, 0);
		put(b, crate(32, 'plastic_red'), 1900, -2300, 0);
	});
}

function beachBar(b: MapBuilder): void {
	const r = rect(2688, 3264, -2240, -1856);
	b.buildings.push('beach bar');
	b.room('beach bar');
	const z = 160;
	for (const [x, y] of [
		[r.x0, r.y0],
		[r.x1 - 16, r.y0],
		[r.x0, r.y1 - 16],
		[r.x1 - 16, r.y1 - 16],
		[(r.x0 + r.x1) / 2 - 8, r.y0]
	] as const)
		b.box(x, y, 0, x + 16, y + 16, z, 'palm_trunk');
	b.box(r.x0 - 16, r.y0 - 16, z, r.x1 + 16, r.y1 + 16, z + 16, 'thatch');
	// Back wall (north) with a hatch.
	wall(b, 'x', r.x0 + 16, r.x1 - 16, r.y1 - 16, r.y1, 0, z, 'wood', [gap(r.x0 + 200, 48, 160, 120)]);
	b.as('prop', () => {
		put(b, counter(384, 44, 'wood_light', 'bamboo'), r.x0 + 96, r.y1 - 160, 0, 's');
		put(b, shelf(256, 96, 3, 'goods', 201, 20), r.x0 + 160, r.y1 - 40, 0, 's');
		for (let i = 0; i < 7; i++) put(b, stool('bamboo', 'canvas_red'), r.x0 + 110 + i * 52, r.y1 - 200, 0);
		for (let i = 0; i < 3; i++) {
			put(b, table(48, 48, 30, 'bamboo', 'bamboo'), r.x0 + 64 + i * 160, r.y0 + 48, 0);
			put(b, chair('bamboo', 'canvas_white'), r.x0 + 34 + i * 160, r.y0 + 58, 0, 'e');
			put(b, chair('bamboo', 'canvas_white'), r.x0 + 116 + i * 160, r.y0 + 58, 0, 'w');
		}
		for (let i = 0; i < 4; i++) put(b, keg(), r.x0 + 40 + i * 24, r.y1 - 40, 0);
		// Crate chain behind the bar up to the thatch roof (40, 80, 120, crouch-jump to 176).
		const cx = r.x1 - 120;
		const cy = r.y1 + 16;
		put(b, crate(40), cx, cy, 0);
		put(b, crate(40), cx + 40, cy, 0);
		put(b, crate(40), cx + 40, cy, 40);
		put(b, crate(40), cx + 80, cy, 0);
		put(b, crate(40), cx + 80, cy, 40);
		put(b, crate(40), cx + 80, cy, 80);
		put(b, crate(40), cx + 80, cy + 40, 0);
		put(b, crate(40), cx + 80, cy + 40, 40);
		put(b, crate(40), cx + 80, cy + 40, 80);
	});
	b.spot('bar-roof', 'Beach bar: on the thatched roof', v(r.x0 + 200, r.y0 + 120, z + 16), 'roof', 'crouchjump');
}

export const TP_CRATE = rect(4288, 4384, -2464, -2400);

function boathouse(b: MapBuilder): void {
	const r = BOATHOUSE;
	const t = 16;
	const top = 256;
	b.buildings.push('boathouse');
	b.room('boathouse', 'boathouse loft');
	wall(b, 'x', r.x0, r.x1, r.y0, r.y0 + t, 0, top, 'timber', [door(3872, 0, 256, 192)]);
	wall(b, 'x', r.x0, r.x1, r.y1 - t, r.y1, 0, top, 'timber', [win(3700, 0, 128), win(4100, 0, 128), win(3700, 144, 128, 32, 96)]);
	wall(b, 'y', r.y0 + t, r.y1 - t, r.x0, r.x0 + t, 0, top, 'timber', [door(-2880, 0, 64, 104)]);
	wall(b, 'y', r.y0 + t, r.y1 - t, r.x1 - t, r.x1, 0, top, 'timber', [win(-2800, 0, 96)]);
	slab(b, r, top, top + 16, 'roof_tile');
	// Loft (north side) at 144 with stairs up from the west.
	const loft = rect(r.x0 + t, r.x1 - t, -2560, r.y1 - t);
	b.box(loft.x0, loft.y0, 128, loft.x1, loft.y1, 144, 'planks');
	railing(b, 'x', loft.x0 + 96, loft.x1, loft.y0 + 2, 144, 'wood');
	flight(b, { x: r.x0 + 64, y: -2776 }, '+y', 9, 96, 0, 'planks');
	b.as('prop', () => {
		put(b, boat(true, 'boat'), 3900, -2800, 0, 'n');
		put(b, boat(false, 'boat_blue'), 4100, -2840, 0, 'n');
		put(b, crate(48), 4300, -2900, 0);
		put(b, crate(48), 4348, -2900, 0);
		put(b, crate(48), 4348, -2900, 48);
		put(b, barrel(), 3620, -2440, 0);
		put(b, barrel(), 3664, -2440, 0);
		put(b, shelf(192, 112, 3, 'boxes', 301), 3800, -2408, 144, 's');
		put(b, crate(48), 3700, -2520, 144);
		put(b, crate(64, 'crate_dark'), 4200, -2520, 144);
		put(b, table(96, 48, 32), 4000, -2500, 144);
	});
	// Hollow crate on the ground in the NE corner (teleporter → lighthouse gallery).
	const c = TP_CRATE;
	const zt = 96;
	b.fake(c.x0, c.y0, 0, c.x1, c.y0 + 4, zt, 'crate');
	b.fake(c.x0, c.y1 - 4, 0, c.x1, c.y1, zt, 'crate');
	b.fake(c.x0, c.y0 + 4, 0, c.x0 + 4, c.y1 - 4, zt, 'crate');
	b.fake(c.x1 - 4, c.y0 + 4, 0, c.x1, c.y1 - 4, zt, 'crate');
	b.fake(c.x0 + 4, c.y0 + 4, zt - 4, c.x1 - 4, c.y1 - 4, zt, 'crate_dark');
	b.spot('boathouse-boat', 'Boathouse: inside the covered boat', v(3936, -2700, 12), 'prop', 'fake', 'crawl');
	b.spot('boathouse-loft', 'Boathouse loft: behind the crates', v(4300, -2480, 144), 'room');
}

function pier(b: MapBuilder): void {
	const p = PIER;
	b.buildings.push('pier pavilion');
	b.room('arcade pavilion');
	flight(b, { x: (p.x0 + p.x1) / 2, y: -2784 }, '-y', 3, 192, 0, 'planks');
	b.box(p.x0, p.y0, DECK - 16, p.x1, p.y1, DECK, 'planks');
	for (let y = -3136; y >= -3520; y -= 128)
		for (const x of [p.x0, p.x1 - 16, (p.x0 + p.x1) / 2 - 8]) {
			const yy = Math.max(y, p.y0);
			if (x === (p.x0 + p.x1) / 2 - 8 && y !== -3520) continue;
			b.box(x, yy, SEABED, x + 16, yy + 16, DECK - 16, 'wood_dark');
		}
	railing(b, 'y', p.y0, p.y1, p.x0 + 2, DECK, 'wood_light');
	railing(b, 'y', p.y0, p.y1, p.x1 - 2, DECK, 'wood_light');
	b.as('prop', () => {
		put(b, bench(72, 'wood_light'), p.x0 + 8, -3200, DECK, 'e');
		put(b, bench(72, 'wood_light'), p.x1 - 32, -3000, DECK, 'w');
		put(b, streetlamp(), p.x0 + 8, -3400, DECK);
		put(b, streetlamp(), p.x1 - 24, -3100, DECK);
		put(b, bin(), p.x1 - 32, -3300, DECK);
	});
	// Pavilion on piles.
	const q = PAVILION;
	const t = 16;
	b.box(q.x0, q.y0, DECK - 16, q.x1, q.y1, DECK, 'planks');
	for (const [x, y] of [
		[q.x0, q.y0],
		[q.x1 - 16, q.y0],
		[q.x0, q.y1 - 16],
		[q.x1 - 16, q.y1 - 16]
	] as const)
		b.box(x, y, SEABED, x + 16, y + 16, DECK - 16, 'wood_dark');
	const top = DECK + 176;
	wall(b, 'x', q.x0, q.x1, q.y1 - t, q.y1, DECK, top, 'hut_white', [door(960, DECK, 64, 104), win(840, DECK, 96), win(1056, DECK, 96)]);
	wall(b, 'x', q.x0, q.x1, q.y0, q.y0 + t, DECK, top, 'hut_white', [win(900, DECK, 192)]);
	wall(b, 'y', q.y0 + t, q.y1 - t, q.x0, q.x0 + t, DECK, top, 'hut_white', [win(-3700, DECK, 96)]);
	wall(b, 'y', q.y0 + t, q.y1 - t, q.x1 - t, q.x1, DECK, top, 'hut_white', [win(-3700, DECK, 96)]);
	b.box(q.x0 - 16, q.y0 - 16, top, q.x1 + 16, q.y1 + 16, top + 16, 'roof_tile');
	b.box(q.x0 + 96, q.y0 + 64, top + 16, q.x1 - 96, q.y1 - 64, top + 64, 'neon_cyan');
	b.as('prop', () => {
		const screens = ['screen', 'screen_green', 'screen'];
		for (let i = 0; i < 6; i++) put(b, arcade(screens[i % 3]!, i === 4), q.x0 + t + 8 + i * 48, q.y0 + t, DECK, 'n');
		put(b, poolTable(), 900, -3620, DECK);
		put(b, counter(128, 42, 'plastic_white', 'plastic_red'), q.x1 - t - 48, -3700, DECK, 'w');
		put(b, shelf(96, 96, 3, 'goods', 401, 16), q.x1 - t - 16, -3632, DECK, 'w');
		put(b, stool(), q.x1 - 100, -3690, DECK);
		put(b, stool(), q.x1 - 100, -3650, DECK);
		put(b, plant(48), q.x0 + t, q.y1 - t - 24, DECK);
	});
	b.spot('under-pier', 'Under the pier, in the sea between the piles', v(992, -3300, SEABED), 'under', 'water');
}

/** Arcade cabinet 4 (hollow): its interior hosts the sea-cave teleporter. */
export const ARCADE = { x0: PAVILION.x0 + 16 + 8 + 4 * 48, y0: PAVILION.y0 + 16 };

function promenade(b: MapBuilder): void {
	b.as('prop', () => {
		for (let x = -4480; x < 4500; x += 384) {
			if (x > 840 && x < 1150) continue;
			put(b, streetlamp(), x, -1656, 0);
			if (Math.abs(x - PHONE_PROM.x) > 200) put(b, bench(72), x + 64, -1640, 0, 'n');
		}
		for (let x = -4300; x < 4500; x += 768) {
			if (Math.abs(x - PHONE_PROM.x) < 160) continue;
			putC(b, palm(256), x + 192, -1520, 0);
			put(b, bin(), x + 330, -1460, 0);
		}
		put(b, phoneBox(), PHONE_PROM.x, PHONE_PROM.y, 0, 'n');
	});
}
