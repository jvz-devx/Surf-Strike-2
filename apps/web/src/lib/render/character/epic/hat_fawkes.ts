/**
 * Gunpowder mask (docs/characters.md): a smooth porcelain face with a closed
 * smile, curled moustache and pointed goatee, a straight black bob and a tall
 * buckled hat with a burning fuse. Blacks are the porcelain colour at a very
 * low shade; blush and embers are single vertices of another palette entry,
 * which the vertex colours blend into the surface.
 */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, type PartBuilder, type Ring } from '../mesh-kit.js';
import { HEAD } from '../shop-items.js';

const WHITE = PAL.hatA;
const ROSE = PAL.hatB;
const GOLD = PAL.hatC;
const EMBER = PAL.hatD;
/** Shade of black paint and hair on the porcelain colour. */
const INK = 0.014;

const rnd = (i: number): number => {
	const x = Math.sin(i * 127.1 + 31.7) * 43758.5453;
	return x - Math.floor(x);
};
const bump = (x: number, c: number, w: number): number => Math.exp(-(((x - c) / w) ** 2));
const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Mask profile: y, front x, back x, half width. */
const PROFILE: readonly (readonly number[])[] = [
	[59.5, 3.5, 2.4, 2.1],
	[59.9, 4.65, 2.6, 2.75],
	[60.6, 5.2, 3.0, 3.6],
	[61.6, 5.4, 3.8, 4.3],
	[62.8, 5.5, 4.6, 4.75],
	[64.2, 5.6, 5.1, 5.05],
	[65.4, 5.65, 5.5, 5.15],
	[66.6, 5.65, 5.7, 5.1],
	[67.8, 5.6, 5.75, 5.0],
	[69.0, 5.35, 5.6, 4.85],
	[70.2, 4.9, 5.0, 4.5]
];
const st: number[] = [];

/** Middle of the eye slit: a smiling arch. */
const eyeLine = (z: number): number => 66.05 + 0.42 * (1 - ((z - 1.95) / 1.3) ** 2) + 0.16 * (z - 1.95);
/** Middle of the eyebrow. */
const browLine = (t: number): [number, number] => [67.3 + 1.15 * Math.sin(Math.min(1, t * 1.12) ** 0.85 * Math.PI * 0.78) - 0.2 * t, 0.7 + 3.35 * t];
/** Middle of the mouth, `t` 0 centre to 1 corner. */
const mouthLine = (t: number): [number, number] => [61.95 - 0.06 * bump(t, 0.35, 0.25) + 1.15 * t ** 2.4, 2.65 * t];

/** Point on the mask at angle `a` (0 front, π/2 right); `out` lifts it off the surface. */
function face(a: number, y: number, out = 0): THREE.Vector3 {
	sample(PROFILE, y, st);
	const c = Math.cos(a);
	const sn = Math.sin(a);
	const e = 2 / 2.2;
	const ca = Math.sign(c) * Math.abs(c) ** e;
	const sa = Math.sign(sn) * Math.abs(sn) ** e;
	const p = v((ca >= 0 ? st[1]! : st[2]!) * ca, y, st[3]! * sa);
	if (p.x > 0.5) {
		const z = Math.abs(p.z);
		// Almond sockets under a clean brow bone.
		let d = -0.42 * Math.exp(-(((z - 1.95) / 1.3) ** 2) - ((y - 66.4) / 0.75) ** 2);
		d += 0.26 * bump(y, 67.75, 0.6) * bump(z, 2, 1.7);
		// Cheeks pushed up by the smile.
		d += 0.72 * Math.exp(-(((z - 3.05) / 1.05) ** 2) - ((y - 64.45) / 0.95) ** 2);
		// Fold from the nose to outside the corner of the mouth.
		d -= 0.2 * bump(z, 1.45 + (64 - y) * 0.95, 0.4) * smooth(61.9, 62.6, y) * (1 - smooth(63.9, 64.4, y));
		d -= 0.2 * bump(y, 62.4, 0.8) * bump(z, 3.9, 0.7);
		// Mouth and chin.
		d += 0.26 * bump(y, 62.2, 0.9) * bump(z, 0, 1.9);
		d += 0.62 * bump(y, 60.75, 0.7) * bump(z, 0, 1.05);
		d -= 0.16 * bump(y, 61.45, 0.25) * bump(z, 0, 1.1);
		// Long straight nose.
		const along = smooth(67.2, 64.3, y);
		if (y > 63.5 && y < 67.6) d += (0.42 + 0.78 * along) * bump(z, 0, 0.46 + 0.26 * along) * smooth(67.6, 66.5, y) * smooth(63.65, 64.1, y);
		d += 0.34 * bump(y, 64.3, 0.36) * bump(z, 0.78, 0.34);
		p.x += d;
		// Stays in front of the eyes underneath.
		if (y > 65.2 && y < 68) p.x = Math.max(p.x, 4.82 - 0.9 * Math.max(0, z - 2.1));
		p.z += d * 0.25 * Math.sign(p.z) * smooth(1, 4, z);
	}
	if (out) {
		const l = Math.hypot(p.x, p.z * 1.1) || 1;
		p.x += (p.x / l) * out;
		p.z += ((p.z * 1.1) / l) * out;
	}
	return p;
}

/** Point on the face by height and side distance. */
function on(y: number, z: number, out: number): THREE.Vector3 {
	sample(PROFILE, y, st);
	const k = Math.min(0.999, Math.abs(z) / st[3]!);
	return face(Math.sign(z) * Math.asin(k ** (2.2 / 2)), y, out);
}

type At<T> = (i: number, j: number, p: THREE.Vector3) => T;

/** Grid facing away from the middle of the head, with a palette entry and shade per vertex. */
function sheet(b: PartBuilder, pts: THREE.Vector3[][], pal: number | At<number>, shade: At<number>, wrap = false, mid = v(0, 65.5, 0)): void {
	let sum = 0;
	for (let i = 0; i < pts.length - 1; i++)
		for (let j = 0; j < pts[i]!.length - 1; j++) {
			const p = pts[i]![j]!;
			sum += pts[i]![j + 1]!.clone().sub(p).cross(pts[i + 1]![j]!.clone().sub(p)).dot(p.clone().sub(mid));
		}
	const n = pts[0]!.length;
	const start = b.data.pal.length;
	b.grid(pts, { w: HEAD, pal: WHITE, wrap, flip: sum < 0 });
	pts.forEach((row, i) =>
		row.forEach((p, j) => {
			b.data.pal[start + i * n + j] = typeof pal === 'number' ? pal : pal(i, j, p);
			b.data.shade[start + i * n + j] = shade(i, j, p);
		})
	);
}

/** Tapered tube along points; `flat` squashes it away from the head. */
function tube(b: PartBuilder, path: readonly THREE.Vector3[], r: readonly number[], o: { n: number; seg: number; flat?: number; pal?: number | At<number>; shade: (t: number, up: number) => number; mid?: THREE.Vector3 }): void {
	const curve = new THREE.CatmullRomCurve3(path.slice());
	const shades: number[][] = [];
	const rows = Array.from({ length: o.n + 1 }, (_, i) => {
		const t = i / o.n;
		// Same parameter as the radii.
		const c = curve.getPoint(t);
		const dir = curve.getTangent(t);
		const out = c.clone().sub(o.mid ?? v(0, c.y, 0)).normalize();
		const side = dir.clone().cross(out).normalize();
		out.copy(side).cross(dir).normalize();
		const k = Math.min(r.length - 1.001, t * (r.length - 1));
		const rr = lerp(r[Math.floor(k)]!, r[Math.floor(k) + 1]!, k % 1);
		shades.push([]);
		return Array.from({ length: o.seg }, (_, j) => {
			const a = (j / o.seg) * Math.PI * 2;
			shades[i]!.push(o.shade(t, Math.sin(a)));
			return c.clone().addScaledVector(side, Math.cos(a) * rr).addScaledVector(out, Math.sin(a) * rr * (o.flat ?? 1));
		});
	});
	// Closed at the start.
	const c0 = curve.getPoint(0);
	const start = b.data.pal.length;
	b.grid([rows[0]!.map(() => c0), ...rows], { w: HEAD, pal: WHITE, wrap: true, flip: true });
	for (let i = 0; i <= o.n + 1; i++)
		for (let j = 0; j < o.seg; j++) {
			const k = Math.max(0, i - 1);
			b.data.pal[start + i * o.seg + j] = typeof o.pal === 'function' ? o.pal(k, j, rows[k]![j]!) : (o.pal ?? WHITE);
			b.data.shade[start + i * o.seg + j] = shades[k]![j]!;
		}
}

// ---------------------------------------------------------------------------
// Face

const blush = (p: THREE.Vector3): number => Math.hypot((Math.abs(p.z) - 3.2) / 1.0, (p.y - 64.5) / 0.75);

/** Glazed porcelain: soft creases, darker towards the hair and under the hat. */
function glaze(p: THREE.Vector3): number {
	const z = Math.abs(p.z);
	const front = smooth(0, 2.5, p.x);
	let s = 1.1;
	s *= 1 - 0.34 * Math.exp(-(((z - 1.95) / 1.2) ** 2) - ((p.y - 66.6) / 0.55) ** 2) * front;
	s *= 1 - 0.2 * bump(z, 1.0, 0.25) * smooth(64.6, 65.6, p.y) * (1 - smooth(66.6, 67.4, p.y)) * front;
	s *= 1 - 0.34 * bump(z, 1.4 + (64 - p.y) * 0.95, 0.28) * smooth(61.9, 62.6, p.y) * (1 - smooth(63.9, 64.4, p.y)) * front;
	s *= 1 - 0.22 * bump(p.y, 63.75, 0.22) * bump(z, 0, 1) * front;
	s *= 1 - 0.22 * bump(p.y, 61.45, 0.28) * bump(z, 0, 1.1) * front;
	s *= 1 - 0.18 * bump(p.y, 62.3, 0.8) * bump(z, 3.9, 0.6);
	s *= lerp(0.62, 1, smooth(59.6, 61, p.y));
	s *= lerp(1, 0.62, smooth(68.6, 69.7, p.y));
	return s * lerp(0.45, 1, front);
}

function buildFace(b: PartBuilder): void {
	const cols = b.pick(27, 13, 9);
	const rows = b.pick(
		[59.5, 59.8, 60.25, 60.75, 61.2, 61.65, 62.15, 62.65, 63.15, 63.6, 63.95, 64.25, 64.6, 65, 65.5, 65.95, 66.35, 66.8, 67.25, 67.7, 68.2, 68.8, 70],
		[59.5, 60.1, 60.9, 61.5, 62.2, 63, 63.65, 64.2, 64.8, 65.6, 66.3, 67, 67.8, 70],
		[59.6, 60.8, 62.2, 63.6, 64.4, 65.6, 66.6, 70]
	);
	const pts = rows.map((y) =>
		Array.from({ length: cols }, (_, j) => {
			const u = (j / (cols - 1)) * 2 - 1;
			return face((u * 0.64 + u * u * u * 0.36) * 1.75, y);
		})
	);
	const r = b.pick(0.82, 0.8, 0.9);
	sheet(b, pts, (_i, _j, p) => (p.x > 1 && blush(p) < r ? ROSE : WHITE), (_i, _j, p) => glaze(p));
	// Closed underneath, around the neck.
	const seg = b.pick(16, 12, 8);
	const under = (k: number, y: number) => Array.from({ length: seg }, (_, j) => face((j / seg) * Math.PI * 2, 59.5).multiply(v(k, 0, k)).setY(y));
	sheet(b, [under(1.02, 59.55), under(0.8, 59.4), under(0.6, 59.7)], WHITE, (i) => (i === 0 ? 0.5 : 0.25), true);
}

/** Narrow smiling slits, black with an ember inside. */
function buildEyes(b: PartBuilder): void {
	const n = b.pick(8, 6, 2);
	const across = b.pick([-1, -0.5, 0.1, 1], [-1, 0, 1], [-1, 1]);
	for (const m of [1, -1]) {
		const pts = Array.from({ length: n + 1 }, (_, i) => {
			const t = i / n;
			const z = 0.72 + 2.5 * t;
			const h = b.pick(0.31, 0.33, 0.45) * Math.sin(Math.PI * lerp(0.06, 0.94, t)) ** 0.75;
			return across.map((k) => on(eyeLine(z) + h * k, z * m, b.lod === 0 ? (Math.abs(k) === 1 ? 0.06 : 0.1) : 0.16));
		});
				sheet(b, pts, (i, j) => (b.lod < 2 && j === b.pick(2, 1, 0) && Math.abs(i / n - 0.5) < 0.1 ? EMBER : WHITE), () => INK * 0.7);
		// Heavy upper lid and a raised lower one.
		if (b.lod === 0)
			for (const up of [1, -1])
				sheet(b, Array.from({ length: n + 1 }, (_, i) => {
					const z = 0.6 + 2.74 * (i / n);
					const s = Math.sin(Math.PI * (i / n)) ** 0.7;
					const y = eyeLine(z) + up * 0.29 * s;
					return [on(y, z * m, 0.02), on(y + up * 0.09, z * m, 0.06 + 0.16 * s), on(y + up * 0.34 * s + up * 0.02, z * m, 0.02)];
				}), WHITE, (_i, j) => (j === 0 ? 0.5 : j === 1 ? 1.15 : 0.95));
	}
}

function buildBrows(b: PartBuilder): void {
	const n = b.pick(11, 6, 3);
	for (const m of [1, -1]) {
		const pts = Array.from({ length: n + 1 }, (_, i) => {
			const t = i / n;
			const [y, z] = browLine(t);
			const [y2, z2] = browLine(t + 0.02);
			const l = Math.hypot(y2 - y, z2 - z);
			const h = b.pick(0.21, 0.23, 0.32) * (1 - t ** 2.2) ** 0.8 * lerp(0.55, 1, smooth(0, 0.25, t)) + 0.015;
			return b.pick([-1, 0, 1], [-1, 1], [-1, 1]).map((k) => on(y + ((z2 - z) / l) * h * k, (z - ((y2 - y) / l) * h * k) * m, b.pick(k ? 0.04 : 0.2, 0.14, 0.2)));
		});
		sheet(b, pts, WHITE, (_i, j) => (b.lod === 0 && j === 1 ? INK * 1.8 : INK));
	}
}

function buildMouth(b: PartBuilder): void {
	const n = b.pick(12, 8, 4);
	const strip = (h: (t: number) => number, across: readonly number[], out: (t: number, k: number) => number, t1 = 1) =>
		Array.from({ length: n + 1 }, (_, i) => {
			const u = ((i / n) * 2 - 1) * t1;
			const [y, z] = mouthLine(Math.abs(u));
			const [y2, z2] = mouthLine(Math.abs(u) + 0.02);
			const l = Math.hypot(y2 - y, z2 - z);
			const hh = h(Math.abs(u));
			return across.map((k) => on(y + ((z2 - z) / l) * hh * k, (z - ((y2 - y) / l) * hh * k) * (u < 0 ? -1 : 1), out(Math.abs(u), k)));
		});
	// Closed lips, tinted.
	if (b.lod < 2)
		sheet(
			b,
			strip((t) => 0.42 * (1 - t ** 2) + 0.03 + 0.06 * bump(t, 0.2, 0.15), b.lod ? [-1, 0, 1] : [-1, -0.5, 0, 0.5, 1], (t, k) => 0.04 + (Math.abs(k) === 0.5 ? 0.17 : 0.03) * (1 - t * t), 0.94),
			(_i, j) => (j === 0 || j === (b.lod ? 2 : 4) ? WHITE : ROSE),
			(_i, j, p) => (j === 0 || j === (b.lod ? 2 : 4) ? glaze(p) * 0.95 : 0.8)
		);
	sheet(b, strip((t) => b.pick(0.075, 0.09, 0.17) * (1 - 0.75 * smooth(0.6, 1, t)) + 0.1 * bump(t, 0.93, 0.07), [-1, 1], () => b.pick(0.13, 0.16, 0.2)), WHITE, () => INK * 0.8);
}

function buildBeard(b: PartBuilder): void {
	for (const m of [1, -1])
		tube(
			b,
			([[63.4, 0.06, 0.1], [63.32, 0.8, 0.22], [63.1, 1.65, 0.28], [63.35, 2.55, 0.3], [64.0, 3.3, 0.34], [64.8, 3.75, 0.45], [65.35, 3.6, 0.62], [65.3, 3.2, 0.62]] as const).map(([y, z, o]) => on(y, z * m, o)),
			[0.13, 0.3, 0.33, 0.28, 0.21, 0.15, 0.1, 0.04].map((r) => r * b.pick(1, 1.05, 1.3)),
			{ n: b.pick(10, 6, 4), seg: b.pick(4, 4, 3), flat: 0.75, shade: (_t, up) => INK * (1 + 1.5 * Math.max(0, up)) }
		);
	// Narrow goatee, pointing forward.
	const g = [on(61.55, 0, 0), on(61.1, 0, 0.16), on(60.55, 0, 0.2), v(6.3, 59.8, 0), v(6.55, 59.1, 0), v(6.75, 58.6, 0)];
	tube(b, g, [0.14, 0.36, 0.62, 0.56, 0.3, 0.02], { n: b.pick(7, 4, 3), seg: b.pick(6, 5, 4), flat: 0.75, mid: v(2, 61.5, 0), shade: (t, up) => INK * (1 + 1.4 * Math.max(0, up)) * lerp(1.3, 0.9, t) });
}

/** Fine cracks in the glaze: dark edges, embers behind. */
function buildCracks(b: PartBuilder): void {
	if (b.lod === 2) return;
	const crack = (path: readonly (readonly [number, number])[], w: number, hot: number) =>
		sheet(b, path.map(([y, z], i) => {
			const t = w * (1 - i / (path.length - 0.6));
			const [y0, z0] = path[Math.max(0, i - 1)]!;
			const [y1, z1] = path[Math.min(path.length - 1, i + 1)]!;
			const l = Math.hypot(y1 - y0, z1 - z0);
			return [-1, 0, 1].map((k) => on(y + ((z1 - z0) / l) * t * k, z - ((y1 - y0) / l) * t * k, k ? 0.04 : 0.06));
		}), (i, j) => (j === 1 && i < hot ? EMBER : WHITE), () => 0.1);
	// Forehead, down to the brow.
	crack([[69.9, 1.7], [69.4, 1.35], [69.0, 1.6], [68.55, 1.2], [68.2, 1.3], [67.8, 0.95]], 0.12, 5);
	// Cheek to jaw.
	crack([[62.2, -4.45], [62.6, -4.0], [63.0, -4.1], [63.5, -3.65], [63.8, -3.75]], 0.12, 4);
	if (b.lod) return;
	crack([[69.0, 1.6], [68.75, 2.0], [68.8, 2.35]], 0.07, 2);
	crack([[63.0, -4.1], [63.35, -4.4], [63.7, -4.45]], 0.07, 2);
}

// ---------------------------------------------------------------------------
// Hair

/** Straight bob; `a` from the temple around the back, `k` 0 outside to 1 inside. */
function bob(a: number, y: number, k: number): THREE.Vector3 {
	const c = Math.cos(a);
	const s = Math.sin(a);
	const low = smooth(67, 62.3, y);
	const tuck = smooth(62.4, 60.2, y);
	const r = -1.15 * k + 0.35 * low - 0.5 * tuck;
	// Full behind, over a ponytail.
	const full = 7.5 + 1.75 * Math.abs(c) ** 4 * smooth(59, 64, y) * (1 - smooth(66.4, 69, y));
	return v((c >= 0 ? 6.3 + r : full + r) * Math.sign(c) * Math.abs(c) ** 0.92 + 0.5 * low * Math.max(0, c), y, (6.05 + r) * Math.sign(s) * Math.abs(s) ** 0.92);
}
const FRONT = 1.14;

function buildHair(b: PartBuilder): void {
	const no = b.pick(33, 15, 9);
	const ni = b.pick(7, 5, 4);
	const ys = b.pick([69.7, 67.6, 65.6, 63, 61.2, 60.2], [69.7, 66, 62.4, 60.2], [69.7, 63.5, 60.2]);
	const ring: { a: number; k: number; col: number }[] = [];
	for (let j = 0; j < no; j++) ring.push({ a: lerp(FRONT, Math.PI * 2 - FRONT, j / (no - 1)), k: 0, col: j });
	for (let j = 0; j < ni; j++) ring.push({ a: lerp(Math.PI * 2 - FRONT, FRONT, j / (ni - 1)), k: 1, col: 100 + j });
	const at = (y: number, o: { a: number; k: number; col: number }, last: boolean) => {
		const groove = b.lod === 0 && !o.k ? (o.col % 2 ? -0.16 : 0.05) + 0.1 * (rnd(o.col) - 0.5) : 0;
		const p = bob(o.a, y, o.k - groove / 1.15);
		// Under the tilted brim; ends cut straight but not ruler-straight.
		if (y > 69) p.y = 69.45 + 0.07 * p.x;
		if (last) p.y += b.lod === 0 ? 0.55 * (rnd(o.col * 3 + 1) - 0.5) : 0;
		return p;
	};
	const rows = ys.map((y, i) => ring.map((o) => at(y, o, i === ys.length - 1)));
	const end = ring.map((o) => at(60.2, { ...o, k: 0.5, col: 1 }, true).setY(59.95));
	const shine = (p: THREE.Vector3) => 1.3 + 2.4 * bump(p.y, 65.8, 1.3) + 0.5 * bump(p.y, 62.8, 0.7);
	sheet(b, [...rows, end], WHITE, (i, j, p) => {
		const o = ring[j]!;
		if (o.k || i >= rows.length) return INK * 0.6;
		return INK * shine(p) * (b.lod === 0 ? (o.col % 2 ? 0.55 : 1) * (0.75 + 0.6 * rnd(o.col * 7)) : 1);
	}, true);
	// Loose flat strands over the cut.
	if (b.lod > 0) return;
	for (const m of [1, -1])
		for (let i = 0; i < 2; i++) {
			const a = (FRONT + [0.0, 0.62][i]! + 0.1 * rnd(i + m)) * m;
			const end2 = 59.7 - 0.35 * rnd(i * 5 + m);
			const path = [68.9, 66.5, 63.6, 61.4, end2].map((y, k) => {
				const p = bob(a, Math.max(60, y), 0);
				const d = v(p.x, 0, p.z).normalize().multiplyScalar(-0.1 + (k === 4 ? -0.25 : 0));
				return p.add(d).setY(y);
			});
			tube(b, path, [0.5, 0.62, 0.62, 0.5, 0.03], { n: 4, seg: 4, flat: 0.45, shade: (t, up) => INK * (1 + 1.3 * Math.max(0, up)) * (0.9 + 1.4 * bump(t, 0.35, 0.16)) });
		}
}

// ---------------------------------------------------------------------------
// Hat

const TILT = 0.07;
/** Hat space (y 0 at the brim) to the head: leaning back a little. */
function hat(x: number, y: number, z: number): THREE.Vector3 {
	return v(x * Math.cos(TILT) - y * Math.sin(TILT), 69.45 + y * Math.cos(TILT) + x * Math.sin(TILT), z);
}
const seat = (p: THREE.Vector3) => p.copy(hat(p.x, p.y, p.z));
/** Radius of the cone above the brim: front, back, side. */
const cone = (y: number): [number, number, number] => {
	const t = y / 11;
	const k = lerp(1, 0.53, t) + 0.035 * bump(t, 0, 0.12);
	return [5.75 * k, 6.15 * k, 5.5 * k];
};
const ring = (y: number, out: number, shade = 1, pal?: number): Ring => {
	const [f, bk, s] = cone(y);
	return { c: [0, y, 0], f: f + out, b: bk + out, s: s + out, w: HEAD, shade, pal };
};
/** Felt: soft folds near the top. */
const FELT = 0.026;

function buildHat(b: PartBuilder): void {
	const seg = b.pick(22, 12, 9);
	const brim = (y: number, r: number, shade: number): Ring => ({ c: [0, y, 0], f: r * 0.98, b: r * 1.02, s: r * 0.98, w: HEAD, shade });
	const curl = (p: THREE.Vector3, _t: number, a: number) => {
		const out = smooth(5.5, 9, Math.hypot(p.x, p.z));
		p.y += out * (0.45 * Math.sin(a) ** 2 - 0.18 * Math.cos(a) + 0.07 * Math.sin(a * 3 + 1));
		seat(p);
	};
	b.loft(
		b.pick(
			[brim(-0.1, 4.9, FELT * 0.4), brim(-0.2, 6.6, FELT * 0.5), brim(-0.2, 8.75, FELT * 0.8), brim(0.02, 8.98, FELT * 2), brim(0.22, 8.75, FELT * 1.4), brim(0.24, 6.6, FELT), brim(0.45, 5.5, FELT * 0.6)],
			[brim(-0.1, 4.9, FELT * 0.4), brim(-0.2, 8.8, FELT * 0.8), brim(0.2, 8.9, FELT * 1.6), brim(0.4, 5.5, FELT * 0.7)],
			[brim(-0.2, 4.9, FELT * 0.5), brim(-0.1, 8.9, FELT), brim(0.4, 5.5, FELT)]
		),
		{ seg, pal: WHITE, deform: curl }
	);
	// Crown with a soft dent on one side and a slightly sunken top.
	b.loft(
		b.pick(
			[ring(0.2, 0, 0.7), ring(3, 0, 0.75), ring(5, 0), ring(7, 0), ring(9, 0), ring(11, 0), ring(11.5, -0.12, 1.7), ring(11.5, -0.45, 1.4)],
			[ring(0.2, 0, 0.7), ring(3, 0, 0.8), ring(7, 0), ring(11.2, 0), ring(11.5, -0.3, 1.4)],
			[ring(0.2, 0), ring(3.2, 0), ring(11.4, 0)]
		),
		{
			seg,
			pal: WHITE,
			deform: (p, _t, a) => {
				if (b.lod === 0) {
					const h = smooth(3, 6, p.y) * (1 - smooth(9, 11, p.y));
					const r = 1 - h * (0.05 * bump(a, 5.4, 0.5) * bump(p.y, 7, 1.4) + 0.045 * bump(a, 1.1, 0.4) * bump(p.y, 5.2, 0.9) + 0.012 * Math.sin(a * 5 + p.y * 1.3));
					p.x *= r;
					p.z *= r;
				}
				seat(p);
			},
			shadeAt: (p, a) => FELT * (b.lod === 0 ? 1 + 0.45 * Math.sin(a * 3 + p.y * 0.6) * Math.sin(a * 2 - p.y * 0.45) : 1)
		}
	);
	// Slightly sunken top.
	const top = [ring(b.pick(11.5, 11.5, 11.4), b.pick(-0.45, -0.3, 0)), ring(11.15, -1.3)].map((r) => Array.from({ length: seg }, (_, j) => {
		const a = (j / seg) * Math.PI * 2;
		return hat(Math.cos(a) * (Math.cos(a) >= 0 ? r.f : r.b!), r.c[1], Math.sin(a) * r.s);
	}));
	const c = hat(-0.1, 11.1, 0);
	sheet(b, [...top.slice(0, b.pick(2, 1, 1)), top[0]!.map(() => c)], WHITE, (i) => FELT * (i ? 0.9 : 1.3), true);
	// Wide band, piped in gold.
	b.loft(
		b.pick(
			[ring(0.3, 0.1, 0.4), ring(0.5, 0.34, 0.8), ring(0.68, 0.24, 0.5), ring(0.7, 0.2, 0.11), ring(2.8, 0.2, 0.15), ring(2.82, 0.24, 0.5), ring(3, 0.34, 0.85), ring(3.15, 0.05, 0.4)],
			[ring(0.3, 0.2, 0.12), ring(3, 0.2, 0.14), ring(3.05, 0, 0.08)],
			[ring(0.2, 0.25, 0.13), ring(3.1, 0.25, 0.15)]
		),
		{ seg, pal: ROSE, deform: seat, palAt: (i) => (b.lod === 0 && (i < 2 || i > 4) ? GOLD : ROSE) }
	);
}

function buildBuckle(b: PartBuilder): void {
	// Point on the band: across, up, lifted off.
	const at = (z: number, y: number, out: number) => {
		const [f, , s] = cone(y);
		return hat((f + 0.24) * Math.sqrt(Math.max(0, 1 - (z / (s + 0.24)) ** 2)) * 0.4 + (f + 0.24) * 0.6 + out - z * z * 0.012, y, z);
	};
	const W = 1.95;
	const H = 1.85;
	const n = b.pick(20, 12, 8);
	// Rounded square frame.
	const frame = (k: number, out: number) =>
		Array.from({ length: n }, (_, i) => {
			const a = (i / n) * Math.PI * 2 + Math.PI / n;
			const e = b.lod === 2 ? 0.6 : 0.42;
			return at(Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** e * (W + k), 1.75 + Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** e * (H + k), out);
		});
	const prof = b.pick([[0.05, -0.1, 0.4], [0.02, 0.3, 0.75], [-0.22, 0.46, 1.2], [-0.45, 0.36, 0.95], [-0.62, 0.38, 1.1], [-0.72, -0.1, 0.45]], [[0.05, -0.1, 0.55], [-0.1, 0.45, 1.1], [-0.7, 0.35, 0.95], [-0.75, -0.1, 0.5]], [[0.1, 0, 0.8], [-0.1, 0.5, 1.1], [-0.8, 0.4, 1]]);
	sheet(b, prof.map(([k, out]) => frame(k!, out!)), GOLD, (i, j) => prof[i]![2]! * (b.lod === 0 ? 0.88 + 0.24 * rnd(j * 3 + i) : 1), true, hat(3, 1.75, 0));
	// Tongue.
	if (b.lod < 2) tube(b, [at(-1.5, 1.75, 0.2), at(-0.4, 1.78, 0.55), at(0.6, 1.75, 0.5), at(1.6, 1.75, 0.62)], [0.28, 0.24, 0.2, 0.1], { n: b.pick(5, 3, 2), seg: b.pick(5, 4, 3), pal: GOLD, shade: (_t, up) => 0.7 + 0.4 * Math.max(0, up) });
}

/** Cord fuse tucked in the band, its end burning. */
function buildFuse(b: PartBuilder): void {
	const at = (a: number, y: number, out: number) => {
		const [f, , s] = cone(Math.max(0, y));
		return hat(Math.cos(a) * (f + out), y, Math.sin(a) * (s + out));
	};
	const path = [at(0.62, 0.8, 0.25), at(0.72, 2.2, 0.5), at(0.8, 3.6, 0.45), at(0.95, 4.9, 0.6), at(0.82, 6.0, 1.0), at(0.6, 6.5, 1.5)];
	const n = b.pick(10, 5, 3);
	tube(b, path, [0.26, 0.26, 0.26, 0.26, 0.25, 0.2].map((r) => r * b.pick(1, 1.1, 1.5)), {
		n,
		seg: b.pick(4, 3, 3),
		pal: (i) => (i >= n ? EMBER : GOLD),
		// Twisted cord, charred near the end.
		shade: (t) => (b.lod === 0 ? (Math.round(t * n) % 2 ? 0.75 : 0.45) : 0.6) * lerp(1, 0.08, smooth(0.6, 0.85, t))
	});
	const e = path[5]!;
	b.ball([e.x, e.y, e.z], b.pick([0.34, 0.4, 0.34], [0.4, 0.45, 0.4], [0.65, 0.7, 0.65]), { w: HEAD, pal: EMBER, seg: b.pick(6, 5, 4), rings: b.pick(4, 3, 2) });
	if (b.lod === 2) return;
	// Sparks: thin spikes and a few loose flecks.
	const dirs = [[0.3, 1, 0.1], [0.9, 0.5, 0.2], [0.2, 0.45, 0.9], [0.4, 0.3, -0.9], [-0.2, 0.9, 0.6], [0.9, -0.2, 0.5], [0.1, 0.9, -0.6]] as const;
	dirs.slice(0, b.pick(7, 2, 0)).forEach(([x, y, z], i) => {
		const d = v(x, y, z).normalize();
		const len = 0.85 + 0.5 * rnd(i + 3);
		tube(b, [e.clone().addScaledVector(d, 0.15), e.clone().addScaledVector(d, len * 0.6), e.clone().addScaledVector(d, len)], [0.12, 0.08, 0.005], { n: 2, seg: 3, pal: EMBER, mid: v(-3, 60, 0.3), shade: () => 1 });
		if (b.lod === 0 && i % 2 === 0) {
			const p = e.clone().addScaledVector(d, len + 0.35);
			b.ball([p.x, p.y, p.z], [0.08, 0.1, 0.08], { w: HEAD, pal: EMBER, seg: 4, rings: 2 });
		}
	});
}

registerItemMesh('hat_fawkes', {
	hides: ['hair'],
	coversFace: true,
	colors: [0xf0e9dd, 0xdd8078, 0xc99a48, 0xff8a30],
	glow: [0, 0, 0, 0.75],
	build(b) {
		buildFace(b);
		buildEyes(b);
		buildBrows(b);
		buildMouth(b);
		buildBeard(b);
		buildCracks(b);
		buildHair(b);
		buildHat(b);
		buildBuckle(b);
		buildFuse(b);
	}
});
