/**
 * Dev-only sample data for InfectedHud.svelte (`?mockhud&mode=infected`):
 * one InfectedView per scene, with every timestamp relative to `now` so the
 * mock can re-issue it and keep popups, arcs and hit markers on screen.
 * `&scene=` picks one of INF_MOCK_SCENES (default `survivor`).
 *
 * A re-issue is the same events again, about once a second: a hit (vignette,
 * arcs), a hit of mine (hit marker) and a flash. Score popups and the timed
 * labels are shown mid-life instead, so they stand still, and the M.O.A.B.
 * detonation repeats only after its overlay has run out.
 */
import { infPerksForStreak, WEAPONS, type InfTeam, type WeaponId } from '@surf/shared';
import type { InfectedView, InfSpecView } from '#lib/game/contract.js';
import type { InfSummaryRow } from '#lib/game/infected-hud-events.js';

export const INF_MOCK_SCENES = [
	'survivor',
	'reload',
	'low',
	'empty',
	'emptypistol',
	'scope',
	'scopedry',
	'alpha',
	'infected',
	'down',
	'last',
	'stack',
	'moab',
	'ended',
	'ended2',
	'ended16',
	'ended32',
	'spec',
	'specended',
	'practice',
	'practicescope'
] as const;
export type InfMockScene = (typeof INF_MOCK_SCENES)[number];

/** Age (ms) of the popups and timed labels at a re-issue: past their entry, and a second later still before their fade. */
const MOCK_MID_MS = 250;
/** The detonation overlay runs 2.4 s: the mock detonates again after this (ms). */
const MOCK_NUKE_EVERY_MS = 3200;
let nukeAt = 0;

/** Detonation time for a view at `now`: the last one until its overlay is over, then a new one. */
function mockNukeAt(now: number): number {
	if (!(nukeAt > 0) || now < nukeAt || now - nukeAt >= MOCK_NUKE_EVERY_MS) nukeAt = now;
	return nukeAt;
}

export function isInfMockScene(s: string | null): s is InfMockScene {
	return INF_MOCK_SCENES.includes(s as InfMockScene);
}

/** Scenes that show the spectator bar. */
export function infMockSpectates(scene: InfMockScene): boolean {
	return scene === 'spec' || scene === 'specended';
}

const NAMES = ['glidepath', 'cirrus', 'boreal', 'you', 'Maximilian_the_Longest24', 'tern', 'halyard', 'fen', 'moraine', 'esker', 'tarn', 'kelp', 'scree', 'drift', 'brine', 'loess'];

function rows(n: number): InfSummaryRow[] {
	return Array.from({ length: n }, (_, i) => {
		const team: InfTeam = i % 3 === 0 ? 'survivor' : 'infected';
		return {
			id: i + 1,
			name: NAMES[i % NAMES.length]! + (i >= NAMES.length ? ` ${i + 1}` : ''),
			team,
			alpha: i === 1,
			score: Math.max(0, 2450 - i * 155),
			kills: team === 'survivor' ? Math.max(0, 14 - i) : i % 4,
			infections: team === 'infected' ? (i * 3) % 5 : 0,
			deaths: (i * 2) % 9,
			accuracy: i % 5 === 4 ? null : (i * 17 + 23) % 101,
			bestStreak: team === 'survivor' ? Math.max(0, 12 - i) : 0
		};
	});
}

function spec(now: number, team: InfTeam): InfSpecView {
	void now;
	return {
		id: 1,
		name: 'glidepath',
		team,
		alpha: false,
		hp: 4,
		maxHp: 5,
		alive: true,
		score: 1250,
		weapon: 'lmg',
		weaponLabel: WEAPONS.lmg.label,
		hasKnife: false,
		hasBeacon: false,
		streak: 5,
		perks: infPerksForStreak(5),
		moabReady: false
	};
}

/** Sample view of `scene` at `now` (performance.now()). */
export function mockInfectedView(scene: InfMockScene, now: number): InfectedView {
	// 'scopedry': fully scoped with an empty rifle and a flash (ammo prompt, popups and flash against the scope hairs).
	const scoped = scene === 'scope' || scene === 'scopedry';
	// 'stack': the 'last' header stack (M.O.A.B. banner, UAV line, flash) with hits from the front quarter.
	const last = scene === 'last' || scene === 'stack';
	const loadout: WeaponId = scoped || scene === 'practicescope' ? 'barrett' : 'lmg';
	const def = WEAPONS[loadout];
	const ended = scene === 'ended' || scene === 'ended2' || scene === 'ended16' || scene === 'ended32' || scene === 'specended';
	const infected = scene === 'infected' || scene === 'alpha' || scene === 'down';
	const team: InfTeam = infected ? 'infected' : 'survivor';
	const watching = infMockSpectates(scene);
	const dry = scene === 'empty' || scene === 'emptypistol' || scene === 'scopedry';
	const ammo = scene === 'reload' ? [14, 100] : scene === 'low' ? [22, 0] : dry ? [0, 0] : [64, 100];
	// 'emptypistol': the pistol is dry and the primary still has rounds (the widest prompt).
	const held: WeaponId = infected ? 'claws' : scene === 'emptypistol' ? 'pistol' : loadout;
	const feedback = !ended && !watching && scene !== 'moab';
	/** Popups and timed labels: mid-life (they would restart on every re-issue). Never 0 or less: that means "none". */
	const mid = Math.max(1, now - MOCK_MID_MS);
	const view: InfectedView = {
		phase: ended ? 'ended' : 'playing',
		round: 3,
		endsAt: now + (ended ? 5200 : last ? 11_000 : 84_000),
		team,
		alpha: scene === 'alpha',
		lastSurvivor: last,
		loadout,
		loadoutLabel: def.label,
		survivors: last ? 1 : 3,
		infected: last ? 5 : 3,
		hp: infected ? 3 : 5,
		maxHp: 5,
		alive: scene !== 'down',
		respawnAt: scene === 'down' ? now + 2400 : 0,
		weapon: held,
		weaponLabel: WEAPONS[held].label,
		mag: infected ? 0 : ammo[0]!,
		magSize: infected ? 0 : WEAPONS[held].magazine,
		reserve: infected ? 0 : ammo[1]!,
		reloadEndsAt: 0,
		reloadMs: def.reloadMs,
		hasKnife: infected && scene !== 'down',
		knifeOut: false,
		hasBeacon: infected,
		beaconDist: infected ? 23 : null,
		myScore: 1250,
		myKills: 9,
		myDeaths: 1,
		hitMarker: feedback ? { at: now, head: true, kill: true } : null,
		killFeed: [
			{ id: 3, text: 'You · Light machine gun · headshot › cirrus', head: true, mine: true, at: now },
			{ id: 2, text: '', head: false, mine: false, at: now, badge: { kind: 'bank', by: 'boreal', victim: 'Maximilian_the_Longest24' } },
			{ id: 1, text: 'glidepath · Patient Zero', head: false, mine: false, at: now }
		],
		flash: last
			? { text: 'M.O.A.B. INBOUND!', at: now, tone: 'infected' }
			: scene === 'moab'
				? { text: 'M.O.A.B. DETONATED! 5 eliminated', at: now, tone: 'bonus' }
				: scene === 'scopedry'
					? { text: 'Beacon destroyed! +50', at: now, tone: 'survivor' }
					: null,
		timeBonusAt: scene === 'survivor' ? mid : 0,
		scavengerAt: scene === 'survivor' ? mid : 0,
		hurtAt: feedback ? now : 0,
		uavAt: last || scene === 'infected' ? mid : 0,
		scoped,
		scopeT: scene === 'scope' ? 0.7 : undefined,
		summary: ended ? { winner: scene === 'ended2' ? 'infected' : 'survivors', secs: 151.4, survivorsLeft: scene === 'ended2' ? 0 : 3, top: 'glidepath (2450)' } : null,
		spectating: watching,
		spec: watching ? spec(now, 'survivor') : null,
		uavDist: scene === 'infected' ? 1400 : null,
		secondary: 'pistol',
		secondaryLabel: WEAPONS.pistol.label,
		streak: team === 'survivor' ? 5 : 0,
		perks: team === 'survivor' ? infPerksForStreak(5) : [],
		moabReady: scene === 'reload',
		moab: last ? { callerName: 'glidepath', endsAt: now + 6300 } : null,
		moabDetonatedAt: scene === 'moab' ? mockNukeAt(now) : 0,
		perkFlash: scene === 'survivor' ? { perk: 'steady', at: mid } : null,
		scorePops:
			scene === 'moab' || scene === 'specended'
				? [
						{ id: 1, points: 100, label: 'Kill', at: mid },
						{ id: 2, points: 500, label: 'M.O.A.B.', at: mid },
						{ id: 3, points: 250, label: 'Round won', at: mid }
					]
				: scene === 'ended2'
					? []
					: ended
						? [{ id: 3, points: 250, label: 'Round won', at: mid }]
					: infected
						? [
								{ id: 1, points: 250, label: 'Bank shot', at: mid },
								{ id: 2, points: 200, label: 'Thrown knife', at: mid },
								{ id: 3, points: 150, label: 'Infection', at: mid }
							]
						: [
								{ id: 1, points: 250, label: 'Specialist', at: mid },
								{ id: 2, points: 100, label: 'Headshot', at: mid },
								{ id: 3, points: 50, label: 'Beacon', at: mid }
							],
		// Straight bearings in some scenes, diagonals in the others, the front quarter in 'stack': together the whole ring.
		hurtDirs: feedback
			? (scene === 'stack'
					? [-40, -20, 20, 40]
					: scene === 'survivor' || scene === 'last' || scene === 'scope' || scene === 'emptypistol'
						? [0, 90, -90, 180]
						: [-44, 46, -134, 136]
				).map((bearing, i) => ({
					id: i + 1,
					// The killing blow is shown mid-life (it lives 2.2 s and would restart at full strength).
					at: scene === 'down' && i === 3 ? mid : now,
					bearing,
					lethal: scene === 'down' && i === 3
				}))
			: [],
		summaryRows: scene === 'ended' ? null : scene === 'ended2' ? rows(2) : scene === 'ended32' ? rows(32) : ended ? rows(16) : null,
		// ended16 carries the longest loadout label with "Survivors win", the widest header.
		nextLoadoutLabel: ended && scene !== 'ended' ? (scene === 'ended16' ? WEAPONS.lmg.label : WEAPONS.barrett.label) : null,
		focusId: watching ? 1 : scene === 'ended32' ? 27 : 4,
		slotAmmo: scene === 'empty' || scene === 'scopedry' ? [0, 48] : scene === 'emptypistol' ? [164, 0] : [ammo[0]! + ammo[1]!, 48]
	};
	// Practice range: no round, so no clock, score, feed, popups or perks; a fresh kill marker on a target.
	if (scene === 'practice' || scene === 'practicescope') {
		Object.assign(view, {
			phase: 'waiting',
			practice: true,
			endsAt: 0,
			survivors: 0,
			infected: 0,
			hp: 5,
			myScore: 0,
			myKills: 0,
			killFeed: [],
			timeBonusAt: 0,
			hurtAt: 0,
			streak: 0,
			perks: infPerksForStreak(0),
			perkFlash: null,
			scorePops: [],
			hurtDirs: []
		} satisfies Partial<InfectedView>);
	}
	return view;
}
