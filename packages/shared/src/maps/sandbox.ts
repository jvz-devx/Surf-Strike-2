/**
 * sandbox — physics and zone test map (not in the rotation).
 *
 * Flat ground at z = 0 with, from south to north:
 *   y ≈ -1024  step test: 8 / 16 / 18 / 19 / 24 unit steps (18 climbs, 19 blocks)
 *   y ≈  -512  a row of bhop blocks (128 × 128, 64 tall, 128 gaps)
 *   y =     0  spawn + start zone (west), end zone (east)
 *   y ≈   800  55° surf V (2 × 384 wide, 2048 long) with stairs up to a drop-in platform
 *   x ≈  2304  wall corner (south-east)
 * A checkpoint zone sits past the bhop row; walking off the ground's edge
 * falls into the teleport trigger.
 */
import { SURF_CVARS } from '../cvars.ts';
import type { BrushDef, MapDef, Theme, Zone } from './types.ts';
import {
	box,
	checkpointZone,
	endZone,
	platform,
	startZone,
	surfV,
	teleportBelow,
	v3,
	wall,
	type BoxBrush
} from './helpers.ts';

const brushes: BrushDef[] = [];
const zones: Zone[] = [];

// Ground.
const ground: BoxBrush = box(v3(-1792, -1536, -64), v3(3328, 1536, 0), 'dev');
brushes.push(ground);

// Step test row.
const STEPS = [8, 16, 18, 19, 24];
STEPS.forEach((h, i) => brushes.push(box(v3(256 + i * 320, -1088, 0), v3(256 + i * 320 + 128, -960, h), 'devStep')));

// Bhop row.
for (let i = 0; i < 6; i++) brushes.push(box(v3(512 + i * 256, -576, 0), v3(640 + i * 256, -448, 64), 'devBlock'));

// Surf V on the ground (base z = 0), centred on y = 800.
const V_Y = 800;
const V_HALF = 384;
const vRamps = surfV({ from: v3(0, V_Y, 0), to: v3(2048, V_Y, 0), angle: 55, halfWidth: V_HALF, material: 'devRamp' });
// surfV takes the centre line at peak height: lift both ramps so the base sits on the ground.
for (const r of vRamps) {
	r.from = v3(r.from.x, r.from.y, r.height);
	r.to = v3(r.to.x, r.to.y, r.height);
}
brushes.push(...vRamps);

// Drop-in platform over the V start, reached by 16-unit stairs rising towards +X.
const DROP_TOP = 608;
brushes.push(platform(v3(-128, V_Y, DROP_TOP), 384, 384, 'dev'));
const STAIR_COUNT = DROP_TOP / 16;
for (let k = 1; k <= STAIR_COUNT; k++) {
	const x1 = -320 - 32 * (STAIR_COUNT - k);
	brushes.push(box(v3(x1 - 32, V_Y - 96, 0), v3(x1, V_Y + 96, 16 * k), 'devStep'));
}

// Wall corner.
brushes.push(
	wall({ x: 2304, y: -1280 }, { x: 2304, y: -768 }, 0, 256, 'devWall'),
	wall({ x: 2320, y: -1280 }, { x: 2816, y: -1280 }, 0, 256, 'devWall')
);

// Zones.
zones.push(startZone({ min: v3(-256, -256, -16), max: v3(256, 256, 192) }));
zones.push(endZone({ min: v3(2560, -256, -16), max: v3(3072, 256, 192) }));
zones.push(
	checkpointZone(1, { min: v3(2048, -640, -16), max: v3(2304, -384, 192) }, { pos: v3(2176, -512, 0), yaw: 0 })
);
zones.push(teleportBelow(brushes, -256, 'start', 4096, 4096));

const theme: Theme = {
	skyTop: 0x3c5a80,
	skyHorizon: 0xa8b8c8,
	skyBottom: 0x707880,
	fogColor: 0x9aa6b2,
	fogNear: 4000,
	fogFar: 20000,
	sunColor: 0xffffff,
	sunIntensity: 1,
	sunDir: v3(0.4, 0.3, 0.86),
	ambientSky: 0xc0d0e0,
	ambientGround: 0x606060,
	ambientIntensity: 0.6,
	materials: {
		dev: { color: 0x7a7a7a, topColor: 0x8e8e8e, noise: 0.1, noiseScale: 128 },
		devStep: { color: 0xc08040, topColor: 0xd89a58, noise: 0.05 },
		devBlock: { color: 0x4070c0, topColor: 0x5a8ad8, noise: 0.05 },
		devRamp: { color: 0xd06030, noise: 0.08, roughness: 0.5 },
		devWall: { color: 0x606878, noise: 0.08 }
	},
	effects: []
};

export const SANDBOX: MapDef = {
	id: 'sandbox',
	title: 'Sandbox',
	kind: 'surf',
	difficulty: 'easy',
	layout: 'linear',
	cvars: { ...SURF_CVARS },
	spawn: { pos: v3(0, 0, 0), yaw: 0 },
	brushes,
	zones,
	theme
};
