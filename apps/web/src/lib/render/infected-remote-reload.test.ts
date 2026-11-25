/**
 * Reloads of remote players (RemotePlayers.reload): driven by the clock, ended
 * early by a swap, a shot or a role change, right on throttled, off-screen
 * and hidden characters, and pooled: after the first reload nothing more is
 * built.
 */
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HeldAssets } from './character/held.js';
import { InfectedFx } from './infected-fx.js';
import { animate, bonePoint, standing } from './players-testkit.js';
import { RemotePlayers } from './players.js';

beforeAll(() => {
	vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
	// Same idle phase for every character.
	vi.spyOn(Math, 'random').mockReturnValue(0.4);
});
afterAll(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function crowd(n = 1) {
	const assets = new HeldAssets();
	const p = new RemotePlayers(assets);
	const roots: THREE.Object3D[] = [];
	for (let id = 1; id <= n; id++) {
		p.upsert(id, `P${id}`);
		p.setPose(id, standing(0, id * 100, 0), true);
		p.setHeld(id, 'barrett');
		roots.push(p.group.children.at(-1)!);
	}
	for (let i = 0; i < 60; i++) animate(p, 0, 1 / 30);
	const parts = (id = 1) => p.model(id)!.partsShown;
	return {
		p,
		assets,
		roots,
		parts,
		dispose() {
			p.dispose();
			assets.dispose();
		}
	};
}
const MS = 3200;

describe('remote reloads', () => {
	it('follow the clock: the same moment at any frame rate, and over at the end', () => {
		const a = crowd();
		const b = crowd();
		for (const c of [a, b]) c.p.reload(1, 'barrett', 1000, MS);
		const end = 1000 + MS * 0.55;
		for (let t = 1000; t < end; t += 5) animate(a.p, t, 0.005);
		for (let t = 1000; t < end; t += 70) animate(b.p, t, 0.07);
		for (const c of [a, b]) animate(c.p, end, 0.001);
		expect(a.parts()).toContain('mag');
		expect(bonePoint(a.roots[0]!, 'handL').distanceTo(bonePoint(b.roots[0]!, 'handL'))).toBeLessThan(0.4);
		expect(a.p.reloading(1)).toBe(MS);
		animate(a.p, 1000 + MS, 0.01);
		expect(a.p.reloading(1)).toBe(0);
		for (let i = 0; i < 12; i++) animate(a.p, 1000 + MS + i * 16);
		expect(a.parts()).toEqual([]);
		a.dispose();
		b.dispose();
	});

	it('an event stamped after the frame time, unknown players, melee and a time of 0 are harmless', () => {
		const { p, parts, dispose } = crowd();
		p.reload(99, 'barrett', 0, MS);
		p.reload(1, 'claws', 0, MS);
		p.reload(1, 'barrett', 0, 0);
		expect(p.reloading(1)).toBe(0);
		p.reload(1, 'knife', 0, 500);
		for (let i = 0; i < 10; i++) animate(p, i * 16);
		expect(parts()).toEqual([]);
		p.reload(1, 'barrett', 500, MS);
		animate(p, 490);
		expect(p.reloading(1)).toBe(MS);
		p.stopReload(99);
		dispose();
	});

	it('a swap away, a shot and turning end it; a swap to the gun that is being reloaded does not', () => {
		const ends: ((p: RemotePlayers) => void)[] = [
			(p) => p.setHeld(1, 'pistol'),
			(p) => p.setHeld(1, 'claws', true),
			(p) => p.setHeld(1, null),
			(p) => p.fired(1, 2000),
			(p) => p.act(1, 'fire'),
			(p) => p.turn(1, 2000),
			(p) => p.stopReload(1),
			(p) => p.stopReloads()
		];
		for (const end of ends) {
			const { p, parts, dispose } = crowd();
			p.reload(1, 'barrett', 1000, MS);
			for (let t = 1000; t < 2500; t += 16) animate(p, t);
			expect(parts()).toContain('mag');
			end(p);
			expect(p.reloading(1)).toBe(0);
			// Home within 150 ms.
			for (let t = 0; t <= 160; t += 16) animate(p, 2500 + t);
			expect(parts()).toEqual([]);
			dispose();
		}
		// The mode state is behind: the pistol's reload arrives first, the swap to it up to 250 ms later.
		const { p, parts, dispose } = crowd();
		p.reload(1, 'pistol', 1000, 1500);
		for (let t = 1000; t < 1200; t += 16) animate(p, t);
		expect(parts()).toEqual([]);
		p.setHeld(1, 'pistol');
		expect(p.reloading(1)).toBe(1500);
		for (let t = 1200; t < 1800; t += 16) animate(p, t);
		expect(parts()).toContain('mag');
		// Nothing else ends it: the same weapon again, the knife on the hip.
		p.setHeld(1, 'pistol', true);
		expect(p.reloading(1)).toBe(1500);
		dispose();
	});

	it('stopReloads keeps those it is told to', () => {
		const { p, dispose } = crowd(3);
		for (const id of [1, 2]) p.reload(id, 'barrett', 0, MS);
		p.stopReloads((id) => id === 2);
		expect([1, 2, 3].map((id) => p.reloading(id))).toEqual([0, MS, 0]);
		p.remove(2);
		expect(p.reloading(2)).toBe(0);
		p.clear();
		// The same id comes back (map change): the plain hold.
		p.upsert(1, 'P1');
		expect(p.reloading(1)).toBe(0);
		dispose();
	});

	it('a far character that animates on every 4th frame, and one that was off screen, end in the right pose', () => {
		const ref = crowd();
		const far = crowd();
		const off = crowd();
		for (const c of [ref, far, off]) c.p.reload(1, 'barrett', 0, MS);
		const frames = Math.ceil(MS / 16) + 30;
		for (let i = 0; i < frames; i++) {
			const t = i * 16;
			animate(ref.p, t, 0.016);
			far.p.update({ dt: 0.016, distance: () => 6000 }, t);
			// Off screen from the middle of the reload on.
			off.p.update({ dt: 0.016, distance: () => (i < 100 ? 100 : -1) }, t);
			if (i === 120) {
				expect(ref.parts()).toContain('mag');
				expect(far.parts()).toContain('mag');
				expect(bonePoint(far.roots[0]!, 'handL').distanceTo(bonePoint(ref.roots[0]!, 'handL'))).toBeLessThan(6);
			}
		}
		// Back on screen: whole in its first frame.
		off.p.update({ dt: 0.016, distance: () => 100 }, frames * 16);
		for (const c of [ref, far, off]) {
			expect(c.parts()).toEqual([]);
			expect((c.roots[0]!.getObjectByName('held') as THREE.Mesh).geometry).toBe(c.assets.geometry('barrett'));
			expect(bonePoint(c.roots[0]!, 'handL').distanceTo(bonePoint(ref.roots[0]!, 'handL'))).toBeLessThan(0.5);
		}
		for (const c of [ref, far, off]) c.dispose();
	});

	it('hidden and shown again (spectated): in the middle of it, or done', () => {
		const { p, parts, dispose } = crowd();
		p.reload(1, 'barrett', 0, MS);
		p.setPose(1, standing(0, 0, 0), false);
		for (let t = 0; t < MS * 0.55; t += 16) animate(p, t);
		p.setPose(1, standing(0, 0, 0), true);
		for (let i = 0; i < 8; i++) animate(p, MS * 0.55 + i * 16);
		expect(parts()).toContain('mag');
		p.setPose(1, standing(0, 0, 0), false);
		animate(p, MS + 50);
		p.setPose(1, standing(0, 0, 0), true);
		animate(p, MS + 66);
		expect([p.reloading(1), parts()]).toEqual([0, []]);
		dispose();
	});

	it('a corpse takes over the pose of a reloading player without gun or magazine', () => {
		const { p, assets, dispose } = crowd();
		const fx = new InfectedFx(assets);
		p.reload(1, 'barrett', 0, MS);
		for (let t = 0; t < MS * 0.55; t += 16) animate(p, t);
		fx.corpse({ x: 0, y: 0, z: 0, yaw: 0, id: 1 }, 'alpha', 1000, p.model(1));
		for (const n of ['held', 'mag', 'mag-drop', 'held-act']) expect(fx.group.getObjectByName(n), n).toBeUndefined();
		fx.dispose();
		dispose();
	});

	it('pooled: after the first reload of a gun nothing more is built, for this player or the next', () => {
		const { p, assets, roots, dispose } = crowd(4);
		const count = () => {
			let n = 0;
			for (const r of roots) r.traverse(() => void n++);
			return n;
		};
		const before = count();
		const run = (id: number, from: number) => {
			p.reload(id, 'barrett', from, MS);
			for (let t = from; t < from + MS + 300; t += 16) animate(p, t);
		};
		run(1, 0);
		const first = count();
		// Magazine and charging handle.
		expect(first).toBe(before + 2);
		expect(assets.splits).toBe(1);
		const parts = assets.parts('barrett')!;
		const mag = roots[0]!.getObjectByName('mag');
		for (let i = 1; i < 4; i++) run(1, i * 10_000);
		expect(count()).toBe(first);
		expect(roots[0]!.getObjectByName('mag')).toBe(mag);
		for (const id of [2, 3, 4]) run(id, 50_000);
		expect(count()).toBe(before + 8);
		expect(assets.splits).toBe(1);
		expect(assets.parts('barrett')).toBe(parts);
		for (const r of roots) {
			expect((r.getObjectByName('mag') as THREE.Mesh).geometry).toBe(parts.mag);
			expect((r.getObjectByName('mag') as THREE.Mesh).material).toBe(assets.material);
			expect((r.getObjectByName('held') as THREE.Mesh).geometry).toBe(assets.geometry('barrett'));
		}
		dispose();
	});

	it('an avatar that shoots through act (Zombie Run) works the bolt too', () => {
		const { p, parts, dispose } = crowd();
		p.setHeld(1, 'sniper');
		for (let i = 0; i < 60; i++) animate(p, i * 16);
		p.act(1, 'fire');
		for (let i = 0; i < 30; i++) animate(p, 1000 + i * 16);
		expect(parts()).toEqual(['mag', 'held-act']);
		for (let i = 0; i < 60; i++) animate(p, 2000 + i * 16);
		expect(parts()).toEqual([]);
		dispose();
	});
});
