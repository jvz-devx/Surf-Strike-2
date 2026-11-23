/**
 * Third-person held items (docs/characters.md): small original meshes built in
 * grip space (origin in the fist, +X along the barrel, +Y up, +Z right) that
 * sit on the `handR` socket. One geometry per kind, one shared material.
 */
import type { WeaponId } from '@surf/shared';
import * as THREE from 'three';

/** Claws are part of the hands, not a held item. */
export type HeldItem = Exclude<WeaponId, 'claws'>;

export interface HeldDef {
	/** `one`: a knife; `pistol`: both hands around the grip; `long`: shouldered, left hand on `fore`. */
	hold: 'one' | 'pistol' | 'long';
	/** Left hand position in grip space. */
	fore: readonly [number, number, number];
	/** Right grip position relative to the shoulder pivot, in the aim frame. */
	at: readonly [number, number, number];
}

export const HELD: Readonly<Record<HeldItem, HeldDef>> = Object.freeze({
	knife: { hold: 'one', fore: [0, 0, 0], at: [10, -6.5, 7] },
	pistol: { hold: 'pistol', fore: [-0.4, -1.1, -1.1], at: [14.5, -0.6, 1.2] },
	lmg: { hold: 'long', fore: [7.4, 1.2, -0.4], at: [8.6, -4.6, 4.6] },
	smg: { hold: 'long', fore: [6.2, 0.2, -0.4], at: [9.6, -3.2, 4] },
	striker: { hold: 'long', fore: [7.6, 0.6, -0.4], at: [8.6, -4.2, 4.4] },
	sniper: { hold: 'long', fore: [7.6, 0.8, -0.4], at: [8.6, -3.2, 4.2] },
	barrett: { hold: 'long', fore: [8, 1, -0.4], at: [8.4, -3.6, 4.4] }
});

type Box = readonly [color: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, rz?: number];

const METAL = 0x2f343b;
const DARK = 0x191b1f;
const STEEL = 0xb4bbc4;
const OLIVE = 0x4a5238;
const WOOD = 0x6a4a2e;
const SLATE = 0x3c424b;

const PARTS: Readonly<Record<HeldItem, readonly Box[]>> = {
	// Hammer grip: the blade runs along the thumb side (+Y).
	knife: [
		[DARK, 1.0, 4.6, 0.8, 0, 0.2, 0],
		[SLATE, 2.2, 0.5, 1.0, 0, 2.7, 0],
		[STEEL, 1.5, 5.4, 0.3, 0.05, 5.6, 0],
		[STEEL, 1.0, 1.9, 0.26, 0.3, 8.6, 0, -0.35]
	],
	pistol: [
		[METAL, 7.6, 1.7, 1.4, 2.6, 2.2, 0],
		[DARK, 6, 0.7, 1.2, 2.4, 1.1, 0],
		[DARK, 1.9, 4.2, 1.2, -0.3, -0.7, 0, -0.18],
		[DARK, 2.2, 0.3, 0.5, 1.9, -0.4, 0],
		[STEEL, 0.5, 0.4, 0.3, 5.8, 3.2, 0]
	],
	lmg: [
		[OLIVE, 13, 3.1, 2.4, 2.5, 2.4, 0],
		[METAL, 12, 1.0, 1.0, 14, 2.9, 0],
		[METAL, 7, 2.0, 1.9, 11, 2.5, 0],
		[DARK, 4, 4.2, 3, 4.6, -1, 0.1],
		[DARK, 1.8, 4, 1.2, -0.3, -0.7, 0, -0.2],
		[OLIVE, 5.4, 2.6, 1.7, -5.6, 1.7, 0, 0.1],
		[DARK, 1, 3.6, 1.9, -8.6, 1.4, 0],
		[DARK, 4, 0.8, 0.8, 4, 4.6, 0],
		[METAL, 5, 0.4, 0.4, 16, 1, 0.8, 0.1],
		[METAL, 5, 0.4, 0.4, 16, 1, -0.8, 0.1]
	],
	smg: [
		[SLATE, 10, 2.6, 1.8, 2.4, 2, 0],
		[DARK, 9, 0.6, 1.1, 2.2, 3.5, 0],
		[DARK, 3.4, 0.8, 0.8, 9, 2.4, 0],
		[SLATE, 9, 1.7, 1.7, 5.2, 0.3, 0],
		[METAL, 0.5, 2, 2, 2.4, 0.3, 0],
		[METAL, 0.5, 2, 2, 5.2, 0.3, 0],
		[METAL, 0.5, 2, 2, 8, 0.3, 0],
		[DARK, 1.8, 3.6, 1.2, -0.3, -0.8, 0, -0.2],
		[METAL, 5, 0.5, 0.5, -5, 2.6, 0.6],
		[METAL, 5, 0.5, 0.5, -5, 2.6, -0.6],
		[DARK, 0.7, 3, 1.8, -7.6, 1.8, 0]
	],
	striker: [
		[METAL, 11, 2.8, 2.2, 2, 2.2, 0],
		[DARK, 3.2, 5, 3.8, 4.4, -0.2, 0],
		[SLATE, 3.4, 3.6, 4.8, 4.4, -0.2, 0],
		[SLATE, 9, 1.9, 1.9, 12, 2.8, 0],
		[DARK, 11, 1, 1, 13, 2.8, 0],
		[DARK, 1.6, 3.6, 1.3, 9.5, 0.2, 0],
		[DARK, 1.8, 4, 1.2, -0.3, -0.7, 0, -0.2],
		[METAL, 5, 0.6, 1.8, -5.6, 2.6, 0],
		[DARK, 0.8, 3.4, 1.8, -8.2, 1.6, 0]
	],
	sniper: [
		[WOOD, 15, 2.2, 1.7, 3, 1.6, 0],
		[METAL, 15, 0.8, 0.8, 16.5, 2.6, 0],
		[METAL, 8, 1.4, 1.4, 2, 2.9, 0],
		[DARK, 8, 1.4, 1.4, 2.4, 5, 0],
		[DARK, 1.6, 1.9, 1.9, 6.6, 5, 0],
		[DARK, 0.6, 1.4, 0.7, 0.6, 4, 0],
		[DARK, 0.6, 1.4, 0.7, 4.2, 4, 0],
		[STEEL, 0.5, 0.5, 2, -0.6, 3, 1.4],
		[WOOD, 1.8, 3.4, 1.3, -0.4, -0.4, 0, -0.4],
		[WOOD, 6, 2.6, 1.6, -5.8, 1, 0, 0.12],
		[DARK, 0.8, 3.4, 1.7, -8.8, 0.7, 0]
	],
	barrett: [
		[METAL, 17, 2.6, 2, 2.5, 2.2, 0],
		[SLATE, 14, 0.5, 1.2, 3, 3.7, 0],
		[METAL, 13, 1.2, 1.2, 17, 2.4, 0],
		[DARK, 2.8, 1.5, 3, 24.2, 2.4, 0],
		[DARK, 3.4, 5, 1.8, 4.6, -1.2, 0, 0.06],
		[DARK, 1.9, 4, 1.2, -0.4, -0.7, 0, -0.25],
		[METAL, 4, 2.6, 1.6, -6.8, 1.6, 0],
		[DARK, 1.1, 4, 2, -9, 1.3, 0],
		[DARK, 8.5, 1.5, 1.5, 2, 5.8, 0],
		[DARK, 1.8, 2.1, 2.1, 6.6, 5.8, 0],
		[SLATE, 0.8, 1.8, 0.8, 0.2, 4.6, 0],
		[SLATE, 0.8, 1.8, 0.8, 4, 4.6, 0],
		[DARK, 7, 0.4, 0.4, 12.5, 1, 0.8, 0.06],
		[DARK, 7, 0.4, 0.4, 12.5, 1, -0.8, 0.06]
	]
};

function buildHeld(boxes: readonly Box[]): THREE.BufferGeometry {
	const pos: number[] = [];
	const nrm: number[] = [];
	const col: number[] = [];
	const idx: number[] = [];
	const c = new THREE.Color();
	const m = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const p = new THREE.Vector3();
	for (const [color, sx, sy, sz, x, y, z, rz = 0] of boxes) {
		const g = new THREE.BoxGeometry(sx, sy, sz);
		q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rz);
		g.applyMatrix4(m.compose(p.set(x, y, z), q, new THREE.Vector3(1, 1, 1)));
		const base = pos.length / 3;
		pos.push(...g.getAttribute('position').array);
		nrm.push(...g.getAttribute('normal').array);
		c.setHex(color);
		for (let i = 0; i < g.getAttribute('position').count; i++) col.push(c.r, c.g, c.b);
		for (const i of g.getIndex()!.array) idx.push(base + i);
		g.dispose();
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
	g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	g.setIndex(idx);
	g.computeBoundingSphere();
	return g;
}

/** Shared held-item geometries and material. Owned by a renderer; dispose with it. */
export class HeldAssets {
	readonly material = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x0c0e12 });
	private geos = new Map<HeldItem, THREE.BufferGeometry>();

	geometry(id: HeldItem): THREE.BufferGeometry {
		let g = this.geos.get(id);
		if (!g) this.geos.set(id, (g = buildHeld(PARTS[id])));
		return g;
	}

	dispose(): void {
		for (const g of this.geos.values()) g.dispose();
		this.geos.clear();
		this.material.dispose();
	}
}
