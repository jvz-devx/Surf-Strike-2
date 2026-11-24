/**
 * Client side of the cosmetic registry (docs/characters.md): the mesh of every
 * item in `packages/shared/src/cosmetics.ts`. Data and mesh are registered
 * separately so the server never loads geometry.
 */
import { COSMETIC_SLOTS, defaultItem, getCosmetic, type CosmeticSlot, type Loadout } from '@surf/shared';
import * as THREE from 'three';
import type { BodyRegion } from './body.js';
import type { PartBuilder } from './mesh-kit.js';
import { buildDefaultBottom, buildDefaultShoes, buildDefaultTop } from './outfit.js';

/** Up to four sRGB hex colours: palette A, B, C, D of the item's slot. */
export type ItemColors = readonly number[];

export interface ItemMesh {
	/** Body regions this item covers; they are left out of the mesh. */
	hides?: readonly BodyRegion[];
	/** Fixed colours, or derived from the player's own tint (default clothes). */
	colors: ItemColors | ((tint: PlayerTint) => ItemColors);
	/** Glow per colour, 0 (plain cloth) to 1 (unlit); see CharacterMaterial. */
	glow?: readonly number[];
	/** Hat that covers the whole face: worn glasses are not drawn. */
	coversFace?: boolean;
	/** Add the geometry. Clothes are skinned; hats and glasses use `b.socket(...)`. */
	build(b: PartBuilder): void;
}

/** Per-player colours of the default clothes (from the stable player hue). */
export interface PlayerTint {
	top: THREE.Color;
	bottom: THREE.Color;
}

const WHITE = new THREE.Color(0xffffff);
const MESHES = new Map<string, ItemMesh>();

/** Register the mesh of an item. Throws on a duplicate id. */
export function registerItemMesh(id: string, mesh: ItemMesh): void {
	if (MESHES.has(id)) throw new Error(`Duplicate item mesh "${id}"`);
	MESHES.set(id, mesh);
}

export function itemMesh(id: string): ItemMesh | undefined {
	return MESHES.get(id);
}

/** The item drawn in a slot: the equipped one if it is known and has a mesh, else the slot's default. */
export function drawnItem(loadout: Loadout, slot: CosmeticSlot): string | null {
	const id = loadout[slot];
	if (id !== null && MESHES.has(id) && (getCosmetic(id)?.slot ?? slot) === slot) return id;
	return defaultItem(slot)?.id ?? null;
}

/** Drawn item per slot (effects are not geometry: always null here, see effects.ts). */
export function drawnItems(loadout: Loadout): Record<CosmeticSlot, string | null> {
	return Object.fromEntries(COSMETIC_SLOTS.map((s) => [s, drawnItem(loadout, s)])) as Record<CosmeticSlot, string | null>;
}

registerItemMesh('top_default', {
	colors: (t) => [t.top.getHex(), t.top.clone().offsetHSL(0, -0.05, -0.16).getHex(), t.top.clone().lerp(WHITE, 0.82).getHex(), 0x20242a],
	build: buildDefaultTop
});
registerItemMesh('bottom_default', {
	hides: ['shins'],
	colors: (t) => [t.bottom.getHex(), t.bottom.clone().offsetHSL(0, 0, -0.07).getHex(), 0x2a2420, 0xb9a46a],
	build: buildDefaultBottom
});
registerItemMesh('shoes_default', {
	colors: (t) => [0x343a44, 0xe9e6dc, t.top.clone().lerp(WHITE, 0.1).getHex(), 0xf2f0ea],
	build: buildDefaultShoes
});
