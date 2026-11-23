/**
 * Hide and seek client (docs/modes.md#hide-and-seek). The server runs the
 * rules; this keeps the latest `modeState`, applies `hns` events (teleports,
 * freezes, finds), sends knife swings and builds the HUD view. Offline (or
 * alone) the map is free roam as a hider.
 */
import type { ClientMessage, HnsEvent, HnsModeState, HnsRole, MapDef, Spawn, Vec3 } from '@surf/shared';
import { hnsSpawns } from '@surf/shared';
import type { CashBagRenderer } from '../render/cashbag.js';
import type { ZombieRenderer } from '../render/zombies.js';
import type { HnsView, KillFeedLine } from './contract.js';
import { bagTakenText, hnsBagNote, hnsBlindfold, hnsCanSwing, hnsFrozen } from './hns-view.js';
import { forwardDir, liveKillFeed, pushKillFeed } from './zombies-view.js';

export type HnsSound = 'swing' | 'hit' | 'release' | 'bag';

export interface HnsHost {
	online(): boolean;
	selfId(): number;
	send(msg: ClientMessage): void;
	name(id: number): string;
	/** Move the local player (spawn, found, freeze pull), velocity zeroed. */
	teleport(pos: Vec3, yaw: number): void;
	/** Play a sound; `from` = the player making it (another player: level falls off with distance). */
	sound(name: HnsSound, from?: number): void;
	viewmodel(): ZombieRenderer | null;
	/** Player whose role the HUD shows (spectated target, else self). */
	viewId(): number;
	cashBag(): CashBagRenderer | null;
	/** Where the camera is and looks (yaw in degrees). */
	eye(): { x: number; y: number; yaw: number };
}

const FLASH_MS = 3200;

export class HnsClient {
	private state: HnsModeState | null = null;
	private stateAt = 0;
	private frozenUntil = 0;
	private lastSwing = -Infinity;
	private flash: HnsView['flash'] = null;
	private killFeed: KillFeedLine[] = [];
	private feedId = 0;
	private summary: HnsView['summary'] = null;
	private view: HnsView | null = null;
	private viewKey = '';
	private readonly spawns: { hiders: Spawn[]; seekers: Spawn[] };

	constructor(
		private readonly host: HnsHost,
		map: MapDef
	) {
		this.spawns = hnsSpawns(map);
	}

	/** Role of a player in the current round (null: unknown / spectating). */
	roleOf(id: number): HnsRole | null {
		return this.state?.players.find((p) => p.id === id)?.role ?? null;
	}

	get role(): HnsRole {
		return this.roleOf(this.host.selfId()) ?? 'hider';
	}

	private get phase(): HnsModeState['phase'] | 'solo' {
		return this.state && this.host.online() ? this.state.phase : 'solo';
	}

	/** The local player may not move. */
	frozen(now: number): boolean {
		return hnsFrozen(this.role, this.phase, this.frozenUntil, now);
	}

	blindfolded(): boolean {
		return hnsBlindfold(this.role, this.phase);
	}

	/** Respawn point for fall-outs and !r (by role). */
	fallSpawn(rng: () => number = Math.random): Spawn {
		const list = this.role === 'seeker' ? this.spawns.seekers : this.spawns.hiders;
		return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;
	}

	/** !r is only for free roam; it would break hiding/freeze rules in a round. */
	canRespawn(): boolean {
		const p = this.phase;
		return p === 'solo' || p === 'waiting' || p === 'starting' || p === 'ended';
	}

	onModeState(m: HnsModeState, now: number): void {
		const prev = this.state;
		this.state = m;
		this.stateAt = now;
		const me = m.players.find((p) => p.id === this.host.selfId());
		if (me && me.frozen > 0) this.frozenUntil = Math.max(this.frozenUntil, now + me.frozen * 1000);
		if (m.phase !== 'ended') this.summary = null;
		if (prev && prev.phase !== m.phase) {
			if (m.phase === 'hiding') {
				this.frozenUntil = 0;
				this.lastSwing = -Infinity;
				this.setFlash(this.role === 'seeker' ? 'You are a SEEKER — wait for the release' : 'You are a HIDER — hide!', this.role === 'seeker' ? 'seeker' : 'hider', now);
			} else if (m.phase === 'seeking' && prev.phase === 'hiding') {
				this.setFlash(this.role === 'seeker' ? 'GO! Find the hiders' : 'Seekers released!', this.role === 'seeker' ? 'seeker' : 'info', now);
			}
		}
		this.viewKey = '';
	}

	onEvent(ev: HnsEvent, now: number): void {
		const self = this.host.selfId();
		switch (ev.e) {
			case 'spawn':
				if (ev.id !== self) return;
				this.host.teleport(ev.pos, ev.yaw);
				this.frozenUntil = ev.freezeSecs > 0 ? now + ev.freezeSecs * 1000 : 0;
				break;
			case 'swing':
				if (ev.by !== self) this.host.sound('swing', ev.by);
				return;
			case 'release':
				this.host.sound('release');
				break;
			case 'found': {
				const by = this.host.name(ev.by);
				const target = this.host.name(ev.target);
				this.killFeed = pushKillFeed(this.killFeed, { id: ++this.feedId, text: `${by} found ${target}`, head: false, mine: ev.by === self, at: now }, now);
				if (ev.target === self) {
					this.host.sound('hit');
					this.setFlash(`You were found by ${by} — you are now a seeker`, 'seeker', now);
				} else if (ev.by === self) {
					this.host.sound('hit');
					this.setFlash(`You found ${target}!`, 'seeker', now);
				}
				break;
			}
			case 'bag':
				this.host.sound('bag');
				this.setFlash(`A bag of cash appeared ${ev.place}!`, 'cash', now);
				if (this.state) this.state = { ...this.state, bag: { phase: 'out', pos: ev.pos, place: ev.place } };
				break;
			case 'bagTaken': {
				const bag = this.state?.bag;
				if (bag?.phase === 'out') this.host.cashBag()?.burst(bag.pos, now);
				if (this.state) this.state = { ...this.state, bag: { phase: 'taken', by: ev.by, coins: ev.coins } };
				this.setFlash(bagTakenText(this.host.name(ev.by), ev.by === self, ev.paid), 'cash', now);
				break;
			}
			case 'lastHider':
				this.setFlash(ev.id === self ? 'You are the last hider!' : `${this.host.name(ev.id)} is the last hider`, 'info', now);
				break;
			case 'newSeeker':
				if (ev.id === self) this.setFlash('Every seeker left — you are now seeking', 'seeker', now);
				break;
			case 'warn':
				this.setFlash(`${ev.secs} seconds left`, 'info', now);
				break;
			case 'end':
				this.summary = {
					winner: ev.winner,
					survivors: ev.survivors.map((id) => this.host.name(id)),
					top: ev.topSeeker ? `${this.host.name(ev.topSeeker.id)} (${ev.topSeeker.finds})` : null
				};
				break;
			default:
				break;
		}
		this.viewKey = '';
	}

	/** Mouse1: knife swing (seekers while seeking). */
	press(down: boolean, now: number, eye: Vec3, pitch: number, yaw: number): void {
		if (!down || !this.host.online()) return;
		if (!hnsCanSwing(this.role, this.phase, this.frozen(now), this.lastSwing, now)) return;
		this.lastSwing = now;
		this.host.viewmodel()?.fired(now);
		this.host.sound('swing');
		this.host.send({ type: 'knife', origin: { x: eye.x, y: eye.y, z: eye.z }, dir: forwardDir(pitch, yaw) });
	}

	private setFlash(text: string, tone: NonNullable<HnsView['flash']>['tone'], now: number): void {
		this.flash = { text, at: now, tone };
	}

	/** Viewmodel and HUD view for this frame (same object while nothing changed). */
	frame(now: number, viewmodel: boolean, speed: number): HnsView {
		const vm = this.host.viewmodel();
		if (vm) {
			const knife = viewmodel && this.role === 'seeker' && this.phase !== 'solo';
			vm.setWeapon(knife ? 'knife' : null);
			vm.updateViewmodel(now, knife && !this.blindfolded(), 1, speed);
		}
		if (this.flash && now - this.flash.at > FLASH_MS) {
			this.flash = null;
			this.viewKey = '';
		}
		const feed = liveKillFeed(this.killFeed, now);
		if (feed.length !== this.killFeed.length) {
			this.killFeed = feed;
			this.viewKey = '';
		}
		const bag = this.phase === 'seeking' ? this.state?.bag : null;
		this.host.cashBag()?.place(bag?.phase === 'out' ? bag.pos : null);
		const id = this.host.viewId();
		const note = hnsBagNote(bag, this.stateAt, this.host.eye(), this.roleOf(id) ?? 'seeker', this.host.selfId(), (i) => this.host.name(i));
		const noteKey = note?.phase === 'out' ? `${note.meters},${note.turn},${note.canTake}` : (note?.phase ?? '');
		const key = `${noteKey}|${this.stateAt}|${id}|${this.frozenUntil}|${this.flash?.at ?? 0}|${this.feedId}|${this.killFeed.length}|${this.host.online()}`;
		if (this.view && key === this.viewKey) return this.view;
		this.viewKey = key;
		const s = this.state;
		const phase = this.phase;
		const role = this.roleOf(id) ?? 'hider';
		this.view = {
			phase,
			round: s?.round ?? 0,
			endsAt: s && phase !== 'solo' && phase !== 'waiting' ? this.stateAt + s.timeLeft * 1000 : 0,
			role,
			hidersLeft: s?.hiders.length ?? 0,
			seekerNames: (s?.seekers ?? []).map((i) => this.host.name(i)),
			blindfold: hnsBlindfold(role, phase),
			frozenUntil: id === this.host.selfId() ? this.frozenUntil : 0,
			finds: s?.players.find((p) => p.id === id)?.finds ?? 0,
			flash: this.flash,
			killFeed: this.killFeed,
			summary: phase === 'ended' ? this.summary : null,
			bag: note
		};
		return this.view;
	}

	dispose(): void {
		this.host.cashBag()?.clear();
		this.host.viewmodel()?.setWeapon(null);
		this.host.viewmodel()?.updateViewmodel(0, false, 1, 0);
	}
}
