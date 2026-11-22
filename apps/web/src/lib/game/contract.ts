/**
 * Contract between the game engine (src/lib/game, src/lib/render, src/lib/net,
 * src/lib/audio) and the Svelte UI (src/lib/ui, src/routes).
 *
 * The engine owns a single `HudState` instance (implemented as a class with
 * Svelte 5 `$state` fields in `hud.svelte.ts`) and a `GameApi`. The UI reads
 * `HudState` reactively and calls `GameApi` methods; it never touches Three.js
 * or the network directly.
 */
import type { AdminAction, AdminState, GameModeId, ModeFamily, ScoreRow, TagPhase, WeaponId, ZmPhase, ZmTeam } from '@surf/shared';

export interface ChatLine {
	id: number;
	from: string | null; // null = system
	text: string; // plain text; UI must render as text (never {@html})
	system: boolean;
	at: number; // performance.now()
	/** Sender is a server admin (server-sent flag; never derived from the name). */
	admin?: boolean;
}

export interface ConsoleLine {
	id: number;
	text: string;
	kind: 'input' | 'output' | 'error' | 'echo';
}

export interface VoteView {
	labels: string[]; // option labels in key order (1..7: up to 6 maps "Surf · Kessler", then extend)
	counts: number[];
	endsAt: number; // performance.now() timestamp
	duration: number; // seconds
	myVote: number | null; // 1-based
	rtv: boolean;
	/** Set after the vote closes: winner label and change time. */
	result: { label: string; changeAt: number } | null;
}

/** Open RTV request: the CS2-style modal at the top (docs/ui.md#rtv-request). */
export interface RtvRequestView {
	initiator: string;
	/** Nominated map label ("Surf · Echo"), or null. */
	mapLabel: string | null;
	yes: number;
	no: number;
	/** Yes votes needed to pass. */
	needed: number;
	endsAt: number; // performance.now() timestamp
	duration: number; // total seconds (countdown bar)
	myChoice: 'yes' | 'no' | null;
	/** False for spectators (they see the modal but cannot vote). */
	canVote: boolean;
	/** Set when the request closed (shown briefly). */
	result: { passed: boolean; at: number } | null;
}

/** A rotation map as listed in the Esc menu's map list (Change map). */
export interface MapListEntry {
	id: string;
	title: string;
	kind: string; // gamemode (surf, bhop, ...)
	difficulty: string;
	/** Disabled by an admin (online): not in votes, greyed in Change map. */
	disabled?: boolean;
}

/** Tag HUD (docs/modes.md#tag); null in race modes. */
/** Zombies kill feed line. */
export interface KillFeedLine {
	id: number;
	text: string;
	head: boolean;
	/** The local player made the kill. */
	mine: boolean;
	at: number;
}

/** Zombies HUD (docs/modes.md#zombies, docs/ui.md#zombies-hud); null in other modes. */
export interface ZombiesView {
	phase: ZmPhase;
	round: number;
	/** performance.now() when the countdown / round summary ends (0 otherwise). */
	endsAt: number;
	/** performance.now() when the round started (playing), 0 otherwise. */
	startedAt: number;
	/** Survivor, or turned into a zombie (claws, zombie HP) for the rest of the round. */
	team: ZmTeam;
	/** The next gate that is not open: closed (go to its unlock area) or counting down. */
	gate: { index: number; count: number; state: 'closed' | 'counting'; opensAt: number } | null;
	/** Not alive: performance.now() of the (zombie) respawn, approximately. */
	respawnAt: number;
	hp: number;
	maxHp: number;
	alive: boolean;
	weapon: WeaponId;
	weaponLabel: string;
	/** Rounds in the magazine / magazine size / reserve; melee weapons have magSize 0. */
	mag: number;
	magSize: number;
	reserve: number;
	/** performance.now() when the reload finishes (0 = not reloading) and its length. */
	reloadEndsAt: number;
	reloadMs: number;
	/** The weapon can still be changed with 1-4 until loadoutEndsAt (performance.now()). */
	loadoutOpen: boolean;
	loadoutEndsAt: number;
	checkpoint: number;
	checkpoints: number;
	/** Front player's route progress 0..1. */
	progress: number;
	zombies: number;
	teamKills: number;
	myKills: number;
	hitMarker: { at: number; head: boolean; kill: boolean } | null;
	killFeed: KillFeedLine[];
	/** Short banner ("Checkpoint 2/5", "Go!"). */
	flash: { text: string; at: number } | null;
	/** Last time the local player was hit (red vignette). */
	hurtAt: number;
	/** Down: watching a teammate until the next checkpoint. */
	down: { targetName: string } | null;
	scoped: boolean;
	/** Round result while the summary shows. */
	summary: { won: boolean; secs: number; kills: number; top: string | null } | null;
	online: boolean;
}

export interface TagView {
	/** 'solo' = offline free roam (tag needs a server and 2+ players). */
	phase: TagPhase | 'solo';
	round: number;
	/** performance.now() when the round ends (playing) or starts (countdown); 0 otherwise. */
	endsAt: number;
	/** The local (or spectated) player is IT. */
	isIt: boolean;
	/** Tag-back immunity (just tagged someone). */
	immune: boolean;
	itNames: string[];
	/** Seconds not being IT this round. */
	score: number;
	/** Short-lived banner ("You're IT!", "Alice tagged you"). */
	flash: { text: string; at: number } | null;
}

export interface HudStateShape {
	// Connection / lobby
	online: boolean;
	connecting: boolean;
	playerCount: number;
	maxPlayers: number;
	// Map
	mapId: string;
	mapTitle: string;
	mapTimeLeft: number; // seconds
	// Gamemode (docs/modes.md): race HUD (timer, splits, records) only when modeFamily is 'race'.
	gameMode: GameModeId;
	modeFamily: ModeFamily;
	tag: TagView | null;
	zombies: ZombiesView | null;
	/** Rotation maps, in rotation order (Esc menu, Change map). */
	maps: MapListEntry[];
	/** Solo, or online as the only connected client: the Esc menu may switch maps directly. */
	canChangeMap: boolean;
	// Movement
	speed: number; // horizontal u/s of the local (or spectated) player
	speedTrend: 'up' | 'down' | 'flat';
	keys: { w: boolean; a: boolean; s: boolean; d: boolean; jump: boolean; duck: boolean };
	// Run
	runPhase: 'start' | 'running' | 'finished' | 'idle';
	runTicks: number;
	stage: number; // current stage or last checkpoint (0 = none)
	stageCount: number; // number of stages (staged) or checkpoints
	stageKind: 'stage' | 'checkpoint';
	unofficial: boolean; // sv_* changed in solo
	splitPopup: { label: string; ticks: number; delta: number | null; at: number } | null;
	pbTicks: number | null;
	pbRank: number | null;
	recordTicks: number | null;
	recordName: string | null;
	// Account (docs/gameplay.md#accounts-and-identity)
	/** Logged-in account; null = guest (runs are not saved to the leaderboard). */
	account: { username: string; admin?: boolean } | null;
	/** Admin menu data (docs/ui.md#admin); only sent by the server to admin accounts, null otherwise. */
	adminState: AdminState | null;
	/** Result of the last admin action (shown in the Admin menu). */
	adminNotice: { ok: boolean; text: string; at: number } | null;
	/** Last register/login error from the server or offline notice; null when none. */
	authError: string | null;
	/** A register/login request is waiting for the server. */
	authBusy: boolean;
	// Social
	chat: ChatLine[]; // last 100
	chatOpen: boolean;
	vote: VoteView | null;
	rtvRequest: RtvRequestView | null;
	/** No RTV request before `until` (performance.now()): decline cooldown or map-start block. */
	rtvCooldown: { until: number; reason: 'declined' | 'mapStart' } | null;
	scoreboardOpen: boolean;
	scoreboard: ScoreRow[];
	spectating: { targetName: string; freeFly: boolean } | null;
	// Overlays
	consoleOpen: boolean;
	consoleLines: ConsoleLine[]; // last 500
	settingsOpen: boolean;
	/**
	 * Account panel (Login | Register | Play as guest). Replaces the old
	 * first-visit name prompt: open on first visit and when a stored session
	 * is rejected (unless the player already chose guest).
	 */
	authPanelOpen: boolean;
	pointerLocked: boolean;
	desktopOnly: boolean; // touch-only device detected
	// Debug readouts (only meaningful when the matching cvar is on)
	fps: number;
	pos: { x: number; y: number; z: number; pitch: number; yaw: number; vx: number; vy: number; vz: number };
	// Client cvar mirror for UI (crosshair, showfps, ...). Keys are cvar names.
	cvars: Record<string, number | string>;
}

export interface GameApi {
	/** Run a console line (e.g. "sensitivity 2.5", "bind mouse3 +jump"). Output goes to consoleLines. */
	exec(line: string): void;
	/** Console tab completion: returns matching command/cvar names. */
	complete(prefix: string): string[];
	/** Console history (oldest first). */
	history(): string[];
	/** Send chat text; "!..." commands handled here (local or sent to server). */
	sendChat(text: string): void;
	setCvar(name: string, value: number | string): void;
	/** Log in over the open connection; result lands in hud.account / hud.authError. */
	login(username: string, password: string): void;
	/** Create an account and log in. Same rules as the server (usernameError/passwordError in @surf/shared). */
	register(username: string, password: string): void;
	/** End the session (server and localStorage); back to the guest name. */
	logout(): void;
	/** Choose guest play with this name; closes the account panel. */
	playAsGuest(name: string): void;
	/** Open the account panel (e.g. from the Esc menu). */
	openAuth(): void;
	/** Close the account panel (first visit: same as playing as guest with the current name). */
	closeAuth(): void;
	/** Request pointer lock on the game canvas (call from a click handler). */
	lockPointer(): void;
	openChat(): void;
	closeChat(): void;
	toggleConsole(): void;
	closeSettings(): void;
	/** Cast a vote (1-based). */
	vote(option: number): void;
	/** Answer the open RTV request (same as keys 1 / 2). */
	rtvVote(yes: boolean): void;
	/**
	 * Pick a map from Change map: switch at once (solo, or online when alone;
	 * see canChangeMap), otherwise start an RTV request nominating it.
	 */
	changeMap(id: string): void;
	/** Admin menu request (re-checked by the server); replies land in adminState / adminNotice. */
	admin(action: AdminAction): void;
}

/**
 * Entry point, implemented by the engine in `src/lib/game/index.ts`:
 *
 *   export function createGame(canvas: HTMLCanvasElement): GameHandle
 *
 * Keyboard/mouse ownership:
 * - The engine listens on window for keys/mouse and runs binds (movement,
 *   Y = openChat, ` / ~ = toggleConsole, Tab = scoreboard while held, 1-7 map vote /
 *   1-2 RTV request (vote.ts routeVoteKey, ahead of binds),
 *   M spectate, R restart, wheel jump). Pointer-lock loss while no overlay is
 *   open sets settingsOpen = true (browsers swallow Esc when exiting lock).
 * - While chatOpen or consoleOpen or settingsOpen or authPanelOpen is true,
 *   the engine ignores all game binds except the console toggle key (when the
 *   console is open). The UI owns text inputs: Enter/Escape in the chat input
 *   call sendChat/closeChat; Escape in the console calls toggleConsole.
 * - Clicking the canvas while no overlay is open calls lockPointer().
 */
export interface GameHandle {
	hud: HudStateShape; // reactive ($state-backed) object
	api: GameApi;
	destroy(): void;
}
