/**
 * The zombie route of a zombies map (MapDef.zombies.path): an ordered
 * polyline of waypoints from the start to the evac point. Progress along it
 * ("s", units from the first waypoint) measures how far the team got and
 * steers zombies towards players along the route.
 */
import type { Vec3 } from '../../types.ts';

export class ZombiePath {
	readonly nodes: readonly Vec3[];
	/** Distance along the path at each node. */
	readonly cum: readonly number[];
	readonly length: number;

	constructor(nodes: readonly Vec3[]) {
		if (nodes.length < 2) throw new Error('zombie path needs at least 2 nodes');
		this.nodes = nodes;
		const cum = [0];
		for (let i = 1; i < nodes.length; i++) {
			const a = nodes[i - 1]!;
			const b = nodes[i]!;
			cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
		}
		this.cum = cum;
		this.length = cum[cum.length - 1]!;
	}

	/** Progress of the point on the path closest to (x, y, z) (XY distance, z as a tie-breaker). */
	project(x: number, y: number, z = 0): number {
		let best = Infinity;
		let bestS = 0;
		const n = this.nodes;
		for (let i = 0; i + 1 < n.length; i++) {
			const a = n[i]!;
			const b = n[i + 1]!;
			const ex = b.x - a.x;
			const ey = b.y - a.y;
			const len2 = ex * ex + ey * ey;
			let t = len2 > 0 ? ((x - a.x) * ex + (y - a.y) * ey) / len2 : 0;
			t = t < 0 ? 0 : t > 1 ? 1 : t;
			const px = a.x + ex * t;
			const py = a.y + ey * t;
			const pz = a.z + (b.z - a.z) * t;
			const d = (x - px) ** 2 + (y - py) ** 2 + 0.25 * (z - pz) ** 2;
			if (d < best) {
				best = d;
				bestS = this.cum[i]! + (this.cum[i + 1]! - this.cum[i]!) * t;
			}
		}
		return bestS;
	}

	/** Index of the segment containing progress `s` (0 .. nodes - 2). */
	segmentAt(s: number): number {
		const c = this.cum;
		for (let i = 1; i < c.length; i++) if (s <= c[i]!) return i - 1;
		return c.length - 2;
	}

	/** Point at progress `s` (clamped to the path). */
	pointAt(s: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
		const c = this.cum;
		if (s <= 0) return Object.assign(out, this.nodes[0]!);
		if (s >= this.length) return Object.assign(out, this.nodes[this.nodes.length - 1]!);
		const i = this.segmentAt(s);
		const a = this.nodes[i]!;
		const b = this.nodes[i + 1]!;
		const span = c[i + 1]! - c[i]!;
		const t = span > 0 ? (s - c[i]!) / span : 0;
		out.x = a.x + (b.x - a.x) * t;
		out.y = a.y + (b.y - a.y) * t;
		out.z = a.z + (b.z - a.z) * t;
		return out;
	}
}
