/**
 * First-person reload, bolt and cycle data (render/fp-clips.ts), without a gun: the order and the times of third person,
 * no jumps, nothing longer than the real reload or the fire interval, a rest pose at both ends.
 */
import { INF_SLEIGHT_RELOAD_FACTOR, INF_SPECIALIST_CADENCE_FACTOR, WEAPONS } from '@surf/shared';
import { describe, expect, it } from 'vitest';
import { BOLT_SECS, RELOADS } from './character/reload.js';
import { BELT_ROUNDS, beltRounds, BOLT_MS, Curve, CYCLES, cycleAt, drawHand, FP_BOLTS, FP_RELOADS, MAG_IN_LEAD_MS, newSample, triggerAt, type Clip } from './fp-clips.js';
import { GUN_PARTS, partSteps, type GunId } from './gun-rig.js';
import { HAND_POSE_DATA } from './hand-pose-data.js';

const GUNS = Object.keys(GUN_PARTS) as GunId[];
const VARIANTS = ['empty', 'loaded'] as const;
const CLIPS: [string, GunId, Clip, number][] = [
	...GUNS.flatMap((id) => VARIANTS.map((v): [string, GunId, Clip, number] => [id + ' ' + v, id, FP_RELOADS[id][v], WEAPONS[id].reloadMs])),
	['sniper bolt', 'sniper', FP_BOLTS.sniper!, BOLT_MS]
];
/** Fastest a gun may be moved (viewmodel units/s) and turned (rad/s), a magazine on screen (model units/s), at the normal reload time. */
const GUN_SPEED = 36;
const GUN_TURN = 8;
const MAG_SPEED = 140;
/** The pistol's falls out of the grip. */
const FALL_SPEED = 200;

describe('the same moves at the same moments as other players see', () => {
	it.each(GUNS)('%s: magazine out, away, back and seated', (id) => {
		const tp = RELOADS[id]!.mag!;
		for (const v of VARIANTS) {
			const fp = FP_RELOADS[id][v].times!;
			expect(fp.out).toBe(tp.out);
			expect(fp.fresh).toBe(tp.fresh);
			expect(fp.seat).toBe(tp.seat);
			// The pistol's magazine falls: other players see it go, I see it off the screen before the next comes.
			if (!tp.drop) expect(fp.stow).toBe(tp.stow);
			else expect(fp.stow).toBeGreaterThan(tp.out);
		}
	});

	it('the bolt, the slide, the handle and the cover move when the third-person ones do', () => {
		const at = (c: Clip, part: 'bolt' | 'cover', p: number) => c.at(p, newSample())[part][0]!;
		const full = (c: Clip, part: 'bolt' | 'cover') => c.def[part]!.filter((k) => k.to[0] === 1).map((k) => k.t);
		expect(full(FP_RELOADS.pistol.empty, 'bolt')).toEqual([0.83]);
		expect(at(FP_RELOADS.pistol.empty, 'bolt', 0.86)).toBe(0);
		expect(full(FP_RELOADS.barrett.empty, 'bolt')).toEqual([0.87]);
		expect(at(FP_RELOADS.barrett.empty, 'bolt', 0.89)).toBe(0);
		expect(FP_RELOADS.sniper.empty.def.bolt!.map((k) => k.t)).toEqual([0.09, 0.12, 0.17, 0.82, 0.89, 0.92]);
		expect(full(FP_RELOADS.lmg.empty, 'cover')[0]).toBe(0.21);
		expect(at(FP_RELOADS.lmg.loaded, 'cover', 0.86)).toBe(0);
		expect(FP_BOLTS.sniper!.def.bolt!.map((k) => k.t)).toEqual([0.3, 0.4, 0.55, 0.58, 0.75, 0.84]);
		expect(BOLT_MS).toBe(BOLT_SECS * 1000);
	});
});

describe('order', () => {
	it('magazine out, off screen, in, seated, and only then what closes', () => {
		for (const id of GUNS)
			for (const v of VARIANTS) {
				const c = FP_RELOADS[id][v];
				const t = c.times!;
				expect(0 < t.out && t.out < t.stow && t.stow <= t.fresh && t.fresh < t.seat && t.seat < 1, id + ' ' + v).toBe(true);
				const s = newSample();
				expect(c.at(t.out - 1e-3, s).mag[0]).toBe(0);
				expect(c.at((t.stow + t.fresh) / 2, s).magShown, id).toBe(false);
				expect(c.at(t.stow - 1e-3, s).magShown).toBe(true);
				expect(c.at(t.fresh, s).magShown).toBe(true);
				expect(c.at(t.seat, s).mag[0], id).toBe(0);
				for (let i = 1; i < 7; i++) expect(c.at(t.seat, s).mag[i], id).toBe(0);
				// The sounds come in the order of the moves; the last is inside the reload.
				const times = c.cues.map((k) => k.t);
				expect(times).toEqual([...times].sort((a, b) => a - b));
				expect(c.cues[0]).toEqual({ t: 0, sound: 'handle' });
				expect(c.cues.find((k) => k.sound === 'magOut')!.t).toBe(t.out);
				expect(c.cues.find((k) => k.sound === 'magIn')!.t).toBe(t.seat);
				expect(times.at(-1)).toBeLessThan(1);
				expect(t.seat * WEAPONS[id].reloadMs * INF_SLEIGHT_RELOAD_FACTOR).toBeGreaterThan(MAG_IN_LEAD_MS);
			}
	});

	it('an empty gun ends with its bolt, slide or handle; with a round left only the sniper works its bolt', () => {
		for (const id of GUNS) {
			const part = partSteps(id, 'slide').length ? 'slide' : 'bolt';
			expect(partSteps(id, part).length, id).toBeGreaterThan(0);
			const works = (c: Clip) => !!c.def.bolt?.some((k) => k.to.at(-1)! > 0);
			expect(works(FP_RELOADS[id].empty), id).toBe(true);
			expect(works(FP_RELOADS[id].loaded), id).toBe(id === 'sniper');
			// Worked after the magazine is in, all but the sniper's, which opens first.
			const first = FP_RELOADS[id].empty.def.bolt!.find((k) => k.to.at(-1) === 1)!.t;
			if (id !== 'sniper') expect(first, id).toBeGreaterThan(FP_RELOADS[id].empty.times!.seat);
			expect(FP_RELOADS[id].empty.cues.at(-1)!.sound).toBe('reloadDone');
		}
		// The LMG: cover up, belt and box off, new box, belt in, cover down.
		const lmg = FP_RELOADS.lmg.empty;
		const t = lmg.times!;
		const s = newSample();
		expect(lmg.at(t.out, s).cover[0]).toBe(1);
		expect(lmg.at(t.out, s).belt[0]).toBeGreaterThan(0);
		expect(lmg.at(t.seat, s).cover[0]).toBe(1);
		expect(lmg.at(0.78, s).belt[0]).toBe(0);
		expect(lmg.at(0.87, s).cover[0]).toBe(0);
	});
});

describe('continuity', () => {
	it.each(CLIPS)('%s starts and ends at rest', (_, id, c) => {
		const s = newSample();
		for (const p of [0, 1]) {
			c.at(p, s);
			for (const v of s.gun) expect(v).toBe(0);
			// An empty pistol's slide is already back.
			expect(s.bolt[0]).toBe(p === 0 && id === 'pistol' && c === FP_RELOADS.pistol.empty ? CYCLES.pistol!.lock : 0);
			for (const v of [...s.cover, ...s.belt, ...s.mag]) expect(v).toBe(0);
			expect(s.magShown).toBe(true);
			expect(s.hang).toBe(false);
		}
		for (const [track, side, rest] of [
			[c.left, 'l', HAND_POSE_DATA[id]!.rest.l],
			[c.right, 'r', HAND_POSE_DATA[id]!.rest.r]
		] as const) {
			if (!track) continue;
			const first = track.keys[0]!;
			const last = track.keys.at(-1)!;
			if (rest) {
				for (const k of [first, last]) {
					expect(k.pose).toBe(rest);
					expect(k.off ?? k.turn ?? k.open).toBeUndefined();
				}
			} else expect(first.hide && last.hide, 'the pistol: the second hand is away').toBe(true);
			for (let i = 1; i < track.keys.length; i++) expect(track.keys[i]!.t).toBeGreaterThan(track.keys[i - 1]!.t);
			// Only poses the gun has, of the hand that has them.
			for (const k of track.keys) expect(HAND_POSE_DATA[id]!.poses[k.pose]!.side, k.pose).toBe(side);
		}
	});

	it.each(CLIPS)('%s never jumps: gun and magazine stay under their speeds', (_, id, c, ms) => {
		const N = 4000;
		const dt = ms / 1000 / N;
		let a = c.at(0, newSample());
		let b = newSample();
		let gun = 0;
		let turn = 0;
		let mag = 0;
		for (let i = 1; i <= N; i++) {
			b = c.at(i / N, b);
			const d = (k: 'gun' | 'mag', from: number) => Math.hypot(...[0, 1, 2].map((j) => b[k][from + j]! - a[k][from + j]!)) / dt;
			gun = Math.max(gun, d('gun', 0));
			turn = Math.max(turn, d('gun', 3));
			if (a.magShown && b.magShown) mag = Math.max(mag, d('mag', 1));
			[a, b] = [b, a];
		}
		expect(gun).toBeLessThan(GUN_SPEED);
		expect(turn).toBeLessThan(GUN_TURN);
		expect(mag).toBeLessThan(id === 'pistol' ? FALL_SPEED : MAG_SPEED);
	});

	it('the curve of the gun goes through its keys and never past them', () => {
		const c = new Curve([[0, 0], [0.2, 1], [0.6, 1], [1, 0]]);
		const out = new Float64Array(1);
		for (const [t, v] of [[0, 0], [0.2, 1], [0.4, 1], [0.6, 1], [1, 0]] as const) {
			c.at(t, out);
			expect(out[0]).toBeCloseTo(v, 12);
		}
		for (let t = 0; t <= 1; t += 0.01) {
			c.at(t, out);
			expect(out[0]).toBeGreaterThanOrEqual(-1e-12);
			expect(out[0]).toBeLessThanOrEqual(1 + 1e-12);
		}
	});
});

describe('cycling', () => {
	it('a bolt or slide is back within the fire interval, the fastest one too', () => {
		for (const id of GUNS) {
			const c = CYCLES[id];
			if (id === 'sniper') {
				expect(c).toBeUndefined();
				expect(BOLT_MS).toBeLessThan(WEAPONS.sniper.fireMs * INF_SPECIALIST_CADENCE_FACTOR);
				continue;
			}
			expect(c!.ms, id).toBeLessThan(WEAPONS[id].fireMs * INF_SPECIALIST_CADENCE_FACTOR);
			expect(cycleAt(c!, -1, false)).toBe(0);
			expect(cycleAt(c!, c!.ms, false)).toBe(0);
			let top = 0;
			let last = 0;
			for (let t = 0; t <= c!.ms; t += 0.5) {
				const v = cycleAt(c!, t, false);
				expect(Math.abs(v - last)).toBeLessThan(0.1);
				top = Math.max(top, last = v);
			}
			expect(top).toBeCloseTo(c!.to, 2);
			// Seen at 60 frames a second whenever the frame falls.
			for (let phase = 0; phase < 16.6; phase += 1) expect(Math.max(...[0, 16.7, 33.4].map((f) => cycleAt(c!, phase + f, false))), id).toBeGreaterThan(0.3);
		}
	});

	it('the pistol locks back on its last round, the others close', () => {
		for (const id of GUNS) {
			const c = CYCLES[id];
			if (c) expect(cycleAt(c, 10_000, true), id).toBe(id === 'pistol' ? CYCLES.pistol!.lock : 0);
		}
		expect(CYCLES.pistol!.lock).toBeGreaterThan(0.5);
		expect(FP_RELOADS.pistol.empty.def.bolt![0]!.to[0]).toBe(CYCLES.pistol!.lock);
	});

	it('the trigger goes in, is held and comes out', () => {
		expect(triggerAt(-5, 60)).toBe(0);
		expect(triggerAt(30, 60)).toBe(1);
		expect(triggerAt(60, 60)).toBe(1);
		expect(triggerAt(500, 60)).toBe(0);
		for (let t = 0; t < 200; t++) expect(Math.abs(triggerAt(t + 1, 60) - triggerAt(t, 60))).toBeLessThan(0.1);
	});

	it('the belt runs short with the magazine', () => {
		expect(beltRounds(100)).toBe(BELT_ROUNDS);
		expect(beltRounds(BELT_ROUNDS)).toBe(BELT_ROUNDS);
		expect(beltRounds(3)).toBe(3);
		expect(beltRounds(0)).toBe(0);
	});

	it('the left hand comes up to the gun while it is drawn', () => {
		expect(drawHand(0)).toBeNull();
		expect(drawHand(1)![1]).toBeLessThan(-3);
		for (let l = 0; l < 1; l += 0.05) expect((drawHand(l)?.[1] ?? 0) >= (drawHand(l + 0.05)?.[1] ?? 0)).toBe(true);
	});
});
