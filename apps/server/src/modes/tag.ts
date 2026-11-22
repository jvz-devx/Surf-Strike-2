/**
 * Tag gamemode (docs/modes.md#tag). Server-authoritative: the shared
 * `TagGame` rules run here on the latest state packets of every
 * non-spectating player; clients only display the result.
 */
import type { MapRecordInfo, ScoreRow, ServerMessage, TagEvent, TagPos } from '@surf/shared';
import { FLAG_DUCKED, Status, TAG_PODIUM, TagGame, type TagGameOptions } from '@surf/shared';
import type { Command } from '../commands.ts';
import type { ModeHost, ModePlayer, ServerMode } from './types.ts';
import { EMPTY_RECORDS } from './types.ts';

/** Mode state is re-sent at least this often (ms). */
export const MODE_STATE_MS = 1000;

export type TagModeOptions = Pick<TagGameOptions, 'roundSecs' | 'intermissionSecs' | 'immunitySecs'>;

const fmtScore = (s: number) => `${s.toFixed(1)} s`;

export class TagMode implements ServerMode {
	readonly id = 'tag' as const;
	readonly game: TagGame;
	private lastSent = -Infinity;

	constructor(
		private readonly host: ModeHost,
		opts: TagModeOptions = {}
	) {
		this.game = new TagGame({ ...opts, now: host.now(), rng: () => host.rng() });
	}

	join(p: ModePlayer): void {
		this.tick(); // add the player to the rules (may start a countdown)
		this.host.send(p, this.stateMessage());
		this.host.systemTo(p, 'Tag: whoever is IT tags someone by touching them. Score = seconds you are not IT.');
	}

	leave(): void {
		this.tick();
	}

	spectate(): void {
		this.tick();
	}

	state(): void {}

	zone(): void {}

	records(): MapRecordInfo {
		return { ...EMPTY_RECORDS };
	}

	command(p: ModePlayer, cmd: Command): boolean {
		if (cmd.cmd !== 'top' && cmd.cmd !== 'pb') return false;
		const mine = this.game.scores().find((s) => s.id === p.id);
		this.host.systemTo(p, `No leaderboard in tag. Your score this round: ${fmtScore(mine?.score ?? 0)}.`);
		return true;
	}

	scoreRows(): ScoreRow[] {
		const rows: ScoreRow[] = [];
		for (const p of this.host.players()) {
			const it = !p.spectating && this.game.isIt(p.id);
			rows.push({
				id: p.id,
				name: p.name,
				rank: null,
				pbTicks: null,
				status: p.spectating ? Status.Spectating : it ? Status.Tagger : Status.Runner,
				stage: 0,
				ping: Math.round(p.ping),
				spectating: p.spectating,
				score: p.spectating ? 0 : this.game.score(p.id),
				it
			});
		}
		rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name));
		return rows;
	}

	tick(): void {
		const now = this.host.now();
		const active = new Map<number, TagPos | null>();
		for (const p of this.host.players()) {
			if (p.spectating) continue;
			const s = p.state;
			active.set(p.id, s ? { x: s.x, y: s.y, z: s.z, ducked: (s.flags & FLAG_DUCKED) !== 0 } : null);
		}
		const events = this.game.update(now, active);
		for (const e of events) this.announce(e);
		if (events.length > 0 || now - this.lastSent >= MODE_STATE_MS) {
			this.lastSent = now;
			this.host.broadcast(this.stateMessage());
		}
	}

	stateMessage(): Extract<ServerMessage, { type: 'modeState' }> {
		const g = this.game;
		const now = this.host.now();
		return {
			type: 'modeState',
			mode: 'tag',
			phase: g.phase,
			round: g.round,
			timeLeft: Math.round(g.timeLeft(now) * 10) / 10,
			it: g.it,
			immune: g.immune(now),
			scores: g.scores()
		};
	}

	private name(id: number): string {
		for (const p of this.host.players()) if (p.id === id) return p.name;
		return `Player ${id}`;
	}

	private announce(e: TagEvent): void {
		const h = this.host;
		switch (e.type) {
			case 'waiting':
				if (e.cancelled) h.system('Not enough players: round cancelled. Tag needs 2+ players.');
				break;
			case 'countdown':
				h.system(`Next tag round starts in ${Math.round((e.endsAt - h.now()) / 1000)} s.`);
				break;
			case 'roundStart': {
				const names = e.it.map((id) => this.name(id)).join(' and ');
				h.system(`Round ${e.round}: ${names} ${e.it.length > 1 ? 'are' : 'is'} IT! Run!`);
				h.log(`tag round ${e.round} it=${e.it.join(',')}`);
				break;
			}
			case 'tag':
				h.broadcast({ type: 'tagged', by: e.by, target: e.target });
				h.system(`${this.name(e.by)} tagged ${this.name(e.target)}. ${this.name(e.target)} is IT!`);
				break;
			case 'newIt':
				h.system(`${this.name(e.id)} is now IT.`);
				break;
			case 'roundEnd': {
				const top = e.ranking.slice(0, TAG_PODIUM).map((s, i) => `${i + 1}. ${this.name(s.id)} ${fmtScore(s.score)}`);
				h.system(`Round ${e.round} over! ${top.join('  ')}`);
				h.log(`tag round ${e.round} end`);
				break;
			}
		}
	}

	dispose(): void {}
}
