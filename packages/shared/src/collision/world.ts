import type { MapDef } from '../maps/types.ts';
import type { Plane, Vec3 } from '../types.ts';
import type { CollisionWorld, Solid, Trace } from './api.ts';
import { buildSolid } from './brush.ts';
import { clipBoxToSolid, type TraceWork } from './trace.ts';

/** Broadphase cell size in units. */
const GRID_CELL = 256;

/** Build all solids and a uniform-grid broadphase; trace returns the nearest hit across brushes. */
export function buildCollisionWorld(map: Pick<MapDef, 'brushes'>): CollisionWorld {
	const solids: Solid[] = map.brushes.map((b) => buildSolid(b));
	const n = solids.length;

	// Grid origin / dimensions over all brush bounds.
	let gx0 = 0,
		gy0 = 0,
		gz0 = 0,
		nx = 1,
		ny = 1,
		nz = 1;
	if (n > 0) {
		let x0 = Infinity,
			y0 = Infinity,
			z0 = Infinity,
			x1 = -Infinity,
			y1 = -Infinity,
			z1 = -Infinity;
		for (const s of solids) {
			x0 = Math.min(x0, s.bounds.min.x);
			y0 = Math.min(y0, s.bounds.min.y);
			z0 = Math.min(z0, s.bounds.min.z);
			x1 = Math.max(x1, s.bounds.max.x);
			y1 = Math.max(y1, s.bounds.max.y);
			z1 = Math.max(z1, s.bounds.max.z);
		}
		gx0 = Math.floor(x0 / GRID_CELL);
		gy0 = Math.floor(y0 / GRID_CELL);
		gz0 = Math.floor(z0 / GRID_CELL);
		nx = Math.floor(x1 / GRID_CELL) - gx0 + 1;
		ny = Math.floor(y1 / GRID_CELL) - gy0 + 1;
		nz = Math.floor(z1 / GRID_CELL) - gz0 + 1;
	}
	const cells = new Map<number, number[]>();
	const key = (ix: number, iy: number, iz: number) => ix + nx * (iy + ny * iz);
	for (let i = 0; i < n; i++) {
		const b = solids[i]!.bounds;
		const ix0 = Math.floor(b.min.x / GRID_CELL) - gx0,
			ix1 = Math.floor(b.max.x / GRID_CELL) - gx0;
		const iy0 = Math.floor(b.min.y / GRID_CELL) - gy0,
			iy1 = Math.floor(b.max.y / GRID_CELL) - gy0;
		const iz0 = Math.floor(b.min.z / GRID_CELL) - gz0,
			iz1 = Math.floor(b.max.z / GRID_CELL) - gz0;
		for (let iz = iz0; iz <= iz1; iz++)
			for (let iy = iy0; iy <= iy1; iy++)
				for (let ix = ix0; ix <= ix1; ix++) {
					const k = key(ix, iy, iz);
					let list = cells.get(k);
					if (!list) cells.set(k, (list = []));
					list.push(i);
				}
	}

	const stamps = new Uint32Array(n);
	let stamp = 0;
	const tw: TraceWork = { fraction: 1, plane: null, startsolid: false, allsolid: false };

	function test(i: number, start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3, bx0: number, by0: number, bz0: number, bx1: number, by1: number, bz1: number) {
		if (stamps[i] === stamp) return;
		stamps[i] = stamp;
		const s = solids[i]!;
		const b = s.bounds;
		if (b.min.x > bx1 || b.max.x < bx0 || b.min.y > by1 || b.max.y < by0 || b.min.z > bz1 || b.max.z < bz0) return;
		clipBoxToSolid(tw, s, start, end, mins, maxs);
	}

	function trace(start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3): Trace {
		tw.fraction = 1;
		tw.plane = null;
		tw.startsolid = false;
		tw.allsolid = false;
		if (n > 0) {
			stamp = (stamp + 1) >>> 0;
			if (stamp === 0) {
				stamps.fill(0);
				stamp = 1;
			}
			// Swept box bounds, padded by one unit for the epsilon logic.
			const bx0 = Math.min(start.x, end.x) + mins.x - 1;
			const by0 = Math.min(start.y, end.y) + mins.y - 1;
			const bz0 = Math.min(start.z, end.z) + mins.z - 1;
			const bx1 = Math.max(start.x, end.x) + maxs.x + 1;
			const by1 = Math.max(start.y, end.y) + maxs.y + 1;
			const bz1 = Math.max(start.z, end.z) + maxs.z + 1;
			const ix0 = Math.max(0, Math.floor(bx0 / GRID_CELL) - gx0);
			const iy0 = Math.max(0, Math.floor(by0 / GRID_CELL) - gy0);
			const iz0 = Math.max(0, Math.floor(bz0 / GRID_CELL) - gz0);
			const ix1 = Math.min(nx - 1, Math.floor(bx1 / GRID_CELL) - gx0);
			const iy1 = Math.min(ny - 1, Math.floor(by1 / GRID_CELL) - gy0);
			const iz1 = Math.min(nz - 1, Math.floor(bz1 / GRID_CELL) - gz0);
			if (ix0 <= ix1 && iy0 <= iy1 && iz0 <= iz1) {
				const cellCount = (ix1 - ix0 + 1) * (iy1 - iy0 + 1) * (iz1 - iz0 + 1);
				if (cellCount > n) {
					// Very long trace: testing every brush is cheaper than walking cells.
					for (let i = 0; i < n; i++) test(i, start, end, mins, maxs, bx0, by0, bz0, bx1, by1, bz1);
				} else {
					for (let iz = iz0; iz <= iz1; iz++)
						for (let iy = iy0; iy <= iy1; iy++)
							for (let ix = ix0; ix <= ix1; ix++) {
								const list = cells.get(key(ix, iy, iz));
								if (!list) continue;
								for (let j = 0; j < list.length; j++)
									test(list[j]!, start, end, mins, maxs, bx0, by0, bz0, bx1, by1, bz1);
							}
				}
			}
		}
		const f = tw.fraction;
		const p = tw.plane as Plane | null;
		return {
			fraction: f,
			endpos:
				f === 1
					? { x: end.x, y: end.y, z: end.z }
					: {
							x: start.x + f * (end.x - start.x),
							y: start.y + f * (end.y - start.y),
							z: start.z + f * (end.z - start.z)
						},
			plane: p && f < 1 ? { normal: { ...p.normal }, dist: p.dist } : { normal: { x: 0, y: 0, z: 0 }, dist: 0 },
			startsolid: tw.startsolid,
			allsolid: tw.allsolid
		};
	}

	return { solids, trace };
}
