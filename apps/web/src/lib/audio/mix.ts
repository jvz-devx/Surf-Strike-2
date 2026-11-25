/**
 * Pure mixing logic for the recorded game sounds (docs/ui.md#audio): pool
 * cycling, per-play level variation and the speed → level/filter mappings.
 * No WebAudio here so it can be unit tested; tools/audio/demo.py mirrors these
 * numbers for the offline demo render.
 */
import { SFX_LUFS } from '#lib/audio/sfx.js';

export type SfxGroup = keyof typeof SFX_LUFS;

/**
 * Loudness each sound should have in the mix (LUFS, same measurement as
 * SFX_LUFS) before the master volume. The wind bed at full speed is the
 * reference; events sit relative to it.
 */
export const MIX_LUFS = {
	wind: -20,
	slideMin: -26,
	slideMax: -20,
	step: -28,
	jump: -33,
	landMin: -33,
	landMax: -21,
	zone: -29,
	record: -24,
	vote: -27,
	click: -31,
	/** Loot box reel. */
	tick: -33,
	/** Hide and seek knife swing (own swing, or a seeker right next to you). */
	swing: -30,
	/** Hide and seek knife hit (you found someone, or were found). */
	hit: -24,
	/**
	 * Combat (infected, zombies): your own sound, or one right next to you.
	 * Gunshots sit above everything else, ordered by weapon: the .50 cal on
	 * top, the SMG lowest per shot (it fires 15 a second).
	 */
	shotBarrett: -15.5,
	shotSniper: -17,
	shotStriker: -18,
	shotLmg: -20.5,
	shotPistol: -23.5,
	shotSmg: -25,
	/** Weapon handling stays under the footsteps. */
	reload: -31,
	reloadDone: -31,
	/** The moves of your own reload: the gun taken up, the magazine out and in, the sniper's bolt after a shot. */
	handle: -35,
	magOut: -32,
	magIn: -30,
	bolt: -33,
	/** A case falling on the ground: under everything. */
	casing: -38,
	shell: -38,
	dryfire: -33,
	draw: -33,
	scope: -37,
	/** Claws use the knife swing pool, a little heavier than the knife. */
	claws: -28,
	throw: -29,
	knifeBounce: -31,
	knifeStick: -30,
	knifePickup: -33,
	/** A bullet hitting the world. */
	impact: -31,
	/** Hit confirms for the shooter: body, head, kill, each one louder. */
	hitBody: -24.5,
	hitHead: -22,
	hitKill: -21,
	/** You were hit. */
	hurt: -26,
	death: -27,
	infect: -26,
	beacon: -28,
	beaconSmash: -26,
	beaconUse: -28,
	/** The M.O.A.B. siren and its detonation, heard by everyone at one level. */
	moab: -22,
	moabDetonate: -19.5,
	/** Crash: the cymbal at the end, and the roll and timpani at the start and at full tension. */
	crash: -21,
	rollMin: -37,
	rollMax: -21,
	timpaniMax: -22
} as const;

/** Reverb send relative to the dry signal (dB), through the measured IR. */
export const REVERB_SEND_DB = -14;
/** Per-play random level variation for pooled takes (± dB). */
export const VARIATION_DB = 1.5;

export const STEP_DISTANCE = 76; // units between footsteps
export const STEP_MIN_SPEED = 90;
/** Footstep cadence stops rising above running speed (no machine-gun steps when sliding fast on ground). */
export const STEP_MAX_SPEED = 320;
export const LAND_MIN_SPEED = 120;

const WIND_MIN_SPEED = 150;
const WIND_FULL_SPEED = 2000;
const WIND_CUTOFF_MIN = 400;
const WIND_CUTOFF_MAX = 9000;
const SLIDE_FULL_SPEED = 1500;

export function dbToGain(db: number): number {
	return Math.pow(10, db / 20);
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Gain (dB) that brings a file group to the given mix loudness. */
export function levelDb(group: SfxGroup, mixLufs: number): number {
	return mixLufs - SFX_LUFS[group];
}

/** Cycles through a pool of takes in order: 0, 1, …, n−1, 0, … */
export class Cycle {
	private i = -1;
	constructor(readonly size: number) {}

	next(): number {
		if (this.size <= 0) return -1;
		this.i = (this.i + 1) % this.size;
		return this.i;
	}
}

/** Uniform level variation in [−VARIATION_DB, +VARIATION_DB]. */
export function variationDb(rand: () => number = Math.random): number {
	const r = clamp01(rand());
	return (r * 2 - 1) * VARIATION_DB;
}

/** Wind bed: linear gain and low-pass cutoff (Hz) for a horizontal speed (u/s). */
export function windParams(speed: number): { gain: number; cutoff: number } {
	const w = clamp01((speed - WIND_MIN_SPEED) / (WIND_FULL_SPEED - WIND_MIN_SPEED));
	return {
		gain: w > 0 ? dbToGain(levelDb('wind', MIX_LUFS.wind)) * Math.pow(w, 1.5) : 0,
		cutoff: WIND_CUTOFF_MIN * Math.pow(WIND_CUTOFF_MAX / WIND_CUTOFF_MIN, w)
	};
}

/** Ramp slide bed: linear gain while surfing (0 otherwise). */
export function slideGain(speed: number, surfing: boolean): number {
	if (!surfing) return 0;
	const k = clamp01(speed / SLIDE_FULL_SPEED);
	return dbToGain(levelDb('slide', MIX_LUFS.slideMin + (MIX_LUFS.slideMax - MIX_LUFS.slideMin) * k));
}

/** After a cash-out the roll goes on this much softer (dB). */
const CRASH_DUCK_DB = -9;

/**
 * Crash build-up at a multiplier (1 = start): a snare roll and, from 1.3×, a
 * timpani roll, both louder, brighter and faster the higher it climbs. The
 * tension rises quickly at first, since most rounds end early, and never stops
 * rising; the speed goes up with every doubling. `out`: already cashed out.
 */
export function crashBuild(mult: number, out = false): { roll: number; timpani: number; rate: number; cutoff: number } {
	const doublings = Math.log2(Math.max(1, mult));
	const tension = 1 - Math.exp(-doublings / 1.8);
	const low = clamp01((doublings - 0.38) / 2.5);
	const duck = out ? CRASH_DUCK_DB : 0;
	return {
		roll: dbToGain(levelDb('roll', MIX_LUFS.rollMin + (MIX_LUFS.rollMax - MIX_LUFS.rollMin) * tension) + duck),
		timpani: low > 0 ? dbToGain(levelDb('timpani', MIX_LUFS.timpaniMax) + duck) * low : 0,
		rate: Math.min(2, 0.85 + 0.15 * doublings),
		cutoff: (out ? 0.5 : 1) * 700 * Math.pow(16_000 / 700, tension)
	};
}

/** Footstep level (dB, before variation): softer when walking slowly. */
export function stepDb(speed: number): number {
	const k = Math.max(0.35, clamp01(speed / 250));
	return levelDb('step', MIX_LUFS.step) + 20 * Math.log10(k);
}

/** Landing level (dB, before variation) by fall speed, or null when too soft to hear. */
export function landDb(fallSpeed: number): number | null {
	if (fallSpeed < LAND_MIN_SPEED) return null;
	const k = clamp01((fallSpeed - 100) / 700);
	return levelDb('land', MIX_LUFS.landMin + (MIX_LUFS.landMax - MIX_LUFS.landMin) * k);
}

/** Distance (units) the step counter advances in dt seconds. */
export function stepAdvance(speed: number, dt: number): number {
	return Math.min(speed, STEP_MAX_SPEED) * dt;
}

/** Single-take event level (dB). */
export function eventDb(group: 'jump' | 'zone' | 'record' | 'vote' | 'click' | 'tick' | 'swing' | 'hit' | 'crash'): number {
	return levelDb(group, MIX_LUFS[group]);
}

/** Another player's knife swing is heard at full level up to this distance (units)… */
export const SWING_NEAR = 128;
/** …and not at all beyond this one (no map-wide cue for hiders). */
export const SWING_FAR = 1024;

/**
 * Level change (dB) of a sound `dist` units away: 0 up to SWING_NEAR, then
 * −6 dB per doubling of distance (inverse distance), null (silent) beyond
 * SWING_FAR.
 */
export function distanceDb(dist: number): number | null {
	if (!Number.isFinite(dist) || dist > SWING_FAR) return null;
	return dist <= SWING_NEAR ? 0 : -20 * Math.log10(dist / SWING_NEAR);
}

/**
 * Loop region of a decoded loop buffer. Some decoders keep the AAC priming
 * silence at the head; the loop starts at the first audible sample so the
 * offline-prepared loop length stays exact.
 */
export function loopRegion(
	head: Float32Array,
	sampleRate: number,
	duration: number,
	loopSeconds: number
): { start: number; end: number } {
	const scan = Math.min(head.length, Math.floor(sampleRate * 0.1));
	let lead = 0;
	for (let i = 0; i < scan; i++) {
		if (Math.abs(head[i]) > 1e-3) {
			lead = i;
			break;
		}
	}
	const start = lead / sampleRate;
	return { start, end: Math.min(duration, start + loopSeconds) };
}

/**
 * Combat sounds (infected, zombies; docs/ui.md#audio). Your own sounds play at
 * their mix level; another player's fall off with distance and are panned by
 * direction.
 */

/** Master volume the game starts with (the `volume` cvar default). */
export const DEFAULT_VOLUME = 0.5;
/** Threshold of the safety limiter after the master volume (dBFS). */
export const LIMITER_THRESHOLD_DB = -3;
/** Every shipped file peaks at or below this (tools/audio/manifest.json truePeakCeiling, dBTP). */
export const FILE_PEAK_DB = -1.5;
/**
 * Most gain (dB, with the per-play variation) a combat sound may get: at the
 * default volume a file at the peak ceiling then just reaches the limiter
 * threshold, so the mix does not lean on the limiter.
 */
export const OWN_HEADROOM_DB = LIMITER_THRESHOLD_DB - 20 * Math.log10(DEFAULT_VOLUME) - FILE_PEAK_DB;

/** How far a sound carries (units): full level up to `near`, silent beyond `far`. */
export const RANGE = {
	/** Gunshots are heard across most of a map. */
	shot: { near: 384, far: 6000 },
	/** Voices, falls, beacons. */
	mid: { near: 256, far: 2400 },
	/** Handling, knives and impacts stay close. */
	near: { near: 128, far: 1200 }
} as const;
export type RangeName = keyof typeof RANGE;

/** The last part of a range (fraction of `far`) fades to silence instead of cutting off. */
const RANGE_FADE = 0.25;

/**
 * Level change (dB) of a sound `dist` units away: 0 up to `near`, then −6 dB
 * per doubling of distance, with an extra fade to silence over the last quarter
 * of the range; null (silent) at `far` and beyond.
 */
export function rangeDb(dist: number, near: number, far: number): number | null {
	if (!Number.isFinite(dist) || dist >= far) return null;
	if (dist <= near) return 0;
	const db = -20 * Math.log10(dist / near);
	const edge = far * (1 - RANGE_FADE);
	return dist <= edge ? db : db + 20 * Math.log10((far - dist) / (far - edge));
}

/** Widest stereo position: a sound straight to one side still reaches the other ear. */
export const PAN_MAX = 0.8;
/** Closer than this (units) a source moves to the centre: a sound at your feet has no side. */
export const PAN_MIN_DIST = 48;

/**
 * Stereo position (−PAN_MAX left … +PAN_MAX right) of a source at `at` for a
 * listener at `listener` looking along `yawDeg` (0 = +X, counter-clockwise, so
 * +Y is to the left). It is the sine of the bearing, so a source ahead or behind
 * is centred, and one above or below narrows towards the centre.
 */
export function panFor(listener: { x: number; y: number; z: number }, at: { x: number; y: number; z: number }, yawDeg: number): number {
	const dx = at.x - listener.x;
	const dy = at.y - listener.y;
	const dist = Math.hypot(dx, dy, at.z - listener.z);
	if (!Number.isFinite(dist) || !Number.isFinite(yawDeg) || dist === 0) return 0;
	const yaw = (yawDeg * Math.PI) / 180;
	const right = dx * Math.sin(yaw) - dy * Math.cos(yaw);
	return PAN_MAX * Math.max(-1, Math.min(1, right / Math.max(dist, PAN_MIN_DIST)));
}

/**
 * A fixed set of voices, so automatic fire cannot pile up audio nodes. A new
 * sound takes, in this order: nothing, when the same sound started less than
 * `gap` seconds ago; the oldest voice of the same sound, when `max` of them
 * are already sounding; a free voice; the oldest voice of the same or a lower
 * priority. With none of those the sound is dropped. No allocation per call.
 */
export class VoicePool {
	private readonly key: Int32Array;
	private readonly prio: Int32Array;
	private readonly startedAt: Float64Array;
	private readonly endsAt: Float64Array;

	constructor(readonly size: number) {
		this.key = new Int32Array(size).fill(-1);
		this.prio = new Int32Array(size);
		this.startedAt = new Float64Array(size).fill(-Infinity);
		this.endsAt = new Float64Array(size).fill(-Infinity);
	}

	/**
	 * Voice (0 … size−1) for a sound of `key` that starts at `now` and lasts
	 * `dur` seconds, or −1 when it must not play. A voice that is still sounding
	 * is cut by the caller.
	 */
	acquire(key: number, prio: number, now: number, dur: number, max: number, gap: number): number {
		let same = 0;
		let oldestSame = -1;
		let free = -1;
		let steal = -1;
		for (let i = 0; i < this.size; i++) {
			if (this.endsAt[i] <= now) {
				if (free < 0) free = i;
				continue;
			}
			if (this.key[i] === key) {
				if (now - this.startedAt[i] < gap) return -1;
				same++;
				if (oldestSame < 0 || this.startedAt[i] < this.startedAt[oldestSame]) oldestSame = i;
			}
			if (this.prio[i] <= prio && (steal < 0 || this.startedAt[i] < this.startedAt[steal])) steal = i;
		}
		const slot = same >= max ? oldestSame : free >= 0 ? free : steal;
		if (slot < 0) return -1;
		this.key[slot] = key;
		this.prio[slot] = prio;
		this.startedAt[slot] = now;
		this.endsAt[slot] = now + dur;
		return slot;
	}

	/** The sound on `slot` ended before its time was up. */
	release(slot: number): void {
		if (slot >= 0 && slot < this.size) this.endsAt[slot] = -Infinity;
	}

	/** Voices still sounding at `now`. */
	active(now: number): number {
		let n = 0;
		for (let i = 0; i < this.size; i++) if (this.endsAt[i] > now) n++;
		return n;
	}

	/** Forget every voice (the audio context was closed). */
	clear(): void {
		this.key.fill(-1);
		this.startedAt.fill(-Infinity);
		this.endsAt.fill(-Infinity);
	}
}
