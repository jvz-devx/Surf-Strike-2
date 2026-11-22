/**
 * surf_skyrend — hard staged surf. Slate spires in a thunderstorm, high above
 * an ocean of clouds.
 *
 * Seven stages. Each stage starts on its own platform (stage zone + respawn);
 * walking off the far edge drops onto the stage's first ramp, and the stage's
 * last ramp launches onto the next stage's platform. Ramps are steeper
 * (63–68°) and narrower (192–256 per face) than surf_ember's, every surface is
 * one brush (no seams, so no ramp bug).
 *
 *   1  +X   two A-frames, straight transfers
 *   2  +X   A-frame, then a 90° left air-turn onto a single ramp running +Y
 *   3  +Y   A-frame, up-ramp (climbs, needs speed), then a transfer that lands
 *           higher than the up-ramp's top
 *   4  +Y   A-frame, then a 110° right air-turn onto a ramp running yaw -20
 *   5  +X   long steep A-frame, then a 1280-unit gap: 600 u/s falls short, 700 makes it
 *   6  +X   A-frame, then a 75° left air-turn onto a ramp running yaw 75
 *   7  +Y   A-frame, second up-ramp, a higher landing ramp, then the end
 */
import { SURF_CVARS } from '../cvars.ts';
import type { Vec3 } from '../types.ts';
import type { BrushDef, MapDef, Spawn, Theme, Zone } from './types.ts';
import {
	along,
	boundsOf,
	dirXY,
	endZone,
	landingPoint,
	platform,
	ramp,
	rampExits,
	rampVelocity,
	sideways,
	stageZone,
	startZone,
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

/** Default horizontal width of one sloped face. */
const HW = 224;
/** Peak height of the first ramp. */
const TOP = 12000;
/** Stage platforms: square size, top height below the launching ramp's exit points. */
const PAD_SIZE = 1024;
const PAD_DROP = 320;
/** Speed used to aim stage platforms (they are large enough for 600–1000). */
const AIM_SPEED = 800;
/** Platform edge overhang over the next ramp's start, and peak depth below the platform top. */
const OVERHANG = 64;
const PEAK_BELOW_PAD = 160;

const brushes: BrushDef[] = [];
const zones: Zone[] = [];
const transfers: SurfTransfer[] = [];

/** Ramp of `length` along `yaw`, descending by `grade` per unit (negative = climbs). */
function rampAlong(from: Vec3, yaw: number, length: number, grade: number, angle: number, side: RampBrush['side'], hw = HW): RampBrush {
	const r = ramp({ from, to: along(from, yaw, length, -length * grade), angle, halfWidth: hw, side, material: 'slate' });
	brushes.push(r);
	return r;
}

/** Next ramp straight ahead: `gap` past the end of `prev`, peak `drop` lower (negative = higher). */
function nextStraight(prev: RampBrush, yaw: number, gap: number, drop: number): Vec3 {
	return along(prev.to, yaw, gap, -drop);
}

/** Platform aimed at where the launch from `r` lands (at AIM_SPEED), PAD_DROP below its exits. */
function landingPad(r: RampBrush, material = 'slatePad'): BoxBrush {
	const exits = rampExits(r);
	const top = Math.min(...exits.map((p) => p.z)) - PAD_DROP;
	const hits = exits.map((p) => landingPoint(p, rampVelocity(r, AIM_SPEED), top));
	const c = v3(hits.reduce((s, h) => s + h.x, 0) / hits.length, hits.reduce((s, h) => s + h.y, 0) / hits.length, top);
	const pad = platform(v3(Math.round(c.x), Math.round(c.y), Math.round(top)), PAD_SIZE, PAD_SIZE, material);
	brushes.push(pad);
	return pad;
}

/** Where the first ramp of the stage leaving `pad` along axis-aligned `yaw` starts. */
function firstRampStart(pad: BoxBrush, yaw: number): Vec3 {
	const c = topCenter(pad);
	const d = dirXY(yaw);
	const edge = v3(c.x + (d.x * PAD_SIZE) / 2, c.y + (d.y * PAD_SIZE) / 2, c.z);
	return along(edge, yaw, -OVERHANG, -PEAK_BELOW_PAD);
}

/** Register a stage platform: zone over it (and the air above, where players arrive). */
function stageStart(index: number, pad: BoxBrush, yaw: number): void {
	const respawn: Spawn = { pos: topCenter(pad), yaw };
	zones.push(stageZone(index, zoneOver(pad, 640), respawn));
}

// --- Stage 1 (+X): start platform, two A-frames.
const start = platform(v3(-448, 0, TOP + PEAK_BELOW_PAD), PAD_SIZE, 768, 'slatePad');
brushes.push(start, wall({ x: -976, y: -384 }, { x: -976, y: 384 }, start.max.z, start.max.z + 320, 'slate'));
zones.push(startZone(zoneOver(start, 256)));
const spawn: Spawn = { pos: topCenter(start), yaw: 0 };

const r1a = rampAlong(v3(0, 0, TOP), 0, 2560, 0.1, 64, 'both', 256);
const r1b = rampAlong(nextStraight(r1a, 0, 512, 420), 0, 2304, 0.1, 65, 'both');
transfers.push({ label: 'start → 1a', from: { platform: start, yaw: 0 }, to: { ramps: [r1a] } });
transfers.push({ label: '1a → 1b', from: { ramps: [r1a] }, to: { ramps: [r1b] } });

// --- Stage 2 (+X): A-frame, then a 90° left air-turn onto a single ramp heading +Y.
const p2 = landingPad(r1b);
stageStart(2, p2, 0);
transfers.push({ label: '1b → stage 2', from: { ramps: [r1b] }, to: { platform: p2 } });
const r2a = rampAlong(firstRampStart(p2, 0), 0, 2304, 0.1, 65, 'both');
// Turn ramp: its face (toward -X) starts 288 past 2a's end; its start sits 160 to the right of 2a's line.
const r2b = rampAlong(sideways(along(r2a.to, 0, 288 + HW, -120), 0, -160), 90, 2560, 0.1, 64, 'left');
transfers.push({ label: 'stage 2 → 2a', from: { platform: p2, yaw: 0 }, to: { ramps: [r2a] } });
transfers.push({ label: '2a → 2b (90° left air-turn)', from: { ramps: [r2a] }, to: { ramps: [r2b] } });

// --- Stage 3 (+Y): A-frame, up-ramp, then a landing ramp that starts above the up-ramp's top.
const p3 = landingPad(r2b);
stageStart(3, p3, 90);
transfers.push({ label: '2b → stage 3', from: { ramps: [r2b] }, to: { platform: p3 } });
const r3a = rampAlong(firstRampStart(p3, 90), 90, 2560, 0.13, 66, 'both');
const r3b = rampAlong(nextStraight(r3a, 90, 448, 440), 90, 1536, -0.2, 64, 'both');
const r3c = rampAlong(nextStraight(r3b, 90, 192, -12), 90, 2048, 0.12, 65, 'both');
transfers.push({ label: 'stage 3 → 3a', from: { platform: p3, yaw: 90 }, to: { ramps: [r3a] } });
transfers.push({ label: '3a → 3b (up-ramp)', from: { ramps: [r3a] }, to: { ramps: [r3b] } });
transfers.push({ label: '3b → 3c (height gain)', from: { ramps: [r3b] }, to: { ramps: [r3c] } });

// --- Stage 4 (+Y): A-frame, then a 110° right air-turn onto a ramp heading yaw -20.
const p4 = landingPad(r3c);
stageStart(4, p4, 90);
transfers.push({ label: '3c → stage 4', from: { ramps: [r3c] }, to: { platform: p4 } });
const r4a = rampAlong(firstRampStart(p4, 90), 90, 2304, 0.1, 66, 'both', 208);
const r4b = rampAlong(sideways(along(r4a.to, 90, 448, -130), 90, 448), -20, 2816, 0.1, 64, 'right', 240);
transfers.push({ label: 'stage 4 → 4a', from: { platform: p4, yaw: 90 }, to: { ramps: [r4a] } });
transfers.push({ label: '4a → 4b (110° right air-turn)', from: { ramps: [r4a] }, to: { ramps: [r4b] } });

// --- Stage 5 (+X): long steep A-frame, then a long gap onto a ramp far below.
const p5 = landingPad(r4b);
stageStart(5, p5, 0);
transfers.push({ label: '4b → stage 5', from: { ramps: [r4b] }, to: { platform: p5 } });
const r5a = rampAlong(firstRampStart(p5, 0), 0, 3328, 0.15, 67, 'both', 208);
const LONG_GAP = 1280;
const r5b = rampAlong(nextStraight(r5a, 0, LONG_GAP, 1700), 0, 2560, 0.1, 65, 'both', 256);
transfers.push({ label: 'stage 5 → 5a', from: { platform: p5, yaw: 0 }, to: { ramps: [r5a] } });
transfers.push({ label: '5a → 5b (long gap)', from: { ramps: [r5a] }, to: { ramps: [r5b] } });

// --- Stage 6 (+X): A-frame, then a 75° left air-turn onto a ramp heading yaw 75.
const p6 = landingPad(r5b);
stageStart(6, p6, 0);
transfers.push({ label: '5b → stage 6', from: { ramps: [r5b] }, to: { platform: p6 } });
const r6a = rampAlong(firstRampStart(p6, 0), 0, 2304, 0.1, 67, 'both', 192);
const r6b = rampAlong(sideways(along(r6a.to, 0, 352, -120), 0, -448), 75, 2816, 0.1, 65, 'left', 240);
transfers.push({ label: 'stage 6 → 6a', from: { platform: p6, yaw: 0 }, to: { ramps: [r6a] } });
transfers.push({ label: '6a → 6b (75° left air-turn)', from: { ramps: [r6a] }, to: { ramps: [r6b] } });

// --- Stage 7 (+Y): A-frame, second up-ramp, a higher landing ramp, then the end.
const p7 = landingPad(r6b);
stageStart(7, p7, 90);
transfers.push({ label: '6b → stage 7', from: { ramps: [r6b] }, to: { platform: p7 } });
const r7a = rampAlong(firstRampStart(p7, 90), 90, 2560, 0.14, 68, 'both', 192);
const r7b = rampAlong(nextStraight(r7a, 90, 448, 460), 90, 1536, -0.22, 65, 'both');
const r7c = rampAlong(nextStraight(r7b, 90, 192, -12), 90, 2304, 0.12, 66, 'both', 208);
transfers.push({ label: 'stage 7 → 7a', from: { platform: p7, yaw: 90 }, to: { ramps: [r7a] } });
transfers.push({ label: '7a → 7b (up-ramp)', from: { ramps: [r7a] }, to: { ramps: [r7b] } });
transfers.push({ label: '7b → 7c (height gain)', from: { ramps: [r7b] }, to: { ramps: [r7c] } });

// --- End platform with a back wall.
const end = landingPad(r7c);
brushes.push(wall({ x: end.min.x, y: end.max.y + 16 }, { x: end.max.x, y: end.max.y + 16 }, end.max.z, end.max.z + 512, 'slate'));
zones.push(endZone(zoneOver(end, 640)));
transfers.push({ label: '7c → end', from: { ramps: [r7c] }, to: { platform: end } });

// --- Catch triggers under each stage (fast fail), then the cloud sea far below.
export const SKYREND_STAGE_GROUPS: BrushDef[][] = [
	[start, r1a, r1b],
	[p2, r2a, r2b],
	[p3, r3a, r3b, r3c],
	[p4, r4a, r4b],
	[p5, r5a, r5b],
	[p6, r6a, r6b],
	[p7, r7a, r7b, r7c]
];
for (const g of SKYREND_STAGE_GROUPS) zones.push(teleportUnder(g, 'stage'));
const SEA_Z = boundsOf(brushes).min.z - 1024;
zones.push(teleportBelow(brushes, SEA_Z + 64, 'stage'));
const all = boundsOf(brushes);

const theme: Theme = {
	skyTop: 0x0b0f1c,
	skyHorizon: 0x47506b,
	skyBottom: 0x1c2233,
	fogColor: 0x3a4258,
	fogNear: 2000,
	fogFar: 16000,
	sunColor: 0xb8c8ff,
	sunIntensity: 0.6,
	sunDir: v3(-0.3, 0.45, 0.85),
	ambientSky: 0x8a9acc,
	ambientGround: 0x262b3a,
	ambientIntensity: 0.6,
	materials: {
		slate: { color: 0x2a2f3d, edgeColor: 0x6fd0ff, seamColor: 0x9a7bff, noise: 0.22, noiseScale: 224, roughness: 0.85 },
		slatePad: { color: 0x323848, topColor: 0x4a5266, edgeColor: 0x8fe0ff, noise: 0.18, noiseScale: 160, roughness: 0.9 }
	},
	effects: [
		// The ocean of clouds: a pale deck far below, thick cloud banks just above it, a storm layer overhead.
		{ type: 'snowFloor', color: 0x9aa3b8, z: SEA_Z, size: 90000 },
		{ type: 'clouds', color: 0xaeb6c8, count: 360, height: SEA_Z + 500 },
		{ type: 'clouds', color: 0x3c4356, count: 160, height: all.max.z + 2400 },
		{ type: 'aurora', colors: [0x5a7dff, 0xa070ff, 0x6fd0ff], height: all.max.z + 3200 },
		{
			type: 'embers',
			color: 0x9fdcff,
			count: 1200,
			area: { min: v3(all.min.x - 2048, all.min.y - 2048, SEA_Z), max: v3(all.max.x + 2048, all.max.y + 2048, all.max.z + 1024) }
		}
	]
};

export const surf_skyrend: MapDef = {
	id: 'surf_skyrend',
	title: 'Skyrend',
	kind: 'surf',
	difficulty: 'easy', // owner: all current surf maps are easy by CS standards
	layout: 'staged',
	cvars: { ...SURF_CVARS },
	spawn,
	brushes,
	zones,
	theme
};

/** Route data for the map tests (ballistic transfer checks). */
export const SKYREND_TRANSFERS: SurfTransfer[] = transfers;
