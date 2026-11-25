/**
 * Practice range target avatars (game/infected-practice.ts) with the real
 * scene objects: the infected look with a bare TARGET name tag, while real
 * players keep their role tags. Node has no canvas: a stub 2D context records
 * the text each tag draws.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeldAssets } from './character/held.js';
import { roleTop, topColor } from './players-testkit.js';
import { RemotePlayers } from './players.js';

/** Text of every name tag drawn, oldest first. */
const drawn: string[] = [];

beforeAll(() => {
	const ctx = {
		measureText: (s: string) => ({ width: s.length * 12 }),
		fillRect: () => {},
		strokeRect: () => {},
		strokeText: () => {},
		fillText: (s: string) => void drawn.push(s)
	};
	vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
});
afterAll(() => {
	vi.unstubAllGlobals();
});
beforeEach(() => {
	drawn.length = 0;
});

describe('practice target avatars', () => {
	it('a target wears the infected look under a bare TARGET tag', () => {
		const p = new RemotePlayers(new HeldAssets());
		p.upsert(-1001, 'TARGET');
		p.setTarget(-1001, true);
		p.setInfected(-1001, 'infected');
		p.setHeld(-1001, 'claws');
		// Every tag drawn for it reads TARGET: no role prefix.
		expect(drawn.length).toBeGreaterThan(0);
		expect(new Set(drawn)).toEqual(new Set(['TARGET']));
		expect(topColor(p.group)).toBe(roleTop('infected'));
		expect(p.model(-1001)!.getRole()).toBe('infected');
		expect(p.model(-1001)!.animator.posture).toBe('infected');
		expect(p.feedback(-1001)).toMatchObject({ held: 'claws' });
		p.dispose();
	});

	it('real players keep their role tags next to a target', () => {
		const p = new RemotePlayers(new HeldAssets());
		p.upsert(-1001, 'TARGET');
		p.setTarget(-1001, true);
		p.setInfected(-1001, 'infected');
		drawn.length = 0;
		p.upsert(2, 'Bob');
		p.setInfected(2, 'infected');
		expect(drawn).toEqual(['Bob', 'INFECTED · Bob']);
		drawn.length = 0;
		p.setInfected(2, 'alpha');
		p.setInfected(2, 'none');
		expect(drawn).toEqual(['PATIENT ZERO · Bob', 'Bob']);
		// Marking is per avatar and can be taken back.
		drawn.length = 0;
		p.setTarget(-1001, true);
		expect(drawn).toEqual([]);
		p.setTarget(-1001, false);
		expect(drawn).toEqual(['INFECTED · TARGET']);
		p.setTarget(99, true);
		expect(drawn).toEqual(['INFECTED · TARGET']);
		p.dispose();
	});
});
