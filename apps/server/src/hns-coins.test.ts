/** Coins of hide and seek (docs/economy.md#hide-and-seek): the real mode and economy in a simulated lobby. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HnsEvent, MapDef, NetState, ServerMessage } from '@surf/shared';
import { FLAG_ON_GROUND, HNS_START_SECS, Status } from '@surf/shared';
import { world, type SimPlayer } from './economy-helpers.ts';
import { HNS_BAG_RETRY_DIST, HnsMode } from './modes/hns.ts';
import type { ModeHost, ModePlayer } from './modes/types.ts';
import { testMap } from './test-helpers.ts';

const HIDE = 10;
const SEEK = 240;
const END = 8;
const BAG = { x: 0, y: 20_000, z: 0 };

function hnsMap(): MapDef {
	return {
		...testMap('hns_test', 'HNS Test'),
		kind: 'hns',
		layout: 'open',
		spawns: [],
		zones: [],
		hns: {
			hiderSpawns: Array.from({ length: 12 }, (_, i) => ({ pos: { x: 10_000 + i * 3000, y: 0, z: 0 }, yaw: 90 })),
			seekerSpawns: [{ pos: { x: -800, y: 0, z: 0 }, yaw: 180 }],
			cashBag: { pos: BAG, place: 'here' }
		}
	};
}

interface Pose {
	x: number;
	y: number;
	z?: number;
	yaw?: number;
	/** Look and move around a little, like a person (default true). */
	alive?: boolean;
}

type Sim = SimPlayer & { ping: number; state: NetState | null };

function lobby(n: number, opts: { guests?: number } = {}) {
	const map = hnsMap();
	const w = world(map);
	const chat: string[] = [];
	const told: string[] = [];
	const events: HnsEvent[] = [];
	const poses = new Map<number, Pose>();
	const host: ModeHost = {
		map,
		db: w.db,
		economy: w.mode,
		now: () => w.now,
		rng: () => 0,
		players: () => w.players as unknown as Iterable<ModePlayer>,
		send: (p, m: ServerMessage) => {
			w.economy.sent(p as unknown as SimPlayer, m);
			if (m.type !== 'hns') return;
			events.push(m.ev);
			if (m.ev.e === 'spawn') poses.set(m.ev.id, { ...m.ev.pos, yaw: m.ev.yaw });
		},
		broadcast: (m) => {
			if (m.type === 'hns') events.push(m.ev);
		},
		sendBinary: () => {},
		broadcastBinary: () => {},
		system: (t) => void chat.push(t),
		systemTo: (_p, t) => void told.push(t),
		guestRunNotice: () => {},
		log: () => {}
	};
	const mode = new HnsMode(host, { hideSecs: HIDE, seekSecs: SEEK, endSecs: END });
	const ready = (p: SimPlayer): Sim => Object.assign(p as Sim, { ping: 30, state: null });
	const all: Sim[] = [];
	for (let i = 0; i < n; i++) all.push(ready(i < n - (opts.guests ?? 0) ? w.join(1)[0]! : w.guest()));
	let t = 0;
	const s = {
		w,
		mode,
		all,
		chat,
		told,
		events,
		poses,
		add(): Sim {
			const p = ready(w.join(1)[0]!);
			mode.join(p as unknown as ModePlayer);
			return p;
		},
		leave(p: Sim): void {
			w.leave(p);
			mode.leave(p as unknown as ModePlayer);
		},
		/** Put a player somewhere (an explained move). */
		put(p: Sim, pose: Pose): void {
			w.mode.teleported(p.id);
			poses.set(p.id, pose);
		},
		/** One packet for everyone. `jump`: an unexplained move. */
		packet(): void {
			for (const p of w.players as Set<Sim>) {
				const pose = poses.get(p.id) ?? { x: p.id * 500, y: -9000 };
				poses.set(p.id, pose);
				const live = pose.alive !== false;
				p.tick += 4;
				const prev = p.state;
				const x = pose.x + (live ? 20 * Math.sin(t * 0.8 + p.id) : 0);
				const y = pose.y + (live ? 14 * Math.cos(t * 0.53 + p.id) : 0);
				p.state = {
					tick: p.tick, x, y, z: pose.z ?? 0,
					vx: prev ? Math.max(-300, Math.min(300, (x - prev.x) * 16)) : 0,
					vy: prev ? Math.max(-300, Math.min(300, (y - prev.y) * 16)) : 0,
					vz: 0, pitch: 0, yaw: (pose.yaw ?? 0) + (live ? 8 * Math.sin(t * 1.7 + p.id * 2) : 0),
					flags: FLAG_ON_GROUND, status: Status.Hider, stage: 0, runTicks: 0
				};
				w.stillness.set(p.id, mode.stillness(p as unknown as ModePlayer));
				w.economy.state(p, p.state);
				mode.state(p as unknown as ModePlayer, p.state);
			}
		},
		/** Let time pass at 16 Hz. */
		run(secs: number, each?: (dt: number) => void): void {
			for (let i = 0; i < Math.round(secs * 16); i++) {
				t += 1 / 16;
				w.clock += 62.5;
				w.now += 62.5;
				each?.(1 / 16);
				s.packet();
				w.economy.tick();
				mode.tick();
			}
		},
		/** From nothing to the seeking phase. */
		start(): { seeker: Sim; hiders: Sim[] } {
			s.run(0.5);
			s.run(HNS_START_SECS + 0.1);
			assert.equal(mode.game.phase, 'hiding');
			return s.release();
		},
		release(): { seeker: Sim; hiders: Sim[] } {
			s.run(HIDE);
			assert.equal(mode.game.phase, 'seeking');
			const seeker = all.find((p) => mode.game.role(p.id) === 'seeker')!;
			// Out of everyone's sight until a test says otherwise.
			s.put(seeker, { x: -50_000, y: 0, yaw: 180 });
			s.run(1);
			return { seeker, hiders: all.filter((p) => mode.game.role(p.id) === 'hider') };
		},
		/** Stab a hider, with real positions and a real swing. */
		find(seeker: Sim, target: Sim): void {
			const q = poses.get(target.id)!;
			s.put(target, { ...q, alive: false });
			s.put(seeker, { x: q.x - 40, y: q.y, yaw: 0, alive: false });
			s.run(0.8);
			mode.message(seeker as unknown as ModePlayer, { type: 'knife', origin: { x: q.x - 40, y: q.y, z: 64 }, dir: { x: 1, y: 0, z: 0 } });
		},
		/** The hider runs along +X, the seeker 300 behind. */
		chase(seeker: Sim, hider: Sim, secs: number): void {
			const h = { x: 0, y: 60_000, yaw: 0, alive: false };
			const k = { x: -300, y: 60_000, yaw: 0, alive: false };
			s.put(hider, h);
			s.put(seeker, k);
			s.run(0.5);
			s.run(secs, (dt) => {
				h.x += 250 * dt;
				k.x += 250 * dt;
			});
			s.put(hider, { x: 10_000, y: 90_000 });
			s.put(seeker, { x: -50_000, y: 0, yaw: 180 });
			s.run(0.5);
		},
		/** Base points paid to a player for a reason. */
		paid(p: Sim, reason: string): number {
			return w.sent(p, 'award').filter((m) => m.reason === reason).reduce((a, m) => a + m.base, 0) / 10;
		},
		any(p: Sim): string[] {
			return w.sent(p, 'award').map((m) => m.reason).filter((r) => r !== 'playtime');
		}
	};
	for (const p of all) mode.join(p as unknown as ModePlayer);
	return s;
}

describe('hide and seek coins: chases, views, finds', () => {
	it('a chase pays the seeker 1 per 20 s (cap 4) and the hider 1 per 10 s (cap 8)', () => {
		const s = lobby(5);
		const { seeker, hiders } = s.start();
		s.chase(seeker, hiders[0]!, 41);
		assert.equal(s.paid(seeker, 'hnsChase'), 2);
		assert.equal(s.paid(hiders[0]!, 'hnsChased'), 4);
		assert.equal(s.paid(hiders[0]!, 'hnsView'), 0, 'chase time is not view time');
		// The multiplier of 5 active players.
		assert.equal(s.w.sent(seeker, 'award')[0]!.mult, 14);
		s.chase(seeker, hiders[0]!, 70);
		assert.equal(s.paid(seeker, 'hnsChase'), 4);
		assert.equal(s.paid(hiders[0]!, 'hnsChased'), 8);
	});

	it('a find pays 3; the found hider keeps what they earned and earns as a seeker from then on', () => {
		const s = lobby(6);
		const { seeker, hiders } = s.start();
		s.chase(seeker, hiders[0]!, 21);
		const before = s.paid(hiders[0]!, 'hnsChased');
		assert.ok(before >= 2);
		s.find(seeker, hiders[0]!);
		assert.equal(s.paid(seeker, 'hnsFind'), 3);
		assert.equal(s.mode.game.role(hiders[0]!.id), 'seeker');
		s.run(4);
		s.find(hiders[0]!, hiders[1]!);
		assert.equal(s.paid(hiders[0]!, 'hnsFind'), 3);
		assert.equal(s.paid(hiders[0]!, 'hnsChased'), before);
		// Seekers win: only who started as a seeker.
		s.run(4);
		for (const h of hiders.slice(2)) {
			s.find(seeker, h);
			s.run(1);
		}
		assert.equal(s.mode.game.winner, 'seekers');
		assert.equal(s.paid(seeker, 'hnsSeekersWin'), 3);
		for (const h of hiders) {
			assert.equal(s.paid(h, 'hnsSeekersWin'), 0);
			assert.equal(s.paid(h, 'hnsSurvive'), 0);
		}
	});

	it('plain view pays 2 per 30 s in one small area (cap 6); a new area starts over', () => {
		const s = lobby(5);
		const { seeker, hiders } = s.start();
		const h = hiders[0]!;
		s.put(h, { x: 1000, y: 70_000 });
		s.put(seeker, { x: 0, y: 70_000, yaw: 0 });
		s.run(25);
		assert.equal(s.paid(h, 'hnsView'), 0);
		s.put(h, { x: 1000, y: 70_300 });
		s.run(25);
		assert.equal(s.paid(h, 'hnsView'), 0, 'moved to a new area');
		s.run(8);
		assert.equal(s.paid(h, 'hnsView'), 2);
		s.run(30);
		assert.equal(s.paid(h, 'hnsView'), 4);
		s.run(62);
		assert.equal(s.paid(h, 'hnsView'), 6);
	});

	it('a blindfolded, frozen or absent seeker sees and chases nobody', () => {
		const s = lobby(5);
		s.run(0.5);
		s.run(HNS_START_SECS + 0.1);
		const seeker = s.all.find((p) => s.mode.game.role(p.id) === 'seeker')!;
		const h = s.all.find((p) => p !== seeker)!;
		// In front of the cage during the hiding phase.
		s.put(h, { x: -1800, y: 0 });
		s.run(HIDE - 0.5);
		s.run(0.6);
		s.put(seeker, { x: -800, y: 0, yaw: 180, alive: false });
		s.run(1);
		const early = (s.mode as unknown as { seenMs: Map<number, number> }).seenMs.get(h.id) ?? 0;
		assert.ok(early < 2500, `seen ${early}`);
		// An AFK seeker: no views after 30 s.
		s.run(60);
		assert.equal(s.paid(h, 'hnsView'), 0);
	});
});

describe('hide and seek coins: the end of a round', () => {
	it('survivors get 5 when seen for 5 s, else 2', () => {
		const s = lobby(5);
		const { seeker, hiders } = s.start();
		s.put(hiders[0]!, { x: 1000, y: 70_000 });
		s.put(seeker, { x: 0, y: 70_000, yaw: 0 });
		s.run(7);
		s.put(seeker, { x: -50_000, y: 0, yaw: 180 });
		s.run(SEEK - 7);
		assert.equal(s.mode.game.winner, 'hiders');
		assert.equal(s.paid(hiders[0]!, 'hnsSurvive'), 5);
		assert.equal(s.paid(hiders[1]!, 'hnsSurvive'), 2);
		assert.deepEqual(s.any(seeker), []);
	});

	it('a late joiner seeks, is paid for finds but not for the win, and sees the bag', () => {
		const s = lobby(5);
		const { seeker, hiders } = s.start();
		s.run(SEEK / 2);
		const late = s.add();
		// Not active before the first movement.
		s.run(8);
		assert.equal(s.mode.game.role(late.id), 'seeker');
		const st = s.mode.stateMessage();
		assert.ok(st.mode === 'hns' && st.bag?.phase === 'out');
		s.find(late, hiders[0]!);
		assert.equal(s.paid(late, 'hnsFind'), 3);
		for (const h of hiders.slice(1)) {
			s.run(1);
			s.find(seeker, h);
		}
		assert.equal(s.paid(seeker, 'hnsSeekersWin'), 3);
		assert.equal(s.paid(late, 'hnsSeekersWin'), 0);
	});

	it('the only seeker leaves: the promoted hider seeks on without the win bonus', () => {
		const s = lobby(6);
		const { seeker, hiders } = s.start();
		s.leave(seeker);
		s.run(5);
		const next = hiders.find((p) => s.mode.game.role(p.id) === 'seeker')!;
		for (const h of hiders.filter((p) => p !== next)) {
			s.find(next, h);
			s.run(1);
		}
		assert.equal(s.mode.game.winner, 'seekers');
		assert.equal(s.paid(next, 'hnsFind'), 12);
		assert.equal(s.paid(next, 'hnsSeekersWin'), 0);
	});

	it('a cancelled round pays nothing and the next one starts clean', () => {
		const s = lobby(5);
		const { seeker, hiders } = s.start();
		s.run(SEEK / 2);
		for (const h of hiders) s.leave(h);
		s.run(0.5);
		assert.equal(s.mode.game.phase, 'waiting');
		assert.deepEqual(s.any(seeker), []);
		assert.equal(s.mode.game.bagCoins, null);
	});

	it('fewer than 5 active players: no awards and no bag', () => {
		const s = lobby(4);
		const { seeker, hiders } = s.start();
		s.chase(seeker, hiders[0]!, 41);
		s.find(seeker, hiders[0]!);
		s.run(SEEK - 40);
		assert.equal(s.mode.game.phase === 'ended' || s.mode.game.phase === 'hiding', true);
		for (const p of s.all) assert.deepEqual(s.any(p), []);
		assert.equal(s.events.some((e) => e.e === 'bag'), false);
	});
});

describe('hide and seek coins: the cash bag', () => {
	const toBag = (n: number, o = {}) => {
		const s = lobby(n, o);
		const r = s.start();
		assert.equal(s.events.some((e) => e.e === 'bag'), false);
		s.run(SEEK / 2);
		assert.equal(s.events.filter((e) => e.e === 'bag').length, 1);
		assert.ok(s.chat.some((c) => c.startsWith('A bag of cash appeared here!')));
		return { s, ...r };
	};
	const walkOver = (s: ReturnType<typeof lobby>, p: Sim) => {
		const pose = { x: BAG.x - 400, y: BAG.y, alive: false };
		s.put(p, pose);
		s.run(6);
		s.run(3.2, (dt) => (pose.x += 250 * dt));
	};

	it('a hider takes it by touch: paid with the multiplier, announced, once', () => {
		const { s, hiders } = toBag(6);
		walkOver(s, hiders[0]!);
		assert.equal(s.paid(hiders[0]!, 'hnsBag'), 4);
		const a = s.w.sent(hiders[0]!, 'award').find((m) => m.reason === 'hnsBag')!;
		assert.equal(a.amount, 60);
		assert.ok(s.events.some((e) => e.e === 'bagTaken' && e.by === hiders[0]!.id && e.coins === 4 && e.paid === 60));
		assert.ok(s.chat.includes(`${hiders[0]!.name} grabbed the cash bag: 6 coins!`));
		walkOver(s, hiders[1]!);
		assert.equal(s.paid(hiders[1]!, 'hnsBag'), 0);
	});

	it('seekers never take it, also after being found', () => {
		const { s, seeker, hiders } = toBag(5);
		walkOver(s, seeker);
		s.find(seeker, hiders[0]!);
		s.run(4);
		walkOver(s, hiders[0]!);
		assert.equal(s.mode.game.bagCoins, 4);
		assert.equal(s.paid(seeker, 'hnsBag') + s.paid(hiders[0]!, 'hnsBag'), 0);
	});

	it('no remote pickup: jumping onto it is refused, waiting there too, walking up to it works', () => {
		const { s, hiders } = toBag(5);
		const h = hiders[0]!;
		s.run(5);
		s.poses.set(h.id, { x: BAG.x, y: BAG.y });
		s.run(20);
		assert.equal(s.mode.game.bagCoins, 4);
		const pose = { x: BAG.x, y: BAG.y, alive: false };
		s.poses.set(h.id, pose);
		s.run(2, (dt) => (pose.x += 200 * dt));
		assert.ok(pose.x > HNS_BAG_RETRY_DIST);
		s.run(2, (dt) => (pose.x -= 200 * dt));
		assert.equal(s.paid(h, 'hnsBag'), 4);
	});

	it('unclaimed: gone with the round, and said so', () => {
		const { s } = toBag(5);
		s.run(SEEK / 2 + 1);
		assert.equal(s.mode.game.phase, 'ended');
		assert.ok(s.chat.includes('Nobody took the cash bag.'));
		const st = s.mode.stateMessage();
		assert.ok(st.mode === 'hns' && st.bag === null);
	});

	it('a guest can take it without coins; too few players leave it lying', () => {
		const g = toBag(6, { guests: 1 });
		const guest = g.hiders.find((p) => p.accountId === null)!;
		walkOver(g.s, guest);
		assert.ok(g.s.chat.includes(`${guest.name} grabbed the cash bag.`));
		const f = toBag(5);
		f.s.leave(f.hiders[3]!);
		walkOver(f.s, f.hiders[0]!);
		assert.equal(f.s.mode.game.bagCoins, 4);
		assert.ok(f.s.told.some((t) => t.startsWith('The cash bag needs 5 active players')));
	});
});

describe('hide and seek coins: abuse', () => {
	it('friends playing normally for several rounds get no warning', () => {
		const s = lobby(6);
		let r = s.start();
		for (let round = 0; round < 4; round++) {
			const { seeker, hiders } = r;
			s.chase(seeker, hiders[0]!, 25);
			s.chase(seeker, hiders[1]!, 22);
			s.find(seeker, hiders[0]!);
			s.run(5);
			s.chase(hiders[0]!, hiders[2]!, 24);
			s.find(hiders[0]!, hiders[2]!);
			s.put(hiders[3]!, { x: 1000, y: 70_000 });
			s.put(seeker, { x: 0, y: 70_000, yaw: 0 });
			s.run(33);
			s.put(seeker, { x: -50_000, y: 0, yaw: 180 });
			while (s.mode.game.phase === 'seeking') s.run(2);
			s.run(END);
			r = s.release();
		}
		assert.deepEqual(s.w.logs.filter((l) => l.startsWith('abuse')), []);
		assert.deepEqual(s.w.bans, []);
	});
});
