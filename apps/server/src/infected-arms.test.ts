/**
 * The arms through the server mode (docs/modes.md#infected): the hit boxes of
 * a player follow what they hold and the view pitch of their state packets,
 * the way every client draws them. Survivors shoot Patient Zero's raised
 * claws; Patient Zero's claws reach the hands on a survivor's rifle. The host's `state()` helper
 * sends no pitch, so the packets are built here.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlayerPose, Vec3 } from '@surf/shared';
import { FLAG_DUCKED, FLAG_ON_GROUND, playerPoint, Status, VIEW_HEIGHT, WEAPONS } from '@surf/shared';
import { infectedHost, type FakePlayer } from './infected-test-host.ts';
import { netState } from './test-helpers.ts';

const LIVE_TICK = 0x7fffffff;

/** Round 1 (.50 cal rifle): Zero (Patient Zero) and survivor Ben 300 apart, side-on to each other; Cat far away. */
function stage() {
	const h = infectedHost(['Zero', 'Ben', 'Cat']);
	const [zero, ben, cat] = h.players as [FakePlayer, FakePlayer, FakePlayer];
	const put = (p: FakePlayer, x: number, y: number, pitch = 0, ducked = false, yaw = 0) => {
		p.state = netState(0, x, { y, yaw, pitch, flags: FLAG_ON_GROUND | (ducked ? FLAG_DUCKED : 0), status: Status.Alive });
		h.mode.state(p, p.state);
	};
	put(zero, 0, 0);
	put(ben, 0, -300);
	h.state(cat, 1800, 1800);
	h.run(500);
	/** `from` fires the rifle at a world point; true when it hit `target`. */
	const shoot = (from: FakePlayer, target: FakePlayer, at: Vec3): boolean => {
		const o = { x: from.state!.x, y: from.state!.y, z: VIEW_HEIGHT };
		const l = Math.hypot(at.x - o.x, at.y - o.y, at.z - o.z);
		const n = from.inbox.length;
		const m = target.inbox.length;
		h.send(from, { type: 'fire', weapon: 'barrett', origin: o, dir: { x: (at.x - o.x) / l, y: (at.y - o.y) / l, z: (at.z - o.z) / l }, tick: LIVE_TICK });
		assert.equal(h.events(target, 'shot', m).length, 1, 'the shot was accepted');
		return h.events(from, 'hit', n).some((e) => e.targetId === target.id);
	};
	/** Patient Zero swings the claws along +x; true when that infected Ben. */
	const swing = (): boolean => {
		const n = ben.inbox.length;
		h.send(zero, { type: 'fire', weapon: 'claws', origin: { x: zero.state!.x, y: zero.state!.y, z: VIEW_HEIGHT }, dir: { x: 1, y: 0, z: 0 }, tick: LIVE_TICK });
		assert.equal(h.events(ben, 'shot', n).length, 1, 'the swing was accepted');
		return h.events(ben, 'infect', n).some((e) => e.id === ben.id && e.method === 'claws');
	};
	return { h, zero, ben, cat, put, shoot, swing };
}

/** As `stage`, with Ben facing Patient Zero at claw reach plus 18: of him only the hands on the rifle, some 22 in front of the feet, are within reach. */
function closeUp() {
	const s = stage();
	const at = (pitch: number) => s.put(s.ben, WEAPONS.claws.range + 18, 0, pitch, false, 180);
	at(0);
	s.h.run(500);
	return { ...s, at };
}

/** The hit pose of Patient Zero (claws) at the origin, facing +x. */
const zeroAt = (ducked = false): PlayerPose => ({ x: 0, y: 0, z: 0, yaw: 0, ducked, hunched: true, held: 'claws', pitch: 0 });

describe('infected mode: hit boxes follow the held pose', () => {
	it("a survivor hits Patient Zero's raised forearm side-on; the claws reach the hands on a survivor's rifle", () => {
		const a = stage();
		const forearm = playerPoint(zeroAt(), 'foreArmL', 0.9);
		// In front of the chest: the body itself ends about 10 in front of the feet.
		assert.ok(forearm.x > 12.5, `forearm at ${forearm.x}`);
		assert.equal(a.shoot(a.ben, a.zero, forearm), true);
		assert.equal(closeUp().swing(), true);
		// The knife in hand: the hands are further back.
		const k = closeUp();
		k.h.send(k.ben, { type: 'loadout', weapon: 'knife' });
		k.h.run(500);
		assert.equal(k.swing(), false);
	});

	it('the arms follow the pitch of the state packets', () => {
		const c = closeUp();
		c.at(-80);
		c.h.run(300);
		assert.equal(c.swing(), false, 'the rifle points up, the hands are above the reach');
		const d = closeUp();
		d.at(-80);
		d.h.run(300);
		d.at(0);
		d.h.run(300);
		assert.equal(d.swing(), true, 'level again');
	});

	it('a live swing rewinds the pitch with the pose: what Patient Zero saw 266 ms ago', () => {
		// Ben levelled the rifle until 200 ms ago; Patient Zero's ping makes their screen 266 ms old.
		const raised = () => {
			const s = closeUp();
			s.at(-80);
			s.h.run(200);
			return s;
		};
		assert.equal(raised().swing(), false, 'ping 0: 116 ms back the rifle was up');
		const then = raised();
		then.zero.ping = 150;
		assert.equal(then.swing(), true, 'ping 150: 266 ms back it was level');
	});

	it('the body follows the velocity and ground flag of the state packets', () => {
		// Patient Zero runs on the spot (the packets say 265 u/s along x): a foot far behind the body is hit, standing or in the air it is not.
		const behind = { x: -13, y: 0, z: 8 };
		const moving = (vx: number, flags: number) => {
			const s = stage();
			s.zero.state = netState(0, 0, { vx, flags, status: Status.Alive });
			s.h.mode.state(s.zero, s.zero.state);
			s.h.run(1500);
			return s;
		};
		const run = moving(265, FLAG_ON_GROUND);
		assert.equal(run.shoot(run.ben, run.zero, behind), true);
		const still = moving(0, FLAG_ON_GROUND);
		assert.equal(still.shoot(still.ben, still.zero, behind), false);
		const air = moving(265, 0);
		assert.equal(air.shoot(air.ben, air.zero, behind), false);
	});

	it('ducked: the shoulders and the raised claws come down with the body', () => {
		const low = playerPoint(zeroAt(true), 'foreArmL', 0.85);
		const high = playerPoint(zeroAt(), 'upperArmL', 0.1);
		assert.ok(high.z - low.z > 10);
		const ducked = () => {
			const s = stage();
			s.put(s.zero, 0, 0, 0, true);
			s.h.run(300);
			return s;
		};
		const a = ducked();
		assert.equal(a.shoot(a.ben, a.zero, low), true);
		const b = ducked();
		assert.equal(b.shoot(b.ben, b.zero, high), false);
	});
});
