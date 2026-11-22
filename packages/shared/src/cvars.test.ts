import { describe, expect, it } from 'vitest';
import { BHOP_CVARS, JUMP_IMPULSE, SURF_CVARS } from './cvars.ts';

describe('cvar profiles', () => {
	it('jump impulse matches docs/physics.md', () => {
		expect(JUMP_IMPULSE).toBeCloseTo(301.993, 3);
	});

	it('surf and bhop profiles follow the SharpTimer CS2 configs; autobhop on everywhere', () => {
		expect(SURF_CVARS).toMatchObject({
			sv_accelerate: 6.5,
			sv_accelerate_use_weapon_speed: 0,
			sv_friction: 5.2,
			sv_stopspeed: 80,
			sv_airaccelerate: 150,
			sv_air_max_wishspeed: 30,
			sv_gravity: 800,
			sv_maxspeed: 250,
			sv_maxvelocity: 9876,
			sv_enablebunnyhopping: 1,
			sv_autobunnyhopping: 1,
			sv_legacy_jump: 1,
			sv_jump_precision_enable: 0,
			sv_timebetweenducks: 0.4,
			sv_staminajumpcost: 0,
			sv_staminalandcost: 0,
			sv_standable_normal: 0.7,
			sv_walkable_normal: 0.7
		});
		expect(BHOP_CVARS).toMatchObject({
			sv_accelerate: 5,
			sv_friction: 4,
			sv_stopspeed: 80,
			sv_airaccelerate: 1000,
			sv_maxvelocity: 99999,
			sv_enablebunnyhopping: 1,
			sv_autobunnyhopping: 1,
			sv_legacy_jump: 1,
			sv_timebetweenducks: 0,
			sv_staminajumpcost: 0,
			sv_staminalandcost: 0
		});
		expect(Object.keys(BHOP_CVARS).sort()).toEqual(Object.keys(SURF_CVARS).sort());
	});
});
