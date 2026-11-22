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
	click: -31
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
export function eventDb(group: 'jump' | 'zone' | 'record' | 'vote' | 'click'): number {
	return levelDb(group, MIX_LUFS[group]);
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
