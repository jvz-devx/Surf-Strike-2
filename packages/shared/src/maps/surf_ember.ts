/**
 * surf_ember — hard staged surf. A volcanic canyon over a lava sea.
 *
 * Six stages. Each stage starts on its own basalt platform (stage zone +
 * respawn); walking off the far edge drops onto the stage's first ramp, and
 * the stage's last ramp launches onto the next stage's platform. Ramps are
 * steep (60–65°) and narrow (256 per face).
 *
 *   1  +X   two A-frames, straight transfer
 *   2  +X   A-frame, then a 90° left air-turn onto a single ramp running +Y
 *   3  +Y   A-frame, then an up-ramp (climbs along its length; needs speed)
 *   4  +Y   A-frame, then a 60° right air-turn onto a ramp running at yaw 30
 *   5  +X   long steep A-frame, then a 1024-unit gap that rewards speed
 *   6  +X   A-frame, then a 90° right air-turn onto a ramp running -Y → end
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

/** Horizontal width of one sloped face. */
const HW = 256;
/** Peak height of the first ramp. */
const TOP = 9000;
/** Stage platforms: square size, top height below the launching ramp's exit points. */
const PAD_SIZE = 1024;
const PAD_DROP = 320;
/** Speed used to aim stage platforms (they are large enough for 500–800). */
const AIM_SPEED = 650;
/** Platform edge overhang over the next ramp's start, and peak depth below the platform top. */
const OVERHANG = 64;
const PEAK_BELOW_PAD = 160;

const brushes: BrushDef[] = [];
const zones: Zone[] = [];
const transfers: SurfTransfer[] = [];

/** Ramp of `length` along `yaw`, descending by `grade` per unit (negative = climbs). */
function rampAlong(from: Vec3, yaw: number, length: number, grade: number, angle: number, side: RampBrush['side'], hw = HW): RampBrush {
	const r = ramp({ from, to: along(from, yaw, length, -length * grade), angle, halfWidth: hw, side, material: 'basalt' });
	brushes.push(r);
	return r;
}

/** Next ramp straight ahead: `gap` past the end of `prev`, peak `drop` lower. */
function nextStraight(prev: RampBrush, yaw: number, gap: number, drop: number): Vec3 {
	return along(prev.to, yaw, gap, -drop);
}

/** Platform aimed at where the launch from `r` lands (at AIM_SPEED), PAD_DROP below its exits. */
function landingPad(r: RampBrush, material = 'basaltPad'): BoxBrush {
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
function stageStart(index: number, pad: BoxBrush, yaw: number): Spawn {
	const respawn: Spawn = { pos: topCenter(pad), yaw };
	zones.push(index === 1 ? startZone(zoneOver(pad, 256)) : stageZone(index, zoneOver(pad, 640), respawn));
	return respawn;
}

// --- Stage 1 (+X): start platform, two A-frames.
const start = platform(v3(-448, 0, TOP + PEAK_BELOW_PAD), PAD_SIZE, 768, 'basaltPad');
brushes.push(start, wall({ x: -976, y: -384 }, { x: -976, y: 384 }, start.max.z, start.max.z + 320, 'basalt'));
zones.push(startZone(zoneOver(start, 256)));
const spawn: Spawn = { pos: topCenter(start), yaw: 0 };

const r1a = rampAlong(v3(0, 0, TOP), 0, 2560, 0.1, 62, 'both');
const r1b = rampAlong(nextStraight(r1a, 0, 448, 400), 0, 2048, 0.1, 61, 'both');
transfers.push({ label: 'start → 1a', from: { platform: start, yaw: 0 }, to: { ramps: [r1a] } });
transfers.push({ label: '1a → 1b', from: { ramps: [r1a] }, to: { ramps: [r1b] } });

// --- Stage 2 (+X): A-frame, then 90° left air-turn onto a single ramp heading +Y.
const p2 = landingPad(r1b);
stageStart(2, p2, 0);
transfers.push({ label: '1b → stage 2', from: { ramps: [r1b] }, to: { platform: p2 } });
const r2a = rampAlong(firstRampStart(p2, 0), 0, 2048, 0.1, 63, 'both');
// Turn ramp: face (toward -X) starts 256 past 2a's end; its start sits 192 to the right of 2a's line.
const r2b = rampAlong(sideways(along(r2a.to, 0, 256 + HW, -110), 0, -192), 90, 2560, 0.1, 62, 'left');
transfers.push({ label: 'stage 2 → 2a', from: { platform: p2, yaw: 0 }, to: { ramps: [r2a] } });
transfers.push({ label: '2a → 2b (90° left air-turn)', from: { ramps: [r2a] }, to: { ramps: [r2b] } });

// --- Stage 3 (+Y): A-frame, then an up-ramp that climbs 192 over its length.
const p3 = landingPad(r2b);
stageStart(3, p3, 90);
transfers.push({ label: '2b → stage 3', from: { ramps: [r2b] }, to: { platform: p3 } });
const r3a = rampAlong(firstRampStart(p3, 90), 90, 2304, 0.12, 64, 'both');
const r3b = rampAlong(nextStraight(r3a, 90, 448, 420), 90, 1600, -0.12, 62, 'both');
transfers.push({ label: 'stage 3 → 3a', from: { platform: p3, yaw: 90 }, to: { ramps: [r3a] } });
transfers.push({ label: '3a → 3b (up-ramp)', from: { ramps: [r3a] }, to: { ramps: [r3b] } });

// --- Stage 4 (+Y): A-frame, then a 60° right air-turn onto a ramp heading yaw 30.
const p4 = landingPad(r3b);
stageStart(4, p4, 90);
transfers.push({ label: '3b → stage 4', from: { ramps: [r3b] }, to: { platform: p4 } });
const r4a = rampAlong(firstRampStart(p4, 90), 90, 2048, 0.1, 61, 'both');
const r4b = rampAlong(sideways(along(r4a.to, 90, 320, -120), 90, HW), 30, 2560, 0.1, 63, 'right');
transfers.push({ label: 'stage 4 → 4a', from: { platform: p4, yaw: 90 }, to: { ramps: [r4a] } });
transfers.push({ label: '4a → 4b (60° right air-turn)', from: { ramps: [r4a] }, to: { ramps: [r4b] } });

// --- Stage 5 (+X): long steep A-frame, then a long gap onto a wider ramp far below.
const p5 = landingPad(r4b);
stageStart(5, p5, 0);
transfers.push({ label: '4b → stage 5', from: { ramps: [r4b] }, to: { platform: p5 } });
const r5a = rampAlong(firstRampStart(p5, 0), 0, 3072, 0.15, 63, 'both');
const LONG_GAP = 1024;
const r5b = rampAlong(nextStraight(r5a, 0, LONG_GAP, 1440), 0, 2560, 0.1, 63, 'both', 320);
transfers.push({ label: 'stage 5 → 5a', from: { platform: p5, yaw: 0 }, to: { ramps: [r5a] } });
transfers.push({ label: '5a → 5b (long gap)', from: { ramps: [r5a] }, to: { ramps: [r5b] } });

// --- Stage 6 (+X): A-frame, then a 90° right air-turn onto a ramp heading -Y, then the end.
const p6 = landingPad(r5b);
stageStart(6, p6, 0);
transfers.push({ label: '5b → stage 6', from: { ramps: [r5b] }, to: { platform: p6 } });
const r6a = rampAlong(firstRampStart(p6, 0), 0, 2304, 0.1, 64, 'both');
const r6b = rampAlong(sideways(along(r6a.to, 0, 256 + HW, -110), 0, 192), -90, 2560, 0.1, 62, 'right');
transfers.push({ label: 'stage 6 → 6a', from: { platform: p6, yaw: 0 }, to: { ramps: [r6a] } });
transfers.push({ label: '6a → 6b (90° right air-turn)', from: { ramps: [r6a] }, to: { ramps: [r6b] } });

// --- End platform with a back wall.
const end = landingPad(r6b);
const eb = end;
brushes.push(
	wall({ x: eb.min.x, y: eb.min.y - 16 }, { x: eb.max.x, y: eb.min.y - 16 }, eb.max.z, eb.max.z + 512, 'basalt')
);
zones.push(endZone(zoneOver(end, 640)));
transfers.push({ label: '6b → end', from: { ramps: [r6b] }, to: { platform: end } });

// --- Catch triggers under each stage (fast fail), then the lava sea far below.
const STAGE_GROUPS: BrushDef[][] = [
	[start, r1a, r1b],
	[p2, r2a, r2b],
	[p3, r3a, r3b],
	[p4, r4a, r4b],
	[p5, r5a, r5b],
	[p6, r6a, r6b]
];
for (const g of STAGE_GROUPS) zones.push(teleportUnder(g, 'stage'));
const LAVA_Z = boundsOf(brushes).min.z - 768;
zones.push(teleportBelow(brushes, LAVA_Z + 64, 'stage'));
const all = boundsOf(brushes);

const theme: Theme = {
	skyTop: 0x170604,
	skyHorizon: 0x8c2f0b,
	skyBottom: 0x2a0903,
	fogColor: 0x6e2a10,
	fogNear: 1800,
	fogFar: 15000,
	sunColor: 0xff8f45,
	sunIntensity: 0.75,
	sunDir: v3(0.4, -0.5, 0.35),
	ambientSky: 0xff7a48,
	ambientGround: 0x45120a,
	ambientIntensity: 0.55,
	materials: {
		basalt: { color: 0x141214, seamColor: 0xff6a1a, noise: 0.25, noiseScale: 192, roughness: 0.9 },
		basaltPad: { color: 0x1d1917, topColor: 0x2a2420, seamColor: 0xff8a2a, noise: 0.2, noiseScale: 160, roughness: 0.95 }
	},
	effects: [
		{ type: 'lavaSea', color: 0xff4a10, z: LAVA_Z, size: 90000 },
		{
			type: 'embers',
			color: 0xffa040,
			count: 1600,
			area: { min: v3(all.min.x - 2048, all.min.y - 2048, LAVA_Z), max: v3(all.max.x + 2048, all.max.y + 2048, all.max.z + 1024) }
		}
	]
};

export const surf_ember: MapDef = {
	id: 'surf_ember',
	title: 'Ember',
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
export const EMBER_TRANSFERS: SurfTransfer[] = transfers;
