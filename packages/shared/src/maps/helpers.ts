/**
 * Builder and geometry helpers for map modules. Maps are plain data; these
 * functions only compute coordinates so the map files stay readable.
 * Hammer units, Z up, yaw in degrees (0 = +X, 90 = +Y).
 */
import { buildSolid } from '../collision/brush.ts';
import type { Vec3 } from '../types.ts';
import type { BrushDef, Spawn, Zone } from './types.ts';

export type BoxBrush = Extract<BrushDef, { type: 'box' }>;
export type RampBrush = Extract<BrushDef, { type: 'ramp' }>;
export interface Box3 {
	min: Vec3;
	max: Vec3;
}

const DEG = Math.PI / 180;

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Unit XY direction for a yaw in degrees (snapped to exact values on axes). */
export function dirXY(yaw: number): { x: number; y: number } {
	const r = yaw * DEG;
	const snap = (n: number) => (Math.abs(n) < 1e-12 ? 0 : Math.abs(Math.abs(n) - 1) < 1e-12 ? Math.sign(n) : n);
	return { x: snap(Math.cos(r)), y: snap(Math.sin(r)) };
}

/** Point `dist` units from `p` along `yaw` (horizontal), with an optional height change. */
export function along(p: Vec3, yaw: number, dist: number, dz = 0): Vec3 {
	const d = dirXY(yaw);
	return v3(p.x + d.x * dist, p.y + d.y * dist, p.z + dz);
}

/** Point offset sideways from `p`: positive = to the left of `yaw`. */
export function sideways(p: Vec3, yaw: number, dist: number, dz = 0): Vec3 {
	return along(p, yaw + 90, dist, dz);
}

// ---------------------------------------------------------------------------
// Brushes

export function box(min: Vec3, max: Vec3, material: string): BoxBrush {
	return {
		type: 'box',
		min: v3(Math.min(min.x, max.x), Math.min(min.y, max.y), Math.min(min.z, max.z)),
		max: v3(Math.max(min.x, max.x), Math.max(min.y, max.y), Math.max(min.z, max.z)),
		material
	};
}

/** Flat platform: `top` is the centre of its top face, size sx × sy, hanging `thickness` down. */
export function platform(top: Vec3, sx: number, sy: number, material: string, thickness = 64): BoxBrush {
	return box(
		v3(top.x - sx / 2, top.y - sy / 2, top.z - thickness),
		v3(top.x + sx / 2, top.y + sy / 2, top.z),
		material
	);
}

/** Axis-aligned wall along the segment a→b (must be parallel to X or Y). */
export function wall(
	a: { x: number; y: number },
	b: { x: number; y: number },
	zMin: number,
	zMax: number,
	material: string,
	thickness = 32
): BoxBrush {
	const t = thickness / 2;
	if (a.x !== b.x && a.y !== b.y) throw new Error('wall() must be axis-aligned');
	return a.y === b.y
		? box(v3(a.x, a.y - t, zMin), v3(b.x, b.y + t, zMax), material)
		: box(v3(a.x - t, a.y, zMin), v3(b.x + t, b.y, zMax), material);
}

export interface RampOpts {
	from: Vec3;
	to: Vec3;
	/** Slope angle from horizontal, degrees. */
	angle: number;
	/** Give either halfWidth or height; the other follows from the angle. */
	halfWidth?: number;
	height?: number;
	side: RampBrush['side'];
	material: string;
}

/** One surf ramp prism (see BrushDef 'ramp'). */
export function ramp(o: RampOpts): RampBrush {
	const t = Math.tan(o.angle * DEG);
	let halfWidth: number;
	let height: number;
	if (o.halfWidth !== undefined) {
		halfWidth = o.halfWidth;
		height = o.halfWidth * t;
	} else if (o.height !== undefined) {
		height = o.height;
		halfWidth = o.height / t;
	} else throw new Error('ramp() needs halfWidth or height');
	return {
		type: 'ramp',
		from: o.from,
		to: o.to,
		height: round3(height),
		halfWidth: round3(halfWidth),
		side: o.side,
		material: o.material
	};
}

/**
 * A surf "V": two single-sided ramps facing each other so their base edges
 * meet on the centre line. `from`/`to` are the centre line at peak height.
 * `gap` (default 0) opens the V: the base edges stay `gap` apart, so a player
 * who stops surfing falls through the middle instead of sliding down a closed
 * crease. The peak lines stay `halfWidth` from the centre line.
 * Returns [left ramp, right ramp] as seen looking from → to.
 */
export function surfV(o: {
	from: Vec3;
	to: Vec3;
	angle: number;
	halfWidth: number;
	gap?: number;
	material: string;
}): [RampBrush, RampBrush] {
	const f = rampFrameXY(o.from, o.to);
	const off = (p: Vec3, s: number) => v3(p.x + f.left.x * s, p.y + f.left.y * s, p.z);
	const hw = o.halfWidth;
	const rw = hw - (o.gap ?? 0) / 2;
	return [
		ramp({ from: off(o.from, hw), to: off(o.to, hw), angle: o.angle, halfWidth: rw, side: 'right', material: o.material }),
		ramp({ from: off(o.from, -hw), to: off(o.to, -hw), angle: o.angle, halfWidth: rw, side: 'left', material: o.material })
	];
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Zones

/** Zone box over a platform: same XY (plus pad), from just under its top to `height` above. */
export function zoneOver(b: Box3, height = 256, pad = 0): Box3 {
	return {
		min: v3(b.min.x - pad, b.min.y - pad, b.max.z - 16),
		max: v3(b.max.x + pad, b.max.y + pad, b.max.z + height)
	};
}

/** Centre of a box's top face. */
export function topCenter(b: Box3): Vec3 {
	return v3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z);
}

export function startZone(b: Box3): Zone {
	return { type: 'start', min: b.min, max: b.max };
}

export function endZone(b: Box3): Zone {
	return { type: 'end', min: b.min, max: b.max };
}

export function stageZone(index: number, b: Box3, respawn: Spawn): Zone {
	return { type: 'stage', index, min: b.min, max: b.max, respawn };
}

export function checkpointZone(index: number, b: Box3, respawn: Spawn): Zone {
	return { type: 'checkpoint', index, min: b.min, max: b.max, respawn };
}

/**
 * Teleport trigger under the whole map: covers every brush's XY bounds plus
 * `margin`, reaching from `floorZ - depth` up to `floorZ`.
 */
export function teleportBelow(brushes: BrushDef[], floorZ: number, to: 'stage' | 'start', margin = 4096, depth = 4096): Zone {
	const b = boundsOf(brushes);
	return {
		type: 'teleport',
		min: v3(b.min.x - margin, b.min.y - margin, floorZ - depth),
		max: v3(b.max.x + margin, b.max.y + margin, floorZ),
		to
	};
}

// ---------------------------------------------------------------------------
// Geometry analysis (used by map builders and tests)

export interface RampFrame {
	dir: { x: number; y: number };
	left: { x: number; y: number };
	length: number;
}

function rampFrameXY(from: Vec3, to: Vec3): RampFrame {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	const dir = { x: dx / length, y: dy / length };
	return { dir, left: { x: -dir.y, y: dir.x }, length };
}

export function rampFrame(r: RampBrush): RampFrame {
	return rampFrameXY(r.from, r.to);
}

/** Slope angle of a ramp's face(s) from horizontal, degrees. */
export function rampAngle(r: RampBrush): number {
	return Math.atan2(r.height, r.halfWidth) / DEG;
}

/** Face signs: +1 = left face, -1 = right face. */
export function rampFaceSigns(r: RampBrush): number[] {
	return r.side === 'both' ? [1, -1] : r.side === 'left' ? [1] : [-1];
}

/** The prism's corner vertices. */
export function rampVertices(r: RampBrush): Vec3[] {
	const f = rampFrame(r);
	const out: Vec3[] = [];
	for (const e of [r.from, r.to]) {
		out.push(e);
		const base = e.z - r.height;
		if (r.side !== 'both') out.push(v3(e.x, e.y, base));
		for (const s of rampFaceSigns(r)) {
			out.push(v3(e.x + f.left.x * s * r.halfWidth, e.y + f.left.y * s * r.halfWidth, base));
		}
	}
	return out;
}

export function brushBounds(b: BrushDef): Box3 {
	if (b.type === 'box') return { min: b.min, max: b.max };
	if (b.type === 'ramp') {
		const vs = rampVertices(b);
		return {
			min: v3(Math.min(...vs.map((p) => p.x)), Math.min(...vs.map((p) => p.y)), Math.min(...vs.map((p) => p.z))),
			max: v3(Math.max(...vs.map((p) => p.x)), Math.max(...vs.map((p) => p.y)), Math.max(...vs.map((p) => p.z)))
		};
	}
	// Convex brushes (e.g. rotated walls from surf-obstacles.ts): bounds of their vertices.
	const sb = buildSolid(b).bounds;
	return { min: v3(sb.min.x, sb.min.y, sb.min.z), max: v3(sb.max.x, sb.max.y, sb.max.z) };
}

export function boundsOf(brushes: BrushDef[]): Box3 {
	const bs = brushes.map(brushBounds);
	return {
		min: v3(Math.min(...bs.map((b) => b.min.x)), Math.min(...bs.map((b) => b.min.y)), Math.min(...bs.map((b) => b.min.z))),
		max: v3(Math.max(...bs.map((b) => b.max.x)), Math.max(...bs.map((b) => b.max.y)), Math.max(...bs.map((b) => b.max.z)))
	};
}

/**
 * Height of the ramp's sloped surface above (x, y), or null when the point is
 * outside the faces' footprint.
 */
export function rampFaceZ(r: RampBrush, x: number, y: number): number | null {
	const f = rampFrame(r);
	const px = x - r.from.x;
	const py = y - r.from.y;
	const s = px * f.dir.x + py * f.dir.y;
	if (s < 0 || s > f.length) return null;
	const lat = px * f.left.x + py * f.left.y;
	const peak = r.from.z + ((r.to.z - r.from.z) * s) / f.length;
	for (const sign of rampFaceSigns(r)) {
		const d = lat * sign;
		if (d >= 0 && d <= r.halfWidth) return peak - (r.height * d) / r.halfWidth;
	}
	return null;
}

/** Typical exit points: the middle of each sloped face at the `to` end. */
export function rampExits(r: RampBrush): Vec3[] {
	const f = rampFrame(r);
	return rampFaceSigns(r).map((s) =>
		v3(r.to.x + (f.left.x * s * r.halfWidth) / 2, r.to.y + (f.left.y * s * r.halfWidth) / 2, r.to.z - r.height / 2)
	);
}

/** Velocity of `speed` along the ramp's peak line (from → to, including its slope). */
export function rampVelocity(r: RampBrush, speed: number): Vec3 {
	const dx = r.to.x - r.from.x;
	const dy = r.to.y - r.from.y;
	const dz = r.to.z - r.from.z;
	const l = Math.hypot(dx, dy, dz);
	return v3((dx / l) * speed, (dy / l) * speed, (dz / l) * speed);
}

/** Where a ballistic point starting at p with velocity vel crosses height z (on the way down). */
export function landingPoint(p: Vec3, vel: Vec3, z: number, gravity = 800): Vec3 {
	const disc = vel.z * vel.z + 2 * gravity * (p.z - z);
	if (disc < 0) throw new Error('landingPoint: never reaches that height');
	const t = (vel.z + Math.sqrt(disc)) / gravity;
	return v3(p.x + vel.x * t, p.y + vel.y * t, z);
}

/** Horizontal (XY) edge-to-edge distance between two boxes; 0 when they overlap in XY. */
export function gapXY(a: Box3, b: Box3): number {
	const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
	const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
	return Math.hypot(dx, dy);
}

// ---------------------------------------------------------------------------
// Bhop path generator

export type PathKind = 'start' | 'block' | 'strip' | 'checkpoint' | 'end';

export interface PathNode extends Box3 {
	kind: PathKind;
	/** Heading used to reach this node (degrees). */
	yaw: number;
}

export interface PathStep {
	/** Edge-to-edge horizontal gap from the previous node. */
	gap: number;
	/** Heading change before this step, degrees (positive = left). */
	turn?: number;
	/** Top height change relative to the previous node. */
	dz?: number;
	/** Size along the heading and across it (default square `size`). */
	along?: number;
	across?: number;
	kind?: PathKind;
}

/**
 * "Turtle" generator for bhop lines: each step places a box ahead of the
 * previous one (along the current heading) with an exact edge-to-edge gap.
 * Boxes stay axis-aligned; non-square boxes need an axis-aligned heading.
 */
export class BhopPath {
	readonly nodes: PathNode[] = [];
	yaw: number;
	private readonly size: number;
	private readonly thickness: number;

	constructor(first: { top: Vec3; sx: number; sy: number; kind?: PathKind }, yaw: number, size: number, thickness = 64) {
		this.yaw = yaw;
		this.size = size;
		this.thickness = thickness;
		const b = platform(first.top, first.sx, first.sy, '', thickness);
		this.nodes.push({ kind: first.kind ?? 'start', min: b.min, max: b.max, yaw });
	}

	get last(): PathNode {
		return this.nodes[this.nodes.length - 1]!;
	}

	step(s: PathStep): PathNode {
		this.yaw += s.turn ?? 0;
		const alongLen = s.along ?? this.size;
		const acrossLen = s.across ?? this.size;
		const d = dirXY(this.yaw);
		let hx: number;
		let hy: number;
		if (alongLen === acrossLen) {
			hx = hy = alongLen / 2;
		} else if (d.y === 0) {
			hx = alongLen / 2;
			hy = acrossLen / 2;
		} else if (d.x === 0) {
			hx = acrossLen / 2;
			hy = alongLen / 2;
		} else throw new Error('BhopPath: non-square boxes need an axis-aligned heading');

		const prev = this.last;
		const c = topCenter(prev);
		const top = c.z + (s.dz ?? 0);
		const at = (t: number): Box3 => ({
			min: v3(c.x + d.x * t - hx, c.y + d.y * t - hy, top - this.thickness),
			max: v3(c.x + d.x * t + hx, c.y + d.y * t + hy, top)
		});
		// Bisection on centre distance for the requested gap (gap grows monotonically).
		let lo = 0;
		let hi = 100000;
		for (let i = 0; i < 80; i++) {
			const mid = (lo + hi) / 2;
			if (gapXY(prev, at(mid)) < s.gap) lo = mid;
			else hi = mid;
		}
		const b = at(Math.round(hi * 1000) / 1000);
		const node: PathNode = { kind: s.kind ?? (alongLen === acrossLen ? 'block' : 'strip'), min: roundV(b.min), max: roundV(b.max), yaw: this.yaw };
		this.nodes.push(node);
		return node;
	}
}

function roundV(p: Vec3): Vec3 {
	return v3(round3(p.x), round3(p.y), round3(p.z));
}

// ---------------------------------------------------------------------------
// Surf route description (consumed by the map tests' ballistic checks)

/** Where a transfer starts: off the end of a ramp group, or walking off a platform edge. */
export type SurfLaunch = { ramps: RampBrush[] } | { platform: Box3; yaw: number };
/** Where it must land: on any ramp of a group, or on a platform top. */
export type SurfTarget = { ramps: RampBrush[] } | { platform: Box3 };

export interface SurfTransfer {
	label: string;
	from: SurfLaunch;
	to: SurfTarget;
}

export interface TransferResult {
	ok: boolean;
	reason: string;
	start: Vec3;
	/** Contact point (ok) or last simulated point (fail). */
	at: Vec3;
	time: number;
}

/** Start points and velocities of a launch at `speed` (ramp: along its peak line; platform: horizontal). */
export function launchStates(from: SurfLaunch, speed: number): Array<{ p: Vec3; vel: Vec3 }> {
	if ('ramps' in from) {
		return from.ramps.flatMap((r) => rampExits(r).map((p) => ({ p, vel: rampVelocity(r, speed) })));
	}
	// Walk straight off the platform edge from its centre along `yaw`.
	const c = topCenter(from.platform);
	const d = dirXY(from.yaw);
	const hx = (from.platform.max.x - from.platform.min.x) / 2;
	const hy = (from.platform.max.y - from.platform.min.y) / 2;
	const t = Math.min(d.x === 0 ? Infinity : hx / Math.abs(d.x), d.y === 0 ? Infinity : hy / Math.abs(d.y));
	return [{ p: v3(c.x + d.x * t, c.y + d.y * t, c.z), vel: v3(d.x * speed, d.y * speed, 0) }];
}

/**
 * Point-mass ballistic check: from each launch state, the path must come down
 * onto the target surface from above (ramp face or platform top). Entering a
 * target footprint already below its surface means hitting its side/end wall;
 * dropping below every target's base means a miss.
 */
export function simulateTransfer(tr: SurfTransfer, speed: number, gravity = 800): TransferResult[] {
	const dt = 1 / 512;
	return launchStates(tr.from, speed).map(({ p, vel }) => {
		const surfaces: Array<(x: number, y: number) => number | null> =
			'ramps' in tr.to
				? tr.to.ramps.map((r) => (x: number, y: number) => rampFaceZ(r, x, y))
				: [
						((b: Box3) => (x: number, y: number) =>
							x >= b.min.x && x <= b.max.x && y >= b.min.y && y <= b.max.y ? b.max.z : null)(tr.to.platform)
					];
		const floor =
			'ramps' in tr.to ? Math.min(...tr.to.ramps.map((r) => Math.min(r.from.z, r.to.z) - r.height)) : tr.to.platform.max.z;
		const above = surfaces.map(() => false);
		let at = p;
		for (let t = 0; t < 8; t += dt) {
			at = v3(p.x + vel.x * t, p.y + vel.y * t, p.z + vel.z * t - 0.5 * gravity * t * t);
			for (const [i, surf] of surfaces.entries()) {
				const z = surf(at.x, at.y);
				if (z === null) {
					above[i] = false;
					continue;
				}
				if (at.z > z) above[i] = true;
				else if (above[i]) return { ok: true, reason: 'landed', start: p, at, time: t };
				else return { ok: false, reason: 'hit the side/end of the target', start: p, at, time: t };
			}
			if (at.z < floor - 1) return { ok: false, reason: 'fell below the target', start: p, at, time: t };
		}
		return { ok: false, reason: 'timeout', start: p, at, time: 8 };
	});
}

/**
 * Brushes and zones for a bhop path: 'start' gets the start zone, each
 * 'checkpoint' the next checkpoint zone (respawn at its centre facing the
 * heading), and the 'end' platform is split along its heading into a final
 * checkpoint zone (near part) and a separate end zone (far part).
 */
export function bhopLayout(
	nodes: PathNode[],
	material: (node: PathNode, i: number) => string,
	zoneHeight = 192
): { brushes: BoxBrush[]; zones: Zone[]; spawn: Spawn } {
	const brushes = nodes.map((n, i) => box(n.min, n.max, material(n, i)));
	const zones: Zone[] = [];
	let cp = 0;
	let spawn: Spawn | undefined;
	for (const n of nodes) {
		if (n.kind === 'start') {
			zones.push(startZone(zoneOver(n, zoneHeight)));
			spawn = { pos: topCenter(n), yaw: n.yaw };
		} else if (n.kind === 'checkpoint') {
			zones.push(checkpointZone(++cp, zoneOver(n, zoneHeight), { pos: topCenter(n), yaw: n.yaw }));
		} else if (n.kind === 'end') {
			const d = dirXY(n.yaw);
			if (d.x !== 0 && d.y !== 0) throw new Error('bhopLayout: end platform needs an axis-aligned heading');
			const z = zoneOver(n, zoneHeight);
			const ax = d.x !== 0 ? 'x' : 'y';
			const len = z.max[ax] - z.min[ax];
			const part = Math.min(384, len / 3);
			const near = { min: { ...z.min }, max: { ...z.max } };
			const far = { min: { ...z.min }, max: { ...z.max } };
			if ((d.x || d.y) > 0) {
				near.max[ax] = z.min[ax] + part;
				far.min[ax] = z.max[ax] - part;
			} else {
				near.min[ax] = z.max[ax] - part;
				far.max[ax] = z.min[ax] + part;
			}
			const nc = topCenter(near);
			zones.push(checkpointZone(++cp, near, { pos: v3(nc.x, nc.y, n.max.z), yaw: n.yaw }), endZone(far));
		}
	}
	if (!spawn) throw new Error('bhopLayout: path has no start node');
	return { brushes, zones, spawn };
}

/**
 * Local catch trigger under a group of brushes (one stage or section) so a
 * miss teleports quickly instead of falling to the far-away floor. Covers the
 * group's XY bounds plus `margin`, from `gap` below its lowest point down `depth`.
 */
export function teleportUnder(
	group: BrushDef[],
	to: 'stage' | 'start',
	margin: number | { x: number; y: number } = 640,
	gap = 256,
	depth = 2048
): Zone {
	const b = boundsOf(group);
	const m = typeof margin === 'number' ? { x: margin, y: margin } : margin;
	return {
		type: 'teleport',
		min: v3(b.min.x - m.x, b.min.y - m.y, b.min.z - gap - depth),
		max: v3(b.max.x + m.x, b.max.y + m.y, b.min.z - gap),
		to
	};
}
