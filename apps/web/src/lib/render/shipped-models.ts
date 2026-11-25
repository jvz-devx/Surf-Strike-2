/**
 * The shipped model files as the browser loader gives them, for the node tests: each file is read once
 * (render/glb-reader.ts) and every load gets its own copy. Not used by the game.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { glbGeometry, glbScene } from './glb-reader.js';

const bytesOf = (url: string): Uint8Array => readFileSync(new URL('../../../static' + url, import.meta.url));

/** A copy with its own geometry and one material of its own. */
function own(scene: THREE.Object3D): THREE.Object3D {
	const out = cloneSkinned(scene);
	const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
	out.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		o.geometry = (o.geometry as THREE.BufferGeometry).clone();
		o.material = material;
	});
	return out;
}

const scenes = new Map<string, Promise<THREE.Group>>();
/** A shipped file with its named nodes and skins. */
export async function shippedLoad(url: string): Promise<THREE.Object3D> {
	let s = scenes.get(url);
	if (!s) scenes.set(url, (s = glbScene(bytesOf(url))));
	return own(await s);
}

/** A shipped file as a scene with one mesh, no nodes: a gun file without moving parts. */
export async function flatLoad(url: string): Promise<THREE.Object3D> {
	const scene = new THREE.Group();
	scene.add(new THREE.Mesh(await glbGeometry(bytesOf(url)), new THREE.MeshStandardMaterial({ map: new THREE.Texture() })));
	return scene;
}
