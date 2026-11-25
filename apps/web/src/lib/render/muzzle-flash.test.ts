/** Muzzle flashes (render/muzzle-flash.ts): the shapes, how long they show, the light and the smoke, reduced motion. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GUN_PARTS, type GunId } from './gun-rig.js';
import { restVmFeel } from '../game/gunfeel.js';
import { HeldAssets } from './character/held.js';
import { FLASH_FRAMES, FLASH_SHAPES, FLASHES, FlashShapes, hasFlash, MuzzleFx, nextShape } from './muzzle-flash.js';

import { coversCentre } from './fp-testkit.js';
import { shippedLoad } from './shipped-models.js';
import { ZombieRenderer } from './zombies.js';

const GUNS = Object.keys(GUN_PARTS) as GunId[];
const MUZZLE = new THREE.Vector3(-1, 2, -20);
const lightOf = (f: MuzzleFx) => f.scene.children.find((c): c is THREE.PointLight => c instanceof THREE.PointLight)!;
const puffsOf = (f: MuzzleFx) => f.scene.children.find((c): c is THREE.Points => c instanceof THREE.Points)!;
const positions = (g: THREE.BufferGeometry) => Array.from(g.getAttribute('position').array);

describe('shapes', () => {
	it('several per gun, none like another, the flame ahead of the muzzle, black at its edge', () => {
		const shapes = new FlashShapes(new THREE.Vector3(0, 0, -1));
		for (const id of GUNS) {
			const all = shapes.of(id);
			expect(all).toHaveLength(FLASH_SHAPES);
			expect(shapes.of(id)).toBe(all);
			for (let i = 0; i < all.length; i++) {
				const g = all[i]!;
				g.computeBoundingBox();
				const b = g.boundingBox!;
				expect(b.min.z, id).toBeLessThan(-0.7);
				expect(b.min.z, id).toBeGreaterThan(-1.4);
				expect(b.max.z, id).toBeLessThan(FLASHES[id].jets > 0 ? 0.6 : 0.35);
				expect(g.getAttribute('position').count / 3, id).toBeLessThan(900);
				for (let j = 0; j < i; j++) expect(positions(all[j]!)).not.toEqual(positions(g));
				const c = g.getAttribute('color');
				let dark = 0;
				for (let k = 0; k < c.count; k++) if (c.getX(k) + c.getY(k) + c.getZ(k) === 0) dark++;
				expect(dark / c.count, id).toBeGreaterThan(0.25);
			}
		}
		// The same shapes every time.
		expect(positions(new FlashShapes(new THREE.Vector3(0, 0, -1)).of('lmg')[1]!)).toEqual(positions(shapes.of('lmg')[1]!));
		shapes.dispose();
	});

	it('the .50 cal blows out of both sides of its brake, the others forwards only', () => {
		const shapes = new FlashShapes(new THREE.Vector3(0, 0, -1));
		for (const id of GUNS)
			for (const g of shapes.of(id)) {
				g.computeBoundingBox();
				const wide = Math.min(-g.boundingBox!.min.x, g.boundingBox!.max.x);
				if (id === 'barrett') expect(wide).toBeGreaterThan(0.5);
			}
		expect(FLASHES.barrett.jets).toBeGreaterThan(0);
		for (const id of GUNS) if (id !== 'barrett') expect(FLASHES[id].jets, id).toBe(0);
		shapes.dispose();
	});

	it('no shape twice in a row', () => {
		let last = -1;
		for (let i = 0; i < 200; i++) {
			const n = nextShape(last, FLASH_SHAPES);
			expect(n).not.toBe(last);
			expect(n).toBeGreaterThanOrEqual(0);
			expect(n).toBeLessThan(FLASH_SHAPES);
			last = n;
		}
		expect(hasFlash('knife')).toBe(false);
		expect(hasFlash('smg')).toBe(true);
	});
});

describe('aimed', () => {
	/** Half the width of the sight picture that stays dark (half screen heights), and how far the flash has to stand out to both sides. */
	const PICTURE = 0.05;
	const WINGS = 0.22;

	it.each(['pistol', 'smg', 'lmg', 'striker'] as const)('%s: stands out beside the gun on both sides, the sight picture stays dark', async (id) => {
		const z = new ZombieRenderer(new HeldAssets(), shippedLoad);
		z.setWeapon(id);
		await z.preload([id]);
		const mesh = z.vmScene.getObjectByName('flash') as THREE.Mesh;
		const tan = Math.tan((z.vmCamera.fov * Math.PI) / 360);
		const shapes = new Set<THREE.BufferGeometry>();
		const v = new THREE.Vector3();
		const real = Math.random;
		let seed = 7;
		try {
			for (let k = 0; k < 60; k++) {
				// The biggest and the smallest flash, and any between.
				Math.random = k % 3 === 0 ? () => 0.999 : k % 3 === 1 ? () => 0 : () => (seed = (seed * 16807) % 2147483647) / 2147483647;
				// At once, the gun not kicked yet.
				z.fired(1000 + k * 2000);
				z.updateViewmodel(1000 + k * 2000, true, 1, 0, { ...restVmFeel(), aim: 1 }, 5);
				expect(mesh.visible).toBe(true);
				shapes.add(mesh.geometry);
				z.vmScene.updateMatrixWorld(true);
				const pos = mesh.geometry.getAttribute('position');
				const col = mesh.geometry.getAttribute('color');
				const lit = (i: number) => col.getX(i) + col.getY(i) + col.getZ(i) > 0;
				let left = 0;
				let right = 0;
				for (let i = 0; i < pos.count; i += 3) {
					if (!lit(i) && !lit(i + 1) && !lit(i + 2)) continue;
					const p = [0, 1, 2].map((c) => v.fromBufferAttribute(pos, i + c).applyMatrix4(mesh.matrixWorld).clone());
					p.forEach((q, c) => {
						if (!lit(i + c)) return;
						left = Math.min(left, q.x / (-q.z * tan));
						right = Math.max(right, q.x / (-q.z * tan));
					});
					expect(coversCentre(p[0]!, p[1]!, p[2]!, z.vmCamera.near, tan, PICTURE), id + ' shot ' + k).toBe(false);
				}
				expect(left, id).toBeLessThan(-WINGS);
				expect(right, id).toBeGreaterThan(WINGS);
			}
		} finally {
			Math.random = real;
		}
		expect(shapes.size).toBe(FLASH_SHAPES);
		z.dispose();
	});
});

describe('my own flash', () => {
	const node = new THREE.Group();
	node.scale.setScalar(0.42);
	const frames = (f: MuzzleFx, at: number, step: number) => {
		let n = 0;
		for (let t = at; t < at + 400; t += step) {
			f.update(t, MUZZLE, node);
			if (f.mesh.visible) n++;
		}
		return n;
	};

	it('one to three frames at any frame rate, on the muzzle, with its light, which is always in the scene', () => {
		const f = new MuzzleFx(false);
		expect(lightOf(f).intensity).toBe(0);
		for (const id of GUNS) {
			f.hold(id);
			for (const step of [4, 7, 16.7, 33, 50]) {
				f.fired(1000);
				f.update(1000, MUZZLE, node);
				expect(f.mesh.visible, id).toBe(true);
				expect(f.mesh.position.equals(MUZZLE)).toBe(true);
				expect(lightOf(f).intensity, id).toBeGreaterThan(5);
				const n = 1 + frames(f, 1000 + step, step);
				expect(n, id + ' ' + step).toBeLessThanOrEqual(FLASH_FRAMES);
				expect(lightOf(f).intensity).toBe(0);
			}
			// Even a frame that comes late shows it once.
			f.fired(5000);
			f.update(5055, MUZZLE, node);
			expect(f.mesh.visible, id).toBe(true);
		}
		f.dispose();
	});

	it('melee and a hidden gun have none', () => {
		const f = new MuzzleFx(false);
		f.hold(null);
		f.fired(1000);
		f.update(1001, MUZZLE, node);
		expect(f.mesh.visible).toBe(false);
		f.hold('smg');
		f.fired(2000);
		f.update(2001, null, node);
		expect(f.mesh.visible).toBe(false);
		f.dispose();
	});

	it('smoke after a long burst, not after a single shot of an automatic gun; it goes away', () => {
		const f = new MuzzleFx(false);
		f.hold('smg');
		f.fired(1000);
		frames(f, 1000, 10);
		expect(puffsOf(f).visible).toBe(false);
		for (let i = 0; i < 20; i++) {
			f.fired(2000 + i * 65);
			f.update(2000 + i * 65, MUZZLE, node);
			f.update(2000 + i * 65 + 30, MUZZLE, node);
		}
		expect(puffsOf(f).visible).toBe(true);
		for (let t = 3300; t < 6000; t += 20) f.update(t, MUZZLE, node);
		expect(puffsOf(f).visible).toBe(false);
		f.dispose();
	});

	it('reduced motion: smaller, darker, one shot in three, no smoke', () => {
		const full = new MuzzleFx(false);
		const calm = new MuzzleFx(true);
		for (const f of [full, calm]) f.hold('lmg');
		let shown = 0;
		let big = 0;
		let small = 0;
		let light = 0;
		let dim = 0;
		for (let i = 0; i < 30; i++) {
			const t = 1000 + i * 80;
			for (const f of [full, calm]) {
				f.fired(t);
				f.update(t + 1, MUZZLE, node);
			}
			big += full.mesh.scale.x;
			light = Math.max(light, lightOf(full).intensity);
			if (calm.mesh.visible) {
				shown++;
				small += calm.mesh.scale.x;
				dim = Math.max(dim, lightOf(calm).intensity);
			}
			for (const f of [full, calm]) for (let k = 10; k < 80; k += 10) f.update(t + k, MUZZLE, node);
		}
		expect(shown).toBe(10);
		expect(small / shown).toBeLessThan((big / 30) * 0.75);
		expect(dim).toBeLessThan(light * 0.5);
		expect(puffsOf(calm).visible).toBe(false);
		full.dispose();
		calm.dispose();
	});
});
