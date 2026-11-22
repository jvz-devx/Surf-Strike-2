/**
 * World coordinates stay in Hammer units. Source is Z-up, Three.js is Y-up:
 * Source (x, y, z) → Three (x, z, −y). This is a proper rotation, so face
 * winding (counter-clockwise from outside) is preserved.
 */
import type { Vec3 } from '@surf/shared';
import * as THREE from 'three';

export function toThree(v: Vec3, out = new THREE.Vector3()): THREE.Vector3 {
	return out.set(v.x, v.z, -v.y);
}

export function setThree(out: THREE.Vector3, x: number, y: number, z: number): THREE.Vector3 {
	return out.set(x, z, -y);
}

/** Write a Source vector into a flat array as Three coordinates. */
export function pushThree(arr: number[], v: Vec3): void {
	arr.push(v.x, v.z, -v.y);
}

const DEG = Math.PI / 180;

/**
 * Apply Source view angles (pitch + = down, yaw 0 = +X counter-clockwise)
 * to a Three camera (looks along −Z).
 */
export function applyViewAngles(obj: THREE.Object3D, pitchDeg: number, yawDeg: number): void {
	obj.rotation.order = 'YXZ';
	obj.rotation.set(-pitchDeg * DEG, yawDeg * DEG - Math.PI / 2, 0);
}
