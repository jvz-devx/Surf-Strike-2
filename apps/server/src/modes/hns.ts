/**
 * Hide and seek gamemode (docs/modes.md#hide-and-seek). Server-authoritative:
 * the shared `HnsGame` (round flow, seeker picks, freeze, knife hits with lag
 * compensation, conversions, win conditions) runs here on the latest state
 * packets; clients send `knife` swings and display the results. Positions stay
 * client-authoritative as in the other modes, but frozen seekers are pulled
 * back to their spawn and over-cap speeds void knife swings.
 */
import type { HnsEvent, MapRecordInfo, NetState, ScoreRow, ServerMessage } from '@surf/shared';
import {
	buildCollisionWorld,
	FLAG_DUCKED,
	HNS_MAX_REWIND_MS,
	HnsGame,
	HNS_SPEED_LIMIT,
	overSpeedCap,
	Status,
	type HnsGameOptions,
	type Vec3
} from '@surf/shared';
import type { Command } from '../commands.ts';
import type { ModeClientMessage, ModeHost, ModePlayer, ServerMode } from './types.ts';
import { EMPTY_RECORDS } from './types.ts';

/** Mode state is re-sent at least this often (ms). */
export const HNS_STATE_MS = 1000;
/** Client-side interpolation delay of remote players (apps/web net/interp.ts INTERP_DELAY_MS) plus half a snapshot interval. */
export const HNS_VIEW_DELAY_MS = 100 + 16;
/** A seeker's swings are void this long after a state packet over the speed cap. */
export const HNS_SPEED_PENALTY_MS = 1000;

export type HnsModeOptions = Pick<HnsGameOptions, 'startSecs' | 'hideSecs' | 'seekSecs' | 'endSecs' | 'foundFreezeSecs'>;

/** Round lengths from the environment (HNS_HIDE_SECS, HNS_SEEK_SECS); unset = defaults. */
export function hnsEnvOptions(env: NodeJS.ProcessEnv = process.env): HnsModeOptions {
	const num = (v: string | undefined, min: number, max: number) => {
		const n = Number(v);
		return v !== undefined && v !== '' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : undefined;
	};
	const out: HnsModeOptions = {};
	const hide = num(env.HNS_HIDE_SECS, 5, 300);
	const seek = num(env.HNS_SEEK_SECS, 30, 1800);
	if (hide !== undefined) out.hideSecs = hide;
	if (seek !== undefined) out.seekSecs = seek;
	return out;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

function clock(secs: number): string {
	const t = Math.max(0, Math.round(secs));
	return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export class HnsMode implements ServerMode {
	readonly id = 'hns' as const;
	readonly game: HnsGame;
	/** Last over-cap state per player (ms). */
	private readonly overCap = new Map<number, number>();
	private lastSent = -Infinity;

	constructor(
		private readonly host: ModeHost,
		opts: HnsModeOptions = {}
	) {
		const map = host.map;
		const world = buildCollisionWorld(map);
		this.game = new HnsGame({
			...opts,
			map,
			now: host.now(),
			rng: () => host.rng(),
			los: (a, b) => world.trace(a, b, ZERO, ZERO).fraction >= 1
		});
	}

	join(p: ModePlayer): void {
		this.tick();
		this.host.send(p, this.stateMessage());
		this.host.systemTo(
			p,
			'Hide and seek: hiders hide while the seekers are blindfolded; seekers then hunt them with knives (Mouse1). A found hider becomes a seeker. Hiders win if anyone is still hidden when time runs out.'
		);
		if (this.game.inRound) this.host.systemTo(p, 'A round is running: you join as a seeker.');
	}

	leave(p: ModePlayer): void {
		this.overCap.delete(p.id);
		this.tick();
	}

	spectate(): void {
		this.tick();
	}

	state(p: ModePlayer, s: NetState): void {
		const now = this.host.now();
		this.game.setPos(p.id, { x: s.x, y: s.y, z: s.z, ducked: (s.flags & FLAG_DUCKED) !== 0 }, now);
		if (overSpeedCap(s.vx, s.vy)) {
			const prev = this.overCap.get(p.id) ?? -Infinity;
			if (now - prev > 5000) this.host.log(`hns: #${p.id} ${p.name} over the ${HNS_SPEED_LIMIT} u/s limit (${Math.round(Math.hypot(s.vx, s.vy))})`);
			this.overCap.set(p.id, now);
		}
	}

	zone(): void {}

	records(): MapRecordInfo {
		return { ...EMPTY_RECORDS };
	}

	message(p: ModePlayer, msg: ModeClientMessage): void {
		if (msg.type !== 'knife' || p.spectating || !this.game.has(p.id)) return;
		const now = this.host.now();
		if (now - (this.overCap.get(p.id) ?? -Infinity) < HNS_SPEED_PENALTY_MS) return;
		const rewind = Math.min(HNS_MAX_REWIND_MS, p.ping + HNS_VIEW_DELAY_MS);
		const res = this.game.swing(p.id, { origin: msg.origin, dir: msg.dir }, now, rewind);
		this.dispatch(res.events);
	}

	command(p: ModePlayer, cmd: Command): boolean {
		if (cmd.cmd !== 'top' && cmd.cmd !== 'pb') return false;
		const g = this.game;
		this.host.systemTo(p, `No leaderboard in hide and seek. This round: ${g.finds(p.id)} finds, survived ${clock(g.survived(p.id))}.`);
		return true;
	}

	scoreRows(): ScoreRow[] {
		const g = this.game;
		const rows: ScoreRow[] = [];
		for (const p of this.host.players()) {
			const role = p.spectating ? null : g.role(p.id);
			rows.push({
				id: p.id,
				name: p.name,
				rank: null,
				pbTicks: null,
				status: !role ? Status.Spectating : role === 'seeker' ? Status.Seeker : Status.Hider,
				stage: 0,
				ping: Math.round(p.ping),
				spectating: p.spectating,
				kills: role ? g.finds(p.id) : 0,
				score: role ? g.survived(p.id) : 0
			});
		}
		rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.kills ?? 0) - (a.kills ?? 0) || a.name.localeCompare(b.name));
		return rows;
	}

	tick(): void {
		const now = this.host.now();
		const active: number[] = [];
		for (const p of this.host.players()) if (!p.spectating) active.push(p.id);
		this.dispatch(this.game.update(now, active));
		if (now - this.lastSent >= HNS_STATE_MS) {
			this.lastSent = now;
			this.host.broadcast(this.stateMessage());
		}
	}

	stateMessage(): Extract<ServerMessage, { type: 'modeState' }> {
		return { type: 'modeState', mode: 'hns', ...this.game.view(this.host.now()) };
	}

	private player(id: number): ModePlayer | null {
		for (const p of this.host.players()) if (p.id === id) return p;
		return null;
	}

	private name(id: number): string {
		return this.player(id)?.name ?? `Player ${id}`;
	}

	private names(ids: number[]): string {
		return ids.map((id) => this.name(id)).join(' and ');
	}

	/** Send events to their audience and announce them in chat. */
	private dispatch(events: HnsEvent[]): void {
		const h = this.host;
		let changed = false;
		for (const ev of events) {
			switch (ev.e) {
				case 'spawn': {
					const p = this.player(ev.id);
					if (p) h.send(p, { type: 'hns', ev });
					continue;
				}
				case 'swing':
					for (const p of h.players()) if (p.id !== ev.by) h.send(p, { type: 'hns', ev });
					continue;
			}
			changed = true;
			h.broadcast({ type: 'hns', ev });
			switch (ev.e) {
				case 'waiting':
					if (ev.cancelled) h.system('Not enough players: round cancelled. Hide and seek needs 2+ players.');
					break;
				case 'starting':
					h.system(`Hide and seek starts in ${ev.secs} s.`);
					break;
				case 'roundStart': {
					const n = ev.seekers.length;
					h.system(`Round ${ev.round}: ${this.names(ev.seekers)} ${n > 1 ? 'are' : 'is'} seeking. Hiders, you have ${ev.hideSecs} s to hide!`);
					h.log(`hns round ${ev.round} seekers=${ev.seekers.join(',')}`);
					break;
				}
				case 'release':
					h.system(`Ready or not, here they come! Seekers released: ${clock(ev.seekSecs)} to find everyone.`);
					break;
				case 'found':
					h.system(`${this.name(ev.by)} found ${this.name(ev.target)}. ${ev.hidersLeft} hider${ev.hidersLeft === 1 ? '' : 's'} left.`);
					break;
				case 'newSeeker':
					h.system(`Every seeker left: ${this.name(ev.id)} is now seeking.`);
					break;
				case 'lastHider':
					h.system(`${this.name(ev.id)} is the last hider!`);
					break;
				case 'warn':
					h.system(`${ev.secs} seconds left!`);
					break;
				case 'end': {
					const top = ev.topSeeker ? ` Top seeker: ${this.name(ev.topSeeker.id)} (${ev.topSeeker.finds} found).` : '';
					h.system(
						ev.winner === 'hiders'
							? `Round ${ev.round}: hiders win! Survived: ${this.names(ev.survivors)}.${top}`
							: `Round ${ev.round}: seekers win, everyone was found.${top}`
					);
					h.log(`hns round ${ev.round} end winner=${ev.winner}`);
					break;
				}
			}
		}
		if (changed) {
			this.lastSent = h.now();
			h.broadcast(this.stateMessage());
		}
	}

	dispose(): void {}
}
