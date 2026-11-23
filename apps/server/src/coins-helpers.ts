/** A server mode on the simulated lobby of economy-helpers.ts (coin tests). Not a test file itself. */
import type { ServerMessage } from '@surf/shared';
import type { SimPlayer, world } from './economy-helpers.ts';
import type { ModeHost } from './modes/types.ts';

type World = ReturnType<typeof world>;

/** `ModeHost` of the current map session; its messages are collected in `out`. */
export function modeHost(w: World, out: ServerMessage[] = []): ModeHost {
	return {
		map: w.map,
		db: w.db,
		economy: w.mode,
		now: () => w.now,
		rng: () => 0.5,
		players: () => [...w.players].map((p) => Object.assign(p, { ping: 0 })) as (SimPlayer & { ping: number })[],
		send: (p, m) => {
			out.push(m);
			w.economy.sent(p as unknown as SimPlayer, m);
		},
		broadcast: (m) => void out.push(m),
		sendBinary: () => {},
		broadcastBinary: () => {},
		system: () => {},
		systemTo: () => {},
		guestRunNotice: () => {},
		log: () => {}
	};
}

/** Awards the player got since `from`: `reason points ×mult`, e.g. `raceFinish 4`. */
export function paid(w: World, p: SimPlayer, from = 0): string[] {
	return w.sent(p, 'award').slice(from).map((m) => `${m.reason === 'zombiesGate' ? m.label : m.reason} ${m.base / 10}`);
}
