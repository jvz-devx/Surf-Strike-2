/** Skeleton hoodie: black zip-up with a bone-white rib cage, spine and arm bones, and a skull on the hood. */
import * as THREE from 'three';
import { alongArm, armSide, armWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, superellipse, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { TORSO_TABLE, torsoRings, torsoWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import { sideSign, type Side } from '../skeleton.js';

const CLOTH = PAL.topA;
const BONE = PAL.topB;
const RIB = PAL.topC;
const METAL = PAL.topD;

const EASE = 0.5;
/** Top of the waistband. */
const BAND = 38.8;
const TOP = 57.2;
const NECK = 58.5;

/** Fit of the body: tight waistband, the cloth blouses over it, chest and shoulder blades. */
function shape(p: THREE.Vector3, round: boolean): void {
	const band = 0.955 + 0.045 * smooth(BAND - 0.05, BAND + 1, p.y);
	const over = 1 + 0.035 * smooth(BAND, 40.2, p.y) * (1 - smooth(41, 45, p.y));
	p.x *= lerp(band, 1, 0.5) * over;
	p.z *= band * over;
	if (!round) return;
	if (p.x > 0) p.x += 0.35 * Math.exp(-(((p.y - 51.5) / 2.2) ** 2) - ((Math.abs(p.z) - 3.6) / 2.4) ** 2);
	else p.x -= 0.3 * Math.exp(-(((p.y - 52.5) / 2.4) ** 2) - ((Math.abs(p.z) - 4.4) / 2.2) ** 2);
}

/** Point on the body; `a` is 0 in front, π/2 at the right. */
function onBody(b: PartBuilder, a: number, y: number, off: number): THREE.Vector3 {
	const r = sample(TORSO_TABLE, y);
	const [c, s] = superellipse(a, 2.35);
	const e = EASE + off + b.pick(0, 0.28, 0.7);
	const p = new THREE.Vector3((c >= 0 ? r[1]! + e : -r[2]! + e) * c, y, (r[3]! + e) * s);
	shape(p, b.lod === 0);
	return p;
}

/** Angle of the front point `z` to the side. */
function angleAt(y: number, z: number): number {
	const w = sample(TORSO_TABLE, y)[3]! + EASE;
	return Math.sign(z) * Math.asin(Math.min(1, (Math.abs(z) / w) ** (2.35 / 2)));
}

interface Node {
	p: THREE.Vector3;
	/** Outward direction. */
	n: THREE.Vector3;
	/** Half width. */
	r: number;
	w: Weights;
}

/** Flat printed bone along a path: two edges in the cloth and a raised middle. */
function bonePrint(b: PartBuilder, path: readonly Node[], raise: number): void {
	b.loft(
		path.map((q, i): Ring => ({ c: [0, i, 0], f: 1, s: 1, w: q.w })),
		{
			seg: 3,
			pal: BONE,
			deform: (p, _t, a, i) => {
				const q = path[i]!;
				const dir = path[Math.min(i + 1, path.length - 1)]!.p.clone().sub(path[Math.max(i - 1, 0)]!.p).normalize();
				const side = q.n.clone().cross(dir).normalize();
				const j = Math.round(a / ((Math.PI * 2) / 3));
				p.copy(q.p);
				if (j === 0) p.addScaledVector(q.n, raise);
				else p.addScaledVector(side, (j === 1 ? -1 : 1) * q.r).addScaledVector(q.n, -0.06);
			}
		}
	);
}

function bodyNode(b: PartBuilder, a: number, y: number, r: number): Node {
	const p = onBody(b, a, y, 0.24);
	const n = onBody(b, a, y, 1.24).sub(p).setY(0).normalize();
	return { p, n, r, w: torsoWeights(p.y, p.z) };
}

function buildBody(b: PartBuilder): void {
	const ys = b.pick([BAND, 39.8, 41.6, 44.5, 48, 50.5, 53.2, 55.2, 56.4, TOP], [BAND, 42, 47, 52, 55.5, TOP], [BAND, 44, 51, 55.5, TOP]);
	const all = torsoRings(36.5, ys, b.lod === 2 ? EASE + 0.25 : EASE);
	const rings = b.lod === 0 ? all.slice(2) : all;
	if (b.lod === 0) {
		const n = 24;
		b.loft([all[0]!, all[1]!, { ...all[2]!, c: [0, BAND + 0.15, 0], shade: 0.85 }], {
			seg: n,
			pal: RIB,
			weightAt: (p) => torsoWeights(p.y, p.z),
			deform: (p) => shape(p, true),
			shadeAt: (_p, a) => (Math.round((a / (Math.PI * 2)) * n) % 2 ? 1.2 : 0.74)
		});
	}
	b.loft(rings, {
		seg: b.pick(20, 11, 8),
		pal: CLOTH,
		capEnd: true,
		weightAt: (p) => torsoWeights(p.y, p.z),
		deform: (p) => shape(p, b.lod === 0),
		palAt: (i) => (rings[i + 1]!.c[1] <= BAND ? RIB : CLOTH),
		shadeAt: (p) => lerp(0.86, 1, smooth(37, 44, p.y)) * (Math.abs(p.z) > 6.8 && p.y > 46 && p.y < 54 ? 0.9 : 1)
	});
}

const SLEEVE: readonly (readonly number[])[] = [
	// t, radius along X, radius sideways
	[-3.6, 1.5, 1.4],
	[-2.6, 2.9, 2.5],
	[-1.2, 3.5, 3.0],
	[0.6, 3.8, 3.35],
	[3, 3.75, 3.35],
	[7.5, 3.5, 3.15],
	[11, 3.2, 3.0],
	[14, 3.2, 3.0],
	[16.5, 3.0, 2.8],
	[17.8, 2.9, 2.7],
	[18.6, 2.25, 2.05]
];
const CUFF = 18.6;
const END = 20.9;

function buildSkeletonSleeve(b: PartBuilder, s: Side): void {
	const ring = (t: number, d = 0, pal: number = CLOTH, shade = 1): Ring => {
		const r = sample(SLEEVE, t);
		return { c: alongArm(s, t), f: r[1]! + d, s: r[2]! + d, w: armWeights(s, t), pal, shade };
	};
	const ts = b.pick([-3.6, -2.4, -0.8, 1.4, 5, 8.6, 11, 13.2, 16, 17.8, CUFF], [-3.4, -1.2, 2, 8.4, 11.2, 15, CUFF], [-3, 2, 9.5, 14, CUFF]);
	const cuff = [ring(CUFF, -0.02, RIB), ring(END, -0.15, RIB), ring(END, -0.6, RIB, 0.6)];
	if (b.lod === 0) b.loft(cuff, { seg: 12, v: armSide(s), shadeAt: (_p, a) => (Math.round((a / (Math.PI * 2)) * 12) % 2 ? 1.18 : 0.76) });
	b.loft([...ts.map((t) => ring(t)), ...(b.lod === 0 ? [] : cuff.slice(0, 2))], {
		seg: b.pick(10, 6, 5),
		v: armSide(s),
		pal: CLOTH,
		capStart: true,
		capEnd: b.lod > 0,
		shadeAt: (p) => lerp(0.86, 1, smooth(0, 3, Math.abs(p.z) - 7))
	});
	// Arm bones, on the front and on the back of the sleeve.
	const v = armSide(s);
	const node = (t: number, a: number, r: number): Node => {
		const q = sample(SLEEVE, t);
		const c = alongArm(s, t);
		const n = new THREE.Vector3(Math.cos(a), v[1] * Math.sin(a), v[2] * Math.sin(a));
		const off = b.pick(0.08, 0.16, 0.25);
		return { p: new THREE.Vector3(c[0] + n.x * (q[1]! + off), c[1] + n.y * (q[2]! + off), c[2] + n.z * (q[2]! + off)), n, r, w: armWeights(s, t) };
	};
	for (const [base, dir] of [[0.7, 1], [2.5, -1]] as const) {
		const strip = (rows: readonly (readonly [number, number, number])[]) => bonePrint(b, rows.map(([t, da, r]) => node(t, base + dir * da, r)), 0.16);
		if (b.lod === 2) {
			if (dir > 0) strip([[2, 0, 0.8], [9, 0, 0.8]]);
			if (dir > 0) strip([[12, 0, 0.8], [17.5, 0, 0.8]]);
			continue;
		}
		// Humerus with knobbed ends, then radius and ulna.
		strip(b.pick([[1.2, 0, 0.45], [2.2, 0, 1], [3.6, 0, 0.5], [7.4, 0, 0.5], [9.1, 0, 0.95], [9.8, 0, 0.4]], [[1.6, 0, 0.9], [5.6, 0, 0.6], [9.6, 0, 0.9]], []));
		for (const k of b.pick([-1, 1], [0], [])) strip(b.pick([[11.4, k * 0.2, 0.5], [13, k * 0.23, 0.36], [15.6, k * 0.23, 0.34], [17.6, k * 0.2, 0.48]], [[11.6, 0, 0.8], [17.6, 0, 0.75]], []));
	}
}

/** Ribs: height at the breastbone, where they start (angle), half width. */
const RIBS: readonly (readonly [number, number, number])[] = [[53.3, 0.3, 0.5], [51.2, 0.3, 0.55], [49.1, 0.3, 0.55], [47, 0.3, 0.52], [45, 0.62, 0.48]];

function buildCage(b: PartBuilder): void {
	const top = (a: number, y0: number) => y0 - 1.5 * smooth(0.25, 1.1, a) + 2.4 * smooth(1.2, 2.7, a);
	const ribs = b.pick(RIBS, [RIBS[0]!, RIBS[1]!, RIBS[2]!, RIBS[3]!], [RIBS[0]!, RIBS[2]!, RIBS[3]!]);
	ribs.forEach(([y0, a0, r], i) => {
		const grow = b.pick(1, 1.15, 1.5);
		for (const k of [1, -1]) {
			// The upper ribs end below the arm, the lower ones run on to the spine under the hood.
			const end = y0 > 50 ? 1.75 : b.lod === 2 ? 1.5 : 2.95;
			const n = b.pick(y0 > 50 ? 6 : 10, y0 > 50 ? 3 : 4, 2);
			const path = Array.from({ length: n }, (_, j) => {
				const t = j / (n - 1);
				const a = lerp(a0, end, t);
				return bodyNode(b, k * a, top(a, y0), r * grow * (b.lod < 2 && (t === 0 || t === 1) ? (i === 4 ? 0.3 : 0.75) : 1));
			});
			bonePrint(b, path, 0.14);
		}
	});
	for (const k of [1, -1]) {
		// Breastbone halves beside the zip.
		const sternum = b.pick([[54.4, 1.0, 0.35], [53.6, 1.15, 0.62], [51.6, 1.05, 0.5], [48.4, 1.0, 0.46], [46.8, 0.85, 0.18]], [[54.2, 1.1, 0.6], [46.8, 0.9, 0.4]], [[54, 0.9, 0.8], [46.8, 0.9, 0.7]]);
		bonePrint(b, sternum.map(([y, z, r]) => bodyNode(b, k * angleAt(y!, z!), y!, r!)), 0.18);
		if (b.lod > 0) continue;
		// Collar bone.
		const clav = [[54.6, 1.5, 0.3], [55, 2.8, 0.45], [55.1, 4.4, 0.4], [55.5, 6, 0.55]];
		bonePrint(b, clav.map(([y, z, r]) => bodyNode(b, k * angleAt(y!, z!), y!, r!)), 0.2);
		// Hip bone above the waistband.
		const hip = [[39.9, 1.6, 0.3], [40.2, 2.9, 0.6], [41, 4.6, 0.75], [42.2, 6.1, 0.4]];
		bonePrint(b, hip.map(([y, z, r]) => bodyNode(b, k * angleAt(y!, z!), y!, r!)), 0.2);
	}
	// Spine: vertebrae beside the zip in front and down the back.
	if (b.lod === 2) return;
	const vert = (a0: number, y: number, half: number, r: number) =>
		b.grid(
			[0.75, 1.15, 0.75].map((k, i) => [1, -1].map((e) => onBody(b, a0 + (i - 1) * half, y + e * r * k, 0.24))),
			{ w: torsoWeights(y), pal: BONE, flip: true }
		);
	const ys = b.pick([45.4, 43.9, 42.4, 40.9], [44.2, 41.6], []);
	for (const y of ys) for (const k of [1, -1]) vert(k * 0.17, y, 0.1, 0.5 * b.pick(1, 1.3, 1));
	for (const y of b.pick([39.8, 41.3, 42.8, 44.3, 45.8, 47.3], [40.4, 43, 45.8], [])) vert(Math.PI, y, 0.16, 0.52 * b.pick(1, 1.4, 1));
}

/** Hood outline in front, at the side and behind: distance from the middle, height. */
const HOOD: readonly (readonly (readonly [number, number])[])[] = [
	[[4.5, 55.5], [4.55, 56.4], [4.3, 57.3], [3.85, 57.9], [3.4, 58.1], [2.9, 57.8], [2.4, 57.4], [1.7, 57.3]],
	[[6.9, 56.2], [6.9, 57.5], [6.3, 58.6], [5.4, 59.15], [4.6, 59.2], [3.8, 58.8], [3.1, 58.8], [2.4, 58.6]],
	[[4.9, 48.8], [7.1, 50.2], [8.3, 53.6], [8, 56.5], [7.1, 57.6], [5.6, 57], [4.1, 58.1], [2.7, 58.6]]
];

function onHood(row: number, a: number, off = 0): THREE.Vector3 {
	const t = HOOD.map((h) => sample(h.map((q, i) => [i, ...q]), row));
	const c = Math.cos(a);
	const end = c > 0 ? t[0]! : t[2]!;
	return new THREE.Vector3(c * (end[1]! + off), lerp(t[1]![2]!, end[2]!, Math.abs(c) ** 1.6), Math.sin(a) * (t[1]![1]! + off));
}

function buildHood(b: PartBuilder): void {
	const rows = b.pick([0, 1, 2, 3, 4, 5, 6, 7], [0, 1, 2, 4, 6], [0, 2, 4, 6]);
	b.loft(
		rows.map((r): Ring => ({ c: [0, r, 0], f: 1, s: 1, w: torsoWeights(NECK), pal: r >= 4 ? RIB : CLOTH })),
		{
			seg: b.pick(18, 9, 8),
			deform: (p, _t, a, i) => void p.copy(onHood(rows[i]!, a)),
			weightAt: (p) => torsoWeights(Math.min(p.y, NECK), p.z),
			shadeAt: (p, _a, i) => {
				const r = rows[i]!;
				return r >= 5 ? lerp(1, 0.72, (r - 4) / 3) : (r === 0 ? 0.75 : 1) * (p.x < -3 && p.y < 52 ? 0.85 : 1);
			}
		}
	);
	// Skull on the back of the hood: patches of [angle, row] round a centre.
	const patch = (seg: number, at: (t: number, k: number) => readonly [number, number], off: number, pal: number) =>
		b.loft(
			[[1, -0.15], [1, off], [0.55, off]].map(([k, o]): Ring => ({ c: [k!, o!, 0], f: 1, s: 1, w: torsoWeights(53) })),
			{
				seg,
				pal,
				capEnd: true,
				deform: (p, _t, a, i) => {
					const [da, row] = at(a, i === 2 ? 0.55 : 1);
					p.copy(onHood(row, Math.PI + da, i === 0 ? -0.15 : off));
				},
				weightAt: (p) => torsoWeights(Math.min(p.y, NECK), p.z)
			}
		);
	if (b.lod === 2) return;
	const round = (z: number, y: number, rz: number, ry: number) => (t: number, k: number) => [z + Math.cos(t) * rz * k, y + Math.sin(t) * ry * k] as const;
	// Cranium, wider at the top, with a jaw.
	patch(
		b.pick(16, 7, 6),
		(t, k) => {
			const s = Math.sin(t);
			return [Math.cos(t) * k * lerp(0.4, 0.62, smooth(-0.5, 0.3, s)), 1.95 + s * k * 1.15] as const;
		},
		0.12,
		BONE
	);
	for (const z of [-1, 1]) patch(b.pick(8, 4, 4), round(z * 0.26, 2.1, 0.17, 0.36), 0.26, CLOTH);
	if (b.lod > 0) return;
	patch(3, (t, k) => [Math.cos(t + Math.PI / 2) * 0.08 * k, 1.58 + Math.sin(t + Math.PI / 2) * 0.14 * k], 0.28, CLOTH);
	for (let i = -1; i <= 1; i++) patch(4, (t, k) => [i * 0.14 + Math.cos(t) * 0.028 * k, 1.08 + Math.sin(t) * 0.22 * k], 0.28, CLOTH);
}

function buildZip(b: PartBuilder): void {
	const front = (y: number) => onBody(b, 0, y, 0).x;
	const ys = b.pick([36.6, BAND - 0.1, 39.8, 41.6, 44.5, 48, 50.5, 53.2, 55.2, 56.2], [36.6, 42, 47, 52, 56.2], [36.6, 51, 56]);
	b.loft(
		ys.map((y): Ring => ({ c: [front(y) + 0.02, y, 0], f: b.pick(0.2, 0.28, 0.3), b: 0.3, s: b.pick(0.5, 0.4, 0.35), n: 2.6, w: torsoWeights(y) })),
		{ seg: b.pick(4, 3, 3), pal: RIB, capEnd: true }
	);
	if (b.lod > 0) return;
	b.loft(
		Array.from({ length: 15 }, (_, i): Ring => {
			const y = lerp(36.7, 56, i / 14);
			return { c: [front(y) + 0.22, y, 0], f: 0.12, b: 0.2, s: 0.2, w: torsoWeights(y) };
		}),
		{ seg: 3, pal: METAL, shadeAt: (_p, _a, i) => (i % 2 ? 0.6 : 1) }
	);
	const w = torsoWeights(55.4);
	b.box([front(55.4) + 0.42, 55.4, 0], [0.4, 0.8, 0.7], { w, pal: METAL, shade: 0.8 });
	b.box([front(54.4) + 0.42, 54.4, 0.05], [0.18, 1.4, 0.4], { w, pal: BONE, rot: [0.08, 0, 0.5] });
}

registerItemMesh('top_skeleton', {
	hides: ['upperArms', 'forearms'],
	colors: [0x1b1c21, 0xf1ebd8, 0x2b2d34, 0x9aa0aa],
	glow: [0, 0.3, 0, 0],
	build(b) {
		buildBody(b);
		buildHood(b);
		buildCage(b);
		buildZip(b);
		for (const s of SIDES) buildSkeletonSleeve(b, s);
	}
});
