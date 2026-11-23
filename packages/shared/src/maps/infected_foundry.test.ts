import { describe, expect, it } from 'vitest';
import { buildCollisionWorld } from '../collision/world.ts';
import { InfectedGame, INF_KNIFE_MAX, INF_KNIFE_MIN, INF_KNIFE_WALL_REACH, INF_STEP_MS, type InfEvent } from '../modes/infected/index.ts';
import { INFECTED_CVARS, ZOMBIES_CVARS } from '../modes/index.ts';
import { WEAPONS } from '../modes/zombies/weapons.ts';
import { HULL_MAX, HULL_MIN, IN_JUMP, VIEW_HEIGHT, type PlayerState, type UserCmd } from '../movement/api.ts';
import { createPlayer, playerMove } from '../movement/gamemovement.ts';
import type { Vec3 } from '../types.ts';
import { TICK_INTERVAL } from '../units.ts';
import { infected_foundry as m, FOUNDRY, ARENA, WALL_TOP, TRENCH, BRIDGE_Y } from './infected_foundry.ts';
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
/** Every climbable top stays at or under this; the furnace stacks and hall walls tower over it. */
const MAX_TOP = 256;
/** Walls and roof of the control room (sheer, not reachable from any deck). */
const ROOF_TOP = 304;
const WALL_T = 64;
/** Clear forward view (and walk) every spawn gets along its yaw. */
const SPAWN_SIGHT = 192;

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
const overTrench = (p: { x: number; y: number }) => p.x > TRENCH.x0 && p.x < TRENCH.x1 && p.y > TRENCH.y0 && p.y < TRENCH.y1;
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
const isGround = (s: Box3) => FOUNDRY.ground.includes(s as BoxBrush);
const quadrant = (p: Vec3) => (p.x > 0 ? (p.y > 0 ? 'NE' : 'SE') : p.y > 0 ? 'NW' : 'SW');
const route = (label: string) => FOUNDRY.climbs.find((r) => r.label === label)!;

describe('infected_foundry', () => {
	it('is an open infected map with the zombies physics profile and only teleport zones', () => {
		expect(m.id).toBe('infected_foundry');
		expect(m.title).toBe('Foundry');
		expect(m.kind as string).toBe('infected');
		expect(m.layout).toBe('open');
		expect(m.cvars).toEqual({ ...ZOMBIES_CVARS });
		expect(m.zones).toHaveLength(2);
		for (const z of m.zones) expect(z.type).toBe('teleport');
		expect(m.zombies).toBeUndefined();
	});

	it('has a dusk theme: indigo sky, amber horizon, low warm sun, cool fill and rising embers', () => {
		const t = m.theme;
		const rgb = (c: number) => [c >> 16, (c >> 8) & 0xff, c & 0xff] as const;
		const [tr, , tb] = rgb(t.skyTop);
		expect(tb, 'sky top is blue-indigo').toBeGreaterThan(tr);
		expect(rgb(t.skyTop).reduce((a, b) => a + b), 'sky top is dark').toBeLessThan(200);
		const [hr, , hb] = rgb(t.skyHorizon);
		expect(hr, 'horizon is warm').toBeGreaterThan(hb * 2);
		expect(t.sunColor >> 16).toBeGreaterThan(t.sunColor & 0xff);
		expect(t.sunDir.z, 'low dusk sun').toBeGreaterThan(0);
		expect(t.sunDir.z).toBeLessThan(0.6);
		const [ar, , ab] = rgb(t.ambientSky);
		expect(ab, 'cool steel-blue fill').toBeGreaterThan(ar);
		expect(t.fogFar).toBeGreaterThan(t.fogNear);
		const known = ['aurora', 'embers', 'clouds', 'gridFloor', 'lavaSea', 'snowFloor'];
		for (const e of t.effects) expect(known).toContain(e.type);
		const embers = t.effects.find((e) => e.type === 'embers');
		expect(embers).toMatchObject({ color: 0xff8c2a, count: 140 });
		// Readable dusk: bright fill, lifted albedos, nothing structural crushed to black.
		expect(t).toMatchObject({ ambientSky: 0x6f8eb8, ambientGround: 0x524034, ambientIntensity: 0.85, sunColor: 0xffaa62, sunIntensity: 1.15, fogColor: 0x2c3442 });
		const luma = (c: number) => { const [r, g, b] = rgb(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
		for (const k of ['perimeter', 'pilaster', 'truss', 'steelBeam', 'catwalk', 'gantryDeck', 'brick', 'roofSteel', 'sill', 'controlFloor', 'furnace', 'furnaceUpper', 'millFloor'])
			expect(luma(t.materials[k]!.color), `${k} too dark`).toBeGreaterThanOrEqual(80);
		expect(t.materials.perimeter).toMatchObject({ color: 0x64544c, topColor: 0x726258 });
		for (const k of ['pilaster', 'truss', 'steelBeam', 'catwalk', 'gantryDeck']) expect(t.materials[k], k).toMatchObject({ color: 0x4d5968, topColor: 0x5d6b7c });
		expect(t.materials.millFloor).toMatchObject({ color: 0x66625e, topColor: 0x706c66 });
		expect(t.materials.safetyLane!.color).toBe(0xd48c28);
		// Safety yellow, not olive: red and green well above blue.
		for (const k of ['hazardRail', 'craneGirder', 'craneLeg']) {
			expect(t.materials[k], k).toMatchObject({ color: 0xe0ad2b, topColor: 0xecbc3c });
			const [r, g, b] = rgb(t.materials[k]!.color);
			expect(r - b, k).toBeGreaterThan(160);
			expect(g - b, k).toBeGreaterThan(100);
		}
		// Clean riveted gunmetal stacks with crisp glowing vent strips and warm glazing.
		expect(t.materials.furnace!.color).toBe(0x48525e);
		expect(t.materials.furnaceVent).toMatchObject({ color: 0xff7a1a, edgeColor: 0xffc454 });
		expect(t.materials.clerestory).toMatchObject({ color: 0xd9944a, edgeColor: 0x403832 });
		for (const k of ['furnace', 'furnaceUpper', 'furnaceVent', 'furnaceCap', 'clerestory']) expect(t.materials[k]!.noise ?? 0, `${k} noise`).toBeLessThanOrEqual(0.08);
		// Lava-crack seams only on the liquid slag: the trench pool and the ladle bowl.
		const seamed = Object.entries(t.materials).filter(([, mat]) => mat.seamColor !== undefined).map(([k]) => k).sort();
		expect(seamed).toEqual(['ladleBowl', 'slag']);
		expect(t.materials.slag).toMatchObject({ color: 0xff5a12, topColor: 0xff741e, seamColor: 0xffbe3b });
		expect(t.materials.ladleBowl).toMatchObject({ color: 0xff5a12, topColor: 0xff741e, seamColor: 0xffbe3b });
		expect(t.materials.glass!.glass).toBe(true);
		for (const k of ['clerestory', 'furnaceVent', 'furnaceCap', 'slagRunnel']) expect(t.materials[k]!.seamColor ?? t.materials[k]!.edgeColor, k).toBeDefined();
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

	it('has 20 spawns, free and on ground in the real trace', () => {
		expect(spawns.length).toBe(20);
		for (const [i, s] of [m.spawn, ...spawns].entries()) {
			expect(s.pos.z, `spawn ${i} authored at floor height`).toBe(0);
			const r = standsFree(loaded(s.pos));
			expect(r.solid, `spawn ${i} starts solid`).toBe(false);
			expect(r.ground, `spawn ${i} has no ground`).toBe(true);
		}
	});

	it('spawns are at least 256 apart, inside the arena, facing inward, ≥ 5 per quadrant, never over the trench', () => {
		for (let i = 0; i < spawns.length; i++) {
			const a = spawns[i]!;
			expect(Math.abs(a.pos.x)).toBeLessThanOrEqual(ARENA - 128);
			expect(Math.abs(a.pos.y)).toBeLessThanOrEqual(ARENA - 128);
			expect(a.pos.x, `spawn ${i} on an axis`).not.toBe(0);
			expect(a.pos.y, `spawn ${i} on an axis`).not.toBe(0);
			expect(overTrench(a.pos), `spawn ${i} over the trench`).toBe(false);
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

	it('every spawn looks down at least 192 units of open floor along its yaw (eye-height ray)', () => {
		const ZERO = { x: 0, y: 0, z: 0 };
		const blocked: string[] = [];
		for (const s of spawns) {
			const p = loaded(s.pos);
			const eye = { x: p.x, y: p.y, z: p.z + VIEW_HEIGHT };
			const d = dirXY(s.yaw);
			const end = { x: eye.x + d.x * SPAWN_SIGHT, y: eye.y + d.y * SPAWN_SIGHT, z: eye.z };
			const t = world.trace(eye, end, ZERO, ZERO);
			if (t.startsolid || t.fraction < 1) blocked.push(`(${s.pos.x}, ${s.pos.y}) yaw ${s.yaw.toFixed(1)}: clear ${(t.fraction * SPAWN_SIGHT).toFixed(0)}`);
		}
		expect(blocked).toEqual([]);
	});

	it('the lane between the NE trench railing and the pipe deck crates is at least 128 wide', () => {
		const railNE = FOUNDRY.trench.rails.find((r) => r.max.x === TRENCH.x1 + 32 && r.max.y === TRENCH.y1 + 32)!;
		expect(railNE).toBeDefined();
		const crates = boxes.filter((b) => b.material === 'crate' && b.min.y >= TRENCH.y1 && b.min.x > 0);
		expect(crates.length).toBeGreaterThan(0);
		for (const c of crates) expect(gapXY(railNE, c), 'NE pinch').toBeGreaterThanOrEqual(128);
		expect(walks({ x: 288, y: 600 }, { x: 288, y: 1000 })).toBe(true);
	});

	it('no two brushes intersect (touching is fine)', () => {
		for (let i = 0; i < all.length; i++)
			for (let j = i + 1; j < all.length; j++)
				expect(overlaps(all[i]!, all[j]!), `brushes ${i} (${m.brushes[i]!.material}) and ${j} (${m.brushes[j]!.material})`).toBe(false);
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

	it('is enclosed: four hall walls around everything, a teleport under the map', () => {
		const walls = boxes.filter((b) => b.material === 'perimeter');
		expect(walls).toHaveLength(4);
		for (const w of walls) {
			expect(w.max.z).toBe(WALL_TOP);
			expect(w.min.z).toBe(-64);
			expect(Math.min(w.max.x - w.min.x, w.max.y - w.min.y)).toBe(WALL_T);
		}
		const decor = new Set<BoxBrush>([...FOUNDRY.walls.trim, ...FOUNDRY.walls.coping, ...FOUNDRY.walls.trusses]);
		for (const d of FOUNDRY.walls.trim) {
			expect(walls.some((w) => gapXY(w, d) === 0), `${d.material} trim touches a wall`).toBe(true);
			expect(Math.min(ARENA - Math.abs(d.min.x), ARENA - Math.abs(d.max.x), ARENA - Math.abs(d.min.y), ARENA - Math.abs(d.max.y))).toBe(0);
		}
		for (const t of FOUNDRY.walls.trusses) expect(t.min.z, 'trusses hang high over the floor').toBeGreaterThanOrEqual(WALL_TOP - 256);
		// Everything climbable stays low; only the furnace stacks and the press head rise above it (sheer, unclimbable).
		const tall = new Set<BoxBrush>([...FOUNDRY.furnace.stacks, ...FOUNDRY.furnace.upper, ...FOUNDRY.furnace.caps]);
		const inner = boxes.filter((b) => b.material !== 'perimeter' && !decor.has(b));
		for (const b of inner) {
			expect(b.min.x).toBeGreaterThanOrEqual(-ARENA);
			expect(b.min.y).toBeGreaterThanOrEqual(-ARENA);
			expect(b.max.x).toBeLessThanOrEqual(ARENA);
			expect(b.max.y).toBeLessThanOrEqual(ARENA);
			if (!tall.has(b)) expect(b.max.z, b.material).toBeLessThanOrEqual(ROOF_TOP);
			if (!tall.has(b) && !FOUNDRY.control.walls.includes(b) && !FOUNDRY.control.bays.includes(b) && b !== FOUNDRY.control.roof)
				expect(b.max.z, b.material).toBeLessThanOrEqual(MAX_TOP);
		}
		expect(WALL_TOP - Math.max(...inner.map((b) => b.max.z))).toBeGreaterThanOrEqual(512);
		const closes = (pred: (w: BoxBrush) => boolean) => walls.some(pred);
		expect(closes((w) => w.max.x <= -ARENA && w.min.y <= -ARENA && w.max.y >= ARENA)).toBe(true);
		expect(closes((w) => w.min.x >= ARENA && w.min.y <= -ARENA && w.max.y >= ARENA)).toBe(true);
		expect(closes((w) => w.max.y <= -ARENA && w.min.x <= -ARENA && w.max.x >= ARENA)).toBe(true);
		expect(closes((w) => w.min.y >= ARENA && w.min.x <= -ARENA && w.max.x >= ARENA)).toBe(true);

		// Ground tiles cover the arena at z = 0 except the trench (no overlaps: see above).
		let groundArea = 0;
		for (const g of FOUNDRY.ground) {
			expect(g.max.z).toBe(0);
			expect(g.min.z).toBe(-64);
			expect(Math.max(Math.abs(g.min.x), Math.abs(g.max.x), Math.abs(g.min.y), Math.abs(g.max.y))).toBeLessThanOrEqual(ARENA);
			expect(overlaps({ ...g, max: { ...g.max, z: 1 } }, { min: { x: TRENCH.x0, y: TRENCH.y0, z: -1 }, max: { x: TRENCH.x1, y: TRENCH.y1, z: 1 } })).toBe(false);
			groundArea += (g.max.x - g.min.x) * (g.max.y - g.min.y);
		}
		expect(groundArea).toBe(4 * ARENA * ARENA - (TRENCH.x1 - TRENCH.x0) * (TRENCH.y1 - TRENCH.y0));

		const tps = m.zones.filter((z) => z.type === 'teleport');
		const b = boundsOf(m.brushes);
		const under = tps.find((z) => z.to === 'start' && z.max.z <= b.min.z && z.min.x <= b.min.x && z.min.y <= b.min.y && z.max.x >= b.max.x && z.max.y >= b.max.y);
		expect(under).toBeDefined();
		expect(under!.max.z).toBeLessThanOrEqual(-256);
		for (const tp of tps) {
			for (const br of all) expect(overlaps(tp, br), 'teleport overlaps a brush').toBe(false);
			for (const s of [m.spawn, ...spawns]) expect(inBox(loaded(s.pos), tp)).toBe(false);
		}
	});

	it('the slag trench is a bounded pit with a trigger well under the bridges', () => {
		const { slag, zone, bridges, liners } = FOUNDRY.trench;
		expect(top(slag)).toBe(-128);
		expect([slag.min.x, slag.max.x, slag.min.y, slag.max.y]).toEqual([TRENCH.x0, TRENCH.x1, TRENCH.y0, TRENCH.y1]);
		expect(zone.min.z).toBeGreaterThan(top(slag));
		expect(zone.max.z).toBeLessThanOrEqual(-32);
		for (const br of bridges) expect(br.min.z - zone.max.z).toBeGreaterThanOrEqual(16);
		expect(liners).toHaveLength(4);
		// The trench does not split the map: open floor north and south of it, across the full width.
		expect(TRENCH.y1).toBeLessThanOrEqual(ARENA / 2);
		expect(walks({ x: -420, y: 848 }, { x: 290, y: 848 })).toBe(true);
		expect(walks({ x: -420, y: 848 }, { x: -420, y: 600 })).toBe(true);
		expect(walks({ x: 272, y: 848 }, { x: 272, y: 600 })).toBe(true);
		expect(walks({ x: -420, y: -880 }, { x: 420, y: -880 })).toBe(true);
		// A player stepping off a bridge into the slag hits the trigger on the way down.
		const p: PlayerState = createPlayer({ x: 0, y: -200, z: 64 });
		const still: UserCmd = { pitch: 0, yaw: 0, forwardmove: 0, sidemove: 0, buttons: 0 };
		let caught = false;
		for (let i = 0; i < 128 && !caught; i++) {
			playerMove(world, p, still, INFECTED_CVARS, TICK_INTERVAL);
			caught = p.origin.z + HULL_MIN.z < zone.max.z && inBox({ ...p.origin, z: zone.min.z + 1 }, zone);
		}
		expect(caught).toBe(true);
	});

	it('three footbridges cross the trench at floor level, railed on both sides', () => {
		const { bridges, bridgeRails } = FOUNDRY.trench;
		expect(bridges).toHaveLength(3);
		for (const [i, br] of bridges.entries()) {
			const yc = BRIDGE_Y[i]!;
			expect(top(br)).toBe(0);
			expect(br.max.y - br.min.y).toBeGreaterThanOrEqual(192);
			expect(br.max.z - br.min.z).toBeLessThanOrEqual(32);
			expect(walks({ x: -340, y: yc }, { x: 340, y: yc }), `bridge ${i}`).toBe(true);
			// Diagonal-ish: from one end of the bridge to the other near its rails.
			expect(walks({ x: -300, y: yc + 72 }, { x: 300, y: yc + 72 }), `bridge ${i} north lane`).toBe(true);
			expect(walks({ x: -300, y: yc - 72 }, { x: 300, y: yc - 72 }), `bridge ${i} south lane`).toBe(true);
		}
		for (const r of bridgeRails) expect(top(r)).toBe(40);
		// Railings line the edges between the bridges: no walking straight into the slag.
		expect(walks({ x: -300, y: 240 }, { x: 300, y: 240 })).toBe(false);
	});

	it('every claimed climb route is walkable (≤ 18 per step) or jumpable (≤ 40 per ledge)', () => {
		expect(FOUNDRY.climbs.length).toBeGreaterThanOrEqual(13);
		// Nothing climbable rises above the gantry.
		for (const r of FOUNDRY.climbs) expect(top(r.surfaces[r.surfaces.length - 1]!), r.label).toBeLessThanOrEqual(192);
		for (const r of FOUNDRY.climbs) {
			const limit = r.how === 'step' ? STEP : LEDGE;
			for (let i = 1; i < r.surfaces.length; i++) {
				const a = r.surfaces[i - 1]!;
				const b = r.surfaces[i]!;
				expect(gapXY(a, b), `${r.label} ${i}: surfaces not adjacent`).toBeLessThanOrEqual(0.5);
				expect(top(b) - top(a), `${r.label} ${i}: rise`).toBeLessThanOrEqual(limit);
			}
			for (const [i, s] of r.surfaces.entries()) {
				const on = all.some((br) => br.max.z === s.max.z && br.min.x <= s.min.x && br.max.x >= s.max.x && br.min.y <= s.min.y && br.max.y >= s.max.y);
				expect(on, `${r.label} ${i}: not on a brush top`).toBe(true);
			}
			const dst = r.surfaces[r.surfaces.length - 1]!;
			let free = 0;
			for (let u = 0.125; u < 1; u += 0.25)
				for (let w = 0.125; w < 1; w += 0.25) {
					const c = { x: dst.min.x + (dst.max.x - dst.min.x) * u, y: dst.min.y + (dst.max.y - dst.min.y) * w, z: top(dst) + CLEARANCE };
					const st = standsFree(c);
					if (!st.solid && st.ground) free++;
				}
			expect(free, `${r.label}: no free standing spot on the destination`).toBeGreaterThanOrEqual(8);
		}
	});

	it('stairs leave head room: nothing within a hull height above any step or landing', () => {
		for (const r of FOUNDRY.climbs.filter((c) => c.how === 'step'))
			for (const [i, s] of r.surfaces.entries()) {
				if (isGround(s)) continue;
				const space: Box3 = { min: { ...s.min, z: s.max.z }, max: { ...s.max, z: s.max.z + HULL_H } };
				for (const [j, b] of all.entries()) expect(overlaps(space, b), `${r.label} ${i}: ceiling (brush ${j} ${m.brushes[j]!.material})`).toBe(false);
			}
	});

	it('jump climbs leave room for a full jump over every take-off', () => {
		for (const r of FOUNDRY.climbs.filter((c) => c.how === 'jump'))
			for (const [i, s] of r.surfaces.slice(0, -1).entries()) {
				if (isGround(s)) continue;
				const space: Box3 = { min: { ...s.min, z: s.max.z }, max: { ...s.max, z: s.max.z + JUMP + HULL_H } };
				for (const [j, b] of all.entries()) expect(overlaps(space, b), `${r.label} ${i}: overhang (brush ${j} ${m.brushes[j]!.material})`).toBe(false);
			}
	});

	it('design heights: control room 160, gantry 192, catwalk 160, pipe deck 144, containers 128 / 256', () => {
		const { control, gantry, furnace, gallery, yards } = FOUNDRY;
		expect(top(control.slab)).toBe(160);
		expect(top(gantry.deck)).toBe(192);
		for (const s of gantry.steps) expect(top(s)).toBe(176);
		for (const c of Object.values(furnace.catwalk)) expect(top(c)).toBe(160);
		expect(top(gallery.deck)).toBe(144);
		expect(top(yards.containerSW)).toBe(128);
		expect(top(yards.containerSE)).toBe(128);
		expect(yards.containerTop.min.z).toBe(128);
		expect(top(yards.containerTop)).toBe(256);
		// Furnace stacks tower out of reach of the catwalk; caps glow at the top.
		for (const s of furnace.stacks) expect(top(s) - 160).toBeGreaterThan(JUMP * 2);
		for (const c of furnace.caps) expect(top(c)).toBe(480);
		// Landmarks sit where the layout says.
		const c = (b: Box3) => ({ x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: 0 });
		expect(c(control.slab).x).toBeLessThan(TRENCH.x0);
		expect(c(furnace.stacks[0]!).x).toBeGreaterThan(TRENCH.x1);
		expect(c(gallery.deck).y).toBeGreaterThan(TRENCH.y1);
		expect(quadrant(c(yards.containerSW))).toBe('SW');
		expect(quadrant(c(yards.containerSE))).toBe('SE');
		// The gantry spans the trench, from the control room to the catwalk.
		expect(gantry.deck.min.x).toBeLessThan(TRENCH.x0);
		expect(gantry.deck.max.x).toBeGreaterThan(TRENCH.x1);
		expect(gapXY(gantry.steps[0]!, control.slab)).toBe(0);
		expect(gapXY(gantry.steps[1]!, furnace.catwalk.w)).toBe(0);
		// Nothing stands inside the trench footprint below the floor except the slag.
		const inTrench = boxes.filter((b) => b.min.z < 0 && b.min.x < TRENCH.x1 && b.max.x > TRENCH.x0 && b.min.y < TRENCH.y1 && b.max.y > TRENCH.y0);
		for (const b of inTrench) expect(b === FOUNDRY.trench.slag || b.min.z >= -16, `${b.material} in the trench`).toBe(true);
	});

	it('every high ground has at least two approaches', () => {
		const ends = (r: ClimbRoute) => r.surfaces[r.surfaces.length - 1]!;
		const fromGround = FOUNDRY.climbs.filter((r) => isGround(r.surfaces[0]!));
		const reaches = (target: Box3) =>
			fromGround.filter((r) => {
				const e = ends(r);
				return e === target || (top(e) === top(target) && e.min.x >= target.min.x && e.max.x <= target.max.x && e.min.y >= target.min.y && e.max.y <= target.max.y);
			});
		const { control, furnace, gallery, yards } = FOUNDRY;
		// Control room: rear stairs + crate climb (+ the gantry).
		expect(reaches(control.slab).map((r) => r.how).sort()).toEqual(['jump', 'step']);
		// Catwalk ring: two stairways (+ the gantry).
		const ring = Object.values(furnace.catwalk);
		expect(fromGround.filter((r) => ring.some((c) => reaches(c).includes(r))).length).toBe(2);
		// Pipe deck: stairs + crates.
		expect(reaches(gallery.deck).map((r) => r.how).sort()).toEqual(['jump', 'step']);
		// Containers: two crate climbs each; the upper SE container is out of reach (roof cover).
		expect(reaches(yards.containerSW)).toHaveLength(2);
		expect(reaches(yards.containerSE)).toHaveLength(2);
		expect(top(yards.containerTop) - top(yards.containerSE)).toBeGreaterThan(JUMP * 2);
		// Gantry: from both decks.
		expect(route('control room → gantry → furnace catwalk').surfaces).toContain(FOUNDRY.gantry.deck);
		expect(route('furnace catwalk → gantry → control room').surfaces).toContain(FOUNDRY.gantry.deck);
	});

	it('the control room: doorways open, a free interior, glass bays and walk-through piers', () => {
		const { doorways, interior, roof, bays } = FOUNDRY.control;
		expect(doorways).toHaveLength(4);
		for (const [i, d] of doorways.entries()) {
			expect(Math.max(d.max.x - d.min.x, d.max.y - d.min.y), `doorway ${i} width`).toBeGreaterThanOrEqual(128);
			expect(d.max.z - d.min.z, `doorway ${i} height`).toBeGreaterThanOrEqual(HULL_H + 48);
			for (const [j, b] of all.entries()) expect(overlaps(d, b), `doorway ${i} blocked by brush ${j}`).toBe(false);
		}
		expect(roof.min.z).toBe(interior.max.z);
		expect(bays.filter((b) => b.material === 'glass')).toHaveLength(2);
		// Walk through the room south door → north door, and under the slab between the piers.
		expect(walks({ x: -720, y: 40 }, { x: -720, y: 480 }, 160)).toBe(true);
		expect(walks({ x: -600, y: -100 }, { x: -600, y: 700 })).toBe(true);
		// The rear door to the gantry opening, straight across the room.
		expect(walks({ x: -880, y: 224 }, { x: -536, y: 224 }, 160)).toBe(true);
	});

	it('the pipe gallery: a covered tunnel with open ends and a side door; flank lane behind it', () => {
		const { walkway, deck, sideDoor } = FOUNDRY.gallery;
		expect(walkway.max.y - walkway.min.y).toBeGreaterThanOrEqual(192);
		expect(walkway.max.z - walkway.min.z).toBeGreaterThanOrEqual(HULL_H + JUMP);
		expect(deck.min.z).toBe(walkway.max.z);
		for (const [j, b] of all.entries()) expect(overlaps(walkway, b), `walkway blocked by brush ${j} ${m.brushes[j]!.material}`).toBe(false);
		const yc = (walkway.min.y + walkway.max.y) / 2;
		expect(walks({ x: -900, y: yc }, { x: 900, y: yc })).toBe(true);
		expect(walks({ x: (sideDoor.x0 + sideDoor.x1) / 2, y: 900 }, { x: (sideDoor.x0 + sideDoor.x1) / 2, y: yc })).toBe(true);
		// Flank lane between the gallery and the north wall.
		expect(walks({ x: -1200, y: 1440 }, { x: 1200, y: 1440 })).toBe(true);
	});

	it('flank alleys around the yards and the furnace are at least 128 wide and walkable', () => {
		const { containerSW, containerSE } = FOUNDRY.yards;
		// South of both containers, along the south wall.
		expect(containerSW.min.y - (-ARENA + 16)).toBeGreaterThanOrEqual(128);
		expect(walks({ x: -1440, y: -1400 }, { x: 1440, y: -1400 })).toBe(true);
		// North of the yards, the south plaza.
		expect(walks({ x: -1440, y: -880 }, { x: 1440, y: -880 })).toBe(true);
		// East lane past the furnace and west lane past the control room stairs.
		expect(walks({ x: 1240, y: -600 }, { x: 1240, y: 1400 })).toBe(true);
		expect(walks({ x: -1400, y: -700 }, { x: -1400, y: 1400 })).toBe(true);
		// Under the catwalk ring, beside the stacks.
		expect(walks({ x: 608, y: -100 }, { x: 608, y: 700 })).toBe(true);
		expect(walks({ x: 1024, y: -100 }, { x: 1024, y: 700 })).toBe(true);
		// Low cover the infected can hide a beacon behind.
		for (const c of [...FOUNDRY.yards.swCoils, ...FOUNDRY.yards.seCoils, ...FOUNDRY.cover.ingots]) expect(top(c)).toBeLessThanOrEqual(JUMP);
	});
});

// ---------------------------------------------------------------------------
// Physics bot: real playerMove on the real collision world at the slowest
// survivor speed (LMG), walking or hopping every claimed climb route.

const LMG_CVARS = { ...INFECTED_CVARS, sv_maxspeed: WEAPONS.lmg.moveSpeed };
const DEG = 180 / Math.PI;
const HALF = HULL_MAX.x;
interface XY {
	x: number;
	y: number;
}
interface Waypoint extends XY {
	on: number;
}
const centreXY = (b: Box3): XY => ({ x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function clampIn(p: XY, b: Box3, margin: number): XY {
	const mx = Math.min(margin, (b.max.x - b.min.x) / 2);
	const my = Math.min(margin, (b.max.y - b.min.y) / 2);
	return { x: clamp(p.x, b.min.x + mx, b.max.x - mx), y: clamp(p.y, b.min.y + my, b.max.y - my) };
}

/** Start point and waypoints: a pair across every contact edge between consecutive surfaces. */
function plan(r: ClimbRoute): { start: Vec3; wps: Waypoint[] } {
	const S = r.surfaces;
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
			// b stands on a: enter b on the side away from the next surface.
			const c = S[i + 1];
			if (!c) throw new Error(`${r.label}: no entry for a lone ledge`);
			const d = { x: centreXY(c).x - centreXY(b).x, y: centreXY(c).y - centreXY(b).y };
			n = Math.abs(d.x) > Math.abs(d.y) ? { x: Math.sign(d.x), y: 0 } : { x: 0, y: Math.sign(d.y) };
			const cb = centreXY(b);
			P = { x: cb.x - n.x * ((b.max.x - b.min.x) / 2), y: cb.y - n.y * ((b.max.y - b.min.y) / 2) };
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

/** Drive a player along the waypoints; jump routes hold jump while the waypoint's surface is above step height. */
function climb(r: ClimbRoute, maxSecs = 20): ClimbResult {
	const { start, wps } = plan(r);
	const dst = r.surfaces[r.surfaces.length - 1]!;
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
		const surf = r.surfaces[t.on]!;
		const buttons = r.how === 'jump' && surf.max.z > p.origin.z + STEP ? IN_JUMP : 0;
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

/** Heading changes over 45° along the planned waypoints. */
function sharpTurns(r: ClimbRoute): number {
	const { start, wps } = plan(r);
	const pts: XY[] = [start, ...wps];
	let n = 0;
	let prev: number | null = null;
	for (let i = 1; i < pts.length; i++) {
		const dx = pts[i]!.x - pts[i - 1]!.x;
		const dy = pts[i]!.y - pts[i - 1]!.y;
		if (Math.hypot(dx, dy) < 1) continue;
		const h = Math.atan2(dy, dx);
		if (prev !== null) {
			const d = Math.abs(((h - prev + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
			if (d > Math.PI / 4) n++;
		}
		prev = h;
	}
	return n;
}

describe('infected_foundry physics bot (playerMove, LMG speed)', () => {
	const speed = WEAPONS.lmg.moveSpeed;

	for (const r of FOUNDRY.climbs.filter((c) => c.how === 'step')) {
		it(`walks ${r.label} without snagging`, () => {
			const res = climb(r);
			expect(res.ok, `${r.label}: did not arrive\n${res.trace}`).toBe(true);
			expect(res.maxAir, `${r.label}: airborne ${res.maxAir} ticks\n${res.trace}`).toBeLessThanOrEqual(4);
			// Close to full speed all the way; each sharp corner (the catwalk loop) costs a little re-acceleration.
			const turns = sharpTurns(r);
			if (r.label !== 'furnace catwalk loop') expect(turns, `${r.label}: corners`).toBe(0);
			expect(res.secs, `${r.label}: slow (path ${res.path.toFixed(0)}, ${turns} turns)\n${res.trace}`).toBeLessThanOrEqual(res.path / speed + 0.6 + 0.3 * turns);
		});
	}

	for (const r of FOUNDRY.climbs.filter((c) => c.how === 'jump')) {
		it(`hops up ${r.label}`, () => {
			const res = climb(r);
			expect(res.ok, `${r.label}: did not arrive\n${res.trace}`).toBe(true);
			const ledges = r.surfaces.length - 1;
			expect(res.secs, `${r.label}: slow (path ${res.path.toFixed(0)})\n${res.trace}`).toBeLessThanOrEqual(res.path / speed + 0.8 * ledges + 0.5);
		});
	}
});

// ---------------------------------------------------------------------------
// Throwing knives on the real map: bank shots and a sweep that never tunnels.

type KEv<K extends InfEvent['e']> = Extract<InfEvent, { e: K }>;

/** An InfectedGame on the foundry in 'playing': 1 is the Alpha; 2 and 3 survivors (parked inside the east wall unless placed). */
function foundryGame() {
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
	const PARK = ARENA + WALL_T / 2;
	put(2, PARK, -200);
	put(3, PARK, 200);
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

describe('infected_foundry throwing knives', () => {
	const bank = (label: string, from: XY, fromZ: number, d: Vec3, wall = true) =>
		it(`banks a knife off ${label} into a survivor`, () => {
			const g = foundryGame();
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
	bank('a furnace vent (east face)', { x: 1300, y: 224 }, 0, dir(180, 0));
	bank('a control room pier', { x: -300, y: 224 }, 0, dir(180, 0));
	bank('the SW container side', { x: -1024, y: -900 }, 0, dir(-90, 0));
	bank('the mill floor', { x: -1000, y: -400 }, 0, dir(-90, 25), false);

	it('a knife lobbed over the trench rail drops into the slag and is gone', () => {
		const g = foundryGame();
		g.put(1, -300, 240, 0);
		const t = g.game.throwKnife(1, { x: -300, y: 240, z: CLEARANCE + VIEW_HEIGHT }, dir(0, 10), g.now());
		expect(t.ok).toBe(true);
		const id = (t.events[0] as KEv<'knifeThrow'>).id;
		const gone = g.until('knifeRemove', id, 1000);
		expect(gone).not.toBeNull();
		expect(g.events.some((e) => e.e === 'knifeStick' && e.id === id)).toBe(false);
	});

	it('a sweep of throws from eight spots never tunnels or leaves the hall; knives land within reach or drop into the slag', () => {
		const spots: Array<{ name: string; x: number; y: number; z: number }> = [
			{ name: 'west mill floor', x: -1000, y: -400, z: 0 },
			{ name: 'under the control room', x: -700, y: 300, z: 0 },
			{ name: 'control room', x: -700, y: 250, z: 160 },
			{ name: 'crane gantry', x: -300, y: 224, z: 192 },
			{ name: 'furnace catwalk', x: 608, y: 500, z: 160 },
			{ name: 'pipe tunnel', x: 0, y: 1152, z: 0 },
			{ name: 'pipe deck', x: 0, y: 1100, z: 144 },
			{ name: 'SE yard', x: 1100, y: -900, z: 0 }
		];
		let thrown = 0;
		let slagged = 0;
		for (const spot of spots) {
			// A knife lost in the slag is gone for that life: a fresh game hands the Alpha a new one.
			let g = foundryGame();
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
					let last: Vec3 | null = null;
					let removed = false;
					for (let t = 0; t < 8000 && !stuck && !removed; t += INF_STEP_MS) {
						const n = g.events.length;
						g.step();
						const out = g.events.slice(n);
						removed = out.some((e) => e.e === 'knifeRemove' && e.id === id);
						if (removed) break;
						stuck = (out.find((e) => e.e === 'knifeStick' && e.id === id) as KEv<'knifeStick'> | undefined) ?? null;
						const k = g.game.knifeViews().find((v) => v.id === id)!;
						expect(k, `${what}: knife vanished`).toBeDefined();
						last = k;
						expect(solidAt(k), `${what}: knife in solid at ${JSON.stringify(k)}`).toBe(false);
						const inHall = Math.abs(k.x) < ARENA && Math.abs(k.y) < ARENA && k.z < WALL_TOP;
						expect(inHall && (k.z > 0 || overTrench(k)), `${what}: out of the hall at ${JSON.stringify(k)}`).toBe(true);
					}
					if (removed) {
						// The only way to lose a knife: it fell into the slag.
						expect(last && overTrench(last), `${what}: knife removed outside the trench at ${JSON.stringify(last)}`).toBe(true);
						slagged++;
						expect(g.events.filter((e) => e.e === 'infect')).toEqual([]);
						g = foundryGame();
						continue;
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
		// Most throws land; the slag only takes the ones thrown over it.
		expect(slagged).toBeGreaterThan(0);
		expect(slagged).toBeLessThan(thrown / 4);
	}, 60_000);
});
