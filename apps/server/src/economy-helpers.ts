/** A simulated lobby for the economy tests: fake clocks, players, input. Not a test file itself. */
import { FLAG_ON_GROUND, Status, type MapDef, type ServerMessage } from '@surf/shared';
import type { Stillness } from './activity.ts';
import { Db } from './db.ts';
import { Economy, type EconomyPlayer, type ModeEconomy } from './economy.ts';

export interface SimPlayer extends EconomyPlayer {
	id: number;
	accountId: number | null;
	spectating: boolean;
	helloed: boolean;
	ip: string | null;
	x: number;
	y: number;
	yaw: number;
	pitch: number;
	dir: number;
	tick: number;
	rng: () => number;
}

/** Small deterministic generator. */
export function seeded(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface RunOptions {
	/** Packets per second (default 32). */
	hz?: number;
	/** These look around while standing. */
	look?: number[];
	/** Nobody sends packets. */
	silent?: boolean;
	flags?: number;
	/** Claimed speed per player id. */
	speed?: Record<number, number>;
	/** How moving players play (default human). */
	input?: 'still' | 'heldKey' | 'spin' | 'macro' | 'human' | ((id: number) => 'heldKey' | 'spin' | 'macro' | 'human');
	/** Called before every step. */
	each?: (secs: number) => void;
}

export function world(first: MapDef) {
	const db = new Db(':memory:');
	const players = new Set<SimPlayer>();
	const log = new Map<SimPlayer, ServerMessage[]>();
	const logs: string[] = [];
	const bans: { accountId: number; reason: string; ms: number }[] = [];
	const admins = new Set<number>();
	let nextId = 1;
	let simAt = 0;
	const w = {
		db,
		players,
		logs,
		bans,
		admins,
		map: first,
		/** Wall clock. */
		now: 1_700_000_000_000,
		/** Monotonic clock. */
		clock: 1000,
		totals: new Map<number, number>(),
		stillness: new Map<number, Stillness>(),
		economy: null as unknown as Economy,
		mode: null as unknown as ModeEconomy,
		sent<K extends ServerMessage['type']>(p: SimPlayer, type: K): Extract<ServerMessage, { type: K }>[] {
			return (log.get(p) ?? []).filter((m) => m.type === type) as Extract<ServerMessage, { type: K }>[];
		},
		add(accountId: number | null, playerId: string, name: string, ip: string | null = null): SimPlayer {
			const id = nextId++;
			const p: SimPlayer = {
				id, playerId, accountId, name, ip,
				spectating: false, helloed: true, state: null,
				x: id * 10_000, y: 0, yaw: 0, pitch: 0, dir: 1, tick: 0, rng: seeded(id * 7919)
			};
			players.add(p);
			log.set(p, []);
			w.economy.join(p);
			return p;
		},
		join(n: number, ip: (i: number) => string | null = () => null): SimPlayer[] {
			return Array.from({ length: n }, (_, i) => {
				const name = `P${nextId}`;
				return w.add(db.createAccount(name, 'h')!.id, `key-${name}`, name, ip(i));
			});
		},
		guest(playerId = `guest-${nextId}`, ip: string | null = null): SimPlayer {
			return w.add(null, playerId, `Guest${nextId}`, ip);
		},
		rejoin(p: SimPlayer): SimPlayer {
			return w.add(p.accountId, p.playerId, p.name, p.ip);
		},
		leave(p: SimPlayer): void {
			players.delete(p);
			w.economy.leave(p);
		},
		changeMap(map: MapDef): void {
			w.map = map;
			w.economy.useMap(map);
			w.mode = w.economy.forMode();
		},
		activeMs(p: SimPlayer): number {
			w.economy.flush();
			return db.activeMs(p.accountId!);
		},
		/** Everyone moves for a second. */
		active(): void {
			w.run(1, () => true);
		},
		/** Let `secs` pass; players for whom `moves` is true run around. */
		run(secs: number, moves: (id: number) => boolean, o: RunOptions = {}): void {
			const hz = o.hz ?? 32;
			const dt = 1 / hz;
			for (let i = 0; i < Math.round(secs * hz); i++) {
				w.clock += dt * 1000;
				w.now += dt * 1000;
				simAt += dt;
				o.each?.(i * dt);
				for (const p of players) {
					if (p.spectating || o.silent) continue;
					const moving = moves(p.id);
					const input = typeof o.input === 'function' ? o.input(p.id) : (o.input ?? 'human');
					if (moving) move(p, dt, input);
					else if (o.look?.includes(p.id)) look(p);
					p.tick += Math.round(64 * dt);
					const speed = o.speed?.[p.id] ?? (moving ? 250 : 0);
					const rad = ((p.yaw + (p.dir < 0 ? 180 : 0)) * Math.PI) / 180;
					w.economy.state(p, {
						tick: p.tick, x: p.x, y: p.y, z: 0, vx: Math.cos(rad) * speed, vy: Math.sin(rad) * speed, vz: 0,
						pitch: p.pitch, yaw: p.yaw, flags: o.flags ?? FLAG_ON_GROUND, status: Status.Runner, stage: 0, runTicks: 0
					});
				}
				w.economy.tick();
			}
		}
	};

	function look(p: SimPlayer): void {
		p.yaw += (p.rng() - 0.5) * 30;
	}
	function move(p: SimPlayer, dt: number, input: string): void {
		if (input === 'heldKey') {
			// Running in a straight line for ever.
			p.x += 250 * dt;
			return;
		}
		if (input === 'spin') p.yaw += 90 * dt;
		else if (input === 'macro') p.yaw += (simAt % 4 < 2 ? 40 : -40) * dt;
		else {
			// A hand on the mouse: flicks of any size, now and then a change of direction.
			if (p.rng() < 4 * dt) p.yaw += (p.rng() - 0.5) * 120;
			else if (p.rng() < 8 * dt) p.yaw += (p.rng() - 0.5) * 20;
			if (p.rng() < 2 * dt) p.pitch = (p.rng() - 0.5) * 60;
			if (p.rng() < 0.5 * dt) p.dir = -p.dir;
		}
		const rad = (p.yaw * Math.PI) / 180;
		p.x += Math.cos(rad) * p.dir * 250 * dt;
		p.y += Math.sin(rad) * p.dir * 250 * dt;
	}

	w.economy = new Economy(
		{
			db,
			now: () => w.now,
			clock: () => w.clock,
			players: () => players,
			send: (p, m) => void log.get(p as SimPlayer)?.push(m),
			broadcast: (m) => {
				for (const p of players) log.get(p)!.push(m);
			},
			systemTo: () => {},
			totals: (id, t) => void w.totals.set(id, t),
			isAdmin: (id) => admins.has(id),
			ban: (accountId, reason, ms) => void bans.push({ accountId, reason, ms }),
			abuseLogged: () => {},
			log: (m) => void logs.push(m),
			stillness: (p) => w.stillness.get(p.id) ?? null
		},
		first
	);
	w.mode = w.economy.forMode();
	return w;
}
