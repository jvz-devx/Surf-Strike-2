/**
 * bhop_circuit — hard bhop. A neon circuit board at night.
 *
 * ~60 small blocks (64 × 64 tops) and narrow strips (32–48 wide, 256+ long)
 * in 6 sections, gaps 128–240 edge to edge, each section ending on a 256 × 256
 * checkpoint pad. Section 6 ends on the long end pad (checkpoint 6 on its
 * near part, end zone on its far part).
 *
 *   1  straight, gaps growing from 128 to 224 (build speed)
 *   2  90° zigzag: alternate left / right strafe turns
 *   3  narrow strips with right-angle turns between them
 *   4  height changes: steps up (≤ 40) and drops, 45° turns
 *   5  long gaps up to 240 on a gentle curve
 *   6  everything at once, onto the end pad
 */
import { BHOP_CVARS } from '../cvars.ts';
import type { MapDef, Theme } from './types.ts';
import { BhopPath, bhopLayout, boundsOf, teleportBelow, v3, type PathStep } from './helpers.ts';

const BLOCK = 64;
const PAD = 256;

/** Square block step. */
const b = (gap: number, turn = 0, dz = 0): PathStep => ({ gap, turn, dz });
/** Narrow strip along the heading. */
const strip = (gap: number, length: number, width: number, turn = 0, dz = 0): PathStep => ({
	gap,
	turn,
	dz,
	along: length,
	across: width
});
const checkpoint = (gap: number, turn = 0, dz = 0): PathStep => ({ gap, turn, dz, along: PAD, across: PAD, kind: 'checkpoint' });

const SECTIONS: PathStep[][] = [
	// 1: straight east, gaps grow so speed has to build.
	[b(128), b(144), b(160), b(160), b(176), b(176), b(192), b(192), b(208), b(224), checkpoint(176)],
	// 2: zigzag — every block is a hard 90° strafe turn.
	[b(144), b(144, 90), b(160, -90), b(160, 90), b(176, -90), b(176, 90), b(176, -90), b(192, 90), b(192, -90), b(176), checkpoint(160)],
	// 3: strips (land anywhere along them) joined by right-angle turns.
	[
		b(160),
		strip(176, 320, 40),
		b(192),
		strip(160, 384, 32, 90),
		b(176),
		b(200),
		strip(176, 256, 48, -90),
		b(192),
		strip(192, 320, 40, -90),
		b(176, 90),
		checkpoint(160)
	],
	// 4: height changes — climbs of up to 40 and drops, with 45° turns.
	[
		b(160, 0, 32),
		b(176, 45, 40),
		b(192, 0, -64),
		b(176, -45, 24),
		b(160, -45, 40),
		b(224, 0, -96),
		b(176, 45, 32),
		b(160, 0, 40),
		b(208, 0, -48),
		b(176, 0, 16),
		checkpoint(160, 0, -24)
	],
	// 5: long gaps on a gentle curve; needs carried speed.
	[b(192, 30), b(208, 0), b(224, 30), b(240, 0), b(224, 30), b(240, 0), b(208, -30), b(240, 0), b(224, -30), b(240, -30), checkpoint(192)],
	// 6: finale — turns, a strip, height changes and long gaps.
	[
		b(176, 90),
		b(208, -90, 32),
		strip(192, 320, 32),
		b(224, 0, -40),
		b(176, -90, 40),
		b(240, 0, -64),
		b(192, 90),
		b(224, 0, 24),
		b(240, 0, -32),
		{ gap: 192, along: 896, across: 320, kind: 'end' }
	]
];

const path = new BhopPath({ top: v3(0, 0, 0), sx: 384, sy: 384 }, 0, BLOCK, 48);
for (const section of SECTIONS) for (const step of section) path.step(step);

const { brushes, zones, spawn } = bhopLayout(path.nodes, (n, i) =>
	n.kind === 'block' ? (i % 2 ? 'chipCyan' : 'chipMagenta') : n.kind === 'strip' ? 'trace' : 'pad'
);

// Grid floor far below; falling returns to the last checkpoint.
const low = boundsOf(brushes).min.z;
zones.push(teleportBelow(brushes, low - 256, 'stage'));

const theme: Theme = {
	skyTop: 0x020210,
	skyHorizon: 0x0c0a2e,
	skyBottom: 0x010106,
	fogColor: 0x070720,
	fogNear: 1500,
	fogFar: 12000,
	sunColor: 0x7a6cff,
	sunIntensity: 0.25,
	sunDir: v3(-0.3, 0.4, 0.85),
	ambientSky: 0x3a3a90,
	ambientGround: 0x0a0a1a,
	ambientIntensity: 0.5,
	materials: {
		chipCyan: { color: 0x0f1018, topColor: 0x171a26, edgeColor: 0x00f0ff, noise: 0.06, noiseScale: 64, roughness: 0.4 },
		chipMagenta: { color: 0x120f18, topColor: 0x1a1626, edgeColor: 0xff2bd6, noise: 0.06, noiseScale: 64, roughness: 0.4 },
		trace: { color: 0x0d1016, topColor: 0x14202a, edgeColor: 0x00f0ff, noise: 0.04, noiseScale: 128, roughness: 0.35 },
		pad: { color: 0x14121e, topColor: 0x1c1a2c, edgeColor: 0xff2bd6, noise: 0.08, noiseScale: 128, roughness: 0.5 }
	},
	effects: [{ type: 'gridFloor', color: 0x00c8ff, z: low - 1600, size: 40000 }]
};

export const bhop_circuit: MapDef = {
	id: 'bhop_circuit',
	title: 'Circuit',
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
export const CIRCUIT_PATH = path.nodes;
