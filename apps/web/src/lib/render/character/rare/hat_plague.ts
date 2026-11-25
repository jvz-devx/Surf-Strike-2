/**
 * Plague doctor mask (docs/characters.md): a stitched leather beak with brass
 * goggles, a hood over head and neck, and a flat wide-brimmed hat.
 */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, mix, PAL, sample, smooth, superellipse, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { HEAD } from '../shop-items.js';
import type { V3 } from '../skeleton.js';

const LEATHER = PAL.hatA;
const BLACK = PAL.hatB;
const BRASS = PAL.hatC;
const LENS = PAL.hatD;

const MIRROR = [1, -1] as const;
const bump = (x: number, c: number, w: number): number => Math.exp(-(((x - c) / w) ** 2));
const st: number[] = [];

/** Grid facing away from `mid`. */
function sheet(b: PartBuilder, pts: THREE.Vector3[][], pal: number, shadeAt: (p: THREE.Vector3, i: number) => number, wrap = false, mid = new THREE.Vector3(0, 65, 0)): void {
	let sum = 0;
	for (let i = 0; i < pts.length - 1; i++)
		for (let j = 0; j < pts[i]!.length - 1; j++) {
			const p = pts[i]![j]!;
			sum += pts[i]![j + 1]!.clone().sub(p).cross(pts[i + 1]![j]!.clone().sub(p)).dot(p.clone().sub(mid));
		}
	b.grid(pts, { w: HEAD, pal, wrap, flip: sum < 0, shadeAt });
}

// ---------------------------------------------------------------------------
// Hood

/** y, front x, back x, half width, extra in the middle of the back. */
const HOOD: readonly (readonly number[])[] = [
	[58.9, 2.7, 4.3, 3.3, 4.0],
	[60.2, 3.9, 5, 4.6, 4.2],
	[61.6, 4.7, 5.7, 5.1, 3.9],
	[63.2, 5, 6.4, 5.4, 3.3],
	[64.8, 5.1, 7.1, 5.6, 2.6],
	[66.4, 5.1, 7.4, 5.85, 1.6],
	[68, 5.1, 7.1, 5.75, 0.8],
	[69.6, 4.9, 6.2, 5.2, 0],
	[71, 4, 5, 4.3, 0]
];

function hood(a: number, y: number, out = 0): THREE.Vector3 {
	sample(HOOD, y, st);
	const [c, s] = superellipse(a, 2.5);
	const x = c > 0 ? (st[1]! + out) * c : (st[2]! + out + st[4]! * bump(s, 0, 0.5)) * c;
	return new THREE.Vector3(x, y, (st[3]! + out) * s);
}

const hemWeight = (y: number): Weights => (y > 62.4 ? HEAD : mix('head', 'neck', 0.6 * (1 - smooth(59, 62.4, y))));

function buildHood(b: PartBuilder): void {
	const ys = b.pick([58.9, 60.4, 62, 64, 66, 68, 69.6, 71], [58.9, 61, 64.5, 67.8, 70.5], [58.9, 63, 67, 70.5]);
	const fold = (p: THREE.Vector3) => Math.sin(Math.atan2(p.z, -p.x) * 8 + p.y * 0.7);
	b.loft(
		[59.5, ...ys].map((y): Ring => ({ c: [0, y, 0], f: 1, s: 1, w: HEAD })),
		{
			seg: b.pick(20, 10, 8),
			pal: BLACK,
			deform: (p, _t, a, i) => {
				p.copy(i ? hood(a, ys[i - 1]!) : hood(a, ys[0]!).multiply(new THREE.Vector3(0.32, 1, 0.6)).setY(59.6));
				// Fewer corners: room for a ponytail.
				if (b.lod > 0 && i && p.x < -2) p.x -= b.pick(0, 0.25, 0.6);
				if (b.lod === 0 && i > 1 && p.x < 0.5 && p.y < 69) p.x -= 0.12 + 0.12 * fold(p);
			},
			weightAt: (p) => hemWeight(p.y),
			shadeAt: (p, _a, i) => (i === 0 ? 0.35 : 1) * lerp(0.75, 1.15, smooth(60, 70, p.y)) * (b.lod === 0 && p.x < 0.5 ? 1 - 0.2 * fold(p) : 1)
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
		{ seg: b.pick(10, 6, 6), pal: BLACK }
	);
}

// ---------------------------------------------------------------------------
// Beak

/** Along the beak `t` 0 at the face … 1 at the tip: centre x, y; up, down, half width. */
const BEAK: readonly (readonly number[])[] = [
	[0, 3.6, 65.4, 3.75, 4.9, 5.0],
	[0.12, 5.2, 65.2, 3.1, 4.3, 4.4],
	[0.26, 6.7, 64.6, 1.95, 3.1, 2.7],
	[0.42, 8.7, 64.0, 1.65, 2.25, 2.1],
	[0.6, 11.1, 63.15, 1.5, 1.7, 1.75],
	[0.78, 13.4, 61.75, 1.15, 1.25, 1.25],
	[0.92, 15.0, 60.2, 0.75, 0.8, 0.78],
	[1, 15.7, 58.95, 0.12, 0.2, 0.18]
];

/** Point on the beak: `a` 0 up, π/2 to the right, π down. */
function beak(t: number, a: number, out = 0): THREE.Vector3 {
	sample(BEAK, t, st);
	const [x, y, up, down, wide] = [st[1]!, st[2]!, st[3]!, st[4]!, st[5]!];
	sample(BEAK, Math.min(1, t + 0.04), st);
	const x1 = st[1]!;
	const y1 = st[2]!;
	sample(BEAK, Math.max(0, t - 0.04), st);
	const l = Math.hypot(x1 - st[1]!, y1 - st[2]!);
	// Sections start upright at the face and then follow the curve.
	const lean = smooth(0.1, 0.45, t);
	const nx = (-(y1 - st[2]!) / l) * lean;
	const ny = lerp(1, (x1 - st[1]!) / l, lean);
	const c = Math.cos(a);
	const s = Math.sin(a);
	// A ridge on top, flattened flanks.
	const e = lerp(0.85, 1.08, lean);
	const h = ((c > 0 ? up : down) + out) * Math.sign(c) * Math.abs(c) ** e;
	let z = (wide + out) * Math.sign(s) * Math.abs(s) ** e;
	// Pinched between the goggles.
	z *= 1 - 0.1 * lean * Math.max(0, c);
	return new THREE.Vector3(x + nx * h, y + ny * h, z);
}

const hide = (t: number, a: number, p: THREE.Vector3): number => {
	const c = Math.cos(a);
	const s = Math.abs(Math.sin(a));
	// Waxed leather: worn ridge, dark seams and wrinkles where it bends.
	let k = 0.82 + 0.16 * Math.sin(p.x * 2.1 + p.z * 1.3) * Math.sin(p.y * 1.9 - p.z * 0.8);
	k += 0.3 * Math.max(0, c) ** 3 + 0.12 * s * smooth(-0.2, 0.5, c) - 0.32 * Math.max(0, -c);
	k *= 1 - 0.3 * bump(t, 0.33, 0.05) * (1 - 0.5 * s);
	k *= lerp(0.72, 1.05, smooth(0, 0.14, t)) * lerp(1, 0.7, smooth(0.88, 1, t));
	return Math.max(0.2, Math.min(1.27, k));
};

function buildBeak(b: PartBuilder): void {
	const seg = b.pick(18, 10, 6);
	const ts = b.pick([0, 0.07, 0.14, 0.2, 0.26, 0.33, 0.42, 0.51, 0.6, 0.69, 0.78, 0.86, 0.94, 1], [0, 0.13, 0.26, 0.42, 0.62, 0.82, 1], [0, 0.2, 0.42, 0.75, 1]);
	const shade = new Map<THREE.Vector3, number>();
	const rows = ts.map((t) =>
		Array.from({ length: seg }, (_, j) => {
			const a = (j / seg) * Math.PI * 2;
			const p = beak(t, a);
			shade.set(p, hide(t, a, p));
			return p;
		})
	);
	if (b.lod < 2) {
		// Edge of the mask.
		rows.unshift(Array.from({ length: seg }, (_, j) => {
			const p = beak(0, (j / seg) * Math.PI * 2, -0.5);
			p.x -= 0.2;
			shade.set(p, 0.25);
			return p;
		}));
	}
	sheet(b, rows, LEATHER, (p) => shade.get(p)!, true, new THREE.Vector3(8, 63.6, 0));
	if (b.lod > 0) return;

	// Raised seams along the ridge and the flanks.
	const seam = (a: number, t0: number, t1: number, n: number, wide: number) =>
		sheet(b, Array.from({ length: n + 1 }, (_, i) => {
			const t = lerp(t0, t1, i / n);
			const da = wide * (1 + t);
			return [beak(t, a - da, 0.02), beak(t, a, 0.17), beak(t, a + da, 0.02)];
		}), LEATHER, () => 0.42, false, new THREE.Vector3(8, 63.6, 0));
	seam(0, 0.15, 0.97, 8, 0.1);
	for (const m of MIRROR) seam(1.95 * m, 0.14, 0.9, 7, 0.055);
	// Stitches: thin pale bars across the seams and around the edge.
	const stitch = (p0: THREE.Vector3, p1: THREE.Vector3, along: THREE.Vector3) => {
		const d = along.clone().normalize().multiplyScalar(0.085);
		sheet(b, [[p0.clone().sub(d), p0.clone().add(d)], [p1.clone().sub(d), p1.clone().add(d)]], BRASS, () => 1.05, false, new THREE.Vector3((p0.x + p1.x) / 2 - 1.2, 63.6, 0));
	};
	for (let i = 0; i < 12; i++) {
		const t = 0.19 + i * 0.063;
		const along = beak(t + 0.03, 0, 0).sub(beak(t - 0.03, 0, 0));
		const w = 0.2 + 0.15 * t;
		stitch(beak(t, -w, 0.16), beak(t + 0.012, w, 0.16), along);
	}
	for (const m of MIRROR) {
		for (let i = 0; i < 9; i++) {
			const t = 0.18 + i * 0.077;
			const along = beak(t + 0.03, 1.95 * m).sub(beak(t - 0.03, 1.95 * m));
			stitch(beak(t, 1.83 * m, 0.14), beak(t + 0.01, 2.07 * m, 0.14), along);
		}
		for (let i = 0; i < 7; i++) {
			const a = (0.35 + i * 0.36) * m;
			stitch(beak(0.03, a, 0.08), beak(0.085, a, 0.1), beak(0.05, a + 0.1).sub(beak(0.05, a - 0.1)));
		}
		// Breathing slits.
		for (let i = 0; i < 3; i++) {
			const t = 0.52 + i * 0.075;
			const row = (a: number) => [beak(t - 0.016, a * m, 0.05), beak(t + 0.016, a * m, 0.05)];
			sheet(b, [row(1.2), row(1.45), row(1.65)], BLACK, () => 0.25, false, new THREE.Vector3(10, 63, 0));
		}
	}
}

// ---------------------------------------------------------------------------
// Goggles

const GOGGLE: V3 = [6.35, 66.4, 2.5];

function buildGoggles(b: PartBuilder): void {
	for (const m of MIRROR) {
		const u = new THREE.Vector3(0, 1, 0);
		const n = new THREE.Vector3(0.9, 0.06, 0.42 * m).normalize();
		const side = n.clone().cross(u).normalize();
		const up = side.clone().cross(n).normalize();
		const c = new THREE.Vector3(GOGGLE[0], GOGGLE[1], GOGGLE[2] * m);
		const ring = (r: number, h: number, seg: number) => Array.from({ length: seg }, (_, j) => {
			const a = (j / seg) * Math.PI * 2;
			return c.clone().addScaledVector(n, h).addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r);
		});
		const seg = b.pick(14, 8, 7);
		// Leather cup, brass rim, lens.
		const at = (p: THREE.Vector3) => 0.72 + 0.4 * smooth(-1.2, 1.5, p.y - c.y + (p.x - c.x) * 0.3);
		if (b.lod === 0) sheet(b, [ring(2.15, -2.4, seg), ring(1.85, -0.3, seg)], LEATHER, () => 0.5, true, c.clone().addScaledVector(n, -3));
		sheet(b, b.pick([ring(1.8, -0.6, seg), ring(1.82, 0.3, seg), ring(1.6, 0.55, seg), ring(1.32, 0.42, seg), ring(1.28, 0.1, seg)], [ring(1.95, -2, seg), ring(1.8, 0.35, seg), ring(1.3, 0.4, seg)], [ring(1.95, -2, seg), ring(1.8, 0.35, seg), ring(1.3, 0.4, seg)]), BRASS, at, true, c.clone().addScaledVector(n, -3));
		const lens = b.pick([ring(1.3, 0.14, seg), ring(0.8, 0.42, seg), ring(0, 0.52, seg)], [ring(1.32, 0.3, seg), ring(0, 0.55, seg)], [ring(1.35, 0.4, seg), ring(0, 0.6, seg)]);
		sheet(b, lens, LENS, (p) => 0.7 + 0.5 * smooth(-0.3, 1.2, p.y - c.y + (p.z - c.z) * 0.4), true, c.clone().addScaledVector(n, -4));
		if (b.lod > 0) continue;
		// Rivets around the rim.
		for (let i = 0; i < 6; i++) {
			const a = (i / 6) * Math.PI * 2 + 0.5;
			const p = c.clone().addScaledVector(n, 0.5).addScaledVector(side, Math.cos(a) * 1.63).addScaledVector(up, Math.sin(a) * 1.63);
			b.ball([p.x, p.y, p.z], [0.16, 0.16, 0.16], { w: HEAD, pal: BRASS, seg: 4, rings: 2, shade: 1.25 });
		}
	}
}

// ---------------------------------------------------------------------------
// Straps and hat

function buildStraps(b: PartBuilder): void {
	// Two straps around the hood, from the edge of the mask to the back.
	const n = b.pick(14, 8, 0);
	if (n === 0) return;
	for (const [y0, y1] of b.pick([[67.3, 67.8], [63.1, 64.2]], [[67.3, 67.8], [63.1, 64.2]], [])) {
		const row = (h: number, out: number) => Array.from({ length: n + 1 }, (_, i) => {
			const a = lerp(0.85, Math.PI * 2 - 0.85, i / n);
			return hood(a, lerp(y0!, y1!, smooth(0.2, 1, -Math.cos(a))) + h, out);
		});
		sheet(b, b.pick([row(-0.6, 0.05), row(-0.5, 0.3), row(0.5, 0.3), row(0.6, 0.05)], [row(-0.55, 0.25), row(0.55, 0.25)], []), LEATHER, (_p, i) => (i === 0 ? 0.45 : 0.72 + 0.1 * i));
		if (b.lod > 0) continue;
		for (const m of MIRROR) {
			// Buckle: a brass frame with a prong.
			const a = (y0! > 65 ? 1.55 : 1.45) * m;
			const bar = (da0: number, da1: number, h0: number, h1: number, out = 0.42) => sheet(b, [
				[hood(a + da0, y0! + h0, out), hood(a + da1, y0! + h0, out)],
				[hood(a + da0, y0! + h1, out), hood(a + da1, y0! + h1, out)]
			], BRASS, () => 1);
			bar(-0.13, 0.13, 0.52, 0.8);
			bar(-0.13, 0.13, -0.8, -0.52);
			bar(-0.17, -0.11, -0.8, 0.8);
			bar(0.11, 0.17, -0.8, 0.8);
			bar(-0.13, 0.13, -0.08, 0.1, 0.46);
		}
	}
}

const HAT_Y = 70.2;

function buildHat(b: PartBuilder): void {
	const seg = b.pick(24, 14, 10);
	const ring = (y: number, r: number, shade: number, pal: number = BLACK, dx = -0.4): Ring => ({ c: [dx, y, 0], f: r, b: r * 1.04, s: r * 0.98, n: 2.1, w: HEAD, pal, shade });
	const bend = (p: THREE.Vector3) => {
		// Flat brim, dipping a little front and back.
		const r = Math.hypot(p.x, p.z);
		const k = smooth(6, 11.5, r);
		p.y += k * (0.35 * (p.z / 11) ** 2 - 0.75 * (p.x / 11) ** 2);
	};
	b.loft(
		b.pick(
			[ring(69.6, 5.0, 0.3), ring(69.75, 6.2, 0.4), ring(HAT_Y - 0.25, 11.0, 0.6), ring(HAT_Y, 11.2, 1.1), ring(HAT_Y + 0.25, 11.0, 1.25), ring(HAT_Y + 0.2, 8.4, 0.95), ring(HAT_Y + 0.15, 6.3, 0.6), ring(70.6, 6.15, 0.7, LEATHER), ring(71.9, 6.0, 0.85, LEATHER), ring(71.95, 5.85, 0.6), ring(73.5, 5.6, 1), ring(74.9, 5.35, 1.15), ring(75.25, 4.9, 1.25), ring(75.1, 3.0, 0.95)],
			[ring(69.65, 5.2, 0.4), ring(HAT_Y - 0.2, 11.1, 0.6), ring(HAT_Y + 0.2, 11.1, 1.2), ring(HAT_Y + 0.15, 6.2, 0.7, LEATHER), ring(71.9, 5.95, 0.8), ring(75, 5.3, 1.2)],
			[ring(69.65, 5.2, 0.5), ring(HAT_Y, 11.2, 1), ring(HAT_Y + 0.25, 6.2, 0.75, LEATHER), ring(72, 6, 0.9), ring(75, 5.3, 1.2)]
		),
		{
			seg,
			capEnd: true,
			deform: (p) => {
				if (p.y < 70.5) bend(p);
			}
		}
	);
	// Brass buckle on the band.
	if (b.lod > 0) return;
	for (const [y, h, z, w] of [[71.75, 0.25, 0, 1.7], [70.85, 0.25, 0, 1.7], [71.3, 1.1, 0.78, 0.25], [71.3, 1.1, -0.78, 0.25]] as const) b.box([5.72, y, z], [0.3, h, w], { w: HEAD, pal: BRASS });
}

registerItemMesh('hat_plague', {
	hides: ['hair', 'neck'],
	coversFace: true,
	colors: [0x6e4a2c, 0x25232a, 0xc9963f, 0x8e1017],
	glow: [0, 0, 0, 0.45],
	build(b) {
		buildHood(b);
		buildBeak(b);
		buildGoggles(b);
		buildStraps(b);
		buildHat(b);
	}
});
