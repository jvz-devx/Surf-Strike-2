import { describe, expect, it } from 'vitest';
import { ZombieBuffer, type ZombieSample } from './zombie-interp.js';

const z = (id: number, x: number, yaw = 0) => ({ id, x, y: 0, z: 0, yaw, flags: 0, hp: 1 });

describe('zombie interpolation', () => {
	it('interpolates position, yaw and the sim tick between frames', () => {
		const b = new ZombieBuffer();
		b.push({ tick: 100, zombies: [z(1, 0, 170)] }, 1000);
		b.push({ tick: 102, zombies: [z(1, 100, -170)] }, 1031.25);
		const out: ZombieSample[] = [];
		b.sample(1015.625, out);
		expect(out.length).toBe(1);
		expect(out[0]!.x).toBeCloseTo(50);
		expect(Math.abs(out[0]!.yaw)).toBeCloseTo(180); // shortest way round
		expect(b.tick).toBeCloseTo(101);
	});

	it('new zombies appear with the newer frame, killed ones vanish', () => {
		const b = new ZombieBuffer();
		b.push({ tick: 1, zombies: [z(1, 0)] }, 0);
		b.push({ tick: 2, zombies: [z(2, 50)] }, 100);
		const out: ZombieSample[] = [];
		expect(b.sample(25, out).map((s) => s.id)).toEqual([1]);
		expect(b.sample(75, out).map((s) => s.id)).toEqual([2]);
	});

	it('holds the last frame, ignores stale frames, snaps big jumps', () => {
		const b = new ZombieBuffer();
		b.push({ tick: 5, zombies: [z(1, 0)] }, 0);
		b.push({ tick: 4, zombies: [z(1, 999)] }, 10); // older tick: dropped
		b.push({ tick: 6, zombies: [z(1, 4000)] }, 100);
		const out: ZombieSample[] = [];
		expect(b.sample(50, out)[0]!.x).toBe(4000);
		expect(b.sample(500, out)[0]!.x).toBe(4000);
		b.clear();
		expect(b.sample(0, out)).toEqual([]);
	});
});
