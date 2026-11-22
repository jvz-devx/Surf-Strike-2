/**
 * Zombies visuals (docs/modes.md#zombies): low-poly zombies (the remote-player
 * humanoid, hunched, greenish grey, glowing eyes), hit flash, death collapse
 * and fade (no blood), tracers, and first-person viewmodels with a muzzle
 * flash drawn in their own scene over the world. Positions are Source feet
 * origins; Source → Three is (x, y, z) → (x, z, −y).
 */
import type { GateState, WeaponId, ZombieGate } from '@surf/shared';
import { ZF_ATTACKING, ZF_HIT } from '@surf/shared';
import * as THREE from 'three';
import { buildHumanoid } from './players.js';

const DEG = Math.PI / 180;
/** Upper body lean (matches the shared head hitbox: 7.5 forward, 65 up). */
const LEAN = 14 * DEG;
const HIP = 34;
const CORPSE_FALL_MS = 380;
const CORPSE_FADE_MS = 1300;
const TRACER_MS = 90;
const MUZZLE_MS = 45;
const MAX_TRACERS = 24;

const SKIN = new THREE.Color(0x7d9a6e);
const SHIRT = new THREE.Color(0x4e5a52);
const PANTS = new THREE.Color(0x3a3a40);
const FLASH = new THREE.Color(0xffffff);
const NO_GLOW = new THREE.Color(0x000000);
const ATTACK_GLOW = new THREE.Color(0x3a0a00);

export interface ZombiePose {
	id: number;
	x: number;
	y: number;
	z: number;
	yaw: number;
	flags: number;
}

interface ZombieMesh {
	root: THREE.Group;
	body: THREE.Group;
	upper: THREE.Group;
	mats: THREE.MeshLambertMaterial[];
	/** Local hit flash until (ms). */
	flashUntil: number;
	phase: number;
}

interface Corpse {
	m: ZombieMesh;
	at: number;
	dir: number;
}

interface Tracer {
	line: THREE.Line;
	at: number;
}

export class ZombieRenderer {
	readonly group = new THREE.Group();
	/** Viewmodel scene and camera, rendered after the world with a cleared depth buffer. */
	readonly vmScene = new THREE.Scene();
	readonly vmCamera = new THREE.PerspectiveCamera(62, 16 / 9, 0.5, 200);
	private box = new THREE.BoxGeometry(1, 1, 1);
	private eyeMat = new THREE.MeshBasicMaterial({ color: 0xd8ff6a, fog: false });
	private live = new Map<number, ZombieMesh>();
	private free: ZombieMesh[] = [];
	private corpses: Corpse[] = [];
	private tracers: Tracer[] = [];
	private tracerMat = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
	private seen = new Set<number>();
	// Viewmodel
	private vm = new THREE.Group();
	private guns = new Map<WeaponId, THREE.Group>();
	private muzzle: THREE.Mesh;
	private weapon: WeaponId | null = null;
	private kickAt = -Infinity;
	private muzzleAt = -Infinity;
	vmVisible = false;
	private vmMats: THREE.Material[] = [];
	// Gates: glowing barrier boxes and unlock-area floor markers.
	private gates: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; area: THREE.Mesh; areaMat: THREE.MeshBasicMaterial; state: GateState; at: number }> = [];

	constructor() {
		this.group.name = 'zombies';
		this.vmScene.add(new THREE.HemisphereLight(0xd8d4e8, 0x3a3030, 1.6));
		const sun = new THREE.DirectionalLight(0xffc8a0, 1.4);
		sun.position.set(0.5, 1, 0.6);
		this.vmScene.add(sun, this.vm);
		this.buildGuns();
		const mm = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
		this.vmMats.push(mm);
		this.muzzle = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 3.5), mm);
		this.muzzle.visible = false;
		this.vm.add(this.muzzle);
	}

	// ---------------------------------------------------------------------
	// Zombies

	private create(): ZombieMesh {
		const skin = new THREE.MeshLambertMaterial({ color: SKIN.clone() });
		const shirt = new THREE.MeshLambertMaterial({ color: SHIRT.clone() });
		const pants = new THREE.MeshLambertMaterial({ color: PANTS.clone() });
		const body = buildHumanoid(this.box, shirt, pants, skin);
		// Children: legs ×2, torso, arms ×2, head, visor. Hunch the upper body over the hips.
		const upper = new THREE.Group();
		upper.position.set(0, HIP, 0);
		upper.rotation.z = -LEAN;
		for (const m of body.children.slice(2)) {
			m.position.y -= HIP;
			upper.add(m);
		}
		const [, arm1, arm2, , visor] = upper.children; // torso, arms, head, visor
		// Arms reach forward.
		for (const a of [arm1, arm2]) {
			if (!a) continue;
			a.rotation.z = -80 * DEG;
			a.position.x += 11;
			a.position.y += 8;
		}
		// Glowing eyes instead of the visor.
		if (visor) visor.visible = false;
		for (const s of [-2.6, 2.6]) {
			const e = new THREE.Mesh(this.box, this.eyeMat);
			e.scale.set(1.2, 1.6, 2);
			e.position.set(5.8, 68 - HIP, s);
			upper.add(e);
		}
		body.add(upper);
		const root = new THREE.Group();
		root.add(body);
		this.group.add(root);
		return { root, body, upper, mats: [skin, shirt, pants], flashUntil: 0, phase: Math.random() * 10 };
	}

	private take(): ZombieMesh {
		const m = this.free.pop() ?? this.create();
		m.root.visible = true;
		m.body.rotation.set(0, 0, 0);
		m.body.position.set(0, 0, 0);
		for (const mat of m.mats) {
			mat.opacity = 1;
			mat.transparent = false;
			mat.emissive.copy(NO_GLOW);
		}
		return m;
	}

	private release(m: ZombieMesh): void {
		m.root.visible = false;
		this.free.push(m);
	}

	/** Draw the zombies of this frame (ids not listed are removed). */
	sync(list: readonly ZombiePose[], now: number): void {
		this.seen.clear();
		for (const z of list) {
			this.seen.add(z.id);
			let m = this.live.get(z.id);
			if (!m) {
				m = this.take();
				this.live.set(z.id, m);
			}
			m.root.position.set(z.x, z.z, -z.y);
			m.body.rotation.y = z.yaw * DEG;
			// Shamble: sway and arm bob.
			const t = now / 1000 + m.phase;
			m.upper.rotation.x = Math.sin(t * 6) * 0.06;
			m.upper.rotation.z = -LEAN - ((z.flags & ZF_ATTACKING) !== 0 ? 0.25 : 0);
			const hit = (z.flags & ZF_HIT) !== 0 || now < m.flashUntil;
			const glow = hit ? FLASH : (z.flags & ZF_ATTACKING) !== 0 ? ATTACK_GLOW : NO_GLOW;
			for (const mat of m.mats) mat.emissive.copy(glow).multiplyScalar(hit ? 0.55 : 1);
		}
		for (const [id, m] of this.live) {
			if (this.seen.has(id)) continue;
			this.live.delete(id);
			this.release(m);
		}
	}

	/** Local hit feedback before the next snapshot shows the flag. */
	flash(id: number, now: number): void {
		const m = this.live.get(id);
		if (m) m.flashUntil = now + 120;
	}

	/** Death: the zombie collapses and fades. Uses its live mesh, or a pose when it is gone. */
	kill(id: number, pose: ZombiePose | null, now: number): void {
		let m = this.live.get(id);
		if (m) this.live.delete(id);
		else if (pose) {
			m = this.take();
			m.root.position.set(pose.x, pose.z, -pose.y);
			m.body.rotation.y = pose.yaw * DEG;
		} else return;
		for (const mat of m.mats) {
			mat.transparent = true;
			mat.emissive.copy(NO_GLOW);
		}
		this.corpses.push({ m, at: now, dir: Math.random() < 0.5 ? 1 : -1 });
	}

	// ---------------------------------------------------------------------
	// Gates

	/** Build the gate meshes of a zombies map (closed). */
	setGates(gates: readonly ZombieGate[], now: number): void {
		this.clearGates();
		for (const g of gates) {
			const mat = new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
			const mesh = new THREE.Mesh(this.box, mat);
			const sx = g.max.x - g.min.x;
			const sy = g.max.y - g.min.y;
			const sz = g.max.z - g.min.z;
			mesh.scale.set(sx, sz, sy);
			mesh.position.set((g.min.x + g.max.x) / 2, (g.min.z + g.max.z) / 2, -(g.min.y + g.max.y) / 2);
			mesh.renderOrder = 3;
			const edges = new THREE.LineSegments(new THREE.EdgesGeometry(this.box), new THREE.LineBasicMaterial({ color: 0xffd080 }));
			mesh.add(edges);
			const u = g.unlock;
			const areaMat = new THREE.MeshBasicMaterial({ color: 0x5cff9a, transparent: true, opacity: 0.16, depthWrite: false });
			const area = new THREE.Mesh(this.box, areaMat);
			area.scale.set(u.max.x - u.min.x, 1, u.max.y - u.min.y);
			area.position.set((u.min.x + u.max.x) / 2, u.min.z + 1, -(u.min.y + u.max.y) / 2);
			this.group.add(mesh, area);
			this.gates.push({ mesh, mat, area, areaMat, state: 'closed', at: now });
		}
	}

	setGateState(i: number, state: GateState, now: number): void {
		const g = this.gates[i];
		if (!g || g.state === state) return;
		g.state = state;
		g.at = now;
		if (state === 'closed') {
			g.mesh.visible = true;
			g.mesh.scale.y = Math.abs(g.mesh.scale.y);
			g.mat.opacity = 0.55;
		}
	}

	private updateGates(now: number): void {
		for (const g of this.gates) {
			const t = now - g.at;
			g.area.visible = g.state === 'closed';
			if (g.state === 'open') {
				// Fade out and sink over 0.9 s.
				const f = Math.min(1, t / 900);
				g.mat.opacity = 0.55 * (1 - f);
				g.mesh.visible = f < 1;
			} else {
				const pulse = g.state === 'counting' ? 0.5 + 0.5 * Math.sin(t / 120) : 0.5 + 0.5 * Math.sin(now / 600);
				g.mat.color.setHex(g.state === 'counting' ? 0xffd24a : 0xff9a2a);
				g.mat.opacity = 0.4 + 0.25 * pulse;
				g.areaMat.opacity = 0.1 + 0.1 * pulse;
			}
		}
	}

	private clearGates(): void {
		for (const g of this.gates) {
			g.mesh.removeFromParent();
			g.area.removeFromParent();
			g.mat.dispose();
			g.areaMat.dispose();
			for (const c of g.mesh.children) {
				(c as THREE.LineSegments).geometry.dispose();
				((c as THREE.LineSegments).material as THREE.Material).dispose();
			}
		}
		this.gates = [];
	}

	// ---------------------------------------------------------------------
	// Tracers

	/** Cosmetic tracer between two Source points. */
	tracer(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, now: number): void {
		let tr = this.tracers.find((t) => now - t.at > TRACER_MS);
		if (!tr) {
			if (this.tracers.length >= MAX_TRACERS) tr = this.tracers[0]!;
			else {
				const g = new THREE.BufferGeometry();
				g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
				const line = new THREE.Line(g, this.tracerMat.clone());
				line.frustumCulled = false;
				this.group.add(line);
				tr = { line, at: now };
				this.tracers.push(tr);
			}
		}
		const pos = tr.line.geometry.getAttribute('position') as THREE.BufferAttribute;
		pos.setXYZ(0, from.x, from.z, -from.y);
		pos.setXYZ(1, to.x, to.z, -to.y);
		pos.needsUpdate = true;
		tr.at = now;
		tr.line.visible = true;
	}

	// ---------------------------------------------------------------------
	// Viewmodel

	private buildGuns(): void {
		const mat = (color: number, rough = 0.6) => {
			const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.3 });
			this.vmMats.push(m);
			return m;
		};
		const metal = mat(0x2c2f34);
		const dark = mat(0x1c1d20);
		const wood = mat(0x6a4a2e, 0.8);
		const steel = mat(0xb8bec6, 0.3);
		const olive = mat(0x4a5238);
		const part = (g: THREE.Group, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
			const p = new THREE.Mesh(this.box, m);
			p.scale.set(sx, sy, sz);
			p.position.set(x, y, z);
			g.add(p);
		};
		// Built pointing down −Z (camera forward); the muzzle point is stored in userData.
		const pistol = new THREE.Group();
		part(pistol, metal, 2.2, 2.4, 9, 0, 0, -3); // slide
		part(pistol, dark, 2, 5, 2.6, 0, -3, 0); // grip
		pistol.userData.muzzle = new THREE.Vector3(0, 0.4, -8);
		const lmg = new THREE.Group();
		part(lmg, olive, 3.6, 4, 16, 0, 0, -2); // receiver
		part(lmg, metal, 1.4, 1.4, 14, 0, 0.6, -16); // barrel
		part(lmg, dark, 3.6, 4.5, 4.5, -0.2, -4, -3); // box magazine
		part(lmg, dark, 2.4, 4, 3, 0, -3.4, 4); // grip
		part(lmg, olive, 3, 3, 7, 0, -0.5, 8); // stock
		lmg.userData.muzzle = new THREE.Vector3(0, 0.6, -23.5);
		const sniper = new THREE.Group();
		part(sniper, wood, 2.8, 3.2, 20, 0, -0.6, -2); // stock and body
		part(sniper, metal, 1, 1, 18, 0, 0.8, -19); // barrel
		part(sniper, dark, 1.8, 1.8, 9, 0, 3.4, -3); // scope
		part(sniper, steel, 0.6, 1.4, 0.6, 1.6, 0.8, 1); // bolt
		sniper.userData.muzzle = new THREE.Vector3(0, 0.8, -28.5);
		const knife = new THREE.Group();
		part(knife, dark, 1.6, 1.6, 5, 0, 0, 1); // handle
		part(knife, steel, 0.4, 1.8, 9, 0, 0.2, -6); // blade
		knife.userData.muzzle = null;
		for (const [id, g] of [
			['pistol', pistol],
			['lmg', lmg],
			['sniper', sniper],
			['knife', knife]
		] as const) {
			g.visible = false;
			this.guns.set(id, g);
			this.vm.add(g);
		}
	}

	setWeapon(w: WeaponId | null): void {
		if (w === this.weapon) return;
		this.weapon = w;
		for (const [id, g] of this.guns) g.visible = id === w;
	}

	/** Shot or swing: recoil kick and (guns) a muzzle flash. */
	fired(now: number): void {
		this.kickAt = now;
		if (this.weapon !== 'knife') this.muzzleAt = now;
	}

	/** Pose the viewmodel for this frame. `reload` 0..1 while reloading, else 1. */
	updateViewmodel(now: number, visible: boolean, reload: number, speed: number): void {
		this.vmVisible = visible && this.weapon !== null;
		this.vm.visible = this.vmVisible;
		if (!this.vmVisible) return;
		const g = this.weapon ? this.guns.get(this.weapon) : undefined;
		const k = Math.max(0, 1 - (now - this.kickAt) / (this.weapon === 'sniper' ? 260 : this.weapon === 'knife' ? 300 : 110));
		const dip = reload < 1 ? Math.sin(Math.min(1, reload) * Math.PI) : 0;
		const bob = Math.min(1, speed / 250) * Math.sin(now / 95) * 0.5;
		this.vm.scale.setScalar(0.42);
		this.vm.position.set(5, -4.6 - dip * 5 + bob * 0.6, -10);
		this.vm.rotation.set(0, 0, 0);
		if (this.weapon === 'knife') {
			this.vm.rotation.x = -k * 0.9;
			this.vm.rotation.y = k * 0.6;
			this.vm.position.x = 5 - k * 3;
		} else {
			this.vm.position.z = -10 + k * 1.2;
			this.vm.rotation.x = k * 0.12 + dip * 0.6;
		}
		const flash = now - this.muzzleAt < MUZZLE_MS && g?.userData.muzzle;
		this.muzzle.visible = !!flash;
		if (flash) {
			this.muzzle.position.copy(g!.userData.muzzle as THREE.Vector3);
			this.muzzle.rotation.z = Math.random() * Math.PI;
		}
	}

	resize(aspect: number): void {
		this.vmCamera.aspect = aspect;
		this.vmCamera.updateProjectionMatrix();
	}

	// ---------------------------------------------------------------------

	/** Corpse and tracer animation. */
	update(now: number): void {
		this.updateGates(now);
		for (let i = this.corpses.length - 1; i >= 0; i--) {
			const c = this.corpses[i]!;
			const t = now - c.at;
			const fall = Math.min(1, t / CORPSE_FALL_MS);
			const ease = fall * fall;
			c.m.body.rotation.z = c.dir * ease * (Math.PI / 2) * 0.95;
			c.m.body.position.y = -ease * 4;
			const fade = Math.max(0, Math.min(1, (t - CORPSE_FALL_MS) / CORPSE_FADE_MS));
			for (const mat of c.m.mats) mat.opacity = 1 - fade;
			if (fade >= 1) {
				this.corpses.splice(i, 1);
				this.release(c.m);
			}
		}
		for (const tr of this.tracers) {
			const age = now - tr.at;
			tr.line.visible = age < TRACER_MS;
			if (tr.line.visible) (tr.line.material as THREE.LineBasicMaterial).opacity = 0.9 * (1 - age / TRACER_MS);
		}
	}

	/** Last drawn pose of a live zombie (for corpses and local tracers). */
	has(id: number): boolean {
		return this.live.has(id);
	}

	clear(): void {
		for (const m of this.live.values()) this.release(m);
		this.live.clear();
		for (const c of this.corpses) this.release(c.m);
		this.corpses = [];
		for (const t of this.tracers) t.line.visible = false;
		this.setWeapon(null);
		this.vmVisible = false;
	}

	/** Map unload: also drop the gates. */
	reset(): void {
		this.clear();
		this.clearGates();
	}

	dispose(): void {
		this.reset();
		for (const m of this.free) for (const mat of m.mats) mat.dispose();
		this.free = [];
		for (const t of this.tracers) {
			t.line.geometry.dispose();
			(t.line.material as THREE.Material).dispose();
		}
		this.tracerMat.dispose();
		this.eyeMat.dispose();
		for (const m of this.vmMats) m.dispose();
		this.muzzle.geometry.dispose();
		this.box.dispose();
		this.group.removeFromParent();
	}
}
