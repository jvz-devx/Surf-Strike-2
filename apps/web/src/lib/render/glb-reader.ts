/**
 * Minimal reader of the shipped weapon model files (render/weapon-assets.ts)
 * for the node tests, which have no browser loader: the JSON chunk, the
 * triangle count, the mesh itself (meshopt-compressed, quantized) as a
 * plain geometry in asset space, and the whole scene with its named nodes and
 * skins, as the browser loader gives it. Not used by the game.
 */
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

interface Gltf {
	meshes: { primitives: { attributes: Record<string, number>; indices: number }[] }[];
	nodes: { name?: string; skin?: number; mesh?: number; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; children?: number[] }[];
	accessors: { bufferView: number; byteOffset?: number; componentType: number; normalized?: boolean; count: number; type: string }[];
	bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; extensions?: Record<string, MeshoptView> }[];
	images?: unknown[];
	skins?: { joints: number[]; inverseBindMatrices?: number }[];
	scenes: { nodes: number[] }[];
}

interface MeshoptView {
	buffer: number;
	byteOffset?: number;
	byteLength: number;
	byteStride: number;
	count: number;
	mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES';
	filter?: 'NONE' | 'OCTAHEDRAL' | 'QUATERNION' | 'EXPONENTIAL';
}

/** The JSON chunk and the binary chunk of a GLB file. */
export function readGlb(bytes: Uint8Array): { json: Gltf; bin: Uint8Array } {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
	const jsonLen = dv.getUint32(12, true);
	const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen))) as Gltf;
	const binAt = 20 + jsonLen;
	const binLen = dv.getUint32(binAt, true);
	return { json, bin: bytes.subarray(binAt + 8, binAt + 8 + binLen) };
}

/** Triangles of every mesh in the file (index counts / 3). */
export function glbTriangles(json: Gltf): number {
	let n = 0;
	for (const m of json.meshes) for (const p of m.primitives) n += json.accessors[p.indices]!.count / 3;
	return n;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Bytes of a buffer view, decoded when meshopt-compressed. */
async function viewBytes(json: Gltf, bin: Uint8Array, i: number): Promise<{ data: Uint8Array; stride: number }> {
	const v = json.bufferViews[i]!;
	const mo = v.extensions?.EXT_meshopt_compression;
	if (!mo) return { data: bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength), stride: v.byteStride ?? 0 };
	await MeshoptDecoder.ready;
	const out = new Uint8Array(mo.count * mo.byteStride);
	const src = bin.subarray(mo.byteOffset ?? 0, (mo.byteOffset ?? 0) + mo.byteLength);
	MeshoptDecoder.decodeGltfBuffer(out, mo.count, mo.byteStride, src, mo.mode, mo.filter ?? 'NONE');
	return { data: out, stride: mo.byteStride };
}

/** Values of an accessor as floats (normalized integers mapped to −1..1 or 0..1). */
async function accessor(json: Gltf, bin: Uint8Array, i: number): Promise<{ values: Float64Array; size: number }> {
	const a = json.accessors[i]!;
	const size = COMPONENTS[a.type]!;
	const { data, stride } = await viewBytes(json, bin, a.bufferView);
	const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const bytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType]!;
	const step = stride || bytes * size;
	const values = new Float64Array(a.count * size);
	for (let k = 0; k < a.count; k++)
		for (let c = 0; c < size; c++) {
			const at = (a.byteOffset ?? 0) + k * step + c * bytes;
			let v: number;
			switch (a.componentType) {
				case 5120:
					v = dv.getInt8(at);
					if (a.normalized) v = Math.max(v / 127, -1);
					break;
				case 5121:
					v = dv.getUint8(at);
					if (a.normalized) v /= 255;
					break;
				case 5122:
					v = dv.getInt16(at, true);
					if (a.normalized) v = Math.max(v / 32767, -1);
					break;
				case 5123:
					v = dv.getUint16(at, true);
					if (a.normalized) v /= 65535;
					break;
				case 5125:
					v = dv.getUint32(at, true);
					break;
				default:
					v = dv.getFloat32(at, true);
			}
			values[k * size + c] = v;
		}
	return { values, size };
}

/** Local matrix of a node. */
function nodeMatrix(n: Gltf['nodes'][number]): THREE.Matrix4 {
	if (n.matrix) return new THREE.Matrix4().fromArray(n.matrix);
	return new THREE.Matrix4().compose(
		new THREE.Vector3(...((n.translation ?? [0, 0, 0]) as [number, number, number])),
		new THREE.Quaternion(...((n.rotation ?? [0, 0, 0, 1]) as [number, number, number, number])),
		new THREE.Vector3(...((n.scale ?? [1, 1, 1]) as [number, number, number]))
	);
}

/** The triangles of the file as one non-indexed geometry in asset space (node transforms applied). */
export async function glbGeometry(bytes: Uint8Array): Promise<THREE.BufferGeometry> {
	const { json, bin } = readGlb(bytes);
	const parents = new Map<number, number>();
	json.nodes.forEach((n, i) => n.children?.forEach((c) => parents.set(c, i)));
	const world = (i: number): THREE.Matrix4 => {
		const p = parents.get(i);
		const m = nodeMatrix(json.nodes[i]!);
		return p === undefined ? m : m.premultiply(world(p));
	};
	const pos: number[] = [];
	const V = new THREE.Vector3();
	for (const [ni, n] of json.nodes.entries()) {
		if (n.mesh === undefined) continue;
		const m = world(ni);
		for (const prim of json.meshes[n.mesh]!.primitives) {
			const p = await accessor(json, bin, prim.attributes.POSITION!);
			const idx = await accessor(json, bin, prim.indices);
			for (const k of idx.values) {
				V.set(p.values[k * 3]!, p.values[k * 3 + 1]!, p.values[k * 3 + 2]!).applyMatrix4(m);
				pos.push(V.x, V.y, V.z);
			}
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.computeVertexNormals();
	g.computeBoundingBox();
	return g;
}

/**
 * The scene of the file: its node tree by name, every mesh as triangles without an index, all with one
 * material, skinned meshes bound to their bones.
 */
export async function glbScene(bytes: Uint8Array): Promise<THREE.Group> {
	const { json, bin } = readGlb(bytes);
	const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
	const joints = new Set(json.skins?.flatMap((s) => s.joints));
	const objects: THREE.Object3D[] = [];
	const skinned: { mesh: THREE.SkinnedMesh; skin: number }[] = [];
	for (const [i, n] of json.nodes.entries()) {
		let o: THREE.Object3D;
		if (n.mesh !== undefined) {
			const prims = json.meshes[n.mesh]!.primitives;
			if (prims.length !== 1) throw new Error('one primitive per mesh expected');
			const prim = prims[0]!;
			const idx = (await accessor(json, bin, prim.indices)).values;
			const g = new THREE.BufferGeometry();
			for (const [attr, name] of [
				['POSITION', 'position'],
				['NORMAL', 'normal'],
				['JOINTS_0', 'skinIndex'],
				['WEIGHTS_0', 'skinWeight']
			] as const) {
				const at = prim.attributes[attr];
				if (at === undefined) continue;
				const { values, size } = await accessor(json, bin, at);
				const out = new Float32Array(idx.length * size);
				for (let k = 0; k < idx.length; k++) for (let c = 0; c < size; c++) out[k * size + c] = values[idx[k]! * size + c]!;
				g.setAttribute(name, new THREE.BufferAttribute(out, size));
			}
			g.computeBoundingBox();
			if (n.skin !== undefined) {
				const mesh = new THREE.SkinnedMesh(g, material);
				skinned.push({ mesh, skin: n.skin });
				o = mesh;
			} else o = new THREE.Mesh(g, material);
		} else o = joints.has(i) ? new THREE.Bone() : new THREE.Object3D();
		o.name = n.name ?? '';
		nodeMatrix(n).decompose(o.position, o.quaternion, o.scale);
		objects.push(o);
	}
	const scene = new THREE.Group();
	json.nodes.forEach((n, i) => n.children?.forEach((c) => objects[i]!.add(objects[c]!)));
	for (const i of json.scenes[0]!.nodes) scene.add(objects[i]!);
	for (const { mesh, skin } of skinned) {
		const s = json.skins![skin]!;
		const inv = (await accessor(json, bin, s.inverseBindMatrices!)).values;
		const skeleton = new THREE.Skeleton(
			s.joints.map((j) => objects[j] as THREE.Bone),
			s.joints.map((_, k) => new THREE.Matrix4().fromArray(Array.from(inv.subarray(k * 16, k * 16 + 16))))
		);
		mesh.normalizeSkinWeights();
		mesh.bind(skeleton, new THREE.Matrix4());
	}
	return scene;
}
