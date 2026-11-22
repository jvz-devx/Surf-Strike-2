/**
 * Generic hard-surf obstacle builders and a route bot (used by surf_ochre and
 * surf_kessler; reusable by any surf map).
 *
 * Obstacles are ordinary solid brushes placed ON the intended line (unlike
 * scenery, which keeps clear of it). Each one carries the openings ("gates")
 * the intended line flies through, so tests can check a real-physics run
 * passes through every hole, and that sloppier lines do not.
 *
 *   - `orientedBox()`: a box turned to any heading (axis-aligned headings give a
 *     plain `box` brush, others a `convex` brush with 6 planes).
 *   - `wallWithHole()`: a thick wall across a flight line with a rectangular
 *     opening (window, narrow slot); 4 non-overlapping pieces.
 *   - `floorWithHole()`: a horizontal slab with a rectangular hole to drop through.
 *   - `glassPanel()`: an oriented box in a glass material (MaterialDef.glass:
 *     see-through in the renderer, solid in collision).
 *   - `pillar()`: an upright square column.
 *   - `spiralSteps()`: peak steps for a downward spiral (rampChain, surf_ochre-helpers.ts):
 *     the heading turns by at most `maxStep` per seam while the radius changes
 *     linearly from r0 to r1. Expanding spirals (r1 > r0) stay banked for a rider
 *     who speeds up on the way down, and their loops never stack over each other.
 *
 * Route bot: `routeBotCmd` / `runRouteBot` ride a list of chains like a surfer
 * (look along the velocity, strafe keys only): on a face it holds a target face
 * fraction (optionally scheduled along the chain, to ride high or low before a
 * window); in the air it follows an `AirPlan` (no input, steer to the next
 * chain's aim point, steer through a list of gates, or turn to a heading). The
 * movement step is injected, so map modules never depend on the movement code.
 *
 * Hammer units, Z up, yaw in degrees (0 = +X, 90 = +Y).
 */
import type { CollisionWorld } from '../collision/api.ts';
import type { Cvars } from '../cvars.ts';
import type { PlayerState, UserCmd } from '../movement/api.ts';
import type { Plane, Vec3 } from '../types.ts';
import type { BrushDef } from './types.ts';
import { box, boundsOf, dirXY, v3, type Box3 } from './helpers.ts';
import type { Zone } from './types.ts';
import { chainAfter, chainExit, faceDir, locateOnChain, pastEnd, rampChain, transferDrop, type ChainHit, type PeakStep, type RampChain } from './surf_ochre-helpers.ts';
import { airTurnFlight, yawDelta } from './surf_kessler-helpers.ts';

const DEG = Math.PI / 180;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const HULL_HALF = 16;
const HULL_H = 72;

// ---------------------------------------------------------------------------
// Brushes

export interface OrientedBoxOpts {
	/** Centre of the box footprint (x, y); z is ignored. */
	center: { x: number; y: number };
	/** Heading of the box's "along" axis, degrees. */
	yaw: number;
	/** Size along the heading. */
	along: number;
	/** Size across the heading. */
	across: number;
	z0: number;
	z1: number;
	material: string;
}

/** Box turned to `yaw` (plain `box` brush on axis headings, else a 6-plane `convex` brush). */
export function orientedBox(o: OrientedBoxOpts): BrushDef {
	const q = (((o.yaw % 90) + 90) % 90 + 90) % 90;
	if (Math.abs(q) < 1e-6 || Math.abs(q - 90) < 1e-6) {
		const swap = Math.round(o.yaw / 90) % 2 !== 0;
		const hx = (swap ? o.across : o.along) / 2;
		const hy = (swap ? o.along : o.across) / 2;
		return box(v3(r3(o.center.x - hx), r3(o.center.y - hy), r3(o.z0)), v3(r3(o.center.x + hx), r3(o.center.y + hy), r3(o.z1)), o.material);
	}
	const d = dirXY(o.yaw);
	const l = { x: -d.y, y: d.x };
	const c = o.center;
	const planes: Plane[] = [
		{ normal: v3(d.x, d.y, 0), dist: d.x * c.x + d.y * c.y + o.along / 2 },
		{ normal: v3(-d.x, -d.y, 0), dist: -(d.x * c.x + d.y * c.y) + o.along / 2 },
		{ normal: v3(l.x, l.y, 0), dist: l.x * c.x + l.y * c.y + o.across / 2 },
		{ normal: v3(-l.x, -l.y, 0), dist: -(l.x * c.x + l.y * c.y) + o.across / 2 },
		{ normal: v3(0, 0, 1), dist: o.z1 },
		{ normal: v3(0, 0, -1), dist: -o.z0 }
	];
	return { type: 'convex', planes: planes.map((p) => ({ normal: p.normal, dist: r3(p.dist) })), material: o.material };
}

/** Upright square column from z0 to z1. */
export function pillar(x: number, y: number, z0: number, z1: number, size: number, material: string): BrushDef {
	return box(v3(x - size / 2, y - size / 2, z0), v3(x + size / 2, y + size / 2, z1), material);
}

/** A glass panel: an oriented box in a glass material (see MaterialDef.glass). */
export function glassPanel(o: OrientedBoxOpts): BrushDef {
	return orientedBox(o);
}

// ---------------------------------------------------------------------------
// Gates (openings on the intended line)

export interface Gate {
	label: string;
	/**
	 * 'wall': opening in a vertical wall crossed along `yaw` (center = opening
	 * centre; halfW across, halfH up/down). 'floor': hole in a horizontal slab
	 * crossed downwards (center = hole centre at the slab top; halfW across
	 * `yaw`, halfH along it).
	 */
	type: 'wall' | 'floor';
	center: Vec3;
	yaw: number;
	halfW: number;
	halfH: number;
	/** Floor gates: slab thickness; the hull must also be inside the hole when its top clears the slab's underside. */
	depth?: number;
}

export type ObstacleKind =
	| 'window' // wall with a hole between ramps
	| 'slot' // narrow slot in a thick wall
	| 'rampWindow' // wall across a ramp: surf through its window
	| 'floorHole' // hole in a floor to drop through
	| 'glassWall'
	| 'glassCeiling'
	| 'glassFloor'
	| 'ceiling' // low arches / slabs over a ramp
	| 'pillar'
	| 'endWall'; // wall closing a ramp's end (leave early)

export interface Obstacle {
	label: string;
	kind: ObstacleKind;
	brushes: BrushDef[];
	/** Openings the intended line passes through (empty for walls, pillars and ceilings to avoid). */
	gates: Gate[];
}

export interface WallHoleOpts {
	label: string;
	kind?: ObstacleKind;
	/** Centre of the opening. */
	hole: Vec3;
	/** Heading of travel through the opening (the wall is perpendicular to it). */
	yaw: number;
	holeW: number;
	holeH: number;
	/** Wall thickness along the heading. */
	thickness: number;
	/** Total wall width across the heading (centred on the hole unless `shift` is set). */
	width: number;
	/** Wall bottom and top heights. */
	z0: number;
	z1: number;
	material: string;
	/** Move the wall sideways relative to the hole (+ = left of the heading). */
	shift?: number;
}

/** Wall across a flight line with a rectangular opening (4 non-overlapping pieces). */
export function wallWithHole(o: WallHoleOpts): Obstacle {
	const d = dirXY(o.yaw);
	const l = { x: -d.y, y: d.x };
	const at = (s: number) => ({ x: o.hole.x + l.x * s, y: o.hole.y + l.y * s });
	const hw = o.holeW / 2;
	const left0 = hw;
	const left1 = o.width / 2 + (o.shift ?? 0);
	const right0 = -(o.width / 2) + (o.shift ?? 0);
	const right1 = -hw;
	const hb = o.hole.z - o.holeH / 2;
	const ht = o.hole.z + o.holeH / 2;
	if (left1 <= left0 || right1 <= right0 || hb <= o.z0 || ht >= o.z1) throw new Error(`${o.label}: hole outside its wall`);
	const piece = (s0: number, s1: number, z0: number, z1: number) =>
		orientedBox({ center: at((s0 + s1) / 2), yaw: o.yaw, along: o.thickness, across: s1 - s0, z0, z1, material: o.material });
	return {
		label: o.label,
		kind: o.kind ?? 'window',
		brushes: [piece(left0, left1, o.z0, o.z1), piece(right0, right1, o.z0, o.z1), piece(-hw, hw, o.z0, hb), piece(-hw, hw, ht, o.z1)],
		gates: [{ label: o.label, type: 'wall', center: { ...o.hole }, yaw: o.yaw, halfW: hw, halfH: o.holeH / 2 }]
	};
}

export interface FloorHoleOpts {
	label: string;
	/** Hole centre at the slab's top surface. */
	hole: Vec3;
	yaw: number;
	/** Hole size along / across the heading. */
	holeAlong: number;
	holeAcross: number;
	/** Slab extent around the hole: behind (before) and beyond it along the heading, and to each side. */
	before: number;
	beyond: number;
	side: number;
	thickness: number;
	material: string;
}

/** Horizontal slab with a rectangular hole to drop through (4 non-overlapping pieces). */
export function floorWithHole(o: FloorHoleOpts): Obstacle {
	const d = dirXY(o.yaw);
	const l = { x: -d.y, y: d.x };
	const at = (a: number, s: number) => ({ x: o.hole.x + d.x * a + l.x * s, y: o.hole.y + d.y * a + l.y * s });
	const ha = o.holeAlong / 2;
	const hs = o.holeAcross / 2;
	const z0 = o.hole.z - o.thickness;
	const z1 = o.hole.z;
	const piece = (a0: number, a1: number, s0: number, s1: number) =>
		orientedBox({ center: at((a0 + a1) / 2, (s0 + s1) / 2), yaw: o.yaw, along: a1 - a0, across: s1 - s0, z0, z1, material: o.material });
	return {
		label: o.label,
		kind: 'floorHole',
		brushes: [
			piece(-ha - o.before, -ha, -hs - o.side, hs + o.side), // near part
			piece(ha, ha + o.beyond, -hs - o.side, hs + o.side), // far part
			piece(-ha, ha, hs, hs + o.side), // left strip
			piece(-ha, ha, -hs - o.side, -hs) // right strip
		],
		gates: [{ label: o.label, type: 'floor', center: { ...o.hole }, yaw: o.yaw, halfW: hs, halfH: ha, depth: o.thickness }]
	};
}

export interface GateCrossing {
	crossed: boolean;
	/** Sideways offset of the hull centre from the opening centre (+ = left), at the crossing. */
	lateral: number;
	/** Feet height (wall gates) or along-offset (floor gates) at the crossing. */
	z: number;
	/** Hull fully inside the opening. */
	inside: boolean;
	/** Smallest distance from the hull to the opening's edge (negative = clipped it). */
	margin: number;
	tick: number;
}

/**
 * Where a path (feet positions per tick) crosses a gate's plane in its travel
 * direction, and whether the whole hull was inside the opening. Only crossings
 * near the opening count (within 4× its size), so later loops of a route that
 * pass the same plane far away are ignored.
 */
export function gateCrossing(path: Vec3[], g: Gate): GateCrossing {
	const d = dirXY(g.yaw);
	const l = { x: -d.y, y: d.x };
	// Hull half extent across the gate (a 32×32 box turned against the gate axes).
	const reachW = HULL_HALF * (Math.abs(l.x) + Math.abs(l.y));
	const reachA = HULL_HALF * (Math.abs(d.x) + Math.abs(d.y));
	for (let i = 1; i < path.length; i++) {
		const a = path[i - 1]!;
		const b = path[i]!;
		let sa: number;
		let sb: number;
		if (g.type === 'wall') {
			sa = (a.x - g.center.x) * d.x + (a.y - g.center.y) * d.y;
			sb = (b.x - g.center.x) * d.x + (b.y - g.center.y) * d.y;
		} else {
			sa = g.center.z - a.z;
			sb = g.center.z - b.z;
		}
		if (!(sa < 0 && sb >= 0)) continue;
		const t = sa / (sa - sb);
		const p = v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
		const lat = (p.x - g.center.x) * l.x + (p.y - g.center.y) * l.y;
		if (g.type === 'wall') {
			if (Math.abs(lat) > 4 * g.halfW + 512 || Math.abs(p.z - g.center.z) > 4 * g.halfH + 512) continue;
			const mW = g.halfW - reachW - Math.abs(lat);
			const mLow = p.z - (g.center.z - g.halfH);
			const mHigh = g.center.z + g.halfH - (p.z + HULL_H);
			const margin = Math.min(mW, mLow, mHigh);
			return { crossed: true, lateral: lat, z: p.z, inside: margin >= 0, margin, tick: i };
		}
		const al = (p.x - g.center.x) * d.x + (p.y - g.center.y) * d.y;
		if (Math.abs(lat) > 4 * g.halfW + 512 || Math.abs(al) > 4 * g.halfH + 512) continue;
		let margin = Math.min(g.halfW - reachW - Math.abs(lat), g.halfH - reachA - Math.abs(al));
		// The hull must still be inside the hole when its top drops below the slab's underside.
		const under = g.center.z - (g.depth ?? 0) - HULL_H;
		for (let j = i; j < path.length; j++) {
			if (path[j]!.z > under) continue;
			const q = path[j]!;
			const ql = (q.x - g.center.x) * l.x + (q.y - g.center.y) * l.y;
			const qa = (q.x - g.center.x) * d.x + (q.y - g.center.y) * d.y;
			margin = Math.min(margin, g.halfW - reachW - Math.abs(ql), g.halfH - reachA - Math.abs(qa));
			break;
		}
		return { crossed: true, lateral: lat, z: al, inside: margin >= 0, margin, tick: i };
	}
	return { crossed: false, lateral: NaN, z: NaN, inside: false, margin: -Infinity, tick: -1 };
}

// ---------------------------------------------------------------------------
// Spirals

/**
 * Peak steps of a spiral: `turn` degrees (+ = left) in steps of at most
 * `maxStep`, the radius changing linearly with the angle from r0 to r1, at a
 * constant `grade` (flat or descending: rampChain only bends on grades >= 0).
 * The face must be on the inside of the turn (a left face for a left spiral).
 */
export function spiralSteps(turn: number, r0: number, r1: number, grade: number, maxStep = 4): PeakStep[] {
	const n = Math.max(1, Math.ceil(Math.abs(turn) / maxStep - 1e-9));
	const step = turn / n;
	return Array.from({ length: n }, (_, i) => {
		const r = r0 + ((r1 - r0) * (i + 0.5)) / n;
		return { length: r * Math.abs(step) * DEG, turn: step, grade };
	});
}

// ---------------------------------------------------------------------------
// Route bot

/** How the bot flies to a chain (or, as a route's `exit`, off the last one). */
export type AirPlan =
	| { kind: 'none' }
	/** Strafe towards the target chain's `aim` point (set by chainAfter). */
	| { kind: 'aim' }
	/** Strafe through these gates' centres in order, then `then` (default none). */
	| { kind: 'via'; gates: Gate[]; then?: 'aim' | 'none' | { yaw: number }; lead?: number }
	/** Full-rate strafe turn to a heading. */
	| { kind: 'yaw'; yaw: number };

export interface RouteStep {
	chain: RampChain;
	/** Face fraction to ride at (0 = peak, 1 = base edge; default 0.45). */
	target?: number;
	/** Target changes along the chain: from horizontal chain distance `from` on, ride at `target`. */
	ride?: Array<{ from: number; target: number }>;
	/** Flight onto this chain from the previous one (default none). */
	air?: AirPlan;
}

export interface RouteBotState {
	/** Index of the step being ridden or flown to. */
	k: number;
	/** Last chain segment the bot touched on step k (-1 = not on it yet). */
	lastSeg: number;
	/** Ticks since it last touched step k's chain. */
	off: number;
	/** Next gate index of the current via plan. */
	gate: number;
	/** True once the bot has left the last chain (flying the route's exit plan). */
	exited: boolean;
}

export const newRouteState = (k = 0): RouteBotState => ({ k, lastSeg: -1, off: 0, gate: 0, exited: false });

const headingOf = (v: { x: number; y: number }) => Math.atan2(v.y, v.x) / DEG;
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/**
 * Chain hit when the hull's feet are within 48 units above that chain's face
 * (more on wall-surf faces, where the hull's corner touches the face higher up).
 */
export function onChainFace(c: RampChain, p: PlayerState): ChainHit | null {
	const h = locateOnChain(c, p.origin);
	const reach = Math.max(48, 23 * Math.tan(c.angle * DEG) + 20);
	return h && p.origin.z - h.faceZ < reach && p.origin.z - h.faceZ > -24 ? h : null;
}

function steerTo(p: PlayerState, x: number, y: number): number {
	const v = p.velocity;
	const d = wrap(headingOf({ x: x - p.origin.x, y: y - p.origin.y }) - headingOf(v));
	return Math.abs(d) > 1 ? (d > 0 ? -450 : 450) : 0;
}

function airInput(plan: AirPlan | undefined, chain: RampChain | undefined, st: RouteBotState, p: PlayerState): number {
	if (!plan || plan.kind === 'none') return 0;
	const v = p.velocity;
	const vh = Math.hypot(v.x, v.y);
	if (plan.kind === 'yaw') {
		const d = wrap(plan.yaw - headingOf(v));
		return Math.abs(d) > 1.5 ? (d > 0 ? -450 : 450) : 0;
	}
	if (plan.kind === 'via') {
		while (st.gate < plan.gates.length) {
			const g = plan.gates[st.gate]!;
			if (g.type === 'floor' ? p.origin.z < g.center.z : (p.origin.x - g.center.x) * dirXY(g.yaw).x + (p.origin.y - g.center.y) * dirXY(g.yaw).y > 0) st.gate++;
			else break;
		}
		const g = plan.gates[st.gate];
		if (g) {
			// Stop correcting just before the opening (hold the line through it).
			const ahead = (g.center.x - p.origin.x) * v.x + (g.center.y - p.origin.y) * v.y;
			if (g.type === 'wall' && ahead < (plan.lead ?? 96) * vh) return 0;
			return steerTo(p, g.center.x, g.center.y);
		}
		if (plan.then && typeof plan.then === 'object') return airInput({ kind: 'yaw', yaw: plan.then.yaw }, chain, st, p);
		if (plan.then !== 'aim') return 0;
	}
	// 'aim' (or via … then aim): steer while the aim point is still well ahead.
	if (!chain?.aim) return 0;
	const ax = chain.aim.x - p.origin.x;
	const ay = chain.aim.y - p.origin.y;
	if (ax * v.x + ay * v.y <= 384 * vh) return 0;
	return steerTo(p, chain.aim.x, chain.aim.y);
}

/**
 * One tick of route input (see the file comment). `st.k` advances once the bot
 * touches the next chain, or has left the current chain's last segment (past
 * its end, or off its face for 4 ticks).
 */
export function routeBotCmd(steps: RouteStep[], exit: AirPlan | undefined, st: RouteBotState, p: PlayerState, gain = 600): { cmd: UserCmd; seg: number } {
	const cur = steps[st.k]!;
	const next = steps[st.k + 1];
	const hitCur = onChainFace(cur.chain, p);
	if (hitCur) {
		st.lastSeg = Math.max(st.lastSeg, hitCur.seg);
		st.off = 0;
	} else st.off++;
	const n = cur.chain.ramps.length;
	const leftCur = st.lastSeg >= n - 1 && !hitCur && (pastEnd(cur.chain, p.origin) > 0 || st.off >= 4);
	if (next && ((st.lastSeg >= 0 && leftCur) || onChainFace(next.chain, p))) {
		st.k++;
		st.lastSeg = -1;
		st.off = 0;
		st.gate = 0;
		return routeBotCmd(steps, exit, st, p, gain);
	}
	if (!next && leftCur && !st.exited) {
		st.exited = true;
		st.gate = 0;
	}
	const v = p.velocity;
	const yaw = headingOf(v);
	const c = cur.chain;
	const hit = st.exited ? null : hitCur;
	if (hit) {
		let target = cur.target ?? 0.45;
		for (const r of cur.ride ?? []) if (hit.along >= r.from) target = r.target;
		const fd = faceDir(c, hit.seg);
		const down = v.x * fd.x + v.y * fd.y;
		const want = Math.max(-300, Math.min(300, gain * (target - hit.frac)));
		const into = c.side === 'left' ? 450 : -450; // + sidemove = right; a left face has its peak to the right
		// Look along the velocity (strafes then turn it without braking); when sliding mostly down the face
		// (slow, e.g. just after dropping in), look along the ramp instead so the strafe pushes into the face.
		const segYaw = c.yaws[hit.seg]!;
		const sd = dirXY(segYaw);
		const view = v.x * sd.x + v.y * sd.y < 400 && Math.abs(wrap(yaw - segYaw)) > 25 ? segYaw : yaw;
		return { cmd: { pitch: 0, yaw: view, forwardmove: 0, sidemove: down > want ? into : 0, buttons: 0 }, seg: hit.seg };
	}
	const sidemove = st.exited ? airInput(exit, undefined, st, p) : st.lastSeg >= 0 ? 0 : airInput(cur.air, c, st, p);
	return { cmd: { pitch: 0, yaw, forwardmove: 0, sidemove, buttons: 0 }, seg: -1 };
}

export type MoveFn = (world: CollisionWorld, p: PlayerState, cmd: UserCmd, cvars: Cvars, dt: number) => void;

export interface RouteSample {
	tick: number;
	pos: Vec3;
	vel: Vec3;
	speed: number;
	/** Route step the bot is on / flying to. */
	k: number;
	/** Segment of step k's chain under the bot (-1 = in the air). */
	seg: number;
	surfing: boolean;
	onGround: boolean;
	exited: boolean;
}

/** Run the route bot from `p` until `stop` returns a reason or `seconds` pass ('timeout'). */
export function runRouteBot(o: {
	world: CollisionWorld;
	move: MoveFn;
	cvars: Cvars;
	dt: number;
	p: PlayerState;
	steps: RouteStep[];
	exit?: AirPlan;
	seconds: number;
	state?: RouteBotState;
	stop?: (p: PlayerState, st: RouteBotState) => string | null;
	gain?: number;
}): { samples: RouteSample[]; reason: string; state: RouteBotState } {
	const st = o.state ?? newRouteState();
	const samples: RouteSample[] = [];
	const n = Math.round(o.seconds / o.dt);
	for (let t = 0; t < n; t++) {
		const { cmd, seg } = routeBotCmd(o.steps, o.exit, st, o.p, o.gain);
		o.move(o.world, o.p, cmd, o.cvars, o.dt);
		const v = o.p.velocity;
		samples.push({
			tick: t,
			pos: { ...o.p.origin },
			vel: { ...v },
			speed: Math.hypot(v.x, v.y, v.z),
			k: st.k,
			seg,
			surfing: o.p.surfing,
			onGround: o.p.onGround,
			exited: st.exited
		});
		const r = o.stop?.(o.p, st);
		if (r) return { samples, reason: r, state: st };
	}
	return { samples, reason: 'timeout', state: st };
}

// ---------------------------------------------------------------------------
// Placement helpers

/** Point-mass flight: position after horizontal distance `dist` from p along heading `yaw`, launched at horizontal speed vh with vertical speed vz. */
export function ballisticAt(p: Vec3, yaw: number, vh: number, vz: number, dist: number, gravity = 800): Vec3 {
	const d = dirXY(yaw);
	const t = dist / vh;
	return v3(p.x + d.x * dist, p.y + d.y * dist, p.z + vz * t - 0.5 * gravity * t * t);
}

/**
 * Catch teleport under a group of brushes: their XY bounds plus `margin`, from
 * `gap` below their lowest point down `depth`; trimmed (bottom raised or one
 * side cut, keeping the largest volume) wherever a box in `avoid` reaches in.
 */
export function catchUnder(group: BrushDef[], avoid: Box3[], to: 'stage' | 'start', margin: number, gap: number, depth: number): Zone {
	const b = boundsOf(group);
	let c: Box3 = { min: v3(b.min.x - margin, b.min.y - margin, b.min.z - gap - depth), max: v3(b.max.x + margin, b.max.y + margin, b.min.z - gap) };
	const vol = (x: Box3) => Math.max(0, x.max.x - x.min.x) * Math.max(0, x.max.y - x.min.y) * Math.max(0, x.max.z - x.min.z);
	const hit = (a: Box3, o: Box3) =>
		a.min.x < o.max.x && o.min.x < a.max.x && a.min.y < o.max.y && o.min.y < a.max.y && a.min.z < o.max.z && o.min.z < a.max.z;
	const PAD = 32;
	for (let pass = 0; pass < 4; pass++)
		for (const o of avoid) {
			if (!hit(c, o)) continue;
			const options: Box3[] = [
				{ min: v3(c.min.x, c.min.y, o.max.z + PAD), max: c.max },
				{ min: c.min, max: v3(c.max.x, c.max.y, o.min.z - PAD) },
				{ min: v3(o.max.x + PAD, c.min.y, c.min.z), max: c.max },
				{ min: c.min, max: v3(o.min.x - PAD, c.max.y, c.max.z) },
				{ min: v3(c.min.x, o.max.y + PAD, c.min.z), max: c.max },
				{ min: c.min, max: v3(c.max.x, o.min.y - PAD, c.max.z) }
			].filter((x) => x.max.x > x.min.x && x.max.y > x.min.y && x.max.z > x.min.z);
			c = options.reduce((best, x) => (vol(x) > vol(best) ? x : best), options[0] ?? c);
		}
	if (c.max.z - c.min.z < 128 || vol(c) === 0) throw new Error('catchUnder: no room under the group');
	return { type: 'teleport', min: c.min, max: c.max, to };
}

// ---------------------------------------------------------------------------
// Chain placement from the previous chain's exit (first used by surf_ochre)

export interface Leg {
	label: string;
	side: 'left' | 'right';
	angle: number;
	halfWidth: number;
	steps: PeakStep[];
	/** Flight heading off the previous chain, relative to its last segment, degrees towards its base (riders exit sliding down-face). */
	drift: number;
	/**
	 * New chain heading relative to the flight, degrees. 'peak' approach: the
	 * flight crosses the new peak line and lands diagonally down the face (the
	 * peak must stay under the flight). 'base' approach: the flight comes in over
	 * the open base edge and lands on a face rising towards it (opposite-face
	 * transfer, robust to where the rider exits).
	 */
	delta: number;
	approach?: 'peak' | 'base';
	ahead: number;
	/** Design launch speed (sets the ballistic drop). */
	speed: number;
	/** Extra drop below the ballistic one: margin over the new peak. */
	extra?: number;
	back?: number;
	frac?: number;
	/** Sideways shift of the landing point (+ = left of the flight), for riders who exit off the design line. */
	shift?: number;
	material?: string;
}

const towardsBase = (c: RampChain) => (c.side === 'left' ? 1 : -1);

export interface Flight {
	p: Vec3;
	yaw: number;
	vh: number;
	vz: number;
}

/** Flight of a leg off `prev` (point mass, design speed): launch point, heading, horizontal and vertical speed. */
export function legFlight(prev: RampChain, l: Pick<Leg, 'drift' | 'speed'>): Flight {
	const ex = chainExit(prev);
	const vh = l.speed / Math.sqrt(1 + ex.grade * ex.grade);
	return { p: ex.point, yaw: ex.yaw + l.drift * towardsBase(prev), vh, vz: -ex.grade * vh };
}

/** Point on a flight `a` units ahead (and `lat` to the left of its heading). */
export function flightPoint(f: Flight, a: number, lat = 0, gravity = 800): Vec3 {
	const d = dirXY(f.yaw);
	const t = a / f.vh;
	return v3(f.p.x + d.x * a - d.y * lat, f.p.y + d.y * a + d.x * lat, f.p.z + f.vz * t - 0.5 * gravity * t * t);
}

/**
 * Next chain, landed on from the previous chain's exit (see Leg): the landing
 * point lies `ahead` along the flight heading, at the ballistic drop for the
 * design speed plus `extra` (drift, extra and shift are tuned against a route bot).
 */
export function leg(prev: RampChain, l: Leg, material: string): RampChain {
	const ex = chainExit(prev);
	const flight = { ...ex, yaw: ex.yaw + l.drift * towardsBase(prev) };
	const yaw = flight.yaw + l.delta * (l.side === 'left' ? -1 : 1) * (l.approach === 'base' ? -1 : 1);
	const base = { label: l.label, yaw, side: l.side, angle: l.angle, halfWidth: l.halfWidth, material: l.material ?? material, steps: l.steps, ahead: l.ahead };
	const drop = transferDrop({ ...base, speed: l.speed, exitGrade: ex.grade }) + (l.extra ?? 0);
	return chainAfter(flight, { ...base, drop, shift: l.shift, back: l.back ?? l.ahead - 320, frac: l.frac ?? (l.approach === 'base' ? 0.6 : 0.2) });
}

export interface TurnLanding {
	label: string;
	/** Launch speed along the previous chain's exit. */
	speed: number;
	/** Heading the rider strafes to (full rate). */
	aimYaw: number;
	/** Seconds after finishing the turn at which the rider touches down. */
	settle: number;
	/** New chain heading. */
	yaw: number;
	side: 'left' | 'right';
	angle: number;
	halfWidth: number;
	steps: PeakStep[];
	back: number;
	frac: number;
	/** Extra height of the flight over the landing point (default 0). */
	drop?: number;
	material: string;
}

/** Chain landed on after a full-rate air-strafe turn to `aimYaw` off `prev`. */
export function chainAfterTurn(prev: RampChain, o: TurnLanding): RampChain {
	const ex = chainExit(prev);
	const vh = o.speed / Math.sqrt(1 + ex.grade * ex.grade);
	const d0 = dirXY(ex.yaw);
	const path = airTurnFlight(ex.point, v3(d0.x * vh, d0.y * vh, -ex.grade * vh), o.aimYaw, { maxTime: 8 });
	const done = path.findIndex((s) => Math.abs(yawDelta(Math.atan2(s.v.y, s.v.x) / DEG, o.aimYaw)) <= 1.5);
	if (done < 0) throw new Error(`${o.label}: turn never completes`);
	const q = path[Math.min(path.length - 1, done + Math.round(o.settle * 256))]!.p;
	const land = v3(q.x, q.y, q.z - (o.drop ?? 0));
	const d = dirXY(o.yaw);
	const n = o.side === 'left' ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x };
	const w = o.frac * o.halfWidth;
	const g = o.steps[0]!.grade ?? 0;
	const start = v3(land.x - d.x * o.back - n.x * w, land.y - d.y * o.back - n.y * w, land.z + w * Math.tan(o.angle * DEG) + g * o.back);
	const c = rampChain({ label: o.label, start, yaw: o.yaw, side: o.side, angle: o.angle, halfWidth: o.halfWidth, material: o.material, steps: o.steps });
	c.aim = land;
	return c;
}
