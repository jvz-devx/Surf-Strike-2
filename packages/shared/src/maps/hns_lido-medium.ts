/**
 * hns_lido_m — what stands at the Medium size's cut (x = 1280): streets end in
 * something built, never in a void. The cliff face itself is the boundary.
 *
 *   plaza       a row of closed arcade houses (shut doors, dark windows)
 *   avenue      a closed road tunnel: portal, barrier row, cones
 *   promenade   a stone wall with a locked gate
 *   beach, sea  rocks tumbling from the cliff
 *   gardens     a stone wall; a crawl culvert runs along it (an east loop)
 *   hotel       the second phone box (large: car park roof) on the forecourt
 */
import { bench, bin, bush, chair, cone, phoneBox, plant, put, streetlamp, table, umbrella, v, type MapBuilder } from './hns-props.ts';

/** Phone box on the hotel forecourt (the promenade box's partner). */
export const PHONE_HOTEL = { x: -1600, y: 1600 };
const X1 = 1280;

export function buildMediumEdges(b: MapBuilder): void {
	plazaArcade(b);
	tunnel(b);
	promenadeGate(b);
	rocks(b);
	gardenWall(b);
	b.as('prop', () => {
		put(b, phoneBox(), PHONE_HOTEL.x, PHONE_HOTEL.y, 0, 's');
	});
	b.loops.push('Garden culvert: maze east gate → crawl along the garden wall → round the maze');
}

/** Closed house fronts along the plaza's east side (kiosk 3 stands between the two rows). */
function plazaArcade(b: MapBuilder): void {
	const paint = ['plaster_pink', 'plaster_cream', 'plaster_blue', 'plaster_ochre'];
	const canvas = ['canvas_red', 'canvas_blue', 'canvas_yellow', 'canvas_green'];
	const houses: Array<[number, number]> = [];
	for (let y = -1408; y < 352; y += 220) houses.push([y, Math.min(352, y + 220)]);
	houses.push([616, 880], [880, 1152]);
	const x0 = X1 - 48;
	houses.forEach(([y0, y1], i) => {
		const h = 220 + (i % 3) * 24;
		b.box(x0, y0, 0, X1, y1, h, paint[i % 4]!);
		b.box(x0 - 8, y0, h, X1, y1, h + 12, 'roof_tile');
		b.as('prop', () => {
			const w = y1 - y0;
			// Shut door, shop window with a closed shutter, upstairs window, awning.
			b.box(x0 - 2, y0 + 16, 0, x0, y0 + 80, 100, i % 2 ? 'wood_dark' : 'plastic_green');
			b.box(x0 - 2, y0 + 100, 24, x0, y0 + w - 16, 104, 'steel_door');
			b.box(x0 - 2, y0 + 40, 148, x0, y0 + 100, 200, 'glass_dark');
			if (w > 200) b.box(x0 - 2, y0 + 128, 148, x0, y0 + 188, 200, 'glass_dark');
			b.box(x0 - 40, y0 + 92, 112, x0 - 2, y0 + w - 8, 120, canvas[i % 4]!);
		});
	});
	b.as('prop', () => {
		put(b, streetlamp(), 1200, -1200, 0);
		put(b, bench(72), 1180, -500, 0, 'w');
		put(b, plant(56), 1200, 120, 0);
		put(b, bin(), 1196, 640, 0);
		// Café terraces in front of the houses.
		for (const [y, c] of [
			[-1120, 'canvas_red'],
			[-760, 'canvas_blue'],
			[-260, 'canvas_yellow'],
			[100, 'canvas_green']
		] as const) {
			put(b, umbrella(c), 1040, y, 0);
			put(b, table(48, 48, 30, 'marble', 'iron'), 1060, y + 120, 0);
			put(b, chair('iron', 'canvas_white'), 1070, y + 176, 0, 's');
			put(b, chair('iron', 'canvas_white'), 1030, y + 130, 0, 'e');
		}
		put(b, plant(56), 1200, 1000, 0);
	});
}

/** The avenue ends in a closed tunnel: stone portal, dark mouth, barriers. */
function tunnel(b: MapBuilder): void {
	b.box(1216, 1152, 0, X1, 1184, 200, 'stone');
	b.box(1216, 1376, 0, X1, 1408, 200, 'stone');
	b.box(1216, 1184, 160, X1, 1376, 200, 'stone');
	b.box(1208, 1152, 200, X1, 1408, 216, 'stone');
	b.box(1264, 1184, 0, X1, 1376, 160, 'plastic_black');
	b.as('prop', () => {
		// Road-closed barrier row and cones; the underpass stairs come out just west of it.
		for (let k = 0; k < 3; k++) {
			const y = 1190 + k * 62;
			b.box(1192, y, 0, 1208, y + 56, 40, k % 2 ? 'plastic_white' : 'plastic_red');
		}
		put(b, cone(), 1168, 1184, 0);
		put(b, cone(), 1168, 1376 - 20, 0);
		b.box(1232, 1200, 136, 1236, 1360, 160, 'plastic_yellow');
	});
}

/** Promenade: a stone wall across it with a locked iron gate. */
function promenadeGate(b: MapBuilder): void {
	b.box(1248, -1664, 0, X1, -1600, 160, 'stone');
	b.box(1248, -1472, 0, X1, -1408, 160, 'stone');
	b.box(1260, -1600, 0, X1, -1472, 144, 'stone_dark');
	b.as('prop', () => {
		for (let k = 0; k < 5; k++) b.box(1252, -1596 + k * 26, 0, 1256, -1592 + k * 26, 136, 'iron');
		b.box(1252, -1600, 136, 1256, -1472, 144, 'iron');
		put(b, bush(48), 1180, -1650, 0);
		put(b, streetlamp(), 1200, -1430, 0);
	});
}

/** Rocks fallen from the cliff on the beach and in the sea. */
function rocks(b: MapBuilder): void {
	// Two tiers each: a broad foot and a smaller block on it, offset.
	const rock = (x: number, y: number, s: number, z0: number, h: number) =>
		b.as('prop', () => {
			const x1 = Math.min(X1, x + s);
			const foot = z0 + Math.round(h * 0.6);
			b.box(x, y, z0, x1, y + s, foot, 'rock');
			b.box(x + (x1 - x) * 0.3, y + s * 0.15, foot, x1, y + s * 0.8, z0 + h, 'rock_top');
		});
	for (const [x, y, s, h] of [
		[1152, -1850, 112, 72],
		[1104, -2080, 80, 48],
		[1184, -2320, 96, 120],
		[1136, -2560, 104, 64],
		[1200, -2760, 80, 150],
		[1088, -2900, 72, 40]
	] as const)
		rock(x, y, s, 0, h);
	for (const [x, y, s, h] of [
		[1216, -3200, 64, 110],
		[1120, -3320, 72, 90],
		[1184, -3500, 96, 130]
	] as const)
		rock(x, y, s, -48, h);
	b.spot('cove-rocks', 'Beach: crouched behind the cove rocks', v(1088, -2480, 0), 'under');
}

/** Garden wall along the cut, and the duck-only culvert between the maze and the wall. */
function gardenWall(b: MapBuilder): void {
	b.box(1264, 1408, 0, X1, 3840, 160, 'stone');
	// Culvert x [1184, 1264] inside: a lid on the strip east of the maze (standing hull blocked).
	const y0 = 2600;
	const y1 = 3000;
	b.box(1168, y0, 56, 1264, y1, 72, 'duct');
	b.box(1168, y0, 0, 1184, y1, 56, 'stone');
	b.crawl('garden-culvert', v(1224, y0 + 32, 0), v(1224, y1 - 32, 0));
	b.spot('garden-culvert', 'Gardens: in the culvert along the garden wall', v(1224, 2800, 0), 'crawl', 'under');
	b.as('prop', () => {
		put(b, bush(48), 1200, 1480, 0);
		put(b, bush(48), 1200, 3700, 0);
		put(b, streetlamp(), 1200, 1900, 0);
	});
}
