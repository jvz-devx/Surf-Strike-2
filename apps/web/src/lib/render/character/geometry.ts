/**
 * Character geometry (docs/characters.md): builds parts once per LOD, merges
 * the parts of a look into one skinned geometry and shares it between every
 * character with the same look (reference counted, freed with its last user).
 */
import { COSMETIC_SLOTS, type CosmeticSlot } from '@surf/shared';
import * as THREE from 'three';
import { BODY_REGIONS, buildClaws, buildForearms, buildHair, buildHands, buildHead, buildNeck, buildShins, buildUpperArms, buildWholeArms, type BodyRegion, type HairStyle } from './body.js';
import { itemMesh } from './items.js';
import { PartBuilder, type Lod, type PartData } from './mesh-kit.js';



/** What a merged geometry contains. */
export interface LookSpec {
	hair: HairStyle;
	/** Item id per slot. */
	items: Record<CosmeticSlot, string | null>;
	claws: boolean;
	/** Keeps the geometry apart from other users of the same look (a second WebGL context). */
	tag?: string;
}

export function lookKey(l: LookSpec): string {
	return `${l.hair}|${COSMETIC_SLOTS.map((s) => l.items[s] ?? '').join('|')}|${l.claws ? 'c' : ''}${l.tag ? `|${l.tag}` : ''}`;
}

const REGION_BUILD: Record<Exclude<BodyRegion, 'hair'>, (b: PartBuilder) => void> = {
	neck: buildNeck,
	upperArms: buildUpperArms,
	forearms: buildForearms,
	hands: buildHands,
	shins: buildShins
};

const parts = new Map<string, PartData>();

function part(key: string, lod: Lod, build: (b: PartBuilder) => void): PartData {
	const id = `${key}@${lod}`;
	let p = parts.get(id);
	if (!p) {
		const b = new PartBuilder(lod);
		build(b);
		parts.set(id, (p = b.data));
	}
	return p;
}

/** Parts of a look, in draw order. */
export function lookParts(look: LookSpec, lod: Lod): PartData[] {
	const hidden = new Set<BodyRegion>();
	for (const s of COSMETIC_SLOTS) {
		const id = look.items[s];
		for (const r of (id && itemMesh(id)?.hides) || []) hidden.add(r);
	}
	const out = [part('head', lod, buildHead)];
	const flat = hidden.has('hair');
	out.push(part(`hair:${look.hair}:${flat ? 'flat' : 'full'}`, lod, (b) => buildHair(b, look.hair, flat)));
	if (!hidden.has('upperArms') && !hidden.has('forearms')) {
		out.push(part('arms', lod, buildWholeArms));
		hidden.add('upperArms').add('forearms');
	}
	for (const r of BODY_REGIONS) if (r !== 'hair' && !hidden.has(r)) out.push(part(r, lod, REGION_BUILD[r]));
	if (look.claws) out.push(part('claws', lod, buildClaws));
	for (const s of COSMETIC_SLOTS) {
		const id = look.items[s];
		const mesh = id ? itemMesh(id) : undefined;
		if (id && mesh) out.push(part(`item:${id}`, lod, (b) => mesh.build(b)));
	}
	return out;
}

export function mergeParts(list: readonly PartData[]): THREE.BufferGeometry {
	let nv = 0;
	let ni = 0;
	for (const p of list) {
		nv += p.pos.length / 3;
		ni += p.idx.length;
	}
	if (nv > 65535) throw new Error(`Character mesh too large: ${nv} vertices`);
	const pos = new Float32Array(nv * 3);
	const nrm = new Int8Array(nv * 4);
	const si = new Uint8Array(nv * 4);
	const sw = new Uint8Array(nv * 4);
	const pal = new Uint8Array(nv * 4);
	const idx = new Uint16Array(ni);
	let v = 0;
	let k = 0;
	for (const p of list) {
		const n = p.pos.length / 3;
		pos.set(p.pos, v * 3);
		for (let i = 0; i < n; i++) {
			const o = (v + i) * 4;
			for (let c = 0; c < 3; c++) nrm[o + c] = Math.round(p.nrm[i * 3 + c]! * 127);
			// Weights as bytes that add up to exactly 255.
			let rest = 255;
			let big = 0;
			for (let c = 0; c < 4; c++) {
				si[o + c] = p.si[i * 4 + c]!;
				const w = Math.round(p.sw[i * 4 + c]! * 255);
				sw[o + c] = w;
				rest -= w;
				if (w > sw[o + big]!) big = c;
			}
			sw[o + big] = sw[o + big]! + rest;
			pal[o] = p.pal[i]!;
			pal[o + 1] = Math.round(Math.max(0, Math.min(1.25, p.shade[i]!)) * 200);
		}
		for (const i of p.idx) idx[k++] = v + i;
		v += n;
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	g.setAttribute('normal', new THREE.BufferAttribute(nrm, 4, true));
	g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
	g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4, true));
	/** x: palette index, y: shade × 200. */
	g.setAttribute('aPal', new THREE.BufferAttribute(pal, 4));
	g.setIndex(new THREE.BufferAttribute(idx, 1));
	g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 38, 0), 52);
	return g;
}

// ---------------------------------------------------------------------------
// Shared, reference counted geometries

interface Shared {
	key: string;
	/** Built on first use. */
	lods: (THREE.BufferGeometry | null)[];
	look: LookSpec;
	refs: number;
}

const shared = new Map<string, Shared>();

/** Handle to the shared geometries of a look. */
export class LookGeometry {
	private released = false;

	constructor(private readonly s: Shared) {
		s.refs++;
	}

	get key(): string {
		return this.s.key;
	}

	get(lod: Lod): THREE.BufferGeometry {
		return (this.s.lods[lod] ??= mergeParts(lookParts(this.s.look, lod)));
	}

	release(): void {
		if (this.released) return;
		this.released = true;
		if (--this.s.refs > 0) return;
		for (const g of this.s.lods) g?.dispose();
		shared.delete(this.s.key);
	}
}

export function acquireLook(look: LookSpec): LookGeometry {
	const key = lookKey(look);
	let s = shared.get(key);
	if (!s) shared.set(key, (s = { key, lods: [null, null, null], look: { ...look, items: { ...look.items } }, refs: 0 }));
	return new LookGeometry(s);
}

/** Number of live shared looks (tests). */
export function liveLooks(): number {
	return shared.size;
}
