/**
 * The cash bag of hide and seek (docs/economy.md#hide-and-seek): a procedural
 * canvas sack stuffed with banknotes and coins that bobs and spins above its
 * spot, with a soft light shaft and a ground ring so it is found from far away.
 * Everything is depth tested: it is never seen through walls. Taking it throws
 * a burst of coins. Positions are Source points.
 */
import type { Vec3 } from '@surf/shared';
import * as THREE from 'three';
import { setThree } from './coords.js';

/** Bob height (units) and speeds (radians per ms). */
export const BAG_BOB = 4;
const BOB_RATE = 0.0021;
const SPIN_RATE = 0.0009;
/** Lowest height of the sack's bottom above its floor point. */
export const BAG_HOVER = 10;
const SHAFT_H = 150;
/** Pickup burst: lifetime (ms), coins, gravity. */
export const BAG_BURST_MS = 900;
const BURST_COINS = 18;
const BURST_GRAVITY = 520;

const SACK_PROFILE: Array<[number, number]> = [
	[0, 0],
	[11, 0.4],
	[15.5, 3],
	[18, 9],
	[18, 15],
	[15.5, 21],
	[11, 25.5],
	[6.8, 28.2],
	[5.8, 30],
	[8.2, 33],
	[11.5, 36.5],
	[10.4, 36.2],
	[6.4, 32.6],
	[0, 31.6]
];

export class CashBagRenderer {
	readonly group = new THREE.Group();
	private readonly root = new THREE.Group();
	private readonly model = new THREE.Group();
	private readonly geos: THREE.BufferGeometry[] = [];
	private readonly mats: THREE.Material[] = [];
	private readonly shaft: THREE.Mesh;
	private readonly ring: THREE.Mesh;
	private readonly shaftMat: THREE.MeshBasicMaterial;
	private readonly ringMat: THREE.MeshBasicMaterial;
	private readonly coins: THREE.InstancedMesh;
	private readonly vel = new Float32Array(BURST_COINS * 3);
	private readonly tmp = new THREE.Object3D();
	private readonly burstAt = new THREE.Vector3();
	private burstStart = -Infinity;

	constructor() {
		this.group.name = 'cash-bag';
		const mat = <T extends THREE.Material>(m: T): T => {
			this.mats.push(m);
			return m;
		};
		const geo = <T extends THREE.BufferGeometry>(g: T): T => {
			this.geos.push(g);
			return g;
		};
		const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
			const mesh = new THREE.Mesh(g, m);
			mesh.position.set(x, y, z);
			parent.add(mesh);
			return mesh;
		};
		const canvas = mat(new THREE.MeshStandardMaterial({ color: 0xb9854a, roughness: 0.95, metalness: 0, flatShading: true, emissive: 0x3a2408, emissiveIntensity: 0.5 }));
		const patch = mat(new THREE.MeshStandardMaterial({ color: 0x8a5a2c, roughness: 0.95, metalness: 0, emissive: 0x241405 }));
		const rope = mat(new THREE.MeshStandardMaterial({ color: 0x5c2f1a, roughness: 0.9, metalness: 0 }));
		const gold = mat(new THREE.MeshStandardMaterial({ color: 0xffc832, roughness: 0.3, metalness: 0.65, emissive: 0x9a6400, emissiveIntensity: 0.75 }));
		const note = mat(new THREE.MeshStandardMaterial({ color: 0x4fae5c, roughness: 0.85, metalness: 0, emissive: 0x0f3a18 }));
		const paper = mat(new THREE.MeshStandardMaterial({ color: 0xe9f2d8, roughness: 0.9, metalness: 0 }));

		// Sack: a lathe with few sides and a slight crease per side reads as folded canvas.
		const sack = geo(new THREE.LatheGeometry(SACK_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 14));
		const p = sack.getAttribute('position') as THREE.BufferAttribute;
		for (let i = 0; i < p.count; i++) {
			const a = Math.atan2(p.getZ(i), p.getX(i));
			const k = 1 + 0.045 * Math.cos(a * 7) + 0.03 * Math.sin(a * 3 + p.getY(i) * 0.3);
			p.setX(i, p.getX(i) * k);
			p.setZ(i, p.getZ(i) * k);
		}
		sack.computeVertexNormals();
		add(this.model, sack, canvas, 0, 0, 0);
		// Rope round the neck with two loose ends.
		const tie = add(this.model, geo(new THREE.TorusGeometry(6.6, 1.1, 6, 18)), rope, 0, 29.4, 0);
		tie.rotation.x = Math.PI / 2;
		const end = geo(new THREE.CylinderGeometry(0.7, 0.9, 8, 6));
		add(this.model, end, rope, 6.6, 26, 2.4).rotation.set(0.25, 0, 0.35);
		add(this.model, end, rope, 6.2, 26, -2.6).rotation.set(-0.3, 0, 0.3);
		// Emblem on both sides: a coin sewn onto a darker patch.
		const disc = geo(new THREE.CylinderGeometry(7.4, 7.4, 1, 24));
		const coinFace = geo(new THREE.CylinderGeometry(5.4, 5.4, 1.4, 24));
		const coinRim = geo(new THREE.TorusGeometry(4.2, 0.55, 6, 24));
		for (const side of [1, -1]) {
			const g = new THREE.Group();
			g.position.set(0, 12.5, side * 17.6);
			add(g, disc, patch, 0, 0, 0).rotation.x = Math.PI / 2;
			add(g, coinFace, gold, 0, 0, side * 0.6).rotation.x = Math.PI / 2;
			add(g, coinRim, patch, 0, 0, side * 1.4);
			this.model.add(g);
		}
		// Banknotes sticking out of the mouth: bundles with a paper band.
		const bundle = geo(new THREE.BoxGeometry(9, 15, 2.6));
		const band = geo(new THREE.BoxGeometry(9.3, 3, 2.9));
		for (const [x, z, ry, rz, y] of [
			[-3.4, 2.4, 0.4, 0.24, 39],
			[3.6, 1.4, -0.5, -0.28, 38],
			[0.2, -4, 2.8, 0.06, 40]
		] as const) {
			const g = new THREE.Group();
			g.position.set(x, y, z);
			g.rotation.set(0, ry, rz);
			add(g, bundle, note, 0, 0, 0);
			add(g, band, paper, 0, 2.2, 0);
			this.model.add(g);
		}
		// A few coins on top.
		const coin = geo(new THREE.CylinderGeometry(3.4, 3.4, 1, 16));
		for (const [x, y, z, rx, rz] of [
			[7, 37, 5, 0.5, 0.9],
			[-7.5, 37, -3.5, 1.1, -0.5],
			[-1, 37.5, 7.5, 1.2, 0.2],
			[6, 37.4, -5.5, -0.9, 0.6]
		] as const)
			add(this.model, coin, gold, x, y, z).rotation.set(rx, 0, rz);

		// Light shaft (open cylinder fading upwards, only its far side so it never veils the sack) and ground ring.
		const shaft = geo(new THREE.CylinderGeometry(10, 22, SHAFT_H, 28, 1, true));
		const colors = new Float32Array(shaft.getAttribute('position').count * 4);
		const sp = shaft.getAttribute('position');
		for (let i = 0; i < sp.count; i++) colors.set([1, 1, 1, sp.getY(i) < 0 ? 1 : 0], i * 4);
		shaft.setAttribute('color', new THREE.BufferAttribute(colors, 4));
		this.shaftMat = mat(new THREE.MeshBasicMaterial({ color: 0xffb21e, transparent: true, opacity: 0.4, vertexColors: true, depthWrite: false, side: THREE.BackSide, fog: false }));
		this.shaft = add(this.root, shaft, this.shaftMat, 0, SHAFT_H / 2 + 1, 0);
		this.shaft.renderOrder = 4;
		this.ringMat = mat(new THREE.MeshBasicMaterial({ color: 0xffa800, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: false }));
		this.ring = add(this.root, geo(new THREE.RingGeometry(26, 31, 40)), this.ringMat, 0, 1.2, 0);
		this.ring.rotation.x = -Math.PI / 2;
		this.ring.renderOrder = 3;
		this.root.add(this.model);
		this.root.visible = false;

		this.coins = new THREE.InstancedMesh(coin, gold, BURST_COINS);
		this.coins.frustumCulled = false;
		this.coins.visible = false;
		this.group.add(this.root, this.coins);
	}

	/** Show the bag above a floor point, or hide it. */
	place(pos: Vec3 | null): void {
		this.root.visible = pos !== null;
		if (pos) setThree(this.root.position, pos.x, pos.y, pos.z);
	}

	get shown(): boolean {
		return this.root.visible;
	}

	/** Coins fly up from the spot where the bag was. */
	burst(pos: Vec3, now: number): void {
		setThree(this.burstAt, pos.x, pos.y, pos.z + BAG_HOVER + 20);
		this.burstStart = now;
		for (let i = 0; i < BURST_COINS; i++) {
			const a = (i / BURST_COINS) * Math.PI * 2 + (i % 3) * 0.4;
			const out = 50 + (i % 5) * 22;
			this.vel[i * 3] = Math.cos(a) * out;
			this.vel[i * 3 + 1] = 190 + (i % 4) * 45;
			this.vel[i * 3 + 2] = Math.sin(a) * out;
		}
		this.coins.visible = true;
	}

	update(now: number): void {
		if (this.root.visible) {
			this.model.position.y = BAG_HOVER + BAG_BOB * (1 + Math.sin(now * BOB_RATE));
			this.model.rotation.y = now * SPIN_RATE;
			const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
			this.ringMat.opacity = 0.55 + 0.35 * pulse;
			this.ring.scale.setScalar(1 + 0.06 * pulse);
			this.shaftMat.opacity = 0.5 + 0.18 * pulse;
		}
		if (!this.coins.visible) return;
		const t = now - this.burstStart;
		if (t >= BAG_BURST_MS || t < 0) {
			this.coins.visible = false;
			return;
		}
		const s = t / 1000;
		const size = Math.min(1, (BAG_BURST_MS - t) / 300);
		for (let i = 0; i < BURST_COINS; i++) {
			this.tmp.position.set(
				this.burstAt.x + this.vel[i * 3]! * s,
				this.burstAt.y + this.vel[i * 3 + 1]! * s - 0.5 * BURST_GRAVITY * s * s,
				this.burstAt.z + this.vel[i * 3 + 2]! * s
			);
			this.tmp.rotation.set(t * 0.011 + i, i, t * 0.008);
			this.tmp.scale.setScalar(size);
			this.tmp.updateMatrix();
			this.coins.setMatrixAt(i, this.tmp.matrix);
		}
		this.coins.instanceMatrix.needsUpdate = true;
	}

	clear(): void {
		this.root.visible = false;
		this.coins.visible = false;
	}

	dispose(): void {
		this.clear();
		for (const g of this.geos) g.dispose();
		for (const m of this.mats) m.dispose();
		this.coins.dispose();
		this.group.removeFromParent();
	}
}
