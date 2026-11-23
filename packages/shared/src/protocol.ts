/**
 * Wire protocol (docs/architecture.md#protocol-sketch).
 * JSON text frames for reliable events, binary frames for state/snapshots.
 */
import type { Cvars } from './cvars.ts';
import type { GameModeId } from './modes/index.ts';
import type { HnsEvent, HnsStateView } from './modes/hns.ts';
import type { InfEvent, InfStateView } from './modes/infected/game.ts';
import type { TagPhase, TagScore } from './modes/tag.ts';
import type { ZmEvent, ZmStateView } from './modes/zombies/game.ts';
import type { WeaponId } from './modes/zombies/weapons.ts';
import type { Vec3 } from './types.ts';
import { TICK_RATE } from './units.ts';

export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS = 32;
export const MAX_NAME = 24;
export const MAX_CHAT = 128;

/** Player status shown on the scoreboard. */
export const Status = {
	StartZone: 0,
	Running: 1,
	Finished: 2,
	Spectating: 3,
	Idle: 4,
	/** Tag: this player is IT. */
	Tagger: 5,
	/** Tag: running from IT. */
	Runner: 6,
	/** Zombies: alive in the round. */
	Alive: 7,
	/** Zombies: down, waiting for the next checkpoint. */
	Down: 8,
	/** Hide and seek: hiding this round. */
	Hider: 9,
	/** Hide and seek: seeking (picked at round start or found). */
	Seeker: 10,
	/** Infected: Patient Zero (first infected, keeps gun until first infection). */
	Alpha: 11,
	/** Infected: turned player hunting with claws and throwing knife. */
	Infected: 12
} as const;
export type Status = (typeof Status)[keyof typeof Status];

/** State flag bits. */
export const FLAG_DUCKED = 1;
export const FLAG_ON_GROUND = 2;
/** Set on the first state packet after a teleport (restart, !back, trigger). */
export const FLAG_TELEPORTED = 4;

export type VoteOption = { kind: 'map'; mapId: string } | { kind: 'extend' };

export interface PlayerInfo {
	id: number;
	name: string;
	spectating: boolean;
}

export interface ScoreRow {
	id: number;
	name: string;
	rank: number | null; // map rank, null = no PB
	pbTicks: number | null;
	status: Status;
	stage: number; // current stage/checkpoint for status text
	ping: number;
	spectating: boolean;
	/** Tag: seconds not being IT this round (absent in race modes). */
	score?: number;
	/** Tag: this player is IT. */
	it?: boolean;
	/** Server-side admin (docs/gameplay.md#admin); set only by the server, never by the client. */
	admin?: boolean;
	/** Zombies: kills and downs this round. */
	kills?: number;
	deaths?: number;
}

/**
 * Mode-specific state for non-race gamemodes (docs/modes.md). Sent on every
 * change and once per second; race modes never send it.
 */
export interface TagModeState {
	mode: 'tag';
	phase: TagPhase;
	round: number;
	/** Seconds until the round ends (playing) or starts (countdown); 0 while waiting. */
	timeLeft: number;
	it: number[];
	/** Players with tag-back immunity. */
	immune: number[];
	scores: TagScore[];
}

/** Zombies round state (docs/modes.md#zombies). */
export interface ZombiesModeState extends ZmStateView {
	mode: 'zombies';
}

/** Infected round state (docs/modes.md#infected). */
export interface InfectedModeState extends InfStateView {
	mode: 'infected';
}

/** Hide and seek round state (docs/modes.md#hide-and-seek). */
export interface HnsModeState extends HnsStateView {
	mode: 'hns';
}

export type ModeState = TagModeState | ZombiesModeState | InfectedModeState | HnsModeState;

export interface MapRecordInfo {
	pbTicks: number | null;
	pbSplits: number[] | null;
	rank: number | null;
	recordTicks: number | null;
	recordName: string | null;
}

export type ClientMessage =
	| {
			type: 'hello';
			playerId: string;
			/** Guest name; ignored when `token` logs the player in (the username is used). */
			name: string;
			version: number;
			/** Session token from an earlier `auth` reply: auto-login. */
			token?: string;
	  }
	/** Accounts (docs/gameplay.md#accounts-and-identity): work on the open socket, answered with `auth`. */
	| { type: 'register'; username: string; password: string }
	| { type: 'login'; username: string; password: string }
	| { type: 'logout' }
	| { type: 'zone'; kind: 'start' | 'stage' | 'checkpoint' | 'end'; index: number; tick: number }
	| { type: 'chat'; text: string }
	| { type: 'vote'; option: number } // 1-based option index
	/** Same as `rtvRequest` without a nomination (`!rtv`). */
	| { type: 'rtv' }
	/** Start an RTV request (docs/gameplay.md#map-rotation-and-voting), optionally nominating a map; on an open request: a yes vote. */
	| { type: 'rtvRequest'; mapId?: string }
	/** Answer the open RTV request (keys 1 = yes, 2 = no). */
	| { type: 'rtvVote'; yes: boolean }
	| { type: 'changeMap'; mapId: string } // lone player only (docs/gameplay.md)
	| { type: 'spectate'; targetId: number | null } // null = leave spectate
	| { type: 'name'; name: string }
	| { type: 'pong'; t: number }
	/** Race maps: ask for the map's record ghost; answered with a BIN_GHOST frame (docs/gameplay.md#ghosts). */
	| { type: 'getGhost'; map: string }
	/**
	 * Zombies (docs/modes.md#zombies): a shot or knife swing. `origin` is the eye,
	 * `dir` a unit vector, `tick` the zombie sim tick the shooter was looking at
	 * (from BIN_ZOMBIES, interpolated) for lag compensation.
	 */
	| { type: 'fire'; weapon: WeaponId; origin: Vec3; dir: Vec3; tick: number }
	| { type: 'reload' }
	/** Zombies: pick the weapon for this life (only while the loadout window is open). */
	| { type: 'loadout'; weapon: WeaponId }
	/** Infected: throw an MW3-style throwing knife from eye `origin` along unit `dir`. */
	| { type: 'throwKnife'; origin: Vec3; dir: Vec3 }
	/** Infected: place an MW3-style respawn beacon (Tactical Insertion) at the feet. */
	| { type: 'placeBeacon' }
	/** Infected: a survivor calls their earned M.O.A.B. (kill streak; detonates after a countdown). */
	| { type: 'callMoab' }
	/**
	 * Hide and seek (docs/modes.md#hide-and-seek): a seeker's knife swing.
	 * `origin` is the eye, `dir` a unit vector; the server resolves the hit
	 * (lag-compensated against the hiders' recent positions).
	 */
	| { type: 'knife'; origin: Vec3; dir: Vec3 }
	/** Admin menu (docs/gameplay.md#admin): re-checked on the server, ignored for non-admins. */
	| { type: 'admin'; action: AdminAction };

/** Admin requests; every one is answered with `adminResult` and (for admins) `adminState`. */
export type AdminAction =
	| { action: 'setMapEnabled'; mapId: string; enabled: boolean }
	/** Ban a connected player (`targetId` = lobby id) or an account by username (offline ban). */
	| { action: 'ban'; targetId?: number; username?: string; reason?: string }
	| { action: 'unban'; banId: number }
	/** Change to any map at once (disabled ones too). */
	| { action: 'forceMap'; mapId: string }
	/** Add ADMIN_EXTEND seconds to the current map. */
	| { action: 'extend' }
	/** Just ask for a fresh `adminState`. */
	| { action: 'listBans' };

/** Seconds the admin "extend" button adds. */
export const ADMIN_EXTEND = 10 * 60;
/** Max length of a ban reason. */
export const MAX_BAN_REASON = 128;

export interface AdminMapInfo {
	id: string;
	title: string;
	kind: GameModeId;
	enabled: boolean;
}

export interface AdminBanInfo {
	id: number;
	/** Account username or guest name at ban time. */
	username: string;
	/** 'account' = account ban; 'guest' = player key (and IP when known). */
	kind: 'account' | 'guest';
	reason: string | null;
	createdAt: number;
	createdBy: string;
}

export interface AdminPlayerInfo {
	id: number;
	name: string;
	/** Account username when logged in. */
	account?: string;
	guest: boolean;
	/** Admins cannot be banned. */
	admin: boolean;
}

export interface AdminState {
	maps: AdminMapInfo[];
	bans: AdminBanInfo[];
	players: AdminPlayerInfo[];
}

export type ServerMessage =
	| {
			type: 'welcome';
			selfId: number;
			map: string;
			/** Gamemode of `map` (optional for old servers: derive from the map). */
			mode?: GameModeId;
			mapTimeLeft: number; // seconds
			players: PlayerInfo[];
			cvars: Partial<Cvars>;
			records: MapRecordInfo;
			/** Logged-in account (hello token accepted), null for guests. Absent on old servers. */
			account?: AccountInfo | null;
	  }
	| { type: 'full' }
	| { type: 'join'; player: PlayerInfo }
	| { type: 'leave'; id: number }
	| { type: 'rename'; id: number; name: string }
	| { type: 'spectating'; id: number; spectating: boolean; targetId: number | null }
	| {
			type: 'chat';
			from: string | null;
			fromId: number | null;
			text: string;
			system?: boolean;
			/** Sender is a server admin (set by the server; drives the chat marker). */
			admin?: boolean;
	  }
	| {
			type: 'runResult';
			ticks: number;
			rank: number;
			pb: boolean; // new PB
			record: boolean; // new map record
			splits: number[];
			records: MapRecordInfo;
	  }
	| { type: 'runRejected'; reason: string }
	/**
	 * The map's leaderboard changed (someone else set a PB or the record):
	 * this player's records on `map` (own PB/rank, map record) right now.
	 */
	| { type: 'records'; map: string; records: MapRecordInfo }
	| { type: 'voteStart'; options: VoteOption[]; duration: number; rtv: boolean }
	| { type: 'voteUpdate'; counts: number[] }
	| { type: 'voteEnd'; winner: VoteOption; countdown: number }
	/**
	 * RTV request opened (`started`) or its counts changed; also sent on join
	 * while one is open. `duration`: seconds left. Passes at `yes >= needed`.
	 */
	| {
			type: 'rtvRequest';
			started: boolean;
			initiatorId: number;
			initiator: string;
			mapId: string | null;
			duration: number;
			yes: number;
			no: number;
			needed: number;
	  }
	/** RTV request closed; when passed a `voteStart` follows. `cooldown`: seconds until the next request (declines). */
	| { type: 'rtvRequestEnd'; passed: boolean; reason: 'passed' | 'timeout' | 'rejected' | 'cancelled'; cooldown: number }
	/** No RTV request for `seconds` (map-start block or decline cooldown); sent on join and map change while it applies. */
	| { type: 'rtvCooldown'; seconds: number; reason: 'declined' | 'mapStart' }
	| {
			type: 'mapChange';
			map: string;
			mode?: GameModeId;
			mapTimeLeft: number;
			cvars: Partial<Cvars>;
			records: MapRecordInfo;
	  }
	| ({ type: 'modeState' } & ModeState)
	| { type: 'tagged'; by: number; target: number }
	/** Zombies event (spawn/teleport, hit marker, kill feed, tracer, hurt, down, checkpoint, ammo, round end). */
	| { type: 'zm'; ev: ZmEvent }
	/** Infected event (spawn, alpha, infect, hit, kill, shot, hurt, ammo, throwing knife, UAV pulse, round end). */
	| { type: 'inf'; ev: InfEvent }
	/** Hide and seek event (spawn/teleport to that player; swing, found, round flow to everyone). */
	| { type: 'hns'; ev: HnsEvent }
	| { type: 'timeLeft'; mapTimeLeft: number }
	| { type: 'scoreboard'; rows: ScoreRow[] }
	| { type: 'ping'; t: number }
	/**
	 * Reply to register/login/logout, or to a rejected hello token.
	 * ok with a username: logged in (`token` is new on register/login);
	 * ok with username null: logged out. `records` are the player's race
	 * records on the current map after the change.
	 */
	| { type: 'auth'; ok: true; username: string | null; token?: string; records?: MapRecordInfo; admin?: boolean }
	| { type: 'auth'; ok: false; error: string }
	/** Maps players may pick (votes, Change map): sent after `welcome` and to everyone on every change. */
	| { type: 'maps'; enabled: string[] }
	/** Admins only: reply to an `admin` request, and pushed when players or bans change. */
	| ({ type: 'adminState' } & AdminState)
	| { type: 'adminResult'; ok: boolean; error?: string; message?: string }
	/** Sent right before close code 4009: the client stops reconnecting until reload. */
	| { type: 'banned'; reason: string | null };

export interface AccountInfo {
	username: string;
	/** Admin account (server config ADMIN_USERNAMES); only used to show the admin menu. */
	admin?: boolean;
}

// ---------------------------------------------------------------------------
// Binary frames
// ---------------------------------------------------------------------------

export const BIN_STATE = 1;
export const BIN_SNAPSHOT = 2;
/**
 * S->C record ghost for a map (docs/gameplay.md#ghosts), the reply to
 * `getGhost` and pushed on a new record. Layout and helpers: ./ghost.ts.
 */
export const BIN_GHOST = 3;

export interface NetState {
	tick: number;
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	pitch: number;
	yaw: number;
	flags: number;
	status: Status;
	stage: number;
	runTicks: number;
}

const STATE_BODY = 4 + 4 * 8 + 1 + 1 + 1 + 4; // 43
export const STATE_SIZE = 1 + STATE_BODY;

function writeBody(v: DataView, o: number, s: NetState): number {
	v.setUint32(o, s.tick >>> 0, true);
	o += 4;
	for (const n of [s.x, s.y, s.z, s.vx, s.vy, s.vz, s.pitch, s.yaw]) {
		v.setFloat32(o, n, true);
		o += 4;
	}
	v.setUint8(o++, s.flags);
	v.setUint8(o++, s.status);
	v.setUint8(o++, s.stage);
	v.setUint32(o, s.runTicks >>> 0, true);
	return o + 4;
}

function readBody(v: DataView, o: number): NetState {
	const f = (i: number) => v.getFloat32(o + 4 + i * 4, true);
	return {
		tick: v.getUint32(o, true),
		x: f(0),
		y: f(1),
		z: f(2),
		vx: f(3),
		vy: f(4),
		vz: f(5),
		pitch: f(6),
		yaw: f(7),
		flags: v.getUint8(o + 36),
		status: v.getUint8(o + 37) as Status,
		stage: v.getUint8(o + 38),
		runTicks: v.getUint32(o + 39, true)
	};
}

export function encodeState(s: NetState): ArrayBuffer {
	const buf = new ArrayBuffer(STATE_SIZE);
	const v = new DataView(buf);
	v.setUint8(0, BIN_STATE);
	writeBody(v, 1, s);
	return buf;
}

export function decodeState(buf: ArrayBuffer): NetState | null {
	if (buf.byteLength !== STATE_SIZE) return null;
	const v = new DataView(buf);
	if (v.getUint8(0) !== BIN_STATE) return null;
	const s = readBody(v, 1);
	for (const n of [s.x, s.y, s.z, s.vx, s.vy, s.vz, s.pitch, s.yaw]) if (!Number.isFinite(n)) return null;
	return s;
}

export interface SnapshotEntry extends NetState {
	id: number;
}

export function encodeSnapshot(entries: SnapshotEntry[]): ArrayBuffer {
	const buf = new ArrayBuffer(2 + entries.length * (2 + STATE_BODY));
	const v = new DataView(buf);
	v.setUint8(0, BIN_SNAPSHOT);
	v.setUint8(1, entries.length);
	let o = 2;
	for (const e of entries) {
		v.setUint16(o, e.id, true);
		o = writeBody(v, o + 2, e);
	}
	return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): SnapshotEntry[] | null {
	const v = new DataView(buf);
	if (buf.byteLength < 2 || v.getUint8(0) !== BIN_SNAPSHOT) return null;
	const n = v.getUint8(1);
	if (buf.byteLength !== 2 + n * (2 + STATE_BODY)) return null;
	const out: SnapshotEntry[] = [];
	let o = 2;
	for (let i = 0; i < n; i++) {
		const id = v.getUint16(o, true);
		out.push({ id, ...readBody(v, o + 2) });
		o += 2 + STATE_BODY;
	}
	return out;
}

/** Format ticks as mm:ss.mmm. */
export function formatTicks(ticks: number, tickRate = TICK_RATE): string {
	const ms = Math.round((ticks / tickRate) * 1000);
	const m = Math.floor(ms / 60000);
	const s = Math.floor((ms % 60000) / 1000);
	const r = ms % 1000;
	return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

/** Strip control chars and trim; limit length. HTML-escaping is done at render time. */
export function sanitizeText(text: string, max: number): string {
	// eslint-disable-next-line no-control-regex
	return text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
