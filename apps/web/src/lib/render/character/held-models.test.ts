/**
 * The third-person weapon meshes (held-models.ts) against the grip table and
 * the script-built first-person guns: colours, triangle budget, the grip in
 * the right fist, the fore-end over the left hand, the muzzle at the barrel
 * end.
 */
import { WEAPONS } from '@surf/shared';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { HELD, HeldAssets, type HeldItem } from './held.js';
import { HELD_BUDGET, HELD_COLORS, HELD_KNIFE_BUDGET, heldKnifeGeometry } from './held-models.js';

const IDS = Object.keys(HELD) as HeldItem[];
const GUNS = IDS.filter((w) => WEAPONS[w].magazine > 0);
const assets = new HeldAssets();
const MAT = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
afterAll(() => {
	assets.dispose();
	MAT.dispose();
});

/** Distance along a ray (grip space) to the model, or Infinity. */
function hit(w: HeldItem, from: THREE.Vector3, dir: THREE.Vector3): number {
	const r = new THREE.Raycaster(from, dir.clone().normalize());
	return r.intersectObject(new THREE.Mesh(assets.geometry(w), MAT))[0]?.distance ?? Infinity;
}

/** Distance from a point to the model surface, and the nearest surface point. */
function nearest(g: THREE.BufferGeometry, p: THREE.Vector3): { d: number; at: THREE.Vector3 } {
	const pos = g.getAttribute('position') as THREE.BufferAttribute;
	const tri = new THREE.Triangle();
	const q = new THREE.Vector3();
	const best = { d: Infinity, at: new THREE.Vector3() };
	for (let i = 0; i < pos.count; i += 3) {
		tri.setFromAttributeAndIndices(pos, i, i + 1, i + 2);
		tri.closestPointToPoint(p, q);
		const d = q.distanceTo(p);
		if (d < best.d) {
			best.d = d;
			best.at.copy(q);
		}
	}
	return best;
}

/** Vertex colours of a model, as sRGB hex. */
function colors(w: HeldItem): Set<number> {
	const a = assets.geometry(w).getAttribute('color');
	const c = new THREE.Color();
	const out = new Set<number>();
	for (let i = 0; i < a.count; i++) out.add(c.fromBufferAttribute(a, i).getHex());
	return out;
}

/** Base colour (sRGB, 0..1) of a surface in a gun script. */
function base(script: string, surface: string): number[] {
	const src = readFileSync(new URL(`../../../../../../tools/models/procedural/${script}.py`, import.meta.url), 'utf8');
	const m = new RegExp(`'${surface}': dict\\([^\\n]*?base=\\(([^)]*)\\)`).exec(src);
	if (!m) throw new Error(`${script}: no ${surface}`);
	return m[1]!.split(',').map(Number);
}
const rgb = (hex: number) => [(hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

describe('third-person weapons match the first-person ones', () => {
	it('the colours are the base colours of the script-built guns, wood and brass a little lighter', () => {
		for (const [name, script, surface, slack] of [
			['gunmetal', 'lmg', 'steel', 0.04],
			['gunmetal', 'heavy_rifle', 'steel', 0.04],
			['steel', 'common', 'bright', 0.04],
			['polymer', 'common', 'polymer', 0.04],
			['rubber', 'common', 'rubber', 0.04],
			['pouch', 'lmg', 'pouch', 0.04],
			['wood', 'sniper', 'wood', 0.12],
			['brass', 'common', 'brass', 0.08]
		] as const) {
			const want = base(script, surface);
			rgb(HELD_COLORS[name]).forEach((v, i) => expect(Math.abs(v - want[i]!), `${name} of ${script}`).toBeLessThan(slack));
		}
	});

	it('the sniper rifle has a wooden stock; the LMG is black with a lens of its optic over the rail; the shotgun has its drum', () => {
		const wooden = IDS.filter((w) => colors(w).has(HELD_COLORS.wood));
		expect(wooden).toEqual(['sniper']);
		expect(colors('lmg').has(HELD_COLORS.glass)).toBe(true);
		const pos = assets.geometry('lmg').getAttribute('position');
		const col = assets.geometry('lmg').getAttribute('color');
		const glass = new THREE.Color(HELD_COLORS.glass);
		let low = Infinity;
		for (let i = 0; i < col.count; i++) if (Math.abs(col.getZ(i) - glass.b) < 1e-4) low = Math.min(low, pos.getY(i));
		expect(low).toBeGreaterThan(HELD.lmg.muzzle![1] + 1.5);
		// The drum hangs below the bore, ahead of the grip, wider than the receiver.
		const drum = hit('striker', new THREE.Vector3(5.5, -2, 20), new THREE.Vector3(0, 0, -1));
		expect(drum).toBeLessThan(20 - 1.5);
	});

	it('every model stays within its triangle budget; one vertex-coloured geometry with unit normals', () => {
		for (const w of IDS) {
			const g = assets.geometry(w);
			const tris = g.getAttribute('position').count / 3;
			expect(tris, w).toBeGreaterThan(40);
			expect(tris, w).toBeLessThanOrEqual(HELD_BUDGET[w]);
			const n = g.getAttribute('normal');
			for (let i = 0; i < n.count; i += 11) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
			expect(g.getAttribute('color').count).toBe(n.count);
		}
		const k = heldKnifeGeometry();
		expect(k.getAttribute('position').count / 3).toBeLessThanOrEqual(HELD_KNIFE_BUDGET);
		k.dispose();
	});

	it('is built once per weapon', () => {
		const a = new HeldAssets();
		expect(a.built).toBe(0);
		expect(a.geometry('smg')).toBe(a.geometry('smg'));
		expect(a.knifeInHand().geometry).toBe(a.knifeInHand().geometry);
		expect(a.built).toBe(2);
		a.dispose();
		expect(a.built).toBe(0);
	});
});

describe('third-person weapons sit in the hands', () => {
	it('the grip is in the right fist: the surface within 1.6 units to either side of the origin', () => {
		for (const w of IDS)
			for (const s of [-1, 1]) {
				const d = 10 - hit(w, new THREE.Vector3(0, 0, s * 10), new THREE.Vector3(0, 0, -s));
				expect(d, `${w} side ${s}`).toBeGreaterThan(0);
				expect(d, `${w} side ${s}`).toBeLessThanOrEqual(1.6);
			}
	});

	it('the left hand is at the fore-end of every long gun: the model within 1.6 units of it, ahead of the grip, below the bore', () => {
		for (const w of GUNS.filter((g) => HELD[g].hold === 'long')) {
			const l = new THREE.Vector3(...HELD[w].fore);
			const n = nearest(assets.geometry(w), l);
			expect(n.d, w).toBeLessThanOrEqual(1.6);
			expect(n.at.x, w).toBeGreaterThan(l.x - 1.6);
			expect(n.at.y, w).toBeLessThan(HELD[w].muzzle![1]);
			expect(l.x, w).toBeGreaterThan(8);
		}
	});

	it('the muzzle is the barrel end: nothing in front of it, the bore axis runs through it, level and centred', () => {
		for (const w of GUNS) {
			const mz = new THREE.Vector3(...HELD[w].muzzle!);
			const g = assets.geometry(w);
			g.computeBoundingBox();
			expect(g.boundingBox!.max.x, w).toBeLessThanOrEqual(mz.x + 0.01);
			expect(Math.abs(hit(w, mz.clone().add(new THREE.Vector3(5, 0, 0)), new THREE.Vector3(-1, 0, 0)) - 5), w).toBeLessThanOrEqual(0.1);
			expect(Math.abs(mz.z), w).toBeLessThan(1e-6);
			expect(mz.x, w).toBeGreaterThan(HELD[w].fore[0] + 2);
			expect(HELD[w].flash, w).toBeGreaterThan(0);
		}
		expect(HELD.knife.muzzle).toBeNull();
	});

	it('lengths keep their order: the .50 cal is the longest, then the sniper rifle; the pistol is the shortest gun', () => {
		const len = (w: HeldItem) => {
			const g = assets.geometry(w);
			g.computeBoundingBox();
			return g.boundingBox!.max.x - g.boundingBox!.min.x;
		};
		const order = [...GUNS].sort((a, b) => len(b) - len(a));
		expect(order[0]).toBe('barrett');
		expect(order.at(-1)).toBe('pistol');
	});
});
