/**
 * Server gamemode modules (docs/modes.md). The lobby owns connections, chat,
 * spectating, relay and the map rotation; everything a gamemode decides
 * (timer/zones/leaderboards for race, rounds/tagging for tag, scoreboard
 * rows) lives behind `ServerMode`. One instance per map; replaced on map change.
 */
import { clampRenderTime } from '@surf/shared';
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

/** An absent claim or an unmeasured RTT uses the mode's fallback. An invalid claim uses the current pose. */
export function renderRewindMs(claim: unknown, now: number, p: ModePlayer, historyMs: number): number | undefined {
	if (claim === undefined) return undefined;
	if (typeof claim !== 'number' || !Number.isFinite(claim)) return 0;
	const at = clampRenderTime(claim, now, p.ping, historyMs);
	if (at === null) return 0;
	return p.hasRttSample === false ? undefined : now - at;
}

export const EMPTY_RECORDS: MapRecordInfo = Object.freeze({
	pbTicks: null,
	pbSplits: null,
	rank: null,
	recordTicks: null,
	recordName: null
}) as MapRecordInfo;
