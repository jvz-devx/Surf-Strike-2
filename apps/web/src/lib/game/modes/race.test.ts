import {
	createPlayer,
	FINISH_RESET_DELAY,
	FINISH_RESET_DELAY_TICKS,
	FLAG_DUCKED,
	FLAG_ON_GROUND,
	FLAG_TELEPORTED,
	formatTicks,
	GhostRecorder,
	packGhost,
	Status,
	type ClientMessage,
	type GhostFrame,
	type GhostTrack,
	type Loadout,
	type MapDef,
	type NetState,
	type PlayerState
} from '@surf/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GhostStore, StoredGhost } from '../ghost-store.js';
import { RaceMode } from './race.js';
import type { ClientModeHost, LocalBest, RemotePlayer } from './types.js';

/** Decodings under way: a test finishes them when it wants to. */
const inflating: ((raw: Uint8Array | null) => void)[] = [];

vi.mock('@surf/shared', async (original) => ({
	...(await original<object>()),
	inflateGhost: () => new Promise((done) => inflating.push(done))
}));

beforeEach(() => {
	inflating.length = 0;
});

const settle = () => new Promise((done) => setTimeout(done));

/** Along +X: start 0..200, checkpoint (or stage 2) at 1000, teleporter to 1700 at 1500, end at 2000; a pit below -100. */
function makeMap(staged = false): MapDef {
	return {
		id: 'surf_test',
		title: 'Test',
		kind: 'surf',
		difficulty: 'easy',
		layout: staged ? 'staged' : 'linear',
		cvars: {},
		spawn: { pos: { x: 100, y: 0, z: 0 }, yaw: 90 },
		brushes: [],
		zones: [
			{ type: 'start', min: { x: 0, y: -100, z: 0 }, max: { x: 200, y: 100, z: 100 } },
			{
				type: staged ? 'stage' : 'checkpoint',
				index: staged ? 2 : 1,
				min: { x: 1000, y: -100, z: 0 },
				max: { x: 1100, y: 100, z: 100 },
				respawn: { pos: { x: 1050, y: 0, z: 0 }, yaw: 45 }
			},
			{ type: 'teleport', min: { x: 1500, y: -100, z: 0 }, max: { x: 1520, y: 100, z: 100 }, to: 'stage', dest: { pos: { x: 1700, y: 0, z: 0 }, yaw: 180 } },
			{ type: 'end', min: { x: 2000, y: -100, z: 0 }, max: { x: 2100, y: 100, z: 100 } },
			{ type: 'teleport', min: { x: -5000, y: -5000, z: -1000 }, max: { x: 5000, y: 5000, z: -100 }, to: 'stage' }
		],
		theme: {}
	} as unknown as MapDef;
}

/** x = 10 per run tick, `ticks` long. */
function makeTrack(ticks: number): GhostTrack {
	const rec = new GhostRecorder();
	rec.start(0);
	for (let t = 0; t <= ticks; t++) rec.push(t, t * 10, 0, 0, 0, 0, 0);
	return rec.finish(ticks)!;
}

const LOADOUT = { hat: 'h' } as unknown as Loadout;

interface Options {
	staged?: boolean;
	online?: boolean;
	best?: LocalBest;
	renderer?: boolean;
}

function setup(o: Options = {}) {
	/** What the mode asked of the host, in order. */
	const log: string[] = [];
	const sent: ClientMessage[] = [];
	const saves: StoredGhost[] = [];
	const gets: string[] = [];
	const pose = { visible: false, x: 0, ramp: null as unknown };
	const look = { label: '', person: -1, loadout: null as Loadout | null, dressed: 0 };
	let loaded!: (g: StoredGhost | null) => void;
	let saved!: (ok: boolean) => void;
	const ghostStore: GhostStore = {
		get: (map) => {
			gets.push(map);
			return new Promise((done) => (loaded = done));
		},
		saveIfFaster: (g) => {
			saves.push(g);
			return new Promise((done) => (saved = done));
		}
	};
	const renderer = {
		ghost: {
			setPose: (x: number, _y: number, _z: number, _p: number, _yaw: number, _d: boolean, _g: boolean, ramp: unknown, visible: boolean) => {
				Object.assign(pose, { x, ramp, visible });
			},
			setLabel: (label: string) => (look.label = label),
			setPlayer: (person: number, loadout: Loadout | null) => {
				Object.assign(look, { person, loadout });
				look.dressed++;
			}
		},
		players: { loadoutOf: (id: number) => (id === 5 ? LOADOUT : null) }
	};
	const remotes = new Map<number, RemotePlayer>();
	const host = {
		map: makeMap(o.staged),
		player: createPlayer({ x: 100, y: 0, z: 0 }) as PlayerState,
		tick: 1000,
		alpha: 0,
		pitch: 10,
		yaw: 20,
		spec: null as ClientModeHost['spec'],
		remotes,
		hud: {
			splitPopup: null as ClientModeHost['hud']['splitPopup'],
			stageKind: o.staged ? 'stage' : 'checkpoint',
			unofficial: false,
			account: null as ClientModeHost['hud']['account'],
			shop: null as { loadout: Loadout } | null
		},
		audio: { zoneBeep: () => log.push('beep'), recordChime: () => log.push('chime') },
		renderer: o.renderer === false ? null : renderer,
		online: o.online ?? false,
		selfId: o.online ? 3 : -1,
		ghostStore,
		ghostLook: null as ClientModeHost['ghostLook'],
		localBest: o.best ?? { ticks: null, splits: null },
		cvars: { cl_ghost: 1 } as Record<string, number>,
		best: () => host.localBest,
		saveSoloBest: (ticks: number, splits: number[]) => {
			const { ticks: old } = host.localBest;
			log.push(`save ${ticks} ${splits}`);
			if (old !== null && old <= ticks) return false;
			host.localBest = { ticks, splits };
			return true;
		},
		cvar: (name: string) => host.cvars[name] ?? 0,
		send: (m: ClientMessage) => {
			sent.push(m);
			log.push(m.type === 'zone' ? `zone ${m.kind} ${m.index} ${m.tick}` : m.type);
		},
		sendState: () => {
			const s = {} as NetState;
			mode.netState(s);
			log.push(`state ${s.status}`);
		},
		notice: (text: string) => log.push(text),
		print: (text: string) => log.push(text),
		ghostUnavailable: () => log.push('ghostUnavailable'),
		setAngles: (pitch: number, yaw: number) => {
			host.pitch = pitch;
			host.yaw = yaw;
		},
		moved: () => {
			log.push('moved');
			host.hud.splitPopup = null;
		},
		movedInTick: () => log.push('movedInTick'),
		rampUnder: () => ({ x: 0, y: 0, z: 0.5 })
	};
	const mode: RaceMode = new RaceMode(host as unknown as ClientModeHost);
	log.length = 0;
	return {
		host,
		mode,
		log,
		sent,
		saves,
		gets,
		pose,
		look,
		/** The stored PB ghost arrives. */
		load: (g: StoredGhost | null) => (loaded(g), settle()),
		/** The store answers the last save. */
		save: (ok: boolean) => (saved(ok), settle()),
		/** One tick with the player there; returns what the mode asked of the host in it. */
		step(x: number, z = 0): string[] {
			host.player.origin = { x, y: 0, z };
			log.length = 0;
			mode.tick(5000);
			host.tick++;
			return [...log];
		},
		/** Leave the start zone (tick 1001) and run four ticks. */
		startRun() {
			this.step(100);
			for (let i = 0; i < 5; i++) this.step(300 + i * 10);
		},
		angles: () => [host.pitch, host.yaw]
	};
}

type Setup = ReturnType<typeof setup>;

function frame(h: Setup, o: Partial<GhostFrame> = {}): GhostFrame {
	return { map: h.host.map.id, name: 'Alice', ticks: 50, has: true, payload: new Uint8Array(1), ...o } as GhostFrame;
}

/** The record ghost arrives and decodes. */
async function record(h: Setup, o: Partial<GhostFrame> = {}): Promise<void> {
	h.mode.ghostFrame(frame(h, o));
	inflating.shift()!(packGhost(makeTrack(50)));
	await settle();
}

const pbGhost = (): StoredGhost => ({ map: 'surf_test', ticks: 80, track: makeTrack(80) });

describe('RaceMode: the run', () => {
	it('reports the start, checkpoint and end zones; only the last two and entering the start beep', () => {
		const h = setup({ online: true });
		h.host.hud.splitPopup = { label: 'Finish', ticks: 1, delta: null, at: 0 };
		expect(h.step(100)).toEqual(['beep']);
		expect(h.host.hud.splitPopup).toBeNull();
		expect(h.step(300)).toEqual(['zone start 0 1001']);
		expect(h.step(1050)).toEqual(['zone checkpoint 1 1002', 'beep']);
		expect(h.step(1200)).toEqual([]);
	});

	it('sends the finished state before the end zone message, online only', () => {
		for (const online of [true, false]) {
			const h = setup({ online });
			h.startRun();
			const asked = h.step(2050);
			expect(asked[0]).toBe(online ? `state ${Status.Finished}` : 'zone end 0 1006');
			expect(asked.filter((a) => a.startsWith('state') || a.startsWith('zone'))).toHaveLength(online ? 2 : 1);
		}
	});

	it('shows a split against the split at the same position of the best run, at the frame time', () => {
		const h = setup({ best: { ticks: 100, splits: [3, 50] } });
		h.startRun();
		h.step(1050);
		expect(h.host.hud.splitPopup).toEqual({ label: 'Checkpoint 1', ticks: 5, delta: 2, at: 5000 });
		const s = setup({ staged: true });
		s.startRun();
		s.step(1050);
		expect(s.host.hud.splitPopup).toEqual({ label: 'Stage 2', ticks: 5, delta: null, at: 5000 });
	});

	it('fills the state packet, also while spectating', () => {
		const h = setup({ online: true });
		const read = () => {
			const s = { status: -1, stage: -1, runTicks: -1 } as unknown as NetState;
			h.mode.netState(s);
			return [s.status, s.stage, s.runTicks];
		};
		expect(read()).toEqual([Status.Idle, 0, 0]);
		h.step(100);
		expect(read()).toEqual([Status.StartZone, 0, 0]);
		h.step(300);
		h.step(1050);
		h.host.spec = { targetId: 5, freeFly: false, pos: { x: 0, y: 0, z: 0 } };
		expect(read()).toEqual([Status.Running, 1, 1]);
		h.step(2050);
		expect(read()).toEqual([Status.Finished, 1, 2]);
		expect(h.mode.run).toMatchObject({ phase: 'finished', ticks: 2 });
	});

	it('the solo scoreboard row has the best run, the phase and the stage', () => {
		const h = setup({ staged: true, best: { ticks: 77, splits: [] } });
		h.startRun();
		expect(h.mode.soloRow()).toEqual({ pbTicks: 77, status: Status.Running, stage: 1 });
	});

	it('is the mode of its map', () => {
		const h = setup();
		expect(h.mode.id).toBe('surf');
		h.host.map = { ...h.host.map, kind: 'bhop' };
		expect(new RaceMode(h.host as unknown as ClientModeHost).id).toBe('bhop');
	});
});

describe('RaceMode: finishing', () => {
	const back = `Returning to start in ${FINISH_RESET_DELAY} s…`;
	const finish = (h: Setup) => {
		h.startRun();
		h.step(1050);
		return h.step(2050).slice(1); // without the zone message
	};

	it('solo: a first and a faster run are saved with a chime; the popup compares with the run before', () => {
		const h = setup();
		expect(finish(h)).toEqual(['beep', 'save 6 5', 'chime', `New solo personal best: ${formatTicks(6)}. Solo runs are not sent to the leaderboard.`, back]);
		expect(h.host.hud.splitPopup).toEqual({ label: 'Finish', ticks: 6, delta: null, at: 5000 });

		const f = setup({ best: { ticks: 70, splits: [] } });
		expect(finish(f)).toContain(`New solo personal best: ${formatTicks(6)} (−${formatTicks(64)}). Solo runs are not sent to the leaderboard.`);
		expect(f.host.hud.splitPopup?.delta).toBe(-64);
	});

	it('solo: a slower run only shows the best', () => {
		const h = setup({ best: { ticks: 4, splits: [] } });
		expect(finish(h)).toEqual(['beep', 'save 6 5', `Finished in ${formatTicks(6)} (PB ${formatTicks(4)}).`, back]);
	});

	it('solo: an unofficial run is saved nowhere, its ghost neither', () => {
		const h = setup();
		h.host.hud.unofficial = true;
		expect(finish(h)).toEqual(['beep', `Finished in ${formatTicks(6)} (unofficial: physics cvars changed, not saved).`, back]);
		expect(h.saves).toEqual([]);
	});

	it('online: the server judges the run; the own ghost is kept here', () => {
		const h = setup({ online: true, best: { ticks: 4, splits: [] } });
		h.startRun();
		expect(h.step(2050).filter((a) => a.startsWith('save') || a.startsWith('Finished'))).toEqual([]);
		expect(h.host.hud.splitPopup?.delta).toBe(1);
		expect(h.saves.map((s) => [s.map, s.ticks])).toEqual([['surf_test', 5]]);
	});

	it('returns to the start by itself after the delay', () => {
		const h = setup();
		finish(h);
		h.host.setAngles(5, 5);
		for (let i = 0; i < FINISH_RESET_DELAY_TICKS - 1; i++) expect(h.step(2050)).toEqual([]);
		expect(h.step(2050)).toEqual(['beep', 'movedInTick']);
		expect(h.host.player.origin.x).toBe(100);
		expect(h.angles()).toEqual([0, 90]);
		expect(h.mode.run.phase).toBe('start');
	});
});

describe('RaceMode: teleports', () => {
	it('restart and respawn go to the spawn, facing its way, as a move outside a tick', () => {
		for (const go of ['restart', 'respawn'] as const) {
			const h = setup();
			h.startRun();
			h.log.length = 0;
			h.mode[go]();
			expect(h.log).toEqual(['moved']);
			expect(h.host.player.origin).toEqual({ x: 100, y: 0, z: 0 });
			expect(h.angles()).toEqual([0, 90]);
			expect(h.mode.run).toMatchObject({ phase: 'start', ticks: 0 });
		}
	});

	it('back goes to the last checkpoint and keeps the timer running', () => {
		const h = setup();
		h.startRun();
		h.step(1050);
		h.step(1300);
		h.log.length = 0;
		h.mode.back();
		expect(h.log).toEqual(['moved']);
		expect(h.host.player.origin.x).toBe(1050);
		expect(h.angles()).toEqual([0, 45]);
		expect(h.mode.run).toMatchObject({ phase: 'running', ticks: 6 });
	});

	it('a fall goes to the checkpoint, a fixed teleporter to its own place, inside the tick; the split stays', () => {
		const h = setup();
		h.startRun();
		h.step(1050);
		expect(h.step(1300, -150)).toEqual(['movedInTick']);
		expect(h.host.player.origin.x).toBe(1050);
		expect(h.angles()).toEqual([0, 45]);
		h.host.setAngles(7, 7);
		expect(h.step(1510)).toEqual(['movedInTick']);
		expect(h.host.player.origin.x).toBe(1700);
		expect(h.angles()).toEqual([0, 180]);
		expect(h.host.hud.splitPopup?.label).toBe('Checkpoint 1');
	});
});

describe('RaceMode: recording the own ghost', () => {
	/** Run ticks, x and flags of the recorded samples. */
	const samples = (t: GhostTrack) => Array.from({ length: t.length }, (_, i) => ({ tick: t.tick[i], x: t.x[i]! / t.x[0]!, flags: t.flags[i] }));

	it('from the start zone to the finish tick, with the state of each tick', () => {
		const h = setup();
		h.step(100);
		h.step(300);
		h.host.player.ducked = true;
		h.step(600);
		h.host.player.ducked = false;
		h.host.player.onGround = true;
		h.step(2050);
		h.step(2060);
		expect(h.saves).toHaveLength(1);
		expect(h.saves[0]!.ticks).toBe(2);
		const s = samples(h.saves[0]!.track);
		expect(s.map((e) => e.tick)).toEqual([0, 1, 2]);
		expect(s.map((e) => e.flags)).toEqual([0, FLAG_DUCKED, FLAG_ON_GROUND]);
		expect(s[1]!.x).toBeCloseTo(2);
	});

	it('marks the tick of a teleport and the tick after a move outside one, with the new view', () => {
		const h = setup();
		h.startRun(); // samples 0..4
		h.step(1050); // 5
		h.mode.back();
		h.step(1060); // 6: after the move
		h.step(1300); // 7
		h.step(1510); // 8: teleported in this tick
		h.step(1800); // 9
		h.step(2050); // 10: finish
		const t = h.saves[0]!.track;
		expect(Array.from(t.flags.slice(0, t.length), (f) => (f & FLAG_TELEPORTED) !== 0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => i === 6 || i === 8));
		expect(t.yaw[6]).toBe(t.yaw[7]);
		expect(t.yaw[8]).not.toBe(t.yaw[7]);
		expect(t.yaw[8]).toBe(t.yaw[9]);
	});

	it('a respawn before the run starts does not mark the run', () => {
		const h = setup();
		h.step(100);
		h.mode.respawn();
		h.step(100);
		h.step(300);
		h.step(2050);
		expect(h.saves[0]!.track.flags[0]! & FLAG_TELEPORTED).toBe(0);
	});

	it('the saved run becomes the ghost; a slower one does not', async () => {
		const h = setup();
		h.startRun();
		h.step(2050);
		await h.save(false);
		expect(h.look.label).toBe('');
		h.mode.restart();
		h.startRun();
		h.step(2050);
		await h.save(true);
		expect(h.look.label).toBe(`Your PB · ${formatTicks(5)}`);
	});
});

describe('RaceMode: the ghost', () => {
	it('asks for this map’s ghosts when it starts', () => {
		const h = setup({ online: true });
		expect(h.gets).toEqual(['surf_test']);
		expect(h.sent).toEqual([{ type: 'getGhost', map: 'surf_test' }]);
	});

	it('plays along with the run timer, except with cl_ghost 0 and while spectating', async () => {
		const h = setup();
		await h.load(pbGhost());
		expect(h.look.label).toBe(`Your PB · ${formatTicks(80)}`);
		h.step(100);
		h.mode.frame();
		expect(h.pose.visible).toBe(false);
		h.startRun(); // run tick 4
		h.host.alpha = 0.5;
		h.mode.frame();
		expect(h.pose).toMatchObject({ visible: true, x: 35, ramp: { z: 0.5 } });
		h.host.cvars.cl_ghost = 0;
		h.mode.frame();
		expect(h.pose).toMatchObject({ visible: false, ramp: null });
		h.host.cvars.cl_ghost = 1;
		h.host.spec = { targetId: null, freeFly: true, pos: { x: 0, y: 0, z: 0 } };
		h.mode.frame();
		expect(h.pose.visible).toBe(false);
	});

	it('works without WebGL', async () => {
		const h = setup({ renderer: false });
		await h.load(pbGhost());
		h.startRun();
		expect(() => {
			h.mode.frame();
			h.mode.peopleChanged();
			h.mode.dispose();
		}).not.toThrow();
	});

	it('online the record ghost goes before the own one, until the server has none', async () => {
		const h = setup({ online: true });
		await h.load(pbGhost());
		await record(h);
		expect(h.look.label).toBe(`Alice · ${formatTicks(50)}`);
		expect(h.log).toEqual([`Record ghost: Alice ${formatTicks(50)}`]);
		h.mode.ghostFrame(frame(h, { has: false }));
		expect(h.look.label).toBe(`Your PB · ${formatTicks(80)}`);
	});

	it('takes no frame offline or of another map', async () => {
		const off = setup();
		off.mode.ghostFrame(frame(off));
		const h = setup({ online: true });
		h.mode.ghostFrame(frame(h, { map: 'surf_other' }));
		expect(inflating).toEqual([]);
		await record(h);
		h.mode.ghostFrame(frame(h, { map: 'surf_other', has: false }));
		h.startRun();
		h.mode.frame();
		expect(h.pose.visible).toBe(true);
	});

	it('says so when the record cannot be decoded and keeps the ghost it has', async () => {
		const h = setup({ online: true });
		await h.load(pbGhost());
		h.mode.ghostFrame(frame(h));
		inflating.shift()!(null);
		h.mode.ghostFrame(frame(h));
		await settle();
		expect(h.log).toEqual([]);
		inflating.shift()!(new Uint8Array([255]));
		await settle();
		expect(h.log).toEqual(['ghostUnavailable']);
		expect(h.look.label).toBe(`Your PB · ${formatTicks(80)}`);
	});

	it('drops a decoded record that a newer frame, a lost connection or a disposal overtook', async () => {
		const overtake: Record<string, (h: Setup) => void> = {
			frame: (h) => h.mode.ghostFrame(frame(h, { has: false })),
			offline: (h) => {
				h.host.online = false;
				h.mode.offline();
			},
			dispose: (h) => h.mode.dispose()
		};
		for (const by of Object.values(overtake)) {
			const h = setup({ online: true });
			h.mode.ghostFrame(frame(h));
			by(h);
			inflating.shift()!(packGhost(makeTrack(50)));
			await settle();
			expect(h.look.label).toBe('');
			expect(h.log).toEqual([]);
		}
	});

	it('offline drops the record, keeps the run and asks for nothing again', async () => {
		const h = setup({ online: true });
		await h.load(pbGhost());
		await record(h);
		h.startRun();
		const { run } = h.mode;
		h.host.online = false;
		h.mode.offline();
		expect(h.look.label).toBe(`Your PB · ${formatTicks(80)}`);
		h.step(400);
		expect(h.mode.run).toBe(run);
		expect(run).toMatchObject({ phase: 'running', ticks: 5 });
		expect(h.gets).toHaveLength(1);
		expect(h.sent.filter((m) => m.type === 'getGhost')).toHaveLength(1);
		expect(h.step(2050)).toContain('save 6 ');
		expect(h.saves[0]!.track.length).toBe(7);
	});

	it('the record dropped offline does not come back with the own ghost', async () => {
		const h = setup({ online: true });
		await record(h);
		h.host.online = false;
		h.mode.offline();
		h.host.online = true;
		await h.load(pbGhost());
		expect(h.look.label).toBe(`Your PB · ${formatTicks(80)}`);
	});

	it('looks like the player of its run, again whenever the people change', async () => {
		const h = setup({ online: true });
		await h.load(pbGhost());
		h.host.hud.shop = { loadout: LOADOUT };
		h.mode.peopleChanged();
		expect(h.look).toMatchObject({ person: 3, loadout: LOADOUT });

		// The holder is not here: always the same person, in what the server says they wear on this map.
		await record(h);
		const stranger = h.look.person;
		expect(stranger).not.toBe(3);
		expect(h.look.loadout).toBeNull();
		h.host.ghostLook = { map: 'surf_other', loadout: LOADOUT };
		h.mode.peopleChanged();
		expect(h.look).toMatchObject({ person: stranger, loadout: null });
		h.host.ghostLook = { map: 'surf_test', loadout: LOADOUT };
		h.mode.peopleChanged();
		expect(h.look).toMatchObject({ person: stranger, loadout: LOADOUT });

		h.host.remotes.set(4, { id: 4, name: 'Bob' } as RemotePlayer);
		h.host.remotes.set(6, { id: 6, name: 'Alice' } as RemotePlayer);
		h.mode.peopleChanged();
		expect(h.look).toMatchObject({ person: 6, loadout: null });

		h.host.hud.account = { username: 'Alice' };
		h.mode.peopleChanged();
		expect(h.look).toMatchObject({ person: 3, loadout: LOADOUT });
	});

	it('dispose hides the ghost; late results and frames bring nothing back', async () => {
		const h = setup();
		await h.load(pbGhost());
		h.startRun();
		h.mode.frame();
		expect(h.pose.visible).toBe(true);
		h.step(2050);
		h.mode.dispose();
		expect(h.pose.visible).toBe(false);
		Object.assign(h.look, { label: '', dressed: 0 });
		await h.save(true);
		expect(h.look).toMatchObject({ label: '', dressed: 0 });
		h.mode.restart();
		h.startRun();
		h.mode.frame();
		expect(h.pose.visible).toBe(false);

		const late = setup();
		late.mode.dispose();
		await late.load(pbGhost());
		expect(late.look).toMatchObject({ label: '', dressed: 0 });
	});
});
