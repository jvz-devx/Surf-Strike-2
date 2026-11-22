/**
 * Building blocks for open (tag) maps: stairs, crate stacks, buildings with
 * roofs on pillars. Pure coordinate helpers like ./helpers.ts; every brush is
 * an axis-aligned box. Hammer units, Z up.
 */
import type { Vec3 } from '../types.ts';
import { box, v3, type Box3, type BoxBrush } from './helpers.ts';

export type AxisDir = '+x' | '-x' | '+y' | '-y';

export interface StairsOpts {
	/** Centre of the foot edge (outer edge of the lowest step), at floor level. */
	foot: { x: number; y: number };
	/** Direction the stairs climb towards. */
	dir: AxisDir;
	steps: number;
	/** Width across the climbing direction. */
	width: number;
	/** Height gained per step (≤ 18 to walk up, ≤ 55 to jump up). */
	rise: number;
	/** Depth of each step along the climbing direction. */
	run: number;
	/** Floor height the stairs stand on. */
	z0?: number;
	material: string;
}

/**
 * A flight of solid steps: step k covers run segment [k, k+1] from the foot
 * along `dir` and rises from z0 to z0 + rise·(k+1). Steps touch each other
 * (no overlap), so the last step's far face is where the target wall goes.
 */
export function stairs(o: StairsOpts): BoxBrush[] {
	const z0 = o.z0 ?? 0;
	const out: BoxBrush[] = [];
	const sign = o.dir[0] === '+' ? 1 : -1;
	const axis = o.dir[1] as 'x' | 'y';
	const hw = o.width / 2;
	for (let k = 0; k < o.steps; k++) {
		const a = (axis === 'x' ? o.foot.x : o.foot.y) + sign * o.run * k;
		const b = a + sign * o.run;
		const top = z0 + o.rise * (k + 1);
		out.push(
			axis === 'x'
				? box(v3(a, o.foot.y - hw, z0), v3(b, o.foot.y + hw, top), o.material)
				: box(v3(o.foot.x - hw, a, z0), v3(o.foot.x + hw, b, top), o.material)
		);
	}
	return out;
}

/** Axis-aligned box from XY extents and a z range. */
export function block(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: string): BoxBrush {
	return box(v3(x0, y0, z0), v3(x1, y1, z1), material);
}

/** Square pillar of side `size` centred on (x, y). */
export function pillar(x: number, y: number, size: number, z0: number, z1: number, material: string): BoxBrush {
	return block(x - size / 2, x + size / 2, y - size / 2, y + size / 2, z0, z1, material);
}

/**
 * Open hall: a roof slab over `foot` carried by square pillars at its corners
 * (inside the footprint) and optionally at the middle of the long sides.
 * Returns the roof first.
 */
export function hall(
	foot: { x0: number; x1: number; y0: number; y1: number },
	roofBottom: number,
	roofTop: number,
	pillarSize: number,
	material: { roof: string; pillar: string },
	midPillars = true
): BoxBrush[] {
	const { x0, x1, y0, y1 } = foot;
	const s = pillarSize;
	const roof = block(x0, x1, y0, y1, roofBottom, roofTop, material.roof);
	const out = [roof];
	const xs = midPillars && x1 - x0 >= y1 - y0 ? [x0, (x0 + x1) / 2 - s / 2, x1 - s] : [x0, x1 - s];
	const ys = midPillars && y1 - y0 > x1 - x0 ? [y0, (y0 + y1) / 2 - s / 2, y1 - s] : [y0, y1 - s];
	for (const px of xs)
		for (const py of ys) {
			const edge = px === x0 || px === x1 - s || py === y0 || py === y1 - s;
			if (edge) out.push(block(px, px + s, py, py + s, 0, roofBottom, material.pillar));
		}
	return out;
}

/** Yaw (degrees, rounded) from `p` towards `target` in the XY plane. */
export function yawTowards(p: Vec3, target: { x: number; y: number }): number {
	return Math.round((Math.atan2(target.y - p.y, target.x - p.x) * 180) / Math.PI);
}

/**
 * A climb route: walkable/jumpable surfaces in order. Each consecutive pair
 * must touch (or overlap) in XY, and the rise to the next top must be within
 * the route's limit (`step` ≤ sv_stepsize, `jump` ≤ standing jump height).
 */
export interface ClimbRoute {
	label: string;
	how: 'step' | 'jump';
	surfaces: Box3[];
}

/**
 * A bhop line: take-off/landing surfaces in order (first and last are usually
 * a rooftop or the ground; the ones in between are 128 × 128 blocks).
 */
export interface BhopChain {
	label: string;
	nodes: Box3[];
}
