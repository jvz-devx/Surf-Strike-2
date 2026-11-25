/**
 * Race modes on the client (surf and bhop, docs/gameplay.md): the local run
 * (RunTracker), solo finishes, and the ghost of the fastest run
 * (docs/gameplay.md#ghosts).
 */
import {
	FINISH_RESET_DELAY,
	FLAG_DUCKED,
	FLAG_ON_GROUND,
	FLAG_TELEPORTED,
	formatTicks,
	GhostRecorder,
	inflateGhost,
	modeOf,
	RunTracker,
	Status,
	unpackGhost,
	type GameModeId,
	type GhostFrame,
	type NetState,
	type RunEvent,
	type RunState,
	type ScoreRow
} from '@surf/shared';
import { chooseGhost, ghostLabel, GhostPlayback, type GhostSource } from '../ghost.js';
import { splitDelta } from '../records.js';
import type { ClientMode, ClientModeHost } from './types.js';

function phaseStatus(phase: RunState['phase']): Status {
	switch (phase) {
		case 'start':
			return Status.StartZone;
		case 'running':
			return Status.Running;
		case 'finished':
			return Status.Finished;
		default:
			return Status.Idle;
	}
}

/** Run ticks shown to others: 0 outside a run. */
function shownTicks(s: RunState): number {
	return s.phase === 'running' || s.phase === 'finished' ? s.ticks : 0;
}

export class RaceMode implements ClientMode {
	readonly id: GameModeId;
	private readonly tracker: RunTracker;

	private readonly ghost = new GhostPlayback();
	private readonly ghostRec = new GhostRecorder();
	/** The server's record ghost for this map (online). */
	private recordGhost: GhostSource | null = null;
	/** This browser's best run on this map. */
	private localGhost: GhostSource | null = null;
	/** Set on the finish tick: the recorded run is closed after this tick's sample. */
	private ghostFinish: number | null = null;
	/** A teleport happened since the last tick. */
	private ghostTp = false;
	/** Bumped per ghost frame so late async results are dropped. */
	private ghostFrameSeq = 0;
	private disposed = false;

	constructor(private readonly host: ClientModeHost) {
		this.id = modeOf(host.map).id;
		this.tracker = new RunTracker(host.map);
		this.loadGhosts();
	}

	get run(): Readonly<RunState> {
		return this.tracker.state;
	}

	// Input

	restart(): void {
		this.toStart();
	}

	back(): void {
		this.tracker.back(this.host.player);
		this.host.setAngles(0, this.tracker.state.respawn.yaw);
		this.moved();
	}

	respawn(): void {
		this.toStart();
	}

	private toStart(): void {
		this.tracker.restart(this.host.player);
		this.host.setAngles(0, this.host.map.spawn.yaw);
		this.moved();
	}

	private moved(): void {
		this.ghostTp = true;
		this.host.moved();
	}

	// Simulation

	tick(now: number): void {
		for (const ev of this.tracker.update(this.host.player, this.host.tick)) this.onRunEvent(ev, now);
		this.recordGhostSample();
	}

	netState(s: NetState): void {
		const st = this.tracker.state;
		s.status = phaseStatus(st.phase);
		s.stage = Math.max(0, Math.min(255, st.stage));
		s.runTicks = shownTicks(st);
	}

	private onRunEvent(ev: RunEvent, now: number): void {
		const { host } = this;
		const { hud } = host;
		switch (ev.type) {
			case 'zone':
				// The server checks the last received state against the end zone:
				// send this tick's state first so it is not a stale one from before entry.
				if (ev.kind === 'end' && host.online) host.sendState();
				host.send({ type: 'zone', kind: ev.kind, index: ev.index, tick: ev.tick });
				if (ev.kind !== 'start') host.audio.zoneBeep();
				else this.ghostRec.start(ev.tick);
				break;
			case 'enterStart':
				this.ghostRec.cancel();
				host.audio.zoneBeep();
				hud.splitPopup = null;
				break;
			case 'split': {
				const splits = this.tracker.state.splits;
				let pos = splits.lastIndexOf(ev.ticks);
				if (pos < 0) pos = splits.length - 1;
				const label = `${hud.stageKind === 'stage' ? 'Stage' : 'Checkpoint'} ${ev.index}`;
				hud.splitPopup = { label, ticks: ev.ticks, delta: splitDelta(host.best().splits, pos, ev.ticks), at: now };
				break;
			}
			case 'finish': {
				const pb = host.best().ticks;
				hud.splitPopup = { label: 'Finish', ticks: ev.ticks, delta: pb !== null ? ev.ticks - pb : null, at: now };
				if (!host.online) this.soloFinish(ev.ticks, ev.splits);
				this.ghostFinish = ev.ticks;
				host.notice(`Returning to start in ${FINISH_RESET_DELAY} s…`);
				break;
			}
			case 'teleport':
				// toStart() and back() set the view themselves; tracker-driven teleports do it here.
				if (ev.dest) host.setAngles(0, ev.dest.yaw);
				else if (ev.reason === 'trigger' || ev.reason === 'finish') host.setAngles(0, this.tracker.state.respawn.yaw);
				this.ghostTp = true;
				host.movedInTick();
				break;
		}
	}

	private soloFinish(ticks: number, splits: number[]): void {
		const { host } = this;
		const time = formatTicks(ticks);
		if (host.hud.unofficial) {
			host.notice(`Finished in ${time} (unofficial: physics cvars changed, not saved).`);
			return;
		}
		const old = host.best().ticks;
		if (host.saveSoloBest(ticks, splits)) {
			host.audio.recordChime();
			const d = old !== null ? ` (−${formatTicks(old - ticks)})` : '';
			host.notice(`New solo personal best: ${time}${d}. Solo runs are not sent to the leaderboard.`);
		} else {
			host.notice(`Finished in ${time} (PB ${formatTicks(old ?? ticks)}).`);
		}
	}

	// Frame

	/** Poses the ghost; the shared HUD reads `run`. */
	frame(): void {
		const { host } = this;
		const r = host.renderer;
		if (!r) return;
		const st = this.tracker.state;
		const on = host.cvar('cl_ghost') !== 0 && !host.spec;
		this.poseGhost(on && this.ghost.update(st.phase, st.ticks, host.alpha));
	}

	private poseGhost(visible: boolean): void {
		const g = this.ghost.pose;
		const onGround = (g.flags & FLAG_ON_GROUND) !== 0;
		const ramp = visible && !onGround ? this.host.rampUnder(g) : null;
		this.host.renderer?.ghost.setPose(g.x, g.y, g.z, g.pitch, g.yaw, (g.flags & FLAG_DUCKED) !== 0, onGround, ramp, visible);
	}

	soloRow(): Partial<ScoreRow> {
		const st = this.tracker.state;
		return { pbTicks: this.host.best().ticks, status: phaseStatus(st.phase), stage: st.stage };
	}

	// Ghosts

	/** Load the local PB ghost, ask the server for the record. */
	private loadGhosts(): void {
		const map = this.host.map.id;
		void this.host.ghostStore.get(map).then((g) => {
			if (!g || this.disposed) return;
			this.localGhost = { kind: 'pb', map, name: 'Your PB', ticks: g.ticks, track: g.track };
			this.refreshGhost();
		});
		this.host.send({ type: 'getGhost', map });
	}

	private refreshGhost(): void {
		const { host } = this;
		const g = chooseGhost(host.online, this.recordGhost, this.localGhost, host.map.id);
		this.ghost.set(g);
		if (g) host.renderer?.ghost.setLabel(ghostLabel(g));
		this.dressGhost();
	}

	/** The ghost looks like the player whose run it shows: this one, one who is here, or as the server describes them. */
	private dressGhost(): void {
		const { host } = this;
		const g = this.ghost.source;
		if (!g || !host.renderer) return;
		const { players, ghost } = host.renderer;
		if (g.kind === 'pb' || (host.hud.account !== null && g.name === host.hud.account.username)) {
			return ghost.setPlayer(host.selfId, host.hud.shop?.loadout ?? null);
		}
		for (const r of host.remotes.values()) if (r.name === g.name) return ghost.setPlayer(r.id, players.loadoutOf(r.id));
		// Not here: a person of their own, always the same.
		let hash = 0;
		for (const ch of g.name) hash = (Math.imul(hash, 31) + ch.codePointAt(0)!) | 0;
		ghost.setPlayer(hash >>> 1, host.ghostLook?.map === g.map ? host.ghostLook.loadout : null);
	}

	/** After the tracker update: record this tick of the local run (same data the server records). */
	private recordGhostSample(): void {
		const { host } = this;
		const rec = this.ghostRec;
		if (rec.recording && (this.tracker.state.phase === 'running' || this.ghostFinish !== null)) {
			const p = host.player;
			const flags = (p.ducked ? FLAG_DUCKED : 0) | (p.onGround ? FLAG_ON_GROUND : 0) | (this.ghostTp ? FLAG_TELEPORTED : 0);
			rec.push(host.tick, p.origin.x, p.origin.y, p.origin.z, host.pitch, host.yaw, flags);
		}
		this.ghostTp = false;
		if (this.ghostFinish === null) return;
		const ticks = this.ghostFinish;
		this.ghostFinish = null;
		const track = rec.finish(host.tick);
		// Unofficial runs (physics cvars changed) never become the PB ghost.
		if (!track || host.hud.unofficial) return;
		const map = host.map.id;
		void host.ghostStore.saveIfFaster({ map, ticks, track }).then((saved) => {
			if (!saved || this.disposed) return;
			this.localGhost = { kind: 'pb', map, name: 'Your PB', ticks, track };
			this.refreshGhost();
		});
	}

	// Network

	ghostFrame(f: GhostFrame): void {
		const { host } = this;
		if (!host.online || f.map !== host.map.id) return;
		const seq = ++this.ghostFrameSeq;
		if (!f.has) {
			this.recordGhost = null;
			this.refreshGhost();
			return;
		}
		void inflateGhost(f.payload).then((raw) => {
			// A newer frame, another map or a lost connection overtook the decoding.
			if (this.disposed || seq !== this.ghostFrameSeq || !host.online) return;
			const track = raw ? unpackGhost(raw) : null;
			if (!track) return host.ghostUnavailable();
			this.recordGhost = { kind: 'record', map: f.map, name: f.name, ticks: f.ticks, track };
			this.refreshGhost();
			host.print(`Record ghost: ${f.name} ${formatTicks(f.ticks)}`);
		});
	}

	peopleChanged(): void {
		this.dressGhost();
	}

	/** The run goes on; the record ghost belongs to the server. */
	offline(): void {
		this.recordGhost = null;
		this.refreshGhost();
	}

	/** The ghost's avatar outlives the map: hide it. */
	dispose(): void {
		this.disposed = true;
		this.ghostRec.cancel();
		this.ghostFinish = null;
		this.recordGhost = null;
		this.localGhost = null;
		this.ghost.set(null);
		this.poseGhost(false);
	}
}
