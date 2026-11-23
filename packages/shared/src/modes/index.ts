/**
 * Gamemode registry (docs/modes.md). A map's `kind` names its gamemode; the
 * mode decides the default physics profile, whether the race timer and zones
 * run (race family: surf, bhop) or the mode has its own rules (tag), and
 * which scoreboard columns are shown.
 *
 * Adding a mode: extend `GameModeId`, add a `GAME_MODES` entry, then plug in a
 * server rules module (apps/server/src/modes) and client HUD (docs/modes.md).
 */
import { BHOP_CVARS, SURF_CVARS, type Cvars } from '../cvars.ts';
import type { MapDef } from '../maps/types.ts';

export type GameModeId = 'surf' | 'bhop' | 'tag' | 'zombies' | 'infected' | 'hns';

/**
 * Rule family. 'race': RunTracker timer, start/end/stage/checkpoint zones,
 * run validation and leaderboards. Any other family has its own rules module.
 */
export type ModeFamily = 'race' | 'tag' | 'coop' | 'infected' | 'hns';

/** Scoreboard columns besides the name (shown in this order). */
export type ScoreColumn = 'rank' | 'pb' | 'score' | 'kills' | 'deaths' | 'status' | 'ping' | 'role' | 'finds' | 'survived';

export interface GameModeDef {
	id: GameModeId;
	label: string;
	/** One-line description for help text and docs. */
	description: string;
	family: ModeFamily;
	/** Default physics profile; a map's own `cvars` override it. */
	cvars: Readonly<Cvars>;
	/** Players needed before the mode's rules run (race: 1). */
	minPlayers: number;
	scoreColumns: readonly ScoreColumn[];
}

/**
 * Tag physics: modern (CS2) jump like bhop, but surf-level air acceleration so
 * chases stay readable and the small surf sections still work.
 */
export const TAG_CVARS: Readonly<Cvars> = Object.freeze({
	...BHOP_CVARS,
	sv_airaccelerate: 150
});

/**
 * Zombies physics: surf ground movement (CS2 accelerate/friction), autobhop on
 * but CS2's bunnyhop cap (sv_enablebunnyhopping 0: 286 u/s on each jump) and
 * a moderate air acceleration, so it plays as run-and-gun. Players' max speed
 * comes from the held weapon (docs/modes.md#zombies).
 */
export const ZOMBIES_CVARS: Readonly<Cvars> = Object.freeze({
	...SURF_CVARS,
	sv_airaccelerate: 30,
	sv_enablebunnyhopping: 0
});

/**
 * Infected physics: same run-and-gun profile as zombies (capped bhop, lower
 * air acceleration, movement speeds driven by the held weapon / claws).
 */
export const INFECTED_CVARS: Readonly<Cvars> = ZOMBIES_CVARS;

/**
 * Hide and seek physics (docs/modes.md#hide-and-seek): CS2 ground movement
 * (surf profile: accelerate 6.5, friction 5.2, 250 run speed), autobhop on,
 * CS:GO-community-HNS air acceleration 100, and a hard 300 u/s horizontal
 * cap while airborne so bhopping helps but never outruns the map.
 */
export const HNS_CVARS: Readonly<Cvars> = Object.freeze({
	...SURF_CVARS,
	sv_airaccelerate: 100,
	sv_maxspeed: 250,
	sv_air_speed_cap: 300
});

const RACE_COLUMNS: readonly ScoreColumn[] = ['rank', 'pb', 'status', 'ping'];

export const GAME_MODES: Readonly<Record<GameModeId, GameModeDef>> = Object.freeze({
	surf: {
		id: 'surf',
		label: 'Surf',
		description: 'Race down surf ramps against the clock.',
		family: 'race',
		cvars: SURF_CVARS,
		minPlayers: 1,
		scoreColumns: RACE_COLUMNS
	},
	bhop: {
		id: 'bhop',
		label: 'Bhop',
		description: 'Race over bunnyhop blocks against the clock.',
		family: 'race',
		cvars: BHOP_CVARS,
		minPlayers: 1,
		scoreColumns: RACE_COLUMNS
	},
	tag: {
		id: 'tag',
		label: 'Tag',
		description: 'Whoever is IT tags someone else; score is time spent not being IT.',
		family: 'tag',
		cvars: TAG_CVARS,
		minPlayers: 2,
		scoreColumns: ['score', 'status', 'ping']
	},
	zombies: {
		id: 'zombies',
		label: 'Zombies',
		description: 'Co-op: follow the route to the evac point and hold back the zombie horde.',
		family: 'coop',
		cvars: ZOMBIES_CVARS,
		minPlayers: 1,
		scoreColumns: ['kills', 'deaths', 'status', 'ping']
	},
	infected: {
		id: 'infected',
		label: 'Infected',
		description: 'MW3-style infected: survive the timer or hunt with claws and throwing knives.',
		family: 'infected',
		cvars: INFECTED_CVARS,
		minPlayers: 2,
		scoreColumns: ['score', 'kills', 'deaths', 'status', 'ping']
	},
	hns: {
		id: 'hns',
		label: 'Hide and Seek',
		description: 'Hiders hide; seekers hunt them with knives. Found hiders become seekers. Hiders win if anyone survives the clock.',
		family: 'hns',
		cvars: HNS_CVARS,
		minPlayers: 2,
		scoreColumns: ['role', 'finds', 'survived', 'ping']
	}
});

export const GAME_MODE_IDS = Object.keys(GAME_MODES) as GameModeId[];

export function isGameModeId(v: unknown): v is GameModeId {
	return typeof v === 'string' && Object.hasOwn(GAME_MODES, v);
}

/** Mode definition by id (unknown ids fall back to surf). */
export function gameMode(id: string): GameModeDef {
	return isGameModeId(id) ? GAME_MODES[id] : GAME_MODES.surf;
}

/** The gamemode a map is played in. */
export function modeOf(map: Pick<MapDef, 'kind'>): GameModeDef {
	return gameMode(map.kind);
}

export function isRaceMode(id: string): boolean {
	return gameMode(id).family === 'race';
}

/** Full physics cvars for a map: its mode's profile, then the map's overrides. */
export function mapCvars(map: Pick<MapDef, 'kind' | 'cvars'>): Cvars {
	return { ...modeOf(map).cvars, ...map.cvars } as Cvars;
}

export * from './hns.ts';
export * from './tag.ts';
export * from './zombies/index.ts';
export * from './infected/index.ts';
