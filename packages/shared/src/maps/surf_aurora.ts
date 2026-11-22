/**
 * surf_aurora — easy linear surf. Dusk over a snowy valley.
 *
 * The course runs along +X. Six long V sections (a left and a right ramp
 * facing each other, base edges CENTRE_GAP apart so the V is open: stop
 * surfing and you fall through), each lower than the last, separated by
 * straight-ahead gaps. Ramps descend gently along their length so gravity adds
 * speed. Start platform and respawn ledges sit over the left ramp (LANE) and
 * drop onto its face; the last V launches onto a large end platform.
 */
import { SURF_CVARS } from '../cvars.ts';
import type { BrushDef, MapDef, Theme, Zone } from './types.ts';
import {
	box,
	boundsOf,
	checkpointZone,
	endZone,
	platform,
	startZone,
	surfV,
	teleportBelow,
	teleportUnder,
	topCenter,
	v3,
	wall,
	zoneOver,
	type BoxBrush,
	type RampBrush,
	type SurfTransfer
} from './helpers.ts';

/** Horizontal distance from each peak line to the centre line (V is 2 × this wide). */
const HALF_WIDTH = 448;
/** Base-edge separation at the bottom of each V (> player width, 32). */
const CENTRE_GAP = 128;
/** Lateral offset of the start platform and respawn ledges: over the middle of the left ramp face. */
const LANE = HALF_WIDTH / 2 + CENTRE_GAP / 4;
/** Straight-ahead gap between the end of one section and the start of the next. */
const GAP = 448;
/** Peak height lost from the end of one section to the start of the next. */
const SECTION_DROP = 480;
/** Peak descent per unit of length (≈ 5.7°). */
const GRADE = 0.1;
/** Peak height of the first section. */
const TOP = 5000;

/** Six sections: length along +X and slope angle (50–55°, gentle). */
const SECTIONS = [
	{ length: 3072, angle: 50 },
	{ length: 3584, angle: 51 },
	{ length: 3584, angle: 52 },
	{ length: 4096, angle: 53 },
	{ length: 3584, angle: 54 },
	{ length: 4096, angle: 55 }
];

/** Sections that get a checkpoint (split) zone in the gap before them, with a respawn ledge. */
const CHECKPOINT_SECTIONS = [1, 3, 5];
/** Respawn ledge height above the next section's peak (well above every transfer path). */
const LEDGE_RISE = 704;

const brushes: BrushDef[] = [];
const zones: Zone[] = [];
const transfers: SurfTransfer[] = [];

// --- Start platform: overhangs the first V by 64 units; walk off to drop in.
const start = platform(v3(-192, LANE, TOP + 192), 512, 512, 'snow');
brushes.push(start, wall({ x: -464, y: LANE - 256 }, { x: -464, y: LANE + 256 }, start.max.z, start.max.z + 256, 'rock'));
zones.push(startZone(zoneOver(start, 256)));
const spawn = { pos: topCenter(start), yaw: 0 };

// --- Ramp sections.
const sections: RampBrush[][] = [];
let x = 0;
let peak = TOP;
for (const [i, s] of SECTIONS.entries()) {
	const from = v3(x, 0, peak);
	const to = v3(x + s.length, 0, peak - s.length * GRADE);
	const pair = surfV({ from, to, angle: s.angle, halfWidth: HALF_WIDTH, gap: CENTRE_GAP, material: 'ice' });
	brushes.push(...pair);
	sections.push(pair);
	if (i === 0) transfers.push({ label: 'start → section 1', from: { platform: start, yaw: 0 }, to: { ramps: pair } });
	else transfers.push({ label: `section ${i} → ${i + 1}`, from: { ramps: sections[i - 1]! }, to: { ramps: pair } });

	if (CHECKPOINT_SECTIONS.includes(i)) {
		// Split zone over the whole gap before this section, plus a respawn ledge high above it.
		const ledge = platform(v3(x - 96, LANE, peak + LEDGE_RISE), 256, 256, 'snow');
		brushes.push(ledge);
		const index = CHECKPOINT_SECTIONS.indexOf(i) + 1;
		zones.push(
			checkpointZone(
				index,
				{
					min: v3(x - GAP, -HALF_WIDTH - 128, peak - pair[0].height - 64),
					max: v3(x + 64, HALF_WIDTH + 128, ledge.max.z + 256)
				},
				{ pos: topCenter(ledge), yaw: 0 }
			)
		);
		transfers.push({ label: `checkpoint ${index} ledge → section ${i + 1}`, from: { platform: ledge, yaw: 0 }, to: { ramps: pair } });
	}

	x = to.x + GAP;
	peak = to.z - SECTION_DROP;
}

// --- End platform: large landing pad 384 past the last V, 400 below its mid-face.
const last = sections[sections.length - 1]!;
const endTop = last[0].to.z - last[0].height / 2 - 400;
const endX0 = last[0].to.x + 384;
const END_LEN = 2048;
const end: BoxBrush = box(v3(endX0, -768, endTop - 64), v3(endX0 + END_LEN, 768, endTop), 'snow');
brushes.push(
	end,
	wall({ x: endX0 + END_LEN + 16, y: -768 }, { x: endX0 + END_LEN + 16, y: 768 }, endTop, endTop + 512, 'rock'),
	wall({ x: endX0, y: -784 }, { x: endX0 + END_LEN + 32, y: -784 }, endTop, endTop + 192, 'rock'),
	wall({ x: endX0, y: 784 }, { x: endX0 + END_LEN + 32, y: 784 }, endTop, endTop + 192, 'rock')
);
zones.push(endZone(zoneOver(end, 640)));
transfers.push({ label: 'section 6 → end', from: { ramps: last }, to: { platform: end } });

// --- Catch triggers under each section (fast fail), then the valley floor far below.
for (const pair of sections) zones.push(teleportUnder(pair, 'start', { x: 0, y: 1024 }));
// --- Valley floor far below; falling resets to the start.
const FLOOR_Z = boundsOf(brushes).min.z - 640;
zones.push(teleportBelow(brushes, FLOOR_Z + 64, 'start'));

const theme: Theme = {
	skyTop: 0x050a24,
	skyHorizon: 0x40538f,
	skyBottom: 0x161c36,
	fogColor: 0x29345e,
	fogNear: 2500,
	fogFar: 18000,
	sunColor: 0xffb48c,
	sunIntensity: 0.55,
	sunDir: v3(-0.7, 0.35, 0.18),
	ambientSky: 0x8ea6ff,
	ambientGround: 0x3a3f5c,
	ambientIntensity: 0.65,
	materials: {
		ice: { color: 0x6aaed8, topColor: 0xe4f3ff, edgeColor: 0xbfe8ff, noise: 0.12, noiseScale: 384, roughness: 0.3 },
		snow: { color: 0xd2deee, topColor: 0xf6faff, noise: 0.08, noiseScale: 256, roughness: 0.9 },
		rock: { color: 0x39414f, topColor: 0xd6e2f0, noise: 0.2, noiseScale: 192, roughness: 0.95 }
	},
	effects: [
		{ type: 'aurora', colors: [0x3dffa8, 0x52d0ff, 0xa66cff], height: 9000 },
		{ type: 'snowFloor', color: 0xcfdcef, z: FLOOR_Z, size: 80000 }
	]
};

export const surf_aurora: MapDef = {
	id: 'surf_aurora',
	title: 'Aurora',
	kind: 'surf',
	difficulty: 'easy',
	layout: 'linear',
	cvars: { ...SURF_CVARS },
	spawn,
	brushes,
	zones,
	theme
};

/** Route data for the map tests (ballistic transfer checks). */
export const AURORA_TRANSFERS: SurfTransfer[] = transfers;
