import { describe, expect, it } from 'vitest';
import { buildCollisionWorld } from '../collision/world.ts';
import { InfectedGame, INF_KNIFE_MAX, INF_KNIFE_MIN, INF_KNIFE_WALL_REACH, INF_STEP_MS, type InfEvent } from '../modes/infected/index.ts';
import { INFECTED_CVARS, ZOMBIES_CVARS } from '../modes/index.ts';
import { WEAPONS } from '../modes/zombies/weapons.ts';
import { HULL_MAX, HULL_MIN, IN_JUMP, VIEW_HEIGHT, type PlayerState, type UserCmd } from '../movement/api.ts';
import { createPlayer, playerMove } from '../movement/gamemovement.ts';
import type { Vec3 } from '../types.ts';
import { TICK_INTERVAL } from '../units.ts';
import { infected_terminal as m, TERMINAL, ARENA, WALL_TOP } from './infected_terminal.ts';
import { boundsOf, brushBounds, dirXY, gapXY, type Box3, type BoxBrush } from './helpers.ts';
import { getMap, mapsForMode, SPAWN_CLEARANCE } from './index.ts';
import type { ClimbRoute } from './tag-helpers.ts';

/** Same as SPAWN_CLEARANCE in ./index.ts (spawns are authored on floor tops and lifted at load). */
const CLEARANCE = 0.25;
const STEP = 18;
/** Standing jump apex is ~55.8 units. */
const JUMP = 55;
/** Jump-up ledges on climb routes stay at or under 40. */
const LEDGE = 40;
const HULL_H = 72;
/** Every climbable top stays at or under this; the curtain walls tower over it. */
const MAX_TOP = 420;
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
interface XY {
	x: number;
	y: number;
}
/** Standing hull walks straight from a to b (both on floor height z) without hitting anything. */
function walks(a: XY, b: XY, z = 0): boolean {
	const s = { x: a.x, y: a.y, z: z + CLEARANCE };
	const e = { x: b.x, y: b.y, z: z + CLEARANCE };
	const t = world.trace(s, e, HULL_MIN, HULL_MAX);
	return !t.startsolid && t.fraction === 1;
}
const isGround = (s: Box3) => s === TERMINAL.floor;
const quadrant = (p: XY) => (p.x > 0 ? (p.y > 0 ? 'NE' : 'SE') : p.y > 0 ? 'NW' : 'SW');
const centreXY = (b: Box3): XY => ({ x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 });

describe('infected_terminal', () => {
	it('is an open infected map with the zombies physics profile and only teleport zones', () => {
		expect(m.id).toBe('infected_terminal');
		expect(m.title).toBe('Terminal');
		expect(m.kind as string).toBe('infected');
		expect(m.difficulty).toBe('easy');
		expect(m.layout).toBe('open');
		expect(m.cvars).toEqual({ ...ZOMBIES_CVARS });
		expect(m.zones.length).toBeGreaterThanOrEqual(1);
		for (const z of m.zones) expect(z.type).toBe('teleport');
		expect(m.zombies).toBeUndefined();
	});

	it('is registered after infected_outpost in the infected rotation', () => {
		expect(getMap('infected_terminal')).toBe(m);
		const ids = mapsForMode('infected').map((x) => x.id);
		expect(ids[0]).toBe('infected_outpost');
		expect(ids.indexOf('infected_terminal')).toBeGreaterThan(0);
	});

	it('has a bright sunlit sky, haze fog, clouds and a warm sun', () => {
		const t = m.theme;
		expect(t.fogNear).toBeGreaterThanOrEqual(2400);
		expect(t.fogFar).toBeGreaterThanOrEqual(12000);
		expect(t.sunDir.z).toBeGreaterThan(0);
		expect(t.effects.some((e) => e.type === 'clouds')).toBe(true);
		const known = ['aurora', 'embers', 'clouds', 'gridFloor', 'lavaSea', 'snowFloor'];
		for (const e of t.effects) expect(known).toContain(e.type);
		// Azure sky: blue channel dominates at the top; warm sun: red at least blue.
		expect(t.skyTop & 0xff).toBeGreaterThan(t.skyTop >> 16);
		expect(t.sunColor >> 16).toBeGreaterThanOrEqual(t.sunColor & 0xff);
	});

	it('every brush material exists in the theme, the map uses only boxes, and glass is used', () => {
		for (const b of m.brushes) expect(m.theme.materials[b.material], b.material).toBeDefined();
		expect(boxes).toHaveLength(m.brushes.length);
		for (const b of boxes) {
			expect(b.max.x).toBeGreaterThan(b.min.x);
			expect(b.max.y).toBeGreaterThan(b.min.y);
			expect(b.max.z).toBeGreaterThan(b.min.z);
		}
		const glass = new Set(Object.entries(m.theme.materials).filter(([, d]) => d.glass).map(([k]) => k));
		for (const g of ['clerestory', 'jetwayGlass', 'glassRail', 'facadeGlass', 'skylight', 'atcGlass']) expect(glass, g).toContain(g);
		for (const g of glass) expect(boxes.some((b) => b.material === g), `${g} unused`).toBe(true);
	});

	it('nothing clips to white under the sun: grounded lighting, mid-tone solids, no seam squiggles', () => {
		const t = m.theme;
		expect(t.sunIntensity).toBeLessThanOrEqual(1);
		expect(t.ambientIntensity).toBeLessThanOrEqual(0.6);
		const luma = (c: number) => 0.2126 * ((c >> 16) & 0xff) + 0.7152 * ((c >> 8) & 0xff) + 0.0722 * (c & 0xff);
		// The pale slate walls (0xbcc4cc) and cream columns (0xc6beae) are the brightest solid faces allowed.
		const cap = Math.max(luma(0xbcc4cc), luma(0xc6beae));
		for (const [name, d] of Object.entries(t.materials)) {
			expect(d.seamColor, `${name} has a seam pattern`).toBeUndefined();
			if (d.glass) {
				expect(d.opacity ?? 0.3, `${name} glass opacity`).toBeLessThanOrEqual(0.7);
				continue;
			}
			expect(luma(d.color), `${name} color too bright`).toBeLessThanOrEqual(cap);
			if (d.topColor !== undefined) expect(luma(d.topColor), `${name} topColor too bright`).toBeLessThanOrEqual(cap);
		}
		// The concourse floor is a readable mid-light slate, the walkways and runners clearly darker.
		const floor = t.materials.terrazzo!;
		expect(luma(floor.topColor!)).toBeLessThan(luma(0xb4b4b4));
		for (const k of ['walkway', 'runner']) expect(luma(t.materials[k]!.topColor!)).toBeLessThan(luma(floor.topColor!) - 40);
	});

	it('the jetliner pops: silver fuselage, cobalt cheatline under a dark window band, dark tarmac, bold taxi stripes', () => {
		const mat = m.theme.materials;
		expect(mat.fuselage!.color).toBe(0xa8b2be);
		expect(mat.cheatline!.color).toBe(0x265496);
		expect(mat.windowBand!.color).toBe(0x263242);
		expect(mat.tarmac!.topColor).toBe(0x3e444c);
		expect(mat.taxiStripe!.topColor).toBe(0xd9a628);
		for (const g of ['clerestory', 'jetwayGlass', 'facadeGlass']) expect(mat[g]!.opacity, g).toBe(0.28);
		// Every fuselage side segment carries the stripe directly under the window band.
		const bands = TERMINAL.plane.walls.filter((b) => b.material === 'windowBand');
		const stripes = TERMINAL.plane.walls.filter((b) => b.material === 'cheatline');
		expect(stripes).toHaveLength(bands.length);
		for (const s of stripes) expect(bands.some((w) => w.min.x === s.min.x && w.min.y === s.min.y && w.min.z === s.max.z)).toBe(true);
	});

	it('the curtain walls stay open: solid base ≤ 448 (≤ 384 on the tarmac side), glass up to a thin header', () => {
		const { perimeter } = TERMINAL.walls;
		const solidBase = perimeter.filter((w) => w.material === 'curtainWall');
		expect(solidBase).toHaveLength(4);
		for (const w of solidBase) expect(w.max.z).toBeLessThanOrEqual(448);
		const north = solidBase.find((w) => w.min.y === ARENA)!;
		expect(north.max.z).toBeLessThanOrEqual(384);
		for (const g of perimeter.filter((w) => w.material === 'clerestory')) expect(g.max.z - g.min.z).toBeGreaterThanOrEqual(448);
	});

	it('has 20 spawns, free and on ground in the real trace', () => {
		expect(spawns).toHaveLength(20);
		for (const [i, s] of [m.spawn, ...spawns].entries()) {
			// Authored on the floor; importing the registry lifted it by SPAWN_CLEARANCE.
			expect(s.pos.z, `spawn ${i} authored at floor height`).toBe(SPAWN_CLEARANCE);
			const r = standsFree(loaded(s.pos));
			expect(r.solid, `spawn ${i} starts solid`).toBe(false);
			expect(r.ground, `spawn ${i} has no ground`).toBe(true);
		}
	});

	it('spawns are at least 256 apart, inside the arena, facing inward, ≥ 5 per quadrant', () => {
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
			expect(spawns.filter((s) => quadrant(s.pos) === q).length, `${q} spawns`).toBeGreaterThanOrEqual(5);
	});

	it('every spawn looks down a clear sightline: ≥ 192 units of eye ray along its yaw (glass counts)', () => {
		const ZERO = { x: 0, y: 0, z: 0 };
		for (const [i, s] of [m.spawn, ...spawns].entries()) {
			const eye = { ...loaded(s.pos), z: loaded(s.pos).z + VIEW_HEIGHT };
			const d = dirXY(s.yaw);
			const reach = 192;
			const t = world.trace(eye, { x: eye.x + d.x * reach, y: eye.y + d.y * reach, z: eye.z }, ZERO, ZERO);
			expect(t.startsolid, `spawn ${i} eye starts solid`).toBe(false);
			expect(t.fraction * reach, `spawn ${i} at (${s.pos.x}, ${s.pos.y}) yaw ${s.yaw} stares at a wall`).toBeGreaterThanOrEqual(reach);
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

	it('is enclosed: curtain walls stacked flush to WALL_TOP on all four sides, a teleport under the map', () => {
		const { perimeter, trim, coping } = TERMINAL.walls;
		expect(perimeter).toHaveLength(12);
		// Each side: bands stacked from -64 to WALL_TOP without a crack, glass in the middle band.
		const sides = new Map<string, BoxBrush[]>();
		for (const w of perimeter) {
			const key = `${w.min.x},${w.max.x},${w.min.y},${w.max.y}`;
			sides.set(key, [...(sides.get(key) ?? []), w]);
			expect(Math.min(w.max.x - w.min.x, w.max.y - w.min.y)).toBe(WALL_T);
		}
		expect(sides.size).toBe(4);
		for (const bands of sides.values()) {
			bands.sort((a, b) => a.min.z - b.min.z);
			expect(bands[0]!.min.z).toBe(-64);
			expect(bands[bands.length - 1]!.max.z).toBe(WALL_TOP);
			for (let i = 1; i < bands.length; i++) expect(bands[i]!.min.z).toBe(bands[i - 1]!.max.z);
			expect(bands.some((b) => m.theme.materials[b.material]!.glass)).toBe(true);
		}
		// Real traces: from inside, straight out through each wall at several heights, never escape.
		for (const z of [8, 120, 400, 600, 900, WALL_TOP - 8])
			for (const u of [-1500, -900, -300, 300, 900, 1500])
				for (const [a, b] of [
					[{ x: u, y: ARENA - 48, z }, { x: u, y: ARENA + 512, z }],
					[{ x: u, y: -ARENA + 48, z }, { x: u, y: -ARENA - 512, z }],
					[{ x: ARENA - 48, y: u, z }, { x: ARENA + 512, y: u, z }],
					[{ x: -ARENA + 48, y: u, z }, { x: -ARENA - 512, y: u, z }]
				] as const) {
					const t = world.trace(a, b, INF_KNIFE_MIN, INF_KNIFE_MAX);
					expect(t.fraction, `escapes from ${JSON.stringify(a)}`).toBeLessThan(1);
					expect(Math.max(Math.abs(t.endpos.x), Math.abs(t.endpos.y))).toBeLessThanOrEqual(ARENA + 1);
				}
		// Decoration: piers and the base band hug the inner faces; coping sits on top.
		const decor = new Set<BoxBrush>([...trim, ...coping]);
		for (const d of trim) {
			expect(d.min.z).toBe(0);
			expect(d.max.z).toBeLessThanOrEqual(WALL_TOP + 16);
			expect(perimeter.some((w) => gapXY(w, d) === 0)).toBe(true);
		}
		for (const c of coping) expect(c.min.z).toBe(WALL_TOP);
		const inner = m.brushes.filter((b) => !perimeter.includes(b as BoxBrush) && !decor.has(b as BoxBrush)).map(brushBounds);
		for (const b of inner) {
			expect(b.min.x).toBeGreaterThanOrEqual(-ARENA);
			expect(b.min.y).toBeGreaterThanOrEqual(-ARENA);
			expect(b.max.x).toBeLessThanOrEqual(ARENA);
			expect(b.max.y).toBeLessThanOrEqual(ARENA);
			expect(b.max.z).toBeLessThanOrEqual(MAX_TOP);
		}
		expect(WALL_TOP - Math.max(...inner.map((b) => b.max.z))).toBeGreaterThanOrEqual(512);

		// Ground tiles cover the whole arena at z = 0 (no overlaps: see above).
		let groundArea = 0;
		for (const g of TERMINAL.ground) {
			expect([g.min.z, g.max.z]).toEqual([-64, 0]);
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
		expect(TERMINAL.climbs.length).toBeGreaterThanOrEqual(14);
		for (const route of TERMINAL.climbs) {
			const limit = route.how === 'step' ? STEP : LEDGE;
			for (let i = 1; i < route.surfaces.length; i++) {
				const a = route.surfaces[i - 1]!;
				const b = route.surfaces[i]!;
				expect(gapXY(a, b), `${route.label} ${i}: surfaces not adjacent`).toBeLessThanOrEqual(0.5);
				expect(top(b) - top(a), `${route.label} ${i}: rise`).toBeLessThanOrEqual(limit);
			}
			for (const [i, s] of route.surfaces.entries()) {
				if (isGround(s)) continue;
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
		for (const route of TERMINAL.climbs.filter((r) => r.how === 'step'))
			for (const [i, s] of route.surfaces.entries()) {
				if (isGround(s)) continue;
				const space: Box3 = { min: { ...s.min, z: s.max.z }, max: { ...s.max, z: s.max.z + HULL_H } };
				for (const [j, b] of all.entries()) expect(overlaps(space, b), `${route.label} ${i}: ceiling (brush ${j})`).toBe(false);
			}
	});

	it('jump climbs leave room for a full jump over every take-off', () => {
		for (const route of TERMINAL.climbs.filter((r) => r.how === 'jump'))
			for (const [i, s] of route.surfaces.slice(0, -1).entries()) {
				if (isGround(s)) continue;
				const space: Box3 = { min: { ...s.min, z: s.max.z }, max: { ...s.max, z: s.max.z + JUMP + HULL_H } };
				for (const [j, b] of all.entries()) expect(overlaps(space, b), `${route.label} ${i}: overhang (brush ${j})`).toBe(false);
			}
	});

	it('the floor reads as zones: terrazzo concourse with slate walkways and runners, gate carpet, tarmac apron with taxiway stripes', () => {
		const at = (x: number, y: number) => TERMINAL.ground.find((g) => x >= g.min.x && x < g.max.x && y >= g.min.y && y < g.max.y)!.material;
		expect(new Set(TERMINAL.ground.map((g) => g.material))).toEqual(new Set(['terrazzo', 'terrazzoDark', 'walkway', 'runner', 'carpet', 'tarmac', 'taxiStripe']));
		expect(at(0, 160)).toBe('walkway');
		expect(at(0, -544)).toBe('walkway');
		expect(at(-384, -256)).toBe('runner');
		expect(at(384, 0)).toBe('runner');
		expect(at(0, -1000)).toBe('terrazzo');
		expect(at(0, -256)).toBe('terrazzoDark');
		expect(at(-1280, 704)).toBe('carpet');
		expect(at(0, 800)).toBe('tarmac');
		expect(at(1500, 1152)).toBe('taxiStripe');
	});
});

describe('infected_terminal landmarks', () => {
	const { plane, mezzanine, skybridge, lounge, security, baggage } = TERMINAL;

	it('the jetliner rests on its gear: belly at 64, cabin 72..200, roof at 208, every part in the north half', () => {
		expect(plane.slab.min.z).toBe(64);
		expect(top(plane.slab)).toBe(72);
		expect(plane.roof.min.z).toBe(200);
		expect(top(plane.roof)).toBe(208);
		for (const g of plane.gear) {
			expect(g.min.z).toBe(0);
			expect(top(g)).toBe(plane.slab.min.z);
		}
		for (const b of [plane.slab, plane.roof, ...plane.walls, ...plane.wings, ...plane.engines, ...plane.nose, ...plane.tail]) expect(b.min.y).toBeGreaterThan(352);
		for (const w of plane.wings) {
			expect(top(w)).toBe(176);
			expect(w.min.z).toBeGreaterThanOrEqual(HULL_H + 64);
		}
		// The tail fin towers over the roof beyond any jump.
		const fin = plane.tail.find((b) => top(b) === Math.max(...plane.tail.map(top)))!;
		expect(top(fin) - top(plane.roof)).toBeGreaterThan(JUMP * 2);
	});

	it('the cabin has four wide doors and a clear aisle: run straight through the plane', () => {
		const doors = Object.values(plane.doors);
		expect(doors).toHaveLength(4);
		for (const [i, d] of doors.entries()) {
			expect(d.max.x - d.min.x, `door ${i} width`).toBeGreaterThanOrEqual(144);
			expect(d.max.z - d.min.z, `door ${i} height`).toBeGreaterThanOrEqual(128);
			for (const [j, b] of all.entries()) expect(overlaps(d, b), `door ${i} blocked by brush ${j}`).toBe(false);
		}
		const z = top(plane.slab);
		const front = centreXY(plane.doors.frontSouth).x;
		const rear = centreXY(plane.doors.rearSouth).x;
		// Along the aisle, front door to rear door.
		expect(walks({ x: front, y: 1152 }, { x: rear, y: 1152 }, z)).toBe(true);
		// Straight across at both door pairs (from the jetway tube; out over the airstairs).
		expect(walks({ x: front, y: 960 }, { x: front, y: 1240 }, z)).toBe(true);
		expect(walks({ x: rear, y: 1072 }, { x: rear, y: 1400 }, z)).toBe(true);
		// Jump head room inside: hull plus a full jump under the ceiling.
		expect(plane.roof.min.z - z).toBeGreaterThanOrEqual(HULL_H + JUMP);
		// Seat rows are jumpable cover.
		for (const s of plane.seats) expect(top(s) - z).toBeLessThanOrEqual(LEDGE);
	});

	it('the jetway is a 128-wide glass tube from the concourse to the front door; airstairs reach the rear door', () => {
		const { floor, walls, roof, steps } = plane.jetway;
		expect(top(floor)).toBe(top(plane.slab));
		expect(floor.max.y).toBe(plane.slab.min.y);
		expect(walls[1]!.min.x - walls[0]!.max.x).toBe(128);
		for (const w of walls) expect(m.theme.materials[w.material]!.glass).toBe(true);
		expect(roof.min.z - top(floor)).toBe(128);
		expect(steps).toHaveLength(6);
		expect(steps[0]!.min.y).toBeLessThan(352);
		expect(plane.airstairs).toHaveLength(6);
		expect(top(plane.airstairs[plane.airstairs.length - 1]!)).toBe(top(plane.slab));
		const labels = TERMINAL.climbs.map((c) => c.label);
		for (const l of ['jetway steps', 'jetway → cabin', 'airstairs', 'loader → wing → fuselage roof']) expect(labels).toContain(l);
	});

	it('the mezzanine is a 160 deck on columns, open underneath, with waist-high glass rails and vault gaps', () => {
		expect(top(mezzanine.deck)).toBe(160);
		expect(mezzanine.columns).toHaveLength(4);
		for (const c of mezzanine.columns) expect(top(c)).toBe(mezzanine.deck.min.z);
		for (const r of mezzanine.rails) {
			expect(r.min.z).toBe(160);
			expect(top(r)).toBe(200);
			expect(m.theme.materials[r.material]!.glass).toBe(true);
		}
		// Two 10 × 16 escalators.
		for (const s of [mezzanine.eastStairs, mezzanine.northStairs]) {
			expect(s).toHaveLength(10);
			for (const st of s) expect(Math.max(st.max.x - st.min.x, st.max.y - st.min.y)).toBe(128);
			expect(top(s[s.length - 1]!)).toBe(160);
		}
		// Walk under the deck both ways.
		expect(walks({ x: -1600, y: -1088 }, { x: -928, y: -1088 })).toBe(true);
		expect(walks({ x: -1216, y: -1600 }, { x: -1216, y: -520 })).toBe(true);
		// A vault gap in the south rail.
		const south = mezzanine.rails.filter((r) => r.min.y === mezzanine.deck.min.y).sort((a, b) => a.min.x - b.min.x);
		expect(south.length).toBeGreaterThanOrEqual(2);
		expect(south[1]!.min.x - south[0]!.max.x).toBeGreaterThanOrEqual(64);
	});

	it('the security line has three metal-detector arches (≥ 160 wide, ≥ 144 tall) between waist-high desks', () => {
		expect(security.arches).toHaveLength(3);
		for (const [i, a] of security.arches.entries()) {
			const o = a.opening;
			expect(o.max.x - o.min.x, `arch ${i} width`).toBeGreaterThanOrEqual(160);
			expect(o.max.z - o.min.z, `arch ${i} height`).toBeGreaterThanOrEqual(144);
			for (const [j, b] of all.entries()) expect(overlaps(o, b), `arch ${i} blocked by brush ${j}`).toBe(false);
			const c = centreXY(o);
			expect(walks({ x: c.x, y: -420 }, { x: c.x, y: -100 }), `walk through arch ${i}`).toBe(true);
		}
		for (const d of security.desks) {
			expect(d.min.z).toBe(0);
			expect(top(d)).toBe(LEDGE);
		}
		// Flank around both ends of the line.
		expect(walks({ x: -760, y: -420 }, { x: -760, y: 100 })).toBe(true);
		expect(walks({ x: 760, y: -420 }, { x: 760, y: 100 })).toBe(true);
		expect(m.theme.materials[security.skylight.material]!.glass).toBe(true);
		expect(security.checkin.filter((b) => b.material === 'checkin').every((b) => top(b) <= LEDGE)).toBe(true);
	});

	it('baggage claim has stepped carousels, and a booth roof at 128 over a dark open alcove', () => {
		for (const { base, belt } of baggage.carousels) {
			expect([base.min.z, top(base)]).toEqual([0, 24]);
			expect([belt.min.z, top(belt)]).toEqual([24, 40]);
		}
		expect(top(baggage.booth.roof)).toBe(128);
		expect(baggage.stairs).toHaveLength(8);
		for (const s of baggage.stairs) expect(s.max.z % 16).toBe(0);
		for (let i = 1; i < baggage.suitcases.length; i++) expect(top(baggage.suitcases[i]!) - top(baggage.suitcases[i - 1]!)).toBeLessThanOrEqual(LEDGE);
		const al = baggage.booth.alcove;
		expect(al.max.z - al.min.z).toBeGreaterThanOrEqual(HULL_H + 32);
		for (const [j, b] of all.entries()) expect(overlaps(al, b), `alcove blocked by brush ${j}`).toBe(false);
		const r = standsFree(loaded({ x: 1344, y: -1344, z: 0 }));
		expect([r.solid, r.ground]).toEqual([false, true]);
		// In from the north and from the west.
		expect(walks({ x: 1296, y: -1100 }, { x: 1296, y: -1400 })).toBe(true);
		expect(walks({ x: 1100, y: -1376 }, { x: 1400, y: -1376 })).toBe(true);
	});

	it('the gate lounge balcony (176) has glass rails, a glass ATC cab, and links to the mezzanine both ways', () => {
		expect(top(lounge.deck)).toBe(176);
		for (const r of lounge.rails) expect([r.min.z, top(r)]).toEqual([176, 216]);
		expect(m.theme.materials[lounge.atc[0]!.material]!.glass).toBe(true);
		expect(top(skybridge.deck)).toBe(176);
		expect(skybridge.deck.min.z).toBeGreaterThanOrEqual(HULL_H + 64);
		expect(skybridge.deck.min.y).toBe(mezzanine.deck.max.y);
		expect(skybridge.deck.max.y).toBe(lounge.deck.min.y);
		const labels = TERMINAL.climbs.map((c) => c.label);
		for (const l of ['mezzanine → skybridge → gate lounge', 'gate lounge → skybridge → mezzanine', 'gate lounge stairs', 'gate lounge crate climb'])
			expect(labels).toContain(l);
		// Under the balcony: walk past the counter and the benches.
		expect(walks({ x: -1440, y: 576 }, { x: -1440, y: 880 })).toBe(true);
	});

	it('the apron is open: corridors south and north of the plane, under the wing, east of the nose', () => {
		expect(walks({ x: -500, y: 720 }, { x: 900, y: 720 })).toBe(true);
		expect(walks({ x: -200, y: 960 }, { x: 900, y: 960 })).toBe(true);
		expect(walks({ x: -1500, y: 1560 }, { x: 1500, y: 1560 })).toBe(true);
		expect(walks({ x: 1500, y: 400 }, { x: 1500, y: 1500 })).toBe(true);
		// Through the facade openings.
		expect(walks({ x: -240, y: 200 }, { x: -240, y: 500 })).toBe(true);
		expect(walks({ x: 1536, y: 200 }, { x: 1536, y: 500 })).toBe(true);
		expect(walks({ x: -700, y: 832 }, { x: -400, y: 832 })).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Physics bot: real playerMove on the real collision world at the slowest
// survivor speed (LMG), walking or hopping every claimed climb route.

const LMG_CVARS = { ...INFECTED_CVARS, sv_maxspeed: WEAPONS.lmg.moveSpeed };
const DEG = 180 / Math.PI;
const HALF = HULL_MAX.x;
interface Waypoint extends XY {
	on: number;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function clampIn(p: XY, b: Box3, margin: number): XY {
	const mx = Math.min(margin, (b.max.x - b.min.x) / 2);
	const my = Math.min(margin, (b.max.y - b.min.y) / 2);
	return { x: clamp(p.x, b.min.x + mx, b.max.x - mx), y: clamp(p.y, b.min.y + my, b.max.y - my) };
}
/** Approach for routes whose first step stands alone on the ground (no next surface to aim along). */
const ENTRY: Record<string, { at: XY; n: XY }> = {
	carousel: { at: { x: 832, y: -1120 }, n: { x: 0, y: 1 } }
};

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
	const st = isGround(s0) ? start! : centreXY(s0);
	return { start: { x: st.x, y: st.y, z: s0.max.z + CLEARANCE }, wps };
}

interface ClimbResult {
	ok: boolean;
	secs: number;
	maxAir: number;
	path: number;
	trace: string;
}

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

describe('infected_terminal physics bot (playerMove, LMG speed)', () => {
	const speed = WEAPONS.lmg.moveSpeed;

	it('covers every stair flight and every jump climb on the map', () => {
		const steps = TERMINAL.climbs.filter((r) => r.how === 'step').map((r) => r.label);
		const jumps = TERMINAL.climbs.filter((r) => r.how === 'jump').map((r) => r.label);
		for (const l of ['jetway steps', 'airstairs', 'mezzanine east escalator', 'mezzanine north escalator', 'gate lounge stairs', 'baggage booth stairs'])
			expect(steps).toContain(l);
		for (const l of ['loader → wing → fuselage roof', 'gate lounge crate climb', 'suitcase stack → booth roof', 'carousel']) expect(jumps).toContain(l);
	});

	for (const route of TERMINAL.climbs.filter((r) => r.how === 'step')) {
		it(`walks up ${route.label} without snagging`, () => {
			const r = climb(route);
			expect(r.ok, `${route.label}: did not arrive\n${r.trace}`).toBe(true);
			expect(r.maxAir, `${route.label}: airborne ${r.maxAir} ticks\n${r.trace}`).toBeLessThanOrEqual(4);
			expect(r.secs, `${route.label}: slow (path ${r.path.toFixed(0)})\n${r.trace}`).toBeLessThanOrEqual(r.path / speed + 0.6);
		});
	}

	for (const route of TERMINAL.climbs.filter((r) => r.how === 'jump')) {
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

/** Survivors park inside the east curtain wall (solid) unless placed. */
const PARK_X = ARENA + WALL_T / 2;

function terminalGame() {
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
	put(2, PARK_X, -200);
	put(3, PARK_X, 200);
	for (let t = 0; t < 1100; t += INF_STEP_MS) step();
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

describe('infected_terminal throwing knives', () => {
	it('the survivor parking spot is inside a solid wall', () => {
		expect(world.trace({ x: PARK_X, y: 0, z: 40 }, { x: PARK_X, y: 0, z: 40 }, HULL_MIN, HULL_MAX).startsolid).toBe(true);
	});

	const bank = (label: string, from: XY, fromZ: number, d: Vec3, wall = true) =>
		it(`banks a knife off ${label} into a survivor`, () => {
			const g = terminalGame();
			g.put(1, from.x, from.y, fromZ);
			const eye = { x: from.x, y: from.y, z: fromZ + CLEARANCE + VIEW_HEIGHT };
			const t = g.game.throwKnife(1, eye, d, g.now());
			expect(t.ok).toBe(true);
			g.put(1, from.x - d.y * 200, from.y + d.x * 200, fromZ); // step aside
			const b = g.until('knifeBounce', (t.events[0] as KEv<'knifeThrow'>).id, 1000)!;
			expect(b, `${label}: no bounce`).not.toBeNull();
			expect(solidAt(b)).toBe(false);
			if (wall) expect(b.vx * d.x + b.vy * d.y).toBeLessThan(0);
			else expect([b.vx * d.x + b.vy * d.y > 0, b.vz > 0, b.z < 4]).toEqual([true, true, true]);
			const k = 0.1;
			g.put(2, b.x + b.vx * k, b.y + b.vy * k, Math.max(0, b.z + b.vz * k - 30 - CLEARANCE));
			const inf = g.until('infect', 2, 600);
			expect(inf).toMatchObject({ id: 2, by: 1, method: 'bank' });
		});
	bank('the fuselage side', { x: 720, y: 720 }, 0, dir(90, -10));
	bank('the east curtain wall', { x: 1200, y: -400 }, 0, dir(0, 0));
	bank('a check-in sign panel', { x: -352, y: -1100 }, 0, dir(90, 0));
	bank('a metal-detector post', { x: -96, y: -700 }, 0, dir(90, -5));
	bank('the concourse floor', { x: 0, y: -1000 }, 0, dir(-90, 25), false);

	it('a sweep of throws from six spots never tunnels or leaves the map, and every knife lands within reach of a floor', () => {
		const spots: Array<{ name: string; x: number; y: number; z: number }> = [
			{ name: 'security hall', x: 0, y: -560, z: 0 },
			{ name: 'cabin aisle', x: 512, y: 1152, z: 72 },
			{ name: 'mezzanine deck', x: -1216, y: -1088, z: 160 },
			{ name: 'baggage claim', x: 1104, y: -1100, z: 0 },
			{ name: 'apron by the wing', x: 760, y: 640, z: 0 },
			{ name: 'gate lounge balcony', x: -1280, y: 640, z: 176 }
		];
		let thrown = 0;
		for (const spot of spots) {
			const g = terminalGame();
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
						expect(Math.abs(k.x) < ARENA && Math.abs(k.y) < ARENA && k.z > 0 && k.z < WALL_TOP, `${what}: out of the arena`).toBe(true);
					}
					expect(stuck, `${what}: never landed`).not.toBeNull();
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
