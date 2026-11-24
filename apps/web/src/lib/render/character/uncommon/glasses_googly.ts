/** Googly eye glasses: two huge domed craft eyes in round red frames; the pupils roll in different directions. */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { PAL, type PartBuilder, type Ring } from '../mesh-kit.js';
import { HEAD } from '../shop-items.js';

const FRAME = PAL.glassesA;
const WHITE = PAL.glassesB;
const BLACK = PAL.glassesC;
const CUP = PAL.glassesD;

/** Eye: distance from the middle, height of the centre, radius, how far the dome bulges. */
interface Eye {
	z: number;
	y: number;
	r: number;
	bulge: number;
	/** Where the pupil rolled to: direction (0 = outwards, π/2 = up) and distance (radians from the middle). */
	roll: number;
	away: number;
}
/** The player's right eye is a bit bigger. */
const EYES: readonly Eye[] = [
	{ z: 2.24, y: -0.56, r: 2.04, bulge: 1.95, roll: -2.25, away: 0.62 },
	{ z: -2.14, y: -0.48, r: 1.92, bulge: 1.85, roll: 0.95, away: 0.66 }
];
/** Back of the eyes, in front of the brows. */
const BASE_X = 0.3;
/** The eyes turn outwards a little, round the face. */
const TURN = 0.16;

function buildEye(b: PartBuilder, e: Eye): void {
	const k = Math.sign(e.z);
	const rot = new THREE.Euler(0, -k * TURN, 0);
	const place = (p: THREE.Vector3) => p.applyEuler(rot).add(new THREE.Vector3(BASE_X, e.y, e.z));
	/** Rings round the eye's axis: [forward, radius, palette, shade]. */
	const round = (rows: readonly (readonly [number, number, number, number])[], seg: number, capEnd = false, capStart = false) =>
		b.loft(
			rows.map(([x, r, pal, shade]): Ring => ({ c: [x, 0, 0], f: r, s: r, w: HEAD, pal, shade })),
			{ seg, u: [0, 1, 0], v: [0, 0, 1], capEnd, capStart, deform: (p) => void place(p) }
		);
	/** Round patch lying on the dome: direction, size, height above it. */
	const spot = (roll: number, away: number, size: number, off: number, pal: number, seg: number, rows: readonly number[]) => {
		// Axis of the patch on the unit dome.
		const axis = new THREE.Vector3(Math.cos(away), Math.sin(away) * Math.sin(roll), k * Math.sin(away) * Math.cos(roll));
		const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis);
		b.loft(
			rows.map((t): Ring => ({ c: [1 - t, 0, 0], f: 1, s: 1, w: HEAD, pal })),
			{
				seg,
				u: [0, 1, 0],
				v: [0, 0, 1],
				capEnd: true,
				deform: (p, _t, a, i) => {
					const t = rows[i]! * size;
					p.set(Math.cos(t), Math.sin(t) * Math.cos(a), Math.sin(t) * Math.sin(a)).applyQuaternion(q);
					const o = 1 + (i === 0 && rows.length > 1 ? -0.04 : off);
					p.set(DOME_X + p.x * e.bulge * o, p.y * (e.r - 0.2) * o, p.z * (e.r - 0.2) * o);
					place(p);
				}
			}
		);
	};
	const DOME_X = 0.35;
	const seg = b.pick(24, 12, 8);
	// Frame: a fat ring with a lip, and the plastic cup of the eye.
	round(
		b.pick(
			[[-0.45, e.r - 0.5, FRAME, 0.6], [-0.45, e.r + 0.05, FRAME, 0.75], [-0.1, e.r + 0.3, FRAME, 0.95], [0.35, e.r + 0.32, FRAME, 1], [0.62, e.r + 0.14, FRAME, 1.1], [0.62, e.r - 0.08, FRAME, 1.1], [0.4, e.r - 0.2, CUP, 0.85]],
			[[-0.4, e.r - 0.3, FRAME, 0.7], [-0.1, e.r + 0.28, FRAME, 0.95], [0.6, e.r + 0.2, FRAME, 1], [0.45, e.r - 0.2, FRAME, 0.8]],
			[[-0.4, e.r, FRAME, 0.8], [0.5, e.r + 0.25, FRAME, 1], [0.5, e.r - 0.2, FRAME, 1]]
		),
		seg,
		false,
		true
	);
	// Dome.
	const n = b.pick(7, 4, 3);
	round(
		Array.from({ length: n }, (_, i): readonly [number, number, number, number] => {
			const t = (i / n) * (Math.PI / 2);
			return [DOME_X + Math.sin(t) * e.bulge, Math.cos(t) * (e.r - 0.2), i === 0 && b.lod === 0 ? CUP : WHITE, i === 0 ? 0.85 : 1];
		}),
		seg,
		true
	);
	// Loose pupil, pressed against the side it rolled to, with a glint.
	if (b.lod === 2) spot(e.roll, e.away, 0.68, 0.16, BLACK, 7, [1, 0.5]);
	else spot(e.roll, e.away, 0.62, b.pick(0.045, 0.1, 0.1), BLACK, b.pick(20, 10, 6), b.pick([1, 0.96, 0.66, 0.33], [1, 0.95, 0.5], [1]));
	if (b.lod > 1) return;
	const gx = Math.cos(e.roll) * Math.sin(e.away) * k + 0.17;
	const gy = Math.sin(e.roll) * Math.sin(e.away) + 0.22;
	const at = (z: number, y: number): readonly [number, number] => [Math.atan2(y, z * k), Math.asin(Math.min(0.98, Math.hypot(z, y)))];
	spot(...at(gx, gy), 0.16, b.pick(0.085, 0.15, 0.2), WHITE, b.pick(10, 5, 4), [1]);
	if (b.lod === 0) spot(...at(gx - 0.4, gy - 0.36), 0.08, 0.085, WHITE, 7, [1]);
}

registerItemMesh('glasses_googly', {
	colors: [0xe8392c, 0xfdfdfa, 0x121316, 0xb9c6cf],
	glow: [0, 0.35, 0, 0],
	build(b) {
		b.socket('glasses', () => {
			for (const e of EYES) {
				buildEye(b, e);
				// Arm with a hinge block, down behind the ear.
				const k = Math.sign(e.z);
				const arm: readonly (readonly [number, number, number, number, number])[] = [
					[0.15, 0.15, 4.0, 0.5, 0.2],
					[-0.8, 0.2, 4.45, 0.42, 0.18],
					[-4.4, 0.2, 4.75, 0.36, 0.17],
					[-5.8, 0, 4.7, 0.4, 0.17],
					[-7, -0.9, 4.6, 0.42, 0.15]
				];
				b.loft(
					b.pick(arm, arm.filter((_, i) => i !== 1), [arm[0]!, arm[3]!]).map(([x, y, z, f, s]): Ring => ({ c: [x, y, k * z], f, s, n: 3, w: HEAD })),
					{ seg: b.pick(8, 4, 4), u: [0, 1, 0], v: [0, 0, 1], pal: FRAME, capStart: true, capEnd: true }
				);
				if (b.lod === 0) b.box([-0.25, 0.2, k * 4.25], [0.7, 1.1, 0.5], { w: HEAD, pal: CUP, shade: 0.9 });
			}
			// Thick bridge over the nose.
			b.loft(
				[-0.9, -0.45, 0.45, 0.9].map((z): Ring => ({ c: [0.45, 0.55 - z * z * 0.25, z], f: 0.36, s: 0.34, w: HEAD })),
				{ seg: b.pick(8, 4, 4), u: [1, 0, 0], v: [0, 1, 0], pal: FRAME, capStart: true, capEnd: true }
			);
		});
	}
});
