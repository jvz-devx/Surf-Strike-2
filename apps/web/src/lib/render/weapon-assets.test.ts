/**
 * Generated weapon models (render/weapon-assets.ts) in node, without WebGL:
 * every weapon id has a model or is code-built only, the shipped files keep
 * their size and triangle budgets, the fit data puts the muzzle on the screen
 * line of the local tracer, the grip in the right glove and the fore-end in
 * the left one, the sight above the grip and behind the muzzle; the
 * code-built model stays when a file fails, and nothing is fetched until a
 * weapon is held. The shipped files are read with render/glb-reader.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { WEAPONS, type WeaponId } from '@surf/shared';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { HeldAssets } from './character/held.js';
import { restVmFeel } from '../game/gunfeel.js';
import { glbGeometry, glbTriangles, readGlb } from './glb-reader.js';
import { handSamples } from './hand-contact.js';
import { HAND_BONES, HandKit, HANDS_BUDGET, HANDS_URL, skinnedPositions } from './hands.js';
import { shippedLoad } from './shipped-models.js';
import { FP_LIGHT, GENERATED, generated, lightFirstPerson, MODEL_BUDGET, modelBudget, modelUrl, type ModelLoad } from './weapon-assets.js';
import { ZombieRenderer } from './zombies.js';

const IDS = Object.keys(WEAPONS) as WeaponId[];
const WITH = IDS.filter((id) => generated(id) !== null);
const GUNS = WITH.filter((id) => id !== 'knife');
/** Start of the local tracer, as in infected-viewmodels.test.ts (game/infected.ts, game/zombies.ts). */
const TRACER = { right: 7 / 18 / 0.75, down: 6 / 18 / 0.75 };
const V = new THREE.Vector3();

const fileOf = (id: WeaponId) => new URL('../../../static' + modelUrl(id), import.meta.url);
const failingLoad: ModelLoad = () => Promise.reject(new Error('404'));

const vmOf = (z: ZombieRenderer) => z.vmScene.children.find((c): c is THREE.Group => c instanceof THREE.Group)!;
const modelOf = (z: ZombieRenderer) => vmOf(z).children.find((c): c is THREE.Group => c.visible && c instanceof THREE.Group)!;
/** Drawn meshes of a group, by material name. */
function drawn(g: THREE.Object3D, name?: string): THREE.Mesh[] {
	const out: THREE.Mesh[] = [];
	const walk = (o: THREE.Object3D) => {
		if (!o.visible) return;
		if (o instanceof THREE.Mesh && (!name || o.name === name)) out.push(o);
		for (const c of o.children) walk(c);
	};
	walk(g);
	return out;
}

/** A renderer holding `id` with its generated model loaded, posed at rest. */
async function held(id: WeaponId): Promise<ZombieRenderer> {
	const z = new ZombieRenderer(new HeldAssets(), shippedLoad);
	z.setWeapon(id);
	await z.preload([id]);
	z.updateViewmodel(1000, true, 1, 0, restVmFeel());
	z.vmScene.updateMatrixWorld(true);
	return z;
}

describe('generated models: the table and the files', () => {
	it('every weapon id has a generated model or is code-built only; the claws are code-built', () => {
		expect(Object.keys(GENERATED).sort()).toEqual([...IDS].sort());
		expect(GENERATED.claws).toBe('code-built');
		for (const id of IDS) expect(GENERATED[id] === 'code-built' || typeof GENERATED[id] === 'object', id).toBe(true);
		expect(WITH.sort()).toEqual(['barrett', 'knife', 'lmg', 'pistol', 'smg', 'sniper', 'striker']);
	});

	it('each file is shipped and within its size and triangle budget (read from the JSON chunk)', () => {
		let total = 0;
		for (const id of WITH) {
			const f = fileOf(id);
			const bytes = statSync(f).size;
			total += bytes;
			const budget = modelBudget(generated(id)!);
			expect(bytes, id).toBeLessThanOrEqual(budget.bytes);
			const { json } = readGlb(readFileSync(f));
			const tris = glbTriangles(json);
			expect(tris, id).toBeLessThanOrEqual(budget.triangles);
			expect(tris, id).toBeGreaterThan(300);
			// A detailed file keeps the whole mesh: more than a simplified one may have.
			if (generated(id)!.detailed) expect(tris, id).toBeGreaterThan(MODEL_BUDGET.plain.triangles);
			// Base colour, normal and occlusion-roughness-metalness maps.
			expect(json.images?.length, id).toBe(3);
		}
		// The whole added download (each file is fetched on first use only).
		expect(total).toBeLessThan(3_000_000);
	});

	it('asset space: the muzzle (the tip of the blade) at the origin, length 1 along the bore', async () => {
		for (const id of WITH) {
			const g = await glbGeometry(readFileSync(fileOf(id)));
			const b = g.boundingBox!;
			expect(b.min.z, id).toBeCloseTo(0, 2);
			expect(b.max.z, id).toBeCloseTo(1, 2);
			// The front end is a bore around the origin, not a part above or beside it.
			const pos = g.getAttribute('position');
			const mouth = new THREE.Box3();
			for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < 0.01) mouth.expandByPoint(V.fromBufferAttribute(pos, i));
			expect(mouth.containsPoint(new THREE.Vector3(0, 0, mouth.getCenter(V).z)), id).toBe(true);
			expect(mouth.getSize(V).length(), id).toBeLessThan(id === 'knife' ? 0.08 : 0.2);
		}
	});
});

describe('generated models: fit points on the shipped geometry', () => {
	it('the grip, fore-end and sight points lie on the model, the grip centred on the bore plane', async () => {
		for (const id of WITH) {
			const gen = generated(id)!;
			const g = await glbGeometry(readFileSync(fileOf(id)));
			const pos = g.getAttribute('position');
			const near = (p: readonly [number, number, number], r: number) => {
				let n = 0;
				for (let i = 0; i < pos.count; i++) if (V.fromBufferAttribute(pos, i).distanceTo(new THREE.Vector3(...p)) < r) n++;
				return n;
			};
			// The grip point is inside the grip: surface all round it within its half depth.
			expect(near(gen.grip, 0.1), id + ' grip').toBeGreaterThan(10);
			if (gen.fore) expect(near(gen.fore, 0.05), id + ' fore-end').toBeGreaterThan(10);
			// The sight point floats just above the sight: matter within reach below it.
			if (gen.sight) expect(near([gen.sight[0], gen.sight[1] - 0.03, gen.sight[2]], 0.06), id + ' sight').toBeGreaterThan(10);
			// The grip is a slab around x = 0: its vertices at the height of the grip point centre there.
			const slab = new THREE.Box3();
			for (let i = 0; i < pos.count; i++) {
				V.fromBufferAttribute(pos, i);
				if (Math.abs(V.y - gen.grip[1]) < 0.02 && Math.abs(V.z - gen.grip[2]) < 0.03) slab.expandByPoint(V);
			}
			expect(slab.isEmpty(), id).toBe(false);
			expect(Math.abs((slab.min.x + slab.max.x) / 2), id).toBeLessThan(0.02);
		}
	});
});

describe('generated models: first-person fit', () => {
	it('the muzzle sits on the screen line of the local tracer, at the barrel end of the model', async () => {
		for (const id of GUNS) {
			const z = await held(id);
			const g = modelOf(z);
			expect(z.generatedShown(id), id).toBe(true);
			const tan = Math.tan((z.vmCamera.fov * Math.PI) / 360);
			V.copy(g.userData.muzzle as THREE.Vector3).applyMatrix4(vmOf(z).matrixWorld);
			const mx = V.x / (-V.z * tan);
			const my = -V.y / (-V.z * tan);
			expect(mx, id).toBeGreaterThan(0.2);
			expect(my, id).toBeGreaterThan(0.2);
			const off = Math.abs(mx * TRACER.down - my * TRACER.right) / Math.hypot(TRACER.right, TRACER.down);
			expect(off, id).toBeLessThan(0.03);
			expect(Math.hypot(mx, my), id).toBeLessThan(Math.hypot(TRACER.right, TRACER.down));
			// The front of the generated model is at the muzzle point.
			const gun = (g.userData.generated as THREE.Group).children.find((c) => !(c instanceof THREE.Mesh && c.name))!;
			// Precise: the model is turned a little (its sight line), and a turned bounding box overshoots.
			const box = new THREE.Box3().setFromObject(gun, true);
			const m = (g.userData.muzzle as THREE.Vector3).clone().applyMatrix4(g.matrixWorld);
			expect(Math.abs(m.z - box.min.z), id).toBeLessThan(0.05);
			z.dispose();
		}
	});

	it('the grip is in the right glove and the fore-end in the left one; the code-built gun and the box hands are hidden', async () => {
		for (const id of GUNS) {
			const z = await held(id);
			const g = modelOf(z);
			const gen = generated(id)!;
			const gun = (g.userData.generated as THREE.Group).children[0]!;
			const at = (p: readonly [number, number, number]) => new THREE.Vector3(...p).applyMatrix4(gun.matrixWorld);
			// Only the gloved hands are drawn: two on a long gun, one on the pistol, nothing of the code-built model.
			expect(drawn(g, 'glove'), id).toHaveLength(0);
			expect(drawn(g, 'hand'), id).toHaveLength(gen.fore ? 2 : 1);
			for (const c of g.children) if (c instanceof THREE.Mesh) expect(c.visible, id).toBe(false);
			// The gun's own draw calls and the hands': at most eight and two (and the aim mark of an optic).
			expect(drawn(g).length, id).toBeLessThanOrEqual(8 + 2 + (gen.dot ? 1 : 0));
			const pair = z.hands(id)!;
			const glove = (side: 'r' | 'l') => {
				const mesh = pair.hands[side].mesh;
				const p = skinnedPositions(mesh);
				const box = new THREE.Box3();
				for (const s of handSamples(mesh)) if (!s.arm) box.expandByPoint(V.fromArray(p, s.vertex * 3));
				return box;
			};
			expect(glove('r').containsPoint(at(gen.grip)), id + ' grip').toBe(true);
			if (gen.fore) expect(glove('l').containsPoint(at(gen.fore)), id + ' fore-end').toBe(true);
			// The pistol is held in one hand.
			expect((g.userData.arms as unknown[]).length, id).toBe(gen.fore ? 2 : 1);
			z.dispose();
		}
	});

	it('the gun and the hands may arrive in either order, and either may fail: boxes until then', async () => {
		const only = (want: (url: string) => boolean): ModelLoad => (url) => (want(url) ? shippedLoad(url) : failingLoad(url));
		// No hands: the box hands on the generated gun. No gun: the code-built model, the hands unused.
		const a = new ZombieRenderer(new HeldAssets(), only((u) => u !== HANDS_URL));
		a.setWeapon('smg');
		await a.preload(['smg']);
		expect(a.generatedShown('smg')).toBe(true);
		expect(a.hands('smg')).toBeUndefined();
		expect(drawn(modelOf(a), 'glove')).toHaveLength(1);
		expect((modelOf(a).userData.arms as unknown[]).length).toBe(2);
		a.dispose();
		const b = new ZombieRenderer(new HeldAssets(), only((u) => u === HANDS_URL));
		b.setWeapon('smg');
		await b.preload(['smg']);
		expect(b.generatedShown('smg')).toBe(false);
		expect(b.hands('smg')).toBeUndefined();
		expect(drawn(modelOf(b), 'glove')).toHaveLength(1);
		b.dispose();
		// One after the other, both ways.
		for (const late of [HANDS_URL, modelUrl('smg')]) {
			let arrive: (s: THREE.Object3D) => void = () => {};
			const z = new ZombieRenderer(new HeldAssets(), (url) => (url === late ? new Promise((r) => (arrive = r)) : shippedLoad(url)));
			z.setWeapon('smg');
			await new Promise((r) => setTimeout(r, 400));
			expect(z.hands('smg'), late).toBeUndefined();
			expect(drawn(modelOf(z), 'glove'), late).toHaveLength(1);
			arrive(await shippedLoad(late));
			await z.preload([]);
			expect(z.hands('smg'), late).toBeDefined();
			expect(drawn(modelOf(z), 'glove'), late).toHaveLength(0);
			expect(drawn(modelOf(z), 'hand'), late).toHaveLength(2);
			z.dispose();
		}
	});

	it('the hand file: within its budget, one skinned mesh, the bones of render/hands.ts without a bind turn', async () => {
		const bytes = readFileSync(new URL('../../../static' + HANDS_URL, import.meta.url));
		expect(bytes.byteLength).toBeLessThanOrEqual(HANDS_BUDGET.bytes);
		const { json } = readGlb(bytes);
		expect(glbTriangles(json)).toBeLessThanOrEqual(HANDS_BUDGET.triangles);
		expect(json.meshes).toHaveLength(1);
		expect(json.images?.length).toBe(3);
		for (const [name, parent] of Object.entries(HAND_BONES)) {
			const i = json.nodes.findIndex((n) => n.name === name);
			expect(i, name).toBeGreaterThanOrEqual(0);
			const r = json.nodes[i]!.rotation ?? [0, 0, 0, 1];
			expect(Math.abs(r[3]!), name).toBeCloseTo(1, 5);
			if (parent) expect(json.nodes.find((n) => n.name === parent)!.children, name).toContain(i);
		}
		// A gun file, or anything else, is not a hand file.
		expect(HandKit.from(await shippedLoad(modelUrl('smg')))).toBeNull();
		expect(HandKit.from(await shippedLoad(HANDS_URL))).not.toBeNull();
	});

	it('every generated gun has a sight point above the grip, behind the muzzle, near the vertical plane of the barrel', async () => {
		for (const id of GUNS) {
			const gen = generated(id)!;
			expect(gen.sight, id).not.toBeNull();
			const [sx, sy, sz] = gen.sight!;
			expect(sy, id).toBeGreaterThan(gen.grip[1]);
			expect(sy, id).toBeGreaterThan(0);
			expect(sz, id).toBeGreaterThan(0.3);
			expect(Math.abs(sx), id).toBeLessThan(0.02);
			// On the group, in the space of the muzzle: behind it (+Z), above it, in its vertical plane.
			const z = await held(id);
			const g = modelOf(z);
			const s = g.userData.sight as THREE.Vector3;
			const m = g.userData.muzzle as THREE.Vector3;
			expect(s, id).toBeInstanceOf(THREE.Vector3);
			expect(s.z, id).toBeGreaterThan(m.z);
			expect(s.y, id).toBeGreaterThan(m.y);
			// Scopes and optics sit on the vertical plane of the bore, within this margin.
			expect(Math.abs(s.x - m.x), id).toBeLessThan(0.6);
			z.dispose();
		}
		// The knife has none; the code-built models get theirs elsewhere.
		const z = await held('knife');
		expect(modelOf(z).userData.sight).toBeUndefined();
		z.dispose();
		const c = new ZombieRenderer(new HeldAssets());
		c.setWeapon('lmg');
		expect(modelOf(c).userData.sight).toBeUndefined();
		c.dispose();
	});

	it('the knife: the blade is generated, the gloved hand closes round its handle', async () => {
		const z = await held('knife');
		const g = modelOf(z);
		expect(drawn(g, 'glove')).toHaveLength(0);
		expect(drawn(g, 'hand')).toHaveLength(1);
		expect(drawn(g).filter((m) => m.name !== 'hand')).toHaveLength(1);
		expect(g.userData.muzzle).toBeNull();
		z.dispose();
	});

	it('a failed file leaves the code-built model, its muzzle and its hands', async () => {
		const z = new ZombieRenderer(new HeldAssets(), failingLoad);
		const ref = new ZombieRenderer(new HeldAssets());
		for (const id of WITH) {
			z.setWeapon(id);
			ref.setWeapon(id);
			await z.preload([id]);
			expect(z.generatedShown(id), id).toBe(false);
			const g = modelOf(z);
			expect(g.userData.generated, id).toBeUndefined();
			expect(drawn(g).length, id).toBe(drawn(modelOf(ref)).length);
			expect(g.userData.muzzle, id).toEqual(modelOf(ref).userData.muzzle);
		}
		z.dispose();
		ref.dispose();
	});

	it('the code-built model shows until the file has arrived, then the generated one, in the same group', async () => {
		let arrive: (s: THREE.Object3D) => void = () => {};
		const z = new ZombieRenderer(new HeldAssets(), (url) => (url === modelUrl('lmg') ? new Promise((r) => (arrive = r)) : failingLoad(url)));
		z.setWeapon('lmg');
		z.updateViewmodel(1000, true, 0.4, 0, restVmFeel());
		const g = modelOf(z);
		const before = g.userData.muzzle as THREE.Vector3;
		expect(z.generatedShown('lmg')).toBe(false);
		// It arrives in the middle of a reload: the same group takes it, the pose carries on.
		arrive(await shippedLoad(modelUrl('lmg')));
		await z.preload([]);
		z.updateViewmodel(1016, true, 0.42, 0, restVmFeel());
		expect(modelOf(z)).toBe(g);
		expect(z.generatedShown('lmg')).toBe(true);
		expect(g.userData.muzzle).not.toBe(before);
		z.dispose();
	});

	it('nothing is fetched on a map without weapons, and each file only once', async () => {
		const load = vi.fn(failingLoad);
		const z = new ZombieRenderer(new HeldAssets(), load);
		z.setWeapon(null);
		z.updateViewmodel(1000, false, 1, 0);
		z.clear();
		expect(load).not.toHaveBeenCalled();
		// The claws are code-built only.
		z.setWeapon('claws');
		expect(load).not.toHaveBeenCalled();
		z.setWeapon('smg');
		z.setWeapon('pistol');
		z.setWeapon('smg');
		await z.preload([]);
		// The hands come with the first weapon.
		expect(load.mock.calls.map((c) => c[0])).toEqual([HANDS_URL, modelUrl('smg'), modelUrl('pistol')]);
		z.dispose();
	});

	it('first-person material: the shared room reflection, or the own shade of a model (base colour darkened)', () => {
		const env = new THREE.Texture();
		for (const id of WITH) {
			const gen = generated(id)!;
			const m = new THREE.MeshStandardMaterial({ color: 0xffffff });
			lightFirstPerson(m, env, gen);
			expect(m.envMap, id).toBe(env);
			expect(m.envMapIntensity, id).toBe(gen.shade?.env ?? FP_LIGHT.env);
			expect(m.color.r, id).toBeCloseTo(gen.shade?.color ?? 1, 9);
		}
		// No shipped model needs its own shade now; the path stays covered with a made-up one.
		const own = { ...generated('lmg')!, shade: { env: 0.1, color: 0.7 } };
		const m = new THREE.MeshStandardMaterial({ color: 0xffffff });
		lightFirstPerson(m, env, own);
		expect(m.envMapIntensity).toBe(0.1);
		expect(m.color.r).toBeCloseTo(0.7, 9);
	});

	it('the generated parts are disposed with the renderer', async () => {
		const z = new ZombieRenderer(new HeldAssets(), shippedLoad);
		await z.preload(WITH);
		const live = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
		const track = (r: THREE.BufferGeometry | THREE.Material | THREE.Texture) => {
			if (live.has(r)) return;
			live.add(r);
			r.addEventListener('dispose', () => live.delete(r));
		};
		z.vmScene.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			track(o.geometry as THREE.BufferGeometry);
			const m = o.material as THREE.MeshStandardMaterial;
			track(m);
			if (m.map) track(m.map);
		});
		expect(live.size).toBeGreaterThan(80);
		z.dispose();
		expect(live.size).toBe(0);
	});
});

describe('generated models: names', () => {
	it('no brand or franchise names in the code or the file names', () => {
		const banned = /pp-?90|street.?sweeper|glock|beretta|\bcolt\b|remington|kalashnikov|\bak-?\d|\bm4a\d|\bawp\b|deagle|desert eagle|\buzi\b|\bmp\d\b|\bm249\b|\bm24\b|\bm107\b|\bm82|mossberg|ontario|\bsaw\b|\bacog\b|\baa-?12\b|call of duty|counter-?strike|left 4 dead/i;
		for (const f of ['weapon-assets.ts', 'glb-reader.ts', 'gun-rig.ts', 'hands.ts', 'hand-poses.ts', 'hand-contact.ts', 'character/held.ts', 'character/held-models.ts', 'players.ts']) {
			const src = readFileSync(new URL(f, import.meta.url), 'utf8');
			expect(src.match(banned)?.[0], f).toBeUndefined();
		}
		// The script-built guns: every file in the folder, so a new gun script is checked too.
		const procedural = readdirSync(new URL('../../../../../tools/models/procedural/', import.meta.url), { withFileTypes: true })
			.filter((f) => f.isFile())
			.map((f) => '../../../../../tools/models/procedural/' + f.name);
		expect(procedural).toContain('../../../../../tools/models/procedural/common.py');
		for (const f of ['../../../../../tools/models/manifest.json', '../../../../../tools/models/prep.py', '../../../../../tools/models/build.sh', ...procedural]) {
			const src = readFileSync(new URL(f, import.meta.url), 'utf8');
			expect(src.match(banned)?.[0], f).toBeUndefined();
		}
		for (const id of WITH) expect(modelUrl(id)).toMatch(/^\/models\/weapons\/[a-z]+-fp\.glb$/);
	});
});
