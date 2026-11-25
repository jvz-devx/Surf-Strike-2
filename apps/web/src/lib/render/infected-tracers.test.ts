/**
 * Tracer pool of the shared viewmodel renderer (real scene objects): sized
 * for one tracer per shotgun pellet from several players at once, expired
 * tracers reused, and the oldest replaced when the pool is full.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HeldAssets } from './character/held.js';
import { MAX_TRACERS, ZombieRenderer } from './zombies.js';

const lines = (z: ZombieRenderer) => z.group.children.filter((c): c is THREE.Line => c instanceof THREE.Line);
const shown = (z: ZombieRenderer) => lines(z).filter((l) => l.visible);
const endX = (l: THREE.Line) => (l.geometry.getAttribute('position') as THREE.BufferAttribute).getX(1);
const O = { x: 0, y: 0, z: 0 };

describe('tracer pool', () => {
	it('holds every pellet of several shotgun volleys in the same instant', () => {
		const z = new ZombieRenderer(new HeldAssets());
		expect(MAX_TRACERS).toBeGreaterThanOrEqual(8 * 8);
		for (let shooter = 0; shooter < 6; shooter++) for (let pellet = 0; pellet < 8; pellet++) z.tracer(O, { x: shooter * 8 + pellet + 1, y: 2, z: 3 }, 1000);
		z.update(1000);
		expect(shown(z)).toHaveLength(48);
		expect(new Set(shown(z).map(endX)).size).toBe(48);
		// Source → Three: (x, y, z) → (x, z, −y).
		const pos = lines(z)[0]!.geometry.getAttribute('position') as THREE.BufferAttribute;
		expect([pos.getX(1), pos.getY(1), pos.getZ(1)]).toEqual([1, 3, -2]);
		z.dispose();
	});

	it('expired tracers are hidden and reused', () => {
		const z = new ZombieRenderer(new HeldAssets());
		for (let i = 0; i < 10; i++) z.tracer(O, { x: i + 1, y: 0, z: 0 }, 1000);
		z.update(1000 + 200);
		expect(shown(z)).toHaveLength(0);
		for (let i = 0; i < 10; i++) z.tracer(O, { x: 100 + i, y: 0, z: 0 }, 1300);
		expect(lines(z)).toHaveLength(10);
		expect(shown(z)).toHaveLength(10);
		z.dispose();
	});

	it('a full pool replaces the oldest tracer, not always the first', () => {
		const z = new ZombieRenderer(new HeldAssets());
		// All inside one tracer lifetime, each a little later than the one before.
		for (let i = 0; i < MAX_TRACERS; i++) z.tracer(O, { x: i + 1, y: 0, z: 0 }, 1000 + i * 0.1);
		expect(lines(z)).toHaveLength(MAX_TRACERS);
		for (let i = 0; i < 3; i++) z.tracer(O, { x: 1000 + i, y: 0, z: 0 }, 1020 + i * 0.1);
		expect(lines(z)).toHaveLength(MAX_TRACERS);
		const ends = lines(z).map(endX);
		// The three oldest (ends 1, 2, 3) made room; the three new ones are all there.
		expect(ends.slice(0, 3)).toEqual([1000, 1001, 1002]);
		expect(ends[3]).toBe(4);
		z.dispose();
	});
});
