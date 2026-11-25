import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlayer, getMap, Status, tagSpawns, type NetState, type Spawn, type TagModeState } from '@surf/shared';
import type { RemotePlayers } from '../../render/players.js';
import type { HudStateShape, TagView } from '../contract.js';
import { TagMode } from './tag.js';
import type { ClientModeHost, RemotePlayer } from './types.js';

const map = getMap('tag_quayside')!;
const lastSpawn = tagSpawns(map).at(-1)!;

function setup() {
	const writes: (TagView | null)[] = [];
	const log = { teleports: [] as Spawn[], notices: [] as string[], beeps: 0, zoneSpawns: [] as (() => Spawn)[] };
	const hud = {
		get tag() {
			return writes.at(-1) ?? null;
		},
		set tag(v: TagView | null) {
			writes.push(v);
		}
	};
	const fake = {
		map,
		hud: hud as unknown as HudStateShape,
		player: createPlayer({ x: 0, y: 0, z: 0 }),
		remotes: new Map<number, RemotePlayer>(),
		selfId: 1,
		viewId: 1,
		audio: { zoneBeep: () => void log.beeps++ },
		name: (id: number) => (id === 1 ? 'Me' : `P${id}`),
		notice: (t: string) => void log.notices.push(t),
		teleport: (s: Spawn) => void log.teleports.push(s),
		teleportZones: (f: () => Spawn) => void log.zoneSpawns.push(f)
	};
	const mode = new TagMode(fake as unknown as ClientModeHost);
	const state = (m: Partial<TagModeState>, now: number) =>
		mode.message({ type: 'modeState', mode: 'tag', phase: 'playing', round: 1, timeLeft: 60, it: [], immune: [], scores: [], ...m }, now);
	return { mode, fake, log, writes, hud, state };
}

const net = (): NetState => ({ tick: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, pitch: 0, yaw: 0, flags: 0, status: Status.Idle, stage: 7, runTicks: 9 });

/** Random spawns are the last one, which is not the map's own. */
function pickLastSpawn() {
	vi.spyOn(Math, 'random').mockReturnValue(0.999);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('TagMode', () => {
	it('publishes the free-roam view at once', () => {
		const { hud, writes } = setup();
		expect(writes).toHaveLength(1);
		expect(hud.tag).toEqual({ phase: 'solo', round: 0, endsAt: 0, isIt: false, immune: false, itNames: [], score: 0, flash: null });
	});

	it('shows the round of the viewed player and names the ITs', () => {
		const { hud, state, fake, mode } = setup();
		state({ round: 3, timeLeft: 20, it: [1, 2], immune: [5], scores: [{ id: 1, score: 4 }, { id: 5, score: 11 }] }, 1000);
		expect(hud.tag).toMatchObject({ phase: 'playing', round: 3, endsAt: 21_000, isIt: true, immune: false, itNames: ['Me', 'P2'], score: 4 });
		fake.viewId = 5;
		mode.frame(1010);
		expect(hud.tag).toMatchObject({ isIt: false, immune: true, score: 11 });
	});

	it('has no end time while waiting', () => {
		const { hud, state } = setup();
		state({ phase: 'waiting', timeLeft: 20 }, 1000);
		expect(hud.tag).toMatchObject({ phase: 'waiting', endsAt: 0 });
	});

	it('only writes the view when something it shows changed', () => {
		const { writes, mode, state, fake } = setup();
		state({}, 100);
		const n = writes.length;
		mode.frame(110);
		mode.frame(120);
		expect(writes).toHaveLength(n);
		fake.remotes.set(2, {} as RemotePlayer);
		mode.frame(130);
		expect(writes).toHaveLength(n + 1);
	});

	it('flashes and beeps when a round it saw coming starts, not when joining one', () => {
		const a = setup();
		a.state({ phase: 'playing' }, 100);
		expect(a.hud.tag?.flash).toBe(null);
		expect(a.log.beeps).toBe(0);

		const b = setup();
		b.state({ phase: 'countdown' }, 100);
		b.state({ phase: 'playing', it: [2] }, 200);
		expect(b.hud.tag?.flash).toEqual({ text: 'Run!', at: 200 });
		expect(b.log.beeps).toBe(1);

		const c = setup();
		c.state({ phase: 'countdown' }, 100);
		c.state({ phase: 'playing', it: [1] }, 200);
		expect(c.hud.tag?.flash).toEqual({ text: "You're IT!", at: 200 });
	});

	it('flashes silently when a handover makes me IT, but never over a running flash', () => {
		const { hud, state, log, mode } = setup();
		state({ it: [2] }, 100);
		state({ it: [1] }, 200);
		expect(hud.tag?.flash).toEqual({ text: "You're IT!", at: 200 });
		expect(log.beeps).toBe(0);

		mode.message({ type: 'tagged', by: 1, target: 3 }, 300);
		state({ it: [3] }, 310);
		state({ it: [1] }, 320);
		expect(hud.tag?.flash).toEqual({ text: 'You tagged P3!', at: 300 });
	});

	it('flashes for tags I am part of and ignores the others', () => {
		const { hud, mode, log } = setup();
		mode.message({ type: 'tagged', by: 2, target: 3 }, 100);
		expect(hud.tag?.flash).toBe(null);
		expect(log.beeps).toBe(0);
		mode.message({ type: 'tagged', by: 2, target: 1 }, 200);
		expect(hud.tag?.flash?.text).toBe("P2 tagged you. You're IT!");
		expect(log.beeps).toBe(1);
	});

	it('drops the flash after 2.5 s', () => {
		const { hud, mode } = setup();
		mode.message({ type: 'tagged', by: 1, target: 2 }, 1000);
		mode.frame(3500);
		expect(hud.tag?.flash).not.toBe(null);
		mode.frame(3501);
		expect(hud.tag?.flash).toBe(null);
	});

	it('ignores states of other modes', () => {
		const { mode, hud, writes } = setup();
		const n = writes.length;
		mode.message({ type: 'modeState', mode: 'hns', phase: 'seeking', round: 1, timeLeft: 5, seekers: [], hiders: [], winner: null, players: [] }, 100);
		expect(hud.tag?.phase).toBe('solo');
		expect(writes).toHaveLength(n);
	});

	it('refuses a restart during a round only', () => {
		pickLastSpawn();
		const { mode, state, log } = setup();
		mode.restart();
		expect(log.teleports).toEqual([lastSpawn]);
		for (const phase of ['waiting', 'countdown'] as const) {
			state({ phase }, 100);
			mode.restart();
		}
		expect(log.teleports).toHaveLength(3);
		expect(log.notices).toEqual([]);
		state({ phase: 'playing' }, 200);
		mode.restart();
		expect(log.teleports).toHaveLength(3);
		expect(log.notices).toEqual(['!r is disabled during a tag round.']);
	});

	it('puts a spectator who comes back into play at a spawn, also during a round', () => {
		pickLastSpawn();
		const { mode, state, log } = setup();
		state({ phase: 'playing' }, 100);
		mode.respawn();
		expect(log.teleports).toEqual([lastSpawn]);
		expect(log.notices).toEqual([]);
	});

	it('sends fall-outs to a random spawn', () => {
		pickLastSpawn();
		const { mode, log } = setup();
		mode.tick();
		expect(log.zoneSpawns.map((f) => f())).toEqual([lastSpawn]);
	});

	it('reports Tagger or Runner, no stage and no run', () => {
		const { mode, state } = setup();
		const s = net();
		mode.netState(s);
		expect(s).toMatchObject({ status: Status.Runner, stage: 0, runTicks: 0 });
		state({ it: [1] }, 100);
		mode.netState(s);
		expect(s.status).toBe(Status.Tagger);
	});

	it('marks remote ITs, drawn or not', () => {
		const { mode, state } = setup();
		state({ it: [2] }, 100);
		const marked: [number, boolean][] = [];
		const players = { setIt: (id: number, it: boolean) => marked.push([id, it]) } as unknown as RemotePlayers;
		mode.dress(players, { id: 2 } as RemotePlayer);
		mode.dress(players, { id: 3 } as RemotePlayer);
		expect(marked).toEqual([[2, true], [3, false]]);
	});

	it('goes back to free roam in place when the connection is lost', () => {
		const { mode, state, hud, log } = setup();
		state({ phase: 'countdown' }, 100);
		state({ phase: 'playing', it: [1] }, 200);
		mode.offline();
		expect(hud.tag).toMatchObject({ phase: 'solo', isIt: false, itNames: [], flash: null });
		mode.restart();
		expect(log.notices).toEqual([]);
	});

	it('takes its view off the HUD', () => {
		const { mode, hud } = setup();
		mode.dispose();
		expect(hud.tag).toBe(null);
	});
});
