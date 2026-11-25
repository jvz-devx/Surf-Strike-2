/**
 * Aimed viewmodel pose (render/sights.ts, ZombieRenderer.updateViewmodel):
 * fully aimed, the sight point of the held gun sits on the view axis; on the
 * way there nothing is cut by the near plane and the forearms stay off
 * screen; sway and bob shrink; at aim 0 the pose is the hip pose. The
 * generated models (render/weapon-assets.ts) are checked on the shipped files,
 * read with render/glb-reader.ts: rear and front sight on the view axis, the
 * view above the sights and the middle of the screen clear of the gun and the
 * hands.
 */
import { WEAPONS } from '@surf/shared';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeldAssets } from './character/held.js';
import { ease, restVmFeel, VM_AIM_STEADY, type VmFeel } from '../game/gunfeel.js';
import { AIM_DEPTH, aimDepthOf, sightOf, VIEWMODEL_SIGHTS } from './sights.js';
import { shippedLoad } from './shipped-models.js';
import type { ArmEnd } from './viewmodels.js';
import { generated } from './weapon-assets.js';
import { VM_KICK, ZombieRenderer } from './zombies.js';

const GUNS = ['pistol', 'smg', 'lmg', 'striker', 'sniper', 'barrett'] as const;
/** The guns with a model file (generated, or the shotgun built by script). */
const GENERATED_GUNS = GUNS.filter((w) => generated(w) !== null);
const ASPECTS = [4 / 3, 16 / 9, 21 / 9];
const T = 5000;

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

/** View-space triangles (xyz ×3 per triangle) of the drawn model (`keep`: only these meshes): the viewmodel camera sits at the origin, looking down −Z. */
function viewTriangles(z: ZombieRenderer, keep: (m: THREE.Mesh) => boolean = () => true): Float32Array {
	z.vmScene.updateMatrixWorld(true);
	const meshes = drawnMeshes(modelOf(z)).filter(keep);
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

/** Where the sight point of the drawn model is in view space (the viewmodel camera at the origin, looking down −Z). */
function sightInView(z: ZombieRenderer, w: (typeof GUNS)[number]): THREE.Vector3 {
	z.vmScene.updateMatrixWorld(true);
	const p = sightOf(w, modelOf(z), new THREE.Vector3())!;
	// The sight point is in the viewmodel node's space, like userData.muzzle.
	return p.applyMatrix4(vmOf(z).matrixWorld);
}

const sway = (sign: number): VmFeel => ({ ...restVmFeel(), x: sign * 1.25, y: sign * 1.2, roll: sign * 0.09, yaw: -sign * 0.06, pitch: sign * 0.05 });


afterEach(() => vi.restoreAllMocks());

describe('sight points', () => {
	it('every gun has one, on the bore line seen from above (same x as the muzzle) and above the bore; melee has none', () => {
		const z = new ZombieRenderer(new HeldAssets());
		for (const w of GUNS) {
			z.setWeapon(w);
			const g = modelOf(z);
			const s = sightOf(w, g, new THREE.Vector3())!;
			const m = g.userData.muzzle as THREE.Vector3;
			expect(VIEWMODEL_SIGHTS[w], w).toBeDefined();
			expect(s.x, w).toBeCloseTo(m.x, 6);
			expect(s.y, w).toBeGreaterThan(m.y);
			// Behind the muzzle: the eye looks along the barrel.
			expect(s.z, w).toBeGreaterThan(m.z);
			expect(AIM_DEPTH[w], w).toBeGreaterThan(z.vmCamera.near);
		}
		for (const w of ['knife', 'claws'] as const) {
			z.setWeapon(w);
			expect(sightOf(w, modelOf(z), new THREE.Vector3()), w).toBeNull();
		}
		z.dispose();
	});

	it("a model's own userData.sight wins over the table (Vector3 or [x, y, z])", () => {
		const g = new THREE.Group();
		const out = new THREE.Vector3();
		g.userData.sight = new THREE.Vector3(1, 2, 3);
		expect(sightOf('smg', g, out)?.toArray()).toEqual([1, 2, 3]);
		g.userData.sight = [4, 5, 6];
		expect(sightOf('smg', g, out)?.toArray()).toEqual([4, 5, 6]);
		g.userData.sight = 'nonsense';
		expect(sightOf('smg', g, out)?.toArray()).toEqual([...VIEWMODEL_SIGHTS.smg!]);
		expect(sightOf('smg', undefined, out)?.toArray()).toEqual([...VIEWMODEL_SIGHTS.smg!]);
	});
});

describe('aimed pose', () => {
	it('fully aimed, the sight point lands on the view axis, AIM_DEPTH ahead of the eye', () => {
		const z = new ZombieRenderer(new HeldAssets());
		for (const w of GUNS) {
			z.setWeapon(w);
			z.updateViewmodel(T, true, 1, 0, { ...restVmFeel(), aim: 1 });
			const s = sightInView(z, w);
			expect(s.x, w).toBeCloseTo(0, 9);
			expect(s.y, w).toBeCloseTo(0, 9);
			expect(s.z, w).toBeCloseTo(-AIM_DEPTH[w]!, 9);
			// At the hip it is off the axis, low and to the right.
			z.updateViewmodel(T, true, 1, 0, restVmFeel());
			const hip = sightInView(z, w);
			expect(hip.x, w).toBeGreaterThan(0.3);
			expect(hip.y, w).toBeLessThan(-0.3);
		}
		z.dispose();
	});

	it('a loaded model with its own sight point is aimed on that point', () => {
		const z = new ZombieRenderer(new HeldAssets());
		z.setWeapon('smg');
		const g = modelOf(z);
		g.userData.sight = new THREE.Vector3(-2.6, 4.9, -9);
		z.updateViewmodel(T, true, 1, 0, { ...restVmFeel(), aim: 1 });
		z.vmScene.updateMatrixWorld(true);
		const s = new THREE.Vector3(-2.6, 4.9, -9).applyMatrix4(vmOf(z).matrixWorld);
		expect(s.x).toBeCloseTo(0, 9);
		expect(s.y).toBeCloseTo(0, 9);
		delete g.userData.sight;
		z.dispose();
	});

	it('aim 0 is the hip pose, bit for bit; part-way the sight moves steadily towards the axis', () => {
		const a = new ZombieRenderer(new HeldAssets());
		const b = new ZombieRenderer(new HeldAssets());
		for (const w of GUNS) {
			a.setWeapon(w);
			b.setWeapon(w);
			a.updateViewmodel(T, true, 1, 250, sway(1));
			b.updateViewmodel(T, true, 1, 250, { ...sway(1), aim: 0 });
			expect(vmOf(b).position.toArray(), w).toEqual(vmOf(a).position.toArray());
			expect(vmOf(b).rotation.toArray(), w).toEqual(vmOf(a).rotation.toArray());
			let prev = Infinity;
			for (const aim of [0, 0.25, 0.5, 0.75, 1]) {
				b.updateViewmodel(T, true, 1, 0, { ...restVmFeel(), aim });
				const s = sightInView(b, w);
				const off = Math.hypot(s.x, s.y);
				expect(off, w + ' ' + aim).toBeLessThan(prev);
				prev = off;
			}
		}
		a.dispose();
		b.dispose();
	});

	it("the gun kick a client hands in (feel.gun) is the one shown, not the renderer's own", () => {
		const z = new ZombieRenderer(new HeldAssets());
		z.setWeapon('smg');
		vi.spyOn(Math, 'random').mockReturnValue(1);
		z.fired(T);
		z.updateViewmodel(T + 20, true, 1, 0, { ...restVmFeel(), gun: { pitch: 2, yaw: -1 } });
		expect(vmOf(z).rotation.x).toBeCloseTo((2 * Math.PI) / 180, 9);
		expect(vmOf(z).rotation.y).toBeCloseTo((-1 * Math.PI) / 180, 9);
		// Without it (zombies, hide and seek) the renderer's own kick turns the gun.
		z.updateViewmodel(T + 20, true, 1, 0, restVmFeel());
		expect(vmOf(z).rotation.x).toBeGreaterThan(0);
		expect(vmOf(z).rotation.x).not.toBeCloseTo((2 * Math.PI) / 180, 4);
		z.dispose();
	});

	it('fully aimed, a gun kick turns the sights about the eye: they point as far off the axis as the kick', () => {
		const z = new ZombieRenderer(new HeldAssets());
		for (const w of ['pistol', 'smg', 'lmg', 'striker'] as const) {
			z.setWeapon(w);
			for (const gun of [
				{ pitch: 3, yaw: 0 },
				{ pitch: 0, yaw: -2 },
				{ pitch: 2, yaw: 1.5 }
			]) {
				z.updateViewmodel(T, true, 1, 0, { ...restVmFeel(), aim: 1, gun });
				const s = sightInView(z, w);
				const up = (Math.atan2(s.y, Math.hypot(s.x, s.z)) * 180) / Math.PI;
				const left = (Math.atan2(-s.x, -s.z) * 180) / Math.PI;
				expect(up, w + ' ' + JSON.stringify(gun)).toBeCloseTo(gun.pitch, 1);
				expect(left, w + ' ' + JSON.stringify(gun)).toBeCloseTo(gun.yaw, 1);
				expect(Math.abs(up - gun.pitch) + Math.abs(left - gun.yaw)).toBeLessThan(0.05);
			}
		}
		z.dispose();
	});

	it('the push-back is smaller fully aimed', () => {
		const z = new ZombieRenderer(new HeldAssets());
		for (const w of ['pistol', 'smg', 'lmg', 'striker'] as const) {
			z.clear();
			z.setWeapon(w);
			const still = { ...restVmFeel(), aim: 1, gun: { pitch: 0, yaw: 0 } };
			z.updateViewmodel(T, true, 1, 0, still);
			const rest = vmOf(z).position.z;
			z.fired(T);
			z.updateViewmodel(T + VM_KICK[w]!.attack, true, 1, 0, still);
			expect(vmOf(z).position.z - rest, w).toBeCloseTo(VM_KICK[w]!.back * 0.4, 6);
		}
		z.dispose();
	});

	it('sway and the walk bob shrink while aimed', () => {
		const z = new ZombieRenderer(new HeldAssets());
		z.setWeapon('lmg');
		const at = (aim: number, feel: VmFeel, speed: number, t = T) => {
			z.updateViewmodel(t, true, 1, speed, { ...feel, aim });
			return vmOf(z).position.clone();
		};
		for (const aim of [0, 1]) {
			const still = at(aim, restVmFeel(), 0);
			const swayed = at(aim, sway(1), 0);
			const bobbed = at(aim, restVmFeel(), 250, T + 30);
			const k = aim === 0 ? 1 : 1 - VM_AIM_STEADY;
			expect(swayed.x - still.x, 'sway ' + aim).toBeCloseTo(1.25 * k, 9);
			expect(bobbed.y - at(aim, restVmFeel(), 0, T + 30).y, 'bob ' + aim).toBeCloseTo(Math.sin((T + 30) / 95) * 0.5 * 0.6 * k, 9);
		}
		z.dispose();
	});

	it('nothing clips the camera on the way in and out: no near-plane cut in view, forearms off screen', () => {
		const z = new ZombieRenderer(new HeldAssets());
		for (const w of GUNS)
			for (const aim of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1])
				for (const s of [-1, 0, 1])
					for (const kick of [false, true])
						for (const [lower, reload, land, dry] of [
							[0, 1, 0, 0],
							[0.5, 1, 0, 0],
							// A reload (or the automatic one on an empty magazine) starts while the aim eases out.
							[0, 0.06, 0, 0],
							[0, 0.12, 0, 0],
							[0, 0.18, 0, 0],
							[0, 1, 1, 0],
							[0, 1, 0, 1],
							[0, 1, 1, 1]
						] as const) {
							vi.restoreAllMocks();
							z.clear();
							z.setWeapon(w);
							vi.spyOn(Math, 'random').mockReturnValue(1);
							if (kick) z.fired(T);
							const gun = kick ? { pitch: 3.75, yaw: s * 1 } : undefined;
							z.updateViewmodel(T + (kick ? VM_KICK[w]!.attack : 0), true, reload, 250, { ...sway(s), aim, lower, land, dry, gun });
							const name = w + ' aim ' + aim + ' sway ' + s + ' kick ' + kick + ' lower ' + lower + ' reload ' + reload + ' land ' + land + ' dry ' + dry;
							const tris = viewTriangles(z);
							for (const a of ASPECTS) {
								expect(nearCuts(tris, z.vmCamera, a), name + ', aspect ' + a.toFixed(2)).toBe(0);
								for (const e of armEnds(z)) expect(offScreen(e.at, e.r, z.vmCamera, a), name + ', aspect ' + a.toFixed(2)).toBe(true);
							}
						}
		z.dispose();
	}, 60000);

	it('fully aimed the gun is in view (the scoped rifles are hidden by the client then, not by the pose)', () => {
		const z = new ZombieRenderer(new HeldAssets());
		for (const w of GUNS) {
			z.setWeapon(w);
			z.updateViewmodel(T, true, 1, 0, { ...restVmFeel(), aim: 1 });
			const tris = viewTriangles(z);
			for (const a of ASPECTS) expect(anyOnScreen(tris, z.vmCamera, a), w).toBe(true);
			expect(WEAPONS[w].magazine).toBeGreaterThan(0);
		}
		z.dispose();
	});
});

/** Mesh names of the hands: the box hands (render/viewmodels.ts palette) and the gloved ones (render/hands.ts). */
const HANDS = new Set(['glove', 'pad', 'sleeve', 'hand']);
/** A renderer holding `w` with its generated model loaded. */
async function heldGenerated(w: (typeof GUNS)[number]): Promise<ZombieRenderer> {
	const z = new ZombieRenderer(new HeldAssets(), shippedLoad);
	z.setWeapon(w);
	await z.preload([w]);
	expect(z.generatedShown(w), w).toBe(true);
	expect(z.hands(w), w).toBeDefined();
	return z;
}
const SCOPED = new Set<string>(['sniper', 'barrett']);
/** `covers` for a box around (0, cy) in NDC instead of the middle: the triangles moved down by cy. */
function coversAbove(tris: Float32Array, cam: THREE.PerspectiveCamera, aspect: number, cy: number, bx: number, by: number, n: number): boolean {
	const tan = Math.tan((cam.fov * Math.PI) / 360);
	const moved = tris.slice();
	for (let i = 1; i < moved.length; i += 3) moved[i]! -= cy * -moved[i + 1]! * tan;
	return covers(moved, cam, aspect, bx, by, n);
}

describe('aimed pose, generated models', () => {
	it('every generated gun has a sight line and its own aim depth', () => {
		for (const w of GENERATED_GUNS) {
			const g = generated(w)!;
			expect(g.sight, w).not.toBeNull();
			expect(g.front, w).not.toBeNull();
			// The front sight is ahead of the rear one, both behind the muzzle.
			expect(g.front![2], w).toBeLessThan(g.sight![2]);
			expect(g.front![2], w).toBeGreaterThanOrEqual(0);
			expect(g.fp.aim, w).toBeGreaterThan(1);
		}
	});

	it('fully aimed, the rear and the front sight both sit on the view axis, the aim depth ahead', async () => {
		for (const w of GENERATED_GUNS) {
			const z = await heldGenerated(w);
			z.updateViewmodel(T, true, 1, 0, { ...restVmFeel(), aim: 1 });
			z.vmScene.updateMatrixWorld(true);
			const g = modelOf(z);
			expect(aimDepthOf(w, g), w).toBe(generated(w)!.fp.aim);
			const rear = sightInView(z, w);
			const front = (g.userData.front as THREE.Vector3).clone().applyMatrix4(vmOf(z).matrixWorld);
			expect(rear.x, w).toBeCloseTo(0, 6);
			expect(rear.y, w).toBeCloseTo(0, 6);
			expect(rear.z, w).toBeCloseTo(-generated(w)!.fp.aim, 6);
			expect(front.x, w).toBeCloseTo(0, 6);
			expect(front.y, w).toBeCloseTo(0, 6);
			expect(front.z, w).toBeLessThan(rear.z);
			z.dispose();
		}
	});

	it('nothing clips the camera on the way in and out: no near-plane cut in view, forearms off screen', async () => {
		for (const w of GENERATED_GUNS) {
			const z = await heldGenerated(w);
			for (const t of [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1])
				for (const s of [-1, 0, 1])
					for (const kick of [false, true])
						for (const [lower, reload, land] of [
							[0, 1, 0],
							[0.5, 1, 0],
							[0, 0.12, 0],
							[0, 1, 1]
						] as const) {
							vi.restoreAllMocks();
							z.clear();
							z.setWeapon(w);
							vi.spyOn(Math, 'random').mockReturnValue(1);
							if (kick) z.fired(T);
							const gun = kick ? { pitch: 3.75, yaw: s * 1 } : undefined;
							z.updateViewmodel(T + (kick ? VM_KICK[w]!.attack : 0), true, reload, 250, { ...sway(s), aim: ease(t), lower, land, gun });
							const name = w + ' aim ' + t + ' sway ' + s + ' kick ' + kick + ' lower ' + lower + ' reload ' + reload + ' land ' + land;
							const tris = viewTriangles(z);
							for (const a of ASPECTS) {
								expect(nearCuts(tris, z.vmCamera, a), name + ', aspect ' + a.toFixed(2)).toBe(0);
								for (const e of armEnds(z)) expect(offScreen(e.at, e.r, z.vmCamera, a), name + ', aspect ' + a.toFixed(2)).toBe(true);
							}
						}
			z.dispose();
		}
	}, 120000);

	it('fully aimed through iron sights or the open optic, the view above the sights and the middle of the screen are clear', async () => {
		for (const w of GENERATED_GUNS) {
			// The client hides the scoped rifles once fully aimed: the scope picture takes over.
			if (SCOPED.has(w)) continue;
			const z = await heldGenerated(w);
			z.updateViewmodel(T, true, 1, 0, { ...restVmFeel(), aim: 1 });
			const gun = viewTriangles(z, (m) => !HANDS.has(m.name) && m.name !== 'dot');
			const hands = viewTriangles(z, (m) => HANDS.has(m.name));
			for (const a of ASPECTS) {
				// The hands stay below the sights: nothing of them from just under the middle up.
				expect(coversAbove(hands, z.vmCamera, a, 0.29, 0.25, 0.31, 9), w + ' hands, aspect ' + a.toFixed(2)).toBe(false);
				// Above the rear sight wings or the optic housing: nothing of the gun.
				expect(coversAbove(gun, z.vmCamera, a, 0.3, 0.3, 0.12, 9), w + ' above the sights, aspect ' + a.toFixed(2)).toBe(false);
				// Iron sights: the notch above the front post is open. The optic: the middle of its tube is open.
				// (Both are as wide as an angle: their half width in NDC shrinks on a wider screen.)
				if (generated(w)!.dot) expect(covers(gun, z.vmCamera, a, 0.04 / a, 0.03, 7), w + ' optic, aspect ' + a.toFixed(2)).toBe(false);
				else expect(coversAbove(gun, z.vmCamera, a, 0.06, 0.02 / a, 0.04, 5), w + ' notch, aspect ' + a.toFixed(2)).toBe(false);
			}
			z.dispose();
		}
	});
});
