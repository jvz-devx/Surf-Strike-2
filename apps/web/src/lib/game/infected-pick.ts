/**
 * Patient Zero pick feedback (docs/modes.md#infected): what the `alpha` event
 * shows in the world. InfectedClient calls it from its `alpha` case. Like the
 * other feedback (./infected-feedback.ts) it is optional: no renderer or an
 * undrawn avatar just shows nothing.
 */
import type { InfEvent } from '@surf/shared';
import { emptyPose } from '../render/players.js';
import type { InfHost } from './infected.js';

const AV = emptyPose();

/**
 * Patient Zero was picked: the same transition as an infection, a burst at
 * the body and the avatar easing into the Patient Zero look. No sound here:
 * the pick has its own (`alpha`), which everyone hears. Nothing for my own
 * pick (my avatar is not drawn).
 */
export function pickFeedback(host: InfHost, ev: Extract<InfEvent, { e: 'alpha' }>, me: number, now: number): void {
	if (ev.id === me) return;
	const players = host.remotePlayers?.() ?? null;
	if (!players) return;
	players.turn(ev.id, now);
	if (players.pose(ev.id, AV) && !players.isHidden) host.infectedRenderer()?.fx?.turn(AV, now);
}
