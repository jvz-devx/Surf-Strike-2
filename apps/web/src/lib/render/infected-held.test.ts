/**
 * Remote characters with the real scene objects (node: a stub `document`
 * stands in for the name-tag canvas): the held weapon and its swap, the
 * throwing knife in the claw, muzzle flash and muzzle point,
 * the hit flash and the turn ease. Also that the looks of the other modes
 * still apply.
 */
import { WEAPONS, type WeaponId } from '@surf/shared';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HELD, HeldAssets, type HeldItem } from './character/held.js';
import { PAL } from './character/mesh-kit.js';
import { animate, bonePoint, character, roleTop, standing, topColor } from './players-testkit.js';
import { emptyPose, HIT_FLASH_MS, MUZZLE_FLASH_MS, RemotePlayers, TURN_EASE_MS } from './players.js';

const GUNS = (Object.keys(HELD) as HeldItem[]).filter((w) => WEAPONS[w].magazine > 0);

beforeAll(() => {
	// makeTag draws on a canvas; node has none. A context-less canvas keeps the real code path.
	vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
});
afterAll(() => {
	vi.unstubAllGlobals();
});

/** Players with their own held assets, disposed together. */
function crowd() {
	const assets = new HeldAssets();
	const p = new RemotePlayers(assets);
	return {
		p,
		assets,
		dispose() {
			p.dispose();
			assets.dispose();
		}
	};
}

/** A player in play at a Source pose. */
function avatar(p: RemotePlayers, id: number, x = 0, y = 0, z = 0, yaw = 0): THREE.Object3D {
	p.upsert(id, `P${id}`);
	p.setPose(id, standing(x, y, z, yaw), true);
	return p.group.children[p.group.children.length - 1]!;
}

/** Let a pose or a swap settle. */
function settle(p: RemotePlayers, now = 0): void {
	for (let i = 0; i < 60; i++) animate(p, now, 1 / 30);
}

const shown = (root: THREE.Object3D, name: string) => root.getObjectByName(name)?.visible ?? false;
const glow = (root: THREE.Object3D) => character(root).material.emissive.r;

describe('looks of the other modes', () => {
	it('tag, zombie and hide and seek looks apply, and a hit flash returns to them', () => {
		const { p, dispose } = crowd();
		const root = avatar(p, 1);
		const own = topColor(root);
		p.setIt(1, true);
		expect(topColor(root)).toBe(roleTop('it'));
		p.flash(1, 0);
		animate(p, 10);
		expect(glow(root)).toBeGreaterThan(0.5);
		animate(p, HIT_FLASH_MS + 1);
		expect(glow(root)).toBe(0);
		expect(topColor(root)).toBe(roleTop('it'));
		p.setIt(1, false);
		p.setZombie(1, true);
		expect(topColor(root)).toBe(roleTop('zombie'));
		p.setZombie(1, false);
		p.setSeeker(1, true);
		expect(topColor(root)).toBe(roleTop('seeker'));
		p.setSeeker(1, false);
		expect(topColor(root)).toBe(own);
		expect(p.feedback(1)).toEqual({ held: null, knife: false, muzzleFlash: false, flashing: false, easing: false });
		dispose();
	});

	it('act() moves the arms of any player, with no muzzle flash (Zombie Run, hide and seek)', () => {
		const { p, dispose } = crowd();
		const root = avatar(p, 1);
		p.setHeld(1, 'pistol');
		settle(p);
		const rest = bonePoint(root, 'handR');
		p.act(1, 'fire');
		animate(p, 0, 0.02);
		expect(bonePoint(root, 'handR').distanceTo(rest)).toBeGreaterThan(0.5);
		expect(shown(root, 'muzzle')).toBe(false);
		dispose();
	});
});

describe('held weapons', () => {
	it('a held gun is one mesh with shared geometry and material, in the right hand; both hands reach it', () => {
		const { p, assets, dispose } = crowd();
		const a = avatar(p, 1);
		const b = avatar(p, 2, 100);
		for (const id of [1, 2]) p.setHeld(id, 'barrett');
		settle(p);
		const ma = a.getObjectByName('held') as THREE.Mesh;
		const mb = b.getObjectByName('held') as THREE.Mesh;
		expect(ma.geometry).toBe(mb.geometry);
		expect(ma.geometry).toBe(assets.geometry('barrett'));
		expect(ma.material).toBe(mb.material);
		const grip = ma.getWorldPosition(new THREE.Vector3());
		expect(bonePoint(a, 'handR').distanceTo(grip)).toBeCloseTo(3, 1);
		expect(bonePoint(a, 'handL').x).toBeGreaterThan(bonePoint(a, 'handR').x + 4);
		dispose();
	});

	it('the left hand closes around the fore-end of every long gun, standing and ducked, at any pitch', () => {
		for (const w of GUNS.filter((g) => HELD[g].hold === 'long'))
			for (const ducked of [false, true])
				for (const pitch of [-60, 0, 60]) {
					const { p, dispose } = crowd();
					const root = avatar(p, 1);
					p.setHeld(1, w);
					p.setPose(1, standing(0, 0, 0, 0, ducked, pitch), true);
					settle(p);
					const gun = root.getObjectByName('held') as THREE.Mesh;
					const want = gun.localToWorld(new THREE.Vector3(...HELD[w].fore));
					// The fist is 3 past the wrist bone.
					expect(Math.abs(bonePoint(root, 'handL').distanceTo(want) - 3), `${w} ${ducked} ${pitch}`).toBeLessThan(1);
					dispose();
				}
	});

	it('a swap dips and shows the new weapon on the same mesh; every weapon id poses without throwing; null empties the hands', () => {
		const { p, assets, dispose } = crowd();
		const root = avatar(p, 1);
		p.setHeld(1, 'lmg');
		settle(p);
		const mesh = root.getObjectByName('held') as THREE.Mesh;
		p.setHeld(1, 'smg');
		expect(p.feedback(1)!.held).toBe('smg');
		// Not drawn yet in the first frame of the swap: no muzzle to fire from.
		expect(p.muzzle(1, emptyPose())).toBe(false);
		settle(p);
		expect(mesh.geometry).toBe(assets.geometry('smg'));
		expect(p.muzzle(1, emptyPose())).toBe(true);
		for (const w of Object.keys(WEAPONS) as WeaponId[]) {
			p.setHeld(1, w);
			settle(p);
			expect(p.feedback(1)!.held).toBe(w);
		}
		p.setHeld(1, 'pistol');
		settle(p);
		expect(shown(root, 'held')).toBe(true);
		expect(root.getObjectsByProperty('name', 'held')).toHaveLength(1);
		p.setHeld(1, null);
		settle(p);
		expect(shown(root, 'held')).toBe(false);
		dispose();
	});

	it('infected show talons, and the throwing knife in the left claw while they have it', () => {
		const { p, dispose } = crowd();
		const root = avatar(p, 1);
		p.setInfected(1, 'infected');
		const plain = character(root).geometry;
		p.setHeld(1, 'claws', true);
		expect(character(root).geometry).not.toBe(plain);
		settle(p);
		expect(shown(root, 'held')).toBe(false);
		const knife = root.getObjectByName('knife-hand')!;
		expect(knife.visible).toBe(true);
		expect(knife.getWorldPosition(new THREE.Vector3()).distanceTo(bonePoint(root, 'handL'))).toBeLessThan(4);
		expect(p.feedback(1)).toMatchObject({ held: 'claws', knife: true });
		p.setHeld(1, 'claws', false); // thrown
		expect(knife.visible).toBe(false);
		p.setHeld(1, 'claws', true); // picked up
		expect(knife.visible).toBe(true);
		dispose();
	});

	it('Patient Zero of an older server may still hold a gun: it is drawn, the throwing knife is not', () => {
		const { p, dispose } = crowd();
		const root = avatar(p, 1);
		p.setInfected(1, 'alpha');
		p.setHeld(1, 'striker', true);
		settle(p);
		expect(p.feedback(1)).toMatchObject({ held: 'striker', knife: true });
		expect(shown(root, 'held')).toBe(true);
		expect(shown(root, 'knife-hand')).toBe(false);
		p.setHeld(1, 'claws', true); // dropped the gun after the first infection
		expect(shown(root, 'knife-hand')).toBe(true);
		dispose();
	});

	it('the weapon follows the view pitch, also on a hunched body', () => {
		for (const role of ['none', 'alpha'] as const) {
			const { p, dispose } = crowd();
			avatar(p, 1);
			p.setInfected(1, role);
			p.setHeld(1, 'lmg');
			const at = (pitch: number) => {
				p.setPose(1, standing(0, 0, 0, 0, false, pitch), true);
				settle(p);
				const out = emptyPose();
				p.muzzle(1, out);
				return out;
			};
			const up = at(-45);
			const level = at(0);
			const down = at(45);
			expect(up.z).toBeGreaterThan(level.z + 12);
			expect(down.z).toBeLessThan(level.z - 12);
			dispose();
		}
	});
});

describe('remote shots', () => {
	it('a shot flashes at the muzzle and kicks the arms, briefly', () => {
		const { p, dispose } = crowd();
		const root = avatar(p, 1);
		p.setHeld(1, 'lmg');
		settle(p, 1000);
		const rest = bonePoint(root, 'handR');
		p.fired(1, 1000);
		const flash = root.getObjectByName('muzzle')!;
		expect(flash.visible).toBe(true);
		expect(flash.position.toArray()).toEqual([...HELD.lmg.muzzle!]);
		expect(p.feedback(1)!.muzzleFlash).toBe(true);
		animate(p, 1010, 0.02);
		expect(bonePoint(root, 'handR').distanceTo(rest)).toBeGreaterThan(0.5);
		animate(p, 1000 + MUZZLE_FLASH_MS);
		expect(flash.visible).toBe(false);
		settle(p, 2000);
		// Breathing moves it a little.
		expect(bonePoint(root, 'handR').distanceTo(rest)).toBeLessThan(0.6);
		dispose();
	});

	it('a swap takes the flash away', () => {
		const { p, dispose } = crowd();
		const root = avatar(p, 1);
		p.setHeld(1, 'striker');
		settle(p);
		p.fired(1, 100);
		p.setHeld(1, 'knife');
		expect(p.feedback(1)!.muzzleFlash).toBe(false);
		expect(shown(root, 'muzzle')).toBe(false);
		dispose();
	});

	it('muzzle(): a Source point in front of the player, at gun height, at the barrel end of every gun', () => {
		for (const w of GUNS) {
			const { p, dispose } = crowd();
			const root = avatar(p, 1, 100, 200, 8, 90);
			p.setHeld(1, w);
			settle(p);
			const out = { x: 0, y: 0, z: 0 };
			expect(p.muzzle(1, out)).toBe(true);
			// Facing +y: the muzzle is ahead, near the centre line, between hip and head.
			expect(out.y).toBeGreaterThan(200 + 20);
			expect(Math.abs(out.x - 100)).toBeLessThan(8);
			expect(out.z).toBeGreaterThan(8 + 40);
			expect(out.z).toBeLessThan(8 + 66);
			// The front of the drawn mesh.
			const gun = root.getObjectByName('held') as THREE.Mesh;
			const box = new THREE.Box3().setFromObject(gun, true);
			expect(Math.abs(-box.min.z - out.y)).toBeLessThan(1);
			dispose();
		}
	});

	it('muzzle() is false without a drawn gun: empty hands, claws, knife, a hidden player, cl_hideplayers', () => {
		const { p, dispose } = crowd();
		avatar(p, 1);
		const out = { x: 0, y: 0, z: 0 };
		settle(p);
		expect(p.muzzle(1, out)).toBe(false);
		for (const w of ['claws', 'knife'] as const) {
			p.setHeld(1, w);
			settle(p);
			expect(p.muzzle(1, out)).toBe(false);
		}
		p.setHeld(1, 'pistol');
		settle(p);
		expect(p.muzzle(1, out)).toBe(true);
		p.setHidden(true);
		expect(p.muzzle(1, out)).toBe(false);
		p.setHidden(false);
		p.setPose(1, standing(0, 0, 0), false);
		expect(p.muzzle(1, out)).toBe(false);
		expect(p.muzzle(99, out)).toBe(false);
		dispose();
	});

	it('claws and the knife swing the right arm instead and come back, no flash', () => {
		for (const w of ['claws', 'knife'] as const) {
			const { p, dispose } = crowd();
			const root = avatar(p, 1);
			if (w === 'claws') p.setInfected(1, 'infected');
			p.setHeld(1, w);
			settle(p);
			const rest = bonePoint(root, 'handR');
			p.fired(1, 0);
			let most = 0;
			for (let i = 0; i < 12; i++) {
				animate(p, i * 33, 1 / 30);
				most = Math.max(most, bonePoint(root, 'handR').distanceTo(rest));
			}
			expect(most).toBeGreaterThan(5);
			expect(shown(root, 'muzzle')).toBe(false);
			settle(p);
			expect(bonePoint(root, 'handR').distanceTo(rest)).toBeLessThan(1.5);
			dispose();
		}
	});
});

describe('hit flash', () => {
	it('the whole character glows white for HIT_FLASH_MS, also one hidden by cl_hideplayers', () => {
		const { p, dispose } = crowd();
		const root = avatar(p, 1);
		p.setInfected(1, 'infected');
		p.flash(1, 500);
		animate(p, 510);
		const e = character(root).material.emissive;
		expect([e.r, e.g, e.b].every((v) => v > 0.5)).toBe(true);
		expect(p.feedback(1)!.flashing).toBe(true);
		animate(p, 500 + HIT_FLASH_MS);
		expect(e.getHex()).toBe(0);
		expect(topColor(root)).toBe(roleTop('infected'));
		p.setHidden(true);
		p.flash(1, 1000);
		animate(p, 1010);
		animate(p, 1000 + HIT_FLASH_MS);
		expect(p.feedback(1)!.flashing).toBe(false);
		dispose();
	});
});

describe('turn ease', () => {
	it('a survivor announced by turn() eases into the infected colours when the role flips; posture and claws switch at once', () => {
		const { p, dispose } = crowd();
		const root = avatar(p, 1);
		p.setHeld(1, 'smg');
		const own = topColor(root);
		p.turn(1, 1000);
		animate(p, 1000);
		expect(topColor(root)).toBe(own);
		p.setInfected(1, 'infected', 1100);
		p.setHeld(1, 'claws', true);
		expect(p.feedback(1)!.easing).toBe(true);
		// The hit capsules hunch and raise the claws at once, so the drawn body does too.
		expect(p.model(1)!.animator.posture).toBe('infected');
		expect(p.model(1)!.held).toBe('claws');
		animate(p, 1100);
		expect(topColor(root)).toBe(own);
		const eye = () => character(root).material.palette[PAL.iris]!.w;
		const dark = eye();
		animate(p, 1100 + TURN_EASE_MS / 2);
		const mid = topColor(root);
		expect(mid).not.toBe(own);
		expect(mid).not.toBe(roleTop('infected'));
		expect(eye()).toBeGreaterThan(dark + 0.2); // the eyes light up over the ease
		animate(p, 1100 + TURN_EASE_MS);
		expect(topColor(root)).toBe(roleTop('infected'));
		expect(eye()).toBe(1);
		expect(p.feedback(1)!.easing).toBe(false);
		dispose();
	});

	it('the state before the event: turn() eases from the player colours', () => {
		const { p, dispose } = crowd();
		const root = avatar(p, 1);
		const own = topColor(root);
		p.setInfected(1, 'infected', 1000);
		expect(topColor(root)).toBe(roleTop('infected'));
		p.turn(1, 1020);
		animate(p, 1020);
		expect(topColor(root)).toBe(own);
		animate(p, 1020 + TURN_EASE_MS);
		expect(topColor(root)).toBe(roleTop('infected'));
		dispose();
	});

	it('no ease without the event (joining a running round), for a stale turn(), or back to survivor', () => {
		const { p, dispose } = crowd();
		const a = avatar(p, 1);
		const b = avatar(p, 2);
		const own = topColor(a);
		p.setInfected(1, 'infected', 1000);
		animate(p, 1000);
		expect(topColor(a)).toBe(roleTop('infected'));
		expect(p.feedback(1)!.easing).toBe(false);
		p.turn(2, 1000);
		p.setInfected(2, 'alpha', 9000);
		animate(p, 9000);
		expect(topColor(b)).toBe(roleTop('alpha'));
		// Round reset: survivors again, at once, also in the middle of an ease.
		p.turn(1, 9000);
		p.setInfected(1, 'none', 9100);
		animate(p, 9100);
		expect(topColor(a)).toBe(own);
		expect(p.feedback(1)!.easing).toBe(false);
		dispose();
	});

	it('a hit flash during the ease leaves the ease running', () => {
		const { p, dispose } = crowd();
		const root = avatar(p, 1);
		const own = topColor(root);
		p.turn(1, 0);
		p.setInfected(1, 'infected', 0);
		p.flash(1, 100);
		animate(p, 100 + HIT_FLASH_MS / 2);
		expect(glow(root)).toBeGreaterThan(0.5);
		animate(p, TURN_EASE_MS / 2);
		expect(glow(root)).toBe(0);
		expect([own, roleTop('infected')]).not.toContain(topColor(root));
		dispose();
	});
});

describe('pose, removal', () => {
	it('pose() reads back where the player stands; false when they are not in play', () => {
		const { p, dispose } = crowd();
		avatar(p, 1, 10, 20, 30, 40);
		const out = emptyPose();
		expect(p.pose(1, out)).toBe(true);
		expect(out).toMatchObject({ x: 10, y: 20, z: 30, yaw: 40, ducked: false });
		p.setHidden(true);
		expect(p.pose(1, out)).toBe(true); // cl_hideplayers does not take them out of play
		p.setPose(1, standing(0, 0, 0), false);
		expect(p.pose(1, out)).toBe(false);
		expect(p.pose(9, out)).toBe(false);
		dispose();
	});

	it('held geometry and material are shared: they go with the assets, not with a player', () => {
		const { p, assets } = crowd();
		const a = avatar(p, 1);
		const b = avatar(p, 2);
		p.setHeld(1, 'striker');
		p.setInfected(2, 'infected');
		p.setHeld(2, 'claws', true);
		settle(p);
		p.fired(1, 0);
		const gun = a.getObjectByName('held') as THREE.Mesh;
		const knife = b.getObjectByName('knife-hand') as THREE.Mesh;
		const flash = a.getObjectByName('muzzle') as THREE.Mesh;
		expect(knife.material).toBe(gun.material);
		const disposed: string[] = [];
		for (const [name, o] of [
			['striker', gun.geometry],
			['knife', knife.geometry],
			['flash', flash.geometry],
			['flashMat', flash.material as THREE.Material],
			['material', gun.material as THREE.Material]
		] as const)
			o.addEventListener('dispose', () => disposed.push(name));
		p.remove(1);
		p.clear();
		p.dispose();
		expect([...p.ids()]).toEqual([]);
		expect(p.group.children).toHaveLength(0);
		expect(disposed).toEqual([]);
		assets.dispose();
		expect(disposed.sort()).toEqual(['flash', 'flashMat', 'knife', 'material', 'striker']);
	});
});
