/**
 * Spent cases (render/casings.ts): the handover from the viewmodel into the world, the flight and its end on a real collision
 * world, the caps, reduced motion and the other players' cases.
 */
import { buildCollisionWorld, WEAPONS, type BrushDef } from '@surf/shared';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { aimFov, restVmFeel } from '../game/gunfeel.js';
import { CASE_BOUNCES, CASE_FADE_MS, CASE_HAND_MS, CASE_MAX, CASE_MAX_REDUCED, CASE_OTHERS, CASE_REST_MS, caseOf, CASES, Casings, depthScale, toViewmodel, toWorldView, type CaseKind, type HandOver } from './casings.js';
import { HeldAssets } from './character/held.js';
import { verticalFovFromHorizontal43 } from './fov.js';
import { GUN_PARTS, type GunId } from './gun-rig.js';
import { shippedLoad } from './shipped-models.js';
import { noLoad } from './weapon-assets.js';
import { ZombieRenderer } from './zombies.js';

const GUNS = Object.keys(GUN_PARTS) as GunId[];
const box = (min: [number, number, number], max: [number, number, number]): BrushDef => ({ type: 'box', min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] }, material: 'concrete' });

function camera(fov = 90, yaw = 0): THREE.PerspectiveCamera {
	const c = new THREE.PerspectiveCamera(verticalFovFromHorizontal43(fov), 16 / 9, 2, 10000);
	c.position.set(0, 64, 0);
	c.rotation.order = 'YXZ';
	c.rotation.y = yaw;
	c.updateMatrixWorld();
	return c;
}
/** A floor the casings trace against, as the world does it. */
const floor = {
	trace(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
		const hit = b.z < 0 && a.z >= 0;
		const f = hit ? a.z / (a.z - b.z) : 1;
		return { fraction: f, endpos: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f }, plane: { normal: { x: 0, y: 0, z: hit ? 1 : 0 }, dist: 0 }, startsolid: false, allsolid: false };
	}
};
const instances = (g: THREE.Group) =>
	(g.children as THREE.InstancedMesh[]).filter((m) => m.visible).flatMap((m) =>
		Array.from({ length: m.count }, (_, i) => {
			const t = new THREE.Matrix4();
			m.getMatrixAt(i, t);
			return { kind: m.name, matrix: t };
		})
	);

describe('handover', () => {
	it('a point goes there and back, and is seen on the same pixel, as big', () => {
		const h: HandOver = { k: 0.4, vmTan: Math.tan((62 * Math.PI) / 360), worldTan: Math.tan((verticalFovFromHorizontal43(90) * Math.PI) / 360) };
		for (const fov of [90, 55, 40]) {
			h.worldTan = Math.tan((verticalFovFromHorizontal43(fov) * Math.PI) / 360);
			for (const p of [new THREE.Vector3(6, -4, -20), new THREE.Vector3(-3, 2, -40)]) {
				const q = p.clone();
				const s = toViewmodel(q, h);
				// Screen place in half heights.
				expect(q.x / (-q.z * h.vmTan)).toBeCloseTo(p.x / (-p.z * h.worldTan), 12);
				expect(q.y / (-q.z * h.vmTan)).toBeCloseTo(p.y / (-p.z * h.worldTan), 12);
				// A length across the view is as long on the screen.
				expect(s / (-q.z * h.vmTan)).toBeCloseTo(1 / (-p.z * h.worldTan), 12);
				toWorldView(q, h);
				expect(q.distanceTo(p)).toBeLessThan(1e-9);
			}
		}
		expect(depthScale(0.42)).toBeGreaterThan(0.3);
	});

	it('my own case starts at the port of the gun, and nothing jumps as it enters the world', async () => {
		for (const id of GUNS) {
			const z = new ZombieRenderer(new HeldAssets(), shippedLoad);
			z.setWeapon(id);
			await z.preload([id]);
			z.updateViewmodel(0, true, 1, 0, restVmFeel(), 5);
			const cam = camera();
			z.casings.collision = floor as never;
			z.updateCasings(0, cam);
			z.fired(1000);
			// The sniper's comes as its bolt opens.
			let at = 1000;
			for (; at < 2000 && z.casings.stats.live === 0; at += 4) {
				z.updateViewmodel(at, true, 1, 0, restVmFeel(), 5);
				z.updateCasings(at, cam);
			}
			expect(z.casings.stats.live, id).toBe(id === 'lmg' ? 2 : 1);
			const born = at - 4;
			const port = new THREE.Vector3().setFromMatrixPosition(z.rig(id)!.point('eject')!.matrixWorld);
			const first = instances(z.casings.hand)[0]!;
			const p = new THREE.Vector3().setFromMatrixPosition(first.matrix);
			expect(p.distanceTo(port), id).toBeLessThan(0.02);
			expect(instances(z.casings.world)).toHaveLength(0);
			// Both pictures of the same case at the moment it changes scene.
			const screen = (v: THREE.Vector3, c: THREE.PerspectiveCamera) => v.clone().project(c);
			const len = (m: THREE.Matrix4, c: THREE.PerspectiveCamera) => screen(new THREE.Vector3(-0.5, 0, 0).applyMatrix4(m), c).setZ(0).distanceTo(screen(new THREE.Vector3(0.5, 0, 0).applyMatrix4(m), c).setZ(0));
			const vmCam = z.vmCamera;
			vmCam.aspect = cam.aspect;
			vmCam.updateProjectionMatrix();
			z.casings.update(born + CASE_HAND_MS - 0.01, cam, Math.tan((vmCam.fov * Math.PI) / 360));
			const hand = instances(z.casings.hand).map((i) => i.matrix);
			z.casings.update(born + CASE_HAND_MS + 0.01, cam, Math.tan((vmCam.fov * Math.PI) / 360));
			const world = instances(z.casings.world).map((i) => i.matrix);
			expect(hand, id).toHaveLength(id === 'lmg' ? 2 : 1);
			expect(world).toHaveLength(hand.length);
			hand.forEach((m, i) => {
				const a = screen(new THREE.Vector3().setFromMatrixPosition(m), vmCam);
				const b = screen(new THREE.Vector3().setFromMatrixPosition(world[i]!), cam);
				expect(Math.hypot(a.x - b.x, a.y - b.y), id).toBeLessThan(0.002);
				expect(Math.abs(len(m, vmCam) / len(world[i]!, cam) - 1), id).toBeLessThan(0.02);
			});
			z.dispose();
		}
	});

	it('a wall nearer than the gun: the case starts this side of it, on the same pixel', () => {
		const c = new Casings();
		c.reduced = false;
		const cam = camera(90, -Math.PI / 2);
		// The camera looks along +X (Source and three): the wall is 8 units off.
		c.collision = {
			trace: (a: { x: number }, b: { x: number; y: number; z: number }) => {
				const hit = b.x > 8 && a.x < 8;
				const f = hit ? (8 - a.x) / (b.x - a.x) : 1;
				return { fraction: f, endpos: b, plane: { normal: { x: -1, y: 0, z: 0 }, dist: 0 }, startsolid: false, allsolid: false };
			}
		} as never;
		c.update(0, cam, 0.6);
		const h: HandOver = { k: 0.4, vmTan: 0.6, worldTan: Math.tan((cam.fov * Math.PI) / 360) };
		const port = new THREE.Vector3(3, -2, -12);
		c.eject(CASES.smg, port, new THREE.Vector3(1, 0, 0), cam, h, 1);
		expect(c.at(0)!.x).toBeLessThan(8);
		c.update(2, cam, 0.6);
		const m = instances(c.hand)[0]!.matrix;
		const seen = new THREE.Vector3().setFromMatrixPosition(m);
		expect(seen.x / -seen.z).toBeCloseTo(port.x / -port.z, 1);
		c.dispose();
	});
});

describe('flight', () => {
	const fly = (c: Casings, cam: THREE.PerspectiveCamera, from: number, to: number, step = 16) => {
		for (let t = from; t <= to; t += step) c.update(t, cam, 0.6);
	};

	it('falls, bounces a few times, lies on its side and goes', () => {
		const c = new Casings();
		c.reduced = false;
		c.collision = floor as never;
		const cam = camera();
		const landed: [CaseKind, number][] = [];
		c.onLand = (k, at, speed) => {
			landed.push([k, speed]);
			expect(Math.abs(at.z)).toBeLessThan(0.5);
		};
		c.update(0, cam, 0.6);
		c.ejectOther('lmg', { x: 0, y: 0, z: 50 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
		expect(c.stats.live).toBe(1);
		let top = 0;
		let turns = 0;
		let up = false;
		let last = c.at(0)!.y;
		for (let t = 16; t < 3000; t += 16) {
			c.update(t, cam, 0.6);
			const y = c.at(0)!.y;
			expect(y).toBeGreaterThan(-0.1);
			if (y > last + 1e-6 && !up) {
				turns++;
				up = true;
			} else if (y < last) up = false;
			top = Math.max(top, y);
			last = y;
		}
		expect(top).toBeGreaterThan(50);
		expect(turns).toBeGreaterThanOrEqual(2);
		expect(turns).toBeLessThanOrEqual(CASE_BOUNCES + 1);
		expect(c.stats.resting).toBe(1);
		// It is heard once, where it first lands.
		expect(landed).toHaveLength(1);
		expect(landed[0]![1]).toBeGreaterThan(100);
		// Flat on the ground.
		const m = instances(c.world)[0]!.matrix;
		const along = new THREE.Vector3(1, 0, 0).transformDirection(m);
		expect(Math.abs(along.y)).toBeLessThan(0.1);
		fly(c, cam, 3000, 3000 + CASE_REST_MS + CASE_FADE_MS + 200);
		expect(c.stats.live).toBe(0);
		expect(instances(c.world)).toHaveLength(0);
		c.dispose();
	});

	it('never falls through a real floor, at any frame rate', () => {
		// A floor at z = 0 and a wall at x = 60.
		const w = buildCollisionWorld({ brushes: [box([-500, -500, -32], [500, 500, 0]), box([60, -500, 0], [92, 500, 200])] });
		for (const step of [4, 16, 40]) {
			const c = new Casings();
			c.reduced = false;
			c.collision = w;
			const cam = camera();
			c.update(0, cam, 0.6);
			for (let i = 0; i < 30; i++) c.ejectOther('striker', { x: 20, y: i * 2, z: 48 }, { x: 0, y: 1, z: 0 }, { x: 200, y: 0, z: 0 }, 0);
			fly(c, cam, 0, 3500, step);
			for (let i = 0; i < c.stats.live; i++) {
				const p = c.at(i)!;
				expect(p.y, 'step ' + step).toBeGreaterThan(-0.2);
				expect(p.x, 'step ' + step).toBeLessThan(60.2);
			}
			expect(c.stats.resting).toBeGreaterThan(25);
			c.dispose();
		}
	});

	it('takes the velocity of the player along', () => {
		const c = new Casings();
		c.reduced = false;
		c.collision = floor as never;
		const cam = camera();
		const h: HandOver = { k: 0.4, vmTan: 0.6, worldTan: Math.tan((cam.fov * Math.PI) / 360) };
		const drift = (speed: number) => {
			c.clear();
			cam.position.set(0, 64, 0);
			for (let i = 0; i < 5; i++) {
				cam.position.z = -i * 0.016 * speed;
				cam.updateMatrixWorld();
				c.update(10_000 + speed * 100 + i * 16, cam, 0.6);
			}
			c.eject({ ...CASES.smg, link: false }, new THREE.Vector3(3, -2, -12), new THREE.Vector3(1, 0, 0), cam, h, 10_000 + speed * 100 + 64);
			const a = c.at(0)!.z;
			for (let i = 5; i < 10; i++) {
				cam.position.z = -i * 0.016 * speed;
				cam.updateMatrixWorld();
				c.update(10_000 + speed * 100 + i * 16, cam, 0.6);
			}
			return (c.at(0)!.z - a) / 0.08;
		};
		expect(drift(400) - drift(0)).toBeLessThan(-330);
		expect(drift(400) - drift(0)).toBeGreaterThan(-470);
		c.dispose();
	});
});

describe('my own cases are seen leaving the gun, looking level', () => {
	/** How long one is on the screen (ms), how far it rises above the port and how far it stays from the crosshair (half screen heights). */
	const SEEN = 350;
	const RISE = 0.25;
	const CLEAR = 0.1;

	it.each(GUNS.flatMap((id) => (id === 'sniper' || id === 'barrett' ? [[id, 0]] : [[id, 0], [id, 1]]) as [GunId, number][]))('%s, aimed %d: up and to the right inside the view, past the crosshair', async (id, aim) => {
		const z = new ZombieRenderer(new HeldAssets(), shippedLoad);
		z.setWeapon(id);
		await z.preload([id]);
		const cam = camera(aim ? aimFov(90, id) : 90);
		const tan = Math.tan((cam.fov * Math.PI) / 360);
		const feel = { ...restVmFeel(), aim };
		z.casings.reduced = false;
		z.casings.collision = floor as never;
		z.updateViewmodel(0, true, 1, 0, feel, 5);
		z.updateCasings(0, cam);
		const real = Math.random;
		try {
			// The smallest, the middle and the biggest of every random share.
			for (const r of [0, 0.5, 0.999]) {
				Math.random = () => r;
				z.casings.clear();
				z.fired(1000);
				let seen = 0;
				let first: number[] | null = null;
				let top = -Infinity;
				let last: number[] = [];
				for (let t = 1000; t < 3000; t += 4) {
					z.updateViewmodel(t, true, 1, 0, feel, 5);
					z.updateCasings(t, cam);
					const p = z.casings.at(0);
					if (!p) continue;
					p.applyMatrix4(cam.matrixWorldInverse);
					const at = [p.x / (-p.z * tan), p.y / (-p.z * tan)];
					first ??= at;
					if (p.z > -cam.near || Math.abs(at[0]!) > 4 / 3 || Math.abs(at[1]!) > 1) break;
					seen += 4;
					top = Math.max(top, at[1]!);
					last = at;
					expect(Math.max(Math.abs(at[0]!), Math.abs(at[1]!)), id + ' ' + (t - 1000) + ' ms').toBeGreaterThan(CLEAR);
					// From the port to the right, never back over the gun.
					expect(at[0]!).toBeGreaterThanOrEqual(first[0]! - 0.02);
				}
				expect(seen, id + ' ' + r).toBeGreaterThanOrEqual(SEEN);
				expect(top - first![1]!, id + ' ' + r).toBeGreaterThan(RISE);
				expect(last[0]!, id + ' ' + r).toBeGreaterThan(first![0]! + 0.15);
			}
		} finally {
			Math.random = real;
		}
		z.dispose();
	});
});

describe('caps', () => {
	it('never more than CASE_MAX: the oldest makes room, and no mesh or buffer is made by a shot', () => {
		const c = new Casings();
		c.reduced = false;
		c.collision = floor as never;
		const cam = camera();
		c.update(0, cam, 0.6);
		const meshes = [...c.world.children, ...c.hand.children] as THREE.InstancedMesh[];
		const buffers = meshes.map((m) => m.instanceMatrix.array);
		for (let i = 0; i < 500; i++) {
			c.ejectOther('smg', { x: 0, y: 0, z: 40 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, i * 8);
			c.update(i * 8, cam, 0.6);
			expect(c.stats.live).toBeLessThanOrEqual(CASE_MAX);
		}
		expect(c.stats.live).toBe(CASE_MAX);
		expect([...c.world.children, ...c.hand.children]).toEqual(meshes);
		meshes.forEach((m, i) => expect(m.instanceMatrix.array).toBe(buffers[i]));
		// One draw call per kind and scene at most.
		expect(meshes).toHaveLength(10);
		c.clear();
		expect(c.stats.live).toBe(0);
		for (const m of meshes) expect(m.visible).toBe(false);
		c.dispose();
	});

	it('other players: near the camera only', () => {
		const c = new Casings();
		c.reduced = false;
		c.update(0, camera(), 0.6);
		c.ejectOther('smg', { x: CASE_OTHERS + 50, y: 0, z: 64 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
		expect(c.stats.live).toBe(0);
		c.ejectOther('smg', { x: CASE_OTHERS - 50, y: 0, z: 64 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
		expect(c.stats.live).toBe(1);
		c.ejectOther('knife', { x: 0, y: 0, z: 64 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
		expect(c.stats.live).toBe(1);
		c.dispose();
	});

	it('reduced motion: fewer of mine, none of the others', () => {
		const c = new Casings();
		c.reduced = true;
		c.collision = floor as never;
		const cam = camera();
		c.update(0, cam, 0.6);
		const h: HandOver = { k: 0.4, vmTan: 0.6, worldTan: 0.7 };
		for (let i = 0; i < 300; i++) c.eject(CASES.lmg, new THREE.Vector3(3, -2, -12), new THREE.Vector3(1, 0, 0), cam, h, i);
		expect(c.stats.live).toBeLessThanOrEqual(CASE_MAX_REDUCED);
		c.clear();
		for (let i = 0; i < 9; i++) c.eject(CASES.lmg, new THREE.Vector3(3, -2, -12), new THREE.Vector3(1, 0, 0), cam, h, i);
		expect(c.stats.live).toBe(3);
		c.clear();
		c.ejectOther('smg', { x: 10, y: 0, z: 64 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
		expect(c.stats.live).toBe(0);
		c.dispose();
	});
});

describe('guns', () => {
	it('brass by calibre, red shells for the shotgun, links and cases for the LMG; melee throws out nothing', () => {
		expect(CASES.pistol.kind).toBe('small');
		expect(CASES.smg.kind).toBe('small');
		expect(CASES.lmg).toMatchObject({ kind: 'rifle', link: true });
		expect(CASES.sniper.kind).toBe('rifle');
		expect(CASES.barrett.kind).toBe('fifty');
		expect(CASES.striker.kind).toBe('shell');
		expect(caseOf('knife')).toBeNull();
		expect(caseOf('claws')).toBeNull();
		for (const id of GUNS) if (id !== 'lmg') expect(CASES[id].link).toBe(false);
		expect(WEAPONS.striker.pellets).toBeGreaterThan(1);
	});

	it('every shot throws out one case; the round reset, the map change and a swap leave none behind', () => {
		const z = new ZombieRenderer(new HeldAssets(), noLoad);
		z.casings.reduced = false;
		const cam = camera();
		z.casings.collision = floor as never;
		z.setWeapon('smg');
		for (let i = 0; i < 10; i++) {
			z.fired(1000 + i * 65);
			z.updateViewmodel(1000 + i * 65, true, 1, 0, undefined, 30 - i);
			z.updateCasings(1000 + i * 65, cam);
		}
		expect(z.casings.stats.live).toBe(10);
		// A case not out yet stays in with the gun that is put away.
		z.fired(1700);
		z.setWeapon('pistol');
		z.updateViewmodel(1701, true, 1, 0, undefined, 12);
		z.updateCasings(1701, cam);
		expect(z.casings.stats.live).toBe(10);
		z.clear();
		expect(z.casings.stats.live).toBe(0);
		z.dispose();
	});
});
