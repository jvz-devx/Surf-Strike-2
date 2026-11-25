import { describe, expect, it } from 'vitest';
import { INF_HURT_LETHAL_MS, INF_HURT_MS, INF_POP_MS, type InfSummaryRow } from '#lib/game/infected-hud-events.js';
import {
	accuracyText,
	ammoPrompt,
	emptySlotHints,
	hitKind,
	hitOpacity,
	hurtArcPath,
	hurtDirOpacity,
	NUKE_CALM_PEAK,
	NUKE_MS,
	nukeOpacity,
	nukeWarm,
	popOpacity,
	scopeOverlay,
	SUMMARY_COLUMN_ROWS,
	SUMMARY_MAX_ROWS,
	summaryLayout,
	vignetteStrength,
	type AmmoPromptInput
} from '#lib/ui/infected-hud.js';

/** A playing survivor holding the pistol (12-round magazine) with a full magazine and reserve. */
const gun = (extra: Partial<AmmoPromptInput> = {}): AmmoPromptInput => ({
	phase: 'playing',
	team: 'survivor',
	alive: true,
	spectating: false,
	mag: 12,
	magSize: 12,
	reserve: 36,
	reloading: false,
	...extra
});

describe('ammoPrompt', () => {
	it('reload: the magazine is low and reserve remains', () => {
		expect(ammoPrompt(gun())).toBeNull();
		expect(ammoPrompt(gun({ mag: 3 }))).toBeNull(); // above a fifth of the magazine
		expect(ammoPrompt(gun({ mag: 2 }))).toBe('reload');
		expect(ammoPrompt(gun({ mag: 0 }))).toBe('reload');
		expect(ammoPrompt(gun({ mag: 0, reserve: 1 }))).toBe('reload');
		// Light machine gun: 100 rounds, low from 20.
		expect(ammoPrompt(gun({ magSize: 100, mag: 21, reserve: 100 }))).toBeNull();
		expect(ammoPrompt(gun({ magSize: 100, mag: 20, reserve: 100 }))).toBe('reload');
	});

	it('low: little left in total and nothing to reload from', () => {
		expect(ammoPrompt(gun({ mag: 12, reserve: 0 }))).toBeNull(); // a full last magazine
		expect(ammoPrompt(gun({ mag: 5, reserve: 0 }))).toBeNull();
		expect(ammoPrompt(gun({ mag: 4, reserve: 0 }))).toBe('low');
		expect(ammoPrompt(gun({ mag: 1, reserve: 0 }))).toBe('low');
		// A few rounds in the magazine and almost none in reserve: low in total, not yet a reload.
		expect(ammoPrompt(gun({ mag: 3, reserve: 1 }))).toBe('low');
		expect(ammoPrompt(gun({ magSize: 100, mag: 35, reserve: 0 }))).toBe('low');
		expect(ammoPrompt(gun({ magSize: 100, mag: 36, reserve: 0 }))).toBeNull();
	});

	it('empty: no round left for the held gun', () => {
		expect(ammoPrompt(gun({ mag: 0, reserve: 0 }))).toBe('empty');
	});

	it('one state at a time, for every magazine and reserve', () => {
		for (const magSize of [10, 12, 36, 100]) {
			for (let mag = 0; mag <= magSize; mag++) {
				for (const reserve of [0, 1, 5, 200]) {
					const p = ammoPrompt(gun({ magSize, mag, reserve }));
					if (mag + reserve === 0) expect(p).toBe('empty');
					else if (p === 'reload') expect(reserve).toBeGreaterThan(0);
					else expect(p === 'low' || p === null).toBe(true);
				}
			}
		}
	});

	it('never while reloading, spectating, down, infected (Patient Zero included), with a melee weapon or outside a round', () => {
		for (const state of [{ mag: 2 }, { mag: 4, reserve: 0 }, { mag: 0, reserve: 0 }]) {
			expect(ammoPrompt(gun(state))).not.toBeNull();
			expect(ammoPrompt(gun({ ...state, reloading: true }))).toBeNull();
			expect(ammoPrompt(gun({ ...state, spectating: true }))).toBeNull();
			expect(ammoPrompt(gun({ ...state, alive: false }))).toBeNull();
			expect(ammoPrompt(gun({ ...state, team: 'infected' }))).toBeNull();
			expect(ammoPrompt(gun({ ...state, magSize: 0 }))).toBeNull(); // knife, claws
			for (const phase of ['waiting', 'solo', 'ended'] as const) expect(ammoPrompt(gun({ ...state, phase }))).toBeNull();
			expect(ammoPrompt(gun({ ...state, phase: 'grace' }))).not.toBeNull();
		}
	});
});

describe('emptySlotHints', () => {
	it('points to the other gun while it has rounds, then the knife', () => {
		expect(emptySlotHints(1, [0, 48], 'Pistol')).toEqual([
			{ key: '2', label: 'Pistol' },
			{ key: '3', label: 'Knife' }
		]);
		expect(emptySlotHints(2, [130, 0], 'Pistol')).toEqual([
			{ key: '1', label: 'Primary' },
			{ key: '3', label: 'Knife' }
		]);
		// Both guns dry: only the knife is left.
		expect(emptySlotHints(1, [0, 0], 'Pistol')).toEqual([{ key: '3', label: 'Knife' }]);
		expect(emptySlotHints(2, [0, 0], 'Pistol')).toEqual([{ key: '3', label: 'Knife' }]);
		// Ammo of the other slot unknown (older view): still offered.
		expect(emptySlotHints(1, undefined, 'Pistol').map((h) => h.key)).toEqual(['2', '3']);
	});
});

describe('fades', () => {
	it('score popup: full, then fading over its last 600 ms', () => {
		expect(popOpacity(0)).toBe(1);
		expect(popOpacity(INF_POP_MS - 600)).toBe(1);
		expect(popOpacity(INF_POP_MS - 300)).toBeCloseTo(0.5, 9);
		expect(popOpacity(INF_POP_MS)).toBe(0);
	});

	it('hit arc: gone at its lifetime; the killing blow lasts longer', () => {
		expect(hurtDirOpacity(0, false)).toBe(1);
		expect(hurtDirOpacity(INF_HURT_MS - 350, false)).toBeCloseTo(0.5, 9);
		expect(hurtDirOpacity(INF_HURT_MS, false)).toBe(0);
		expect(hurtDirOpacity(INF_HURT_MS, true)).toBe(1);
		expect(hurtDirOpacity(INF_HURT_LETHAL_MS, true)).toBe(0);
	});

	it('hit marker: body, head and kill are three states; a kill holds longer', () => {
		expect(hitKind({ head: false, kill: false })).toBe('body');
		expect(hitKind({ head: true, kill: false })).toBe('head');
		expect(hitKind({ head: false, kill: true })).toBe('kill');
		expect(hitKind({ head: true, kill: true })).toBe('kill');
		expect(hitOpacity(150, 'body')).toBeLessThan(1);
		expect(hitOpacity(150, 'kill')).toBe(1);
		// The client drops the marker after 400 ms: both are gone by then.
		expect(hitOpacity(400, 'body')).toBe(0);
		expect(hitOpacity(400, 'kill')).toBe(0);
	});
});

describe('hurtArcPath', () => {
	it('a crescent across the top: ends on the radius at the half angle, thickest in the middle', () => {
		const d = hurtArcPath(170, 30, 10);
		const m = /^M (-?[\d.]+) (-?[\d.]+) A 170 170 0 0 1 (-?[\d.]+) (-?[\d.]+) A ([\d.]+) [\d.]+ 0 0 0 (-?[\d.]+) (-?[\d.]+) Z$/.exec(d);
		expect(m).not.toBeNull();
		const [x0, y0, x1, y1, inner, x2, y2] = m!.slice(1).map(Number) as [number, number, number, number, number, number, number];
		expect(x0).toBeCloseTo(-85, 1); // 170 * sin 30
		expect(x1).toBeCloseTo(85, 1);
		expect(y0).toBeCloseTo(-147.22, 1); // above the centre: straight ahead
		expect(y1).toBe(y0);
		expect([x2, y2]).toEqual([x0, y0]);
		expect(Math.hypot(x0, y0)).toBeCloseTo(170, 1);
		// The inner arc is flatter: its middle lies 10 inside the outer one.
		const half = x1;
		const sag = inner - Math.sqrt(inner * inner - half * half);
		expect(-y0 + sag).toBeCloseTo(160, 0);
	});
});

describe('M.O.A.B. detonation overlay', () => {
	it('normal: a white flash at full opacity that warms to amber and fades out', () => {
		expect(nukeOpacity(0, false)).toBe(1);
		expect(nukeWarm(0, false)).toBe(0);
		expect(nukeOpacity(NUKE_MS / 2, false)).toBeGreaterThan(0.2);
		expect(nukeOpacity(NUKE_MS / 2, false)).toBeLessThan(0.5);
		expect(nukeWarm(NUKE_MS / 2, false)).toBe(1);
		expect(nukeOpacity(NUKE_MS, false)).toBe(0);
		expect(nukeOpacity(-1, false)).toBe(0);
		expect(nukeOpacity(Number.NaN, false)).toBe(0);
	});

	it('reduced motion: no flash, a dim amber wash that eases in and fades once', () => {
		expect(nukeOpacity(0, true)).toBe(0);
		let peak = 0;
		let prev = 0;
		let maxStep = 0;
		let turns = 0;
		let rising = true;
		for (let age = 0; age < NUKE_MS; age += 16) {
			const o = nukeOpacity(age, true);
			expect(nukeWarm(age, true)).toBe(1); // never the white core
			peak = Math.max(peak, o);
			maxStep = Math.max(maxStep, Math.abs(o - prev));
			if (rising && o < prev - 1e-9) {
				rising = false;
				turns++;
			} else if (!rising && o > prev + 1e-9) turns++;
			prev = o;
		}
		expect(peak).toBeCloseTo(NUKE_CALM_PEAK, 9);
		expect(peak).toBeLessThanOrEqual(0.3);
		expect(maxStep).toBeLessThan(0.02); // no jump between frames
		expect(turns).toBe(1); // up once, down once
		expect(prev).toBeLessThan(0.01);
		expect(nukeOpacity(NUKE_MS, true)).toBe(0);
	});

	it('the hurt vignette is softer with reduced motion', () => {
		expect(vignetteStrength(true)).toBeLessThan(vignetteStrength(false));
	});
});

describe('scopeOverlay', () => {
	it('follows scopeT: fades in with the zoom while the lens closes in', () => {
		expect(scopeOverlay(0, true)).toBeNull();
		expect(scopeOverlay(0.5, true)).toEqual({ opacity: 0.5, scale: 1.175 });
		expect(scopeOverlay(1, true)).toEqual({ opacity: 1, scale: 1 });
		// Zooming out: still drawn while scoped is already false.
		expect(scopeOverlay(0.25, false)).toMatchObject({ opacity: 0.25 });
		expect(scopeOverlay(7, true)).toEqual({ opacity: 1, scale: 1 });
		expect(scopeOverlay(-1, true)).toBeNull();
		expect(scopeOverlay(Number.NaN, true)).toBeNull();
	});

	it('without scopeT it follows scoped', () => {
		expect(scopeOverlay(undefined, true)).toEqual({ opacity: 1, scale: 1 });
		expect(scopeOverlay(undefined, false)).toBeNull();
	});
});

const row = (id: number): InfSummaryRow => ({ id, name: `P${id}`, team: 'survivor', alpha: false, score: 1000 - id, kills: 0, infections: 0, deaths: 0, accuracy: null, bestStreak: 0 });
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1));

describe('summaryLayout', () => {
	it('one column up to 8 players, two balanced columns up to 16, in order', () => {
		expect(summaryLayout(rows(2), 1)).toEqual({ columns: [rows(2)], more: 0 });
		expect(summaryLayout(rows(SUMMARY_COLUMN_ROWS), 1).columns).toHaveLength(1);
		const nine = summaryLayout(rows(9), 1);
		expect(nine.columns.map((c) => c.map((r) => r.id))).toEqual([
			[1, 2, 3, 4, 5],
			[6, 7, 8, 9]
		]);
		const sixteen = summaryLayout(rows(16), 1);
		expect(sixteen.columns.map((c) => c.length)).toEqual([8, 8]);
		expect(sixteen.columns.flat().map((r) => r.id)).toEqual(rows(16).map((r) => r.id));
		expect(sixteen.more).toBe(0);
		expect(summaryLayout([], 1)).toEqual({ columns: [[]], more: 0 });
	});

	it('more than 16: the best 16, the focus player always among them, and how many are left out', () => {
		const top = summaryLayout(rows(32), 3);
		expect(top.columns.flat().map((r) => r.id)).toEqual(rows(16).map((r) => r.id));
		expect(top.more).toBe(16);
		const low = summaryLayout(rows(32), 27);
		const ids = low.columns.flat().map((r) => r.id);
		expect(ids).toHaveLength(SUMMARY_MAX_ROWS);
		expect(ids.slice(0, 15)).toEqual(rows(15).map((r) => r.id));
		expect(ids[15]).toBe(27);
		expect(low.more).toBe(16);
		// No focus player in the stats (a spectator): just the best 16.
		expect(summaryLayout(rows(20), 99).columns.flat().at(-1)!.id).toBe(16);
		expect(summaryLayout(rows(20), undefined).more).toBe(4);
	});
});

describe('accuracyText', () => {
	it('percent, or a dash without a shot', () => {
		expect(accuracyText(42)).toBe('42%');
		expect(accuracyText(0)).toBe('0%');
		expect(accuracyText(null)).toBe('—');
	});
});
