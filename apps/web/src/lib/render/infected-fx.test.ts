/**
 * InfectedFx in node with the real scene objects (no canvas: the glow texture
 * is null): corpses collapse and fade at the death pose in the infected look,
 * the infection burst, bullet impacts in two shared buffers, the caps, and
 * that clear and dispose (also through InfectedRenderer) leave nothing behind.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { emptyMotion } from './character/animator.js';
import { HeldAssets } from './character/held.js';
import { PAL } from './character/mesh-kit.js';
import { applyLoadout, CharacterModel, personOf } from './character/model.js';
import { CORPSE_FADE_MS, CORPSE_FALL_MS, CORPSE_MAX, IMPACT_MAX, IMPACT_MS, IMPACT_PUFFS, IMPACT_SPARKS, InfectedFx, TURN_MAX, TURN_MOTES, TURN_MS } from './infected-fx.js';
import { InfectedRenderer } from './infected.js';
import { bonePoint, character, roleTop, topColor } from './players-testkit.js';

const DEG = Math.PI / 180;

/** Corpse and burst roots are the Groups under the fx group. */
const groups = (fx: InfectedFx) => fx.group.children.filter((c): c is THREE.Group => c.type === 'Group');
const shown = (fx: InfectedFx) => groups(fx).filter((c) => c.visible);
const sparks = (fx: InfectedFx) => fx.group.children.find((c): c is THREE.LineSegments => c instanceof THREE.LineSegments)!;
const puffs = (fx: InfectedFx) => fx.group.children.find((c): c is THREE.Points => c instanceof THREE.Points)!;

/** root → tip → character. */
function corpseParts(root: THREE.Object3D) {
	const { material, parent } = character(root);
	const eye = material.palette[PAL.iris]!;
	const top = material.palette[PAL.topA]!;
	return { tip: root.children[0] as THREE.Group, group: parent!, material, eye, top };
}

const headAt = (root: THREE.Object3D) => bonePoint(root, 'head');

/** Colours of the corpse: main colour of the top, and the eyes. */
const colors = (root: THREE.Object3D) => {
	const p = corpseParts(root);
	return [topColor(root), new THREE.Color(p.eye.x, p.eye.y, p.eye.z).getHex()];
};
const INF_EYES = 0xff3a1e;
const ALPHA_EYES = 0xffb21e;

describe('corpses', () => {
	it('stands at the death pose in the infected look: Source → Three, yaw, glowing eyes, talons, upright and solid', () => {
		const fx = new InfectedFx(new HeldAssets());
		fx.corpse({ x: 10, y: 20, z: 30, yaw: 90, id: 4 }, 'infected', 1000);
		expect(fx.stats.corpses).toBe(1);
		const root = shown(fx)[0]!;
		expect(root.position.toArray()).toEqual([10, 30, -20]);
		const p = corpseParts(root);
		expect(p.group.rotation.y).toBeCloseTo(90 * DEG, 6);
		expect(colors(root)).toEqual([roleTop('infected'), INF_EYES]);
		expect(p.top.w).toBeGreaterThan(0.2); // the glow of the shirt
		expect(p.eye.w).toBe(1);
		expect(p.tip.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6);
		expect(p.material.opacity).toBe(1);
		// Hunched, hands raised in front.
		expect(headAt(root).z).toBeLessThan(-20 - 4);
		expect(bonePoint(root, 'handR').z).toBeLessThan(-20 - 8);
		fx.dispose();
	});

	it('takes over the drawn avatar: clothes, pose, claws and detail; a hit flash ends with it', () => {
		const assets = new HeldAssets();
		const fx = new InfectedFx(assets);
		const m = new CharacterModel(personOf(7), assets);
		applyLoadout(m, { hat: 'hat_cap', glasses: null, top: 'top_hoodie', bottom: null, shoes: null, effect: null });
		m.setRole('infected');
		m.setHeld('claws', true);
		m.material.emissive.setHex(0xffffff);
		for (let i = 0; i < 30; i++) m.update(1 / 30, { ...emptyMotion(), yaw: 40, ducked: true, pitch: 30, vx: 200 }, 900);
		const at = new THREE.Group();
		at.add(m.group);
		const want = bonePoint(at, 'head');
		const hand = bonePoint(at, 'handL');
		fx.corpse({ x: 0, y: 0, z: 0, yaw: 40 }, 'infected', 0, m);
		const root = shown(fx)[0]!;
		expect(bonePoint(root, 'head').distanceTo(want)).toBeLessThan(1e-4);
		expect(bonePoint(root, 'handL').distanceTo(hand)).toBeLessThan(1e-4);
		// The same shared geometry: clothes, claws and LOD.
		expect(character(root).geometry).toBe(m.mesh.geometry);
		expect(character(root).material.emissive.getHex()).toBe(0);
		// The avatar goes on living: its next pose does not move the corpse.
		for (let i = 0; i < 30; i++) m.update(1 / 30, { ...emptyMotion(), yaw: 40 }, 100);
		expect(bonePoint(root, 'head').distanceTo(want)).toBeLessThan(1e-4);
		m.dispose();
		fx.dispose();
	});

	it('Patient Zero dies in its own look', () => {
		const fx = new InfectedFx(new HeldAssets());
		fx.corpse({ x: 0, y: 0, z: 0, yaw: 0 }, 'alpha', 0);
		expect(colors(shown(fx)[0]!)).toEqual([roleTop('alpha'), ALPHA_EYES]);
		fx.dispose();
	});

	it('collapses, the glow and eyes go out, then it fades and returns to the pool', () => {
		const fx = new InfectedFx(new HeldAssets());
		fx.corpse({ x: 0, y: 0, z: 0, yaw: 0 }, 'infected', 1000);
		const root = shown(fx)[0]!;
		const p = corpseParts(root);
		fx.update(1000 + CORPSE_FALL_MS / 2);
		const half = p.tip.quaternion.angleTo(new THREE.Quaternion());
		expect(half).toBeGreaterThan(0.2);
		expect(half).toBeLessThan(Math.PI / 4);
		expect(p.material.opacity).toBe(1);
		fx.update(1000 + CORPSE_FALL_MS);
		expect(p.tip.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(1.4);
		expect(headAt(root).y).toBeLessThan(20);
		expect(p.top.w).toBe(0);
		expect(p.eye.x).toBeLessThan(new THREE.Color(INF_EYES).r * 0.2);
		expect(p.material.opacity).toBe(1);
		fx.update(1000 + CORPSE_FALL_MS + CORPSE_FADE_MS / 2);
		expect(p.material.opacity).toBeCloseTo(0.5, 6);
		// Fading needs a transparent material from the start (no program switch mid-effect).
		expect(p.material.transparent).toBe(true);
		expect(root.visible).toBe(true);
		fx.update(1000 + CORPSE_FALL_MS + CORPSE_FADE_MS);
		expect(fx.stats).toMatchObject({ corpses: 0, corpsesPooled: 1 });
		expect(root.visible).toBe(false);
		fx.dispose();
	});

	it('falls away from the hit, or backwards when the direction is unknown', () => {
		const fx = new InfectedFx(new HeldAssets());
		const end = CORPSE_FALL_MS + 1;
		fx.corpse({ x: 100, y: 0, z: 0, yaw: 0, fx: 0, fy: 5 }, 'infected', 0); // hit travelling +Y (Source) → Three −Z
		fx.corpse({ x: 300, y: 0, z: 0, yaw: 0 }, 'infected', 0); // facing +X: backwards is −X
		fx.corpse({ x: 500, y: 0, z: 0, yaw: 90 }, 'infected', 0); // facing +Y: backwards is −Y → Three +Z
		fx.update(end);
		const [a, b, c] = shown(fx).map(headAt) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
		expect(a.z).toBeLessThan(-50);
		expect(Math.abs(a.x - 100)).toBeLessThan(8);
		expect(b.x).toBeLessThan(300 - 50);
		expect(Math.abs(b.z)).toBeLessThan(8);
		expect(c.z).toBeGreaterThan(50);
		expect(Math.abs(c.x - 500)).toBeLessThan(8);
		fx.dispose();
	});

	it('a delayed corpse stands until its turn (M.O.A.B. wave)', () => {
		const fx = new InfectedFx(new HeldAssets());
		fx.corpse({ x: 0, y: 0, z: 0, yaw: 0, delay: 200 }, 'infected', 1000);
		const p = corpseParts(shown(fx)[0]!);
		fx.update(1150);
		expect(p.tip.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6);
		fx.update(1200 + CORPSE_FALL_MS);
		expect(p.tip.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(1.4);
		fx.dispose();
	});

	it('is pooled and capped: a full lobby fits, more replace the oldest, expired bodies are reused', () => {
		const fx = new InfectedFx(new HeldAssets());
		expect(CORPSE_MAX).toBeGreaterThanOrEqual(32);
		for (let i = 0; i < CORPSE_MAX + 6; i++) fx.corpse({ x: i, y: 0, z: 0, yaw: 0 }, 'infected', i);
		expect(fx.stats.corpses).toBe(CORPSE_MAX);
		expect(groups(fx)).toHaveLength(CORPSE_MAX);
		// The six oldest were replaced by the newest.
		expect(shown(fx).map((r) => r.position.x).sort((a, b) => a - b)[0]).toBe(6);
		fx.update(1e6);
		expect(fx.stats).toMatchObject({ corpses: 0, corpsesPooled: CORPSE_MAX });
		fx.corpse({ x: 1, y: 2, z: 3, yaw: 0 }, 'alpha', 2e6);
		expect(groups(fx)).toHaveLength(CORPSE_MAX);
		expect(shown(fx)).toHaveLength(1);
		// A reused body starts upright and solid again.
		const p = corpseParts(shown(fx)[0]!);
		expect(p.tip.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6);
		expect(p.material.opacity).toBe(1);
		fx.dispose();
	});
});

describe('infection burst', () => {
	it('motes spiral in around the body, a ring races out, then it returns to the pool', () => {
		const fx = new InfectedFx(new HeldAssets());
		fx.turn({ x: 10, y: 20, z: 30 }, 500);
		expect(fx.stats.turns).toBe(1);
		const root = shown(fx)[0]!;
		expect(root.position.toArray()).toEqual([10, 30, -20]);
		const lines = root.children.find((c): c is THREE.LineSegments => c instanceof THREE.LineSegments)!;
		const ring = root.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh)!;
		const pos = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
		expect(pos.count).toBe(TURN_MOTES * 2);
		const radius = () => Math.hypot(pos.getX(0), pos.getZ(0));
		fx.update(500 + TURN_MS * 0.2);
		const r0 = radius();
		const y0 = pos.getY(0);
		const s0 = ring.scale.x;
		expect((lines.material as THREE.LineBasicMaterial).opacity).toBeGreaterThan(0.5);
		fx.update(500 + TURN_MS * 0.8);
		expect(radius()).toBeLessThan(r0);
		expect(pos.getY(0)).toBeGreaterThan(y0);
		expect(ring.scale.x).toBeGreaterThan(s0);
		for (let i = 0; i < pos.count; i++) expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
		fx.update(500 + TURN_MS);
		expect(fx.stats).toMatchObject({ turns: 0, turnsPooled: 1 });
		expect(root.visible).toBe(false);
		fx.dispose();
	});

	it('is capped: more bursts replace the oldest', () => {
		const fx = new InfectedFx(new HeldAssets());
		for (let i = 0; i < TURN_MAX + 3; i++) fx.turn({ x: i, y: 0, z: 0 }, 0);
		expect(fx.stats.turns).toBe(TURN_MAX);
		expect(groups(fx)).toHaveLength(TURN_MAX);
		fx.dispose();
	});
});

describe('bullet impacts', () => {
	it('sparks fly off the surface, dust drifts along the normal, all in two shared draws', () => {
		const fx = new InfectedFx(new HeldAssets());
		expect(sparks(fx).visible).toBe(false);
		fx.impact({ x: 100, y: 200, z: 50 }, { x: 1, y: 0, z: 0 }, 1000);
		expect(fx.stats.impacts).toBe(1);
		expect([sparks(fx).visible, puffs(fx).visible]).toEqual([true, true]);
		const sp = sparks(fx).geometry.getAttribute('position') as THREE.BufferAttribute;
		const sc = sparks(fx).geometry.getAttribute('color') as THREE.BufferAttribute;
		const pp = puffs(fx).geometry.getAttribute('position') as THREE.BufferAttribute;
		const pc = puffs(fx).geometry.getAttribute('color') as THREE.BufferAttribute;
		expect(sp.count).toBe(IMPACT_MAX * IMPACT_SPARKS * 2);
		expect(pp.count).toBe(IMPACT_MAX * IMPACT_PUFFS);
		// Per-vertex alpha: the colour attributes carry four components.
		expect([sc.itemSize, pc.itemSize]).toEqual([4, 4]);
		// At the impact point (Source → Three) at first.
		expect([sp.getX(0), sp.getY(0), sp.getZ(0)]).toEqual([100, 50, -200]);
		fx.update(1000 + 40);
		for (let i = 0; i < IMPACT_SPARKS; i++) {
			expect(sp.getX(i * 2)).toBeGreaterThan(100); // off the wall, along its normal
			expect(sc.getW(i * 2)).toBeGreaterThan(0);
		}
		fx.update(1000 + IMPACT_MS * 0.5);
		expect(pp.getX(0)).toBeGreaterThan(100 + 5);
		expect(pc.getW(0)).toBeGreaterThan(0);
		// Sparks burn out before the dust.
		fx.update(1000 + IMPACT_MS * 0.8);
		expect(sc.getW(0)).toBe(0);
		expect(pc.getW(0)).toBeGreaterThan(0);
		fx.update(1000 + IMPACT_MS);
		expect(fx.stats.impacts).toBe(0);
		expect([sparks(fx).visible, puffs(fx).visible]).toEqual([false, false]);
		expect(pc.getW(0)).toBe(0);
		fx.dispose();
	});

	it('an unknown normal sprays up', () => {
		const fx = new InfectedFx(new HeldAssets());
		fx.impact({ x: 0, y: 0, z: 0 }, null, 0);
		fx.impact({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
		const pp = puffs(fx).geometry.getAttribute('position') as THREE.BufferAttribute;
		fx.update(IMPACT_MS * 0.5);
		expect(pp.getY(0)).toBeGreaterThan(5);
		expect(pp.getY(IMPACT_PUFFS)).toBeGreaterThan(5);
		fx.dispose();
	});

	it('is capped: a ring of IMPACT_MAX slots, the oldest replaced, no new objects', () => {
		const fx = new InfectedFx(new HeldAssets());
		const before = fx.group.children.length;
		for (let i = 0; i < IMPACT_MAX + 20; i++) fx.impact({ x: i, y: 0, z: 0 }, null, i * 0.01);
		expect(fx.stats.impacts).toBe(IMPACT_MAX);
		expect(fx.group.children.length).toBe(before);
		// Slot 0 was reused by impact number IMPACT_MAX.
		const sp = sparks(fx).geometry.getAttribute('position') as THREE.BufferAttribute;
		expect(sp.getX(0)).toBe(IMPACT_MAX);
		fx.update(IMPACT_MS + 1);
		expect(fx.stats.impacts).toBe(0);
		fx.dispose();
	});
});

describe('clear and dispose', () => {
	it('clear stops everything at once and keeps the pools', () => {
		const fx = new InfectedFx(new HeldAssets());
		fx.corpse({ x: 0, y: 0, z: 0, yaw: 0 }, 'infected', 0);
		fx.turn({ x: 0, y: 0, z: 0 }, 0);
		fx.impact({ x: 0, y: 0, z: 0 }, null, 0);
		fx.clear();
		expect(fx.stats).toEqual({ corpses: 0, corpsesPooled: 1, turns: 0, turnsPooled: 1, impacts: 0 });
		expect(shown(fx)).toHaveLength(0);
		expect([sparks(fx).visible, puffs(fx).visible]).toEqual([false, false]);
		// Nothing comes back on the next frame.
		fx.update(10);
		expect(shown(fx)).toHaveLength(0);
		expect(sparks(fx).visible).toBe(false);
		fx.dispose();
		expect(fx.group.children).toHaveLength(0);
	});

	it('InfectedRenderer owns it: update, clear (round reset, map change) and dispose reach the effects', () => {
		const r = new InfectedRenderer(new HeldAssets());
		expect(r.fx.group.parent).toBe(r.group);
		// Not a Group: knife-root queries on Groups under the renderer stay unaffected.
		expect(r.group.children.filter((c) => c.type === 'Group')).toHaveLength(0);
		r.fx.corpse({ x: 0, y: 0, z: 0, yaw: 0 }, 'infected', 0);
		r.fx.turn({ x: 0, y: 0, z: 0 }, 0);
		r.fx.impact({ x: 0, y: 0, z: 0 }, null, 0);
		r.update(IMPACT_MS + 1);
		expect(r.fx.stats).toMatchObject({ corpses: 1, turns: 1, impacts: 0 });
		r.clear();
		expect(r.fx.stats).toMatchObject({ corpses: 0, turns: 0, impacts: 0 });
		r.fx.corpse({ x: 0, y: 0, z: 0, yaw: 0 }, 'infected', 0);
		r.dispose();
		expect(r.fx.stats.corpses).toBe(0);
		expect(r.fx.group.parent).toBeNull();
	});
});
