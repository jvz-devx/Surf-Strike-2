/**
 * The tests of fp-contact.test.ts and fp-contact-rifles.test.ts (two files, so they run side by side).
 * Nothing clips (render/fp-testkit.ts), measured over the whole of every reload, the sniper's bolt and a shot, blends between two poses
 * included, on the shipped meshes: hands and forearms against the gun with its parts where they are, hand against hand,
 * the magazine against the gun on its track and off it, everything against the near plane, the screen centre and the ends of the sleeves.
 * `FP_CONTACT_STEPS`, `FP_CONTACT_FINE` (between close keys) and `FP_CONTACT_SPACING` measure finer, `FP_CONTACT_REPORT` prints the
 * deepest of each. After a change to a clip, a hand pose or a gun run these files once with FP_CONTACT_FINE=0.0025 (about 8 minutes).
 */
import { describe, expect, it } from 'vitest';
import { restVmFeel } from '../game/gunfeel.js';
import { FP_BOLTS, type Clip } from './fp-clips.js';
import { GUNS, holds, keyPhases, phases, poseReload, poseShot, Probe, reloadClip, type Measured } from './fp-testkit.js';

/** Deepest a hand or a forearm may be: on a named pose, and in a blend between two; a magazine on its track, and off it. Model units (about 2.3 cm). */
const HOLD = 0.1;
const BLEND = 0.25;
const env = (name: string, value: number) => Number(process.env[name] ?? value);
const STEPS = env('FP_CONTACT_STEPS', 60);
const FINE = env('FP_CONTACT_FINE', 0.015);
const SPACING = env('FP_CONTACT_SPACING', 0.4);

const probes = new Map<string, Promise<Probe>>();
const probeOf = (id: (typeof GUNS)[number]): Promise<Probe> => {
	let p = probes.get(id);
	if (!p) probes.set(id, (p = Probe.of(id, SPACING)));
	return p;
};

function check(label: string, m: Measured, hold: { r: boolean; l: boolean }, loose: boolean): void {
	for (const s of ['r', 'l'] as const) {
		const limit = hold[s] ? HOLD : BLEND;
		expect(m.hand[s].depth, label + ' hand ' + s + ', ' + m.hand[s].at).toBeLessThanOrEqual(limit);
		expect(m.arm[s].depth, label + ' arm ' + s + ', ' + m.arm[s].at).toBeLessThanOrEqual(limit);
	}
	expect(m.hands.depth, label + ' hand in hand, ' + m.hands.at).toBeLessThanOrEqual(hold.r && hold.l ? HOLD : BLEND);
	expect(m.mag.depth, label + ', ' + m.mag.at).toBeLessThanOrEqual(loose ? BLEND : HOLD);
	expect(m.near, label + ' cut by the near plane').toBe(0);
	expect(m.centre, label + ' in the screen centre').toBe('');
	expect(m.sleeve, label + ' sleeve end in view').toBe('');
}

class Worst {
	private readonly all = new Map<string, { d: number; at: string }>();
	add(key: string, d: number, at: string): void {
		if (d > (this.all.get(key)?.d ?? -1)) this.all.set(key, { d, at });
	}
	print(label: string): void {
		if (process.env.FP_CONTACT_REPORT) console.log(label, [...this.all].map(([k, v]) => k + ' ' + v.d.toFixed(3) + ' ' + v.at).join(' | '));
	}
}

function run(probe: Probe, label: string, clip: Clip | null, pose: (p: number) => void, steps: number): void {
	const worst = new Worst();
	for (const p of [...phases(steps), ...(clip ? keyPhases(clip, FINE) : [])]) {
		pose(p);
		const m = probe.measure();
		const hold = { r: !clip || holds(clip, 'r', p), l: !clip || holds(clip, 'l', p) };
		for (const s of ['r', 'l'] as const) worst.add('hand ' + s + (hold[s] ? ' held' : ' blend'), m.hand[s].depth, p.toFixed(3) + ' ' + m.hand[s].at);
		for (const s of ['r', 'l'] as const) worst.add('arm ' + s, m.arm[s].depth, p.toFixed(3));
		worst.add('hand in hand', m.hands.depth, p.toFixed(3));
		worst.add('magazine' + (probe.loose ? ' loose' : ' on its track'), m.mag.depth, p.toFixed(3) + ' ' + m.mag.at);
		check(label + ' at ' + p.toFixed(3), m, hold, probe.loose);
		const t = clip?.times;
		// While there is no magazine, the hand that went for the next one is off the screen.
		if (t && p >= t.stow && p < t.fresh) expect(m.leftSeen, label + ' at ' + p.toFixed(3) + ': the hand without a magazine is seen').toBe(false);
	}
	worst.print(label);
}

export function contactTests(ids: readonly (typeof GUNS)[number][]): void {
	describe.each(ids)('%s', (id) => {
		it('reload of an empty gun', async () => {
			const probe = await probeOf(id);
			run(probe, id + ' empty', reloadClip(id, true), (p) => poseReload(probe, p, true), STEPS);
		}, 240_000);

		it('reload with a round left', async () => {
			const probe = await probeOf(id);
			run(probe, id + ' loaded', reloadClip(id, false), (p) => poseReload(probe, p, false), STEPS);
		}, 240_000);

		// A finger was in the receiver for 3 thousandths of this clip, between two steps.
		if (id === 'lmg')
			it('the left hand leaves the closed cover clear of the receiver', async () => {
				const probe = await probeOf(id);
				for (let p = 0.9; p < 0.985; p += 0.001) {
					poseReload(probe, p, false);
					const m = probe.measure();
					expect(m.hand.l.depth, p.toFixed(3) + ' ' + m.hand.l.at).toBeLessThanOrEqual(BLEND);
				}
			}, 120_000);

		it('a shot, the last one too, and the bolt', async () => {
			const probe = await probeOf(id);
			const bolt = FP_BOLTS[id];
			if (bolt) run(probe, id + ' bolt', bolt, (p) => poseShot(probe, p * 900, 3), STEPS);
			else for (const mag of [3, 0]) run(probe, id + ' shot, ' + mag + ' left', null, (p) => poseShot(probe, p * 200, mag), STEPS / 2);
		}, 240_000);

		it('drawn: the left hand comes up to the fore-end clear of the gun', async () => {
			const probe = await probeOf(id);
			for (const lower of phases(12)) {
				probe.z.clear();
				probe.z.setWeapon(id);
				probe.z.updateViewmodel(5000, true, 1, 0, { ...restVmFeel(), lower }, 5);
				const m = probe.measure();
				check(id + ' lowered ' + lower.toFixed(2), m, { r: true, l: false }, false);
			}
		}, 120_000);

		it('a reload cut short: the way back has nothing cut off and nothing in the screen centre', async () => {
			const probe = await probeOf(id);
			const t = reloadClip(id, true).times!;
			for (const at of [t.out + 0.04, (t.stow + t.fresh) / 2, t.seat - 0.03, 0.88])
				for (const d of [0, 30, 60, 90, 120, 150]) {
					probe.z.clear();
					probe.z.setWeapon(id);
					probe.z.updateViewmodel(5000, true, at, 0, restVmFeel(), 0);
					probe.z.updateViewmodel(5016, true, 1, 0, restVmFeel(), 0);
					probe.z.updateViewmodel(5016 + d, true, 1, 0, restVmFeel(), 0);
					const m = probe.measure();
					expect(m.near, id + ' ' + at + ' + ' + d).toBe(0);
					expect(m.sleeve, id + ' ' + at + ' + ' + d).toBe('');
					expect(m.centre, id + ' ' + at + ' + ' + d).toBe('');
				}
		}, 120_000);
	});
}
