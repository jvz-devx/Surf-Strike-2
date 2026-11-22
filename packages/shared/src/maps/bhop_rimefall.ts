/**
 * bhop_rimefall — hard bhop. A frozen glacier cave at night under the aurora.
 *
 * 65 small ice blocks (48 × 48 to 64 × 64 tops) and rime strips (24–32 wide)
 * in 6 sections, gaps 128–248 edge to edge, each section ending on a 192 × 192
 * checkpoint pad. Section 6 ends on the long end pad (checkpoint 6 on its near
 * part, end zone on its far part). Slightly harder than bhop_circuit: smaller
 * tops, narrower strips, longer gaps and a final straight that needs 420 u/s.
 *
 *   1  icefall run: straight, gaps growing from 128 to 224 (build speed)
 *   2  spiral: a full clockwise turn, 30° every jump, climbing up to +32 per block
 *   3  weave: 24–32 wide rime strips joined by alternating 90° turns, stepping down
 *   4  seracs: blocks alternating up 40 (short gaps) / down 40 (long gaps), 45° kinks
 *   5  crevasse field: long gaps (232–248) with turns and drops
 *   6  final straight: flat 240–248 gaps on 48 blocks, needs ≥ 420 u/s
 */
import { BHOP_CVARS } from '../cvars.ts';
import type { BrushDef, MapDef, Theme, Zone } from './types.ts';
import { BhopPath, bhopLayout, boundsOf, brushBounds, teleportBelow, teleportUnder, v3, type PathNode, type PathStep } from './helpers.ts';

const BLOCK = 56;
const PAD = 192;
const THICKNESS = 48;

/** Square block step (`size` × `size` top). */
const b = (gap: number, turn = 0, dz = 0, size = BLOCK): PathStep => ({ gap, turn, dz, along: size, across: size });
/** Narrow strip along the heading. */
const strip = (gap: number, length: number, width: number, turn = 0, dz = 0): PathStep => ({
	gap,
	turn,
	dz,
	along: length,
	across: width
});
const checkpoint = (gap: number, turn = 0, dz = 0): PathStep => ({ gap, turn, dz, along: PAD, across: PAD, kind: 'checkpoint' });

/** Section index of the final straight (0-based) and its block gaps (for the speed tests). */
export const RIMEFALL_FINAL_SECTION = 5;

const SECTIONS: PathStep[][] = [
	// 1: icefall run — straight east, blocks shrink and gaps grow so speed has to build.
	[
		b(128, 0, 0, 64),
		b(136, 0, 0, 64),
		b(144),
		b(160),
		b(176),
		b(184),
		b(192),
		b(200),
		b(208, 0, 0, 48),
		b(216, 0, 0, 48),
		b(224, 0, 0, 48),
		checkpoint(200)
	],
	// 2: spiral — clockwise, 30° every jump (12 turns = 360°), climbing up to +32 per block,
	// climbing gaps kept ≤ 184 so the shorter modern-jump hop still reaches them.
	[
		b(208, 0, 16),
		b(184, -30, 32),
		b(184, -30, 32),
		b(184, -30, 32),
		b(248, -30, 0),
		b(184, -30, 32),
		b(176, -30, 32),
		b(208, -30, 16, 48),
		b(168, -30, 32, 48),
		b(144, -30, 0, 48),
		b(144, -30, 32, 48),
		b(168, -30, 32, 48),
		checkpoint(184, -30, 0)
	],
	// 3: weave — narrow rime strips, every one a hard 90° turn the other way, stepping down.
	[
		strip(176, 288, 28, 90, -16),
		strip(184, 288, 24, -90, -16),
		strip(184, 320, 32, 90, -16),
		strip(192, 288, 24, -90, -16),
		b(200, 0, -16, 48),
		strip(184, 320, 28, 90, -16),
		strip(192, 288, 24, -90, -16),
		strip(200, 320, 32, 90, -16),
		strip(192, 288, 24, -90, -16),
		strip(200, 288, 28, 90, -16),
		b(200, -90, -16, 48),
		checkpoint(192, 0, -16)
	],
	// 4: seracs — up 40 over short gaps, down 40 over long ones, with 45° kinks.
	[
		b(152, 0, 40),
		b(224, 45, -40),
		b(144, 0, 40, 48),
		b(232, -45, -40),
		b(160, -45, 40, 48),
		b(224, 0, -40),
		b(152, 45, 40, 48),
		b(240, 45, -40),
		b(144, 0, 40, 48),
		b(232, -45, -40),
		checkpoint(200)
	],
	// 5: crevasse field — long gaps on turns, small climbs and drops.
	[
		b(232, 0, -24, 48),
		b(240, 45, 0, 48),
		b(216, 0, 16, 48),
		b(248, -45, -32, 48),
		b(240, -45, 0, 48),
		b(216, 0, 16, 48),
		b(248, 45, -24, 48),
		b(240, 45, 0, 48),
		b(216, -45, 16, 48),
		b(248, 0, -40, 48),
		checkpoint(232)
	],
	// 6: final straight — flat, the longest gaps on the smallest blocks; only carried speed makes it.
	[
		b(240, 0, 0, 48),
		b(240, 0, 0, 48),
		b(244, 0, 0, 48),
		b(244, 0, 0, 48),
		b(248, 0, 0, 48),
		b(248, 0, 0, 48),
		b(248, 0, 0, 48),
		b(248, 0, 0, 48),
		b(248, 0, 0, 48),
		b(248, 0, 0, 48),
		{ gap: 240, along: 896, across: 320, kind: 'end' }
	]
];

const path = new BhopPath({ top: v3(0, 0, 0), sx: 384, sy: 384 }, 0, BLOCK, THICKNESS);
/** Node indices [first, last] of each section (last = its checkpoint pad / end pad). */
const sectionRanges: Array<[number, number]> = [];
for (const section of SECTIONS) {
	const first = path.nodes.length;
	for (const step of section) path.step(step);
	sectionRanges.push([first, path.nodes.length - 1]);
}

const { brushes, zones, spawn } = bhopLayout(path.nodes, (n, i) =>
	n.kind === 'block' ? (i % 2 ? 'iceBlue' : 'iceDeep') : n.kind === 'strip' ? 'rime' : n.kind === 'start' ? 'pad' : n.kind === 'end' ? 'endPad' : 'pad'
);

/**
 * Catch trigger under one section: like teleportUnder, but its top is pushed
 * below every brush its footprint covers (the spiral climbs over the
 * neighbourhood, so another section can sit under this one's margin).
 */
function sectionTeleport(group: BrushDef[], all: BrushDef[]): Zone {
	const tp = teleportUnder(group, 'stage', 512, 256, 2048);
	let top = tp.max.z;
	for (const br of all) {
		const bb = brushBounds(br);
		const xy = bb.min.x < tp.max.x && tp.min.x < bb.max.x && bb.min.y < tp.max.y && tp.min.y < bb.max.y;
		if (xy) top = Math.min(top, bb.min.z - 256);
	}
	return { ...tp, min: v3(tp.min.x, tp.min.y, top - 2048), max: v3(tp.max.x, tp.max.y, top) };
}

for (const [first, last] of sectionRanges) zones.push(sectionTeleport(brushes.slice(first, last + 1), brushes));

// Snow floor far below; one trigger under everything returns to the last checkpoint.
const low = boundsOf(brushes).min.z;
const floorTp = Math.min(...zones.filter((z) => z.type === 'teleport').map((z) => z.min.z), low - 256);
zones.push(teleportBelow(brushes, floorTp, 'stage'));

const theme: Theme = {
	skyTop: 0x020814,
	skyHorizon: 0x0f3346,
	skyBottom: 0x01040a,
	fogColor: 0x0a1e2e,
	fogNear: 1800,
	fogFar: 14000,
	sunColor: 0x9fd8ff,
	sunIntensity: 0.3,
	sunDir: v3(0.35, -0.4, 0.85),
	ambientSky: 0x4f86b8,
	ambientGround: 0x0c1a26,
	ambientIntensity: 0.6,
	materials: {
		iceBlue: { color: 0x7fb4d6, topColor: 0xf1f8ff, edgeColor: 0x46f2ff, noise: 0.12, noiseScale: 96, roughness: 0.25 },
		iceDeep: { color: 0x5d93bd, topColor: 0xe6f3ff, edgeColor: 0x7af8ff, noise: 0.14, noiseScale: 96, roughness: 0.3 },
		rime: { color: 0x9cc8e4, topColor: 0xffffff, edgeColor: 0x2fe6ff, noise: 0.08, noiseScale: 128, roughness: 0.35 },
		pad: { color: 0x4c7a9e, topColor: 0xdceaf6, edgeColor: 0x46f2ff, seamColor: 0x2fb8d8, noise: 0.16, noiseScale: 192, roughness: 0.6 },
		endPad: { color: 0x3f6c92, topColor: 0xe8f4ff, edgeColor: 0x9a8cff, seamColor: 0x3dffb0, noise: 0.16, noiseScale: 192, roughness: 0.6 }
	},
	effects: [
		{ type: 'aurora', colors: [0x3dffb0, 0x46d8ff, 0x9a6cff], height: 8000 },
		{ type: 'snowFloor', color: 0xcfe0f0, z: floorTp - 1200, size: 60000 }
	]
};

export const bhop_rimefall: MapDef = {
	id: 'bhop_rimefall',
	title: 'Rimefall',
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
export const RIMEFALL_PATH: PathNode[] = path.nodes;
/** Node index ranges [first, last] per section (last = checkpoint pad, or the end pad). */
export const RIMEFALL_SECTIONS: ReadonlyArray<readonly [number, number]> = sectionRanges;
