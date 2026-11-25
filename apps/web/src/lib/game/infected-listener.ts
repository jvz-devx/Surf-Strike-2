/**
 * Where the combat sounds of infected and zombies are heard from
 * (docs/ui.md#audio): the camera. Pure helpers for the `sound` entries of
 * the mode hosts in game.ts; GameAudio sets level and pan from what they
 * return.
 */
import { INTERP_DELAY_MS, type Vec3 } from '@surf/shared';

/** The spectator camera as game.ts keeps it. */
export interface SpecCamera {
	/** Spectated player; free-fly keeps the last one. */
	targetId: number | null;
	freeFly: boolean;
	/** Camera eye: the target's drawn eye, or the free-fly position. */
	pos: Vec3;
}

/** What is read of a remote player: the velocity of its drawn sample. */
export interface DrawnPlayer {
	hasSample: boolean;
	sample: { vx: number; vy: number; vz: number };
}

/**
 * A spectated player is drawn INTERP_DELAY_MS late, and an event of theirs
 * can be up to a snapshot and some jitter newer than that: their own sounds
 * happen on the stretch they cover in this time, ahead of the drawn eye.
 */
const OWN_SOUND_LAG_S = (INTERP_DELAY_MS + 100) / 1000;
/** A sound this close beside that stretch (units, the width of a player) is the spectated player's own. */
export const OWN_SOUND_RADIUS = 32;
/** …and this far below the eye (the feet, with some slack) or above it. */
const OWN_SOUND_BELOW = 80;
const OWN_SOUND_ABOVE = 16;

/**
 * The point sounds are heard from: the camera. While spectating that is the
 * spectator camera (the target's eye or the free-fly position, which
 * `updateCamera` keeps in `spec.pos`), else my own eye. My eye stops where
 * I stood when I started spectating, so it must not be the listener then.
 * Returns one of the two objects (nothing is allocated per sound).
 */
export function soundListener(spec: SpecCamera | null, eye: Vec3): Vec3 {
	return spec ? spec.pos : eye;
}

/**
 * Where a sound at `at` is played from; undefined: it is heard as the
 * listener's own (centred, full level). That is every sound without a
 * position, and while spectating a player also that player's own sounds:
 * the camera sits in their head, but their shots arrive with the position
 * they have now, a little ahead of the drawn eye, which pans the shots of a
 * strafing player to the side. Everyone else keeps their position, also
 * right beside the target. Free-fly has no player of its own.
 */
export function soundSource(at: Vec3 | undefined, spec: SpecCamera | null, players: ReadonlyMap<number, DrawnPlayer>): Vec3 | undefined {
	if (at === undefined || !spec || spec.freeFly || spec.targetId === null) return at;
	const p = players.get(spec.targetId);
	// The stretch from the drawn eye to where the target can be by now.
	const sx = p?.hasSample ? p.sample.vx * OWN_SOUND_LAG_S : 0;
	const sy = p?.hasSample ? p.sample.vy * OWN_SOUND_LAG_S : 0;
	const sz = p?.hasSample ? p.sample.vz * OWN_SOUND_LAG_S : 0;
	let dx = at.x - spec.pos.x;
	let dy = at.y - spec.pos.y;
	let dz = at.z - spec.pos.z;
	const len2 = sx * sx + sy * sy + sz * sz;
	if (len2 > 0) {
		// Nearest point of the stretch.
		const k = Math.max(0, Math.min(1, (dx * sx + dy * sy + dz * sz) / len2));
		dx -= sx * k;
		dy -= sy * k;
		dz -= sz * k;
	}
	const own = Math.hypot(dx, dy) <= OWN_SOUND_RADIUS && dz <= OWN_SOUND_ABOVE && dz >= -OWN_SOUND_BELOW;
	return own ? undefined : at;
}
