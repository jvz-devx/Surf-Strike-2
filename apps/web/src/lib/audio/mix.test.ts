import { describe, expect, it } from 'vitest';
import {
	Cycle,
	LAND_MIN_SPEED,
	MIX_LUFS,
	SWING_FAR,
	SWING_NEAR,
	VARIATION_DB,
	crashBuild,
	dbToGain,
	distanceDb,
	eventDb,
	landDb,
	levelDb,
	loopRegion,
	slideGain,
	stepAdvance,
	stepDb,
	variationDb,
	windParams
} from '#lib/audio/mix.js';
import { SFX_EVENTS } from '#lib/audio/sfx.js';

describe('Cycle', () => {
	it('visits every take in order before repeating', () => {
		const c = new Cycle(4);
		expect(Array.from({ length: 9 }, () => c.next())).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0]);
	});

	it('never plays the same take twice in a row for pools of 2+', () => {
		const c = new Cycle(3);
		let prev = c.next();
		for (let i = 0; i < 20; i++) {
			const n = c.next();
			expect(n).not.toBe(prev);
			prev = n;
		}
	});

	it('returns -1 for an empty pool', () => {
		expect(new Cycle(0).next()).toBe(-1);
	});

	it('repeated actions have pools of 3+ takes', () => {
		expect(SFX_EVENTS.step.length).toBeGreaterThanOrEqual(3);
		expect(SFX_EVENTS.jump.length).toBeGreaterThanOrEqual(3);
		expect(SFX_EVENTS.land.length).toBeGreaterThanOrEqual(3);
		expect(SFX_EVENTS.swing.length).toBeGreaterThanOrEqual(3);
		expect(SFX_EVENTS.hit.length).toBeGreaterThanOrEqual(3);
	});
});

describe('hide and seek knife sounds', () => {
	it('place the swing and hit at their mix levels', () => {
		expect(eventDb('swing')).toBeCloseTo(levelDb('swing', MIX_LUFS.swing));
		expect(eventDb('hit')).toBeCloseTo(levelDb('hit', MIX_LUFS.hit));
		expect(MIX_LUFS.hit).toBeGreaterThan(MIX_LUFS.swing);
	});

	it("fall off with distance and are silent far away (another seeker's swing)", () => {
		expect(distanceDb(0)).toBe(0);
		expect(distanceDb(SWING_NEAR)).toBe(0);
		expect(distanceDb(SWING_NEAR * 2)).toBeCloseTo(-6.02, 1);
		expect(distanceDb(SWING_NEAR * 4)).toBeCloseTo(-12.04, 1);
		expect(distanceDb(SWING_FAR)).toBeCloseTo(-18.06, 1);
		expect(distanceDb(SWING_FAR + 1)).toBeNull();
		expect(distanceDb(Number.NaN)).toBeNull();
	});
});

describe('variationDb', () => {
	it('stays within ±1.5 dB', () => {
		expect(VARIATION_DB).toBe(1.5);
		expect(variationDb(() => 0)).toBeCloseTo(-1.5);
		expect(variationDb(() => 0.5)).toBeCloseTo(0);
		expect(variationDb(() => 0.999999)).toBeCloseTo(1.5, 4);
		for (let i = 0; i < 1000; i++) {
			const v = variationDb();
			expect(v).toBeGreaterThanOrEqual(-1.5);
			expect(v).toBeLessThanOrEqual(1.5);
		}
	});

	it('clamps a misbehaving random source', () => {
		expect(variationDb(() => 7)).toBeCloseTo(1.5);
		expect(variationDb(() => -3)).toBeCloseTo(-1.5);
	});
});

describe('windParams', () => {
	it('is silent at rest and rises monotonically with speed', () => {
		expect(windParams(0).gain).toBe(0);
		expect(windParams(150).gain).toBe(0);
		let prev = { gain: 0, cutoff: 0 };
		for (let s = 200; s <= 2400; s += 100) {
			const p = windParams(s);
			expect(p.gain).toBeGreaterThan(prev.gain - 1e-12);
			expect(p.cutoff).toBeGreaterThan(prev.cutoff - 1e-9);
			prev = p;
		}
	});

	it('maps speed to a 400 Hz – 9 kHz low-pass and caps at full speed', () => {
		expect(windParams(0).cutoff).toBeCloseTo(400);
		expect(windParams(2000).cutoff).toBeCloseTo(9000);
		expect(windParams(5000)).toEqual(windParams(2000));
		expect(windParams(2000).gain).toBeCloseTo(Math.pow(10, levelDb('wind', MIX_LUFS.wind) / 20));
	});
});

describe('slideGain', () => {
	it('is zero unless surfing and louder with speed', () => {
		expect(slideGain(1000, false)).toBe(0);
		expect(slideGain(1500, true)).toBeGreaterThan(slideGain(0, true));
		expect(slideGain(3000, true)).toBeCloseTo(slideGain(1500, true));
	});
});

describe('landDb', () => {
	it('ignores soft landings and gets louder with fall speed (level only)', () => {
		expect(landDb(LAND_MIN_SPEED - 1)).toBeNull();
		const a = landDb(200)!;
		const b = landDb(500)!;
		const c = landDb(800)!;
		expect(b).toBeGreaterThan(a);
		expect(c).toBeGreaterThan(b);
		expect(landDb(5000)).toBeCloseTo(c);
		expect(c - landDb(LAND_MIN_SPEED)!).toBeLessThanOrEqual(MIX_LUFS.landMax - MIX_LUFS.landMin);
	});
});

describe('stepDb', () => {
	it('is softer when walking slowly', () => {
		expect(stepDb(250)).toBeGreaterThan(stepDb(100));
		expect(stepDb(400)).toBeCloseTo(stepDb(250));
	});
});

describe('loopRegion', () => {
	it('skips decoder priming silence and keeps the exact loop length', () => {
		const head = new Float32Array(48000);
		head.fill(0, 0, 2112);
		head.fill(0.1, 2112);
		const r = loopRegion(head, 48000, 16.6, 16.5);
		expect(r.start).toBeCloseTo(2112 / 48000);
		expect(r.end - r.start).toBeCloseTo(16.5);
	});

	it('starts at 0 when the decoder already trimmed priming, and clamps to the buffer', () => {
		const head = new Float32Array(4800).fill(0.2);
		expect(loopRegion(head, 48000, 10, 16.5)).toEqual({ start: 0, end: 10 });
	});
});

describe('stepAdvance', () => {
	it('caps footstep cadence at running speed', () => {
		expect(stepAdvance(200, 0.5)).toBe(100);
		expect(stepAdvance(2000, 0.5)).toBe(160);
	});
});

describe('crashBuild', () => {
	it('keeps rising in level, brightness and speed; starts soft, the timpani comes in later', () => {
		const at = [1, 1.3, 1.6, 2, 3, 5, 10, 30, 100].map((m) => crashBuild(m));
		for (let i = 1; i < at.length; i++) {
			expect(at[i]!.roll).toBeGreaterThan(at[i - 1]!.roll);
			expect(at[i]!.cutoff).toBeGreaterThan(at[i - 1]!.cutoff);
			expect(at[i]!.rate).toBeGreaterThan(at[i - 1]!.rate);
			expect(at[i]!.timpani).toBeGreaterThanOrEqual(at[i - 1]!.timpani);
		}
		expect(at[0]).toMatchObject({ timpani: 0, rate: 0.85 });
		expect(at[0]!.roll).toBeCloseTo(dbToGain(levelDb('roll', MIX_LUFS.rollMin)));
		expect(at[2]!.timpani).toBeGreaterThan(0);
		expect(at.at(-1)!.rate).toBeLessThan(2);
		expect(at.at(-1)!.cutoff).toBeLessThanOrEqual(16_000);
		expect(crashBuild(0.5)).toEqual(at[0]);
		expect(crashBuild(5, true).roll).toBeLessThan(crashBuild(5).roll / 2);
	});
});
