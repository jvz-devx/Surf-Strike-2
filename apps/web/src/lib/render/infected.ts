/**
 * Infected visuals (docs/modes.md#infected): throwing knives (tumbling in
 * flight, embedded when stuck, a pulsing pickup ring on your own), respawn
 * beacons (beacon flares: puck, flare tube, burning tip, ground
 * halo and a rising glow; your own also gets a trim ring and a marker seen
 * through walls), the last-survivor UAV pulse, drawn through walls, plus
 * sparks where a knife bounces or sticks and a flare burst where a beacon is
 * smashed or used. Positions are Source points;
 * Source → Three is (x, y, z) → (x, z, −y).
 * Hit and kill feedback (corpses, infection bursts, bullet impacts) lives in
 * render/infected-fx.ts; this renderer owns it as `fx`.
 */
import * as THREE from 'three';
import type { HeldAssets } from './character/held.js';
import { InfectedFx } from './infected-fx.js';

const DEG = Math.PI / 180;
/** Spin rate in radians per ms (end-over-end tumble). */
const SPIN = 0.025;
const UAV_MS = 3200;
const UAV_RADIUS = 720;
const UAV_MARKER_Z = 44;
/** Knife layout along local +X (Hammer units): pommel at 0, tip at KNIFE_LEN. */
const HANDLE_LEN = 7;
const GUARD_X = HANDLE_LEN + 0.4;
const BLADE_LEN = 12.5;
const KNIFE_LEN = GUARD_X + 0.4 + BLADE_LEN;
/** How deep a stuck knife sits in the surface. */
const EMBED = 3.5;
/** Impact sparks: lifetime, count per burst, burst pool cap. */
export const SPARK_MS = 220;
export const SPARKS_BOUNCE = 8;
export const SPARKS_STICK = 6;
/** Beacon smash / respawn: a bigger, longer crimson-orange flare burst. */
export const SPARKS_BEACON = 12;
export const SPARK_BEACON_MS = 380;
const SPARK_POOL = 12;
const SPARK_GRAVITY = 900;
/** Spark streak length (seconds of travel). */
const SPARK_TRAIL = 0.022;
/** Respawn beacon layout (Hammer units above its floor point; hit centre is INF_BEACON_HIT_Z = 10). */
const RB_BASE_H = 4;
const RB_TUBE_H = 12;
/** Tube tilt (radians) and the tip position at its end. */
const RB_TILT = 0.22;
const RB_TIP_Y = RB_BASE_H + Math.cos(RB_TILT) * RB_TUBE_H + 1;
const RB_TIP_X = Math.sin(RB_TILT) * RB_TUBE_H;
const RB_COLUMN_H = 48;
/** Owner marker height above the floor point. */
export const RB_MARKER_Z = 26;
const RB_FLARE = 0xff4422;

export interface BeaconRenderPose {
	id: number;
	ownerId: number;
	x: number;
	y: number;
	z: number;
	yaw: number;
}

interface BeaconMesh {
	root: THREE.Group;
	tip: THREE.Mesh;
	glow: THREE.Sprite;
	halo: THREE.Mesh;
	column: THREE.Mesh;
	/** Owner only: trim ring and a through-wall marker. */
	trim: THREE.Mesh;
	marker: THREE.Mesh;
	mine: boolean;
	phase: number;
}

export interface KnifeRenderPose {
	id: number;
	ownerId: number;
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	pitch: number;
	yaw: number;
	stuck: boolean;
}

interface KnifeMesh {
	/** Positioned at the knife point. */
	root: THREE.Group;
	/** Yaw and pitch (flight direction or impact angles). */
	orient: THREE.Group;
	/** End-over-end spin around the knife's lateral axis. */
	spin: THREE.Group;
	/** The knife model, shifted so the spin centre or the embedded tip sits at the origin. */
	model: THREE.Group;
	streak: THREE.Mesh;
	/** Dark, normal-blended streak under the bright one (reads on sunlit sand and sky). */
	shade: THREE.Mesh;
	glint: THREE.Sprite;
	ring: THREE.Mesh;
	halo: THREE.Mesh;
	stuck: boolean;
	mine: boolean;
	phase: number;
}

interface UavBeacon {
	root: THREE.Group;
	rings: THREE.Mesh[];
	pillar: THREE.Mesh;
	marker: THREE.Mesh;
	glow: THREE.Sprite;
	/** Thin lock-on reticle around the ping. */
	lock: THREE.Mesh;
	mats: THREE.Material[];
	at: number;
}

interface SparkBurst {
	lines: THREE.LineSegments;
	pos: THREE.BufferAttribute;
	lineMat: THREE.LineBasicMaterial;
	flash: THREE.Sprite;
	flashMat: THREE.SpriteMaterial;
	/** Spark velocities in Three space (x, y, z per spark). */
	vel: Float32Array;
	count: number;
	kind: 'bounce' | 'stick' | 'beacon';
	at: number;
}

export type SparkKind = SparkBurst['kind'];

/** Tapered, angled blade profile in the XY plane, extruded thin along Z. */
function bladeGeometry(): THREE.BufferGeometry {
	const s = new THREE.Shape();
	const L = BLADE_LEN;
	s.moveTo(0, -1.15);
	s.lineTo(L * 0.62, -1.0);
	s.lineTo(L, 0.15); // tip, raised slightly: an angled clip point
	s.lineTo(L * 0.78, 0.95);
	s.lineTo(L * 0.2, 1.2);
	s.lineTo(0, 1.2);
	s.closePath();
	const g = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.18, bevelSize: 0.22, bevelSegments: 1, steps: 1 });
	g.translate(0, 0, -0.175);
	g.computeVertexNormals();
	return g;
}

/** Soft round glow texture for sprites. */
function glowTexture(): THREE.CanvasTexture | null {
	if (typeof document === 'undefined') return null;
	const c = document.createElement('canvas');
	c.width = c.height = 64;
	const ctx = c.getContext('2d');
	if (!ctx) return null;
	const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
	grad.addColorStop(0, 'rgba(255,255,255,1)');
	grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
	grad.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, 64, 64);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

export class InfectedRenderer {
	readonly group = new THREE.Group();
	// Shared geometries
	private box = new THREE.BoxGeometry(1, 1, 1);
	private blade = bladeGeometry();
	private pommel = new THREE.TorusGeometry(1.15, 0.32, 6, 12);
	private streakGeo: THREE.PlaneGeometry;
	private ringGeo = new THREE.RingGeometry(0.82, 1, 48);
	private haloGeo = new THREE.RingGeometry(0, 1, 40);
	private pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
	private markerGeo = new THREE.OctahedronGeometry(1, 0);
	private glowTex = glowTexture();
	// Shared knife materials
	private handleMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.85, metalness: 0.1 });
	private wrapMat = new THREE.MeshStandardMaterial({ color: 0x3b4034, roughness: 0.9, metalness: 0 });
	private guardMat = new THREE.MeshStandardMaterial({ color: 0x4a4e55, roughness: 0.45, metalness: 0.7 });
	// Dark gunmetal blade with a black spine and a bright edge: a clear silhouette on warm sand
	// and sky (a bright steel blade washes out there), the edge glints in shade.
	private steelMat = new THREE.MeshStandardMaterial({ color: 0x4a525c, roughness: 0.28, metalness: 0.9, emissive: 0x0c0f13 });
	private spineMat = new THREE.MeshBasicMaterial({ color: 0x101216 });
	private edgeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
	private streakMat = new THREE.MeshBasicMaterial({ color: 0xfff4dc, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
	private shadeMat = new THREE.MeshBasicMaterial({ color: 0x14171c, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
	private glintMat: THREE.SpriteMaterial;
	private ringMat = new THREE.MeshBasicMaterial({ color: 0x5cf2ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
	private haloMat = new THREE.MeshBasicMaterial({ color: 0xffc35a, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
	private knifeMats: THREE.Material[];
	private live = new Map<number, KnifeMesh>();
	private free: KnifeMesh[] = [];
	private seen = new Set<number>();
	private beacons: UavBeacon[] = [];
	private sparks: SparkBurst[] = [];
	private sparkFree: SparkBurst[] = [];
	private lockGeo = new THREE.RingGeometry(0.93, 1, 64);
	// Respawn beacons
	/** Holds the beacon roots (an Object3D, so knife-root queries on Groups stay unaffected). */
	private readonly rbLayer = new THREE.Object3D();
	private rbColumnGeo = new THREE.CylinderGeometry(0.2, 1, 1, 14, 1, true);
	private rbTipGeo = new THREE.OctahedronGeometry(1, 0);
	private rbBaseMat = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.8, metalness: 0.35 });
	private rbBandMat = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.55, metalness: 0.6 });
	private rbTubeMat = new THREE.MeshStandardMaterial({ color: 0xb08a4a, roughness: 0.35, metalness: 0.85 });
	private rbTipMat = new THREE.MeshBasicMaterial({ color: RB_FLARE, fog: false });
	private rbLedMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, fog: false });
	private rbGlowMat: THREE.SpriteMaterial;
	private rbHaloMat = new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
	private rbColumnMat = new THREE.MeshBasicMaterial({ color: 0xff6a30, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
	private rbTrimMat = new THREE.MeshBasicMaterial({ color: 0x3cf0c0, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
	private rbMarkerMat = new THREE.MeshBasicMaterial({ color: 0x5cffd2, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
	private rbMats: THREE.Material[];
	private rbLive = new Map<number, BeaconMesh>();
	private rbFree: BeaconMesh[] = [];
	private rbSeen = new Set<number>();
	private rbViewer: 'survivor' | 'infected' = 'survivor';
	/** Hit and kill feedback: corpses, infection bursts, bullet impacts (updated, cleared and disposed with this renderer). */
	readonly fx: InfectedFx;

	constructor(assets: HeldAssets) {
		this.fx = new InfectedFx(assets, this.glowTex);
		this.group.name = 'infected';
		// Streak: a tapered plane trailing behind the knife (local −X).
		this.streakGeo = new THREE.PlaneGeometry(1, 1);
		const p = this.streakGeo.getAttribute('position') as THREE.BufferAttribute;
		for (let i = 0; i < p.count; i++) {
			const x = p.getX(i) - 0.5; // −1..0: tail to head
			p.setX(i, x);
			p.setY(i, p.getY(i) * (x < -0.5 ? 0.25 : 1));
		}
		p.needsUpdate = true;
		this.glintMat = new THREE.SpriteMaterial({ map: this.glowTex, color: 0xfff1d0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
		this.rbGlowMat = new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff6a3a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
		this.rbMats = [this.rbBaseMat, this.rbBandMat, this.rbTubeMat, this.rbTipMat, this.rbLedMat, this.rbGlowMat, this.rbHaloMat, this.rbColumnMat, this.rbTrimMat, this.rbMarkerMat];
		this.rbLayer.name = 'respawn-beacons';
		this.group.add(this.rbLayer, this.fx.group);
		this.knifeMats = [this.handleMat, this.wrapMat, this.guardMat, this.steelMat, this.spineMat, this.edgeMat, this.streakMat, this.shadeMat, this.glintMat, this.ringMat, this.haloMat];
	}

	// ---------------------------------------------------------------------
	// Knives

	private part(g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.Mesh {
		const m = new THREE.Mesh(geo, mat);
		m.scale.set(sx, sy, sz);
		m.position.set(x, y, z);
		g.add(m);
		return m;
	}

	private create(): KnifeMesh {
		const model = new THREE.Group();
		// Pommel ring, handle with cord wraps, crossguard, blade with a bright edge bevel.
		this.part(model, this.pommel, this.guardMat, 1, 1, 1, -0.6, 0, 0);
		this.part(model, this.box, this.handleMat, HANDLE_LEN, 2, 1.2, HANDLE_LEN / 2, 0, 0);
		for (let i = 0; i < 4; i++) this.part(model, this.box, this.wrapMat, 0.7, 2.25, 1.4, 1.2 + i * 1.6, 0, 0);
		this.part(model, this.box, this.guardMat, 0.8, 4.6, 1.6, GUARD_X, 0, 0);
		const blade = new THREE.Mesh(this.blade, this.steelMat);
		blade.position.x = GUARD_X + 0.4;
		model.add(blade);
		this.part(model, this.box, this.edgeMat, BLADE_LEN * 0.6, 0.22, 0.95, GUARD_X + 0.4 + BLADE_LEN * 0.38, -1.08, 0);
		this.part(model, this.box, this.spineMat, BLADE_LEN * 0.7, 0.3, 0.9, GUARD_X + 0.4 + BLADE_LEN * 0.35, 1.25, 0);

		const spin = new THREE.Group();
		spin.add(model);
		const orient = new THREE.Group();
		orient.rotation.order = 'YZX';
		orient.add(spin);
		const streak = new THREE.Mesh(this.streakGeo, this.streakMat);
		streak.scale.set(46, 3.2, 1);
		streak.renderOrder = 2;
		const shade = new THREE.Mesh(this.streakGeo, this.shadeMat);
		shade.scale.set(52, 5.2, 1);
		shade.renderOrder = 1;
		orient.add(shade, streak);
		const glint = new THREE.Sprite(this.glintMat);
		glint.scale.setScalar(9);
		glint.renderOrder = 2;
		orient.add(glint);

		const root = new THREE.Group();
		root.add(orient);
		// Pickup indicator: flat ring and soft disc, kept horizontal.
		const pickRing = new THREE.Mesh(this.ringGeo, this.ringMat);
		pickRing.rotation.x = -Math.PI / 2;
		pickRing.renderOrder = 4;
		const halo = new THREE.Mesh(this.haloGeo, this.haloMat);
		halo.rotation.x = -Math.PI / 2;
		halo.renderOrder = 4;
		root.add(pickRing, halo);
		this.group.add(root);
		return { root, orient, spin, model, streak, shade, glint, ring: pickRing, halo, stuck: false, mine: false, phase: Math.random() * Math.PI * 2 };
	}

	private take(): KnifeMesh {
		const k = this.free.pop() ?? this.create();
		k.root.visible = true;
		return k;
	}

	private release(k: KnifeMesh): void {
		k.root.visible = false;
		this.free.push(k);
	}

	/** Draw the knives of this frame (ids not listed are removed). */
	syncKnives(knives: readonly KnifeRenderPose[], selfId: number, now: number): void {
		this.seen.clear();
		for (const p of knives) {
			this.seen.add(p.id);
			let k = this.live.get(p.id);
			if (!k) {
				k = this.take();
				this.live.set(p.id, k);
			}
			k.root.position.set(p.x, p.z, -p.y);
			k.stuck = p.stuck;
			k.mine = p.stuck && p.ownerId === selfId;
			if (p.stuck) {
				k.orient.rotation.set(0, p.yaw * DEG, -p.pitch * DEG);
				// Tip pushed into the surface along the impact direction.
				k.model.position.x = EMBED - KNIFE_LEN;
			} else {
				const h = Math.hypot(p.vx, p.vy);
				if (h > 1e-3 || Math.abs(p.vz) > 1e-3) k.orient.rotation.set(0, Math.atan2(p.vy, p.vx), Math.atan2(p.vz, h));
				// Spin around the knife's balance point.
				k.model.position.x = -KNIFE_LEN * 0.45;
			}
			k.streak.visible = !p.stuck;
			k.shade.visible = !p.stuck;
			k.glint.visible = !p.stuck;
			k.ring.visible = k.mine;
			k.halo.visible = k.mine;
		}
		for (const [id, k] of this.live) {
			if (this.seen.has(id)) continue;
			this.live.delete(id);
			this.release(k);
		}
		this.updateKnives(now);
	}

	private updateKnives(now: number): void {
		const pulse = 0.5 + 0.5 * Math.sin(now / 260);
		this.ringMat.opacity = 0.45 + 0.45 * pulse;
		this.ringMat.color.setHex(pulse > 0.5 ? 0x5cf2ff : 0x8ff7ff);
		this.haloMat.opacity = 0.1 + 0.14 * pulse;
		this.streakMat.opacity = 0.45 + 0.15 * Math.sin(now / 40);
		this.shadeMat.opacity = 0.36 + 0.08 * Math.sin(now / 40);
		for (const k of this.live.values()) {
			if (k.stuck) {
				k.spin.rotation.z = 0;
				if (k.mine) {
					const s = 15 + 4 * Math.sin(now / 260 + k.phase);
					k.ring.scale.set(s, s, 1);
					k.ring.position.y = 1 + Math.sin(now / 420 + k.phase) * 1.5;
					k.ring.rotation.z = now / 900;
					k.halo.scale.set(s * 0.95, s * 0.95, 1);
					k.halo.position.y = 0.6;
				}
			} else {
				k.spin.rotation.z = -now * SPIN;
				k.glint.material.rotation = now * 0.01;
				k.glint.scale.setScalar(8 + 3 * Math.abs(Math.sin(now * SPIN)));
			}
		}
	}

	// ---------------------------------------------------------------------
	// Respawn beacons

	private createBeacon(): BeaconMesh {
		const root = new THREE.Group();
		// Charcoal puck flush on the floor: two boxes 45° apart read as an octagon, a steel band on top.
		this.part(root, this.box, this.rbBaseMat, 14, RB_BASE_H, 14, 0, RB_BASE_H / 2, 0);
		this.part(root, this.box, this.rbBaseMat, 14, RB_BASE_H, 14, 0, RB_BASE_H / 2, 0).rotation.y = Math.PI / 4;
		this.part(root, this.box, this.rbBandMat, 10, 1, 10, 0, RB_BASE_H + 0.5, 0);
		this.part(root, this.box, this.rbLedMat, 1.4, 0.8, 1.4, 4.4, RB_BASE_H + 0.4, 0);
		// Angled brass flare tube with a burning chemical tip.
		const tube = this.part(root, this.box, this.rbTubeMat, 4, RB_TUBE_H, 4, RB_TIP_X / 2, RB_BASE_H + (Math.cos(RB_TILT) * RB_TUBE_H) / 2, 0);
		tube.rotation.z = -RB_TILT;
		const tip = this.part(root, this.rbTipGeo, this.rbTipMat, 2.6, 3.4, 2.6, RB_TIP_X, RB_TIP_Y, 0);
		const glow = new THREE.Sprite(this.rbGlowMat);
		glow.position.set(RB_TIP_X, RB_TIP_Y, 0);
		glow.scale.setScalar(14);
		glow.renderOrder = 3;
		root.add(glow);
		// Pulsing ground halo and a tapering, flickering glow column.
		const halo = this.part(root, this.ringGeo, this.rbHaloMat, 20, 20, 1, 0, 0.6, 0);
		halo.rotation.x = -Math.PI / 2;
		halo.renderOrder = 4;
		const column = this.part(root, this.rbColumnGeo, this.rbColumnMat, 3, RB_COLUMN_H, 3, RB_TIP_X, RB_TIP_Y + RB_COLUMN_H / 2, 0);
		column.renderOrder = 4;
		// Owner: an emerald trim ring and a marker seen through walls.
		const trim = this.part(root, this.ringGeo, this.rbTrimMat, 28, 28, 1, 0, 0.9, 0);
		trim.rotation.x = -Math.PI / 2;
		trim.renderOrder = 4;
		const marker = this.part(root, this.markerGeo, this.rbMarkerMat, 3.5, 5, 3.5, 0, RB_MARKER_Z, 0);
		marker.renderOrder = 8;
		this.rbLayer.add(root);
		return { root, tip, glow, halo, column, trim, marker, mine: false, phase: Math.random() * Math.PI * 2 };
	}

	/**
	 * Draw the planted respawn beacons (ids not listed are removed). Every
	 * beacon is depth tested (survivors hunt them by sight); the viewer's own
	 * (`selfId`: the local or spectated player) adds the trim ring and the
	 * through-wall marker. Survivors see enemy beacons pulse harder.
	 */
	syncBeacons(beacons: readonly BeaconRenderPose[], selfId: number, viewerTeam: 'survivor' | 'infected', now: number): void {
		this.rbSeen.clear();
		this.rbViewer = viewerTeam;
		for (const p of beacons) {
			this.rbSeen.add(p.id);
			let b = this.rbLive.get(p.id);
			if (!b) {
				b = this.rbFree.pop() ?? this.createBeacon();
				b.root.visible = true;
				this.rbLive.set(p.id, b);
			}
			b.root.position.set(p.x, p.z, -p.y);
			b.root.rotation.y = p.yaw * DEG;
			b.mine = p.ownerId === selfId;
			b.trim.visible = b.mine;
			b.marker.visible = b.mine;
		}
		for (const [id, b] of this.rbLive) {
			if (this.rbSeen.has(id)) continue;
			this.rbLive.delete(id);
			this.releaseBeacon(b);
		}
		this.updateRespawnBeacons(now);
	}

	private releaseBeacon(b: BeaconMesh): void {
		b.root.visible = false;
		this.rbFree.push(b);
	}

	private updateRespawnBeacons(now: number): void {
		if (this.rbLive.size === 0) return;
		const hunt = this.rbViewer === 'survivor';
		const pulse = 0.5 + 0.5 * Math.sin(now / (hunt ? 170 : 240));
		const flicker = 0.75 + 0.15 * Math.sin(now / 37) + 0.1 * Math.sin(now / 61 + 1.3);
		this.rbHaloMat.opacity = (hunt ? 0.35 : 0.25) + 0.35 * pulse;
		this.rbColumnMat.opacity = 0.16 + 0.1 * flicker;
		this.rbGlowMat.opacity = 0.7 + 0.3 * flicker;
		this.rbTrimMat.opacity = 0.45 + 0.35 * (1 - pulse);
		this.rbMarkerMat.opacity = 0.65 + 0.3 * pulse;
		this.rbLedMat.color.setHex(Math.floor(now / 400) % 2 === 0 ? 0xff2a1a : 0x401008);
		for (const b of this.rbLive.values()) {
			const s = 18 + 6 * (0.5 + 0.5 * Math.sin(now / 260 + b.phase));
			b.halo.scale.set(s, s, 1);
			b.column.scale.set(3 * flicker, RB_COLUMN_H * (0.92 + 0.08 * Math.sin(now / 90 + b.phase)), 3 * flicker);
			b.column.position.y = RB_TIP_Y + b.column.scale.y / 2;
			b.glow.scale.setScalar(12 + 4 * flicker);
			b.tip.scale.set(2.6 * flicker, 3.4 * flicker, 2.6 * flicker);
			if (b.mine) {
				b.trim.rotation.z = now / 1100;
				b.marker.rotation.y = now / 320;
				b.marker.position.y = RB_MARKER_Z + Math.sin(now / 300 + b.phase) * 1.5;
			}
		}
	}

	/** Live and pooled respawn beacon meshes (tests and debugging). */
	get beaconStats(): { live: number; pooled: number } {
		return { live: this.rbLive.size, pooled: this.rbFree.length };
	}

	// ---------------------------------------------------------------------
	// UAV pulse

	/** Radar pulse at a Source point, seen through walls for 3.2 s. */
	uavPulse(pos: { x: number; y: number; z: number }, now: number): void {
		const xray = { transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false } as const;
		const mats: THREE.Material[] = [];
		const root = new THREE.Group();
		root.position.set(pos.x, pos.z, -pos.y);
		const rings: THREE.Mesh[] = [];
		for (const color of [0xff3a3a, 0xffb347]) {
			const m = new THREE.MeshBasicMaterial({ color, opacity: 0, ...xray });
			mats.push(m);
			const r = new THREE.Mesh(this.ringGeo, m);
			r.rotation.x = -Math.PI / 2;
			r.position.y = 2;
			r.renderOrder = 6;
			rings.push(r);
			root.add(r);
		}
		const pm = new THREE.MeshBasicMaterial({ color: 0xff5a3a, opacity: 0, ...xray });
		mats.push(pm);
		const pillar = new THREE.Mesh(this.pillarGeo, pm);
		pillar.scale.set(6, 900, 6);
		pillar.position.y = 450;
		pillar.renderOrder = 6;
		const mm = new THREE.MeshBasicMaterial({ color: 0xffd27a, opacity: 0, ...xray });
		mats.push(mm);
		const marker = new THREE.Mesh(this.markerGeo, mm);
		marker.scale.set(5, 8, 5);
		marker.position.y = UAV_MARKER_Z;
		marker.renderOrder = 6;
		const gm = new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff4a2a, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
		mats.push(gm);
		const glow = new THREE.Sprite(gm);
		glow.scale.setScalar(40);
		glow.position.y = UAV_MARKER_Z;
		glow.renderOrder = 6;
		const lm = new THREE.MeshBasicMaterial({ color: 0xfff0e0, opacity: 0, ...xray });
		mats.push(lm);
		const lock = new THREE.Mesh(this.lockGeo, lm);
		lock.rotation.x = -Math.PI / 2;
		lock.position.y = 2.5;
		lock.renderOrder = 7;
		root.add(pillar, marker, glow, lock);
		this.group.add(root);
		this.beacons.push({ root, rings, pillar, marker, glow, lock, mats, at: now });
		this.updateBeacons(now);
	}

	private disposeBeacon(b: UavBeacon): void {
		b.root.removeFromParent();
		for (const m of b.mats) m.dispose();
	}

	private updateBeacons(now: number): void {
		for (let i = this.beacons.length - 1; i >= 0; i--) {
			const b = this.beacons[i]!;
			const t = now - b.at;
			if (t >= UAV_MS) {
				this.disposeBeacon(b);
				this.beacons.splice(i, 1);
				continue;
			}
			const f = Math.max(0, t / UAV_MS);
			const fadeIn = Math.min(1, t / 140);
			const fadeOut = 1 - Math.max(0, (f - 0.55) / 0.45);
			const life = fadeIn * fadeOut * fadeOut;
			// Two sweeps, the second trailing the first.
			for (let r = 0; r < b.rings.length; r++) {
				const ring = b.rings[r]!;
				const local = Math.max(0, Math.min(1, (t - r * 450) / (UAV_MS - 900)));
				const ease = 1 - (1 - local) * (1 - local) * (1 - local);
				const s = 16 + ease * UAV_RADIUS;
				ring.scale.set(s, s, 1);
				ring.visible = t >= r * 450;
				(ring.material as THREE.MeshBasicMaterial).opacity = (r === 0 ? 0.85 : 0.6) * (1 - local) * fadeIn;
			}
			(b.pillar.material as THREE.MeshBasicMaterial).opacity = 0.22 * life * (0.75 + 0.25 * Math.sin(t / 90));
			const beat = 0.5 + 0.5 * Math.sin(t / 110);
			(b.marker.material as THREE.MeshBasicMaterial).opacity = 0.95 * life;
			b.marker.rotation.y = t / 260;
			b.marker.position.y = UAV_MARKER_Z + Math.sin(t / 300) * 2;
			b.marker.scale.set(5 + beat * 1.5, 8 + beat * 2, 5 + beat * 1.5);
			b.glow.material.opacity = (0.45 + 0.35 * beat) * life;
			b.glow.position.y = b.marker.position.y;
			// Lock-on reticle: snaps in from wide, then holds tight around the ping.
			const snap = Math.min(1, t / 260);
			const ls = 34 + (1 - snap) * (1 - snap) * 90;
			b.lock.scale.set(ls, ls, 1);
			b.lock.rotation.z = -t / 700;
			(b.lock.material as THREE.MeshBasicMaterial).opacity = 0.9 * life * (0.8 + 0.2 * beat);
		}
	}

	/** Live UAV beacons. */
	get beaconCount(): number {
		return this.beacons.length;
	}

	// ---------------------------------------------------------------------
	// Impact sparks

	private makeBurst(): SparkBurst {
		const n = Math.max(SPARKS_BOUNCE, SPARKS_STICK, SPARKS_BEACON);
		const geo = new THREE.BufferGeometry();
		const pos = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
		pos.setUsage(THREE.DynamicDrawUsage);
		geo.setAttribute('position', pos);
		const lineMat = new THREE.LineBasicMaterial({ color: 0xffd890, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
		const lines = new THREE.LineSegments(geo, lineMat);
		lines.frustumCulled = false;
		lines.renderOrder = 3;
		const flashMat = new THREE.SpriteMaterial({ map: this.glowTex, color: 0xfff6e0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
		const flash = new THREE.Sprite(flashMat);
		flash.renderOrder = 3;
		lines.add(flash);
		this.group.add(lines);
		return { lines, pos, lineMat, flash, flashMat, vel: new Float32Array(n * 3), count: 0, kind: 'stick', at: 0 };
	}

	/**
	 * Metal sparks where a knife hit a surface: a wide burst on a bounce, a
	 * tight glint on a stick. `dir` (Source, any length) biases the spray: the
	 * new velocity of a bounce, or the flight direction of a stuck knife.
	 * 'beacon': a 12-spark crimson-orange flare burst (beacon smashed or used),
	 * sprayed upward unless `dir` is given.
	 */
	spark(pos: { x: number; y: number; z: number }, kind: SparkKind, now: number, dir?: { x: number; y: number; z: number }): void {
		let b = this.sparkFree.pop();
		if (!b) b = this.sparks.length >= SPARK_POOL ? this.sparks.shift()! : this.makeBurst();
		b.kind = kind;
		b.at = now;
		b.count = kind === 'bounce' ? SPARKS_BOUNCE : kind === 'beacon' ? SPARKS_BEACON : SPARKS_STICK;
		b.lines.visible = true;
		b.lines.position.set(pos.x, pos.z, -pos.y);
		b.lineMat.color.setHex(kind === 'bounce' ? 0xffc874 : kind === 'beacon' ? 0xff5a2a : 0xfff0d0);
		b.flashMat.color.setHex(kind === 'beacon' ? 0xff7a3a : 0xfff6e0);
		// Spray direction in Three space (up when unknown; back out of the surface on a stick).
		let dx = 0;
		let dy = 1;
		let dz = 0;
		if (dir) {
			const l = Math.hypot(dir.x, dir.y, dir.z);
			if (l > 1e-6) {
				const sgn = kind === 'stick' ? -1 : 1;
				dx = (sgn * dir.x) / l;
				dy = (sgn * dir.z) / l;
				dz = (sgn * -dir.y) / l;
			}
		}
		const speed = kind === 'bounce' ? 420 : kind === 'beacon' ? 380 : 260;
		const cone = kind === 'bounce' ? 0.9 : kind === 'beacon' ? 1.05 : 0.55;
		for (let i = 0; i < b.count; i++) {
			let vx = dx + (Math.random() * 2 - 1) * cone;
			let vy = dy + (Math.random() * 2 - 1) * cone + 0.25;
			let vz = dz + (Math.random() * 2 - 1) * cone;
			const l = Math.hypot(vx, vy, vz) || 1;
			const sp = speed * (0.6 + 0.4 * Math.random());
			vx = (vx / l) * sp;
			vy = (vy / l) * sp;
			vz = (vz / l) * sp;
			b.vel[i * 3] = vx;
			b.vel[i * 3 + 1] = vy;
			b.vel[i * 3 + 2] = vz;
		}
		b.lines.geometry.setDrawRange(0, b.count * 2);
		this.sparks.push(b);
		this.updateSparks(now);
	}

	private releaseBurst(b: SparkBurst): void {
		b.lines.visible = false;
		this.sparkFree.push(b);
	}

	private updateSparks(now: number): void {
		for (let i = this.sparks.length - 1; i >= 0; i--) {
			const b = this.sparks[i]!;
			// Events are stamped with performance.now(), frames with the (slightly older) rAF time.
			const t = Math.max(0, now - b.at);
			const ms = b.kind === 'beacon' ? SPARK_BEACON_MS : SPARK_MS;
			if (t >= ms) {
				this.sparks.splice(i, 1);
				this.releaseBurst(b);
				continue;
			}
			const sec = t / 1000;
			const life = 1 - t / ms;
			const tl = SPARK_TRAIL * (0.4 + 0.6 * life);
			for (let j = 0; j < b.count; j++) {
				const vx = b.vel[j * 3]!;
				const vy = b.vel[j * 3 + 1]!;
				const vz = b.vel[j * 3 + 2]!;
				// Head: ballistic; tail: a short streak behind it along the current velocity.
				const hx = vx * sec;
				const hy = vy * sec - 0.5 * SPARK_GRAVITY * sec * sec;
				const hz = vz * sec;
				const cvy = vy - SPARK_GRAVITY * sec;
				b.pos.setXYZ(j * 2, hx, hy, hz);
				b.pos.setXYZ(j * 2 + 1, hx - vx * tl, hy - cvy * tl, hz - vz * tl);
			}
			b.pos.needsUpdate = true;
			b.lineMat.opacity = Math.min(1, life * 1.6);
			const f = Math.max(0, 1 - t / (ms * 0.55));
			b.flash.visible = f > 0;
			b.flash.scale.setScalar((b.kind === 'bounce' ? 14 : b.kind === 'beacon' ? 30 : 8) * (0.6 + 0.4 * f));
			b.flashMat.opacity = f;
		}
	}

	/** Live spark bursts. */
	get sparkCount(): number {
		return this.sparks.length;
	}

	/** Live and pooled knife meshes (tests and debugging). */
	get knifeStats(): { live: number; pooled: number } {
		return { live: this.live.size, pooled: this.free.length };
	}

	// ---------------------------------------------------------------------

	/** Knife spin, pickup ring pulse, respawn beacon flicker, UAV sweeps. */
	update(now: number): void {
		this.updateKnives(now);
		this.updateRespawnBeacons(now);
		this.updateBeacons(now);
		this.updateSparks(now);
		this.fx.update(now);
	}

	/** Round reset or map change. */
	clear(): void {
		for (const k of this.live.values()) this.release(k);
		this.live.clear();
		for (const b of this.rbLive.values()) this.releaseBeacon(b);
		this.rbLive.clear();
		for (const b of this.beacons) this.disposeBeacon(b);
		this.beacons = [];
		for (const b of this.sparks) this.releaseBurst(b);
		this.sparks = [];
		this.fx.clear();
	}

	dispose(): void {
		this.clear();
		this.fx.dispose();
		for (const k of this.free) k.root.removeFromParent();
		this.free = [];
		for (const b of this.rbFree) b.root.removeFromParent();
		this.rbFree = [];
		this.rbLayer.removeFromParent();
		for (const b of this.sparkFree) {
			b.lines.removeFromParent();
			b.lines.geometry.dispose();
			b.lineMat.dispose();
			b.flashMat.dispose();
		}
		this.sparkFree = [];
		for (const m of this.knifeMats) m.dispose();
		for (const m of this.rbMats) m.dispose();
		for (const g of [this.rbColumnGeo, this.rbTipGeo, this.box, this.blade, this.pommel, this.streakGeo, this.ringGeo, this.haloGeo, this.pillarGeo, this.markerGeo, this.lockGeo]) g.dispose();
		this.glowTex?.dispose();
		this.group.removeFromParent();
	}
}
