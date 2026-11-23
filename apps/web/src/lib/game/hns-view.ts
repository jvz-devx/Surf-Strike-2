/** Pure helpers for the hide and seek client and HUD (docs/modes.md#hide-and-seek). Unit-tested. */
import { formatTenths, HNS_KNIFE, HNS_NAMETAG_RANGE, type HnsBagView, type HnsPhase, type HnsRole } from '@surf/shared';
import type { HnsBagNote } from './contract.js';

/**
 * Whether a remote player's name tag is drawn. Hide and seek shows tags only
 * close by and in line of sight, and never a hider's tag to a seeker (no
 * wallhack through tags). `viewerRole` null = spectator or not in the round.
 */
export function hnsTagVisible(viewerRole: HnsRole | null, targetRole: HnsRole | null, dist: number, los: boolean): boolean {
	if (viewerRole === 'seeker' && targetRole === 'hider') return false;
	return los && dist <= HNS_NAMETAG_RANGE;
}

/** The local player may not move: a seeker during the hiding phase, or just found (respawn freeze). */
export function hnsFrozen(role: HnsRole, phase: HnsPhase | 'solo', frozenUntil: number, now: number): boolean {
	return (role === 'seeker' && phase === 'hiding') || now < frozenUntil;
}

/** Seekers are blindfolded (black screen with a countdown) for the whole hiding phase. */
export function hnsBlindfold(role: HnsRole, phase: HnsPhase | 'solo'): boolean {
	return role === 'seeker' && phase === 'hiding';
}

/** A knife swing may be sent now (seeker, seeking, not frozen, swing interval passed). */
export function hnsCanSwing(role: HnsRole, phase: HnsPhase | 'solo', frozen: boolean, lastSwing: number, now: number): boolean {
	return role === 'seeker' && phase === 'seeking' && !frozen && now - lastSwing >= HNS_KNIFE.swingMs;
}

/** Closer than this (units) the cash bag needs no direction arrow. */
export const BAG_ARROW_MIN = 160;
/** Units per metre, as the player models are scaled. */
const UNITS_PER_METER = 39.37;

/** The HUD's note about the cash bag. `at`: when `bag` arrived; `eye`: where the viewer is and looks. */
export function hnsBagNote(
	bag: HnsBagView | null | undefined,
	at: number,
	eye: { x: number; y: number; yaw: number },
	role: HnsRole,
	self: number,
	name: (id: number) => string
): HnsBagNote | null {
	if (!bag) return null;
	if (bag.phase === 'pending') return { phase: 'pending', at: at + bag.secs * 1000 };
	if (bag.phase === 'taken') return { phase: 'taken', by: name(bag.by), mine: bag.by === self };
	const dx = bag.pos.x - eye.x;
	const dy = bag.pos.y - eye.y;
	const dist = Math.hypot(dx, dy);
	const turn = eye.yaw - (Math.atan2(dy, dx) * 180) / Math.PI;
	return {
		phase: 'out',
		place: bag.place,
		meters: Math.round(dist / UNITS_PER_METER),
		// Steps of 5° in (-180, 180].
		turn: dist < BAG_ARROW_MIN ? null : Math.round((((turn % 360) + 540) % 360 - 180) / 5) * 5,
		canTake: role === 'hider'
	};
}

/** Short banner when the bag is taken. */
export function bagTakenText(name: string, mine: boolean, paid: number): string {
	const amount = paid > 0 ? `: ${formatTenths(paid)} coins` : '';
	return mine ? `You grabbed the cash bag${amount}!` : `${name} grabbed the cash bag${amount}`;
}

/** Banner text for the phase. */
export function hnsPhaseLabel(phase: HnsPhase | 'solo', role: HnsRole): string {
	switch (phase) {
		case 'solo':
		case 'waiting':
			return 'Waiting for players';
		case 'starting':
			return 'Round starts in';
		case 'hiding':
			return role === 'seeker' ? 'Seekers released in' : 'Hide! Seekers released in';
		case 'seeking':
			return role === 'seeker' ? 'Find them' : 'Stay hidden';
		case 'ended':
			return 'Next round in';
	}
}
