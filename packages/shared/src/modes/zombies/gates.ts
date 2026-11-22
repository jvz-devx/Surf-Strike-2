/**
 * Zombies gates (MapDef.zombies.gates, docs/modes.md#zombies): a collision
 * world that adds the solid box of every closed gate to the map's static
 * world. The same wrapper runs on the server (zombies, hit traces) and on the
 * client (local movement), driven by the gate state in the mode state.
 */
import type { CollisionWorld, Trace } from '../../collision/api.ts';
import { buildCollisionWorld } from '../../collision/world.ts';
import type { ZombieGate } from '../../maps/types.ts';
import type { Vec3 } from '../../types.ts';

export type GateState = 'closed' | 'counting' | 'open';

export const ZM_GATE_COUNTDOWN_SECS = 30;

/** Unlock rule: at least half of the living survivors in the area (and at least one). */
export function unlockReached(inside: number, alive: number): boolean {
	return alive > 0 && inside > 0 && inside * 2 >= alive;
}

export interface GatedWorld extends CollisionWorld {
	/** Open flags by gate index (true = no collision). */
	readonly open: boolean[];
	setOpen(index: number, open: boolean): void;
}

export function gatedWorld(base: CollisionWorld, gates: readonly ZombieGate[]): GatedWorld {
	const worlds = gates.map((g) => buildCollisionWorld({ brushes: [{ type: 'box', min: g.min, max: g.max, material: 'gate' }] }));
	const open = gates.map(() => false);
	function trace(start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3): Trace {
		let best = base.trace(start, end, mins, maxs);
		for (let i = 0; i < worlds.length; i++) {
			if (open[i]) continue;
			const g = gates[i]!;
			// Cheap reject: swept box far from the gate.
			if (
				Math.max(start.x, end.x) + maxs.x < g.min.x - 1 ||
				Math.min(start.x, end.x) + mins.x > g.max.x + 1 ||
				Math.max(start.y, end.y) + maxs.y < g.min.y - 1 ||
				Math.min(start.y, end.y) + mins.y > g.max.y + 1 ||
				Math.max(start.z, end.z) + maxs.z < g.min.z - 1 ||
				Math.min(start.z, end.z) + mins.z > g.max.z + 1
			)
				continue;
			const t = worlds[i]!.trace(start, end, mins, maxs);
			if (t.startsolid || t.fraction < best.fraction) {
				best = {
					...(t.fraction < best.fraction ? t : best),
					startsolid: best.startsolid || t.startsolid,
					allsolid: best.allsolid || t.allsolid
				};
			}
		}
		return best;
	}
	return {
		solids: base.solids,
		trace,
		open,
		setOpen(i, v) {
			if (i >= 0 && i < open.length) open[i] = v;
		}
	};
}
