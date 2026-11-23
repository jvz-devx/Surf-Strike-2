/**
 * Per-frame view of the crowd (docs/characters.md): which characters are on
 * screen, how far they are, and how much detail the crowd can afford.
 */
import * as THREE from 'three';

const m = new THREE.Matrix4();

export class CrowdView {
	/** Seconds since the last frame (capped). */
	dt = 0;
	private last = NaN;
	private readonly cam = new THREE.Vector3();
	private readonly frustum = new THREE.Frustum();
	private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 64);
	private count = 0;
	private lastCount = 0;

	begin(timeSec: number, camera: THREE.Camera): void {
		this.dt = Number.isNaN(this.last) ? 0 : Math.max(0, Math.min(0.25, timeSec - this.last));
		this.last = timeSec;
		camera.updateMatrixWorld();
		this.cam.setFromMatrixPosition(camera.matrixWorld);
		this.frustum.setFromProjectionMatrix(m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
		this.lastCount = this.count;
		this.count = 0;
	}

	/**
	 * Effective distance of a character (feet position), or −1 when it is off
	 * screen. In a big crowd distances count for more, so LODs switch closer.
	 */
	distance(p: THREE.Vector3): number {
		this.sphere.center.set(p.x, p.y + 36, p.z);
		if (!this.frustum.intersectsSphere(this.sphere)) return -1;
		this.count++;
		return p.distanceTo(this.cam) * crowdScale(this.lastCount);
	}
}

/** Distance factor for `n` characters on screen: 1 up to 16, 2.2 at 96 and more. */
export function crowdScale(n: number): number {
	return 1 + 1.2 * Math.max(0, Math.min(1, (n - 16) / 80));
}
