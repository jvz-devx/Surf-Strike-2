/**
 * Generic ramp-chain builders (first used by surf_ochre; reusable by any surf map).
 *
 * A "ramp chain" is one continuous surfable face built from several single-sided
 * `ramp` prisms (BrushDef 'ramp') that share their peak line end points:
 *
 *   - `bend` steps turn the heading a few degrees per segment, so the face curves
 *     while you ride it (curved ramp).
 *   - `gradeBlend` steps change the peak's descent per unit length a little per
 *     segment, so the face dips and rises (wave / pipe ramp) or steepens into a
 *     long downhill.
 *
 * Seam rules (why these ramps are flush, so there is no "rampbug"):
 *
 *   - A grade change with the same heading: both prisms have the same cross-section
 *     at the shared vertical end cap, so the faces meet exactly (a tiny fold of at
 *     most `maxStep` degrees, never a step).
 *   - A heading change: the prisms pivot about the shared peak point. The face must
 *     be on the INSIDE of the bend (a 'left' face only turns left, a 'right' face
 *     only turns right: a banked turn, high side outside). Then the two prisms
 *     overlap under the face instead of opening a wedge gap, and the union surface
 *     is continuous (a shallow fold). Bends also need grade >= 0 on both sides of
 *     the joint (flat or descending), otherwise the next prism's end cap could poke
 *     above the previous face. `rampChain` enforces both rules.
 *   - A bend's best grade is `flushBendGrade(angle, turn)` (about 0.04 for 4° at
 *     52°): then the previous end cap sits exactly on the next face.
 *
 * Banked turns: a rider at speed v on a bank of angle α around radius R holds
 * height when v² / R = g · tan α. Faster riders climb towards the peak, slower ones
 * slide towards the base. `bankSpeed` gives that speed for a bend so maps can size
 * the radius for the speed players carry into it.
 *
 * Hammer units, Z up, yaw in degrees (0 = +X, 90 = +Y).
 */
import type { CollisionWorld } from '../collision/api.ts';
import type { Cvars } from '../cvars.ts';
import type { PlayerState, UserCmd } from '../movement/api.ts';
import type { Vec3 } from '../types.ts';
import { dirXY, ramp, v3, type RampBrush } from './helpers.ts';

const DEG = Math.PI / 180;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** One straight piece of a chain's peak line. */
export interface PeakStep {
	/** Horizontal length of the segment. */
	length: number;
	/** Heading change at the start of this segment, degrees (+ = left). */
	turn?: number;
	/** Peak descent per unit of horizontal length (negative = climbs). Default 0. */
	grade?: number;
}

/** `n` equal straight segments (one is enough unless you want seams for looks). */
export function straight(length: number, grade = 0, n = 1): PeakStep[] {
	return Array.from({ length: n }, () => ({ length: length / n, grade }));
}

/**
 * A constant-radius bend: `turn` degrees spread over `arcLength` of peak line,
 * in segments of at most `maxStep` degrees. The first segment already turns.
 */
export function bend(turn: number, arcLength: number, grade = 0, maxStep = 4): PeakStep[] {
	const n = Math.max(1, Math.ceil(Math.abs(turn) / maxStep - 1e-9));
	return Array.from({ length: n }, () => ({ length: arcLength / n, turn: turn / n, grade }));
}

/**
 * Change the peak grade from `from` to `to` over `length`, so that the slope
 * angle along the peak changes by at most `maxStepDeg` per joint. The first
 * segment already has the first intermediate grade; the last one has `to`.
 */
export function gradeBlend(from: number, to: number, length: number, maxStepDeg = 4): PeakStep[] {
	const a0 = Math.atan(from) / DEG;
	const a1 = Math.atan(to) / DEG;
	const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / maxStepDeg - 1e-9));
	return Array.from({ length: n }, (_, i) => ({ length: length / n, grade: Math.tan((a0 + ((a1 - a0) * (i + 1)) / n) * DEG) }));
}

/** Grade at which a bend joint of `turn` degrees on a face of `angle` degrees is exactly flush. */
export function flushBendGrade(angle: number, turn: number): number {
	return Math.tan(angle * DEG) * Math.tan((Math.abs(turn) * DEG) / 2);
}

/** Speed at which a rider holds height on a bend of radius R (v² / R = g tan α). */
export function bankSpeed(angle: number, radius: number, gravity = 800): number {
	return Math.sqrt(gravity * radius * Math.tan(angle * DEG));
}

/** Radius of a bend (arc length / turn in radians). */
export function bendRadius(turn: number, arcLength: number): number {
	return arcLength / (Math.abs(turn) * DEG);
}

export interface RampChain {
	label: string;
	side: 'left' | 'right';
	angle: number;
	halfWidth: number;
	/** The prisms, in riding order. */
	ramps: RampBrush[];
	/** Peak line points (segments + 1): segment i runs from peak[i] (its `from`) towards peak[i + 1] (SEAM_DROP above it for i + 1 < n). */
	peak: Vec3[];
	/** Heading of each segment, degrees. */
	yaws: number[];
	/** Grade of each segment. */
	grades: number[];
	/** Cumulative horizontal distance at each peak point. */
	dist: number[];
	/** Landing point a transfer onto this chain aims at (set by `chainAfter`). */
	aim?: Vec3;
}

export interface ChainOpts {
	label: string;
	/** Peak line start point. */
	start: Vec3;
	/** Heading of the peak line before the first step's turn, degrees. */
	yaw: number;
	side: 'left' | 'right';
	/** Face slope from horizontal, degrees. */
	angle: number;
	/** Horizontal face width (peak to base edge). */
	halfWidth: number;
	material: string;
	steps: PeakStep[];
	/** Max heading or slope change per joint, degrees (default 4). */
	maxStep?: number;
	/** Height step down at every joint (default SEAM_DROP). */
	seamDrop?: number;
}

/**
 * Every segment starts this far below the end of the previous one (0.01 units,
 * a third of DIST_EPSILON, invisible). A rider sliding along a face sits only
 * a tiny distance above it; if the next prism's face were even 0.0005 higher
 * (coordinate rounding), the hull would already be inside that prism and its
 * start cap or edge bevel would stop the rider dead: the classic Source
 * "rampbug". Stepping each seam down a hair makes every seam a drop instead.
 */
export const SEAM_DROP = 0.01;

/** Build a ramp chain and check the seam rules (see the file comment). */
export function rampChain(o: ChainOpts): RampChain {
	const maxStep = o.maxStep ?? 4;
	const seamDrop = o.seamDrop ?? SEAM_DROP;
	const peak: Vec3[] = [v3(r3(o.start.x), r3(o.start.y), r3(o.start.z))];
	const yaws: number[] = [];
	const grades: number[] = [];
	const dist: number[] = [0];
	const ramps: RampBrush[] = [];
	let yaw = o.yaw;
	for (const [i, s] of o.steps.entries()) {
		const turn = s.turn ?? 0;
		const grade = s.grade ?? 0;
		if (Math.abs(turn) > maxStep + 1e-9) throw new Error(`${o.label}: segment ${i} turns ${turn}° (> ${maxStep}°)`);
		if (turn !== 0) {
			if (o.side === 'left' ? turn < 0 : turn > 0)
				throw new Error(`${o.label}: segment ${i} bends away from its face (a ${o.side} face must turn ${o.side})`);
			if (i > 0 && (grades[i - 1]! < 0 || grade < 0)) throw new Error(`${o.label}: segment ${i} bends on a climbing grade`);
		}
		if (i > 0) {
			const dSlope = Math.abs(Math.atan(grade) - Math.atan(grades[i - 1]!)) / DEG;
			if (dSlope > maxStep + 1e-9) throw new Error(`${o.label}: segment ${i} changes slope by ${dSlope.toFixed(2)}°`);
		}
		yaw += turn;
		const prevEnd = peak[peak.length - 1]!;
		// Each segment starts a hair (seamDrop) below the previous one's end: see SEAM_DROP.
		const a = i === 0 ? prevEnd : v3(prevEnd.x, prevEnd.y, r3(prevEnd.z - seamDrop));
		if (i > 0) peak[peak.length - 1] = a;
		const d = dirXY(yaw);
		const b = v3(r3(a.x + d.x * s.length), r3(a.y + d.y * s.length), r3(a.z - grade * s.length));
		peak.push(b);
		yaws.push(yaw);
		grades.push(grade);
		dist.push(dist[dist.length - 1]! + s.length);
		ramps.push(ramp({ from: a, to: b, angle: o.angle, halfWidth: o.halfWidth, side: o.side, material: o.material }));
	}
	return { label: o.label, side: o.side, angle: o.angle, halfWidth: o.halfWidth, ramps, peak, yaws, grades, dist };
}

/** Unit vector (horizontal) from segment i's peak line towards its base edge. */
export function faceDir(c: RampChain, i: number): { x: number; y: number } {
	const d = dirXY(c.yaws[i]!);
	return c.side === 'left' ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x };
}

/** Point on the face of segment i at horizontal distance `along` from its start and fraction `frac` of the face width. */
export function facePoint(c: RampChain, i: number, along: number, frac: number): Vec3 {
	const a = c.peak[i]!;
	const d = dirXY(c.yaws[i]!);
	const n = faceDir(c, i);
	const t = Math.tan(c.angle * DEG);
	const w = frac * c.halfWidth;
	return v3(a.x + d.x * along + n.x * w, a.y + d.y * along + n.y * w, a.z - c.grades[i]! * along - w * t);
}

export interface ChainExit {
	point: Vec3;
	yaw: number;
	grade: number;
}

/** Face point at the chain's end (default mid-face), with the heading and grade there. */
export function chainExit(c: RampChain, frac = 0.5): ChainExit {
	const i = c.ramps.length - 1;
	const len = c.dist[i + 1]! - c.dist[i]!;
	return { point: facePoint(c, i, len, frac), yaw: c.yaws[i]!, grade: c.grades[i]! };
}

export interface ChainHit {
	/** Segment index. */
	seg: number;
	/** Total horizontal distance along the chain. */
	along: number;
	/** Horizontal distance from the segment's peak line towards its base. */
	lateral: number;
	/** lateral / halfWidth (0 = peak, 1 = base edge). */
	frac: number;
	/** Segment heading. */
	yaw: number;
	/** Face height at this point. */
	faceZ: number;
}

/**
 * Where (x, y) lies on the chain's face, or null outside every segment's footprint.
 * Where segments overlap (inside a bend) the higher face wins, as in the collision.
 */
export function locateOnChain(c: RampChain, p: { x: number; y: number }): ChainHit | null {
	let best: ChainHit | null = null;
	for (let i = 0; i < c.ramps.length; i++) {
		const a = c.peak[i]!;
		const d = dirXY(c.yaws[i]!);
		const n = faceDir(c, i);
		const len = c.dist[i + 1]! - c.dist[i]!;
		const s = (p.x - a.x) * d.x + (p.y - a.y) * d.y;
		const lat = (p.x - a.x) * n.x + (p.y - a.y) * n.y;
		if (s < 0 || s > len || lat < 0 || lat > c.halfWidth) continue;
		const faceZ = a.z - c.grades[i]! * s - lat * Math.tan(c.angle * DEG);
		if (!best || faceZ > best.faceZ) best = { seg: i, along: c.dist[i]! + s, lateral: lat, frac: lat / c.halfWidth, yaw: c.yaws[i]!, faceZ };
	}
	return best;
}

/** Signed horizontal distance past the chain's end along its last heading (> 0 = beyond the end). */
export function pastEnd(c: RampChain, p: { x: number; y: number }): number {
	const i = c.ramps.length - 1;
	const e = c.peak[i + 1]!;
	const d = dirXY(c.yaws[i]!);
	return (p.x - e.x) * d.x + (p.y - e.y) * d.y;
}

export interface LandingLeg {
	label: string;
	/** Heading of the new chain's first segment. */
	yaw: number;
	side: 'left' | 'right';
	angle: number;
	halfWidth: number;
	material: string;
	steps: PeakStep[];
	/** Horizontal distance from the previous exit, along its heading, to the landing point. */
	ahead: number;
	/** Sideways shift of the landing point from the straight line (+ = left of the exit heading). */
	shift?: number;
	/**
	 * Vertical drop from the previous exit point to the landing point. Default:
	 * the ballistic drop at `speed` (a launch along the exit heading and grade).
	 */
	drop?: number;
	/** Design launch speed for the default `drop`. */
	speed?: number;
	/** Grade of the previous chain at its exit (for the default `drop`). */
	exitGrade?: number;
	/** Horizontal distance along the new chain's first segment from its start to the landing point. */
	back: number;
	/** Face fraction of the landing point (default 0.5 = mid-face). */
	frac?: number;
}

/** A leg's drop: explicit, or ballistic at its design speed (see LandingLeg.drop). */
export function transferDrop(leg: Pick<LandingLeg, 'drop' | 'speed' | 'exitGrade' | 'ahead' | 'label'>, gravity = 800): number {
	if (leg.drop !== undefined) return leg.drop;
	if (!leg.speed) throw new Error(`${leg.label}: needs drop or speed`);
	const g = leg.exitGrade ?? 0;
	// Launch velocity along the exit heading with the exit grade, `speed` in total.
	const vh = leg.speed / Math.sqrt(1 + g * g);
	const t = leg.ahead / vh;
	return g * leg.ahead + 0.5 * gravity * t * t;
}

/**
 * Chain whose face passes through a landing point placed relative to `exit`
 * (the previous chain's exit). The first step must be long enough to contain `back`.
 */
export function chainAfter(exit: ChainExit, leg: LandingLeg): RampChain {
	const d0 = dirXY(exit.yaw);
	const l0 = { x: -d0.y, y: d0.x };
	const sh = leg.shift ?? 0;
	const land = v3(
		exit.point.x + d0.x * leg.ahead + l0.x * sh,
		exit.point.y + d0.y * leg.ahead + l0.y * sh,
		exit.point.z - transferDrop({ ...leg, exitGrade: leg.exitGrade ?? exit.grade })
	);
	const first = leg.steps[0]!;
	if ((first.turn ?? 0) !== 0) throw new Error(`${leg.label}: first step must not turn`);
	if (first.length < leg.back) throw new Error(`${leg.label}: landing point beyond the first segment`);
	const d = dirXY(leg.yaw);
	const n = leg.side === 'left' ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x };
	const w = (leg.frac ?? 0.5) * leg.halfWidth;
	const g = first.grade ?? 0;
	const start = v3(
		land.x - d.x * leg.back - n.x * w,
		land.y - d.y * leg.back - n.y * w,
		land.z + w * Math.tan(leg.angle * DEG) + g * leg.back
	);
	const c = rampChain({ label: leg.label, start, yaw: leg.yaw, side: leg.side, angle: leg.angle, halfWidth: leg.halfWidth, material: leg.material, steps: leg.steps });
	c.aim = v3(r3(land.x), r3(land.y), r3(land.z));
	return c;
}

// ---------------------------------------------------------------------------
// Route bot (tests and map tuning). Pure input logic; the caller injects the
// movement step so map modules never depend on the movement code.


export interface BotOpts {
	/** Face fraction the bot tries to ride at (0 = peak, 1 = base edge; default 0.45). */
	target?: number;
	/** Gain from face-fraction error to wanted down-face speed, u/s per unit fraction (default 600). */
	gain?: number;
	/** Air-strafe towards the next chain's `aim` point (default false: transfers are flown ballistically). */
	steer?: boolean;
}

export interface BotSample {
	tick: number;
	pos: Vec3;
	vel: Vec3;
	speed: number;
	/** Index of the chain the bot is targeting. */
	chain: number;
	/** The chain segment under the bot when touching that chain's face, else -1. */
	seg: number;
	surfing: boolean;
	onGround: boolean;
	/** Strafe input used this tick. */
	sidemove: number;
}

const headingOf = (v: { x: number; y: number }) => Math.atan2(v.y, v.x) / DEG;
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/**
 * One tick of "surf the chains in order" input, played like a surfer: always
 * look along the horizontal velocity and only use strafe keys, so every key
 * press turns the velocity (perpendicular air acceleration) instead of braking.
 *
 * - On a chain: strafe into the ramp (towards the peak) while the rider slides
 *   down the face faster than wanted for its height on the face, else let go.
 * - In the air: no input (a ballistic transfer), or with `steer`, strafe
 *   towards the next chain's `aim` point when the heading is off by more than 1°.
 *
 * `state.k` is the targeted chain; it advances once the bot is past the end of
 * the current one, or touches the next one.
 */
export function chainBotCmd(chains: RampChain[], state: { k: number }, p: PlayerState, o: BotOpts = {}): { cmd: UserCmd; seg: number } {
	const c0 = chains[state.k]!;
	const next = chains[state.k + 1];
	if (next && (pastEnd(c0, p.origin) > 0 || onChain(next, p))) state.k++;
	const c = chains[state.k]!;
	const v = p.velocity;
	const yaw = headingOf(v);
	const into = c.side === 'left' ? 450 : -450; // + sidemove = right; a left face has its peak to the right
	const hit = onChain(c, p);
	if (hit) {
		const n = faceDir(c, hit.seg);
		const down = v.x * n.x + v.y * n.y;
		const want = Math.max(-300, Math.min(300, (o.gain ?? 600) * ((o.target ?? 0.45) - hit.frac)));
		return { cmd: { pitch: 0, yaw, forwardmove: 0, sidemove: down > want ? into : 0, buttons: 0 }, seg: hit.seg };
	}
	let sidemove = 0;
	const ax = c.aim ? c.aim.x - p.origin.x : 0;
	const ay = c.aim ? c.aim.y - p.origin.y : 0;
	// Steer only while the aim point is still well ahead; past it, fly straight on and land further along.
	if (o.steer && c.aim && ax * v.x + ay * v.y > 384 * Math.hypot(v.x, v.y)) {
		const d = wrap(headingOf({ x: ax, y: ay }) - yaw);
		if (Math.abs(d) > 1) sidemove = d > 0 ? -450 : 450;
	}
	return { cmd: { pitch: 0, yaw, forwardmove: 0, sidemove, buttons: 0 }, seg: -1 };
}

/** Chain hit when the hull's feet are within 48 units above that chain's face. */
function onChain(c: RampChain, p: PlayerState): ChainHit | null {
	const h = locateOnChain(c, p.origin);
	return h && p.origin.z - h.faceZ < 48 && p.origin.z - h.faceZ > -24 ? h : null;
}

export type MoveFn = (world: CollisionWorld, p: PlayerState, cmd: UserCmd, cvars: Cvars, dt: number) => void;

/**
 * Run the chain bot from `p` until `stop` returns a reason or `seconds` pass.
 * Returns every tick's sample and the stop reason ('timeout' if none).
 */
export function runChainBot(o: {
	world: CollisionWorld;
	move: MoveFn;
	cvars: Cvars;
	dt: number;
	p: PlayerState;
	chains: RampChain[];
	seconds: number;
	first?: number;
	stop?: (p: PlayerState) => string | null;
	bot?: BotOpts;
}): { samples: BotSample[]; reason: string } {
	const state = { k: o.first ?? 0 };
	const samples: BotSample[] = [];
	const n = Math.round(o.seconds / o.dt);
	for (let t = 0; t < n; t++) {
		const { cmd, seg } = chainBotCmd(o.chains, state, o.p, o.bot);
		o.move(o.world, o.p, cmd, o.cvars, o.dt);
		const v = o.p.velocity;
		samples.push({
			tick: t,
			pos: { ...o.p.origin },
			vel: { ...v },
			speed: Math.hypot(v.x, v.y, v.z),
			chain: state.k,
			seg,
			surfing: o.p.surfing,
			onGround: o.p.onGround,
			sidemove: cmd.sidemove
		});
		const r = o.stop?.(o.p);
		if (r) return { samples, reason: r };
	}
	return { samples, reason: 'timeout' };
}
