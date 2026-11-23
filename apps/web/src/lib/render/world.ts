/**
 * Map geometry: brush face polygons from `buildSolid`, fan-triangulated and
 * merged into one BufferGeometry per material, plus optional edge lines.
 * Non-solid brushes (`solid: false`, hide and seek fake walls) are drawn exactly
 * like solid ones: same material buckets, no visual hint.
 */
import { buildSolid, type AABB, type MapDef, type MaterialDef } from '@surf/shared';
import * as THREE from 'three';
import { pushThree } from './coords.js';
import { biasLineDepth, createBrushMaterial, DEFAULT_MATERIAL, materialOpacity, type SharedUniforms } from './materials.js';

export interface WorldMeshes {
	group: THREE.Group;
	/** Source-space bounds of all brushes. */
	bounds: AABB;
	dispose(): void;
}

interface Bucket {
	pos: number[];
	nrm: number[];
}

export function buildWorldMeshes(map: MapDef, shared: SharedUniforms): WorldMeshes {
	const group = new THREE.Group();
	group.name = 'world';
	const buckets = new Map<string, Bucket>();
	const bounds: AABB = {
		min: { x: Infinity, y: Infinity, z: Infinity },
		max: { x: -Infinity, y: -Infinity, z: -Infinity }
	};

	for (const def of map.brushes) {
		let solid;
		try {
			solid = buildSolid(def);
		} catch {
			continue;
		}
		const b = solid.bounds;
		bounds.min.x = Math.min(bounds.min.x, b.min.x);
		bounds.min.y = Math.min(bounds.min.y, b.min.y);
		bounds.min.z = Math.min(bounds.min.z, b.min.z);
		bounds.max.x = Math.max(bounds.max.x, b.max.x);
		bounds.max.y = Math.max(bounds.max.y, b.max.y);
		bounds.max.z = Math.max(bounds.max.z, b.max.z);
		const key = solid.material ?? def.material;
		let bucket = buckets.get(key);
		if (!bucket) buckets.set(key, (bucket = { pos: [], nrm: [] }));
		for (const face of solid.faces) {
			const v = face.vertices;
			if (v.length < 3) continue;
			for (let i = 1; i < v.length - 1; i++) {
				pushThree(bucket.pos, v[0]);
				pushThree(bucket.pos, v[i]);
				pushThree(bucket.pos, v[i + 1]);
				for (let k = 0; k < 3; k++) pushThree(bucket.nrm, face.normal);
			}
		}
	}
	if (!Number.isFinite(bounds.min.x)) {
		bounds.min = { x: -1024, y: -1024, z: 0 };
		bounds.max = { x: 1024, y: 1024, z: 512 };
	}

	const disposables: Array<{ dispose(): void }> = [];
	for (const [name, bucket] of buckets) {
		if (bucket.pos.length === 0) continue;
		const def: MaterialDef = map.theme.materials[name] ?? DEFAULT_MATERIAL;
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(bucket.pos, 3));
		geo.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.nrm, 3));
		geo.computeBoundingSphere();
		const mat = createBrushMaterial(def, shared);
		const mesh = new THREE.Mesh(geo, mat);
		mesh.name = `brushes:${name}`;
		mesh.matrixAutoUpdate = false;
		// Glass / see-through brushes draw after opaque geometry and its edge lines.
		if (materialOpacity(def) < 1) mesh.renderOrder = 2;
		group.add(mesh);
		disposables.push(geo, mat);

		if (def.edgeColor !== undefined) {
			const edges = new THREE.EdgesGeometry(geo, 20);
			const lineMat = biasLineDepth(
				new THREE.LineBasicMaterial({
					color: def.edgeColor,
					fog: true,
					transparent: true,
					opacity: 0.95,
					blending: THREE.AdditiveBlending,
					depthWrite: false
				})
			);
			const lines = new THREE.LineSegments(edges, lineMat);
			lines.name = `edges:${name}`;
			lines.matrixAutoUpdate = false;
			lines.renderOrder = 1;
			group.add(lines);
			disposables.push(edges, lineMat);
		}
	}

	return {
		group,
		bounds,
		dispose() {
			group.removeFromParent();
			for (const d of disposables) d.dispose();
		}
	};
}
