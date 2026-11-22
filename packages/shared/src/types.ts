/** Shared geometric types. All coordinates are Hammer units, Z-up (Source convention). */
export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export interface Plane {
	normal: Vec3;
	dist: number;
}

export interface AABB {
	min: Vec3;
	max: Vec3;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
