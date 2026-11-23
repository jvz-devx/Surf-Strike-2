/**
 * Zombies weapons (docs/modes.md#zombies). Data-driven: the client and the
 * server read the same table, and `WeaponState` (magazine, reserve, reload,
 * fire rate) runs on both, with the server using a looser `tolerance` so
 * network jitter never rejects honest shots.
 *
 * Damage is in zombie hit points: a zombie has ZOMBIE_HP, so shots-to-kill
 * on the body is ZOMBIE_HP / damage. Any headshot kills outright.
 */

/**
 * Survivor weapons, plus 'claws': the melee attack of players who turned into
 * zombies. 'barrett', 'striker' and 'smg' are Infected-only primaries (not in
 * the Zombies loadout, WEAPON_IDS).
 */
export type WeaponId = 'knife' | 'pistol' | 'sniper' | 'lmg' | 'barrett' | 'striker' | 'smg' | 'claws';

export interface WeaponDef {
	id: WeaponId;
	label: string;
	/** Loadout key (1-4) while picking a weapon. */
	slot: number;
	/** Zombie HP removed by one body hit. */
	damage: number;
	/** Player max speed while holding it (CS-style weapon speed, u/s). */
	moveSpeed: number;
	/** Minimum time between shots (ms). */
	fireMs: number;
	/** Hold mouse1 to keep firing. */
	automatic: boolean;
	/** Rounds per magazine; 0 = melee (no ammo). */
	magazine: number;
	/** Reserve rounds at spawn (refilled at checkpoints). */
	reserve: number;
	reloadMs: number;
	/** Max hit distance from the eye (units). Melee: reach. */
	range: number;
	/** Melee only: half-angle of the hit cone (degrees). */
	coneDeg: number;
	/** Zombies one bullet can pass through. */
	pierce: number;
	/** Random spread half-angle (degrees, client-side); `scopedSpread` while zoomed. */
	spread: number;
	scopedSpread: number;
	/** Has a zoom on mouse2 (horizontal FOV while zoomed, at 4:3). */
	zoomFov: number | null;
	/** Horizontal push on the zombie per hit (u/s). */
	knockback: number;
	/** Shotguns: rays per trigger pull (default 1); `damage` and `knockback` are per pellet. */
	pellets?: number;
	/** Shotguns: pellet scatter half-angle (degrees) around the aim. */
	pelletSpread?: number;
}

/** Zombie hit points. */
export const ZOMBIE_HP = 8;

export const WEAPONS: Readonly<Record<WeaponId, WeaponDef>> = Object.freeze({
	lmg: {
		id: 'lmg',
		label: 'Light machine gun',
		slot: 1,
		damage: 1, // 8 body hits
		moveSpeed: 195,
		fireMs: 80, // 750 rpm
		automatic: true,
		magazine: 100,
		reserve: 300,
		reloadMs: 4200,
		range: 4096,
		coneDeg: 0,
		pierce: 1,
		spread: 1.6,
		scopedSpread: 1.6,
		zoomFov: null,
		knockback: 40
	},
	pistol: {
		id: 'pistol',
		label: 'Pistol',
		slot: 2,
		damage: 2, // 4 body hits
		moveSpeed: 240,
		fireMs: 150,
		automatic: false,
		magazine: 12,
		reserve: 96,
		reloadMs: 1500,
		range: 4096,
		coneDeg: 0,
		pierce: 1,
		spread: 0.5,
		scopedSpread: 0.5,
		zoomFov: null,
		knockback: 80
	},
	knife: {
		id: 'knife',
		label: 'Knife',
		slot: 3,
		damage: ZOMBIE_HP, // one hit
		moveSpeed: 250,
		fireMs: 450,
		automatic: true,
		magazine: 0,
		reserve: 0,
		reloadMs: 0,
		range: 76,
		coneDeg: 38,
		pierce: 1,
		spread: 0,
		scopedSpread: 0,
		zoomFov: null,
		knockback: 0
	},
	sniper: {
		id: 'sniper',
		label: 'Sniper rifle',
		slot: 4,
		damage: ZOMBIE_HP, // one hit
		moveSpeed: 205,
		fireMs: 1250, // bolt action
		automatic: false,
		magazine: 5,
		reserve: 30,
		reloadMs: 3000,
		range: 8192,
		coneDeg: 0,
		pierce: 3,
		spread: 3,
		scopedSpread: 0,
		zoomFov: 40,
		knockback: 0
	},
	barrett: {
		id: 'barrett',
		label: '.50 cal rifle',
		slot: 1,
		damage: ZOMBIE_HP, // one hit
		moveSpeed: 205,
		fireMs: 360, // semi-auto
		automatic: false,
		magazine: 10,
		reserve: 30,
		reloadMs: 3200,
		range: 8192,
		coneDeg: 0,
		pierce: 3,
		spread: 2.8,
		scopedSpread: 0,
		zoomFov: 38,
		knockback: 140
	},
	striker: {
		id: 'striker',
		label: 'Auto shotgun',
		slot: 1,
		damage: 1, // per pellet
		pellets: 8,
		pelletSpread: 4.0,
		moveSpeed: 230,
		fireMs: 280,
		automatic: false,
		magazine: 12,
		reserve: 36,
		reloadMs: 2600,
		range: 1400,
		coneDeg: 0,
		pierce: 1,
		spread: 1.2,
		scopedSpread: 1.2,
		zoomFov: null,
		knockback: 28 // per pellet
	},
	smg: {
		id: 'smg',
		label: 'SMG',
		slot: 1,
		damage: 1,
		moveSpeed: 245,
		fireMs: 65, // ~920 rpm
		automatic: true,
		magazine: 36,
		reserve: 144,
		reloadMs: 1750,
		range: 3600,
		coneDeg: 0,
		pierce: 1,
		spread: 1.3,
		scopedSpread: 1.3,
		zoomFov: null,
		knockback: 30
	},
	claws: {
		id: 'claws',
		label: 'Claws',
		slot: 0, // never picked: player-zombies always use it
		damage: 0, // hits survivors (1 HP per hit, like AI zombies)
		moveSpeed: 265, // ZM_ZOMBIE_SPEED
		fireMs: 900, // ZM_ATTACK_COOLDOWN_MS
		automatic: true,
		magazine: 0,
		reserve: 0,
		reloadMs: 0,
		range: 64,
		coneDeg: 45,
		pierce: 1,
		spread: 0,
		scopedSpread: 0,
		zoomFov: null,
		knockback: 0
	}
});

/** Survivor loadout (claws are not selectable). */
export const WEAPON_IDS: readonly WeaponId[] = ['lmg', 'pistol', 'knife', 'sniper'];

export function isLoadoutWeapon(v: unknown): v is WeaponId {
	return isWeaponId(v) && WEAPON_IDS.includes(v);
}
export const DEFAULT_WEAPON: WeaponId = 'pistol';

export function isWeaponId(v: unknown): v is WeaponId {
	return typeof v === 'string' && Object.hasOwn(WEAPONS, v);
}

/** Weapon bound to loadout key `slot` (1-4), or null. */
export function weaponForSlot(slot: number): WeaponId | null {
	return WEAPON_IDS.find((w) => WEAPONS[w].slot === slot) ?? null;
}

/** Zombie damage of one hit (headshots always kill). */
export function hitDamage(weapon: WeaponId, head: boolean, zombieHp = ZOMBIE_HP): number {
	return head ? Math.max(zombieHp, ZOMBIE_HP) : WEAPONS[weapon].damage;
}

/** Body hits needed to kill a full-health zombie. */
export function shotsToKill(weapon: WeaponId, head = false): number {
	return head ? 1 : Math.ceil(ZOMBIE_HP / WEAPONS[weapon].damage);
}

/**
 * Magazine, reserve, reload and fire-rate bookkeeping for one held weapon.
 * Times are ms on the caller's clock. `tolerance` (0..1] scales the waits
 * (server: 0.75 for fire, 0.85 for reloads) so jitter does not reject shots.
 */
export class WeaponState {
	weapon: WeaponId;
	mag: number;
	reserve: number;
	/** Reload completes at this time; 0 = not reloading. */
	reloadEndsAt = 0;
	/** Duration of the running (or last) reload, for `reloadProgress`. */
	reloadDurationMs = 0;
	nextFireAt = 0;

	constructor(
		weapon: WeaponId = DEFAULT_WEAPON,
		private readonly fireTolerance = 1,
		private readonly reloadTolerance = 1
	) {
		this.weapon = weapon;
		this.mag = WEAPONS[weapon].magazine;
		this.reserve = WEAPONS[weapon].reserve;
	}

	get def(): WeaponDef {
		return WEAPONS[this.weapon];
	}

	get melee(): boolean {
		return this.def.magazine === 0;
	}

	/** Switch to a fresh weapon (full magazine and reserve). */
	equip(weapon: WeaponId): void {
		this.weapon = weapon;
		this.mag = WEAPONS[weapon].magazine;
		this.reserve = WEAPONS[weapon].reserve;
		this.reloadEndsAt = 0;
		this.nextFireAt = 0;
	}

	/** Refill the reserve (checkpoints); the magazine is kept. */
	refill(): void {
		this.reserve = this.def.reserve;
	}

	reloading(now: number): boolean {
		this.update(now);
		return this.reloadEndsAt > 0;
	}

	/** Finish a reload whose time is up. */
	update(now: number): void {
		if (this.reloadEndsAt === 0 || now < this.reloadEndsAt) return;
		this.reloadEndsAt = 0;
		const take = Math.min(this.def.magazine - this.mag, this.reserve);
		this.mag += take;
		this.reserve -= take;
	}

	/** Reload progress 0..1 (1 when not reloading). */
	reloadProgress(now: number): number {
		if (!this.reloading(now)) return 1;
		const total = this.reloadDurationMs > 0 ? this.reloadDurationMs : this.def.reloadMs * this.reloadTolerance;
		return total <= 0 ? 1 : Math.max(0, Math.min(1, 1 - (this.reloadEndsAt - now) / total));
	}

	canFire(now: number): boolean {
		if (this.reloading(now) || now < this.nextFireAt) return false;
		return this.melee || this.mag > 0;
	}

	/** Spend a round (or swing). `cadenceFactor` scales the wait to the next shot. Returns false if the weapon cannot fire now. */
	fire(now: number, cadenceFactor = 1): boolean {
		if (!this.canFire(now)) return false;
		if (!this.melee) this.mag--;
		this.nextFireAt = now + this.def.fireMs * this.fireTolerance * cadenceFactor;
		return true;
	}

	canReload(now: number): boolean {
		return !this.melee && !this.reloading(now) && this.mag < this.def.magazine && this.reserve > 0;
	}

	/** Start a reload; `reloadFactor` scales its duration (e.g. 0.5 for a faster reload perk). */
	startReload(now: number, reloadFactor = 1): boolean {
		if (!this.canReload(now)) return false;
		this.reloadDurationMs = this.def.reloadMs * this.reloadTolerance * reloadFactor;
		this.reloadEndsAt = now + this.reloadDurationMs;
		return true;
	}
}
