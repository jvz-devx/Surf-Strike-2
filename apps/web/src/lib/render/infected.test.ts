/**
 * InfectedRenderer in node (no canvas: the glow texture is null): knife
 * pooling and poses, the owner-only pickup ring, impact sparks, UAV beacons,
 * and that clear/dispose leave nothing behind.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
	InfectedRenderer,
	RB_MARKER_Z,
	SPARK_BEACON_MS,
	SPARK_MS,
	SPARKS_BEACON,
	SPARKS_BOUNCE,
	SPARKS_STICK,
	type BeaconRenderPose,
	type KnifeRenderPose
} from './infected.js';
import { HeldAssets } from './character/held.js';
import { ZombieRenderer } from './zombies.js';

const DEG = Math.PI / 180;

const knife = (id: number, over: Partial<KnifeRenderPose> = {}): KnifeRenderPose => ({
	id,
	ownerId: 1,
	x: 10,
	y: 20,
	z: 30,
	vx: 600,
	vy: 600,
	vz: 0,
	pitch: 0,
	yaw: 0,
	stuck: false,
	...over
});

/** Knife roots are the Groups directly under the renderer group: [orient, ring, halo]. */
function knifeParts(root: THREE.Object3D) {
	const [orient, ring, halo] = root.children as [THREE.Group, THREE.Mesh, THREE.Mesh];
	const [spin, shade, streak, glint] = orient.children as [THREE.Group, THREE.Mesh, THREE.Mesh, THREE.Sprite];
	return { orient, ring, halo, spin, shade, streak, glint };
}

const roots = (r: InfectedRenderer) => r.group.children.filter((c) => c.type === 'Group');
const visibleRoots = (r: InfectedRenderer) => roots(r).filter((c) => c.visible);
const sparkLines = (r: InfectedRenderer) => r.group.children.filter((c): c is THREE.LineSegments => c instanceof THREE.LineSegments);

describe('knives', () => {
	it('pools meshes: removed knives are hidden and reused, not rebuilt', () => {
		const r = new InfectedRenderer();
		r.syncKnives([knife(1), knife(2)], 9, 0);
		expect(r.knifeStats).toEqual({ live: 2, pooled: 0 });
		expect(visibleRoots(r)).toHaveLength(2);
		r.syncKnives([knife(1)], 9, 16);
		expect(r.knifeStats).toEqual({ live: 1, pooled: 1 });
		expect(visibleRoots(r)).toHaveLength(1);
		const before = r.group.children.length;
		r.syncKnives([knife(1), knife(3)], 9, 32);
		expect(r.knifeStats).toEqual({ live: 2, pooled: 0 });
		expect(r.group.children.length).toBe(before);
		r.syncKnives([], 9, 48);
		expect(r.knifeStats).toEqual({ live: 0, pooled: 2 });
		expect(visibleRoots(r)).toHaveLength(0);
		r.dispose();
	});

	it('flying: Source → Three position, faces its velocity, spins end over end, streaks on', () => {
		const r = new InfectedRenderer();
		r.syncKnives([knife(1, { vx: 300, vy: 300, vz: 300 * Math.SQRT2 })], 9, 100);
		const root = visibleRoots(r)[0]!;
		expect(root.position.toArray()).toEqual([10, 30, -20]);
		const p = knifeParts(root);
		expect(p.orient.rotation.y).toBeCloseTo(45 * DEG, 6);
		expect(p.orient.rotation.z).toBeCloseTo(45 * DEG, 6);
		expect(p.spin.rotation.z).toBeCloseTo(-100 * 0.025, 6);
		r.update(200);
		expect(p.spin.rotation.z).toBeCloseTo(-200 * 0.025, 6);
		expect([p.streak.visible, p.shade.visible, p.glint.visible]).toEqual([true, true, true]);
		expect([p.ring.visible, p.halo.visible]).toEqual([false, false]);
		// The dark shade streak draws under the bright additive one (contrast on sand and sky).
		const shadeMat = p.shade.material as THREE.MeshBasicMaterial;
		const streakMat = p.streak.material as THREE.MeshBasicMaterial;
		expect(shadeMat.blending).toBe(THREE.NormalBlending);
		expect(streakMat.blending).toBe(THREE.AdditiveBlending);
		expect(p.shade.renderOrder).toBeLessThan(p.streak.renderOrder);
		expect(shadeMat.color.getHex()).toBeLessThan(0x303030);
		r.dispose();
	});

	it('zero velocity keeps the last flight direction', () => {
		const r = new InfectedRenderer();
		r.syncKnives([knife(1, { vx: 0, vy: 500, vz: 0 })], 9, 0);
		const p = knifeParts(visibleRoots(r)[0]!);
		expect(p.orient.rotation.y).toBeCloseTo(90 * DEG, 6);
		r.syncKnives([knife(1, { vx: 0, vy: 0, vz: 0 })], 9, 16);
		expect(p.orient.rotation.y).toBeCloseTo(90 * DEG, 6);
		r.dispose();
	});

	it('stuck: impact angles, no spin or streak, pickup ring only for its owner', () => {
		const r = new InfectedRenderer();
		const stuck = knife(1, { ownerId: 4, stuck: true, pitch: 30, yaw: 120, vx: 0, vy: 0 });
		r.syncKnives([stuck, knife(2, { ownerId: 5, stuck: true })], 4, 500);
		const [mine, theirs] = visibleRoots(r).map(knifeParts) as [ReturnType<typeof knifeParts>, ReturnType<typeof knifeParts>];
		expect(mine.orient.rotation.y).toBeCloseTo(120 * DEG, 6);
		expect(mine.orient.rotation.z).toBeCloseTo(-30 * DEG, 6);
		expect(mine.spin.rotation.z).toBe(0);
		expect([mine.streak.visible, mine.shade.visible, mine.glint.visible]).toEqual([false, false, false]);
		expect([mine.ring.visible, mine.halo.visible]).toEqual([true, true]);
		expect([theirs.ring.visible, theirs.halo.visible]).toEqual([false, false]);
		// The ring pulses (scale changes over time).
		const s0 = mine.ring.scale.x;
		r.update(500 + 400);
		expect(mine.ring.scale.x).not.toBeCloseTo(s0, 3);
		// Viewed by player 5 instead: the rings swap.
		r.syncKnives([stuck, knife(2, { ownerId: 5, stuck: true })], 5, 1000);
		expect(mine.ring.visible).toBe(false);
		expect(theirs.ring.visible).toBe(true);
		// A reused mesh from a stuck knife flies again with its streak and no ring.
		r.syncKnives([], 5, 1100);
		r.syncKnives([knife(3)], 5, 1200);
		const again = knifeParts(visibleRoots(r)[0]!);
		expect([again.streak.visible, again.ring.visible]).toEqual([true, false]);
		r.dispose();
	});
});

describe('sparks', () => {
	it('bounce: a wide burst that flies out, fades and expires after SPARK_MS', () => {
		const r = new InfectedRenderer();
		r.spark({ x: 100, y: 200, z: 50 }, 'bounce', 1000, { x: 0, y: 0, z: 1 });
		expect(r.sparkCount).toBe(1);
		const [lines] = sparkLines(r);
		expect(lines!.visible).toBe(true);
		expect(lines!.position.toArray()).toEqual([100, 50, -200]);
		expect(lines!.geometry.drawRange.count).toBe(SPARKS_BOUNCE * 2);
		const mat = lines!.material as THREE.LineBasicMaterial;
		expect(mat.blending).toBe(THREE.AdditiveBlending);
		r.update(1100);
		const pos = lines!.geometry.getAttribute('position') as THREE.BufferAttribute;
		let up = 0;
		for (let i = 0; i < SPARKS_BOUNCE; i++) {
			expect(Math.hypot(pos.getX(i * 2), pos.getY(i * 2), pos.getZ(i * 2))).toBeGreaterThan(5);
			if (pos.getY(i * 2) > 0) up++;
		}
		// Sprayed along the bounce direction (Source +z = Three +y).
		expect(up).toBeGreaterThan(SPARKS_BOUNCE / 2);
		expect(mat.opacity).toBeLessThan(1);
		r.update(1000 + SPARK_MS);
		expect(r.sparkCount).toBe(0);
		expect(lines!.visible).toBe(false);
		// A frame stamped slightly before the event (rAF time) keeps the burst alive.
		r.spark({ x: 0, y: 0, z: 0 }, 'stick', 5000);
		r.update(4997);
		expect(r.sparkCount).toBe(1);
		r.dispose();
	});

	it('stick: a tighter glint, fewer sparks; bursts are pooled and capped', () => {
		const r = new InfectedRenderer();
		r.spark({ x: 0, y: 0, z: 0 }, 'stick', 0, { x: 1, y: 0, z: 0 });
		expect(sparkLines(r)[0]!.geometry.drawRange.count).toBe(SPARKS_STICK * 2);
		r.update(SPARK_MS + 1);
		expect(r.sparkCount).toBe(0);
		r.spark({ x: 0, y: 0, z: 0 }, 'bounce', 500);
		expect(sparkLines(r)).toHaveLength(1); // the expired burst was reused
		for (let i = 0; i < 30; i++) r.spark({ x: i, y: 0, z: 0 }, i % 2 ? 'stick' : 'bounce', 600);
		expect(sparkLines(r).length).toBeLessThanOrEqual(12);
		expect(r.sparkCount).toBeLessThanOrEqual(12);
		r.dispose();
	});
});

describe('UAV beacon', () => {
	it('fades in, sweeps, and is removed with its materials disposed after 3.2 s', () => {
		const r = new InfectedRenderer();
		r.uavPulse({ x: 5, y: 6, z: 7 }, 1000);
		expect(r.beaconCount).toBe(1);
		const beacon = r.group.children.at(-1)!;
		expect(beacon.position.toArray()).toEqual([5, 7, -6]);
		const mats = new Set<THREE.Material>();
		beacon.traverse((o) => {
			const m = (o as THREE.Mesh).material as THREE.Material | undefined;
			if (m) mats.add(m);
		});
		// Two sweep rings, pillar, marker, glow, lock reticle; all x-ray (no depth test).
		expect(mats.size).toBe(6);
		for (const m of mats) expect(m.depthTest).toBe(false);
		let disposed = 0;
		for (const m of mats) m.addEventListener('dispose', () => void disposed++);
		const marker = beacon.children.find((c) => (c as THREE.Mesh).geometry instanceof THREE.OctahedronGeometry) as THREE.Mesh;
		r.update(1400);
		const mid = (marker.material as THREE.MeshBasicMaterial).opacity;
		expect(mid).toBeGreaterThan(0.5);
		r.update(1000 + 3000);
		expect((marker.material as THREE.MeshBasicMaterial).opacity).toBeLessThan(mid);
		expect(r.beaconCount).toBe(1);
		r.update(1000 + 3200);
		expect(r.beaconCount).toBe(0);
		expect(beacon.parent).toBeNull();
		expect(disposed).toBe(6);
		r.dispose();
	});
});

describe('clear and dispose', () => {
	it('clear: hides knives into the pool, removes beacons, stops sparks', () => {
		const r = new InfectedRenderer();
		r.syncKnives([knife(1), knife(2, { stuck: true })], 1, 0);
		r.uavPulse({ x: 0, y: 0, z: 0 }, 0);
		r.spark({ x: 0, y: 0, z: 0 }, 'bounce', 0);
		r.clear();
		expect(r.knifeStats).toEqual({ live: 0, pooled: 2 });
		expect(visibleRoots(r)).toHaveLength(0);
		expect(r.beaconCount).toBe(0);
		expect(r.sparkCount).toBe(0);
		expect(sparkLines(r).every((l) => !l.visible)).toBe(true);
		// Usable again after a clear.
		r.syncKnives([knife(5)], 1, 10);
		expect(r.knifeStats).toEqual({ live: 1, pooled: 1 });
		r.dispose();
	});

	it('dispose: every geometry and material is freed and the group is empty and detached', () => {
		const r = new InfectedRenderer();
		const scene = new THREE.Scene();
		scene.add(r.group);
		r.syncKnives([knife(1), knife(2, { stuck: true, ownerId: 3 })], 3, 0);
		r.syncKnives([knife(1)], 3, 10); // one knife pooled
		r.uavPulse({ x: 0, y: 0, z: 0 }, 0);
		r.spark({ x: 0, y: 0, z: 0 }, 'bounce', 0);
		r.spark({ x: 0, y: 0, z: 0 }, 'stick', 0);
		r.update(SPARK_MS + 5); // one round of sparks expires into the pool
		r.spark({ x: 0, y: 0, z: 0 }, 'stick', 300); // one live burst at dispose time
		const owned = new Set<THREE.Material | THREE.BufferGeometry>();
		r.group.traverse((o) => {
			const m = o as THREE.Mesh;
			if (m.material) owned.add(m.material as THREE.Material);
			if (m.geometry && !(o instanceof THREE.Sprite)) owned.add(m.geometry); // sprites share three's quad
		});
		expect(owned.size).toBeGreaterThan(15);
		const freed = new Set<unknown>();
		for (const x of owned) x.addEventListener('dispose', () => void freed.add(x));
		r.dispose();
		const leaked = [...owned].filter((x) => !freed.has(x)).map((x) => `${x.type}`);
		expect(leaked).toEqual([]);
		expect(r.group.parent).toBeNull();
		expect(r.group.children).toHaveLength(0);
		expect(r.beaconCount).toBe(0);
		expect(r.sparkCount).toBe(0);
	});
});

const beacon = (id: number, over: Partial<BeaconRenderPose> = {}): BeaconRenderPose => ({ id, ownerId: 2, x: 100, y: 200, z: 16, yaw: 90, ...over });
const beaconLayer = (r: InfectedRenderer) => r.group.children.find((c) => c.name === 'respawn-beacons')!;
const beaconRoots = (r: InfectedRenderer) => beaconLayer(r).children.filter((c) => c.visible);
const meshes = (o: THREE.Object3D) => o.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
const basic = (m: THREE.Mesh) => m.material as THREE.MeshBasicMaterial;

describe('respawn beacons', () => {
	it('pools meshes and keeps knife roots unaffected', () => {
		const r = new InfectedRenderer();
		r.syncBeacons([beacon(1), beacon(2)], 9, 'survivor', 0);
		expect(r.beaconStats).toEqual({ live: 2, pooled: 0 });
		expect(beaconRoots(r)).toHaveLength(2);
		expect(visibleRoots(r)).toHaveLength(0); // beacons are not knife roots
		r.syncBeacons([beacon(2)], 9, 'survivor', 16);
		expect(r.beaconStats).toEqual({ live: 1, pooled: 1 });
		const before = beaconLayer(r).children.length;
		r.syncBeacons([beacon(2), beacon(3)], 9, 'survivor', 32);
		expect(r.beaconStats).toEqual({ live: 2, pooled: 0 });
		expect(beaconLayer(r).children.length).toBe(before);
		r.syncBeacons([], 9, 'survivor', 48);
		expect(beaconRoots(r)).toHaveLength(0);
		r.dispose();
	});

	it('model: puck flush on the floor, angled brass tube, unfogged flare tip, halo and glow column', () => {
		const r = new InfectedRenderer();
		r.syncBeacons([beacon(1)], 9, 'survivor', 0);
		const root = beaconRoots(r)[0]!;
		// Source → Three position, yaw about +Y.
		expect(root.position.toArray()).toEqual([100, 16, -200]);
		expect(root.rotation.y).toBeCloseTo(90 * DEG, 6);
		const ms = meshes(root);
		const puck = ms.filter((m) => m.geometry instanceof THREE.BoxGeometry && m.scale.x === 14);
		expect(puck).toHaveLength(2);
		for (const m of puck) {
			expect(m.scale.toArray()).toEqual([14, 4, 14]);
			expect(m.position.y).toBe(2);
		}
		const tube = ms.find((m) => m.scale.x === 4 && m.scale.y === 12)!;
		expect(Math.abs(tube.rotation.z)).toBeGreaterThan(0.1);
		const tip = ms.find((m) => basic(m).color?.getHex() === 0xff4422 && m.geometry instanceof THREE.OctahedronGeometry)!;
		expect(basic(tip).fog).toBe(false);
		// The model spans roughly the server hit sphere (centre INF_BEACON_HIT_Z = 10 above the floor).
		expect(tip.position.y).toBeGreaterThan(14);
		expect(tip.position.y).toBeLessThan(22);
		const halo = ms.find((m) => m.geometry instanceof THREE.RingGeometry && basic(m).color.getHex() === 0xff5a2a)!;
		expect(basic(halo).depthWrite).toBe(false);
		const column = ms.find((m) => m.geometry instanceof THREE.CylinderGeometry)!;
		expect(basic(column).blending).toBe(THREE.AdditiveBlending);
		for (const t of [100, 400, 900, 1300]) {
			r.update(t);
			expect(halo.scale.x).toBeGreaterThanOrEqual(18);
			expect(halo.scale.x).toBeLessThanOrEqual(24);
			expect(column.scale.y).toBeGreaterThan(40);
			expect(column.scale.y).toBeLessThanOrEqual(48);
		}
		r.dispose();
	});

	it('owner: trim ring and a through-wall marker; enemy beacons are depth tested only', () => {
		const r = new InfectedRenderer();
		r.syncBeacons([beacon(1, { ownerId: 9 }), beacon(2, { ownerId: 4, x: 500 })], 9, 'infected', 0);
		const [mine, other] = beaconRoots(r) as [THREE.Group, THREE.Group];
		const marker = (g: THREE.Group) => meshes(g).find((m) => m.geometry instanceof THREE.OctahedronGeometry && m.position.y > 20)!;
		const trim = (g: THREE.Group) => meshes(g).find((m) => m.geometry instanceof THREE.RingGeometry && m.scale.x > 25)!;
		expect(marker(mine).visible).toBe(true);
		expect(trim(mine).visible).toBe(true);
		expect(basic(marker(mine)).depthTest).toBe(false);
		expect(Math.abs(marker(mine).position.y - RB_MARKER_Z)).toBeLessThanOrEqual(1.5); // bobs around it
		expect(marker(other).visible).toBe(false);
		expect(trim(other).visible).toBe(false);
		const shown: THREE.Material[] = [];
		other.traverseVisible((o) => {
			const m = (o as THREE.Mesh).material as THREE.Material | undefined;
			if (m) shown.push(m);
		});
		expect(shown.length).toBeGreaterThan(5);
		for (const m of shown) expect(m.depthTest).toBe(true);
		// Ownership follows the viewer (spectating someone else flips it).
		r.syncBeacons([beacon(1, { ownerId: 9 }), beacon(2, { ownerId: 4, x: 500 })], 4, 'infected', 16);
		expect(marker(mine).visible).toBe(false);
		expect(marker(other).visible).toBe(true);
		r.dispose();
	});

	it("'beacon' sparks: a 12-spark crimson flare burst that outlives knife sparks", () => {
		const r = new InfectedRenderer();
		r.spark({ x: 1, y: 2, z: 13 }, 'beacon', 1000);
		const [lines] = sparkLines(r);
		expect(lines!.geometry.drawRange.count).toBe(SPARKS_BEACON * 2);
		expect(SPARKS_BEACON).toBe(12);
		expect(lines!.position.toArray()).toEqual([1, 13, -2]);
		expect((lines!.material as THREE.LineBasicMaterial).color.getHex()).toBe(0xff5a2a);
		r.update(1000 + SPARK_MS + 10);
		expect(r.sparkCount).toBe(1);
		const pos = lines!.geometry.getAttribute('position') as THREE.BufferAttribute;
		let moved = 0;
		for (let i = 0; i < SPARKS_BEACON; i++) if (Math.hypot(pos.getX(i * 2), pos.getY(i * 2), pos.getZ(i * 2)) > 5) moved++;
		expect(moved).toBe(SPARKS_BEACON);
		r.update(1000 + SPARK_BEACON_MS);
		expect(r.sparkCount).toBe(0);
		// A reused burst goes back to knife colours and counts.
		r.spark({ x: 0, y: 0, z: 0 }, 'stick', 2000);
		expect(sparkLines(r)).toHaveLength(1);
		expect(lines!.geometry.drawRange.count).toBe(SPARKS_STICK * 2);
		expect((lines!.material as THREE.LineBasicMaterial).color.getHex()).not.toBe(0xff5a2a);
		r.dispose();
	});

	it('clear pools every beacon; dispose frees all beacon geometry and materials', () => {
		const r = new InfectedRenderer();
		const scene = new THREE.Scene();
		scene.add(r.group);
		r.syncBeacons([beacon(1, { ownerId: 9 }), beacon(2)], 9, 'survivor', 0);
		r.clear();
		expect(r.beaconStats).toEqual({ live: 0, pooled: 2 });
		expect(beaconRoots(r)).toHaveLength(0);
		r.syncBeacons([beacon(3)], 9, 'survivor', 10); // reused after a clear
		expect(r.beaconStats).toEqual({ live: 1, pooled: 1 });
		r.spark({ x: 0, y: 0, z: 0 }, 'beacon', 10);
		const owned = new Set<THREE.Material | THREE.BufferGeometry>();
		r.group.traverse((o) => {
			const m = o as THREE.Mesh;
			if (m.material) owned.add(m.material as THREE.Material);
			if (m.geometry && !(o instanceof THREE.Sprite)) owned.add(m.geometry);
		});
		const freed = new Set<unknown>();
		for (const x of owned) x.addEventListener('dispose', () => void freed.add(x));
		r.dispose();
		expect([...owned].filter((x) => !freed.has(x)).map((x) => x.type)).toEqual([]);
		expect(r.group.children).toHaveLength(0);
		expect(r.group.parent).toBeNull();
		expect(r.beaconStats).toEqual({ live: 0, pooled: 0 });
	});
});

describe('claws viewmodel off-hand knife (ZombieRenderer)', () => {
	it('held with claws, stays in the hand until the throw releases, pops back, cleared on reset', () => {
		const z = new ZombieRenderer(new HeldAssets());
		z.setWeapon('claws');
		z.updateViewmodel(0, true, 1, 0);
		expect(z.offhandDrawn).toBe(false); // zombies mode default: off
		z.setOffhandKnife(true, 100);
		z.updateViewmodel(100, true, 1, 0);
		expect(z.offhandDrawn).toBe(true);
		// Throw: hidden by the client right away, still drawn through the wind-up.
		z.thrown(1000);
		z.setOffhandKnife(false, 1000);
		z.updateViewmodel(1050, true, 1, 0);
		expect(z.offhandDrawn).toBe(true);
		z.updateViewmodel(1200, true, 1, 0);
		expect(z.offhandDrawn).toBe(false);
		// Pickup: back in the hand.
		z.setOffhandKnife(true, 2000);
		z.updateViewmodel(2000, true, 1, 0);
		expect(z.offhandDrawn).toBe(true);
		// Other weapons never draw it; neither does a hidden viewmodel.
		z.setWeapon('lmg');
		z.updateViewmodel(2100, true, 1, 0);
		expect(z.offhandDrawn).toBe(false);
		z.setWeapon('claws');
		z.updateViewmodel(2200, false, 1, 0);
		expect(z.offhandDrawn).toBe(false);
		z.clear();
		expect(z.offhandKnife).toBe(false);
		z.setWeapon('claws');
		z.updateViewmodel(2300, true, 1, 0);
		expect(z.offhandDrawn).toBe(false);
		z.dispose();
	});
});
