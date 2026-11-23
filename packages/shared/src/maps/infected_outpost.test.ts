import { describe, expect, it } from 'vitest';
import { buildCollisionWorld } from '../collision/world.ts';
import { InfectedGame, INF_KNIFE_MAX, INF_KNIFE_MIN, INF_KNIFE_WALL_REACH, INF_STEP_MS, type InfEvent } from '../modes/infected/index.ts';
import { INFECTED_CVARS, ZOMBIES_CVARS } from '../modes/index.ts';
import { WEAPONS } from '../modes/zombies/weapons.ts';
import { HULL_MAX, HULL_MIN, IN_JUMP, VIEW_HEIGHT, type PlayerState, type UserCmd } from '../movement/api.ts';
import { createPlayer, playerMove } from '../movement/gamemovement.ts';
import type { Vec3 } from '../types.ts';
import { TICK_INTERVAL } from '../units.ts';
import { infected_outpost as m, OUTPOST, ARENA, CURTAIN_TOP, WALL_TOP } from './infected_outpost.ts';
import { boundsOf, brushBounds, dirXY, gapXY, type Box3, type BoxBrush } from './helpers.ts';
import type { ClimbRoute } from './tag-helpers.ts';

/** Same as SPAWN_CLEARANCE in ./index.ts (spawns are authored on floor tops and lifted at load). */
const CLEARANCE = 0.25;
const STEP = 18;
/** Standing jump apex is ~55.8 units. */
const JUMP = 55;
/** Jump-up ledges on climb routes stay at or under 40 (see tag_quayside.test.ts). */
const LEDGE = 40;
const HULL_H = 72;
/** Every interior brush top stays at or under this (only non-climbable masts and beacons rise past the wall top). */
const MAX_TOP = 420;
/** The highest climbable top (stacked container, dock canopy). */
const CLIMB_TOP = 240;
const WALL_T = 64;

const boxes = m.brushes.filter((b): b is BoxBrush => b.type === 'box');
const world = buildCollisionWorld(m);
const spawns = m.spawns ?? [];
const all = m.brushes.map(brushBounds);
const top = (b: Box3) => b.max.z;
const overlaps = (a: Box3, b: Box3, eps = 0.01) =>
	a.min.x < b.max.x - eps &&
	b.min.x < a.max.x - eps &&
	a.min.y < b.max.y - eps &&
	b.min.y < a.max.y - eps &&
	a.min.z < b.max.z - eps &&
	b.min.z < a.max.z - eps;
const inBox = (p: Vec3, b: Box3) =>
	p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;
const loaded = (p: Vec3): Vec3 => ({ ...p, z: Math.round(p.z) + CLEARANCE });
function standsFree(p: Vec3): { solid: boolean; ground: boolean } {
	const t = world.trace(p, p, HULL_MIN, HULL_MAX);
	const down = world.trace(p, { ...p, z: p.z - 2 }, HULL_MIN, HULL_MAX);
	return { solid: t.startsolid, ground: down.fraction < 1 && down.plane.normal.z >= 0.7 };
}
/** Standing hull walks straight from a to b (both on floor height z) without hitting anything. */
function walks(a: { x: number; y: number }, b: { x: number; y: number }, z = 0): boolean {
	const s = { x: a.x, y: a.y, z: z + CLEARANCE };
	const e = { x: b.x, y: b.y, z: z + CLEARANCE };
	const t = world.trace(s, e, HULL_MIN, HULL_MAX);
	return !t.startsolid && t.fraction === 1;
}
const isGround = (s: Box3) => OUTPOST.ground.includes(s as BoxBrush);
const quadrant = (p: Vec3) => (p.x > 0 ? (p.y > 0 ? 'NE' : 'SE') : p.y > 0 ? 'NW' : 'SW');

describe('infected_outpost', () => {
	it('is an open infected map with the zombies physics profile and only teleport zones', () => {
		expect(m.id).toBe('infected_outpost');
		expect(m.title).toBe('Outpost');
		expect(m.kind as string).toBe('infected');
		expect(m.layout).toBe('open');
		expect(m.cvars).toEqual({ ...ZOMBIES_CVARS });
		expect(m.zones.length).toBeGreaterThanOrEqual(1);
		for (const z of m.zones) expect(z.type).toBe('teleport');
		expect(m.zombies).toBeUndefined();
	});

	it('has a warm desert theme with haze fog and clouds', () => {
		const t = m.theme;
		expect(t.fogNear).toBeGreaterThanOrEqual(2400);
		expect(t.fogFar).toBeGreaterThanOrEqual(12000);
		expect(t.fogFar).toBeGreaterThan(t.fogNear);
		expect(t.sunDir.z).toBeGreaterThan(0);
		expect(t.effects.some((e) => e.type === 'clouds')).toBe(true);
		const known = ['aurora', 'embers', 'clouds', 'gridFloor', 'lavaSea', 'snowFloor'];
		for (const e of t.effects) expect(known).toContain(e.type);
		// Warm sun: red channel above blue.
		expect(t.sunColor >> 16).toBeGreaterThan(t.sunColor & 0xff);
	});

	it('every brush material exists in the theme and the map uses only boxes', () => {
		for (const b of m.brushes) expect(m.theme.materials[b.material], b.material).toBeDefined();
		expect(boxes).toHaveLength(m.brushes.length);
		for (const b of boxes) {
			expect(b.max.x).toBeGreaterThan(b.min.x);
			expect(b.max.y).toBeGreaterThan(b.min.y);
			expect(b.max.z).toBeGreaterThan(b.min.z);
		}
	});

	it('has at least 16 spawns, free and on ground in the real trace', () => {
		expect(spawns.length).toBeGreaterThanOrEqual(16);
		for (const [i, s] of [m.spawn, ...spawns].entries()) {
			expect(s.pos.z, `spawn ${i} authored at floor height`).toBe(0);
			const r = standsFree(loaded(s.pos));
			expect(r.solid, `spawn ${i} starts solid`).toBe(false);
			expect(r.ground, `spawn ${i} has no ground`).toBe(true);
		}
	});

	it('spawns are at least 256 apart, inside the arena, facing inward, ≥ 4 per quadrant', () => {
		for (let i = 0; i < spawns.length; i++) {
			const a = spawns[i]!;
			expect(Math.abs(a.pos.x)).toBeLessThanOrEqual(ARENA - 128);
			expect(Math.abs(a.pos.y)).toBeLessThanOrEqual(ARENA - 128);
			expect(a.pos.x, `spawn ${i} on an axis`).not.toBe(0);
			expect(a.pos.y, `spawn ${i} on an axis`).not.toBe(0);
			const d = dirXY(a.yaw);
			expect(d.x * -a.pos.x + d.y * -a.pos.y, `spawn ${i} faces out`).toBeGreaterThan(0);
			for (let j = i + 1; j < spawns.length; j++) {
				const b = spawns[j]!;
				expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y), `spawns ${i}, ${j}`).toBeGreaterThanOrEqual(256);
			}
		}
		for (const q of ['NE', 'NW', 'SW', 'SE'])
			expect(spawns.filter((s) => quadrant(s.pos) === q).length, `${q} spawns`).toBeGreaterThanOrEqual(4);
	});

	it('every spawn looks down an open sightline: ≥ 256 clear ahead at eye height, ±15° (spec floor 192)', () => {
		const h = { x: -8, y: -8, z: -8 };
		const H = { x: 8, y: 8, z: 8 };
		for (const [i, s] of [m.spawn, ...spawns].entries())
			for (const dyaw of [-15, 0, 15]) {
				const d = dirXY(s.yaw + dyaw);
				const eye = { x: s.pos.x, y: s.pos.y, z: s.pos.z + CLEARANCE + 64 };
				const t = world.trace(eye, { x: eye.x + d.x * 256, y: eye.y + d.y * 256, z: eye.z }, h, H);
				expect([t.startsolid, t.fraction], `spawn ${i} (${s.pos.x}, ${s.pos.y}) yaw ${s.yaw}${dyaw >= 0 ? '+' : ''}${dyaw}`).toEqual([false, 1]);
			}
	});

	it('no two brushes intersect (touching is fine)', () => {
		for (let i = 0; i < all.length; i++)
			for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i]!, all[j]!), `brushes ${i} and ${j}`).toBe(false);
	});

	it('has no player-trapping slots: walkable-height gaps are < 1 or > 40 units', () => {
		for (let i = 0; i < all.length; i++)
			for (let j = i + 1; j < all.length; j++) {
				const a = all[i]!;
				const b = all[j]!;
				const z0 = Math.max(a.min.z, b.min.z, 0);
				const z1 = Math.min(a.max.z, b.max.z);
				if (z1 - z0 < 1) continue;
				const g = gapXY(a, b);
				if (g < 1 || g > 40) continue;
				const mid = {
					x: (Math.max(a.min.x, b.min.x) + Math.min(a.max.x, b.max.x)) / 2,
					y: (Math.max(a.min.y, b.min.y) + Math.min(a.max.y, b.max.y)) / 2,
					z: (z0 + z1) / 2
				};
				const filled = all.some((c, k) => k !== i && k !== j && inBox(mid, c));
				expect(filled, `brushes ${i} (${m.brushes[i]!.material}) and ${j} (${m.brushes[j]!.material}): open gap ${g.toFixed(2)}`).toBe(true);
			}
	});

	it('is enclosed: four perimeter walls around everything, a teleport under the map', () => {
		const walls = boxes.filter((b) => b.material === 'perimeter');
		expect(walls).toHaveLength(4);
		for (const w of walls) {
			expect(w.max.z).toBe(WALL_TOP);
			expect(w.min.z).toBe(-64);
			expect(Math.min(w.max.x - w.min.x, w.max.y - w.min.y)).toBe(64);
		}
		// Wall decoration: pilasters and the base band hug the inner faces; coping and watch posts sit on top.
		const decor = new Set<BoxBrush>([...OUTPOST.walls.trim, ...OUTPOST.walls.coping, ...OUTPOST.walls.watchPosts, ...OUTPOST.walls.curtain]);
		for (const d of decor) {
			if (d.min.z >= WALL_TOP) {
				expect(Math.max(Math.abs(d.min.x), Math.abs(d.max.x), Math.abs(d.min.y), Math.abs(d.max.y))).toBeLessThanOrEqual(ARENA + WALL_T + 16);
			} else {
				expect(d.min.z).toBe(0);
				expect(d.max.z).toBeLessThanOrEqual(WALL_TOP + 16);
				expect(walls.some((w) => gapXY(w, d) === 0), `${d.material} trim touches a wall`).toBe(true);
				expect(Math.min(ARENA - Math.abs(d.min.x), ARENA - Math.abs(d.max.x), ARENA - Math.abs(d.min.y), ARENA - Math.abs(d.max.y))).toBe(0);
			}
		}
		const inner = m.brushes.filter((b) => b.material !== 'perimeter' && !decor.has(b as BoxBrush)).map(brushBounds);
		for (const b of inner) {
			expect(b.min.x).toBeGreaterThanOrEqual(-ARENA);
			expect(b.min.y).toBeGreaterThanOrEqual(-ARENA);
			expect(b.max.x).toBeLessThanOrEqual(ARENA);
			expect(b.max.y).toBeLessThanOrEqual(ARENA);
			expect(b.max.z).toBeLessThanOrEqual(MAX_TOP);
		}
		// The low wall still encloses: the highest climb-route top plus a full jump stays well under it.
		const climbTop = Math.max(...OUTPOST.climbs.flatMap((r) => r.surfaces.map(top)));
		expect(climbTop).toBe(CLIMB_TOP);
		expect(WALL_TOP - (climbTop + JUMP)).toBeGreaterThanOrEqual(64);
		expect(WALL_TOP).toBeLessThanOrEqual(400);
		const closes = (pred: (w: BoxBrush) => boolean) => walls.some(pred);
		expect(closes((w) => w.max.x <= -ARENA && w.min.y <= -ARENA && w.max.y >= ARENA)).toBe(true);
		expect(closes((w) => w.min.x >= ARENA && w.min.y <= -ARENA && w.max.y >= ARENA)).toBe(true);
		expect(closes((w) => w.max.y <= -ARENA && w.min.x <= -ARENA && w.max.x >= ARENA)).toBe(true);
		expect(closes((w) => w.min.y >= ARENA && w.min.x <= -ARENA && w.max.x >= ARENA)).toBe(true);

		// Ground tiles cover the whole arena at z = 0 (no overlaps: see above).
		let groundArea = 0;
		for (const g of OUTPOST.ground) {
			expect(g.max.z).toBe(0);
			expect(g.min.z).toBe(-64);
			expect(Math.max(Math.abs(g.min.x), Math.abs(g.max.x), Math.abs(g.min.y), Math.abs(g.max.y))).toBeLessThanOrEqual(ARENA);
			groundArea += (g.max.x - g.min.x) * (g.max.y - g.min.y);
		}
		expect(groundArea).toBe(4 * ARENA * ARENA);

		const tps = m.zones.filter((z) => z.type === 'teleport');
		const b = boundsOf(m.brushes);
		expect(
			tps.some((z) => z.to === 'start' && z.max.z <= b.min.z && z.min.x <= b.min.x && z.min.y <= b.min.y && z.max.x >= b.max.x && z.max.y >= b.max.y)
		).toBe(true);
		for (const tp of tps) {
			for (const br of all) expect(overlaps(tp, br), 'teleport overlaps a brush').toBe(false);
			for (const s of [m.spawn, ...spawns]) expect(inBox(loaded(s.pos), tp)).toBe(false);
		}
	});

	it('every claimed climb route is walkable (≤ 18 per step) or jumpable (≤ 40 per ledge)', () => {
		expect(OUTPOST.climbs.length).toBeGreaterThanOrEqual(10);
		for (const route of OUTPOST.climbs) {
			const limit = route.how === 'step' ? STEP : LEDGE;
			for (let i = 1; i < route.surfaces.length; i++) {
				const a = route.surfaces[i - 1]!;
				const b = route.surfaces[i]!;
				expect(gapXY(a, b), `${route.label} ${i}: surfaces not adjacent`).toBeLessThanOrEqual(0.5);
				expect(top(b) - top(a), `${route.label} ${i}: rise`).toBeLessThanOrEqual(limit);
			}
			// Every surface is the top of a real brush (landing areas lie on one).
			for (const [i, s] of route.surfaces.entries()) {
				const on = all.some(
					(br) => br.max.z === s.max.z && br.min.x <= s.min.x && br.max.x >= s.max.x && br.min.y <= s.min.y && br.max.y >= s.max.y
				);
				expect(on, `${route.label} ${i}: not on a brush top`).toBe(true);
			}
			const dst = route.surfaces[route.surfaces.length - 1]!;
			let free = 0;
			for (let u = 0.125; u < 1; u += 0.25)
				for (let w = 0.125; w < 1; w += 0.25) {
					const c = { x: dst.min.x + (dst.max.x - dst.min.x) * u, y: dst.min.y + (dst.max.y - dst.min.y) * w, z: top(dst) + CLEARANCE };
					const r = standsFree(c);
					if (!r.solid && r.ground) free++;
				}
			expect(free, `${route.label}: no free standing spot on the destination`).toBeGreaterThanOrEqual(8);
		}
	});

	it('stairs leave head room: nothing within a hull height above any step or landing', () => {
		for (const route of OUTPOST.climbs.filter((r) => r.how === 'step'))
			for (const [i, s] of route.surfaces.entries()) {
				if (isGround(s)) continue;
				const space: Box3 = { min: { ...s.min, z: s.max.z }, max: { ...s.max, z: s.max.z + HULL_H } };
				for (const [j, b] of all.entries()) expect(overlaps(space, b), `${route.label} ${i}: ceiling (brush ${j})`).toBe(false);
			}
	});

	it('jump climbs leave room for a full jump over every take-off', () => {
		for (const route of OUTPOST.climbs.filter((r) => r.how === 'jump'))
			for (const [i, s] of route.surfaces.slice(0, -1).entries()) {
				if (isGround(s)) continue;
				const space: Box3 = { min: { ...s.min, z: s.max.z }, max: { ...s.max, z: s.max.z + JUMP + HULL_H } };
				for (const [j, b] of all.entries()) expect(overlaps(space, b), `${route.label} ${i}: overhang (brush ${j})`).toBe(false);
			}
	});

	it('climbable tops: roofs and decks match the design heights; the radar mast is out of jump reach', () => {
		const { radar, bunker, dock, watchtower, courtyard } = OUTPOST;
		expect(top(radar.deck)).toBe(160);
		expect(top(bunker.roof)).toBe(176);
		expect(top(dock.platform)).toBe(64);
		expect(top(dock.containerSouth)).toBe(128);
		expect(dock.upperContainer.min.z).toBe(128);
		expect(top(dock.upperContainer)).toBe(240);
		expect(top(watchtower.deck)).toBe(192);
		expect(top(courtyard.bridge)).toBe(176);
		for (const p of radar.parapets) {
			expect(p.min.z).toBe(160);
			expect(p.max.z).toBe(200);
		}
		// Mast towers over the plinth beyond a standing jump.
		expect(top(radar.mast) - top(radar.plinth)).toBeGreaterThan(JUMP * 2);
		expect(top(radar.dish)).toBeLessThanOrEqual(MAX_TOP);
		// Every landmark sits in its quadrant.
		const c = (b: Box3) => ({ x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: 0 });
		expect(quadrant(c(radar.deck))).toBe('NE');
		expect(quadrant(c(bunker.roof))).toBe('SW');
		expect(quadrant(c(dock.platform))).toBe('SE');
		expect(quadrant(c(watchtower.deck))).toBe('NW');
		expect(Math.hypot(c(courtyard.island).x, c(courtyard.island).y)).toBeLessThan(128);
	});

	it('the radar deck is reached by two stair flights (south and west) with 10 steps of 16', () => {
		const routes = OUTPOST.climbs.filter((r) => r.label.startsWith('radar') && r.how === 'step' && isGround(r.surfaces[0]!));
		expect(routes).toHaveLength(2);
		for (const r of routes) {
			const steps = r.surfaces.slice(1, -1);
			expect(steps).toHaveLength(10);
			for (const s of steps) expect(Math.min(s.max.x - s.min.x, s.max.y - s.min.y)).toBe(32);
			for (const s of steps) expect(Math.max(s.max.x - s.min.x, s.max.y - s.min.y)).toBe(128);
			expect(top(r.surfaces[r.surfaces.length - 1]!)).toBe(160);
		}
	});

	it('the bunker has two wide doorways into a free interior room with a 160 ceiling', () => {
		const { doorways, interior, roof } = OUTPOST.bunker;
		expect(doorways).toHaveLength(2);
		for (const [i, d] of doorways.entries()) {
			expect(Math.max(d.max.x - d.min.x, d.max.y - d.min.y), `doorway ${i} width`).toBeGreaterThanOrEqual(160);
			expect(d.max.z - d.min.z, `doorway ${i} height`).toBeGreaterThanOrEqual(128);
			for (const [j, b] of all.entries()) expect(overlaps(d, b), `doorway ${i} blocked by brush ${j}`).toBe(false);
		}
		expect(roof.min.z).toBe(interior.max.z);
		expect(interior.max.z - interior.min.z).toBeGreaterThanOrEqual(HULL_H + 64);
		const inside = { x: (interior.min.x + interior.max.x) / 2 + 128, y: (interior.min.y + interior.max.y) / 2 - 128 };
		// Walk in through each doorway from outside.
		const north = doorways[0]!;
		const nx = (north.min.x + north.max.x) / 2;
		expect(walks({ x: nx, y: north.max.y + 96 }, { x: nx, y: north.min.y - 96 })).toBe(true);
		const east = doorways[1]!;
		const ey = (east.min.y + east.max.y) / 2;
		expect(walks({ x: east.max.x + 96, y: ey }, { x: east.min.x - 96, y: ey })).toBe(true);
		const r = standsFree(loaded({ ...inside, z: 0 }));
		expect(r.solid).toBe(false);
		expect(r.ground).toBe(true);
	});

	it('the bunker roof is reached by stairs and by a crate stack; the bridge links it to the watchtower', () => {
		const labels = OUTPOST.climbs.map((r) => r.label);
		for (const l of ['bunker stairs', 'bunker crate stack', 'bunker roof → bridge → watchtower', 'watchtower → bridge → bunker roof'])
			expect(labels).toContain(l);
		const stairsRoute = OUTPOST.climbs.find((r) => r.label === 'bunker stairs')!;
		expect(stairsRoute.surfaces.slice(1, -1)).toHaveLength(11);
		const watch = OUTPOST.climbs.filter((r) => r.label.startsWith('watchtower') && isGround(r.surfaces[0]!));
		expect(watch.map((r) => r.how).sort()).toEqual(['jump', 'step']);
		expect(OUTPOST.climbs.find((r) => r.label === 'watchtower stairs')!.surfaces.slice(1, -1)).toHaveLength(12);
	});

	it('the watchtower stands on four pillars and is open underneath', () => {
		const { deck, pillars } = OUTPOST.watchtower;
		expect(pillars).toHaveLength(4);
		for (const p of pillars) {
			expect(p.min.z).toBe(0);
			expect(p.max.z).toBe(deck.min.z);
		}
		const cx = (deck.min.x + deck.max.x) / 2;
		const cy = (deck.min.y + deck.max.y) / 2;
		// Walk straight through under the deck both ways.
		expect(walks({ x: deck.min.x - 96, y: cy }, { x: deck.max.x - 96, y: cy })).toBe(true);
		// (east of the south crate climb, west of the east pillars)
		expect(walks({ x: cx + 104, y: deck.min.y - 96 }, { x: cx + 104, y: deck.max.y + 96 })).toBe(true);
		const r = standsFree(loaded({ x: cx, y: cy, z: 0 }));
		expect(r.solid).toBe(false);
	});

	it('flank corridors are at least 128 wide and walkable end to end', () => {
		const { platform, containerSouth, containerEast } = OUTPOST.dock;
		expect(platform.min.y - containerSouth.max.y).toBeGreaterThanOrEqual(128);
		expect(containerEast.min.x - platform.max.x).toBeGreaterThanOrEqual(128);
		expect(ARENA - containerEast.max.x).toBeGreaterThanOrEqual(128);
		const ys = (containerSouth.max.y + platform.min.y) / 2;
		expect(walks({ x: platform.min.x - 64, y: ys }, { x: platform.max.x + 64, y: ys })).toBe(true);
		const xe = (platform.max.x + containerEast.min.x) / 2;
		expect(walks({ x: xe, y: containerEast.min.y - 64 }, { x: xe, y: containerEast.max.y + 64 })).toBe(true);
		const xw = (containerEast.max.x + ARENA) / 2;
		expect(walks({ x: xw, y: containerEast.min.y - 64 }, { x: xw, y: containerEast.max.y + 64 })).toBe(true);
		// The courtyard loop: around the fuel island between it and the barriers.
		expect(walks({ x: -224, y: -224 }, { x: 224, y: -224 })).toBe(true);
		expect(walks({ x: 224, y: -224 }, { x: 224, y: 224 })).toBe(true);
	});

	it('the courtyard has a jumpable fuel island, waist-high barriers and a bridge reachable from it', () => {
		const { island, fuelTanks, barriers, bridge } = OUTPOST.courtyard;
		expect(top(island)).toBeLessThanOrEqual(LEDGE);
		for (const t of [...fuelTanks, ...OUTPOST.courtyard.fuelCradles]) {
			expect(t.min.z).toBeGreaterThanOrEqual(top(island));
			expect(t.max.x <= island.max.x && t.min.x >= island.min.x && t.max.y <= island.max.y && t.min.y >= island.min.y).toBe(true);
		}
		// Low-profile tanks: the skids sit on the island and nothing tops 128.
		expect(fuelTanks.filter((t) => t.min.z === top(island)).length).toBe(2);
		expect(Math.max(...fuelTanks.map(top))).toBeLessThanOrEqual(128);
		// A survivor beside the island sees the radar dish over the tanks.
		const dish = OUTPOST.radar.dish;
		const target = { x: (dish.min.x + dish.max.x) / 2, y: (dish.min.y + dish.max.y) / 2, z: (dish.min.z + dish.max.z) / 2 };
		for (const from of [
			{ x: -300, y: -300 },
			{ x: -400, y: -160 },
			{ x: 0, y: -400 }
		]) {
			const eye = { x: from.x, y: from.y, z: CLEARANCE + VIEW_HEIGHT };
			// The eye ray's first hit is the dish assembly itself, not a tank.
			const t = world.trace(eye, target, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
			const head = boundsOf([dish, ...OUTPOST.radar.dishParts]);
			const near = { min: { ...head.min, x: head.min.x - 1, y: head.min.y - 1, z: head.min.z - 1 }, max: { x: head.max.x + 1, y: head.max.y + 1, z: head.max.z + 1 } };
			expect(inBox(t.endpos, near), `dish hidden from (${from.x}, ${from.y}): hit at ${JSON.stringify(t.endpos)}`).toBe(true);
		}
		expect(barriers.length).toBeGreaterThanOrEqual(4);
		for (const b of barriers) {
			expect(b.min.z).toBe(0);
			expect(top(b)).toBeGreaterThanOrEqual(32);
			expect(top(b)).toBeLessThanOrEqual(48);
		}
		// Room to walk under the bridge.
		expect(bridge.min.z).toBeGreaterThanOrEqual(HULL_H + 32);
		expect(OUTPOST.climbs.some((r) => isGround(r.surfaces[0]!) && r.surfaces[r.surfaces.length - 1] === bridge)).toBe(true);
	});
});

describe('infected_outpost architecture', () => {
	const mats = (bs: BoxBrush[]) => new Set(bs.map((b) => b.material));
	const groundMat = (x: number, y: number) => OUTPOST.ground.find((g) => x >= g.min.x && x < g.max.x && y >= g.min.y && y < g.max.y)!.material;

	it('the floor reads as lanes: sand plus tarmac roads linking bunker, courtyard, radar and dock', () => {
		expect(mats(OUTPOST.ground)).toEqual(new Set(['sand', 'tarmac', 'apron', 'stripe', 'bunkerFloor']));
		// Sample along each road: every point is paved (not sand).
		const roads: Array<[string, XY, XY]> = [
			['bunker east door → plaza', { x: -620, y: -800 }, { x: -300, y: -800 }],
			['bunker → plaza (north)', { x: -352, y: -800 }, { x: -352, y: -300 }],
			['plaza → radar', { x: 0, y: 256 }, { x: 736, y: 256 }],
			['radar road → radar apron', { x: 736, y: 256 }, { x: 736, y: 600 }],
			['plaza → dock', { x: 0, y: -416 }, { x: 640, y: -416 }],
			['dock road', { x: 512, y: -416 }, { x: 512, y: -940 }],
			['plaza → watchtower', { x: -352, y: 0 }, { x: -352, y: 740 }],
			['under the bridge', { x: -704, y: -560 }, { x: -704, y: 690 }]
		];
		for (const [label, a, b] of roads)
			for (let u = 0; u <= 1; u += 1 / 32) {
				const mat = groundMat(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
				expect(mat, `${label} at ${u.toFixed(2)}`).not.toBe('sand');
			}
		expect(groundMat(1408, 1408)).toBe('sand');
		expect(groundMat(-960, -900)).toBe('bunkerFloor');
	});

	it('the compound walls carry pilasters, a base band, coping and two high watch posts', () => {
		const { trim, coping, watchPosts } = OUTPOST.walls;
		const pil = trim.filter((b) => b.material === 'buttress');
		const band = trim.filter((b) => b.material === 'plinth');
		expect(pil.length).toBeGreaterThanOrEqual(20);
		expect(band.length).toBeGreaterThanOrEqual(20);
		for (const b of band) expect(b.max.z, 'band too tall to jump onto').toBeGreaterThan(JUMP);
		for (const p of pil) expect(p.max.z).toBe(WALL_TOP + 16);
		expect(coping).toHaveLength(4);
		for (const c of coping) expect(c.min.z).toBe(WALL_TOP);
		const cabins = watchPosts.filter((b) => b.material === 'watchpost');
		expect(cabins).toHaveLength(2);
		for (const c of cabins) expect(c.min.z).toBe(WALL_TOP + 16);
		// The posts rise into the open sky above the low wall.
		const postTop = Math.max(...watchPosts.map(top));
		expect(postTop).toBeGreaterThanOrEqual(480);
		expect(postTop).toBeLessThanOrEqual(544);
		// The band and pilasters leave the 128-wide container corridor by the east wall walkable.
		const { containerEast } = OUTPOST.dock;
		const eastTrim = trim.filter((b) => b.max.x === ARENA && b.max.y > containerEast.min.y && b.min.y < containerEast.max.y);
		for (const b of eastTrim) expect(b.min.x - containerEast.max.x).toBeGreaterThanOrEqual(96);
	});

	it('an invisible curtain over the low walls stops high knives at the arena edge, corners included', () => {
		const { curtain } = OUTPOST.walls;
		expect(curtain.length).toBeGreaterThanOrEqual(4);
		const c = m.theme.materials.curtain!;
		expect([c.opacity, c.edgeColor, c.glass, c.seamColor]).toEqual([0, undefined, undefined, undefined]);
		for (const b of curtain) {
			expect(b.material).toBe('curtain');
			expect(b.min.z).toBeGreaterThanOrEqual(WALL_TOP + 16);
			expect(b.max.z).toBeLessThanOrEqual(CURTAIN_TOP);
			// On the wall footprint, never inside the arena.
			expect(Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.y), Math.abs(b.max.y))).toBeGreaterThan(ARENA);
			expect(b.min.x >= ARENA || b.max.x <= -ARENA || b.min.y >= ARENA || b.max.y <= -ARENA).toBe(true);
		}
		const km = { x: -2, y: -2, z: -2 };
		const kM = { x: 2, y: 2, z: 2 };
		const edge = ARENA - 8;
		for (let z = WALL_TOP + 24; z < CURTAIN_TOP - 8; z += 40)
			for (let u = -edge; u <= edge; u += 32)
				for (const [from, to] of [
					[{ x: -edge, y: u }, { x: -ARENA - 200, y: u }],
					[{ x: edge, y: u }, { x: ARENA + 200, y: u }],
					[{ x: u, y: -edge }, { x: u, y: -ARENA - 200 }],
					[{ x: u, y: edge }, { x: u, y: ARENA + 200 }]
				] as const) {
					const t = world.trace({ ...from, z }, { ...to, z }, km, kM);
					if (t.startsolid) continue; // inside a watch-post cabin over the corner
					const out = Math.max(Math.abs(t.endpos.x), Math.abs(t.endpos.y));
					expect(t.fraction < 1 && out <= ARENA, `knife escapes at (${from.x}, ${from.y}, ${z})`).toBe(true);
				}
	});

	it('materials read as clean solid fields: no seams, subtle noise and the desert palette', () => {
		const mt = m.theme.materials;
		// Edge lines draw additively: keep them off the floor tiles (roads split them into boxes).
		for (const g of new Set(OUTPOST.ground.map((b) => b.material))) expect(mt[g]!.edgeColor, `${g} floor edges`).toBeUndefined();
		for (const [name, d] of Object.entries(mt)) {
			expect(d.seamColor, `${name} has seams`).toBeUndefined();
			expect(d.noise ?? 0.15, `${name} noise`).toBeLessThanOrEqual(0.15);
		}
		expect(mt.sand!.topColor).toBe(0xd4b483);
		expect(mt.tarmac!.topColor).toBe(0x5b5d62);
		expect(mt.concrete!.color).toBe(0xa89f91);
		expect(mt.steelDark!.color).toBe(0x3e454e);
		expect(mt.rust!.color).toBe(0x9e4b30);
		// Figure–ground: tarmac, sand and concrete differ clearly in brightness.
		const lum = (c: number) => 0.2126 * ((c >> 16) & 0xff) + 0.7152 * ((c >> 8) & 0xff) + 0.0722 * (c & 0xff);
		expect(lum(mt.sand!.topColor!) - lum(mt.concrete!.color)).toBeGreaterThan(20);
		expect(lum(mt.concrete!.color) - lum(mt.tarmac!.topColor!)).toBeGreaterThan(40);
		expect(lum(mt.concrete!.color) - lum(mt.steelDark!.color)).toBeGreaterThan(60);
	});

	it('the bunker has corner pilasters, lintels over both doors, crenellated parapets and roof machinery', () => {
		const { pilasters, lintels, parapets, roof, ac, antenna, doorways } = OUTPOST.bunker;
		expect(pilasters).toHaveLength(8);
		expect(lintels).toHaveLength(2);
		for (const [i, l] of lintels.entries()) {
			expect(l.min.z).toBeGreaterThanOrEqual(HULL_H + 32);
			expect(gapXY(l, doorways[i]!)).toBe(0);
		}
		for (const p of parapets) {
			expect(p.min.z).toBe(top(roof));
			expect(top(p) - top(roof)).toBe(40);
		}
		// Firing gaps: merlons along each edge are at least 64 apart.
		for (let i = 0; i < parapets.length; i++)
			for (let j = i + 1; j < parapets.length; j++) {
				const g = gapXY(parapets[i]!, parapets[j]!);
				if (g > 0) expect(g, `parapets ${i}, ${j}`).toBeGreaterThanOrEqual(64);
			}
		expect(top(ac) - top(roof)).toBeLessThanOrEqual(JUMP);
		expect(antenna.min.z).toBe(top(ac));
		expect(top(antenna)).toBeLessThanOrEqual(MAX_TOP);
	});

	it('the radar dish sits on gantry legs over the mast with a beacon cap; deck edges are trimmed', () => {
		const { mast, dish, legs, beacon, dishParts, trim, skirt, plinth } = OUTPOST.radar;
		for (const l of legs) {
			expect(l.min.z).toBe(top(plinth) - 16);
			expect(top(l)).toBe(dish.min.z);
		}
		expect(dish.min.z).toBe(top(mast));
		expect(dishParts.length).toBeGreaterThanOrEqual(3);
		expect(beacon.min.z).toBeGreaterThan(top(dish));
		expect(top(beacon)).toBeLessThanOrEqual(MAX_TOP);
		expect(m.theme.materials.beacon!.edgeColor).toBeDefined();
		expect(trim.length).toBeGreaterThanOrEqual(5);
		for (const t of trim) expect(t.min.z).toBeGreaterThanOrEqual(HULL_H + 64);
		for (const s of skirt) expect(top(s)).toBeLessThanOrEqual(LEDGE);
	});

	it('the courtyard has hazard curbs on the island, sandbag beacon nooks and railed bridge sides', () => {
		const { curbs, island, nooks, rails, bridge } = OUTPOST.courtyard;
		for (const c of curbs) {
			expect(c.material).toBe('hazard');
			expect(top(c)).toBe(top(island));
		}
		// Each nook is an L of two sandbag walls (cover you can hide behind and jump over).
		expect(nooks.length).toBeGreaterThanOrEqual(4);
		for (const n of nooks) expect(top(n)).toBeLessThanOrEqual(JUMP);
		// A survivor can crouch out of sight behind the NE nook.
		const r = standsFree(loaded({ x: 384, y: 352, z: 0 }));
		expect([r.solid, r.ground]).toEqual([false, true]);
		// Rails stand beside the bridge (not on it) and rise above its deck.
		for (const rl of rails) {
			expect(gapXY(rl, bridge)).toBe(0);
			expect(rl.min.x >= bridge.max.x || rl.max.x <= bridge.min.x).toBe(true);
			expect(top(rl)).toBeGreaterThan(top(bridge));
		}
		// The bridge crate climb lands through a gap in the east rail.
		const crates = OUTPOST.climbs.find((c) => c.label === 'courtyard crates → bridge')!.surfaces;
		const last = crates[crates.length - 2]!;
		for (const rl of rails) expect(gapXY(rl, last)).toBeGreaterThan(40);
	});

	it('the dock has a corrugated canopy on posts with headroom, crate stacks and a flank alcove', () => {
		const { platform, canopy, posts, crates, alcove } = OUTPOST.dock;
		expect(canopy.min.z - top(platform)).toBeGreaterThanOrEqual(HULL_H + JUMP + 32);
		for (const p of posts) {
			expect(p.min.z).toBe(top(platform));
			expect(top(p)).toBe(canopy.min.z);
		}
		expect(crates.length).toBeGreaterThanOrEqual(2);
		expect(alcove.length).toBeGreaterThanOrEqual(2);
	});
});

// ---------------------------------------------------------------------------
// Physics bot: real playerMove on the real collision world at the slowest
// survivor speed (LMG), walking or hopping every claimed climb route.

/** Infected movement with the LMG held (the client sets sv_maxspeed from the held weapon). */
const LMG_CVARS = { ...INFECTED_CVARS, sv_maxspeed: WEAPONS.lmg.moveSpeed };
const DEG = 180 / Math.PI;
const HALF = HULL_MAX.x;
interface XY {
	x: number;
	y: number;
}
interface Waypoint extends XY {
	/** Index of the route surface the waypoint lies on. */
	on: number;
}
const centreXY = (b: Box3): XY => ({ x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Clamp into a surface, `margin` inside its edges (or its centre line when narrower). */
function clampIn(p: XY, b: Box3, margin: number): XY {
	const mx = Math.min(margin, (b.max.x - b.min.x) / 2);
	const my = Math.min(margin, (b.max.y - b.min.y) / 2);
	return { x: clamp(p.x, b.min.x + mx, b.max.x - mx), y: clamp(p.y, b.min.y + my, b.max.y - my) };
}
/** Approach for routes whose first step stands alone on the ground (no next surface to aim along). */
const ENTRY: Record<string, { at: XY; n: XY }> = {
	// Between the island and the north barrier, east of the barrier's end.
	'fuel island': { at: { x: 160, y: 192 }, n: { x: 0, y: -1 } }
};

/** Start point and waypoints: a pair across every contact edge between consecutive surfaces. */
function plan(route: ClimbRoute): { start: Vec3; wps: Waypoint[] } {
	const S = route.surfaces;
	const wps: Waypoint[] = [];
	let start: XY | null = null;
	for (let i = 1; i < S.length; i++) {
		const a = S[i - 1]!;
		const b = S[i]!;
		const ox0 = Math.max(a.min.x, b.min.x);
		const ox1 = Math.min(a.max.x, b.max.x);
		const oy0 = Math.max(a.min.y, b.min.y);
		const oy1 = Math.min(a.max.y, b.max.y);
		let P: XY;
		let n: XY;
		if (ox1 - ox0 < 1) {
			P = { x: (ox0 + ox1) / 2, y: (oy0 + oy1) / 2 };
			n = { x: Math.sign(centreXY(b).x - centreXY(a).x), y: 0 };
		} else if (oy1 - oy0 < 1) {
			P = { x: (ox0 + ox1) / 2, y: (oy0 + oy1) / 2 };
			n = { x: 0, y: Math.sign(centreXY(b).y - centreXY(a).y) };
		} else {
			// b stands on a (the ground): enter b on the side away from the next surface.
			const c = S[i + 1];
			if (c) {
				const d = { x: centreXY(c).x - centreXY(b).x, y: centreXY(c).y - centreXY(b).y };
				n = Math.abs(d.x) > Math.abs(d.y) ? { x: Math.sign(d.x), y: 0 } : { x: 0, y: Math.sign(d.y) };
				const cb = centreXY(b);
				P = { x: cb.x - n.x * ((b.max.x - b.min.x) / 2), y: cb.y - n.y * ((b.max.y - b.min.y) / 2) };
			} else {
				const e = ENTRY[route.label];
				if (!e) throw new Error(`${route.label}: no entry for a lone ledge`);
				({ at: P, n } = e);
			}
		}
		if (i === 1) start = { x: P.x - n.x * 64, y: P.y - n.y * 64 };
		wps.push({ ...clampIn({ x: P.x - n.x * 20, y: P.y - n.y * 20 }, a, HALF), on: i - 1 });
		wps.push({ ...clampIn({ x: P.x + n.x * 24, y: P.y + n.y * 24 }, b, HALF), on: i });
	}
	const s0 = S[0]!;
	const st = i0Ground(route) ? start! : centreXY(s0);
	return { start: { x: st.x, y: st.y, z: s0.max.z + CLEARANCE }, wps };
}
const i0Ground = (route: ClimbRoute) => isGround(route.surfaces[0]!);

interface ClimbResult {
	ok: boolean;
	secs: number;
	/** Longest run of airborne ticks. */
	maxAir: number;
	/** Path length over the waypoints (start included). */
	path: number;
	trace: string;
}

/** Drive a player along the waypoints; jump routes hold jump while the waypoint's surface is above step height. */
function climb(route: ClimbRoute, maxSecs = 20): ClimbResult {
	const { start, wps } = plan(route);
	const dst = route.surfaces[route.surfaces.length - 1]!;
	const p: PlayerState = createPlayer(start);
	const still: UserCmd = { pitch: 0, yaw: 0, forwardmove: 0, sidemove: 0, buttons: 0 };
	for (let i = 0; i < 16; i++) playerMove(world, p, still, LMG_CVARS, TICK_INTERVAL);
	let path = 0;
	let prev: XY = start;
	for (const w of wps) {
		path += Math.hypot(w.x - prev.x, w.y - prev.y);
		prev = w;
	}
	const log: string[] = [];
	let w = 0;
	let air = 0;
	let maxAir = 0;
	const teleports = m.zones.filter((z) => z.type === 'teleport');
	for (let tick = 0; tick < maxSecs / TICK_INTERVAL; tick++) {
		let t = wps[w]!;
		while (w < wps.length - 1 && Math.hypot(t.x - p.origin.x, t.y - p.origin.y) < 6) t = wps[++w]!;
		const surf = route.surfaces[t.on]!;
		const buttons = route.how === 'jump' && surf.max.z > p.origin.z + STEP ? IN_JUMP : 0;
		const yaw = Math.atan2(t.y - p.origin.y, t.x - p.origin.x) * DEG;
		playerMove(world, p, { pitch: 0, yaw, forwardmove: 450, sidemove: 0, buttons }, LMG_CVARS, TICK_INTERVAL);
		air = p.onGround ? 0 : air + 1;
		maxAir = Math.max(maxAir, air);
		if (tick % 8 === 0) log.push(`${tick}:w${w} (${p.origin.x.toFixed(0)},${p.origin.y.toFixed(0)},${p.origin.z.toFixed(1)}) v${Math.hypot(p.velocity.x, p.velocity.y).toFixed(0)}${p.onGround ? '' : ' air'}`);
		if (teleports.some((z) => inBox(p.origin, z))) return { ok: false, secs: tick * TICK_INTERVAL, maxAir, path, trace: `fell out\n${log.join('\n')}` };
		const onDst =
			p.onGround &&
			Math.abs(p.origin.z - dst.max.z) < 1 &&
			p.origin.x >= dst.min.x &&
			p.origin.x <= dst.max.x &&
			p.origin.y >= dst.min.y &&
			p.origin.y <= dst.max.y &&
			w === wps.length - 1;
		if (onDst) return { ok: true, secs: tick * TICK_INTERVAL, maxAir, path, trace: log.join('\n') };
	}
	return { ok: false, secs: maxSecs, maxAir, path, trace: log.join('\n') };
}

describe('infected_outpost physics bot (playerMove, LMG speed)', () => {
	const speed = WEAPONS.lmg.moveSpeed;

	for (const route of OUTPOST.climbs.filter((r) => r.how === 'step')) {
		it(`walks up ${route.label} without snagging`, () => {
			const r = climb(route);
			expect(r.ok, `${route.label}: did not arrive\n${r.trace}`).toBe(true);
			// Walking: never airborne beyond a stair step-down, and close to full speed all the way.
			expect(r.maxAir, `${route.label}: airborne ${r.maxAir} ticks\n${r.trace}`).toBeLessThanOrEqual(4);
			expect(r.secs, `${route.label}: slow (path ${r.path.toFixed(0)})\n${r.trace}`).toBeLessThanOrEqual(r.path / speed + 0.6);
		});
	}

	for (const route of OUTPOST.climbs.filter((r) => r.how === 'jump')) {
		it(`hops up ${route.label}`, () => {
			const r = climb(route);
			expect(r.ok, `${route.label}: did not arrive\n${r.trace}`).toBe(true);
			const ledges = route.surfaces.length - 1;
			expect(r.secs, `${route.label}: slow (path ${r.path.toFixed(0)})\n${r.trace}`).toBeLessThanOrEqual(r.path / speed + 0.8 * ledges + 0.5);
		});
	}
});

// ---------------------------------------------------------------------------
// Throwing knives on the real map: bank shots and a sweep that never tunnels.

type KEv<K extends InfEvent['e']> = Extract<InfEvent, { e: K }>;

/** An InfectedGame on the outpost in 'playing': 1 is the Alpha; 2 and 3 survivors (parked inside the east wall unless placed). */
function outpostGame() {
	let now = 1_000_000;
	const game = new InfectedGame({ map: m, world, now, rng: () => 0, graceSecs: 1, roundSecs: 100_000 });
	const events: InfEvent[] = [];
	const step = () => {
		now += INF_STEP_MS;
		events.push(...game.update(now));
	};
	game.syncPlayers([1, 2, 3], now);
	for (let t = 0; t < 1100; t += INF_STEP_MS) step();
	expect(game.phase).toBe('playing');
	expect(game.alphaId).toBe(1);
	const put = (id: number, x: number, y: number, z = 0) => game.setPlayerPos(id, { x, y, z: z + CLEARANCE, ducked: false, yaw: 0 });
	put(2, 1632, -200);
	put(3, 1632, 200);
	for (let t = 0; t < 1100; t += INF_STEP_MS) step(); // past the spawn teleport grace
	const until = <K extends InfEvent['e']>(e: K, id: number, ms: number): KEv<K> | null => {
		for (let t = 0; t < ms; t += INF_STEP_MS) {
			const n = events.length;
			step();
			const hit = events.slice(n).find((ev) => ev.e === e && (!('id' in ev) || ev.id === id || e === 'infect'));
			if (hit) return hit as KEv<K>;
		}
		return null;
	};
	return { game, events, step, put, until, now: () => now };
}

const solidAt = (p: Vec3) => world.trace(p, p, INF_KNIFE_MIN, INF_KNIFE_MAX).startsolid;
const dir = (yawDeg: number, pitchDeg: number): Vec3 => {
	const y = yawDeg / DEG;
	const p = pitchDeg / DEG;
	return { x: Math.cos(p) * Math.cos(y), y: Math.cos(p) * Math.sin(y), z: -Math.sin(p) };
};

describe('infected_outpost throwing knives', () => {
	const bank = (label: string, from: XY, fromZ: number, d: Vec3, wall = true) =>
		it(`banks a knife off ${label} into a survivor`, () => {
			const g = outpostGame();
			g.put(1, from.x, from.y, fromZ);
			const eye = { x: from.x, y: from.y, z: fromZ + CLEARANCE + VIEW_HEIGHT };
			const t = g.game.throwKnife(1, eye, d, g.now());
			expect(t.ok).toBe(true);
			g.put(1, from.x - d.y * 200, from.y + d.x * 200, fromZ); // step aside
			const b = g.until('knifeBounce', (t.events[0] as KEv<'knifeThrow'>).id, 1000)!;
			expect(b, `${label}: no bounce`).not.toBeNull();
			expect(solidAt(b)).toBe(false);
			// Off a wall it rebounds towards the thrower; off the floor it carries on, rising.
			if (wall) expect(b.vx * d.x + b.vy * d.y).toBeLessThan(0);
			else expect([b.vx * d.x + b.vy * d.y > 0, b.vz > 0, b.z < 4]).toEqual([true, true, true]);
			const k = 0.1;
			g.put(2, b.x + b.vx * k, b.y + b.vy * k, Math.max(0, b.z + b.vz * k - 30 - CLEARANCE));
			const inf = g.until('infect', 2, 600);
			expect(inf).toMatchObject({ id: 2, by: 1, method: 'bank' });
		});
	bank('the bunker north wall', { x: -1200, y: -300 }, 0, dir(-90, 0));
	bank('the radar deck west face', { x: 480, y: 800 }, 0, dir(0, 0));
	bank('a fuel tank', { x: -80, y: 400 }, 32 - 32, dir(-90, -10));
	bank('the courtyard floor', { x: 0, y: -700 }, 0, dir(-90, 25), false);

	it('a sweep of throws from six spots never tunnels or leaves the map, and every knife lands within reach of a floor', () => {
		const spots: Array<{ name: string; x: number; y: number; z: number }> = [
			{ name: 'courtyard', x: 0, y: -400, z: 0 },
			{ name: 'bunker interior', x: -960, y: -760, z: 0 },
			{ name: 'under the watchtower', x: -960, y: 832, z: 0 },
			{ name: 'container corridor', x: 1280, y: -832, z: 0 },
			{ name: 'radar deck', x: 760, y: 700, z: 160 },
			{ name: 'bunker roof', x: -960, y: -700, z: 176 }
		];
		let thrown = 0;
		for (const spot of spots) {
			const g = outpostGame();
			for (let yaw = 0; yaw < 360; yaw += 30)
				for (const pitch of [-35, 0, 30, 70]) {
					g.put(1, spot.x, spot.y, spot.z);
					const eye = { x: spot.x, y: spot.y, z: spot.z + CLEARANCE + VIEW_HEIGHT };
					const r = g.game.throwKnife(1, eye, dir(yaw, pitch), g.now());
					const what = `${spot.name} yaw ${yaw} pitch ${pitch}`;
					expect(r.ok, `${what}: ${r.reason}`).toBe(true);
					const id = (r.events[0] as KEv<'knifeThrow'>).id;
					thrown++;
					let stuck: KEv<'knifeStick'> | null = null;
					for (let t = 0; t < 8000 && !stuck; t += INF_STEP_MS) {
						const n = g.events.length;
						g.step();
						const out = g.events.slice(n);
						expect(out.some((e) => e.e === 'knifeRemove' && e.id === id), `${what}: knife removed (left the map?)`).toBe(false);
						stuck = (out.find((e) => e.e === 'knifeStick' && e.id === id) as KEv<'knifeStick'> | undefined) ?? null;
						const k = g.game.knifeViews().find((v) => v.id === id)!;
						expect(solidAt(k), `${what}: knife in solid at ${JSON.stringify(k)}`).toBe(false);
						expect(Math.abs(k.x) < ARENA && Math.abs(k.y) < ARENA && k.z > 0 && k.z < CURTAIN_TOP, `${what}: out of the arena`).toBe(true);
					}
					expect(stuck, `${what}: never landed`).not.toBeNull();
					// Retrievable: a floor within pickup reach below it; the owner stands there and takes it back.
					const down = world.trace(stuck!, { ...stuck!, z: stuck!.z - INF_KNIFE_WALL_REACH }, INF_KNIFE_MIN, INF_KNIFE_MAX);
					expect(down.fraction < 1 && down.plane.normal.z >= 0.7, `${what}: stuck out of reach at ${JSON.stringify(stuck)}`).toBe(true);
					g.put(1, stuck!.x, stuck!.y, down.endpos.z + INF_KNIFE_MIN.z - CLEARANCE);
					expect(g.until('knifePickup', id, 100), `${what}: no pickup at ${JSON.stringify(stuck)}`).not.toBeNull();
				}
			expect(g.events.filter((e) => e.e === 'infect')).toEqual([]);
		}
		expect(thrown).toBe(spots.length * 48);
	});
});
