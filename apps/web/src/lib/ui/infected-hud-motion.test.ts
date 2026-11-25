/**
 * Reduced motion in the Infected HUD (infected-hud.ts): under
 * prefers-reduced-motion no event cue may jump to its strength in one frame,
 * restart from nothing when its event repeats, or pulse. The cues are driven
 * by these curves; the tests walk them frame by frame.
 */
import { describe, expect, it } from 'vitest';
import { INF_HURT_LETHAL_MS, INF_HURT_MS, INF_POP_MS } from '#lib/game/infected-hud-events.js';
import { fadeOpacity } from '#lib/ui/format.js';
import {
	CALM_FLASH,
	CALM_HIT,
	CALM_IN_MS,
	CALM_MAX_STEP_MS,
	CALM_OUT_MS,
	CALM_VIGNETTE,
	calmCueOpacity,
	calmIn,
	CalmLevel,
	calmStep,
	hitOpacity,
	hurtDirOpacity,
	popOpacity,
	vignetteStrength,
	type CalmCue
} from '#lib/ui/infected-hud.js';

const HZ60 = 1000 / 60;
const EPS = 1e-9;

/** Deterministic pseudo-random numbers in [0, 1). */
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

/**
 * Walks a cue through frames `dt` apart from `t0` for `ms`, with events at
 * `events` (ms). Returns the level of every frame.
 */
function walk(cue: CalmCue, events: readonly number[], ms: number, dt = HZ60, t0 = 1000): number[] {
	const level = new CalmLevel(cue);
	const out: number[] = [];
	let last = 0;
	for (let t = t0; t <= t0 + ms; t += dt) {
		for (const e of events) if (t0 + e <= t) last = Math.max(last, t0 + e);
		out.push(level.at(t, last));
	}
	return out;
}

const steps = (levels: readonly number[]): number[] => levels.slice(1).map((l, i) => l - levels[i]!);
const maxAbs = (v: readonly number[]): number => v.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

describe('reduced motion: the hurt vignette', () => {
	it('the finding: the old curve was at its strength in the first frame', () => {
		// What InfectedHud.svelte computed before: fadeOpacity(age, 80, 420) * vignetteStrength(reduced).
		expect(fadeOpacity(0, 80, 420) * vignetteStrength(true)).toBe(0.4);
	});

	it('one hit: eases in over about 150 ms to the softer peak, holds, and fades out once', () => {
		const v = walk(CALM_VIGNETTE, [0], 1200);
		expect(CALM_VIGNETTE.peak).toBe(vignetteStrength(true));
		expect(CALM_VIGNETTE.peak).toBeLessThan(vignetteStrength(false));
		expect(CALM_VIGNETTE.rise).toBeGreaterThanOrEqual(150);
		// The first frame shows nothing yet, the next ones a little more each.
		expect(v[0]).toBe(0);
		expect(v[1]!).toBeLessThan(0.05);
		const top = v.findIndex((l) => l >= CALM_VIGNETTE.peak - EPS);
		expect(top * HZ60).toBeGreaterThanOrEqual(CALM_VIGNETTE.rise - EPS);
		expect(top * HZ60).toBeLessThan(CALM_VIGNETTE.rise + 2 * HZ60);
		expect(Math.max(...v)).toBeCloseTo(CALM_VIGNETTE.peak, 9);
		// One swell: up, level, down. It never turns up again, and it is gone at the end.
		const d = steps(v);
		const firstDown = d.findIndex((x) => x < -EPS);
		expect(firstDown * HZ60).toBeGreaterThanOrEqual(CALM_VIGNETTE.hold - HZ60);
		expect(d.slice(firstDown).every((x) => x <= EPS)).toBe(true);
		expect(v.at(-1)).toBe(0);
		const gone = v.findIndex((l, i) => i > top && l === 0);
		expect(gone * HZ60).toBeLessThan(CALM_VIGNETTE.hold + CALM_VIGNETTE.fall + 2 * HZ60);
	});

	it('no frame changes it by more than a small step, whatever the hits and the frame rate', () => {
		const rand = rng(7);
		const trains: number[][] = [
			[0],
			Array.from({ length: 40 }, (_, i) => i * 66), // automatic fire
			Array.from({ length: 12 }, (_, i) => i * 300), // claws
			Array.from({ length: 8 }, (_, i) => i * 700), // each one lands in the fade of the last
			Array.from({ length: 30 }, () => Math.floor(rand() * 6000)).sort((a, b) => a - b)
		];
		for (const dt of [1000 / 144, HZ60, 1000 / 30]) {
			for (const events of trains) {
				const v = walk(CALM_VIGNETTE, events, 8000, dt);
				expect(maxAbs(steps(v))).toBeLessThanOrEqual((CALM_VIGNETTE.peak * dt) / CALM_VIGNETTE.rise + EPS);
				expect(Math.max(...v)).toBeLessThanOrEqual(CALM_VIGNETTE.peak + EPS);
				expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
			}
		}
		// At 60 Hz that is under 5% of full opacity per frame.
		expect((CALM_VIGNETTE.peak * HZ60) / CALM_VIGNETTE.rise).toBeLessThan(0.05);
	});

	it('repeated hits do not pulse: the edge stays up and a hit in the fade continues from the level it finds', () => {
		// Automatic fire: once up, it stays at the peak until the fire stops (the old curve dipped on every hit).
		const fire = walk(CALM_VIGNETTE, Array.from({ length: 30 }, (_, i) => i * 100), 3000);
		const up = fire.findIndex((l) => l >= CALM_VIGNETTE.peak - EPS);
		const until = Math.floor(2900 / HZ60);
		expect(Math.min(...fire.slice(up, until))).toBeCloseTo(CALM_VIGNETTE.peak, 9);
		// A second hit 500 ms later, halfway down: it turns up again from there, never from zero.
		const two = walk(CALM_VIGNETTE, [0, 500], 1500);
		const at500 = Math.ceil(500 / HZ60);
		expect(two[at500 - 1]!).toBeGreaterThan(0.2);
		expect(two[at500]!).toBeGreaterThan(two[at500 - 1]! - EPS);
		expect(Math.min(...two.slice(at500 - 1, at500 + 12))).toBeGreaterThan(0.2);
	});

	it('a hitch does not turn the ease into a jump; a cue that was not shown for a while starts from nothing', () => {
		const level = new CalmLevel(CALM_VIGNETTE);
		const most = (CALM_VIGNETTE.peak * CALM_MAX_STEP_MS) / CALM_VIGNETTE.rise;
		expect(level.at(1000, 1000)).toBe(0);
		// A 400 ms frame, the hit 200 ms old: one capped step up, not the whole way.
		const a = level.at(1400, 1200);
		expect(a).toBeGreaterThan(0);
		expect(a).toBeLessThanOrEqual(most + EPS);
		// Up to the peak under steady hits, then not asked for 5 s (spectating): the old level is gone when it is shown again.
		let t = 1400;
		while (t < 1650) level.at((t += HZ60), t - 5);
		expect(level.at((t += HZ60), t - 5)).toBeCloseTo(CALM_VIGNETTE.peak, 9);
		t += 5000;
		const back = level.at(t, t - 5);
		expect(back).toBeGreaterThan(0);
		expect(back).toBeLessThanOrEqual((CALM_VIGNETTE.peak * 5) / CALM_VIGNETTE.rise + EPS); // it rose for the 5 ms the hit is old
		// The same frame asked twice does not advance it, and a frame time that runs backwards changes nothing.
		const now = level.at(t + HZ60, t);
		expect(level.at(t + HZ60, t)).toBe(now);
		expect(level.at(t, t)).toBe(now);
	});

	it('an event stamped just after the HUD clock (age < 0) counts as just happened; no event is nothing', () => {
		const one = (CALM_VIGNETTE.peak * HZ60) / CALM_VIGNETTE.rise;
		expect(calmStep(0, 100, HZ60, CALM_VIGNETTE)).toBeCloseTo(one, 9);
		// The old curve returned full strength for a negative age (fadeOpacity does); this one takes its one step.
		expect(fadeOpacity(-4, 80, 420)).toBe(1);
		expect(calmStep(0, -4, HZ60, CALM_VIGNETTE)).toBeCloseTo(one, 9);
		expect(calmStep(0.2, Infinity, HZ60, CALM_VIGNETTE)).toBeLessThan(0.2);
		expect(calmStep(0.2, Number.NaN, HZ60, CALM_VIGNETTE)).toBeLessThan(0.2);
		expect(calmStep(0.2, 100, 0, CALM_VIGNETTE)).toBe(0.2);
		expect(calmStep(0.2, 100, -5, CALM_VIGNETTE)).toBe(0.2);
		const level = new CalmLevel(CALM_VIGNETTE);
		expect(level.at(1000, 0)).toBe(0);
		expect(level.at(1016, 0)).toBe(0);
	});
});

describe('reduced motion: hit marker and flash banner (one slot each, re-triggered)', () => {
	it('they ease in, and no frame changes them by more than dt / rise', () => {
		const rand = rng(11);
		for (const cue of [CALM_HIT, CALM_FLASH]) {
			expect(cue.peak).toBe(1);
			expect(cue.rise).toBeGreaterThanOrEqual(CALM_IN_MS);
			const events = Array.from({ length: 40 }, () => Math.floor(rand() * 9000)).sort((a, b) => a - b);
			for (const dt of [1000 / 144, HZ60, 1000 / 30]) {
				const v = walk(cue, events, 12_000, dt);
				expect(maxAbs(steps(v))).toBeLessThanOrEqual(dt / cue.rise + EPS);
			}
			expect(walk(cue, [0], 100)[1]!).toBeLessThan(0.15);
		}
	});

	it('the hit marker holds steady under automatic fire (an eased curve of the age alone would blink at the fire rate)', () => {
		// 15 hits a second: each hit restarts the age.
		const v = walk(CALM_HIT, Array.from({ length: 45 }, (_, i) => i * 66), 2900);
		const up = v.findIndex((l) => l >= 1 - EPS);
		expect(up * HZ60).toBeLessThan(CALM_HIT.rise + 2 * HZ60);
		expect(Math.min(...v.slice(up))).toBeCloseTo(1, 9);
		// A slower gun: each hit turns the marker up from where it is, it never drops out first.
		const slow = walk(CALM_HIT, [0, 250, 500, 750], 1000);
		const d = steps(slow);
		for (let i = 1; i < d.length; i++) if (d[i]! > EPS && d[i - 1]! < -EPS) expect(slow[i]!).toBeGreaterThan(0);
	});

	it('they are gone when the client drops them: 400 ms for a hit marker, 3 s for a flash, like the normal curves', () => {
		expect(CALM_HIT.hold + CALM_HIT.fall).toBeLessThanOrEqual(400);
		expect(walk(CALM_HIT, [0], 400).at(-1)!).toBeLessThan(0.05);
		// The flash keeps its normal timing: 2 s up, 0.8 s fade.
		expect(CALM_FLASH.hold).toBe(2000);
		expect(CALM_FLASH.fall).toBe(800);
		expect(fadeOpacity(CALM_FLASH.hold + CALM_FLASH.fall, 2000, 800)).toBe(0);
		// A new flash while one is up changes the text, not the level.
		const two = walk(CALM_FLASH, [0, 1200], 2000);
		expect(Math.min(...two.slice(Math.ceil((CALM_FLASH.rise + HZ60) / HZ60)))).toBeCloseTo(1, 9);
	});
});

describe('reduced motion: cues with their own timestamp (arcs, popups, timed labels)', () => {
	/** The curve sampled every 60 Hz frame from before its event to after its end. */
	const sample = (f: (age: number) => number, life: number): number[] => {
		const out: number[] = [];
		for (let age = -50; age <= life + 50; age += HZ60) out.push(f(age));
		return out;
	};

	it('calmIn: nothing at the event (or before it), full after CALM_IN_MS, a sixth per frame at most', () => {
		expect(calmIn(-5)).toBe(0);
		expect(calmIn(0)).toBe(0);
		expect(calmIn(Number.NaN)).toBe(0);
		expect(calmIn(CALM_IN_MS / 2)).toBeCloseTo(0.5, 9);
		expect(calmIn(CALM_IN_MS)).toBe(1);
		expect(calmIn(5000)).toBe(1);
		expect(HZ60 / CALM_IN_MS).toBeLessThan(1 / 6);
	});

	it('hit arcs and score popups ease in; after that they are the normal curves', () => {
		const curves: [string, (age: number, reduced?: boolean) => number, number][] = [
			['arc', (age, r) => hurtDirOpacity(age, false, r), INF_HURT_MS],
			['lethal arc', (age, r) => hurtDirOpacity(age, true, r), INF_HURT_LETHAL_MS],
			['popup', (age, r) => popOpacity(age, r), INF_POP_MS]
		];
		for (const [name, f, life] of curves) {
			// Normal: there at once (unchanged).
			expect(f(0), name).toBe(1);
			expect(f(0, false), name).toBe(1);
			// Reduced: from nothing, in small steps, never above the normal curve, identical once eased in.
			expect(f(0, true), name).toBe(0);
			expect(f(-3, true), name).toBe(0);
			const v = sample((age) => f(age, true), life);
			expect(maxAbs(steps(v)), name).toBeLessThanOrEqual(HZ60 / CALM_IN_MS + EPS);
			expect(Math.max(...v), name).toBe(1);
			expect(v.at(-1), name).toBe(0);
			for (let age = 0; age <= life; age += 7) {
				expect(f(age, true), name).toBeLessThanOrEqual(f(age) + EPS);
				if (age >= CALM_IN_MS) expect(f(age, true), name).toBe(f(age));
			}
		}
	});

	it('timed labels (perk toast, +20s, +AMMO, UAV line): in over CALM_IN_MS, out over CALM_OUT_MS, gone at their lifetime', () => {
		for (const life of [1500, 1600, 1800, 3000]) {
			expect(calmCueOpacity(0, life)).toBe(0);
			expect(calmCueOpacity(-1, life)).toBe(0);
			expect(calmCueOpacity(CALM_IN_MS, life)).toBe(1);
			expect(calmCueOpacity(life / 2, life)).toBe(1);
			expect(calmCueOpacity(life - CALM_OUT_MS, life)).toBe(1);
			expect(calmCueOpacity(life - CALM_OUT_MS / 2, life)).toBeCloseTo(0.5, 9);
			expect(calmCueOpacity(life, life)).toBe(0);
			expect(calmCueOpacity(life + 1000, life)).toBe(0);
			const v = sample((age) => calmCueOpacity(age, life), life);
			expect(maxAbs(steps(v))).toBeLessThanOrEqual(HZ60 / Math.min(CALM_IN_MS, CALM_OUT_MS) + EPS);
			// One swell: it rises, holds and falls once.
			const d = steps(v);
			const firstDown = d.findIndex((x) => x < -EPS);
			expect(d.slice(firstDown).every((x) => x <= EPS)).toBe(true);
		}
	});

	it('normal motion keeps its curves: the hit marker and the popups are there at once', () => {
		expect(hitOpacity(0, 'body')).toBe(1);
		expect(hitOpacity(0, 'kill')).toBe(1);
		expect(popOpacity(0)).toBe(1);
		expect(hurtDirOpacity(0, true)).toBe(1);
	});
});
