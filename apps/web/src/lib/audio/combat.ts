/**
 * Combat sounds of the infected and zombies modes (docs/ui.md#audio): which
 * recorded pool a sound name plays, at what level, how far it carries and how
 * many of it may sound at once. Data and pure maths only; GameAudio
 * (audio.ts) does the WebAudio. Levels are MIX_LUFS in mix.ts.
 */
import { MIX_LUFS, RANGE, levelDb, rangeDb, type RangeName } from '#lib/audio/mix.js';
import type { SFX_EVENTS } from '#lib/audio/sfx.js';

export type CombatPool = keyof typeof SFX_EVENTS;

/** Voices shared by all combat sounds (VoicePool size). */
export const COMBAT_VOICES = 24;

/** A sound never cuts one of a higher priority. */
export const PRIO = { world: 0, weapon: 1, feedback: 2, event: 3 } as const;

export interface CombatSound {
	/** Voice key: one per sound, so its voices can be counted. */
	readonly key: number;
	/** Recorded takes (SFX_EVENTS). */
	readonly pool: CombatPool;
	/** Loudness in the mix of your own sound, or of one right next to you (LUFS). */
	readonly lufs: number;
	/** How far another player's sound carries; null: heard at full level wherever it happens. */
	readonly range: RangeName | null;
	/** Most voices of this sound at once; the oldest is cut for a new one. */
	readonly voices: number;
	readonly prio: number;
	/** Shortest time between two starts (s). */
	readonly gap: number;
	/** ±VARIATION_DB per play, like the other pooled takes. */
	readonly vary: boolean;
	/** Core sound played instead while the pool has not loaded (the sound that played before the recordings existed). */
	readonly fallback: 'zone' | null;
}

let keys = 0;
function sound(pool: CombatPool, lufs: number, range: RangeName | null, voices: number, prio: number, gap = 0.03, vary = true, fallback: 'zone' | null = null): CombatSound {
	return { key: keys++, pool, lufs, range, voices, prio, gap, vary, fallback };
}

const SHOT_PISTOL = sound('shotPistol', MIX_LUFS.shotPistol, 'shot', 3, PRIO.weapon);
const SHOT_LMG = sound('shotLmg', MIX_LUFS.shotLmg, 'shot', 4, PRIO.weapon);
const SHOT_SNIPER = sound('shotSniper', MIX_LUFS.shotSniper, 'shot', 2, PRIO.weapon);
const KNIFE = sound('swing', MIX_LUFS.swing, 'near', 2, PRIO.weapon);
const RELOAD = sound('reload', MIX_LUFS.reload, 'near', 2, PRIO.world, 0.1);
const CASING = sound('casing', MIX_LUFS.casing, 'near', 3, PRIO.world, 0.06);
const SHELL = sound('shell', MIX_LUFS.shell, 'near', 2, PRIO.world, 0.08);
const HIT_BODY = sound('hitBody', MIX_LUFS.hitBody, null, 3, PRIO.feedback, 0.03, false);
const HURT = sound('hurt', MIX_LUFS.hurt, null, 2, PRIO.feedback, 0.05);

/**
 * Infected (docs/modes.md#infected): every name of the client's InfSound that
 * has its own recording. Round start, Patient Zero and the UAV pulse keep the
 * zone bell and perks keep the record chime (INFECTED_CHIMES).
 */
export const INFECTED_SOUNDS: Readonly<Record<string, CombatSound>> = {
	'shot-pistol': SHOT_PISTOL,
	'shot-smg': sound('shotSmg', MIX_LUFS.shotSmg, 'shot', 4, PRIO.weapon),
	'shot-lmg': SHOT_LMG,
	'shot-sniper': SHOT_SNIPER,
	'shot-barrett': sound('shotBarrett', MIX_LUFS.shotBarrett, 'shot', 2, PRIO.weapon),
	'shot-striker': sound('shotStriker', MIX_LUFS.shotStriker, 'shot', 3, PRIO.weapon),
	knife: KNIFE,
	claws: sound('swing', MIX_LUFS.claws, 'near', 2, PRIO.weapon),
	throw: sound('throw', MIX_LUFS.throw, 'near', 2, PRIO.weapon),
	reload: RELOAD,
	reloadDone: sound('reloadDone', MIX_LUFS.reloadDone, 'near', 2, PRIO.world, 0.1),
	handle: sound('draw', MIX_LUFS.handle, 'near', 2, PRIO.world, 0.1),
	magOut: sound('magOut', MIX_LUFS.magOut, 'near', 2, PRIO.world, 0.1),
	magIn: sound('magIn', MIX_LUFS.magIn, 'near', 2, PRIO.world, 0.1),
	bolt: sound('reloadDone', MIX_LUFS.bolt, 'near', 2, PRIO.world, 0.1),
	// Every case that lands asks for one: few play, and never right after each other.
	casing: CASING,
	shell: SHELL,
	dryfire: sound('dryfire', MIX_LUFS.dryfire, 'near', 2, PRIO.world, 0.08),
	draw: sound('draw', MIX_LUFS.draw, 'near', 2, PRIO.world, 0.1),
	scope: sound('scope', MIX_LUFS.scope, 'near', 1, PRIO.world, 0.06),
	// A shotgun's eight pellets land in one frame: one impact per 25 ms, four voices.
	impact: sound('impact', MIX_LUFS.impact, 'near', 4, PRIO.world, 0.025),
	hit: HIT_BODY,
	hitHead: sound('hitHead', MIX_LUFS.hitHead, null, 2, PRIO.feedback, 0.03, false),
	hitKill: sound('hitKill', MIX_LUFS.hitKill, null, 2, PRIO.feedback, 0.03, false),
	hurt: HURT,
	death: sound('death', MIX_LUFS.death, 'mid', 3, PRIO.world, 0.05),
	infect: sound('infect', MIX_LUFS.infect, 'mid', 2, PRIO.weapon, 0.1),
	knifeBounce: sound('knifeBounce', MIX_LUFS.knifeBounce, 'near', 2, PRIO.world, 0.05),
	knifeStick: sound('knifeStick', MIX_LUFS.knifeStick, 'near', 2, PRIO.world, 0.05),
	knifePickup: sound('knifePickup', MIX_LUFS.knifePickup, 'near', 2, PRIO.world, 0.05),
	beacon: sound('beacon', MIX_LUFS.beacon, 'mid', 2, PRIO.world, 0.1),
	beaconSmash: sound('beaconSmash', MIX_LUFS.beaconSmash, 'mid', 2, PRIO.world, 0.1),
	beaconUse: sound('beaconUse', MIX_LUFS.beaconUse, 'mid', 2, PRIO.world, 0.1),
	moab: sound('moab', MIX_LUFS.moab, null, 1, PRIO.event, 1, false, 'zone'),
	moabDetonate: sound('moabDetonate', MIX_LUFS.moabDetonate, null, 1, PRIO.event, 1, false, 'zone')
};

/** Infected names that play a core sound: the zone bell or the record chime. */
export const INFECTED_CHIMES: Readonly<Record<string, 'zone' | 'record'>> = {
	round: 'zone',
	alpha: 'zone',
	uav: 'zone',
	perk: 'record',
	moabReady: 'record'
};

/**
 * Zombies (docs/modes.md#zombies): the names that mean the same as in
 * infected share its recordings. The zombie groan has no recording yet and the
 * checkpoint keeps the zone bell (GameAudio.zombies).
 */
export const ZOMBIES_SOUNDS: Readonly<Record<string, CombatSound>> = {
	'shot-pistol': SHOT_PISTOL,
	'shot-lmg': SHOT_LMG,
	'shot-sniper': SHOT_SNIPER,
	knife: KNIFE,
	reload: RELOAD,
	casing: CASING,
	shell: SHELL,
	hit: HIT_BODY,
	hurt: HURT
};

/**
 * Voice key of a play: another player's sound counts apart from your own, so
 * a teammate firing the same gun in the same frame never takes your shot's
 * voice or trips its minimum gap.
 */
export function voiceKey(s: CombatSound, remote: boolean): number {
	return remote ? s.key + REMOTE_KEY : s.key;
}
const REMOTE_KEY = 1000;

/**
 * Level (dB, before the per-play variation) of a combat sound: its mix level
 * for your own sound (`dist` undefined) or one that is heard everywhere, else
 * lowered by distance; null when it is out of earshot.
 */
export function combatDb(s: CombatSound, dist?: number): number | null {
	const own = levelDb(s.pool, s.lufs);
	if (dist === undefined || s.range === null) return own;
	const fall = rangeDb(dist, RANGE[s.range].near, RANGE[s.range].far);
	return fall === null ? null : own + fall;
}
