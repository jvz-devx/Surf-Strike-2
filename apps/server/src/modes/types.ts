/**
 * Server gamemode modules (docs/modes.md). The lobby owns connections, chat,
 * spectating, relay and the map rotation; everything a gamemode decides
 * (timer/zones/leaderboards for race, rounds/tagging for tag, scoreboard
 * rows) lives behind `ServerMode`. One instance per map; replaced on map change.
 */
import { clampRenderTime, RENDER_DELAY_GROW_RATE, RENDER_DELAY_SHRINK_RATE, RENDER_TIME_SLACK_MS, renderTimeBudgetMs } from '@surf/shared';
import type { ClientMessage, GameModeId, MapDef, MapRecordInfo, NetState, ScoreRow, ServerMessage, SnapshotEntry } from '@surf/shared';
import type { Stillness } from '../activity.ts';
import type { Command } from '../commands.ts';
import type { Db } from '../db.ts';
import type { ModeEconomy } from '../economy.ts';
import type { ZoneKind } from '../validation.ts';

export type { ZoneKind };

/** What a mode may read about a connected (helloed) player. */
export interface ModePlayer {
	readonly id: number;
	readonly playerId: string;
	/** Logged-in account; null for guests (their runs are never saved). */
	readonly accountId: number | null;
	readonly name: string;
	readonly spectating: boolean;
	/** Latest state packet on this map (null after join/map change/spectate until one arrives). */
	readonly state: NetState | null;
	/** Fresh RTT in milliseconds, capped for combat rewind. */
	readonly ping: number;
	/** Whether the transport RTT estimate has a sample in its active window. */
	readonly hasRttSample?: boolean;
}

/** Services the lobby gives a mode. */
export interface ModeHost {
	readonly map: MapDef;
	readonly db: Db;
	/** Points and coins (docs/economy.md#paying-from-a-mode). */
	readonly economy: ModeEconomy;
	now(): number;
	/** Monotonic clock used for both snapshot streams. */
	serverNow?(): number;
	/** Invalidate the active race mode when a queued replay save completes. */
	replaySaved?(mapId: string): void;
	rng(): number;
	/** Helloed players (spectators included). */
	players(): Iterable<ModePlayer>;
	send(p: ModePlayer, msg: ServerMessage): void;
	/** Broadcast a JSON message to every helloed player (optionally skipping `exceptId`, stringified once). */
	broadcast(msg: ServerMessage, exceptId?: number): void;
	/** Binary frame (BIN_GHOST) to one player; never dropped for backlog like snapshots. */
	sendBinary(p: ModePlayer, data: Uint8Array): void;
	/**
	 * Binary frame to every helloed player. `droppable`: skip clients with a
	 * large send backlog (per-tick snapshots like BIN_ZOMBIES); default reliable.
	 */
	broadcastBinary(data: Uint8Array, droppable?: boolean): void;
	system(text: string): void;
	systemTo(p: ModePlayer, text: string): void;
	/** Private notice for a guest's finished run; adds "Log in to save runs…" once per connection. */
	guestRunNotice(p: ModePlayer, text: string): void;
	log(msg: string): void;
}

export interface ServerMode {
	readonly id: GameModeId;
	/** Player is now on this map (after welcome or mapChange was sent). */
	join(p: ModePlayer): void;
	leave(p: ModePlayer): void;
	/** Spectate toggled (state was reset to null). */
	spectate(p: ModePlayer, spectating: boolean): void;
	/** A state packet arrived (already stored in `p.state`). */
	state(p: ModePlayer, s: NetState): void;
	/** Player poses in the lobby's outgoing snapshot, stamped on the server clock. */
	snapshot?(entries: readonly SnapshotEntry[], now: number): void;
	/** Race zone event (ignored by non-race modes). */
	zone(p: ModePlayer, kind: ZoneKind, index: number, tick: number): void;
	/** Race records for welcome/mapChange (empty for non-race modes). */
	records(p: ModePlayer): MapRecordInfo;
	/** `getGhost`: send the map's record ghost (race modes; others ignore it). */
	ghost?(p: ModePlayer, map: string): void;
	replayChanged?(): void;
	/** Mode-specific client messages (zombies: fire, reload, loadout; infected: also throwKnife, placeBeacon, callMoab); others ignore them. */
	message?(p: ModePlayer, msg: ModeClientMessage): void;
	/** Chat command for this mode (!top, !pb); return false if not handled. */
	command(p: ModePlayer, cmd: Command): boolean;
	scoreRows(): ScoreRow[];
	/**
	 * Why this player may stand still without being AFK (docs/economy.md):
	 * 'held' by the game (frozen, waiting to respawn), 'look' when looking
	 * around is enough (a hider). Absent or null: moving is needed.
	 */
	stillness?(p: ModePlayer): Stillness;
	/** Called at TAG_TICK_HZ (and from tests). */
	tick(): void;
	dispose(): void;
}

/** Client messages the lobby forwards to the mode as they are. */
export type ModeClientMessage = Extract<ClientMessage, { type: 'fire' | 'reload' | 'loadout' | 'throwKnife' | 'placeBeacon' | 'callMoab' | 'knife' }>;

/** State packets arrive at 64 Hz. Briefly keep using their estimate during an uplink stall. */
const RENDER_STATE_FRESH_MS = 100;
/** A packet after a pause cannot spend the whole pause steering the estimate. */
const RENDER_MAX_STEP_MS = 50;
/** Allow the clock estimate to move as well as the client's interpolation delay. */
const RENDER_CLOCK_RATE = 0.04;

class RenderTimeline {
	private offset: number | undefined;
	private updatedAt = -Infinity;
	private stateAt = -Infinity;

	private update(age: number, now: number): void {
		const dt = Math.min(RENDER_MAX_STEP_MS, Math.max(0, now - this.updatedAt));
		const offset = this.offset ?? age;
		const lo = offset - (RENDER_DELAY_SHRINK_RATE + RENDER_CLOCK_RATE) * dt;
		const hi = offset + (RENDER_DELAY_GROW_RATE + RENDER_CLOCK_RATE) * dt;
		this.offset = Math.max(lo, Math.min(hi, age));
		this.updatedAt = now;
	}

	observeState(age: number, now: number): void {
		this.update(age, now);
		this.stateAt = now;
	}

	rewind(age: number | null, now: number, max: number): number {
		const offset = this.offset ?? age ?? 0;
		if (age === null) return Math.min(max, offset);
		if (now - this.stateAt > RENDER_STATE_FRESH_MS) this.update(age, now);
		// Use the existing window for this attack, before it can move the estimate.
		return Math.min(max, Math.max(offset - RENDER_TIME_SLACK_MS, Math.min(offset + RENDER_TIME_SLACK_MS, age)));
	}
}

const renderTimelines = new WeakMap<ModePlayer, RenderTimeline>();

function renderTimeline(p: ModePlayer): RenderTimeline {
	let timeline = renderTimelines.get(p);
	if (!timeline) renderTimelines.set(p, (timeline = new RenderTimeline()));
	return timeline;
}

export function observeRenderTime(claim: number, now: number, p: ModePlayer): void {
	if (p.hasRttSample === false) return;
	const rtt = p.ping;
	const at = clampRenderTime(claim, now, rtt, renderTimeBudgetMs(rtt));
	if (at !== null) renderTimeline(p).observeState(now - at, now);
}

/** Timestamp and tick-based attacks share the connection's window and the hard RTT cap. */
export function renderRewindMs(claim: unknown, now: number, p: ModePlayer, historyMs: number, fallbackMs: number): number {
	const rtt = p.ping;
	const max = Math.min(historyMs, renderTimeBudgetMs(rtt));
	let age: number | null;
	if (claim === undefined || p.hasRttSample === false) age = Math.max(0, Math.min(max, fallbackMs));
	else {
		const at = typeof claim === 'number' ? clampRenderTime(claim, now, rtt, historyMs) : null;
		age = at === null ? null : now - at;
	}
	return renderTimeline(p).rewind(age, now, max);
}

export const EMPTY_RECORDS: MapRecordInfo = Object.freeze({
	pbTicks: null,
	pbSplits: null,
	rank: null,
	recordTicks: null,
	recordName: null
}) as MapRecordInfo;
