/**
 * First-person gloved hands (tools/models/procedural/hands.py): one skinned right hand with its forearm in
 * `hands-fp.glb`, mirrored here for the left one. Skinned, not jointed: a pair costs two draw calls
 * (34 rigid segments would be 34), and the knuckles bend without gaps; three.js poses it on the CPU too, so
 * the tests measure the real skin in node (`skinnedPositions`). The code-built hands (render/viewmodels.ts) show until the
 * file has loaded and stay if it fails.
 */
import type { WeaponId } from '@surf/shared';
import * as THREE from 'three';
import type { GunRig, PartName } from './gun-rig.js';
import { freeShape, weaponHands, type FreePoseName, type HandPlace, type HandPose, type HandShape, type HandSide, type PoseName, type WeaponHands } from './hand-poses.js';

/** URL of the shipped file (apps/web/static). */
export const HANDS_URL = '/models/weapons/hands-fp.glb';
/** Size and cost limits of the file, checked by the tests (the triangles of one hand). */
export const HANDS_BUDGET = { bytes: 300_000, triangles: 7_500 } as const;

export const FINGER_NAMES = ['index', 'middle', 'ring', 'pinky'] as const;
/** Bones and their parents; every bone is bound without a turn (hands.py). */
export const HAND_BONES: Readonly<Record<string, string | null>> = {
	hand: null,
	forearm: 'hand',
	...Object.fromEntries([...FINGER_NAMES, 'thumb'].flatMap((f) => [1, 2, 3].map((i) => [f + i, i === 1 ? 'hand' : f + (i - 1)])))
};
/** Direction of the straight thumb of the right hand and the axis its outer joints bend about (hand space). */
const THUMB_DIR = new THREE.Vector3(-0.66, -0.3, -0.69).normalize();
const THUMB_FLEX = new THREE.Vector3().crossVectors(THUMB_DIR, new THREE.Vector3(0.72, -0.62, -0.3)).normalize();
/** The fingers bend towards the palm about −X, and sideways about −Y (towards the thumb of the right hand). */
const FLEX = new THREE.Vector3(-1, 0, 0);
const SPLAY = new THREE.Vector3(0, 1, 0);
/** Length of the sleeve from the wrist and its radius there: it has to end off screen. */
export const SLEEVE = { end: 32, r: 2.9 } as const;

const Q1 = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const V1 = new THREE.Vector3();
const E1 = new THREE.Euler();
const BACK = new THREE.Vector3(0, 0, 1);

/** Turns of the bones for a shape, right hand: name → quaternion, written into `out`. */
export function shapeTurns(shape: HandShape, out: Map<string, THREE.Quaternion>): void {
	const at = (name: string) => {
		let q = out.get(name);
		if (!q) out.set(name, (q = new THREE.Quaternion()));
		return q;
	};
	FINGER_NAMES.forEach((f, k) => {
		const [splay, a, b, c] = shape.fingers.slice(k * 4, k * 4 + 4) as [number, number, number, number];
		at(f + 1)
			.setFromAxisAngle(SPLAY, splay)
			.multiply(Q1.setFromAxisAngle(FLEX, a));
		at(f + 2).setFromAxisAngle(FLEX, b);
		at(f + 3).setFromAxisAngle(FLEX, c);
	});
	const [x, y, z, b, c] = shape.thumb as [number, number, number, number, number];
	at('thumb1').setFromEuler(E1.set(x, y, z));
	at('thumb2').setFromAxisAngle(THUMB_FLEX, b);
	at('thumb3').setFromAxisAngle(THUMB_FLEX, c);
}

/** Mirror a turn across the YZ plane. */
const mirrored = (q: THREE.Quaternion): THREE.Quaternion => q.set(q.x, -q.y, -q.z, q.w);

/** The loaded hand file: shared geometry (and its mirror image), material and bone table for every weapon. */
export class HandKit {
	private readonly made: Hand[] = [];

	private constructor(
		readonly material: THREE.Material,
		private readonly geometry: Readonly<Record<HandSide, THREE.BufferGeometry>>,
		private readonly joints: readonly string[],
		private readonly bones: ReadonlyMap<string, THREE.Vector3>,
		private readonly inverses: Readonly<Record<HandSide, readonly THREE.Matrix4[]>>
	) {}

	/** From a loaded scene; null when it isn't the hand file. */
	static from(scene: THREE.Object3D): HandKit | null {
		const meshes: THREE.SkinnedMesh[] = [];
		scene.traverse((o) => {
			if (o instanceof THREE.SkinnedMesh) meshes.push(o);
		});
		const m = meshes[0];
		if (meshes.length !== 1 || !m || Array.isArray(m.material)) return null;
		const bones = new Map<string, THREE.Vector3>();
		for (const b of m.skeleton.bones) bones.set(b.name, b.position.clone());
		if (Object.keys(HAND_BONES).some((n) => !bones.has(n))) return null;
		lightHands(m.material);
		const M = new THREE.Matrix4().makeScale(-1, 1, 1);
		return new HandKit(
			m.material,
			{ r: m.geometry, l: mirrorGeometry(m.geometry) },
			m.skeleton.bones.map((b) => b.name),
			bones,
			{ r: m.skeleton.boneInverses.map((i) => i.clone()), l: m.skeleton.boneInverses.map((i) => M.clone().multiply(i).multiply(M)) }
		);
	}

	/** A hand of its own (bones and mesh), with the shared geometry and material. */
	make(side: HandSide): Hand {
		const h = new Hand(side, this.geometry[side], this.material, this.joints, this.bones, this.inverses[side]);
		this.made.push(h);
		return h;
	}

	/** Frees the shared geometry, material and textures, and the bones of every hand made from it. */
	dispose(): void {
		for (const h of this.made) h.dispose();
		this.geometry.r.dispose();
		this.geometry.l.dispose();
		for (const v of Object.values(this.material)) if (v instanceof THREE.Texture) v.dispose();
		this.material.dispose();
	}
}

/**
 * Cloth and leather: no room reflection (it turns the sleeve pale), and the little of its own colour
 * as emissive that the code-built hands have, so the glove and the sleeve keep their colours.
 */
function lightHands(m: THREE.Material): void {
	if (!(m instanceof THREE.MeshStandardMaterial)) return;
	m.envMap = null;
	m.emissive.setScalar(0.14);
	m.emissiveMap = m.map;
	m.needsUpdate = true;
}

/** The same mesh flipped across the YZ plane: positions, normals and the winding. */
function mirrorGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
	const out = new THREE.BufferGeometry();
	for (const [name, a] of Object.entries(g.attributes)) {
		const flip = name === 'position' || name === 'normal';
		const own = a as THREE.BufferAttribute;
		// Quantized attributes keep their type; a normalized integer is its own negative.
		const copy = new THREE.BufferAttribute(new (own.array.constructor as new (n: number) => THREE.TypedArray)(own.count * own.itemSize), own.itemSize, own.normalized);
		for (let i = 0; i < own.count; i++) for (let k = 0; k < own.itemSize; k++) copy.setComponent(i, k, flip && k === 0 ? -own.getComponent(i, k) : own.getComponent(i, k));
		out.setAttribute(name, copy);
	}
	const n = g.index ? g.index.count : g.getAttribute('position').count;
	const index: number[] = [];
	for (let i = 0; i < n; i += 3) {
		const at = (k: number) => (g.index ? g.index.getX(i + k) : i + k);
		index.push(at(0), at(2), at(1));
	}
	if (g.index) out.setIndex(index);
	else {
		out.setIndex(index);
		const flat = out.toNonIndexed();
		out.dispose();
		return flat;
	}
	return out;
}

/** One posable hand. `group` is in the model space of its weapon. */
export class Hand {
	readonly group = new THREE.Group();
	readonly mesh: THREE.SkinnedMesh;
	private readonly bones = new Map<string, THREE.Bone>();
	private readonly turns = new Map<string, THREE.Quaternion>();

	constructor(
		readonly side: HandSide,
		geometry: THREE.BufferGeometry,
		material: THREE.Material,
		joints: readonly string[],
		at: ReadonlyMap<string, THREE.Vector3>,
		inverses: readonly THREE.Matrix4[]
	) {
		this.group.name = side === 'r' ? 'hand-right' : 'hand-left';
		for (const [name, parent] of Object.entries(HAND_BONES)) {
			const b = new THREE.Bone();
			b.name = name;
			b.position.copy(at.get(name)!);
			if (side === 'l') b.position.x *= -1;
			(parent ? this.bones.get(parent)! : this.group).add(b);
			this.bones.set(name, b);
		}
		this.mesh = new THREE.SkinnedMesh(geometry, material);
		this.mesh.name = 'hand';
		// The bind pose says nothing about where the posed hand is.
		this.mesh.frustumCulled = false;
		this.group.add(this.mesh);
		this.mesh.bind(new THREE.Skeleton(joints.map((n) => this.bones.get(n)!), inverses.map((i) => i.clone())), new THREE.Matrix4());
	}

	/** Bend the fingers. */
	shape(s: HandShape): void {
		shapeTurns(s, this.turns);
		for (const [name, q] of this.turns) this.bones.get(name)!.quaternion.copy(this.side === 'l' ? mirrored(Q1.copy(q)) : q);
	}

	/** Put the hand in its place: wrist, fingers, and the forearm towards the elbow. */
	place(h: HandPlace): void {
		this.group.position.set(h.p[0], h.p[1], h.p[2]);
		this.group.quaternion.set(h.q[0], h.q[1], h.q[2], h.q[3]);
		this.shape(h);
		const arm = this.bones.get('forearm')!;
		V1.set(h.elbow[0], h.elbow[1], h.elbow[2]).sub(this.group.position).applyQuaternion(Q2.copy(this.group.quaternion).invert()).sub(arm.position).normalize();
		arm.quaternion.setFromUnitVectors(BACK, V1);
	}

	/** The cut end of the sleeve in the space of the group's parent, into `out`. */
	sleeveEnd(out: THREE.Vector3): THREE.Vector3 {
		const arm = this.bones.get('forearm')!;
		return out.set(0, 0, SLEEVE.end).applyQuaternion(arm.quaternion).add(arm.position).applyQuaternion(this.group.quaternion).add(this.group.position);
	}

	dispose(): void {
		this.mesh.skeleton.dispose();
	}
}

/** Vertices of a posed hand in world space (three's CPU skinning). Call `updateMatrixWorld` on the scene first. */
export function skinnedPositions(m: THREE.SkinnedMesh): Float32Array {
	m.skeleton.update();
	const n = m.geometry.getAttribute('position').count;
	const out = new Float32Array(n * 3);
	for (let i = 0; i < n; i++) m.getVertexPosition(i, V1).applyMatrix4(m.matrixWorld).toArray(out, i * 3);
	return out;
}

const M1 = new THREE.Matrix4();
const M2 = new THREE.Matrix4();
const M3 = new THREE.Matrix4();
const M4 = new THREE.Matrix4();
const S1 = new THREE.Vector3();

/**
 * The two hands of one weapon, in its model space. `space` is added to the weapon's group; `rest()` is the hip
 * pose. For an animation: `pose(name)` gives a named pose where the gun's parts are now, `blendHands`
 * (render/hand-poses.ts) goes between two of them, `set(side, place)` shows it; null hides the hand.
 */
export class WeaponHandPair {
	readonly space = new THREE.Group();
	readonly hands: Readonly<Record<HandSide, Hand>>;
	private readonly data: WeaponHands;

	/** `root`: model space to the space of the weapon's group; `gun`: the fitted gun and its rig (none: the knife). */
	constructor(
		kit: HandKit,
		id: WeaponId,
		root: THREE.Matrix4,
		private readonly gun: { rig: GunRig; object: THREE.Object3D; fit: THREE.Matrix4 } | null
	) {
		this.data = weaponHands(id)!;
		this.space.name = 'hands';
		root.decompose(this.space.position, this.space.quaternion, this.space.scale);
		this.hands = { r: kit.make('r'), l: kit.make('l') };
		this.space.add(this.hands.r.group, this.hands.l.group);
		this.rest();
	}

	/** The named pose of this weapon. */
	named(name: PoseName): HandPose | null {
		return this.data.poses[name] ?? null;
	}

	/** Names of the poses this weapon has. */
	get names(): PoseName[] {
		return Object.keys(this.data.poses) as PoseName[];
	}

	/** Elbow of a hand (model space). */
	elbow(side: HandSide): HandPlace['elbow'] {
		return this.data.elbow[side];
	}

	/** Matrix of a node of the gun in model space, with the scale of the gun, into M1. */
	private inModel(node: THREE.Object3D): THREE.Matrix4 {
		M1.identity();
		for (let o: THREE.Object3D | null = node; o && o !== this.gun!.object; o = o.parent) {
			M2.compose(o.position, o.quaternion, o.scale);
			M1.premultiply(M2);
		}
		return M1.premultiply(this.gun!.fit);
	}

	/** A place that goes along with a part: from where the part is at rest to where it is now. */
	private ride(part: PartName, h: HandPlace): HandPlace {
		const node = this.gun?.rig.part(part);
		const rest = this.gun?.rig.restOf(part);
		if (!node?.parent || !rest) return h;
		M2.compose(rest.position, rest.quaternion, node.scale);
		M3.copy(this.inModel(node.parent)).multiply(M2).invert();
		M3.premultiply(this.inModel(node)).decompose(V1, Q1, S1);
		const at = new THREE.Vector3(h.p[0], h.p[1], h.p[2]).applyMatrix4(M4.compose(V1, Q1, S1));
		const q = Q1.multiply(Q2.set(h.q[0], h.q[1], h.q[2], h.q[3]));
		return { ...h, p: [at.x, at.y, at.z], q: [q.x, q.y, q.z, q.w] };
	}

	/**
	 * A named pose in model space, with the gun's moving parts where they are now; null when the weapon hasn't got it.
	 * `part`: a part the pose is not attached to, which it goes along with (the hand on the feed cover).
	 */
	pose(name: PoseName, part?: PartName): HandPlace | null {
		const p = this.named(name);
		if (!p) return null;
		const elbow = this.data.elbow[p.side];
		const node = p.at ? this.gun?.rig.point(p.at) : null;
		if (p.at && !node) return null;
		if (!node) return part ? this.ride(part, { ...p, elbow }) : { ...p, elbow };
		// The point within the gun, then the fit of the gun into model space; the scale of the gun is left out.
		this.inModel(node).decompose(V1, Q1, S1);
		const at = new THREE.Vector3(p.p[0], p.p[1], p.p[2]).applyQuaternion(Q1).add(V1);
		const q = Q1.multiply(Q2.set(p.q[0], p.q[1], p.q[2], p.q[3]));
		return { p: [at.x, at.y, at.z], q: [q.x, q.y, q.z, q.w], elbow, fingers: p.fingers, thumb: p.thumb };
	}

	/** Show a hand in a place, or hide it. */
	set(side: HandSide, h: HandPlace | null): void {
		const hand = this.hands[side];
		hand.group.visible = !!h;
		if (h) hand.place(h);
	}

	/** Bend the fingers of a hand without moving it (open hand, fist). */
	shape(side: HandSide, name: FreePoseName): void {
		this.hands[side].shape(freeShape(name));
	}

	/** Both hands back to their rest poses, where the parts are now. */
	rest(): void {
		for (const side of ['r', 'l'] as const) {
			const name = this.data.rest[side];
			this.set(side, name ? this.pose(name) : null);
		}
	}

	/** The cut ends of the shown sleeves in the space of the weapon's group: the tests check they are off screen. */
	arms(): { at: THREE.Vector3; r: number }[] {
		this.space.updateMatrix();
		const s = this.space.scale.x;
		return (['r', 'l'] as const)
			.filter((side) => this.hands[side].group.visible)
			.map((side) => ({ at: this.hands[side].sleeveEnd(new THREE.Vector3()).applyMatrix4(this.space.matrix), r: SLEEVE.r * s }));
	}
}
