import * as THREE from 'three';
import { headPoint } from '../body.js';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, smooth, type PartBuilder, type Ring } from '../mesh-kit.js';
import { HEAD, SIDES } from '../shop-items.js';
import { sideSign, SOCKET_DEFS } from '../skeleton.js';

const TOP_Y = 71.45;
/** Waves around the border. */
const WAVES = 8;
/** Direction in which the cloth lies off the head (as in the hair). */
const CENTRE = new THREE.Vector3(-0.35, 66.4, 0);
const KNOT: readonly [number, number, number] = [-6.75, -0.95, 0];

/** Angle from the front, 0..π. */
const fromFront = (a: number): number => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
/** Lower edge: on the forehead at the front, lower over the ears and at the back (model y). */
const edgeY = (a: number): number => {
	const t = fromFront(a) / Math.PI;
	return 68.45 - 0.9 * smooth(0.1, 0.4, t) - 0.15 * smooth(0.6, 0.95, t);
};

const dir = new THREE.Vector3();
/** Point of the cloth, in socket space, `up` (0 edge … 1 crown) at angle `a`, `out` units off the surface. */
function cloth(a: number, up: number, out: number, p: THREE.Vector3): THREE.Vector3 {
	const t = fromFront(a) / Math.PI;
	const y = lerp(edgeY(a), TOP_Y, up);
	headPoint(a, y, p);
	dir.copy(p).sub(CENTRE);
	dir.y *= 0.55;
	dir.normalize();
	// Looser at the sides and back, where the hair is.
	let off = lerp(0.45 + 0.45 * smooth(0.12, 0.3, t) + 0.3 * smooth(0.4, 0.65, t), 0.6, smooth(0, 0.5, up)) + 0.35 * smooth(0.7, 1, up);
	// Pleats: gathered at the knot, fading towards the front.
	const back = smooth(0.4, 0.65, t);
	off += pleat(a, up) * 0.26 * back;
	p.addScaledVector(dir, off + out);
	p.x -= SOCKET_DEFS.hat.pos[0];
	p.y -= SOCKET_DEFS.hat.pos[1];
	return p;
}
/** -1 … 1: ridges that fan out from the knot over the back of the head. */
function pleat(a: number, up: number): number {
	const z = Math.sin(a);
	const fan = Math.atan2(z * (1 - up * 0.55), 0.22 + up * 0.8);
	return Math.cos(fan * 13) * smooth(0.02, 0.2, up) * (1 - smooth(0.6, 0.95, up));
}

/** Rolling wave: height 0..1 of the crest line at border phase `u`, with a lean towards the crest. */
const crest = (u: number): number => {
	const f = u - Math.floor(u);
	// Slow rise, steep fall.
	return f < 0.625 ? 0.5 - 0.5 * Math.cos((f / 0.625) * Math.PI) : 0.5 + 0.5 * Math.cos(((f - 0.625) / 0.375) * Math.PI);
};

function buildCloth(b: PartBuilder): void {
	// Eight columns per wave up close; further away the border is a plain band.
	const seg = b.pick(WAVES * 8, 16, 9);
	const wave = b.lod === 0;
	const rows = b.pick(
		// [up, wave amplitude, off the surface, shade, palette of the quads above]
		[
			[0.015, 0, -1.1, 0.6, PAL.hatD],
			[-0.02, 0, 0, 0.9, PAL.hatD],
			[0.03, 0, 0.1, 1, PAL.hatD],
			[0.075, 0, 0.1, 1, PAL.hatB],
			[0.1, 0.22, 0.05, 1, PAL.hatC],
			[0.17, 0.25, 0.04, 1, PAL.hatA],
			[0.36, 0.12, 0, 1, PAL.hatA],
			[0.54, 0.03, 0, 1, PAL.hatA],
			[0.63, 0, 0, 1, PAL.hatA],
			[0.8, 0, 0, 1.02, PAL.hatA],
			[0.95, 0, 0, 1.03, PAL.hatA],
			[1, 0, 0.05, 1.04, PAL.hatA]
		],
		[
			[0.015, 0, -1.1, 0.6, PAL.hatD],
			[0, 0, 0.1, 0.95, PAL.hatD],
			[0.07, 0, 0.1, 1, PAL.hatB],
			[0.24, 0, 0.05, 1, PAL.hatC],
			[0.33, 0, 0, 1, PAL.hatA],
			[0.63, 0, 0, 1, PAL.hatA],
			[0.9, 0, 0, 1.02, PAL.hatA],
			[1, 0, 0.1, 1.04, PAL.hatA]
		],
		[
			[0, 0, 0.1, 0.95, PAL.hatB],
			[0.28, 0, 0.05, 1, PAL.hatA],
			[0.75, 0, 0.15, 1, PAL.hatA],
			[1, 0, 0.25, 1.04, PAL.hatA]
		]
	) as readonly (readonly [number, number, number, number, number])[];
	const rings: Ring[] = rows.map(([, , , shade, pal], i) => ({ c: [0, i * 0.4, 0], f: 1, s: 1, w: HEAD, pal, shade }));
	b.loft(rings, {
		seg,
		capEnd: true,
		deform(p, _t, a, i) {
			const [up, amp, out] = rows[i]!;
			const k = wave ? crest((a / (Math.PI * 2)) * WAVES) : 0.5;
			// Crests lean over the next trough.
			const lean = wave ? a + ((k * amp) / 0.25) * 0.16 : a;
			cloth(lean, up + amp * k, out, p);
			if (i === rows.length - 1) {
				// Close the crown in a low dome.
				p.x = lerp(p.x, -0.15, 0.45);
				p.y += 0.18;
				p.z *= 0.55;
			}
		},
		shadeAt(_p, a, i) {
			const up = rows[i]![0];
			const back = smooth(0.4, 0.65, fromFront(a) / Math.PI);
			return 1 + pleat(a, up) * 0.28 * back;
		}
	});
}

registerItemMesh('hat_bandana', {
	hides: ['hair'],
	colors: [0x24407c, 0x2fa8ad, 0xf4ecd8, 0x182a55],
	build(b) {
		b.socket('hat', () => {
			buildCloth(b);
			if (b.lod === 0) {
				// Printed motif: small diamonds in two staggered rows; the pleated back stays plain.
				const q = new THREE.Vector3();
				const at = (a: number, up: number) => cloth(a, up, 0.08, q).clone();
				for (const [up, n, shift] of [
					[0.56, 11, 0.5],
					[0.76, 8, 0.25]
				] as const)
					for (let i = 0; i < n; i++) {
						const a = ((i + shift) / n) * Math.PI * 2;
						if (fromFront(a) > 1.95) continue;
						const w = up > 0.7 ? 0.09 : 0.06;
						const h = 0.06;
						b.grid(
							[
								[at(a, up + h), at(a, up + h)],
								[at(a - w, up), at(a + w, up)],
								[at(a, up - h), at(a, up - h)]
							],
							{ w: HEAD, pal: PAL.hatC }
						);
					}
			}
			const [kx, ky] = KNOT;
			for (const s of SIDES) {
				const z = sideSign(s);
				// The corners, twisted together on their way to the knot.
				if (b.lod < 2) {
					const start = cloth(Math.PI - z * 0.85, 0.12, -0.15, new THREE.Vector3());
					const mid = cloth(Math.PI - z * 0.4, 0.1, 0.25, new THREE.Vector3());
					b.loft(
						[
							{ c: [start.x, start.y, start.z], f: 0.25, s: 0.5, w: HEAD },
							{ c: [mid.x, mid.y, mid.z], f: 0.5, s: 0.65, w: HEAD, shade: 0.95 },
							{ c: [kx + 0.2, ky, z * 0.3], f: 0.5, s: 0.6, w: HEAD, shade: 0.82 }
						],
						{ seg: b.pick(8, 5, 4), u: [1, 0, 0], v: [0, 1, 0], pal: PAL.hatD, capStart: true }
					);
				}
				buildTail(b, z);
			}
			// Knot: a band of cloth around the two ends.
			b.ball([kx, ky, 0], [0.75, 0.95, 0.9], { w: HEAD, pal: PAL.hatA, seg: b.pick(10, 6, 4), rings: b.pick(7, 4, 3), rot: [0.25, 0, 0] });
			if (b.lod === 0) b.ball([kx - 0.25, ky, 0], [0.62, 1.12, 0.42], { w: HEAD, pal: PAL.hatD, seg: 8, rings: 6, rot: [0.3, 0, 0] });
		});
	}
});

/** A hanging end: narrow at the knot, wider and cut to a point at the tip, with a coloured border. */
function buildTail(b: PartBuilder, z: number): void {
	const [kx, ky] = KNOT;
	const long = z > 0 ? 1 : 0.86;
	// [x, y, z, half width]
	const path: readonly (readonly [number, number, number, number])[] = [
		[kx - 0.1, ky - 0.2, 0.35, 0.4],
		[kx - 0.75, ky - 1.2 * long, 1.15, 0.75],
		[kx - 0.75, ky - 2.6 * long, 1.75, 1.05],
		[kx - 0.5, ky - 4.0 * long, 2.15, 1.2],
		[kx - 0.35, ky - 4.9 * long, 2.35, 1.1],
		[kx - 0.35, ky - 5.9 * long, 2.75, 0.12]
	];
	const used = b.lod === 0 ? path : [path[0]!, path[2]!, path[4]!, path[5]!];
	b.loft(
		used.map(([x, y, zz, w], i) => ({ c: [x, y, z * zz], f: 0.13, s: w, w: HEAD, n: 2, shade: lerp(0.8, 1, smooth(0, 2, i)) })),
		{
			seg: b.pick(8, 6, 4),
			pal: PAL.hatA,
			capStart: true,
			capEnd: true,
			deform: (p, t, a) => {
				// A soft fold along the length.
				p.x += Math.cos(Math.asin(Math.max(-1, Math.min(1, Math.sin(a)))) * 2) * -0.28 * Math.sin(t * Math.PI);
			},
			palAt: (i) => (i >= used.length - 2 ? PAL.hatB : b.lod === 0 && i === used.length - 3 ? PAL.hatC : PAL.hatA)
		}
	);
}
