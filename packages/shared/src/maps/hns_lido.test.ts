import { describe, expect, it } from 'vitest';
import { buildCollisionWorld } from '../collision/world.ts';
import { createPlayer, playerMove } from '../movement/gamemovement.ts';
import { DUCK_HULL_MAX, HULL_MAX, HULL_MIN, IN_DUCK, IN_JUMP } from '../movement/api.ts';
import { HNS_CVARS } from '../modes/index.ts';
import type { Vec3 } from '../types.ts';
import { getMap, mapsForMode } from './index.ts';
import { brushBounds, type BoxBrush } from './helpers.ts';
import { NavGraph } from './hns-nav.ts';
import { LIDO } from './hns_lido.ts';
import type { MapDef, Zone } from './types.ts';

/** The map as the game loads it (spawns and teleport destinations lifted by the registry). */
const m = getMap('hns_lido') as MapDef;
const hns = m.hns!;
const t0 = performance.now();
const world = buildCollisionWorld(m);
const buildMs = performance.now() - t0;
const A = LIDO.arena;
const ZERO = { x: 0, y: 0, z: 0 };
const tpZones = m.zones.filter((z): z is Extract<Zone, { type: 'teleport' }> => z.type === 'teleport');
const lifted = (p: Vec3): Vec3 => ({ ...p, z: p.z + 0.25 });

function standsFree(p: Vec3, maxs = HULL_MAX): { free: boolean; ground: boolean } {
	const t = world.trace(p, p, HULL_MIN, maxs);
	const down = world.trace(p, { ...p, z: p.z - 2 }, HULL_MIN, maxs);
	return { free: !t.startsolid, ground: down.fraction < 1 && down.plane.normal.z >= 0.7 };
}

const overlaps = (a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }, eps = 0.01) =>
	a.min.x < b.max.x - eps && b.min.x < a.max.x - eps && a.min.y < b.max.y - eps && b.min.y < a.max.y - eps && a.min.z < b.max.z - eps && b.min.z < a.max.z - eps;

describe('hns_lido: registration and data', () => {
	it('is a registered hide and seek map with an open layout', () => {
		expect(m.kind).toBe('hns');
		expect(m.layout).toBe('open');
		expect(mapsForMode('hns').map((x) => x.id)).toContain('hns_lido');
		expect(m.cvars.sv_air_speed_cap).toBe(300);
	});

	it('every brush material exists; effects are known types', () => {
		for (const b of m.brushes) expect(m.theme.materials[b.material], b.material).toBeDefined();
		const known = ['aurora', 'embers', 'clouds', 'gridFloor', 'lavaSea', 'snowFloor'];
		for (const e of m.theme.effects) expect(known).toContain(e.type);
		expect(m.theme.fogFar).toBeGreaterThanOrEqual(12000);
		expect(Object.keys(m.theme.materials).length).toBeGreaterThanOrEqual(100);
	});

	it('no two solid boxes intersect (touching is fine)', () => {
		const bs = m.brushes.filter((b): b is BoxBrush => b.type === 'box' && b.solid !== false).sort((a, b) => a.min.x - b.min.x);
		const bad: string[] = [];
		for (let i = 0; i < bs.length; i++) {
			const a = bs[i]!;
			for (let j = i + 1; j < bs.length && bs[j]!.min.x < a.max.x - 0.01; j++) if (overlaps(a, bs[j]!)) bad.push(`${a.material} × ${bs[j]!.material} at ${a.min.x},${a.min.y},${a.min.z}`);
		}
		expect(bad).toEqual([]);
	});
});

describe('hns_lido: spawns and the seeker cage', () => {
	it('has ≥ 12 spread hider spawns and ≥ 4 seeker spawns, all free and on ground', () => {
		expect(hns.hiderSpawns.length).toBeGreaterThanOrEqual(12);
		expect(hns.seekerSpawns.length).toBeGreaterThanOrEqual(4);
		for (const [i, s] of [...hns.hiderSpawns, ...hns.seekerSpawns, m.spawn].entries()) {
			const r = standsFree(s.pos);
			expect(r.free, `spawn ${i} starts solid`).toBe(true);
			expect(r.ground, `spawn ${i} not on ground`).toBe(true);
		}
		for (let i = 0; i < hns.hiderSpawns.length; i++)
			for (let j = i + 1; j < hns.hiderSpawns.length; j++) {
				const a = hns.hiderSpawns[i]!.pos;
				const b = hns.hiderSpawns[j]!.pos;
				expect(Math.hypot(a.x - b.x, a.y - b.y), `hider spawns ${i}, ${j}`).toBeGreaterThanOrEqual(256);
			}
	});

	it('seeker spawns are inside the cage, near the centre of the map; the cage has one doorway', () => {
		const c = hns.seekerCage!;
		for (const s of hns.seekerSpawns) {
			expect(s.pos.x).toBeGreaterThan(c.min.x + 16);
			expect(s.pos.x).toBeLessThan(c.max.x - 16);
			expect(s.pos.y).toBeGreaterThan(c.min.y + 16);
			expect(s.pos.y).toBeLessThan(c.max.y - 16);
		}
		expect(Math.hypot((c.min.x + c.max.x) / 2, (c.min.y + c.max.y) / 2)).toBeLessThan(1024);
		// Closed room: horizontal traces out of the cage hit a wall in every direction but the door (south).
		const o = { x: 0, y: 620, z: 8.25 };
		for (const [dx, dy] of [
			[1, 0],
			[-1, 0],
			[0, 1]
		] as const)
			expect(world.trace(o, { x: o.x + dx * 600, y: o.y + dy * 600, z: o.z }, HULL_MIN, HULL_MAX).fraction).toBeLessThan(1);
		expect(world.trace(o, { x: 0, y: 200, z: o.z }, HULL_MIN, HULL_MAX).fraction).toBe(1);
	});
});

describe('hns_lido: enclosure and fall-outs', () => {
	it('cliffs, clip walls and the invisible sea wall close every side up to 2048', () => {
		const walls = m.brushes.filter((b) => b.material === 'cliff' || b.material === 'clip').map(brushBounds);
		const inside = (p: Vec3) => walls.some((w) => p.x > w.min.x && p.x < w.max.x && p.y > w.min.y && p.y < w.max.y && p.z > w.min.z && p.z < w.max.z);
		const gaps: string[] = [];
		for (let z = 8; z < LIDO.wallTop; z += 64) {
			for (let x = A.x0 - 1; x <= A.x1 + 1; x += 64) {
				const xx = Math.min(Math.max(x, A.x0 + 1), A.x1 - 1);
				if (!inside({ x: xx, y: A.y0 - 2, z })) gaps.push(`S ${xx},${z}`);
				if (!inside({ x: xx, y: A.y1 + 2, z })) gaps.push(`N ${xx},${z}`);
			}
			for (let y = A.y0 + 1; y <= A.y1 - 1; y += 64) {
				if (!inside({ x: A.x0 - 2, y, z })) gaps.push(`W ${y},${z}`);
				if (!inside({ x: A.x1 + 2, y, z })) gaps.push(`E ${y},${z}`);
			}
		}
		expect(gaps.slice(0, 10)).toEqual([]);
		// Everything inside the arena stays inside it and far below the wall tops.
		const inner = m.brushes.map(brushBounds).filter((b) => (b.min.x + b.max.x) / 2 > A.x0 && (b.min.x + b.max.x) / 2 < A.x1 && (b.min.y + b.max.y) / 2 > A.y0 && (b.min.y + b.max.y) / 2 < A.y1 && b.max.z < 1500);
		for (const b of inner) {
			expect(b.min.x).toBeGreaterThanOrEqual(A.x0);
			expect(b.max.x).toBeLessThanOrEqual(A.x1);
			expect(b.min.y).toBeGreaterThanOrEqual(A.y0);
			expect(b.max.y).toBeLessThanOrEqual(A.y1);
		}
		expect(Math.max(...inner.map((b) => b.max.z))).toBeLessThanOrEqual(LIDO.wallTop - 1024);
	});

	it('has a respawn teleport under everything', () => {
		const below = tpZones.find((z) => !z.dest && z.max.z <= -256 && z.min.x <= A.x0 && z.max.x >= A.x1 && z.min.y <= A.y0 && z.max.y >= A.y1);
		expect(below).toBeDefined();
		const lowest = Math.min(...m.brushes.filter((b) => b.material !== 'cliff' && b.material !== 'clip').map((b) => brushBounds(b).min.z));
		expect(below!.max.z).toBeLessThan(lowest);
	});
});

describe('hns_lido: secrets', () => {
	const fakes = m.brushes.filter((b) => b.solid === false);

	it('has ≥ 25 clip-through brushes and none of them collides', () => {
		expect(fakes.length).toBeGreaterThanOrEqual(25);
		const solidBoxes = m.brushes.filter((b) => b.solid !== false).map(brushBounds);
		for (const f of fakes) {
			const b = brushBounds(f);
			const c = { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 };
			if (solidBoxes.some((s) => c.x > s.min.x && c.x < s.max.x && c.y > s.min.y && c.y < s.max.y && c.z > s.min.z && c.z < s.max.z)) continue;
			expect(world.trace(c, c, ZERO, ZERO).startsolid, `fake ${f.material} at ${c.x},${c.y},${c.z}`).toBe(false);
		}
	});

	it('records the checklist minimums (docs/research/hide-and-seek-maps.md)', () => {
		const kinds = (k: string) => LIDO.spots.filter((s) => s.kinds.includes(k as never)).length;
		expect(A.x1 - A.x0).toBeGreaterThanOrEqual(8192);
		expect(A.y1 - A.y0).toBeGreaterThanOrEqual(7168);
		expect(m.brushes.length).toBeGreaterThanOrEqual(3000);
		expect(LIDO.kinds.filter((k) => k === 'prop').length).toBeGreaterThanOrEqual(1200);
		expect(LIDO.buildings.length).toBeGreaterThanOrEqual(10);
		expect(LIDO.rooms.length).toBeGreaterThanOrEqual(40);
		expect(LIDO.spots.length).toBeGreaterThanOrEqual(30);
		expect(kinds('fake')).toBeGreaterThanOrEqual(12);
		expect(kinds('roof')).toBeGreaterThanOrEqual(5);
		expect(kinds('crouchjump')).toBeGreaterThanOrEqual(3);
		expect(kinds('prop')).toBeGreaterThanOrEqual(4);
		expect(LIDO.crawls.length).toBeGreaterThanOrEqual(5);
		expect(LIDO.loops.length).toBeGreaterThanOrEqual(8);
		expect(new Set(LIDO.spots.map((s) => s.id)).size).toBe(LIDO.spots.length);
	});

	it('every declared spot is a free floor position (duck hull at least)', () => {
		for (const s of LIDO.spots) {
			const r = standsFree(lifted(s.pos), DUCK_HULL_MAX);
			expect(r.free, `${s.id} starts solid`).toBe(true);
			expect(r.ground, `${s.id} has no floor`).toBe(true);
		}
	});

	it('crawlspaces: the standing hull is blocked, the duck hull passes end to end', () => {
		for (const c of LIDO.crawls) {
			const a = lifted(c.from);
			const b = lifted(c.to);
			const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
			expect(world.trace(mid, mid, HULL_MIN, HULL_MAX).startsolid, `${c.id}: standing fits`).toBe(true);
			expect(world.trace(mid, mid, HULL_MIN, DUCK_HULL_MAX).startsolid, `${c.id}: duck blocked`).toBe(false);
			const t = world.trace(a, b, HULL_MIN, DUCK_HULL_MAX);
			expect(t.startsolid || t.fraction < 1, `${c.id}: duck path blocked`).toBe(false);
		}
	});
});

describe('hns_lido: teleporters', () => {
	const T = LIDO.teleports;

	it('≥ 10 teleporters with fixed destinations, ≥ 5 hidden, ≥ 2 visible two-way pairs', () => {
		expect(T.length).toBeGreaterThanOrEqual(10);
		expect(T.filter((t) => t.hidden).length).toBeGreaterThanOrEqual(5);
		const pairs = T.filter((t) => !t.hidden && t.back && T.find((u) => u.id === t.back)?.back === t.id);
		expect(pairs.length).toBeGreaterThanOrEqual(4);
		for (const t of T) if (t.back) expect(T.find((u) => u.id === t.back), t.id).toBeDefined();
		expect(tpZones.filter((z) => z.dest).length).toBe(T.length);
	});

	it('destinations are free, on ground and outside every teleport zone', () => {
		for (const z of tpZones) {
			if (!z.dest) continue;
			const r = standsFree(z.dest.pos);
			expect(r.free, `dest ${JSON.stringify(z.dest.pos)} solid`).toBe(true);
			expect(r.ground, `dest ${JSON.stringify(z.dest.pos)} no ground`).toBe(true);
			const p = z.dest.pos;
			for (const o of tpZones)
				expect(p.x + 16 > o.min.x && p.x - 16 < o.max.x && p.y + 16 > o.min.y && p.y - 16 < o.max.y && p.z + 72 > o.min.z && p.z < o.max.z, 'dest inside a zone').toBe(false);
		}
	});

	it('zones overlap no solid brush', () => {
		const solids = m.brushes.filter((b) => b.solid !== false && b.type === 'box').map(brushBounds);
		for (const z of tpZones.filter((q) => q.dest)) for (const s of solids) expect(overlaps(z, s), `zone at ${z.min.x},${z.min.y}`).toBe(false);
	});
});

describe('hns_lido: reachability with the conservative nav graph', () => {
	const extras = [...hns.hiderSpawns.map((s) => s.pos), ...hns.seekerSpawns.map((s) => s.pos), ...LIDO.spots.map((s) => s.pos), ...T().flatMap((t) => (t.approach ? [t.approach] : []))];
	function T() {
		return LIDO.teleports;
	}
	const nh = hns.hiderSpawns.length;
	const ns = hns.seekerSpawns.length;
	let nav: NavGraph;
	let fromHiders: Uint8Array;
	let fromSeekers: Uint8Array;

	it('builds the graph', () => {
		nav = new NavGraph(world, m.brushes, {
			bounds: A,
			teleports: tpZones.filter((z) => z.dest).map((z) => ({ min: z.min, max: z.max, dest: z.dest! })),
			// Spawns are already lifted by the registry; spots are floor positions.
			extras: extras.map((p, i) => (i < nh + ns ? { ...p, z: p.z - 0.25 } : p))
		});
		expect(nav.nodes.length).toBeGreaterThan(50000);
		for (const [i, n] of nav.extraNodes.entries()) expect(n, `extra ${i} invalid`).toBeGreaterThanOrEqual(0);
		for (const n of nav.destNodes) expect(n).toBeGreaterThanOrEqual(0);
		fromHiders = nav.reach(nav.extraNodes.slice(0, nh));
		fromSeekers = nav.reach(nav.extraNodes.slice(nh, nh + ns));
	}, 120000);

	it('every hiding spot is reachable from the hider spawns and from the seeker cage', () => {
		for (const [i, s] of LIDO.spots.entries()) {
			const n = nav.extraNodes[nh + ns + i]!;
			expect(fromHiders[n], `${s.id} from hiders`).toBe(1);
			expect(fromSeekers[n], `${s.id} from seekers`).toBe(1);
		}
	});

	it('every teleporter is entered from the walkable map and its destination is reached', () => {
		const dz = tpZones.filter((z) => z.dest);
		dz.forEach((_, i) => {
			expect(nav.nodes.some((n, k) => n.tp === i && fromHiders[k] && fromSeekers[k]), `teleporter ${T()[i]!.id}`).toBe(true);
			expect(fromHiders[nav.destNodes[i]!], `dest of ${T()[i]!.id}`).toBe(1);
		});
	});

	it('no traps: every reachable place leads back to the seeker cage', () => {
		const back = nav.coReach(nav.extraNodes.slice(nh, nh + ns), fromHiders);
		const stuck: string[] = [];
		nav.nodes.forEach((n, i) => {
			if (fromHiders[i] && !back[i] && stuck.length < 10) stuck.push(`${n.x},${n.y},${n.z.toFixed(1)}`);
		});
		expect(stuck).toEqual([]);
	});

	it('nothing reachable lies outside the boundary or above 800', () => {
		nav.nodes.forEach((n, i) => {
			if (!fromHiders[i]) return;
			expect(n.x > A.x0 && n.x < A.x1 && n.y > A.y0 && n.y < A.y1, `${n.x},${n.y}`).toBe(true);
			expect(n.z).toBeLessThan(800);
		});
	});

	it('is a 45–90 s crossing at the 250 u/s knife run speed; ≥ 5 levels are walkable', () => {
		const far = (d: Float64Array): [number, number] => {
			let bi = -1;
			let bd = -1;
			d.forEach((x, i) => {
				if (Number.isFinite(x) && x > bd) [bd, bi] = [x, i];
			});
			return [bi, bd];
		};
		const [a] = far(nav.distances(nav.extraNodes[0]!));
		const [, dist] = far(nav.distances(a));
		expect(dist / 250).toBeGreaterThanOrEqual(45);
		expect(dist / 250).toBeLessThanOrEqual(90);
		const levels = new Set<number>();
		nav.nodes.forEach((n, i) => {
			if (fromHiders[i]) for (const z of [-192, 0, 192, 384, 576]) if (Math.abs(n.z - 0.25 - z) < 1) levels.add(z);
		});
		expect(levels.size).toBe(5);
	});
});

/**
 * Real movement: run from `from` towards `to` and jump (crouch-jump: duck in
 * the air; duck-jump: duck held throughout); succeed when standing on the
 * target height near `to`.
 */
function climbs(from: Vec3, to: Vec3, how: 'jump' | 'cjump' | 'djump'): boolean {
	for (const delay of [0, 2, 4, 6, 8, 12]) {
		const p = createPlayer(lifted(from));
		const yaw = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
		let ok = false;
		for (let t = 0; t < 240 && !ok; t++) {
			let buttons = how === 'djump' ? IN_DUCK : 0;
			const settle = how === 'djump' ? 20 : 0;
			if (t >= settle + delay && t <= settle + delay + 1) buttons |= IN_JUMP;
			if (how === 'cjump' && t > settle + delay) buttons |= IN_DUCK;
			const near = Math.hypot(to.x - p.origin.x, to.y - p.origin.y) < 8;
			const fwd = t >= settle && !near ? 450 : 0;
			playerMove(world, p, { pitch: 0, yaw, forwardmove: fwd, sidemove: 0, buttons }, HNS_CVARS);
			if (t > settle + delay + 4 && p.onGround && Math.abs(p.origin.z - (to.z + 0.25)) < 1.5 && Math.hypot(to.x - p.origin.x, to.y - p.origin.y) < 40) ok = true;
		}
		if (ok) return true;
	}
	return false;
}

describe('hns_lido: crouch-jump chains with the real movement', () => {
	const chains: Array<{ id: string; steps: Array<[Vec3, Vec3, 'jump' | 'cjump' | 'djump']> }> = [
		{ id: 'lifeguard-roof', steps: [[{ x: -766, y: -2502, z: 196 }, { x: -836, y: -2502, z: 256 }, 'cjump']] },
		{
			id: 'bar-roof',
			steps: [
				[{ x: 3164, y: -1820, z: 40 }, { x: 3204, y: -1820, z: 80 }, 'jump'],
				[{ x: 3204, y: -1820, z: 80 }, { x: 3244, y: -1820, z: 120 }, 'jump'],
				[{ x: 3244, y: -1810, z: 120 }, { x: 3244, y: -1880, z: 176 }, 'cjump']
			]
		},
		{ id: 'hotel-canopy', steps: [[{ x: -2840, y: 1640, z: 68 }, { x: -2780, y: 1640, z: 128 }, 'cjump']] },
		{ id: 'container-top', steps: [[{ x: 4360, y: 3224, z: 152 }, { x: 4420, y: 3224, z: 208 }, 'cjump']] },
		{
			id: 'hotel-void',
			steps: [
				[{ x: -3176, y: 2520, z: 192 }, { x: -3176, y: 2566, z: 216 }, 'djump'],
				[{ x: -3176, y: 2566, z: 216 }, { x: -3176, y: 2612, z: 248 }, 'djump'],
				[{ x: -3200, y: 2612, z: 248 }, { x: -3240, y: 2612, z: 296 }, 'djump']
			]
		}
	];
	for (const c of chains)
		it(c.id, () => {
			for (const [i, [a, b, how]] of c.steps.entries()) expect(climbs(a, b, how), `${c.id} step ${i}`).toBe(true);
		});
});

describe('hns_lido: performance', () => {
	it('collision builds in under a second; traces are cheap', () => {
		expect(buildMs).toBeLessThan(1000);
		const t1 = performance.now();
		const n = 20000;
		for (let i = 0; i < n; i++) {
			const x = A.x0 + 200 + ((i * 37) % (A.x1 - A.x0 - 400));
			const y = A.y0 + 200 + ((i * 53) % (A.y1 - A.y0 - 400));
			world.trace({ x, y, z: 40 }, { x: x + 64, y: y + 32, z: 40 }, HULL_MIN, HULL_MAX);
		}
		expect(((performance.now() - t1) * 1000) / n).toBeLessThan(20);
	});
});
