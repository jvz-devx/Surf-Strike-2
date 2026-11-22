/**
 * Generic surf ramp builders (used by surf_kessler, usable by any map).
 *
 * Every builder returns plain `ramp` prisms (BrushDef type 'ramp'), so the
 * shared helpers (`boundsOf`, `rampFaceZ`, `simulateTransfer`) and the map
 * registry tests work on them unchanged.
 *
 * - `straightRamp()`: one prism along a heading with a constant grade.
 * - `curvedRamp()`: a ramp that bends while you ride it. The peak line follows
 *   an arc; each segment turns by at most `maxSegDeg` (default 3°). The face is
 *   always on the inside of the bend (a concave "bowl" curve, which pushes the
 *   rider around the turn instead of throwing them off). Neighbouring segments
 *   overlap by enough that each one's end cap is buried under the next face:
 *   the union of two prisms is the max of their two face planes, which is a
 *   shallow valley crease, so the rider is only deflected by ≤ maxSegDeg at a
 *   seam and never meets an exposed cap ("rampbug").
 * - `waveRamp()`: one heading, the peak line's grade changes along it (down,
 *   flatten, climb, down again). Grade changes are split into small steps
 *   (≤ `maxGradeStep`) so no seam bends the face by more than ~1°. Segments
 *   share the same vertical end cap plane and cross-section, so their faces
 *   meet flush.
 * - `wallRamp()`: a very steep (70–80°) face for wall-surf sections.
 *
 * Plus geometry queries used by map tests and bots: `locateOnChain()` (which
 * segment, how far along, how far down the face), segment heading, face
 * normals, chain exits.
 *
 * Hammer units, Z up, yaw in degrees (0 = +X, 90 = +Y).
 */
import type { Vec3 } from '../types.ts';
import { ramp, rampFrame, v3, type RampBrush } from './helpers.ts';

const DEG = Math.PI / 180;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const rv = (p: Vec3) => v3(r3(p.x), r3(p.y), r3(p.z));

export type FaceSide = 'left' | 'right';

/** A run of ramp segments ridden as one surface. */
export interface RampChain {
	label: string;
	kind: 'straight' | 'curve' | 'wave' | 'wall' | 'up';
	side: FaceSide;
	segs: RampBrush[];
}

/** Heading of a segment's peak line, degrees. */
export function segYaw(r: RampBrush): number {
	const f = rampFrame(r);
	return Math.atan2(f.dir.y, f.dir.x) / DEG;
}

/** Horizontal unit vector from the peak line towards the face's base edge. */
export function faceOut(yaw: number, side: FaceSide): { x: number; y: number } {
	const r = yaw * DEG;
	const s = side === 'left' ? 1 : -1;
	return { x: -Math.sin(r) * s, y: Math.cos(r) * s };
}

/** Outward 3D unit normal of a single-sided segment's sloped face. */
export function faceNormal(r: RampBrush): Vec3 {
	const side = r.side === 'both' ? 'left' : r.side;
	const f = rampFrame(r);
	const o = faceOut(segYaw(r), side);
	// Face plane contains the peak direction (with its grade) and the down-slope (o, -height/halfWidth).
	const len = f.length;
	const dz = r.to.z - r.from.z;
	const a = v3(f.dir.x * len, f.dir.y * len, dz);
	const b = v3(o.x * r.halfWidth, o.y * r.halfWidth, -r.height);
	let n = v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
	if (n.z < 0) n = v3(-n.x, -n.y, -n.z);
	const l = Math.hypot(n.x, n.y, n.z);
	return v3(n.x / l, n.y / l, n.z / l);
}

/** Angle of the face from horizontal, degrees (from its true normal, so grade counts). */
export function faceAngle(r: RampBrush): number {
	return Math.acos(faceNormal(r).z) / DEG;
}

export interface StraightOpts {
	from: Vec3;
	yaw: number;
	length: number;
	/** Peak descent per unit of horizontal length (negative = climbs). */
	grade: number;
	angle: number;
	/** Horizontal width of the face. */
	hw: number;
	side: RampBrush['side'];
	material: string;
}

/** One straight prism from `from` (peak) along `yaw`. */
export function straightRamp(o: StraightOpts): RampBrush {
	const d = { x: Math.cos(o.yaw * DEG), y: Math.sin(o.yaw * DEG) };
	const to = v3(o.from.x + d.x * o.length, o.from.y + d.y * o.length, o.from.z - o.length * o.grade);
	return ramp({ from: rv(o.from), to: rv(to), angle: o.angle, halfWidth: o.hw, side: o.side, material: o.material });
}

/** Wall-surf face: a straight single-sided ramp that must be 70–80° steep. */
export function wallRamp(o: StraightOpts & { side: FaceSide }): RampBrush {
	if (o.angle < 70 || o.angle > 80) throw new Error('wallRamp: angle must be 70–80°');
	return straightRamp(o);
}

export interface CurveOpts {
	from: Vec3;
	/** Heading at the start of the curve. */
	yaw: number;
	/** Total bend in degrees: positive = left (counter-clockwise), negative = right. */
	turn: number;
	/** Radius of the peak line's arc (horizontal). */
	radius: number;
	/** Peak descent per unit of arc length (negative = climbs). */
	grade: number;
	angle: number;
	hw: number;
	material: string;
	/** Largest bend between two neighbouring segments, degrees (default 3). */
	maxSegDeg?: number;
	/** Straight run-in before the bend and run-out after it (default 0). */
	leadIn?: number;
	leadOut?: number;
}

/**
 * Concave curved ramp (see file comment). Returns the segments in riding
 * order. The face side follows the bend: a left turn puts the face on the
 * left (inside of the arc).
 */
export function curvedRamp(o: CurveOpts): { segs: RampBrush[]; side: FaceSide; end: Vec3; endYaw: number } {
	const side: FaceSide = o.turn > 0 ? 'left' : 'right';
	const sgn = Math.sign(o.turn);
	const maxSeg = o.maxSegDeg ?? 3;
	const n = Math.max(1, Math.ceil(Math.abs(o.turn) / maxSeg));
	const step = o.turn / n; // degrees per segment (signed)
	const chord = 2 * o.radius * Math.sin((Math.abs(step) * DEG) / 2);
	const T = Math.tan(o.angle * DEG);
	// Cap burial: the crease between two neighbours leans by atan(grade/T) from the bisector,
	// and the caps fan apart by the bend; extend each segment past its joints to cover both.
	const overlap = Math.ceil(o.hw * (Math.abs(o.grade) / T + Math.abs(step) * DEG) + 8);
	const segs: RampBrush[] = [];
	const pts: Vec3[] = [];
	const yaws: number[] = [];
	let p = rv(o.from);
	let yaw = o.yaw;
	const push = (a: Vec3, y: number, len: number) => {
		const d = { x: Math.cos(y * DEG), y: Math.sin(y * DEG) };
		const b = v3(a.x + d.x * len, a.y + d.y * len, a.z - len * o.grade);
		pts.push(a);
		yaws.push(y);
		return b;
	};
	if (o.leadIn) p = push(p, yaw, o.leadIn);
	// First chord heads half a step into the bend (chord of an arc tangent to `yaw`).
	for (let i = 0; i < n; i++) {
		const y = yaw + step * (i + 0.5);
		p = push(p, y, chord);
	}
	yaw += o.turn;
	if (o.leadOut) p = push(p, yaw, o.leadOut);
	pts.push(p);
	for (let i = 0; i < yaws.length; i++) {
		const a = pts[i]!;
		const b = pts[i + 1]!;
		const y = yaws[i]!;
		const d = { x: Math.cos(y * DEG), y: Math.sin(y * DEG) };
		const pre = i > 0 ? overlap : 0;
		const post = i < yaws.length - 1 ? overlap : 0;
		const from = v3(a.x - d.x * pre, a.y - d.y * pre, a.z + pre * o.grade);
		const to = v3(b.x + d.x * post, b.y + d.y * post, b.z - post * o.grade);
		segs.push(ramp({ from: rv(from), to: rv(to), angle: o.angle, halfWidth: o.hw, side, material: o.material }));
	}
	void sgn;
	return { segs, side, end: p, endYaw: yaw };
}

export interface WaveOpts {
	from: Vec3;
	yaw: number;
	/** Sections of constant grade, in riding order. */
	sections: Array<{ length: number; grade: number }>;
	angle: number;
	hw: number;
	side: FaceSide;
	material: string;
	/** Largest grade change at one seam (default 0.02, about 1.1° of pitch). */
	maxGradeStep?: number;
	/** Length of each transition step between sections (default 96). */
	blendStep?: number;
}

/**
 * Down-up "wave" ramp on one heading (see file comment). Transitions between
 * sections are blended into ≤ maxGradeStep steps taken out of the following
 * section's length. Returns the segments in riding order.
 */
export function waveRamp(o: WaveOpts): RampBrush[] {
	const maxStep = o.maxGradeStep ?? 0.02;
	const blend = o.blendStep ?? 96;
	const d = { x: Math.cos(o.yaw * DEG), y: Math.sin(o.yaw * DEG) };
	const segs: RampBrush[] = [];
	let p = rv(o.from);
	let prevGrade: number | null = null;
	const seg = (len: number, grade: number) => {
		const to = rv(v3(p.x + d.x * len, p.y + d.y * len, p.z - len * grade));
		segs.push(ramp({ from: p, to, angle: o.angle, halfWidth: o.hw, side: o.side, material: o.material }));
		p = to;
	};
	for (const s of o.sections) {
		let left = s.length;
		if (prevGrade !== null) {
			const k = Math.ceil(Math.abs(s.grade - prevGrade) / maxStep - 1e-9);
			for (let i = 1; i < k; i++) {
				seg(blend, prevGrade + ((s.grade - prevGrade) * i) / k);
				left -= blend;
			}
		}
		if (left < blend / 2) throw new Error('waveRamp: section too short for its transition');
		seg(left, s.grade);
		prevGrade = s.grade;
	}
	return segs;
}

export interface ChainPos {
	/** Segment index. */
	i: number;
	/** Distance along that segment's peak line (horizontal). */
	s: number;
	/** Horizontal distance from the peak line down the face (0 = peak, hw = base). */
	lat: number;
	/** Height of the face above the point (on the face's footprint). */
	faceZ: number;
	yaw: number;
}

/**
 * Where a point is over a chain's faces: the segment whose face footprint
 * contains it (first match in riding order, preferring the highest face where
 * segments overlap), or null when the point is off every face.
 */
export function locateOnChain(segs: RampBrush[], x: number, y: number): ChainPos | null {
	let best: ChainPos | null = null;
	for (const [i, r] of segs.entries()) {
		const f = rampFrame(r);
		const px = x - r.from.x;
		const py = y - r.from.y;
		const s = px * f.dir.x + py * f.dir.y;
		if (s < 0 || s > f.length) continue;
		const sideSign = r.side === 'right' ? -1 : 1;
		const lat = (px * f.left.x + py * f.left.y) * sideSign;
		if (lat < 0 || lat > r.halfWidth) continue;
		const peak = r.from.z + ((r.to.z - r.from.z) * s) / f.length;
		const faceZ = peak - (r.height * lat) / r.halfWidth;
		if (!best || faceZ > best.faceZ) best = { i, s, lat, faceZ, yaw: segYaw(r) };
	}
	return best;
}

/** Mid-face point at the far end of a chain's last segment (where a typical rider exits). */
export function chainExit(segs: RampBrush[]): Vec3 {
	const r = segs[segs.length - 1]!;
	const o = faceOut(segYaw(r), r.side === 'right' ? 'right' : 'left');
	return v3(r.to.x + (o.x * r.halfWidth) / 2, r.to.y + (o.y * r.halfWidth) / 2, r.to.z - r.height / 2);
}

/** Horizontal angle between two headings, 0..180. */
export function yawDiff(a: number, b: number): number {
	let d = Math.abs(a - b) % 360;
	if (d > 180) d = 360 - d;
	return d;
}

/** Signed heading change from a to b, -180..180 (positive = left / counter-clockwise). */
export function yawDelta(a: number, b: number): number {
	let d = (b - a) % 360;
	if (d > 180) d -= 360;
	if (d < -180) d += 360;
	return d;
}

// ---------------------------------------------------------------------------
// Air-turn flight model

/**
 * Strafe turn rate limit: with sv_air_max_wishspeed 30, a strafe perpendicular
 * to the velocity adds 30 u/s per tick (64 tick), so the heading turns at
 * 1920 / v rad/s (radius v² / 1920) and the speed barely changes.
 */
export const AIR_TURN_ACCEL = 30 * 64;

export interface FlightSample {
	t: number;
	p: Vec3;
	v: Vec3;
}

/**
 * Point-mass flight of a rider who air-strafes towards `aimYaw` at the full
 * strafing rate (perpendicular strafe), then stops turning within `tolerance`
 * degrees of it. `aimYaw` null = no turn (plain ballistic flight).
 */
export function airTurnFlight(
	p0: Vec3,
	v0: Vec3,
	aimYaw: number | null,
	o: { gravity?: number; accel?: number; dt?: number; maxTime?: number; tolerance?: number } = {}
): FlightSample[] {
	const g = o.gravity ?? 800;
	const acc = o.accel ?? AIR_TURN_ACCEL;
	const dt = o.dt ?? 1 / 256;
	const maxT = o.maxTime ?? 6;
	const tol = o.tolerance ?? 1.5;
	const p = { ...p0 };
	const v = { ...v0 };
	const out: FlightSample[] = [{ t: 0, p: { ...p }, v: { ...v } }];
	for (let t = dt; t <= maxT + 1e-9; t += dt) {
		if (aimYaw !== null) {
			const h = Math.atan2(v.y, v.x) / DEG;
			const d = yawDelta(h, aimYaw);
			if (Math.abs(d) > tol) {
				const vh = Math.hypot(v.x, v.y);
				// Rotate the horizontal velocity by acc·dt / vh (perpendicular push, length kept).
				const a = Math.sign(d) * Math.min((acc * dt) / Math.max(vh, 1), Math.abs(d) * DEG);
				const c = Math.cos(a);
				const s = Math.sin(a);
				const vx = v.x * c - v.y * s;
				v.y = v.x * s + v.y * c;
				v.x = vx;
			}
		}
		p.x += v.x * dt;
		p.y += v.y * dt;
		p.z += v.z * dt - 0.5 * g * dt * dt;
		v.z -= g * dt;
		out.push({ t, p: { ...p }, v: { ...v } });
	}
	return out;
}

/**
 * Air-turn landing check (the turning counterpart of helpers.ts
 * simulateTransfer): the flight must come down onto one of `segs`' faces from
 * above. Entering a face footprint below the face = hitting a side or end cap.
 */
export function simulateAirTurn(
	p0: Vec3,
	v0: Vec3,
	aimYaw: number | null,
	segs: RampBrush[],
	gravity = 800
): { ok: boolean; reason: string; at: Vec3; time: number; v: Vec3 } {
	const path = airTurnFlight(p0, v0, aimYaw, { gravity });
	const floor = Math.min(...segs.map((r) => Math.min(r.from.z, r.to.z) - r.height));
	const above = segs.map(() => false);
	for (const s of path) {
		for (const [i, r] of segs.entries()) {
			const loc = locateOnChain([r], s.p.x, s.p.y);
			if (!loc) {
				above[i] = false;
				continue;
			}
			if (s.p.z > loc.faceZ) above[i] = true;
			else if (above[i]) return { ok: true, reason: 'landed', at: s.p, time: s.t, v: s.v };
			else return { ok: false, reason: 'hit the side/end of the target', at: s.p, time: s.t, v: s.v };
		}
		if (s.p.z < floor - 1) return { ok: false, reason: 'fell below the target', at: s.p, time: s.t, v: s.v };
	}
	const last = path[path.length - 1]!;
	return { ok: false, reason: 'timeout', at: last.p, time: last.t, v: last.v };
}

/** Launch state off a chain at `speed`: mid-face exit, velocity along the last segment's peak line. */
export function chainLaunch(segs: RampBrush[], speed: number): { p: Vec3; v: Vec3 } {
	const r = segs[segs.length - 1]!;
	const dx = r.to.x - r.from.x;
	const dy = r.to.y - r.from.y;
	const dz = r.to.z - r.from.z;
	const l = Math.hypot(dx, dy, dz);
	return { p: chainExit(segs), v: v3((dx / l) * speed, (dy / l) * speed, (dz / l) * speed) };
}
