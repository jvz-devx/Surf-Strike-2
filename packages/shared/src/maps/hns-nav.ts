/**
 * Conservative reachability graph for open maps (hide and seek map tests).
 *
 * Nodes: player positions standing (or ducking) on walkable tops, on a
 * 32-unit column grid plus explicit extra points (spawns, spots, teleport
 * destinations). Edges: moves the real collision proves possible with a
 * "box path" — vertical lift, horizontal move, drop — which is stricter
 * than the real parabolic movement:
 *
 *   walk   ≤ 48 horizontal, rise ≤ 18 (sv_stepsize), any drop; duck hull
 *          (anyone can crouch-walk, so duck-only crawlspaces connect).
 *   jump   standing hull lifted 50 (real running jump: 55), then the duck
 *          hull across ≤ 64 (≤ 96 when not rising) and down.
 *   cjump  crouch-jump: standing hull to +50, duck hull to +62 (real: 65),
 *          across ≤ 48, down.
 *   djump  jump while already ducked: duck hull lifted 48 (real: 56), across ≤ 48.
 *
 * A node whose duck hull overlaps a teleport zone leads only to that zone's
 * destination. Distances are horizontal path lengths (teleports excluded).
 */
import type { CollisionWorld } from '../collision/api.ts';
import { DUCK_HULL_MAX, HULL_MAX, HULL_MIN } from '../movement/api.ts';
import type { Vec3 } from '../types.ts';
import { rampFaceZ, type RampBrush } from './helpers.ts';
import type { BrushDef, Spawn } from './types.ts';

export const NAV_CELL = 32;
const CLEAR = 0.25;
const STEP = 18;
const JUMP = 50;
const CJUMP = 62;
const DJUMP = 48;

export interface NavNode {
	x: number;
	y: number;
	/** Feet height (floor top + 0.25). */
	z: number;
	/** The standing hull fits (else duck only). */
	stand: boolean;
	/** Index of the teleporter whose zone the duck hull overlaps, or -1. */
	tp: number;
	/** Explicit extra point (spawn, spot, destination). */
	extra: boolean;
}

export interface NavTeleport {
	min: Vec3;
	max: Vec3;
	dest: Spawn;
}

export interface NavOptions {
	bounds: { x0: number; x1: number; y0: number; y1: number };
	teleports: NavTeleport[];
	/** Extra points (feet on the floor, not lifted). */
	extras: Vec3[];
}

export class NavGraph {
	readonly nodes: NavNode[] = [];
	/** Grid column (i + nx * j) → node indices sorted by z. */
	private readonly cols = new Map<number, number[]>();
	private readonly adj = new Map<number, Array<[number, number]>>();
	private readonly x0: number;
	private readonly y0: number;
	private readonly nx: number;
	private readonly ny: number;
	/** Node index of each extra point (-1 if not a valid position). */
	readonly extraNodes: number[] = [];
	/** Node index of each teleport destination (-1 if invalid). */
	readonly destNodes: number[] = [];
	/** Node index of a point inside each teleport zone (-1 if none). */
	readonly entryNodes: number[] = [];
	traces = 0;

	constructor(
		readonly world: CollisionWorld,
		brushes: BrushDef[],
		readonly opts: NavOptions
	) {
		const b = opts.bounds;
		// Columns at 32k + 5: hull faces (±16) never sit exactly on even-aligned faces (touching = solid).
		this.x0 = Math.ceil((b.x0 + 16) / NAV_CELL) * NAV_CELL + 5;
		this.y0 = Math.ceil((b.y0 + 16) / NAV_CELL) * NAV_CELL + 5;
		this.nx = Math.floor((b.x1 - 16 - this.x0) / NAV_CELL) + 1;
		this.ny = Math.floor((b.y1 - 16 - this.y0) / NAV_CELL) + 1;
		// Candidate floor heights per column from walkable brush tops.
		const cand = new Map<number, number[]>();
		const add = (k: number, z: number) => {
			let l = cand.get(k);
			if (!l) cand.set(k, (l = []));
			l.push(z);
		};
		for (const br of brushes) {
			if (br.solid === false) continue;
			if (br.type === 'box') {
				const [i0, i1, j0, j1] = this.colRange(br.min.x, br.max.x, br.min.y, br.max.y);
				for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) add(i + this.nx * j, br.max.z);
			} else if (br.type === 'ramp') {
				const r = br as RampBrush;
				const xs = [r.from.x, r.to.x];
				const ys = [r.from.y, r.to.y];
				const hw = r.halfWidth;
				const [i0, i1, j0, j1] = this.colRange(Math.min(...xs) - hw, Math.max(...xs) + hw, Math.min(...ys) - hw, Math.max(...ys) + hw);
				for (let i = i0; i <= i1; i++)
					for (let j = j0; j <= j1; j++) {
						const z = rampFaceZ(r, this.x0 + i * NAV_CELL, this.y0 + j * NAV_CELL);
						if (z !== null) add(i + this.nx * j, z);
					}
			}
		}
		for (const [k, zs] of cand) {
			zs.sort((a, c) => a - c);
			const i = k % this.nx;
			const j = Math.floor(k / this.nx);
			const x = this.x0 + i * NAV_CELL;
			const y = this.y0 + j * NAV_CELL;
			let last = -Infinity;
			for (const z0 of zs) {
				if (z0 - last < 0.5) continue;
				last = z0;
				const n = this.makeNode(x, y, z0, false);
				if (n) this.push(n, k);
			}
		}
		for (const p of opts.extras) {
			const n = this.makeNode(p.x, p.y, p.z, true);
			this.extraNodes.push(n ? this.push(n, null) : -1);
		}
		for (const t of opts.teleports) {
			const n = this.makeNode(t.dest.pos.x, t.dest.pos.y, t.dest.pos.z, true);
			this.destNodes.push(n ? this.push(n, null) : -1);
		}
		// Teleport entries: a point at each zone's centre, on the floor under it.
		for (const t of opts.teleports) {
			const c = { x: (t.min.x + t.max.x) / 2, y: (t.min.y + t.max.y) / 2, z: t.min.z + 1 };
			const tr = this.trace(c, { x: c.x, y: c.y, z: t.min.z - 64 }, DUCK_HULL_MAX);
			const n = tr.fraction < 1 && !tr.startsolid ? this.makeNode(c.x, c.y, tr.endpos.z - CLEAR / 8, true) : null;
			this.entryNodes.push(n ? this.push(n, null) : -1);
		}
	}

	private colRange(ax: number, bx: number, ay: number, by: number): [number, number, number, number] {
		// Columns whose hull square (centre ± 16) overlaps [ax, bx] × [ay, by] with positive area.
		const i0 = Math.max(0, Math.floor((ax - 16 - this.x0) / NAV_CELL) + 1);
		const i1 = Math.min(this.nx - 1, Math.ceil((bx + 16 - this.x0) / NAV_CELL) - 1);
		const j0 = Math.max(0, Math.floor((ay - 16 - this.y0) / NAV_CELL) + 1);
		const j1 = Math.min(this.ny - 1, Math.ceil((by + 16 - this.y0) / NAV_CELL) - 1);
		return [i0, i1, j0, j1];
	}

	private trace(a: Vec3, b: Vec3, maxs: Vec3) {
		this.traces++;
		return this.world.trace(a, b, HULL_MIN, maxs);
	}

	/** A valid node at floor z (feet z + 0.25), or null. Ramps: settle with a short drop. */
	private makeNode(x: number, y: number, floorZ: number, extra: boolean): NavNode | null {
		let p = { x, y, z: floorZ + CLEAR };
		if (this.trace(p, p, DUCK_HULL_MAX).startsolid) {
			// Sloped floor: the hull rests on the uphill edge; settle from up to 16 above.
			const up = { x, y, z: floorZ + 16 };
			if (this.trace(up, up, DUCK_HULL_MAX).startsolid) return null;
			const t = this.trace(up, { x, y, z: floorZ - 4 }, DUCK_HULL_MAX);
			if (t.fraction === 1 || t.plane.normal.z < 0.7) return null;
			p = { x, y, z: t.endpos.z + CLEAR / 2 };
			if (this.trace(p, p, DUCK_HULL_MAX).startsolid) return null;
		}
		const down = this.trace(p, { x, y, z: p.z - 2 }, DUCK_HULL_MAX);
		if (down.fraction === 1 || down.plane.normal.z < 0.7) return null;
		const stand = !this.trace(p, p, HULL_MAX).startsolid;
		let tp = -1;
		this.opts.teleports.forEach((t, i) => {
			if (tp < 0 && x - 16 < t.max.x && x + 16 > t.min.x && y - 16 < t.max.y && y + 16 > t.min.y && p.z < t.max.z && p.z + DUCK_HULL_MAX.z > t.min.z) tp = i;
		});
		return { x, y, z: p.z, stand, tp, extra };
	}

	private push(n: NavNode, k: number | null): number {
		const id = this.nodes.length;
		this.nodes.push(n);
		if (k !== null) {
			let l = this.cols.get(k);
			if (!l) this.cols.set(k, (l = []));
			l.push(id);
		}
		return id;
	}

	private colAt(x: number, y: number): number | null {
		const i = Math.round((x - this.x0) / NAV_CELL);
		const j = Math.round((y - this.y0) / NAV_CELL);
		if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return null;
		return i + this.nx * j;
	}

	/** Box path a → b: lift (hull `up` for the first `l1` units, then `mid`), across with `mid`, down to b. */
	private boxPath(a: NavNode, b: NavNode, l1: number, l2: number, up: Vec3, mid: Vec3): boolean {
		const top = a.z + l1 + l2;
		if (b.z > top + 1e-6) return false;
		const p0 = { x: a.x, y: a.y, z: a.z };
		if (l1 > 0) {
			const t = this.trace(p0, { x: a.x, y: a.y, z: a.z + l1 }, up);
			if (t.startsolid || t.fraction < 1) return false;
		}
		if (l2 > 0) {
			const t = this.trace({ x: a.x, y: a.y, z: a.z + l1 }, { x: a.x, y: a.y, z: top }, mid);
			if (t.startsolid || t.fraction < 1) return false;
		}
		const t2 = this.trace({ x: a.x, y: a.y, z: top }, { x: b.x, y: b.y, z: top }, mid);
		if (t2.startsolid || t2.fraction < 1) return false;
		if (top > b.z) {
			const t3 = this.trace({ x: b.x, y: b.y, z: top }, { x: b.x, y: b.y, z: b.z }, mid);
			if (t3.startsolid || t3.fraction < 1) return false;
		}
		return true;
	}

	/** Can a player at a get to b (one move)? Returns the move kind or null. */
	move(a: NavNode, b: NavNode): 'walk' | 'jump' | 'cjump' | 'djump' | null {
		const d = Math.hypot(b.x - a.x, b.y - a.y);
		const dz = b.z - a.z;
		if (d <= (a.extra || b.extra ? 64 : 48) && dz <= STEP && this.boxPath(a, b, Math.max(0, dz), 0, DUCK_HULL_MAX, DUCK_HULL_MAX)) return 'walk';
		if (a.stand) {
			if (dz <= JUMP && d <= (dz <= 0 ? 96 : 64) && this.boxPath(a, b, JUMP, 0, HULL_MAX, DUCK_HULL_MAX)) return 'jump';
			if (dz > JUMP - 8 && dz <= CJUMP && d <= 48 && this.boxPath(a, b, JUMP, CJUMP - JUMP, HULL_MAX, DUCK_HULL_MAX)) return 'cjump';
		}
		if (dz <= DJUMP && d <= (a.stand ? 48 : 64) && this.boxPath(a, b, DJUMP, 0, DUCK_HULL_MAX, DUCK_HULL_MAX)) return 'djump';
		return null;
	}

	/** Candidate targets of node a: nearby column nodes (and extras near a). */
	private candidates(id: number): number[] {
		const a = this.nodes[id]!;
		const out: number[] = [];
		const pick = (k: number | null, maxRise: number) => {
			if (k === null) return;
			const l = this.cols.get(k);
			if (!l) return;
			let below = -1;
			for (const n of l) {
				const dz = this.nodes[n]!.z - a.z;
				if (dz > maxRise) continue;
				if (dz >= -STEP) out.push(n);
				else below = n; // highest node more than a step below
			}
			if (below >= 0) out.push(below);
		};
		if (a.extra) {
			for (let dx = -64; dx <= 64; dx += NAV_CELL)
				for (let dy = -64; dy <= 64; dy += NAV_CELL) {
					const cx = Math.round((a.x + dx - this.x0) / NAV_CELL) * NAV_CELL + this.x0;
					const cy = Math.round((a.y + dy - this.y0) / NAV_CELL) * NAV_CELL + this.y0;
					if (Math.hypot(cx - a.x, cy - a.y) <= 64) pick(this.colAt(cx, cy), CJUMP);
				}
			for (const e of this.extraIds()) {
				const n = this.nodes[e]!;
				if (Math.hypot(n.x - a.x, n.y - a.y) <= 64 && n.z - a.z <= CJUMP) out.push(e);
			}
			return [...new Set(out)];
		}
		for (const [ux, uy] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1]
		] as const) {
			pick(this.colAt(a.x + ux * NAV_CELL, a.y + uy * NAV_CELL), CJUMP);
			pick(this.colAt(a.x + ux * 2 * NAV_CELL, a.y + uy * 2 * NAV_CELL), JUMP);
			pick(this.colAt(a.x + ux * 3 * NAV_CELL, a.y + uy * 3 * NAV_CELL), 0);
		}
		// Extras within reach (spots inside props, destinations).
		for (const e of this.extraIds()) {
			const n = this.nodes[e]!;
			if (Math.hypot(n.x - a.x, n.y - a.y) <= 64 && n.z - a.z <= CJUMP && n.z - a.z >= -400) out.push(e);
		}
		return out;
	}

	private extraCache: number[] | null = null;
	private extraIds(): number[] {
		if (!this.extraCache) this.extraCache = this.nodes.map((n, i) => (n.extra ? i : -1)).filter((i) => i >= 0);
		return this.extraCache;
	}

	/** Outgoing edges [target, length] (teleport nodes lead to their destination only). */
	edges(id: number): Array<[number, number]> {
		let e = this.adj.get(id);
		if (e) return e;
		e = [];
		const a = this.nodes[id]!;
		if (a.tp >= 0) {
			const d = this.destNodes[a.tp]!;
			if (d >= 0) e.push([d, -1]);
		} else {
			for (const n of this.candidates(id)) {
				if (n === id) continue;
				const b = this.nodes[n]!;
				if (this.move(a, b)) e.push([n, Math.hypot(b.x - a.x, b.y - a.y)]);
			}
		}
		this.adj.set(id, e);
		return e;
	}

	/** Breadth-first reachable set from `sources`. */
	reach(sources: number[]): Uint8Array {
		const seen = new Uint8Array(this.nodes.length);
		const q: number[] = [];
		for (const s of sources) if (s >= 0 && !seen[s]) (seen[s] = 1), q.push(s);
		for (let h = 0; h < q.length; h++) for (const [n] of this.edges(q[h]!)) if (!seen[n]) (seen[n] = 1), q.push(n);
		return seen;
	}

	/** Nodes (among `within`) that can reach `targets`: reverse search over the computed edges. */
	coReach(targets: number[], within: Uint8Array): Uint8Array {
		const rev = new Map<number, number[]>();
		for (let i = 0; i < this.nodes.length; i++) {
			if (!within[i]) continue;
			for (const [n] of this.edges(i)) {
				let l = rev.get(n);
				if (!l) rev.set(n, (l = []));
				l.push(i);
			}
		}
		const seen = new Uint8Array(this.nodes.length);
		const q: number[] = [];
		for (const t of targets) if (t >= 0) (seen[t] = 1), q.push(t);
		for (let h = 0; h < q.length; h++) for (const p of rev.get(q[h]!) ?? []) if (!seen[p]) (seen[p] = 1), q.push(p);
		return seen;
	}

	/** Shortest horizontal path lengths from `src` without teleports (Dijkstra). */
	distances(src: number): Float64Array {
		const dist = new Float64Array(this.nodes.length).fill(Infinity);
		dist[src] = 0;
		// Binary heap of [d, id].
		const h: Array<[number, number]> = [[0, src]];
		const pushH = (d: number, i: number) => {
			h.push([d, i]);
			let c = h.length - 1;
			while (c > 0) {
				const p = (c - 1) >> 1;
				if (h[p]![0] <= h[c]![0]) break;
				[h[p], h[c]] = [h[c]!, h[p]!];
				c = p;
			}
		};
		const popH = (): [number, number] => {
			const top = h[0]!;
			const last = h.pop()!;
			if (h.length) {
				h[0] = last;
				let c = 0;
				for (;;) {
					const l = 2 * c + 1;
					const r = l + 1;
					let m = c;
					if (l < h.length && h[l]![0] < h[m]![0]) m = l;
					if (r < h.length && h[r]![0] < h[m]![0]) m = r;
					if (m === c) break;
					[h[m], h[c]] = [h[c]!, h[m]!];
					c = m;
				}
			}
			return top;
		};
		while (h.length) {
			const [d, i] = popH();
			if (d > dist[i]!) continue;
			for (const [n, w] of this.edges(i)) {
				if (w < 0) continue;
				const nd = d + w;
				if (nd < dist[n]!) {
					dist[n] = nd;
					pushH(nd, n);
				}
			}
		}
		return dist;
	}
}
