/** Loot box model (shop picture; docs/economy.md#loot-box). Original procedural design, standing on y = 0, front +X. */
import { LOOTBOX, RARITIES, type RarityId } from '@surf/shared';
import * as THREE from 'three';

/** Build the box; call `dispose` when done. */
export function createLootbox(): { group: THREE.Group; dispose(): void } {
	const group = new THREE.Group();
	const owned: { dispose(): void }[] = [];
	const mat = (color: number | string, o: THREE.MeshStandardMaterialParameters = {}) => {
		const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...o });
		owned.push(m);
		return m;
	};
	const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
		owned.push(geo);
		const mesh = new THREE.Mesh(geo, m);
		mesh.position.set(x, y, z);
		group.add(mesh);
		return mesh;
	};
	const hull = mat(0x24476b);
	const dark = mat(0x16293d);
	const gold = mat(0xe2aa45, { roughness: 0.35, metalness: 0.35 });
	const glow = mat(0xfff1c4, { emissive: 0xffd978, emissiveIntensity: 1.2 });

	// Body, with the light of the gap under the lid.
	add(new THREE.BoxGeometry(15, 10, 22), hull, 0, 5.6, 0);
	add(new THREE.BoxGeometry(16, 1.4, 23), dark, 0, 0.7, 0);
	add(new THREE.BoxGeometry(14.4, 0.9, 21.4), glow, 0, 10.9, 0);
	// Rounded lid: half a cylinder along Z, flattened.
	const lid = add(new THREE.CylinderGeometry(7.7, 7.7, 22.6, 28, 1, false, 0, Math.PI), hull, 0, 11.3, 0);
	lid.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
	// Gold straps over body and lid.
	for (const z of [-7.6, 7.6]) {
		add(new THREE.BoxGeometry(15.6, 10, 2.4), gold, 0, 5.6, z);
		const strap = add(new THREE.CylinderGeometry(8.1, 8.1, 2.4, 28, 1, false, 0, Math.PI), gold, 0, 11.3, z);
		strap.quaternion.copy(lid.quaternion);
	}
	// Corner posts.
	for (const x of [-7.3, 7.3]) for (const z of [-11, 11]) add(new THREE.BoxGeometry(1.4, 10.4, 1.4), gold, x, 5.6, z);
	// Lock plate with a keyhole.
	add(new THREE.BoxGeometry(1.2, 6, 5.4), gold, 8, 10.6, 0);
	const hole = add(new THREE.CylinderGeometry(0.85, 0.85, 0.3, 16), dark, 8.6, 11.2, 0);
	hole.rotation.z = Math.PI / 2;
	add(new THREE.BoxGeometry(0.3, 1.9, 0.75), dark, 8.6, 10.1, 0);
	// A gem per rarity that can be inside.
	(Object.keys(LOOTBOX.odds) as RarityId[]).forEach((r, i, all) => {
		const c = RARITIES[r].color;
		const gem = add(new THREE.OctahedronGeometry(1.15), mat(c, { emissive: c, emissiveIntensity: 0.45, roughness: 0.25 }), 7.7, 4.2, (i - (all.length - 1) / 2) * 3);
		gem.scale.set(0.6, 1, 1);
	});
	return {
		group,
		dispose: () => {
			for (const o of owned) o.dispose();
		}
	};
}
