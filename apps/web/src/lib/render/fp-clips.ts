/**
 * First-person reloads and the bolt cycle of the Infected guns (docs/modes.md#infected): what the gun, its moving
 * parts, its magazine and both hands do over progress 0..1. Data and pure functions, no scene objects;
 * render/fp-anim.ts poses the loaded gun with them, fp-clips.test.ts and fp-contact.test.ts check them.
 *
 * The times of the magazine, the bolt and the cover are those of the third-person clips (character/reload.ts), so
 * other players see the same moves at the same moments. A reload of an empty gun ends with the bolt or the slide; one
 * with a round left leaves that out and takes the same time. The whole clip is always the real reload time.
 *
 * Gun offsets are in the viewmodel node (render/zombies.ts): x right, y up, z towards the eye, turns about its axes (+x
 * muzzle up, +y muzzle left, +z top to the left). Hands and magazines are in model units of the gun.
 */
import type { GunId, PartName } from './gun-rig.js';
import { OPEN, type GunPoseName, type HandPlace, type HandShape, type Quat } from './hand-poses.js';
import type { V3 } from './weapon-assets.js';

// ---------------------------------------------------------------------
// Clip data

/** Where a hand is at `t`: a named pose of the gun (it follows the part it holds), moved by `off`. */
export interface HandKey {
	t: number;
	pose: GunPoseName;
	/** Wrist moved from the pose (model units); the elbow goes along. */
	off?: V3;
	/** Hand turned from the pose (Euler XYZ, about the wrist, model axes). */
	turn?: V3;
	/** Fingers opened: 0 the pose, 1 the open hand. */
	open?: number;
	/** The pose rides a part it is not attached to (the feed cover). */
	on?: PartName;
	/** The bolt or slide it holds taken where it is at these amounts, not where it is now: it was let go there. */
	when?: readonly number[];
	/** Passed through without stopping. */
	via?: boolean;
	/** Not drawn until the next key: the hand is off screen here. */
	hide?: boolean;
}

/** Magazine: `d` of its travel along the well (0 seated, 1 clear of the gun), then off its track. */
export interface MagKey {
	t: number;
	d: number;
	off?: V3;
	/** Euler XYZ. */
	turn?: V3;
}

/** When the magazine leaves the gun and the picture, when the new one comes in and is seated: as `MagTimes` of third person. */
export interface MagTimes {
	out: number;
	stow: number;
	fresh: number;
	seat: number;
}

/** Gun: offset and turn. */
export interface GunKey {
	t: number;
	at?: V3;
	turn?: V3;
}

/** A moving part: its travel, one amount per step of the part (gun-rig.ts). */
export interface PartKey {
	t: number;
	to: readonly number[];
}

/** Sounds of a reload: the gun taken up, the magazine out and in, and the bolt, slide or cover closed. */
export type CueSound = 'handle' | 'magOut' | 'magIn' | 'reloadDone' | 'bolt';
export interface Cue {
	t: number;
	sound: CueSound;
}
/** The click of the recorded magazine going in comes this long after its start (tools/audio/manifest.json). */
export const MAG_IN_LEAD_MS = 45;

export interface ClipDef {
	gun: readonly GunKey[];
	left?: readonly HandKey[];
	right?: readonly HandKey[];
	bolt?: readonly PartKey[];
	cover?: readonly PartKey[];
	/** The belt, off its track to the left, and from `hang[0]` to `hang[1]` on the magazine. */
	belt?: readonly PartKey[];
	hang?: readonly [number, number];
	mag?: readonly MagKey[];
	times?: MagTimes;
	/** What is heard, and when the move it belongs to happens (the recordings start up to MAG_IN_LEAD_MS before). */
	cues: readonly Cue[];
}

/** A reload: what both have, and what differs when the gun was empty or had a round left. */
interface ReloadDef {
	all: Omit<ClipDef, 'cues' | 'gun'>;
	empty: Partial<ClipDef> & Pick<ClipDef, 'gun' | 'cues'>;
	loaded: Partial<ClipDef> & Pick<ClipDef, 'gun' | 'cues'>;
}

/** The cues of a reload: the magazine, and what closes at the end. */
const cues = (out: number, seat: number, ...closed: number[]): readonly Cue[] => [{ t: 0, sound: 'handle' }, { t: out, sound: 'magOut' }, { t: seat, sound: 'magIn' }, ...closed.map((t): Cue => ({ t, sound: 'reloadDone' }))];

const g = (t: number, x = 0, y = 0, z = 0, up = 0, left = 0, roll = 0): GunKey => ({ t, at: [x, y, z], turn: [up, left, roll] });


// ---------------------------------------------------------------------
// Reloads

const PISTOL: ReloadDef = {
	// The magazine drops out of the grip, the left hand brings one up from below, pushes it home and works the slide.
	all: {
		mag: [
			{ t: 0.14, d: 0 },
			{ t: 0.2, d: 1 },
			{ t: 0.31, d: 1, off: [0.4, -20, 7], turn: [0.5, 0, 0.2] },
			{ t: 0.33, d: 1, off: [-9, -15, 7], turn: [0.3, 0, -0.4] },
			{ t: 0.5, d: 1 },
			{ t: 0.58, d: 0 }
		],
		times: { out: 0.14, stow: 0.31, fresh: 0.33, seat: 0.58 }
	},
	empty: {
		gun: [
			g(0),
			g(0.1, -1.5, 1.5, 0, 0.34, 0.1, -0.3),
			g(0.2, -1.6, 1.5, 0, 0.36, 0.12, -0.34),
			g(0.52, -1.6, 1.5, 0, 0.34, 0.12, -0.36),
			g(0.585, -1.55, 1.95, 0.1, 0.4, 0.12, -0.36),
			g(0.63, -1, 0.4, 0, 0.26, 0.08, -0.22),
			g(0.7, 0.2, -1.1, 0.1, 0.04, 0.08, 0.02),
			g(0.83, 0.2, -1.1, 0.7, 0.08, 0.08, 0.04),
			g(0.865, 0.2, -1, -0.2, -0.02, 0.04, 0.02),
			g(0.91, 0.1, -0.5, 0.05, 0, 0.02, 0),
			g(1)
		],
		left: [
			{ t: 0, pose: 'mag', hide: true },
			{ t: 0.33, pose: 'mag' },
			{ t: 0.51, pose: 'mag' },
			{ t: 0.55, pose: 'mag', off: [-0.35, -0.25, -0.1], open: 0.2 },
			{ t: 0.58, pose: 'mag' },
			{ t: 0.605, pose: 'mag' },
			{ t: 0.64, pose: 'mag', off: [-3.56, 0.62, -1.53], open: 0.87, via: true },
			{ t: 0.69, pose: 'bolt', off: [-4.4, -4.29, -0.1], open: 0, via: true },
			{ t: 0.735, pose: 'bolt', off: [-2.41, 1.29, 1.69], open: 1, via: true },
			{ t: 0.765, pose: 'bolt' },
			{ t: 0.83, pose: 'bolt' },
			{ t: 0.837, pose: 'bolt', when: [1], off: [-0.1, 0.35, 0.89], open: 0.02, via: true },
			{ t: 0.852, pose: 'bolt', when: [1], off: [-1.4, -0.18, 2.15], open: 0.68, via: true },
			{ t: 0.885, pose: 'bolt', when: [1], off: [-5.64, -4.06, 4.13], open: 0.92, via: true },
			{ t: 0.92, pose: 'bolt', when: [1], off: [-9.18, -8.71, 5.34], open: 0.81, via: true },
			{ t: 0.975, pose: 'bolt', when: [1], off: [-11, -15, 8], open: 0.8, hide: true }
		],
		bolt: [
			{ t: 0.76, to: [0.85] },
			{ t: 0.83, to: [1] },
			{ t: 0.86, to: [0] }
		],
		cues: cues(0.14, 0.58, 0.845)
	},
	loaded: {
		gun: [
			g(0),
			g(0.1, -1.5, 1.5, 0, 0.34, 0.1, -0.3),
			g(0.2, -1.6, 1.5, 0, 0.36, 0.12, -0.34),
			g(0.52, -1.6, 1.5, 0, 0.34, 0.12, -0.36),
			g(0.585, -1.55, 1.95, 0.1, 0.4, 0.12, -0.36),
			g(0.66, -1.45, 1.4, 0, 0.3, 0.1, -0.28),
			g(0.78, -0.9, 0.8, 0, 0.14, 0.06, -0.12),
			g(1)
		],
		left: [
			{ t: 0, pose: 'mag', hide: true },
			{ t: 0.33, pose: 'mag' },
			{ t: 0.51, pose: 'mag' },
			{ t: 0.55, pose: 'mag', off: [-0.35, -0.25, -0.1], open: 0.2 },
			{ t: 0.58, pose: 'mag' },
			{ t: 0.63, pose: 'mag' },
			{ t: 0.69, pose: 'mag', off: [-2.03, -2.15, 0.76], open: 1, via: true },
			{ t: 0.83, pose: 'mag', off: [-12, -14, 8], open: 0.8, hide: true }
		],
		cues: cues(0.14, 0.58)
	}
};

const SMG: ReloadDef = {
	// The tube forward and down off its rails, a new one on, then the charging handle on the left.
	all: {
		right: [
			{ t: 0, pose: 'grip' },
			{ t: 0.025, pose: 'grip_off', off: [0.01, 0.01, -0.01], open: 0.07, via: true },
			{ t: 0.06, pose: 'grip_off' },
			{ t: 0.92, pose: 'grip_off' },
			{ t: 0.96, pose: 'grip_off', off: [0.01, 0.01, -0.01], open: 0.06, via: true },
			{ t: 1, pose: 'grip' }
		],
		mag: [
			{ t: 0.11, d: 0 },
			{ t: 0.22, d: 1 },
			{ t: 0.4, d: 1, off: [-7, -24, 9], turn: [0.5, 0.5, -0.4] },
			{ t: 0.47, d: 1, off: [-7, -24, 9], turn: [0.5, 0.5, -0.4] },
			{ t: 0.68, d: 1 },
			{ t: 0.76, d: 0 }
		],
		times: { out: 0.11, stow: 0.41, fresh: 0.46, seat: 0.76 }
	},
	empty: {
		gun: [
			g(0),
			g(0.11, -0.9, 0.9, 0.2, 0.14, -0.14, -0.4),
			g(0.2, -0.9, 0.8, 0.2, 0.1, -0.14, -0.44),
			g(0.62, -1, 0.9, 0.2, 0.14, -0.14, -0.44),
			g(0.765, -1, 1.35, 0.3, 0.2, -0.12, -0.42),
			g(0.81, -0.9, 0.9, 0.2, 0.1, -0.06, -0.3),
			g(0.86, -0.8, 0.8, 0.2, 0.06, -0.04, -0.24),
			g(0.9, -0.8, 0.8, 0.8, 0.09, -0.04, -0.22),
			g(0.925, -0.6, 0.6, -0.1, 0.02, 0, -0.14),
			g(1)
		],
		left: [
			{ t: 0.04, pose: 'fore' },
			{ t: 0.1, pose: 'mag' },
			{ t: 0.765, pose: 'mag' },
			{ t: 0.785, pose: 'mag', off: [-1.89, -2.67, 0.01], open: 1, via: true },
			{ t: 0.83, pose: 'bolt', off: [-2.3, -2.87, -0.14], open: 1, via: true },
			{ t: 0.85, pose: 'bolt' },
			{ t: 0.9, pose: 'bolt' },
			{ t: 0.92, pose: 'bolt', when: [1], off: [-2.3, -2.66, -0.95], open: 0.88, via: true },
			{ t: 0.97, pose: 'fore', off: [-1.37, -3.96, 2.72], open: 1, via: true },
			{ t: 1, pose: 'fore' }
		],
		bolt: [
			{ t: 0.85, to: [0] },
			{ t: 0.9, to: [1] },
			{ t: 0.93, to: [0] }
		],
		cues: cues(0.11, 0.76, 0.915)
	},
	loaded: {
		gun: [
			g(0),
			g(0.11, -0.9, 0.9, 0.2, 0.14, -0.14, -0.4),
			g(0.2, -0.9, 0.8, 0.2, 0.1, -0.14, -0.44),
			g(0.62, -1, 0.9, 0.2, 0.14, -0.14, -0.44),
			g(0.765, -1, 1.35, 0.3, 0.2, -0.12, -0.42),
			g(0.83, -0.7, 0.7, 0.2, 0.1, -0.08, -0.28),
			g(1)
		],
		left: [
			{ t: 0.04, pose: 'fore' },
			{ t: 0.1, pose: 'mag' },
			{ t: 0.8, pose: 'mag' },
			{ t: 0.9, pose: 'fore' }
		],
		cues: cues(0.11, 0.76)
	}
};

const LMG: ReloadDef = {
	// Feed cover up, the belt and the box off, a new box on, the belt in, the cover down, then the handle on the right.
	all: {
		right: [
			{ t: 0, pose: 'grip' },
			{ t: 0.025, pose: 'grip_off', off: [0, -0.56, 0.08], open: 0.05, via: true },
			{ t: 0.06, pose: 'grip_off' },
			{ t: 0.92, pose: 'grip_off' },
			{ t: 0.96, pose: 'grip_off', off: [0.06, -0.54, 0.13], open: 0.03, via: true },
			{ t: 1, pose: 'grip' }
		],
		cover: [
			{ t: 0.1, to: [0] },
			{ t: 0.18, to: [0.85] },
			{ t: 0.21, to: [1] },
			{ t: 0.8, to: [1] },
			{ t: 0.86, to: [0] }
		],
		belt: [
			{ t: 0.23, to: [0] },
			{ t: 0.29, to: [0.3] },
			{ t: 0.72, to: [0.3] },
			{ t: 0.77, to: [0] }
		],
		hang: [0.3, 0.71],
		mag: [
			{ t: 0.32, d: 0 },
			{ t: 0.37, d: 1 },
			{ t: 0.46, d: 1, off: [-7, -18, 7], turn: [0.2, 0.3, -0.5] },
			{ t: 0.52, d: 1, off: [-7, -18, 7], turn: [0.2, 0.3, -0.5] },
			{ t: 0.64, d: 1 },
			{ t: 0.685, d: 0 }
		],
		times: { out: 0.32, stow: 0.47, fresh: 0.51, seat: 0.69 }
	},
	empty: {
		gun: [
			g(0),
			g(0.09, 0, -0.7, 0.2, 0, -0.06, -0.14),
			g(0.2, 0, -0.8, 0.2, -0.04, -0.08, -0.16),
			g(0.3, -1, 0.9, 0.2, 0.06, -0.14, -0.4),
			g(0.64, -1, 0.9, 0.2, 0.06, -0.14, -0.4),
			g(0.69, -1, 1.25, 0.3, 0.1, -0.12, -0.38),
			g(0.735, -0.5, 0, 0.2, 0, -0.08, -0.24),
			g(0.79, 0, -0.8, 0.2, -0.04, -0.06, -0.14),
			g(0.862, 0, -1.1, 0.2, -0.06, -0.06, -0.12),
			g(0.9, -0.4, -0.3, 0.2, 0.03, -0.02, 0.04),
			g(0.95, -0.5, 0, 0.75, 0.05, -0.02, 0.06),
			g(0.968, -0.3, 0, -0.05, 0.01, 0, 0.02),
			g(1)
		],
		left: [
			{ t: 0, pose: 'fore' },
			{ t: 0.02, pose: 'fore', off: [-2.03, -2.44, 1.07], open: 0.98, via: true },
			{ t: 0.06, pose: 'cover', off: [-2.83, -4.44, -5.67], open: 0.74, via: true },
			{ t: 0.085, pose: 'cover', off: [-1.29, -0.98, -1.66], open: 0.63, via: true },
			{ t: 0.1, pose: 'cover', on: 'cover' },
			{ t: 0.205, pose: 'cover', on: 'cover' },
			{ t: 0.222, pose: 'cover', on: 'cover', off: [-1.19, -2.02, -0.84], open: 0.88, via: true },
			{ t: 0.262, pose: 'mag', off: [-5.73, 3.63, -3.81], open: 0.35, via: true },
			{ t: 0.29, pose: 'mag', off: [-1.97, -1.08, -2.94], open: 0.99, via: true },
			{ t: 0.31, pose: 'mag' },
			{ t: 0.695, pose: 'mag' },
			{ t: 0.712, pose: 'mag', off: [-1.63, -1.68, -2.91], open: 0.62, via: true },
			{ t: 0.742, pose: 'mag', off: [-6.14, 4.41, -3.22], open: 0.6, via: true },
			{ t: 0.775, pose: 'cover', on: 'cover', off: [-2.1, -3.33, -2.18], open: 0.58, via: true },
			{ t: 0.797, pose: 'cover', on: 'cover' },
			{ t: 0.865, pose: 'cover', on: 'cover' },
			{ t: 0.877, pose: 'cover', off: [-1.22, -1.11, -1.7], open: 0.83, via: true },
			{ t: 0.9, pose: 'cover', off: [-2.34, -5.25, -7], open: 0.85, via: true },
			{ t: 0.922, pose: 'fore', off: [-2.08, -2.19, 1.05], open: 1, via: true },
			{ t: 0.935, pose: 'fore' }
		],
		right: [
			{ t: 0, pose: 'grip' },
			{ t: 0.015, pose: 'grip_off', off: [0.06, -0.54, 0.14], open: 0.03, via: true },
			{ t: 0.035, pose: 'grip_off' },
			{ t: 0.862, pose: 'grip_off' },
			{ t: 0.878, pose: 'grip_off', off: [1.38, -1.61, 2.35], open: 0.99, via: true },
			{ t: 0.903, pose: 'bolt', off: [1.73, -4.47, 1.59], open: 0.93, via: true },
			{ t: 0.92, pose: 'bolt' },
			{ t: 0.95, pose: 'bolt' },
			{ t: 0.961, pose: 'bolt', when: [1], off: [1.01, -3.48, 1.34], open: 0.68, via: true },
			{ t: 0.982, pose: 'grip', off: [1.77, -1.05, 2.55], open: 1, via: true },
			{ t: 1, pose: 'grip' }
		],
		bolt: [
			{ t: 0.92, to: [0] },
			{ t: 0.95, to: [1] },
			{ t: 0.965, to: [0] }
		],
		cues: cues(0.32, 0.69, 0.855, 0.955)
	},
	loaded: {
		gun: [
			g(0),
			g(0.09, 0, -0.7, 0.2, 0, -0.06, -0.14),
			g(0.2, 0, -0.8, 0.2, -0.04, -0.08, -0.16),
			g(0.3, -1, 0.9, 0.2, 0.06, -0.14, -0.4),
			g(0.64, -1, 0.9, 0.2, 0.06, -0.14, -0.4),
			g(0.69, -1, 1.25, 0.3, 0.1, -0.12, -0.38),
			g(0.735, -0.5, 0, 0.2, 0, -0.08, -0.24),
			g(0.79, 0, -0.8, 0.2, -0.04, -0.06, -0.14),
			g(0.862, 0, -1.1, 0.2, -0.06, -0.06, -0.12),
			g(0.91, 0, -0.5, 0.1, -0.02, -0.04, -0.08),
			g(1)
		],
		left: [
			{ t: 0, pose: 'fore' },
			{ t: 0.02, pose: 'fore', off: [-2.03, -2.44, 1.07], open: 0.98, via: true },
			{ t: 0.06, pose: 'cover', off: [-2.83, -4.44, -5.67], open: 0.74, via: true },
			{ t: 0.085, pose: 'cover', off: [-1.29, -0.98, -1.66], open: 0.63, via: true },
			{ t: 0.1, pose: 'cover', on: 'cover' },
			{ t: 0.205, pose: 'cover', on: 'cover' },
			{ t: 0.222, pose: 'cover', on: 'cover', off: [-1.19, -2.02, -0.84], open: 0.88, via: true },
			{ t: 0.262, pose: 'mag', off: [-5.73, 3.63, -3.81], open: 0.35, via: true },
			{ t: 0.29, pose: 'mag', off: [-1.97, -1.08, -2.94], open: 0.99, via: true },
			{ t: 0.31, pose: 'mag' },
			{ t: 0.695, pose: 'mag' },
			{ t: 0.712, pose: 'mag', off: [-1.63, -1.68, -2.91], open: 0.62, via: true },
			{ t: 0.742, pose: 'mag', off: [-6.14, 4.41, -3.22], open: 0.6, via: true },
			{ t: 0.775, pose: 'cover', on: 'cover', off: [-2.1, -3.33, -2.18], open: 0.58, via: true },
			{ t: 0.797, pose: 'cover', on: 'cover' },
			{ t: 0.875, pose: 'cover', on: 'cover' },
			{ t: 0.892, pose: 'cover', off: [-0.81, -0.5, -0.83], open: 0.72, via: true },
			{ t: 0.93, pose: 'cover', off: [-3.2, -4.4, -4.94], open: 0.93, via: true },
			{ t: 0.965, pose: 'fore', off: [-2.25, -2.33, 1.46], open: 1, via: true },
			{ t: 0.99, pose: 'fore' }
		],
		cues: cues(0.32, 0.69, 0.855)
	}
};

const SNIPER: ReloadDef = (() => {
	const gun = [
		g(0),
		g(0.085, -0.5, 0.3, 0.1, 0.05, 0, 0.1),
		g(0.17, -0.5, 0.3, 0.5, 0.08, 0, 0.12),
		g(0.28, -1, 0.9, 0.2, 0.1, -0.14, -0.36),
		g(0.62, -1, 0.9, 0.2, 0.1, -0.14, -0.38),
		g(0.675, -1, 1.3, 0.3, 0.15, -0.12, -0.36),
		g(0.74, -0.8, 0.6, 0.2, 0.06, -0.06, -0.12),
		g(0.82, -0.5, 0.3, 0.45, 0.07, 0, 0.1),
		g(0.89, -0.5, 0.3, 0, 0.03, 0, 0.1),
		g(1)
	];
	return {
		// Bolt up and back, the magazine out and a new one in, bolt forward and down.
		all: {
			right: [
				{ t: 0, pose: 'grip' },
				{ t: 0.025, pose: 'grip', off: [0.97, 0.34, -0.22], open: 0.98, via: true },
				{ t: 0.06, pose: 'bolt', off: [0.35, -0.83, 0.26], open: 0.63, via: true },
				{ t: 0.085, pose: 'bolt' },
				{ t: 0.17, pose: 'bolt' },
				{ t: 0.19, pose: 'bolt', off: [0.83, -0.14, -0.11], open: 1, via: true },
				{ t: 0.225, pose: 'grip_off', off: [3.46, 1.65, 1.6], open: 0.94, via: true },
				{ t: 0.25, pose: 'grip_off' },
				{ t: 0.75, pose: 'grip_off' },
				{ t: 0.77, pose: 'grip_off', off: [3.58, 1.6, 0.86], open: 1, via: true },
				{ t: 0.8, pose: 'bolt', off: [1.05, -0.22, -2.21], open: 1, via: true },
				{ t: 0.815, pose: 'bolt' },
				{ t: 0.925, pose: 'bolt' },
				{ t: 0.945, pose: 'bolt', off: [0.36, -0.87, 0.28], open: 0.67, via: true },
				{ t: 0.975, pose: 'grip', off: [0.75, 0.26, -0.18], open: 0.69, via: true },
				{ t: 1, pose: 'grip' }
			],
			left: [
				{ t: 0, pose: 'fore' },
				{ t: 0.2, pose: 'fore' },
				{ t: 0.22, pose: 'fore', off: [-0.8, -2.4, 0], open: 1, via: true },
				{ t: 0.255, pose: 'mag', off: [-1.4, -2.2, -0.6], open: 1, via: true },
				{ t: 0.28, pose: 'mag' },
				{ t: 0.7, pose: 'mag' },
				{ t: 0.72, pose: 'mag', off: [-1.4, -2.2, -0.6], open: 1, via: true },
				{ t: 0.765, pose: 'fore', off: [-0.8, -2.4, 0], open: 1, via: true },
				{ t: 0.79, pose: 'fore' }
			],
			bolt: [
				{ t: 0.09, to: [0, 0] },
				{ t: 0.12, to: [1, 0] },
				{ t: 0.17, to: [1, 1] },
				{ t: 0.82, to: [1, 1] },
				{ t: 0.89, to: [1, 0] },
				{ t: 0.92, to: [0, 0] }
			],
			mag: [
				{ t: 0.3, d: 0 },
				{ t: 0.36, d: 1 },
				{ t: 0.455, d: 1, off: [-6, -18, 8], turn: [0.3, 0.2, -0.4] },
				{ t: 0.49, d: 1, off: [-6, -18, 8], turn: [0.3, 0.2, -0.4] },
				{ t: 0.61, d: 1 },
				{ t: 0.67, d: 0 }
			],
			times: { out: 0.3, stow: 0.465, fresh: 0.485, seat: 0.67 }
		},
		empty: { gun, cues: cues(0.3, 0.67, 0.875) },
		loaded: { gun, cues: cues(0.3, 0.67, 0.875) }
	};
})();

const BARRETT: ReloadDef = {
	// The big magazine rocked out and a new one in, then the charging handle on the right.
	all: {
		mag: [
			{ t: 0.18, d: 0 },
			{ t: 0.27, d: 1 },
			{ t: 0.385, d: 1, off: [-6, -17, 8], turn: [0.3, 0.2, -0.4] },
			{ t: 0.44, d: 1, off: [-6, -17, 8], turn: [0.3, 0.2, -0.4] },
			{ t: 0.58, d: 1 },
			{ t: 0.65, d: 0 }
		],
		times: { out: 0.18, stow: 0.395, fresh: 0.43, seat: 0.65 }
	},
	empty: {
		gun: [
			g(0),
			g(0.13, -1, 1, 0.2, 0.1, -0.14, -0.36),
			g(0.26, -1.05, 1, 0.2, 0.08, -0.14, -0.4),
			g(0.58, -1.05, 1, 0.2, 0.08, -0.14, -0.4),
			g(0.655, -1, 1.45, 0.3, 0.14, -0.12, -0.36),
			g(0.72, -0.8, 0.7, 0.2, 0.06, -0.06, -0.14),
			g(0.8, -0.5, 0.3, 0.1, 0.04, 0, 0.08),
			g(0.87, -0.5, 0.3, 0.8, 0.07, 0, 0.1),
			g(0.895, -0.4, 0.25, -0.1, 0.01, 0, 0.04),
			g(1)
		],
		left: [
			{ t: 0, pose: 'fore' },
			{ t: 0.04, pose: 'fore' },
			{ t: 0.065, pose: 'fore', off: [-0.8, -2.4, 0], open: 1, via: true },
			{ t: 0.125, pose: 'mag', off: [-1.6, -2, -0.6], open: 1, via: true },
			{ t: 0.16, pose: 'mag' },
			{ t: 0.67, pose: 'mag' },
			{ t: 0.6950000000000001, pose: 'mag', off: [-1.6, -2, -0.6], open: 1, via: true },
			{ t: 0.74, pose: 'fore', off: [-0.8, -2.4, 0], open: 1, via: true },
			{ t: 0.77, pose: 'fore' }
		],
		right: [
			{ t: 0, pose: 'grip' },
			{ t: 0.025, pose: 'grip_off', off: [0.12, -0.45, 0.31], open: 0.34, via: true },
			{ t: 0.06, pose: 'grip_off' },
			{ t: 0.73, pose: 'grip_off' },
			{ t: 0.75, pose: 'grip_off', off: [1.34, -1.31, 2.21], open: 1, via: true },
			{ t: 0.79, pose: 'bolt', off: [1.32, -3.78, 1.94], open: 0.6, via: true },
			{ t: 0.81, pose: 'bolt' },
			{ t: 0.87, pose: 'bolt' },
			{ t: 0.885, pose: 'bolt', when: [1], off: [0.85, -2.59, 1.47], open: 0.42, via: true },
			{ t: 0.94, pose: 'grip', off: [1.26, -1.56, 2.05], open: 1, via: true },
			{ t: 0.97, pose: 'grip' }
		],
		bolt: [
			{ t: 0.82, to: [0] },
			{ t: 0.87, to: [1] },
			{ t: 0.89, to: [0] }
		],
		cues: cues(0.18, 0.65, 0.88)
	},
	loaded: {
		gun: [
			g(0),
			g(0.13, -1, 1, 0.2, 0.1, -0.14, -0.36),
			g(0.26, -1.05, 1, 0.2, 0.08, -0.14, -0.4),
			g(0.58, -1.05, 1, 0.2, 0.08, -0.14, -0.4),
			g(0.655, -1, 1.45, 0.3, 0.14, -0.12, -0.36),
			g(0.73, -0.8, 0.8, 0.2, 0.08, -0.08, -0.24),
			g(0.95)
		],
		left: [
			{ t: 0, pose: 'fore' },
			{ t: 0.04, pose: 'fore' },
			{ t: 0.065, pose: 'fore', off: [-0.8, -2.4, 0], open: 1, via: true },
			{ t: 0.125, pose: 'mag', off: [-1.6, -2, -0.6], open: 1, via: true },
			{ t: 0.16, pose: 'mag' },
			{ t: 0.7, pose: 'mag' },
			{ t: 0.725, pose: 'mag', off: [-1.6, -2, -0.6], open: 1, via: true },
			{ t: 0.79, pose: 'fore', off: [-0.8, -2.4, 0], open: 1, via: true },
			{ t: 0.82, pose: 'fore' }
		],
		right: [
			{ t: 0, pose: 'grip' },
			{ t: 0.025, pose: 'grip_off', off: [0.1, -0.47, 0.3], open: 0.27, via: true },
			{ t: 0.06, pose: 'grip_off' },
			{ t: 0.92, pose: 'grip_off' },
			{ t: 0.96, pose: 'grip_off', off: [0.1, -0.48, 0.29], open: 0.26, via: true },
			{ t: 1, pose: 'grip' }
		],
		cues: cues(0.18, 0.65)
	}
};

const STRIKER: ReloadDef = {
	// The drum down off its catch, a new one up and a push, then the charging handle on the left.
	all: {
		right: [
			{ t: 0, pose: 'grip' },
			{ t: 0.025, pose: 'grip_off', off: [0.14, -0.53, 0.31], open: 0.26, via: true },
			{ t: 0.06, pose: 'grip_off' },
			{ t: 0.92, pose: 'grip_off' },
			{ t: 0.96, pose: 'grip_off', off: [0.14, -0.53, 0.32], open: 0.26, via: true },
			{ t: 1, pose: 'grip' }
		],
		mag: [
			{ t: 0.18, d: 0 },
			{ t: 0.26, d: 1 },
			{ t: 0.39, d: 1, off: [-6, -18, 8], turn: [0.3, 0.2, -0.4] },
			{ t: 0.45, d: 1, off: [-6, -18, 8], turn: [0.3, 0.2, -0.4] },
			{ t: 0.59, d: 1 },
			{ t: 0.66, d: 0 }
		],
		times: { out: 0.18, stow: 0.4, fresh: 0.44, seat: 0.66 }
	},
	empty: {
		gun: [
			g(0),
			g(0.14, -1, 1.1, 0.2, 0.12, -0.14, -0.36),
			g(0.26, -1, 1, 0.2, 0.08, -0.14, -0.4),
			g(0.59, -1, 1, 0.2, 0.08, -0.14, -0.4),
			g(0.665, -1, 1.4, 0.3, 0.14, -0.12, -0.38),
			g(0.72, -0.95, 0.9, 0.2, 0.08, -0.1, -0.34),
			g(0.765, -0.95, 1.2, 0.2, 0.12, -0.1, -0.32),
			g(0.82, -0.8, 0.8, 0.2, 0.06, -0.04, -0.22),
			g(0.87, -0.8, 0.7, 0.2, 0.05, -0.04, -0.2),
			g(0.915, -0.8, 0.7, 0.8, 0.08, -0.04, -0.2),
			g(0.94, -0.5, 0.5, -0.1, 0.02, 0, -0.12),
			g(1)
		],
		left: [
			{ t: 0, pose: 'fore' },
			{ t: 0.04, pose: 'fore' },
			{ t: 0.065, pose: 'fore', off: [-0.8, -2.4, 0], open: 1, via: true },
			{ t: 0.125, pose: 'mag', off: [-1.6, -2, -0.6], open: 1, via: true },
			{ t: 0.16, pose: 'mag' },
			{ t: 0.67, pose: 'mag' },
			{ t: 0.72, pose: 'mag', off: [0.11, -0.19, -0.17], open: 0.77 },
			{ t: 0.77, pose: 'mag' },
			{ t: 0.785, pose: 'mag' },
			{ t: 0.805, pose: 'mag', off: [-2.36, -1.53, -3.22], open: 1, via: true },
			{ t: 0.85, pose: 'bolt', off: [-3.35, -2.51, -1.56], open: 1, via: true },
			{ t: 0.87, pose: 'bolt' },
			{ t: 0.915, pose: 'bolt' },
			{ t: 0.935, pose: 'bolt', when: [1], off: [-2.14, -2.23, -4.81], open: 0.84, via: true },
			{ t: 0.975, pose: 'fore', off: [-2.23, -2.24, 1.6], open: 0.99, via: true },
			{ t: 1, pose: 'fore' }
		],
		bolt: [
			{ t: 0.87, to: [0] },
			{ t: 0.915, to: [1] },
			{ t: 0.94, to: [0] }
		],
		cues: cues(0.18, 0.66, 0.925)
	},
	loaded: {
		gun: [
			g(0),
			g(0.14, -1, 1.1, 0.2, 0.12, -0.14, -0.36),
			g(0.26, -1, 1, 0.2, 0.08, -0.14, -0.4),
			g(0.59, -1, 1, 0.2, 0.08, -0.14, -0.4),
			g(0.665, -1, 1.4, 0.3, 0.14, -0.12, -0.38),
			g(0.72, -0.95, 0.9, 0.2, 0.08, -0.1, -0.34),
			g(0.765, -0.95, 1.2, 0.2, 0.12, -0.1, -0.32),
			g(0.84, -0.6, 0.7, 0.2, 0.06, -0.06, -0.2),
			g(1)
		],
		left: [
			{ t: 0, pose: 'fore' },
			{ t: 0.04, pose: 'fore' },
			{ t: 0.065, pose: 'fore', off: [-0.8, -2.4, 0], open: 1, via: true },
			{ t: 0.125, pose: 'mag', off: [-1.6, -2, -0.6], open: 1, via: true },
			{ t: 0.16, pose: 'mag' },
			{ t: 0.67, pose: 'mag' },
			{ t: 0.72, pose: 'mag', off: [0.04, -0.28, 0.19], open: 0.02 },
			{ t: 0.77, pose: 'mag' },
			{ t: 0.8, pose: 'mag' },
			{ t: 0.825, pose: 'mag', off: [-1.6, -2, -0.6], open: 1, via: true },
			{ t: 0.91, pose: 'fore', off: [-0.8, -2.4, 0], open: 1, via: true },
			{ t: 0.95, pose: 'fore' }
		],
		cues: cues(0.18, 0.66)
	}
};

/** The sniper's bolt after a shot (BOLT_SECS of character/reload.ts): the right hand lets go, works it, and comes back. */
const SNIPER_BOLT: ClipDef = {
	gun: [g(0.08), g(0.3, -0.3, 0.2, 0.05, 0.05, 0, 0.1), g(0.42, -0.3, 0.22, 0.1, 0.07, 0, 0.14), g(0.55, -0.3, 0.2, 0.5, 0.09, 0, 0.12), g(0.6, -0.3, 0.2, 0.5, 0.09, 0, 0.12), g(0.75, -0.3, 0.2, -0.05, 0.03, 0, 0.1), g(0.84, -0.25, 0.1, 0, 0, 0, 0.06), g(1)],
	right: [
		{ t: 0.12, pose: 'grip' },
		{ t: 0.16, pose: 'grip', off: [0.84, 0.12, -0.3], open: 1, via: true },
		{ t: 0.25, pose: 'bolt', off: [0.42, -0.98, 0.18], open: 0.72, via: true },
		{ t: 0.3, pose: 'bolt' },
		{ t: 0.84, pose: 'bolt' },
		{ t: 0.88, pose: 'bolt', off: [0.36, -0.75, 0.05], open: 0.61, via: true },
		{ t: 0.955, pose: 'grip', off: [0.92, 0.29, -0.28], open: 0.78, via: true },
		{ t: 1, pose: 'grip' }
	],
	bolt: [
		{ t: 0.3, to: [0, 0] },
		{ t: 0.4, to: [1, 0] },
		{ t: 0.55, to: [1, 1] },
		{ t: 0.58, to: [1, 1] },
		{ t: 0.75, to: [1, 0] },
		{ t: 0.84, to: [0, 0] }
	],
	cues: [{ t: 0.69, sound: 'bolt' }]
};

// ---------------------------------------------------------------------
// Sampling

/**
 * Values over time through rows of [t, ...values]: smooth, at rest where a value turns round or stays, never past its
 * keys (monotone cubic). Before the first and after the last row the value stays.
 */
export class Curve {
	private readonly slopes: Float64Array[];

	constructor(private readonly rows: readonly (readonly number[])[]) {
		const n = rows.length;
		const w = rows[0]!.length - 1;
		this.slopes = rows.map(() => new Float64Array(w));
		for (let k = 1; k <= w; k++)
			for (let i = 1; i + 1 < n; i++) {
				const h0 = rows[i]![0]! - rows[i - 1]![0]!;
				const h1 = rows[i + 1]![0]! - rows[i]![0]!;
				const d0 = (rows[i]![k]! - rows[i - 1]![k]!) / h0;
				const d1 = (rows[i + 1]![k]! - rows[i]![k]!) / h1;
				if (d0 * d1 <= 0) continue;
				const w0 = 2 * h1 + h0;
				const w1 = h1 + 2 * h0;
				this.slopes[i]![k - 1] = (w0 + w1) / (w0 / d0 + w1 / d1);
			}
	}

	at(t: number, out: Float64Array): void {
		const r = this.rows;
		let i = 0;
		while (i + 1 < r.length && r[i + 1]![0]! <= t) i++;
		const a = r[i]!;
		const b = r[Math.min(i + 1, r.length - 1)]!;
		const h = b[0]! - a[0]!;
		const s = h > 0 ? Math.min(1, Math.max(0, (t - a[0]!) / h)) : 0;
		const s2 = s * s;
		const s3 = s2 * s;
		for (let k = 1; k < a.length; k++) {
			if (s === 0) {
				out[k - 1] = a[k]!;
				continue;
			}
			const m0 = this.slopes[i]![k - 1]! * h;
			const m1 = this.slopes[Math.min(i + 1, r.length - 1)]![k - 1]! * h;
			out[k - 1] = (2 * s3 - 3 * s2 + 1) * a[k]! + (s3 - 2 * s2 + s) * m0 + (3 * s2 - 2 * s3) * b[k]! + (s3 - s2) * m1;
		}
	}
}

/** Rows that stop at every one: straight between, eased at both ends. The parts and the magazine go from place to place. */
class Steps {
	constructor(
		private readonly rows: readonly (readonly number[])[],
		/** Eases the start of the segment that begins at this row only (a spring closing, a push home): faster and faster. */
		private readonly snap: (i: number) => boolean
	) {}

	at(t: number, out: Float64Array): void {
		const r = this.rows;
		let i = 0;
		while (i + 1 < r.length && r[i + 1]![0]! <= t) i++;
		const a = r[i]!;
		const b = r[Math.min(i + 1, r.length - 1)]!;
		const h = b[0]! - a[0]!;
		const s = h > 0 ? Math.min(1, Math.max(0, (t - a[0]!) / h)) : 0;
		const u = this.snap(i) ? s * s : s * s * (3 - 2 * s);
		for (let k = 1; k < a.length; k++) out[k - 1] = a[k]! + (b[k]! - a[k]!) * u;
	}
}

/** What gives a key its place in model space now (the gun and its parts as they are). */
export type Resolve = (k: HandKey) => HandPlace | null;

/** Cubic through 0 and 1 with the slopes `m0` and `m1` at its ends. */
const cubic = (s: number, m0: number, m1: number): number => 3 * s * s - 2 * s * s * s + m0 * (s * s * s - 2 * s * s + s) + m1 * (s * s * s - s * s);

/** One hand's way through its keys: it stops at each, or passes a `via` key on a curve. */
export class HandTrack {
	constructor(readonly keys: readonly HandKey[]) {}

	/** Index of the key at or before `t`. */
	private index(t: number): number {
		let i = 0;
		while (i + 1 < this.keys.length && this.keys[i + 1]!.t <= t) i++;
		return i;
	}

	/** Whether the hand is drawn at `t`. */
	shown(t: number): boolean {
		return !this.keys[this.index(t)]!.hide;
	}

	/** Named pose the hand keeps at `t` (on the part it holds, wherever that is), else null: a blend between two. */
	holding(t: number): GunPoseName | null {
		const i = this.index(t);
		const a = this.keys[i]!;
		const still = (k: HandKey) => !k.via && !k.hide && !k.when;
		if (!still(a)) return null;
		if (t <= a.t || i + 1 >= this.keys.length) return a.pose;
		const b = this.keys[i + 1]!;
		return still(b) && b.pose === a.pose && b.on === a.on ? a.pose : null;
	}

	/** Where the hand is; null when the gun hasn't got a pose. */
	at(t: number, resolve: Resolve, blend: (a: HandPlace, b: HandPlace, u: number) => HandPlace): HandPlace | null {
		const ks = this.keys;
		const i = this.index(t);
		const a = ks[i]!;
		const pa = resolve(a);
		const b = ks[i + 1];
		if (!b || t <= a.t || !pa) return pa;
		const pb = resolve(b);
		if (!pb) return pa;
		const h = b.t - a.t;
		const s = (t - a.t) / h;
		const out = blend(pa, pb, cubic(s, a.via ? 1 : 0, b.via ? 1 : 0));
		if (!a.via && !b.via) return out;
		// The wrist passes the via keys on a curve through their neighbours.
		const before = a.via ? resolve(ks[i - 1]!) : null;
		const after = b.via ? resolve(ks[i + 2] ?? b) : null;
		const m0 = before ? h / (b.t - ks[i - 1]!.t) : 0;
		const m1 = after ? h / ((ks[i + 2]?.t ?? b.t) - a.t) : 0;
		const c0 = 2 * s * s * s - 3 * s * s + 1;
		const c1 = s * s * s - 2 * s * s + s;
		const c2 = 3 * s * s - 2 * s * s * s;
		const c3 = s * s * s - s * s;
		const p = [0, 1, 2].map((k) => c0 * pa.p[k]! + c1 * (before ? (pb.p[k]! - before.p[k]!) * m0 : 0) + c2 * pb.p[k]! + c3 * (after ? (after.p[k]! - pa.p[k]!) * m1 : 0));
		return { ...out, p: p as unknown as V3 };
	}
}

/** Everything but the hands at one moment; the hands need the gun (`HandTrack.at`). */
export interface ClipSample {
	/** Gun offset x, y, z and turn up, left, roll. */
	readonly gun: Float64Array;
	/** Amount per step of the bolt or slide, of the cover and the belt. */
	readonly bolt: Float64Array;
	readonly cover: Float64Array;
	readonly belt: Float64Array;
	/** Magazine: travel, offset x, y, z, turn x, y, z. */
	readonly mag: Float64Array;
	magShown: boolean;
	/** The belt hangs on the magazine, not in the gun. */
	hang: boolean;
}

export const newSample = (): ClipSample => ({ gun: new Float64Array(6), bolt: new Float64Array(2), cover: new Float64Array(1), belt: new Float64Array(1), mag: new Float64Array(7), magShown: true, hang: false });

/** Back to a gun at rest. */
export function restSample(out: ClipSample): ClipSample {
	out.gun.fill(0);
	out.bolt.fill(0);
	out.cover.fill(0);
	out.belt.fill(0);
	out.mag.fill(0);
	out.magShown = true;
	out.hang = false;
	return out;
}

const ZERO: V3 = [0, 0, 0];

export class Clip {
	readonly left: HandTrack | null;
	readonly right: HandTrack | null;
	readonly times: MagTimes | null;
	readonly cues: readonly Cue[];
	private readonly gun: Curve;
	private readonly bolt: Steps | null;
	private readonly cover: Steps | null;
	private readonly belt: Steps | null;
	private readonly mag: Steps | null;

	constructor(readonly def: ClipDef) {
		this.left = def.left ? new HandTrack(def.left) : null;
		this.right = def.right ? new HandTrack(def.right) : null;
		this.times = def.times ?? null;
		this.cues = def.cues;
		const first = def.gun[0]!;
		const rows = def.gun.map((k) => [k.t, ...(k.at ?? ZERO), ...(k.turn ?? ZERO)]);
		this.gun = new Curve(first.t > 0 ? [[0, 0, 0, 0, 0, 0, 0], ...rows] : rows);
		const steps = (keys: readonly PartKey[] | undefined, snap: boolean) =>
			keys ? new Steps(keys.map((k) => [k.t, ...k.to]), (i) => snap && keys[i + 1] !== undefined && keys[i + 1]!.to.length === 1 && keys[i + 1]!.to[0]! < keys[i]!.to[0]!) : null;
		// Springs and the cover's weight do the closing.
		this.bolt = steps(def.bolt, true);
		this.cover = steps(def.cover, true);
		this.belt = steps(def.belt, false);
		const m = def.mag;
		this.mag = m ? new Steps(m.map((k) => [k.t, k.d, ...(k.off ?? ZERO), ...(k.turn ?? ZERO)]), (i) => m[i + 1] !== undefined && m[i]!.d === 0) : null;
	}

	at(p: number, out: ClipSample): ClipSample {
		restSample(out);
		this.gun.at(p, out.gun);
		this.bolt?.at(p, out.bolt);
		this.cover?.at(p, out.cover);
		this.belt?.at(p, out.belt);
		this.mag?.at(p, out.mag);
		const t = this.times;
		out.magShown = !t || p < t.stow || p >= t.fresh;
		out.hang = !!this.def.hang && p >= this.def.hang[0] && p < this.def.hang[1];
		return out;
	}
}

const compile = (d: ReloadDef) => ({ empty: new Clip({ ...d.all, ...d.empty }), loaded: new Clip({ ...d.all, ...d.loaded }) });

/** The reload of every gun: of an empty one, and with a round left. */
export const FP_RELOADS: Readonly<Record<GunId, { readonly empty: Clip; readonly loaded: Clip }>> = Object.freeze({
	pistol: compile(PISTOL),
	smg: compile(SMG),
	lmg: compile(LMG),
	sniper: compile(SNIPER),
	barrett: compile(BARRETT),
	striker: compile(STRIKER)
});

/** Length of the bolt cycle after a shot (ms), as in third person (BOLT_SECS of character/reload.ts). */
export const BOLT_MS = 900;

/** The bolt worked by hand after a shot. */
export const FP_BOLTS: Readonly<Partial<Record<GunId, Clip>>> = Object.freeze({ sniper: new Clip(SNIPER_BOLT) });

// ---------------------------------------------------------------------
// Cycling after a shot

/** A gun that cycles by itself: its bolt or slide goes back and returns within `ms` (shorter than the fastest fire interval). */
export interface Cycle {
	ms: number;
	/** How far it goes (share of the travel), and where it stays on an empty magazine (0: it closes). */
	to: number;
	lock: number;
}

export const CYCLES: Readonly<Partial<Record<GunId, Cycle>>> = Object.freeze({
	pistol: { ms: 95, to: 1, lock: 0.85 },
	smg: { ms: 48, to: 0.9, lock: 0 },
	lmg: { ms: 60, to: 0.9, lock: 0 },
	striker: { ms: 140, to: 1, lock: 0 },
	barrett: { ms: 180, to: 1, lock: 0 }
});

/** Share of the cycle the way back takes. */
const CYCLE_BACK = 0.35;

/** Bolt or slide `ms` after a shot, 0..1 of its travel; `last`: the magazine ran empty with that shot. */
export function cycleAt(c: Cycle, ms: number, last: boolean): number {
	const rest = last ? c.lock : 0;
	if (!(ms >= 0) || ms >= c.ms) return rest;
	const back = c.ms * CYCLE_BACK;
	if (ms < back) {
		const u = 1 - ms / back;
		return c.to * (1 - u * u);
	}
	const u = (ms - back) / (c.ms - back);
	return c.to + (rest - c.to) * u * u;
}

/** The trigger goes back in TRIGGER_IN ms, is held, and comes back over TRIGGER_OUT. */
const TRIGGER_IN = 18;
const TRIGGER_OUT = 70;

/** Trigger `ms` after a shot (0..1), held for `hold` ms: an automatic gun keeps it back between two shots. */
export function triggerAt(ms: number, hold: number): number {
	if (!(ms >= 0)) return 0;
	if (ms < TRIGGER_IN) return ms / TRIGGER_IN;
	if (ms < hold) return 1;
	const u = (ms - hold) / TRIGGER_OUT;
	return u >= 1 ? 0 : 1 - u * u * (3 - 2 * u);
}

/** Finger bend (rad) of the three joints of the index finger that follows a trigger pulled all the way. */
export const SQUEEZE: Readonly<Record<GunId, readonly [number, number, number]>> = Object.freeze({
	pistol: [-0.055, 0.19, -0.076],
	smg: [0.014, 0.041, 0],
	lmg: [-0.04, 0.14, 0.05],
	sniper: [-0.14, 0.35, -0.04],
	barrett: [-0.028, 0.125, 0.124],
	striker: [-0.1, 0.27, -0.045]
});

/** A hand with its index finger `k` (0..1) of the way through the trigger pull. */
export function squeezed(id: GunId, h: HandPlace, k: number): HandPlace {
	if (!(k > 0)) return h;
	const s = SQUEEZE[id];
	return { ...h, fingers: h.fingers.map((v, i) => (i >= 1 && i <= 3 ? v + s[i - 1]! * k : v)) };
}

/** Rounds of the belt the first-person LMG shows, and how long it takes to go on by one (ms): most of the fire interval, so a burst pulls it along. */
export const BELT_ROUNDS = 8;
export const BELT_MS = 72;

/** How far the belt is behind its place (1..0 of a pitch) `ms` after a shot: with a round less it is where it was. */
export function beltBack(ms: number): number {
	const u = ms / BELT_MS;
	return u >= 0 && u < 1 ? 1 - u * u * (3 - 2 * u) : 0;
}

/** Belt rounds left to see. */
export const beltRounds = (mag: number): number => Math.max(0, Math.min(BELT_ROUNDS, mag));

// ---------------------------------------------------------------------
// Draw

/** The left hand comes up to the fore-end while the gun is drawn: its offset (model units) at `lower` (1 out of view, 0 up). */
export function drawHand(lower: number): V3 | null {
	const u = Math.min(1, Math.max(0, (lower - 0.1) / 0.8));
	if (u <= 0) return null;
	// Down off the fore-end first, then out to the side: the fingers come up round it.
	const down = Math.min(1, u * 1.8);
	return [-3.4 * u * u, -4.6 * down * down * (3 - 2 * down), 2 * u * u];
}

// ---------------------------------------------------------------------
// Helpers for places

/** A place moved, turned and its fingers opened, as a key says. */
export function withKey(h: HandPlace, k: HandKey, quat: (turn: V3) => Quat, mulQuat: (a: Quat, b: Quat) => Quat): HandPlace {
	if (!k.off && !k.turn && !k.open) return h;
	const o = k.off ?? ZERO;
	const open = k.open ?? 0;
	const mix = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v + (b[i]! - v) * open);
	const shape: HandShape = open > 0 ? { fingers: mix(h.fingers, OPEN.fingers), thumb: mix(h.thumb, OPEN.thumb) } : h;
	return {
		p: [h.p[0] + o[0], h.p[1] + o[1], h.p[2] + o[2]],
		q: k.turn ? mulQuat(quat(k.turn), h.q) : h.q,
		elbow: [h.elbow[0] + o[0] * ELBOW, h.elbow[1] + o[1] * ELBOW, h.elbow[2] + o[2] * ELBOW],
		fingers: shape.fingers,
		thumb: shape.thumb
	};
}
/** Share of a hand's offset that its elbow makes. */
export const ELBOW = 0.9;
