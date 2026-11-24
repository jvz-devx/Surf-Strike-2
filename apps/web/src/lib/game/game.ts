/**
 * Game orchestration: fixed-tick simulation, input/binds, console, run
 * tracking, solo rotation, networking, spectating, audio and rendering.
 * The UI only sees `hud` and `api` (contract.ts).
 */
import {
	buildCollisionWorld,
	createPlayer,
	DEFAULT_MAP_ID,
	DUCK_VIEW_HEIGHT,
	encodeState,
	eyeHeight,
	FLAG_DUCKED,
	FLAG_ON_GROUND,
	FINISH_RESET_DELAY,
	FLAG_TELEPORTED,
	formatTenths,
	formatTicks,
	GhostRecorder,
	inflateGhost,
	unpackGhost,
	getMap,
	hnsSpawns,
	HNS_NAMETAG_RANGE,
	hullInBox,
	CLOSE_IP_LIMIT,
	MAP_IDS,
	mapCvars,
	modeOf,
	MAPS,
	MapRotation,
	MAX_CHAT,
	RTV_REQUEST_DURATION,
	MAX_TICKS_PER_FRAME,
	HULL_MIN,
	DUCK_HULL_MAX,
	playerMaxs,
	PROTOCOL_VERSION,
	passwordError,
	playerMove,
	usernameError,
	randomSpawn,
	mapTitle,
	RunTracker,
	sanitizeLoadout,
	sanitizeText,
	Status,
	SURF_CVARS,
	SV_BOOL_CVARS,
	TICK_INTERVAL,
	TICK_RATE,
	VIEW_HEIGHT,
	type AdminAction,
	type ClientMessage,
	type CollisionWorld,
	type Cvars,
	type GameModeDef,
	type GhostFrame,
	type Loadout,
	type Spawn,
	type TagModeState,
	type MapDef,
	type MapRecordInfo,
	type NetState,
	type PlayerState,
	type RotationEvent,
	type RunEvent,
	type ScoreRow,
	type ServerMessage,
	type SnapshotEntry,
	type UserCmd,
	type Vec3,
	type VoteOption,
	type WeaponId
} from '@surf/shared';
import { GameAudio } from '../audio/audio.js';
import { GameFullscreen } from '../input/fullscreen.js';
import { isBrowserShortcut } from '../input/guard.js';
import { Input } from '../input/input.js';
import { isMoveAction, SubtickSampler } from '../input/subtick.js';
import type { NetClient } from '../net/client.js';
import { Connection } from '../net/connection.js';
import { serverOverride } from '../net/discovery.js';
import { emptySample, INTERP_DELAY_MS, SnapshotBuffer, type Sample } from '../net/interp.js';
import { emptyPose } from '../render/players.js';
import { GameRenderer } from '../render/renderer.js';
import { Binds } from './binds.js';
import { CHAT_HELP, parseChatCommand } from './chat.js';
import { cvarFallback, HOLD_ACTIONS, registerCommands, type CommandContext, type HoldAction } from './commands.js';
import { casinoError, casinoResult, crashStarted, parseCasino } from './casino.js';
import { parseShop, shopNotice } from './shop.js';
import { CharacterPreview, disposeItemPictures, itemPicture, warmItemPictures } from '../render/character/preview.js';
import { parseBoxNews, pushBoxNews } from './box-news.js';
import { applyAward, awardPopup, countdown, noticePopup, pushPopup } from './coins.js';
import { DevConsole, type PrintKind } from './console.js';
import type { CharacterPreviewHandle, ChatLine, ConsoleLine, GameApi, TagView } from './contract.js';
import { ClientCvars } from './cvars.js';
import { HudState } from './hud.svelte.js';
import {
	cleanName,
	clearSession,
	isGuest,
	loadName,
	loadPlayerId,
	loadSession,
	saveName,
	saveSession,
	setGuest,
	type StoredSession
} from './identity.js';
import { FixedStep } from './loop.js';
import { chooseGhost, ghostLabel, GhostPlayback, type GhostSource } from './ghost.js';
import { browserGhostStore, type GhostStore } from './ghost-store.js';
import { loadSoloPb, mergeRecordsPush, recordFields, saveSoloPb, splitDelta, type LocalPb } from './records.js';
import { cycleTarget, findTargetByName, specTargets } from './spectate.js';
import { browserStore, STORAGE_KEYS, type KeyValueStore } from './storage.js';
import { mapLabel, routeVoteKey, voteLabel } from './vote.js';
import { HnsClient, type HnsHost } from './hns.js';
import { hnsTagVisible } from './hns-view.js';
import { InfectedClient, type InfHost } from './infected.js';
import { ZombiesClient, type ZmHost } from './zombies.js';

const FREEFLY_SPEED = 1000;
const ZERO_VEC: Vec3 = { x: 0, y: 0, z: 0 };
const MAX_CHAT_LINES = 100;
const MAX_CONSOLE_LINES = 500;
const SOLO_VOTER = 'local';
/** Scoreboard row id of the local player offline. */
const SOLO_ROW_ID = 0;
const FULL_HOLDOFF_MS = 60_000;
/** Reconnect this long after a temporary ban lifted (clock and timer slack). */
const BAN_RECONNECT_MS = 1_000;
/** The shop stops waiting for a reply after this long. */
const SHOP_TIMEOUT_MS = 6_000;
const SV_NAMES = Object.keys(SURF_CVARS) as Array<keyof Cvars>;
const SV_BOOL = SV_BOOL_CVARS;

interface Remote {
	id: number;
	name: string;
	spectating: boolean;
	buf: SnapshotBuffer;
	sample: Sample;
	hasSample: boolean;
}

interface Spectate {
	targetId: number | null;
	freeFly: boolean;
	pos: Vec3; // free-fly camera eye
}

function vlerp(a: Vec3, b: Vec3, t: number, out: Vec3): Vec3 {
	out.x = a.x + (b.x - a.x) * t;
	out.y = a.y + (b.y - a.y) * t;
	out.z = a.z + (b.z - a.z) * t;
	return out;
}

function phaseStatus(phase: RunTrackerPhase): Status {
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
type RunTrackerPhase = 'start' | 'running' | 'finished' | 'idle';

function statusPhase(s: number): RunTrackerPhase {
	if (s === Status.StartZone) return 'start';
	if (s === Status.Running) return 'running';
	if (s === Status.Finished) return 'finished';
	return 'idle';
}

/**
 * First solo map: `?map=<id>` when it names a known map (rotation or sandbox),
 * else DEFAULT_MAP_ID. A server's welcome still switches to the server's map.
 */
export function initialMapId(search: string, lastMap: string | null = null): string {
	try {
		const id = new URLSearchParams(search).get('map')?.trim();
		if (id && getMap(id)) return id;
	} catch {
		// malformed query: last or default map
	}
	return lastMap && getMap(lastMap) ? lastMap : DEFAULT_MAP_ID;
}

export class Game implements CommandContext {
	readonly hud = new HudState();
	readonly api: GameApi;
	readonly cvars: ClientCvars;
	readonly binds: Binds;
	private store: KeyValueStore = browserStore;
	private con: DevConsole;
	private input: Input;
	private fullscreen: GameFullscreen;
	/** The refused-keyboard-lock notice was shown. */
	private lockRefused = false;
	private renderer: GameRenderer | null = null;
	private audio = new GameAudio();
	private conn: Connection;
	private step = new FixedStep(TICK_RATE, MAX_TICKS_PER_FRAME);
	private raf = 0;
	private lastFrame = -1;
	private disposed = false;
	private offCvars: () => void;
	private lineId = 0;

	// Identity
	private playerId: string;
	/** Stored session (token + username); the server confirms it on welcome. */
	private session: StoredSession | null;
	/** Token sent in the current connection's hello (to detect a rejected session). */
	private helloToken: string | null = null;

	// Map and simulation
	private map!: MapDef;
	private world!: CollisionWorld;
	private player!: PlayerState;
	private tracker!: RunTracker;
	/** Gamemode of the loaded map (docs/modes.md); race modes use `tracker`. */
	private gameMode: GameModeDef = modeOf({ kind: 'surf' });
	/** Tag: latest server mode state (null offline / race) and when it arrived. */
	private tagState: TagModeState | null = null;
	private tagStateAt = 0;
	private tagFlash: TagView['flash'] = null;
	private tagViewKey = '';
	/** Zombies mode client (docs/modes.md#zombies); null on other maps. */
	private zm: ZombiesClient | null = null;
	/** Infected mode client (docs/modes.md#infected); null on other maps. */
	private inf: InfectedClient | null = null;
	/** Hide and seek client (docs/modes.md#hide-and-seek); null on other maps. */
	private hns: HnsClient | null = null;
	/** Physics cvars with the held weapon's max speed (zombies). */
	private zmSv: Cvars = { ...SURF_CVARS };
	private sv: Cvars = { ...SURF_CVARS };
	private tick = 0;
	private pitch = 0;
	private yaw = 0;
	private prevEye: Vec3 = { x: 0, y: 0, z: 0 };
	private currEye: Vec3 = { x: 0, y: 0, z: 0 };
	private renderEye: Vec3 = { x: 0, y: 0, z: 0 };
	private cmd: UserCmd = { pitch: 0, yaw: 0, forwardmove: 0, sidemove: 0, buttons: 0 };
	private held: Record<HoldAction, number> = Object.fromEntries(HOLD_ACTIONS.map((a) => [a, 0])) as Record<HoldAction, number>;
	private pressedKeys = new Map<string, string>();
	/** Movement key changes with timestamps, cut into per-tick subtick events. */
	private sampler = new SubtickSampler();
	/** Timestamp (ms) of the DOM input event being handled, -1 outside one. */
	private inputTime = -1;
	private teleported = true;
	private snapPending = false;
	private mouse = { dx: 0, dy: 0 };

	// Online
	private mode: 'solo' | 'online' = 'solo';
	private net: NetClient | null = null;
	private selfId = -1;
	private shopTimer: ReturnType<typeof setTimeout> | undefined;
	private casinoTimer: ReturnType<typeof setTimeout> | undefined;
	/** Account and its casino net when this session began (kept over reconnects). */
	private casinoSession: { username: string; net: number } | null = null;
	/** The loot box screen is open. */
	private boxScreen = false;
	/** The server holds a result of ours back until it was shown. */
	private boxUnseen = false;
	private remotes = new Map<number, Remote>();
	/** Scratch pose for `players.setPose`. */
	private readonly avatarPose = emptyPose();
	private records: MapRecordInfo | null = null;
	private mapEndsAt = 0;
	private netState: NetState = {
		tick: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, pitch: 0, yaw: 0, flags: 0, status: Status.Idle, stage: 0, runTicks: 0
	};
	private fullNotified = false;
	/** Set by a `banned` message (reason, '' = none) until the 4009 close arrives. */
	private bannedReason: string | null = null;
	/** Seconds until that ban lifts by itself; null = permanent. */
	private bannedSecs: number | null = null;

	// Solo
	private rotation: MapRotation | null = null;
	private soloPb: LocalPb | null = null;

	// Ghosts (docs/gameplay.md#ghosts)
	private ghost = new GhostPlayback();
	private ghostRec = new GhostRecorder();
	private ghostStore: GhostStore = browserGhostStore();
	/** The server's record ghost for the current map (online). */
	private recordGhost: GhostSource | null = null;
	/** This browser's best run on the current map. */
	private localGhost: GhostSource | null = null;
	/** Set on the finish tick: the recorded run is closed after this tick's sample. */
	private ghostFinish: number | null = null;
	/** A teleport happened since the last recorded sample. */
	private ghostTp = false;
	/** Bumped per map load / ghost frame so late async results are dropped. */
	private ghostSeq = 0;
	private ghostFrameSeq = 0;
	private ghostWarned = false;
	/** What the record ghost's holder wears. */
	private ghostLook: { map: string; loadout: Loadout } | null = null;
	private lastRotationUpdate = 0;
	private lastSoloBoard = 0;

	// Spectate and vote
	private spec: Spectate | null = null;
	private voteOptions: VoteOption[] = [];

	// HUD bookkeeping
	private fpsFrames = 0;
	private fpsSince = 0;
	private trendAt = 0;
	private trendSpeed = 0;

	constructor(private canvas: HTMLCanvasElement) {
		this.cvars = new ClientCvars(this.store);
		this.binds = new Binds(this.store);
		this.playerId = loadPlayerId(this.store);
		const storedName = loadName(this.store);
		if (storedName) this.cvars.set('name', storedName);
		this.session = loadSession(this.store);
		this.hud.account = this.session ? { username: this.session.username } : null;
		// First visit (no session, never chose guest): account panel instead of the old name prompt.
		this.hud.authPanelOpen = !this.session && !isGuest(this.store);
		this.hud.cvars = this.cvars.snapshot();
		this.hud.maps = MAPS.map((m) => ({ id: m.id, title: m.title, kind: m.kind, difficulty: m.difficulty, ...(m.size && { size: m.size }) }));

		this.con = new DevConsole({
			print: (t, k) => this.print(t, k),
			fallback: (name, args) => cvarFallback(this, name, args),
			names: () => [...this.cvars.defs.keys(), ...SV_NAMES]
		});
		registerCommands(this.con, this);
		this.offCvars = this.cvars.onChange((name, value) => this.onCvar(name, value));

		try {
			this.renderer = new GameRenderer(canvas);
			this.renderer.setFov(this.cvars.num('fov'));
			this.renderer.players.setHidden(this.cvars.num('cl_hideplayers') !== 0);
		} catch (e) {
			this.renderer = null;
			this.print(`WebGL unavailable: ${(e as Error)?.message ?? e}`, 'error');
		}
		this.audio.setVolume(this.cvars.num('volume'));

		this.input = new Input(canvas, {
			key: (n, d, e) => this.onKey(n, d, e),
			button: (n, d, t) => this.onButton(n, d, t),
			wheel: (n, t) => this.onWheel(n, t),
			pointerLock: (l) => this.onPointerLock(l),
			canvasClick: () => {
				if (!this.overlayOpen()) this.lockPointer();
			},
			gesture: () => this.audio.resume(),
			blur: () => this.releaseAll(),
			overlayOpen: () => this.overlayOpen()
		});
		this.fullscreen = new GameFullscreen((ok) => this.onKeyboardLock(ok));
		this.hud.fullscreenSupported = this.fullscreen.supported;

		this.loadMap(initialMapId(typeof location !== 'undefined' ? location.search : '', this.store.get(STORAGE_KEYS.lastMap)));
		this.startSoloRotation();

		this.conn = new Connection(
			{
				connecting: () => {
					this.hud.connecting = true;
				},
				idle: () => {
					this.hud.connecting = false;
				},
				open: (c) => this.onOpen(c),
				message: (m) => this.onMessage(m),
				snapshot: (e, t) => this.onSnapshot(e, t),
				ghost: (f) => this.onGhostFrame(f),
				zombies: (f, t) => this.zm?.onZombies(f, t),
				closed: (wasOpen, _url, code) => this.onClosed(wasOpen, code)
			},
			{
				override: typeof location !== 'undefined' ? serverOverride(location.search) : null,
				dev: import.meta.env.DEV,
				fetch: (...a) => fetch(...a)
			}
		);

		this.api = {
			exec: (line) => this.con.submit(line),
			complete: (p) => this.con.complete(p),
			history: () => this.con.history(),
			sendChat: (t) => this.sendChat(t),
			setCvar: (n, v) => this.setCvar(n, v),
			login: (u, p) => this.credentials('login', u, p),
			register: (u, p) => this.credentials('register', u, p),
			logout: () => this.logout(),
			playAsGuest: (n) => this.playAsGuest(n),
			openAuth: () => this.openAuth(),
			closeAuth: () => this.closeAuth(),
			lockPointer: () => this.lockPointer(),
			openChat: () => this.openChat(),
			closeChat: () => this.closeChat(),
			toggleConsole: () => this.toggleConsole(),
			closeSettings: () => this.closeSettings(),
			vote: (o) => this.vote(o),
			changeMap: (id) => this.changeMap(id),
			rtvVote: (yes) => this.rtvVote(yes),
			minimizeBan: (minimized) => this.minimizeBan(minimized),
			shopBuy: (item) => this.shopRequest({ type: 'shopBuy', item }),
			boxOpen: () => this.shopRequest({ type: 'boxOpen' }),
			boxRevealed: () => this.boxRevealed(),
			boxScreen: (open) => {
				this.boxScreen = open;
				if (!open) this.boxRevealed();
			},
			boxSound: (name) => this.audio.box(name),
			casinoBet: (bet) => this.casinoRequest(bet),
			crashCashout: () => this.casinoRequest({ type: 'crashCashout' }),
			casinoSound: (name) => this.audio.casino(name),
			shopEquip: (slot, item) => this.shopRequest({ type: 'shopEquip', slot, item }),
			createPreview: (canvas) => this.createPreview(canvas),
			itemPicture: (id) => itemPicture(this.selfId, id),
			admin: (a) => this.adminAction(a)
		};

		this.print('Surf Strike 2. Type "help" for commands.');
	}

	start(): void {
		this.conn.start();
		this.raf = requestAnimationFrame(this.frame);
	}

	// -----------------------------------------------------------------------
	// Console / chat output
	// -----------------------------------------------------------------------

	print(text: string, kind: PrintKind = 'output'): void {
		const lines = text.split('\n').map((t): ConsoleLine => ({ id: ++this.lineId, text: t, kind }));
		const next = this.hud.consoleLines.concat(lines);
		this.hud.consoleLines = next.length > MAX_CONSOLE_LINES ? next.slice(-MAX_CONSOLE_LINES) : next;
	}

	clearConsole(): void {
		this.hud.consoleLines = [];
	}

	private pushChat(from: string | null, text: string, system = from === null, admin = false): void {
		const line: ChatLine = { id: ++this.lineId, from, text, system, at: performance.now(), ...(admin ? { admin: true } : {}) };
		const next = this.hud.chat.concat(line);
		this.hud.chat = next.length > MAX_CHAT_LINES ? next.slice(-MAX_CHAT_LINES) : next;
		this.audio.chatTick();
	}

	private notice(text: string): void {
		this.pushChat(null, text, true);
	}

	// -----------------------------------------------------------------------
	// Cvars
	// -----------------------------------------------------------------------

	private onCvar(name: string, value: number | string): void {
		this.hud.cvars = this.cvars.snapshot();
		switch (name) {
			case 'volume':
				this.audio.setVolume(Number(value));
				break;
			case 'fov':
				this.renderer?.setFov(Number(value));
				break;
			case 'cl_hideplayers':
				this.renderer?.players.setHidden(Number(value) !== 0);
				break;
			case 'cl_fullscreen':
				if (Number(value) !== 0) this.fullscreen.enter();
				else this.fullscreen.exit();
				break;
			case 'name':
				saveName(this.store, String(value));
				// Logged in: the username is the display name; this stays the guest name.
				if (this.hud.account) this.notice(`You're logged in as ${this.hud.account.username}. "${value}" is your guest name.`);
				else this.send({ type: 'name', name: String(value) });
				break;
		}
	}

	private setCvar(name: string, value: number | string): void {
		if (this.cvars.has(name)) {
			const err = this.cvars.set(name, value);
			if (err) this.print(err, 'error');
		} else if ((SV_NAMES as string[]).includes(name)) {
			this.svSet(name, String(value));
		} else this.print(`Unknown cvar: ${name}`, 'error');
	}

	svNames(): string[] {
		return SV_NAMES;
	}

	svGet(name: string): number | undefined {
		return this.sv[name as keyof Cvars];
	}

	svSet(name: string, raw: string): void {
		if (this.mode === 'online') {
			this.print('sv_* cvars can only be changed in solo mode.', 'error');
			return;
		}
		let n = Number(raw);
		if (!Number.isFinite(n)) {
			this.print(`${name}: "${raw}" is not a number`, 'error');
			return;
		}
		const key = name as keyof Cvars;
		if (SV_BOOL.has(key)) n = n !== 0 ? 1 : 0;
		if (this.sv[key] === n) return;
		(this.sv as unknown as Record<string, number>)[key] = n;
		if (!this.hud.unofficial) this.print('Physics cvars changed: runs on this map are unofficial until the map reloads.');
		this.hud.unofficial = true;
	}

	// -----------------------------------------------------------------------
	// Map loading
	// -----------------------------------------------------------------------

	mapIds(): string[] {
		return [...MAP_IDS];
	}

	private loadMap(id: string, serverCvars?: Partial<Cvars>, records?: MapRecordInfo | null): void {
		const def = getMap(id) ?? getMap(DEFAULT_MAP_ID);
		if (!def) {
			this.print(`Map "${id}" not found`, 'error');
			return;
		}
		this.map = def;
		this.store.set(STORAGE_KEYS.lastMap, def.id);
		this.world = buildCollisionWorld(def);
		this.player = createPlayer({ ...def.spawn.pos });
		this.tracker = new RunTracker(def);
		this.gameMode = modeOf(def);
		this.sv = { ...mapCvars(def), ...(serverCvars ?? {}) };
		this.pitch = 0;
		this.yaw = def.spawn.yaw;
		if (this.gameMode.id === 'zombies') this.placeAt(def.spawn);
		else if (this.gameMode.family === 'hns') {
			const hiders = hnsSpawns(def).hiders;
			this.placeAt(hiders[Math.floor(Math.random() * hiders.length)]!);
		}
		else if (!this.isRace()) this.placeAt(randomSpawn(def));
		this.teleported = true;
		this.snapEye();
		this.step.reset();

		this.renderer?.loadMap(def);
		const h = this.hud;
		h.mapId = def.id;
		h.mapTitle = mapTitle(def);
		h.gameMode = this.gameMode.id;
		h.modeFamily = this.gameMode.family;
		h.modeState = null;
		this.tagState = null;
		this.tagFlash = null;
		this.refreshTagView(performance.now());
		this.resetZombies();
		this.resetInfected();
		this.resetHns();
		h.unofficial = false;
		h.splitPopup = null;
		const staged = def.layout === 'staged';
		h.stageKind = staged ? 'stage' : 'checkpoint';
		let maxIndex = staged ? 1 : 0;
		for (const z of def.zones) {
			if (z.type === (staged ? 'stage' : 'checkpoint') && 'index' in z) maxIndex = Math.max(maxIndex, z.index);
		}
		h.stageCount = maxIndex;
		for (const r of this.remotes.values()) {
			r.buf.clear();
			r.hasSample = false;
		}
		if (this.mode === 'solo') {
			this.records = null;
			this.soloPb = loadSoloPb(this.store, def.id);
		} else this.records = records ?? null;
		this.applyRecords();
		this.loadGhosts();
	}

	private applyRecords(): void {
		const h = this.hud;
		const f = recordFields(this.mode, this.records, this.soloPb);
		h.pbTicks = f.pbTicks;
		h.pbRank = f.pbRank;
		h.recordTicks = f.recordTicks;
		h.recordName = f.recordName;
		h.recordTop = f.recordTop;
	}

	private pbSplits(): number[] | null {
		return this.mode === 'online' ? (this.records?.pbSplits ?? null) : (this.soloPb?.splits ?? null);
	}

	/** Online and the only connected client (spectators count). */
	private aloneOnline(): boolean {
		return this.mode === 'online' && this.remotes.size === 0;
	}

	changeMap(id: string): void {
		if (this.mode === 'online') {
			if (!MAP_IDS.includes(id)) {
				this.print(`Unknown map "${id}". Maps: ${MAP_IDS.join(', ')}`, 'error');
				return;
			}
			if (!this.aloneOnline()) {
				// Others here: the pick nominates the map in an RTV request.
				this.requestRtv(id);
				return;
			}
			// The server switches everyone (just us) and replies with mapChange.
			this.send({ type: 'changeMap', mapId: id });
			return;
		}
		if (!getMap(id)) {
			this.print(`Unknown map "${id}". Maps: ${MAP_IDS.join(', ')}`, 'error');
			return;
		}
		this.loadMap(id);
		this.startSoloRotation();
		this.hud.vote = null;
		this.hud.rtvRequest = null;
		this.hud.rtvCooldown = null;
	}

	private startSoloRotation(): void {
		const ids = this.mapIds();
		this.rotation = ids.includes(this.map.id)
			? new MapRotation({ maps: ids, current: this.map.id, now: performance.now(), kindOf: (id) => getMap(id)?.kind ?? '' })
			: null;
	}

	// -----------------------------------------------------------------------
	// Input and binds
	// -----------------------------------------------------------------------

	private overlayOpen(): boolean {
		const h = this.hud;
		return h.chatOpen || h.consoleOpen || h.settingsOpen || h.authPanelOpen || h.desktopOnly || (h.ban !== null && !h.ban.minimized);
	}

	private onKey(name: string, down: boolean, e: KeyboardEvent): boolean {
		const cmd = this.binds.get(name);
		if (this.overlayOpen()) {
			if (down && !e.repeat && cmd === 'toggleconsole' && this.hud.consoleOpen) {
				this.toggleConsole();
				return true;
			}
			return false;
		}
		// Ignore keys typed into other page inputs.
		const t = e.target as HTMLElement | null;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return false;
		if (name === 'escape') {
			// A repeat is a held Esc (leaves fullscreen): the first press already did its work.
			if (!down || e.repeat) return false;
			// Fullscreen keyboard lock hands us Esc with the pointer still locked; the menu opens
			// when the lock is gone (onPointerLock), as it does when the browser handles Esc.
			if (this.input.locked) this.input.exitLock();
			else this.openSettings();
			return true;
		}
		if (down) {
			// Crouch on Ctrl turns game keys into browser shortcuts (Ctrl+W above all). Swallow every
			// one the browser lets us see while playing; with a free cursor, close/new stay with it.
			const shortcut = isBrowserShortcut(name, e);
			if (shortcut && !this.input.locked && (name === 'w' || name === 't' || name === 'n')) return false;
			const swallow = shortcut && this.input.locked;
			// Number keys go to an open map vote (1-7) or RTV request (1/2) instead of their binds.
			const route = routeVoteKey(name, this.voteKeyState());
			if (route) {
				if (!e.repeat) {
					if (route.kind === 'mapVote') this.castMapVote(route.option);
					else this.rtvVote(route.yes);
				}
				return true;
			}
			if (!cmd) return swallow;
			if (e.repeat) return true;
			this.pressedKeys.set(name, cmd);
			this.inputTime = e.timeStamp;
			this.runBind(cmd, true);
			this.inputTime = -1;
			return true;
		}
		const pressed = this.pressedKeys.get(name);
		if (pressed === undefined) return !!cmd;
		this.pressedKeys.delete(name);
		this.inputTime = e.timeStamp;
		this.runBind(pressed, false);
		this.inputTime = -1;
		return true;
	}

	private onButton(name: string, down: boolean, t: number): void {
		if (this.overlayOpen()) return;
		this.inputTime = t;
		try {
			this.buttonBind(name, down);
		} finally {
			this.inputTime = -1;
		}
	}

	private buttonBind(name: string, down: boolean): void {
		if (down) {
			const cmd = this.binds.get(name);
			if (!cmd) return;
			this.pressedKeys.set(name, cmd);
			this.runBind(cmd, true);
		} else {
			const cmd = this.pressedKeys.get(name);
			if (cmd === undefined) return;
			this.pressedKeys.delete(name);
			this.runBind(cmd, false);
		}
	}

	/** Wheel binds press and release at the same instant (CS2 scroll bhop: both in one subtick). */
	private onWheel(name: string, t: number): void {
		if (this.overlayOpen()) return;
		const cmd = this.binds.get(name);
		if (!cmd) return;
		if (cmd.startsWith('+')) {
			const action = cmd.slice(1) as HoldAction;
			if (HOLD_ACTIONS.includes(action) && action !== 'showscores') {
				this.inputTime = t;
				this.press(action, true);
				this.press(action, false);
				this.inputTime = -1;
				return;
			}
		}
		this.con.exec(cmd);
	}

	private runBind(cmd: string, down: boolean): void {
		if (cmd.startsWith('+')) {
			if (down) this.con.exec(cmd);
			else this.con.exec(`-${cmd.slice(1).split(/[\s;]/)[0]}`);
		} else if (down) this.con.exec(cmd);
	}

	press(action: HoldAction, down: boolean): void {
		const was = this.held[action] > 0;
		this.held[action] = Math.max(0, this.held[action] + (down ? 1 : -1));
		const is = this.held[action] > 0;
		if (was === is) return;
		if (isMoveAction(action)) this.sampler.push(action, is, this.inputTime >= 0 ? this.inputTime : performance.now());
		switch (action) {
			case 'showscores':
				this.hud.scoreboardOpen = is;
				if (is && this.mode === 'solo') this.refreshSoloBoard(performance.now());
				break;
			case 'jump':
				if (is && this.spec) this.toggleFreeFly();
				break;
			case 'attack':
			case 'attack2':
				if (this.spec) {
					if (is) this.cycleSpectate(action === 'attack' ? 1 : -1);
				} else if (this.hns) {
					if (action === 'attack') this.hns.press(is, performance.now(), this.currEye, this.pitch, this.yaw);
				} else {
					this.zm?.press(action, is, performance.now());
					this.inf?.press(action, is, performance.now());
				}
				break;
		}
	}

	private releaseAll(): void {
		for (const a of HOLD_ACTIONS) this.held[a] = 0;
		this.pressedKeys.clear();
		this.sampler.releaseAll(performance.now());
		this.hud.scoreboardOpen = false;
	}

	private onPointerLock(locked: boolean): void {
		this.hud.pointerLocked = locked;
		if (!locked) {
			this.releaseAll();
			if (!this.overlayOpen()) this.hud.settingsOpen = true;
			return;
		}
		// After the pointer lock, not with it: requestFullscreen uses up the click that both need.
		if (this.cvars.num('cl_fullscreen') !== 0) this.fullscreen.enter();
	}

	private onKeyboardLock(ok: boolean): void {
		if (this.disposed) return;
		if (!ok) {
			if (!this.lockRefused) this.notice('The browser refused the keyboard lock, so Ctrl+W can still close the tab.');
			this.lockRefused = true;
		} else if (!this.store.get(STORAGE_KEYS.fullscreenHint)) {
			// Once per browser.
			this.store.set(STORAGE_KEYS.fullscreenHint, '1');
			this.notice('Fullscreen blocks Ctrl+W (forward + crouch). Esc: menu, hold Esc: leave fullscreen. Turn it off under Settings › Video.');
		}
	}

	private lockPointer(): void {
		this.audio.resume();
		if (this.hud.desktopOnly) return;
		this.input.requestLock();
	}

	private openSettings(): void {
		this.releaseAll();
		this.hud.settingsOpen = true;
	}

	private closeSettings(): void {
		this.hud.settingsOpen = false;
		if (!this.overlayOpen()) this.lockPointer();
	}

	openChat(): void {
		const h = this.hud;
		if (h.consoleOpen || h.settingsOpen || h.authPanelOpen) return;
		this.releaseAll();
		h.chatOpen = true;
	}

	private closeChat(): void {
		this.hud.chatOpen = false;
		if (!this.overlayOpen() && !this.input.locked) this.lockPointer();
	}

	toggleConsole(): void {
		const h = this.hud;
		h.consoleOpen = !h.consoleOpen;
		if (h.consoleOpen) {
			this.releaseAll();
			this.input.exitLock();
		} else if (!this.overlayOpen()) this.lockPointer();
	}

	// -----------------------------------------------------------------------
	// Accounts (docs/gameplay.md#accounts-and-identity)
	// -----------------------------------------------------------------------

	/** Display name: the account username when logged in, else the guest name cvar. */
	private myName(): string {
		return this.hud.account?.username ?? this.cvars.str('name');
	}

	private credentials(kind: 'login' | 'register', username: string, password: string): void {
		const h = this.hud;
		if (h.authBusy) return;
		if (h.account) {
			h.authError = `Already logged in as ${h.account.username}. Log out first.`;
			return;
		}
		if (this.mode !== 'online') {
			h.authError = 'Server offline — play as guest; log in when online.';
			return;
		}
		if (kind === 'register') {
			const bad = usernameError(username) ?? passwordError(password);
			if (bad) {
				h.authError = bad;
				return;
			}
		} else if (!username || !password) {
			h.authError = 'Enter your username and password.';
			return;
		}
		h.authError = null;
		h.authBusy = true;
		this.send({ type: kind, username, password });
	}

	private logout(): void {
		clearSession(this.store);
		this.session = null;
		this.helloToken = null;
		if (!this.hud.account) return;
		this.hud.account = null;
		this.hud.adminState = null;
		if (this.mode === 'online') this.send({ type: 'logout' });
		else this.notice('Logged out.');
	}

	private playAsGuest(raw: string): void {
		const n = cleanName(raw);
		if (!n || this.hud.account) return;
		setGuest(this.store);
		this.cvars.set('name', n);
		saveName(this.store, n);
		this.hud.authPanelOpen = false;
		this.hud.authError = null;
		this.lockPointer();
	}

	private openAuth(): void {
		this.releaseAll();
		this.input.exitLock();
		this.hud.settingsOpen = false;
		this.hud.authError = null;
		this.hud.authPanelOpen = true;
	}

	private closeAuth(): void {
		// Closing the first-visit panel without choosing: play as guest under the current name.
		if (!this.hud.account && !isGuest(this.store)) setGuest(this.store);
		this.hud.authPanelOpen = false;
		this.hud.authError = null;
		if (!this.overlayOpen()) this.lockPointer();
	}

	private minimizeBan(minimized: boolean): void {
		if (!this.hud.ban) return;
		this.hud.ban = { ...this.hud.ban, minimized };
		if (minimized && !this.overlayOpen()) this.lockPointer();
	}

	private onAuth(m: Extract<ServerMessage, { type: 'auth' }>): void {
		const h = this.hud;
		h.authBusy = false;
		if (!m.ok) {
			h.authError = m.error;
			if (!h.authPanelOpen) this.notice(m.error);
			return;
		}
		if (m.records) {
			this.records = m.records;
			this.applyRecords();
		}
		if (m.username === null) {
			h.account = null;
			h.adminState = null;
			this.notice(`Logged out. Playing as guest (${this.cvars.str('name')}); runs are not saved.`);
			return;
		}
		h.account = { username: m.username, admin: m.admin === true };
		h.authError = null;
		if (!h.account.admin) h.adminState = null;
		if (m.token) {
			this.session = { token: m.token, username: m.username };
			saveSession(this.store, this.session);
		}
		if (h.authPanelOpen) {
			h.authPanelOpen = false;
			// The reply is async (no user gesture): the click hint asks for a click to lock the pointer.
		}
		this.notice(`Logged in as ${m.username}. Your runs are saved to the leaderboard.`);
	}

	// -----------------------------------------------------------------------
	// Shop (docs/ui.md#shop): the server decides; the menu shows its replies.

	private shopRequest(msg: Extract<ClientMessage, { type: 'shopBuy' | 'shopEquip' | 'boxOpen' }>): void {
		const s = this.hud.shop;
		if (!s || s.busy || this.mode !== 'online') return;
		this.hud.shop = { ...s, busy: true, notice: null };
		this.send(msg);
		clearTimeout(this.shopTimer);
		this.shopTimer = setTimeout(() => {
			if (this.hud.shop?.busy) this.hud.shop = { ...this.hud.shop, busy: false, notice: { ok: false, text: 'No answer from the server. Try again.' } };
		}, SHOP_TIMEOUT_MS);
	}

	private boxRevealed(): void {
		if (!this.boxUnseen) return;
		this.boxUnseen = false;
		this.send({ type: 'boxRevealed' });
	}

	/** Casino (docs/ui.md#casino): the server rolls and pays. */
	private casinoRequest(msg: Extract<ClientMessage, { type: 'casinoBet' | 'crashCashout' }>): void {
		const c = this.hud.casino;
		if (!c || c.busy || this.mode !== 'online') return;
		this.hud.casino = { ...c, busy: true, error: null };
		this.send(msg);
		clearTimeout(this.casinoTimer);
		this.casinoTimer = setTimeout(() => {
			if (this.hud.casino?.busy) this.hud.casino = casinoError(this.hud.casino, 'No answer from the server. Try again.');
		}, SHOP_TIMEOUT_MS);
	}

	private onCasino(m: Extract<ServerMessage, { type: 'casino' }>, now: number): void {
		const username = this.hud.account?.username;
		if (username === undefined) this.casinoSession = null;
		else if (this.casinoSession?.username !== username) this.casinoSession = { username, net: m.net };
		this.hud.casino = parseCasino(m, now, this.casinoSession?.net ?? m.net, this.hud.casino);
	}

	private onCasinoResult(m: Extract<ServerMessage, { type: 'casinoResult' }>, now: number): void {
		const c = this.hud.casino;
		if (!c) return;
		clearTimeout(this.casinoTimer);
		this.hud.casino = m.ok ? casinoResult(c, m, Date.now()) : casinoError(c, m.error);
		// A crash round that ends while the menu is closed.
		if (m.ok && m.game === 'crash' && !this.hud.settingsOpen) {
			const text = m.payout > 0 ? `Crash: cashed out, ${formatTenths(m.payout)} coins.` : 'Crash: your bet is lost.';
			this.hud.awardPopups = pushPopup(this.hud.awardPopups, noticePopup({ type: 'coinsNotice', text, tone: 'info' }, now));
		}
	}

	private createPreview(canvas: HTMLCanvasElement): CharacterPreviewHandle | null {
		try {
			return new CharacterPreview(canvas, this.selfId);
		} catch {
			return null; // no second WebGL context
		}
	}

	/** The ghost looks like the player whose run it shows: this one, one who is here, or as the server describes them. */
	private dressGhost(): void {
		const g = this.ghost.source;
		if (!g || !this.renderer) return;
		const { players, ghost } = this.renderer;
		if (g.kind === 'pb' || (this.hud.account !== null && g.name === this.hud.account.username)) {
			return ghost.setPlayer(this.selfId, this.hud.shop?.loadout ?? null);
		}
		for (const r of this.remotes.values()) if (r.name === g.name) return ghost.setPlayer(r.id, players.loadoutOf(r.id));
		// Not here: a person of their own, always the same.
		let hash = 0;
		for (const ch of g.name) hash = (Math.imul(hash, 31) + ch.codePointAt(0)!) | 0;
		ghost.setPlayer(hash >>> 1, this.ghostLook?.map === g.map ? this.ghostLook.loadout : null);
	}


	// -----------------------------------------------------------------------
	// Admin (docs/ui.md#admin): the server decides who is admin and re-checks every request.

	private adminAction(action: AdminAction): void {
		if (this.mode !== 'online' || !this.hud.account?.admin) {
			this.hud.adminNotice = { ok: false, text: 'Admin actions need the server and an admin account.', at: performance.now() };
			return;
		}
		this.send({ type: 'admin', action });
	}

	/** Server's enabled maps (null = all, e.g. offline): disabled maps are greyed in Change map. */
	private applyEnabledMaps(enabled: Set<string> | null): void {
		this.hud.maps = this.hud.maps.map((m) => {
			const disabled = enabled !== null && !enabled.has(m.id);
			if (!!m.disabled === disabled) return m;
			const { disabled: _d, ...rest } = m;
			return disabled ? { ...rest, disabled: true } : rest;
		});
	}

	/** Welcome: confirm or drop the stored session. */
	private applyWelcomeAccount(account: { username: string; admin?: boolean } | null | undefined): void {
		const h = this.hud;
		if (account === undefined) return; // old server without accounts
		if (account) {
			h.account = { username: account.username, admin: account.admin === true };
			if (this.session && this.session.username !== account.username) {
				this.session = { ...this.session, username: account.username };
				saveSession(this.store, this.session);
			}
			return;
		}
		h.account = null;
		if (this.helloToken) {
			// Stored session unknown or expired: forget it; ask again unless playing as guest.
			clearSession(this.store);
			this.session = null;
			if (!isGuest(this.store)) {
				this.releaseAll();
				h.authPanelOpen = true;
			}
		}
	}

	// -----------------------------------------------------------------------
	// Chat
	// -----------------------------------------------------------------------

	say(text: string): void {
		this.sendChat(text, false);
	}

	private sendChat(raw: string, close = true): void {
		if (close) this.hud.chatOpen = false;
		const text = sanitizeText(raw, MAX_CHAT);
		if (!text) return;
		const cmd = parseChatCommand(text);
		const online = this.mode === 'online';
		if (!cmd) {
			if (online) this.send({ type: 'chat', text });
			else this.pushChat(this.myName(), text, false);
			return;
		}
		switch (cmd.kind) {
			case 'restart':
			case 'back':
				if (this.inf) return this.infectedRestart();
				if (this.zm) return this.zm.chatRestart(performance.now());
				return cmd.kind === 'restart' ? this.restart() : this.back();
			case 'spec':
				return this.spectate(cmd.target);
			case 'rtv':
				return this.rtv();
			case 'name': {
				if (this.hud.account) return this.notice(`You're logged in as ${this.hud.account.username}. Log out to play under another name.`);
				const n = cleanName(cmd.name);
				if (!n) return this.notice('Usage: !name <new name>');
				this.cvars.set('name', n);
				if (!online) this.notice(`You are now ${n}.`);
				return;
			}
		}
		if (online) {
			// !top, !pb, !help and unknown commands are answered by the server.
			this.send({ type: 'chat', text });
			return;
		}
		switch (cmd.kind) {
			case 'top':
				this.notice('Leaderboards are only available online. Solo runs are not saved to the leaderboard.');
				break;
			case 'pb':
				this.notice(this.soloPb ? `Your solo PB on ${this.map.title}: ${formatTicks(this.soloPb.ticks)}` : `No solo PB on ${this.map.title} yet.`);
				break;
			case 'help':
				this.notice(CHAT_HELP);
				break;
			default:
				this.notice(`Unknown command: !${cmd.name}`);
		}
	}

	// -----------------------------------------------------------------------
	// Runs
	// -----------------------------------------------------------------------

	/** (Re)create the zombies client for the current map and connection (docs/modes.md#zombies). */
	private resetZombies(): void {
		this.zm?.dispose();
		this.zm = null;
		if (this.gameMode.id !== 'zombies') {
			if (this.hud.zombies) this.hud.zombies = null;
			return;
		}
		const host: ZmHost = {
			online: () => this.mode === 'online',
			selfId: () => this.selfId,
			send: (msg) => this.send(msg),
			zombieRenderer: () => this.renderer?.zombies ?? null,
			name: (id) => (this.mode === 'solo' ? this.myName() : this.remoteName(id)),
			notice: (text) => this.notice(text),
			teleport: (x, y, z, yaw) => {
				this.placeAt({ pos: { x, y, z }, yaw });
				this.afterTeleport();
			},
			voteOpen: () => !!this.hud.vote && !this.hud.vote.result,
			sound: (name, at) => this.audio.zombies(name, at, this.currEye, this.yaw),
			setZoom: (fov) => this.renderer?.setFov(fov ?? this.cvars.num('fov')),
			push: (vx, vy) => {
				this.player.velocity.x = vx;
				this.player.velocity.y = vy;
			}
		};
		this.zm = new ZombiesClient(host, this.map, this.sv, performance.now());
		// Closed gates are solid for the local player too.
		this.world = this.zm.world;
		this.hud.zombies = this.zm.frame(performance.now(), false, 0);
	}

	/** (Re)create the infected client for the current map and connection (docs/modes.md#infected). */
	private resetInfected(): void {
		this.inf?.dispose();
		this.inf = null;
		if (this.gameMode.id !== 'infected') {
			if (this.hud.infected) this.hud.infected = null;
			return;
		}
		const host: InfHost = {
			online: () => this.mode === 'online',
			selfId: () => this.selfId,
			send: (msg) => this.send(msg),
			zombieRenderer: () => this.renderer?.zombies ?? null,
			infectedRenderer: () => this.renderer?.infected ?? null,
			name: (id) => this.remoteName(id),
			notice: (text) => this.notice(text),
			teleport: (x, y, z, yaw) => {
				this.placeAt({ pos: { x, y, z }, yaw });
				this.afterTeleport();
			},
			voteOpen: () => !!this.hud.vote && !this.hud.vote.result,
			sound: (name, at) => this.audio.infected(name, at, this.currEye, this.yaw),
			setZoom: (fov) => this.renderer?.setFov(fov ?? this.cvars.num('fov')),
			push: (vx, vy) => {
				this.player.velocity.x = vx;
				this.player.velocity.y = vy;
			}
		};
		this.inf = new InfectedClient(host, performance.now(), this.world);
		this.hud.infected = this.inf.frame(performance.now(), false, 0);
	}

	/** Chat `!r`/`!b` in infected: solo respawns; online rounds restart by themselves. */
	private infectedRestart(): void {
		if (this.inf?.localFallouts) return this.respawnRandom();
		this.notice('Infected rounds restart by themselves (use !rtv to change map).');
	}

	/** (Re)create the hide and seek client for the current map and connection (docs/modes.md#hide-and-seek). */
	private resetHns(): void {
		this.hns?.dispose();
		this.hns = null;
		if (this.gameMode.family !== 'hns') {
			if (this.hud.hns) this.hud.hns = null;
			return;
		}
		const host: HnsHost = {
			online: () => this.mode === 'online',
			selfId: () => this.selfId,
			send: (msg) => this.send(msg),
			name: (id) => this.remoteName(id),
			teleport: (pos, yaw) => {
				this.placeAt({ pos, yaw });
				this.afterTeleport();
			},
			sound: (name, from) => {
				if (from === undefined || from === this.selfId) return this.audio.hns(name);
				const r = this.remotes.get(from);
				if (!r?.hasSample) return;
				const o = this.player.origin;
				this.audio.hns(name, Math.hypot(r.sample.x - o.x, r.sample.y - o.y, r.sample.z - o.z));
			},
			viewmodel: () => this.renderer?.zombies ?? null,
			viewId: () => this.tagViewId(),
			cashBag: () => this.renderer?.cashBag ?? null,
			eye: () => {
				const pos = this.spec ? this.spec.pos : this.currEye;
				return { x: pos.x, y: pos.y, yaw: this.yaw };
			}
		};
		this.hns = new HnsClient(host, this.map);
		this.hud.hns = this.hns.frame(performance.now(), false, 0);
	}

	/** Respawn point for fall-outs and !r in non-race modes. */
	private fallSpawn(): Spawn {
		return this.hns ? this.hns.fallSpawn() : randomSpawn(this.map);
	}

	private isRace(): boolean {
		return this.gameMode.family === 'race';
	}

	/** Put the player at a spawn, standing still. */
	private placeAt(s: Spawn): void {
		const p = this.player;
		p.origin.x = s.pos.x;
		p.origin.y = s.pos.y;
		p.origin.z = s.pos.z;
		p.velocity.x = 0;
		p.velocity.y = 0;
		p.velocity.z = 0;
		p.onGround = false;
		this.yaw = s.yaw;
		this.pitch = 0;
	}

	/** Non-race modes: respawn at a random map spawn (fall-outs, !r, leaving spectate). */
	private respawnRandom(): void {
		this.placeAt(this.fallSpawn());
		this.afterTeleport();
	}

	/**
	 * Non-race modes: teleport triggers respawn at a random spawn, or move the
	 * player to the zone's fixed `dest` (map teleporters, any mode).
	 */
	private modeTick(): void {
		const p = this.player;
		for (const z of this.map.zones) {
			if (z.type !== 'teleport' || !hullInBox(p.origin, p.ducked, z)) continue;
			this.placeAt(z.dest ?? this.fallSpawn());
			this.teleported = true;
			this.snapPending = true;
			return;
		}
	}

	/** E (`beacon`): infected plant a respawn beacon; other modes ignore it. */
	beacon(): void {
		if (this.spec) return;
		this.inf?.placeBeacon(performance.now());
	}

	/** N (`moab`, also key 4): infected survivors call an earned M.O.A.B.; other modes ignore it. */
	moab(): void {
		if (this.spec) return;
		this.inf?.callMoab(performance.now());
	}

	restart(): void {
		if (this.spec) return;
		// Zombies: R reloads (chat !r restarts, see sendChat).
		if (this.zm) return this.zm.reload(performance.now());
		// Infected: R reloads the primary.
		if (this.inf) return this.inf.reload(performance.now());
		if (!this.isRace()) {
			if (this.tagState?.phase === 'playing') return this.notice('!r is disabled during a tag round.');
			if (this.hns && !this.hns.canRespawn()) return this.notice('!r is disabled during a hide and seek round.');
			return this.respawnRandom();
		}
		this.tracker.restart(this.player);
		this.yaw = this.map.spawn.yaw;
		this.pitch = 0;
		this.afterTeleport();
	}

	back(): void {
		if (this.spec) return;
		if (!this.isRace()) return this.restart();
		this.tracker.back(this.player);
		this.yaw = this.tracker.state.respawn.yaw;
		this.pitch = 0;
		this.afterTeleport();
	}

	private afterTeleport(): void {
		this.teleported = true;
		this.ghostTp = true;
		this.snapEye();
		this.hud.splitPopup = null;
	}

	/**
	 * Defensive: a spawn/teleport placed exactly on a floor can start solid in
	 * the trace; nudge up by up to 2 units so movement is not frozen.
	 */
	private unstick(): void {
		const o = this.player.origin;
		const maxs = playerMaxs(this.player);
		if (!this.world.trace(o, o, HULL_MIN, maxs).startsolid) return;
		const base = o.z;
		for (let dz = 0.0625; dz <= 2; dz *= 2) {
			o.z = base + dz;
			if (!this.world.trace(o, o, HULL_MIN, maxs).startsolid) return;
		}
		o.z = base;
	}

	private snapEye(): void {
		this.unstick();
		const p = this.player;
		this.currEye.x = p.origin.x;
		this.currEye.y = p.origin.y;
		this.currEye.z = p.origin.z + eyeHeight(p);
		this.prevEye.x = this.currEye.x;
		this.prevEye.y = this.currEye.y;
		this.prevEye.z = this.currEye.z;
	}

	private onRunEvent(ev: RunEvent, now: number): void {
		switch (ev.type) {
			case 'zone':
				// The server checks the last received state against the end zone:
				// send this tick's state first so it is not a stale one from before entry.
				if (ev.kind === 'end' && this.mode === 'online') this.sendState();
				this.send({ type: 'zone', kind: ev.kind, index: ev.index, tick: ev.tick });
				if (ev.kind !== 'start') this.audio.zoneBeep();
				else this.ghostRec.start(ev.tick);
				break;
			case 'enterStart':
				this.ghostRec.cancel();
				this.audio.zoneBeep();
				this.hud.splitPopup = null;
				break;
			case 'split': {
				const splits = this.tracker.state.splits;
				let pos = splits.lastIndexOf(ev.ticks);
				if (pos < 0) pos = splits.length - 1;
				const label = `${this.hud.stageKind === 'stage' ? 'Stage' : 'Checkpoint'} ${ev.index}`;
				this.hud.splitPopup = { label, ticks: ev.ticks, delta: splitDelta(this.pbSplits(), pos, ev.ticks), at: now };
				break;
			}
			case 'finish': {
				const pb = this.mode === 'online' ? (this.records?.pbTicks ?? null) : (this.soloPb?.ticks ?? null);
				this.hud.splitPopup = { label: 'Finish', ticks: ev.ticks, delta: pb !== null ? ev.ticks - pb : null, at: now };
				if (this.mode === 'solo') this.soloFinish(ev.ticks, ev.splits);
				this.ghostFinish = ev.ticks;
				this.notice(`Returning to start in ${FINISH_RESET_DELAY} s…`);
				break;
			}
			case 'teleport':
				// restart()/back() set the view themselves; tracker-driven teleports do it here.
				if (ev.dest) {
					this.yaw = ev.dest.yaw;
					this.pitch = 0;
				} else if (ev.reason === 'trigger' || ev.reason === 'finish') {
					this.yaw = this.tracker.state.respawn.yaw;
					this.pitch = 0;
				}
				this.teleported = true;
				this.ghostTp = true;
				this.snapPending = true;
				break;
		}
	}

	private soloFinish(ticks: number, splits: number[]): void {
		const time = formatTicks(ticks);
		if (this.hud.unofficial) {
			this.notice(`Finished in ${time} (unofficial: physics cvars changed, not saved).`);
			return;
		}
		const old = this.soloPb?.ticks ?? null;
		if (saveSoloPb(this.store, this.map.id, { ticks, splits: [...splits] })) {
			this.soloPb = { ticks, splits: [...splits] };
			this.applyRecords();
			this.audio.recordChime();
			const d = old !== null ? ` (−${formatTicks(old - ticks)})` : '';
			this.notice(`New solo personal best: ${time}${d}. Solo runs are not sent to the leaderboard.`);
		} else {
			this.notice(`Finished in ${time} (PB ${formatTicks(old ?? ticks)}).`);
		}
	}

	// -----------------------------------------------------------------------
	// Ghosts (docs/gameplay.md#ghosts)
	// -----------------------------------------------------------------------

	/** Map loaded: drop the old ghosts, load the local PB ghost, ask the server for the record. */
	private loadGhosts(): void {
		const seq = ++this.ghostSeq;
		this.ghostRec.cancel();
		this.ghostFinish = null;
		this.recordGhost = null;
		this.localGhost = null;
		this.refreshGhost();
		if (!this.isRace()) return;
		const map = this.map.id;
		void this.ghostStore.get(map).then((g) => {
			if (!g || this.map.id !== map || seq !== this.ghostSeq) return;
			this.localGhost = { kind: 'pb', map, name: 'Your PB', ticks: g.ticks, track: g.track };
			this.refreshGhost();
		});
		this.send({ type: 'getGhost', map });
	}

	private refreshGhost(): void {
		const g = chooseGhost(this.mode === 'online', this.recordGhost, this.localGhost, this.map.id);
		this.ghost.set(g);
		if (g) this.renderer?.ghost.setLabel(ghostLabel(g));
		this.dressGhost();
	}

	private onGhostFrame(f: GhostFrame): void {
		if (this.mode !== 'online' || f.map !== this.map.id || !this.isRace()) return;
		const seq = ++this.ghostFrameSeq;
		const mapSeq = this.ghostSeq;
		if (!f.has) {
			this.recordGhost = null;
			this.refreshGhost();
			return;
		}
		void inflateGhost(f.payload).then((raw) => {
			if (seq !== this.ghostFrameSeq || mapSeq !== this.ghostSeq || this.mode !== 'online' || f.map !== this.map.id) return;
			const track = raw ? unpackGhost(raw) : null;
			if (!track) {
				if (!this.ghostWarned) this.print('Record ghost unavailable (this browser cannot decode it).', 'error');
				this.ghostWarned = true;
				return;
			}
			this.recordGhost = { kind: 'record', map: f.map, name: f.name, ticks: f.ticks, track };
			this.refreshGhost();
			this.print(`Record ghost: ${f.name} ${formatTicks(f.ticks)}`);
		});
	}

	/** After the tracker update: record this tick of the local run (same data the server records). */
	private recordGhostSample(): void {
		const rec = this.ghostRec;
		if (rec.recording && (this.tracker.state.phase === 'running' || this.ghostFinish !== null)) {
			const p = this.player;
			const flags = (p.ducked ? FLAG_DUCKED : 0) | (p.onGround ? FLAG_ON_GROUND : 0) | (this.ghostTp ? FLAG_TELEPORTED : 0);
			rec.push(this.tick, p.origin.x, p.origin.y, p.origin.z, this.pitch, this.yaw, flags);
		}
		this.ghostTp = false;
		if (this.ghostFinish === null) return;
		const ticks = this.ghostFinish;
		this.ghostFinish = null;
		const track = rec.finish(this.tick);
		// Unofficial runs (physics cvars changed) never become the PB ghost.
		if (!track || this.hud.unofficial) return;
		const map = this.map.id;
		void this.ghostStore.saveIfFaster({ map, ticks, track }).then((saved) => {
			if (!saved || this.map.id !== map) return;
			this.localGhost = { kind: 'pb', map, name: 'Your PB', ticks, track };
			this.refreshGhost();
		});
	}

	private updateGhost(): void {
		const r = this.renderer;
		if (!r) return;
		const st = this.tracker.state;
		const on = this.cvars.num('cl_ghost') !== 0 && !this.spec && this.isRace();
		const visible = on && this.ghost.update(st.phase, st.ticks, this.step.alpha);
		const g = this.ghost.pose;
		const onGround = (g.flags & FLAG_ON_GROUND) !== 0;
		r.ghost.setPose(g.x, g.y, g.z, g.pitch, g.yaw, (g.flags & FLAG_DUCKED) !== 0, onGround, visible && !onGround ? this.rampUnder(g) : null, visible);
	}

	// -----------------------------------------------------------------------
	// Simulation
	// -----------------------------------------------------------------------

	/** One tick covering the wall-clock interval [start, end) ms (subtick input inside it). */
	private simTick(now: number, start: number, end: number): void {
		const p = this.player;
		const c = this.cmd;
		// Key changes inside this tick become subtick events; the view angle is the one at tick
		// time (sv_subtick_movement_view_angles 0 on CS2 surf/bhop servers).
		this.sampler.buildTick(start, end, c);
		if (!this.spec) {
			c.pitch = this.pitch;
			c.yaw = this.yaw;
			const zm = this.zm;
			const inf = this.inf;
			const armed = zm ?? inf;
			if (armed) {
				// Zombies / infected: weapon (or claws) move speed; no movement while down.
				Object.assign(this.zmSv, this.sv);
				this.zmSv.sv_maxspeed = armed.maxSpeed(end);
				if (!armed.down) playerMove(this.world, p, c, this.zmSv, TICK_INTERVAL);
			} else if (this.hns?.frozen(end)) {
				// Hide and seek: seekers frozen while the hiders hide, and found hiders for a moment.
				p.velocity.x = p.velocity.y = 0;
				if (p.velocity.z > 0) p.velocity.z = 0;
			} else playerMove(this.world, p, c, this.sv, TICK_INTERVAL);
			if (this.isRace()) {
				const events = this.tracker.update(p, this.tick);
				for (const ev of events) this.onRunEvent(ev, now);
				this.recordGhostSample();
			} else if (zm) zm.tick(end, p.origin, p.origin.z + eyeHeight(p), this.pitch, this.yaw, p.ducked);
			else if (inf) {
				inf.tick(end, p.origin, p.origin.z + eyeHeight(p), this.pitch, this.yaw, p.ducked);
				// No server round (solo / waiting): fall-outs respawn locally.
				if (inf.localFallouts) this.modeTick();
			} else this.modeTick();
			if (p.jumped) this.audio.jump();
			if (p.landedSpeed > 0) this.audio.land(p.landedSpeed);

			this.prevEye.x = this.currEye.x;
			this.prevEye.y = this.currEye.y;
			this.prevEye.z = this.currEye.z;
			this.currEye.x = p.origin.x;
			this.currEye.y = p.origin.y;
			this.currEye.z = p.origin.z + eyeHeight(p);
			if (this.snapPending) {
				this.snapPending = false;
				this.snapEye();
			}
		}
		// State goes out every tick: 64 Hz (docs/architecture.md).
		if (this.mode === 'online') this.sendState();
		this.tick++;
	}

	private sendState(): void {
		if (!this.net) return;
		const p = this.player;
		const s = this.netState;
		const st = this.tracker.state;
		s.tick = this.tick;
		s.x = p.origin.x;
		s.y = p.origin.y;
		s.z = p.origin.z;
		s.vx = p.velocity.x;
		s.vy = p.velocity.y;
		s.vz = p.velocity.z;
		s.pitch = this.pitch;
		s.yaw = this.yaw;
		s.flags = (p.ducked ? FLAG_DUCKED : 0) | (p.onGround ? FLAG_ON_GROUND : 0) | (this.teleported ? FLAG_TELEPORTED : 0);
		if (this.isRace()) {
			s.status = this.spec ? Status.Spectating : phaseStatus(st.phase);
			s.stage = Math.max(0, Math.min(255, st.stage));
			s.runTicks = st.phase === 'running' || st.phase === 'finished' ? st.ticks : 0;
		} else {
			s.status = this.spec
				? Status.Spectating
				: this.zm
					? this.zm.down
						? Status.Down
						: Status.Alive
					: this.inf
						? this.inf.isAlpha
							? Status.Alpha
							: this.inf.isInfected
								? Status.Infected
								: Status.Alive
					: this.hns
						? this.hns.role === 'seeker'
							? Status.Seeker
							: Status.Hider
					: this.tagState?.it.includes(this.selfId)
						? Status.Tagger
						: Status.Runner;
			s.stage = 0;
			s.runTicks = 0;
		}
		this.net.sendBinary(encodeState(s));
		this.teleported = false;
	}

	private applyMouse(dtSec: number): void {
		this.input.consumeMouse(this.mouse);
		if (this.overlayOpen() || !this.input.locked) return;
		if (this.spec && !this.spec.freeFly) return;
		const sens = this.cvars.num('sensitivity');
		this.yaw -= this.mouse.dx * sens * this.cvars.num('m_yaw');
		this.pitch += this.mouse.dy * sens * this.cvars.num('m_pitch');
		if (this.pitch > 89) this.pitch = 89;
		if (this.pitch < -89) this.pitch = -89;
		if (this.yaw > 180 || this.yaw <= -180) this.yaw = ((((this.yaw + 180) % 360) + 360) % 360) - 180;
		if (this.spec?.freeFly) this.moveFreeFly(dtSec);
	}

	private moveFreeFly(dt: number): void {
		const s = this.spec!;
		const h = this.held;
		const f = (h.forward > 0 ? 1 : 0) - (h.back > 0 ? 1 : 0);
		const r = (h.moveright > 0 ? 1 : 0) - (h.moveleft > 0 ? 1 : 0);
		if (!f && !r) return;
		const cy = Math.cos((this.yaw * Math.PI) / 180);
		const sy = Math.sin((this.yaw * Math.PI) / 180);
		const cp = Math.cos((this.pitch * Math.PI) / 180);
		const sp = Math.sin((this.pitch * Math.PI) / 180);
		const speed = FREEFLY_SPEED * (h.duck > 0 ? 0.35 : 1) * dt;
		// Source forward (pitch + = down) and right vectors.
		s.pos.x += (cp * cy * f + sy * r) * speed;
		s.pos.y += (cp * sy * f - cy * r) * speed;
		s.pos.z += -sp * f * speed;
	}

	// -----------------------------------------------------------------------
	// Frame
	// -----------------------------------------------------------------------

	private frame = (now: number): void => {
		if (this.disposed) return;
		this.raf = requestAnimationFrame(this.frame);
		const dt = this.lastFrame < 0 ? 0 : now - this.lastFrame;
		this.lastFrame = now;

		this.applyMouse(Math.min(dt, 100) / 1000);
		const n = this.step.advance(dt);
		const stepMs = this.step.stepMs;
		// Wall-clock end of the first tick run now: the newest tick ends `accMs` before this frame.
		let end = now - this.step.accMs - (n - 1) * stepMs;
		for (let i = 0; i < n; i++, end += stepMs) this.simTick(now, end - stepMs, end);

		if (this.mode === 'solo' && this.rotation && now - this.lastRotationUpdate >= 100) {
			this.lastRotationUpdate = now;
			for (const ev of this.rotation.update(now, 1)) this.onRotationEvent(ev, now);
		}

		const view = this.updateCamera(now);
		this.updateRemotes(now);
		if (this.zm) {
			const v = this.zm.frame(now, !this.spec, Math.hypot(this.player.velocity.x, this.player.velocity.y));
			if (this.hud.zombies !== v) this.hud.zombies = v;
		}
		if (this.inf) {
			// Spectating: the HUD shows the target (tagViewId), local viewmodel and input are off.
			this.inf.setSpectate(!!this.spec, this.spec && !this.spec.freeFly ? this.tagViewId() : null);
			const v = this.inf.frame(now, !this.spec, Math.hypot(this.player.velocity.x, this.player.velocity.y));
			if (this.hud.infected !== v) this.hud.infected = v;
		}
		if (this.hns) {
			const v = this.hns.frame(now, !this.spec, Math.hypot(this.player.velocity.x, this.player.velocity.y));
			if (this.hud.hns !== v) this.hud.hns = v;
		}
		this.updateGhost();
		this.updateHud(now, view);
		this.audio.update(Math.min(dt, 100) / 1000, {
			speed: Math.hypot(this.player.velocity.x, this.player.velocity.y),
			onGround: this.player.onGround,
			surfing: this.player.surfing,
			ducked: this.player.ducked,
			active: !this.spec
		});
		this.renderer?.render(now / 1000);
	};

	/** Positions the camera; returns the sample shown on the HUD (spectated target) or null. */
	private updateCamera(now: number): Sample | null {
		const r = this.renderer;
		if (this.spec) {
			const s = this.spec;
			const target = s.targetId !== null ? this.remotes.get(s.targetId) : undefined;
			if (!s.freeFly && target?.hasSample) {
				const t = target.sample;
				const eye = t.z + ((t.flags & FLAG_DUCKED) !== 0 ? DUCK_VIEW_HEIGHT : VIEW_HEIGHT);
				s.pos.x = t.x;
				s.pos.y = t.y;
				s.pos.z = eye;
				this.pitch = t.pitch;
				this.yaw = t.yaw;
				r?.setView(t.x, t.y, eye, t.pitch, t.yaw);
				return t;
			}
			r?.setView(s.pos.x, s.pos.y, s.pos.z, this.pitch, this.yaw);
			return s.freeFly ? null : (target?.sample ?? null);
		}
		const e = vlerp(this.prevEye, this.currEye, this.step.alpha, this.renderEye);
		r?.setView(e.x, e.y, e.z, this.pitch, this.yaw);
		return null;
	}

	/** Third-person recoil or swing of a remote player. */
	private avatarShot(id: number, weapon: WeaponId): void {
		this.renderer?.players.act(id, weapon === 'knife' || weapon === 'claws' ? 'swing' : 'fire');
	}

	/** Normal of the surf ramp an airborne hull at feet `p` rests on, for the surf stance (visual only). */
	private rampUnder(p: Vec3): Vec3 | null {
		const a = { x: p.x, y: p.y, z: p.z + 2 };
		const n = this.world.trace(a, { x: p.x, y: p.y, z: p.z - 4 }, HULL_MIN, DUCK_HULL_MAX).plane.normal;
		return n.z > 0.1 && n.z < 0.7 ? n : null;
	}

	private updateRemotes(now: number): void {
		if (this.remotes.size === 0) return;
		const renderAt = now - INTERP_DELAY_MS;
		const players = this.renderer?.players;
		const specTarget = this.spec && !this.spec.freeFly ? this.spec.targetId : null;
		const it = this.tagState?.it;
		for (const rm of this.remotes.values()) {
			rm.hasSample = rm.buf.sample(renderAt, rm.sample);
			if (!players) continue;
			if (!players.has(rm.id)) players.upsert(rm.id, rm.name);
			const s = rm.sample;
			const visible =
				rm.hasSample &&
				!rm.spectating &&
				s.status !== Status.Spectating &&
				rm.id !== specTarget &&
				now - rm.buf.lastArrival < 3000 &&
				!(this.zm?.isDown(rm.id) ?? false) &&
				!(this.inf?.isDown(rm.id) ?? false);
			const pose = this.avatarPose;
			pose.x = s.x;
			pose.y = s.y;
			pose.z = s.z;
			pose.vx = s.vx;
			pose.vy = s.vy;
			pose.vz = s.vz;
			pose.yaw = s.yaw;
			pose.pitch = s.pitch;
			pose.ducked = (s.flags & FLAG_DUCKED) !== 0;
			pose.onGround = (s.flags & FLAG_ON_GROUND) !== 0;
			pose.ramp = visible && !pose.onGround ? this.rampUnder(s) : null;
			players.setPose(rm.id, pose, visible);
			players.setHeld(rm.id, this.zm?.heldOf(rm.id) ?? this.inf?.heldOf(rm.id) ?? (this.hns?.roleOf(rm.id) === 'seeker' ? 'knife' : null));
			players.setIt(rm.id, it?.includes(rm.id) ?? false);
			players.setZombie(rm.id, this.zm?.isZombiePlayer(rm.id) ?? false);
			players.setInfected(rm.id, this.inf?.roleOf(rm.id) ?? 'none');
			if (this.hns && visible) {
				// Hide and seek: seekers are marked; tags only up close, in sight, never hider tags to seekers.
				const role = this.hns.roleOf(rm.id);
				players.setSeeker(rm.id, role === 'seeker');
				const eye = this.spec ? this.spec.pos : this.currEye;
				const head = { x: s.x, y: s.y, z: s.z + 64 };
				const dist = Math.hypot(head.x - eye.x, head.y - eye.y, head.z - eye.z);
				const los = dist <= HNS_NAMETAG_RANGE && this.world.trace(eye, head, ZERO_VEC, ZERO_VEC).fraction >= 1;
				const viewer = this.spec ? null : this.hns.roleOf(this.selfId);
				players.setTagVisible(rm.id, hnsTagVisible(viewer, role, dist, los));
			} else if (!this.hns) {
				players.setSeeker(rm.id, false);
				players.setTagVisible(rm.id, true);
			}
		}
	}

	private updateHud(now: number, target: Sample | null): void {
		const h = this.hud;
		const p = this.player;
		// Movement readouts: spectated target or local player.
		const vx = target ? target.vx : p.velocity.x;
		const vy = target ? target.vy : p.velocity.y;
		const speed = Math.round(Math.hypot(vx, vy));
		if (h.speed !== speed) h.speed = speed;
		if (now - this.trendAt >= 100) {
			const d = speed - this.trendSpeed;
			const trend = d > 1 ? 'up' : d < -1 ? 'down' : 'flat';
			if (h.speedTrend !== trend) h.speedTrend = trend;
			this.trendSpeed = speed;
			this.trendAt = now;
		}

		if (target) {
			const phase = statusPhase(target.status);
			if (h.runPhase !== phase) h.runPhase = phase;
			if (h.runTicks !== target.runTicks) h.runTicks = target.runTicks;
			if (h.stage !== target.stage) h.stage = target.stage;
		} else {
			const st = this.tracker.state;
			if (h.runPhase !== st.phase) h.runPhase = st.phase;
			const ticks = st.phase === 'running' || st.phase === 'finished' ? st.ticks : 0;
			if (h.runTicks !== ticks) h.runTicks = ticks;
			if (h.stage !== st.stage) h.stage = st.stage;
		}

		const k = h.keys;
		const hd = this.held;
		if (k.w !== hd.forward > 0) k.w = hd.forward > 0;
		if (k.s !== hd.back > 0) k.s = hd.back > 0;
		if (k.a !== hd.moveleft > 0) k.a = hd.moveleft > 0;
		if (k.d !== hd.moveright > 0) k.d = hd.moveright > 0;
		if (k.jump !== hd.jump > 0) k.jump = hd.jump > 0;
		if (k.duck !== hd.duck > 0) k.duck = hd.duck > 0;

		this.fpsFrames++;
		if (now - this.fpsSince >= 500) {
			h.fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsSince));
			this.fpsFrames = 0;
			this.fpsSince = now;
		}

		if (this.cvars.num('cl_showpos') !== 0) {
			const pos = h.pos;
			const src = target ?? null;
			pos.x = Math.round((src ? src.x : p.origin.x) * 100) / 100;
			pos.y = Math.round((src ? src.y : p.origin.y) * 100) / 100;
			pos.z = Math.round((src ? src.z : p.origin.z) * 100) / 100;
			pos.pitch = Math.round(this.pitch * 100) / 100;
			pos.yaw = Math.round(this.yaw * 100) / 100;
			pos.vx = Math.round(vx * 100) / 100;
			pos.vy = Math.round(vy * 100) / 100;
			pos.vz = Math.round((src ? src.vz : p.velocity.z) * 100) / 100;
		}

		let left = 0;
		if (this.mode === 'online') left = Math.max(0, (this.mapEndsAt - now) / 1000);
		else if (this.rotation) left = this.rotation.timeLeft(now);
		const secs = Math.ceil(left);
		if (h.mapTimeLeft !== secs) h.mapTimeLeft = secs;

		const vote = h.vote;
		if (vote?.result && now > vote.result.changeAt + 1500) h.vote = null;
		const req = h.rtvRequest;
		if (req?.result && now > req.result.at + 2500) h.rtvRequest = null;
		else if (req && req.canVote === !!this.spec) h.rtvRequest = { ...req, canVote: !this.spec };
		if (h.rtvCooldown && now >= h.rtvCooldown.until) h.rtvCooldown = null;

		if (this.mode === 'solo' && now - this.lastSoloBoard > 500) this.refreshSoloBoard(now);
		const selfId = this.mode === 'online' ? this.selfId : SOLO_ROW_ID;
		if (h.selfId !== selfId) h.selfId = selfId;
		const selfName = this.myName();
		if (h.selfName !== selfName) h.selfName = selfName;
		if (!this.isRace()) this.refreshTagView(now);

		if (this.spec) {
			const name = this.spec.targetId !== null ? (this.remotes.get(this.spec.targetId)?.name ?? '') : '';
			const cur = h.spectating;
			if (!cur || cur.targetName !== name || cur.freeFly !== this.spec.freeFly)
				h.spectating = { targetName: name, freeFly: this.spec.freeFly };
		} else if (h.spectating) h.spectating = null;
	}

	private refreshSoloBoard(now: number): void {
		this.lastSoloBoard = now;
		const st = this.tracker.state;
		const race = this.isRace();
		const row: ScoreRow = {
			id: SOLO_ROW_ID,
			name: this.myName(),
			rank: null,
			pbTicks: race ? (this.soloPb?.ticks ?? null) : null,
			status: race ? phaseStatus(st.phase) : Status.Runner,
			stage: race ? st.stage : 0,
			ping: 0,
			spectating: false,
			...(race ? {} : { score: 0, it: false })
		};
		if (this.hns) Object.assign(row, { status: Status.Hider, kills: 0, score: 0, it: undefined });
		if (this.zm) {
			const z = this.zm.soloRow();
			Object.assign(row, { status: z.alive ? Status.Alive : Status.Down, kills: z.kills, deaths: z.deaths, score: undefined, it: undefined });
		}
		if (this.inf) {
			const z = this.inf.soloRow();
			Object.assign(row, { status: Status.Alive, kills: z.kills, deaths: z.deaths, score: z.score, it: undefined });
		}
		this.hud.scoreboard = [row];
		const zm = this.zm?.soloState();
		if (zm) this.hud.modeState = { mode: 'zombies', ...zm };
	}

	// -----------------------------------------------------------------------
	// Tag (docs/modes.md#tag)
	// -----------------------------------------------------------------------

	private remoteName(id: number): string {
		if (id === this.selfId) return this.myName();
		return this.remotes.get(id)?.name ?? `Player ${id}`;
	}

	/** Player whose role the tag HUD shows: the spectated target, else self. */
	private tagViewId(): number {
		return this.spec && !this.spec.freeFly && this.spec.targetId !== null ? this.spec.targetId : this.selfId;
	}

	/** Rebuild hud.tag when anything it shows changed (cheap key compare per frame). */
	private refreshTagView(now: number): void {
		const h = this.hud;
		if (this.gameMode.family !== 'tag') {
			if (h.tag) h.tag = null;
			this.tagViewKey = '';
			return;
		}
		if (this.tagFlash && now - this.tagFlash.at > 2500) this.tagFlash = null;
		const t = this.tagState;
		const id = this.tagViewId();
		const key = `${t ? `${t.phase}|${t.round}|${t.it.join(',')}|${t.immune.join(',')}|${this.tagStateAt}` : 'solo'}|${id}|${this.tagFlash?.at ?? 0}|${this.remotes.size}`;
		if (key === this.tagViewKey && h.tag) return;
		this.tagViewKey = key;
		h.tag = {
			phase: t ? t.phase : 'solo',
			round: t?.round ?? 0,
			endsAt: t && t.phase !== 'waiting' ? this.tagStateAt + t.timeLeft * 1000 : 0,
			isIt: t?.it.includes(id) ?? false,
			immune: t?.immune.includes(id) ?? false,
			itNames: (t?.it ?? []).map((i) => this.remoteName(i)),
			score: t?.scores.find((s) => s.id === id)?.score ?? 0,
			flash: this.tagFlash
		};
	}

	private onModeState(m: TagModeState, now: number): void {
		if (this.isRace() || m.mode !== 'tag') return;
		const prev = this.tagState;
		const wasIt = prev?.it.includes(this.selfId) ?? false;
		const isIt = m.it.includes(this.selfId);
		this.tagState = m;
		this.tagStateAt = now;
		if (prev && m.phase === 'playing' && prev.phase !== 'playing') {
			this.tagFlash = { text: isIt ? "You're IT!" : 'Run!', at: now };
			this.audio.zoneBeep();
		} else if (isIt && !wasIt && m.phase === 'playing' && !this.tagFlash) {
			this.tagFlash = { text: "You're IT!", at: now };
		}
		this.refreshTagView(now);
	}

	private onTagged(by: number, target: number, now: number): void {
		if (target === this.selfId) this.tagFlash = { text: `${this.remoteName(by)} tagged you. You're IT!`, at: now };
		else if (by === this.selfId) this.tagFlash = { text: `You tagged ${this.remoteName(target)}!`, at: now };
		else return;
		this.audio.zoneBeep();
		this.refreshTagView(now);
	}

	// -----------------------------------------------------------------------
	// Votes and rotation
	// -----------------------------------------------------------------------

	/** Console `vote N` (number keys are routed in onKey via routeVoteKey). */
	vote(option: number): void {
		const s = this.voteKeyState();
		if (s.mapVoteOptions === 0 && s.rtvRequestOpen && (option === 1 || option === 2)) return this.rtvVote(option === 1);
		// Zombies: 1-4 pick a weapon unless a map vote is open.
		if (this.zm && this.zm.slot(option, performance.now())) return;
		// Infected: 1 primary, 2 pistol, 3 knife, 4 M.O.A.B. unless a map vote is open.
		if (this.inf && this.inf.slot(option, performance.now())) return;
		this.castMapVote(option);
	}

	private voteKeyState(): { mapVoteOptions: number; rtvRequestOpen: boolean } {
		const v = this.hud.vote;
		const r = this.hud.rtvRequest;
		return { mapVoteOptions: v && !v.result ? v.labels.length : 0, rtvRequestOpen: !!r && !r.result };
	}

	private castMapVote(option: number): void {
		const v = this.hud.vote;
		if (!v || v.result || option < 1 || option > v.labels.length) return;
		if (this.mode === 'online') this.send({ type: 'vote', option });
		else if (this.rotation) {
			const now = performance.now();
			for (const ev of this.rotation.castVote(SOLO_VOTER, option, now)) this.onRotationEvent(ev, now);
		}
		if (this.hud.vote && !this.hud.vote.result) this.hud.vote = { ...this.hud.vote, myVote: option };
	}

	/** `!rtv` / console `rtv`: RTV request without a nominated map. */
	rtv(): void {
		this.requestRtv(null);
	}

	/** Start an RTV request (optionally nominating a map), or agree to the open one. */
	private requestRtv(mapId: string | null): void {
		if (this.mode === 'online') {
			this.send(mapId === null ? { type: 'rtvRequest' } : { type: 'rtvRequest', mapId });
			return;
		}
		if (!this.rotation) return this.notice('Rock the vote is not available on this map.');
		const now = performance.now();
		const res = this.rotation.requestRtv(SOLO_VOTER, 1, now, mapId);
		if (Array.isArray(res)) for (const ev of res) this.onRotationEvent(ev, now);
		else this.notice(res.error);
	}

	/** Yes/no on the open RTV request (keys 1 / 2, or the modal buttons). */
	rtvVote(yes: boolean): void {
		const r = this.hud.rtvRequest;
		if (!r || r.result) return;
		if (!r.canVote) return this.notice('Spectators cannot vote.');
		const choice = yes ? 'yes' : 'no';
		if (r.myChoice === choice) return;
		this.hud.rtvRequest = { ...r, myChoice: choice };
		if (this.mode === 'online') this.send({ type: 'rtvVote', yes });
		else if (this.rotation) {
			const now = performance.now();
			const res = this.rotation.rtvVote(SOLO_VOTER, yes, 1, now);
			if (Array.isArray(res)) for (const ev of res) this.onRotationEvent(ev, now);
		}
	}

	private onRtvRequest(
		m: { started: boolean; initiator: string; mapId: string | null; duration: number; yes: number; no: number; needed: number },
		mine: boolean,
		now: number
	): void {
		const prev = this.hud.rtvRequest;
		if (m.started) this.audio.voteChime();
		this.hud.rtvRequest = {
			initiator: m.initiator,
			mapLabel: m.mapId ? mapLabel(m.mapId) : null,
			yes: m.yes,
			no: m.no,
			needed: m.needed,
			endsAt: now + m.duration * 1000,
			duration: RTV_REQUEST_DURATION,
			myChoice: m.started ? (mine ? 'yes' : null) : (prev?.myChoice ?? null),
			canVote: !this.spec,
			result: null
		};
	}

	private onRtvRequestEnd(passed: boolean, cooldown: number, now: number): void {
		const r = this.hud.rtvRequest;
		if (r) this.hud.rtvRequest = { ...r, result: { passed, at: now } };
		if (!passed && cooldown > 0) this.hud.rtvCooldown = { until: now + cooldown * 1000, reason: 'declined' };
	}

	private onVoteStart(options: VoteOption[], duration: number, rtv: boolean, now: number): void {
		// The vote panel replaces a passed (or cancelled) RTV request.
		this.hud.rtvRequest = null;
		this.voteOptions = options;
		const labels = options.map((o) => voteLabel(o));
		this.hud.vote = {
			labels,
			counts: options.map(() => 0),
			endsAt: now + duration * 1000,
			duration,
			myVote: null,
			rtv,
			result: null
		};
		this.audio.voteChime();
		// Online, the server announces votes in chat itself.
		if (this.mode === 'solo') this.notice(`${rtv ? 'Rock the vote! ' : ''}Vote for the next map: press 1-${labels.length}.`);
	}

	private onVoteUpdate(counts: number[]): void {
		if (this.hud.vote) this.hud.vote = { ...this.hud.vote, counts: [...counts] };
	}

	private onVoteEnd(winner: VoteOption, countdown: number, now: number): void {
		const label = voteLabel(winner);
		const v = this.hud.vote;
		const base = v ?? {
			labels: this.voteOptions.map((o) => voteLabel(o)),
			counts: this.voteOptions.map(() => 0),
			endsAt: now,
			duration: 0,
			myVote: null,
			rtv: false
		};
		this.hud.vote = { ...base, result: { label, changeAt: now + countdown * 1000 } };
		if (this.mode === 'solo')
			this.notice(winner.kind === 'extend' ? 'Vote result: map extended.' : `Vote result: ${label}. Changing in ${countdown} s.`);
	}

	private onRotationEvent(ev: RotationEvent, now: number): void {
		switch (ev.type) {
			case 'voteStart':
				return this.onVoteStart(ev.options, ev.duration, ev.rtv, now);
			case 'voteUpdate':
				return this.onVoteUpdate(ev.counts);
			case 'voteEnd':
				return this.onVoteEnd(ev.winner, ev.countdown, now);
			case 'extended':
				this.notice(`Map extended: ${Math.ceil(ev.timeLeft / 60)} min left.`);
				return;
			case 'mapChange':
				this.hud.vote = null;
				this.hud.rtvRequest = null;
				this.loadMap(ev.map);
				return;
			case 'rtvRequest':
				return this.onRtvRequest(ev, ev.initiator === SOLO_VOTER, now);
			case 'rtvRequestEnd':
				return this.onRtvRequestEnd(ev.passed, ev.cooldown, now);
		}
	}

	// -----------------------------------------------------------------------
	// Spectating (online only)
	// -----------------------------------------------------------------------

	spectate(query: string): void {
		if (this.mode !== 'online') {
			this.notice('Spectating is only available online.');
			return;
		}
		const q = query.trim();
		if (this.spec && !q) return this.leaveSpectate(true);
		const targets = specTargets(this.remotes.values(), this.selfId);
		const id = q ? findTargetByName(targets, q) : cycleTarget(targets, this.spec?.targetId ?? null, 1);
		if (id === null) {
			this.notice(q ? `No player matching "${q}".` : 'No one to spectate.');
			return;
		}
		this.setSpecTarget(id);
	}

	private setSpecTarget(id: number): void {
		if (!this.spec) {
			this.releaseAll();
			this.spec = { targetId: id, freeFly: false, pos: { ...this.currEye } };
		} else {
			this.spec.targetId = id;
			this.spec.freeFly = false;
		}
		this.send({ type: 'spectate', targetId: id });
	}

	private cycleSpectate(dir: 1 | -1): void {
		if (!this.spec || this.spec.freeFly) return;
		const id = cycleTarget(specTargets(this.remotes.values(), this.selfId), this.spec.targetId, dir);
		if (id !== null && id !== this.spec.targetId) this.setSpecTarget(id);
	}

	private toggleFreeFly(): void {
		if (!this.spec) return;
		this.spec.freeFly = !this.spec.freeFly;
		if (!this.spec.freeFly) {
			const targets = specTargets(this.remotes.values(), this.selfId);
			if (this.spec.targetId === null || !targets.some((t) => t.id === this.spec!.targetId)) {
				const id = cycleTarget(targets, null, 1);
				if (id === null) {
					this.spec.freeFly = true;
					return;
				}
				this.setSpecTarget(id);
			}
		}
	}

	private leaveSpectate(notifyServer: boolean): void {
		if (!this.spec) return;
		this.spec = null;
		if (notifyServer) this.send({ type: 'spectate', targetId: null });
		this.releaseAll();
		if (!this.isRace()) return this.respawnRandom();
		this.tracker.restart(this.player);
		this.yaw = this.map.spawn.yaw;
		this.pitch = 0;
		this.afterTeleport();
	}

	// -----------------------------------------------------------------------
	// Networking
	// -----------------------------------------------------------------------

	private send(msg: ClientMessage): void {
		if (this.mode === 'online') this.net?.send(msg);
	}

	connect(url: string): void {
		if (!this.conn.connect(url)) this.print(`connect: invalid server address "${url}"`, 'error');
		else this.print(`Connecting to ${url}...`);
	}

	disconnect(): void {
		this.conn.disconnect();
		this.print('Disconnected. Playing solo until "connect <url>".');
	}

	status(): string[] {
		return [
			`map: ${this.map.id} (${mapTitle(this.map)})`,
			`mode: ${this.mode}${this.mode === 'online' ? ` (${this.conn.client?.url ?? ''}, id ${this.selfId})` : ''}`,
			`players: ${this.hud.playerCount}`,
			`tick: ${this.tick}`
		];
	}

	private onOpen(client: NetClient): void {
		this.helloToken = this.session?.token ?? null;
		client.send({
			type: 'hello',
			playerId: this.playerId,
			name: this.cvars.str('name'),
			version: PROTOCOL_VERSION,
			...(this.helloToken ? { token: this.helloToken } : {})
		});
	}

	private remote(id: number, name?: string): Remote {
		let r = this.remotes.get(id);
		if (!r) {
			r = { id, name: name ?? `Player ${id}`, spectating: false, buf: new SnapshotBuffer(), sample: emptySample(), hasSample: false };
			this.remotes.set(id, r);
		} else if (name !== undefined && r.name !== name) {
			r.name = name;
			this.renderer?.players.upsert(id, name);
		}
		return r;
	}

	private dropRemote(id: number): void {
		this.remotes.delete(id);
		this.renderer?.players.remove(id);
		if (this.spec?.targetId === id) {
			const next = cycleTarget(specTargets(this.remotes.values(), this.selfId), null, 1);
			if (next !== null) this.setSpecTarget(next);
			else {
				this.spec.targetId = null;
				this.spec.freeFly = true;
			}
		}
	}

	private updatePlayerCount(): void {
		this.hud.playerCount = this.mode === 'online' ? this.remotes.size + 1 : 1;
		this.hud.canChangeMap = this.mode === 'solo' || this.aloneOnline();
	}

	private onMessage(m: ServerMessage): void {
		const now = performance.now();
		if (m.type === 'welcome') return this.onWelcome(m, now);
		if (m.type === 'full') {
			this.conn.holdOff(FULL_HOLDOFF_MS);
			if (!this.fullNotified) {
				this.notice('Server full. Playing solo; will retry later.');
				this.print('Server full.');
			}
			this.fullNotified = true;
			this.conn.client?.close();
			return;
		}
		if (m.type === 'banned') {
			// Followed by close code 4009 (onClosed stops reconnecting).
			this.bannedReason = m.reason ?? '';
			this.bannedSecs = typeof m.seconds === 'number' && m.seconds > 0 ? m.seconds : null;
			return;
		}
		if (this.mode !== 'online') return;
		switch (m.type) {
			case 'join':
				if (m.player.id !== this.selfId) {
					this.remote(m.player.id, m.player.name).spectating = m.player.spectating;
					this.renderer?.players.setLoadout(m.player.id, sanitizeLoadout(m.player.loadout));
					this.updatePlayerCount();
					this.dressGhost();
				}
				break;
			case 'leave':
				this.dropRemote(m.id);
				this.updatePlayerCount();
				this.dressGhost();
				break;
			case 'rename':
				if (m.id !== this.selfId) this.remote(m.id, m.name);
				this.dressGhost();
				break;
			case 'spectating':
				if (m.id === this.selfId) {
					if (!m.spectating && this.spec) this.leaveSpectate(false);
				} else if (this.remotes.has(m.id)) {
					this.remotes.get(m.id)!.spectating = m.spectating;
					if (m.spectating && this.spec?.targetId === m.id) this.cycleSpectate(1);
				}
				break;
			case 'chat':
				this.pushChat(m.from, m.text, m.system ?? m.from === null, m.admin === true);
				break;
			case 'maps':
				this.applyEnabledMaps(new Set(m.enabled));
				break;
			case 'adminState': {
				const { type: _t, ...state } = m;
				this.hud.adminState = state;
				break;
			}
			case 'adminResult':
				if (!m.ok || m.message) {
					this.hud.adminNotice = { ok: m.ok, text: m.ok ? (m.message ?? 'Done.') : (m.error ?? 'Failed.'), at: performance.now() };
				}
				break;
			case 'runResult': {
				this.records = m.records;
				this.applyRecords();
				if (m.pb || m.record) this.audio.recordChime();
				const extra = m.record ? ' New map record!' : m.pb ? ' New personal best!' : '';
				this.notice(`Finished in ${formatTicks(m.ticks)} (rank #${m.rank}).${extra}`);
				break;
			}
			case 'runRejected':
				this.notice(`Run not saved: ${m.reason}`);
				break;
			case 'records':
				this.records = mergeRecordsPush(this.records, m, this.mode, this.map.id);
				this.applyRecords();
				break;
			case 'voteStart':
				this.onVoteStart(m.options, m.duration, m.rtv, now);
				break;
			case 'voteUpdate':
				this.onVoteUpdate(m.counts);
				break;
			case 'voteEnd':
				this.onVoteEnd(m.winner, m.countdown, now);
				break;
			case 'rtvRequest':
				this.onRtvRequest(m, m.initiatorId === this.selfId, now);
				break;
			case 'rtvRequestEnd':
				this.onRtvRequestEnd(m.passed, m.cooldown, now);
				break;
			case 'rtvCooldown':
				this.hud.rtvCooldown = { until: now + m.seconds * 1000, reason: m.reason };
				break;
			case 'mapChange':
				if (this.spec) this.leaveSpectate(true);
				this.hud.vote = null;
				this.hud.rtvRequest = null;
				this.hud.rtvCooldown = null;
				this.loadMap(m.map, m.cvars, m.records);
				this.mapEndsAt = now + m.mapTimeLeft * 1000;
				break;
			case 'timeLeft':
				this.mapEndsAt = now + m.mapTimeLeft * 1000;
				break;
			case 'scoreboard':
				this.hud.scoreboard = m.rows;
				this.hud.richest = Array.isArray(m.richest) ? m.richest : [];
				break;
			case 'modeState':
				if (m.mode === this.gameMode.id) this.hud.modeState = m;
				if (m.mode === 'zombies') this.zm?.onModeState(m, now);
				else if (m.mode === 'infected') this.inf?.onModeState(m, now);
				else if (m.mode === 'hns') this.hns?.onModeState(m, now);
				else this.onModeState(m, now);
				break;
			case 'zm':
				this.zm?.onEvent(m.ev, now);
				if (m.ev.e === 'shot') this.avatarShot(m.ev.by, m.ev.weapon);
				break;
			case 'inf':
				this.inf?.onEvent(m.ev, now);
				if (m.ev.e === 'shot') this.avatarShot(m.ev.by, m.ev.weapon);
				break;
			case 'hns':
				this.hns?.onEvent(m.ev, now);
				if (m.ev.e === 'swing') this.avatarShot(m.ev.by, 'knife');
				break;
			case 'tagged':
				this.onTagged(m.by, m.target, now);
				break;
			case 'ping':
				this.net?.send({ type: 'pong', t: m.t });
				break;
			case 'auth':
				this.onAuth(m);
				if (m.ok && m.username === null) this.hud.coins = null;
				break;
			case 'coins':
				this.hud.coins = { total: m.total, balance: m.balance, recent: m.recent };
				break;
			case 'award':
				this.hud.coins = applyAward(this.hud.coins, m);
				this.hud.awardPopups = pushPopup(this.hud.awardPopups, awardPopup(m, now));
				break;
			case 'coinsNotice':
				this.hud.awardPopups = pushPopup(this.hud.awardPopups, noticePopup(m, now));
				break;
			case 'cosmetics':
				// The own items come with `shop`.
				if (typeof m.id === 'number' && m.id !== this.selfId) this.renderer?.players.setLoadout(m.id, sanitizeLoadout(m.loadout));
				this.dressGhost();
				break;
			case 'ghostLook':
				this.ghostLook = { map: m.map, loadout: sanitizeLoadout(m.loadout) };
				this.dressGhost();
				break;
			case 'shop':
				this.hud.shop = { busy: this.hud.shop?.busy ?? false, notice: this.hud.shop?.notice ?? null, opened: this.hud.shop?.opened ?? null, ...parseShop(m) };
				this.dressGhost();
				break;
			case 'shopResult':
				clearTimeout(this.shopTimer);
				if (this.hud.shop) this.hud.shop = { ...this.hud.shop, busy: false, notice: shopNotice(m) };
				break;
			case 'boxResult': {
				clearTimeout(this.shopTimer);
				if (m.ok) {
					this.boxUnseen = true;
					if (!this.boxScreen) this.boxRevealed();
				}
				const s = this.hud.shop;
				if (!s) break;
				if (m.ok) this.hud.shop = { ...s, busy: false, notice: null, opened: { n: (s.opened?.n ?? 0) + 1, item: m.item, duplicate: m.duplicate === true, refund: Number(m.refund) || 0 } };
				else this.hud.shop = { ...s, busy: false, notice: { ok: false, text: m.error } };
				break;
			}
			case 'boxNews': {
				const n = parseBoxNews(m, now);
				// The opener has the loot box screen in front of them.
				if (n && !(m.id === this.selfId && this.boxScreen)) this.hud.boxNews = pushBoxNews(this.hud.boxNews, n);
				break;
			}
			case 'casino':
				this.onCasino(m, now);
				break;
			case 'crashStart':
				clearTimeout(this.casinoTimer);
				if (this.hud.casino) this.hud.casino = crashStarted(this.hud.casino, m, now);
				break;
			case 'casinoResult':
				this.onCasinoResult(m, now);
				break;
			case 'multiplier':
				this.hud.multiplier = { mult: m.mult, active: m.active, need: m.need };
				break;
		}
	}

	private onWelcome(m: Extract<ServerMessage, { type: 'welcome' }>, now: number): void {
		const client = this.conn.client;
		if (!client) return;
		this.net = client;
		this.mode = 'online';
		// The loot box pictures get ready now, not in the middle of a run.
		if (this.cvars.num('cl_boxnews') !== 0) warmItemPictures(m.selfId);
		this.fullNotified = false;
		this.selfId = m.selfId;
		this.rotation = null;
		this.spec = null;
		this.hud.vote = null;
		this.hud.rtvRequest = null;
		this.hud.rtvCooldown = null;
		this.renderer?.players.clear();
		this.remotes.clear();
		this.hud.ban = null;
		this.hud.coins = null;
		this.hud.multiplier = null;
		this.hud.shop = null;
		this.hud.casino = null;
		this.boxUnseen = false;
		for (const p of m.players) {
			if (p.id === m.selfId) continue;
			this.remote(p.id, p.name).spectating = p.spectating;
			this.renderer?.players.setLoadout(p.id, sanitizeLoadout(p.loadout));
		}
		this.applyWelcomeAccount(m.account);
		this.loadMap(m.map, m.cvars, m.records);
		this.mapEndsAt = now + m.mapTimeLeft * 1000;
		this.hud.online = true;
		this.hud.connecting = false;
		this.updatePlayerCount();
		this.notice(`Connected. Playing ${mapTitle(this.map)} online.`);
		this.print(`Connected to ${client.url}`);
	}

	private onSnapshot(entries: SnapshotEntry[], arrival: number): void {
		if (this.mode !== 'online') return;
		for (const e of entries) {
			if (e.id === this.selfId) continue;
			this.remote(e.id).buf.push(e, arrival);
		}
	}

	private onClosed(wasOpen: boolean, code = 0): void {
		this.hud.connecting = false;
		this.hud.authBusy = false;
		if (code === 4009 || this.bannedReason !== null) {
			// Banned (docs/architecture.md#admin-and-bans): no reconnect until reload, or until a short ban lifts.
			const secs = this.bannedSecs;
			const reason = this.bannedReason || null;
			if (secs === null) this.conn.disconnect();
			else this.conn.holdOff(secs * 1000 + BAN_RECONNECT_MS);
			const why = reason ? ` Reason: ${reason.replace(/[.!?]?$/, '.')}` : '';
			const how = secs === null ? 'You are banned from this server.' : `You are banned from this server for ${countdown(secs)}.`;
			this.notice(`${how}${why} Playing solo.`);
			this.print(`${how}${why}`, 'error');
			const again = this.hud.ban !== null;
			this.hud.ban = {
				reason,
				until: secs === null ? null : performance.now() + secs * 1000,
				minimized: this.hud.ban?.minimized ?? false
			};
			if (!again) {
				this.releaseAll();
				this.hud.chatOpen = false;
				this.hud.settingsOpen = false;
				this.hud.authPanelOpen = false;
				this.input.exitLock();
			}
			this.bannedSecs = null;
			this.bannedReason = null;
			code = 4009;
		}
		if (code === 4002) {
			// Same player id or account connected from another tab/device: stop here instead of
			// reconnecting (which would kick the other one back).
			this.conn.disconnect();
			this.notice('You connected from another tab or device. Playing solo here; reload the page to reconnect.');
		}
		if (code === CLOSE_IP_LIMIT) {
			// Retrying would fail until someone on this network leaves.
			this.conn.disconnect();
			this.notice('Too many players are connected from your network (3 at most). Playing solo; reload the page to try again.');
		}
		if (this.mode !== 'online') {
			if (wasOpen) this.net = null;
			return;
		}
		this.mode = 'solo';
		this.net = null;
		this.selfId = -1;
		this.spec = null;
		this.hud.online = false;
		this.hud.vote = null;
		this.hud.rtvRequest = null;
		this.hud.rtvCooldown = null;
		this.hud.scoreboard = [];
		this.hud.richest = [];
		this.hud.modeState = null;
		this.remotes.clear();
		this.renderer?.players.clear();
		this.records = null;
		this.hud.adminState = null;
		this.hud.coins = null;
		this.hud.shop = null;
		this.hud.casino = null;
		this.hud.multiplier = null;
		this.applyEnabledMaps(null);
		this.tagState = null;
		this.tagFlash = null;
		this.refreshTagView(performance.now());
		this.resetZombies();
		this.resetInfected();
		this.resetHns();
		this.soloPb = loadSoloPb(this.store, this.map.id);
		this.applyRecords();
		this.recordGhost = null;
		this.refreshGhost();
		this.startSoloRotation();
		this.updatePlayerCount();
		if (code !== 4002 && code !== 4009 && code !== CLOSE_IP_LIMIT) this.notice('Disconnected from server. Playing solo; reconnecting automatically.');
	}

	// -----------------------------------------------------------------------

	destroy(): void {
		if (this.disposed) return;
		this.disposed = true;
		cancelAnimationFrame(this.raf);
		clearTimeout(this.shopTimer);
		clearTimeout(this.casinoTimer);
		this.offCvars();
		this.zm?.dispose();
		this.zm = null;
		this.inf?.dispose();
		this.inf = null;
		this.conn.dispose();
		this.input.dispose();
		this.fullscreen.dispose();
		this.audio.dispose();
		this.renderer?.dispose();
		disposeItemPictures();
		this.renderer = null;
	}
}
