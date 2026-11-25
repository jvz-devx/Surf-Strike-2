/**
 * Geometry builder of the first-person models (render/viewmodels.ts): boxes,
 * chamfered boxes, rods, balls and extruded profiles, collected per material
 * and merged into one mesh per material. A model then costs one draw call per
 * material, however many parts it has. Parts are flat shaded unless a rod asks
 * for round sides.
 */
import * as THREE from 'three';

export type V3 = readonly [x: number, y: number, z: number];
/** A profile point: (z, y) for a side profile, (x, y) for a cross-section. */
export type P2 = readonly [a: number, b: number];

interface Bucket {
	pos: number[];
	nor: number[];
}

export interface RodOpts {
	/** Sides (default 8). */
	seg?: number;
	/** Round shading instead of facets (default: 10 sides or more). */
	smooth?: boolean;
	/** Flattening of the cross-section across its second axis (1 = round). */
	squash?: number;
	/** Turn of the cross-section about the axis (rad). */
	roll?: number;
	/** Leave an end open (it is hidden inside another part). */
	open?: boolean;
}

const P = new THREE.Vector3();
const N = new THREE.Vector3();
const S = new THREE.Vector3();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const NM = new THREE.Matrix3();
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const U = new THREE.Vector3();
const W = new THREE.Vector3();
const D = new THREE.Vector3();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);

/** Rectangle (a from −w/2 to w/2 around `mid`, b from b0 to b1) with its corners cut: `ct` at b1, `cb` at b0. */
export function sect(w: number, b0: number, b1: number, ct: number, cb = ct, mid = 0): P2[] {
	const l = mid - w / 2;
	const r = mid + w / 2;
	const pts: P2[] = [
		[l + cb, b0],
		[r - cb, b0],
		[r, b0 + cb],
		[r, b1 - ct],
		[r - ct, b1],
		[l + ct, b1],
		[l, b1 - ct],
		[l, b0 + cb]
	];
	// A corner that is not cut gives the same point twice.
	return pts.filter((p, i) => {
		const q = pts[(i + pts.length - 1) % pts.length]!;
		return Math.abs(p[0] - q[0]) > 1e-6 || Math.abs(p[1] - q[1]) > 1e-6;
	});
}

export class Mesher {
	private buckets = new Map<THREE.Material, Bucket>();
	private frames: THREE.Matrix4[];
	private rootInv: THREE.Matrix4;

	/** `root`: placement of the model in viewmodel space, baked into the geometry. */
	constructor(root: THREE.Matrix4 = new THREE.Matrix4()) {
		this.frames = [root.clone()];
		this.rootInv = root.clone().invert();
	}

	private get frame(): THREE.Matrix4 {
		return this.frames[this.frames.length - 1]!;
	}

	private bucket(m: THREE.Material): Bucket {
		let b = this.buckets.get(m);
		if (!b) this.buckets.set(m, (b = { pos: [], nor: [] }));
		return b;
	}

	/** Run `fn` in a local frame: moved, then turned (XYZ order); `mirror` flips it across its YZ plane. */
	in(x: number, y: number, z: number, rx: number, ry: number, rz: number, fn: () => void, mirror = false): void {
		const m = new THREE.Matrix4().compose(P.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(mirror ? -1 : 1, 1, 1));
		this.frames.push(m.premultiply(this.frame));
		fn();
		this.frames.pop();
	}

	/** A point of the current frame in model space (the frame the builder started in). */
	model(x: number, y: number, z: number): V3 {
		P.set(x, y, z).applyMatrix4(this.frame).applyMatrix4(this.rootInv);
		return [P.x, P.y, P.z];
	}

	/** A model-space point in the space of the finished group. */
	placed(p: V3): THREE.Vector3 {
		return new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(this.frames[0]!);
	}

	/** A direction given in the space of the finished group, as a direction of model space (unit length). */
	modelDir(x: number, y: number, z: number): V3 {
		P.set(x, y, z).transformDirection(this.rootInv);
		return [P.x, P.y, P.z];
	}

	/** Uniform scale of the placement. */
	get scale(): number {
		return this.frames[0]!.getMaxScaleOnAxis();
	}

	/** Triangles (flat xyz list, counter-clockwise from outside) of the current frame; flat normals unless given. */
	private emit(m: THREE.Material, pos: readonly number[], nor?: readonly number[]): void {
		const b = this.bucket(m);
		const f = this.frame;
		NM.getNormalMatrix(f);
		const flip = f.determinant() < 0;
		for (let i = 0; i < pos.length; i += 9) {
			if (!nor) {
				A.set(pos[i]!, pos[i + 1]!, pos[i + 2]!);
				B.set(pos[i + 3]!, pos[i + 4]!, pos[i + 5]!);
				C.set(pos[i + 6]!, pos[i + 7]!, pos[i + 8]!);
				N.subVectors(B, A).cross(C.sub(A));
				// A sliver has no direction to light.
				if (N.lengthSq() < 1e-12) continue;
				N.applyMatrix3(NM).normalize();
			}
			for (let k = 0; k < 3; k++) {
				const j = i + (flip ? 2 - k : k) * 3;
				P.set(pos[j]!, pos[j + 1]!, pos[j + 2]!).applyMatrix4(f);
				b.pos.push(P.x, P.y, P.z);
				if (nor) N.set(nor[j]!, nor[j + 1]!, nor[j + 2]!).applyMatrix3(NM).normalize();
				b.nor.push(N.x, N.y, N.z);
			}
		}
	}

	/** A convex solid from its faces (corner lists in any winding): each face is turned to look away from the middle. */
	private solid(m: THREE.Material, faces: readonly (readonly V3[])[]): void {
		let n = 0;
		C.set(0, 0, 0);
		for (const f of faces)
			for (const p of f) {
				C.x += p[0];
				C.y += p[1];
				C.z += p[2];
				n++;
			}
		C.divideScalar(n);
		const pos: number[] = [];
		for (const f of faces) {
			const [a, b, c] = f as [V3, V3, V3];
			U.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
			W.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
			const out = U.cross(W).dot(D.set(a[0] - C.x, a[1] - C.y, a[2] - C.z)) >= 0;
			for (let i = 1; i + 1 < f.length; i++) {
				const p = f[out ? i : i + 1]!;
				const q = f[out ? i + 1 : i]!;
				pos.push(a[0], a[1], a[2], p[0], p[1], p[2], q[0], q[1], q[2]);
			}
		}
		this.emit(m, pos);
	}

	/** Box: size, centre, optional rotation (rad, XYZ order). */
	box(m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
		this.cbox(m, sx, sy, sz, x, y, z, 0, rx, ry, rz);
	}

	/** Box with all its edges chamfered by `c`. */
	cbox(m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, c: number, rx = 0, ry = 0, rz = 0): void {
		const hx = sx / 2;
		const hy = sy / 2;
		const hz = sz / 2;
		const faces: V3[][] = [];
		if (c <= 0) {
			const v = (i: number): V3 => [i & 1 ? hx : -hx, i & 2 ? hy : -hy, i & 4 ? hz : -hz];
			for (const f of [
				[0, 2, 6, 4],
				[1, 3, 7, 5],
				[0, 1, 5, 4],
				[2, 3, 7, 6],
				[0, 1, 3, 2],
				[4, 5, 7, 6]
			])
				faces.push(f.map(v));
		} else {
			// Every corner becomes three points, one on each of its faces.
			const px = (i: number): V3 => [i & 1 ? hx : -hx, (i & 2 ? 1 : -1) * (hy - c), (i & 4 ? 1 : -1) * (hz - c)];
			const py = (i: number): V3 => [(i & 1 ? 1 : -1) * (hx - c), i & 2 ? hy : -hy, (i & 4 ? 1 : -1) * (hz - c)];
			const pz = (i: number): V3 => [(i & 1 ? 1 : -1) * (hx - c), (i & 2 ? 1 : -1) * (hy - c), i & 4 ? hz : -hz];
			for (const s of [0, 1]) {
				faces.push([px(s), px(s | 2), px(s | 6), px(s | 4)]);
				faces.push([py(s * 2), py(s * 2 | 1), py(s * 2 | 5), py(s * 2 | 4)]);
				faces.push([pz(s * 4), pz(s * 4 | 1), pz(s * 4 | 3), pz(s * 4 | 2)]);
			}
			for (let i = 0; i < 8; i++) {
				faces.push([px(i), py(i), pz(i)]);
				// Edge strips: once per edge, from the corner with that axis bit clear.
				if (!(i & 4)) faces.push([px(i), py(i), py(i | 4), px(i | 4)]);
				if (!(i & 2)) faces.push([px(i), pz(i), pz(i | 2), px(i | 2)]);
				if (!(i & 1)) faces.push([py(i), pz(i), pz(i | 1), py(i | 1)]);
			}
		}
		this.in(x, y, z, rx, ry, rz, () => this.solid(m, faces));
	}

	/** Six-sided solid from eight corners: the four of one end, then the four of the other in the same order. */
	hexa(m: THREE.Material, p: readonly V3[]): void {
		const f = (...i: number[]) => i.map((k) => p[k]!);
		this.solid(m, [f(0, 1, 2, 3), f(4, 5, 6, 7), f(0, 1, 5, 4), f(1, 2, 6, 5), f(2, 3, 7, 6), f(3, 0, 4, 7)]);
	}

	/** Rod from `a` to `b` with radius `r` at a and `r2` at b. */
	rod(m: THREE.Material, a: V3, b: V3, r: number, r2 = r, o: RodOpts = {}): void {
		const seg = o.seg ?? 8;
		const smooth = o.smooth ?? seg >= 10;
		const squash = o.squash ?? 1;
		D.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
		const len = D.length();
		if (len < 1e-9) return;
		D.divideScalar(len);
		U.crossVectors(Math.abs(D.y) < 0.99 ? AXIS_Y : AXIS_X, D).normalize();
		W.crossVectors(D, U);
		const ring: number[] = [];
		for (let i = 0; i < seg; i++) {
			const t = ((i + 0.5) / seg) * Math.PI * 2 + (o.roll ?? 0);
			ring.push(Math.cos(t) * U.x + Math.sin(t) * squash * W.x, Math.cos(t) * U.y + Math.sin(t) * squash * W.y, Math.cos(t) * U.z + Math.sin(t) * squash * W.z);
		}
		const pos: number[] = [];
		const nor: number[] = [];
		const at = (end: V3, rad: number, i: number): [number, number, number] => [end[0] + ring[i * 3]! * rad, end[1] + ring[i * 3 + 1]! * rad, end[2] + ring[i * 3 + 2]! * rad];
		for (let i = 0; i < seg; i++) {
			const j = (i + 1) % seg;
			// Counter-clockwise from outside: the ring runs U → W, which is right-handed about D.
			const quad = [at(a, r, i), at(a, r, j), at(b, r2, j), at(b, r2, i)];
			for (const k of r2 > 1e-9 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]) {
				pos.push(...quad[k]!);
				const s = k === 0 || k === 3 ? i : j;
				nor.push(ring[s * 3]!, ring[s * 3 + 1]!, ring[s * 3 + 2]!);
			}
		}
		this.emit(m, pos, smooth ? nor : undefined);
		if (o.open) return;
		const caps: number[] = [];
		for (let i = 1; i + 1 < seg; i++) {
			caps.push(...at(a, r, 0), ...at(a, r, i + 1), ...at(a, r, i));
			if (r2 > 1e-9) caps.push(...at(b, r2, 0), ...at(b, r2, i), ...at(b, r2, i + 1));
		}
		this.emit(m, caps);
	}

	/** Rod along Z (the barrel axis): radius `r` at the rear, `r2` at the front; 12 sides and round by default. */
	cyl(m: THREE.Material, r: number, len: number, x: number, y: number, z: number, seg = 12, r2 = r, o: RodOpts = {}): void {
		this.rod(m, [x, y, z + len / 2], [x, y, z - len / 2], r, r2, { seg, ...o });
	}

	/** Rods through `pts` with a radius per point (or one for all) and a ball on every inner joint. */
	chain(m: THREE.Material, pts: readonly V3[], radii: readonly number[] | number, seg = 6): void {
		const r = (i: number) => (typeof radii === 'number' ? radii : radii[i]!);
		for (let i = 0; i + 1 < pts.length; i++) {
			this.rod(m, pts[i]!, pts[i + 1]!, r(i), r(i + 1), { seg, smooth: false });
			if (i > 0) this.ball(m, r(i) * 1.04, pts[i]![0], pts[i]![1], pts[i]![2]);
		}
	}

	/** Thin triangle seen from both sides (torn cloth). */
	flap(m: THREE.Material, a: V3, b: V3, c: V3): void {
		this.emit(m, [...a, ...b, ...c, ...a, ...c, ...b]);
	}

	/** Low-poly ball (20 faces). */
	ball(m: THREE.Material, r: number, x: number, y: number, z: number): void {
		const g = new THREE.IcosahedronGeometry(r, 0);
		g.translate(x, y, z);
		this.geometry(m, g);
	}

	/**
	 * Side profile ((z, y) points, either winding) extruded across X: `w` wide around `x`,
	 * its two faces bevelled by `bevel`; `hole` cuts an opening through it.
	 */
	prism(m: THREE.Material, profile: readonly P2[], w: number, x = 0, bevel = 0, hole?: readonly P2[]): void {
		// Shape plane: x = forward (−z), y = up; the extrusion axis turns onto +X.
		const g = this.extrude(profile.map(([z, y]) => new THREE.Vector2(-z, y)), w, bevel, hole?.map(([z, y]) => new THREE.Vector2(-z, y)));
		g.rotateY(Math.PI / 2);
		g.translate(x, 0, 0);
		this.geometry(m, g);
	}

	/** Cross-section ((x, y) points) extruded along Z from `z0` to `z1`, its two ends bevelled by `bevel`. */
	xsec(m: THREE.Material, profile: readonly P2[], z0: number, z1: number, bevel = 0): void {
		const g = this.extrude(profile.map(([x, y]) => new THREE.Vector2(x, y)), Math.abs(z1 - z0), bevel);
		g.translate(0, 0, (z0 + z1) / 2);
		this.geometry(m, g);
	}

	/** Extrusion along Z, centred on z = 0, `depth` long including the bevels. */
	private extrude(pts: THREE.Vector2[], depth: number, bevel: number, hole?: THREE.Vector2[]): THREE.BufferGeometry {
		const shape = new THREE.Shape(pts);
		if (hole) shape.holes.push(new THREE.Path(hole));
		// bevelOffset: the profile is the full outline and the bevel cuts into it.
		const g = new THREE.ExtrudeGeometry(shape, { depth: depth - bevel * 2, steps: 1, curveSegments: 1, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1 });
		g.translate(0, 0, -(depth - bevel * 2) / 2);
		return g;
	}

	/** Any three.js geometry, flat shaded, in the current frame; it is disposed here. */
	private geometry(m: THREE.Material, g: THREE.BufferGeometry): void {
		const src = g.index ? g.toNonIndexed() : g;
		this.emit(m, Array.from((src.getAttribute('position') as THREE.BufferAttribute).array));
		if (src !== g) src.dispose();
		g.dispose();
	}

	/** Triangles collected so far. */
	get triangles(): number {
		let n = 0;
		for (const b of this.buckets.values()) n += b.pos.length / 9;
		return n;
	}

	/** One mesh per material, added to `parent`; the geometries are appended to `geometries` (for disposal). */
	build(parent: THREE.Object3D, geometries: THREE.BufferGeometry[]): void {
		for (const [m, b] of this.buckets) {
			const g = new THREE.BufferGeometry();
			g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.pos), 3));
			g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b.nor), 3));
			g.computeBoundingSphere();
			geometries.push(g);
			const mesh = new THREE.Mesh(g, m);
			mesh.name = m.name;
			parent.add(mesh);
		}
		this.buckets.clear();
	}
}
