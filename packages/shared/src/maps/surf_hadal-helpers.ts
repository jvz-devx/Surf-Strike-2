/**
 * Placement helpers for surf_hadal: single-faced ramps chained by their
 * transfer geometry, respawn ledges over a ramp's face, flight sampling for
 * checkpoint zones and catch triggers that stay clear of other brushes.
 */
import type { Vec3 } from '../types.ts';
import type { BrushDef, Zone } from './types.ts';
import {
	along,
	boundsOf,
	dirXY,
	launchStates,
	platform,
	ramp,
	rampExits,
	rampFrame,
	simulateTransfer,
	v3,
	type Box3,
	type BoxBrush,
	type RampBrush,
	type SurfTransfer
} from './helpers.ts';

const DEG = Math.PI / 180;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const rv = (p: Vec3) => v3(r3(p.x), r3(p.y), r3(p.z));

export interface Leg {
	/** Heading of the new ramp's peak line, degrees. */
	yaw: number;
	/** Which side of the peak the single sloped face is on. */
	side: 'left' | 'right';
	length: number;
	/** Peak descent per unit of length (negative = climbs: an up-ramp). */
	grade: number;
	angle: number;
	/** Horizontal width of the face. */
	hw: number;
	/**
	 * Horizontal distance from the previous ramp's exit (mid-face at its `to`
	 * end), straight along its heading, to where the flight line crosses the
	 * new face's middle line.
	 */
	ahead: number;
	/** How far along the new ramp that crossing is (0 for straight transfers: it starts right there). */
	back: number;
	/** Vertical drop from the exit point to the new face's middle at the crossing. */
	drop: number;
}

/** Unit vector from the peak line towards the face's base edge (horizontal). */
export function faceNormalXY(yaw: number, side: 'left' | 'right'): { x: number; y: number } {
	const u = dirXY(yaw);
	const s = side === 'left' ? 1 : -1;
	return { x: -u.y * s, y: u.x * s };
}

/** Heading of a ramp's peak line, degrees. */
export function rampYaw(r: RampBrush): number {
	const f = rampFrame(r);
	return Math.atan2(f.dir.y, f.dir.x) / DEG;
}

/** Ramp that the flight off `prev`'s exit lands on (see Leg). */
export function nextRamp(prev: RampBrush, leg: Leg, material: string): RampBrush {
	const e = rampExits(prev)[0]!;
	const d = rampFrame(prev).dir;
	const p = v3(e.x + d.x * leg.ahead, e.y + d.y * leg.ahead, 0);
	const u = dirXY(leg.yaw);
	const n = faceNormalXY(leg.yaw, leg.side);
	const h = leg.hw * Math.tan(leg.angle * DEG);
	const from = v3(
		p.x - (n.x * leg.hw) / 2 - u.x * leg.back,
		p.y - (n.y * leg.hw) / 2 - u.y * leg.back,
		e.z - leg.drop + h / 2 + leg.grade * leg.back
	);
	return ramp({
		from: rv(from),
		to: rv(along(from, leg.yaw, leg.length, -leg.length * leg.grade)),
		angle: leg.angle,
		halfWidth: leg.hw,
		side: leg.side,
		material
	});
}

/**
 * Respawn ledge `rise` above `r`'s start: walking off its edge along the ramp
 * heading drops onto the middle of the face, `inset` units along the ramp.
 */
export function ledgeOver(r: RampBrush, rise: number, material: string, size = 256, inset = 96): BoxBrush {
	const yaw = rampYaw(r);
	const u = dirXY(yaw);
	const n = faceNormalXY(yaw, r.side as 'left' | 'right');
	const launch = v3(r.from.x + u.x * inset + (n.x * r.halfWidth) / 2, r.from.y + u.y * inset + (n.y * r.halfWidth) / 2, r.from.z + rise);
	const t = Math.min(u.x === 0 ? Infinity : size / 2 / Math.abs(u.x), u.y === 0 ? Infinity : size / 2 / Math.abs(u.y));
	return platform(v3(Math.round(launch.x - u.x * t), Math.round(launch.y - u.y * t), Math.round(launch.z)), size, size, material);
}

/** Hull-sized box (32 × 32 × 72) at a player origin, grown by `pad`. */
export function hullBox(p: Vec3, pad = 0): Box3 {
	return { min: v3(p.x - 16 - pad, p.y - 16 - pad, p.z - pad), max: v3(p.x + 16 + pad, p.y + 16 + pad, p.z + 72 + pad) };
}

export function boxesOverlap(a: Box3, b: Box3): boolean {
	return a.min.x < b.max.x && b.min.x < a.max.x && a.min.y < b.max.y && b.min.y < a.max.y && a.min.z < b.max.z && b.min.z < a.max.z;
}

/** Point-mass flight samples (every 1/128 s) up to the landing, for each launch state at each speed. */
export function flightSamples(tr: SurfTransfer, speeds: number[], gravity = 800, fromFraction = 0): Vec3[] {
	const out: Vec3[] = [];
	for (const speed of speeds) {
		const res = simulateTransfer(tr, speed, gravity);
		launchStates(tr.from, speed).forEach(({ p, vel }, i) => {
			const end = res[i]!.time;
			for (let t = end * fromFraction; t <= end; t += 1 / 128) {
				out.push(v3(p.x + vel.x * t, p.y + vel.y * t, p.z + vel.z * t - 0.5 * gravity * t * t));
			}
		});
	}
	return out;
}

/** Axis-aligned bounds of points, padded. */
export function boundsOfPoints(ps: Vec3[], pad: number): Box3 {
	return {
		min: v3(Math.min(...ps.map((p) => p.x)) - pad, Math.min(...ps.map((p) => p.y)) - pad, Math.min(...ps.map((p) => p.z)) - pad),
		max: v3(Math.max(...ps.map((p) => p.x)) + pad, Math.max(...ps.map((p) => p.y)) + pad, Math.max(...ps.map((p) => p.z)) + pad)
	};
}

const overlapXY = (a: Box3, b: Box3) => a.min.x < b.max.x && b.min.x < a.max.x && a.min.y < b.max.y && b.min.y < a.max.y;

/**
 * Catch trigger under one section: the section's XY bounds plus `margin`,
 * from `gap` below its lowest point down `depth`. Wherever one of `avoid`
 * (other brushes' bounds, other zones) reaches into that volume, the box is
 * trimmed (raise the bottom, or cut one side) keeping the largest volume, so
 * it never overlaps any of them.
 */
export function catchUnder(
	group: BrushDef[],
	avoid: Box3[],
	margin: { x: number; y: number },
	gap: number,
	depth = 2048
): Zone {
	const b = boundsOf(group);
	let box: Box3 = {
		min: v3(b.min.x - margin.x, b.min.y - margin.y, b.min.z - gap - depth),
		max: v3(b.max.x + margin.x, b.max.y + margin.y, b.min.z - gap)
	};
	const vol = (x: Box3) => Math.max(0, x.max.x - x.min.x) * Math.max(0, x.max.y - x.min.y) * Math.max(0, x.max.z - x.min.z);
	const PAD = 32;
	for (const ob of avoid) {
		const hits = overlapXY(box, ob) && ob.max.z > box.min.z && ob.min.z < box.max.z;
		if (!hits) continue;
		const options: Box3[] = [
			{ min: v3(box.min.x, box.min.y, ob.max.z + PAD), max: box.max },
			{ min: v3(ob.max.x + PAD, box.min.y, box.min.z), max: box.max },
			{ min: box.min, max: v3(ob.min.x - PAD, box.max.y, box.max.z) },
			{ min: v3(box.min.x, ob.max.y + PAD, box.min.z), max: box.max },
			{ min: box.min, max: v3(box.max.x, ob.min.y - PAD, box.max.z) }
		];
		box = options.reduce((best, x) => (vol(x) > vol(best) ? x : best));
	}
	if (box.max.z - box.min.z < 128 || vol(box) === 0) throw new Error('catchUnder: no room under the section');
	return { type: 'teleport', min: box.min, max: box.max, to: 'start' };
}
