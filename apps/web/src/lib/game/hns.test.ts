import { describe, expect, it } from 'vitest';
import { getMap, HNS_CVARS, HNS_KNIFE, HNS_NAMETAG_RANGE, type ClientMessage, type HnsModeState, type MapDef } from '@surf/shared';
import { HnsClient, type HnsHost, type HnsSound } from './hns.js';
import { hnsBlindfold, hnsCanSwing, hnsFrozen, hnsPhaseLabel, hnsTagVisible } from './hns-view.js';

describe('hns view helpers', () => {
	it('never shows hider tags to seekers; others only close and in sight', () => {
		expect(hnsTagVisible('seeker', 'hider', 50, true)).toBe(false);
		expect(hnsTagVisible('seeker', 'seeker', 50, true)).toBe(true);
		expect(hnsTagVisible('hider', 'seeker', 50, true)).toBe(true);
		expect(hnsTagVisible('hider', 'hider', 50, false)).toBe(false);
		expect(hnsTagVisible('hider', 'hider', HNS_NAMETAG_RANGE + 1, true)).toBe(false);
		expect(hnsTagVisible(null, 'hider', 100, true)).toBe(true);
	});

	it('freezes and blindfolds seekers while hiding; found players for their freeze time', () => {
		expect(hnsFrozen('seeker', 'hiding', 0, 0)).toBe(true);
		expect(hnsBlindfold('seeker', 'hiding')).toBe(true);
		expect(hnsFrozen('hider', 'hiding', 0, 0)).toBe(false);
		expect(hnsBlindfold('hider', 'hiding')).toBe(false);
		expect(hnsFrozen('seeker', 'seeking', 0, 0)).toBe(false);
		expect(hnsFrozen('seeker', 'seeking', 1000, 500)).toBe(true);
		expect(hnsBlindfold('seeker', 'seeking')).toBe(false);
	});

	it('lets seekers swing only while seeking, unfrozen, at the swing interval', () => {
		expect(hnsCanSwing('seeker', 'seeking', false, -Infinity, 0)).toBe(true);
		expect(hnsCanSwing('seeker', 'seeking', false, 0, HNS_KNIFE.swingMs - 1)).toBe(false);
		expect(hnsCanSwing('seeker', 'hiding', false, -Infinity, 0)).toBe(false);
		expect(hnsCanSwing('seeker', 'seeking', true, -Infinity, 0)).toBe(false);
		expect(hnsCanSwing('hider', 'seeking', false, -Infinity, 0)).toBe(false);
	});

	it('labels phases by role', () => {
		expect(hnsPhaseLabel('hiding', 'hider')).toMatch(/Hide!/);
		expect(hnsPhaseLabel('hiding', 'seeker')).toBe('Seekers released in');
		expect(hnsPhaseLabel('seeking', 'hider')).toBe('Stay hidden');
	});

	it('the mode profile caps air speed at 300 and keeps the 250 run speed', () => {
		expect(HNS_CVARS.sv_air_speed_cap).toBe(300);
		expect(HNS_CVARS.sv_maxspeed).toBe(250);
	});
});

function mapDef(): MapDef {
	const base = getMap('tag_quayside')!;
	return {
		...base,
		kind: 'hns',
		hns: {
			hiderSpawns: [{ pos: { x: 10, y: 0, z: 0 }, yaw: 0 }],
			seekerSpawns: [{ pos: { x: -10, y: 0, z: 0 }, yaw: 180 }]
		}
	};
}

function client() {
	const sent: ClientMessage[] = [];
	const sounds: HnsSound[] = [];
	const teleports: Array<{ x: number; yaw: number }> = [];
	const host: HnsHost = {
		online: () => true,
		selfId: () => 1,
		send: (m) => sent.push(m),
		name: (id) => (id === 1 ? 'Me' : `P${id}`),
		teleport: (pos, yaw) => teleports.push({ x: pos.x, yaw }),
		sound: (n) => sounds.push(n),
		viewmodel: () => null,
		viewId: () => 1
	};
	return { c: new HnsClient(host, mapDef()), sent, sounds, teleports };
}

const state = (phase: HnsModeState['phase'], seekers: number[], hiders: number[], extra: Partial<HnsModeState> = {}): HnsModeState => ({
	mode: 'hns',
	phase,
	round: 1,
	timeLeft: 30,
	seekers,
	hiders,
	winner: null,
	players: [...seekers.map((id) => ({ id, role: 'seeker' as const, finds: 0, survived: 0, frozen: 0 })), ...hiders.map((id) => ({ id, role: 'hider' as const, finds: 0, survived: 0, frozen: 0 }))],
	...extra
});

describe('HnsClient', () => {
	it('teleports and freezes on a spawn event; the hiding-phase seeker is blindfolded', () => {
		const { c, teleports } = client();
		c.onModeState(state('starting', [], [1, 2]), 0);
		c.onModeState(state('hiding', [1], [2]), 10);
		c.onEvent({ e: 'spawn', id: 1, role: 'seeker', pos: { x: -10, y: 0, z: 0 }, yaw: 180, freezeSecs: 45 }, 10);
		expect(teleports).toEqual([{ x: -10, yaw: 180 }]);
		expect(c.frozen(20)).toBe(true);
		const v = c.frame(20, true, 0);
		expect(v.role).toBe('seeker');
		expect(v.blindfold).toBe(true);
		expect(v.flash?.text).toMatch(/SEEKER/);
		// Spawn events for others are ignored.
		c.onEvent({ e: 'spawn', id: 2, role: 'hider', pos: { x: 99, y: 0, z: 0 }, yaw: 0, freezeSecs: 0 }, 30);
		expect(teleports).toHaveLength(1);
	});

	it('sends a knife swing only as an unfrozen seeker while seeking', () => {
		const { c, sent, sounds } = client();
		const eye = { x: 0, y: 0, z: 64 };
		c.onModeState(state('hiding', [1], [2]), 0);
		c.press(true, 100, eye, 0, 0);
		expect(sent).toHaveLength(0);
		c.onModeState(state('seeking', [1], [2]), 200);
		c.press(true, 300, eye, 0, 90);
		expect(sent).toHaveLength(1);
		const k = sent[0] as Extract<ClientMessage, { type: 'knife' }>;
		expect(k.type).toBe('knife');
		expect(k.dir.y).toBeCloseTo(1);
		c.press(true, 350, eye, 0, 0);
		expect(sent).toHaveLength(1);
		c.press(true, 300 + HNS_KNIFE.swingMs, eye, 0, 0);
		expect(sent).toHaveLength(2);
		expect(sounds.filter((s) => s === 'swing')).toHaveLength(2);
	});

	it('being found shows the notice and the kill feed, and freezes after the respawn', () => {
		const { c } = client();
		c.onModeState(state('seeking', [3], [1, 2]), 0);
		c.onEvent({ e: 'found', by: 3, target: 1, hidersLeft: 1 }, 100);
		c.onEvent({ e: 'spawn', id: 1, role: 'seeker', pos: { x: -10, y: 0, z: 0 }, yaw: 0, freezeSecs: 3 }, 100);
		c.onModeState(state('seeking', [1, 3], [2]), 120);
		const v = c.frame(150, true, 0);
		expect(v.flash?.text).toBe('You were found by P3 — you are now a seeker');
		expect(v.killFeed.map((k) => k.text)).toEqual(['P3 found Me']);
		expect(v.role).toBe('seeker');
		expect(v.hidersLeft).toBe(1);
		expect(v.frozenUntil).toBe(3100);
		expect(c.frozen(3000)).toBe(true);
		expect(c.frozen(3200)).toBe(false);
		expect(c.canRespawn()).toBe(false);
	});

	it('shows the round summary while ended', () => {
		const { c } = client();
		c.onModeState(state('seeking', [3], [1]), 0);
		c.onEvent({ e: 'end', round: 1, winner: 'hiders', survivors: [1], topSeeker: null }, 10);
		c.onModeState(state('ended', [3], [1], { winner: 'hiders' }), 20);
		const v = c.frame(30, true, 0);
		expect(v.summary).toEqual({ winner: 'hiders', survivors: ['Me'], top: null });
		expect(c.canRespawn()).toBe(true);
	});

	it('falls back to role spawns', () => {
		const { c } = client();
		expect(c.fallSpawn().pos.x).toBe(10);
		c.onModeState(state('seeking', [1], [2]), 0);
		expect(c.fallSpawn().pos.x).toBe(-10);
	});
});
