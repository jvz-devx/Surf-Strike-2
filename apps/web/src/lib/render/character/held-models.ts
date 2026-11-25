/**
 * Third-person weapon meshes (docs/characters.md): one low-poly model per
 * weapon id and the throwing knife of the infected. Each is the first-person
 * weapon (the script-built guns of tools/models/procedural, the knife of
 * render/viewmodels.ts) with far fewer parts: the same layout and the same
 * colours, built with the first-person mesh helpers
 * (render/viewmodel-mesh.ts) and merged into one geometry with vertex colours.
 *
 * A gun is built in first-person model space (bore along −Z, +X to the right)
 * and turned into grip space: origin in the fist, +X along the barrel, +Y up,
 * +Z right. `fore` and `at` of the grip (PLAYER_HOLDS) are tuned to these
 * meshes, so the left hand closes around the fore-end.
 *
 * A gun is one geometry. While its player reloads or works the bolt it is
 * drawn in parts instead (`heldParts`): the body, what is loaded into it
 * (magazine, tube, box or drum) and the part the hand works (slide, cover,
 * bolt). What each part does when is in reload.ts.
 */
import type { WeaponId } from '@surf/shared';
import * as THREE from 'three';
import { Mesher, sect, type P2 } from '../viewmodel-mesh.js';

type V3 = readonly [x: number, y: number, z: number];

/**
 * Vertex colours: the base colours of the script-built first-person guns
 * (tools/models/procedural, sRGB), the wood and brass a little lighter because
 * nothing here has their worn edges. `blade` and `edge` are the throwing
 * knife's of render/viewmodels.ts.
 */
export const HELD_COLORS = Object.freeze({
	gunmetal: 0x4f5154,
	steel: 0x808388,
	polymer: 0x2f3133,
	rubber: 0x232527,
	wood: 0x6a4024,
	pouch: 0x363a2c,
	brass: 0xa07c3a,
	silver: 0xb4bac2,
	glass: 0x1a3a5a,
	blade: 0x3c4249,
	edge: 0xf4f8ff
});
type Pal = Record<keyof typeof HELD_COLORS, THREE.MeshBasicMaterial>;
/** Bucket keys of the mesh builder: never drawn, only their colour is read. */
const PAL = Object.fromEntries(Object.entries(HELD_COLORS).map(([k, c]) => [k, new THREE.MeshBasicMaterial({ color: c, name: k })])) as Pal;

/** Turn of first-person model space into grip space: the bore (−Z) points forward (+X), the right side (+X) to the right (+Z). */
const TO_GRIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);

interface HeldModel {
	/** Model scale (units per first-person model unit). */
	s: number;
	/** Middle of the pistol grip (model space): it sits in the right hand. */
	grip: V3;
	/** Barrel end (model space). */
	muzzle: V3 | null;
	/** Extra turn in grip space after TO_GRIP (rad, XYZ order): the knife is held blade up and forward. */
	turn?: V3;
	/** The gun without `mag` and `act`, or the whole item. */
	build(b: Mesher, c: Pal): void;
	/** Magazine, tube, box or drum: goes into the left hand in a reload. */
	mag?(b: Mesher, c: Pal): void;
	/** What of it the gun hides while it is in. */
	magInner?(b: Mesher, c: Pal): void;
	/** Slide, feed cover, bolt handle or charging handle. */
	act?(b: Mesher, c: Pal): void;
	/** What of the gun `act` hides at rest. */
	actInner?(b: Mesher, c: Pal): void;
}

/** Placement of a first-person model in grip space: `grip` at the origin, scaled and turned. */
function placement(g: HeldModel): THREE.Matrix4 {
	const q = TO_GRIP.clone();
	if (g.turn) q.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...g.turn)));
	const m = new THREE.Matrix4().compose(new THREE.Vector3(), q, new THREE.Vector3(g.s, g.s, g.s));
	const p = new THREE.Vector3(...g.grip).applyMatrix4(m);
	return m.premultiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
}

const v3 = (p: THREE.Vector3): V3 => [p.x, p.y, p.z];

// ---------------------------------------------------------------------
// Guns: the first-person shapes (render/viewmodels.ts), few segments, no bevels.

/** Raked pistol grip of a long gun: its top front corner at (z, y); the hand closes around its middle, (z + 2.1, y − 2.3). */
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
		w
	);
}
const gripMiddle = (z: number, y: number): V3 => [0, y - 2.3, z + 2.1];

/** Trigger guard ahead of a grip at (z, y): the bow under the trigger. */
function guard(b: Mesher, m: THREE.Material, z: number, y: number): void {
	b.box(m, 0.8, 0.4, 3.6, 0, y - 1.6, z - 1.6);
	b.box(m, 0.8, 1.6, 0.4, 0, y - 0.8, z - 3.4);
}

/** Scope on two rings (the first-person `scope()`): tube, bells, lens, turret; `y` its axis, `z` the middle of the tube, `s` its size. */
function scope(b: Mesher, c: Pal, y: number, z: number, s: number, base: number): void {
	b.cyl(c.rubber, 0.62 * s, 7.4 * s, 0, y, z, 8);
	b.cyl(c.rubber, 0.62 * s, 1.6 * s, 0, y, z - 4.5 * s, 8, 1.05 * s);
	b.cyl(c.rubber, 1.05 * s, 2.6 * s, 0, y, z - 6.6 * s, 8);
	b.cyl(c.glass, 0.9 * s, 0.12, 0, y, z - 7.9 * s - 0.02, 8);
	b.cyl(c.rubber, 0.86 * s, 1.0 * s, 0, y, z + 4.2 * s, 8, 0.62 * s);
	b.cyl(c.rubber, 0.86 * s, 2.0 * s, 0, y, z + 5.7 * s, 8);
	b.box(c.rubber, 1.0 * s, 1.1 * s, 1.0 * s, 0, y + 0.9 * s, z - 0.4 * s);
	for (const dz of [-2.6 * s, 2.3 * s]) {
		b.cyl(c.gunmetal, 0.82 * s, 0.9, 0, y, z + dz, 8);
		b.box(c.gunmetal, 1.0, y - base, 0.9, 0, (y + base) / 2, z + dz);
	}
}

const GUNS: Record<Exclude<WeaponId, 'claws'>, HeldModel> = {
	// Slide with sights and the steel ejection port, frame with a rail, raked grip.
	pistol: {
		s: 0.95,
		grip: [0, -2.4, 2.45],
		muzzle: [0, 2.05, -8.8],
		build(b, c) {
			b.cyl(c.steel, 0.52, 0.5, 0, 2.05, -8.55, 6);
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
			b.prism(c.polymer, frame, 2.1);
			b.prism(
				c.rubber,
				[
					[1.15, -0.8],
					[2.45, -4.6],
					[4.05, -4.6],
					[2.95, -0.8]
				],
				2.26
			);
			guard(b, c.polymer, 0.3, 0.25);
		},
		mag(b, c) {
			b.box(c.rubber, 2.3, 0.55, 3.0, 0, -5.28, 3.3);
		},
		magInner(b, c) {
			b.prism(
				c.steel,
				[
					[0.75, 0],
					[2.35, -5.05],
					[4.15, -5.05],
					[2.55, 0]
				],
				1.5
			);
		},
		act(b, c) {
			b.xsec(c.gunmetal, sect(2.3, 1.0, 3.1, 0.5, 0.12), -8.4, 1.9);
			b.box(c.steel, 1.45, 0.3, 2.3, 0.3, 3.0, -2.9);
			b.box(c.rubber, 0.32, 0.4, 0.8, 0, 3.26, -7.7);
			b.box(c.rubber, 1.5, 0.45, 0.8, 0, 3.25, 1.3);
		},
		actInner(b, c) {
			b.cyl(c.steel, 0.52, 5, 0, 2.05, -5.8, 6);
		}
	},
	// Compact body with a sight rail, short shroud and muzzle nut, ribbed tube magazine under
	// the barrel (the fore-end), wire stock folded forward along the right side.
	smg: {
		s: 0.9,
		grip: gripMiddle(2.4, -1.5),
		muzzle: [0, 0.9, -13.2],
		build(b, c) {
			b.xsec(c.gunmetal, sect(2.8, -1.5, 1.9, 0.4, 0.25), -7.5, 5.6);
			b.box(c.polymer, 2.3, 0.55, 12.4, 0, 2.17, -1.0);
			b.box(c.gunmetal, 1.1, 0.4, 8.8, 0, 2.6, -1.2);
			b.box(c.rubber, 0.9, 1.3, 0.5, 0, 3.05, -6.6);
			b.box(c.rubber, 1.6, 1.1, 0.8, 0, 3.0, 4.3);
			b.cyl(c.gunmetal, 0.95, 2.6, 0, 0.9, -8.7, 8);
			b.cyl(c.rubber, 0.55, 2.2, 0, 0.9, -11, 6);
			b.cyl(c.steel, 0.8, 1.3, 0, 0.9, -12.55, 8);
			b.box(c.steel, 0.9, 0.7, 1.0, 0, -3.2, 0.3);
			grip(b, c.polymer, 2.4, -1.5);
			guard(b, c.polymer, 2.4, -1.5);
			// Folded stock: hinge, two struts, the butt plate flat on the body; end cap.
			b.box(c.gunmetal, 1.4, 1.6, 1.0, 0.9, 0.2, 5.9);
			for (const y of [1.0, -0.6]) b.rod(c.steel, [1.75, y, 5.6], [1.75, y, -4.6], 0.32, 0.32, { seg: 4, roll: Math.PI / 4 });
			b.box(c.rubber, 0.7, 3.0, 1.6, 1.9, 0.2, -5.2);
			b.box(c.polymer, 2.4, 2.6, 0.5, 0, 0.3, 5.8);
		},
		mag(b, c) {
			b.cyl(c.polymer, 1.5, 12.4, 0, -1.9, -5.4, 8);
			for (let i = 0; i < 3; i++) b.cyl(c.rubber, 1.62, 0.5, 0, -1.9, -9.6 + i * 3.1, 8);
		}
	},
	// Black receiver with a full rail and a short optic, the belt running up from the box under
	// it, vented handguard with the carry handle over it, ribbed barrel with a flash hider, stock.
	lmg: {
		s: 0.76,
		grip: gripMiddle(2.6, -1.9),
		muzzle: [0, 0.6, -27.6],
		build(b, c) {
			b.xsec(c.gunmetal, sect(3.4, -1.9, 1.8, 0.4, 0.3), -9.5, 6.5);
			b.cyl(c.gunmetal, 0.75, 16.3, 0, 0.6, -17.65, 8);
			for (let i = 0; i < 3; i++) b.cyl(c.rubber, 0.95, 0.8, 0, 0.6, -20.4 - i * 1.8, 8);
			b.cyl(c.rubber, 0.8, 2.0, 0, 0.6, -26.6, 6, 1.1);
			b.box(c.gunmetal, 1.2, 1.6, 1.4, 0, -0.1, -18.8);
			b.xsec(c.polymer, sect(2.9, -2.0, 1.7, 0.4, 0.6), -9.5, -18.2);
			for (let i = 0; i < 3; i++) for (const s of [-1, 1]) b.box(c.rubber, 0.2, 0.7, 1.6, s * 1.45, 0.7, -11.2 - i * 2.5);
			// Carry handle, folded over the handguard.
			b.box(c.rubber, 0.8, 0.8, 4.4, 0, 3.0, -12.6);
			for (const z of [-10.7, -14.5]) b.box(c.rubber, 0.7, 1.4, 0.6, 0, 2.3, z);
			grip(b, c.polymer, 2.6, -1.9);
			guard(b, c.polymer, 2.6, -1.9);
			b.prism(
				c.polymer,
				[
					[6.3, 1.4],
					[15.6, 1.6],
					[16.0, -3.6],
					[13.0, -3.2],
					[8.2, -1.0],
					[6.3, -1.6]
				],
				2.6
			);
			b.box(c.rubber, 2.9, 5.6, 0.8, 0, -1.0, 16.3);
		},
		// Ammunition box and the belt that runs up from it.
		mag(b, c) {
			b.box(c.pouch, 3.6, 5.2, 5.6, -0.9, -4.4, -3.4);
			b.box(c.rubber, 3.7, 0.4, 5.7, -0.9, -1.75, -3.4);
			for (let i = 0; i < 4; i++) {
				const t = i / 3;
				b.box(c.brass, 0.9, 0.75, 2.2, -2.25 - Math.sin(t * Math.PI) * 0.7 - t * 0.25, 1.4 - t * 2.9, -3.1);
			}
		},
		// Feed cover, hinged at its front, with the rail and the optic: a short scope on two rings.
		act(b, c) {
			b.xsec(c.gunmetal, sect(2.8, 1.8, 2.4, 0.3, 0.02), -8.8, 4.6);
			b.box(c.rubber, 1.6, 0.5, 13, 0, 2.6, -2.2);
			b.cyl(c.rubber, 0.95, 5.6, 0, 4.6, -0.6, 8);
			b.cyl(c.rubber, 1.25, 1.8, 0, 4.6, -3.6, 8);
			b.cyl(c.glass, 1.05, 0.12, 0, 4.6, -4.55, 8);
			b.cyl(c.rubber, 1.15, 1.4, 0, 4.6, 2.6, 8);
			b.box(c.rubber, 1.0, 1.0, 1.0, 0, 5.6, -0.6);
			for (const z of [-2, 1]) b.box(c.gunmetal, 1.6, 1.4, 0.9, 0, 3.4, z);
		},
		// The feed tray under the cover.
		actInner(b, c) {
			b.box(c.steel, 2.2, 0.16, 8.5, 0, 1.84, -2.8);
		}
	},
	// One-piece wooden stock with a box magazine, steel action with the bolt handle, tapered barrel, scope on two rings.
	sniper: {
		s: 0.78,
		grip: [0, -3.4, 5.15],
		muzzle: [0, 0.8, -28.6],
		build(b, c) {
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
			b.prism(c.wood, stock, 2.4);
			b.box(c.rubber, 2.5, 5.0, 0.8, 0, -1.5, 15.9);
			b.box(c.rubber, 2.44, 1.1, 1.2, 0, -0.2, -17.2);
			b.cyl(c.gunmetal, 0.95, 9.5, 0, 0.8, -1.75, 8);
			b.cyl(c.gunmetal, 0.68, 21.5, 0, 0.8, -17.25, 8, 0.46);
			b.box(c.rubber, 1.7, 1.5, 2.2, 0, 0.8, -27.5);
			b.prism(
				c.wood,
				[
					[9.3, 1.3],
					[14.8, 1.1],
					[14.8, 1.8],
					[11, 1.95],
					[9.3, 1.7]
				],
				2.1
			);
			scope(b, c, 3.0, -1.6, 1, 1.6);
			guard(b, c.steel, 2.6, -1.5);
		},
		mag(b, c) {
			b.box(c.gunmetal, 1.2, 2.0, 3.0, 0, -2.2, -3.45);
			b.box(c.polymer, 1.44, 0.4, 3.4, 0, -3.32, -3.55);
		},
		magInner(b, c) {
			b.box(c.steel, 1.1, 1.4, 2.9, 0, -0.6, -3.45);
		},
		act(b, c) {
			b.cyl(c.steel, 0.62, 1.6, 0, 0.8, 3.6, 6);
			b.rod(c.steel, [0.6, 0.8, 2.4], [2.5, 0.1, 2.7], 0.3, 0.3, { seg: 4, roll: Math.PI / 4 });
			b.box(c.steel, 1.0, 1.0, 1.0, 2.75, -0.05, 2.75);
		},
		// The bolt itself, behind the receiver while it is open.
		actInner(b, c) {
			b.cyl(c.steel, 0.55, 4, 0, 0.8, 0.9, 6);
		}
	},
	// Two-part receiver with a full rail, big box magazine, heavy barrel with a collar and a
	// two-chamber muzzle brake, high scope, handguard with the carry handle, stock with a cheek rest.
	barrett: {
		s: 0.74,
		grip: gripMiddle(4.0, -1.8),
		muzzle: [0, 0.3, -36.3],
		build(b, c) {
			b.xsec(c.gunmetal, sect(3.2, -1.8, 0.6, 0.3, 0.3), -12, 8);
			b.xsec(c.gunmetal, sect(2.8, 0.6, 2.1, 0.5, 0.02), -11.6, 6.4);
			b.box(c.polymer, 1.6, 0.4, 17.2, 0, 2.3, -2.6);
			grip(b, c.polymer, 4.0, -1.8);
			guard(b, c.gunmetal, 4.0, -1.8);
			b.xsec(c.gunmetal, sect(2.6, -2.0, 1.2, 0.5, 0.5), 8, 16.2);
			b.xsec(c.polymer, sect(2.2, 1.2, 2.2, 0.4, 0.02), 9.5, 14.6);
			b.box(c.polymer, 3.0, 4.8, 1.3, 0, -0.6, 16.8);
			b.rod(c.steel, [0, -2.0, 13.2], [0, -3.4, 13.2], 0.42, 0.42, { seg: 4 });
			b.cyl(c.gunmetal, 1.05, 20.5, 0, 0.3, -22.25, 8);
			b.cyl(c.gunmetal, 1.4, 2.2, 0, 0.3, -12.9, 8);
			b.box(c.gunmetal, 3.4, 2.2, 3.8, 0, 0.3, -34.1);
			for (const z of [-33.3, -34.9]) b.box(c.rubber, 3.46, 1.2, 0.8, 0, 0.3, z);
			b.cyl(c.steel, 0.75, 0.3, 0, 0.3, -36.15, 8);
			scope(b, c, 4.5, -3.0, 1.3, 2.4);
			b.xsec(c.polymer, sect(3.0, -1.8, 0.4, 0.2, 0.6), -8, -18.2);
			b.box(c.rubber, 0.8, 0.7, 4.4, 0, 3.5, -14.6);
			for (const z of [-12.7, -16.5]) b.box(c.rubber, 0.7, 3, 0.6, 0, 2, z);
		},
		mag(b, c) {
			b.prism(
				c.polymer,
				[
					[-2.3, -1.8],
					[-1.7, -7.5],
					[3.0, -7.8],
					[2.8, -1.8]
				],
				2.7
			);
			b.box(c.rubber, 2.9, 0.6, 5.0, 0, -7.9, 0.65, -0.06);
		},
		// Charging handle.
		act(b, c) {
			b.rod(c.steel, [1.4, 1.3, 0.2], [2.3, 1.3, 0.2], 0.35, 0.4, { seg: 4 });
		}
	},
	// Thick barrel under a vented heat shield, gas tube, ribbed handguard, the drum across the
	// gun under the receiver, ghost-ring sights, skeleton stock.
	striker: {
		s: 0.76,
		grip: gripMiddle(2.8, -1.7),
		muzzle: [0, 0.8, -25.25],
		build(b, c) {
			b.xsec(c.gunmetal, sect(3.2, -1.7, 2.0, 0.45, 0.25), -8, 6.5);
			b.box(c.polymer, 1.4, 0.4, 10.8, 0, 2.2, -2.0);
			for (const s of [-1, 1]) b.box(c.rubber, 0.4, 1.6, 0.7, s * 0.57, 3.0, 4.6);
			b.box(c.rubber, 1.5, 0.35, 0.7, 0, 3.75, 4.6);
			b.box(c.rubber, 0.4, 1.4, 0.5, 0, 2.3, -20.4);
			b.cyl(c.gunmetal, 0.95, 17.2, 0, 0.8, -16.6, 8);
			b.cyl(c.steel, 1.15, 1.3, 0, 0.8, -24.6, 8);
			b.xsec(
				c.polymer,
				[
					[-1.3, 0.8],
					[-1.3, 1.7],
					[-0.7, 2.3],
					[0.7, 2.3],
					[1.3, 1.7],
					[1.3, 0.8]
				],
				-8.6,
				-21
			);
			for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.box(c.steel, 0.5, 0.25, 1.2, s * 1.0, 2.05, -10.2 - i * 2.8, 0, 0, s * -0.78);
			b.cyl(c.gunmetal, 0.62, 12.6, 0, -0.55, -14.3, 6);
			b.box(c.gunmetal, 1.6, 2.2, 1.4, 0, 0.1, -21.3);
			b.xsec(c.polymer, sect(2.9, -2.0, 0.2, 0.2, 0.6), -8.4, -17.4);
			for (let i = 0; i < 3; i++) b.box(c.rubber, 2.96, 1.1, 0.5, 0, -0.95, -10.4 - i * 2.6);
			b.box(c.polymer, 2.2, 2.4, 3.0, 0, -2.6, -3.4);
			b.box(c.brass, 1.0, 0.5, 0.5, 0, -1.9, -4.2);
			grip(b, c.polymer, 2.8, -1.7);
			guard(b, c.polymer, 2.8, -1.7);
			b.prism(
				c.polymer,
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
				0,
				[
					[8.2, 0.6],
					[14.0, 0.8],
					[14.0, -2.2],
					[12.4, -2.1],
					[8.8, -0.3]
				]
			);
			b.box(c.polymer, 2.8, 5.8, 0.9, 0, -1.1, 15.8);
		},
		mag(b, c) {
			b.rod(c.rubber, [-1.9, -5.6, -3.4], [1.9, -5.6, -3.4], 3.4, 3.4, { seg: 10 });
			for (const s of [-1, 1]) {
				b.rod(c.polymer, [s * 1.85, -5.6, -3.4], [s * 2.1, -5.6, -3.4], 3.5, 3.3, { seg: 10 });
				b.rod(c.steel, [s * 2.0, -5.6, -3.4], [s * 2.35, -5.6, -3.4], 0.9, 0.7, { seg: 6 });
			}
		}
	},
	// Combat knife: grooved handle, steel guard and pommel, clip-point blade with a fuller;
	// held low on the right, the blade up, forward and in.
	knife: {
		s: 1.15,
		grip: [0, 0, 0.4],
		muzzle: null,
		turn: [0, 0.15, 0.95],
		build(b, c) {
			b.xsec(c.polymer, sect(1.3, -0.95, 0.95, 0.35), -2.2, 3.0);
			b.box(c.silver, 0.7, 3.6, 0.55, 0, -0.1, -2.5);
			b.box(c.silver, 1.5, 2.1, 0.7, 0, 0, 3.3);
			b.prism(
				c.silver,
				[
					[-2.75, 1.1],
					[-7.6, 1.1],
					[-11.0, -0.2],
					[-9.4, -1.25],
					[-2.75, -1.25]
				],
				0.5
			);
			b.box(c.gunmetal, 0.54, 0.3, 4.2, 0, 0.45, -5.4);
		}
	}
};

/**
 * Throwing knife (the first-person `throwingKnife()`): handle along +Y at the
 * origin, blade up, the cutting edge towards −Z with a bright strip.
 */
function throwingKnife(b: Mesher, c: Pal): void {
	b.box(c.rubber, 1.25, 4.6, 1.5, 0, 0, 0);
	b.box(c.blade, 1.0, 0.5, 1.2, 0, -2.5, 0);
	b.box(c.blade, 0.8, 0.5, 2.8, 0, 2.5, 0);
	b.prism(
		c.blade,
		[
			[0.8, 2.7],
			[0.8, 8.4],
			[-0.1, 11.2],
			[-0.8, 9.0],
			[-0.8, 2.7]
		],
		0.5
	);
	b.prism(
		c.edge,
		[
			[-0.84, 2.9],
			[-0.84, 9.0],
			[-0.12, 11.24],
			[-0.3, 9.6],
			[-0.48, 2.9]
		],
		0.56
	);
}
/** Size of the throwing knife on an avatar. */
const KNIFE_SCALE = 1.1;

/** Merge what a builder collected into one geometry with vertex colours (linear, like material colours). */
function bake(b: Mesher): THREE.BufferGeometry {
	const group = new THREE.Group();
	const parts: THREE.BufferGeometry[] = [];
	b.build(group, parts);
	let n = 0;
	for (const g of parts) n += g.getAttribute('position').count;
	const pos = new Float32Array(n * 3);
	const nor = new Float32Array(n * 3);
	const col = new Float32Array(n * 3);
	let o = 0;
	for (const mesh of group.children as THREE.Mesh[]) {
		const g = mesh.geometry;
		const color = (mesh.material as THREE.MeshBasicMaterial).color;
		pos.set((g.getAttribute('position') as THREE.BufferAttribute).array, o * 3);
		nor.set((g.getAttribute('normal') as THREE.BufferAttribute).array, o * 3);
		const k = g.getAttribute('position').count;
		for (let i = 0; i < k; i++) color.toArray(col, (o + i) * 3);
		o += k;
	}
	for (const g of parts) g.dispose();
	const out = new THREE.BufferGeometry();
	out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
	out.setAttribute('color', new THREE.BufferAttribute(col, 3));
	out.computeBoundingSphere();
	return out;
}

/** Build the merged geometry of a weapon (grip space). */
export function heldGeometry(weapon: Exclude<WeaponId, 'claws'>): THREE.BufferGeometry {
	const g = GUNS[weapon];
	const b = new Mesher(placement(g));
	g.build(b, PAL);
	g.mag?.(b, PAL);
	g.act?.(b, PAL);
	return bake(b);
}

/** A gun in parts (grip space, each where it sits on the gun). */
export interface HeldParts {
	body: THREE.BufferGeometry;
	mag: THREE.BufferGeometry;
	/** Null when no part of the gun moves. */
	act: THREE.BufferGeometry | null;
}

/** Build the parts of a gun; null for an item without a magazine. */
export function heldParts(weapon: Exclude<WeaponId, 'claws'>): HeldParts | null {
	const g = GUNS[weapon];
	if (!g.mag) return null;
	const part = (...build: (HeldModel['mag'] | undefined)[]) => {
		const b = new Mesher(placement(g));
		for (const f of build) f?.call(g, b, PAL);
		return bake(b);
	};
	return { body: part(g.build, g.actInner), mag: part(g.mag, g.magInner), act: g.act ? part(g.act) : null };
}

/** A point of a first-person model in grip space. */
export function heldPoint(weapon: Exclude<WeaponId, 'claws'>, x: number, y: number, z: number): V3 {
	return v3(new THREE.Vector3(x, y, z).applyMatrix4(placement(GUNS[weapon])));
}

/** Barrel end of a weapon in grip space; null for the knife. */
export function heldMuzzle(weapon: Exclude<WeaponId, 'claws'>): V3 | null {
	const g = GUNS[weapon];
	return g.muzzle ? v3(new THREE.Vector3(...g.muzzle).applyMatrix4(placement(g))) : null;
}

/** Build the merged geometry of the throwing knife. */
export function heldKnifeGeometry(): THREE.BufferGeometry {
	const b = new Mesher(new THREE.Matrix4().makeScale(KNIFE_SCALE, KNIFE_SCALE, KNIFE_SCALE));
	throwingKnife(b, PAL);
	return bake(b);
}

/** Triangle budgets per model (checked by the tests). */
export const HELD_BUDGET: Readonly<Record<Exclude<WeaponId, 'claws'>, number>> = Object.freeze({ pistol: 300, smg: 500, lmg: 700, sniper: 650, barrett: 700, striker: 700, knife: 150 });
export const HELD_KNIFE_BUDGET = 100;
