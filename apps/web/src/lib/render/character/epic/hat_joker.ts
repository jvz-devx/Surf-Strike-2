/**
 * Clown prince mask (docs/characters.md): smeared greasepaint on a full head,
 * with messy swept-back hair. The paint is baked into the shade (dirt, smudged
 * sockets) and thin ragged patches (grin, cracks); everything is built in code.
 */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, type PartBuilder, type Ring } from '../mesh-kit.js';
import { HEAD } from '../shop-items.js';
import type { V3 } from '../skeleton.js';

const PAINT = PAL.hatA;
const RED = PAL.hatB;
const HAIR = PAL.hatC;
const SMEAR = PAL.hatD;

/** Stable pseudo-random number 0..1. */
const rnd = (i: number): number => {
	const x = Math.sin(i * 127.1 + 31.7) * 43758.5453;
	return x - Math.floor(x);
};
const bump = (x: number, c: number, w: number): number => Math.exp(-(((x - c) / w) ** 2));

/** Mask profile: y, front x, back x, half width. */
const PROFILE: readonly (readonly number[])[] = [
	[59.5, 3.4, 2.4, 2.3],
	[59.8, 4.5, 2.6, 2.95],
	[60.4, 5.15, 3.0, 3.9],
	[61.4, 5.45, 3.8, 4.5],
	[62.6, 5.55, 4.6, 4.8],
	[64.0, 5.6, 5.1, 5.0],
	[65.4, 5.6, 5.5, 5.15],
	[66.6, 5.55, 5.7, 5.1],
	[67.8, 5.55, 5.75, 5.0],
	[69.0, 5.15, 5.6, 4.75],
	[70.2, 4.4, 5.0, 4.2],
	[71.2, 3.2, 4.0, 3.2],
	[72.0, 1.6, 2.4, 1.8]
];
const st: number[] = [];

/** Sunken eye socket, 0..1. */
const socket = (y: number, z: number): number => Math.exp(-(((Math.abs(z) - 1.95) / 1.15) ** 2) - ((y - 66.25) / 0.95) ** 2);

/** Point on the mask at angle `a` (0 front, π/2 right); `out` lifts it off the surface. */
function face(a: number, y: number, out = 0): THREE.Vector3 {
	sample(PROFILE, y, st);
	const c = Math.cos(a);
	const sn = Math.sin(a);
	const e = 2 / 2.25;
	const ca = Math.sign(c) * Math.abs(c) ** e;
	const sa = Math.sign(sn) * Math.abs(sn) ** e;
	const p = new THREE.Vector3((ca >= 0 ? st[1]! : st[2]!) * ca, y, st[3]! * sa);
	if (p.x > 0.5) {
		const z = Math.abs(p.z);
		let d = -0.6 * socket(y, z);
		// Heavy brow, cheekbones, hollow cheeks, chin.
		d += 0.4 * bump(y, 67.6, 0.5) * bump(z, 1.9, 1.5) - 0.12 * bump(y, 67.5, 0.5) * bump(z, 0, 0.5);
		d += 0.45 * bump(y, 64.6, 0.8) * bump(z, 3.2, 1.0);
		d -= 0.3 * bump(y, 62.6, 0.9) * bump(z, 3.6, 0.8);
		d += 0.4 * bump(y, 60.7, 0.7) * bump(z, 0, 1.3);
		d -= 0.22 * bump(y, 61.5, 0.3) * bump(z, 0, 1.3);
		// Lips and folds beside the mouth.
		d += 0.3 * bump(y, 62.4, 0.75) * bump(z, 0, 2.0);
		// Nose.
		const along = smooth(67, 64.2, y) * (1 - smooth(64.05, 63.5, y));
		d += (0.45 + 0.75 * along) * bump(z, 0, 0.5 + 0.32 * along) * (y < 67.3 && y > 63.4 ? smooth(67.4, 66.4, y) * smooth(63.45, 63.95, y) : 0);
		d += 0.42 * bump(y, 64.15, 0.42) * bump(z, 0.85, 0.38);
		// Forehead furrows.
		d += 0.1 * Math.sin((y - 68) * 6.2 + z * z * 0.14) * smooth(67.9, 68.3, y) * bump(z, 0, 3.2);
		p.x += d;
		// Stays in front of the eyes underneath.
		if (y > 65.2 && y < 68) p.x = Math.max(p.x, 4.78 - 0.9 * Math.max(0, z - 2.1));
		p.z += d * 0.25 * Math.sign(p.z) * smooth(1, 4, z);
	}
	if (out) {
		const l = Math.hypot(p.x, p.z * 1.1) || 1;
		p.x += (p.x / l) * out;
		p.z += ((p.z * 1.1) / l) * out;
	}
	return p;
}

/** Angle of the front point `z` to the side at height `y`. */
function angleAt(y: number, z: number): number {
	sample(PROFILE, y, st);
	const k = Math.min(0.999, Math.abs(z) / st[3]!);
	return Math.sign(z) * Math.asin(k ** (2.25 / 2));
}
/** Point on the face by height and side distance. */
const on = (y: number, z: number, out: number): THREE.Vector3 => face(angleAt(y, z), y, out);

/** Baked paint: smudged black sockets, dirt, creases. */
function paint(p: THREE.Vector3): number {
	const z = Math.abs(p.z);
	const front = smooth(0, 2.5, p.x);
	// Uneven black around the eyes, dragged down and outwards.
	const wob = 0.16 * Math.sin(p.y * 5 + p.z * 4) + 0.12 * Math.sin(p.z * 9 - p.y * 3);
	const ez = (z - 2.0 - (66.3 - p.y) * (p.y < 66 ? 0.16 : 0)) / (1.9 + wob);
	const cy = 66.4 + 0.2 * (z - 1.95);
	const ey = (p.y - cy) / (p.y > cy ? 1.3 + wob : 1.55 + wob * 1.6);
	const black = (1 - smooth(0.64, 1.14, Math.hypot(ez, ey))) * front;
	const tear = 0.5 * bump(z, 2.4, 0.22) * smooth(62.9, 64.4, p.y) * (1 - smooth(64.6, 66, p.y)) * (p.z > 0 ? 1 : 0.55) * front;
	// Patchy, cracked greasepaint.
	let s = 1.06 + 0.06 * Math.sin(p.y * 3.1 + p.z * 2.3) * Math.sin(p.z * 4.7 - p.y * 1.7);
	s *= 1 - 0.3 * smooth(0.2, 0.9, -Math.sin((p.y - 68) * 6.2 + z * z * 0.14)) * smooth(67.95, 68.3, p.y) * (1 - smooth(69.6, 70.2, p.y)) * bump(z, 0, 3) * front;
	// Between the brows, beside the nose, under the cheekbones, chin crease.
	s *= 1 - 0.35 * bump(z, 0.45, 0.16) * bump(p.y, 67.5, 0.5) * front;
	s *= 1 - 0.28 * bump(z, 1.35 + (64.2 - p.y) * 0.55, 0.3) * smooth(62.4, 63, p.y) * (1 - smooth(64.2, 64.7, p.y)) * front;
	s *= 1 - 0.3 * bump(p.y, 62.7, 0.8) * bump(z, 3.7, 0.7);
	s *= 1 - 0.28 * bump(p.y, 61.45, 0.25) * bump(z, 0, 1.2) * front;
	s *= lerp(0.6, 1, smooth(59.7, 61.2, p.y));
	s *= lerp(0.72, 1, front);
	return Math.max(0.035, s * (1 - 0.97 * black) * (1 - tear));
}

/** Grid facing away from a point (default: the middle of the head). */
function sheet(b: PartBuilder, pts: THREE.Vector3[][], pal: number, shadeAt: (p: THREE.Vector3, i: number) => number, wrap = false): void {
	const mid = new THREE.Vector3(0, 65.5, 0);
	let sum = 0;
	for (let i = 0; i < pts.length - 1; i++)
		for (let j = 0; j < pts[i]!.length - 1; j++) {
			const p = pts[i]![j]!;
			sum += pts[i]![j + 1]!.clone().sub(p).cross(pts[i + 1]![j]!.clone().sub(p)).dot(p.clone().sub(mid));
		}
	b.grid(pts, { w: HEAD, pal, wrap, flip: sum < 0, shadeAt });
}

function buildFace(b: PartBuilder): void {
	// Columns gather at the front.
	const cols = b.pick(31, 15, 9);
	const rows = b.pick(
		[59.5, 59.8, 60.3, 60.9, 61.5, 62.2, 62.9, 63.4, 63.75, 64.15, 64.6, 65, 65.4, 65.8, 66.2, 66.6, 67, 67.4, 67.8, 68.2, 68.5, 68.8, 69.1, 69.45, 70.8],
		[59.5, 60, 61, 62, 62.9, 63.7, 64.3, 65.1, 65.8, 66.5, 67.2, 67.9, 68.8, 70.4],
		[59.6, 61, 62.6, 64, 65.3, 66.3, 67.2, 70]
	);
	const pts = rows.map((y) =>
		Array.from({ length: cols }, (_, j) => {
			const u = (j / (cols - 1)) * 2 - 1;
			return face((u * 0.62 + u * u * u * 0.38) * 1.95, y);
		})
	);
	sheet(b, pts, PAINT, paint);
	// Closed underneath, around the neck.
	const seg = b.pick(22, 12, 8);
	const under = (k: number, y: number) => Array.from({ length: seg }, (_, j) => {
		const a = (j / seg) * Math.PI * 2;
		return face(a, 59.5).multiply(new THREE.Vector3(k, 0, k)).setY(y);
	});
	sheet(b, [under(1.02, 59.55), under(0.8, 59.4), [...under(0.6, 59.7)]], PAINT, (_p, i) => (i === 0 ? 0.5 : 0.25), true);
}

/** Eyes deep in the black. */
function buildEyes(b: PartBuilder): void {
	for (const m of [1, -1]) {
		const c = on(66.2, 1.95 * m, 0);
		b.ball([c.x - (b.lod === 2 ? 0.15 : 0.3), 66.25, c.z], b.lod === 2 ? [0.55, 1, 1.3] : [0.62, 0.6, 0.84], { w: HEAD, pal: PAINT, seg: b.pick(8, 6, 5), rings: b.pick(5, 3, 3), shade: b.lod === 2 ? 0.05 : 0.8 });
		if (b.lod === 2) continue;
		b.ball([c.x + 0.2, 66.16, c.z - 0.06 * m], [0.17, 0.38, 0.38], { w: HEAD, pal: PAINT, seg: b.pick(7, 5, 4), rings: b.pick(4, 3, 3), shade: 0.05 });
		if (b.lod === 1) continue;
		// Glint and heavy lids.
		b.ball([c.x + 0.34, 66.3, c.z + 0.13], [0.06, 0.09, 0.09], { w: HEAD, pal: PAINT, seg: 4, rings: 2, shade: 1.27 });
		b.ball([c.x - 0.2, 66.62, c.z], [0.74, 0.44, 1.12], { w: HEAD, pal: PAINT, seg: 8, rings: 4, shade: 0.045, rot: [-0.2 * m, 0, 0] });
		b.ball([c.x - 0.26, 65.79, c.z], [0.74, 0.3, 1.08], { w: HEAD, pal: PAINT, seg: 7, rings: 3, shade: 0.05 });
	}
}

/** Middle line of the grin: `t` 0 at the lips, 1 at the end of the scar on the cheek. */
function grin(t: number): [number, number] {
	const z = 3.95 * t ** 0.95;
	const y = 62.35 - 0.12 * bump(t, 0.35, 0.25) + 2.35 * smooth(0.28, 1.05, t) ** 1.35;
	return [y, z];
}

function buildGrin(b: PartBuilder): void {
	const n = b.pick(12, 7, 4);
	for (const m of [1, -1]) {
		const side = m > 0 ? 0 : 50;
		const strip = (half: (t: number, up: number) => number, out: (t: number) => number, across: readonly number[], t1: number) =>
			Array.from({ length: n + 1 }, (_, i) => {
				const t = (i / n) * t1;
				const [y, z] = grin(t);
				const [y2, z2] = grin(t + 0.02);
				const l = Math.hypot(y2 - y, z2 - z);
				const ny = (z2 - z) / l;
				const nz = -(y2 - y) / l;
				return across.map((k) => {
					const h = half(t, k) * k;
					return on(y + ny * h, Math.max(0, z + nz * h * smooth(0, 0.2, t)) * m, out(t) + (1 - k * k) * 0.22 * (1 - t * 0.5));
				});
			});
		// Smeared rim, then the red, then the dark line of the mouth.
		if (b.lod < 2) sheet(b, strip((t, k) => lerp(0.74, 0.42, smooth(0, 0.9, t)) * (0.85 + 0.45 * smooth(0, 0.15, t) * rnd(Math.round(t * 40) + side + (k > 0 ? 7 : 0))) * (1 - 0.85 * smooth(0.82, 1.05, t)), () => 0.07, [-1, 0, 1], 1.05), SMEAR, (p) => 0.8 + 0.25 * rnd(Math.round(p.y * 9)));
		const wide = (t: number, k: number) => (lerp(0.56, 0.28, smooth(0.1, 0.85, t)) * (1 - 0.1 * bump(t, 0, 0.1)) + 0.12 * bump(t, 0.5, 0.12)) * (0.9 + 0.22 * smooth(0, 0.15, t) * rnd(Math.round(t * 40) + side + 100 + (k > 0 ? 9 : 0))) * (1 - 0.92 * smooth(0.72, 1, t));
		const red = strip(wide, () => 0.13, b.pick([-1, -0.5, 0, 0.5, 1], [-1, 0, 1], [-1, 1]), 1);
		const order = new Map<THREE.Vector3, number>();
		red.forEach((r, i) => r.forEach((p, j) => order.set(p, (0.82 + 0.3 * rnd(i * 5 + j + side)) * (b.lod === 0 && i > 5 && i % 2 ? 0.72 : 1))));
		sheet(b, red, RED, (p) => order.get(p)!);
		const slit = strip((t) => 0.13 * (1 - 0.75 * smooth(0.3, 0.95, t)) + (b.lod === 2 ? 0.05 : 0), (t) => 0.36 - 0.11 * t, [-1, 1], 0.95);
		sheet(b, slit.map((r) => r.map((p) => new THREE.Vector3(p.x + 0.02, p.y, p.z + 0.02 * m))), RED, () => 0.07);
		// Stitched creases across the scar.
		if (b.lod === 0)
			for (let i = 0; i < 4; i++) {
				const t = 0.56 + i * 0.115;
				const [y, z] = grin(t);
				const h = 0.52 - i * 0.06;
				const dz = 0.22 + 0.1 * rnd(i + side);
				sheet(b, [
					[on(y - h * 0.8, (z + dz - 0.05) * m, 0.2), on(y - h * 0.8, (z + dz + 0.05) * m, 0.2)],
					[on(y, (z - 0.09) * m, 0.42), on(y, (z + 0.09) * m, 0.42)],
					[on(y + h * 0.8, (z - dz - 0.05) * m, 0.2), on(y + h * 0.8, (z - dz + 0.05) * m, 0.2)]
				], RED, () => 0.32);
			}
	}
}

/** Cracks in the paint: thin dark slivers. */
function buildCracks(b: PartBuilder): void {
	if (b.lod > 0) return;
	const crack = (path: readonly (readonly [number, number])[], w: number) =>
		sheet(b, path.map(([y, z], i) => {
			const t = w * (1 - i / (path.length - 0.4));
			return [on(y, z - t, 0.05), on(y, z + t, 0.05)];
		}), PAINT, () => 0.42);
	for (const [y, z, dy, dz, s] of [
		[69.5, 1.6, -0.5, 0.12, 1], [69.6, -2.1, -0.45, -0.2, 2], [69.2, -0.4, -0.4, 0.16, 3], [64.6, 3.6, -0.5, 0.25, 4], [64.3, -3.2, -0.48, -0.3, 5],
		[61.2, 2.2, -0.35, -0.2, 6], [61.3, -1.8, -0.4, 0.15, 7], [65.4, 4.2, -0.4, 0.2, 8], [65.2, -4.1, -0.42, -0.15, 9], [68.9, 3.2, -0.3, 0.3, 10]
	] as const) crack([0, 1, 2, 3].map((i) => [y + dy * i * 0.8, z + dz * i + 0.16 * (rnd(s * 7 + i) - 0.5) * i] as const), 0.06);
}

// ---------------------------------------------------------------------------
// Hair

/** Hairline height by angle: high forehead, in front of the ears, down to the nape. */
function hairline(a: number): number {
	const t = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
	return 69.6 + 0.35 * bump(t, 0.5, 0.25) - 1.6 * smooth(0.55, 0.85, t) - 6.0 * smooth(0.78, 1.1, t) - 2.5 * smooth(1.15, 1.8, t) - 0.9 * smooth(1.9, 3, t);
}

/** Outside of the hair. `t`: 0 at the hairline, 1 at the crown. */
function hairPoint(a: number, t: number): THREE.Vector3 {
	const y0 = hairline(a);
	const y = lerp(y0, 72.2, Math.sin((t * Math.PI) / 2));
	const k = y > 66.5 ? Math.sqrt(Math.max(0, 1 - ((y - 66.5) / 6.35) ** 2)) : 1;
	const s = Math.abs(Math.sin(a));
	const c = Math.cos(a);
	// Full at the sides, swept back to the nape.
	const down = Math.max(0, 66.5 - y);
	const f = 5.35 * k;
	const bk = 7.1 * k + 2.25 * smooth(69.5, 64.6, y) - 0.02 * down * down * down * 0.2;
	const w = 6.35 * k - 0.022 * down * down;
	const wave = 0.22 * Math.sin(a * 9 + y * 1.1) * smooth(0.5, 1.2, Math.abs(a > Math.PI ? a - Math.PI * 2 : a)) + 0.12 * Math.sin(a * 17 - y * 1.7);
	const r = wave + 0.5 * smooth(0, 0.18, t) - 0.35;
	// Round front and back, corners filled.
	const ca = Math.sign(c) * Math.abs(c) ** 0.9;
	const sa = Math.sign(Math.sin(a)) * s ** 0.9;
	// Brought forward beside the cheeks.
	const fwd = c > -0.2 && c < 0.75 ? 0.5 * smooth(67.5, 65, y) : 0;
	return new THREE.Vector3((c >= 0 ? f + r : bk + r) * ca + fwd * 0.5, y + (y > 70.5 ? wave * 0.6 : 0), (w + r) * sa);
}

interface Lock {
	path: readonly V3[];
	r: readonly number[];
	flat?: number;
	shade: number;
}

function buildLock(b: PartBuilder, l: Lock): void {
	const curve = new THREE.CatmullRomCurve3(l.path.map((p) => new THREE.Vector3(...p)));
	const n = b.pick(4, 2, 2);
	const seg = b.pick(4, 4, 3);
	const mid = new THREE.Vector3(-0.8, 65, 0);
	const shade = new Map<THREE.Vector3, number>();
	const rows = Array.from({ length: n + 1 }, (_, i) => {
		const t = i / n;
		const c = curve.getPoint(t);
		const dir = curve.getTangent(t);
		const out = c.clone().sub(mid).normalize();
		const side = dir.clone().cross(out).normalize();
		out.copy(side).cross(dir).normalize();
		const k = Math.min(l.r.length - 1.001, t * (l.r.length - 1));
		const r = i === n ? 0.02 : lerp(l.r[Math.floor(k)]!, l.r[Math.floor(k) + 1]!, k % 1);
		return Array.from({ length: seg }, (_, j) => {
			const a = (j / seg) * Math.PI * 2;
			const p = c.clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(out, Math.sin(a) * r * (l.flat ?? 0.7));
			shade.set(p, l.shade * (0.72 + 0.36 * Math.max(0, Math.sin(a))) * lerp(0.75, 1.1, t));
			return p;
		});
	});
	const c0 = curve.getPoint(0);
	shade.set(c0, 0.5);
	b.grid([rows[0]!.map(() => c0), ...rows], { w: HEAD, pal: HAIR, wrap: true, flip: true, shadeAt: (p) => shade.get(p)! });
}

function buildHairMass(b: PartBuilder): void {
	const seg = b.pick(32, 16, 12);
	const ts = b.pick([0, 0.08, 0.2, 0.36, 0.54, 0.72, 0.9], [0, 0.16, 0.4, 0.7, 0.92], [0, 0.25, 0.6, 0.92]);
	const ang = (j: number) => (j / seg) * Math.PI * 2;
	const shade = new Map<THREE.Vector3, number>();
	const rows = ts.map((t) =>
		Array.from({ length: seg }, (_, j) => {
			const a = ang(j);
			const p = hairPoint(a, t);
			if (b.lod === 2) p.multiply(new THREE.Vector3(1.04, 1, 1.04));
			shade.set(p, (0.72 + 0.3 * Math.sin(a * 13 + p.y * 0.9 + Math.sin(a * 5) * 2) * (b.lod === 0 ? 1 : 0.4)) * lerp(0.6, 1.05, smooth(58.5, 69, p.y)));
			return p;
		})
	);
	const top = new THREE.Vector3(-0.6, 72.75, 0);
	shade.set(top, 0.9);
	// The root row sinks into the mask; underneath it closes towards the neck.
	const root = Array.from({ length: seg }, (_, j) => {
		const a = ang(j);
		const y = hairline(a);
		const p = face(a, Math.max(59.6, y), -0.5);
		p.y = Math.max(59.2, y) - 0.1;
		shade.set(p, 0.3);
		return p;
	});
	b.grid([root, ...rows, rows[0]!.map(() => top)], { w: HEAD, pal: HAIR, wrap: true, flip: true, shadeAt: (p) => shade.get(p) ?? 0.6 });
	{
		// Underside of the nape.
		const inner = (k: number, y: number) => Array.from({ length: seg }, (_, j) => {
			const a = ang(j);
			return new THREE.Vector3(-0.4 + Math.cos(a) * k, y, Math.sin(a) * k);
		});
		sheet(b, [root.map((p) => p.clone()), inner(2.1, 59.4)], HAIR, () => 0.2, true);
	}
}

function buildLocks(b: PartBuilder): void {
	if (b.lod === 2) return;
	const locks: Lock[] = [];
	// Combed back over the crown.
	const tops = b.pick(9, 5, 0);
	for (let i = 0; i < tops; i++) {
		const k = i / (tops - 1) - 0.5;
		const z = k * 8.2 + (rnd(i) - 0.5) * 0.5;
		const h = 72.0 - k * k * 8.5 + rnd(i + 20) * 0.5;
		locks.push({
			path: [[4.3 - Math.abs(k) * 2.6, 70 - k * k * 2.5, z * 0.85], [3.4 - Math.abs(k) * 2, h - 0.6, z], [0.8, h + 0.45, z * 1.02 + (rnd(i + 40) - 0.5)], [-3, h - 0.1, z * 1.02], [-6.3, 69.2 - k * k * 2, z * 0.9 + (rnd(i + 60) - 0.5) * 1.2]],
			r: [0.35, 0.95, 0.95, 0.8, 0.4],
			flat: 0.6,
			shade: 0.9 + 0.35 * rnd(i + 80)
		});
	}
	for (const m of [1, -1]) {
		const o = m > 0 ? 100 : 200;
		// Sides: wavy, back past the ears and out at the ends.
		const n = b.pick(5, 3, 0);
		for (let i = 0; i < n; i++) {
			const k = i / Math.max(1, n - 1);
			const a0 = 0.95 + 0.25 * rnd(i + o) + k * 0.2;
			const t0 = lerp(0.72, 0.1, k) + (rnd(i + o + 5) - 0.5) * 0.12;
			const at = (da: number, t: number, out: number): V3 => {
				const p = hairPoint((a0 + da) * m, Math.max(0, t));
				const q = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(out);
				return [p.x + q.x, p.y, p.z + q.z];
			};
			locks.push({
				path: [at(0, t0, -0.3), at(0.4, t0 - 0.02, 0.15), at(0.85, t0 - 0.12, 0.2), at(1.2, t0 - 0.26, 0.15), at(1.45 + 0.2 * rnd(i + o + 20), t0 - 0.42, 0.8 + 0.7 * rnd(i + o + 30))],
				r: [0.3, 0.8, 0.95, 0.75, 0.3],
				shade: 0.8 + 0.4 * rnd(i + o + 50)
			});
		}
		// Loose strands on the forehead and temple.
		if (b.lod === 0) {
			locks.push({ path: m > 0 ? [[4.3, 70.3, 1.2], [5.15, 70.0, 1.9], [5.35, 68.7, 2.9], [4.85, 67.4, 3.5]] : [[4.2, 70.2, -2.2], [4.75, 70.0, -2.9], [4.5, 68.9, -3.7], [4.1, 67.8, -4.0]], r: [0.4, 0.36, 0.24, 0.1], shade: 1.05 });
			locks.push({ path: [[1.9, 67.6, 4.9 * m], [2.3, 66.3, 5.5 * m], [2.0, 64.8, 5.5 * m], [1.1 - rnd(o) * 0.8, 63.2, 5.7 * m]], r: [0.45, 0.5, 0.36, 0.15], shade: 0.95 });
		}
	}
	// Nape: ends flip out.
	const nape = b.pick(5, 3, 0);
	for (let i = 0; i < nape; i++) {
		const k = i / (nape - 1) - 0.5;
		locks.push({
			path: [[-7.6 + k * k * 4, 67, k * 5.5], [-9.0 + k * k * 8, 64.4, k * 6.6], [-8.7 + k * k * 8, 61.6, k * 7.0], [-9.3 + k * k * 7 - rnd(i + 300) * 0.5, 59.2 - rnd(i + 310) * 0.7, k * 7.8]],
			r: [0.5, 1.15, 0.95, 0.35],
			shade: 0.75 + 0.35 * rnd(i + 320)
		});
	}
	for (const l of locks) buildLock(b, l);
}

registerItemMesh('hat_joker', {
	hides: ['hair'],
	coversFace: true,
	colors: [0xe9e5da, 0xa3171c, 0x4c6b2c, 0xb9625c],
	build(b) {
		buildFace(b);
		buildEyes(b);
		buildGrin(b);
		buildCracks(b);
		buildHairMass(b);
		buildLocks(b);
	}
});
