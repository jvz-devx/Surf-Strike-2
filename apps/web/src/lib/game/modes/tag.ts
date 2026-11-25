/**
 * Tag on the client (docs/modes.md#tag). The server runs the rounds; this keeps
 * the latest `modeState`, builds the HUD view and marks the remote ITs. Offline
 * it is free roam: the view's phase is 'solo'.
 */
import { randomSpawn, Status, type GameModeId, type NetState, type ScoreRow, type TagModeState } from '@surf/shared';
import type { RemotePlayers } from '../../render/players.js';
import type { TagView } from '../contract.js';
import type { ClientMode, ClientModeHost, ModeServerMessage, RemotePlayer } from './types.js';

const FLASH_MS = 2500;

export class TagMode implements ClientMode {
	readonly id: GameModeId = 'tag';
	/** Latest server state (null offline, or before the first one) and when it arrived. */
	private state: TagModeState | null = null;
	private stateAt = 0;
	private flash: TagView['flash'] = null;
	private viewKey = '';

	constructor(private readonly host: ClientModeHost) {
		this.refresh(performance.now());
	}

	restart(): void {
		if (this.state?.phase === 'playing') return this.host.notice('!r is disabled during a tag round.');
		this.respawn();
	}

	/** Also during a round (spectating ended). */
	respawn(): void {
		this.host.teleport(randomSpawn(this.host.map));
	}

	tick(): void {
		this.host.teleportZones(() => randomSpawn(this.host.map));
	}

	netState(s: NetState): void {
		s.status = this.state?.it.includes(this.host.selfId) ? Status.Tagger : Status.Runner;
		s.stage = 0;
		s.runTicks = 0;
	}

	frame(now: number): void {
		this.refresh(now);
	}

	dress(players: RemotePlayers, p: RemotePlayer): void {
		players.setIt(p.id, this.state?.it.includes(p.id) ?? false);
	}

	soloRow(): Partial<ScoreRow> {
		return { status: Status.Runner, score: 0, it: false };
	}

	message(m: ModeServerMessage, now: number): void {
		if (m.type === 'modeState' && m.mode === 'tag') this.onState(m, now);
		else if (m.type === 'tagged') this.onTagged(m.by, m.target, now);
	}

	offline(): void {
		this.state = null;
		this.flash = null;
		this.refresh(performance.now());
	}

	dispose(): void {
		this.host.hud.tag = null;
	}

	private onState(m: TagModeState, now: number): void {
		const prev = this.state;
		const self = this.host.selfId;
		const wasIt = prev?.it.includes(self) ?? false;
		const isIt = m.it.includes(self);
		this.state = m;
		this.stateAt = now;
		if (prev && m.phase === 'playing' && prev.phase !== 'playing') {
			this.flash = { text: isIt ? "You're IT!" : 'Run!', at: now };
			this.host.audio.zoneBeep();
		} else if (isIt && !wasIt && m.phase === 'playing' && !this.flash) {
			this.flash = { text: "You're IT!", at: now };
		}
		this.refresh(now);
	}

	private onTagged(by: number, target: number, now: number): void {
		const { host } = this;
		if (target === host.selfId) this.flash = { text: `${host.name(by)} tagged you. You're IT!`, at: now };
		else if (by === host.selfId) this.flash = { text: `You tagged ${host.name(target)}!`, at: now };
		else return;
		host.audio.zoneBeep();
		this.refresh(now);
	}

	/** Rebuild `hud.tag` when anything it shows changed (cheap key compare per frame). */
	private refresh(now: number): void {
		const { host } = this;
		const h = host.hud;
		if (this.flash && now - this.flash.at > FLASH_MS) this.flash = null;
		const t = this.state;
		const id = host.viewId;
		const key = `${t ? `${t.phase}|${t.round}|${t.it.join(',')}|${t.immune.join(',')}|${this.stateAt}` : 'solo'}|${id}|${this.flash?.at ?? 0}|${host.remotes.size}`;
		if (key === this.viewKey && h.tag) return;
		this.viewKey = key;
		h.tag = {
			phase: t ? t.phase : 'solo',
			round: t?.round ?? 0,
			endsAt: t && t.phase !== 'waiting' ? this.stateAt + t.timeLeft * 1000 : 0,
			isIt: t?.it.includes(id) ?? false,
			immune: t?.immune.includes(id) ?? false,
			itNames: (t?.it ?? []).map((i) => host.name(i)),
			score: t?.scores.find((s) => s.id === id)?.score ?? 0,
			flash: this.flash
		};
	}
}
