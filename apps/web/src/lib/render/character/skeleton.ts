/**
 * Character skeleton (docs/characters.md). Model space: facing +X, Y up, +Z to
 * the character's right, feet at y = 0, Hammer units.
 *
 * Bones are flat: each one holds its model-space position and rotation, which
 * the animator writes directly. The bind pose has no rotation (an A-pose with
 * the arms 35° out). The `*H` helper bones sit on a joint with half of its
 * rotation, so bent elbows, knees, hips and shoulders keep their volume.
 */
import { BODY_ANKLE_X, BODY_ANKLE_Y, BODY_BALL, BODY_HIP_Y, BODY_HIP_Z, BODY_KNEE_Y, BODY_THIGH, PLAYER_FOREARM, PLAYER_UPPER_ARM } from '@surf/shared';
import * as THREE from 'three';

export const CENTER_BONES = ['pelvis', 'spine', 'chest', 'neck', 'head'] as const;
export const SIDE_BONES = [
	'clav',
	'upperH',
	'upper',
	'foreH',
	'fore',
	'hand',
	'fingers',
	'tips',
	'thighH',
	'thigh',
	'shinH',
	'shin',
	'foot',
	'toe'
] as const;
export type CenterBone = (typeof CENTER_BONES)[number];
export type SideBone = (typeof SIDE_BONES)[number];
export type Side = 'L' | 'R';
export type BoneName = CenterBone | `${SideBone}${Side}`;

export const BONES: readonly BoneName[] = [
	...CENTER_BONES,
	...SIDE_BONES.map((b) => `${b}L` as BoneName),
	...SIDE_BONES.map((b) => `${b}R` as BoneName)
];
export const BONE_INDEX = Object.freeze(Object.fromEntries(BONES.map((b, i) => [b, i]))) as Readonly<Record<BoneName, number>>;

export type V3 = readonly [number, number, number];

/** Arm direction in the bind pose: 35° out from straight down. */
export const ARM_TILT = (35 * Math.PI) / 180;
export const UPPER_ARM = PLAYER_UPPER_ARM;
export const FOREARM = PLAYER_FOREARM;
export const HIP_Y = BODY_HIP_Y;
export const KNEE_Y = BODY_KNEE_Y;
export const ANKLE_Y = BODY_ANKLE_Y;
export const THIGH = BODY_THIGH;
export const SHIN = KNEE_Y - ANKLE_Y;
/** Ball of the foot relative to the ankle. */
export const BALL: V3 = BODY_BALL;

/** +1 right (+Z), −1 left. */
export const sideSign = (s: Side): 1 | -1 => (s === 'R' ? 1 : -1);

/** Unit arm direction of a side in the bind pose. */
export function armDir(s: Side): V3 {
	return [0, -Math.cos(ARM_TILT), sideSign(s) * Math.sin(ARM_TILT)];
}

const SHOULDER: V3 = [-0.3, 53.9, 8.5];
const HIP_Z = BODY_HIP_Z;

function bind(name: BoneName): V3 {
	switch (name) {
		case 'pelvis':
			return [0, 37, 0];
		case 'spine':
			return [-0.2, 42.5, 0];
		case 'chest':
			return [-0.3, 48, 0];
		case 'neck':
			return [-0.8, 58, 0];
		case 'head':
			return [-0.4, 61.2, 0];
	}
	const s = name.endsWith('R') ? 'R' : 'L';
	const z = sideSign(s);
	const d = armDir(s);
	const along = (t: number): V3 => [SHOULDER[0] + d[0] * t, SHOULDER[1] + d[1] * t, z * SHOULDER[2] + d[2] * t];
	switch (name.slice(0, -1) as SideBone) {
		case 'clav':
			return [-0.3, 54.4, z * 2.6];
		case 'upperH':
		case 'upper':
			return along(0);
		case 'foreH':
		case 'fore':
			return along(UPPER_ARM);
		case 'hand':
			return along(UPPER_ARM + FOREARM);
		case 'fingers':
			return along(UPPER_ARM + FOREARM + 3.6);
		case 'tips':
			return along(UPPER_ARM + FOREARM + 5.1);
		case 'thighH':
		case 'thigh':
			return [0, HIP_Y, z * HIP_Z];
		case 'shinH':
		case 'shin':
			return [0, KNEE_Y, z * HIP_Z];
		case 'foot':
			return [BODY_ANKLE_X, ANKLE_Y, z * HIP_Z];
		case 'toe':
			return [BODY_ANKLE_X + BALL[0], ANKLE_Y + BALL[1], z * HIP_Z];
	}
}

/** Bind position of every bone. */
export const BIND = Object.freeze(Object.fromEntries(BONES.map((b) => [b, bind(b)]))) as Readonly<Record<BoneName, V3>>;

// ---------------------------------------------------------------------------
// Sockets

/** Named attachment points. Rigid cosmetics and held items sit on them. */
export const SOCKETS = ['hat', 'glasses', 'handR', 'handL', 'back'] as const;
export type SocketName = (typeof SOCKETS)[number];

export interface SocketDef {
	bone: BoneName;
	/** Model-space bind position. */
	pos: V3;
	/** Bind rotation. Hands: X = along the fingers, Y = thumb side. */
	quat: THREE.Quaternion;
}

function handQuat(s: Side): THREE.Quaternion {
	const d = armDir(s);
	const x = new THREE.Vector3(d[0], d[1], d[2]);
	const y = new THREE.Vector3(1, 0, 0);
	return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)));
}

function palm(s: Side): V3 {
	const h = BIND[`hand${s}`];
	const d = armDir(s);
	return [h[0], h[1] + d[1] * 3, h[2] + d[2] * 3];
}

export const SOCKET_DEFS: Readonly<Record<SocketName, SocketDef>> = Object.freeze({
	/** Centre of the head at hat-band height. */
	hat: { bone: 'head', pos: [-0.35, 68.4, 0], quat: new THREE.Quaternion() },
	/** Bridge of the nose, between the eyes. */
	glasses: { bone: 'head', pos: [4.9, 66.2, 0], quat: new THREE.Quaternion() },
	handR: { bone: 'handR', pos: palm('R'), quat: handQuat('R') },
	handL: { bone: 'handL', pos: palm('L'), quat: handQuat('L') },
	back: { bone: 'chest', pos: [-5.4, 51, 0], quat: new THREE.Quaternion() }
});

// ---------------------------------------------------------------------------
// Runtime skeleton

/** Model-space transform of a bone. */
export interface BonePose {
	position: THREE.Vector3;
	quaternion: THREE.Quaternion;
}

/**
 * Skeleton whose bones live outside the scene graph: their model-space poses
 * go straight into the bone matrices, so a character costs one world matrix
 * per frame instead of one per bone. Bind it with identity matrices.
 */
class FlatSkeleton extends THREE.Skeleton {
	dirty = true;

	constructor(private readonly poses: readonly BonePose[]) {
		super(DUMMY_BONES, DUMMY_INVERSES);
	}

	override update(): void {
		if (!this.dirty) return;
		this.dirty = false;
		const out = this.boneMatrices as unknown as Float32Array;
		for (let i = 0; i < this.poses.length; i++) {
			const { position: p, quaternion: q } = this.poses[i]!;
			const [bx, by, bz] = BIND_LIST[i]!;
			const x2 = q.x + q.x;
			const y2 = q.y + q.y;
			const z2 = q.z + q.z;
			const xx = q.x * x2;
			const xy = q.x * y2;
			const xz = q.x * z2;
			const yy = q.y * y2;
			const yz = q.y * z2;
			const zz = q.z * z2;
			const wx = q.w * x2;
			const wy = q.w * y2;
			const wz = q.w * z2;
			const o = i * 16;
			const m0 = 1 - (yy + zz);
			const m1 = xy + wz;
			const m2 = xz - wy;
			const m4 = xy - wz;
			const m5 = 1 - (xx + zz);
			const m6 = yz + wx;
			const m8 = xz + wy;
			const m9 = yz - wx;
			const m10 = 1 - (xx + yy);
			out[o] = m0;
			out[o + 1] = m1;
			out[o + 2] = m2;
			out[o + 4] = m4;
			out[o + 5] = m5;
			out[o + 6] = m6;
			out[o + 8] = m8;
			out[o + 9] = m9;
			out[o + 10] = m10;
			// Rotation about the bind position.
			out[o + 12] = p.x - (m0 * bx + m4 * by + m8 * bz);
			out[o + 13] = p.y - (m1 * bx + m5 * by + m9 * bz);
			out[o + 14] = p.z - (m2 * bx + m6 * by + m10 * bz);
			out[o + 3] = out[o + 7] = out[o + 11] = 0;
			out[o + 15] = 1;
		}
		if (this.boneTexture) this.boneTexture.needsUpdate = true;
	}
}

const BIND_LIST = BONES.map((b) => BIND[b]);
/** Only their number matters to three.js. */
const DUMMY_BONES = BONES.map(() => new THREE.Bone());
const DUMMY_INVERSES = BONES.map(() => new THREE.Matrix4());

export interface CharacterSkeleton {
	skeleton: FlatSkeleton;
	bones: Record<BoneName, BonePose>;
	/** Add these to the mesh; `updateSockets` moves them. */
	sockets: Record<SocketName, THREE.Object3D>;
}

export function createSkeleton(): CharacterSkeleton {
	const bones = {} as Record<BoneName, BonePose>;
	const list = BONES.map((name) => (bones[name] = { position: new THREE.Vector3(...BIND[name]), quaternion: new THREE.Quaternion() }));
	const sockets = {} as Record<SocketName, THREE.Object3D>;
	for (const name of SOCKETS) {
		const o = new THREE.Object3D();
		o.name = `socket:${name}`;
		sockets[name] = o;
	}
	return { skeleton: new FlatSkeleton(list), bones, sockets };
}

const SOCKET_OFFSET = Object.fromEntries(
	SOCKETS.map((s) => {
		const d = SOCKET_DEFS[s];
		return [s, new THREE.Vector3(...d.pos).sub(new THREE.Vector3(...BIND[d.bone]))];
	})
) as Record<SocketName, THREE.Vector3>;

/** After posing the bones: move the sockets that carry something, and upload the matrices on the next draw. */
export function commitPose(sk: CharacterSkeleton): void {
	sk.skeleton.dirty = true;
	for (const name of SOCKETS) {
		const o = sk.sockets[name];
		if (o.children.length === 0) continue;
		const d = SOCKET_DEFS[name];
		const b = sk.bones[d.bone];
		o.position.copy(SOCKET_OFFSET[name]).applyQuaternion(b.quaternion).add(b.position);
		o.quaternion.copy(b.quaternion).multiply(d.quat);
	}
}
