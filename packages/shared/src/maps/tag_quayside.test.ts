import { describe, expect, it } from 'vitest';
import { buildCollisionWorld } from '../collision/world.ts';
import { HULL_MAX, HULL_MIN } from '../movement/api.ts';
import type { Vec3 } from '../types.ts';
import { tag_quayside as m, QUAYSIDE, ARENA, WALL_TOP } from './tag_quayside.ts';
import {
	boundsOf,
	brushBounds,
	dirXY,
	gapXY,
	rampAngle,
	rampFaceZ,
	simulateTransfer,
	type Box3,
	type BoxBrush,
	type RampBrush
} from './helpers.ts';

/** Same as SPAWN_CLEARANCE in ./index.ts (spawns are authored on floor tops and lifted at load). */
const CLEARANCE = 0.25;
const STEP = 18;
/** Standing jump apex is ~55.8 units (bhop chain math uses 55). */
const JUMP = 55;
/**
 * Jump-up ledges on climb routes stay at or under 40: a 48 ledge needs a
 * standing jump from against the wall, a running autobhop into it often fails.
 */
const LEDGE = 40;
const GRAVITY = 800;
const BHOP_SPEED = 290;

const boxes = m.brushes.filter((b): b is BoxBrush => b.type === 'box');
const ramps = m.brushes.filter((b): b is RampBrush => b.type === 'ramp');
const world = buildCollisionWorld(m);
const spawns = m.spawns ?? [];
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
/** Feet position as the game loads it: floor top + clearance (whether or not ./index.ts already lifted it). */
const loaded = (p: Vec3): Vec3 => ({ ...p, z: Math.round(p.z) + CLEARANCE });
/** Hull standing free on a walkable floor at p. */
function standsFree(p: Vec3): { solid: boolean; ground: boolean } {
	const t = world.trace(p, p, HULL_MIN, HULL_MAX);
	const down = world.trace(p, { ...p, z: p.z - 2 }, HULL_MIN, HULL_MAX);
	return { solid: t.startsolid, ground: down.fraction < 1 && down.plane.normal.z >= 0.7 };
}

describe('tag_quayside', () => {
	it('is an open tag map with only teleport zones', () => {
		expect(m.kind).toBe('tag');
		expect(m.layout).toBe('open');
		for (const z of m.zones) expect(z.type).toBe('teleport');
		expect(m.theme.fogFar).toBeGreaterThanOrEqual(12000);
	});

	it('has at least 12 spawns, free and on ground in the real trace', () => {
		expect(spawns.length).toBeGreaterThanOrEqual(12);
		for (const [i, s] of [m.spawn, ...spawns].entries()) {
			const r = standsFree(loaded(s.pos));
			expect(r.solid, `spawn ${i} starts solid`).toBe(false);
			expect(r.ground, `spawn ${i} has no ground`).toBe(true);
		}
	});

	it('spawns are at least 256 apart, inside the arena, facing into the map', () => {
		for (let i = 0; i < spawns.length; i++) {
			const a = spawns[i]!;
			expect(Math.abs(a.pos.x)).toBeLessThanOrEqual(ARENA - 128);
			expect(Math.abs(a.pos.y)).toBeLessThanOrEqual(ARENA - 128);
			const d = dirXY(a.yaw);
			expect(d.x * -a.pos.x + d.y * -a.pos.y, `spawn ${i} faces out`).toBeGreaterThan(0);
			for (let j = i + 1; j < spawns.length; j++) {
				const b = spawns[j]!;
				expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y), `spawns ${i}, ${j}`).toBeGreaterThanOrEqual(256);
			}
		}
		// Both banks get spawns.
		expect(spawns.filter((s) => s.pos.y < 0).length).toBeGreaterThanOrEqual(6);
		expect(spawns.filter((s) => s.pos.y > 0).length).toBeGreaterThanOrEqual(6);
	});

	it('every brush material exists in the theme', () => {
		for (const b of m.brushes) expect(m.theme.materials[b.material], b.material).toBeDefined();
	});

	it('only uses known effect types', () => {
		const known = ['aurora', 'embers', 'clouds', 'gridFloor', 'lavaSea', 'snowFloor'];
		for (const e of m.theme.effects) expect(known).toContain(e.type);
	});

	it('no two brushes intersect (touching is fine)', () => {
		const all = m.brushes.map(brushBounds);
		for (let i = 0; i < boxes.length; i++)
			for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!), `boxes ${i} and ${j}`).toBe(false);
		// Ramp bounding boxes against every other brush (conservative: the prisms are smaller).
		for (const r of ramps)
			for (const [j, b] of all.entries()) {
				if (m.brushes[j] === r) continue;
				expect(overlaps(brushBounds(r), b), `ramp vs brush ${j}`).toBe(false);
			}
	});

	it('has no player-trapping slots: walkable-height gaps are < 1 or > 40 units', () => {
		const all = m.brushes.map(brushBounds);
		for (let i = 0; i < all.length; i++)
			for (let j = i + 1; j < all.length; j++) {
				const a = all[i]!;
				const b = all[j]!;
				// Only pairs that share height above the ground plane.
				const z0 = Math.max(a.min.z, b.min.z, 0);
				const z1 = Math.min(a.max.z, b.max.z);
				if (z1 - z0 < 1) continue;
				const g = gapXY(a, b);
				if (g < 1 || g > 40) continue;
				// A slot is fine when another brush fills it (e.g. the step between two steps).
				const mid = {
					x: (Math.max(a.min.x, b.min.x) + Math.min(a.max.x, b.max.x)) / 2,
					y: (Math.max(a.min.y, b.min.y) + Math.min(a.max.y, b.max.y)) / 2,
					z: (z0 + z1) / 2
				};
				const filled = all.some((c, k) => k !== i && k !== j && inBox(mid, c));
				expect(filled, `brushes ${i} and ${j}: open gap ${g.toFixed(2)}`).toBe(true);
			}
	});

	it('is enclosed: sea walls around everything, teleport in the canal and under the map', () => {
		const walls = boxes.filter((b) => b.material === 'seawall');
		expect(walls).toHaveLength(4);
		for (const w of walls) expect(w.max.z).toBe(WALL_TOP);
		const inner = m.brushes.filter((b) => b.material !== 'seawall').map(brushBounds);
		const ib = { min: { x: Math.min(...inner.map((b) => b.min.x)), y: Math.min(...inner.map((b) => b.min.y)) }, max: { x: Math.max(...inner.map((b) => b.max.x)), y: Math.max(...inner.map((b) => b.max.y)) } };
		expect(ib.min.x).toBeGreaterThanOrEqual(-ARENA);
		expect(ib.min.y).toBeGreaterThanOrEqual(-ARENA);
		expect(ib.max.x).toBeLessThanOrEqual(ARENA);
		expect(ib.max.y).toBeLessThanOrEqual(ARENA);
		// Walls tower over everything climbable.
		expect(Math.max(...inner.map((b) => b.max.z))).toBeLessThanOrEqual(WALL_TOP - 1024);
		// Each side of the arena is fully closed by one wall.
		const closes = (pred: (w: BoxBrush) => boolean) => walls.some(pred);
		expect(closes((w) => w.max.x <= -ARENA && w.min.y <= -ARENA && w.max.y >= ARENA)).toBe(true);
		expect(closes((w) => w.min.x >= ARENA && w.min.y <= -ARENA && w.max.y >= ARENA)).toBe(true);
		expect(closes((w) => w.max.y <= -ARENA && w.min.x <= -ARENA && w.max.x >= ARENA)).toBe(true);
		expect(closes((w) => w.min.y >= ARENA && w.min.x <= -ARENA && w.max.x >= ARENA)).toBe(true);

		const tps = m.zones.filter((z) => z.type === 'teleport');
		const all = boundsOf(m.brushes);
		expect(
			tps.some((z) => z.max.z <= all.min.z && z.min.x <= all.min.x && z.min.y <= all.min.y && z.max.x >= all.max.x && z.max.y >= all.max.y)
		).toBe(true);
		const c = QUAYSIDE.canal;
		const canalTp = tps.find((z) => z.min.x <= -ARENA && z.max.x >= ARENA && z.min.y <= c.y0 && z.max.y >= c.y1 && z.max.z >= -c.depth + 64);
		expect(canalTp, 'canal teleport').toBeDefined();
		// Everything spanning the canal (bridges, pontoons) sits above the trigger.
		for (const b of m.brushes.map(brushBounds)) {
			if (b.min.y >= c.y0 && b.max.y <= c.y1 && b.min.z > -c.depth) expect(b.min.z).toBeGreaterThanOrEqual(canalTp!.max.z);
		}
		for (const tp of tps) {
			for (const b of m.brushes) expect(overlaps(tp, brushBounds(b)), 'teleport overlaps a brush').toBe(false);
			for (const s of [m.spawn, ...spawns]) expect(inBox(loaded(s.pos), tp)).toBe(false);
		}
	});

	it('has 3 single-brush surf ramps at 50°+ (steeper than walkable 46°)', () => {
		expect(ramps).toHaveLength(3);
		for (const r of ramps) {
			expect(rampAngle(r)).toBeGreaterThan(46);
			expect(rampAngle(r)).toBeGreaterThanOrEqual(50 - 1e-3);
			// Bases rest on the ground (no crawl space under them).
			expect(Math.min(r.from.z, r.to.z) - r.height).toBeCloseTo(0, 2);
		}
	});

	it('the slipway V is open at the bottom: a walkable channel ≥ 64 wide', () => {
		const [a, b] = QUAYSIDE.surfRamps.slipway;
		const mid = (a.from.x + a.to.x) / 2;
		for (const y of [2176 - 32, 2176, 2176 + 32]) {
			expect(rampFaceZ(a, mid, y)).toBeNull();
			expect(rampFaceZ(b, mid, y)).toBeNull();
		}
		const r = standsFree({ x: mid, y: 2176, z: CLEARANCE });
		expect(r.solid).toBe(false);
		expect(r.ground).toBe(true);
	});

	it('walking off the tower and the dock house lands on the surf ramps', () => {
		const { towerSlide, slipway } = QUAYSIDE.surfRamps;
		const t = simulateTransfer({ label: 'tower → slide', from: { platform: QUAYSIDE.tower, yaw: 90 }, to: { ramps: [towerSlide] } }, 250, GRAVITY);
		for (const r of t) expect(r.ok, r.reason).toBe(true);
		// Walk-off lane on the dock house roof over the slipway's north face.
		const d = QUAYSIDE.dockHouse;
		const lane: Box3 = { min: { x: d.min.x, y: 2272, z: d.min.z }, max: { x: d.max.x, y: 2400, z: d.max.z } };
		const s = simulateTransfer({ label: 'dock house → slipway', from: { platform: lane, yaw: 180 }, to: { ramps: slipway } }, 250, GRAVITY);
		for (const r of s) expect(r.ok, r.reason).toBe(true);
	});

	it('every claimed climb route is walkable (≤ 18 per step) or jumpable (≤ 40 per ledge)', () => {
		expect(QUAYSIDE.climbs.length).toBeGreaterThanOrEqual(8);
		for (const route of QUAYSIDE.climbs) {
			const limit = route.how === 'step' ? STEP : LEDGE;
			for (let i = 1; i < route.surfaces.length; i++) {
				const a = route.surfaces[i - 1]!;
				const b = route.surfaces[i]!;
				expect(gapXY(a, b), `${route.label} ${i}: surfaces not adjacent`).toBeLessThanOrEqual(0.5);
				expect(top(b) - top(a), `${route.label} ${i}: rise`).toBeLessThanOrEqual(limit);
			}
			// The destination roof has standing room in the real trace.
			const dst = route.surfaces[route.surfaces.length - 1]!;
			// (sampled on a grid: some roofs carry decor, e.g. the statue on the plinth).
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

	it('stairs leave head room: nothing within a hull height above any step', () => {
		for (const route of QUAYSIDE.climbs.filter((r) => r.how === 'step'))
			for (const s of route.surfaces) {
				if (QUAYSIDE.ground.includes(s as BoxBrush)) continue;
				const space: Box3 = { min: { ...s.min, z: s.max.z }, max: { ...s.max, z: s.max.z + 72 } };
				for (const b of m.brushes.map(brushBounds)) expect(overlaps(space, b), `${route.label}: ceiling`).toBe(false);
			}
	});

	it('bhop chains: 128 × 128 blocks, gaps 96–160, jumpable at 290 u/s with a 55-unit jump', () => {
		expect(QUAYSIDE.chains.length).toBeGreaterThanOrEqual(3);
		const v0 = Math.sqrt(2 * GRAVITY * JUMP);
		for (const ch of QUAYSIDE.chains) {
			for (const n of ch.nodes.slice(1, -1)) {
				expect(n.max.x - n.min.x).toBe(128);
				expect(n.max.y - n.min.y).toBe(128);
			}
			for (let i = 1; i < ch.nodes.length; i++) {
				const a = ch.nodes[i - 1]!;
				const b = ch.nodes[i]!;
				const gap = gapXY(a, b);
				const dz = top(b) - top(a);
				expect(gap, `${ch.label} ${i}: gap`).toBeGreaterThanOrEqual(96);
				expect(gap, `${ch.label} ${i}: gap`).toBeLessThanOrEqual(160);
				// Still above the target top when crossing its near edge...
				const tEdge = gap / BHOP_SPEED;
				expect(v0 * tEdge - 0.5 * GRAVITY * tEdge * tEdge, `${ch.label} ${i}: clears edge`).toBeGreaterThanOrEqual(dz);
				// ...and comes down on it before passing its far edge (blocks are 128 deep).
				const tLand = (v0 + Math.sqrt(v0 * v0 - 2 * GRAVITY * dz)) / GRAVITY;
				expect(BHOP_SPEED * tLand, `${ch.label} ${i}: reaches`).toBeGreaterThanOrEqual(gap);
				if (i < ch.nodes.length - 1) expect(BHOP_SPEED * tLand, `${ch.label} ${i}: overshoots`).toBeLessThanOrEqual(gap + 128);
				// Head room over the take-off surface edge and the landing block.
				if (i < ch.nodes.length - 1) {
					const space: Box3 = { min: { ...b.min, z: b.max.z }, max: { ...b.max, z: b.max.z + 72 } };
					for (const o of m.brushes.map(brushBounds)) expect(overlaps(space, o), `${ch.label} ${i}: ceiling`).toBe(false);
				}
			}
		}
	});
});
