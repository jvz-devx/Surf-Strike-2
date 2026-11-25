/**
 * Practice targets are drawn holding claws (raised arms), so their hit pose
 * must raise the same arms: a shot through a forearm hits.
 */
import { playerPoint } from '@surf/shared';
import { describe, expect, it } from 'vitest';
import type { InfHost } from './infected.js';
import { InfPractice } from './infected-practice.js';

const SPAWNS = [
	{ pos: { x: 0, y: 0, z: 0.25 }, yaw: 0 },
	{ pos: { x: 1000, y: 0, z: 0.25 }, yaw: 180 },
	{ pos: { x: 0, y: 1000, z: 0.25 }, yaw: 0 },
	{ pos: { x: 1000, y: 1000, z: 0.25 }, yaw: 180 }
];

/** A host that answers `spawns` and nothing else (no renderers, no sounds). */
const host = new Proxy(
	{},
	{ get: (_t, key) => (key === 'spawns' ? () => SPAWNS : () => null) }
) as unknown as InfHost;

describe('practice targets and the held pose', () => {
	it('a shot through a raised forearm hits (the hit pose holds claws like the avatar)', () => {
		const p = new InfPractice(host, null, () => 0);
		p.start(0, { x: 0, y: 0, z: 0.25 }, { x: 0, y: 0, z: 64 });
		const t = p.targets().find((q) => q.alive)!;
		expect(t).toBeDefined();
		expect(t.pose.held).toBe('claws');
		expect(t.pose.pitch).toBe(0);
		const at = playerPoint(t.pose, 'foreArmR', 0.8);
		// Straight down through the forearm, which is out in front of the body.
		const hit = p.shot(0, { x: at.x, y: at.y, z: at.z + 40 }, { x: 0, y: 0, z: -1 }, 'pistol', 0, -1);
		expect(hit).not.toBeNull();
	});
});
