/**
 * Spent cases and links (docs/modes.md#infected): they leave the ejection port with spin and the
 * player's velocity, fall, bounce on the world a few times, rest and go. Pooled: CASE_MAX slots in flat arrays and one
 * instanced mesh per kind and scene, so a shot allocates nothing here and the oldest case makes room for a new one. Owned by
 * ZombieRenderer.
 *
 * My own cases start in the viewmodel scene, which has its own camera, field of view and scale, and go over into the world
 * one. Their motion is always in the world: `toViewmodel` puts a point of the world camera's view where the viewmodel camera
 * sees it on the same pixel, at the depth of the gun, so nothing jumps when the scene changes.
 */
import type { CollisionWorld, Vec3, WeaponId } from '@surf/shared';
import * as THREE from 'three';
import type { GunId } from './gun-rig.js';

/** Cases and links that exist at once (the oldest goes first), and with reduced motion. */
export const CASE_MAX = 96;
export const CASE_MAX_REDUCED = 24;
/** Cases of other players closer than this to the camera (units). */
export const CASE_OTHERS = 700;
/** Own cases are drawn over the gun for this long (ms). */
export const CASE_HAND_MS = 110;
/** A resting case stays this long and shrinks away over the last part (ms). */
export const CASE_REST_MS = 5000;
export const CASE_FADE_MS = 500;
/** Longest life of a case that never comes to rest (ms). */
const CASE_FLY_MS = 4000;
const GRAVITY = 800;
export const CASE_BOUNCES = 4;
/** Speed kept off the surface, and along it, in a bounce. */
const BOUNCE = 0.4;
const SLIDE = 0.65;
/** Slower than this off the ground after a bounce, it stays (u/s). */
const REST_SPEED = 45;
/** The way ahead is traced this far in time (s). */
const AHEAD = 0.05;
/** Size of a case in a world unit against a model unit of the first-person guns. */
const MODEL_UNIT = 0.9;

export type CaseKind = 'small' | 'rifle' | 'fifty' | 'shell' | 'link';
const KINDS: readonly CaseKind[] = ['small', 'rifle', 'fifty', 'shell', 'link'];
/** Length and radius (world units), a little over life-size so the brass reads. */
const SIZE: Readonly<Record<CaseKind, readonly [number, number]>> = {
	small: [1, 0.25],
	rifle: [2.2, 0.28],
	fifty: [4.2, 0.46],
	shell: [2.9, 0.46],
	link: [0.6, 0.35]
};

/** How a case leaves (u/s in the frame of the gun: out along the port, up, forwards). */
export interface Throw {
	out: number;
	up: number;
	ahead: number;
}
/** What a gun throws out, and how: as other players see it, and mine from the hip and fully aimed (an arc up and to the right inside my view). */
export interface CaseDef extends Throw {
	kind: CaseKind;
	link: boolean;
	hip: Throw;
	aimed: Throw;
}
const own = (out: number, up: number, ahead: number): Throw => ({ out, up, ahead });
export const CASES: Readonly<Record<GunId, CaseDef>> = Object.freeze({
	pistol: { kind: 'small', link: false, out: 85, up: 105, ahead: -15, hip: own(70, 150, 70), aimed: own(75, 125, 110) },
	smg: { kind: 'small', link: false, out: 120, up: 75, ahead: 20, hip: own(80, 180, 60), aimed: own(75, 135, 100) },
	lmg: { kind: 'rifle', link: true, out: 125, up: 30, ahead: 25, hip: own(80, 205, 50), aimed: own(85, 165, 70) },
	sniper: { kind: 'rifle', link: false, out: 75, up: 75, ahead: -20, hip: own(80, 180, 60), aimed: own(80, 180, 60) },
	barrett: { kind: 'fifty', link: false, out: 120, up: 85, ahead: 35, hip: own(80, 195, 60), aimed: own(80, 195, 60) },
	striker: { kind: 'shell', link: false, out: 115, up: 80, ahead: 10, hip: own(80, 180, 60), aimed: own(65, 140, 120) }
});
export const caseOf = (w: WeaponId): CaseDef | null => (CASES as Partial<Record<WeaponId, CaseDef>>)[w] ?? null;

/** A camera as the handover sees it: the tangent of half its vertical field of view. */
export interface HandOver {
	/** Viewmodel depth per world depth. */
	k: number;
	/** Half-height tangents of the viewmodel and the world camera. */
	vmTan: number;
	worldTan: number;
}

/**
 * A point in the view of the world camera, put into the view of the viewmodel camera: the same place on the screen, at the
 * depth of the gun. Returns the factor sizes take.
 */
export function toViewmodel(p: THREE.Vector3, h: HandOver): number {
	const s = (h.k * h.vmTan) / h.worldTan;
	p.set(p.x * s, p.y * s, p.z * h.k);
	return s;
}

/** The way back: where in the world view a point of the viewmodel is. */
export function toWorldView(p: THREE.Vector3, h: HandOver): void {
	const s = (h.k * h.vmTan) / h.worldTan;
	p.set(p.x / s, p.y / s, p.z / h.k);
}

/** The gun's share: viewmodel units per world unit of a gun drawn at `scale` (viewmodel units per model unit). */
export const depthScale = (scale: number): number => scale / MODEL_UNIT;

/** A shape along +X, its middle at the origin. */
function caseGeometry(kind: CaseKind): THREE.BufferGeometry {
	const [l, r] = SIZE[kind];
	const g: THREE.BufferGeometry[] = [];
	const color = new THREE.Color();
	const paint = (b: THREE.BufferGeometry, hex: number): THREE.BufferGeometry => {
		color.setHex(hex);
		const n = b.getAttribute('position').count;
		const c = new Float32Array(n * 3);
		for (let i = 0; i < n; i++) color.toArray(c, i * 3);
		b.setAttribute('color', new THREE.BufferAttribute(c, 3));
		return b;
	};
	const BRASS = 0xd9a441;
	const DARK = 0x3a2a14;
	/** Rings along X: [x, radius] of the length and the radius. */
	const lathe = (rings: readonly (readonly [number, number])[], hex: number, sides = 10) => {
		const b = new THREE.LatheGeometry(
			rings.map(([x, y]) => new THREE.Vector2(y * r, (x - 0.5) * l)),
			sides
		);
		b.rotateZ(-Math.PI / 2);
		g.push(paint(b, hex));
	};
	if (kind === 'shell') {
		lathe([[0, 0], [0, 1.12], [0.05, 1.12], [0.05, 1], [0.26, 1]], BRASS);
		lathe([[0.26, 1], [0.97, 0.98], [1, 0.8], [0.9, 0.6], [0.9, 0]], 0xb3261e);
	} else if (kind === 'link') {
		const b = new THREE.BoxGeometry(l, r * 0.5, r * 1.6).toNonIndexed();
		b.deleteAttribute('uv');
		g.push(paint(b, 0x4a4d52));
	} else {
		const neck = kind === 'small' ? 0.94 : 0.66;
		lathe([[0, 0], [0, 1.06], [0.05, 1.06], [0.07, 0.86], [0.11, 1], [kind === 'small' ? 0.9 : 0.74, 0.97], [kind === 'small' ? 0.92 : 0.84, neck], [1, neck], [1, neck * 0.82]], BRASS);
		lathe([[1, neck * 0.82], [0.9, neck * 0.8], [0.9, 0]], DARK, 8);
	}
	// One geometry: positions, normals and colours without an index.
	const parts = g.map((b) => (b.index ? b.toNonIndexed() : b));
	const out = new THREE.BufferGeometry();
	for (const name of ['position', 'normal', 'color'] as const) {
		const n = parts.reduce((s, p) => s + p.getAttribute(name).array.length, 0);
		const a = new Float32Array(n);
		let o = 0;
		for (const p of parts) {
			a.set(p.getAttribute(name).array as Float32Array, o);
			o += p.getAttribute(name).array.length;
		}
		out.setAttribute(name, new THREE.BufferAttribute(a, 3));
	}
	for (const p of [...g, ...parts]) p.dispose();
	return out;
}

const brass = () => new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x8a7448, shininess: 45, emissive: 0x2a1e0c });

const HULL: Vec3 = { x: 0.2, y: 0.2, z: 0.2 };
const HULL_MIN: Vec3 = { x: -0.2, y: -0.2, z: -0.2 };
const A: Vec3 = { x: 0, y: 0, z: 0 };
const B: Vec3 = { x: 0, y: 0, z: 0 };
const V = new THREE.Vector3();
const W = new THREE.Vector3();
const Q = new THREE.Quaternion();
const M = new THREE.Matrix4();
const M2 = new THREE.Matrix4();
const S = new THREE.Vector3();
const AXIS = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);

/** Reduced motion, read once: the media query is the same for the life of a page. */
export const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Casings {
	/** Cases in the world, and those still drawn with the gun. */
	readonly world = new THREE.Group();
	readonly hand = new THREE.Group();
	/** What the cases bounce on; null: a floor below the camera. */
	collision: Pick<CollisionWorld, 'trace'> | null = null;
	/** A case met the ground: where (Source), what it is, how fast. */
	onLand: ((kind: CaseKind, at: Vec3, speed: number) => void) | null = null;
	reduced = reducedMotion();
	private readonly meshes: Record<'world' | 'hand', Map<CaseKind, THREE.InstancedMesh>> = { world: new Map(), hand: new Map() };
	/** One material per scene: their lights differ. */
	private readonly materials = { world: brass(), hand: brass() };
	// Slots (Three space).
	private readonly on = new Uint8Array(CASE_MAX);
	private readonly kind = new Uint8Array(CASE_MAX);
	private readonly own = new Uint8Array(CASE_MAX);
	private readonly pos = new Float32Array(CASE_MAX * 3);
	private readonly vel = new Float32Array(CASE_MAX * 3);
	private readonly rot = new Float32Array(CASE_MAX * 4);
	private readonly lie = new Float32Array(CASE_MAX * 4);
	private readonly spin = new Float32Array(CASE_MAX * 4);
	private readonly size = new Float32Array(CASE_MAX);
	private readonly depth = new Float32Array(CASE_MAX);
	private readonly born = new Float64Array(CASE_MAX);
	private readonly restAt = new Float64Array(CASE_MAX);
	private readonly tracedTo = new Float64Array(CASE_MAX);
	private readonly hitAt = new Float64Array(CASE_MAX);
	private readonly hit = new Float32Array(CASE_MAX * 6);
	private readonly bounces = new Uint8Array(CASE_MAX);
	private next = 0;
	private live = 0;
	private shots = 0;
	private last = -Infinity;
	private readonly eye = new THREE.Vector3();
	private readonly eyeVel = new THREE.Vector3();
	private floor = 0;

	constructor() {
		this.world.name = 'casings';
		this.hand.name = 'casings-hand';
		for (const k of KINDS) {
			const g = caseGeometry(k);
			for (const where of ['world', 'hand'] as const) {
				const m = new THREE.InstancedMesh(g, this.materials[where], where === 'hand' ? 16 : CASE_MAX);
				m.name = 'case-' + k;
				m.count = 0;
				m.visible = false;
				// Anywhere on the map: no single bounding sphere.
				m.frustumCulled = false;
				m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
				this.meshes[where].set(k, m);
				this[where].add(m);
			}
		}
	}

	/** Live cases (tests and debugging). */
	get stats(): { live: number; resting: number; inHand: number } {
		let resting = 0;
		let inHand = 0;
		for (let i = 0; i < CASE_MAX; i++) {
			if (!this.on[i]) continue;
			if (this.restAt[i]! > 0) resting++;
			else if (this.own[i] && this.last - this.born[i]! < CASE_HAND_MS) inHand++;
		}
		return { live: this.live, resting, inHand };
	}

	/** Position (Three space) of the `n`-th live case, for the tests. */
	at(n: number): THREE.Vector3 | null {
		for (let i = 0; i < CASE_MAX; i++) if (this.on[i] && n-- === 0) return new THREE.Vector3().fromArray(this.pos, i * 3);
		return null;
	}

	private slot(): number {
		const cap = this.reduced ? CASE_MAX_REDUCED : CASE_MAX;
		const i = this.next % cap;
		this.next = (i + 1) % cap;
		if (!this.on[i]) this.live++;
		this.on[i] = 1;
		return i;
	}

	private launch(kind: CaseKind, own: boolean, p: THREE.Vector3, v: THREE.Vector3, along: THREE.Vector3, now: number): number {
		const i = this.slot();
		this.kind[i] = KINDS.indexOf(kind);
		this.own[i] = own ? 1 : 0;
		p.toArray(this.pos, i * 3);
		v.toArray(this.vel, i * 3);
		Q.setFromUnitVectors(X, along).toArray(this.rot, i * 4);
		AXIS.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
		// Tumbles end over end, the way it was thrown.
		W.crossVectors(along, v).normalize();
		if (W.lengthSq() > 0.5) AXIS.lerp(W, 0.75).normalize();
		AXIS.toArray(this.spin, i * 4);
		this.spin[i * 4 + 3] = (this.reduced ? 6 : 14) + 14 * Math.random();
		this.size[i] = 1;
		this.depth[i] = 1;
		this.born[i] = now;
		this.restAt[i] = 0;
		this.tracedTo[i] = now;
		this.hitAt[i] = Infinity;
		this.bounces[i] = 0;
		return i;
	}

	/**
	 * My gun throws out a case: `at` and `dir` are the ejection port and its way out in the view of the viewmodel camera,
	 * `h` the two cameras, `aim` how far the gun is aimed (0..1). The case is placed in the world where it is seen.
	 */
	eject(def: CaseDef, at: THREE.Vector3, dir: THREE.Vector3, camera: THREE.Camera, h: HandOver, now: number, aim = 0): void {
		// Fewer with reduced motion: every third shot.
		if (this.reduced && this.shots++ % 3 !== 0) return;
		for (let n = 0; n < (def.link && !this.reduced ? 2 : 1); n++) {
			const link = n === 1;
			V.copy(at);
			toWorldView(V, h);
			V.applyMatrix4(camera.matrixWorld);
			// Out of the port: along its +X as seen, up and ahead in the view.
			const by = (k: keyof Throw) => def.hip[k] + (def.aimed[k] - def.hip[k]) * aim;
			W.copy(dir).setY(dir.y * 0.4).normalize().multiplyScalar(by('out') * (0.85 + 0.3 * Math.random()) * (link ? 0.6 : 1));
			W.y += by('up') * (0.85 + 0.3 * Math.random()) * (link ? 0.4 : 1);
			W.z -= by('ahead') + (Math.random() - 0.5) * 24;
			W.applyQuaternion(Q.setFromRotationMatrix(camera.matrixWorld)).add(this.eyeVel);
			AXIS.set(0, 0, -1).applyQuaternion(Q);
			// A wall nearer than the gun: the case starts this side of it, on the same pixel and as big.
			let near = 1;
			const eye = S.setFromMatrixPosition(camera.matrixWorld);
			if (this.collision) {
				source(eye, A);
				source(V, B);
				const t = this.collision.trace(A, B, HULL_MIN, HULL);
				if (t.fraction < 1) near = Math.max(0.15, t.fraction * 0.9);
			}
			V.sub(eye).multiplyScalar(near).add(eye);
			const i = this.launch(link ? 'link' : def.kind, true, V, W, AXIS, now);
			this.size[i] = near;
			this.depth[i] = h.k / near;
		}
	}

	/** Another player's gun: from a Source point, thrown to the right of `dir`; not far from the camera only. */
	ejectOther(w: WeaponId, at: Vec3, dir: Vec3, vel: Vec3, now: number, delay = 0): void {
		const def = caseOf(w);
		if (!def || this.reduced) return;
		three(at, V);
		if (V.distanceToSquared(this.eye) > CASE_OTHERS * CASE_OTHERS) return;
		const l = Math.hypot(dir.x, dir.y) || 1;
		// Right of the way it points (Source: (y, −x)), in Three space.
		W.set(dir.y / l, 0, dir.x / l).multiplyScalar(def.out * (0.8 + 0.4 * Math.random()));
		W.y += def.up * (0.8 + 0.4 * Math.random());
		W.x += vel.x;
		W.y += vel.z;
		W.z -= vel.y;
		AXIS.set(dir.x / l, 0, -dir.y / l);
		this.launch(def.kind, false, V, W, AXIS, now + delay);
	}

	/** Move everything to `now` and fill the instances; `camera` is the world camera of this frame. */
	update(now: number, camera: THREE.PerspectiveCamera, vmTan: number): void {
		const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
		const worldTan = Math.tan((camera.fov * Math.PI) / 360);
		V.setFromMatrixPosition(camera.matrixWorld);
		if (dt > 0 && this.last !== -Infinity) {
			this.eyeVel.subVectors(V, this.eye).divideScalar((now - this.last) / 1000);
			// A teleport is no velocity.
			if (this.eyeVel.lengthSq() > 4000 * 4000) this.eyeVel.set(0, 0, 0);
		}
		this.eye.copy(V);
		this.floor = V.y - 64;
		this.last = now;
		if (this.live === 0) {
			if (this.shown) this.show();
			return;
		}
		for (let i = 0; i < CASE_MAX; i++) if (this.on[i]) this.step(i, now, dt);
		this.fill(now, camera, vmTan, worldTan);
	}

	private drop(i: number): void {
		this.on[i] = 0;
		this.live--;
	}

	private step(i: number, now: number, dt: number): void {
		const o = i * 3;
		if (now < this.born[i]!) return;
		if (this.restAt[i]! > 0) {
			if (now - this.restAt[i]! > CASE_REST_MS + CASE_FADE_MS) this.drop(i);
			else {
				// Settling onto its side.
				Q.fromArray(this.rot, i * 4).slerp(QB.fromArray(this.lie, i * 4), Math.min(1, dt * 14)).toArray(this.rot, i * 4);
			}
			return;
		}
		if (now - this.born[i]! > CASE_FLY_MS) return this.drop(i);
		// A case that came out in this frame starts where it is.
		let left = Math.min(dt, (now - this.born[i]!) / 1000);
		for (let n = 0; n < 5 && left > 0; n++) {
			const at = now - left * 1000;
			if (this.hitAt[i] === Infinity && at >= this.tracedTo[i]! - 1e-6) {
				this.look(i, at);
				if (!this.on[i]) return;
			}
			// As far as the way is known to be free, or to where it hits.
			const until = Math.min(this.hitAt[i]!, this.tracedTo[i]!);
			const go = Math.min(left, Math.max(0, (until - at) / 1000));
			this.pos[o] = this.pos[o]! + this.vel[o]! * go;
			this.pos[o + 1] = this.pos[o + 1]! + this.vel[o + 1]! * go - 0.5 * GRAVITY * go * go;
			this.pos[o + 2] = this.pos[o + 2]! + this.vel[o + 2]! * go;
			this.vel[o + 1] = this.vel[o + 1]! - GRAVITY * go;
			left -= go;
			if (this.hitAt[i]! <= now - left * 1000 + 1e-6) {
				this.bounce(i, now - left * 1000);
				if (this.restAt[i]! > 0) return;
			}
		}
		AXIS.fromArray(this.spin, i * 4);
		Q.fromArray(this.rot, i * 4).premultiply(QB.setFromAxisAngle(AXIS, this.spin[i * 4 + 3]! * dt)).normalize().toArray(this.rot, i * 4);
	}

	/** Trace the next stretch of the way. */
	private look(i: number, at: number): void {
		const o = i * 3;
		this.tracedTo[i] = at + AHEAD * 1000;
		const px = this.pos[o]!;
		const py = this.pos[o + 1]!;
		const pz = this.pos[o + 2]!;
		const ex = px + this.vel[o]! * AHEAD;
		const ey = py + this.vel[o + 1]! * AHEAD - 0.5 * GRAVITY * AHEAD * AHEAD;
		const ez = pz + this.vel[o + 2]! * AHEAD;
		if (this.collision) {
			A.x = px;
			A.y = -pz;
			A.z = py;
			B.x = ex;
			B.y = -ez;
			B.z = ey;
			const t = this.collision.trace(A, B, HULL_MIN, HULL);
			if (t.startsolid) return this.drop(i);
			if (t.fraction >= 1) return;
			this.hitAt[i] = at + t.fraction * AHEAD * 1000;
			this.hit[i * 6] = t.endpos.x;
			this.hit[i * 6 + 1] = t.endpos.z;
			this.hit[i * 6 + 2] = -t.endpos.y;
			this.hit[i * 6 + 3] = t.plane.normal.x;
			this.hit[i * 6 + 4] = t.plane.normal.z;
			this.hit[i * 6 + 5] = -t.plane.normal.y;
		} else if (ey < this.floor && py >= this.floor && py > ey) {
			const f = (py - this.floor) / (py - ey);
			this.hitAt[i] = at + f * AHEAD * 1000;
			this.hit.set([px + (ex - px) * f, this.floor, pz + (ez - pz) * f, 0, 1, 0], i * 6);
		}
	}

	private bounce(i: number, now: number): void {
		const o = i * 3;
		const h = i * 6;
		const nx = this.hit[h + 3]!;
		const ny = this.hit[h + 4]!;
		const nz = this.hit[h + 5]!;
		this.pos[o] = this.hit[h]! + nx * 0.05;
		this.pos[o + 1] = this.hit[h + 1]! + ny * 0.05;
		this.pos[o + 2] = this.hit[h + 2]! + nz * 0.05;
		const vx = this.vel[o]!;
		const vy = this.vel[o + 1]!;
		const vz = this.vel[o + 2]!;
		const into = -(vx * nx + vy * ny + vz * nz);
		const keep = BOUNCE * (0.75 + 0.5 * Math.random());
		// Along the surface slowed, a little to the side; off it with part of the speed.
		const k = SLIDE;
		this.vel[o] = (vx + nx * into) * k + nx * into * keep + (Math.random() - 0.5) * into * 0.25;
		this.vel[o + 1] = (vy + ny * into) * k + ny * into * keep;
		this.vel[o + 2] = (vz + nz * into) * k + nz * into * keep + (Math.random() - 0.5) * into * 0.25;
		this.spin[i * 4 + 3] = this.spin[i * 4 + 3]! * (0.5 + 0.4 * Math.random());
		this.hitAt[i] = Infinity;
		this.tracedTo[i] = now;
		const first = this.bounces[i] === 0;
		this.bounces[i] = this.bounces[i]! + 1;
		const kind = KINDS[this.kind[i]!]!;
		if (first && kind !== 'link' && this.onLand) {
			A.x = this.pos[o]!;
			A.y = -this.pos[o + 2]!;
			A.z = this.pos[o + 1]!;
			this.onLand(kind, A, into);
		}
		if (ny > 0.7 && (into * keep < REST_SPEED || this.bounces[i]! >= CASE_BOUNCES)) {
			this.restAt[i] = now;
			this.vel[o] = this.vel[o + 1] = this.vel[o + 2] = 0;
			// On its side, the way it points now.
			Q.fromArray(this.rot, i * 4);
			V.set(1, 0, 0).applyQuaternion(Q);
			W.set(nx, ny, nz);
			V.addScaledVector(W, -V.dot(W));
			if (V.lengthSq() < 1e-3) V.set(nz, 0, -nx + 1e-3);
			V.normalize();
			QB.setFromUnitVectors(AXIS.set(1, 0, 0).applyQuaternion(Q), V);
			Q.premultiply(QB).toArray(this.lie, i * 4);
			this.pos[o + 1] = this.pos[o + 1]! + SIZE[kind][1] * this.size[i]!;
		}
	}

	private shown = false;

	/** Hide or show the meshes by their counts. */
	private show(): void {
		this.shown = false;
		for (const where of ['world', 'hand'] as const)
			for (const m of this.meshes[where].values()) {
				if (this.live === 0) m.count = 0;
				m.visible = m.count > 0;
				if (m.visible) {
					m.instanceMatrix.needsUpdate = true;
					this.shown = true;
				}
			}
	}

	private fill(now: number, camera: THREE.PerspectiveCamera, vmTan: number, worldTan: number): void {
		for (const where of ['world', 'hand'] as const) for (const m of this.meshes[where].values()) m.count = 0;
		for (let i = 0; i < CASE_MAX; i++) {
			if (!this.on[i] || now < this.born[i]!) continue;
			const kind = KINDS[this.kind[i]!]!;
			const age = this.restAt[i]! > 0 ? now - this.restAt[i]! - CASE_REST_MS : 0;
			const s = this.size[i]! * (age > 0 ? Math.max(0, 1 - age / CASE_FADE_MS) : 1);
			V.fromArray(this.pos, i * 3);
			Q.fromArray(this.rot, i * 4);
			const inHand = this.own[i] === 1 && this.restAt[i] === 0 && now - this.born[i]! < CASE_HAND_MS;
			let m = inHand ? this.meshes.hand.get(kind)! : this.meshes.world.get(kind)!;
			if (inHand && m.count >= 16) m = this.meshes.world.get(kind)!;
			else if (inHand) {
				// The whole shape as `toViewmodel` takes a point, so every corner of it stays on its pixel.
				HAND.k = this.depth[i]!;
				HAND.vmTan = vmTan;
				HAND.worldTan = worldTan;
				const k = toViewmodel(W.set(0, 0, 0), HAND);
				M.compose(V, Q, S.setScalar(s)).premultiply(camera.matrixWorldInverse).premultiply(M2.makeScale(k, k, HAND.k));
				m.setMatrixAt(m.count++, M);
				continue;
			}
			m.setMatrixAt(m.count++, M.compose(V, Q, S.setScalar(s)));
		}
		this.show();
	}

	/** Round reset, map change: all gone at once. */
	clear(): void {
		this.on.fill(0);
		this.live = 0;
		this.next = 0;
		this.show();
	}

	dispose(): void {
		this.clear();
		for (const where of ['world', 'hand'] as const)
			for (const m of this.meshes[where].values()) {
				m.geometry.dispose();
				m.dispose();
			}
		this.materials.world.dispose();
		this.materials.hand.dispose();
		this.world.removeFromParent();
		this.hand.removeFromParent();
	}
}

const QB = new THREE.Quaternion();
const HAND: HandOver = { k: 1, vmTan: 1, worldTan: 1 };

function source(v: THREE.Vector3, out: Vec3): void {
	out.x = v.x;
	out.y = -v.z;
	out.z = v.y;
}
function three(v: Vec3, out: THREE.Vector3): void {
	out.set(v.x, v.z, -v.y);
}
