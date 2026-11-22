/**
 * Run tracker contract (docs/gameplay.md): zones, timer, splits, prespeed cap,
 * teleports. Shared by client (simulation) and server (validation helpers).
 *
 * Implemented in ./run-tracker.ts:
 *   export class RunTracker {
 *     constructor(map: MapDef)
 *     state: RunState
 *     // Call once per tick AFTER playerMove. Mutates player (prespeed cap,
 *     // teleports) and returns events that happened this tick.
 *     update(player: PlayerState, tick: number): RunEvent[]
 *     restart(player: PlayerState): void   // !r: to spawn, timer reset
 *     back(player: PlayerState): void      // !back: to current stage/checkpoint respawn
 *   }
 */
import type { Spawn } from './maps/types.ts';
import { TICK_RATE } from './units.ts';

export const PRESPEED_CAP = 290;

/** Seconds after finishing before the player is sent back to the start. */
export const FINISH_RESET_DELAY = 3;
/** FINISH_RESET_DELAY in ticks. */
export const FINISH_RESET_DELAY_TICKS = Math.round(FINISH_RESET_DELAY * TICK_RATE);

export interface RunState {
	phase: 'start' | 'running' | 'finished' | 'idle';
	/** Ticks since leaving the start zone (only meaningful while running/finished). */
	ticks: number;
	/** Current stage (staged maps, 1-based) or last checkpoint index (0 = none). */
	stage: number;
	/** Split ticks at each stage/checkpoint entry, in order. */
	splits: number[];
	/** Respawn used by !back and 'stage' teleports. */
	respawn: Spawn;
	/** Tick at which a finished player is sent back to the start (null = none pending). */
	resetAt: number | null;
}

export type RunEvent =
	| { type: 'zone'; kind: 'start' | 'stage' | 'checkpoint' | 'end'; index: number; tick: number }
	| { type: 'split'; index: number; ticks: number }
	| { type: 'finish'; ticks: number; splits: number[] }
	| { type: 'teleport'; reason: 'trigger' | 'restart' | 'back' | 'finish' }
	| { type: 'enterStart' };
