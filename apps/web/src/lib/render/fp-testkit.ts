/**
 * Measuring the first-person animations on the shipped meshes (fp-contact.test.ts): hands and forearms against the gun
 * with its parts where they are, hand against hand, the magazine against the gun (both ways), everything against the near plane, the
 * screen centre and the sleeve ends. Not used by the game.
 *
 * The body of the gun and each moving part are a solid of their own (hand-contact.ts), in the space of their node: moving
 * a part moves the points it is measured with, nothing is built anew. Where two solids overlap, a point in the overlap is as deep as it
 * is in the one it is deeper in, so depths next to a seam read a little low. Model units of the gun (about 2.3 cm).
 */
import * as THREE from 'three';
import { restVmFeel, type VmFeel } from '../game/gunfeel.js';
import { HeldAssets } from './character/held.js';
import { FP_RELOADS, type Clip } from './fp-clips.js';
import { GUN_PARTS, partSteps, type GunId, type PartName } from './gun-rig.js';
import { handSamples, Solid, type HandSample } from './hand-contact.js';
import type { HandSide } from './hand-poses.js';
import { skinnedPositions, type WeaponHandPair } from './hands.js';
import { shippedLoad } from './shipped-models.js';
import { ZombieRenderer } from './zombies.js';

export const GUNS = Object.keys(GUN_PARTS) as GunId[];
export const ASPECTS = [4 / 3, 16 / 9, 21 / 9] as const;

interface Piece {
	name: PartName | 'body';
	node: THREE.Object3D;
	solid: Solid;
	box: THREE.Box3;
	/** World to the node. */
	inverse: THREE.Matrix4;
}

export interface Depth {
	depth: number;
	/** Bone and the piece of the gun it is in. */
	at: string;
}

export interface Measured {
	/** Fingers and palm, and the forearm, of each hand inside the gun. */
	hand: Record<HandSide, Depth>;
	arm: Record<HandSide, Depth>;
	/** The left hand inside the right one (skin and sleeves). */
	hands: Depth;
	/** The magazine inside the rest of the gun, or the rest of the gun inside the magazine. */
	mag: Depth;
	/** Triangles cut by the near plane inside the view. */
	near: number;
	/** A triangle covers the middle of the screen. */
	centre: string;
	/** A sleeve ends inside the view. */
	sleeve: HandSide | '';
	/** The magazine, or the hand with it, is in the picture. */
	magSeen: boolean;
	leftSeen: boolean;
}

const M = new THREE.Matrix4();
const V = new THREE.Vector3();

/** Triangles of the meshes under `node` that aren't under `skip`, in the space of `node` times `len`. */
function trianglesIn(node: THREE.Object3D, skip: readonly THREE.Object3D[], len: number): Float64Array {
	node.updateWorldMatrix(true, true);
	const to = node.matrixWorld.clone().invert();
	const out: number[] = [];
	const walk = (o: THREE.Object3D) => {
		if (skip.includes(o)) return;
		if (o instanceof THREE.Mesh && !(o instanceof THREE.SkinnedMesh) && o.name !== 'dot') {
			M.multiplyMatrices(to, o.matrixWorld);
			const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position');
			const idx = (o.geometry as THREE.BufferGeometry).index;
			for (let i = 0; i < (idx ? idx.count : pos.count); i++) {
				V.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(M).multiplyScalar(len);
				out.push(V.x, V.y, V.z);
			}
		}
		for (const c of o.children) walk(c);
	};
	walk(node);
	return Float64Array.from(out);
}

/** Distance of the points the magazine and what it passes are measured with. */
const MAG_SPACING = 0.25;

/** Points all over triangles (xyz ×3), at most `spacing` apart. */
function pointsOn(tri: Float64Array, spacing: number): Float64Array {
	const out: number[] = [];
	for (let o = 0; o < tri.length; o += 9) {
		const edge = (i: number, j: number) => Math.hypot(tri[o + i]! - tri[o + j]!, tri[o + i + 1]! - tri[o + j + 1]!, tri[o + i + 2]! - tri[o + j + 2]!);
		const m = Math.max(1, Math.ceil(Math.max(edge(0, 3), edge(3, 6), edge(6, 0)) / spacing));
		for (let a = 0; a <= m; a++) for (let b = 0; a + b <= m; b++) for (let k = 0; k < 3; k++) out.push((tri[o + k]! * a + tri[o + 3 + k]! * b + tri[o + 6 + k]! * (m - a - b)) / m);
	}
	return Float64Array.from(out);
}

export class Probe {
	private constructor(
		readonly id: GunId,
		readonly z: ZombieRenderer,
		readonly pair: WeaponHandPair,
		private readonly pieces: Piece[],
		private readonly samples: Record<HandSide, HandSample[]>,
		/** Points on the faces of the magazine, and on those of the pieces round its way (in the space of their node times `len`). */
		private readonly magPoints: Float64Array,
		private readonly roundMag: readonly { piece: Piece; points: Float64Array }[],
		private readonly len: number
	) {}

	/** `spacing`: distance of the points on the skin. */
	static async of(id: GunId, spacing: number): Promise<Probe> {
		const z = new ZombieRenderer(new HeldAssets(), shippedLoad);
		z.setWeapon(id);
		await z.preload([id]);
		z.updateViewmodel(1000, true, 1, 0, restVmFeel(), 5);
		z.vmScene.updateMatrixWorld(true);
		const rig = z.rig(id)!;
		const pair = z.hands(id)!;
		const root = pair.space.parent!.children[0]!;
		const nodes = rig.names.map((n) => rig.part(n)!);
		const piece = (name: Piece['name'], node: THREE.Object3D): Piece => {
			const tri = trianglesIn(node, nodes.filter((n) => n !== node), rig.len);
			const box = new THREE.Box3();
			for (let i = 0; i < tri.length; i += 3) box.expandByPoint(V.set(tri[i]!, tri[i + 1]!, tri[i + 2]!));
			return { name, node, solid: new Solid(tri), box, inverse: new THREE.Matrix4() };
		};
		const pieces = [piece('body', root), ...rig.names.map((n) => piece(n, rig.part(n)!))];
		// What the magazine passes: the points in the box it sweeps on its track.
		const magNode = rig.part('mag')!;
		const step = partSteps(id, 'mag')[0]!;
		const swept = pieces.find((p) => p.name === 'mag')!.box.clone();
		swept.union(swept.clone().translate(V.set(...step.axis).normalize().multiplyScalar(step.to)));
		const roundMag = pieces
			.filter((p) => p.name !== 'mag')
			.map((p) => {
				const all = pointsOn(trianglesIn(p.node, nodes.filter((n) => n !== p.node), rig.len), MAG_SPACING);
				M.copy(magNode.matrixWorld).invert().multiply(p.node.matrixWorld);
				const keep: number[] = [];
				for (let i = 0; i < all.length; i += 3) if (swept.containsPoint(V.fromArray(all, i).divideScalar(rig.len).applyMatrix4(M).multiplyScalar(rig.len))) keep.push(all[i]!, all[i + 1]!, all[i + 2]!);
				return { piece: p, points: Float64Array.from(keep) };
			});
		return new Probe(
			id,
			z,
			pair,
			pieces,
			{ r: handSamples(pair.hands.r.mesh, spacing), l: handSamples(pair.hands.l.mesh, spacing) },
			pointsOn(trianglesIn(magNode, [], rig.len), MAG_SPACING),
			roundMag,
			rig.len
		);
	}

	/** World positions of a hand's vertices. */
	private skin(side: HandSide): Float32Array {
		return skinnedPositions(this.pair.hands[side].mesh);
	}

	/** Depth of points (world) inside the gun; `skip`: a piece left out. */
	private inGun(p: THREE.Vector3, skip: string | null, out: Depth, label: string): void {
		for (const piece of this.pieces) {
			if (piece.name === skip || !piece.node.visible) continue;
			V.copy(p).applyMatrix4(piece.inverse).multiplyScalar(this.len);
			if (!piece.box.containsPoint(V) || !piece.solid.inside(V.x, V.y, V.z)) continue;
			const d = -piece.solid.signed(V.x, V.y, V.z);
			if (d > out.depth) {
				out.depth = d;
				out.at = label + ' in ' + piece.name;
			}
		}
	}

	/** How close the tip of the right index finger is to the trigger (negative: inside). */
	triggerGap(): number {
		this.z.vmScene.updateMatrixWorld(true);
		const t = this.pieces.find((p) => p.name === 'trigger')!;
		t.inverse.copy(t.node.matrixWorld).invert();
		const a = this.skin('r');
		let gap = Infinity;
		for (const s of this.samples.r) {
			if (s.tip !== 'index') continue;
			V.set(0, 0, 0);
			if (s.face) for (let k = 0; k < 3; k++) V.addScaledVector(new THREE.Vector3().fromArray(a, s.face[k]! * 3), s.weights![k]!);
			else V.fromArray(a, s.vertex * 3);
			V.applyMatrix4(t.inverse).multiplyScalar(this.len);
			gap = Math.min(gap, t.solid.signed(V.x, V.y, V.z));
		}
		return gap;
	}

	/** Depth of one hand alone and against the other (the tuner). */
	one(side: HandSide): { hand: number; arm: number; hands: number } {
		const m = this.measure(false, side);
		return { hand: m.hand[side].depth, arm: m.arm[side].depth, hands: m.hands.depth };
	}

	/** Pose the renderer first (`updateViewmodel`). `view`: the screen checks too. */
	measure(view = true, only: HandSide | null = null): Measured {
		const { z, pair } = this;
		z.vmScene.updateMatrixWorld(true);
		for (const p of this.pieces) p.inverse.copy(p.node.matrixWorld).invert();
		const none = (): Depth => ({ depth: 0, at: '' });
		const out: Measured = { hand: { r: none(), l: none() }, arm: { r: none(), l: none() }, hands: none(), mag: none(), near: 0, centre: '', sleeve: '', magSeen: false, leftSeen: false };
		const skins: Partial<Record<HandSide, Float32Array>> = {};
		const p = new THREE.Vector3();
		const sample = (s: HandSample, a: Float32Array) => {
			if (!s.face) return p.fromArray(a, s.vertex * 3);
			const [i, j, k] = s.face;
			const [u, v, w] = s.weights!;
			return p.set(a[i * 3]! * u + a[j * 3]! * v + a[k * 3]! * w, a[i * 3 + 1]! * u + a[j * 3 + 1]! * v + a[k * 3 + 1]! * w, a[i * 3 + 2]! * u + a[j * 3 + 2]! * v + a[k * 3 + 2]! * w);
		};
		for (const side of ['r', 'l'] as const) {
			if (!pair.hands[side].group.visible) continue;
			const a = (skins[side] = this.skin(side));
			if (only && only !== side) continue;
			for (const s of this.samples[side]) this.inGun(sample(s, a), null, s.arm ? out.arm[side] : out.hand[side], s.bone);
		}
		// Hand against hand: the right one as a solid, in the model space of the gun.
		const model = pair.space.matrixWorld.clone().invert();
		if (skins.r && skins.l) {
			const g = pair.hands.r.mesh.geometry;
			const n = g.index ? g.index.count : skins.r.length / 3;
			const tri = new Float64Array(n * 3);
			const box = new THREE.Box3();
			for (let i = 0; i < n; i++) {
				box.expandByPoint(V.fromArray(skins.r, (g.index ? g.index.getX(i) : i) * 3).applyMatrix4(model));
				V.toArray(tri, i * 3);
			}
			let solid: Solid | null = null;
			for (const s of this.samples.l) {
				sample(s, skins.l).applyMatrix4(model);
				if (!box.containsPoint(p)) continue;
				const d = -(solid ??= new Solid(tri, true)).signed(p.x, p.y, p.z);
				if (d > out.hands.depth) {
					out.hands.depth = d;
					out.hands.at = s.bone;
				}
			}
		}
		const rig = z.rig(this.id)!;
		const mag = rig.part('mag')!;
		if (mag.visible && !only) {
			const m = this.pieces.find((q) => q.name === 'mag')!;
			for (let i = 0; i < this.magPoints.length; i += 3) this.inGun(p.fromArray(this.magPoints, i).divideScalar(this.len).applyMatrix4(mag.matrixWorld), 'mag', out.mag, 'magazine');
			for (const { piece, points } of this.roundMag) {
				if (!piece.node.visible) continue;
				M.copy(m.inverse).multiply(piece.node.matrixWorld);
				for (let i = 0; i < points.length; i += 3) {
					p.fromArray(points, i).divideScalar(this.len).applyMatrix4(M).multiplyScalar(this.len);
					if (!m.box.containsPoint(p) || !m.solid.inside(p.x, p.y, p.z)) continue;
					const d = -m.solid.signed(p.x, p.y, p.z);
					if (d > out.mag.depth) {
						out.mag.depth = d;
						out.mag.at = piece.name + ' in magazine';
					}
				}
			}
		}
		if (view) this.screen(out, skins);
		return out;
	}

	/** Whether the magazine is off its track (the last pose). */
	get loose(): boolean {
		const s = this.z.anim.shownMag;
		return s[1] !== 0 || s[2] !== 0 || s[3] !== 0;
	}

	private screen(out: Measured, skins: Partial<Record<HandSide, Float32Array>>): void {
		const { z, pair } = this;
		const cam = z.vmCamera;
		const tan = Math.tan((cam.fov * Math.PI) / 360);
		const rig = z.rig(this.id)!;
		const root = pair.space.parent!.children[0]!;
		const a = new THREE.Vector3();
		const b = new THREE.Vector3();
		const c = new THREE.Vector3();
		const seen = (v: THREE.Vector3, asp: number) => -v.z > cam.near && Math.abs(v.y) < -v.z * tan && Math.abs(v.x) < -v.z * tan * asp;
		const tri = (label: string, get: (k: number, v: THREE.Vector3) => void, n: number, seeing: (() => void) | null) => {
			for (let i = 0; i < n; i += 3) {
				get(i, a);
				get(i + 1, b);
				get(i + 2, c);
				for (const asp of ASPECTS) if (cutByNear(a, b, c, cam.near, tan, asp)) out.near++;
				if (!out.centre && coversCentre(a, b, c, cam.near, tan)) out.centre = label;
				if (seeing && (seen(a, 21 / 9) || seen(b, 21 / 9) || seen(c, 21 / 9))) seeing();
			}
		};
		const walk = (o: THREE.Object3D, label: string) => {
			if (!o.visible) return;
			for (const n of rig.names) if (rig.part(n) === o) label = n;
			if (o instanceof THREE.Mesh) {
				const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position');
				const idx = (o.geometry as THREE.BufferGeometry).index;
				const at = new Float32Array(pos.count * 3);
				for (let i = 0; i < pos.count; i++) V.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).toArray(at, i * 3);
				tri(label, (k, v) => v.fromArray(at, (idx ? idx.getX(k) : k) * 3), idx ? idx.count : pos.count, label === 'mag' ? () => (out.magSeen = true) : null);
			}
			for (const k of o.children) walk(k, label);
		};
		walk(root, 'body');
		for (const side of ['r', 'l'] as const) {
			const at = skins[side];
			if (!at) continue;
			const g = pair.hands[side].mesh.geometry;
			tri('hand ' + side, (k, v) => v.fromArray(at, (g.index ? g.index.getX(k) : k) * 3), g.index ? g.index.count : at.length / 3, side === 'l' ? () => (out.leftSeen = true) : null);
			// The cut end of the sleeve.
			const end = pair.hands[side].sleeveEnd(new THREE.Vector3()).applyMatrix4(pair.space.matrixWorld);
			const r = 2.9 * pair.space.matrixWorld.getMaxScaleOnAxis();
			for (const asp of ASPECTS) if (!ballOffScreen(end, r, cam.near, tan, asp)) out.sleeve = side;
		}
	}
}

/** The middle of the screen that stays clear, in half screen heights round the crosshair. */
export const CENTRE = 0.1;

function cutByNear(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, near: number, tan: number, asp: number): boolean {
	const za = a.z + near;
	const zb = b.z + near;
	const zc = c.z + near;
	if ((za < 0 && zb < 0 && zc < 0) || (za >= 0 && zb >= 0 && zc >= 0)) return false;
	const w = near * tan * asp;
	const h = near * tan;
	const pts: number[] = [];
	for (const [p, q, zp, zq] of [
		[a, b, za, zb],
		[b, c, zb, zc],
		[c, a, zc, za]
	] as const) {
		if (zp < 0 === zq < 0) continue;
		const t = zp / (zp - zq);
		pts.push(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t);
	}
	if (pts.length !== 4) return false;
	// The cut line against the near window (Liang-Barsky).
	const [x0, y0, x1, y1] = pts as [number, number, number, number];
	let t0 = 0;
	let t1 = 1;
	for (const [p, q] of [
		[x0 - x1, x0 + w],
		[x1 - x0, w - x0],
		[y0 - y1, y0 + h],
		[y1 - y0, h - y0]
	] as const) {
		if (p === 0) {
			if (q < 0) return false;
			continue;
		}
		const r = q / p;
		if (p < 0) t0 = Math.max(t0, r);
		else t1 = Math.min(t1, r);
		if (t0 > t1) return false;
	}
	return true;
}

/** Whether a triangle reaches into the square round the screen centre. */
export function coversCentre(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, near: number, tan: number, half = CENTRE): boolean {
	if (-a.z < near || -b.z < near || -c.z < near) return false;
	const p = [a, b, c].map((v) => [v.x / (-v.z * tan), v.y / (-v.z * tan)] as [number, number]);
	const xs = p.map((q) => q[0]);
	const ys = p.map((q) => q[1]);
	if (Math.min(...xs) > half || Math.max(...xs) < -half || Math.min(...ys) > half || Math.max(...ys) < -half) return false;
	// Separating axes of the triangle's edges.
	for (let i = 0; i < 3; i++) {
		const [x0, y0] = p[i]!;
		const [x1, y1] = p[(i + 1) % 3]!;
		const nx = y0 - y1;
		const ny = x1 - x0;
		const d = p.map((q) => (q[0] - x0) * nx + (q[1] - y0) * ny);
		const r = half * (Math.abs(nx) + Math.abs(ny));
		const o = -x0 * nx - y0 * ny;
		if (Math.min(...d) > o + r || Math.max(...d) < o - r) return false;
	}
	return true;
}

/** Whether a ball (view space) is wholly outside the view. */
function ballOffScreen(c: THREE.Vector3, r: number, near: number, tan: number, asp: number): boolean {
	const v = Math.atan(tan);
	const hz = Math.atan(tan * asp);
	if (c.z - r > -near) return true;
	if (c.y * Math.cos(v) - c.z * Math.sin(v) < -r) return true;
	return Math.abs(c.x) * -Math.cos(hz) - c.z * Math.sin(hz) < -r;
}

/** Phases of a clip to measure: evenly spread. */
export const phases = (n: number): number[] => Array.from({ length: n }, (_, i) => (i + 0.5) / n);

/**
 * Phases between any two keys of a clip next to each other. The hands move fast there, and a finger
 * can be in the gun for a few thousandths of a clip: close keys are sampled every `fine`, the rest once.
 */
export function keyPhases(clip: Clip, fine: number): number[] {
	const d = clip.def;
	const all = [d.left, d.right, d.bolt, d.cover, d.belt, d.mag].flatMap((k) => (k ?? []).map((i: { t: number }) => i.t)).concat(d.hang ?? []);
	const t = [...new Set(all)].sort((a, b) => a - b);
	return t.slice(1).flatMap((v, i) => {
		const from = t[i]!;
		const n = v - from <= 0.08 ? Math.max(1, Math.ceil((v - from) / fine)) : 1;
		return Array.from({ length: n }, (_, k) => from + ((v - from) * (k + 0.5)) / n);
	});
}

/** Whether a hand is meant to hold still on a named pose at `p`, else in a blend. */
export const holds = (clip: Clip, side: HandSide, p: number): boolean => {
	const t = side === 'l' ? clip.left : clip.right;
	return !t || t.holding(p) !== null;
};

export const reloadClip = (id: GunId, empty: boolean): Clip => FP_RELOADS[id][empty ? 'empty' : 'loaded'];

/** Pose a probe in a reload. */
export function poseReload(probe: Probe, p: number, empty: boolean, feel: VmFeel = restVmFeel()): void {
	probe.z.clear();
	probe.z.setWeapon(probe.id);
	probe.z.updateViewmodel(5000, true, p, 0, feel, empty ? 0 : 3);
}
/** Pose a probe `ms` after a shot. */
export function poseShot(probe: Probe, ms: number, mag: number): void {
	probe.z.clear();
	probe.z.setWeapon(probe.id);
	probe.z.fired(5000);
	probe.z.updateViewmodel(5000 + ms, true, 1, 0, restVmFeel(), mag);
}
