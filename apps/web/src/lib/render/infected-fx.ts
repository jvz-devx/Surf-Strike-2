/**
 * Infected hit and kill feedback in the world (docs/modes.md#infected):
 * corpses (a killed infected collapses and fades as the character it was, no blood),
 * the burst around a survivor who turns, and bullet impacts (sparks and a
 * dust puff) where a shot meets the map. Everything is pooled and capped;
 * the impacts of all shots share two draw calls. Owned by InfectedRenderer,
 * which forwards update, clear and dispose. Positions are Source points;
 * Source → Three is (x, y, z) → (x, z, −y).
 */
import * as THREE from 'three';
import { emptyMotion } from './character/animator.js';
import type { HeldAssets } from './character/held.js';
import { PALETTE_SIZE } from './character/material.js';
import { PAL } from './character/mesh-kit.js';
import { CharacterModel, personOf } from './character/model.js';
import type { InfectedLook } from './players.js';

const DEG = Math.PI / 180;

/** Corpse: fall time, fade time after it, and the cap (a full lobby wiped by a M.O.A.B.). */
export const CORPSE_FALL_MS = 420;
export const CORPSE_FADE_MS = 1300;
export const CORPSE_MAX = 32;
/** The red of the infected eyes (the turn burst). */
const TURN_COLOR = 0xff3a1e;
/** How far the body tips over (radians) and how high it is lifted to rest on its side. */
const CORPSE_TIP = (Math.PI / 2) * 0.96;
const CORPSE_REST_Y = 5;
const EYES_OUT = 0.12;

/** Infection burst: lifetime, motes per burst, bursts drawn at once. */
export const TURN_MS = 560;
export const TURN_MOTES = 14;
export const TURN_MAX = 8;
/** Burst centre above the feet. */
const TURN_CHEST_Z = 44;

/** Bullet impacts: lifetime, sparks and dust points per impact, impacts drawn at once. */
export const IMPACT_MS = 300;
export const IMPACT_SPARKS = 4;
export const IMPACT_PUFFS = 2;
export const IMPACT_MAX = 64;
/** Sparks die this far into the impact; the dust lingers to the end. */
const IMPACT_SPARK_PART = 0.6;
const IMPACT_GRAVITY = 700;
/** Spark streak length (seconds of travel). */
const IMPACT_TRAIL = 0.018;

export interface CorpsePose {
	x: number;
	y: number;
	z: number;
	yaw: number;
	/** Player id: the person of a corpse without a drawn avatar to take over. */
	id?: number;
	/** Source direction the body falls towards (any length); backwards when omitted. */
	fx?: number;
	fy?: number;
	/** Stand this long before collapsing (ms; staggers a wipe). */
	delay?: number;
}

interface Corpse {
	/** At the death pose. */
	root: THREE.Group;
	/** Tips over around a horizontal axis. */
	tip: THREE.Group;
	model: CharacterModel;
	/** Palette at the death pose: the glow and the eyes go out from it. */
	palette: Float32Array;
	/** Collapse start (ms). */
	at: number;
	/** Unit fall axis in the Three XZ plane. */
	ax: number;
	az: number;
}

interface TurnBurst {
	root: THREE.Group;
	lines: THREE.LineSegments;
	pos: THREE.BufferAttribute;
	lineMat: THREE.LineBasicMaterial;
	ring: THREE.Mesh;
	ringMat: THREE.MeshBasicMaterial;
	flash: THREE.Sprite;
	flashMat: THREE.SpriteMaterial;
	at: number;
}

const AXIS = new THREE.Vector3();
const UP = { x: 0, y: 0, z: 1 };

export class InfectedFx {
	/** An Object3D, so knife-root queries on Groups under the infected renderer stay unaffected. */
	readonly group = new THREE.Object3D();
	private ringGeo = new THREE.RingGeometry(0.86, 1, 40);
	// Corpses
	private corpses: Corpse[] = [];
	private corpseFree: Corpse[] = [];
	private corpseBuilt = 0;
	// Infection bursts
	private turns: TurnBurst[] = [];
	private turnFree: TurnBurst[] = [];
	// Impacts: every impact is a slot in two shared buffers (spark lines, dust points).
	private impAt = new Float64Array(IMPACT_MAX).fill(-Infinity);
	/** Slot origin and surface normal in Three space. */
	private impPos = new Float32Array(IMPACT_MAX * 3);
	private impNor = new Float32Array(IMPACT_MAX * 3);
	/** Spark velocities (Three space), IMPACT_SPARKS per slot. */
	private impVel = new Float32Array(IMPACT_MAX * IMPACT_SPARKS * 3);
	/** Sideways drift of each dust point (Three space), IMPACT_PUFFS per slot. */
	private impDrift = new Float32Array(IMPACT_MAX * IMPACT_PUFFS * 3);
	private impNext = 0;
	private impLive = 0;
	private sparkPos: THREE.BufferAttribute;
	private sparkCol: THREE.BufferAttribute;
	private sparkMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
	private sparks: THREE.LineSegments;
	private puffPos: THREE.BufferAttribute;
	private puffCol: THREE.BufferAttribute;
	private puffMat: THREE.PointsMaterial;
	private puffs: THREE.Points;

	constructor(
		private readonly assets: HeldAssets,
		private readonly glowTex: THREE.Texture | null = null
	) {
		this.group.name = 'infected-fx';
		const sv = IMPACT_MAX * IMPACT_SPARKS * 2;
		this.sparkPos = new THREE.BufferAttribute(new Float32Array(sv * 3), 3);
		this.sparkCol = new THREE.BufferAttribute(new Float32Array(sv * 4), 4);
		const sg = new THREE.BufferGeometry();
		sg.setAttribute('position', this.sparkPos.setUsage(THREE.DynamicDrawUsage));
		sg.setAttribute('color', this.sparkCol.setUsage(THREE.DynamicDrawUsage));
		this.sparks = new THREE.LineSegments(sg, this.sparkMat);
		const pv = IMPACT_MAX * IMPACT_PUFFS;
		this.puffPos = new THREE.BufferAttribute(new Float32Array(pv * 3), 3);
		this.puffCol = new THREE.BufferAttribute(new Float32Array(pv * 4), 4);
		const pg = new THREE.BufferGeometry();
		pg.setAttribute('position', this.puffPos.setUsage(THREE.DynamicDrawUsage));
		pg.setAttribute('color', this.puffCol.setUsage(THREE.DynamicDrawUsage));
		this.puffMat = new THREE.PointsMaterial({ size: 11, map: glowTex, vertexColors: true, transparent: true, depthWrite: false });
		this.puffs = new THREE.Points(pg, this.puffMat);
		for (const o of [this.sparks, this.puffs]) {
			// Slots are anywhere on the map: no single bounding sphere.
			o.frustumCulled = false;
			o.renderOrder = 3;
			o.visible = false;
			this.group.add(o);
		}
	}

	// ---------------------------------------------------------------------
	// Corpses

	private createCorpse(): Corpse {
		const model = new CharacterModel(personOf(0), this.assets);
		// Transparent from the start: flipping `transparent` later would need a program switch.
		model.material.transparent = true;
		const tip = new THREE.Group();
		tip.add(model.group);
		const root = new THREE.Group();
		root.add(tip);
		this.group.add(root);
		this.corpseBuilt++;
		return { root, tip, model, palette: new Float32Array(PALETTE_SIZE), at: 0, ax: 0, az: 1 };
	}

	/**
	 * A killed infected: its body, in the infected or Patient Zero look, stands
	 * at the death pose, falls over and fades. No blood. `from`: the drawn
	 * avatar, whose clothes, pose and detail the corpse takes over; without one
	 * it stands as any infected does.
	 */
	corpse(pose: CorpsePose, look: InfectedLook, now: number, from: CharacterModel | null = null): void {
		let c = this.corpseFree.pop();
		if (!c) c = this.corpseBuilt < CORPSE_MAX ? this.createCorpse() : this.corpses.shift()!;
		if (from) c.model.mirror(from);
		else {
			c.model.setPerson(personOf(pose.id ?? 0));
			c.model.setHeld('claws');
		}
		c.model.setRole(look);
		// A hit flash or a turn ease of the avatar ends with it: the plain look from here.
		c.model.recolor();
		if (!from) {
			c.model.animator.reset();
			c.model.settle({ ...emptyMotion(), yaw: pose.yaw });
		}
		c.model.setYaw(pose.yaw);
		c.model.material.save(c.palette);
		c.root.visible = true;
		c.root.position.set(pose.x, pose.z, -pose.y);
		// Falls away from the hit; backwards when the direction is unknown.
		let dx = pose.fx ?? -Math.cos(pose.yaw * DEG);
		let dz = -(pose.fy ?? -Math.sin(pose.yaw * DEG));
		const l = Math.hypot(dx, dz);
		if (l > 1e-6) {
			dx /= l;
			dz /= l;
		} else {
			dx = 1;
			dz = 0;
		}
		// up × direction: turning around it tips the head towards the direction.
		c.ax = dz;
		c.az = -dx;
		c.at = now + Math.max(0, pose.delay ?? 0);
		this.corpses.push(c);
		this.poseCorpse(c, now);
	}

	/** Returns false when the corpse has faded out. */
	private poseCorpse(c: Corpse, now: number): boolean {
		const t = now - c.at;
		const fade = Math.min(1, Math.max(0, (t - CORPSE_FALL_MS) / CORPSE_FADE_MS));
		if (fade >= 1) return false;
		const fall = Math.min(1, Math.max(0, t / CORPSE_FALL_MS));
		const ease = fall * fall;
		c.tip.quaternion.setFromAxisAngle(AXIS.set(c.ax, 0, c.az), ease * CORPSE_TIP);
		c.tip.position.y = ease * CORPSE_REST_Y;
		// The glow and the eyes go out as it falls.
		const pal = c.model.material.palette;
		for (let i = 0; i < pal.length; i++) {
			const o = i * 4;
			const eye = i === PAL.eyeWhite || i === PAL.iris;
			const k = eye ? 1 - (1 - EYES_OUT) * fall : 1;
			pal[i]!.set(c.palette[o]! * k, c.palette[o + 1]! * k, c.palette[o + 2]! * k, c.palette[o + 3]! * (eye ? 1 : 1 - fall));
		}
		c.model.material.opacity = 1 - fade;
		return true;
	}

	private releaseCorpse(c: Corpse): void {
		c.root.visible = false;
		this.corpseFree.push(c);
	}

	private updateCorpses(now: number): void {
		for (let i = this.corpses.length - 1; i >= 0; i--) {
			const c = this.corpses[i]!;
			if (this.poseCorpse(c, now)) continue;
			this.corpses.splice(i, 1);
			this.releaseCorpse(c);
		}
	}

	// ---------------------------------------------------------------------
	// Infection burst

	private createTurn(): TurnBurst {
		const geo = new THREE.BufferGeometry();
		const pos = new THREE.BufferAttribute(new Float32Array(TURN_MOTES * 2 * 3), 3);
		pos.setUsage(THREE.DynamicDrawUsage);
		geo.setAttribute('position', pos);
		// The red of the infected eyes. Normal blending: additive red washes out to yellow on sunlit sand.
		const lineMat = new THREE.LineBasicMaterial({ color: TURN_COLOR, transparent: true, opacity: 0, depthWrite: false });
		const lines = new THREE.LineSegments(geo, lineMat);
		lines.frustumCulled = false;
		lines.renderOrder = 3;
		const ringMat = new THREE.MeshBasicMaterial({ color: 0xd8301a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
		const ring = new THREE.Mesh(this.ringGeo, ringMat);
		ring.rotation.x = -Math.PI / 2;
		ring.position.y = 1.5;
		ring.renderOrder = 3;
		const flashMat = new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff2a14, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
		const flash = new THREE.Sprite(flashMat);
		flash.position.y = TURN_CHEST_Z;
		flash.renderOrder = 3;
		const root = new THREE.Group();
		root.add(lines, ring, flash);
		this.group.add(root);
		return { root, lines, pos, lineMat, ring, ringMat, flash, flashMat, at: 0 };
	}

	/**
	 * A survivor turns: motes in the red of the infected eyes spiral up and in
	 * around the body, with a glow at the chest and a thin ring racing out over
	 * the floor (light, not blood). `pos`: feet.
	 */
	turn(pos: { x: number; y: number; z: number }, now: number): void {
		let b = this.turnFree.pop();
		if (!b) b = this.turns.length >= TURN_MAX ? this.turns.shift()! : this.createTurn();
		b.at = now;
		b.root.visible = true;
		b.root.position.set(pos.x, pos.z, -pos.y);
		this.turns.push(b);
		this.poseTurn(b, now);
	}

	/** Returns false when the burst is over. */
	private poseTurn(b: TurnBurst, now: number): boolean {
		// Events are stamped with performance.now(), frames with the (slightly older) rAF time.
		const f = Math.max(0, now - b.at) / TURN_MS;
		if (f >= 1) return false;
		for (let j = 0; j < TURN_MOTES; j++) {
			const u = j / TURN_MOTES;
			// Two interleaved helices closing in on the body while they climb.
			const a0 = u * Math.PI * 4 + (j % 2) * Math.PI;
			for (let k = 0; k < 2; k++) {
				const g = Math.max(0, f - k * 0.07);
				const a = a0 + g * 5.5;
				const r = 30 * (1 - g) + 5;
				b.pos.setXYZ(j * 2 + k, Math.cos(a) * r, 4 + u * 18 + g * 50, Math.sin(a) * r);
			}
		}
		b.pos.needsUpdate = true;
		const env = Math.sin(Math.PI * f);
		b.lineMat.opacity = Math.min(1, env * 1.5);
		const rs = 10 + 46 * (1 - (1 - f) * (1 - f));
		b.ring.scale.set(rs, rs, 1);
		b.ringMat.opacity = 0.7 * (1 - f);
		b.flash.scale.setScalar(22 + 30 * env);
		b.flashMat.opacity = 0.75 * env;
		return true;
	}

	private releaseTurn(b: TurnBurst): void {
		b.root.visible = false;
		this.turnFree.push(b);
	}

	private updateTurns(now: number): void {
		for (let i = this.turns.length - 1; i >= 0; i--) {
			const b = this.turns[i]!;
			if (this.poseTurn(b, now)) continue;
			this.turns.splice(i, 1);
			this.releaseTurn(b);
		}
	}

	// ---------------------------------------------------------------------
	// Bullet impacts

	/**
	 * A bullet met the map at `pos`: a few sparks off the surface and a small
	 * dust puff. `normal` (Source, unit) is the surface normal; up when unknown.
	 * The oldest impact is replaced when IMPACT_MAX are live.
	 */
	impact(pos: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number } | null, now: number): void {
		const s = this.impNext;
		this.impNext = (s + 1) % IMPACT_MAX;
		if (this.impAt[s] === -Infinity) this.impLive++;
		this.impAt[s] = now;
		const n = normal && Math.hypot(normal.x, normal.y, normal.z) > 1e-6 ? normal : UP;
		const nx = n.x;
		const ny = n.z;
		const nz = -n.y;
		this.impPos[s * 3] = pos.x;
		this.impPos[s * 3 + 1] = pos.z;
		this.impPos[s * 3 + 2] = -pos.y;
		this.impNor[s * 3] = nx;
		this.impNor[s * 3 + 1] = ny;
		this.impNor[s * 3 + 2] = nz;
		for (let i = 0; i < IMPACT_SPARKS; i++) {
			// Off the surface in a wide cone.
			let vx = nx + (Math.random() * 2 - 1) * 0.9;
			let vy = ny + (Math.random() * 2 - 1) * 0.9;
			let vz = nz + (Math.random() * 2 - 1) * 0.9;
			const l = Math.hypot(vx, vy, vz) || 1;
			const sp = 170 + 190 * Math.random();
			vx = (vx / l) * sp;
			vy = (vy / l) * sp;
			vz = (vz / l) * sp;
			const o = (s * IMPACT_SPARKS + i) * 3;
			this.impVel[o] = vx;
			this.impVel[o + 1] = vy;
			this.impVel[o + 2] = vz;
		}
		for (let i = 0; i < IMPACT_PUFFS; i++) {
			const o = (s * IMPACT_PUFFS + i) * 3;
			this.impDrift[o] = (Math.random() * 2 - 1) * 7;
			this.impDrift[o + 1] = (Math.random() * 2 - 1) * 7 + 4;
			this.impDrift[o + 2] = (Math.random() * 2 - 1) * 7;
		}
		this.writeImpact(s, now);
		this.flushImpacts();
	}

	/** Write one slot's vertices; returns false (and blanks it) when it is over. */
	private writeImpact(s: number, now: number): boolean {
		const t = Math.max(0, now - this.impAt[s]!);
		const f = t / IMPACT_MS;
		const live = f < 1;
		const px = this.impPos[s * 3]!;
		const py = this.impPos[s * 3 + 1]!;
		const pz = this.impPos[s * 3 + 2]!;
		const sec = t / 1000;
		const sf = f / IMPACT_SPARK_PART;
		const sa = live && sf < 1 ? Math.min(1, (1 - sf) * 1.6) : 0;
		for (let i = 0; i < IMPACT_SPARKS; i++) {
			const o = (s * IMPACT_SPARKS + i) * 3;
			const vx = this.impVel[o]!;
			const vy = this.impVel[o + 1]!;
			const vz = this.impVel[o + 2]!;
			// Head: ballistic; tail: a short streak behind it along the current velocity.
			const hx = px + vx * sec;
			const hy = py + vy * sec - 0.5 * IMPACT_GRAVITY * sec * sec;
			const hz = pz + vz * sec;
			const cvy = vy - IMPACT_GRAVITY * sec;
			const v = (s * IMPACT_SPARKS + i) * 2;
			this.sparkPos.setXYZ(v, hx, hy, hz);
			this.sparkPos.setXYZ(v + 1, hx - vx * IMPACT_TRAIL, hy - cvy * IMPACT_TRAIL, hz - vz * IMPACT_TRAIL);
			this.sparkCol.setXYZW(v, 1, 0.86, 0.56, sa);
			this.sparkCol.setXYZW(v + 1, 1, 0.6, 0.25, sa * 0.4);
		}
		const pa = live ? 0.5 * (1 - f) * Math.min(1, f * 8) : 0;
		// Dust: drifts off the surface and slows down.
		const out = 3 + 16 * (1 - (1 - f) * (1 - f));
		for (let i = 0; i < IMPACT_PUFFS; i++) {
			const o = (s * IMPACT_PUFFS + i) * 3;
			const k = out * (1 - i * 0.35);
			const d = Math.min(1, f * 1.5);
			const v = s * IMPACT_PUFFS + i;
			this.puffPos.setXYZ(
				v,
				px + this.impNor[s * 3]! * k + this.impDrift[o]! * d,
				py + this.impNor[s * 3 + 1]! * k + this.impDrift[o + 1]! * d,
				pz + this.impNor[s * 3 + 2]! * k + this.impDrift[o + 2]! * d
			);
			this.puffCol.setXYZW(v, 0.8, 0.76, 0.68, pa);
		}
		if (!live) {
			this.impAt[s] = -Infinity;
			this.impLive--;
		}
		return live;
	}

	private flushImpacts(): void {
		this.sparkPos.needsUpdate = true;
		this.sparkCol.needsUpdate = true;
		this.puffPos.needsUpdate = true;
		this.puffCol.needsUpdate = true;
		this.sparks.visible = this.puffs.visible = this.impLive > 0;
	}

	private updateImpacts(now: number): void {
		if (this.impLive === 0) return;
		for (let s = 0; s < IMPACT_MAX; s++) if (this.impAt[s] !== -Infinity) this.writeImpact(s, now);
		this.flushImpacts();
	}

	// ---------------------------------------------------------------------

	/** Live effects (tests and debugging). */
	get stats(): { corpses: number; corpsesPooled: number; turns: number; turnsPooled: number; impacts: number } {
		return { corpses: this.corpses.length, corpsesPooled: this.corpseFree.length, turns: this.turns.length, turnsPooled: this.turnFree.length, impacts: this.impLive };
	}

	update(now: number): void {
		this.updateCorpses(now);
		this.updateTurns(now);
		this.updateImpacts(now);
	}

	/** Round reset or map change: everything stops at once (pools are kept). */
	clear(): void {
		for (const c of this.corpses) this.releaseCorpse(c);
		this.corpses.length = 0;
		for (const b of this.turns) this.releaseTurn(b);
		this.turns.length = 0;
		if (this.impLive > 0) {
			this.impAt.fill(-Infinity);
			this.impLive = 0;
			this.sparkCol.array.fill(0);
			this.puffCol.array.fill(0);
			this.flushImpacts();
		}
	}

	dispose(): void {
		this.clear();
		for (const c of this.corpseFree) c.model.dispose();
		this.corpseFree = [];
		this.corpseBuilt = 0;
		for (const b of this.turnFree) {
			b.lines.geometry.dispose();
			b.lineMat.dispose();
			b.ringMat.dispose();
			b.flashMat.dispose();
		}
		this.turnFree = [];
		this.sparks.geometry.dispose();
		this.puffs.geometry.dispose();
		this.sparkMat.dispose();
		this.puffMat.dispose();
		this.ringGeo.dispose();
		this.group.clear();
		this.group.removeFromParent();
	}
}
