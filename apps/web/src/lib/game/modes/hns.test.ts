import { describe, expect, it } from 'vitest';
import {
	createPlayer,
	getMap,
	HNS_CVARS,
	HNS_NAMETAG_RANGE,
	hnsSpawns,
	Status,
	type ClientMessage,
	type HnsModeState,
	type MapDef,
	type NetState,
	type Spawn,
	type Vec3
} from '@surf/shared';
import type { RemotePlayers } from '../../render/players.js';
import type { HnsView, HudStateShape } from '../contract.js';
import { HnsMode } from './hns.js';
import type { ClientModeHost, RemotePlayer } from './types.js';

const map: MapDef = {
	...getMap('tag_quayside')!,
	kind: 'hns',
	hns: {
		hiderSpawns: [{ pos: { x: 10, y: 0, z: 0 }, yaw: 0 }],
		seekerSpawns: [{ pos: { x: -10, y: 0, z: 0 }, yaw: 180 }]
	}
};
const [hiderSpawn] = hnsSpawns(map).hiders;
const [seekerSpawn] = hnsSpawns(map).seekers;

function remote(id: number, x: number, hasSample = true): RemotePlayer {
	return {
		id,
		name: `P${id}`,
		spectating: false,
		hasSample,
		sample: { x, y: 0, z: 0, vx: 0, vy: 0, vz: 0, pitch: 0, yaw: 0, flags: 0, status: 0, stage: 0, runTicks: 0 }
	};
}

function setup(order: string[] = []) {
	const writes: (HnsView | null)[] = [];
	const log = {
		sent: [] as ClientMessage[],
		teleports: [] as Spawn[],
		notices: [] as string[],
		sounds: [] as unknown[][],
		acts: [] as [number, string][],
		zoneSpawns: [] as (() => Spawn)[],
		traces: [] as [Vec3, Vec3][],
		weapons: [] as (string | null)[],
		shown: [] as boolean[],
		speeds: [] as number[],
		placed: [] as (Vec3 | null)[],
		cleared: 0
	};
	const hud = {
		get hns() {
			return writes.at(-1) ?? null;
		},
		set hns(v: HnsView | null) {
			writes.push(v);
		}
	};
	const fake = {
		map,
		sv: { ...HNS_CVARS },
		fraction: 1,
		world: {
			trace: (a: Vec3, b: Vec3) => {
				log.traces.push([{ ...a }, { ...b }]);
				return { fraction: fake.fraction };
			}
		},
		player: createPlayer({ x: 0, y: 0, z: 0 }),
		pitch: 0,
		yaw: 90,
		eye: { x: 0, y: 0, z: 64 },
		spec: null as { targetId: number | null; freeFly: boolean; pos: Vec3 } | null,
		remotes: new Map<number, RemotePlayer>(),
		hud: hud as unknown as HudStateShape,
		audio: {
			hns: (...a: unknown[]) => {
				order.push(`sound ${a[0]}`);
				log.sounds.push(a);
			}
		},
		renderer: {
			zombies: {
				fired: () => {},
				setWeapon: (w: string | null) => log.weapons.push(w),
				updateViewmodel: (_now: number, visible: boolean, _reload: number, speed: number) => {
					log.shown.push(visible);
					log.speeds.push(speed);
				}
			},
			cashBag: { place: (p: Vec3 | null) => log.placed.push(p), burst: () => {}, clear: () => void log.cleared++ }
		} as object | null,
		online: true,
		selfId: 1,
		viewId: 1,
		name: (id: number) => (id === 1 ? 'Me' : `P${id}`),
		send: (m: ClientMessage) => void log.sent.push(m),
		notice: (t: string) => void log.notices.push(t),
		teleport: (s: Spawn) => void log.teleports.push(s),
		teleportZones: (f: () => Spawn) => void log.zoneSpawns.push(f),
		avatarAct: (id: number, a: string) => {
			order.push(`act ${a}`);
			log.acts.push([id, a]);
		}
	};
	const mode = new HnsMode(fake as unknown as ClientModeHost);
	const state = (phase: HnsModeState['phase'], seekers: number[], hiders: number[], now = 100) =>
		mode.message(
			{
				type: 'modeState',
				mode: 'hns',
				phase,
				round: 1,
				timeLeft: 30,
				seekers,
				hiders,
				winner: null,
				players: [
					...seekers.map((id) => ({ id, role: 'seeker' as const, finds: 0, survived: 0, frozen: 0 })),
					...hiders.map((id) => ({ id, role: 'hider' as const, finds: 0, survived: 0, frozen: 0 }))
				]
			},
			now
		);
	return { mode, fake, log, writes, hud, state };
}

function dressed(mode: HnsMode, p: RemotePlayer, visible: boolean) {
	const calls: Record<string, unknown> = {};
	const players = new Proxy({}, { get: (_t, k) => (_id: number, v: unknown) => void (calls[String(k)] = v) }) as RemotePlayers;
	mode.dress(players, p, visible);
	return calls;
}

describe('HnsMode', () => {
	it('publishes the first view at once, then only when it changed', () => {
		const { mode, writes, hud, state } = setup();
		expect(writes).toHaveLength(1);
		expect(hud.hns?.phase).toBe('solo');
		mode.frame(10);
		mode.frame(20);
		expect(writes).toHaveLength(1);
		state('seeking', [2], [1]);
		mode.frame(110);
		mode.frame(120);
		expect(writes).toHaveLength(2);
		expect(hud.hns).toMatchObject({ phase: 'seeking', role: 'hider' });
	});

	it('shows the knife to seekers, not while spectating', () => {
		const { mode, log, state, fake } = setup();
		state('seeking', [1], [2]);
		fake.player.velocity.x = 30;
		fake.player.velocity.y = 40;
		mode.frame(110);
		expect(log.weapons.at(-1)).toBe('knife');
		expect(log.shown.at(-1)).toBe(true);
		expect(log.speeds.at(-1)).toBe(50);
		fake.spec = { targetId: 2, freeFly: false, pos: { x: 0, y: 0, z: 0 } };
		mode.frame(120);
		expect(log.weapons.at(-1)).toBe(null);
		expect(log.shown.at(-1)).toBe(false);
	});

	it('shows the round of the viewed player', () => {
		const { mode, hud, state, fake } = setup();
		state('seeking', [1], [2]);
		fake.viewId = 2;
		mode.frame(110);
		expect(hud.hns).toMatchObject({ role: 'hider', seekerNames: ['Me'] });
	});

	it('is free roam without a server', () => {
		const { mode, hud, state, fake, log } = setup();
		state('seeking', [1], [2]);
		fake.online = false;
		mode.press('attack', true, 1000);
		expect(log.sent).toEqual([]);
		mode.frame(1010);
		expect(hud.hns?.phase).toBe('solo');
	});

	it('runs without a renderer', () => {
		const { mode, fake, hud, state } = setup();
		fake.renderer = null;
		state('seeking', [1], [2]);
		mode.frame(110);
		expect(hud.hns?.role).toBe('seeker');
	});

	it('swings with the attack button only, from my eye along my view', () => {
		const { mode, log, state, fake } = setup();
		state('seeking', [1], [2]);
		mode.press('attack2', true, 1000);
		mode.press('attack', false, 1000);
		expect(log.sent).toEqual([]);
		fake.eye = { x: 1, y: 2, z: 3 };
		mode.press('attack', true, 1000);
		expect(log.sent).toHaveLength(1);
		const m = log.sent[0] as Extract<ClientMessage, { type: 'knife' }>;
		expect(m.type).toBe('knife');
		expect(m.origin).toEqual({ x: 1, y: 2, z: 3 });
		expect(m.dir.y).toBeCloseTo(1);
	});

	it('keeps frozen players still but lets them fall, by the end of the tick', () => {
		const { mode, state, fake } = setup();
		const v = fake.player.velocity;
		Object.assign(v, { x: 100, y: -50, z: 200 });
		expect(mode.moveCvars(0)).toBe(fake.sv);
		expect(v).toEqual({ x: 100, y: -50, z: 200 });
		state('hiding', [1], [2]);
		expect(mode.moveCvars(0)).toBe(null);
		expect(v).toEqual({ x: 0, y: 0, z: 0 });
		v.z = -300;
		expect(mode.moveCvars(0)).toBe(null);
		expect(v.z).toBe(-300);

		state('seeking', [1], [2]);
		mode.message({ type: 'hns', ev: { e: 'spawn', id: 1, role: 'seeker', pos: { x: 0, y: 0, z: 0 }, yaw: 0, freezeSecs: 3 } }, 1000);
		expect(mode.moveCvars(3999)).toBe(null);
		expect(mode.moveCvars(4000)).toBe(fake.sv);
	});

	it('reads the physics cvars live', () => {
		const { mode, fake } = setup();
		fake.sv = { ...HNS_CVARS, sv_gravity: 400 };
		expect(mode.moveCvars(0)).toBe(fake.sv);
	});

	it('sends fall-outs to a spawn of my role', () => {
		const { mode, log, state } = setup();
		mode.tick();
		expect(log.zoneSpawns[0]!()).toBe(hiderSpawn);
		state('seeking', [1], [2]);
		expect(log.zoneSpawns[0]!()).toBe(seekerSpawn);
	});

	it('refuses a restart during a round only', () => {
		const { mode, log, state } = setup();
		state('waiting', [], [1]);
		mode.restart();
		expect(log.teleports).toEqual([hiderSpawn]);
		for (const phase of ['hiding', 'seeking'] as const) {
			state(phase, [2], [1]);
			mode.restart();
		}
		expect(log.teleports).toHaveLength(1);
		expect(log.notices).toEqual(Array(2).fill('!r is disabled during a hide and seek round.'));
	});

	it('puts a spectator who comes back into play at a spawn, also during a round', () => {
		const { mode, log, state } = setup();
		state('seeking', [1], [2]);
		mode.respawn();
		expect(log.teleports).toEqual([seekerSpawn]);
		expect(log.notices).toEqual([]);
	});

	it('reports Seeker or Hider, no stage and no run', () => {
		const { mode, state } = setup();
		const s: NetState = { tick: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, pitch: 0, yaw: 0, flags: 0, status: Status.Idle, stage: 7, runTicks: 9 };
		mode.netState(s);
		expect(s).toMatchObject({ status: Status.Hider, stage: 0, runTicks: 0 });
		state('seeking', [1], [2]);
		mode.netState(s);
		expect(s.status).toBe(Status.Seeker);
	});

	it('ignores messages of other modes', () => {
		const { mode, hud } = setup();
		mode.message({ type: 'modeState', mode: 'tag', phase: 'playing', round: 4, timeLeft: 5, it: [1], immune: [], scores: [] }, 100);
		mode.message({ type: 'tagged', by: 2, target: 1 }, 100);
		mode.frame(110);
		expect(hud.hns).toMatchObject({ round: 0, role: 'hider', flash: null });
	});

	it('teleports me on my spawn event', () => {
		const { mode, log } = setup();
		mode.message({ type: 'hns', ev: { e: 'spawn', id: 1, role: 'hider', pos: { x: 5, y: 6, z: 7 }, yaw: 45, freezeSecs: 0 } }, 100);
		expect(log.teleports).toEqual([{ pos: { x: 5, y: 6, z: 7 }, yaw: 45 }]);
	});

	it('a swing moves the avatar after the client took it, and is heard from where the player is drawn', () => {
		const order: string[] = [];
		const { mode, log, fake } = setup(order);
		fake.player.origin.x = 100;
		fake.remotes.set(2, remote(2, 400));
		fake.remotes.set(3, remote(3, 400, false));
		const swing = (by: number) => mode.message({ type: 'hns', ev: { e: 'swing', by } }, 100);
		swing(2);
		expect(order).toEqual(['sound swing', 'act swing']);
		expect(log.sounds).toEqual([['swing', 300]]);
		swing(3); // not drawn yet
		swing(9); // gone
		expect(log.sounds).toHaveLength(1);
		expect(log.acts).toEqual([[2, 'swing'], [3, 'swing'], [9, 'swing']]);
	});

	it('plays sounds that are not a player\'s, and my own, at full level', () => {
		const { mode, log, state } = setup();
		mode.message({ type: 'hns', ev: { e: 'release', seekSecs: 60 } }, 100);
		state('seeking', [1], [2]);
		mode.press('attack', true, 1000);
		expect(log.sounds).toEqual([['release'], ['swing']]);
		expect(log.acts).toEqual([]);
	});

	it('points at the bag from the spectator camera, else from my eye', () => {
		const { mode, hud, fake, state } = setup();
		state('seeking', [2], [1]);
		mode.message({ type: 'hns', ev: { e: 'bag', pos: { x: 0, y: 393.7, z: 0 }, place: 'here' } }, 200);
		mode.frame(210);
		expect(hud.hns?.bag).toMatchObject({ phase: 'out', meters: 10, turn: 0 });
		fake.spec = { targetId: null, freeFly: true, pos: { x: 393.7, y: 393.7, z: 0 } };
		mode.frame(220);
		expect(hud.hns?.bag).toMatchObject({ meters: 10, turn: -90 });
	});

	describe('dress', () => {
		it('only updates the held knife of players who are not drawn', () => {
			const { mode, state, log } = setup();
			state('seeking', [2], [1, 3]);
			expect(dressed(mode, remote(2, 100), false)).toEqual({ setHeld: 'knife' });
			expect(dressed(mode, remote(3, 100), false)).toEqual({ setHeld: null });
			expect(log.traces).toEqual([]);
		});

		it('marks seekers and shows near tags in sight', () => {
			const { mode, state, log, fake } = setup();
			state('seeking', [2], [1, 3]);
			expect(dressed(mode, remote(2, 100), true)).toEqual({ setHeld: 'knife', setSeeker: true, setTagVisible: true });
			expect(dressed(mode, remote(3, 100), true)).toEqual({ setHeld: null, setSeeker: false, setTagVisible: true });
			expect(log.traces[0]).toEqual([{ x: 0, y: 0, z: 64 }, { x: 100, y: 0, z: 64 }]);
			fake.fraction = 0.5;
			expect(dressed(mode, remote(3, 100), true).setTagVisible).toBe(false);
		});

		it('hides far tags without tracing', () => {
			const { mode, state, log } = setup();
			state('seeking', [2], [1]);
			expect(dressed(mode, remote(2, HNS_NAMETAG_RANGE), true).setTagVisible).toBe(true);
			expect(log.traces).toHaveLength(1);
			expect(dressed(mode, remote(2, HNS_NAMETAG_RANGE + 1), true).setTagVisible).toBe(false);
			expect(log.traces).toHaveLength(1);
		});

		it('hides hider tags from seekers, also once they spectate, until the round is over', () => {
			const { mode, state, fake, log } = setup();
			const tag = () => dressed(mode, remote(3, 100), true).setTagVisible;
			state('seeking', [1], [3]);
			expect(tag()).toBe(false);
			fake.spec = { targetId: null, freeFly: true, pos: { x: 50, y: 0, z: 64 } };
			expect(tag()).toBe(false);
			// The server took me out of the round.
			state('seeking', [2], [3]);
			expect(tag()).toBe(false);
			expect(log.traces.at(-1)![0]).toEqual({ x: 50, y: 0, z: 64 });
			state('ended', [2], [3]);
			expect(tag()).toBe(true);
			state('hiding', [2], [3]);
			expect(tag()).toBe(true);
		});

		it('a spectator who did not seek sees the tags the watched player sees', () => {
			const { mode, state, fake } = setup();
			const tag = () => dressed(mode, remote(3, 100), true).setTagVisible;
			state('seeking', [2], [1, 3, 4]);
			fake.spec = { targetId: 2, freeFly: false, pos: { x: 0, y: 0, z: 64 } };
			fake.viewId = 2;
			state('seeking', [2], [3, 4]);
			expect(tag()).toBe(false);
			fake.spec = { targetId: 4, freeFly: false, pos: { x: 0, y: 0, z: 64 } };
			fake.viewId = 4;
			expect(tag()).toBe(true);
			fake.spec = { targetId: 4, freeFly: true, pos: { x: 0, y: 0, z: 64 } };
			fake.viewId = 1;
			expect(tag()).toBe(true);
		});

		it('a hider who was found seeks from then on', () => {
			const { mode, state, fake } = setup();
			state('seeking', [2], [1, 3]);
			expect(dressed(mode, remote(3, 100), true).setTagVisible).toBe(true);
			state('seeking', [1, 2], [3]);
			fake.spec = { targetId: null, freeFly: true, pos: { x: 0, y: 0, z: 64 } };
			state('seeking', [2], [3]);
			expect(dressed(mode, remote(3, 100), true).setTagVisible).toBe(false);
		});
	});

	it('keeps the solo row free of tag fields', () => {
		const { mode } = setup();
		const row = { status: Status.Runner, score: 5, it: false, ...mode.soloRow() };
		expect(row).toEqual({ status: Status.Hider, kills: 0, score: 0, it: undefined });
	});

	it('leaves no viewmodel, bag or view behind', () => {
		const { mode, log, hud, state } = setup();
		state('seeking', [1], [2]);
		mode.frame(110);
		mode.dispose();
		expect(log.weapons.at(-1)).toBe(null);
		expect(log.shown.at(-1)).toBe(false);
		expect(log.cleared).toBe(1);
		expect(hud.hns).toBe(null);
	});
});
