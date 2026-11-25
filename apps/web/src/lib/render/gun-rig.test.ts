/**
 * Moving parts of the first-person guns (render/gun-rig.ts) on the shipped files: every gun has its named
 * parts and points, each at its pivot, within the draw-call limit; parts move along their travel and come back;
 * a weapon change resets them; a gun file without parts works.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { restVmFeel } from '../game/gunfeel.js';
import { readGlb } from './glb-reader.js';
import { GUN_PARTS, GunRig, partSteps, PART_NAMES, POINT_NAMES, stepAmounts, type GunId, type PartName } from './gun-rig.js';
import { flatLoad, shippedLoad } from './shipped-models.js';
import { GENERATED, meshesOf, modelUrl, type GeneratedModel } from './weapon-assets.js';
import { HeldAssets } from './character/held.js';
import { ZombieRenderer } from './zombies.js';

const GUNS = Object.keys(GUN_PARTS) as GunId[];
/** Meshes of a gun file: draw calls of the gun itself. */
const DRAW_CALLS = 8;
const PARTS: Record<GunId, PartName[]> = {
	pistol: ['slide', 'mag', 'trigger'],
	smg: ['bolt', 'mag', 'trigger'],
	lmg: ['bolt', 'mag', 'cover', 'belt', 'trigger'],
	sniper: ['bolt', 'mag', 'trigger'],
	barrett: ['bolt', 'mag', 'trigger'],
	striker: ['bolt', 'mag', 'trigger']
};
const gen = (id: GunId) => GENERATED[id] as GeneratedModel;

async function held(id: GunId, load = shippedLoad): Promise<ZombieRenderer> {
	const z = new ZombieRenderer(new HeldAssets(), load);
	z.setWeapon(id);
	await z.preload([id]);
	z.updateViewmodel(1000, true, 1, 0, restVmFeel());
	z.vmScene.updateMatrixWorld(true);
	return z;
}
/** A point of the gun in its model space (the gun object's own placement undone). */
function modelPoint(id: GunId, o: THREE.Object3D, root: THREE.Object3D): THREE.Vector3 {
	const { len, at } = gen(id).fp;
	const p = root.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
	return p.multiplyScalar(len).add(new THREE.Vector3(...at));
}
const gunOf = (z: ZombieRenderer, id: GunId): THREE.Object3D => {
	let o: THREE.Object3D = z.rig(id)!.point('eject')!;
	while (o.name !== 'gun') o = o.parent!;
	return o;
};

describe('gun files: parts and points', () => {
	it('every gun has its parts and points, one material, and at most ' + DRAW_CALLS + ' draw calls', async () => {
		for (const id of GUNS) {
			expect(Object.keys(GUN_PARTS[id]).sort(), id).toEqual([...PARTS[id]].sort());
			const { json } = readGlb(readFileSync(new URL('../../../static' + modelUrl(id), import.meta.url)));
			const names = new Set(json.nodes.map((n) => n.name));
			for (const n of [...PARTS[id], ...POINT_NAMES]) expect(names.has(n), id + ' ' + n).toBe(true);
			expect(json.meshes.length, id).toBe(PARTS[id].length + 1);
			expect(json.meshes.length, id).toBeLessThanOrEqual(DRAW_CALLS);
			for (const m of json.meshes) expect(m.primitives.length, id).toBe(1);
			const z = await held(id);
			const rig = z.rig(id)!;
			expect([...rig.names].sort(), id).toEqual([...PARTS[id]].sort());
			for (const p of POINT_NAMES) expect(rig.point(p), id + ' ' + p).toBeDefined();
			// (The aim mark of the optic, attached to the cover, has its own.)
			expect(new Set(meshesOf(gunOf(z, id)).filter((m) => m.name !== 'dot').map((m) => m.material)).size, id).toBe(1);
			// The points where hands hold a part travel with it.
			expect(rig.point('grip_mag')!.parent, id).toBe(rig.part('mag'));
			expect(rig.point('grip_bolt')!.parent, id).toBe(rig.part('bolt') ?? rig.part('slide'));
			z.dispose();
		}
	});

	it('pivots and points are where the scripts put them (model units)', async () => {
		// The seat, the pin or the bolt axis of each part, the port: the numbers of the gun scripts.
		const AT: Record<GunId, Partial<Record<string, [number, number, number]>>> = {
			pistol: { slide: [0, 2.05, 1.95], trigger: [0, 0.2, -0.8], hand_r: [0, -2.3, 2.45], eject: [0.92, 2.75, -2.78] },
			smg: { bolt: [0, 1.1, -1.9], mag: [0, -1.9, -0.4], trigger: [0, -1.5, 1.2], magwell: [0, -1.9, -0.4] },
			lmg: { bolt: [0, 0.6, -1.4], cover: [0, 2.05, -8], mag: [-0.9, -1.9, -3.9], belt: [-2.15, 1.4, -2.9], trigger: [0, -2.3, 1.25] },
			sniper: { bolt: [0, 0.8, 2.55], mag: [0, -1.6, -3.45], trigger: [0, -1.6, 1], grip_bolt: [2.75, -0.13, 2.8] },
			barrett: { bolt: [0, 1.2, 0.3], mag: [0, -2.35, -0.9], trigger: [0, -1.8, 3.02], hand_l: [0, -1.6, -14.8] },
			striker: { bolt: [0, 1, -2.2], mag: [0, -5.6, -3.4], trigger: [0, -1.65, 1.45], grip_bolt: [-2.35, 1.05, -2.2] }
		};
		for (const id of GUNS) {
			const z = await held(id);
			const rig = z.rig(id)!;
			const root = gunOf(z, id);
			for (const [name, want] of Object.entries(AT[id])) {
				const o = rig.part(name as PartName) ?? rig.point(name as 'eject');
				expect(modelPoint(id, o!, root).distanceTo(new THREE.Vector3(...want!)), id + ' ' + name).toBeLessThan(0.01);
			}
			// A case leaves to the right: +X of the port points out of the gun.
			const out = new THREE.Vector3(1, 0, 0).transformDirection(rig.point('eject')!.matrixWorld).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()).invert());
			expect(out.x, id).toBeGreaterThan(0.75);
			// The magazine leaves downwards, along −Y of its seat.
			const down = new THREE.Vector3(0, -1, 0).transformDirection(rig.point('magwell')!.matrixWorld).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()).invert());
			expect(down.y, id).toBeLessThan(-0.9);
			const way = new THREE.Vector3(...partSteps(id, 'mag')[0]!.axis).normalize();
			expect(way.dot(down), id).toBeGreaterThan(0.999);
			z.dispose();
		}
	});

	it('at rest the parts are where the one-mesh gun has them: same bounding box', async () => {
		for (const id of GUNS) {
			const z = await held(id);
			const f = await held(id, flatLoad);
			const a = new THREE.Box3().setFromObject(gunOf(z, id), true);
			const flat = meshesOf((f.vmScene.getObjectByName(id) as THREE.Group).userData.generated as THREE.Object3D).find((m) => !m.name)!;
			const b = new THREE.Box3().setFromObject(flat, true);
			expect(a.min.distanceTo(b.min), id).toBeLessThan(1e-3);
			expect(a.max.distanceTo(b.max), id).toBeLessThan(1e-3);
			z.dispose();
			f.dispose();
		}
	});
});

describe('gun rig', () => {
	it('every part moves along its travel and comes back', async () => {
		for (const id of GUNS) {
			const z = await held(id);
			const rig = z.rig(id)!;
			const root = gunOf(z, id);
			for (const name of PARTS[id]) {
				const node = rig.part(name)!;
				const rest = modelPoint(id, node, root);
				const restQ = node.quaternion.clone();
				expect(rig.move(name, 1), id + ' ' + name).toBe(true);
				z.vmScene.updateMatrixWorld(true);
				const steps = partSteps(id, name);
				const slide = steps.filter((s) => s.kind === 'slide').reduce((n, s) => n + s.to, 0);
				const turn = steps.filter((s) => s.kind === 'turn').reduce((n, s) => n + Math.abs(s.to), 0);
				expect(modelPoint(id, node, root).distanceTo(rest), id + ' ' + name).toBeCloseTo(slide, 3);
				expect(node.quaternion.angleTo(restQ), id + ' ' + name).toBeCloseTo(turn, 3);
				rig.reset();
				z.vmScene.updateMatrixWorld(true);
				expect(modelPoint(id, node, root).distanceTo(rest), id + ' ' + name).toBeCloseTo(0, 9);
				expect(node.quaternion.angleTo(restQ), id + ' ' + name).toBeCloseTo(0, 9);
			}
			// A part this gun hasn't got.
			for (const p of PART_NAMES) if (!PARTS[id].includes(p)) expect(rig.move(p, 1), id + ' ' + p).toBe(false);
			z.dispose();
		}
	});

	it('the sniper bolt lifts first and slides second, or each on its own', async () => {
		expect(stepAmounts(2, 0.25)).toEqual([0.5, 0]);
		expect(stepAmounts(2, 0.75)).toEqual([1, 0.5]);
		const z = await held('sniper');
		const rig = z.rig('sniper')!;
		const bolt = rig.part('bolt')!;
		rig.move('bolt', 0.5);
		expect(2 * Math.acos(bolt.quaternion.w)).toBeCloseTo(1.05, 6);
		const z0 = bolt.position.z;
		rig.move('bolt', [1, 1]);
		expect((bolt.position.z - z0) * gen('sniper').fp.len).toBeCloseTo(4.2, 6);
		// The knob goes up and to the left of where it was.
		const knob = rig.point('grip_bolt')!;
		rig.reset();
		const low = modelPoint('sniper', knob, gunOf(z, 'sniper'));
		rig.move('bolt', [1, 0]);
		z.vmScene.updateMatrixWorld(true);
		const high = modelPoint('sniper', knob, gunOf(z, 'sniper'));
		expect(high.y).toBeGreaterThan(low.y + 1);
		z.dispose();
	});

	it('the feed cover opens upwards and takes the optic and its aim mark along', async () => {
		const z = await held('lmg');
		const rig = z.rig('lmg')!;
		const cover = new THREE.Box3().setFromObject(rig.part('cover')!, true);
		const dot = () => {
			z.vmScene.updateMatrixWorld(true);
			let at: THREE.Vector3 | null = null;
			(z.vmScene.getObjectByName('lmg') as THREE.Group).traverse((o) => {
				if (o instanceof THREE.Mesh && o.name === 'dot') at = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
			});
			return at! as THREE.Vector3;
		};
		const before = dot();
		rig.move('cover', 1);
		const open = new THREE.Box3().setFromObject(rig.part('cover')!, true);
		expect(open.max.y).toBeGreaterThan(cover.max.y + 1);
		expect(dot().y).toBeGreaterThan(before.y + 1);
		z.dispose();
	});

	it('a weapon change resets the parts', async () => {
		const z = await held('sniper');
		const rig = z.rig('sniper')!;
		const bolt = rig.part('bolt')!;
		const p = bolt.position.clone();
		rig.move('bolt', 1);
		rig.part('mag')!.visible = false;
		z.setWeapon('pistol');
		z.setWeapon('sniper');
		expect(bolt.position.equals(p)).toBe(true);
		expect(bolt.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 9);
		expect(rig.part('mag')!.visible).toBe(true);
		z.dispose();
	});

	it('a gun file without parts works, with an empty rig; the code-built guns have none', async () => {
		for (const id of GUNS) {
			const z = await held(id, flatLoad);
			expect(z.generatedShown(id), id).toBe(true);
			const rig = z.rig(id)!;
			expect(rig, id).toBeInstanceOf(GunRig);
			expect(rig.names, id).toEqual([]);
			expect(rig.point('eject'), id).toBeUndefined();
			expect(rig.move('mag', 1), id).toBe(false);
			rig.reset();
			z.dispose();
		}
		const c = new ZombieRenderer(new HeldAssets());
		c.setWeapon('smg');
		expect(c.rig('smg')).toBeUndefined();
		c.dispose();
	});
});
