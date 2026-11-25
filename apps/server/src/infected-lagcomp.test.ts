/**
 * Lag compensation through the server mode (docs/architecture.md#netcode):
 * a live `fire` is tested against the pose the shooter's client drew.
 *
 * The client side is modelled here on its own, not with the server's rewind
 * helper: the target's client sends a state packet every 1/64 s, the server
 * relays the latest states in a snapshot every 1/32 s, the shooter stamps
 * each snapshot on arrival and draws the others 100 ms back, interpolated
 * (apps/web net/interp.ts), at 60 frames a second. The fire message leaves
 * on the frame after the one the shooter aimed at and takes half a ping.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Vec3 } from '@surf/shared';
import { INF_HISTORY_MS, INF_INFECTED_SPEED, playerPoint, VIEW_HEIGHT, WEAPONS } from '@surf/shared';
import { infectedHost, type FakePlayer } from './infected-test-host.ts';

const INTERP_MS = 100;
const STATE_MS = 1000 / 64;
const SNAPSHOT_MS = 1000 / 32;
const FRAME_MS = 1000 / 60;
const LIVE_TICK = 0x7fffffff;

interface XY {
	x: number;
	y: number;
}

/** The shooter's interpolation buffer for one remote player (SnapshotBuffer.sample without the fields not needed here). */
class ClientView {
	private buf: Array<{ t: number; p: XY }> = [];

	push(arrival: number, p: XY): void {
		this.buf.push({ t: arrival, p });
	}

	sample(renderMs: number): XY | null {
		const n = this.buf.length;
		if (n === 0) return null;
		if (renderMs <= this.buf[0]!.t) return this.buf[0]!.p;
		if (renderMs >= this.buf[n - 1]!.t) return this.buf[n - 1]!.p;
		let i = 1;
		while (this.buf[i]!.t < renderMs) i++;
		const a = this.buf[i - 1]!;
		const b = this.buf[i]!;
		const f = (renderMs - a.t) / (b.t - a.t);
		return { x: a.p.x + (b.p.x - a.p.x) * f, y: a.p.y + (b.p.y - a.p.y) * f };
	}
}

const unit = (v: Vec3): Vec3 => {
	const l = Math.hypot(v.x, v.y, v.z);
	return { x: v.x / l, y: v.y / l, z: v.z / l };
};

interface Scene {
	/** Round-trip time of the shooter (half each way). */
	ping: number;
	shooter: 1 | 2;
	shooterAt: XY;
	weapon: string;
	/** Where the target's client is `t` ms into the scene; `yaw` its facing. */
	move: (t: number) => XY;
	yaw: number;
	/** The shooter fires on the first frame at or after this time. */
	fireAt: number;
	/** Aim point from the pose the shooter saw (`seen`); `posAt` gives the target's position at any scene time, `arrival` when the server gets the shot. */
	aim: (ctx: { seen: XY; posAt: (t: number) => XY; arrival: number }) => Vec3;
	/** Mode ticks trail the snapshots by this much (the lobby starts both timers together: 0). */
	tickPhase?: number;
}

/**
 * Plays a scene on a fresh server mode (players 1 = Patient Zero, 2 and 3
 * survivors) and returns what happened to the target.
 */
function play(s: Scene) {
	const h = infectedHost(['Zero', 'Ben', 'Cat']);
	const shooter = h.players[s.shooter - 1]!;
	const target = h.players[s.shooter === 1 ? 1 : 0]!;
	const cat = h.players[2]!;
	const t0 = h.now;
	const half = s.ping / 2;
	shooter.ping = s.ping;
	if (s.weapon !== h.game.weaponOf(shooter.id)!.weapon) h.send(shooter, { type: 'loadout', weapon: s.weapon });
	h.state(shooter, s.shooterAt.x, s.shooterAt.y);
	h.state(cat, 1800, 1800);
	const start = s.move(0);
	h.state(target, start.x, start.y, { yaw: s.yaw });

	type Event = { t: number; order: number; run: () => void };
	const queue: Event[] = [];
	const end = s.fireAt + FRAME_MS * 2 + half + 1;
	const view = new ClientView();
	let latest = start;
	for (let k = 1; k * STATE_MS < end; k++) {
		const t = k * STATE_MS + 2;
		queue.push({ t, order: 0, run: () => ((latest = s.move(t)), h.state(target, latest.x, latest.y, { yaw: s.yaw })) });
	}
	for (let k = 0; k * SNAPSHOT_MS < end; k++) {
		const t = k * SNAPSHOT_MS;
		queue.push({ t, order: 1, run: () => view.push(t + half, latest) });
		queue.push({ t: t + (s.tickPhase ?? 0), order: 2, run: () => h.mode.tick() });
	}
	let drawn: XY | null = null;
	let fired = false;
	let seen: XY | null = null;
	let arrival = 0;
	let inboxAt = 0;
	for (let j = 0; j * FRAME_MS + 5 < end; j++) {
		const t = j * FRAME_MS + 5;
		queue.push({
			t,
			order: 3,
			run: () => {
				if (!fired && t >= s.fireAt && drawn) {
					// The sim tick at the start of this frame fires at what the last frame showed.
					fired = true;
					seen = drawn;
					arrival = t + half;
					const aim = s.aim({ seen, posAt: s.move, arrival });
					const origin = { x: s.shooterAt.x, y: s.shooterAt.y, z: VIEW_HEIGHT };
					const dir = unit({ x: aim.x - origin.x, y: aim.y - origin.y, z: aim.z - origin.z });
					queue.push({
						t: arrival,
						order: 4,
						run: () => {
							inboxAt = shooter.inbox.length;
							h.send(shooter, { type: 'fire', weapon: s.weapon, origin, dir, tick: LIVE_TICK });
						}
					});
				}
				drawn = view.sample(t - INTERP_MS);
			}
		});
	}
	for (;;) {
		queue.sort((a, b) => a.t - b.t || a.order - b.order);
		const ev = queue.shift();
		if (!ev) break;
		h.now = t0 + ev.t;
		ev.run();
	}
	assert.ok(fired && seen, 'the scene fired');
	return {
		h,
		seen: seen as XY,
		arrival,
		hit: h.events(shooter, 'hit', inboxAt).some((e) => e.targetId === target.id),
		infected: h.game.playerView(target.id)!.team === 'infected',
		target: target as FakePlayer
	};
}

/** Chest of Patient Zero (profile, facing +x) standing at `p`. */
const zeroChest = (p: XY): Vec3 => playerPoint({ x: p.x, y: p.y, z: 0, yaw: 0, ducked: false, hunched: true }, 'ribs');
/** Widest part of the model (arm to arm, with the pad): "a body width". */
const BODY = 37;

/** Patient Zero crosses at 265 u/s in profile, 600 units in front of survivor Ben (.50 cal rifle). */
const crossing = (ping: number, off: number, extra: Partial<Scene> = {}): Scene => ({
	ping,
	shooter: 2,
	shooterAt: { x: 0, y: -600 },
	weapon: 'barrett',
	move: (t) => ({ x: -300 + (INF_INFECTED_SPEED * t) / 1000, y: 0 }),
	yaw: 0,
	fireAt: 1200,
	aim: ({ seen }) => zeroChest({ x: seen.x + off, y: seen.y }),
	...extra
});

describe('infected lag compensation: the pose the shooter saw', () => {
	for (const ping of [0, 40, 150]) {
		it(`a target crossing at 265 u/s is hit where it was seen, ping ${ping} ms`, () => {
			const on = play(crossing(ping, 0));
			assert.equal(on.hit, true, 'aimed at the seen pose');
			// What the shooter saw is ping + 100 ms + a frame behind the server (31 to 71 units at this speed),
			// and up to one state packet (4 units) more: a snapshot relays the last packet the server got.
			const now = -300 + (INF_INFECTED_SPEED * on.arrival) / 1000;
			const behind = now - on.seen.x - (INF_INFECTED_SPEED * (ping + INTERP_MS + FRAME_MS)) / 1000;
			assert.ok(behind > -0.5 && behind < (INF_INFECTED_SPEED * STATE_MS) / 1000 + 0.5, `the model of the client view (${behind})`);
			assert.equal(play(crossing(ping, 2 * BODY)).hit, false, 'two body widths ahead');
			assert.equal(play(crossing(ping, -2 * BODY)).hit, false, 'two body widths behind');
		});

		it(`the mode tick need not be in phase with the snapshots, ping ${ping} ms`, () => {
			for (const tickPhase of [7, 13, 22, 29]) {
				assert.equal(play(crossing(ping, 0, { tickPhase })).hit, true, `tick phase ${tickPhase}`);
				assert.equal(play(crossing(ping, 2 * BODY, { tickPhase })).hit, false, `tick phase ${tickPhase}, ahead`);
			}
		});

		it(`a claw swing reaches a fleeing survivor where they were seen, ping ${ping} ms`, () => {
			const reach = WEAPONS.claws.range;
			// Ben stands 10 in front of Patient Zero, then runs straight away at 250 u/s.
			const flee = (side: boolean): Scene => ({
				ping,
				shooter: 1,
				shooterAt: { x: 0, y: 0 },
				weapon: 'claws',
				move: (t) => ({ x: 10 + (250 * Math.max(0, t - 500)) / 1000, y: 0 }),
				yaw: 0,
				fireAt: 780 + ping / 2,
				aim: ({ seen }) => (side ? { x: 0, y: 500, z: VIEW_HEIGHT } : { x: seen.x + 500, y: 0, z: VIEW_HEIGHT })
			});
			const on = play(flee(false));
			// Seen within reach (the back is 7.5 behind the feet); at the server by now out of it.
			const now = flee(false).move(on.arrival).x;
			assert.ok(on.seen.x - 7.5 < reach - 10, `seen at ${on.seen.x}`);
			assert.ok(now - 7.5 > reach + 5, `now at ${now}`);
			assert.equal(on.infected, true, 'the swing lands on the seen pose');
			assert.equal(play(flee(true)).infected, false, 'a swing to the side does not');
		});
	}

	it('the rewind is clamped to the history: a 2 s ping reaches 400 ms back, no further', () => {
		const ping = 2000;
		const scene = (aim: Scene['aim']) => crossing(ping, 0, { fireAt: 3400, aim });
		// The pose 400 ms before the shot arrived is hit.
		assert.equal(play(scene(({ posAt, arrival }) => zeroChest(posAt(arrival - INF_HISTORY_MS)))).hit, true);
		// What that shooter saw is over 2 s old, 470 units back: out of the history.
		const seen = play(scene(({ seen }) => zeroChest(seen)));
		assert.ok(seen.arrival > 3400 + 1000);
		assert.equal(seen.hit, false);
		// And the current pose is not tested either.
		assert.equal(play(scene(({ posAt, arrival }) => zeroChest(posAt(arrival)))).hit, false);
	});

	it('never rewinds past a respawn: after a fall the target is only where it respawned', () => {
		const stage = () => {
			const h = infectedHost(['Zero', 'Ben', 'Cat']);
			const [zero, ben, cat] = h.players as [FakePlayer, FakePlayer, FakePlayer];
			h.state(zero, -200, 0);
			h.state(ben, -200, -600);
			h.state(cat, 1800, 1800);
			h.run(1500);
			// Patient Zero drops into the fall-out zone and is put back on a spawn.
			const n = zero.inbox.length;
			h.state(zero, -200, 0, { z: -1000 });
			h.run(1000 / 32);
			const fall = h.events(zero, 'spawn', n)[0]!;
			assert.equal(fall.reason, 'fall');
			h.state(zero, fall.x, fall.y, { z: fall.z, yaw: fall.yaw });
			h.run(1000 / 16);
			ben.ping = 150;
			const fire = (from: { x: number; y: number }, at: Vec3) => {
				h.state(ben, from.x, from.y);
				const origin = { x: from.x, y: from.y, z: VIEW_HEIGHT };
				const m = ben.inbox.length;
				h.send(ben, { type: 'fire', weapon: 'barrett', origin, dir: unit({ x: at.x - origin.x, y: at.y - origin.y, z: at.z - origin.z }), tick: LIVE_TICK });
				return h.events(ben, 'hit', m).length;
			};
			return { h, fall, fire };
		};
		const chest = (x: number, y: number, z: number, yaw: number): Vec3 => playerPoint({ x, y, z, yaw, ducked: false, hunched: true }, 'ribs');
		// 266 ms back (ping 150) Patient Zero stood at (-200, 0): that pose is gone.
		const a = stage();
		assert.equal(a.fire({ x: -200, y: -600 }, chest(-200, 0, 0, 0)), 0, 'the pose before the fall');
		const b = stage();
		assert.equal(b.fire({ x: b.fall.x, y: b.fall.y + 300 }, chest(b.fall.x, b.fall.y, b.fall.z, b.fall.yaw)), 1, 'the pose on the spawn');
	});
});
