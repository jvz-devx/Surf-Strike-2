/**
 * bhop_meadow — easy bhop. Floating grass islands at noon.
 *
 * 40 stone blocks (128 × 128 tops) in 5 sections of 8, gaps 96–160 edge to
 * edge, tops within ±32 of z = 0. Each section ends on a 384 × 384 checkpoint
 * island; section 5 ends on the long end island (checkpoint 5 on its near
 * part, end zone on its far part).
 *
 *   1  straight east
 *   2  gentle left curve (east → north)
 *   3  straight north with small rises and dips
 *   4  gentle right curve (north → east)
 *   5  soft zigzag east to the end island
 */
import { BHOP_CVARS } from '../cvars.ts';
import type { MapDef, Theme } from './types.ts';
import { BhopPath, bhopLayout, boundsOf, teleportBelow, v3, type PathStep } from './helpers.ts';

const BLOCK = 128;
const CHECKPOINT_SIZE = 384;

const blocks = (gaps: number[], turns: number[] = [], dzs: number[] = []): PathStep[] =>
	gaps.map((gap, i) => ({ gap, turn: turns[i] ?? 0, dz: dzs[i] ?? 0 }));
const checkpoint = (gap: number): PathStep => ({ gap, along: CHECKPOINT_SIZE, across: CHECKPOINT_SIZE, kind: 'checkpoint' });

const SECTIONS: PathStep[][] = [
	// 1: straight east, steady rhythm.
	[...blocks([112, 128, 128, 144, 128, 112, 128, 144]), checkpoint(128)],
	// 2: gentle left curve, 15° per block, ending heading north.
	[...blocks([128, 128, 144, 128, 128, 144, 128, 128], [15, 15, 15, 0, 15, 15, 15, 0]), checkpoint(128)],
	// 3: straight north, small rises and dips.
	[...blocks([128, 144, 128, 160, 128, 144, 128, 112], [], [0, 16, 16, 0, -16, -16, -16, 16]), checkpoint(128)],
	// 4: gentle right curve back to east.
	[...blocks([128, 144, 128, 144, 128, 144, 128, 128], [-15, -15, -15, 0, -15, -15, -15, 0]), checkpoint(144)],
	// 5: soft zigzag, wider gaps, then the end island.
	[
		...blocks([144, 152, 160, 144, 152, 160, 144, 128], [20, -20, -20, 20, 20, -20, -20, 20]),
		{ gap: 128, along: 1152, across: 512, kind: 'end' }
	]
];

const path = new BhopPath({ top: v3(0, 0, 0), sx: 512, sy: 512 }, 0, BLOCK, 96);
for (const section of SECTIONS) for (const step of section) path.step(step);

const { brushes, zones, spawn } = bhopLayout(path.nodes, (n) => (n.kind === 'block' ? 'stone' : 'island'));

// Clouds drift below the islands; falling through them returns to the last checkpoint.
const low = boundsOf(brushes).min.z;
zones.push(teleportBelow(brushes, low - 256, 'stage'));

const theme: Theme = {
	skyTop: 0x2f86e6,
	skyHorizon: 0xc4e6ff,
	skyBottom: 0x9cc6ea,
	fogColor: 0xcde5fb,
	fogNear: 3000,
	fogFar: 20000,
	sunColor: 0xfff3d6,
	sunIntensity: 1.25,
	sunDir: v3(0.3, 0.25, 0.92),
	ambientSky: 0xbfe0ff,
	ambientGround: 0x6d7a52,
	ambientIntensity: 0.7,
	materials: {
		stone: { color: 0x8b8a83, topColor: 0x5fa83f, noise: 0.18, noiseScale: 96, roughness: 0.85 },
		island: { color: 0x6e5238, topColor: 0x58a238, noise: 0.15, noiseScale: 192, roughness: 0.9 }
	},
	effects: [
		{ type: 'clouds', color: 0xffffff, count: 70, height: low - 900 },
		{ type: 'clouds', color: 0xf4f8ff, count: 30, height: 2400 }
	]
};

export const bhop_meadow: MapDef = {
	id: 'bhop_meadow',
	title: 'Meadow',
	kind: 'bhop',
	difficulty: 'easy',
	layout: 'linear',
	cvars: { ...BHOP_CVARS },
	spawn,
	brushes,
	zones,
	theme
};

/** Generator output for the map tests (block sizes and gaps). */
export const MEADOW_PATH = path.nodes;
