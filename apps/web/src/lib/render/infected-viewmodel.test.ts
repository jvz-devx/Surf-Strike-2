/**
 * First-person viewmodel motion of the ZombieRenderer in node (no canvas):
 * per-weapon kick, reload pose, and the feel inputs (draw, sway, landing dip,
 * dry-fire nudge). Zombies and hide and seek call it without feel inputs.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeldAssets } from './character/held.js';
import { GUN_KICK, restVmFeel } from '../game/gunfeel.js';
import { shippedLoad } from './shipped-models.js';
import { VM_KICK, ZombieRenderer } from './zombies.js';

const GUNS = ['pistol', 'lmg', 'sniper', 'barrett', 'striker', 'smg'] as const;
/** Rest pose of the viewmodel group. */
const REST = { x: 5, y: -4.6, z: -10 };

const vmOf = (z: ZombieRenderer) => z.vmScene.children.find((c): c is THREE.Group => c instanceof THREE.Group)!;

afterEach(() => {
	vi.restoreAllMocks();
});

describe('viewmodel kick', () => {
	it('rests in place without feel inputs (zombies, hide and seek)', () => {
		const z = new ZombieRenderer(new HeldAssets());
		for (const w of [...GUNS, 'knife', 'claws'] as const) {
			z.setWeapon(w);
			z.updateViewmodel(1000, true, 1, 0);
			const vm = vmOf(z);
			expect(vm.visible).toBe(true);
			expect(vm.position.x).toBeCloseTo(REST.x, 9);
			expect(vm.position.z).toBeCloseTo(REST.z, 9);
			expect(vm.rotation.x).toBeCloseTo(0, 9);
			expect(vm.rotation.z).toBeCloseTo(0, 9);
		}
		z.updateViewmodel(1000, false, 1, 0);
		expect(z.vmVisible).toBe(false);
		z.dispose();
	});

	it('every gun: a short push-back to its own depth, and the gun kick turns the muzzle up; at rest when both are over', () => {
		const z = new ZombieRenderer(new HeldAssets());
		for (const w of GUNS) {
			const k = VM_KICK[w]!;
			expect(k.attack).toBeLessThanOrEqual(30);
			expect(k.ms).toBeGreaterThan(k.attack * 4);
			z.setWeapon(w);
			z.fired(1000);
			const vm = vmOf(z);
			z.updateViewmodel(1000 + k.attack, true, 1, 0);
			expect(vm.position.z, w).toBeCloseTo(REST.z + k.back, 6);
			// Muzzle up: the gun kick, not the push-back curve.
			expect(vm.rotation.x, w).toBeGreaterThan(0.005);
			expect(vm.rotation.x, w).toBeLessThanOrEqual((GUN_KICK[w]!.maxPitch * Math.PI) / 180 + 1e-9);
			// The push-back return falls steadily and is mostly spent half-way.
			let prev = vm.position.z;
			for (let t = k.attack + 2; t < k.ms; t += 2) {
				z.updateViewmodel(1000 + t, true, 1, 0);
				expect(vm.position.z).toBeLessThanOrEqual(prev + 1e-9);
				prev = vm.position.z;
			}
			z.updateViewmodel(1000 + (k.attack + k.ms) / 2, true, 1, 0);
			expect(vm.position.z - REST.z).toBeLessThan(k.back * 0.3);
			z.updateViewmodel(1000 + k.ms, true, 1, 0);
			expect(vm.position.z).toBeCloseTo(REST.z, 9);
			for (let t = k.ms; t <= 2000; t += 16) z.updateViewmodel(1000 + t, true, 1, 0);
			expect(vm.rotation.x, w).toBe(0);
			expect(vm.rotation.y, w).toBe(0);
			expect(vm.rotation.z).toBeCloseTo(0, 9);
		}
		z.dispose();
	});

	it('the LMG kicks differently from the pistol', () => {
		const { lmg, pistol } = VM_KICK;
		expect(lmg!.back).toBeGreaterThan(pistol!.back);
		expect(GUN_KICK.lmg!.pitchMax).toBeLessThan(GUN_KICK.pistol!.pitchMax);
		expect(GUN_KICK.lmg!.yawMax).toBeGreaterThan(GUN_KICK.pistol!.yawMax);
	});

	it('gun kick adds up in a spray: the LMG muzzle climbs higher after several shots than after one', () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const z = new ZombieRenderer(new HeldAssets());
		z.setWeapon('lmg');
		const vm = vmOf(z);
		z.fired(1000);
		let one = 0;
		for (let t = 1000; t < 1080; t += 4) {
			z.updateViewmodel(t, true, 1, 0);
			one = Math.max(one, vm.rotation.x);
		}
		let many = 0;
		for (let shot = 1; shot < 8; shot++) {
			z.fired(1000 + shot * 80);
			for (let t = 1000 + shot * 80; t < 1080 + shot * 80; t += 4) {
				z.updateViewmodel(t, true, 1, 0);
				many = Math.max(many, vm.rotation.x);
			}
		}
		expect(many).toBeGreaterThan(one * 2);
		z.dispose();
	});

	it('automatic fire re-kicks from where the gun is: no snap to rest, it stays pushed back', () => {
		const z = new ZombieRenderer(new HeldAssets());
		z.setWeapon('lmg');
		const vm = vmOf(z);
		const k = VM_KICK.lmg!;
		let low = Infinity;
		for (let shot = 0; shot < 12; shot++) {
			const t0 = 1000 + shot * 80;
			z.updateViewmodel(t0 - 1, true, 1, 0);
			const before = vm.position.z;
			z.fired(t0);
			z.updateViewmodel(t0 + 1, true, 1, 0);
			expect(Math.abs(vm.position.z - before)).toBeLessThan(k.back * 0.2);
			if (shot > 0) for (let t = t0; t < t0 + 80; t += 4) {
				z.updateViewmodel(t, true, 1, 0);
				low = Math.min(low, vm.position.z - REST.z);
			}
		}
		expect(low).toBeGreaterThan(k.back * 0.3);
		z.dispose();
	});

	it('a weapon switch carries no kick over', () => {
		const z = new ZombieRenderer(new HeldAssets());
		z.setWeapon('barrett');
		z.fired(1000);
		z.updateViewmodel(1020, true, 1, 0);
		expect(vmOf(z).position.z).toBeGreaterThan(REST.z + 1);
		z.setWeapon('pistol');
		z.updateViewmodel(1030, true, 1, 0);
		expect(vmOf(z).position.z).toBeCloseTo(REST.z, 9);
		expect(vmOf(z).rotation.x).toBeCloseTo(0, 9);
		z.dispose();
	});
});

describe('viewmodel reload and feel', () => {
	it('reload: a code-built gun, whose hands are part of it, goes down out of the way and gets a tug back as the bolt closes', () => {
		const z = new ZombieRenderer(new HeldAssets());
		z.setWeapon('lmg');
		const vm = vmOf(z);
		z.updateViewmodel(0, true, 0.4, 0, undefined, 0);
		expect(vm.position.y).toBeLessThan(REST.y - 1.5);
		expect(vm.rotation.z).toBeCloseTo(0, 9);
		z.updateViewmodel(0, true, 0.95, 0, undefined, 0);
		expect(vm.position.z).toBeGreaterThan(REST.z + 0.5);
		z.updateViewmodel(0, true, 1, 0, undefined, 100);
		expect(vm.position.y).toBeCloseTo(REST.y, 9);
		expect(vm.rotation.z).toBeCloseTo(0, 9);
		z.dispose();
	});

	it('reload: the loaded gun turns its underside to the left hand, comes up, and lets the muzzle go away from the crosshair', async () => {
		for (const id of ['smg', 'lmg', 'sniper', 'barrett', 'striker'] as const) {
			const z = new ZombieRenderer(new HeldAssets(), shippedLoad);
			z.setWeapon(id);
			await z.preload([id]);
			const vm = vmOf(z);
			z.updateViewmodel(0, true, 0.55, 0, undefined, 0);
			// Top to the right, muzzle to the right.
			expect(vm.rotation.z, id).toBeLessThan(-0.3);
			expect(vm.rotation.y, id).toBeLessThan(-0.1);
			expect(vm.position.y, id).toBeGreaterThan(REST.y);
			z.updateViewmodel(0, true, 1, 0, undefined, 10);
			z.updateViewmodel(1000, true, 1, 0, undefined, 10);
			expect(vm.rotation.z, id).toBeCloseTo(0, 9);
			z.dispose();
		}
	});

	it('feel: the draw starts below the view and ends at rest; sway, landing dip and dry-fire nudge move the gun', () => {
		const z = new ZombieRenderer(new HeldAssets());
		z.setWeapon('pistol');
		const vm = vmOf(z);
		const f = restVmFeel();
		z.updateViewmodel(0, true, 1, 0, f);
		expect([vm.position.x, vm.position.y, vm.position.z]).toEqual([REST.x, REST.y, REST.z]);
		expect([vm.rotation.x, vm.rotation.y, vm.rotation.z]).toEqual([0, 0, 0]);

		// Lowered: the whole gun is under the bottom edge of the viewmodel camera (no pop on a switch).
		f.lower = 1;
		z.updateViewmodel(0, true, 1, 0, f);
		const edge = Math.tan((z.vmCamera.fov * Math.PI) / 360) * Math.abs(vm.position.z);
		expect(vm.position.y).toBeLessThan(-edge - 6);
		expect(vm.rotation.x).toBeLessThan(-0.5);
		f.lower = 0.5;
		z.updateViewmodel(0, true, 1, 0, f);
		expect(vm.position.y).toBeLessThan(REST.y);
		expect(vm.position.y).toBeGreaterThan(REST.y - 11);

		Object.assign(f, restVmFeel(), { x: 0.5, y: -0.3, roll: 0.04, yaw: -0.03, pitch: 0.02 });
		z.updateViewmodel(0, true, 1, 0, f);
		expect(vm.position.x).toBeCloseTo(REST.x + 0.5, 9);
		expect(vm.position.y).toBeCloseTo(REST.y - 0.3, 9);
		expect(vm.rotation.z).toBeCloseTo(0.04, 9);
		expect(vm.rotation.y).toBeCloseTo(-0.03, 9);
		expect(vm.rotation.x).toBeCloseTo(0.02, 9);

		Object.assign(f, restVmFeel(), { land: 1 });
		z.updateViewmodel(0, true, 1, 0, f);
		expect(vm.position.y).toBeLessThan(REST.y - 1);
		Object.assign(f, restVmFeel(), { dry: 1 });
		z.updateViewmodel(0, true, 1, 0, f);
		expect(vm.position.z).toBeGreaterThan(REST.z);
		expect(vm.rotation.x).toBeLessThan(0);

		// Melee weapons take the same inputs.
		z.setWeapon('knife');
		Object.assign(f, restVmFeel(), { lower: 1 });
		z.updateViewmodel(0, true, 1, 0, f);
		expect(vm.position.y).toBeLessThan(-edge - 6);
		z.dispose();
	});
});
