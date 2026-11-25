/**
 * Sight points of the first-person guns (docs/modes.md#infected): where the
 * eye looks through the sights, and the aimed pose built from it. Aiming down
 * sights puts this point on the view axis of the viewmodel camera.
 *
 * A sight point is in viewmodel-node space, the same space as
 * `userData.muzzle` (render/viewmodels.ts): after a model's `place()`, before
 * the viewmodel group's own scale. A model may carry its own as
 * `group.userData.sight` (a THREE.Vector3 or [x, y, z]); the code-built models
 * use `VIEWMODEL_SIGHTS`. Iron sights: the top of the front post (the rear
 * notch sits on the same line). Scopes: the centre of the eyepiece. A loaded
 * model sets its own aim depth too (`userData.aimDepth`): its sight point is
 * the rear sight, nearer the eye than the front post of a code-built gun.
 */
import type { WeaponId } from '@surf/shared';
import * as THREE from 'three';

/** Sight points of the code-built models (viewmodel-node space). */
export const VIEWMODEL_SIGHTS: Readonly<Partial<Record<WeaponId, readonly [number, number, number]>>> = Object.freeze({
	// Front post top: place(-3.57, 1.15, -3.0, 1.3) of (0, 3.44, -7.7).
	pistol: [-3.57, 5.622, -13.01],
	// Front post top: place(-2.6, 2.1, -4.9, 1) of (0, 3.65, -6.6).
	smg: [-2.6, 5.75, -11.5],
	// Front post top: place(-1.4, 1.5, -5.2, 0.82) of (0, 2.55, -19.6).
	lmg: [-1.4, 3.591, -21.272],
	// Front post top inside the ghost ring: place(-1.9, 1.65, -5.1, 0.9) of (0, 3.0, -23.4).
	striker: [-1.9, 4.35, -26.16],
	// Scope eyepiece: place(-1.2, 1.1, -5.2, 0.85) of (0, 3.0, 5.1).
	sniper: [-1.2, 3.65, -0.865],
	// Scope eyepiece: place(-0.95, 1.3, -6.3, 0.78) of (0, 4.5, 5.71).
	barrett: [-0.95, 4.81, -1.846]
});

/**
 * Distance from the eye to the sight point when fully aimed (viewmodel camera
 * units, at the viewmodel group's 0.42 scale): close enough to fill the view
 * like a raised gun, far enough that no part of the gun or the forearms is cut
 * by the near plane on the way.
 */
export const AIM_DEPTH: Readonly<Partial<Record<WeaponId, number>>> = Object.freeze({
	pistol: 9,
	smg: 8.5,
	lmg: 16,
	striker: 17,
	sniper: 6.5,
	barrett: 6.5
});
/** Depth for a gun without an entry (a loaded model of a new weapon). */
export const AIM_DEPTH_DEFAULT = 10;

/** Aim depth of `weapon` with model `group`: `userData.aimDepth` first, else the table, else the default. */
export function aimDepthOf(weapon: WeaponId, group: THREE.Object3D | undefined): number {
	const own: unknown = group?.userData.aimDepth;
	if (typeof own === 'number' && Number.isFinite(own) && own > 0) return own;
	return AIM_DEPTH[weapon] ?? AIM_DEPTH_DEFAULT;
}

/** Sight point of `weapon` with model `group` (`userData.sight` first, else the table) into `out`; null for none. */
export function sightOf(weapon: WeaponId, group: THREE.Object3D | undefined, out: THREE.Vector3): THREE.Vector3 | null {
	const own: unknown = group?.userData.sight;
	if (own instanceof THREE.Vector3) return out.copy(own);
	if (Array.isArray(own) && own.length === 3 && own.every((n) => typeof n === 'number' && Number.isFinite(n))) return out.set(own[0], own[1], own[2]);
	const t = VIEWMODEL_SIGHTS[weapon];
	return t ? out.set(t[0], t[1], t[2]) : null;
}
