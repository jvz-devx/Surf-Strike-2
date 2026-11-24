/** Denim jacket: light-wash trucker jacket with a sherpa collar. Also the sewing kit of the other Common shirts. */
import * as THREE from 'three';
import { alongArm, armSide, armWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, superellipse, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { TORSO_TABLE, torsoWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import { sideSign, type Side } from '../skeleton.js';

// ---------------------------------------------------------------------------
// Sewing kit: a torso surface and things sewn on it

/** Cloth around the torso, `ease(y)` outside the body. */
export class Torso {
	constructor(
		private readonly ease: (y: number) => number,
		private readonly n: (y: number) => number = () => 2.35
	) {}

	private radii(y: number): { f: number; b: number; s: number } {
		const r = sample(TORSO_TABLE, y);
		const e = this.ease(y);
		return { f: r[1]! + e, b: -r[2]! + e, s: r[3]! + e };
	}

	private point(y: number, a: number): THREE.Vector3 {
		const r = this.radii(y);
		const [c, s] = superellipse(a, this.n(y));
		const p = new THREE.Vector3((c >= 0 ? r.f : r.b) * c, y, r.s * s);
		// Chest and shoulder blades.
		if (p.x > 0) p.x += 0.3 * Math.exp(-(((y - 51.5) / 2.2) ** 2) - ((Math.abs(p.z) - 3.6) / 2.4) ** 2);
		else p.x -= 0.28 * Math.exp(-(((y - 52.5) / 2.4) ** 2) - ((Math.abs(p.z) - 4.4) / 2.2) ** 2);
		return p;
	}

	normal(y: number, a: number): THREE.Vector3 {
		const da = this.point(y, a + 0.04).sub(this.point(y, a - 0.04));
		return this.point(y + 0.15, a).sub(this.point(y - 0.15, a)).cross(da).normalize();
	}

	/** Point at a height and angle (0 front, π/2 right), `off` outside the cloth. */
	at(y: number, a: number, off = 0): THREE.Vector3 {
		const p = this.point(y, a);
		return off === 0 ? p : p.addScaledVector(this.normal(y, a), off);
	}

	/** Angle of the point `z` sideways, on the front or the back. */
	angle(y: number, z: number, back = false): number {
		const a = Math.asin(Math.min(1, Math.abs(z) / this.radii(y).s) ** (this.n(y) / 2)) * Math.sign(z);
		return back ? Math.PI - a : a;
	}

	front(y: number, z: number, off = 0): THREE.Vector3 {
		return this.at(y, this.angle(y, z), off);
	}
}

/** Torso weights; a low hem follows the thighs like the seat of the trousers below it. */
export function shirtWeights(p: THREE.Vector3): Weights {
	if (p.y >= 38) return torsoWeights(p.y, p.z);
	const k = smooth(1, 6, Math.abs(p.z)) * 0.75 * (1 - smooth(35.4, 38, p.y));
	return [...torsoWeights(p.y, p.z).map(([b, w]) => [b, w * (1 - k)] as const), [p.z > 0 ? 'thighHR' : 'thighHL', k] as const];
}

export const shirtShade = (p: THREE.Vector3): number => lerp(0.86, 1, smooth(37, 43, p.y)) * (Math.abs(p.z) > 6.8 && p.y > 46 && p.y < 54 ? 0.9 : 1);

/** [height, angle] points on a torso. */
export type Path = readonly (readonly [number, number])[];
/** Straight line on the front (or back) between two [height, z] points. */
export function line(t: Torso, from: readonly [number, number], to: readonly [number, number], n: number, back = false): Path {
	return Array.from({ length: n + 1 }, (_, i) => {
		const y = lerp(from[0], to[0], i / n);
		return [y, t.angle(y, lerp(from[1], to[1], i / n), back)] as const;
	});
}

/**
 * Sewn line along a path: a thread (a thin ridge), or with `flat` a raised
 * band. `side` moves it sideways (to the left of the path, seen from outside).
 */
export function strip(b: PartBuilder, t: Torso, path: Path, half: number, off: number, pal: number, o: { flat?: boolean; shade?: number; side?: number } = {}): void {
	const pts = path.map(([y, a]) => ({ p: t.at(y, a), n: t.normal(y, a) }));
	const profile: readonly (readonly [number, number])[] = o.flat ? [[-1, -0.15], [-0.92, off], [0.92, off], [1, -0.15]] : [[-1, 0], [0, off], [1, 0]];
	const rows = pts.map(({ p, n }, i) => {
		const dir = pts[Math.min(i + 1, pts.length - 1)]!.p.clone().sub(pts[Math.max(i - 1, 0)]!.p).cross(n).normalize();
		return profile.map(([k, h]) => p.clone().addScaledVector(dir, k * half - (o.side ?? 0)).addScaledVector(n, h));
	});
	b.loft(
		rows.map((_, i): Ring => ({ c: [0, -i, 0], f: 1, s: 1, w: [['chest', 1]], pal })),
		{
			seg: profile.length,
			pal,
			capStart: o.flat,
			capEnd: o.flat,
			deform: (p, _t, a, i) => void p.copy(rows[i]![Math.round((a / (Math.PI * 2)) * profile.length) % profile.length]!),
			weightAt: shirtWeights,
			shadeAt: (p) => (o.shade ?? 1) * shirtShade(p)
		}
	);
}

/** Two parallel rows of stitching. */
export function doubleStitch(b: PartBuilder, t: Torso, path: Path, pal: number, gap = 0.22): void {
	for (const side of b.lod === 0 ? [-gap, gap] : [0]) strip(b, t, path, 0.085, 0.1, pal, { side });
}

/** Patch on the front. `outline`: [z, y] around (cz, cy), from the top towards +z; `layers`: [scale, height above the cloth, palette, shade]. */
export function patch(b: PartBuilder, t: Torso, cy: number, cz: number, outline: readonly (readonly [number, number])[], layers: readonly (readonly [number, number, number, number?])[]): void {
	b.loft(
		layers.map(([k, , pal, shade], i): Ring => ({ c: [i, cy, cz], f: k, s: k, w: torsoWeights(cy, cz), pal, shade })),
		{
			seg: outline.length,
			u: [0, 1, 0],
			v: [0, 0, 1],
			capEnd: true,
			deform: (p, _t, a, i) => {
				const [k, h] = layers[i]!;
				const [oz, oy] = outline[Math.round((a / (Math.PI * 2)) * outline.length) % outline.length]!;
				p.copy(t.front(cy + oy * k, cz + oz * k, h));
			}
		}
	);
}

/** Round button, `h` above the cloth. */
export function button(b: PartBuilder, t: Torso, y: number, z: number, r: number, h: number, pal: number): void {
	const n = b.pick(6, 4, 4);
	patch(b, t, y, z, Array.from({ length: n }, (_, i) => [Math.sin((i / n) * Math.PI * 2) * r, Math.cos((i / n) * Math.PI * 2) * r] as const), b.pick([[1, h - 0.15, pal, 0.7], [1, h + 0.12, pal]], [[1, h - 0.1, pal], [0.9, h + 0.14, pal]], [[1, h, pal], [0.9, h + 0.1, pal]]));
}

/**
 * Collar that stands at the nape and folds down to two points. `a0`: half of
 * the gap in front; `tip`: [height, angle] of the points; `back`: height of
 * the edge at the nape; `puff`: how far it bulges; `curl`: fluff, -1..1.
 */
export function foldCollar(
	b: PartBuilder,
	t: Torso,
	o: { a0: number; tip: readonly [number, number]; back: number; pal: number; off: number; puff?: number; rows?: number; cols?: number; low?: number; curl?: (i: number, j: number) => number }
): void {
	const cols = b.pick(o.cols ?? 15, 9, 7);
	const outer = b.pick(o.rows ?? 2, 1, 1);
	const curl = (i: number, j: number) => (b.lod === 0 ? (o.curl?.(i, j) ?? 0) : 0);
	const rows: THREE.Vector3[][] = Array.from({ length: outer + 4 }, () => []);
	for (let j = 0; j < cols; j++) {
		const a = lerp(o.a0, Math.PI * 2 - o.a0, j / (cols - 1));
		const sgn = a < Math.PI ? 1 : -1;
		const q = Math.min(a, Math.PI * 2 - a);
		const f = 1 - smooth(o.a0, 1.35, q);
		const y = lerp(o.low ?? 57.5, 59.35, smooth(o.a0, 1.7, q));
		const ring = (k: number, dy: number) => new THREE.Vector3(-0.5 + 2.95 * k * Math.cos(a), y + dy, 3.1 * k * Math.sin(a));
		const qe = lerp(q, o.tip[1], f);
		const ye = q < 1.6 ? lerp(57.45, o.tip[0], f) : lerp(57.45, o.back, smooth(1.6, 2.7, q));
		const n = t.normal(ye, qe * sgn);
		const edge = t.at(ye, qe * sgn, o.off);
		const fold = ring(1.12, -0.02);
		rows[0]!.push(ring(0.86, -1));
		rows[1]!.push(ring(0.99, 0.02));
		rows[2]!.push(fold);
		for (let i = 1; i <= outer; i++) {
			const k = i / outer;
			rows[2 + i]!.push(fold.clone().lerp(edge, k).addScaledVector(n, (o.puff ?? 0) * Math.sin(k * Math.PI * 0.8) + 0.26 * curl(i, j)));
		}
		rows[outer + 3]!.push(t.at(ye, qe * sgn, b.lod === 2 ? -0.6 : 0));
	}
	const shades = new Map<THREE.Vector3, number>();
	rows.forEach((row, i) => row.forEach((p, j) => shades.set(p, [0.5, 0.82, 1.02][i] ?? (i === outer + 3 ? 0.62 : 1.04 + 0.13 * curl(i - 2, j)))));
	b.grid(rows, { w: torsoWeights(58.5), pal: o.pal, shadeAt: (p) => shades.get(p) ?? 1 });
}

/** Last ring of a torso: the neckline, turned inwards and dipping in front. */
export function neckline(p: THREE.Vector3, a: number, dip: number, inner: boolean): void {
	const q = Math.min(a, Math.PI * 2 - a);
	p.y -= dip * (1 - smooth(0.2, 0.9, q)) * Math.max(0, Math.min(1, (p.y - 55.2) / 3.3));
	// Tucked under the collar.
	const tuck = 1 - 0.13 * smooth(57, 58.5, p.y + dip);
	p.x = -0.5 + (p.x + 0.5) * tuck;
	p.z *= tuck;
	p.y -= 0.35 * smooth(57, 58.5, p.y + dip);
	if (!inner) return;
	p.x = -0.5 + (p.x + 0.5) * 0.7;
	p.z *= 0.7;
	p.y -= 0.8;
}

/** Long sleeve: t along the arm, radius along X, sideways. */
export const SLEEVE: readonly (readonly number[])[] = [
	[-3.6, 1.3, 1],
	[-2.4, 2.6, 2.05],
	[-0.8, 3.3, 2.75],
	[1.2, 3.65, 3.15],
	[4.5, 3.7, 3.25],
	[7.5, 3.55, 3.15],
	[11, 3.3, 3.05],
	[14, 3.2, 2.95],
	[17, 2.85, 2.65],
	[19, 2.45, 2.2],
	[20.7, 2.2, 1.95]
];
export function sleeveRing(s: Side, t: number, d = 0, pal?: number, shade = 1): Ring {
	const r = sample(SLEEVE, t);
	return { c: alongArm(s, t), f: r[1]! + d, s: r[2]! + d, w: armWeights(s, t), pal, shade };
}
export const sleeveShade = (p: THREE.Vector3): number => lerp(0.82, 1, smooth(0, 2.8, Math.abs(p.z) - 7.5));
/** Creases inside the elbow and bunching above the cuff. */
export function wrinkle(p: THREE.Vector3, s: Side, t: number, a: number): void {
	if (t < 6 || t > 18) return;
	const c = alongArm(s, t);
	const k = 1 + 0.03 * Math.exp(-(((t - 10.5) / 2.2) ** 2)) * Math.sin(t * 2.6 + a) + 0.03 * smooth(13, 17, t) * Math.sin(a * 3 + t);
	p.set(c[0] + (p.x - c[0]) * k, c[1] + (p.y - c[1]) * k, c[2] + (p.z - c[2]) * k);
}

// ---------------------------------------------------------------------------
// Denim jacket

const DENIM = PAL.topA;
const SHERPA = PAL.topB;
const THREAD = PAL.topC;
const DARK = PAL.topD;

const jacket = new Torso((y) => lerp(0.4, 0.68, smooth(37.6, 39.2, y)) + 0.4 * Math.exp(-(((y - 42.2) / 2.8) ** 2)) - 0.38 * smooth(54, 58.2, y));
/** Whiter over the chest and the shoulders. */
const wash = (p: THREE.Vector3): number => shirtShade(p) * (1 + 0.1 * Math.exp(-(((p.y - 47) / 3.5) ** 2)) * (p.x > 0 ? 1 : 0.5)) * (p.y > 52 ? 0.95 : 1);

function buildBody(b: PartBuilder): void {
	const seg = b.pick(22, 12, 8);
	const ys = b.pick([39.2, 42, 45, 48, 50, 51.6, 53.4, 55.2, 56.6, 57.7, 58.5], [39, 45, 51, 54.5, 57, 58.5], [39, 45, 51, 55.5, 58.5]);
	const all = [38.6, 38, ...ys, 58.5];
	b.loft(all.map((y, i): Ring => ({ c: [0, i, 0], f: 1, s: 1, w: torsoWeights(y), shade: i === all.length - 1 ? 0.5 : [0.55, 0.8][i] })), {
		seg,
		pal: DENIM,
		weightAt: (p) => torsoWeights(p.y, p.z),
		deform: (p, _t, a, i) => {
			p.copy(jacket.at(all[i]!, a, i === 0 ? -0.9 : i === 1 ? -0.05 : 0));
			neckline(p, a, 1.3, i === all.length - 1);
		},
		shadeAt: (p) => wash(p)
	});
	// Waistband.
	const band = (y: number, d: number, pal: number, shade = 1): Ring => {
		const [, f, back, s] = sample(TORSO_TABLE, y);
		return { c: [0, y, 0], f: f! + d, b: -back! + d, s: s! + d, n: 2.35, w: torsoWeights(y), pal, shade };
	};
	b.loft(
		b.pick(
			[band(36, 0.3, DENIM, 0.85), band(36.35, 0.5, THREAD), band(36.5, 0.53, DENIM), band(38.1, 0.74, DENIM), band(38.3, 0.4, DENIM, 0.8)],
			[band(36, 0.45, DENIM, 0.9), band(38.1, 0.75, DENIM), band(38.3, 0.4, DENIM, 0.8)],
			[band(36, 0.45, DENIM), band(38.1, 0.75, DENIM), band(38.3, 0.4, DENIM)]
		),
		{ seg, weightAt: (p) => torsoWeights(p.y, p.z), shadeAt: () => 0.92 }
	);
	// Fleece: lumps in two sizes.
	const curl = (i: number, j: number) => ((i + j) % 2 ? 0.7 : -0.7) + 0.6 * Math.sin(i * 5.1 + j * 3.7);
	foldCollar(b, jacket, { a0: 0.28, tip: [54.4, 0.36], back: 56.1, pal: SHERPA, off: 0.7, puff: 0.5, rows: 4, cols: 23, curl });
}

function buildSleeves(b: PartBuilder): void {
	for (const s of SIDES) {
		const ts = b.pick([-3.6, -2.4, -0.8, 1.4, 5, 8.2, 10.6, 13, 16], [-3.4, -0.8, 3, 7, 11, 15], [-3, 2, 9, 14]);
		const cuff = b.pick(
			[sleeveRing(s, 18.3), sleeveRing(s, 18.35, 0.24, THREAD), sleeveRing(s, 18.55, 0.28), sleeveRing(s, 20.7, 0.2, DENIM, 0.85), sleeveRing(s, 20, -0.9, DENIM, 0.45)],
			[sleeveRing(s, 18.2), sleeveRing(s, 18.3, 0.25), sleeveRing(s, 20.7, 0.2), sleeveRing(s, 20, -0.9, DENIM, 0.5)],
			[sleeveRing(s, 18.2), sleeveRing(s, 20.7, 0.1)]
		);
		b.loft([...ts.map((t) => sleeveRing(s, t)), ...cuff], {
			seg: b.pick(11, 6, 5),
			v: armSide(s),
			pal: DENIM,
			capStart: true,
			deform: b.lod > 0 ? undefined : (p, _t, a, i) => i < ts.length && wrinkle(p, s, ts[i]!, a),
			shadeAt: (p, a, i) => sleeveShade(p) * (1 + 0.1 * Math.exp(-((((ts[i] ?? 20) - 10.5) / 3) ** 2)) * (Math.cos(a) < 0 ? 1 : 0.3))
		});
		// Cuff button on the outside.
		if (b.lod === 0) {
			const r = sleeveRing(s, 19.6, 0.3);
			const v = armSide(s);
			b.ball([r.c[0] + 0.4, r.c[1] + v[1] * r.s, r.c[2] + v[2] * r.s], [0.4, 0.4, 0.4], { w: armWeights(s, 19.6), pal: THREAD, seg: 5, rings: 3, shade: 0.85 });
		}
	}
}

/** Pocket flap: [z, y] around its middle. */
const FLAP: readonly (readonly [number, number])[] = [[0, 1.35], [2, 1.35], [2, -0.5], [0, -1.35], [-2, -0.5], [-2, 1.35]];

function buildDetails(b: PartBuilder): void {
	if (b.lod === 2) return;
	const n = b.pick(4, 2, 2);
	// Placket with stitched edges and copper buttons.
	strip(b, jacket, line(jacket, [36.1, 0.2], [56.2, 0.2], b.pick(7, 3, 2)), 0.95, 0.5, DENIM, { flat: true, shade: 1.05 });
	if (b.lod === 0)
		for (const k of [-0.75, 0.75]) {
			const path = line(jacket, [36.3, 0.2], [56, 0.2], 6);
			strip(b, jacket, path, 0.07, 0.58, THREAD, { side: k });
		}
	for (const y of b.pick([37.1, 41, 44.6, 48.2, 51.8], [], [])) button(b, jacket, y, 0.2, 0.5, 0.55, THREAD);
	for (const s of SIDES) {
		const k = sideSign(s);
		const l = (y0: number, z0: number, y1: number, z1: number, m = n) => line(jacket, [y0, k * z0], [y1, k * z1], m);
		if (b.lod === 1) {
			strip(b, jacket, l(49.2, 5.4, 38.3, 2.8), 0.16, 0.14, THREAD);
			patch(b, jacket, 50.35, k * 4.1, FLAP, [[1, 0, THREAD, 0.8], [1, 0.35, THREAD], [0.86, 0.38, DENIM]]);
			continue;
		}
		// Yoke seam, the V below the pocket and the welt.
		doubleStitch(b, jacket, l(51.9, 1.2, 51.9, 7.2), THREAD);
		doubleStitch(b, jacket, l(49.4, 2.5, 38.3, 1.9), THREAD, 0.16);
		doubleStitch(b, jacket, l(49.2, 5.7, 38.3, 3.3), THREAD, 0.16);
		strip(b, jacket, l(44.6, 6.4, 40.2, 5.2, 2), 0.42, 0.22, DARK, { flat: true });
		// Pocket flap with a point and a button.
		patch(b, jacket, 50.35, k * 4.1, FLAP, [[1, -0.15, DENIM, 0.7], [1, 0.3, DENIM], [0.92, 0.34, THREAD], [0.85, 0.35, DENIM, 1.06]]);
		button(b, jacket, 49.75, k * 4.1, 0.42, 0.45, THREAD);
		// Back seams.
		doubleStitch(b, jacket, line(jacket, [52.2, k * 4.6], [38.3, k * 2.6], n, true), THREAD, 0.16);
	}
	if (b.lod > 0) return;
	const span = 8;
	doubleStitch(b, jacket, Array.from({ length: span + 1 }, (_, i) => [52.4 - 0.8 * (1 - Math.abs(i / span - 0.5) * 2), lerp(Math.PI - 1.05, Math.PI + 1.05, i / span)] as const), THREAD);
}

registerItemMesh('top_denim', {
	hides: ['upperArms', 'forearms'],
	colors: [0x93b4d8, 0xf3e8d3, 0xc07f3d, 0x5f82ad],
	build(b) {
		buildBody(b);
		buildSleeves(b);
		buildDetails(b);
	}
});
