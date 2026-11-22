/**
 * Zombie hitboxes (docs/modes.md#zombies): a vertical cylinder for the body
 * and a sphere for the head, matching the hunched low-poly zombie the client
 * draws (head pushed forward along the zombie's yaw). Origins are feet
 * positions, Source axes (Z up), yaw in degrees.
 */
import type { Vec3 } from '../../types.ts';

/** Body cylinder: radius and height range above the feet. */
export const ZOMBIE_BODY = { radius: 13, z0: 0, z1: 54 } as const;
/** Head sphere: forward offset along the yaw, height of its centre, radius. */
export const ZOMBIE_HEAD = { forward: 7.5, z: 65, radius: 7.5 } as const;

export interface HitboxPose {
	x: number;
	y: number;
	z: number;
	yaw: number;
}

export interface RayHit {
	/** Distance along the (unit) ray to the first hitbox surface. */
	t: number;
	head: boolean;
}

/** Ray (unit `d`) vs sphere; returns the entry distance >= 0, or -1. */
export function raySphere(o: Vec3, d: Vec3, cx: number, cy: number, cz: number, r: number): number {
	const ox = o.x - cx;
	const oy = o.y - cy;
	const oz = o.z - cz;
	const b = ox * d.x + oy * d.y + oz * d.z;
	const c = ox * ox + oy * oy + oz * oz - r * r;
	if (c > 0 && b > 0) return -1;
	const disc = b * b - c;
	if (disc < 0) return -1;
	const t = -b - Math.sqrt(disc);
	return t < 0 ? 0 : t;
}

/** Ray (unit `d`) vs capped vertical cylinder; returns the entry distance >= 0, or -1. */
export function rayCylinder(o: Vec3, d: Vec3, cx: number, cy: number, z0: number, z1: number, r: number): number {
	let tMin = -Infinity;
	let tMax = Infinity;
	// Side wall: |(o + d t) - c|_xy <= r.
	const ox = o.x - cx;
	const oy = o.y - cy;
	const a = d.x * d.x + d.y * d.y;
	const c = ox * ox + oy * oy - r * r;
	if (a < 1e-12) {
		if (c > 0) return -1;
	} else {
		const b = ox * d.x + oy * d.y;
		const disc = b * b - a * c;
		if (disc < 0) return -1;
		const s = Math.sqrt(disc);
		tMin = (-b - s) / a;
		tMax = (-b + s) / a;
	}
	// Caps: z0 <= o.z + d.z t <= z1.
	if (Math.abs(d.z) < 1e-12) {
		if (o.z < z0 || o.z > z1) return -1;
	} else {
		let ta = (z0 - o.z) / d.z;
		let tb = (z1 - o.z) / d.z;
		if (ta > tb) [ta, tb] = [tb, ta];
		if (ta > tMin) tMin = ta;
		if (tb < tMax) tMax = tb;
	}
	if (tMin > tMax || tMax < 0) return -1;
	return tMin < 0 ? 0 : tMin;
}

/** Head sphere centre of a pose. */
export function headCentre(p: HitboxPose): Vec3 {
	const r = (p.yaw * Math.PI) / 180;
	return { x: p.x + Math.cos(r) * ZOMBIE_HEAD.forward, y: p.y + Math.sin(r) * ZOMBIE_HEAD.forward, z: p.z + ZOMBIE_HEAD.z };
}

/**
 * First hitbox a ray hits within `maxT`. The head counts when the ray reaches
 * it before (or without) the body: a ray from below that passes the body
 * first is a body hit.
 */
export function rayZombie(o: Vec3, d: Vec3, p: HitboxPose, maxT: number): RayHit | null {
	const h = headCentre(p);
	const th = raySphere(o, d, h.x, h.y, h.z, ZOMBIE_HEAD.radius);
	const tb = rayCylinder(o, d, p.x, p.y, p.z + ZOMBIE_BODY.z0, p.z + ZOMBIE_BODY.z1, ZOMBIE_BODY.radius);
	const head = th >= 0 && th <= maxT && (tb < 0 || th <= tb);
	if (head) return { t: th, head: true };
	if (tb >= 0 && tb <= maxT) return { t: tb, head: false };
	return null;
}

/**
 * Melee check: the zombie's nearest point (body axis clamped to its height)
 * is within `reach` of the eye and inside the aim cone. Returns the distance
 * and whether the aim ray itself goes through the head, or null.
 */
export function meleeZombie(eye: Vec3, d: Vec3, p: HitboxPose, reach: number, coneDeg: number): RayHit | null {
	const zc = Math.max(p.z + ZOMBIE_BODY.z0, Math.min(p.z + ZOMBIE_BODY.z1, eye.z));
	const vx = p.x - eye.x;
	const vy = p.y - eye.y;
	const vz = zc - eye.z;
	const dist = Math.hypot(vx, vy, vz);
	const surface = Math.max(0, dist - ZOMBIE_BODY.radius);
	if (surface > reach) return null;
	if (dist > 1e-6) {
		const cos = (vx * d.x + vy * d.y + vz * d.z) / dist;
		// Very close zombies count even at the edge of the screen.
		const limit = Math.cos(((dist < ZOMBIE_BODY.radius * 2 ? coneDeg * 1.6 : coneDeg) * Math.PI) / 180);
		if (cos < limit) return null;
	}
	const ray = rayZombie(eye, d, p, reach + ZOMBIE_BODY.radius * 2);
	return { t: surface, head: ray?.head ?? false };
}
