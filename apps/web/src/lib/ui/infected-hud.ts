/**
 * Pure helpers for InfectedHud.svelte (docs/ui.md): ammo prompt state, the
 * fades of score popups, hit arcs and hit markers, their reduced-motion
 * variants (no cue jumps, restarts or pulses), the M.O.A.B. overlay, the
 * scope overlay and the round summary layout. No DOM, no Svelte:
 * unit-tested in node.
 */
import type { InfPhase, InfTeam } from '@surf/shared';
import { INF_HURT_LETHAL_MS, INF_HURT_MS, INF_POP_MS, type InfSummaryRow } from '#lib/game/infected-hud-events.js';
import { ammoText } from '#lib/game/zombies-view.js';
import { fadeOpacity } from '#lib/ui/format.js';

export type AmmoPrompt = 'reload' | 'low' | 'empty';

export interface AmmoPromptInput {
	phase: InfPhase | 'solo';
	team: InfTeam;
	alive: boolean;
	spectating: boolean;
	mag: number;
	/** 0 for the knife and claws. */
	magSize: number;
	reserve: number;
	reloading: boolean;
}

/** Magazine plus reserve at or below this share of a magazine counts as low. */
export const LOW_TOTAL_SHARE = 0.35;

/**
 * Ammo prompt beside the crosshair, one state at a time: 'empty' (no round
 * left for the held gun), else 'reload' (magazine low, reserve left), else
 * 'low' (little left in total). None with a melee weapon, while reloading,
 * spectating or down, outside a round, and never for the infected team
 * (Patient Zero included).
 */
export function ammoPrompt(a: AmmoPromptInput): AmmoPrompt | null {
	if (a.spectating || !a.alive || a.team !== 'survivor' || a.reloading || a.magSize <= 0) return null;
	if (a.phase !== 'grace' && a.phase !== 'playing') return null;
	const total = a.mag + a.reserve;
	if (total <= 0) return 'empty';
	if (a.reserve > 0 && ammoText(a.mag, a.magSize, a.reserve).low) return 'reload';
	return total <= Math.max(2, Math.floor(a.magSize * LOW_TOTAL_SHARE)) ? 'low' : null;
}

export interface SlotHint {
	key: string;
	label: string;
}

/**
 * Slots to switch to when the held gun is empty: the other gun while it has
 * rounds (or its ammo is unknown), then the knife.
 */
export function emptySlotHints(held: number, slotAmmo: readonly [number, number] | undefined, secondaryLabel: string): SlotHint[] {
	const out: SlotHint[] = [];
	if (held !== 1 && (slotAmmo?.[0] ?? 1) > 0) out.push({ key: '1', label: 'Primary' });
	if (held !== 2 && (slotAmmo?.[1] ?? 1) > 0) out.push({ key: '2', label: secondaryLabel });
	out.push({ key: '3', label: 'Knife' });
	return out;
}

const POP_FADE_MS = 600;
const HURT_FADE_MS = 700;

/** Reduced motion: a cue eases in over this long instead of being there at once (a sixth per 60 Hz frame at most). */
export const CALM_IN_MS = 120;
/** Reduced motion: a timed label fades out over this long instead of being cut. */
export const CALM_OUT_MS = 200;

/** Reduced-motion entry of a cue `age` ms old: nothing at its event (or before it), full after CALM_IN_MS. */
export function calmIn(age: number): number {
	return age > 0 ? Math.min(1, age / CALM_IN_MS) : 0;
}

/** Opacity of a score popup `age` ms old: full, then a fade over its last 600 ms. Reduced motion: it eases in. */
export function popOpacity(age: number, reduced = false): number {
	const fade = fadeOpacity(age, INF_POP_MS - POP_FADE_MS, POP_FADE_MS);
	return reduced ? fade * calmIn(age) : fade;
}

/**
 * Opacity of a hit direction arc: full, then a fade over its last 700 ms (the
 * killing blow lives longer). Reduced motion: it eases in.
 */
export function hurtDirOpacity(age: number, lethal: boolean, reduced = false): number {
	const fade = fadeOpacity(age, (lethal ? INF_HURT_LETHAL_MS : INF_HURT_MS) - HURT_FADE_MS, HURT_FADE_MS);
	return reduced ? fade * calmIn(age) : fade;
}

/**
 * Reduced-motion opacity of a label that shows for `life` ms (perk toast,
 * +20s, +AMMO, UAV line; their pop and blink animations are off): it eases
 * in, holds and fades out over its last CALM_OUT_MS.
 */
export function calmCueOpacity(age: number, life: number): number {
	return calmIn(age) * fadeOpacity(age, life - CALM_OUT_MS, CALM_OUT_MS);
}

/** Hit ring in the units of its svg: a box of RING_BOX around the crosshair, arcs on RING_RADIUS. */
export const RING_BOX = 400;
export const RING_RADIUS = 188;
/** An arc spans this many degrees to either side of its bearing and is this deep in the middle. */
export const RING_HALF_DEG = 20;
export const RING_THICKNESS = 14;

/**
 * SVG path of a hit arc pointing straight ahead (up), centred on the origin:
 * a crescent from -`halfDeg` to +`halfDeg` on `radius`, `thickness` deep in
 * the middle and tapering to its ends. The HUD rotates it by the bearing.
 */
export function hurtArcPath(radius: number, halfDeg: number, thickness: number): string {
	const a = (halfDeg * Math.PI) / 180;
	const x = radius * Math.sin(a);
	const y = -radius * Math.cos(a);
	// Inner edge: a flatter arc through the same ends whose middle lies `thickness` inside the outer one.
	const sag = radius - radius * Math.cos(a) - thickness;
	const inner = sag > 0 ? (x * x + sag * sag) / (2 * sag) : radius * 1000;
	const n = (v: number) => String(Math.round(v * 100) / 100);
	return `M ${n(-x)} ${n(y)} A ${n(radius)} ${n(radius)} 0 0 1 ${n(x)} ${n(y)} A ${n(inner)} ${n(inner)} 0 0 0 ${n(-x)} ${n(y)} Z`;
}

/** A box on screen (px), as getBoundingClientRect gives it. */
export interface ScreenRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** A box in ring units around the crosshair (x to the right, y down). */
export interface RingRect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/** How far an arc stays from a HUD block (px): its glow (a 5 px drop shadow) and a gap. */
export const ARC_KEEP_PX = 8;

/**
 * The area the hit arcs stay out of for a HUD block on screen: `block` in
 * ring units, grown by ARC_KEEP_PX. `ring` is the box of the ring svg on
 * screen (RING_BOX units wide, centred on the crosshair); null without one.
 */
export function ringKeepOut(block: ScreenRect, ring: ScreenRect): RingRect | null {
	const k = (ring.right - ring.left) / RING_BOX;
	if (!(k > 0)) return null;
	const cx = (ring.left + ring.right) / 2;
	const cy = (ring.top + ring.bottom) / 2;
	return {
		x0: (block.left - ARC_KEEP_PX - cx) / k,
		y0: (block.top - ARC_KEEP_PX - cy) / k,
		x1: (block.right + ARC_KEEP_PX - cx) / k,
		y1: (block.bottom + ARC_KEEP_PX - cy) / k
	};
}

const ARC_HALF_RAD = (RING_HALF_DEG * Math.PI) / 180;
/** Ends of an arc pointing up: (±ARC_END_X, ARC_END_Y). */
const ARC_END_X = RING_RADIUS * Math.sin(ARC_HALF_RAD);
const ARC_END_Y = -RING_RADIUS * Math.cos(ARC_HALF_RAD);
/** Outline points tested per edge: half a degree apart on the outer edge. */
const ARC_SAMPLES = 80;

/**
 * False when a hit arc at `bearing` (degrees clockwise from straight ahead)
 * would reach into `keepOut` (ringKeepOut; null: nothing to avoid). The HUD
 * does not draw such an arc: on a small screen a deep round header stack ends
 * inside the ring, and only arcs for hits from the front can meet it, where
 * the attacker is on screen. Tested on the arc's outer edge and the chord
 * between its ends, which enclose the crescent. No allocation.
 */
export function arcClear(bearing: number, keepOut: RingRect | null): boolean {
	if (!keepOut) return true;
	const b = (bearing * Math.PI) / 180;
	const cb = Math.cos(b);
	const sb = Math.sin(b);
	for (let i = 0; i <= ARC_SAMPLES; i++) {
		const t = (i / ARC_SAMPLES) * 2 - 1;
		const a = t * ARC_HALF_RAD;
		// Outer edge, then the chord, both turned by the bearing.
		let x = RING_RADIUS * Math.sin(a);
		let y = -RING_RADIUS * Math.cos(a);
		for (let edge = 0; edge < 2; edge++) {
			const rx = x * cb - y * sb;
			const ry = x * sb + y * cb;
			if (rx >= keepOut.x0 && rx <= keepOut.x1 && ry >= keepOut.y0 && ry <= keepOut.y1) return false;
			x = t * ARC_END_X;
			y = ARC_END_Y;
		}
	}
	return true;
}

/**
 * Top of score popup row `row` (0 = newest) from the crosshair line, in row
 * heights. The arm of a wide crosshair and the scope's horizontal hair run
 * along that line: every row sits above it, the newest nearest (below it they
 * would meet the keys display).
 */
export function popRowTop(row: number): number {
	return -(row + 1);
}

/** The ammo prompt and the score popups end this far above the crosshair line (px), clear of the arms and the scope's hair. */
export const CROSSHAIR_LINE_CLEAR_PX = 4;

export type HitKind = 'body' | 'head' | 'kill';

/** Hit marker state: a kill wins over a headshot (a headshot kill keeps its head pip). */
export function hitKind(h: { head: boolean; kill: boolean }): HitKind {
	return h.kill ? 'kill' : h.head ? 'head' : 'body';
}

/** Hit marker opacity: a kill holds a little longer. */
export function hitOpacity(age: number, kind: HitKind): number {
	return kind === 'kill' ? fadeOpacity(age, 200, 200) : fadeOpacity(age, 120, 220);
}

/** M.O.A.B. detonation overlay length. */
export const NUKE_MS = 2400;
/** Peak opacity of the reduced-motion overlay. */
export const NUKE_CALM_PEAK = 0.3;
const NUKE_CALM_RISE_MS = 400;
const NUKE_CALM_FALL_MS = 1200;

/**
 * Opacity of the M.O.A.B. detonation overlay `age` ms after the detonation
 * (0 when over). Normally a blinding flash that fades out. With reduced
 * motion a dim wash that eases in, holds and fades once: it never jumps and
 * never passes NUKE_CALM_PEAK.
 */
export function nukeOpacity(age: number, reduced: boolean): number {
	if (!(age >= 0) || age >= NUKE_MS) return 0;
	if (reduced) return NUKE_CALM_PEAK * Math.min(1, age / NUKE_CALM_RISE_MS, (NUKE_MS - age) / NUKE_CALM_FALL_MS);
	return Math.pow(1 - age / NUKE_MS, 1.6);
}

/** Colour of the flash: 0 = white core, warming to 1 = amber. Reduced motion is flat amber throughout. */
export function nukeWarm(age: number, reduced: boolean): number {
	return reduced ? 1 : Math.max(0, Math.min(1, (age / NUKE_MS) * 2.2));
}

/** Hurt vignette strength: softer with reduced motion (where it also eases in: CALM_VIGNETTE). */
export function vignetteStrength(reduced: boolean): number {
	return reduced ? 0.4 : 0.8;
}

/**
 * A cue with one slot that its event re-triggers (hurt vignette, hit marker,
 * flash banner), under reduced motion: how fast it may rise and fall.
 */
export interface CalmCue {
	/** Level it rises to. */
	peak: number;
	/** Time from nothing to the peak (ms). */
	rise: number;
	/** The cue stays up while its latest event is younger than this (ms). */
	hold: number;
	/** Time from the peak to nothing (ms). */
	fall: number;
}

/** Hurt vignette: a soft edge that takes 150 ms to come up and fades out once. */
export const CALM_VIGNETTE: CalmCue = { peak: vignetteStrength(true), rise: 150, hold: 250, fall: 600 };
/** Hit marker: gone within the 400 ms the client keeps it. */
export const CALM_HIT: CalmCue = { peak: 1, rise: CALM_IN_MS, hold: 180, fall: 220 };
/** Flash banner: its normal 2 s and 0.8 s fade. */
export const CALM_FLASH: CalmCue = { peak: 1, rise: 150, hold: 2000, fall: 800 };

/** Longest frame a cue rises over: a hitch must not turn the ease into a jump. */
export const CALM_MAX_STEP_MS = 34;

/**
 * One frame of a reduced-motion cue: `level` moves towards the peak while
 * the latest event is younger than `hold` (`age` in ms; Infinity: none) and
 * towards nothing after that, by `dt` / rise of the peak up and `dt` / fall
 * down at most. So the cue eases in, holds and fades once, and an event that
 * lands in the fade continues from the level it finds: an opacity curve of
 * the age alone restarts on every event, which pulses under repeated hits.
 */
export function calmStep(level: number, age: number, dt: number, cue: CalmCue): number {
	if (!(dt > 0)) return level;
	// An event stamped a moment after the HUD clock (age < 0) has just happened.
	return age < cue.hold ? Math.min(cue.peak, level + (cue.peak * dt) / cue.rise) : Math.max(0, level - (cue.peak * dt) / cue.fall);
}

/** The level of one reduced-motion cue from frame to frame (the state of calmStep). */
export class CalmLevel {
	private level = 0;
	private last = -Infinity;

	constructor(private readonly cue: CalmCue) {}

	/**
	 * Level at `now` for a cue whose latest event was at `eventAt` (0: none).
	 * Asked once per frame; the same `now` again returns the same level. After
	 * a pause (the first frame, a hitch, frames in which the cue was not shown)
	 * the level first falls for the time missed, then rises for one capped
	 * frame at most, and no longer than its event is old.
	 */
	at(now: number, eventAt: number): number {
		const dt = now - this.last;
		if (!(dt > 0)) return this.level;
		this.last = now;
		const age = eventAt > 0 ? now - eventAt : Infinity;
		let step = dt;
		if (dt > CALM_MAX_STEP_MS) {
			step = Math.min(CALM_MAX_STEP_MS, Math.max(age, 0));
			this.level = Math.max(0, this.level - (this.cue.peak * (dt - step)) / this.cue.fall);
		}
		this.level = calmStep(this.level, age, step, this.cue);
		return this.level;
	}
}

/**
 * Scope overlay for zoom progress `scopeT` (0..1; absent: follows `scoped`):
 * it fades in with the zoom while the lens closes in from `scale` 1.35 to 1.
 * null when the scope is down.
 */
export function scopeOverlay(scopeT: number | undefined, scoped: boolean): { opacity: number; scale: number } | null {
	const t = Math.max(0, Math.min(1, scopeT ?? (scoped ? 1 : 0)));
	if (!(t > 0)) return null;
	return { opacity: t, scale: 1 + (1 - t) * 0.35 };
}

/** Rows per summary column, and the most rows shown. */
export const SUMMARY_COLUMN_ROWS = 8;
export const SUMMARY_MAX_ROWS = SUMMARY_COLUMN_ROWS * 2;

export interface SummaryLayout {
	/** One column up to SUMMARY_COLUMN_ROWS players, else two of (nearly) equal length. */
	columns: InfSummaryRow[][];
	/** Players left out (more than SUMMARY_MAX_ROWS). */
	more: number;
}

/**
 * Round summary layout: rows in the given order, split into two columns
 * above SUMMARY_COLUMN_ROWS. Beyond SUMMARY_MAX_ROWS the best are shown, with
 * the focus player (me or the spectate target) always among them.
 */
export function summaryLayout(rows: readonly InfSummaryRow[], focusId: number | undefined): SummaryLayout {
	const shown = rows.slice(0, SUMMARY_MAX_ROWS);
	if (rows.length > SUMMARY_MAX_ROWS) {
		const focus = rows.findIndex((r) => r.id === focusId);
		if (focus >= SUMMARY_MAX_ROWS) shown[SUMMARY_MAX_ROWS - 1] = rows[focus]!;
	}
	const more = rows.length - shown.length;
	if (shown.length <= SUMMARY_COLUMN_ROWS) return { columns: [shown], more };
	const first = Math.ceil(shown.length / 2);
	return { columns: [shown.slice(0, first), shown.slice(first)], more };
}

/** Accuracy cell: `42%`, or a dash for a player who never fired. */
export function accuracyText(accuracy: number | null): string {
	return accuracy === null ? '—' : `${accuracy}%`;
}
