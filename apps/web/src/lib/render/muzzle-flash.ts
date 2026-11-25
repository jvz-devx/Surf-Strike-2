/**
 * Muzzle flashes (docs/modes.md#infected): a ragged star across the bore and a tongue of flame ahead of it, for the .50 cal the
 * side jets of its brake too. A few shapes per gun class are built once; a shot picks one, turns it and sizes it, so no two in a row
 * look the same. First person: `MuzzleFx` adds a short light on the gun and the hands, and a little smoke after a burst. Other players'
 * guns show the same shapes (character/held.ts).
 */
import type { WeaponId } from '@surf/shared';
import * as THREE from 'three';
import type { GunId } from './gun-rig.js';

export interface FlashDef {
	/** Length of the tongue (viewmodel units) and, as a share of it, its half-width, the radius of the star and its points. */
	len: number;
	tongue: number;
	star: number;
	points: number;
	/** Jets out of the sides of a muzzle brake (share of the length). */
	jets: number;
	/** How long it may show (ms); never more than FLASH_FRAMES frames. */
	ms: number;
	/** Light on the gun. */
	light: number;
	/** Smoke a shot adds (1: at once a puff). */
	smoke: number;
}

export const FLASHES: Readonly<Record<GunId, FlashDef>> = Object.freeze({
	pistol: { len: 6.5, tongue: 0.2, star: 0.6, points: 5, jets: 0, ms: 34, light: 26, smoke: 0.16 },
	smg: { len: 5.5, tongue: 0.2, star: 0.58, points: 5, jets: 0, ms: 30, light: 20, smoke: 0.12 },
	lmg: { len: 8, tongue: 0.18, star: 0.62, points: 6, jets: 0, ms: 34, light: 34, smoke: 0.13 },
	sniper: { len: 11, tongue: 0.16, star: 0.52, points: 5, jets: 0, ms: 42, light: 46, smoke: 0.7 },
	barrett: { len: 11, tongue: 0.18, star: 0.5, points: 6, jets: 0.8, ms: 45, light: 70, smoke: 1 },
	striker: { len: 9.5, tongue: 0.28, star: 0.72, points: 7, jets: 0, ms: 42, light: 52, smoke: 0.5 }
});

/** A flash is drawn in this many frames at most, and how big in each. */
export const FLASH_FRAMES = 3;
const FRAME_SIZE = [1, 0.82, 0.6] as const;
/** A frame this late after the shot (ms) still shows it once. */
const LATE_MS = 60;
/** Shapes per gun class. */
export const FLASH_SHAPES = 5;
/** Length of the wings of an aimed flash, in stars. */
const AIMED_STAR = 2.5;
/** With reduced motion: this much of the size and of the light, and only every so many shots (no strobing). */
const CALM_SIZE = 0.6;
const CALM_LIGHT = 0.35;
const CALM_SHOTS = 3;

/** White-hot, yellow, orange, out. */
const HOT = [1, 0.96, 0.84] as const;
const MID = [1, 0.72, 0.26] as const;
const EDGE = [0.55, 0.19, 0.03] as const;
const OUT = [0, 0, 0] as const;
type RGB = readonly [number, number, number];

/** A small generator with a seed: the shapes are the same in every game and test. */
function random(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

/** Triangles with a colour per corner (added to the picture: black is nothing). */
class Tris {
	readonly p: number[] = [];
	readonly c: number[] = [];

	tri(a: THREE.Vector3, ca: RGB, b: THREE.Vector3, cb: RGB, c: THREE.Vector3, cc: RGB): void {
		for (const v of [a, b, c]) this.p.push(v.x, v.y, v.z);
		this.c.push(...ca, ...cb, ...cc);
	}

	build(): THREE.BufferGeometry {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
		g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
		return g;
	}
}

const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** A leaf of flame from `at` along `dir`: `w` half as wide as `len` at a third of it, its edge ragged, its tip off to a side. */
function leaf(t: Tris, rnd: () => number, at: THREE.Vector3, dir: THREE.Vector3, side: THREE.Vector3, len: number, w: number, hot: number): void {
	const n = 6;
	const bend = (rnd() - 0.5) * 0.18;
	const mid: THREE.Vector3[] = [];
	const l: THREE.Vector3[] = [];
	const r: THREE.Vector3[] = [];
	for (let i = 0; i <= n; i++) {
		const u = i / n;
		const c = at.clone().addScaledVector(dir, len * u).addScaledVector(side, bend * len * u * u);
		const wide = w * len * Math.sin(Math.PI * Math.min(1, 0.12 + u ** 0.7)) * (0.7 + 0.6 * rnd());
		mid.push(c);
		l.push(c.clone().addScaledVector(side, i === n ? 0 : wide));
		r.push(c.clone().addScaledVector(side, i === n ? 0 : -wide * (0.75 + 0.5 * rnd())));
	}
	const shade = (u: number): RGB => (u < hot ? HOT : u < hot + 0.3 ? MID : u < 0.95 ? EDGE : OUT);
	for (let i = 0; i < n; i++) {
		const a = shade(i / n);
		const b = shade((i + 1) / n);
		for (const s of [l, r]) {
			t.tri(mid[i]!, a, mid[i + 1]!, b, s[i]!, OUT);
			t.tri(mid[i + 1]!, b, s[i + 1]!, OUT, s[i]!, OUT);
		}
	}
}

/**
 * Shape `n` of a gun class, for a muzzle at the origin: the bore along `fwd`, unit length of the tongue. `aimed`: as it is seen
 * over the sights, where the gun hides the muzzle: wings to both sides and down, the way up to the sight line left dark.
 */
export function flashGeometry(def: FlashDef, n: number, fwd: THREE.Vector3, aimed = false): THREE.BufferGeometry {
	const rnd = random(n * 7919 + Math.round(def.star * 1000) * 31 + def.points);
	const t = new Tris();
	const up = Math.abs(fwd.y) > 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
	const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
	const over = new THREE.Vector3().crossVectors(right, fwd).normalize();
	const round = (a: number) => right.clone().multiplyScalar(Math.cos(a)).addScaledVector(over, Math.sin(a));
	const o = v3(0, 0, 0);
	if (aimed) {
		// The biggest are no bigger than they have to be: they are close to the eye.
		const star = Math.min(def.star, 0.55);
		for (const s of [-1, 1]) {
			// Level and lower, none alike: long ones that stand out beside the gun.
			[0.22, -0.12, -0.45].forEach((lift, i) => {
				const a = lift + (rnd() - 0.5) * 0.1;
				const dir = right.clone().multiplyScalar(s * Math.cos(a)).addScaledVector(over, Math.sin(a));
				const long = star * AIMED_STAR * (i === 0 ? 1 : 0.75) * (0.8 + 0.4 * rnd());
				// They begin beside the bore, clear of the sight line.
				leaf(t, rnd, right.clone().multiplyScalar(s * star * 0.3), dir, new THREE.Vector3().crossVectors(dir, fwd).normalize(), long, 0.075 + 0.03 * rnd(), 0.16);
			});
		}
		// A soft glow, wide and mostly below: it stands out to both sides of the gun.
		const glow = (a: number) => right.clone().multiplyScalar(Math.cos(a) * star * AIMED_STAR * 0.75).addScaledVector(over, Math.sin(a) * star * (Math.sin(a) > 0 ? 0.1 : 0.9));
		for (let i = 0; i < 16; i++) t.tri(o, EDGE, glow((i / 8) * Math.PI), OUT, glow(((i + 1) / 8) * Math.PI), OUT);
		return t.build();
	}
	// The star: points of different lengths round a hot middle, leaning forwards.
	const start = rnd() * Math.PI;
	for (let i = 0; i < def.points; i++) {
		const a = start + ((i + (rnd() - 0.5) * 0.6) / def.points) * Math.PI * 2;
		const dir = round(a).addScaledVector(fwd, 0.15 + 0.6 * rnd()).normalize();
		const side = new THREE.Vector3().crossVectors(dir, fwd).normalize();
		const long = def.star * (0.5 + 0.75 * rnd());
		leaf(t, rnd, o, dir, side, long, 0.13 + 0.07 * rnd(), 0.22);
		leaf(t, rnd, o, dir, new THREE.Vector3().crossVectors(dir, side).normalize(), long * 0.8, 0.1, 0.18);
	}
	// A soft round glow across the bore.
	const glow = def.star * 0.62;
	for (let i = 0; i < 12; i++) {
		const a = (i / 12) * Math.PI * 2;
		const b = ((i + 1) / 12) * Math.PI * 2;
		t.tri(v3(0, 0, 0).addScaledVector(fwd, 0.04), EDGE, round(a).multiplyScalar(glow), OUT, round(b).multiplyScalar(glow), OUT);
		t.tri(v3(0, 0, 0).addScaledVector(fwd, 0.05), HOT, round(a).multiplyScalar(glow * 0.28), OUT, round(b).multiplyScalar(glow * 0.28), OUT);
	}
	// The tongue, in three planes through the bore.
	for (let i = 0; i < 3; i++) leaf(t, rnd, o, fwd, round(start + (i / 3) * Math.PI), 0.85 + 0.3 * rnd(), def.tongue * (0.8 + 0.4 * rnd()), 0.3);
	// The brake blows out to both sides and a little back.
	if (def.jets > 0)
		for (const s of [-1, 1])
			for (const lean of [-0.18, 0.3]) {
				const dir = right.clone().multiplyScalar(s).addScaledVector(fwd, -0.28 + lean * 0.4).addScaledVector(over, lean * 0.3).normalize();
				for (const side of [over, new THREE.Vector3().crossVectors(dir, over).normalize()]) leaf(t, rnd, v3(0, 0, 0).addScaledVector(fwd, -0.06), dir, side, def.jets * (0.75 + 0.4 * rnd()), 0.2, 0.32);
			}
	return t.build();
}

/** Every shape of every class with the bore along `fwd`, built when first asked for. */
export class FlashShapes {
	private readonly made = new Map<string, THREE.BufferGeometry[]>();
	readonly material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });

	constructor(private readonly fwd: THREE.Vector3) {}

	/** The shapes of a gun, as it is seen over its sights too. */
	of(id: GunId, aimed = false): readonly THREE.BufferGeometry[] {
		const key = id + (aimed ? ' aimed' : '');
		let g = this.made.get(key);
		if (!g) this.made.set(key, (g = Array.from({ length: FLASH_SHAPES }, (_, n) => flashGeometry(FLASHES[id], n, this.fwd, aimed))));
		return g;
	}

	dispose(): void {
		for (const g of this.made.values()) for (const s of g) s.dispose();
		this.made.clear();
		this.material.dispose();
	}
}

/** Another of `n` shapes than `last`. */
export function nextShape(last: number, n: number, rnd = Math.random()): number {
	return last < 0 ? Math.floor(rnd * n) % n : (last + 1 + Math.floor(rnd * (n - 1))) % n;
}

/** Puffs of smoke drawn at once, their life (ms), and how much smoke hangs on the muzzle before it shows. */
const PUFFS = 14;
const PUFF_MS = 900;
const SMOKE_FROM = 0.75;
/** Smoke goes away at this rate (per s), and wisps go on this long after the last shot (ms), one every so many ms. */
const SMOKE_DECAY = 0.55;
const WISP_MS = 420;
const WISP_EVERY = 75;

const P = new THREE.Vector3();

/** A soft round spot. */
function softSpot(): THREE.DataTexture {
	const n = 32;
	const d = new Uint8Array(n * n * 4);
	for (let y = 0; y < n; y++)
		for (let x = 0; x < n; x++) {
			const r = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
			const a = Math.max(0, 1 - r) ** 1.6;
			d.set([255, 255, 255, Math.round(255 * a)], (y * n + x) * 4);
		}
	const t = new THREE.DataTexture(d, n, n);
	t.magFilter = THREE.LinearFilter;
	t.needsUpdate = true;
	return t;
}

/** The flash, the light and the smoke of my own gun. `mesh` goes into the viewmodel node, `scene` into the viewmodel scene. */
export class MuzzleFx {
	readonly mesh: THREE.Mesh;
	readonly scene = new THREE.Group();
	private readonly shapes = new FlashShapes(new THREE.Vector3(0, 0, -1));
	private readonly light = new THREE.PointLight(0xffb469, 0, 60, 1.6);
	private gun: GunId | null = null;
	private shape = -1;
	private size = 1;
	/** Turn about the bore, and the side an aimed shape is turned to. */
	private turn = 0;
	private flip = 1;
	private at = -Infinity;
	private frames = 0;
	private shots = 0;
	private heat = 0;
	private heatAt = -Infinity;
	private wispAt = -Infinity;
	private readonly puffs: THREE.Points;
	private readonly spot = softSpot();
	private readonly puffMat: THREE.PointsMaterial;
	private readonly puffPos = new THREE.BufferAttribute(new Float32Array(PUFFS * 3), 3);
	private readonly puffCol = new THREE.BufferAttribute(new Float32Array(PUFFS * 4), 4);
	private readonly puffAt = new Float64Array(PUFFS).fill(-Infinity);
	private readonly puffVel = new Float32Array(PUFFS * 3);
	private readonly puffAge = new Float32Array(PUFFS).fill(1);
	private nextPuff = 0;

	constructor(private readonly calm: boolean) {
		this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.shapes.material);
		this.mesh.name = 'flash';
		this.mesh.visible = false;
		// The smallest box would be cut at the edge of the view.
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 4;
		this.puffMat = new THREE.PointsMaterial({ size: 2.1, map: this.spot, vertexColors: true, transparent: true, depthWrite: false });
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', this.puffPos.setUsage(THREE.DynamicDrawUsage));
		g.setAttribute('color', this.puffCol.setUsage(THREE.DynamicDrawUsage));
		this.puffs = new THREE.Points(g, this.puffMat);
		this.puffs.frustumCulled = false;
		this.puffs.visible = false;
		this.puffs.renderOrder = 5;
		// The light is always in the scene, dark: adding one would compile every material again at the first shot.
		this.scene.add(this.light, this.puffs);
	}

	/** Another gun is held. */
	hold(id: GunId | null): void {
		this.gun = id;
		this.at = -Infinity;
		this.heat = 0;
		this.wispAt = -Infinity;
		this.mesh.visible = false;
		this.light.intensity = 0;
		this.puffAt.fill(-Infinity);
		this.puffs.visible = false;
	}

	/** A shot. */
	fired(now: number): void {
		const id = this.gun;
		if (!id) return;
		const def = FLASHES[id];
		this.heat = this.cooled(now) + def.smoke;
		this.heatAt = now;
		if (this.calm && this.shots++ % CALM_SHOTS !== 0) return;
		this.at = now;
		this.frames = 0;
		this.shape = nextShape(this.shape, FLASH_SHAPES);
		this.size = def.len * (0.85 + 0.3 * Math.random()) * (this.calm ? CALM_SIZE : 1);
		// The brake's jets stay level; any other flash is turned about the bore.
		this.turn = def.jets > 0 ? (Math.random() - 0.5) * 0.3 : Math.random() * Math.PI * 2;
		this.flip = Math.random() < 0.5 ? -1 : 1;
	}

	private cooled(now: number): number {
		return Math.max(0, this.heat - (Math.max(0, now - this.heatAt) / 1000) * SMOKE_DECAY);
	}

	/** Frame: `muzzle` in the viewmodel node, `node` its place in the scene; null: no gun is drawn. `aim`: how far it is aimed (0..1). */
	update(now: number, muzzle: THREE.Vector3 | null, node: THREE.Object3D, aim = 0): void {
		const def = this.gun ? FLASHES[this.gun] : null;
		const t = now - this.at;
		const on = !!def && !!muzzle && this.frames < FLASH_FRAMES && (t < def.ms || (this.frames === 0 && t < LATE_MS));
		this.mesh.visible = on;
		this.light.intensity = 0;
		if (on) {
			const k = FRAME_SIZE[this.frames]!;
			this.frames++;
			this.mesh.position.copy(muzzle);
			const aimed = aim > 0.5;
			this.mesh.geometry = this.shapes.of(this.gun!, aimed)[this.shape]!;
			this.mesh.rotation.z = aimed ? 0 : this.turn;
			this.mesh.scale.setScalar(this.size * k);
			if (aimed) this.mesh.scale.x *= this.flip;
			node.updateMatrixWorld();
			// Beside the muzzle, towards the gun: it lights the barrel, the hands and the sleeve.
			this.light.position.copy(muzzle).applyMatrix4(node.matrixWorld);
			this.light.position.y += 0.5;
			this.light.position.z += 1.5;
			this.light.intensity = def.light * k * (this.calm ? CALM_LIGHT : 1);
		} else if (!muzzle) this.at = -Infinity;
		this.smoke(now, def ? muzzle : null, node);
	}

	private smoke(now: number, muzzle: THREE.Vector3 | null, node: THREE.Object3D): void {
		if (muzzle && !this.calm && this.cooled(now) > SMOKE_FROM && now - this.heatAt < WISP_MS && now - this.wispAt > WISP_EVERY && now - this.heatAt > 12) {
			this.wispAt = now;
			const i = this.nextPuff;
			this.nextPuff = (i + 1) % PUFFS;
			node.updateMatrixWorld();
			P.copy(muzzle).applyMatrix4(node.matrixWorld);
			this.puffPos.setXYZ(i, P.x, P.y, P.z);
			this.puffVel.set([(Math.random() - 0.4) * 0.9, 1.1 + Math.random() * 0.9, -0.6 + Math.random() * 0.8], i * 3);
			this.puffAt[i] = now;
			this.puffAge[i] = 0;
		}
		if (!this.puffs.visible && this.wispAt !== now) return;
		let any = false;
		for (let i = 0; i < PUFFS; i++) {
			const u = (now - this.puffAt[i]!) / PUFF_MS;
			const live = u >= 0 && u < 1;
			if (live) {
				const d = ((u - this.puffAge[i]!) * PUFF_MS) / 1000;
				this.puffAge[i] = u;
				if (d > 0)
					this.puffPos.setXYZ(
						i,
						this.puffPos.getX(i) + this.puffVel[i * 3]! * d,
						this.puffPos.getY(i) + this.puffVel[i * 3 + 1]! * d,
						this.puffPos.getZ(i) + this.puffVel[i * 3 + 2]! * d
					);
				any = true;
			}
			this.puffCol.setXYZW(i, 0.72, 0.72, 0.74, live ? 0.2 * Math.min(1, u * 6) * (1 - u) : 0);
		}
		this.puffs.visible = any;
		if (!any) return;
		this.puffPos.needsUpdate = true;
		this.puffCol.needsUpdate = true;
	}

	dispose(): void {
		this.mesh.geometry.dispose();
		this.shapes.dispose();
		this.puffs.geometry.dispose();
		this.puffMat.dispose();
		this.spot.dispose();
		this.light.dispose();
	}
}

/** Whether a weapon has a flash. */
export const hasFlash = (w: WeaponId | null): w is GunId => w !== null && w in FLASHES;
