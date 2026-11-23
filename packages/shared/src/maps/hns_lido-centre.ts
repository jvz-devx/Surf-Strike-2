/**
 * hns_lido — the centre: the plaza (fountain, the seekers' security office,
 * bandstand, kiosks, playground), the hedge maze gardens with a greenhouse
 * and a shed, and the sewer under the avenue.
 *
 * Plaza x [-1792, 1664], y [-1408, 1152]. Security office (seeker cage)
 * x [-224, 224], y [448, 800]. Maze x [-768, 1152], y [1600, 3520] on a
 * 192 grid (10 × 10 cells). Sewer x [-4352, 1472], y [1184, 1376], floor -192.
 *
 * Secrets: the security office roof (crate chain); crawlspace under the
 * bandstand; a kiosk storeroom behind a fake vending machine; the playground
 * tower top; three hidden maze clearings behind fake hedges; the maze statue
 * plinth (teleporter → belfry); the shed roof; the sewer's smugglers' room
 * behind a fake wall; the sewer drain alcove (teleporter back to the yards).
 */
import {
	bench,
	bin,
	bikeRack,
	bunk,
	chair,
	counter,
	crate,
	desk,
	flight,
	flowerBed,
	lamp,
	lockers,
	officeDesk,
	pallet,
	plant,
	put,
	putC,
	railing,
	rect,
	rng,
	shelf,
	slab,
	streetlamp,
	swingSet,
	table,
	tree,
	vending,
	v,
	wall,
	barrel,
	door,
	fakeHole,
	gap,
	win,
	type MapBuilder,
	type Rect
} from './hns-props.ts';
import type { LidoVariant } from './hns_lido-variant.ts';

export const CAGE = rect(-224, 224, 448, 800);
export const CAGE_INNER = rect(-208, 208, 464, 784);
export const FOUNTAIN = { x: 0, y: -448 };
export const MAZE = { x0: -768, y0: 1600, cell: 192, n: 10 };
export const MAZE_CENTRE = { x: MAZE.x0 + 5 * MAZE.cell, y: MAZE.y0 + 5 * MAZE.cell };
export const PLINTH = rect(MAZE_CENTRE.x - 48, MAZE_CENTRE.x + 48, MAZE_CENTRE.y - 48, MAZE_CENTRE.y + 48);
export const SEWER = rect(-4352, 1472, 1184, 1376);
export const SEWER_Z = -192;
export const DRAIN_ALCOVE = rect(-4320, -4256, 1408, 1472);
export const KIOSK3 = rect(1088, 1280, 384, 576);
const HEDGE = 'hedge';
const HEDGE_H = 136;

export function buildCentre(b: MapBuilder, holes: Rect[], variant: LidoVariant): void {
	plaza(b, variant.size === 'medium');
	cage(b);
	bandstand(b);
	kiosks(b);
	playground(b);
	maze(b);
	gardens(b);
	sewer(b, holes, variant.sewerX1);
	b.loops.push(
		'Plaza: round the fountain and the bandstand (under the stage for the brave)',
		'Maze: braided loops round the centre',
		'Sewer: underpass stairs → tunnel → hotel laundry crawl pipe → hotel → avenue'
	);
}

function plaza(b: MapBuilder, medium: boolean): void {
	const { x, y } = FOUNTAIN;
	// Fountain: rim, water, tiered pedestal and a statue.
	b.box(x - 192, y - 192, 0, x + 192, y - 168, 24, 'marble');
	b.box(x - 192, y + 168, 0, x + 192, y + 192, 24, 'marble');
	b.box(x - 192, y - 168, 0, x - 168, y + 168, 24, 'marble');
	b.box(x + 168, y - 168, 0, x + 192, y + 168, 24, 'marble');
	b.fake(x - 168, y - 168, 0, x + 168, y + 168, 14, 'poolwater');
	b.box(x - 48, y - 48, 0, x + 48, y + 48, 48, 'marble');
	b.box(x - 32, y - 32, 48, x + 32, y + 32, 96, 'marble');
	b.box(x - 16, y - 16, 96, x + 16, y + 16, 192, 'statue');
	b.box(x - 40, y - 40, 192, x + 40, y + 40, 200, 'statue');
	b.as('prop', () => {
		// Plane trees in planters.
		for (const [tx, ty] of [
			[-1200, -1100],
			[-450, -1250],
			[600, -1250],
			[1200, -1100],
			[-1300, 500],
			[1300, 900],
			[-500, 200],
			[500, 150],
			[900, -500],
			[-900, -600]
		] as const) {
			// The medium size has the closed arcade houses along its east edge.
			if (medium && tx > 1100) continue;
			b.box(tx - 64, ty - 64, 0, tx + 64, ty + 64, 24, 'stone');
			putC(b, tree(136, 80), tx, ty, 24);
		}
		for (let k = 0; k < 8; k++) {
			const a = (k / 8) * Math.PI * 2;
			const bx = Math.round(x + Math.cos(a) * 320);
			const by = Math.round(y + Math.sin(a) * 320);
			if (k % 2 === 0) putC(b, bench(72), bx, by, 0, k === 0 ? 'w' : k === 2 ? 's' : k === 4 ? 'e' : 'n');
			else putC(b, streetlamp(), bx, by, 0);
		}
		for (let k = 0; k < 6; k++) put(b, bin(), -1500 + k * 560, -1380, 0);
		put(b, bikeRack(), -400, 900, 0);
		put(b, bikeRack(), 300, 1100, 0);
		put(b, flowerBed(256, 96, 'flower_yellow'), -1500, -900, 0);
		put(b, flowerBed(256, 96, 'flower_pink'), 1100, -800, 0);
		put(b, flowerBed(192, 96, 'flower_red'), 500, 1000, 0);
	});
}

/** The seekers' room: closed office with one doorway (seekers are frozen inside during the hiding phase). */
function cage(b: MapBuilder): void {
	const c = CAGE;
	const t = 16;
	b.buildings.push('security office');
	b.room('security office');
	wall(b, 'x', c.x0, c.x1, c.y0, c.y0 + t, 0, 176, 'plaster_blue', [door(-48, 0, 96, 112), win(-176, 0, 96), win(80, 0, 96)]);
	wall(b, 'x', c.x0, c.x1, c.y1 - t, c.y1, 0, 176, 'plaster_blue');
	wall(b, 'y', c.y0 + t, c.y1 - t, c.x0, c.x0 + t, 0, 176, 'plaster_blue', [win(560, 0, 128)]);
	wall(b, 'y', c.y0 + t, c.y1 - t, c.x1 - t, c.x1, 0, 176, 'plaster_blue', [win(560, 0, 128)]);
	b.box(c.x0 - 8, c.y0 - 8, 176, c.x1 + 8, c.y1 + 8, 192, 'roof_tar');
	b.box(-64, c.y0 - 40, 120, 64, c.y0 - 8, 128, 'plastic_blue');
	b.as('prop', () => {
		put(b, officeDesk(), -200, 736, 0, 's');
		put(b, officeDesk(), -96, 736, 0, 's');
		put(b, officeDesk(), 104, 736, 0, 's');
		put(b, shelf(96, 112, 3, 'boxes', 701), -208, 600, 0, 'e');
		put(b, lockers(4), 188, 520, 0, 'w');
		put(b, plant(40), -208, 464, 0);
		// Delivery crates outside the east wall: 48 → 96 → 144 → roof (192).
		put(b, crate(48), 224, 640, 0);
		put(b, crate(48), 224, 640, 48);
		put(b, crate(48), 224, 640, 96);
		put(b, crate(48), 272, 640, 0);
		put(b, crate(48), 272, 640, 48);
		put(b, crate(48), 320, 640, 0);
		put(b, pallet(true), 320, 700, 0);
	});
	b.spot('cage-roof', 'Security office roof (right above the seekers)', v(-120, 700, 192), 'roof');
}

function bandstand(b: MapBuilder): void {
	const r = rect(-1408, -896, -256, 256);
	const fz = 72;
	b.buildings.push('bandstand');
	for (const x of [r.x0, (r.x0 + r.x1) / 2 - 8, r.x1 - 16])
		for (const y of [r.y0, r.y1 - 16]) b.box(x, y, 0, x + 16, y + 16, fz - 16, 'wood_dark');
	b.box(r.x0, r.y0, fz - 16, r.x1, r.y1, fz, 'planks');
	flight(b, { x: (r.x0 + r.x1) / 2, y: r.y0 - 96 }, '+y', 4, 128, 0, 'planks', 18);
	for (const [x, y] of [
		[r.x0, r.y0],
		[r.x1 - 16, r.y0],
		[r.x0, r.y1 - 16],
		[r.x1 - 16, r.y1 - 16]
	] as const)
		b.box(x, y, fz, x + 16, y + 16, fz + 176, 'iron');
	b.box(r.x0 - 16, r.y0 - 16, fz + 176, r.x1 + 16, r.y1 + 16, fz + 184, 'canvas_white');
	b.brushes.push({ type: 'ramp', from: v(r.x0 - 16, 0, fz + 248), to: v(r.x1 + 16, 0, fz + 248), height: 64, halfWidth: 272, side: 'both', material: 'canvas_red' });
	b.kinds.push('struct');
	b.as('prop', () => {
		for (let k = 0; k < 5; k++) put(b, chair('iron', 'fabric_red'), -1360 + k * 96, 120, fz, 's');
		put(b, crate(48, 'drum', 40), -1180, 180, fz);
		put(b, crate(32, 'drum', 28), -1124, 196, fz);
		put(b, table(48, 32, 44, 'iron', 'iron'), -1300, 40, fz);
	});
	b.crawl('bandstand', v(-1376, 0, 0), v(-928, 0, 0));
	b.spot('under-bandstand', 'Plaza: crawlspace under the bandstand', v(-1152, 100, 0), 'crawl', 'under');
}

function kiosk(b: MapBuilder, r: Rect, mat: string, opts: { door?: boolean; hatch?: boolean; fakeVending?: boolean }): void {
	const t = 12;
	const top = 160;
	const sHoles = opts.hatch ? [gap(r.x0 + 40, 40, r.x1 - r.x0 - 80, 120)] : [];
	const nHoles = opts.door ? [door(r.x0 + 64, 0, 64, 104)] : [];
	if (opts.fakeVending) nHoles.push({ a: r.x0 + 48, b: r.x0 + 92, z0: 0, z1: 88 });
	wall(b, 'x', r.x0, r.x1, r.y0, r.y0 + t, 0, top, mat, sHoles);
	wall(b, 'x', r.x0, r.x1, r.y1 - t, r.y1, 0, top, mat, nHoles);
	b.box(r.x0, r.y0 + t, 0, r.x0 + t, r.y1 - t, top, mat);
	b.box(r.x1 - t, r.y0 + t, 0, r.x1, r.y1 - t, top, mat);
	b.box(r.x0 - 16, r.y0 - 32, top, r.x1 + 16, r.y1 + 16, top + 12, 'roof_tile');
	if (opts.hatch) b.box(r.x0 + 16, r.y0 - 48, 132, r.x1 - 16, r.y0 - 32, 140, 'canvas_red', true, 'prop');
}

function kiosks(b: MapBuilder): void {
	const k1 = rect(600, 792, -1100, -908);
	const k2 = rect(-800, -608, -1100, -908);
	kiosk(b, k1, 'plaster_pink', { door: true, hatch: true });
	kiosk(b, k2, 'plaster_ochre', { door: true, hatch: true });
	kiosk(b, KIOSK3, 'plaster_white', { fakeVending: true });
	b.buildings.push('ice cream kiosk', 'news kiosk', 'storage kiosk');
	b.room('ice cream kiosk', 'news kiosk', 'kiosk storeroom');
	b.as('prop', () => {
		put(b, counter(112, 40, 'plastic_white', 'plastic_pink'), k1.x0 + 40, k1.y0 + 12, 0, 'n');
		put(b, counter(112, 40, 'wood', 'wood_dark'), k2.x0 + 40, k2.y0 + 12, 0, 'n');
		put(b, shelf(112, 96, 3, 'books', 801, 16), k2.x0 + 40, k2.y1 - 28, 0, 's');
		// The fake vending machine sits in the storeroom's doorway; a real one beside it.
		put(b, vending('plastic_red', true), KIOSK3.x0 + 48, KIOSK3.y1 - 12, 0, 'n');
		put(b, vending('plastic_blue'), KIOSK3.x0 + 100, KIOSK3.y1, 0, 'n');
		put(b, shelf(96, 112, 3, 'boxes', 802), KIOSK3.x0 + 12, KIOSK3.y0 + 12, 0, 'n');
		put(b, crate(40), KIOSK3.x1 - 52, KIOSK3.y0 + 12, 0);
		put(b, bench(72), k1.x0 + 80, k1.y0 - 120, 0, 'n');
		put(b, bench(72), k2.x0, k2.y0 - 120, 0, 'n');
	});
	b.spot('kiosk-storeroom', 'Plaza: storeroom inside the kiosk, through the fake vending machine', v(KIOSK3.x0 + 120, KIOSK3.y0 + 120, 0), 'fake', 'room');
}

function playground(b: MapBuilder): void {
	b.as('prop', () => {
		put(b, swingSet(), -1600, 860, 0);
		// Climbing tower: posts, platform at 96 (reach it via the 48 block), roof.
		b.box(-1376, 640, 0, -1360, 656, 192, 'plastic_yellow');
		b.box(-1264, 640, 0, -1248, 656, 192, 'plastic_yellow');
		b.box(-1376, 752, 0, -1360, 768, 192, 'plastic_yellow');
		b.box(-1264, 752, 0, -1248, 768, 192, 'plastic_yellow');
		b.box(-1360, 640, 88, -1264, 768, 96, 'plastic_red');
		b.box(-1376, 640, 192, -1248, 768, 200, 'plastic_blue');
		b.box(-1440, 680, 0, -1376, 728, 48, 'plastic_green');
		b.box(-1248, 680, 0, -1120, 728, 8, 'sand');
		b.box(-1600, 640, 0, -1504, 736, 6, 'sand');
	});
	b.spot('playground-tower', 'Playground: inside the climbing tower', v(-1312, 704, 96), 'roof');
}

/** Hedge maze: recursive backtracker on 10 × 10 cells, braided for loops, three sealed clearings with a fake hedge. */
function maze(b: MapBuilder): void {
	const { x0, y0, cell, n } = MAZE;
	const r = rng(4242);
	// Wall sets: hWall[i][j] = wall on the south edge of cell (i, j) (j = 0..n), vWall[i][j] = west edge (i = 0..n).
	const hWall = Array.from({ length: n }, () => Array.from({ length: n + 1 }, () => true));
	const vWall = Array.from({ length: n + 1 }, () => Array.from({ length: n }, () => true));
	const secret = new Set(['0,9', '9,0', '9,9']);
	const centre = new Set(['4,4', '5,4', '4,5', '5,5']);
	const seen = new Set<string>();
	const stack: Array<[number, number]> = [[0, 0]];
	seen.add('0,0');
	for (const s of secret) seen.add(s);
	while (stack.length) {
		const [i, j] = stack[stack.length - 1]!;
		const opts = (
			[
				[i + 1, j],
				[i - 1, j],
				[i, j + 1],
				[i, j - 1]
			] as Array<[number, number]>
		).filter(([a, c]) => a >= 0 && c >= 0 && a < n && c < n && !seen.has(`${a},${c}`));
		if (!opts.length) {
			stack.pop();
			continue;
		}
		const [a, c] = opts[Math.floor(r() * opts.length)]!;
		if (a !== i) vWall[Math.max(a, i)]![j] = false;
		else hWall[i]![Math.max(c, j)] = false;
		seen.add(`${a},${c}`);
		stack.push([a, c]);
	}
	// Braid: open extra walls (not into secret cells) for chase loops.
	for (let i = 1; i < n; i++)
		for (let j = 0; j < n; j++) if (r() < 0.18 && !secret.has(`${i},${j}`) && !secret.has(`${i - 1},${j}`)) vWall[i]![j] = false;
	for (let i = 0; i < n; i++)
		for (let j = 1; j < n; j++) if (r() < 0.18 && !secret.has(`${i},${j}`) && !secret.has(`${i},${j - 1}`)) hWall[i]![j] = false;
	// Centre plaza: no inner walls.
	vWall[5]![4] = false;
	vWall[5]![5] = false;
	hWall[4]![5] = false;
	hWall[5]![5] = false;
	// Entrances: south (cells 4, 5), north (2), west (row 6), east (row 3).
	hWall[4]![0] = false;
	hWall[5]![0] = false;
	hWall[2]![n] = false;
	vWall[0]![6] = false;
	vWall[n]![3] = false;
	// Secret clearings keep all walls; one wall of each is fake.
	const fakeWalls = new Set(['v,1,9', 'h,9,1', 'v,9,9']);
	const P = 16;
	const post = (i: number, j: number) => b.box(x0 + i * cell - P, y0 + j * cell - P, 0, x0 + i * cell + P, y0 + j * cell + P, HEDGE_H, HEDGE);
	for (let i = 0; i <= n; i++)
		for (let j = 0; j <= n; j++) {
			if (i === 5 && j === 5) continue;
			post(i, j);
		}
	for (let i = 0; i < n; i++)
		for (let j = 0; j <= n; j++)
			if (hWall[i]![j]) {
				const fk = fakeWalls.has(`h,${i},${j}`);
				b.box(x0 + i * cell + P, y0 + j * cell - P, 0, x0 + (i + 1) * cell - P, y0 + j * cell + P, HEDGE_H, fk ? 'hedge' : HEDGE, !fk);
			}
	for (let i = 0; i <= n; i++)
		for (let j = 0; j < n; j++)
			if (vWall[i]![j]) {
				const fk = fakeWalls.has(`v,${i},${j}`);
				b.box(x0 + i * cell - P, y0 + j * cell + P, 0, x0 + i * cell + P, y0 + (j + 1) * cell - P, HEDGE_H, HEDGE, !fk);
			}
	const cc = (i: number, j: number) => v(x0 + i * cell + cell / 2, y0 + j * cell + cell / 2, 0);
	b.room('maze clearing NW', 'maze clearing SE', 'maze clearing NE');
	b.as('prop', () => {
		put(b, bench(72), cc(0, 9).x - 36, cc(0, 9).y + 40, 0, 's');
		b.box(cc(9, 0).x - 24, cc(9, 0).y - 24, 0, cc(9, 0).x + 24, cc(9, 0).y + 24, 32, 'stone');
		b.box(cc(9, 0).x - 32, cc(9, 0).y - 32, 32, cc(9, 0).x + 32, cc(9, 0).y + 32, 40, 'stone');
		put(b, crate(32, 'gnome', 40), cc(9, 9).x + 30, cc(9, 9).y + 30, 0);
		put(b, plant(40), cc(9, 9).x - 60, cc(9, 9).y + 40, 0);
	});
	b.spot('maze-nw', 'Maze: sealed clearing (NW corner) behind a fake hedge', v(cc(0, 9).x, cc(0, 9).y - 30, 0), 'fake', 'room');
	b.spot('maze-se', 'Maze: sealed clearing (SE corner) behind a fake hedge', v(cc(9, 0).x - 56, cc(9, 0).y, 0), 'fake', 'room');
	b.spot('maze-ne', 'Maze: sealed clearing (NE corner) behind a fake hedge', v(cc(9, 9).x - 40, cc(9, 9).y - 40, 0), 'fake', 'room');
	// Statue plinth in the centre: hollow, its east face is clip-through; the teleporter is inside.
	const p = PLINTH;
	b.box(p.x0, p.y0, 0, p.x1, p.y1, 4, 'marble', true, 'prop');
	b.box(p.x0, p.y0, 4, p.x1, p.y0 + 4, 92, 'marble', true, 'prop');
	b.box(p.x0, p.y1 - 4, 4, p.x1, p.y1, 92, 'marble', true, 'prop');
	b.box(p.x0, p.y0 + 4, 4, p.x0 + 4, p.y1 - 4, 92, 'marble', true, 'prop');
	b.fake(p.x1 - 4, p.y0 + 4, 4, p.x1, p.y1 - 4, 92, 'marble', 'prop');
	b.box(p.x0 - 4, p.y0 - 4, 92, p.x1 + 4, p.y1 + 4, 100, 'marble', true, 'prop');
	b.box(p.x0 + 24, p.y0 + 24, 100, p.x1 - 24, p.y1 - 24, 228, 'statue', true, 'prop');
	b.as('prop', () => {
		for (const [dx, dy] of [
			[-150, -150],
			[110, -150],
			[-150, 110],
			[110, 110]
		] as const)
			put(b, bench(40), MAZE_CENTRE.x + dx, MAZE_CENTRE.y + dy, 0, 's');
	});
}

function gardens(b: MapBuilder): void {
	b.as('prop', () => {
		for (let k = 0; k < 6; k++) put(b, flowerBed(160, 64, k % 2 ? 'flower_pink' : 'flower_red'), -860 + k * 340, 1440, 0);
		for (let k = 0; k < 4; k++) put(b, streetlamp(), -800 + k * 600, 1528, 0);
		for (const x of [-880, 200, 960]) put(b, tree(140, 72), x, 3580, 0);
	});
	// Greenhouse x [-640, 128], y [3584, 3808]: glass walls, plant tables.
	const g = rect(-640, 128, 3600, 3808);
	b.buildings.push('greenhouse', 'garden shed');
	b.room('greenhouse', 'garden shed');
	wall(b, 'x', g.x0, g.x1, g.y0, g.y0 + 8, 0, 160, 'glass', [door(-288, 0, 64, 104)]);
	wall(b, 'x', g.x0, g.x1, g.y1 - 8, g.y1, 0, 160, 'glass');
	b.box(g.x0, g.y0 + 8, 0, g.x0 + 8, g.y1 - 8, 160, 'glass');
	b.box(g.x1 - 8, g.y0 + 8, 0, g.x1, g.y1 - 8, 160, 'glass');
	b.box(g.x0, g.y0, 160, g.x1, g.y1, 168, 'glass');
	for (let x = g.x0; x < g.x1; x += 128) b.box(x, g.y0, 168, x + 8, g.y1, 176, 'iron');
	b.as('prop', () => {
		for (let k = 0; k < 4; k++) {
			put(b, table(128, 48, 32, 'wood_light', 'iron'), g.x0 + 40 + k * 176, g.y0 + 60, 0);
			put(b, table(128, 48, 32, 'wood_light', 'iron'), g.x0 + 40 + k * 176, g.y1 - 80, 0);
			for (let m = 0; m < 3; m++) {
				put(b, plant(24 + m * 8), g.x0 + 48 + k * 176 + m * 40, g.y0 + 72, 32);
				put(b, plant(32), g.x0 + 48 + k * 176 + m * 40, g.y1 - 68, 32);
			}
		}
	});
	b.spot('greenhouse', 'Greenhouse: under the plant tables at the back', v(100, 3700, 0), 'room');
	// Garden shed with compost bins up to its roof (40 → 80 → roof 128).
	const s = rect(384, 640, 3616, 3808);
	wall(b, 'x', s.x0, s.x1, s.y0, s.y0 + 12, 0, 116, 'timber', [door(480, 0, 64, 100)]);
	wall(b, 'x', s.x0, s.x1, s.y1 - 12, s.y1, 0, 116, 'timber');
	b.box(s.x0, s.y0 + 12, 0, s.x0 + 12, s.y1 - 12, 116, 'timber');
	b.box(s.x1 - 12, s.y0 + 12, 0, s.x1, s.y1 - 12, 116, 'timber');
	b.box(s.x0 - 8, s.y0 - 8, 116, s.x1 + 8, s.y1 + 8, 128, 'roof_tile');
	b.as('prop', () => {
		put(b, crate(40, 'compost'), s.x1 + 8, s.y0 + 40, 0);
		put(b, crate(40, 'compost'), s.x1 + 8, s.y0 + 80, 0);
		put(b, crate(40, 'compost'), s.x1 + 8, s.y0 + 80, 40);
		put(b, shelf(128, 96, 3, 'boxes', 901), s.x0 + 40, s.y1 - 36, 0, 's');
		put(b, barrel(), s.x0 + 20, s.y0 + 30, 0);
		put(b, table(80, 40, 32), s.x1 - 100, s.y0 + 30, 0);
	});
	b.spot('shed-roof', 'Garden shed roof (compost bin climb)', v(500, 3700, 128), 'roof');
}

function sewer(b: MapBuilder, holes: Rect[], x1: number): void {
	const s = rect(SEWER.x0, x1, SEWER.y0, SEWER.y1);
	const z = SEWER_Z;
	b.room('sewer tunnel', 'smugglers room', 'drain alcove', 'crawl pipe');
	b.as('struct', () => {
		// Floor: walkways at -192, a channel at -208.
		b.box(s.x0, s.y0, z - 32, s.x1, 1248, z, 'sewer_floor');
		b.box(s.x0, 1312, z - 32, s.x1, s.y1, z, 'sewer_floor');
		b.box(s.x0, 1248, z - 32, s.x1, 1312, z - 16, 'sewer_floor');
		b.fake(s.x0, 1248, z - 16, s.x1, 1312, z - 6, 'sewage');
		wall(b, 'x', s.x0 - 32, s.x1 + 32, 1152, s.y0, z - 32, -32, 'sewer_brick', [fakeHole(-928, z, 64, 104, 'sewer_brick')]);
		wall(b, 'x', s.x0 - 32, s.x1 + 32, s.y1, 1408, z - 32, -32, 'sewer_brick', [gap(-3584, z, 64, z + 56), { a: DRAIN_ALCOVE.x0, b: DRAIN_ALCOVE.x1, z0: z, z1: z + 96, fill: 'fake', mat: 'bars' }]);
		b.box(s.x0 - 32, s.y0, z - 32, s.x0, s.y1, -32, 'sewer_brick');
		b.box(s.x1, s.y0, z - 32, s.x1 + 32, s.y1, -32, 'sewer_brick');
	});
	// Underpass stairs up to the avenue at the east end.
	const hole = rect(x1 - 304, x1, 1280, 1376);
	holes.push(hole);
	flight(b, { x: x1 - 288, y: 1328 }, '+x', 12, 96, z, 'concrete_stair');
	railing(b, 'x', x1 - 304, x1, 1278, 0, 'iron');
	railing(b, 'y', 1282, 1376, x1 - 306, 0, 'iron');
	// Pipes and lamps along the tunnel, crates on the walkways.
	b.as('prop', () => {
		b.box(s.x0, s.y1 - 24, -72, x1 - 304, s.y1 - 8, -56, 'pipe');
		for (let x = s.x0 + 200; x < s.x1 - 100; x += 480) {
			b.box(x, s.y0, -96, x + 16, s.y0 + 4, -80, 'lampglow');
			put(b, crate(40, k(x) ? 'crate' : 'crate_dark'), x + 120, s.y0 + 8, z);
		}
		put(b, barrel(), -2000, 1320, z);
		put(b, barrel(), -1956, 1320, z);
		put(b, pallet(true), 400, 1190, z);
	});
	// Smugglers' room south of the tunnel behind the fake wall.
	const r = rect(-1040, -752, 912, 1152);
	b.box(r.x0, r.y0, z - 32, r.x1, r.y1, z, 'sewer_floor');
	b.box(r.x0, r.y0, z, r.x1, r.y0 + 16, -32, 'sewer_brick');
	b.box(r.x0, r.y0 + 16, z, r.x0 + 16, r.y1, -32, 'sewer_brick');
	b.box(r.x1 - 16, r.y0 + 16, z, r.x1, r.y1, -32, 'sewer_brick');
	b.as('prop', () => {
		put(b, bunk(), r.x0 + 24, r.y0 + 24, z, 'n');
		put(b, table(64, 48, 30), r.x0 + 120, r.y0 + 60, z);
		put(b, chair(), r.x0 + 140, r.y0 + 112, z, 's');
		put(b, crate(48), r.x1 - 72, r.y0 + 24, z);
		put(b, crate(48), r.x1 - 72, r.y0 + 72, z);
		put(b, crate(40, 'gold'), r.x1 - 64, r.y0 + 72, z + 48);
		put(b, lamp('lampglow'), r.x0 + 200, r.y0 + 24, z);
	});
	b.spot('sewer-smugglers', 'Sewer: smugglers room behind a fake tunnel wall', v(-880, 1110, z), 'fake', 'room');
	// Drain alcove (north wall, west end): return teleporter to the back yards.
	const a = DRAIN_ALCOVE;
	b.box(a.x0 - 16, a.y0, z - 32, a.x1 + 16, a.y1 + 16, z, 'sewer_floor');
	b.box(a.x0 - 16, a.y0, z, a.x0, a.y1, z + 112, 'sewer_brick');
	b.box(a.x1, a.y0, z, a.x1 + 16, a.y1, z + 112, 'sewer_brick');
	b.box(a.x0 - 16, a.y1, z, a.x1 + 16, a.y1 + 16, z + 112, 'sewer_brick');
	b.box(a.x0 - 16, a.y0, z + 112, a.x1 + 16, a.y1 + 16, z + 128, 'sewer_brick');
	// Crawl pipe to the hotel laundry: x [-3584, -3520], y [1408, 1792], 56 tall.
	b.box(-3600, 1408, z - 32, -3504, 1792, z, 'pipe');
	b.box(-3600, 1408, z, -3584, 1792, z + 56, 'pipe');
	b.box(-3520, 1408, z, -3504, 1792, z + 56, 'pipe');
	b.box(-3600, 1408, z + 56, -3504, 1792, z + 72, 'pipe');
	b.spot('sewer-west', 'Sewer: the dark west end of the tunnel', v(-4200, 1216, z), 'teleport');
}

const k = (x: number) => Math.round(x / 480) % 2 === 0;
