import type { Vec3 } from '../types.ts';

/** Small Vec3 helpers shared by collision and movement. Allocating ones are for build time only. */

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copy = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
	x: a.y * b.z - a.z * b.y,
	y: a.z * b.x - a.x * b.z,
	z: a.x * b.y - a.y * b.x
});
export const length = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

/** Normalize in place; returns the original length (like Source's VectorNormalize). */
export function normalizeInPlace(a: Vec3): number {
	const l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
	if (l > 0) {
		a.x /= l;
		a.y /= l;
		a.z /= l;
	}
	return l;
}

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
	out.x = x;
	out.y = y;
	out.z = z;
	return out;
}

export function assign(out: Vec3, a: Vec3): Vec3 {
	out.x = a.x;
	out.y = a.y;
	out.z = a.z;
	return out;
}
