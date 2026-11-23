/**
 * Server physics cvars (CS2 names). Values from docs/physics.md: the SharpTimer CS2 surf and
 * bhop server configs, with autobhop forced on for every map.
 */
export interface Cvars {
	sv_airaccelerate: number;
	sv_accelerate: number;
	/** CS2: scale ground acceleration by the held weapon's speed. Knife only here, so a no-op. */
	sv_accelerate_use_weapon_speed: 0 | 1;
	/** AirAccelerate projection cap (GetAirSpeedCap). */
	sv_air_max_wishspeed: number;
	sv_friction: number;
	sv_stopspeed: number;
	sv_gravity: number;
	sv_maxspeed: number;
	/** Per-axis velocity clamp; CS2 never goes past its 16384 hard limit (MAX_VELOCITY_HARD). */
	sv_maxvelocity: number;
	sv_autobunnyhopping: 0 | 1;
	sv_enablebunnyhopping: 0 | 1;
	sv_jump_impulse: number;
	/** 1 = CS:GO style jump (old-buttons rule), 0 = CS2 modern jump (bhop window, landing penalty). */
	sv_legacy_jump: 0 | 1;
	/** Modern jump: presses within ±half of this (seconds) around the landing count as bhops. */
	sv_bhop_time_window: number;
	/** Modern jump: a press this soon (seconds) after the previous press is ignored. */
	sv_jump_spam_penalty_time: number;
	/** CS2 jump-precision subtick snapping (not simulated; kept for console parity). */
	sv_jump_precision_enable: 0 | 1;
	sv_timebetweenducks: number;
	/** Ground probe: planes with normal.z >= this can be stood on (CategorizePosition). */
	sv_standable_normal: number;
	/** Step / stay-on-ground: planes with normal.z >= this are walkable. */
	sv_walkable_normal: number;
	sv_staminamax: number;
	sv_staminajumpcost: number;
	sv_staminalandcost: number;
	sv_staminarecoveryrate: number;
	sv_stepsize: number;
	/**
	 * Hard cap on horizontal speed while airborne (bhop/strafe/surf), in u/s; 0 = off.
	 * Not a CS2 cvar: hide and seek servers capped bhop speed with plugins (docs/modes.md#hide-and-seek).
	 */
	sv_air_speed_cap: number;
}

/** CS2 MAX_VELOCITY_HARD: no velocity component ever exceeds this, whatever sv_maxvelocity says. */
export const MAX_VELOCITY_HARD = 16384;

/** sqrt(2 * gravity * 57): a 57-unit standing jump at sv_gravity 800 (CS2 default 301.993378). */
export const JUMP_IMPULSE = Math.sqrt(2 * 800 * 57);

/** SharpTimer CS2 surf config (sv_maxspeed kept at the 250 knife run speed). */
export const SURF_CVARS: Readonly<Cvars> = Object.freeze({
	sv_airaccelerate: 150,
	sv_accelerate: 6.5,
	sv_accelerate_use_weapon_speed: 0,
	sv_air_max_wishspeed: 30,
	sv_friction: 5.2,
	sv_stopspeed: 80,
	sv_gravity: 800,
	sv_maxspeed: 250,
	sv_maxvelocity: 9876,
	sv_autobunnyhopping: 1, // hold jump to bhop on every map (owner's choice)
	sv_enablebunnyhopping: 1,
	sv_jump_impulse: JUMP_IMPULSE,
	sv_legacy_jump: 1,
	sv_bhop_time_window: 0.0078125,
	sv_jump_spam_penalty_time: 0.015625,
	sv_jump_precision_enable: 0,
	sv_timebetweenducks: 0.4,
	sv_standable_normal: 0.7,
	sv_walkable_normal: 0.7,
	sv_staminamax: 80,
	sv_staminajumpcost: 0,
	sv_staminalandcost: 0,
	sv_staminarecoveryrate: 60,
	sv_stepsize: 18,
	sv_air_speed_cap: 0
});

/**
 * SharpTimer CS2 bhop config (high air accel, sv_maxvelocity 99999, clamped at 16384),
 * but with the legacy jump (owner's choice): full-height hops, no landing penalty.
 */
export const BHOP_CVARS: Readonly<Cvars> = Object.freeze({
	...SURF_CVARS,
	sv_airaccelerate: 1000,
	sv_accelerate: 5,
	sv_friction: 4,
	sv_maxvelocity: 99999,
	sv_legacy_jump: 1,
	sv_timebetweenducks: 0
});

/** Boolean cvars (console input is normalised to 0/1). */
export const SV_BOOL_CVARS: ReadonlySet<keyof Cvars> = new Set<keyof Cvars>([
	'sv_accelerate_use_weapon_speed',
	'sv_autobunnyhopping',
	'sv_enablebunnyhopping',
	'sv_legacy_jump',
	'sv_jump_precision_enable'
]);
