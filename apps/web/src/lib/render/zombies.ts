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
/** Claw slash and throwing-knife throw animation lengths. */
const SLASH_MS = 320;
const THROW_MS = 360;
/** The off-hand knife leaves the hand this far into the throw (0..1). */
const RELEASE_AT = 0.38;
/** Pop-in time when the off-hand knife comes back (pickup, respawn). */
const OFFHAND_POP_MS = 140;
const MAX_TRACERS = 32;

/**
 * Recoil kick per weapon: recovery time (ms), pushback (viewmodel units) and
 * muzzle rise (rad). Heavy guns kick long and hard, the SMG fast and tight.
 */
export const VM_KICK: Readonly<Partial<Record<WeaponId, { ms: number; back: number; rise: number }>>> = Object.freeze({
	pistol: { ms: 110, back: 1.2, rise: 0.12 },
	lmg: { ms: 110, back: 1.2, rise: 0.12 },
	sniper: { ms: 260, back: 1.2, rise: 0.12 },
	barrett: { ms: 280, back: 3.4, rise: 0.32 },
	striker: { ms: 200, back: 2.6, rise: 0.26 },
	smg: { ms: 85, back: 0.7, rise: 0.05 }
});
const DEFAULT_KICK = { ms: 110, back: 1.2, rise: 0.12 };

/** `vmPart` arguments after the parent group. */
type PartArgs = [m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx?: number, ry?: number, rz?: number];

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
	private throwAt = -Infinity;
	private muzzleAt = -Infinity;
	/** Infected: throwing knife held ready in the left claw. */
	private offhand = false;
	private offhandAt = -Infinity;
	private offKnife: THREE.Group | null = null;
	vmVisible = false;
	private vmMats: THREE.Material[] = [];
	/** Non-box viewmodel geometry (cylinders, drums, rings), disposed with the renderer. */
	private vmGeoms: THREE.BufferGeometry[] = [];
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
		const barrett = this.buildBarrett(mat);
		const striker = this.buildStriker(mat);
		const smg = this.buildSmg(mat);
		// Claws: two infected forearms with three dark talons each, hands raised.
		const skin = mat(0x7a5a4c, 0.85);
		const sleeve = mat(0x3a2a26, 0.9);
		const talon = mat(0x1a1214, 0.35);
		const vein = new THREE.MeshStandardMaterial({ color: 0x5a1010, emissive: 0x6a0a08, roughness: 0.7 });
		this.vmMats.push(vein);
		const hand = (side: number) => {
			const h = new THREE.Group();
			part(h, sleeve, 3.8, 3.8, 10, 0, -1.2, 6); // ragged sleeve
			part(h, skin, 3, 3, 9, 0, 0, -1); // forearm
			part(h, vein, 0.5, 0.4, 6, side * 1.2, 1.5, -1); // glowing vein
			part(h, skin, 4.2, 1.8, 4, 0, 0.2, -6.5); // hand
			for (let i = 0; i < 3; i++) {
				const t = new THREE.Mesh(this.box, talon);
				t.scale.set(0.5, 0.5, 4.5);
				t.position.set((i - 1) * 1.4, 0.4, -10);
				t.rotation.x = 0.25;
				t.rotation.y = (i - 1) * -0.12;
				h.add(t);
			}
			h.userData.rest = { x: side > 0 ? 2 : -24, y: side > 0 ? -1 : -2, z: side > 0 ? 0 : -1 };
			h.position.set(h.userData.rest.x, h.userData.rest.y, h.userData.rest.z);
			h.rotation.set(0.15, side * -0.12, side * 0.18);
			return h;
		};
		const claws = new THREE.Group();
		const right = hand(1);
		const left = hand(-1);
		claws.add(right, left);
		claws.userData.muzzle = null;
		claws.userData.right = right;
		claws.userData.left = left;
		// Off-hand throwing knife (infected): gripped in the left fist, blade up and forward.
		// Dark gunmetal blade with a bright edge so it reads against bright skies.
		const gun = mat(0x3c4249, 0.32);
		const grip = mat(0x15171a, 0.85);
		const edge = new THREE.MeshBasicMaterial({ color: 0xf4f8ff });
		this.vmMats.push(edge);
		const off = new THREE.Group();
		part(off, grip, 1.2, 4.4, 1.2, 0, 0, 0); // handle in the fist
		part(off, gun, 2.6, 0.5, 1.4, 0, 2.4, 0); // guard
		part(off, gun, 0.35, 7.5, 1.6, 0, 6.3, 0); // blade
		part(off, edge, 0.45, 6.6, 0.32, 0, 6.1, -0.85); // cutting edge
		part(off, gun, 0.3, 1.4, 0.9, 0, 10.4, -0.3); // tip
		off.position.set(0.8, 1.6, -7.2);
		off.rotation.set(-1.05, 0, 0.2);
		off.visible = false;
		left.add(off);
		this.offKnife = off;
		for (const [id, g] of [
			['pistol', pistol],
			['lmg', lmg],
			['sniper', sniper],
			['barrett', barrett],
			['striker', striker],
			['smg', smg],
			['knife', knife],
			['claws', claws]
		] as const) {
			g.visible = false;
			this.guns.set(id, g);
			this.vm.add(g);
		}
	}

	/** Box part (optional rotation) of a viewmodel. */
	private vmPart(g: THREE.Object3D, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
		const p = new THREE.Mesh(this.box, m);
		p.scale.set(sx, sy, sz);
		p.position.set(x, y, z);
		p.rotation.set(rx, ry, rz);
		g.add(p);
		return p;
	}

	/** Cylinder along Z (the barrel axis) of a viewmodel; `seg` 8 makes an octagon. */
	private vmCyl(g: THREE.Object3D, m: THREE.Material, r: number, len: number, x: number, y: number, z: number, seg = 12, r2 = r): THREE.Mesh {
		const geo = new THREE.CylinderGeometry(r2, r, len, seg);
		this.vmGeoms.push(geo);
		const c = new THREE.Mesh(geo, m);
		c.rotation.x = -Math.PI / 2; // +Y (radiusTop, r2) → −Z: r2 is the front (muzzle) end
		c.position.set(x, y, z);
		g.add(c);
		return c;
	}

	/**
	 * Barrett .50cal: long gunmetal receiver, big box magazine, fluted heavy
	 * barrel, arrowhead muzzle brake, high scope on rings, carry handle, bipod.
	 */
	private buildBarrett(mat: (color: number, rough?: number) => THREE.MeshStandardMaterial): THREE.Group {
		const gunmetal = mat(0x3a3f46, 0.42);
		const black = mat(0x16181b, 0.8);
		const edge = mat(0x5d646d, 0.35);
		const glass = new THREE.MeshStandardMaterial({ color: 0x1a3a5a, emissive: 0x0a2240, roughness: 0.15, metalness: 0.6 });
		this.vmMats.push(glass);
		const g = new THREE.Group();
		const P = (...a: PartArgs) => this.vmPart(g, ...a);
		// Receiver: lower and upper halves with a top rail.
		P(gunmetal, 3.2, 2.4, 20, 0, -0.6, -2);
		P(gunmetal, 2.8, 1.6, 18, 0, 1.3, -2.6);
		P(edge, 1.6, 0.5, 17, 0, 2.35, -2.6);
		for (let i = 0; i < 7; i++) P(black, 1.8, 0.3, 0.6, 0, 2.7, -10 + i * 2.4); // rail slots
		// Massive box magazine and its base plate.
		P(black, 2.8, 6.2, 4.6, 0, -4.6, 0.5, 0.06);
		P(edge, 3, 0.6, 5, 0, -7.8, 0.7, 0.06);
		// Pistol grip, trigger guard.
		P(black, 2.2, 5, 2.6, 0, -3.8, 6.6, -0.32);
		P(black, 0.6, 0.5, 4.2, 0, -2.2, 4.2);
		// Stock: tube, cheek rest, recoil pad.
		P(gunmetal, 2.6, 3.2, 8, 0, -0.4, 12.4);
		P(black, 2.2, 1.2, 5, 0, 1.6, 12);
		P(black, 3, 4.6, 1.2, 0, -0.8, 16.8);
		// Heavy fluted barrel with a barrel shroud collar.
		this.vmCyl(g, gunmetal, 0.95, 20, 0, 0.3, -22);
		this.vmCyl(g, edge, 1.25, 2, 0, 0.3, -12.6);
		for (let i = 0; i < 6; i++) {
			const a = (i / 6) * Math.PI * 2;
			const f = this.vmPart(g, black, 0.22, 0.22, 16, Math.cos(a) * 0.92, 0.3 + Math.sin(a) * 0.92, -22);
			f.rotation.z = a;
		}
		// Arrowhead muzzle brake: a wide block with swept-back side wings and ports.
		P(gunmetal, 2.4, 1.9, 3.2, 0, 0.3, -33.4);
		P(gunmetal, 1.8, 1.7, 2.6, 1.6, 0.3, -32.8, 0, 0.55);
		P(gunmetal, 1.8, 1.7, 2.6, -1.6, 0.3, -32.8, 0, -0.55);
		P(black, 4.4, 1.0, 0.45, 0, 0.3, -33.6);
		P(black, 4.0, 1.0, 0.45, 0, 0.3, -32.4);
		P(edge, 1.2, 1.2, 0.8, 0, 0.3, -35.2);
		// High tactical scope on two rings.
		this.vmCyl(g, black, 1.25, 11, 0, 5.4, -3.2);
		this.vmCyl(g, black, 1.25, 2.6, 0, 5.4, -9.8, 12, 1.9); // objective bell
		this.vmCyl(g, black, 1.5, 2.2, 0, 5.4, 3.2); // eyepiece
		this.vmCyl(g, glass, 1.6, 0.2, 0, 5.4, -11.15);
		P(black, 1.1, 1.4, 1.1, 0, 7, -3.2); // elevation turret
		P(black, 1.1, 1.1, 1.4, 1.5, 5.4, -3.2); // windage turret
		for (const z of [-6.5, 0.4]) {
			P(edge, 2.6, 0.7, 1.2, 0, 4, z); // ring
			P(gunmetal, 1.2, 1.6, 1.2, 0, 3, z); // mount
		}
		// Carry handle over the front of the receiver.
		P(black, 0.7, 2.2, 0.7, 0, 3.6, -10);
		P(black, 0.7, 2.2, 0.7, 0, 3.6, -13.6);
		P(black, 0.8, 0.7, 4.4, 0, 4.9, -11.8);
		// Folded bipod under the barrel.
		P(black, 0.5, 0.5, 9, 0.9, -1.4, -17.5, 0.08);
		P(black, 0.5, 0.5, 9, -0.9, -1.4, -17.5, 0.08);
		P(gunmetal, 2.6, 0.9, 1.4, 0, -0.8, -13.2);
		g.userData.muzzle = new THREE.Vector3(0, 0.3, -36);
		return g;
	}

	/**
	 * Striker: matte street-sweeper with the wide octagonal rotary drum under
	 * the body, perforated heat-shield shroud, foregrip, stock folded on top.
	 */
	private buildStriker(mat: (color: number, rough?: number) => THREE.MeshStandardMaterial): THREE.Group {
		const matte = mat(0x26282c, 0.85);
		const steel = mat(0x4a4f56, 0.45);
		const black = mat(0x121315, 0.9);
		const brass = mat(0x8a6a2e, 0.5);
		const g = new THREE.Group();
		const P = (...a: PartArgs) => this.vmPart(g, ...a);
		// Receiver and top strap.
		P(matte, 3.4, 3.6, 14, 0, 0, -1);
		P(steel, 2.4, 0.6, 12, 0, 2.05, -1.5);
		// Rotary drum: a wide octagon with a hub, a winding key and shell chambers on the rim.
		this.vmCyl(g, matte, 4.4, 3.4, 0, -2.4, -3.8, 8);
		this.vmCyl(g, steel, 4.5, 0.5, 0, -2.4, -5.6, 8);
		this.vmCyl(g, steel, 4.5, 0.5, 0, -2.4, -2, 8);
		this.vmCyl(g, steel, 1.1, 1.2, 0, -2.4, -6.1);
		P(black, 0.5, 3, 0.5, 0, -2.4, -6.8, 0, 0, 0.7); // winding key
		// Shell chamber studs standing out of the front face of the drum.
		for (let i = 0; i < 12; i++) {
			const a = (i / 12) * Math.PI * 2;
			this.vmPart(g, i % 3 === 0 ? brass : black, 0.8, 0.8, 0.7, Math.cos(a) * 3.2, -2.4 + Math.sin(a) * 3.2, -6.05);
		}
		// Barrel inside a perforated heat-shield shroud.
		this.vmCyl(g, black, 0.8, 18, 0, 0.8, -16);
		this.vmCyl(g, steel, 1.35, 13, 0, 0.8, -14.6, 10);
		for (let row = 0; row < 3; row++) {
			const a = Math.PI / 2 + (row - 1) * 0.85;
			for (let i = 0; i < 6; i++) {
				const h = this.vmPart(g, black, 0.55, 0.32, 1, Math.cos(a) * 1.3, 0.8 + Math.sin(a) * 1.3, -9.6 - i * 2);
				h.rotation.z = a;
			}
		}
		this.vmCyl(g, steel, 1.0, 1.4, 0, 0.8, -25.3);
		// Vertical foregrip and pistol grip with trigger guard.
		P(black, 1.6, 4.2, 1.8, 0, -3.2, -12.5, 0.12);
		P(black, 2.2, 4.8, 2.6, 0, -3.8, 5.4, -0.3);
		P(black, 0.6, 0.5, 3.6, 0, -2.2, 3.4);
		// Folding stock, folded forward over the top: two struts and the butt plate.
		P(steel, 0.45, 0.45, 11, 1.1, 2.9, -2.5);
		P(steel, 0.45, 0.45, 11, -1.1, 2.9, -2.5);
		P(black, 3, 2.6, 0.7, 0, 3.4, -8.3);
		P(steel, 2.6, 0.9, 1.2, 0, 2.6, 3.2); // hinge
		g.userData.muzzle = new THREE.Vector3(0, 0.8, -26.4);
		return g;
	}

	/**
	 * PP90M1-style SMG: compact slate body, helical tube magazine under the
	 * barrel, stubby muzzle, iron-sight rail, side-folded stock.
	 */
	private buildSmg(mat: (color: number, rough?: number) => THREE.MeshStandardMaterial): THREE.Group {
		const slate = mat(0x3a4048, 0.6);
		const black = mat(0x15171a, 0.85);
		const steel = mat(0x6a7078, 0.4);
		const g = new THREE.Group();
		const P = (...a: PartArgs) => this.vmPart(g, ...a);
		// Body and top cover.
		P(slate, 2.8, 3.4, 13, 0, 0.2, -1);
		P(black, 2.2, 0.6, 12, 0, 2.1, -1.4);
		// Iron-sight rail: front post with ears, rear aperture.
		P(steel, 0.9, 0.4, 11, 0, 2.6, -1.6);
		P(black, 0.35, 1.4, 0.35, 0, 3.4, -6.8);
		P(black, 0.3, 1.1, 0.5, 0.55, 3.2, -6.8);
		P(black, 0.3, 1.1, 0.5, -0.55, 3.2, -6.8);
		P(black, 1.4, 1.2, 0.5, 0, 3.2, 3.6);
		// Stubby barrel and muzzle nut.
		this.vmCyl(g, black, 0.55, 4.4, 0, 0.9, -9.6);
		this.vmCyl(g, steel, 0.8, 1.2, 0, 0.9, -12.2, 8);
		// Helical tube magazine under the barrel, ridged along its length.
		this.vmCyl(g, slate, 1.5, 12.5, 0, -1.9, -5.2);
		this.vmCyl(g, black, 1.25, 0.8, 0, -1.9, -11.6);
		const ring = new THREE.TorusGeometry(1.52, 0.2, 4, 14);
		this.vmGeoms.push(ring);
		for (let i = 0; i < 9; i++) {
			const r = new THREE.Mesh(ring, steel);
			r.position.set(0, -1.9, -10.2 + i * 1.25);
			r.rotation.set(0.28, 0, 0); // tilted: reads as a helix
			g.add(r);
		}
		// Grip, trigger guard, selector.
		P(black, 2, 4.4, 2.4, 0, -3.6, 3.6, -0.25);
		P(black, 0.5, 0.5, 3.2, 0, -2.0, 1.4);
		P(steel, 0.4, 0.8, 1.2, 1.5, 0.4, 1.8);
		// Compact stock folded along the left side.
		P(black, 0.5, 1.8, 9, -1.75, -0.4, -1.5);
		P(black, 0.6, 3, 0.9, -1.75, -1.2, -6);
		P(steel, 0.7, 1.2, 1.2, -1.6, 0.4, 4.6); // hinge
		g.userData.muzzle = new THREE.Vector3(0, 0.9, -13.2);
		return g;
	}

	setWeapon(w: WeaponId | null): void {
		if (w === this.weapon) return;
		this.weapon = w;
		for (const [id, g] of this.guns) g.visible = id === w;
	}

	/** Shot or swing: recoil kick, claw slash, and (guns only) a muzzle flash. */
	fired(now: number): void {
		this.kickAt = now;
		if (this.weapon !== 'knife' && this.weapon !== 'claws') this.muzzleAt = now;
	}

	/**
	 * Infected: show the throwing knife held in the left claw. Hiding it right
	 * after `thrown()` keeps it in the hand until the release point of the throw.
	 */
	setOffhandKnife(visible: boolean, now = performance.now()): void {
		if (visible === this.offhand) return;
		this.offhand = visible;
		if (visible) this.offhandAt = now;
	}

	/** Whether the off-hand knife is held (set by `setOffhandKnife`). */
	get offhandKnife(): boolean {
		return this.offhand;
	}

	/** Whether the off-hand knife mesh was drawn in the last `updateViewmodel`. */
	get offhandDrawn(): boolean {
		return !!this.offKnife?.visible && this.vmVisible && this.weapon === 'claws';
	}

	/** Throwing knife: an overhand throw (no muzzle flash). */
	thrown(now: number): void {
		this.throwAt = now;
	}

	/** Pose the viewmodel for this frame. `reload` 0..1 while reloading, else 1. */
	updateViewmodel(now: number, visible: boolean, reload: number, speed: number): void {
		this.vmVisible = visible && this.weapon !== null;
		this.vm.visible = this.vmVisible;
		if (!this.vmVisible) return;
		const g = this.weapon ? this.guns.get(this.weapon) : undefined;
		const kick = (this.weapon && VM_KICK[this.weapon]) || DEFAULT_KICK;
		const k = Math.max(0, 1 - (now - this.kickAt) / (this.weapon === 'knife' ? 300 : this.weapon === 'claws' ? SLASH_MS : kick.ms));
		const tp = Math.max(0, Math.min(1, (now - this.throwAt) / THROW_MS));
		/** 0 → 1 → 0 over the throw (wind-up, release, recover). */
		const toss = tp < 1 ? Math.sin(tp * Math.PI) : 0;
		const dip = reload < 1 ? Math.sin(Math.min(1, reload) * Math.PI) : 0;
		const bob = Math.min(1, speed / 250) * Math.sin(now / 95) * 0.5;
		this.vm.scale.setScalar(0.42);
		this.vm.position.set(5, -4.6 - dip * 5 + bob * 0.6, -10);
		this.vm.rotation.set(0, 0, 0);
		if (this.weapon === 'claws' && g) {
			const right = g.userData.right as THREE.Group;
			const left = g.userData.left as THREE.Group;
			const rr = right.userData.rest as { x: number; y: number; z: number };
			const lr = left.userData.rest as { x: number; y: number; z: number };
			// Slash: the right claw rakes across the view, right to left and down.
			const sweep = k > 0 ? Math.sin((1 - k) * Math.PI) : 0;
			const idle = Math.sin(now / 420) * 0.4;
			right.position.set(rr.x - sweep * 20, rr.y + sweep * 4 - (1 - k) * sweep * 6 + idle, rr.z - sweep * 6);
			right.rotation.set(0.15 - sweep * 0.5, -0.12 + sweep * 0.9, 0.18 + sweep * 0.9);
			// Throw: the left hand snaps forward and up.
			left.position.set(lr.x + toss * 8, lr.y + toss * 6 - idle, lr.z - toss * 12);
			left.rotation.set(0.15 - toss * 1.1, 0.12 - toss * 0.4, -0.18);
			this.vm.position.y -= sweep * 1.5;
			const off = this.offKnife;
			if (off) {
				// Held, or still in the hand until the release point of a throw.
				off.visible = this.offhand || tp < RELEASE_AT;
				const pop = Math.min(1, Math.max(0, (now - this.offhandAt) / OFFHAND_POP_MS));
				off.scale.setScalar(this.offhand ? 0.35 + 0.65 * (1 - (1 - pop) * (1 - pop)) : 1);
			}
		} else if (this.weapon === 'knife') {
			this.vm.rotation.x = -k * 0.9;
			this.vm.rotation.y = k * 0.6;
			this.vm.position.x = 5 - k * 3;
		} else {
			this.vm.position.z = -10 + k * kick.back;
			this.vm.rotation.x = k * kick.rise + dip * 0.6;
		}
		if (toss > 0 && this.weapon !== 'claws') {
			this.vm.position.y -= toss * 3;
			this.vm.rotation.x -= toss * 0.8;
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
		this.setOffhandKnife(false);
		this.throwAt = -Infinity;
		if (this.offKnife) this.offKnife.visible = false;
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
		for (const g of this.vmGeoms) g.dispose();
		this.vmGeoms = [];
		this.muzzle.geometry.dispose();
		this.box.dispose();
		this.group.removeFromParent();
	}
}
