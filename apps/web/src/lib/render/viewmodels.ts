/**
 * First-person weapon and claw models (docs/modes.md#zombies), shared by the
 * Zombies, Infected and Hide and seek modes: code-built low-poly geometry, no
 * model files. One group per weapon id, pointing down −Z (camera forward) in
 * viewmodel space, with `userData.muzzle` at the barrel end (null for melee).
 * The claws carry `userData.right` and `userData.left` (each with
 * `userData.rest`); the off-hand throwing knife sits in the left claw.
 *
 * Every model is built in its own model space (grip near the origin, bore
 * along −Z) and placed with `place()`: the offset and scale are baked into the
 * geometry, so the group itself stays at the origin of the viewmodel node and
 * `userData.muzzle` is in that node's space. Static parts that share a material
 * are one mesh (render/viewmodel-mesh.ts).
 */
import type { WeaponId } from '@surf/shared';
import * as THREE from 'three';
import { Mesher, sect, type P2, type V3 } from './viewmodel-mesh.js';
import { GunRig } from './gun-rig.js';
import { weaponHands } from './hand-poses.js';
import { WeaponHandPair, type HandKit } from './hands.js';
import { generated, sightTurn } from './weapon-assets.js';

export interface Viewmodels {
	/** One hidden group per weapon id. */
	models: Map<WeaponId, THREE.Group>;
	/** Off-hand throwing knife (infected), a child of the left claw. */
	offKnife: THREE.Group;
	/** Everything to dispose with the renderer (the hands of generated models join the list). */
	materials: THREE.Material[];
	geometries: THREE.BufferGeometry[];
	/**
	 * Put a loaded generated model (render/weapon-assets.ts) in place of the
	 * code-built one of a weapon, in the same group: the hands re-posed on it,
	 * the muzzle, sight and forearm ends moved with it. The model is used as it
	 * is (the caller owns it); a weapon without a generated model is left alone.
	 * `userData.rig` of the group is then its `GunRig` (render/gun-rig.ts): the moving parts and points of the file.
	 */
	fit(id: WeaponId, mesh: THREE.Object3D): void;
	/**
	 * The gloved hands have arrived (render/hands.ts): every fitted weapon, now or later, gets its own pair
	 * in place of the box hands. `userData.hands` of its group is then the `WeaponHandPair`.
	 */
	useHands(kit: HandKit): void;
	/** The moving parts and the hands of a weapon back to rest. */
	rest(id: WeaponId): void;
}

/**
 * Cost limit of one model, checked by the tests: triangles of the whole model,
 * and meshes drawn at once (one per material, plus the moving parts of the claws).
 */
export const VIEWMODEL_BUDGET = { triangles: 3500, drawCalls: 12 } as const;

/** The cut end of a forearm (viewmodel space): it has to stay off screen. */
export interface ArmEnd {
	at: THREE.Vector3;
	r: number;
}

/** Materials shared by all models. */
interface Palette {
	gunmetal: THREE.Material;
	steel: THREE.Material;
	polymer: THREE.Material;
	rubber: THREE.Material;
	wood: THREE.Material;
	olive: THREE.Material;
	brass: THREE.Material;
	glass: THREE.Material;
	/** Survivor hands: glove, its dark strap and knuckle plate, jacket sleeve. */
	glove: THREE.Material;
	pad: THREE.Material;
	sleeve: THREE.Material;
	/** Infected arms: skin, torn sleeve, talons, glowing veins. */
	skin: THREE.Material;
	tornSleeve: THREE.Material;
	talon: THREE.Material;
	vein: THREE.Material;
	/** Throwing knife: dark blade and its bright cutting edge (unlit, so it reads against bright skies). */
	blade: THREE.Material;
	edge: THREE.Material;
	/** Aim mark of an open optic (unlit). */
	dot: THREE.Material;
}

interface Kit {
	pal: Palette;
	materials: THREE.Material[];
	geometries: THREE.BufferGeometry[];
}

function palette(materials: THREE.Material[]): Palette {
	// The viewmodel scene has no environment map: metalness stays low, and a little of the
	// base colour as emissive keeps the faces turned away from the sun readable.
	const std = (color: number, roughness: number, metalness = 0.1, fill = 0.14) => {
		const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive: color, emissiveIntensity: fill });
		materials.push(m);
		return m;
	};
	const pal: Palette = {
		gunmetal: std(0x596069, 0.45, 0.35),
		steel: std(0xb4bac2, 0.3, 0.45),
		polymer: std(0x34383e, 0.75, 0.05),
		rubber: std(0x1f2125, 0.9, 0),
		wood: std(0x8a5c36, 0.7, 0),
		olive: std(0x5f6a48, 0.7, 0.05),
		brass: std(0xb08a3c, 0.4, 0.5),
		glass: std(0x1a3a5a, 0.15, 0.6, 0.5),
		glove: std(0x86704f, 0.85, 0),
		pad: std(0x2f3237, 0.7, 0),
		sleeve: std(0x44505e, 0.9, 0),
		skin: std(0x7a5a4c, 0.85, 0),
		tornSleeve: std(0x3a2a26, 0.9, 0),
		talon: std(0x1a1214, 0.35, 0.2),
		vein: new THREE.MeshStandardMaterial({ color: 0x5a1010, emissive: 0x6a0a08, roughness: 0.7 }),
		blade: std(0x3c4249, 0.32, 0.3),
		dot: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
		edge: new THREE.MeshBasicMaterial({ color: 0xf4f8ff })
	};
	materials.push(pal.vein, pal.edge, pal.dot);
	// Meshes take the name of their material (the dev viewer and the tests tell the arms from the gun by it).
	for (const [name, m] of Object.entries(pal)) m.name = name;
	return pal;
}

/** Placement of a model in viewmodel space: offset of its origin, uniform scale, optional turn (rad, XYZ order). */
function place(x: number, y: number, z: number, s: number, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
	return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));
}

/**
 * Placement of each model in viewmodel space. The generated models
 * (render/weapon-assets.ts) are fitted into the same model spaces, so their
 * hands keep the size of the code-built ones.
 */
const PLACES = {
	pistol: place(-3.57, 1.15, -3.0, 1.3),
	smg: place(-2.6, 2.1, -4.9, 1),
	lmg: place(-1.4, 1.5, -5.2, 0.82),
	sniper: place(-1.2, 1.1, -5.2, 0.85),
	heavy: place(-0.95, 1.3, -6.3, 0.78),
	shotgun: place(-1.9, 1.65, -5.1, 0.9),
	knife: place(0.6, -1.0, -1.5, 1.2, 0.5, 0.55, -0.6)
} as const;

/** Model space of each weapon id that has a generated model. */
const SPACE: Readonly<Partial<Record<WeaponId, THREE.Matrix4>>> = {
	pistol: PLACES.pistol,
	smg: PLACES.smg,
	lmg: PLACES.lmg,
	sniper: PLACES.sniper,
	barrett: PLACES.heavy,
	striker: PLACES.shotgun,
	knife: PLACES.knife
};

/** Cut end of the pistol forearm (model space). */
const PISTOL_ARM_END: V3 = [4.5, -15, 22];

const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
	const l = Math.hypot(a[0], a[1], a[2]) || 1;
	return [a[0] / l, a[1] / l, a[2] / l];
};

/** Turn a builder into the model group: meshes, the muzzle point and the forearm ends. */
function finish(k: Kit, b: Mesher, muzzle: V3 | null, arms: ArmEnd[]): THREE.Group {
	const g = new THREE.Group();
	b.build(g, k.geometries);
	g.userData.muzzle = muzzle ? b.placed(muzzle) : null;
	g.userData.arms = arms;
	return g;
}

// ---------------------------------------------------------------------
// Hands (survivors): dark gloves, a strap at the wrist, jacket sleeves.

/** Finger half thickness and the height of one finger. */
const FINGER = 0.5;
const FINGER_H = 0.92;

/**
 * Gloved right hand closed around a grip. Frame: grip axis +Y, front −Z,
 * backstrap +Z, origin on the axis at the middle finger; mirror the frame for
 * a left hand. `hw`, `hd`: half width and half depth of the grip; `rake`: how
 * far the frame leans back from the bore (rad). The index finger lies on the
 * trigger or wraps with the others; the thumb points forward along the far
 * side or closes over the fingers. Returns the wrist (model space).
 */
function gripHand(b: Mesher, pal: Palette, hw: number, hd: number, rake = 0.31, index: 'trigger' | 'wrap' = 'trigger', thumb: 'forward' | 'wrap' = 'forward'): V3 {
	const R = FINGER;
	const xr = hw + R;
	const zf = -(hd + R);
	const back = hd * 0.7;
	for (const i of index === 'wrap' ? [1, 0, -1, -2] : [0, -1, -2]) {
		const y = i;
		const tip = 1.9 - Math.abs(i + 0.5) * 0.3;
		b.box(pal.glove, 2 * R, FINGER_H, back - (zf - R), xr, y, (back + zf - R) / 2); // along the near side
		b.box(pal.glove, 2 * (hw + 2 * R), FINGER_H, 2 * R, 0, y, zf); // across the front
		b.box(pal.glove, 2 * R, FINGER_H, tip, -xr, y, zf - R + tip / 2); // back along the far side
	}
	if (index === 'trigger') {
		// Along the frame, level with the bore, the tip bent in onto the trigger.
		b.in(0, 1.2, back, rake, 0, 0, () => {
			b.box(pal.glove, 2 * R, FINGER_H, 3.8, xr, 0, -1.9);
			b.box(pal.glove, xr + R - 0.15, FINGER_H, 2 * R * 0.9, (xr + R + 0.15) / 2, 0, -3.8 + R * 0.9);
		});
	}
	// Back of the hand on the near side, with a knuckle plate.
	b.cbox(pal.glove, 1.4, 4.3, back + 1.7, hw + 0.7, -0.4, (hd + 1.7 + hd - back) / 2, 0.25);
	b.box(pal.pad, 0.22, 2.7, 1.9, hw + 1.45, 0.1, hd * 0.4 + 0.3);
	// Behind the grip: the web of the thumb on top, the heel of the hand below, a strap between them.
	b.cbox(pal.glove, 2 * hw + 1.7, 1.6, 1.4, 0.35, 1.0, hd + 0.7, 0.3);
	b.cbox(pal.glove, 2 * hw + 2.0, 3.0, 2.0, 0.5, -0.95, hd + 1.0, 0.45);
	b.box(pal.pad, 2 * hw + 2.06, 0.34, 0.6, 0.5, 0.42, hd + 1.75);
	if (thumb === 'forward') {
		b.in(0, 1.8, hd + 0.6, rake + 0.06, 0, 0, () => {
			b.cbox(pal.glove, 1.1, 1.0, 2.2, -(hw + 0.5), 0, -0.9, 0.2);
			b.cbox(pal.glove, 0.95, 0.86, 1.6, -(hw + 0.45), 0.03, -2.6, 0.2);
		});
	} else {
		// Over the fingers: along the far side, then across the front.
		b.box(pal.glove, 1.1, 1.0, hd * 1.6 + R, -(hw + 0.5), 1.98, (hd * 0.6 + zf) / 2 + 0.2);
		b.box(pal.glove, hw * 1.6, 1.0, 1.0, -hw * 0.3, 1.98, zf - 0.05);
	}
	return b.model(hw * 0.3, -1.5, hd + 1.5);
}

/**
 * Forearm from a wrist back to its cut end (model space): glove cuff with a
 * strap, then the jacket sleeve. The end has to leave the screen; it is
 * recorded so the tests can check that.
 */
function arm(b: Mesher, pal: Palette, wrist: V3, end: V3, r = 1.65): ArmEnd {
	const d: V3 = [end[0] - wrist[0], end[1] - wrist[1], end[2] - wrist[2]];
	const len = Math.hypot(d[0], d[1], d[2]);
	const at = (t: number): V3 => [wrist[0] + (d[0] * t) / len, wrist[1] + (d[1] * t) / len, wrist[2] + (d[2] * t) / len];
	const o = { seg: 8, squash: 0.86 };
	// Glove cuff with its strap.
	b.rod(pal.glove, at(-1.2), at(2.1), r * 0.95, r * 1.1, o);
	b.rod(pal.pad, at(0.8), at(1.6), r * 1.18, r * 1.2, o);
	// Jacket sleeve: a turned-up cuff with a dark seam, the forearm, a fold at the elbow, the wider upper sleeve.
	b.rod(pal.sleeve, at(1.9), at(3.4), r * 1.42, r * 1.46, o);
	b.rod(pal.pad, at(3.3), at(3.6), r * 1.36, r * 1.36, o);
	b.rod(pal.sleeve, at(3.2), at(len * 0.46), r * 1.24, r * 1.52, o);
	b.rod(pal.sleeve, at(len * 0.44), at(len * 0.5), r * 1.66, r * 1.6, o);
	b.rod(pal.sleeve, at(len * 0.48), end, r * 1.5, r * 1.75, { ...o, open: true });
	return { at: b.placed(end), r: r * 1.75 * b.scale };
}

/**
 * Gloved left hand under a fore-end. Frame: barrel axis −Z, origin at the
 * bottom of the fore-end under the middle of the hand. `hw`: half width of
 * the fore-end, `h`: how far the fingers reach up its far side. Returns the
 * wrist (model space).
 */
function cradleHand(b: Mesher, pal: Palette, hw: number, h: number): V3 {
	const R = FINGER;
	b.cbox(pal.glove, 2 * hw + 1.7, 1.2, 4.4, 0.05, -0.62, 0.2, 0.3); // palm
	for (let i = 0; i < 4; i++) {
		const top = h - Math.abs(i - 1.3) * 0.22;
		b.box(pal.glove, 2 * R, top + 1.0, FINGER_H, hw + R, (top - 1.0) / 2, -1.55 + i); // up the far side
	}
	// Thumb up the near side, pointing forward, and the ball of the thumb behind it.
	b.cbox(pal.glove, 1.1, 1.15, 3.1, -(hw + 0.5), 0.5, -0.5, 0.18, 0.4);
	b.cbox(pal.glove, 1.6, 1.7, 2.4, -(hw + 0.15), -0.3, 1.5, 0.35);
	return b.model(-0.5, -1.0, 2.6);
}

// ---------------------------------------------------------------------
// Guns

/** Rail on top of a receiver: a strip with cross slots, its underside at `y`. */
function rail(b: Mesher, strip: THREE.Material, slot: THREE.Material, w: number, y: number, z0: number, z1: number): void {
	b.box(strip, w, 0.36, z1 - z0, 0, y + 0.18, (z0 + z1) / 2);
	for (let z = z0 + 0.6; z < z1 - 0.3; z += 0.9) b.box(slot, w + 0.06, 0.2, 0.3, 0, y + 0.3, z);
}

/** Raked pistol grip of a long gun: its top front corner at (z, y). */
function grip(b: Mesher, m: THREE.Material, z: number, y: number, w = 2): void {
	b.prism(
		m,
		[
			[z, y],
			[z + 1.5, y - 4.6],
			[z + 4.0, y - 4.6],
			[z + 2.9, y - 0.6],
			[z + 3.3, y]
		],
		w,
		0,
		0.2
	);
}

/** Trigger guard and trigger ahead of a grip whose top front corner is at (z, y). */
function guard(b: Mesher, m: THREE.Material, trigger: THREE.Material, z: number, y: number): void {
	b.prism(
		m,
		[
			[z - 3.6, y],
			[z - 3.3, y - 1.55],
			[z - 0.2, y - 1.8],
			[z + 0.7, y - 1.2],
			[z + 0.3, y]
		],
		0.8,
		0,
		0.1,
		[
			[z - 3.0, y - 0.05],
			[z - 2.8, y - 1.2],
			[z - 0.3, y - 1.4],
			[z + 0.25, y - 1.0],
			[z, y - 0.05]
		]
	);
	b.box(trigger, 0.3, 1.0, 0.3, 0, y - 0.6, z - 1.3, 0.3);
}

/** Right hand on a grip built by `grip()` at (z, y); returns the wrist. */
function onGrip(b: Mesher, pal: Palette, z: number, y: number, w = 2): V3 {
	let wrist: V3 = [0, 0, 0];
	b.in(0, y - 2.4, z + 2.1, -0.31, 0, 0, () => {
		wrist = gripHand(b, pal, w / 2, 1.25, 0.31);
	});
	return wrist;
}

/** Left hand under a fore-end whose bottom is at `y`, around `z`; returns the wrist. */
function underForeEnd(b: Mesher, pal: Palette, z: number, y: number, hw: number, h: number): V3 {
	let wrist: V3 = [0, 0, 0];
	b.in(0, y, z, 0, 0, 0, () => {
		wrist = cradleHand(b, pal, hw, h);
	});
	return wrist;
}

/** Both forearms of a long gun; they leave through the bottom of the screen. */
function twoArms(b: Mesher, pal: Palette, right: V3, left: V3): ArmEnd[] {
	return [arm(b, pal, right, [right[0] + 5, right[1] - 13, right[2] + 22]), arm(b, pal, left, [left[0] - 22, left[1] - 12, left[2] + 20])];
}

/** Scope on two rings: tube, bells, turrets and lenses; `y` is its axis, `z` the middle of the tube, `s` its size. */
function scope(b: Mesher, pal: Palette, y: number, z: number, s: number, base: number): void {
	const { rubber, gunmetal, glass } = pal;
	b.cyl(rubber, 0.62 * s, 7.4 * s, 0, y, z, 10);
	// Objective bell and lens at the front, eyepiece and lens towards the shooter.
	b.cyl(rubber, 0.62 * s, 1.6 * s, 0, y, z - 4.5 * s, 10, 1.05 * s);
	b.cyl(rubber, 1.05 * s, 2.6 * s, 0, y, z - 6.6 * s, 10);
	b.cyl(glass, 0.9 * s, 0.12, 0, y, z - 7.9 * s - 0.02, 10);
	b.cyl(rubber, 0.86 * s, 1.0 * s, 0, y, z + 4.2 * s, 10, 0.62 * s);
	b.cyl(rubber, 0.86 * s, 2.0 * s, 0, y, z + 5.7 * s, 10);
	b.cyl(glass, 0.7 * s, 0.12, 0, y, z + 6.7 * s + 0.02, 10);
	// Turrets on top and on the right.
	b.rod(rubber, [0, y + 0.4 * s, z - 0.4 * s], [0, y + 1.45 * s, z - 0.4 * s], 0.52 * s, 0.52 * s, { seg: 8 });
	b.rod(rubber, [0.4 * s, y, z - 0.4 * s], [1.45 * s, y, z - 0.4 * s], 0.52 * s, 0.52 * s, { seg: 8 });
	// Rings and their bases down to the receiver.
	for (const dz of [-2.6 * s, 2.3 * s]) {
		b.cyl(gunmetal, 0.82 * s, 0.9, 0, y, z + dz, 8, 0.82 * s, { smooth: false });
		b.box(gunmetal, 1.0, y - base, 0.9, 0, (y + base) / 2, z + dz);
	}
}

/**
 * Pistol: chamfered slide with sights, serrations and an ejection port, a
 * polymer frame with a rail, trigger guard and raked grip, held in one hand.
 */
function pistol(k: Kit): THREE.Group {
	const { gunmetal, steel, polymer, rubber } = k.pal;
	const b = new Mesher(PLACES.pistol);
	const BORE = 2.05;
	// Slide, barrel end and guide rod.
	b.xsec(gunmetal, sect(2.3, 1.0, 3.1, 0.5, 0.12), -8.4, 1.9, 0.14);
	b.cyl(steel, 0.52, 0.5, 0, BORE, -8.55, 10);
	b.cyl(rubber, 0.3, 0.1, 0, BORE, -8.82, 8);
	b.cyl(rubber, 0.3, 0.3, 0, 1.38, -8.45, 8);
	// Ejection port (the steel barrel hood shows) and rear serrations.
	b.box(steel, 1.45, 0.3, 2.3, 0.3, 3.0, -2.9);
	for (let i = 0; i < 5; i++)
		for (const s of [-1, 1]) b.box(rubber, 0.1, 1.25, 0.2, s * 1.13, 1.95, 0.05 + i * 0.36, 0, 0, s * -0.0);
	// Sights: front post, rear notch.
	b.box(rubber, 0.32, 0.36, 0.8, 0, 3.26, -7.7);
	b.box(rubber, 1.5, 0.16, 0.8, 0, 3.16, 1.3);
	for (const s of [-1, 1]) b.box(rubber, 0.46, 0.42, 0.7, s * 0.52, 3.3, 1.3);
	// White dots on the faces towards the shooter.
	b.box(steel, 0.16, 0.16, 0.05, 0, 3.3, -7.29);
	for (const s of [-1, 1]) b.box(steel, 0.16, 0.16, 0.05, s * 0.52, 3.34, 1.66);
	// Frame: dust cover, raked grip with a beavertail.
	const frame: P2[] = [
		[-7.9, 1.02],
		[-7.9, 0.2],
		[0.3, 0.2],
		[2.0, -5.0],
		[4.6, -5.0],
		[2.95, -0.25],
		[3.55, 0.62],
		[2.3, 1.02]
	];
	b.prism(polymer, frame, 2.1, 0, 0.16);
	// Accessory rail under the dust cover.
	b.box(polymer, 1.5, 0.34, 3.4, 0, 0.06, -5.9);
	for (let i = 0; i < 3; i++) b.box(rubber, 1.56, 0.2, 0.3, 0, -0.02, -6.9 + i * 1.0);
	// Trigger guard and trigger.
	b.prism(
		polymer,
		[
			[-3.9, 0.25],
			[-3.5, -1.5],
			[-0.3, -1.8],
			[0.8, -1.2],
			[0.3, 0.25]
		],
		0.9,
		0,
		0.1,
		[
			[-3.2, 0.2],
			[-2.95, -1.15],
			[-0.4, -1.4],
			[0.25, -1.0],
			[-0.05, 0.2]
		]
	);
	b.box(steel, 0.34, 1.05, 0.32, 0, -0.45, -1.35, 0.3);
	// Grip panels, magazine base, controls on the left side.
	b.prism(
		rubber,
		[
			[1.15, -0.8],
			[2.45, -4.6],
			[4.05, -4.6],
			[2.95, -0.8]
		],
		2.26,
		0,
		0.1
	);
	b.prism(
		rubber,
		[
			[1.85, -5.0],
			[4.75, -5.0],
			[4.9, -5.55],
			[1.75, -5.55]
		],
		2.3,
		0,
		0.12
	);
	b.box(steel, 0.14, 0.3, 1.7, -1.1, 0.82, -1.0);
	b.box(rubber, 0.14, 0.42, 0.42, -1.1, 0.62, -3.3);
	b.cyl(rubber, 0.26, 0.2, -1.1, -0.9, 0.95, 6, 0.26, { smooth: false });
	// Right hand on the grip; the forearm leaves through the bottom of the screen.
	let wrist: V3 = [0, 0, 0];
	b.in(0, -2.3, 2.3, -0.33, 0, 0, () => {
		wrist = gripHand(b, k.pal, 1.05, 1.2, 0.33);
	});
	const arms = [arm(b, k.pal, wrist, PISTOL_ARM_END)];
	return finish(k, b, [0, BORE, -8.87], arms);
}

/**
 * SMG: compact body with a sight rail, stubby barrel in a short shroud, a
 * ribbed tube magazine under the barrel (the fore-end), wire stock pushed in.
 */
function smg(k: Kit): THREE.Group {
	const { gunmetal, steel, polymer, rubber } = k.pal;
	const b = new Mesher(PLACES.smg);
	const BORE = 0.9;
	// Receiver with a top cover and a sight rail.
	b.xsec(gunmetal, sect(2.8, -1.5, 1.9, 0.4, 0.25), -7.5, 5.6, 0.16);
	b.xsec(polymer, sect(2.3, 1.9, 2.45, 0.22, 0.02), -7.2, 5.2, 0.1);
	rail(b, gunmetal, rubber, 1.1, 2.45, -5.6, 3.2);
	// Sights: hooded front post, rear notch.
	b.box(rubber, 0.3, 1.2, 0.4, 0, 3.05, -6.6);
	for (const s of [-1, 1]) b.box(rubber, 0.28, 1.35, 0.8, s * 0.62, 3.1, -6.6, 0, 0, s * -0.12);
	b.box(rubber, 1.6, 0.5, 0.8, 0, 2.7, 4.3);
	for (const s of [-1, 1]) {
		b.box(rubber, 0.5, 0.9, 0.7, s * 0.55, 3.2, 4.3);
		b.box(steel, 0.18, 0.18, 0.05, s * 0.55, 3.3, 4.66);
	}
	b.box(steel, 0.16, 0.2, 0.05, 0, 3.4, -6.39);
	// Barrel, shroud and muzzle nut.
	b.cyl(rubber, 0.55, 5.0, 0, BORE, -9.9, 10);
	b.cyl(gunmetal, 0.95, 2.6, 0, BORE, -8.7, 8, 0.95, { smooth: false });
	b.cyl(steel, 0.8, 1.3, 0, BORE, -12.55, 8, 0.8, { smooth: false });
	b.cyl(rubber, 0.45, 0.1, 0, BORE, -13.22, 8);
	// Tube magazine under the barrel: slanted ribs, a front cap, a latch at the rear.
	b.cyl(polymer, 1.5, 12.4, 0, -1.9, -5.4, 12);
	b.cyl(rubber, 1.3, 0.6, 0, -1.9, -11.8, 12);
	for (let i = 0; i < 7; i++) {
		const z = -10.3 + i * 1.55;
		b.rod(rubber, [0, -1.9 - 0.05, z + 0.16], [0, -1.9 + 0.05, z - 0.16], 1.62, 1.62, { seg: 12 });
	}
	b.box(steel, 0.9, 0.7, 1.0, 0, -3.2, 0.3);
	// Charging handle in its slot on the left, ejection port on the right, selector.
	b.box(rubber, 0.1, 0.4, 4.2, -1.42, 1.2, -3.4);
	b.rod(steel, [-1.4, 1.2, -1.9], [-2.3, 1.2, -1.9], 0.32, 0.4, { seg: 6 });
	b.box(rubber, 0.1, 0.9, 2.2, 1.42, 1.1, -2.5);
	b.box(steel, 0.16, 0.36, 1.1, -1.45, -0.6, 2.6, 0.5);
	grip(b, polymer, 2.4, -1.5);
	guard(b, polymer, steel, 2.4, -1.5);
	// Wire stock folded forward along the right side: hinge at the rear, two struts, the butt plate flat on the body.
	b.cbox(gunmetal, 1.4, 1.6, 1.0, 0.9, 0.2, 5.9, 0.15);
	for (const y of [1.0, -0.6]) b.rod(steel, [1.75, y, 5.6], [1.75, y, -4.6], 0.2, 0.2, { seg: 6 });
	b.cbox(rubber, 0.6, 3.0, 1.6, 1.85, 0.2, -5.2, 0.15);
	// End cap with a sling loop.
	b.cbox(polymer, 2.4, 2.6, 0.5, 0, 0.3, 5.8, 0.2);
	b.rod(steel, [-0.5, 1.2, 6.2], [0.5, 1.2, 6.2], 0.16, 0.16, { seg: 6 });
	const arms = twoArms(b, k.pal, onGrip(b, k.pal, 2.4, -1.5), underForeEnd(b, k.pal, -6.2, -3.4, 1.5, 2.6));
	return finish(k, b, [0, BORE, -13.27], arms);
}

/**
 * Light machine gun: olive receiver with a feed cover, a belt running up
 * from the box under it, heavy barrel with a heat shield and flash hider,
 * folded bipod and carry handle, skeleton stock.
 */
function lmg(k: Kit): THREE.Group {
	const { gunmetal, steel, polymer, rubber, olive, brass } = k.pal;
	const b = new Mesher(PLACES.lmg);
	const BORE = 0.6;
	// Receiver, feed cover with its hinge and latch.
	b.xsec(olive, sect(3.4, -1.9, 1.8, 0.4, 0.3), -9.5, 6.5, 0.16);
	b.xsec(gunmetal, sect(3.0, 1.8, 2.6, 0.4, 0.02), -8.6, 2.6, 0.14);
	b.rod(steel, [-1.6, 1.9, -8.8], [1.6, 1.9, -8.8], 0.3, 0.3, { seg: 6 });
	b.box(rubber, 1.2, 0.4, 0.6, 0, 2.7, 2.2);
	// Rear sight on the receiver, behind the cover.
	b.box(rubber, 1.7, 0.5, 1.4, 0, 2.05, 4.4);
	for (const s of [-1, 1]) b.box(rubber, 0.4, 1.0, 0.5, s * 0.6, 2.75, 4.6);
	// Feed tray, and the belt coming up from the box on the left.
	b.box(steel, 1.3, 0.3, 2.8, -2.2, 1.25, -3.2);
	for (let i = 0; i < 6; i++) {
		const t = i / 5;
		const x = -2.25 - Math.sin(t * Math.PI) * 0.7 - t * 0.25;
		const y = 1.5 - t * 3.0;
		b.rod(brass, [x, y, -2.3], [x, y, -3.8], 0.22, 0.22, { seg: 6 });
		b.rod(steel, [x, y, -3.8], [x, y, -4.4], 0.2, 0.05, { seg: 6 });
		b.box(rubber, 0.5, 0.2, 0.5, x, y, -3.0);
	}
	// Belt box under the receiver, left of centre.
	b.cbox(polymer, 3.6, 4.6, 5.6, -0.9, -4.1, -3.4, 0.3);
	b.box(rubber, 3.7, 0.4, 5.7, -0.9, -1.75, -3.4);
	b.box(steel, 0.2, 1.1, 0.9, -2.75, -2.6, -3.4);
	// Heavy barrel with its nut, gas tube and gas block.
	b.cyl(gunmetal, 0.8, 16.3, 0, BORE, -17.65, 10);
	b.cyl(steel, 1.05, 1.2, 0, BORE, -10.3, 8, 1.05, { smooth: false });
	b.cyl(gunmetal, 0.42, 9.6, 0, -0.75, -14.3, 8);
	b.cbox(gunmetal, 1.3, 2.4, 1.5, 0, -0.1, -19.6, 0.15);
	// Hooded front sight on the gas block.
	b.box(rubber, 0.3, 1.3, 0.4, 0, 1.9, -19.6);
	for (const s of [-1, 1]) b.box(rubber, 0.25, 1.5, 0.9, s * 0.6, 1.9, -19.6, 0, 0, s * -0.15);
	// Heat shield over the barrel, vents on its shoulders.
	b.xsec(
		polymer,
		[
			[-1.2, 0.7],
			[-1.2, 1.5],
			[-0.6, 2.0],
			[0.6, 2.0],
			[1.2, 1.5],
			[1.2, 0.7]
		],
		-10.9,
		-18.6,
		0.15
	);
	for (let i = 0; i < 5; i++) for (const s of [-1, 1]) b.box(rubber, 0.5, 0.2, 0.9, s * 0.92, 1.78, -11.8 - i * 1.4, 0, 0, s * -0.7);
	// Flash hider.
	b.cyl(steel, 0.75, 2.0, 0, BORE, -26.6, 8, 1.05, { smooth: false });
	b.cyl(rubber, 0.6, 0.1, 0, BORE, -27.62, 8);
	// Handguard under the barrel, grooved.
	b.xsec(polymer, sect(2.7, -2.0, 0.3, 0.15, 0.6), -9.8, -18.2, 0.18);
	for (let i = 0; i < 4; i++) b.box(rubber, 2.76, 0.25, 0.9, 0, -0.9, -11.4 - i * 1.7);
	// Carry handle folded to the right of the barrel nut.
	b.rod(rubber, [1.7, 1.6, -9.9], [1.7, 1.6, -13.4], 0.42, 0.42, { seg: 8 });
	for (const z of [-10.2, -13.1]) b.box(steel, 1.0, 0.3, 0.4, 1.2, 1.5, z);
	// Bipod folded forward under the barrel: legs from the gas block to short of the muzzle.
	b.box(gunmetal, 1.8, 0.6, 1.0, 0, -1.5, -19.8);
	for (const s of [-1, 1]) {
		b.rod(steel, [s * 0.5, -1.4, -19.9], [s * 0.95, -1.3, -26.3], 0.24, 0.24, { seg: 6 });
		b.box(rubber, 0.7, 0.5, 1.0, s * 0.95, -1.3, -26.6);
	}
	// Charging handle on the right.
	b.rod(steel, [1.7, 0.6, -1.0], [2.5, 0.6, -1.0], 0.3, 0.36, { seg: 6 });
	grip(b, polymer, 2.6, -1.9);
	guard(b, polymer, steel, 2.6, -1.9);
	// Skeleton stock with a butt plate.
	b.prism(
		olive,
		[
			[6.3, 1.4],
			[15.6, 1.6],
			[16.0, -3.6],
			[13.0, -3.2],
			[8.2, -1.0],
			[6.3, -1.6]
		],
		2.6,
		0,
		0.25,
		[
			[8.6, 0.6],
			[14.0, 0.7],
			[14.2, -2.0],
			[12.6, -1.9],
			[9.0, -0.2]
		]
	);
	b.cbox(gunmetal, 2.9, 5.6, 0.8, 0, -1.0, 16.3, 0.25);
	for (const y of [0.6, -1.0, -2.6]) b.box(rubber, 2.2, 0.3, 0.1, 0, y, 16.72);
	const arms = twoArms(b, k.pal, onGrip(b, k.pal, 2.6, -1.9), underForeEnd(b, k.pal, -13.6, -2.0, 1.35, 2.0));
	return finish(k, b, [0, BORE, -27.67], arms);
}

/**
 * Bolt-action sniper rifle: one-piece wooden stock with a cheek comb and a
 * rubber butt pad, steel action with a turned-down bolt handle, tapered
 * barrel, scope on two rings.
 */
function sniper(k: Kit): THREE.Group {
	const { gunmetal, steel, rubber, wood } = k.pal;
	const b = new Mesher(PLACES.sniper);
	const BORE = 0.8;
	// Stock: fore-end, grip, comb and butt in one profile; fore-end tip and butt pad.
	const stock: P2[] = [
		[-17.0, 0.35],
		[-17.0, -0.7],
		[-15.5, -1.25],
		[-4.0, -1.6],
		[2.6, -1.5],
		[4.5, -5.4],
		[6.6, -5.6],
		[6.9, -2.2],
		[15.5, -4.0],
		[15.5, 1.0],
		[9.6, 1.3],
		[7.4, 0.2],
		[3.0, 0.35]
	];
	b.prism(wood, stock, 2.4, 0, 0.3);
	b.prism(
		rubber,
		[
			[15.5, -4.0],
			[16.3, -4.0],
			[16.3, 1.0],
			[15.5, 1.0]
		],
		2.5,
		0,
		0.2
	);
	b.cbox(rubber, 2.44, 1.1, 1.2, 0, -0.2, -17.2, 0.2);
	// Chequered panels on the grip and the fore-end.
	b.prism(
		rubber,
		[
			[3.8, -2.2],
			[5.0, -5.0],
			[6.2, -5.1],
			[6.3, -2.2]
		],
		2.46,
		0,
		0.05
	);
	b.box(rubber, 2.46, 0.7, 6.0, 0, -0.95, -9.5);
	// Action: receiver tube with an ejection port, bolt shroud, turned-down handle with its knob.
	b.cyl(gunmetal, 0.95, 9.5, 0, BORE, -1.75, 10);
	b.box(rubber, 0.8, 0.5, 2.6, 0.6, BORE + 0.45, -2.0);
	b.cyl(steel, 0.62, 1.6, 0, BORE, 3.6, 8, 0.62, { smooth: false });
	b.rod(steel, [0.6, BORE, 2.4], [2.5, 0.1, 2.7], 0.24, 0.24, { seg: 6 });
	b.ball(steel, 0.52, 2.75, -0.05, 2.75);
	// Tapered barrel, crown, front sight ramp.
	b.cyl(gunmetal, 0.68, 21.5, 0, BORE, -17.25, 10, 0.46);
	b.cyl(steel, 0.56, 0.7, 0, BORE, -28.25, 10);
	b.cyl(rubber, 0.3, 0.1, 0, BORE, -28.62, 8);
	b.box(rubber, 0.3, 0.5, 1.3, 0, BORE + 0.7, -26.6);
	scope(b, k.pal, 3.0, -1.6, 1, BORE + 0.8);
	// Trigger guard, trigger, magazine floor plate, sling swivels.
	b.prism(
		steel,
		[
			[-1.3, -1.5],
			[-1.0, -2.5],
			[2.2, -2.6],
			[3.0, -2.0],
			[2.6, -1.5]
		],
		0.7,
		0,
		0.1,
		[
			[-0.7, -1.55],
			[-0.5, -2.2],
			[2.0, -2.3],
			[2.5, -1.9],
			[2.3, -1.55]
		]
	);
	b.box(steel, 0.3, 0.8, 0.3, 0, -1.9, 1.1, 0.3);
	b.box(steel, 1.5, 0.2, 3.4, 0, -1.68, -3.4);
	for (const z of [-14.2, 13.4]) b.rod(steel, [-0.35, z < 0 ? -1.5 : -3.75, z], [0.35, z < 0 ? -1.5 : -3.75, z], 0.3, 0.3, { seg: 6 });
	// Right hand on the grip of the stock, left hand under the fore-end.
	let wrist: V3 = [0, 0, 0];
	b.in(0, -3.3, 5.4, -0.42, 0, 0, () => {
		wrist = gripHand(b, k.pal, 1.2, 1.3, 0.42);
	});
	const arms = twoArms(b, k.pal, wrist, underForeEnd(b, k.pal, -9.5, -1.5, 1.2, 1.7));
	return finish(k, b, [0, BORE, -28.67], arms);
}

/**
 * .50 cal rifle: long two-part receiver with a full rail, big box magazine,
 * heavy fluted barrel with a two-chamber muzzle brake, high scope, folded
 * bipod, stock with a cheek rest and a recoil pad.
 */
function heavyRifle(k: Kit): THREE.Group {
	const { gunmetal, steel, polymer, rubber } = k.pal;
	const b = new Mesher(PLACES.heavy);
	const BORE = 0.3;
	// Lower and upper receiver, rail, ejection port and charging handle on the right.
	b.xsec(gunmetal, sect(3.2, -1.8, 0.6, 0.3, 0.3), -12, 8, 0.16);
	b.xsec(gunmetal, sect(2.8, 0.6, 2.1, 0.5, 0.02), -11.6, 6.4, 0.16);
	rail(b, polymer, rubber, 1.6, 2.1, -11.2, 6.0);
	b.box(rubber, 0.1, 0.9, 3.4, 1.42, 1.3, -3.0);
	b.rod(steel, [1.4, 1.3, 0.2], [2.3, 1.3, 0.2], 0.3, 0.38, { seg: 6 });
	// Big box magazine: ribbed sides, base plate.
	b.prism(
		polymer,
		[
			[-2.3, -1.8],
			[-1.7, -7.5],
			[3.0, -7.8],
			[2.8, -1.8]
		],
		2.7,
		0,
		0.2
	);
	for (let i = 0; i < 3; i++) b.box(rubber, 2.76, 4.4, 0.35, 0, -4.7, -0.9 + i * 1.3, 0.06);
	b.prism(
		rubber,
		[
			[-1.9, -7.4],
			[-1.85, -8.1],
			[3.2, -8.4],
			[3.15, -7.7]
		],
		2.9,
		0,
		0.12
	);
	grip(b, polymer, 4.0, -1.8);
	guard(b, gunmetal, steel, 4.0, -1.8);
	// Stock: body, cheek rest, recoil pad, monopod stub.
	b.xsec(gunmetal, sect(2.6, -2.0, 1.2, 0.5, 0.5), 8, 16.2, 0.2);
	b.xsec(polymer, sect(2.2, 1.2, 2.2, 0.4, 0.02), 9.5, 14.6, 0.15);
	b.cbox(polymer, 3.0, 4.8, 1.3, 0, -0.6, 16.8, 0.35);
	for (const y of [0.9, -0.6, -2.1]) b.box(rubber, 2.2, 0.3, 0.1, 0, y, 17.46);
	b.rod(steel, [0, -2.0, 13.2], [0, -3.4, 13.2], 0.42, 0.42, { seg: 8 });
	// Heavy barrel with a collar and flutes.
	b.cyl(gunmetal, 1.05, 20.5, 0, BORE, -22.25, 12);
	b.cyl(steel, 1.4, 2.2, 0, BORE, -12.9, 8, 1.4, { smooth: false });
	for (let i = 0; i < 6; i++) {
		const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
		b.box(rubber, 0.26, 0.26, 15, Math.cos(a) * 1.0, BORE + Math.sin(a) * 1.0, -23, 0, 0, a);
	}
	// Two-chamber muzzle brake with side ports.
	b.cbox(gunmetal, 3.4, 2.2, 3.8, 0, BORE, -34.1, 0.3);
	for (const z of [-33.3, -34.9]) b.box(rubber, 3.46, 1.2, 0.8, 0, BORE, z);
	b.cyl(steel, 0.75, 0.4, 0, BORE, -36.1, 10);
	b.cyl(rubber, 0.5, 0.1, 0, BORE, -36.32, 8);
	scope(b, k.pal, 4.5, -3.0, 1.3, 2.4);
	// Handguard under the barrel and the bipod folded forward from it.
	b.xsec(polymer, sect(3.0, -1.6, 0.4, 0.2, 0.6), -12, -18.2, 0.18);
	b.box(gunmetal, 2.6, 0.9, 1.4, 0, -1.5, -18.6);
	for (const s of [-1, 1]) {
		b.rod(steel, [s * 0.9, -1.6, -18.8], [s * 1.2, -1.5, -28.4], 0.28, 0.28, { seg: 6 });
		b.box(rubber, 0.8, 0.6, 1.2, s * 1.2, -1.5, -28.8);
	}
	const arms = twoArms(b, k.pal, onGrip(b, k.pal, 4.0, -1.8), underForeEnd(b, k.pal, -14.8, -1.6, 1.5, 1.8));
	return finish(k, b, [0, BORE, -36.37], arms);
}

/**
 * Auto shotgun: thick barrel under a vented heat shield, gas tube and ribbed
 * handguard, a wide drum magazine under the receiver, ghost-ring sights, fixed
 * stock.
 */
function autoShotgun(k: Kit): THREE.Group {
	const { gunmetal, steel, polymer, rubber, brass } = k.pal;
	const b = new Mesher(PLACES.shotgun);
	const BORE = 0.8;
	// Receiver with a rail; charging handle in its slot on the left, ejection port on the right.
	b.xsec(gunmetal, sect(3.2, -1.7, 2.0, 0.45, 0.25), -8, 6.5, 0.16);
	rail(b, polymer, rubber, 1.4, 2.0, -7.4, 3.4);
	b.box(rubber, 0.1, 0.4, 4.6, -1.62, 0.9, -3.6);
	b.rod(steel, [-1.6, 0.9, -1.8], [-2.5, 0.9, -1.8], 0.32, 0.4, { seg: 6 });
	b.box(rubber, 0.1, 1.1, 3.0, 1.62, 0.8, -3.0);
	// Ghost-ring rear sight, front post on the barrel.
	b.box(rubber, 1.5, 0.4, 0.8, 0, 2.5, 4.6);
	for (const s of [-1, 1]) b.box(rubber, 0.36, 1.1, 0.7, s * 0.57, 3.2, 4.6);
	b.box(rubber, 1.5, 0.3, 0.7, 0, 3.75, 4.6);
	b.box(rubber, 0.3, 1.4, 0.5, 0, 2.3, -23.4);
	// Barrel, bore, muzzle ring.
	b.cyl(gunmetal, 0.95, 17.2, 0, BORE, -16.6, 12);
	b.cyl(steel, 1.15, 1.3, 0, BORE, -24.6, 8, 1.15, { smooth: false });
	b.cyl(rubber, 0.72, 0.1, 0, BORE, -25.27, 10);
	// Heat shield over the barrel, vents on its shoulders.
	b.xsec(
		polymer,
		[
			[-1.3, 0.8],
			[-1.3, 1.7],
			[-0.7, 2.3],
			[0.7, 2.3],
			[1.3, 1.7],
			[1.3, 0.8]
		],
		-8.6,
		-21,
		0.15
	);
	for (let i = 0; i < 7; i++) for (const s of [-1, 1]) b.box(steel, 0.5, 0.2, 0.9, s * 1.0, 2.05, -9.8 - i * 1.6, 0, 0, s * -0.78);
	// Gas tube and block, ribbed handguard.
	b.cyl(gunmetal, 0.62, 12.6, 0, -0.55, -14.3, 10);
	b.cbox(gunmetal, 1.6, 2.2, 1.4, 0, 0.1, -21.3, 0.15);
	b.xsec(polymer, sect(2.9, -2.0, 0.2, 0.2, 0.6), -8.4, -17.4, 0.18);
	for (let i = 0; i < 5; i++) b.box(rubber, 2.96, 1.1, 0.35, 0, -0.95, -9.8 - i * 1.5);
	// Drum magazine: feed tower, the drum across the gun, hub, spokes and rim on both faces.
	b.box(polymer, 2.2, 2.4, 3.0, 0, -2.6, -3.4);
	b.rod(gunmetal, [-1.9, -5.6, -3.4], [1.9, -5.6, -3.4], 3.4, 3.4, { seg: 14, smooth: true });
	for (const s of [-1, 1]) {
		b.rod(steel, [s * 1.85, -5.6, -3.4], [s * 2.05, -5.6, -3.4], 3.5, 3.3, { seg: 14, smooth: false });
		b.rod(steel, [s * 2.0, -5.6, -3.4], [s * 2.3, -5.6, -3.4], 0.9, 0.7, { seg: 8 });
		for (let i = 0; i < 6; i++) {
			const a = (i / 6) * Math.PI * 2;
			b.box(rubber, 0.16, 2.0, 0.42, s * 2.08, -5.6 + Math.cos(a) * 1.9, -3.4 + Math.sin(a) * 1.9, a);
		}
	}
	b.box(brass, 1.0, 0.5, 0.5, 0, -1.9, -4.2);
	grip(b, polymer, 2.8, -1.7);
	guard(b, polymer, steel, 2.8, -1.7);
	// Fixed stock with a rubber pad.
	b.prism(
		polymer,
		[
			[6.3, 1.5],
			[15.4, 1.7],
			[15.4, -3.9],
			[12.4, -3.5],
			[8.0, -1.2],
			[6.3, -1.5]
		],
		2.5,
		0,
		0.28
	);
	b.cbox(polymer, 2.8, 5.8, 0.9, 0, -1.1, 15.8, 0.3);
	for (const y of [0.7, -1.1, -2.9]) b.box(rubber, 2.0, 0.3, 0.1, 0, y, 16.26);
	const arms = twoArms(b, k.pal, onGrip(b, k.pal, 2.8, -1.7), underForeEnd(b, k.pal, -12.6, -2.0, 1.45, 2.0));
	return finish(k, b, [0, BORE, -25.32], arms);
}

// ---------------------------------------------------------------------
// Knife (survivors, hide and seek seekers)

/**
 * Combat knife in a gloved fist: grooved handle, steel guard and pommel, a
 * clip-point blade with a fuller. Held low on the right, the blade up, forward
 * and in towards the middle.
 */
function knife(k: Kit): THREE.Group {
	const { steel, polymer, rubber, gunmetal } = k.pal;
	const b = new Mesher(PLACES.knife);
	// Handle, guard, pommel.
	b.xsec(polymer, sect(1.3, -0.95, 0.95, 0.35), -2.2, 3.0, 0.12);
	b.cbox(steel, 0.7, 3.6, 0.55, 0, -0.1, -2.5, 0.12);
	b.cbox(steel, 1.5, 2.1, 0.7, 0, 0, 3.3, 0.2);
	// Blade: clip point, the bevel is its ground edge; fuller and notches on the spine.
	b.prism(
		steel,
		[
			[-2.75, 1.1],
			[-7.6, 1.1],
			[-11.0, -0.2],
			[-9.4, -1.25],
			[-2.75, -1.25]
		],
		0.4,
		0,
		0.18
	);
	b.box(gunmetal, 0.44, 0.3, 4.2, 0, 0.45, -5.4);
	for (let i = 0; i < 4; i++) b.box(rubber, 0.46, 0.22, 0.3, 0, 1.06, -3.4 - i * 0.6);
	// Fist around the handle: fingers on the edge side, the thumb closed over them.
	let wrist: V3 = [0, 0, 0];
	b.in(0, 0, 0.5, -Math.PI / 2, 0, 0, () => {
		wrist = gripHand(b, k.pal, 0.65, 0.95, 0, 'wrap', 'wrap');
	});
	// The forearm runs down and right, out of the screen, whatever the turn of the knife.
	const arms = [arm(b, k.pal, wrist, add(wrist, b.modelDir(0.3, -0.55, 0.78), 24))];
	return finish(k, b, null, arms);
}

// ---------------------------------------------------------------------
// Claws (infected)

/** Size of the claw arms in viewmodel units per model unit. */
const CLAW = 1.25;
/** Hand frame of a claw arm: palm in the XZ plane, fingers along −Z, back of the hand +Y, thumb on −X (right hand). */
const CLAW_WRIST: V3 = [0, -0.2, 0.3];
/** Cut end of the forearm, inside the torn sleeve. */
const CLAW_END: V3 = [1.5, -9, 21];

/** Rest pose of a claw arm in viewmodel space: position and turn (rad, XYZ order). */
export interface ClawPose {
	x: number;
	y: number;
	z: number;
	rx: number;
	ry: number;
	rz: number;
}

/** Direction of a finger bone: `yaw` splays it sideways, `pitch` curls it (negative: towards the palm). */
function bone(yaw: number, pitch: number): V3 {
	return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

/** One finger from its knuckle: bones with the given curl, then a curved talon (`talon` 0: none). */
function clawFinger(b: Mesher, pal: Palette, base: V3, yaw: number, pitches: readonly number[], lens: readonly number[], r: number, talon: number): void {
	const pts: V3[] = [base];
	const radii = [r];
	let p = base;
	for (let i = 0; i < pitches.length; i++) {
		p = add(p, bone(yaw, pitches[i]!), lens[i]!);
		pts.push(p);
		radii.push(r * (0.92 - i * 0.08));
	}
	b.ball(pal.skin, r * 1.12, base[0], base[1], base[2]);
	b.chain(pal.skin, pts, radii);
	if (talon <= 0) return;
	// The talon keeps curling and tapers to a point.
	const last = pitches[pitches.length - 1]!;
	const tip = radii[radii.length - 1]!;
	const mid = add(p, bone(yaw, last - 0.4), talon * 0.55);
	b.rod(pal.talon, add(p, bone(yaw, last), -0.25), mid, tip * 0.95, tip * 0.6, { seg: 5 });
	b.rod(pal.talon, mid, add(mid, bone(yaw, last - 1.05), talon * 0.45), tip * 0.6, 0.03, { seg: 5 });
}

/** Forearm, wrist and palm of a claw arm: skin with glowing veins, the sleeve torn off half-way. */
function clawArm(b: Mesher, pal: Palette): void {
	const axis = unit(add(CLAW_END, CLAW_WRIST, -1));
	const len = Math.hypot(CLAW_END[0] - CLAW_WRIST[0], CLAW_END[1] - CLAW_WRIST[1], CLAW_END[2] - CLAW_WRIST[2]);
	const side = unit(cross([0, 1, 0], axis));
	const up = cross(axis, side);
	const at = (t: number): V3 => add(CLAW_WRIST, axis, t);
	// Palm, wrist with its bone, forearm.
	b.cbox(pal.skin, 4.0, 1.5, 4.3, 0, 0, -2.25, 0.4);
	b.rod(pal.skin, [0, -0.1, -0.8], at(1.6), 1.8, 1.45, { seg: 8, squash: 0.62 });
	b.ball(pal.skin, 0.62, 1.3, 0.3, 1.0);
	b.rod(pal.skin, at(1.0), at(len * 0.5), 1.4, 1.95, { seg: 8, squash: 0.8 });
	// Sleeve from half-way, its hem torn into strips of uneven length.
	const hemAt = len * 0.42;
	b.rod(pal.tornSleeve, at(hemAt), CLAW_END, 2.25, 2.9, { seg: 8, squash: 0.85, open: true });
	const ring = (a: number, r: number, t: number): V3 => add(add(at(t), side, Math.cos(a) * r), up, Math.sin(a) * r * 0.85);
	const strips = [2.6, 1.2, 3.6, 1.7, 2.3, 3.2, 1.0, 2.6];
	for (let i = 0; i < strips.length; i++) {
		const a = (v: number) => ((i + v) / strips.length) * Math.PI * 2;
		b.flap(pal.tornSleeve, ring(a(-0.45), 2.3, hemAt + 0.3), ring(a(0.45), 2.3, hemAt + 0.3), ring(a(i % 2 ? 0.2 : -0.15), 1.85, hemAt - strips[i]!));
	}
	// Veins: along the top of the forearm, over the wrist, branching to the knuckles.
	// The forearm is a flattened tube: a vein off its centre line sits lower.
	const top = (t: number, off: number): V3 => {
		const r = 1.4 + (0.55 * (t - 1)) / (len * 0.5 - 1);
		return add(add(at(t), up, 0.8 * r * Math.sqrt(1 - (off / r) ** 2) * 0.96 + 0.03), side, off);
	};
	const vein = (pts: readonly V3[]) => {
		for (let i = 0; i + 1 < pts.length; i++) b.rod(pal.vein, pts[i]!, pts[i + 1]!, 0.17, 0.17, { seg: 4 });
	};
	const fork: V3 = [0.15, 0.84, -2.4];
	vein([top(len * 0.46, 0.35), top(len * 0.32, -0.25), top(len * 0.17, 0.3), [0.1, 0.72, -0.3], fork, [0.5, 0.86, -4.1]]);
	vein([fork, [-1.0, 0.84, -3.9]]);
	vein([top(len * 0.32, -0.25), top(len * 0.24, -1.0), top(len * 0.1, -0.9)]);
}

/** Open claw: four splayed, hooked fingers and the thumb, each ending in a talon. */
function clawOpen(b: Mesher, pal: Palette): void {
	const fingers: [x: number, yaw: number, len: number][] = [
		[-1.5, -0.3, 0.95],
		[-0.5, -0.1, 1.08],
		[0.5, 0.1, 1.0],
		[1.5, 0.32, 0.84]
	];
	for (const [x, yaw, l] of fingers) clawFinger(b, pal, [x, 0.15, -4.3], yaw, [0.25, -0.4, -1.05], [2.0 * l, 1.5 * l, 1.2 * l], 0.52, 2.7 * l);
	clawFinger(b, pal, [-1.9, -0.25, -1.3], -1.05, [-0.15, -0.55], [1.8, 1.5], 0.58, 2.3);
}

/** Fist around the handle of the throwing knife (it runs across the palm): fingers closed, the thumb over them. */
function clawFist(b: Mesher, pal: Palette): void {
	for (const x of [-1.5, -0.5, 0.5, 1.5]) clawFinger(b, pal, [x, 0.15, -4.3], 0, [-1.2, -2.7, -4.0], [2.0, 1.5, 1.1], 0.52, 0);
	const thumb: V3[] = [
		[-1.9, -0.25, -1.3],
		[-2.4, -1.0, -3.3],
		[-1.8, -1.9, -4.9]
	];
	b.ball(pal.skin, 0.65, -1.9, -0.25, -1.3);
	b.chain(pal.skin, thumb, [0.58, 0.52, 0.46]);
	b.rod(pal.talon, thumb[2]!, [-0.9, -2.3, -5.7], 0.44, 0.26, { seg: 5 });
	b.rod(pal.talon, [-0.9, -2.3, -5.7], [-0.1, -2.2, -6.2], 0.26, 0.03, { seg: 5 });
}

/**
 * Throwing knife (infected off-hand): handle along +Y at the origin, blade up,
 * cutting edge towards −Z with a bright strip so it reads against bright skies.
 */
function throwingKnife(k: Kit): THREE.Group {
	const { rubber, blade, edge } = k.pal;
	const b = new Mesher(place(0, 0, 0, CLAW * 0.78));
	b.cbox(rubber, 1.25, 4.6, 1.5, 0, 0, 0, 0.3);
	b.cbox(blade, 1.0, 0.5, 1.2, 0, -2.5, 0, 0.1);
	b.cbox(blade, 0.8, 0.5, 2.8, 0, 2.5, 0, 0.12);
	b.prism(
		blade,
		[
			[0.8, 2.7],
			[0.8, 8.4],
			[-0.1, 11.2],
			[-0.8, 9.0],
			[-0.8, 2.7]
		],
		0.36,
		0,
		0.15
	);
	b.prism(
		edge,
		[
			[-0.84, 2.9],
			[-0.84, 9.0],
			[-0.12, 11.24],
			[-0.3, 9.6],
			[-0.48, 2.9]
		],
		0.4
	);
	const g = new THREE.Group();
	b.build(g, k.geometries);
	return g;
}

/**
 * Claws: two infected arms, hands raised. The right one is an open claw (it
 * slashes); the left one is an open claw too, or a fist around the throwing
 * knife while that is held (`userData.open`, `userData.fist`, and
 * `userData.hold`: its pose with the knife).
 */
function claws(k: Kit): { group: THREE.Group; offKnife: THREE.Group } {
	const part = (mirror: boolean, fn: (b: Mesher) => void): THREE.Group => {
		const g = new THREE.Group();
		const b = new Mesher(place(0, 0, 0, CLAW));
		b.in(0, 0, 0, 0, 0, 0, () => fn(b), mirror);
		b.build(g, k.geometries);
		return g;
	};
	const end = (mirror: boolean): ArmEnd[] => [{ at: new THREE.Vector3(CLAW_END[0] * (mirror ? -1 : 1), CLAW_END[1], CLAW_END[2]).multiplyScalar(CLAW), r: 2.9 * CLAW }];
	const pose = (g: THREE.Group, p: ClawPose) => {
		g.userData.rest = p;
		g.position.set(p.x, p.y, p.z);
		g.rotation.set(p.rx, p.ry, p.rz);
	};
	const right = part(false, (b) => {
		clawArm(b, k.pal);
		clawOpen(b, k.pal);
	});
	right.userData.arms = end(false);
	pose(right, { x: 1.7, y: 0.9, z: 2, rx: 0.8, ry: 0.25, rz: -0.35 });
	const left = part(true, (b) => clawArm(b, k.pal));
	const open = part(true, (b) => clawOpen(b, k.pal));
	const fist = part(true, (b) => clawFist(b, k.pal));
	fist.visible = false;
	left.add(open, fist);
	left.userData.open = open;
	left.userData.fist = fist;
	left.userData.arms = end(true);
	// The screen centre is at x = −5 / 0.42 in viewmodel units: the left arm mirrors the right one about it.
	pose(left, { x: -25.5, y: 0.9, z: 2, rx: 0.8, ry: -0.25, rz: 0.35 });
	left.userData.hold = { x: -26.3, y: -0.7, z: 2, rx: 0.15, ry: -0.3, rz: 1.25 } satisfies ClawPose;
	// The knife lies across the palm of the fist, blade out of the thumb side.
	const off = throwingKnife(k);
	off.position.set(0.3 * CLAW, -1.35 * CLAW, -4.25 * CLAW);
	off.rotation.set(0, 0.75, -Math.PI / 2);
	off.visible = false;
	left.add(off);
	const group = new THREE.Group();
	group.add(right, left);
	group.userData.muzzle = null;
	group.userData.arms = [];
	group.userData.right = right;
	group.userData.left = left;
	return { group, offKnife: off };
}

// ---------------------------------------------------------------------
// Generated models

/** Hand meshes of a code-built model (by material name): the knife keeps its fist. */
const HAND_PARTS = new Set(['glove', 'pad', 'sleeve']);

/**
 * Fit a generated model into the group of its weapon (`Viewmodels.fit`): the
 * code-built gun is hidden; a gun gets new hands on its grip and fore-end, the
 * knife keeps its fist. `userData.generated` holds the shown part.
 */
function fitGenerated(k: Kit, g: THREE.Group, id: WeaponId, mesh: THREE.Object3D): void {
	const gen = generated(id);
	const root = SPACE[id];
	if (!gen || !root || g.userData.generated) return;
	const fp = gen.fp;
	// Turned about the muzzle so the sight line runs along the bore: aimed, it is the view axis.
	const turn = sightTurn(gen, new THREE.Quaternion());
	const T = new THREE.Vector3();
	/** Asset space to model space. */
	const at = (p: V3): V3 => {
		T.set(p[0], p[1], p[2]).applyQuaternion(turn);
		return [fp.at[0] + T.x * fp.len, fp.at[1] + T.y * fp.len, fp.at[2] + T.z * fp.len];
	};
	/** Pitch of the turn: the grip hand leans with the gun. */
	const pitch = new THREE.Euler().setFromQuaternion(turn).x;
	const part = new THREE.Group();
	part.name = 'generated';
	new THREE.Matrix4()
		.compose(new THREE.Vector3(...fp.at), turn, new THREE.Vector3(fp.len, fp.len, fp.len))
		.premultiply(root)
		.decompose(mesh.position, mesh.quaternion, mesh.scale);
	part.add(mesh);
	const b = new Mesher(root);
	let arms = g.userData.arms as ArmEnd[];
	const knife = id === 'knife';
	for (const c of g.children) if (c instanceof THREE.Mesh && !(knife && HAND_PARTS.has(c.name))) c.visible = false;
	if (!knife) {
		const grip = at(gen.grip);
		let right: V3 = [0, 0, 0];
		b.in(grip[0], grip[1], grip[2], pitch - gen.rake, 0, 0, () => {
			right = gripHand(b, k.pal, fp.grip[0], fp.grip[1], gen.rake);
		});
		if (gen.fore) {
			const f = at(gen.fore);
			arms = twoArms(b, k.pal, right, underForeEnd(b, k.pal, f[2], f[1], fp.fore[0], fp.fore[1]));
		} else arms = [arm(b, k.pal, right, PISTOL_ARM_END)];
		// The aim mark of an open optic, on its axis at the objective.
		if (gen.dot && gen.front) {
			const d = at(gen.front);
			b.box(k.pal.dot, 0.2, 0.2, 0.05, d[0], d[1], d[2]);
		}
		b.build(part, k.geometries);
	}
	g.add(part);
	g.userData.generated = part;
	const rig = new GunRig(id, mesh, fp.len);
	g.userData.rig = rig;
	// An optic on a moving part (the feed cover) takes its aim mark along.
	const cover = rig.part('cover');
	const dot = part.children.find((c) => c.name === 'dot');
	if (cover && dot) {
		g.updateWorldMatrix(true, true);
		cover.attach(dot);
	}
	g.userData.arms = arms;
	g.userData.muzzle = knife ? null : b.placed(fp.at);
	if (gen.sight && !knife) {
		g.userData.sight = b.placed(at(gen.sight));
		if (gen.front) g.userData.front = b.placed(at(gen.front));
		g.userData.aimDepth = fp.aim;
	}
}

/** Give a fitted weapon its gloved hands: the box hands are hidden, the forearm ends are the new ones. */
function fitHands(g: THREE.Group, id: WeaponId, kit: HandKit): void {
	const part = g.userData.generated as THREE.Group | undefined;
	const gen = generated(id);
	const root = SPACE[id];
	if (!part || !gen || !root || g.userData.hands || !weaponHands(id)) return;
	const rig = g.userData.rig as GunRig;
	const object = part.children[0]!;
	const fit = new THREE.Matrix4().compose(new THREE.Vector3(...gen.fp.at), sightTurn(gen, new THREE.Quaternion()), new THREE.Vector3().setScalar(gen.fp.len));
	const pair = new WeaponHandPair(kit, id, root, { rig, object, fit });
	for (const c of [...g.children, ...part.children]) if (c instanceof THREE.Mesh && HAND_PARTS.has(c.name)) c.visible = false;
	part.add(pair.space);
	g.userData.hands = pair;
	// The forearms move with the hands: where they end now.
	Object.defineProperty(g.userData, 'arms', { get: () => pair.arms(), configurable: true, enumerable: true });
}

/** Build every first-person model. The caller adds the groups to its viewmodel node and disposes the lists. */
export function buildViewmodels(): Viewmodels {
	const materials: THREE.Material[] = [];
	const geometries: THREE.BufferGeometry[] = [];
	const k: Kit = { pal: palette(materials), materials, geometries };
	const models = new Map<WeaponId, THREE.Group>();
	const c = claws(k);
	for (const [id, g] of [
		['pistol', pistol(k)],
		['smg', smg(k)],
		['lmg', lmg(k)],
		['sniper', sniper(k)],
		['barrett', heavyRifle(k)],
		['striker', autoShotgun(k)],
		['knife', knife(k)],
		['claws', c.group]
	] as const) {
		g.name = id;
		g.visible = false;
		models.set(id, g);
	}
	let kit: HandKit | null = null;
	return {
		models,
		offKnife: c.offKnife,
		materials,
		geometries,
		fit: (id, mesh) => {
			fitGenerated(k, models.get(id)!, id, mesh);
			if (kit) fitHands(models.get(id)!, id, kit);
		},
		useHands: (loaded) => {
			kit = loaded;
			for (const [id, g] of models) fitHands(g, id, loaded);
		},
		rest: (id) => {
			const u = models.get(id)?.userData;
			(u?.rig as GunRig | undefined)?.reset();
			(u?.hands as WeaponHandPair | undefined)?.rest();
		}
	};
}
