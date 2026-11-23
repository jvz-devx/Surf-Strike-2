/**
 * hns_lido — the east side: the pool club (sunken pool with see-through
 * water, diving tower, pool house with a roof terrace, pump room under the
 * deck, tennis court), the avenue, and the car park (two-deck garage with
 * walkable ramps and stair cores, an elevator shaft, an electrical room
 * behind a crawl duct, the open lot and the container yard).
 *
 * Secrets: the pool drain (teleporter → pump room, walk out through a fake
 * trapdoor); under water in the deep end; fake lockers into the pool house
 * staff room; the pool house changing cubicle (visible pair with the beach
 * hut); the elevator's fake doors (teleporter → hotel roof water tank);
 * the electrical room (duck-only duct); open and stacked containers with a
 * crouch-jump onto the top stack; the garage roof phone box (visible pair
 * with the promenade).
 */
import type { LidoVariant } from './hns_lido-variant.ts';
import {
	bench,
	bin,
	boiler,
	car,
	chair,
	cone,
	container,
	counter,
	crate,
	fakeOf,
	fence,
	flight,
	lockers,
	palm,
	pallet,
	phoneBox,
	plant,
	put,
	rect,
	railing,
	shelf,
	shower,
	slab,
	stool,
	streetlamp,
	sunbed,
	table,
	tree,
	tyres,
	umbrella,
	v,
	van,
	wall,
	barrel,
	door,
	fakeHole,
	gap,
	win,
	type MapBuilder,
	type Rect
} from './hns-props.ts';

export const POOL = rect(2304, 3840, -896, 192);
export const POOL_FLOOR = -160;
export const PUMP = rect(3904, 4416, -640, -256);
export const PUMP_Z = -192;
export const DRAIN = rect(3040, 3104, -384, -320);
export const POOLHOUSE = rect(1792, 2944, 576, 1088);
export const CUBICLE_POOL = rect(2848, 2928, 592, 672);
export const GARAGE = rect(1664, 4224, 1792, 3584);
export const SHAFT = rect(1984, 2112, 3456, 3584);
export const PHONE_ROOF = { x: 3000, y: 2600, z: 384 };
const DECK1 = 192;
const ROOFZ = 384;
const RAMP1 = rect(2304, 3072, 1824, 2016);
const RAMP2 = rect(2304, 3072, 3360, 3552);
const COLS_X = [2176, 2688, 3200, 3712];
const COLS_Y = [2240, 2688, 3136];

/** Everything east of the plaza plus the avenue (large size only; medium builds just the avenue). */
export function buildEast(b: MapBuilder, holes: Rect[], variant: LidoVariant): void {
	pool(b, holes);
	poolHouse(b, holes);
	tennis(b);
	buildAvenue(b, variant);
	garage(b, holes);
	lot(b);
	b.loops.push(
		'Pool: round the pool deck, in at the shallow steps, out at the east steps',
		'Pool house: front door → hall → roof terrace stairs → jump down to the deck',
		'Car park: up ramp 1 → deck → ramp 2 → roof → stair core down',
		'Car park ground floor: weave between the columns and parked cars'
	);
}

function pool(b: MapBuilder, holes: Rect[]): void {
	const p = POOL;
	const z = POOL_FLOOR;
	holes.push(p);
	b.box(p.x0, p.y0, z - 16, p.x1, p.y1, z, 'pooltile');
	b.box(p.x0 - 16, p.y0 - 16, z - 16, p.x1 + 16, p.y0, -32, 'pooltile');
	b.box(p.x0 - 16, p.y1, z - 16, p.x1 + 16, p.y1 + 16, -32, 'pooltile');
	b.box(p.x0 - 16, p.y0, z - 16, p.x0, p.y1, -32, 'pooltile');
	b.box(p.x1, p.y0, z - 16, p.x1 + 16, p.y1, -32, 'pooltile');
	// Steps in at both ends (rise 16).
	flight(b, { x: p.x0 + 240, y: -352 }, '-x', 10, 256, z, 'pooltile');
	flight(b, { x: p.x1 - 240, y: -352 }, '+x', 10, 256, z, 'pooltile');
	b.fake(p.x0, p.y0, z, p.x1, p.y1, -24, 'poolwater');
	// Lane ropes (floating, clip-through) and the drain grate.
	for (const y of [-616, -88]) b.fake(p.x0, y, -28, p.x1, y + 4, -24, 'plastic_red');
	b.fake(DRAIN.x0, DRAIN.y0, z, DRAIN.x1, DRAIN.y1, z + 2, 'iron');
	b.spot('pool-deep', 'Pool: on the bottom of the deep end, under water', v(3600, 0, z), 'water');
	// Diving tower north of the pool: platforms at 128 and 256 with boards over the water.
	const tx0 = 3136;
	const ty0 = 208;
	for (const [x, y] of [
		[tx0, ty0],
		[tx0 + 112, ty0],
		[tx0, ty0 + 112],
		[tx0 + 112, ty0 + 112]
	] as const) {
		b.box(x, y, 0, x + 16, y + 16, 112, 'concrete');
		b.box(x, y, 128, x + 16, y + 16, 240, 'concrete');
	}
	b.box(tx0, ty0, 112, tx0 + 128, ty0 + 128, 128, 'concrete');
	b.box(tx0, ty0, 240, tx0 + 128, ty0 + 128, 256, 'concrete');
	b.box(tx0 + 40, 32, 120, tx0 + 88, ty0, 128, 'plastic_blue');
	b.box(tx0 + 40, 32, 248, tx0 + 88, ty0, 256, 'plastic_blue');
	flight(b, { x: tx0 + 64, y: ty0 + 320 }, '-y', 8, 64, 0, 'concrete');
	flight(b, { x: 2752, y: ty0 + 64 }, '+x', 16, 64, 0, 'concrete');
	// Pump room under the deck: stairs up to a fake trapdoor.
	const q = PUMP;
	const qz = PUMP_Z;
	b.box(q.x0 - 16, q.y0 - 16, qz - 16, q.x1 + 16, q.y1 + 16, qz, 'concrete');
	b.box(q.x0 - 16, q.y0 - 16, qz, q.x1 + 16, q.y0, -32, 'concrete');
	b.box(q.x0 - 16, q.y1, qz, q.x1 + 16, q.y1 + 16, -32, 'concrete');
	b.box(q.x0 - 16, q.y0, qz, q.x0, q.y1, -32, 'concrete');
	b.box(q.x1, q.y0, qz, q.x1 + 16, q.y1, -32, 'concrete');
	const hatch = rect(4304, 4400, -636, -332);
	holes.push(hatch);
	flight(b, { x: 4352, y: -620 }, '+y', 12, 96, qz, 'concrete_stair');
	b.fake(hatch.x0, hatch.y0, -32, hatch.x1, hatch.y1, 0, 'deck');
	b.room('pump room');
	b.as('prop', () => {
		put(b, crate(64, 'rust', 120), 3924, -620, qz);
		put(b, crate(64, 'rust', 120), 4000, -620, qz);
		for (let k = 0; k < 4; k++) put(b, barrel('chem', 'plastic_white'), 3930 + k * 44, -300, qz);
		put(b, shelf(160, 112, 3, 'boxes', 501), 4110, -280, qz, 's');
		b.box(3904, -460, qz + 120, 4300, -444, qz + 136, 'pipe');
		b.box(4100, -640, qz, 4116, -460, qz + 16, 'pipe');
	});
	b.spot('pump-room', 'Pump room under the pool deck', v(4180, -400, qz), 'room', 'teleport', 'fake');
	// Deck furniture.
	b.as('prop', () => {
		for (let k = 0; k < 9; k++) {
			put(b, sunbed('plastic_white', k % 2 ? 'fabric_blue' : 'fabric_red'), 2320 + k * 160, -1160, 0, 'n');
			put(b, sunbed('plastic_white', 'fabric_green'), 2360 + k * 160, -1160, 0, 'n');
			if (k % 2 === 0) put(b, umbrella(k % 4 ? 'canvas_blue' : 'canvas_white'), 2400 + k * 160, -1040, 0);
		}
		for (let k = 0; k < 4; k++) put(b, sunbed(), 1920, -800 + k * 140, 0, 'e');
		for (let k = 0; k < 3; k++) put(b, palm(240), 1700, -1300 + k * 600, 0);
		put(b, palm(260), 3950, 300, 0);
		put(b, plant(48), 2200, 260, 0);
		put(b, plant(48), 3800, -1000, 0);
		put(b, chair('plastic_white', 'plastic_white'), 2240, -100, 0, 'e');
	});
}

function poolHouse(b: MapBuilder, holes: Rect[]): void {
	const r = POOLHOUSE;
	const t = 16;
	const top = 192;
	void holes;
	b.buildings.push('pool house');
	b.room('pool bar', 'pool house hall', 'changing room', 'staff room', 'changing cubicle', 'pool house roof terrace');
	wall(b, 'x', r.x0, r.x1, r.y0, r.y0 + t, 0, top + 32, 'plaster_white', [gap(1872, 40, 288, 136), door(2328, 0, 96, 112), win(2560, 0, 192, 48, 128)]);
	wall(b, 'x', r.x0, r.x1, r.y1 - t, r.y1, 0, top + 32, 'plaster_white', [door(2080, 0, 64, 104), win(2600, 0, 96), door(2320, 0, 96, 112)]);
	wall(b, 'y', r.y0 + t, r.y1 - t, r.x0, r.x0 + t, 0, top + 32, 'plaster_white', [door(800, 0, 64, 104)]);
	wall(b, 'y', r.y0 + t, r.y1 - t, r.x1 - t, r.x1, 0, top + 32, 'plaster_white', [win(700, 0, 96)]);
	// Partitions: bar | hall | changing.
	wall(b, 'y', r.y0 + t, r.y1 - t, 2224, 2240, 0, top, 'plaster_white', [door(880, 0, 64)]);
	wall(b, 'y', r.y0 + t, r.y1 - t, 2480, 2496, 0, top, 'plaster_white', [door(720, 0, 64), door(960, 0, 64)]);
	// Roof with the terrace stairs hole.
	const stairHole = rect(2304, 2400, 624, 928);
	slab(b, rect(r.x0 + t, r.x1 - t, r.y0 + t, r.y1 - t), top, top + 16, 'roof_tar', [stairHole]);
	flight(b, { x: 2352, y: 640 }, '+y', 12, 96, 0, 'tile_white');
	// Staff room behind fake lockers: x [2752, 2928], y [912, 1072].
	b.box(2752, 896, 0, r.x1 - t, 912, top, 'plaster_white');
	wall(b, 'y', 912, r.y1 - t, 2736, 2752, 0, top, 'plaster_white', [fakeHole(960, 0, 64, 80, 'plaster_white')]);
	b.as('prop', () => {
		put(b, lockers(1), 2716, 936, 0, 'w');
		put(b, fakeOf(lockers(3)), 2716, 960, 0, 'w');
		put(b, lockers(1), 2716, 1032, 0, 'w');
		put(b, lockers(6), 2500, 1052, 0, 's');
		put(b, bench(96, 'wood_light'), 2600, 900, 0, 's');
		put(b, bench(96, 'wood_light'), 2540, 760, 0, 's');
		for (let k = 0; k < 4; k++) put(b, shower(), 2500 + k * 44, 592, 0, 'n');
		// Staff room.
		put(b, table(64, 48, 30), 2840, 1000, 0);
		put(b, chair(), 2870, 960, 0, 'n');
		put(b, shelf(96, 96, 3, 'boxes', 511), 2820, 1048, 0, 's');
		// Bar.
		put(b, counter(288, 44, 'wood_light', 'plastic_blue'), 1872, 640, 0, 's');
		put(b, shelf(256, 80, 2, 'goods', 512, 20), 1808, 1052, 0, 's');
		for (let k = 0; k < 5; k++) put(b, stool(), 1900 + k * 56, 600 - 0, 0);
		put(b, table(64, 64, 30), 1880, 860, 0);
		put(b, table(64, 64, 30), 2060, 860, 0);
		put(b, crate(32, 'plastic_red'), 2180, 1040, 0);
		// Hall.
		put(b, plant(56), 2440, 1040, 0);
		put(b, bench(96), 2410, 960, 0, 'w');
	});
	// Changing cubicle (teleporter back to the beach hut).
	const c = CUBICLE_POOL;
	b.box(c.x0 - 4, c.y0, 0, c.x0, c.y1 + 4, 112, 'wood_light');
	wall(b, 'x', c.x0, c.x1, c.y1, c.y1 + 4, 0, 112, 'wood_light', [{ a: c.x0 + 4, b: c.x1 - 4, z0: 0, z1: 104, fill: 'fake', mat: 'curtain' }]);
	b.spot('poolhouse-staff', 'Pool house: staff room behind the fake lockers', v(2840, 930, 0), 'fake', 'room');
	// Roof terrace.
	const z = top + 16;
	b.as('prop', () => {
		for (let k = 0; k < 4; k++) put(b, sunbed('plastic_white', 'fabric_blue'), 1840 + k * 64, 960, z, 'n');
		put(b, umbrella('canvas_yellow'), 2100, 700, z);
		put(b, table(48, 48, 30, 'plastic_white', 'plastic_white'), 2600, 700, z);
		put(b, chair('plastic_white', 'plastic_white'), 2560, 704, z, 'e');
		b.box(2700, 900, z, 2900, 1060, z + 24, 'pooltile');
		b.fake(2704, 904, z + 24, 2896, 1056, z + 26, 'poolwater');
		put(b, plant(48), 1820, 600, z);
	});
	b.spot('poolhouse-roof', 'Pool house roof terrace: behind the hot tub', v(2800, 870, z), 'roof');
}

function tennis(b: MapBuilder): void {
	const r = rect(3968, 4544, -1344, -704);
	b.as('prop', () => {
		b.box(r.x0, r.y0, 0, r.x1, r.y1, 1, 'court');
		for (const [x0, y0, x1, y1] of [
			[r.x0 + 32, r.y0 + 32, r.x1 - 32, r.y0 + 36],
			[r.x0 + 32, r.y1 - 36, r.x1 - 32, r.y1 - 32],
			[r.x0 + 32, r.y0 + 36, r.x0 + 36, r.y1 - 36],
			[r.x1 - 36, r.y0 + 36, r.x1 - 32, r.y1 - 36]
		] as const)
			b.box(x0, y0, 1, x1, y1, 2, 'paint');
		const ny = (r.y0 + r.y1) / 2;
		b.box(r.x0 + 16, ny - 2, 1, r.x0 + 24, ny + 2, 48, 'iron');
		b.box(r.x1 - 24, ny - 2, 1, r.x1 - 16, ny + 2, 48, 'iron');
		b.box(r.x0 + 24, ny - 1, 16, r.x1 - 24, ny + 1, 44, 'net');
		// Umpire chair (crouch-jump onto its seat platform at 56).
		b.box(r.x0 - 48, ny - 16, 0, r.x0 - 16, ny + 16, 56, 'plastic_white');
		put(b, bench(96), r.x1 + 8, ny - 48, 0, 'w');
	});
	// Mesh fence round the court with a gate on the west side.
	const fh = 128;
	wall(b, 'x', r.x0 - 64, r.x1 + 64, r.y0 - 32, r.y0 - 28, 1, fh, 'mesh');
	wall(b, 'x', r.x0 - 64, r.x1 + 64, r.y1 + 28, r.y1 + 32, 1, fh, 'mesh');
	wall(b, 'y', r.y0 - 28, r.y1 + 28, r.x0 - 68, r.x0 - 64, 1, fh, 'mesh', [door(r.y0 + 96, 1, 96, 127)]);
	b.room('tennis court');
}

/** The road; in the medium size its east end stays clear (underpass stairs, closed tunnel). */
export function buildAvenue(b: MapBuilder, variant: LidoVariant): void {
	const medium = variant.size === 'medium';
	const paints = ['car_red', 'car_blue', 'car_white', 'car_black', 'car_yellow', 'car_green', 'car_silver'];
	b.as('prop', () => {
		let k = 0;
		for (let x = -4480; x < 4400; x += 264) {
			const busy = (x > -1200 && x < -600) || (x > 1000 && x < 1600) || (x > -3000 && x < -2400) || (medium && x > 700);
			if (busy || k % 3 === 2) {
				k++;
				continue;
			}
			put(b, car(paints[k % paints.length]!), x, 1172, 0, k % 2 ? 'e' : 'w');
			k++;
		}
		k = 0;
		for (let x = -4400; x < 4400; x += 300) {
			const busy = (x + 200 > 1000 && x < 1600) || (x > -400 && x < 400) || (medium && x + 200 > 800);
			if (!busy && k % 4 !== 3) put(b, k % 5 === 0 ? van(paints[(k + 2) % paints.length]!) : car(paints[(k + 3) % paints.length]!), x, k % 5 === 0 ? 1308 : 1312, 0, k % 2 ? 'w' : 'e');
			k++;
		}
		for (let x = -4300; x < 4500; x += 640) {
			put(b, streetlamp(), x, 1152, 0);
			if (Math.abs(x + 320) > 300) put(b, streetlamp(), x + 320, 1392, 0);
		}
		// Bus shelter by the plaza.
		b.box(-160, 1376, 0, 160, 1380, 112, 'glass');
		b.box(-160, 1340, 112, 160, 1400, 120, 'plastic_red');
		b.box(-164, 1340, 0, -160, 1400, 112, 'iron');
		b.box(160, 1340, 0, 164, 1400, 112, 'iron');
		put(b, bench(128), -64, 1350, 0, 's');
		if (!medium) for (let k2 = 0; k2 < 3; k2++) put(b, cone(), 1100 + k2 * 40, 1240, 0);
	});
}

function garage(b: MapBuilder, holes: Rect[]): void {
	const g = GARAGE;
	b.buildings.push('car park');
	b.room('car park ground floor', 'car park deck', 'car park roof', 'stair core A', 'stair core B', 'electrical room', 'elevator shaft');
	const coreA = rect(1664, 1984, 3200, 3584);
	const coreB = rect(3904, 4224, 1792, 2176);
	const coreHoles = (c: Rect) => ({
		f1: rect(c.x0 + 32, c.x0 + 128, c.y0 + 16, c.y0 + 320),
		f2: rect(c.x0 + 192, c.x0 + 288, c.y0 + 64, c.y1 - 16)
	});
	const hA = coreHoles(coreA);
	const hB = coreHoles(coreB);
	slab(b, g, DECK1 - 16, DECK1, 'concrete_deck', [RAMP1, coreA, coreB, SHAFT]);
	slab(b, g, ROOFZ - 16, ROOFZ, 'concrete_deck', [RAMP2, coreA, coreB, SHAFT]);
	// Parapets on the deck and roof edges (40 tall), leaving the core sides closed by the cores.
	for (const z of [DECK1, ROOFZ]) {
		b.box(g.x0, g.y0, z, coreB.x0, g.y0 + 16, z + 40, 'concrete');
		b.box(SHAFT.x1, g.y1 - 16, z, g.x1, g.y1, z + 40, 'concrete');
		b.box(g.x0, g.y0 + 16, z, g.x0 + 16, coreA.y0, z + 40, 'concrete');
		b.box(g.x1 - 16, coreB.y1, z, g.x1, g.y1 - 16, z + 40, 'concrete');
	}
	// Columns.
	for (const x of COLS_X)
		for (const y of COLS_Y)
			for (const [z0, z1] of [
				[0, DECK1 - 16],
				[DECK1, ROOFZ - 16]
			] as const)
				b.box(x - 16, y - 16, z0, x + 16, y + 16, z1, 'concrete');
	// Ramps (walkable wedges) with curbs.
	b.wedge(RAMP1, '+x', 0, DECK1, 'concrete_ramp');
	b.wedge(RAMP2, '+x', DECK1, ROOFZ, 'concrete_ramp');
	// Stair cores: flight 1 G → deck, flight 2 deck → roof; doors on the south side at each level.
	for (const [c, h, north] of [
		[coreA, hA, false],
		[coreB, hB, true]
	] as const) {
		const t = 16;
		const top = ROOFZ + 112;
		const dx = c.x0 + 144;
		const doors = [door(dx, 0, 64, 104), door(dx, DECK1, 64, 104), door(dx, ROOFZ, 64, 104)];
		wall(b, 'x', c.x0, c.x1, c.y0, c.y0 + t, 0, top, 'concrete_core', north ? [] : doors);
		wall(b, 'x', c.x0, c.x1, c.y1 - t, c.y1, 0, top, 'concrete_core', north ? doors : []);
		wall(b, 'y', c.y0 + t, c.y1 - t, c.x0, c.x0 + t, 0, top, 'concrete_core');
		wall(b, 'y', c.y0 + t, c.y1 - t, c.x1 - t, c.x1, 0, top, 'concrete_core');
		const inner = rect(c.x0 + t, c.x1 - t, c.y0 + t, c.y1 - t);
		slab(b, inner, DECK1 - 16, DECK1, 'concrete', [h.f1]);
		slab(b, inner, ROOFZ - 16, ROOFZ, 'concrete', [h.f2]);
		b.box(c.x0, c.y0, top, c.x1, c.y1, top + 16, 'concrete');
		flight(b, { x: (h.f1.x0 + h.f1.x1) / 2, y: c.y0 + 32 }, '+y', 12, 96, 0, 'concrete_stair');
		flight(b, { x: (h.f2.x0 + h.f2.x1) / 2, y: c.y1 - 32 }, '-y', 12, 96, DECK1, 'concrete_stair');
	}
	// Elevator shaft next to core A: fake doors at ground level, teleporter inside.
	const s = SHAFT;
	const st = 16;
	const stop = ROOFZ + 112;
	wall(b, 'x', s.x0, s.x1, s.y0, s.y0 + st, 0, stop, 'concrete_core', [fakeHole(s.x0 + 32, 0, 64, 104, 'steel_door')]);
	for (const z of [DECK1, ROOFZ]) b.box(s.x0 + 32, s.y0 - 2, z, s.x0 + 96, s.y0, z + 104, 'steel_door');
	wall(b, 'y', s.y0 + st, s.y1, s.x0, s.x0 + st, 0, stop, 'concrete_core');
	wall(b, 'y', s.y0 + st, s.y1, s.x1 - st, s.x1, 0, stop, 'concrete_core');
	b.box(s.x0 + st, s.y1 - st, 0, s.x1 - st, s.y1, stop, 'concrete_core');
	b.box(s.x0, s.y0, stop, s.x1, s.y1, stop + 16, 'concrete');
	b.box(s.x0 + st, s.y0 + st, 0, s.x1 - st, s.y1 - st, 1, 'steel');
	// Electrical room (NE, ground floor) behind a duck-only duct from the west.
	const e = rect(4032, 4224, 3392, 3584);
	wall(b, 'y', e.y0, e.y1 - 16, e.x0, e.x0 + 16, 0, DECK1 - 16, 'concrete', [gap(3456, 0, 64, 60)]);
	b.box(e.x0 + 16, e.y0, 0, e.x1 - 16, e.y0 + 16, DECK1 - 16, 'concrete');
	b.box(e.x0, e.y1 - 16, 0, e.x1, e.y1, DECK1 - 16, 'concrete');
	b.box(e.x1 - 16, e.y0, 0, e.x1, e.y1 - 16, DECK1 - 16, 'concrete');
	const d = rect(3712, 4032, 3440, 3536);
	b.box(d.x0, d.y0, 0, d.x1, d.y0 + 16, 60, 'duct');
	b.box(d.x0, d.y1 - 16, 0, d.x1, d.y1, 60, 'duct');
	b.box(d.x0, d.y0, 60, d.x1, d.y1, 72, 'duct');
	b.crawl('garage-duct', v(3740, 3488, 0), v(4000, 3488, 0));
	b.as('prop', () => {
		for (let k = 0; k < 2; k++) put(b, crate(48, 'transformer', 96), e.x0 + 40 + k * 48, e.y1 - 64, 0);
		put(b, shelf(96, 96, 3, 'boxes', 601), e.x1 - 40, e.y0 + 40, 0, 'w');
	});
	b.spot('garage-electrical', 'Car park: electrical room at the end of the crawl duct', v(4128, 3440, 0), 'crawl', 'room');

	// Parked cars on every level (skip columns, ramps, holes, cores).
	const blocked = (z: number): Rect[] => {
		const out: Rect[] = [coreA, coreB, SHAFT, e, d, rect(3700, 4032, 3420, 3560)];
		for (const x of COLS_X) for (const y of COLS_Y) out.push(rect(x - 24, x + 24, y - 24, y + 24));
		if (z === 0) out.push(rect(RAMP1.x0 - 32, RAMP1.x1 + 32, RAMP1.y0 - 16, RAMP1.y1 + 16));
		if (z === DECK1) out.push(RAMP1, rect(RAMP2.x0 - 32, RAMP2.x1 + 32, RAMP2.y0 - 16, RAMP2.y1 + 16), hA.f1, hB.f1);
		if (z === ROOFZ) out.push(RAMP2, hA.f2, hB.f2, rect(PHONE_ROOF.x - 64, PHONE_ROOF.x + 136, PHONE_ROOF.y - 96, PHONE_ROOF.y + 136));
		return out;
	};
	const paints = ['car_red', 'car_blue', 'car_white', 'car_black', 'car_yellow', 'car_green', 'car_silver'];
	let k = 0;
	for (const z of [0, DECK1, ROOFZ]) {
		const bl = blocked(z);
		for (const y of [2272, 2880]) {
			for (let x = 1720; x + 80 < g.x1 - 24; x += 112) {
				const r = rect(x - 8, x + 88, y - 8, y + 192);
				if (bl.some((q) => r.x0 < q.x1 && q.x0 < r.x1 && r.y0 < q.y1 && q.y0 < r.y1)) continue;
				k++;
				if (k % 3 === 0) continue;
				put(b, k % 7 === 0 ? van(paints[k % paints.length]!) : car(paints[k % paints.length]!), x, y, z, k % 2 ? 'n' : 's');
			}
		}
	}
	b.as('prop', () => {
		put(b, phoneBox(), PHONE_ROOF.x, PHONE_ROOF.y, ROOFZ, 's');
		for (let i = 0; i < 6; i++) put(b, cone(), 2000 + i * 40, 2100, 0);
		put(b, bin(), 1700, 3150, 0);
		put(b, tyres(4), 3300, 3500, 0);
	});
	b.spot('garage-roof-van', 'Car park roof: behind the parked cars by the north parapet', v(3600, 3500, ROOFZ), 'roof');
	void holes;
}

function lot(b: MapBuilder): void {
	b.as('prop', () => {
		const paints = ['car_white', 'car_blue', 'car_red', 'car_silver'];
		for (let k = 0; k < 10; k++) {
			if (k === 4 || k === 8) continue;
			put(b, car(paints[k % 4]!), 1720 + k * 240, 1440, 0, 'n');
		}
		for (let k = 0; k < 4; k++) put(b, tree(128, 72), 1320, 1500 + k * 520, 0);
		for (let k = 0; k < 3; k++) put(b, streetlamp(), 2200 + k * 800, 1700, 0);
		// Ticket booth.
		b.box(1400, 3700, 0, 1520, 3800, 112, 'plastic_white');
		b.box(1392, 3692, 112, 1528, 3808, 120, 'plastic_red');
		b.box(1520, 3740, 32, 1700, 3744, 40, 'plastic_red');
	});
	// Container yard x [4256, 4576], y [2240, 3520]: stacks two high, some open.
	b.as('prop', () => {
		const mats = ['container_red', 'container_blue', 'container_green', 'container_orange'];
		put(b, container(mats[0]!, true, false), 4256, 2240, 0, 's');
		put(b, container(mats[1]!), 4256, 2240, 104, 's');
		put(b, container(mats[2]!), 4384, 2240, 0, 's');
		put(b, container(mats[3]!, true, true), 4384, 2624, 0, 's');
		put(b, container(mats[0]!), 4256, 2640, 0, 'n');
		put(b, container(mats[1]!), 4256, 2640, 104, 'n');
		put(b, container(mats[2]!, true, false), 4288, 3040, 0, 'n');
		put(b, container(mats[3]!), 4384, 3040, 0, 'n');
		put(b, container(mats[1]!), 4384, 3040, 104, 'n');
		// Climb: crate (48) → crate on crate (96) → container top (104) → crates on top → second stack (208).
		put(b, crate(48), 4336, 2992, 0);
		put(b, crate(48), 4288, 2992, 0);
		put(b, crate(48), 4288, 2992, 48);
		put(b, crate(48), 4336, 3200, 104);
		put(b, pallet(true), 4400, 3500, 0);
		put(b, barrel(), 4520, 3460, 0);
		put(b, barrel(), 4480, 3460, 0);
	});
	b.spot('container-open', 'Container yard: inside the open container', v(4304, 2300, 4), 'prop');
	b.spot('container-fake', 'Container yard: inside the container with fake doors', v(4432, 2690, 4), 'prop', 'fake');
	b.spot('container-top', 'Container yard: on top of the double stack', v(4432, 3300, 208), 'roof', 'crouchjump');
}
