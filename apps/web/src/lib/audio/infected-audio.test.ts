import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMBAT_VOICES, INFECTED_CHIMES, INFECTED_SOUNDS, PRIO, ZOMBIES_SOUNDS, combatDb, voiceKey, type CombatSound } from '#lib/audio/combat.js';
import {
	DEFAULT_VOLUME,
	FILE_PEAK_DB,
	LIMITER_THRESHOLD_DB,
	MIX_LUFS,
	OWN_HEADROOM_DB,
	PAN_MAX,
	PAN_MIN_DIST,
	RANGE,
	VARIATION_DB,
	VoicePool,
	dbToGain,
	levelDb,
	panFor,
	rangeDb
} from '#lib/audio/mix.js';
import { SFX_DEFERRED, SFX_EVENTS, SFX_IR, SFX_LOOPS } from '#lib/audio/sfx.js';
import type { InfSound } from '#lib/game/infected.js';
import type { ZmSound } from '#lib/game/zombies.js';

/** Every name of the client's InfSound union: a new name fails the typecheck here until it is listed. */
const INF_NAMES: Record<InfSound, true> = {
	'shot-pistol': true,
	'shot-lmg': true,
	'shot-sniper': true,
	'shot-barrett': true,
	'shot-striker': true,
	'shot-smg': true,
	knife: true,
	claws: true,
	throw: true,
	reload: true,
	hit: true,
	hurt: true,
	round: true,
	alpha: true,
	uav: true,
	beacon: true,
	perk: true,
	moabReady: true,
	moab: true,
	moabDetonate: true,
	dryfire: true,
	draw: true,
	scope: true,
	reloadDone: true,
	handle: true,
	magOut: true,
	magIn: true,
	bolt: true,
	casing: true,
	shell: true,
	impact: true,
	hitHead: true,
	hitKill: true,
	death: true,
	infect: true,
	knifeBounce: true,
	knifeStick: true,
	knifePickup: true,
	beaconSmash: true,
	beaconUse: true
};
/** The zombies names that mean the same as an infected sound. */
const ZM_SHARED: ZmSound[] = ['shot-pistol', 'shot-lmg', 'shot-sniper', 'knife', 'reload', 'casing', 'shell', 'hit', 'hurt'];

const sounds = Object.entries(INFECTED_SOUNDS);
const own = (s: CombatSound): number => levelDb(s.pool, s.lufs);
const inf = (name: InfSound): CombatSound => INFECTED_SOUNDS[name]!;

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const SFX_DIR = fileURLToPath(new URL('../../../static/sfx/', import.meta.url));
const manifest = JSON.parse(readFileSync(ROOT + 'tools/audio/manifest.json', 'utf8')) as {
	truePeakCeiling: number;
	groups: Record<string, { src: string; tier?: string; takes: { src?: string }[] }>;
};
const credits = readFileSync(ROOT + 'CREDITS.md', 'utf8')
	.split('\n')
	.filter((l) => l.startsWith('|'));

describe('infected sound names', () => {
	it('every name of InfSound plays a recording', () => {
		for (const name of Object.keys(INF_NAMES)) {
			const s = INFECTED_SOUNDS[name];
			const chime = INFECTED_CHIMES[name];
			expect(s !== undefined || chime !== undefined, name).toBe(true);
			if (s) expect(SFX_EVENTS[s.pool].length, name).toBeGreaterThan(0);
		}
		// Nothing is mapped that the client cannot ask for.
		for (const name of [...Object.keys(INFECTED_SOUNDS), ...Object.keys(INFECTED_CHIMES)]) expect(name in INF_NAMES, name).toBe(true);
	});

	it('the bell and the chime stay where no recording replaced them', () => {
		expect(INFECTED_CHIMES).toEqual({ round: 'zone', alpha: 'zone', uav: 'zone', perk: 'record', moabReady: 'record' });
		// The siren and the explosion fall back to the bell they replaced while their pool loads.
		expect(inf('moab').fallback).toBe('zone');
		expect(inf('moabDetonate').fallback).toBe('zone');
	});

	it('sounds that repeat have 3 or more distinct takes', () => {
		const once = new Set(['moab', 'moabDetonate']);
		for (const [name, s] of sounds) {
			if (once.has(name)) expect(SFX_EVENTS[s.pool].length, name).toBe(1);
			else expect(SFX_EVENTS[s.pool].length, name).toBeGreaterThanOrEqual(3);
		}
	});

	it('each gun has its own pool; knife and claws share the swing pool at different levels', () => {
		const guns: InfSound[] = ['shot-pistol', 'shot-smg', 'shot-lmg', 'shot-sniper', 'shot-barrett', 'shot-striker'];
		expect(new Set(guns.map((g) => inf(g).pool)).size).toBe(guns.length);
		expect(inf('knife').pool).toBe('swing');
		expect(inf('claws').pool).toBe('swing');
		expect(inf('knife').lufs).toBe(MIX_LUFS.swing);
		expect(inf('claws').lufs).toBeGreaterThan(inf('knife').lufs);
		expect(new Set([inf('hit').pool, inf('hitHead').pool, inf('hitKill').pool]).size).toBe(3);
	});

	it('zombies shares the infected recordings for the names with the same meaning', () => {
		expect(Object.keys(ZOMBIES_SOUNDS).sort()).toEqual([...ZM_SHARED].sort());
		for (const name of ZM_SHARED) expect(ZOMBIES_SOUNDS[name], name).toBe(INFECTED_SOUNDS[name]);
	});
});

describe('shipped combat files', () => {
	it('every take of every pool is on disk, and nothing else is', () => {
		const listed = new Set<string>([SFX_IR.file, ...Object.values(SFX_LOOPS).map((l) => l.file), ...Object.values(SFX_EVENTS).flat()]);
		for (const f of listed) expect(existsSync(SFX_DIR + f), f).toBe(true);
		expect(readdirSync(SFX_DIR).filter((f) => f.endsWith('.m4a') && !listed.has(f))).toEqual([]);
	});

	it('the manifest, sfx.ts and CREDITS.md describe the same pools', () => {
		expect(Object.keys(manifest.groups)).toEqual(Object.keys(SFX_EVENTS));
		expect(manifest.truePeakCeiling).toBe(FILE_PEAK_DB);
		for (const [name, g] of Object.entries(manifest.groups)) {
			const files = SFX_EVENTS[name as keyof typeof SFX_EVENTS];
			expect(files.length, name).toBe(g.takes.length);
			// One CREDITS row per pool: its files, its Freesound source and the licence.
			const token = files.length > 1 ? `\`${name}-1…${files.length}.m4a\`` : `\`${name}.m4a\``;
			const rows = credits.filter((l) => l.includes(token));
			expect(rows.length, `CREDITS.md row for ${token}`).toBe(1);
			expect(rows[0], name).toContain('CC0 1.0');
			for (const src of new Set([g.src, ...g.takes.map((t) => t.src ?? g.src)])) expect(rows[0], name).toMatch(new RegExp(`freesound\\.org/(people/[^/ ]+/sounds|s)/${src}/`));
		}
	});

	it('combat pools load after the core set', () => {
		expect([...SFX_DEFERRED]).toEqual(Object.keys(manifest.groups).filter((n) => manifest.groups[n]!.tier === 'deferred'));
		const deferred = new Set<string>(SFX_DEFERRED);
		for (const core of ['step', 'jump', 'land', 'zone', 'record', 'vote', 'click', 'swing', 'hit', 'crash']) expect(deferred.has(core), core).toBe(false);
		for (const [name, s] of sounds) expect(deferred.has(s.pool) || s.pool === 'swing', name).toBe(true);
	});
});

describe('combat levels', () => {
	it('orders the guns: .50 cal > sniper > shotgun > LMG > pistol > SMG', () => {
		const order: InfSound[] = ['shot-barrett', 'shot-sniper', 'shot-striker', 'shot-lmg', 'shot-pistol', 'shot-smg'];
		for (let i = 1; i < order.length; i++) expect(inf(order[i - 1]!).lufs, order[i]).toBeGreaterThan(inf(order[i]!).lufs);
		expect(MIX_LUFS.shotBarrett).toBeGreaterThan(MIX_LUFS.shotPistol);
	});

	it('puts every shot above the footsteps, the landing and the wind bed', () => {
		for (const [name, s] of sounds) {
			if (!name.startsWith('shot-')) continue;
			expect(s.lufs, name).toBeGreaterThan(MIX_LUFS.step);
			expect(s.range, name).toBe('shot');
		}
		expect(MIX_LUFS.shotSmg).toBeGreaterThanOrEqual(MIX_LUFS.step + 3);
		expect(MIX_LUFS.shotLmg).toBeGreaterThan(MIX_LUFS.landMax);
		expect(MIX_LUFS.shotLmg).toBeGreaterThanOrEqual(MIX_LUFS.wind - 1);
	});

	it('keeps handling under the footsteps and makes the hit confirms distinct', () => {
		for (const name of ['reload', 'reloadDone', 'handle', 'magOut', 'magIn', 'bolt', 'dryfire', 'draw', 'scope'] as const) expect(inf(name).lufs, name).toBeLessThan(MIX_LUFS.step);
		// A falling case is under the handling, and there are never more than three at once.
		for (const name of ['casing', 'shell'] as const) {
			expect(inf(name).lufs, name).toBeLessThan(MIX_LUFS.reload);
			expect(inf(name).voices, name).toBeLessThanOrEqual(3);
			expect(inf(name).gap, name).toBeGreaterThanOrEqual(0.05);
		}
		expect(inf('hitKill').lufs).toBeGreaterThan(inf('hitHead').lufs);
		expect(inf('hitHead').lufs).toBeGreaterThan(inf('hit').lufs);
		// Confirms and the detonation carry information: no random level change.
		for (const name of ['hit', 'hitHead', 'hitKill', 'moab', 'moabDetonate'] as const) expect(inf(name).vary, name).toBe(false);
	});

	it('does not lean on the limiter at the default volume', () => {
		expect(OWN_HEADROOM_DB).toBeCloseTo(4.52, 2);
		// A file at the peak ceiling with this much gain reaches the limiter threshold exactly.
		expect(20 * Math.log10(dbToGain(FILE_PEAK_DB + OWN_HEADROOM_DB) * DEFAULT_VOLUME)).toBeCloseTo(LIMITER_THRESHOLD_DB);
		for (const [name, s] of sounds) expect(own(s) + (s.vary ? VARIATION_DB : 0), name).toBeLessThanOrEqual(OWN_HEADROOM_DB);
	});
});

describe('combatDb and rangeDb', () => {
	it('plays your own sound at its mix level', () => {
		for (const [name, s] of sounds) {
			expect(combatDb(s), name).toBe(own(s));
			expect(combatDb(s, 0), name).toBe(own(s));
			expect(combatDb(s, 64), name).toBe(own(s));
		}
	});

	it('falls off by 6 dB per doubling beyond the near distance', () => {
		const { near, far } = RANGE.shot;
		expect(rangeDb(0, near, far)).toBe(0);
		expect(rangeDb(near, near, far)).toBe(0);
		expect(rangeDb(near * 2, near, far)).toBeCloseTo(-6.02, 2);
		expect(rangeDb(near * 4, near, far)).toBeCloseTo(-12.04, 2);
		expect(rangeDb(near * 8, near, far)).toBeCloseTo(-18.06, 2);
	});

	it('fades to silence over the last quarter of the range, without a step', () => {
		for (const { near, far } of Object.values(RANGE)) {
			let prev = 0;
			for (let d = 0; d < far; d += far / 400) {
				const db = rangeDb(d, near, far)!;
				expect(db).toBeLessThanOrEqual(prev);
				// No audible jump anywhere, the far edge included (linear gain).
				expect(dbToGain(prev) - dbToGain(db)).toBeLessThan(0.05);
				prev = db;
			}
			expect(rangeDb(far * 0.75, near, far)).toBeCloseTo(-20 * Math.log10((far * 0.75) / near));
			expect(rangeDb(far - 1, near, far)!).toBeLessThan(-60);
			expect(rangeDb(far, near, far)).toBeNull();
			expect(rangeDb(far * 2, near, far)).toBeNull();
		}
		expect(rangeDb(Number.NaN, 128, 1200)).toBeNull();
		expect(rangeDb(Number.POSITIVE_INFINITY, 128, 1200)).toBeNull();
	});

	it('carries gunshots a few thousand units and keeps handling and impacts near', () => {
		expect(RANGE.shot.far).toBeGreaterThanOrEqual(4000);
		expect(RANGE.near.far).toBeLessThanOrEqual(1500);
		for (const [name, s] of sounds) {
			const at3000 = combatDb(s, 3000);
			if (name.startsWith('shot-')) {
				expect(at3000, name).not.toBeNull();
				expect(at3000! - own(s), name).toBeCloseTo(-17.86, 1);
			} else if (s.range === 'near' || s.range === 'mid') {
				expect(at3000, name).toBeNull();
				expect(combatDb(s, 600)!, name).toBeLessThan(own(s));
			} else {
				// Hit confirms, hurt and the M.O.A.B. are heard at one level by everyone they are sent to.
				expect(s.range, name).toBeNull();
				expect(at3000, name).toBe(own(s));
			}
		}
		for (const name of ['reload', 'reloadDone', 'dryfire', 'draw', 'scope', 'handle', 'magOut', 'magIn', 'bolt', 'casing', 'shell', 'impact', 'knife', 'claws', 'throw', 'knifeBounce', 'knifeStick', 'knifePickup'] as const) expect(inf(name).range, name).toBe('near');
	});
});

describe('panFor', () => {
	const me = { x: 100, y: -50, z: 64 };
	const at = (dx: number, dy: number, dz = 0) => ({ x: me.x + dx, y: me.y + dy, z: me.z + dz });

	it('pans by the angle between the view yaw and the source', () => {
		// Yaw 0 looks along +X, so +Y is on the left.
		expect(panFor(me, at(500, 0), 0)).toBeCloseTo(0);
		expect(panFor(me, at(0, -500), 0)).toBeCloseTo(PAN_MAX);
		expect(panFor(me, at(0, 500), 0)).toBeCloseTo(-PAN_MAX);
		expect(panFor(me, at(-500, 0), 0)).toBeCloseTo(0);
		expect(panFor(me, at(500, -500), 0)).toBeCloseTo(PAN_MAX * Math.SQRT1_2);
		// Turning the view moves the source the other way.
		expect(panFor(me, at(500, 0), 90)).toBeCloseTo(PAN_MAX);
		expect(panFor(me, at(500, 0), -90)).toBeCloseTo(-PAN_MAX);
		expect(panFor(me, at(0, 500), 90)).toBeCloseTo(0);
		expect(panFor(me, at(500, 0), 360 + 90)).toBeCloseTo(PAN_MAX);
	});

	it('does not depend on the distance, only on the direction', () => {
		expect(panFor(me, at(300, -400), 0)).toBeCloseTo(panFor(me, at(3000, -4000), 0));
	});

	it('centres a source above, below or on top of the listener', () => {
		expect(panFor(me, at(0, 0, 800), 0)).toBeCloseTo(0);
		expect(panFor(me, at(0, -100, 800), 0)).toBeLessThan(PAN_MAX * 0.2);
		expect(panFor(me, me, 0)).toBe(0);
		expect(panFor(me, at(0, -PAN_MIN_DIST / 2), 0)).toBeCloseTo(PAN_MAX / 2);
		expect(panFor(me, at(0, -PAN_MIN_DIST), 0)).toBeCloseTo(PAN_MAX);
	});

	it('stays within ±PAN_MAX and survives bad input', () => {
		for (let yaw = -720; yaw <= 720; yaw += 17) {
			const p = panFor(me, at(Math.cos(yaw) * 700, Math.sin(yaw) * 700, 30), yaw);
			expect(Math.abs(p)).toBeLessThanOrEqual(PAN_MAX + 1e-9);
		}
		expect(panFor(me, at(Number.NaN, 0), 0)).toBe(0);
		expect(panFor(me, at(100, 100), Number.NaN)).toBe(0);
	});
});

describe('VoicePool', () => {
	it('caps 920 rpm automatic fire at the voices of that sound', () => {
		const smg = inf('shot-smg');
		const pool = new VoicePool(COMBAT_VOICES);
		const used = new Set<number>();
		let most = 0;
		for (let i = 0; i < 920; i++) {
			const now = i * 0.065;
			const slot = pool.acquire(smg.key, smg.prio, now, 0.45, smg.voices, smg.gap);
			expect(slot).toBeGreaterThanOrEqual(0);
			expect(slot).toBeLessThan(COMBAT_VOICES);
			used.add(slot);
			most = Math.max(most, pool.active(now));
		}
		expect(most).toBe(smg.voices);
		expect(used.size).toBeLessThanOrEqual(smg.voices + 1);
	});

	it("keeps your own shot when another player's same gun fires in the same frame", () => {
		const pool = new VoicePool(COMBAT_VOICES);
		for (const [name, s] of sounds) {
			expect(voiceKey(s, false), name).toBe(s.key);
			expect(voiceKey(s, true), name).not.toBe(s.key);
			// Their sound arrives first, then mine at the same instant: both get a voice.
			const theirs = pool.acquire(voiceKey(s, true), s.prio, 1, 0.4, s.voices, s.gap);
			const mine = pool.acquire(voiceKey(s, false), s.prio, 1, 0.4, s.voices, s.gap);
			expect(theirs, name).toBeGreaterThanOrEqual(0);
			expect(mine, name).toBeGreaterThanOrEqual(0);
			expect(mine, name).not.toBe(theirs);
			pool.clear();
		}
		// A squad on full auto next to me cannot take my voices: theirs are counted apart.
		const smg = inf('shot-smg');
		for (let i = 0; i < 400; i++) {
			const now = 2 + i * 0.0325;
			pool.acquire(voiceKey(smg, true), smg.prio, now, 0.45, smg.voices, smg.gap);
			if (i % 2 === 0) expect(pool.acquire(voiceKey(smg, false), smg.prio, now, 0.45, smg.voices, smg.gap), `shot ${i}`).toBeGreaterThanOrEqual(0);
			expect(pool.active(now)).toBeLessThanOrEqual(smg.voices * 2);
		}
		// No remote key collides with a sound's own key.
		const ownKeys = new Set(sounds.map(([, s]) => voiceKey(s, false)));
		for (const [name, s] of sounds) expect(ownKeys.has(voiceKey(s, true)), name).toBe(false);
	});

	it('never holds more voices than its size, whatever fires', () => {
		const pool = new VoicePool(COMBAT_VOICES);
		const all = sounds.map(([, s]) => s);
		for (let i = 0; i < 20000; i++) {
			const now = i * 0.004;
			const s = all[(i * 7) % all.length]!;
			const slot = pool.acquire(s.key, s.prio, now, 1.6, s.voices, s.gap);
			expect(slot).toBeLessThan(COMBAT_VOICES);
			expect(pool.active(now)).toBeLessThanOrEqual(COMBAT_VOICES);
		}
		for (const [name, s] of sounds) expect(s.voices, name).toBeLessThanOrEqual(4);
	});

	it('starts one impact for the eight pellets of a shotgun blast', () => {
		const impact = inf('impact');
		const pool = new VoicePool(COMBAT_VOICES);
		const slots = Array.from({ length: 8 }, () => pool.acquire(impact.key, impact.prio, 5, 0.16, impact.voices, impact.gap));
		expect(slots.filter((s) => s >= 0)).toHaveLength(1);
		expect(pool.acquire(impact.key, impact.prio, 5 + impact.gap, 0.16, impact.voices, impact.gap)).toBeGreaterThanOrEqual(0);
	});

	it('cuts the oldest voice of a full sound, then the oldest of the same or a lower priority', () => {
		const pool = new VoicePool(3);
		expect(pool.acquire(1, PRIO.weapon, 0.0, 9, 2, 0)).toBe(0);
		expect(pool.acquire(1, PRIO.weapon, 0.1, 9, 2, 0)).toBe(1);
		// Third voice of a sound capped at two: the oldest of its own.
		expect(pool.acquire(1, PRIO.weapon, 0.2, 9, 2, 0)).toBe(0);
		expect(pool.acquire(2, PRIO.event, 0.3, 9, 1, 0)).toBe(2);
		// Full: a world sound may not cut weapons or events.
		expect(pool.acquire(3, PRIO.world, 0.4, 9, 2, 0)).toBe(-1);
		// A weapon cuts the oldest weapon, never the event.
		expect(pool.acquire(4, PRIO.weapon, 0.5, 9, 2, 0)).toBe(1);
		expect(pool.acquire(5, PRIO.weapon, 0.6, 9, 2, 0)).toBe(0);
		expect(pool.active(0.7)).toBe(3);
	});

	it('reuses a voice once its sound has ended or was released', () => {
		const pool = new VoicePool(2);
		expect(pool.acquire(1, 0, 0, 0.5, 4, 0)).toBe(0);
		expect(pool.acquire(1, 0, 0.1, 0.5, 4, 0)).toBe(1);
		expect(pool.active(0.2)).toBe(2);
		pool.release(1);
		expect(pool.active(0.2)).toBe(1);
		expect(pool.acquire(1, 0, 0.2, 0.5, 4, 0)).toBe(1);
		expect(pool.active(0.55)).toBe(1);
		expect(pool.acquire(1, 0, 0.6, 0.5, 4, 0)).toBe(0);
		pool.clear();
		expect(pool.active(0.6)).toBe(0);
	});
});
