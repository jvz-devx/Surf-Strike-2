/**
 * First-person models (render/viewmodels.ts) in node, no canvas: every weapon
 * id has one, the muzzle point sits at the barrel end, the claws expose their
 * arms and the knife grip, the cost stays inside the stated budget and
 * everything is disposed with the renderer. Placement is checked through the
 * ZombieRenderer at the pose extremes: nothing is cut by the near plane inside
 * the view, the forearms end off screen, the screen centre stays clear.
 */
import { readFileSync } from 'node:fs';
import { WEAPONS, type WeaponId } from '@surf/shared';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeldAssets } from './character/held.js';
import { restVmFeel, type VmFeel } from '../game/gunfeel.js';
import { buildViewmodels, VIEWMODEL_BUDGET, type ArmEnd, type ClawPose } from './viewmodels.js';
import { RELEASE_AT, SLASH_MS, THROW_MS, VM_KICK, ZombieRenderer } from './zombies.js';
import { shippedLoad } from './shipped-models.js';
import { generated } from './weapon-assets.js';

const IDS = Object.keys(WEAPONS) as WeaponId[];
const GUNS = ['pistol', 'smg', 'lmg', 'sniper', 'barrett', 'striker'] as const;
const ASPECTS = [4 / 3, 16 / 9, 21 / 9];
/** Knife swing length (ms), as in ZombieRenderer.updateViewmodel. */
const KNIFE_MS = 300;
/**
 * Start of the local tracer in the world view (game/infected.ts, game/zombies.ts):
 * 18 forward, 7 right, 6 down, seen with the default world camera (tan of half
 * its vertical fov is 0.75).
 */
const TRACER = { right: 7 / 18 / 0.75, down: 6 / 18 / 0.75 };

const V = new THREE.Vector3();
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();

const vmOf = (z: ZombieRenderer) => z.vmScene.children.find((c): c is THREE.Group => c instanceof THREE.Group)!;
/** The weapon group that is drawn (the muzzle flash is a mesh, not a group). */
const modelOf = (z: ZombieRenderer) => vmOf(z).children.find((c): c is THREE.Group => c.visible && c instanceof THREE.Group)!;

/** Meshes of `root` that are drawn: visible, with every parent up to `root` visible. */
function drawnMeshes(root: THREE.Object3D): THREE.Mesh[] {
	const out: THREE.Mesh[] = [];
	const walk = (o: THREE.Object3D) => {
		if (!o.visible) return;
		if (o instanceof THREE.Mesh) out.push(o);
		for (const c of o.children) walk(c);
	};
	walk(root);
	return out;
}

const triangles = (o: THREE.Object3D) => {
	let n = 0;
	o.traverse((m) => {
		if (m instanceof THREE.Mesh) n += (m.geometry as THREE.BufferGeometry).getAttribute('position').count / 3;
	});
	return n;
};

/** View-space triangles (xyz ×3 per triangle) of the drawn model: the viewmodel camera sits at the origin, looking down −Z. */
function viewTriangles(z: ZombieRenderer): Float32Array {
	z.vmScene.updateMatrixWorld(true);
	const meshes = drawnMeshes(modelOf(z));
	let n = 0;
	for (const m of meshes) n += (m.geometry as THREE.BufferGeometry).getAttribute('position').count;
	const out = new Float32Array(n * 3);
	let o = 0;
	for (const m of meshes) {
		const pos = (m.geometry as THREE.BufferGeometry).getAttribute('position');
		const skin = m instanceof THREE.SkinnedMesh;
		if (skin) m.skeleton.update();
		for (let i = 0; i < pos.count; i++) {
			// The gloved hands are skinned: where the bones put the vertex.
			(skin ? m.getVertexPosition(i, V) : V.fromBufferAttribute(pos, i)).applyMatrix4(m.matrixWorld);
			out[o++] = V.x;
			out[o++] = V.y;
			out[o++] = V.z;
		}
	}
	return out;
}

/** Whether the segment (x0,y0)-(x1,y1) touches the rectangle |x| ≤ w, |y| ≤ h (Liang-Barsky). */
function segmentInRect(x0: number, y0: number, x1: number, y1: number, w: number, h: number): boolean {
	let t0 = 0;
	let t1 = 1;
	const dx = x1 - x0;
	const dy = y1 - y0;
	for (const [p, q] of [
		[-dx, x0 + w],
		[dx, w - x0],
		[-dy, y0 + h],
		[dy, h - y0]
	] as const) {
		if (p === 0) {
			if (q < 0) return false;
			continue;
		}
		const r = q / p;
		if (p < 0) t0 = Math.max(t0, r);
		else t1 = Math.min(t1, r);
		if (t0 > t1) return false;
	}
	return true;
}

/** Triangles that the near plane cuts inside the visible window: the model would show a hole there. */
function nearCuts(tris: Float32Array, cam: THREE.PerspectiveCamera, aspect: number): number {
	const near = cam.near;
	const h = near * Math.tan((cam.fov * Math.PI) / 360);
	const w = h * aspect;
	let cuts = 0;
	for (let i = 0; i < tris.length; i += 9) {
		const za = tris[i + 2]! + near;
		const zb = tris[i + 5]! + near;
		const zc = tris[i + 8]! + near;
		if ((za < 0 && zb < 0 && zc < 0) || (za >= 0 && zb >= 0 && zc >= 0)) continue;
		// The two edges that cross the plane give the cut line.
		const pts: number[] = [];
		for (const [p, q] of [
			[0, 3],
			[3, 6],
			[6, 0]
		] as const) {
			const zp = tris[i + p + 2]! + near;
			const zq = tris[i + q + 2]! + near;
			if (zp < 0 === zq < 0) continue;
			const t = zp / (zp - zq);
			pts.push(tris[i + p]! + (tris[i + q]! - tris[i + p]!) * t, tris[i + p + 1]! + (tris[i + q + 1]! - tris[i + p + 1]!) * t);
		}
		if (pts.length === 4 && segmentInRect(pts[0]!, pts[1]!, pts[2]!, pts[3]!, w, h)) cuts++;
	}
	return cuts;
}

/** Whether a ball (view space) is wholly outside the view: behind the near plane, or past the bottom, left or right edge. */
function offScreen(c: THREE.Vector3, r: number, cam: THREE.PerspectiveCamera, aspect: number): boolean {
	const tan = Math.tan((cam.fov * Math.PI) / 360);
	const v = Math.atan(tan);
	const hz = Math.atan(tan * aspect);
	if (c.z - r > -cam.near) return true;
	if (c.y * Math.cos(v) - c.z * Math.sin(v) < -r) return true;
	return Math.abs(c.x) * -Math.cos(hz) - c.z * Math.sin(hz) < -r;
}

/** Forearm ends of the drawn model in view space, with their radius there. */
function armEnds(z: ZombieRenderer): { at: THREE.Vector3; r: number }[] {
	z.vmScene.updateMatrixWorld(true);
	const out: { at: THREE.Vector3; r: number }[] = [];
	const g = modelOf(z);
	for (const node of [g, g.userData.right as THREE.Object3D | undefined, g.userData.left as THREE.Object3D | undefined]) {
		if (!node) continue;
		for (const e of node.userData.arms as ArmEnd[]) out.push({ at: e.at.clone().applyMatrix4(node.matrixWorld), r: e.r * node.matrixWorld.getMaxScaleOnAxis() });
	}
	return out;
}

/** Whether a drawn vertex falls inside the middle of the screen: |x| ≤ bx, |y| ≤ by in NDC. */
function inCentre(tris: Float32Array, cam: THREE.PerspectiveCamera, aspect: number, bx: number, by: number): boolean {
	const tan = Math.tan((cam.fov * Math.PI) / 360);
	for (let i = 0; i < tris.length; i += 3) {
		const d = -tris[i + 2]!;
		if (d < cam.near) continue;
		if (Math.abs(tris[i]! / (d * tan * aspect)) <= bx && Math.abs(tris[i + 1]! / (d * tan)) <= by) return true;
	}
	return false;
}

/** Whether a drawn vertex is inside the view at all. */
const anyOnScreen = (tris: Float32Array, cam: THREE.PerspectiveCamera, aspect: number) => inCentre(tris, cam, aspect, 1, 1);

/**
 * Whether a triangle covers one of the n × n sample points spread over the
 * middle of the screen (|x| ≤ bx, |y| ≤ by in NDC). Long parts have vertices
 * only at their ends, so the vertex test alone could miss a barrel or a sleeve
 * that crosses the box.
 */
function covers(tris: Float32Array, cam: THREE.PerspectiveCamera, aspect: number, bx: number, by: number, n = 5): boolean {
	const tan = Math.tan((cam.fov * Math.PI) / 360);
	const p = [0, 0, 0, 0, 0, 0];
	for (let i = 0; i < tris.length; i += 9) {
		// A triangle that reaches behind the near plane is the business of the near-plane test.
		if (-tris[i + 2]! < cam.near || -tris[i + 5]! < cam.near || -tris[i + 8]! < cam.near) continue;
		for (let k = 0; k < 3; k++) {
			const d = -tris[i + k * 3 + 2]!;
			p[k * 2] = tris[i + k * 3]! / (d * tan * aspect);
			p[k * 2 + 1] = tris[i + k * 3 + 1]! / (d * tan);
		}
		for (let a = 0; a < n; a++)
			for (let b = 0; b < n; b++) {
				const x = n === 1 ? 0 : -bx + (2 * bx * a) / (n - 1);
				const y = n === 1 ? 0 : -by + (2 * by * b) / (n - 1);
				const s0 = (p[2]! - p[0]!) * (y - p[1]!) - (p[3]! - p[1]!) * (x - p[0]!);
				const s1 = (p[4]! - p[2]!) * (y - p[3]!) - (p[5]! - p[3]!) * (x - p[2]!);
				const s2 = (p[0]! - p[4]!) * (y - p[5]!) - (p[1]! - p[5]!) * (x - p[4]!);
				if ((s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0)) return true;
			}
	}
	return false;
}

interface Pose {
	name: string;
	apply(z: ZombieRenderer): void;
}

/** The largest sway the game feeds in (game/gunfeel.ts VmSway), to either side. */
function sway(sign: number): VmFeel {
	return { ...restVmFeel(), x: sign * 1.25, y: sign * 1.2, roll: sign * 0.09, yaw: -sign * 0.06, pitch: sign * 0.05 };
}

/** Rest, kick, reload, draw, landing, sway, slash and throw: the extremes of every motion of a weapon. */
function poses(w: WeaponId): Pose[] {
	const out: Pose[] = [];
	const add = (name: string, apply: (z: ZombieRenderer) => void) => out.push({ name, apply });
	const T = 5000;
	const melee = w === 'knife' || w === 'claws';
	add('rest', (z) => z.updateViewmodel(T, true, 1, 0, restVmFeel()));
	add('rest, no feel', (z) => z.updateViewmodel(T, true, 1, 250));
	for (const s of [-1, 1]) add('sway ' + s, (z) => z.updateViewmodel(T, true, 1, 250, sway(s)));
	add('landing', (z) => z.updateViewmodel(T, true, 1, 0, { ...restVmFeel(), land: 1 }));
	add('dry fire', (z) => z.updateViewmodel(T, true, 1, 0, { ...restVmFeel(), dry: 1 }));
	for (const lower of [0.2, 0.4, 0.6, 0.8]) add('lowered ' + lower, (z) => z.updateViewmodel(T, true, 1, 0, { ...restVmFeel(), lower }));
	if (!melee) {
		const k = VM_KICK[w]!;
		for (const twist of [0, 1])
			for (const at of [k.attack * 0.5, k.attack, k.attack + (k.ms - k.attack) * 0.25])
				for (const s of [-1, 0, 1])
					add('kick ' + at + ' twist ' + twist + ' sway ' + s, (z) => {
						vi.spyOn(Math, 'random').mockReturnValue(twist);
						z.fired(T);
						z.updateViewmodel(T + at, true, 1, 0, sway(s));
					});
		for (const p of [0.06, 0.12, 0.18, 0.24, 0.3, 0.4, 0.5, 0.58, 0.64, 0.7, 0.76, 0.82, 0.88, 0.94])
			for (const s of [-1, 0, 1]) add('reload ' + p + ' sway ' + s, (z) => z.updateViewmodel(T, true, p, 0, sway(s)));
	}
	if (w === 'knife') for (const t of [0, 0.1, 0.25, 0.4, 0.6, 0.8]) add('swing ' + t, (z) => (z.fired(T), z.updateViewmodel(T + t * KNIFE_MS, true, 1, 0, restVmFeel())));
	if (w === 'claws') {
		for (const knife of [false, true]) {
			add('rest knife ' + knife, (z) => (z.setOffhandKnife(knife, T - 1000), z.updateViewmodel(T, true, 1, 0, restVmFeel())));
			add('knife pops in ' + knife, (z) => (z.setOffhandKnife(knife, T - 40), z.updateViewmodel(T, true, 1, 0, restVmFeel())));
			for (let u = 0.05; u < 1; u += 0.05)
				for (const s of [-1, 0, 1])
					add('slash ' + u.toFixed(2) + ' knife ' + knife + ' sway ' + s, (z) => {
						z.setOffhandKnife(knife, T - 1000);
						z.fired(T);
						z.updateViewmodel(T + u * SLASH_MS, true, 1, 0, sway(s));
					});
		}
		for (let tp = 0.03; tp < 1; tp += 0.03)
			for (const s of [-1, 0, 1])
				add('throw ' + tp.toFixed(2) + ' sway ' + s, (z) => {
					z.setOffhandKnife(true, T - 1000);
					z.thrown(T);
					z.setOffhandKnife(false, T);
					z.updateViewmodel(T + tp * THROW_MS, true, 1, 0, sway(s));
				});
		// A slash in the middle of a throw.
		for (let tp = 0.1; tp < 1; tp += 0.1)
			add('slash in throw ' + tp.toFixed(1), (z) => {
				z.setOffhandKnife(true, T - 1000);
				z.thrown(T);
				z.setOffhandKnife(false, T);
				z.fired(T + tp * THROW_MS - 0.3 * SLASH_MS);
				z.updateViewmodel(T + tp * THROW_MS, true, 1, 0, restVmFeel());
			});
	} else for (const tp of [0.25, 0.5, 0.75]) add('throw dip ' + tp, (z) => (z.thrown(T), z.updateViewmodel(T + tp * THROW_MS, true, 1, 0, restVmFeel())));
	return out;
}

/** Put `z` in `pose` holding `w`, from a clean state: no kick, throw or knife carried over from the pose before. */
function posed(z: ZombieRenderer, w: WeaponId, pose: Pose): ZombieRenderer {
	vi.restoreAllMocks();
	z.clear();
	z.setWeapon(w);
	pose.apply(z);
	return z;
}

afterEach(() => vi.restoreAllMocks());

/**
 * The placement checks run on the code-built models and on the generated ones
 * (render/weapon-assets.ts): node has no browser loader, so the shipped
 * first-person files are read with render/glb-reader.ts.
 */
const VARIANTS = ['code-built', 'generated'] as const;
/** A renderer with the code-built models, or with every generated model loaded. */
async function renderer(variant: (typeof VARIANTS)[number]): Promise<ZombieRenderer> {
	if (variant === 'code-built') return new ZombieRenderer(new HeldAssets());
	const z = new ZombieRenderer(new HeldAssets(), shippedLoad);
	await z.preload(IDS);
	for (const id of IDS) expect(z.generatedShown(id), id).toBe(generated(id) !== null);
	for (const id of IDS) expect(!!z.hands(id), id).toBe(generated(id) !== null);
	return z;
}

describe('first-person models', () => {
	it('every weapon id has one hidden, named group; guns have a muzzle point, melee has none', () => {
		const set = buildViewmodels();
		expect([...set.models.keys()].sort()).toEqual([...IDS].sort());
		for (const id of IDS) {
			const g = set.models.get(id)!;
			expect(g.name).toBe(id);
			expect(g.visible).toBe(false);
			expect(triangles(g), id).toBeGreaterThan(300);
			const melee = id === 'knife' || id === 'claws';
			if (melee) expect(g.userData.muzzle).toBeNull();
			else expect(g.userData.muzzle).toBeInstanceOf(THREE.Vector3);
		}
	});

	it('the muzzle point is the front end of the model, on the barrel axis', () => {
		const set = buildViewmodels();
		const box = new THREE.Box3();
		for (const id of GUNS) {
			const g = set.models.get(id)!;
			const muzzle = g.userData.muzzle as THREE.Vector3;
			box.setFromObject(g);
			// Front of the bounding box: −Z is forward.
			expect(muzzle.z, id).toBeGreaterThanOrEqual(box.min.z - 1e-4);
			expect(muzzle.z - box.min.z, id).toBeLessThan(0.1);
			// The foremost ring of the model is the mouth of the barrel: the muzzle point is its middle.
			const mouth = new THREE.Box3();
			let n = 0;
			g.traverse((m) => {
				if (!(m instanceof THREE.Mesh)) return;
				const pos = (m.geometry as THREE.BufferGeometry).getAttribute('position');
				for (let i = 0; i < pos.count; i++) {
					if (pos.getZ(i) > box.min.z + 0.02) continue;
					n++;
					mouth.expandByPoint(V.fromBufferAttribute(pos, i));
				}
			});
			expect(n, id).toBeGreaterThan(6);
			mouth.getCenter(A);
			expect(A.x, id).toBeCloseTo(muzzle.x, 2);
			expect(A.y, id).toBeCloseTo(muzzle.y, 2);
			// A bore, not a wide front plate.
			expect(mouth.getSize(B).length(), id).toBeLessThan(1.8);
			// The barrel runs straight back from it: the model has matter on the axis behind the muzzle.
			expect(box.containsPoint(V.set(muzzle.x, muzzle.y, muzzle.z + 3)), id).toBe(true);
		}
	});

	it('the muzzle sits on the screen line of the local tracer, right of and below the centre', () => {
		// The tracer start is fixed in game code; a muzzle off that line would shoot from beside the gun.
		const z = new ZombieRenderer(new HeldAssets());
		const tan = Math.tan((z.vmCamera.fov * Math.PI) / 360);
		for (const id of GUNS) {
			z.setWeapon(id);
			z.updateViewmodel(1000, true, 1, 0, restVmFeel());
			z.vmScene.updateMatrixWorld(true);
			V.copy(modelOf(z).userData.muzzle as THREE.Vector3).applyMatrix4(vmOf(z).matrixWorld);
			// Both in units of the half screen height (the aspect drops out).
			const mx = V.x / (-V.z * tan);
			const my = -V.y / (-V.z * tan);
			expect(mx, id).toBeGreaterThan(0.2);
			expect(my, id).toBeGreaterThan(0.2);
			const off = Math.abs(mx * TRACER.down - my * TRACER.right) / Math.hypot(TRACER.right, TRACER.down);
			expect(off, id).toBeLessThan(0.03);
			// And between the tracer start and the centre: the gun hides the first stretch of the tracer.
			expect(Math.hypot(mx, my), id).toBeLessThan(Math.hypot(TRACER.right, TRACER.down));
		}
		z.dispose();
	});

	it('claws: a right and a left arm with rest poses, an open hand and a fist, the knife in the left grip', () => {
		const set = buildViewmodels();
		const g = set.models.get('claws')!;
		const right = g.userData.right as THREE.Group;
		const left = g.userData.left as THREE.Group;
		expect(right.parent).toBe(g);
		expect(left.parent).toBe(g);
		for (const arm of [right, left]) {
			const rest = arm.userData.rest as ClawPose;
			expect([arm.position.x, arm.position.y, arm.position.z]).toEqual([rest.x, rest.y, rest.z]);
			expect([arm.rotation.x, arm.rotation.y, arm.rotation.z]).toEqual([rest.rx, rest.ry, rest.rz]);
			expect(arm.userData.arms).toHaveLength(1);
		}
		// Mirrored about the screen centre (x = −5 / 0.42 in viewmodel units).
		const rr = right.userData.rest as ClawPose;
		const lr = left.userData.rest as ClawPose;
		expect((rr.x + lr.x) / 2).toBeCloseTo(-5 / 0.42, 1);
		expect([lr.y, lr.z, lr.rx, lr.ry, lr.rz]).toEqual([rr.y, rr.z, rr.rx, -rr.ry, -rr.rz]);
		// Separate fingers with talons: the hand has many more parts than the old flat box.
		const mats = (o: THREE.Object3D) => {
			const names = new Set<string>();
			o.traverse((m) => m instanceof THREE.Mesh && names.add((m.material as THREE.Material).name));
			return [...names].sort();
		};
		expect(mats(right)).toEqual(['skin', 'talon', 'tornSleeve', 'vein']);
		expect(mats(left.userData.open as THREE.Object3D)).toEqual(['skin', 'talon']);
		expect(mats(left.userData.fist as THREE.Object3D)).toEqual(['skin', 'talon']);
		expect(triangles(right)).toBeGreaterThan(600);
		expect(left.userData.hold).toBeDefined();
		// The knife is a child of the left arm and its handle lies inside the fist.
		expect(set.offKnife.parent).toBe(left);
		expect(set.offKnife.visible).toBe(false);
		g.updateMatrixWorld(true);
		const fist = new THREE.Box3().setFromObject(left.userData.fist as THREE.Object3D);
		expect(fist.containsPoint(set.offKnife.getWorldPosition(V))).toBe(true);
		const blade = new THREE.Box3().setFromObject(set.offKnife);
		expect(blade.getSize(V).length()).toBeGreaterThan(fist.getSize(A).length());
	});

	it('budget: at most ' + VIEWMODEL_BUDGET.triangles + ' triangles and ' + VIEWMODEL_BUDGET.drawCalls + ' draw calls per model, materials shared by all', () => {
		const set = buildViewmodels();
		const used = new Set<THREE.Material>();
		const geoms = new Set<THREE.BufferGeometry>();
		for (const [id, g] of set.models) {
			expect(triangles(g), id).toBeLessThanOrEqual(VIEWMODEL_BUDGET.triangles);
			g.traverse((m) => {
				if (!(m instanceof THREE.Mesh)) return;
				used.add(m.material as THREE.Material);
				geoms.add(m.geometry as THREE.BufferGeometry);
			});
		}
		// One palette for the whole set, one geometry per mesh, all of them listed for disposal.
		expect(set.materials.length).toBeLessThanOrEqual(20);
		for (const m of used) expect(set.materials).toContain(m);
		expect(new Set(set.geometries).size).toBe(set.geometries.length);
		expect([...geoms].sort((a, b) => a.id - b.id)).toEqual([...set.geometries].sort((a, b) => a.id - b.id));
		// Draw calls: the meshes drawn at once, through the renderer (one mesh per material and moving part).
		const z = new ZombieRenderer(new HeldAssets());
		for (const id of IDS) {
			z.setWeapon(id);
			for (const knife of [false, true]) {
				z.setOffhandKnife(knife, 0);
				z.updateViewmodel(1000, true, 1, 0);
				const meshes = drawnMeshes(modelOf(z));
				expect(meshes.length, id).toBeLessThanOrEqual(VIEWMODEL_BUDGET.drawCalls);
				expect(new Set(meshes.map((m) => m.material)).size, id).toBeGreaterThanOrEqual(id === 'claws' ? 4 : 5);
			}
		}
		z.dispose();
	});

	it('everything is disposed with the renderer', () => {
		const z = new ZombieRenderer(new HeldAssets());
		const live = new Set<THREE.BufferGeometry | THREE.Material>();
		z.vmScene.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			for (const r of [o.geometry as THREE.BufferGeometry, o.material as THREE.Material]) {
				if (live.has(r)) continue;
				live.add(r);
				r.addEventListener('dispose', () => live.delete(r));
			}
		});
		expect(live.size).toBeGreaterThan(60);
		z.dispose();
		expect(live.size).toBe(0);
	});

	it('generic designs: no brand or franchise names in the model code', () => {
		const banned = /pp-?90|street.?sweeper|glock|beretta|\bcolt\b|remington|kalashnikov|\bak-?\d|\bm4a\d|\bawp\b|deagle|desert eagle|\buzi\b|\bmp\d\b|\bm249\b|\bm82|\baa-?12\b|call of duty|counter-?strike|left 4 dead/i;
		for (const f of ['viewmodels.ts', 'viewmodel-mesh.ts', 'viewmodel-viewer.ts', 'zombies.ts']) {
			const src = readFileSync(new URL(f, import.meta.url), 'utf8');
			expect(src.match(banned)?.[0], f).toBeUndefined();
			// The two weapon ids named after guns appear only as ids: quoted, or as a key of the kick table.
			for (const m of src.matchAll(/barrett|striker/gi)) expect(src.slice(m.index - 1, m.index + m[0].length + 1), f).toMatch(/^'(barrett|striker)'$|^	(barrett|striker):$/);
		}
	});
});

describe.each(VARIANTS)('first-person placement, %s models', (variant) => {
	it('nothing is cut by the near plane inside the view, at any pose extreme', async () => {
		const z = await renderer(variant);
		for (const w of IDS)
			for (const p of poses(w)) {
				const tris = viewTriangles(posed(z, w, p));
				for (const a of ASPECTS) expect(nearCuts(tris, z.vmCamera, a), w + ', ' + p.name + ', aspect ' + a.toFixed(2)).toBe(0);
			}
		z.dispose();
	}, 30000);

	it('the forearms end off screen at every pose: no hand or gun floats', async () => {
		const z = await renderer(variant);
		for (const w of IDS) {
			let ends = 0;
			for (const p of poses(w)) {
				for (const e of armEnds(posed(z, w, p))) {
					ends++;
					for (const a of ASPECTS) expect(offScreen(e.at, e.r, z.vmCamera, a), w + ', ' + p.name + ', aspect ' + a.toFixed(2)).toBe(true);
				}
			}
			// One hand on the pistol and the knife, two on everything else; the pistol's second one comes up for the reload only.
			const each = ends / poses(w).length;
			if (w === 'pistol' && variant === 'generated') {
				expect(each).toBeGreaterThan(1);
				expect(each).toBeLessThan(1.5);
			} else expect(each, w).toBe(w === 'pistol' || w === 'knife' ? 1 : 2);
		}
		z.dispose();
	});

	it('at rest the model is in view, low and to the side, and the screen centre is clear', async () => {
		for (const w of IDS)
			for (const knife of [false, true]) {
				const z = await renderer(variant);
				z.setWeapon(w);
				z.setOffhandKnife(knife, 0);
				z.updateViewmodel(1000, true, 1, 0, restVmFeel());
				const tris = viewTriangles(z);
				for (const a of ASPECTS) {
					expect(anyOnScreen(tris, z.vmCamera, a), w).toBe(true);
					expect(inCentre(tris, z.vmCamera, a, 0.1, 0.12), w + ', aspect ' + a.toFixed(2)).toBe(false);
					expect(covers(tris, z.vmCamera, a, 0.1, 0.12), w + ', aspect ' + a.toFixed(2)).toBe(false);
					// Nothing reaches the horizon either: the upper half of the screen stays free.
					expect(inCentre(tris, z.vmCamera, a, 1, 0.02), w + ', aspect ' + a.toFixed(2)).toBe(false);
					expect(covers(tris, z.vmCamera, a, 1, 0.02, 41), w + ', aspect ' + a.toFixed(2)).toBe(false);
				}
				z.dispose();
			}
	}, 30000);

	it('a gun stays out of the screen centre while it kicks', async () => {
		for (const w of GUNS) {
			const k = VM_KICK[w]!;
			for (const at of [k.attack * 0.5, k.attack, k.attack * 2]) {
				const z = await renderer(variant);
				z.setWeapon(w);
				vi.spyOn(Math, 'random').mockReturnValue(1);
				z.fired(1000);
				z.updateViewmodel(1000 + at, true, 1, 0, restVmFeel());
				const tris = viewTriangles(z);
				for (const a of ASPECTS) {
					expect(inCentre(tris, z.vmCamera, a, 0.06, 0.06), w + ' at ' + at + ', aspect ' + a.toFixed(2)).toBe(false);
					expect(covers(tris, z.vmCamera, a, 0.06, 0.06), w + ' at ' + at + ', aspect ' + a.toFixed(2)).toBe(false);
				}
				z.dispose();
				vi.restoreAllMocks();
			}
		}
	});

	it('fully lowered (draw start, scope): the whole model is out of view, so a switch does not pop', async () => {
		for (const w of IDS) {
			const z = await renderer(variant);
			z.setWeapon(w);
			z.setOffhandKnife(true, 0);
			z.updateViewmodel(1000, true, 1, 0, { ...restVmFeel(), lower: 1 });
			const tris = viewTriangles(z);
			for (const a of ASPECTS) {
				expect(anyOnScreen(tris, z.vmCamera, a), w + ', aspect ' + a.toFixed(2)).toBe(false);
				expect(covers(tris, z.vmCamera, a, 1, 1, 21), w + ', aspect ' + a.toFixed(2)).toBe(false);
			}
			z.dispose();
		}
	});

	it('the muzzle flash is drawn on the muzzle point of the held gun', async () => {
		const z = await renderer(variant);
		const flash = vmOf(z).children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh)!;
		for (const w of GUNS) {
			z.setWeapon(w);
			z.fired(1000);
			z.updateViewmodel(1010, true, 1, 0);
			expect(flash.visible, w).toBe(true);
			expect(flash.position.equals(modelOf(z).userData.muzzle as THREE.Vector3), w).toBe(true);
			z.updateViewmodel(1100, true, 1, 0);
			expect(flash.visible, w).toBe(false);
		}
		for (const w of ['knife', 'claws'] as const) {
			z.setWeapon(w);
			z.fired(2000);
			z.updateViewmodel(2010, true, 1, 0);
			expect(flash.visible, w).toBe(false);
		}
		z.dispose();
	});
});

describe('claw and knife motion', () => {
	it('slash: the right claw whips across the middle of the view and is back at rest after SLASH_MS', () => {
		const z = new ZombieRenderer(new HeldAssets());
		z.setWeapon('claws');
		z.updateViewmodel(0, true, 1, 0);
		const g = modelOf(z);
		const right = g.userData.right as THREE.Group;
		const left = g.userData.left as THREE.Group;
		const rest = right.userData.rest as ClawPose;
		const centre = -5 / 0.42;
		expect(right.position.x).toBeCloseTo(rest.x, 9);
		const leftAt = left.position.clone();
		z.fired(1000);
		let minX = Infinity;
		let prev = rest.x;
		for (let t = 0; t <= SLASH_MS; t += 8) {
			z.updateViewmodel(1000 + t, true, 1, 0);
			minX = Math.min(minX, right.position.x);
			// Out fast (most of the way in the first fifth), back slowly; no jump between frames.
			expect(Math.abs(right.position.x - prev)).toBeLessThan(4.5);
			prev = right.position.x;
			// The left arm stays where it is, apart from the idle motion.
			expect(left.position.distanceTo(leftAt)).toBeLessThan(1);
		}
		expect(minX).toBeLessThan(centre + 2);
		z.updateViewmodel(1000 + SLASH_MS * 0.2, true, 1, 0);
		expect(right.position.x).toBeLessThan(rest.x - 0.6 * (rest.x - minX));
		z.updateViewmodel(1000 + SLASH_MS, true, 1, 0);
		expect(right.position.x).toBeCloseTo(rest.x, 9);
		expect([right.rotation.x, right.rotation.y, right.rotation.z]).toEqual([rest.rx, rest.ry, rest.rz]);
		z.dispose();
	});

	it('throwing knife: in the fist while held, gone at the release point, the hand opens into a claw', () => {
		const z = new ZombieRenderer(new HeldAssets());
		z.setWeapon('claws');
		z.updateViewmodel(0, true, 1, 0);
		const left = modelOf(z).userData.left as THREE.Group;
		const open = left.userData.open as THREE.Object3D;
		const fist = left.userData.fist as THREE.Object3D;
		const rest = left.userData.rest as ClawPose;
		const hold = left.userData.hold as ClawPose;
		// No knife: an open claw in its rest pose.
		expect([z.offhandDrawn, open.visible, fist.visible]).toEqual([false, true, false]);
		expect(left.rotation.z).toBeCloseTo(rest.rz, 9);
		// Picked up: the fist closes on it at once, the arm eases into the hold pose.
		z.setOffhandKnife(true, 1000);
		z.updateViewmodel(1000, true, 1, 0);
		expect([z.offhandDrawn, open.visible, fist.visible]).toEqual([true, false, true]);
		z.updateViewmodel(2000, true, 1, 0);
		expect(left.rotation.z).toBeCloseTo(hold.rz, 9);
		expect(left.position.x).toBeCloseTo(hold.x, 9);
		// Thrown: held through the wind-up, released at RELEASE_AT, then the open claw comes back to rest.
		z.thrown(3000);
		z.setOffhandKnife(false, 3000);
		z.updateViewmodel(3000 + THROW_MS * (RELEASE_AT - 0.05), true, 1, 0);
		expect([z.offhandDrawn, open.visible, fist.visible]).toEqual([true, false, true]);
		const wound = left.position.z;
		z.updateViewmodel(3000 + THROW_MS * (RELEASE_AT + 0.02), true, 1, 0);
		expect([z.offhandDrawn, open.visible, fist.visible]).toEqual([false, true, false]);
		// The hand is further forward at the release than at any point of the wind-up.
		expect(left.position.z).toBeLessThan(wound);
		expect(left.position.z).toBeLessThan(hold.z - 5);
		z.updateViewmodel(3000 + THROW_MS, true, 1, 0);
		expect(left.position.x).toBeCloseTo(rest.x, 9);
		expect(left.position.z).toBeCloseTo(rest.z, 9);
		expect(left.rotation.z).toBeCloseTo(rest.rz, 9);
		z.dispose();
	});

	it('knife: a swing moves the blade across and comes back to rest', () => {
		const z = new ZombieRenderer(new HeldAssets());
		z.setWeapon('knife');
		const vm = vmOf(z);
		z.updateViewmodel(0, true, 1, 0);
		const rest = vm.position.clone();
		z.fired(1000);
		z.updateViewmodel(1010, true, 1, 0);
		expect(vm.position.x).toBeLessThan(rest.x - 1);
		expect(Math.abs(vm.rotation.y)).toBeGreaterThan(0.3);
		z.updateViewmodel(1000 + KNIFE_MS, true, 1, 0);
		expect(vm.position.distanceTo(rest)).toBeCloseTo(0, 9);
		expect(Math.abs(vm.rotation.x) + Math.abs(vm.rotation.y) + Math.abs(vm.rotation.z)).toBeCloseTo(0, 9);
		z.dispose();
	});
});
