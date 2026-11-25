/** Poses, a frame view and look-ups for tests of the remote characters. Not a test file itself. */
import * as THREE from 'three';
import { HeldAssets } from './character/held.js';
import type { CharacterMaterial } from './character/material.js';
import { PAL } from './character/mesh-kit.js';
import { CharacterModel, personOf, type CharacterRole } from './character/model.js';
import { BIND, BONE_INDEX, type BoneName } from './character/skeleton.js';
import { emptyPose, type AvatarPose, type RemotePlayers } from './players.js';

/** A player standing (or `ducked`) still at Source feet coordinates. */
export function standing(x: number, y: number, z: number, yaw = 0, ducked = false, pitch = 0): AvatarPose {
	return { ...emptyPose(), x, y, z, yaw, ducked, pitch };
}

/** One frame: everybody on screen, close to the camera. */
export function animate(players: RemotePlayers, now: number, dt = 1 / 60): void {
	players.update({ dt, distance: () => 100 }, now);
}

/** The character drawn under an avatar or corpse root. */
export function character(root: THREE.Object3D): THREE.SkinnedMesh<THREE.BufferGeometry, CharacterMaterial> {
	return root.getObjectByName('character') as THREE.SkinnedMesh<THREE.BufferGeometry, CharacterMaterial>;
}

/** World position of a bone of a drawn character. */
export function bonePoint(root: THREE.Object3D, bone: BoneName): THREE.Vector3 {
	const mesh = character(root);
	mesh.skeleton.update();
	mesh.updateWorldMatrix(true, false);
	const m = new THREE.Matrix4().fromArray(mesh.skeleton.boneMatrices as unknown as number[], BONE_INDEX[bone] * 16);
	return new THREE.Vector3(...BIND[bone]).applyMatrix4(m).applyMatrix4(mesh.matrixWorld);
}

/** Main colour of the top a character wears. */
export function topColor(root: THREE.Object3D): number {
	const p = character(root).material.palette[PAL.topA]!;
	return new THREE.Color(p.x, p.y, p.z).getHex();
}

/** The top colour of a role look. */
export function roleTop(role: CharacterRole): number {
	const assets = new HeldAssets();
	const m = new CharacterModel(personOf(1), assets);
	m.setRole(role);
	const hex = topColor(m.group);
	m.dispose();
	assets.dispose();
	return hex;
}
