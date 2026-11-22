/**
 * surf_hadal — hard linear surf. A crystal-lined trench far below the sea.
 *
 * Every ramp is a single steep face (63–68°, 192–256 wide), and consecutive
 * ramps face alternate sides: there is no V to fall back into. Linear layout:
 * checkpoints only record splits, and any fall sends the player back to the
 * start with the timer reset.
 *
 *   1  yaw   0  start drop, right face → left face (zigzag)
 *   2  yaw -90  90° right air-turn onto a right face, zigzag onto a left face
 *   3  yaw -90  up-ramp: a right face that climbs along its length
 *   4  yaw -15  75° left air-turn off the up-ramp, zigzag
 *   5  yaw -15  rhythm: four short 192-wide faces in quick succession
 *   6  yaw  45  60° left air-turn onto a long, steep speed ramp
 *   7  yaw  45  long gap (1280 across, 1700 down) that needs ≥ 700 u/s
 *   8  yaw 135  90° left air-turn onto the last face, then the end platform
 */
import { SURF_CVARS } from '../cvars.ts';
import type { BrushDef, MapDef, Spawn, Theme, Zone } from './types.ts';
import {
	boundsOf,
	brushBounds,
	checkpointZone,
	endZone,
	landingPoint,
	platform,
	ramp,
	rampExits,
	rampVelocity,
	startZone,
	teleportBelow,
	topCenter,
	v3,
	wall,
	zoneOver,
	type BoxBrush,
	type RampBrush,
	type SurfTransfer
} from './helpers.ts';
import {
	boundsOfPoints,
	boxesOverlap,
	catchUnder,
	flightSamples,
	hullBox,
	ledgeOver,
	nextRamp,
	rampYaw,
	type Leg
} from './surf_hadal-helpers.ts';

/** Peak height of the first ramp. */
const TOP = 12000;
/** Start platform: top this far above the first peak, overhanging the first ramp by 64. */
const START_RISE = 160;
/** Speeds the ramp-to-ramp transfers are aimed for (tests check every one lands at all of them). */
export const HADAL_SPEEDS = [700, 800, 900];
/** Minimum respawn ledge rise above the ramp it drops onto; raised until it clears every flight path. */
const LEDGE_RISE = 640;
/** Speeds whose flights the ledges must clear (wider than HADAL_SPEEDS). */
const CLEAR_SPEEDS = [600, 700, 800, 900, 1000, 1100];
/** End platform: size, depth below the last exit, aim speed. */
const END_SIZE = 1280;
const END_DROP = 320;
const END_AIM = 800;

const brushes: BrushDef[] = [];
const zones: Zone[] = [];
const transfers: SurfTransfer[] = [];
const rampsInOrder: RampBrush[] = [];

/** Alternate the two crystal tints by face side, so the left/right rhythm reads at a glance. */
const mat = (side: 'left' | 'right') => (side === 'left' ? 'amethyst' : 'crystal');

function add(r: RampBrush): RampBrush {
	brushes.push(r);
	rampsInOrder.push(r);
	return r;
}

/** Next ramp after `prev` along `leg`, with its transfer registered. */
function chain(prev: RampBrush, leg: Leg, label: string): RampBrush {
	const r = add(nextRamp(prev, leg, mat(leg.side)));
	transfers.push({ label, from: { ramps: [prev] }, to: { ramps: [r] } });
	return r;
}

// --- Section 1 (yaw 0): start platform, right face, zigzag onto a left face.
const r1 = add(ramp({ from: v3(0, 0, TOP), to: v3(2560, 0, TOP - 2560 * 0.12), angle: 63, halfWidth: 256, side: 'right', material: 'crystal' }));
// Platform centred over the face's middle (128 to the right of the peak), its +X edge 64 past the ramp start.
const start = platform(v3(64 - 192, -128, TOP + START_RISE), 384, 384, 'shelf');
brushes.push(start, wall({ x: -336, y: -320 }, { x: -336, y: 64 }, start.max.z, start.max.z + 320, 'rock'));
zones.push(startZone(zoneOver(start, 256)));
const spawn: Spawn = { pos: topCenter(start), yaw: 0 };
transfers.push({ label: 'start → 1a', from: { platform: start, yaw: 0 }, to: { ramps: [r1] } });

const r2 = chain(r1, { yaw: 0, side: 'left', length: 2048, grade: 0.1, angle: 64, hw: 256, ahead: 448, back: 0, drop: 400 }, '1a → 1b (zigzag)');

// --- Section 2 (yaw -90): 90° right air-turn, zigzag.
const r3 = chain(r2, { yaw: -90, side: 'right', length: 2304, grade: 0.1, angle: 64, hw: 256, ahead: 704, back: 320, drop: 420 }, '1b → 2a (90° right air-turn)');
const r4 = chain(r3, { yaw: -90, side: 'left', length: 1792, grade: 0.1, angle: 65, hw: 240, ahead: 448, back: 0, drop: 420 }, '2a → 2b (zigzag)');

// --- Section 3 (yaw -90): the up-ramp.
const r5 = chain(r4, { yaw: -90, side: 'right', length: 1536, grade: -0.1, angle: 63, hw: 256, ahead: 448, back: 0, drop: 460 }, '2b → 3 (up-ramp)');

// --- Section 4 (yaw -15): 75° left air-turn off the top of the up-ramp, zigzag.
const r6 = chain(r5, { yaw: -15, side: 'left', length: 2048, grade: 0.1, angle: 65, hw: 240, ahead: 768, back: 256, drop: 260 }, '3 → 4a (75° left air-turn)');
const r7 = chain(r6, { yaw: -15, side: 'right', length: 1792, grade: 0.12, angle: 66, hw: 224, ahead: 416, back: 0, drop: 420 }, '4a → 4b (zigzag)');

// --- Section 5 (yaw -15): rhythm — four short, narrow faces in quick succession.
const rhythm: RampBrush[] = [];
let prev = r7;
for (let i = 0; i < 4; i++) {
	const side = i % 2 === 0 ? 'left' : 'right';
	prev = chain(
		prev,
		{ yaw: -15, side, length: 768, grade: 0.12, angle: i < 2 ? 66 : 67, hw: 192, ahead: i === 0 ? 384 : 224, back: 0, drop: 240 },
		i === 0 ? '4b → 5a (rhythm)' : `5${'abcd'[i - 1]} → 5${'abcd'[i]} (rhythm)`
	);
	rhythm.push(prev);
}

// --- Section 6 (yaw 45): 60° left air-turn onto a long steep speed ramp.
const r12 = chain(prev, { yaw: 45, side: 'left', length: 3072, grade: 0.16, angle: 67, hw: 224, ahead: 640, back: 256, drop: 400 }, '5d → 6 (60° left air-turn)');

// --- Section 7 (yaw 45): the long gap.
export const LONG_GAP = 1280;
const r13 = chain(r12, { yaw: 45, side: 'right', length: 2560, grade: 0.1, angle: 66, hw: 256, ahead: LONG_GAP, back: 0, drop: 1700 }, '6 → 7 (long gap)');

// --- Section 8 (yaw 135): 90° left air-turn onto the last face, then the end platform.
const r14 = chain(r13, { yaw: 135, side: 'left', length: 2304, grade: 0.1, angle: 68, hw: 224, ahead: 704, back: 320, drop: 420 }, '7 → 8 (90° left air-turn)');

const exits = rampExits(r14);
const endTop = Math.round(Math.min(...exits.map((p) => p.z)) - END_DROP);
const hit = landingPoint(exits[0]!, rampVelocity(r14, END_AIM), endTop);
const end: BoxBrush = platform(v3(Math.round(hit.x), Math.round(hit.y), endTop), END_SIZE, END_SIZE, 'shelf');
brushes.push(
	end,
	// Heading 135 runs towards -X / +Y: back walls on those two sides.
	wall({ x: end.min.x - 16, y: end.min.y }, { x: end.min.x - 16, y: end.max.y + 32 }, endTop, endTop + 512, 'rock'),
	wall({ x: end.min.x, y: end.max.y + 16 }, { x: end.max.x, y: end.max.y + 16 }, endTop, endTop + 512, 'rock')
);
zones.push(endZone(zoneOver(end, 640)));
transfers.push({ label: '8 → end', from: { ramps: [r14] }, to: { platform: end } });

// --- Checkpoints: split zones over the flight into sections 3, 5, 7 and 8, each with a respawn ledge.
const CHECKPOINT_RAMPS = [r5, rhythm[0]!, r13, r14];
const flights = transfers.flatMap((t) => flightSamples(t, CLEAR_SPEEDS)).map((p) => hullBox(p, 64));
for (const [i, target] of CHECKPOINT_RAMPS.entries()) {
	const tr = transfers.find((t) => 'ramps' in t.to && t.to.ramps[0] === target)!;
	let rise = LEDGE_RISE;
	while (flights.some((f) => boxesOverlap(f, ledgeOver(target, rise, 'shelf')))) rise += 64;
	const ledge = ledgeOver(target, rise, 'shelf');
	brushes.push(ledge);
	const fly = boundsOfPoints(flightSamples(tr, HADAL_SPEEDS, 800, 0.4), 96);
	const zone = {
		min: v3(Math.min(fly.min.x, ledge.min.x), Math.min(fly.min.y, ledge.min.y), fly.min.z),
		max: v3(Math.max(fly.max.x, ledge.max.x), Math.max(fly.max.y, ledge.max.y), ledge.max.z + 192)
	};
	const respawn: Spawn = { pos: topCenter(ledge), yaw: rampYaw(target) };
	zones.push(checkpointZone(i + 1, zone, respawn));
	transfers.push({ label: `checkpoint ${i + 1} ledge`, from: { platform: ledge, yaw: respawn.yaw }, to: { ramps: [target] } });
}

// --- Catch triggers under each section (fast fail → start), then the abyss floor far below.
export const HADAL_SECTIONS: BrushDef[][] = [[start, r1, r2], [r3, r4], [r5], [r6, r7], rhythm, [r12], [r13], [r14, end]];
const CATCH_MARGIN = { x: 384, y: 384 };
const CATCH_GAP = 512;
const keepClear = [...zones];
for (const g of HADAL_SECTIONS) {
	const avoid = [...brushes.filter((b) => !g.includes(b)).map(brushBounds), ...keepClear];
	zones.push(catchUnder(g, avoid, CATCH_MARGIN, CATCH_GAP));
}
const FLOOR_Z = boundsOf(brushes).min.z - 768;
zones.push(teleportBelow(brushes, FLOOR_Z + 64, 'start'));
const all = boundsOf(brushes);

const theme: Theme = {
	skyTop: 0x020309,
	skyHorizon: 0x0b2a3a,
	skyBottom: 0x05040f,
	fogColor: 0x081a26,
	fogNear: 1600,
	fogFar: 14000,
	sunColor: 0x8fe4ff,
	sunIntensity: 0.4,
	sunDir: v3(0.25, 0.35, 0.9),
	ambientSky: 0x3d6f9e,
	ambientGround: 0x1c1030,
	ambientIntensity: 0.6,
	materials: {
		crystal: { color: 0x0d2a33, seamColor: 0x5ff2ff, edgeColor: 0x9ffcff, noise: 0.22, noiseScale: 160, roughness: 0.35 },
		amethyst: { color: 0x1d1236, seamColor: 0xb47cff, edgeColor: 0xd6b8ff, noise: 0.22, noiseScale: 160, roughness: 0.35 },
		shelf: { color: 0x141a24, topColor: 0x1f2d36, seamColor: 0x3fe0c8, noise: 0.18, noiseScale: 192, roughness: 0.9 },
		rock: { color: 0x0a0d14, topColor: 0x161c26, edgeColor: 0x6e58ff, noise: 0.25, noiseScale: 224, roughness: 0.95 }
	},
	effects: [
		{ type: 'lavaSea', color: 0x10867f, z: FLOOR_Z, size: 90000 },
		{
			type: 'embers',
			color: 0x7ffcff,
			count: 1800,
			area: { min: v3(all.min.x - 2048, all.min.y - 2048, FLOOR_Z), max: v3(all.max.x + 2048, all.max.y + 2048, all.max.z + 1024) }
		},
		{ type: 'aurora', colors: [0x2fe6d0, 0x6b5cff, 0xc77dff], height: all.max.z + 3000 }
	]
};

export const surf_hadal: MapDef = {
	id: 'surf_hadal',
	title: 'Hadal',
	kind: 'surf',
	difficulty: 'easy', // owner: all current surf maps are easy by CS standards
	layout: 'linear',
	cvars: { ...SURF_CVARS },
	spawn,
	brushes,
	zones,
	theme
};

/** Route data for the map tests (ballistic transfer checks). */
export const HADAL_TRANSFERS: SurfTransfer[] = transfers;
/** Every ramp, in course order. */
export const HADAL_RAMPS: RampBrush[] = rampsInOrder;
