/** Pure helpers for the hide and seek client and HUD (docs/modes.md#hide-and-seek). Unit-tested. */
import { HNS_KNIFE, HNS_NAMETAG_RANGE, type HnsPhase, type HnsRole } from '@surf/shared';

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
