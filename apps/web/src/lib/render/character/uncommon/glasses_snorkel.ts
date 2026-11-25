/** Snorkel mask: a one-piece aqua diving mask with a nose pocket, a buckled rubber strap and a snorkel on the player's left. */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, superellipse, type PartBuilder, type Ring } from '../mesh-kit.js';
import { HEAD } from '../shop-items.js';

const FRAME = PAL.glassesA;
const LENS = PAL.glassesB;
const WHITE = PAL.glassesC;
const RUBBER = PAL.glassesD;

// ---------------------------------------------------------------------------
// Mask

/** Outline of the lens: angle 0 is the top, growing towards +z. A notch makes room for the nose. */
function outline(a: number, grow: number): { y: number; z: number } {
	// More points at the notch than at the brow.
	const [c, s] = superellipse(a + 0.5 * Math.sin(a), 2.5);
	const z = 3.95 * s;
	const y = 0.1 + (c > 0 ? 1.12 : 2.3) * c;
	const notch = c < 0 ? 1.4 * Math.exp(-((z / 1.15) ** 2)) : 0;
	const l = Math.hypot(z / 1.5, y - 0.1) || 1;
	// A slimmer brow, under the peaks of caps.
	return { y: y + notch + ((c > 0 ? 0.68 : 1) * grow * (y - 0.1)) / l, z: z + (grow * z) / 1.5 / l };
}

/** Front of the glass; the top leans back. */
const glass = (z: number, y: number): number => 1.72 - 0.1 * z * z - 0.06 * (y - 0.1) ** 2 - 0.32 * Math.max(0, y - 0.4) ** 2;
/** The face behind it. */
const face = (z: number): number => 4.5 * Math.max(0, 1 - (Math.abs(z) / 4.25) ** 2.35) ** 0.43 - 4.9;

/** How deep a row of the mask lies: on the face, or relative to the glass. */
interface Row {
	grow: number;
	/** Distance in front of the glass; null: against the face. */
	off: number | null;
	/** Scale of the outline (glass only). */
	k?: number;
	pal: number;
	shade?: number;
}

function buildMask(b: PartBuilder): void {
	const rows: Row[] = b.pick<Row[]>(
		[
			{ grow: 0.3, off: null, pal: RUBBER, shade: 0.7 },
			{ grow: 0.42, off: -0.95, pal: RUBBER, shade: 0.95 },
			{ grow: 0.02, off: -0.72, pal: RUBBER, shade: 0.7 },
			{ grow: 0.5, off: -0.66, pal: FRAME, shade: 0.8 },
			{ grow: 0.66, off: -0.2, pal: FRAME },
			{ grow: 0.58, off: 0.34, pal: FRAME, shade: 1.02 },
			{ grow: 0.24, off: 0.56, pal: FRAME, shade: 1.08 },
			{ grow: -0.1, off: 0.46, pal: RUBBER, shade: 0.9 },
			{ grow: -0.16, off: 0, pal: LENS, shade: 0.72 },
			{ grow: -0.36, off: 0, pal: LENS, shade: 0.95 },
			{ grow: 0, off: 0, k: 0.45, pal: LENS }
		],
		[
			{ grow: -0.15, off: null, pal: RUBBER, shade: 0.75 },
			{ grow: 0.1, off: -0.7, pal: FRAME, shade: 0.8 },
			{ grow: 0.66, off: -0.2, pal: FRAME },
			{ grow: 0.34, off: 0.5, pal: FRAME, shade: 1.05 },
			{ grow: -0.14, off: 0, pal: LENS, shade: 0.85 },
			{ grow: 0, off: 0, k: 0.45, pal: LENS }
		],
		[
			{ grow: -0.1, off: null, pal: RUBBER, shade: 0.8 },
			{ grow: 0.5, off: -0.2, pal: FRAME },
			{ grow: 0.3, off: 0.4, pal: FRAME },
			{ grow: -0.14, off: 0, pal: LENS }
		]
	);
	const seg = b.pick(36, 20, 12);
	b.loft(
		rows.map((r, i): Ring => ({ c: [i, 0, 0], f: 1, s: 1, w: HEAD, pal: r.pal, shade: r.shade })),
		{
			seg,
			u: [0, 1, 0],
			v: [0, 0, 1],
			capEnd: true,
			deform: (p, _t, a, i) => {
				const r = rows[i]!;
				const o = outline(a, r.grow);
				const k = r.k ?? 1;
				const y = 0.2 + (o.y - 0.2) * k;
				const z = o.z * k;
				p.set(r.off === null ? face(z) - 0.15 : glass(z, y) + r.off, y, z);
			},
			// The glass is deeper blue towards the bottom.
			shadeAt: (p, _a, i) => (rows[i]!.pal === LENS ? lerp(0.66, 1.1, Math.max(0, Math.min(1, (p.y + 1.7) / 3))) : 1)
		}
	);
	// Glare: slanted streaks on the glass, from the top edge down.
	const streak = (z: number, w: number, top: number, bottom: number) => {
		const n = b.pick(6, 3, 2);
		const at = (t: number, k: number) => {
			const y = lerp(top, bottom, t);
			const zz = z + k * w + (y - 0.1) * 0.62;
			return new THREE.Vector3(glass(zz, y) + b.pick(0.07, 0.12, 0.16), y, zz);
		};
		b.grid(Array.from({ length: n }, (_, i) => [0, 1].map((k) => at(i / (n - 1), k))), { w: HEAD, pal: WHITE });
	};
	streak(0.8, 1.0, 1.06, -1.3);
	if (b.lod < 2) {
		streak(2.2, 0.32, 0.9, -1.1);
		streak(-2.9, 0.42, 0.95, 0);
	}
	// Nose pocket.
	const nose: readonly (readonly number[])[] = [
		// y, middle x, front, back, side
		[-0.85, 0.8, 0.6, 1, 0.7],
		[-1.1, 0.95, 0.95, 1.3, 0.95],
		[-1.5, 1.0, 1.15, 1.45, 1.2],
		[-2.1, 0.8, 1.2, 1.3, 1.34],
		[-2.5, 0.5, 1, 1, 1.12],
		[-2.72, 0.3, 0.45, 0.45, 0.6]
	];
	b.loft(
		b.pick(nose, nose.filter((_, i) => i !== 1 && i !== 4), nose.filter((_, i) => i === 1 || i === 3 || i === 4)).map(([y, x, f, back, s]): Ring => ({ c: [x!, y!, 0], f: f!, b: back!, s: s!, n: 2.3, w: HEAD })),
		{ seg: b.pick(14, 8, 6), pal: FRAME, capEnd: true, capStart: true, shadeAt: (p) => lerp(0.75, 1.12, Math.max(0, Math.min(1, (p.y + 2.7) / 1.4))) }
	);
	if (b.lod > 0) return;
	// Finger dents on both sides of the nose and rivets on the frame.
	for (const k of [-1, 1]) {
		b.ball([1.05, -1.75, k * 1.24], [0.55, 0.48, 0.16], { w: HEAD, pal: RUBBER, seg: 8, rings: 3, rot: [0, k * -0.25, 0] });
		for (const z of [1.1, 2.6]) b.ball([glass(z, 1.5) + 0.5, 1.36 - z * z * 0.025, k * z], [0.15, 0.16, 0.16], { w: HEAD, pal: WHITE, seg: 5, rings: 3 });
	}
}

// ---------------------------------------------------------------------------
// Strap

/** Half of the strap, from the frame to the back of the head: x, y, z, half height, half thickness. */
const STRAP: readonly (readonly number[])[] = [
	[-0.5, 0.15, 4.2, 0.6, 0.26],
	[-1.9, 0.22, 4.62, 0.62, 0.3],
	[-3.6, 0.28, 5.02, 0.64, 0.34],
	[-5.4, 0.28, 5.2, 0.64, 0.36],
	[-7.2, 0.18, 5.3, 0.66, 0.45],
	[-8.95, 0, 4.75, 0.72, 0.44],
	[-10.45, -0.12, 3.5, 0.85, 0.46],
	[-11.3, -0.2, 1.8, 0.92, 0.46],
	[-11.5, -0.2, 0, 0.92, 0.46]
];

function buildStrap(b: PartBuilder): void {
	const half = b.pick(STRAP, STRAP.filter((_, i) => i % 2 === 0), STRAP.filter((_, i) => [0, 3, 5, 8].includes(i)));
	const mid = half.length - 1;
	// Left end, round the back, right end.
	const path = [...half.map((r) => [r[0]!, r[1]!, -r[2]!, r[3]!, r[4]!]), ...half.slice(0, mid).reverse()];
	const seg = b.pick(6, 4, 4);
	const dir = new THREE.Vector3();
	b.loft(
		path.map((_, i): Ring => ({ c: [0, 0, i], f: 1, s: 1, w: HEAD })),
		{
			seg,
			u: [0, 1, 0],
			v: [1, 0, 0],
			pal: RUBBER,
			capStart: true,
			capEnd: true,
			deform: (p, _t, a, i) => {
				const q = path[i]!;
				const prev = path[Math.max(0, i - 1)]!;
				const next = path[Math.min(path.length - 1, i + 1)]!;
				dir.set(next[0]! - prev[0]!, 0, next[2]! - prev[2]!).normalize();
				const [up, out] = superellipse(a + Math.PI / seg, 3.2);
				// `out` points to the head: (z, -x) of the direction.
				p.set(q[0]! + dir.z * q[4]! * out, q[1]! + q[3]! * up, q[2]! - dir.x * q[4]! * out);
			},
			shadeAt: (_p, a) => (b.lod === 0 && Math.abs(Math.cos(a + Math.PI / seg)) < 0.5 ? 1.12 : 0.9)
		}
	);
	for (const k of [-1, 1]) {
		// Lugs on the frame with a roller buckle.
		b.box([-0.55, 0.15, k * 4.35], [1.5, b.pick(1.5, 1.6, 1.7), 0.62], { w: HEAD, pal: FRAME, rot: [0, k * 0.28, 0] });
		if (b.lod > 0) continue;
		b.ball([-0.45, 0.15, k * 4.68], [0.4, 0.4, 0.14], { w: HEAD, pal: WHITE, seg: 8, rings: 4, rot: [0, k * 0.28, 0] });
		// Ridges where the strap runs through the buckle, and its slide.
		for (let i = 0; i < 3; i++) {
			const x = -1.75 - i * 0.42;
			const [, z] = sample(STRAP.map((r) => [-r[0]!, r[2]!]), -x) as [number, number];
			b.box([x, 0.22, k * (z + 0.32)], [0.16, 1.1, 0.16], { w: HEAD, pal: RUBBER, shade: 1.4, rot: [0, k * 0.22, 0] });
		}
		b.box([-7.2, 0.18, k * 5.3], [0.55, 1.65, 1], { w: HEAD, pal: FRAME, rot: [0, k * -0.2, 0] });
	}
	// Buckle at the back of the head.
	const x = -11.75;
	if (b.lod > 0) {
		b.box([x, -0.2, 0], [0.7, 2.3, 2.4], { w: HEAD, pal: FRAME });
		return;
	}
	for (const s of [-1, 1]) {
		b.box([x, -0.2 + s * 1.05, 0], [0.8, 0.42, 2.9], { w: HEAD, pal: FRAME });
		b.box([x, -0.2, s * 1.26], [0.8, 1.7, 0.42], { w: HEAD, pal: FRAME, shade: 0.94 });
	}
	b.box([x - 0.12, -0.2, 0], [0.7, 1.7, 0.36], { w: HEAD, pal: WHITE });
}

// ---------------------------------------------------------------------------
// Snorkel

/** Out of the mouth, round the left cheek and up outside the head, clear of the hats. */
const TUBE = new THREE.CatmullRomCurve3(
	[
		[-0.5, -3.45, 0],
		[0.75, -3.5, -0.35],
		[1.15, -3.85, -1.7],
		[0.55, -4.1, -3.5],
		[-0.55, -3.5, -5.05],
		[-1.35, -1.9, -6],
		[-1.8, 0.3, -6.5],
		[-2.3, 3, -6.85],
		[-2.9, 6, -7],
		[-3.3, 8.2, -7]
	].map((p) => new THREE.Vector3(...(p as [number, number, number]))),
	false,
	'centripetal'
);

/** One ring of the snorkel: place on the curve, radius, palette, shade. */
type TubeRow = readonly [number, number, number, number?];

function buildSnorkel(b: PartBuilder): void {
	const rows: TubeRow[] = [];
	if (b.lod === 0) {
		// Bite piece with its lip shield.
		rows.push([0, 0.5, RUBBER, 0.8], [0.03, 1.05, RUBBER, 0.9], [0.055, 1.05, RUBBER], [0.065, 0.6, RUBBER, 0.85], [0.1, 0.6, RUBBER]);
		// Ribbed hose of the bend.
		for (let i = 0; i < 7; i++) rows.push([0.125 + i * 0.035, 0.8, RUBBER, 1.15], [0.1425 + i * 0.035, 0.62, RUBBER, 0.75]);
		rows.push([0.375, 0.62, RUBBER], [0.38, 0.84, FRAME], [0.425, 0.84, FRAME], [0.43, 0.66, WHITE, 0.85], [0.55, 0.64, WHITE]);
		// Bands, then the splash guard.
		rows.push([0.74, 0.64, WHITE], [0.74, 0.69, RUBBER], [0.765, 0.69, RUBBER], [0.765, 0.64, WHITE]);
		rows.push([0.79, 0.64, WHITE, 0.9], [0.8, 0.98, FRAME, 0.9], [0.845, 1.04, FRAME], [0.845, 1.06, WHITE], [0.885, 1.07, WHITE], [0.885, 1.06, FRAME], [0.925, 1.05, FRAME], [0.925, 0.8, RUBBER, 0.8], [0.95, 0.8, RUBBER, 0.7], [0.95, 1.06, FRAME, 0.9], [0.975, 0.98, FRAME], [0.993, 0.66, FRAME, 1.05], [1, 0.25, FRAME, 1.08]);
	} else if (b.lod === 1) rows.push([0, 0.9, RUBBER], [0.06, 0.85, RUBBER], [0.12, 0.66, RUBBER], [0.2, 0.7, RUBBER], [0.28, 0.7, RUBBER], [0.375, 0.7, FRAME], [0.43, 0.72, WHITE], [0.55, 0.66, WHITE], [0.79, 0.66, FRAME], [0.8, 1, FRAME], [0.845, 1.06, WHITE], [0.89, 1.06, FRAME], [0.97, 1, FRAME], [1, 0.4, FRAME]);
	else rows.push([0, 0.85, RUBBER], [0.15, 0.75, RUBBER], [0.28, 0.75, RUBBER], [0.42, 0.75, WHITE], [0.78, 0.75, FRAME], [0.82, 1.15, FRAME], [1, 0.9, FRAME]);
	// Frames carried along the curve.
	const T = new THREE.Vector3();
	const N = new THREE.Vector3(0, 1, 0);
	const frames = rows.map(([t]) => {
		TUBE.getTangentAt(t, T);
		N.addScaledVector(T, -N.dot(T)).normalize();
		return { p: TUBE.getPointAt(t), n: N.clone(), k: T.clone().cross(N) };
	});
	b.loft(
		rows.map(([, , pal, shade], i): Ring => ({ c: [0, 0, i], f: 1, s: 1, w: HEAD, pal, shade })),
		{
			seg: b.pick(9, 6, 5),
			u: [1, 0, 0],
			v: [0, 1, 0],
			capStart: true,
			capEnd: true,
			deform: (p, _t, a, i) => {
				const f = frames[i]!;
				const r = rows[i]![1];
				p.copy(f.p).addScaledVector(f.n, Math.cos(a) * r).addScaledVector(f.k, Math.sin(a) * r);
			}
		}
	);
	if (b.lod === 2) return;
	// Keeper: clips the tube to the strap.
	const at = (y: number) => TUBE.points.find((p) => p.y > y)!;
	const c = at(0);
	b.box([c.x - 0.05, 0.28, -5.6], [0.95, 0.85, 1.9], { w: HEAD, pal: RUBBER, rot: [0, 0.1, 0] });
	if (b.lod > 0) return;
	b.box([c.x - 0.05, 0.28, -6.5], [1.7, 1, 1.66], { w: HEAD, pal: RUBBER, rot: [0.2, 0.1, 0], shade: 1.15 });
	// Purge valve under the bend.
	b.ball([0.7, -4.75, -3.1], [0.55, 0.4, 0.55], { w: HEAD, pal: FRAME, seg: 8, rings: 5 });
}

registerItemMesh('glasses_snorkel', {
	colors: [0xff5b2e, 0x22cfe0, 0xeefcff, 0x17324f],
	glow: [0, 0.3, 0.2, 0],
	build(b) {
		b.socket('glasses', () => {
			buildMask(b);
			buildStrap(b);
			buildSnorkel(b);
		});
	}
});
