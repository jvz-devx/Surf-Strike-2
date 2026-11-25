/**
 * Oni mask (docs/characters.md): a lacquered demon mask tied with a rope over a
 * dark hood. The face is one displaced sheet; its gloss is baked into the shade.
 */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, mix, PAL, sample, smooth, superellipse, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { HEAD } from '../shop-items.js';
import type { V3 } from '../skeleton.js';

const RED = PAL.hatA;
const DARK = PAL.hatB;
const GOLD = PAL.hatC;
const IVORY = PAL.hatD;

const MIRROR = [1, -1] as const;
const bump = (x: number, c: number, w: number): number => Math.exp(-(((x - c) / w) ** 2));
const rnd = (i: number): number => {
	const x = Math.sin(i * 91.7 + 12.3) * 43758.5453;
	return x - Math.floor(x);
};
const v3 = (p: V3): THREE.Vector3 => new THREE.Vector3(...p);
const MID = new THREE.Vector3(-0.4, 65.5, 0);

// ---------------------------------------------------------------------------
// Face

/** Mask profile: y, front x, half width. */
const PROFILE: readonly (readonly number[])[] = [
	[59.2, 3.9, 2.8],
	[59.6, 4.9, 3.6],
	[60.4, 5.4, 4.5],
	[61.6, 5.6, 5.2],
	[63, 5.65, 5.7],
	[64.5, 5.65, 6.0],
	[66, 5.6, 6.1],
	[67.5, 5.6, 6.1],
	[69, 5.4, 5.8],
	[70.3, 4.8, 5.1],
	[71.2, 4.0, 4.3]
];
const EDGE = 1.5;
const POW = 2.3;
const st: number[] = [];

/** Height of the brow ridge: low between the eyes, rising outwards. */
const browY = (z: number): number => 66.75 + 0.5 * Math.max(0, z - 0.5) - 0.11 * Math.max(0, z - 2.4) ** 2;
/** Crease from the nostril around the mouth. */
const foldZ = (y: number): number => 1.6 + (64.2 - y) * 0.95 - 0.1 * Math.max(0, 62.6 - y) ** 2;

/** Point on the mask at angle `a` (0 front, π/2 right); `out` lifts it off. */
function face(a: number, y: number, out = 0): THREE.Vector3 {
	sample(PROFILE, y, st);
	const e = 2 / POW;
	const c = Math.max(0, Math.cos(a));
	const s = Math.sin(a);
	const p = new THREE.Vector3(st[1]! * c ** e, y, st[2]! * Math.sign(s) * Math.abs(s) ** e);
	const z = Math.abs(p.z);
	let d = 0;
	// Overhanging brow, pinched in the middle.
	const by = browY(z);
	d += 1.15 * Math.exp(-(((y - by - 0.25) / (y > by ? 0.75 : 0.42)) ** 2)) * bump(z, 1.6, 2.0) * smooth(0.1, 0.6, z);
	d += 0.75 * bump(z, 0.42, 0.22) * bump(y, 67.2, 0.75);
	// Sunken eyes.
	d -= 0.75 * bump(z, 2.15, 1.05) * bump(y, 65.95, 0.62);
	// Full cheeks, hollow below.
	d += 0.85 * bump(z, 3.5, 1.15) * bump(y, 64.3, 0.95);
	d -= 0.35 * bump(z, 4.1, 0.8) * bump(y, 62.4, 0.8);
	// Deep creases beside the nose and mouth, and under the eyes.
	d -= 0.42 * bump(z, foldZ(y), 0.3) * smooth(61, 61.8, y) * (1 - smooth(64.2, 64.8, y));
	d -= 0.22 * bump(y, 65.1 + 0.12 * (z - 2) ** 2, 0.2) * bump(z, 2.4, 1.1);
	// Nose: broad bridge, flared tip, wrinkles across the top.
	const along = smooth(66.9, 64.3, y) * smooth(63.4, 63.85, y);
	d += (0.5 + 1.35 * along) * bump(z, 0, 0.6 + 0.45 * along) * smooth(67.2, 66.2, y) * smooth(63.35, 63.8, y);
	d += 0.75 * bump(y, 64.1, 0.5) * bump(z, 1.15, 0.5);
	d -= 0.2 * (bump(y, 66.1, 0.16) + bump(y, 65.6, 0.14)) * bump(z, 0, 0.7);
	// Muzzle and chin.
	d += 0.5 * bump(y, 62, 1.3) * bump(z, 0, 2.6);
	d += 0.55 * bump(y, 59.9, 0.6) * bump(z, 0, 1.4);
	// Forehead: arched furrows and the roots of the horns.
	d += 0.26 * Math.sin((y - 68.2 - z * z * 0.05) * 5.6) * smooth(67.9, 68.3, y) * (1 - smooth(70.2, 70.7, y)) * bump(z, 0, 2.4);
	d += 0.7 * bump(y, 70.1, 0.95) * bump(z, 2.75, 1.1);
	const f = smooth(0.2, 2.4, p.x);
	p.x += d * f;
	p.z += d * 0.3 * Math.sign(p.z) * smooth(1.5, 4, z) * f;
	// In front of the player's own eyes.
	if (y > 65 && y < 67.2 && z < 3.2) p.x = Math.max(p.x, 4.85 - 0.5 * Math.max(0, z - 2.2));
	if (out) {
		const l = Math.hypot(p.x, p.z) || 1;
		p.x += (p.x / l) * out;
		p.z += (p.z / l) * out;
	}
	return p;
}

function angleAt(y: number, z: number): number {
	sample(PROFILE, y, st);
	return Math.sign(z) * Math.asin(Math.min(0.999, Math.abs(z) / st[2]!) ** (POW / 2));
}
/** Point on the face by height and side distance. */
const on = (y: number, z: number, out = 0): THREE.Vector3 => face(angleAt(y, z), y, out);

/** Baked lacquer: reflections, dark creases, soot around the eyes. */
function lacquer(a: number, y: number, p: THREE.Vector3): number {
	const e = 0.1;
	const da = face(a + 0.02, y).sub(face(a - 0.02, y));
	const dy = face(a, y + e).sub(face(a, y - e));
	const n = dy.cross(da).normalize();
	if (n.dot(new THREE.Vector3(p.x, 0, p.z)) < 0) n.negate();
	const lobe = (x: number, yy: number, z: number, k: number) => Math.max(0, (n.x * x + n.y * yy + n.z * z) / Math.hypot(x, yy, z)) ** k;
	let s = 0.68 + 0.75 * lobe(0.7, 0.65, 0.3, 14) + 0.4 * lobe(0.6, 0.4, -0.7, 18) + 0.3 * smooth(-0.2, 0.7, n.y) - 0.3 * smooth(0.1, 0.8, -n.y);
	const z = Math.abs(p.z);
	s *= 1 - 0.85 * bump(z, 2.15, 1.25) * bump(y, 65.95, 0.7);
	s *= 1 - 0.72 * bump(z, foldZ(y), 0.42) * smooth(61, 61.8, y) * (1 - smooth(64.3, 64.9, y));
	s *= 1 - 0.55 * smooth(0.2, 1, -Math.sin((y - 68.2 - z * z * 0.05) * 5.6)) * smooth(67.9, 68.3, y) * (1 - smooth(70, 70.6, y)) * bump(z, 0, 2.6);
	s *= 1 - 0.55 * bump(z, foldZ(y) + 1.25, 0.34) * smooth(61.4, 62.2, y) * (1 - smooth(63.6, 64.2, y));
	s *= 1 - 0.5 * bump(y, 65.15 + 0.1 * (z - 2) ** 2, 0.2) * bump(z, 2.6, 1.2);
	s *= 1 - 0.5 * bump(z, 0.05, 0.16) * bump(y, 67.3, 0.6);
	s *= 1 - 0.8 * bump(y, 63.68, 0.2) * bump(z, 0.85, 0.5);
	return Math.max(0.1, Math.min(1.27, s * lerp(0.7, 1, smooth(59.4, 61, y))));
}

/** Rounded outline: the jaw rises and the forehead drops to the sides. */
const outline = (a: number, y: number): number => y + ((1 - smooth(59.4, 62.5, y)) * 1.3 - smooth(68.6, 71, y) * 1.1) * (a / EDGE) ** 2;

function buildFace(b: PartBuilder): void {
	const cols = b.pick(19, 9, 7);
	const ys = b.pick(
		[59.5, 60.2, 60.9, 61.7, 62.6, 63.3, 63.7, 64.05, 64.45, 64.95, 65.45, 65.95, 66.4, 66.8, 67.2, 67.92, 68.48, 69.04, 69.6, 70.2, 71],
		[59.5, 61, 62.6, 63.6, 64.2, 65.2, 65.95, 66.8, 67.5, 69, 71],
		[59.4, 61.6, 64.1, 65.9, 67.2, 69, 71]
	);
	const shade = new Map<THREE.Vector3, number>();
	const rows = ys.map((y) => {
		const row: THREE.Vector3[] = [];
		for (let j = 0; j < cols; j++) {
			const u = (j / (cols - 1)) * 2 - 1;
			const a = (u * 0.62 + u * u * u * 0.38) * EDGE;
			const yy = outline(a, y);
			const p = face(a, yy);
			shade.set(p, lacquer(a, yy, p));
			row.push(p);
		}
		// The forehead tucks into the hood.
		if (y === 71 && b.lod < 2) for (const p of row) p.multiply(new THREE.Vector3(0.93, 1, 0.93));
		if (b.lod === 2) return row;
		// Thickness of the rim.
		const rim = MIRROR.map((m) => {
			const p = face(EDGE * m, outline(EDGE, y), -0.55);
			p.x -= 0.25;
			shade.set(p, 0.3);
			return p;
		});
		return [rim[1]!, ...row, rim[0]!];
	});
	// Rim below the chin.
	if (b.lod < 2)
		rows.unshift(
			rows[0]!.map((p) => {
				const q = new THREE.Vector3(p.x * 0.75 - 0.2, p.y + 0.3, p.z * 0.8);
				shade.set(q, 0.3);
				return q;
			})
		);
	b.grid(rows, { w: HEAD, pal: RED, flip: true, shadeAt: (p) => shade.get(p)! });
}

// ---------------------------------------------------------------------------
// Tubes: horns, fangs, locks, lips, rope

interface TubeOptions {
	pal: number;
	seg: number;
	n: number;
	flat?: number;
	/** Shade along the tube and by how far it faces outwards (-1..1). */
	shade: (t: number, out: number) => number;
	/** Closed loop; otherwise it starts open (out of sight) and ends in a point. */
	loop?: boolean;
}

function tube(b: PartBuilder, path: readonly THREE.Vector3[], r: (t: number) => number, o: TubeOptions): void {
	const curve = new THREE.CatmullRomCurve3([...path], o.loop);
	const shade = new Map<THREE.Vector3, number>();
	const rows = Array.from({ length: o.n + 1 }, (_, i) => {
		const t = i / o.n;
		const c = curve.getPoint(t);
		const dir = curve.getTangent(t);
		const out = c.clone().sub(MID).normalize();
		const side = dir.clone().cross(out).normalize();
		out.copy(side).cross(dir).normalize();
		const rad = Math.max(0.015, r(t));
		return Array.from({ length: o.seg }, (_x, j) => {
			const a = (j / o.seg) * Math.PI * 2 + (o.seg === 3 ? Math.PI / 2 : 0);
			const p = c.clone().addScaledVector(side, Math.cos(a) * rad).addScaledVector(out, Math.sin(a) * rad * (o.flat ?? 1));
			shade.set(p, o.shade(t, Math.sin(a)));
			return p;
		});
	});
	b.grid(rows, { w: HEAD, pal: o.pal, wrap: true, flip: true, shadeAt: (p) => shade.get(p)! });
}

function buildHorns(b: PartBuilder): void {
	for (const m of MIRROR) {
		const path = [v3([3.7, 69.6, 2.6 * m]), v3([4.5, 71.2, 3.5 * m]), v3([4.5, 73.4, 4.5 * m]), v3([3.6, 75.6, 4.7 * m]), v3([2.0, 77.6, 3.9 * m])];
		const ring = (t: number) => (b.lod === 0 && t > 0.08 && t < 0.7 ? 0.07 * Math.cos(t * Math.PI * 2 * 4.5) : 0);
		tube(b, path, (t) => 1.3 * (1 - t) ** 0.8 * (1 + ring(t)) + 0.02, {
			pal: IVORY,
			seg: b.pick(7, 4, 3),
			n: b.pick(9, 4, 3),
			shade: (t, o) => lerp(0.13, 1.15, smooth(0.22, 0.85, t)) * (0.86 + 0.16 * o) * (1 + 2 * Math.min(0, ring(t)))
		});
	}
}

function buildEyes(b: PartBuilder): void {
	for (const m of MIRROR) {
		const c = on(66, 2.1 * m);
		const rot: V3 = [-0.22 * m, 0, 0];
		const x = c.x - (b.lod === 2 ? 0.1 : 0.12);
		b.ball([x, 66.02, c.z], [0.5, b.lod === 2 ? 0.7 : 0.52, 1.02], { w: HEAD, pal: GOLD, seg: b.pick(7, 4, 4), rings: b.pick(4, 2, 2), rot, shade: 1.1 });
		if (b.lod < 2) b.ball([x + 0.31, 66.04, c.z - 0.22 * m], [0.24, 0.34, 0.27], { w: HEAD, pal: DARK, seg: b.pick(5, 4, 4), rings: 2, shade: 0.3 });
	}
}

/** Edge of the mouth by side distance: upper and lower lip meet at the corners. */
const MOUTH = 3.35;
const upper = (z: number): number => 62.75 + 0.45 * bump(z, 1.7, 0.9) - 0.1 * smooth(2.4, MOUTH, z);
const lower = (z: number): number => lerp(60.75 + 0.1 * z, 62.65, smooth(1.6, MOUTH, z) ** 1.3);

function buildMouth(b: PartBuilder): void {
	// Dark inside.
	const cols = b.pick(11, 6, 5);
	const zs = Array.from({ length: cols }, (_, j) => ((j / (cols - 1)) * 2 - 1) * MOUTH);
	const rows = b.pick([0, 0.5, 1], [0, 1], [0, 1]).map((k) => zs.map((z) => on(lerp(lower(Math.abs(z)), upper(Math.abs(z)), k), z, b.pick(0.14, 0.25, 0.45))));
	b.grid(rows, { w: HEAD, pal: DARK, flip: true, shadeAt: () => 0.3 });
	if (b.lod < 2) {
		// Lips around it.
		const loop: THREE.Vector3[] = [];
		const n = b.pick(9, 5, 0);
		for (let i = 0; i < n; i++) {
			const z = (1 - (i / n) * 2) * MOUTH;
			loop.push(on(upper(Math.abs(z)), z, 0.16));
		}
		for (let i = 0; i < n; i++) {
			const z = ((i / n) * 2 - 1) * MOUTH;
			loop.push(on(lower(Math.abs(z)), z, 0.16));
		}
		tube(b, loop, () => 0.34, { pal: RED, seg: 3, n: b.pick(20, 8, 0), loop: true, shade: (_t, o) => 0.5 + 0.38 * o });
	}
	const fang = (path: V3[], r: number, seg: number, n: number) => tube(b, path.map(v3), (t) => r * (1 - t) ** 0.75, { pal: GOLD, seg, n, shade: (t, o) => (0.75 + 0.35 * t) * (0.85 + 0.2 * o) });
	for (const m of MIRROR) {
		// Big fangs up over the upper lip, smaller ones down.
		const a = on(60.95, 2.3 * m, 0.35);
		const c = on(63, 2.75 * m, 0.95);
		const t = on(64.9, 3.05 * m, 0.85);
		fang([[a.x - 0.2, 60.9, a.z], [a.x + 0.45, 61.9, 2.55 * m], [c.x, 63.2, c.z], [t.x, 64.9, t.z]], b.lod === 2 ? 0.7 : 0.62, b.pick(5, 3, 3), b.pick(4, 2, 2));
		if (b.lod === 2) continue;
		const u = on(62.9, 1.45 * m, 0.25);
		fang([[u.x - 0.05, 63, u.z], [u.x + 0.28, 62.2, u.z * 1.02], [u.x + 0.2, 61.15, u.z * 1.04]], 0.44, b.pick(4, 3, 3), b.pick(3, 1, 1));
	}
	// Gold teeth.
	const tooth = (z: number, y: number, h: number, w: number) => {
		const row = (k: number) => [-0.5, -0.4, 0.4, 0.5].map((e, q) => on(y + (k * h) / 2, z + e * w * (1 - 0.12 * Math.abs(k)), q % 3 ? 0.42 : 0.1));
		b.grid([row(-1), row(1)], { w: HEAD, pal: GOLD, flip: true, shadeAt: (p) => (p.y > 61.8 === p.y > y ? 0.6 : 0.95) });
	};
	if (b.lod === 2) return;
	const top = b.pick([-2.3, -0.72, -0.24, 0.24, 0.72, 2.3], [-0.5, 0.5], []);
	for (const z of top) tooth(z, upper(Math.abs(z)) - 0.38, 0.62, b.lod ? 0.9 : Math.abs(z) > 2 ? 0.5 : 0.42);
	const low = b.pick([-1.32, -0.8, -0.27, 0.27, 0.8, 1.32], [-0.7, 0.7], []);
	for (const z of low) tooth(z, lower(Math.abs(z)) + 0.34, 0.56, b.lod ? 1.2 : 0.45);
}

function buildLocks(b: PartBuilder): void {
	const lock = (path: V3[], r: number, s: number, seg: number, n: number) => tube(b, path.map(v3), (t) => r * (0.55 + 1.5 * t - 2.05 * t * t) * 1.15, { pal: DARK, seg, n, flat: 0.7, shade: (t, o) => s * (0.75 + 0.35 * o) * lerp(0.8, 1.15, t) });
	for (const m of MIRROR) {
		// Shaggy brows: overlapping tufts, the outer ones flicking out past the mask.
		const brows = b.pick(5, 2, 2);
		for (let i = 0; i < brows; i++) {
			const k = i / (brows - 1);
			const z = lerp(0.75, 3.6, k);
			const p = on(browY(z) + 0.15, z * m, 0.2);
			const len = lerp(1.1, 1.9, k) * (0.8 + 0.4 * rnd(i + 3));
			lock([[p.x - 0.35, p.y - 0.25, p.z - 0.35 * m], [p.x + 0.35, p.y + len * 0.3, p.z + 0.35 * m], [p.x + 0.05 - 0.6 * k, p.y + len * 0.85, p.z + len * (0.65 + 0.3 * k) * m], [p.x - 0.3 - 1.1 * k, p.y + len * 1.15, p.z + len * (1.0 + 0.55 * k) * m]], b.pick(0.78, 0.8, 0.85), 1.05 + 0.5 * rnd(i + 60), 3, b.pick(3, 2, 2));
		}
		// Side hair: wild tufts from behind the rim, flaring out.
		const sides = b.pick(5, 3, 2);
		for (let i = 0; i < sides; i++) {
			const k = i / (sides - 1);
			const y = lerp(70.2, 63.6, k);
			const r = rnd(i + 11 + (m > 0 ? 40 : 0));
			const x = 1.0 - 0.9 * (i % 2) + 0.3 * r;
			const z = (4.4 + 1.4 * smooth(70.6, 67, y)) * (1 - 0.1 * smooth(64, 61, y));
			const end = Math.max(60.1, y - 4.6 - r * 1.2);
			lock([[x + 0.3, y, (z - 0.9) * m], [x, y - 0.4, (z + 0.8) * m], [x - 0.6, y - 2.1, (z + 1.6) * m], [x - 1.1 - r, end + 0.5, (z + 1.5) * m], [x - 2 - r, end, (z + 2.5 + r * 0.7) * m]], b.pick(1.15, 1.35, 1.7), 0.85 + 0.45 * r, 3, b.pick(4, 2, 2));
		}
	}
}

// ---------------------------------------------------------------------------
// Hood and rope

/** Hood: y, front x, back x, half width, extra in the middle of the back. */
const HOOD: readonly (readonly number[])[] = [
	[58.9, 2.5, 4.3, 3.1, 4.0],
	[60.2, 3.6, 5, 4.6, 4.2],
	[61.6, 4.4, 5.7, 5.2, 3.9],
	[63.2, 4.7, 6.4, 5.5, 3.3],
	[64.8, 4.7, 7.1, 5.6, 2.6],
	[66.4, 4.7, 7.2, 5.75, 1.7],
	[68, 4.7, 7, 5.7, 0.8],
	[69.6, 4.5, 6.2, 5.1, 0],
	[71, 3.8, 5, 4.3, 0],
	[72.1, 2.5, 3.4, 2.9, 0],
	[72.7, 0.9, 1.2, 1.1, 0]
];

function hood(a: number, y: number, out = 0): THREE.Vector3 {
	sample(HOOD, y, st);
	const [c, s] = superellipse(a, 2.6);
	const x = c > 0 ? (st[1]! + out) * c : (st[2]! + out + st[4]! * bump(s, 0, 0.5)) * c;
	return new THREE.Vector3(x - 0.3, y, (st[3]! + out) * s);
}

/** The hem follows the neck, like the hair under it. */
const hemWeight = (y: number): Weights => (y > 62.4 ? HEAD : mix('head', 'neck', 0.6 * (1 - smooth(59, 62.4, y))));

function buildHood(b: PartBuilder): void {
	const seg = b.pick(16, 10, 8);
	const ys = b.pick([58.9, 60.6, 62.8, 65, 67.2, 69.6, 71.4, 72.6], [58.9, 61.6, 65.5, 69.5, 72.4], [58.9, 63, 67.5, 71.8]);
	b.loft(
		[59.5, ...ys].map((y): Ring => ({ c: [0, y, 0], f: 1, s: 1, w: HEAD })),
		{
			seg,
			pal: DARK,
			capEnd: true,
			deform: (p, _t, a, i) => {
				p.copy(i ? hood(a, ys[i - 1]!) : hood(a, ys[0]!).multiply(new THREE.Vector3(0.32, 1, 0.6)).setY(59.6));
				// Fewer corners: room for a ponytail.
				if (b.lod > 0 && i && p.x < -2) p.x -= b.pick(0, 0.25, 0.6);
				// Soft folds.
				if (b.lod === 0 && i > 1 && p.x < -1) p.x -= 0.16 * Math.sin(Math.sin(a) * 9 + p.y * 0.8);
			},
			weightAt: (p) => hemWeight(p.y),
			shadeAt: (p, a, i) => (i === 0 ? 0.4 : 1) * lerp(0.75, 1.1, smooth(60, 70, p.y)) * (b.lod === 0 ? 1 + 0.14 * Math.sin(Math.sin(a) * 9 + p.y * 0.8 + 1) : 1)
		}
	);
	// Around the neck, down into the collar (the player's own neck is hidden).
	const w = (t: number): Weights => (t < 0.5 ? mix('chest', 'neck', t * 2) : mix('neck', 'head', (t - 0.5) * 2));
	b.loft(
		[
			{ c: [-0.6, 56, 0], f: 2.7, s: 3.1, w: w(0.1), shade: 0.6 },
			{ c: [-0.5, 58.9, 0], f: 2.45, s: 2.55, w: w(0.5), shade: 0.75 },
			{ c: [-0.2, 61.5, 0], f: 2.8, s: 2.8, w: w(1), shade: 0.5 }
		],
		{ seg: b.pick(8, 6, 6), pal: DARK }
	);
}

function buildRope(b: PartBuilder): void {
	// A closed loop; the front runs hidden behind the mask.
	const y = (a: number) => 67 - 0.5 * Math.cos(a);
	const loop = Array.from({ length: 14 }, (_, i) => {
		const a = -(i / 14) * Math.PI * 2;
		return hood(a, y(a), Math.cos(a) > 0.1 ? -0.4 : b.pick(0.3, 0.5, 1));
	});
	const n = b.pick(16, 8, 6);
	tube(b, loop, () => b.pick(0.46, 0.5, 0.6), { pal: IVORY, seg: b.pick(4, 3, 3), n, loop: true, shade: (t, o) => (0.72 + 0.12 * o) * (b.lod === 0 && Math.round(t * n) % 2 ? 0.62 : 1) });
	if (b.lod === 2) return;
	const k = hood(Math.PI, y(Math.PI), 0.45);
	b.ball([k.x - 0.1, k.y, 0], [0.7, 0.75, 0.85], { w: HEAD, pal: IVORY, seg: b.pick(5, 4, 4), rings: b.pick(3, 2, 2), shade: 0.75 });
	if (b.lod === 1) return;
	for (const m of MIRROR) {
		const p = (yy: number, z: number, o = 0.35): THREE.Vector3 => {
			const q = hood(Math.PI - Math.asin(z / 6.5), yy, o);
			return q.setZ(z);
		};
		// Bow and loose ends.
		tube(b, [p(k.y, 0.2 * m), p(k.y + 0.8, 1.6 * m, 0.5), p(k.y + 0.1, 2.7 * m, 0.5), p(k.y - 0.6, 1.5 * m, 0.5), p(k.y - 0.1, 0.2 * m)], () => 0.3, { pal: IVORY, seg: 3, n: 6, shade: (t, o) => (0.7 + 0.15 * o) * (Math.round(t * 6) % 2 ? 0.75 : 1) });
		tube(b, [p(k.y - 0.2, 0.3 * m), p(65, 0.9 * m), p(62.9 - 0.4 * m, 1.1 * m, 0.4)], (t) => 0.34 + 0.1 * t, { pal: IVORY, seg: 3, n: 3, shade: (t, o) => (0.7 + 0.15 * o) * (Math.round(t * 3) % 2 ? 0.75 : 1) });
	}
}

registerItemMesh('hat_oni', {
	hides: ['hair', 'neck'],
	coversFace: true,
	colors: [0xb3161a, 0x2a262e, 0xe3ad35, 0xdccba4],
	glow: [0, 0, 0.4, 0],
	build(b) {
		buildHood(b);
		buildFace(b);
		buildEyes(b);
		buildMouth(b);
		buildHorns(b);
		buildLocks(b);
		buildRope(b);
	}
});
