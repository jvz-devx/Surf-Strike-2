/**
 * bhop_reliquary — hard bhop. A sunken temple at golden hour.
 *
 * ~68 sandstone blocks (48 × 48 and 64 × 64 tops) and narrow lintel strips
 * (24–32 wide, 256–448 long) in 7 sections, gaps 144–256 edge to edge, each
 * section ending on a 192 × 192 altar pad (checkpoint). Section 7 ends on the
 * long end terrace (checkpoint 7 on its near part, end zone on its far part).
 * Harder than bhop_circuit: smaller tops, wider gaps, thinner strips, chained
 * 90°–120° turns, a longjump run that needs built speed and big drops.
 *
 *   1  causeway: straight east, gaps growing from 144 to 240 (build speed)
 *   2  serpent: chained alternating 90° / 120° strafe turns on 48 blocks
 *   3  colonnade: thin lintel strips joined by right-angle turns
 *   4  ziggurat: climbs of +40, drops down to −128, 45° turns
 *   5  sunken stair: a descending staircase of blocks, gaps up to 256
 *   6  longjump: flat run of 232–256 gaps (needs ≥ 420 u/s carried in)
 *   7  sanctum: everything at once, climbing onto the end terrace
 */
import { BHOP_CVARS } from '../cvars.ts';
import type { MapDef, Theme, Zone } from './types.ts';
import {
	BhopPath,
	bhopLayout,
	boundsOf,
	teleportBelow,
	teleportUnder,
	v3,
	type PathNode,
	type PathStep
} from './helpers.ts';

const BLOCK = 64;
const SMALL = 48;
const PAD = 192;

/** 64 × 64 block step. */
const b = (gap: number, turn = 0, dz = 0): PathStep => ({ gap, turn, dz });
/** 48 × 48 block step. */
const s = (gap: number, turn = 0, dz = 0): PathStep => ({ gap, turn, dz, along: SMALL, across: SMALL });
/** Narrow strip along the heading (heading must be axis-aligned). */
const strip = (gap: number, length: number, width: number, turn = 0, dz = 0): PathStep => ({
	gap,
	turn,
	dz,
	along: length,
	across: width
});
const checkpoint = (gap: number, turn = 0, dz = 0): PathStep => ({ gap, turn, dz, along: PAD, across: PAD, kind: 'checkpoint' });

const SECTIONS: PathStep[][] = [
	// 1: causeway east, gaps grow so speed has to build.
	[b(144), b(160), b(176), b(176), b(192), b(208), s(208), b(224), s(224), b(240), checkpoint(192)],
	// 2: serpent — every block is a hard strafe turn, alternating sides, two of them 120°.
	[
		s(176, 90),
		s(176, -90),
		s(192, 90),
		s(192, -90),
		s(176, 120),
		s(184, -120),
		s(192, 90),
		s(200, -90),
		b(192, 90),
		b(208, -90),
		checkpoint(176)
	],
	// 3: colonnade — thin strips (land anywhere along them) joined by right-angle turns.
	[
		b(176),
		strip(192, 384, 28),
		s(208, 90),
		strip(192, 448, 24),
		b(200, -90),
		strip(208, 320, 32),
		s(192, -90),
		strip(176, 256, 24),
		b(208, 90),
		strip(192, 416, 28),
		checkpoint(176)
	],
	// 4: ziggurat — climbs of +40 and drops down to −128, with 45° turns.
	[
		b(176, 0, 32),
		s(176, 45, 40),
		b(192, 0, -64),
		s(168, -45, 40),
		b(200, -45, 40),
		b(224, 0, -96),
		s(176, 45, 40),
		b(184, 0, 40),
		b(208, 45, -128),
		s(192, -45, 32),
		checkpoint(176, 0, 24)
	],
	// 5: sunken stair — every block a step down, gaps up to 256, slow right-hand sweep and back.
	[
		b(208, -30, -32),
		s(224, 0, -48),
		b(232, -30, -32),
		s(240, 0, -48),
		b(248, -30, -32),
		s(256, 0, -48),
		b(240, 30, -32),
		s(248, 30, -48),
		b(232, 30, -32),
		checkpoint(224, 0, -32)
	],
	// 6: longjump run — flat, long gaps that need speed carried in from the stair.
	[b(208), b(232), b(240), b(248), b(256), b(240), b(256), b(248), checkpoint(240)],
	// 7: sanctum — turns, thin strips, climbs and a big drop, onto the end terrace.
	[
		s(192, 90, 40),
		s(176, -90, 40),
		strip(200, 384, 24),
		b(208, 90, 32),
		s(184, -90, 40),
		b(240, 0, -128),
		s(200, -90, 40),
		b(192, 90, 40),
		strip(208, 320, 28, 0, 24),
		s(224, -90),
		b(240, 90, -32),
		{ gap: 208, along: 768, across: 256, kind: 'end' }
	]
];

/** Index of the section whose longjump gaps (into each of its nodes) need ≥ 420 u/s. */
const LONGJUMP_SECTION = 5;

const path = new BhopPath({ top: v3(0, 0, 0), sx: 320, sy: 320 }, 0, BLOCK, 48);
/** Node index ranges [first, last] per section (last = its checkpoint pad / the end terrace). */
const sectionRanges: Array<[number, number]> = [];
for (const section of SECTIONS) {
	const first = path.nodes.length;
	for (const step of section) path.step(step);
	sectionRanges.push([first, path.nodes.length - 1]);
}

const { brushes, zones, spawn } = bhopLayout(path.nodes, (n, i) =>
	n.kind === 'block' ? (i % 2 ? 'sandstone' : 'sandstoneWorn') : n.kind === 'strip' ? 'lintel' : 'altar'
);

// Local catch triggers under each section, plus one under everything. All send
// the player back to the last checkpoint.
const sectionTeleports: Zone[] = sectionRanges.map(([first, last]) =>
	teleportUnder(brushes.slice(first, last + 1), 'stage', 384, 192, 1024)
);
const low = boundsOf(brushes).min.z;
zones.push(...sectionTeleports, teleportBelow(brushes, low - 1536, 'stage'));

const theme: Theme = {
	skyTop: 0x3d5f93,
	skyHorizon: 0xf3b45e,
	skyBottom: 0x7a4f2c,
	fogColor: 0xe6a764,
	fogNear: 2500,
	fogFar: 15000,
	sunColor: 0xffc070,
	sunIntensity: 1.25,
	sunDir: v3(0.8, -0.45, 0.4),
	ambientSky: 0x9fb6d6,
	ambientGround: 0x6e4a26,
	ambientIntensity: 0.55,
	materials: {
		sandstone: { color: 0xb48a58, topColor: 0xe2b23c, noise: 0.22, noiseScale: 96, roughness: 0.85 },
		sandstoneWorn: { color: 0xa47a4c, topColor: 0xd9a535, noise: 0.28, noiseScale: 72, roughness: 0.9 },
		lintel: { color: 0x9c7448, topColor: 0xf0c04a, noise: 0.18, noiseScale: 128, roughness: 0.8 },
		altar: { color: 0xc49a64, topColor: 0xf2c75a, edgeColor: 0xffd27a, noise: 0.16, noiseScale: 160, roughness: 0.7 }
	},
	effects: [
		{ type: 'lavaSea', color: 0x1f6f78, z: low - 2200, size: 60000 },
		{ type: 'clouds', color: 0xffd3a0, count: 80, height: low - 1200 },
		{ type: 'clouds', color: 0xffe6c4, count: 40, height: 2600 },
		{
			type: 'embers',
			color: 0xffcf6a,
			count: 1500,
			area: { min: v3(-2000, -6000, low - 600), max: v3(26000, 8000, 1200) }
		}
	]
};

export const bhop_reliquary: MapDef = {
	id: 'bhop_reliquary',
	title: 'Reliquary',
	kind: 'bhop',
	difficulty: 'hard',
	layout: 'linear',
	cvars: { ...BHOP_CVARS },
	spawn,
	brushes,
	zones,
	theme
};

/** Generator output for the map tests (block sizes and gaps). */
export const RELIQUARY_PATH: PathNode[] = path.nodes;
/** Node index ranges [first, last] of each section in RELIQUARY_PATH. */
export const RELIQUARY_SECTIONS: ReadonlyArray<readonly [number, number]> = sectionRanges;
/** Node indices i whose incoming gap (from node i − 1) is a longjump that needs ≥ 420 u/s. */
export const RELIQUARY_LONGJUMPS: number[] = (() => {
	const [first, last] = sectionRanges[LONGJUMP_SECTION]!;
	const out: number[] = [];
	for (let i = first + 1; i <= last; i++) out.push(i);
	return out;
})();
/** Teleport triggers under each section, in section order (the map-wide one is not included). */
export const RELIQUARY_SECTION_TELEPORTS: Zone[] = sectionTeleports;
