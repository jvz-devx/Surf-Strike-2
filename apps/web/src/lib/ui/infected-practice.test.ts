/**
 * Practice range hint: shown only while the range is open, with the keys of
 * the held weapon.
 */
import { describe, expect, it } from 'vitest';
import { INF_MOCK_SCENES, mockInfectedView } from './infected-mock.js';
import { PRACTICE_TITLE, practiceHint } from './infected-practice.js';

const keys = (v: Parameters<typeof practiceHint>[0]) => practiceHint(v)?.keys.map((k) => `${k.key} ${k.label}`) ?? null;

describe('practiceHint', () => {
	it('only while the practice range is open', () => {
		expect(practiceHint({ practice: true, phase: 'solo', weapon: 'lmg' })).not.toBeNull();
		expect(practiceHint({ practice: true, phase: 'waiting', weapon: 'lmg' })?.title).toBe(PRACTICE_TITLE);
		// Waiting without the range (before the server's first state, or a client without it).
		expect(practiceHint({ practice: false, phase: 'waiting', weapon: 'lmg' })).toBeNull();
		expect(practiceHint({ phase: 'solo', weapon: 'lmg' })).toBeNull();
		for (const phase of ['grace', 'playing', 'ended'] as const) expect(practiceHint({ practice: true, phase, weapon: 'lmg' })).toBeNull();
		expect(practiceHint({ practice: true, phase: 'waiting', spectating: true, weapon: 'lmg' })).toBeNull();
	});

	it('names the keys of the held weapon', () => {
		expect(keys({ practice: true, phase: 'solo', weapon: 'lmg' })).toEqual(['LMB Fire', 'RMB Aim', 'R Reload', '1 2 3 Weapons', '4 Next primary']);
		for (const weapon of ['pistol', 'smg', 'striker'] as const) expect(keys({ practice: true, phase: 'solo', weapon }), weapon).toContain('RMB Aim');
		expect(keys({ practice: true, phase: 'solo', weapon: 'barrett' })).toEqual(['LMB Fire', 'RMB Scope', 'R Reload', '1 2 3 Weapons', '4 Next primary']);
		expect(keys({ practice: true, phase: 'solo', weapon: 'sniper' })).toContain('RMB Scope');
		expect(keys({ practice: true, phase: 'solo', weapon: 'sniper' })).not.toContain('RMB Aim');
		expect(keys({ practice: true, phase: 'solo', weapon: 'knife' })).toEqual(['LMB Swing', '1 2 3 Weapons', '4 Next primary']);
	});

	it('mock scenes: only the practice scenes show it', () => {
		for (const scene of INF_MOCK_SCENES) {
			const hint = practiceHint(mockInfectedView(scene, 1000));
			if (scene === 'practice' || scene === 'practicescope') expect(hint, scene).not.toBeNull();
			else expect(hint, scene).toBeNull();
		}
	});
});
