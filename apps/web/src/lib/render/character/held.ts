/**
 * Third-person held items (docs/characters.md): the grip table and the meshes
 * of held-models.ts, in grip space (origin in the fist, +X along the barrel,
 * +Y up, +Z right), on the `handR` socket. One geometry per kind, one shared
 * material. Also the throwing knife of the infected and the muzzle flash.
 */
import { PLAYER_HOLDS, type PlayerHold, type WeaponId } from '@surf/shared';
import * as THREE from 'three';
import { reducedMotion } from '../casings.js';
import { FlashShapes } from '../muzzle-flash.js';
import { heldGeometry, heldKnifeGeometry, heldMuzzle, heldParts, type HeldParts } from './held-models.js';

/** Claws are part of the hands, not a held item. */
export type HeldItem = Exclude<WeaponId, 'claws'>;

/** The grip (shared with the server's hit tests) and what the mesh adds to it. */
export interface HeldDef extends PlayerHold {
	/** Barrel end in grip space (muzzle flash, tracer start) and flash size; null and 0 for melee. */
	muzzle: readonly [number, number, number] | null;
	flash: number;
}

const def = (id: HeldItem, flash: number): HeldDef => ({ ...PLAYER_HOLDS[id], muzzle: heldMuzzle(id), flash });

export const HELD: Readonly<Record<HeldItem, HeldDef>> = Object.freeze({
	knife: def('knife', 0),
	pistol: def('pistol', 5),
	lmg: def('lmg', 7),
	smg: def('smg', 6),
	striker: def('striker', 10),
	sniper: def('sniper', 8),
	barrett: def('barrett', 11)
});

/** Shared held-item geometries and material. Owned by a renderer; dispose with it. */
export class HeldAssets {
	readonly material = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x0c0e12 });
	private geos = new Map<HeldItem, THREE.BufferGeometry>();
	private split = new Map<HeldItem, HeldParts | null>();
	private knifeGeo: THREE.BufferGeometry | null = null;
	/** Muzzle flashes, the bore along +X: the shapes of the first-person ones. */
	readonly flashes = new FlashShapes(new THREE.Vector3(1, 0, 0));
	/** Reduced motion: smaller flashes, and not at every shot. */
	readonly calm = reducedMotion();

	geometry(id: HeldItem): THREE.BufferGeometry {
		let g = this.geos.get(id);
		if (!g) this.geos.set(id, (g = heldGeometry(id)));
		return g;
	}

	/** The parts of a gun (built at its first reload); null for melee. */
	parts(id: HeldItem): HeldParts | null {
		let p = this.split.get(id);
		if (p === undefined) this.split.set(id, (p = heldParts(id)));
		return p;
	}

	/** Whole models built so far (tests). */
	get built(): number {
		return this.geos.size + (this.knifeGeo ? 1 : 0);
	}

	/** Guns split into parts so far (tests). */
	get splits(): number {
		return this.split.size;
	}

	/** Throwing knife in the left claw (`handL` socket: X along the fingers, Y to the thumb). */
	knifeInHand(): THREE.Mesh {
		const m = new THREE.Mesh((this.knifeGeo ??= heldKnifeGeometry()), this.material);
		m.name = 'knife-hand';
		return m;
	}

	dispose(): void {
		for (const g of this.geos.values()) g.dispose();
		this.geos.clear();
		for (const p of this.split.values()) {
			p?.body.dispose();
			p?.mag.dispose();
			p?.act?.dispose();
		}
		this.split.clear();
		this.knifeGeo?.dispose();
		this.knifeGeo = null;
		this.flashes.dispose();
		this.material.dispose();
	}
}
