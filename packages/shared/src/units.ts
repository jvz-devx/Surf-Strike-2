/** World units are Hammer units (1 unit = 1 inch). See docs/physics.md. */
export const HU_TO_METRES = 0.0254;

/** Fixed simulation rate: CS2's 64 tick (15.625 ms), with subtick input inside each tick. */
export const TICK_RATE = 64;
export const TICK_INTERVAL = 1 / TICK_RATE;

/** Upper bound on ticks run per frame before the simulation slows down. */
export const MAX_TICKS_PER_FRAME = 8;

export type { Vec3 } from './types.ts';
