/** Turtle shell: scaly suit top with a domed sea turtle shell on the back (raised scutes, notched rim), a segmented cream plastron and straps. */
import * as THREE from 'three';
import { alongArm, armSide, armWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { bone, lerp, PAL, sample, smooth, superellipse, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { TORSO_TABLE, torsoWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import type { Side } from '../skeleton.js';

const DARK = PAL.topA;
const LIGHT = PAL.topB;
const CREAM = PAL.topC;
const SKIN = PAL.topD;

const CHEST = bone('chest');
/** Cream darkened to tan leather. */
const TAN = 0.46;

// ---------------------------------------------------------------------------
// Suit

const N = 2.35;
const PAD: readonly (readonly number[])[] = [
	[36.5, 0.45],
	[39, 0.4],
	[43, 0.4],
	[51, 0.45],
	[55, 0.4],
	[57.7, 0.25],
	[58.4, 0.15]
];

/** Point on the suit; `a` is 0 in front, π/2 at the right. */
function onBody(a: number, y: number, off: number): THREE.Vector3 {
	const r = sample(TORSO_TABLE, y);
	const [c, s] = superellipse(a, N);
	const e = sample(PAD, y)[1]! + off;
	return new THREE.Vector3((c >= 0 ? r[1]! + e : -r[2]! + e) * c, y, (r[3]! + e) * s);
}

/** Angle of the front point `z` to the side. */
function angleAt(y: number, z: number): number {
	const w = sample(TORSO_TABLE, y)[3]! + sample(PAD, y)[1]!;
	return Math.sign(z) * Math.asin(Math.min(1, (Math.abs(z) / w) ** (N / 2)));
}

/** Row of scales: every row is turned half a step, and every third point is light with six dark ones round it. */
const turn = (a: number, i: number, seg: number): number => a - (i * Math.PI) / seg;
const scale = (a: number, i: number, seg: number): number => ((Math.round((a / (Math.PI * 2)) * seg) + i) % 3 === 0 ? 1.08 : 0.62);

function buildBody(b: PartBuilder): void {
	const ring = (y: number, d = 0, pal: number = SKIN, shade = 1): Ring => {
		const r = sample(TORSO_TABLE, y);
		const e = sample(PAD, y)[1]! + d + b.pick(0, 0.12, 0.4);
		return { c: [0, y, 0], f: r[1]! + e, b: -r[2]! + e, s: r[3]! + e, n: N, w: torsoWeights(y), pal, shade };
	};
	const hem = [ring(37.6, -1, DARK, 0.5), ring(36.5, -0.1, DARK, 0.8)];
	const rows = b.pick(
		[...hem, ring(36.7, 0.1, DARK), ring(38, 0.05, DARK), ring(38.1), ...[40.1, 42.1, 44.1, 46.1, 48.1, 50.1, 52.1, 54, 55.8, 57.2, 58.3].map((y) => ring(y))],
		[hem[1]!, ring(38, 0, DARK), ...[38.1, 42, 46, 51, 55, 57, 58.4].map((y) => ring(y))],
		[hem[1]!, ring(38), ring(43.5), ring(51), ring(55.6), ring(58.2)]
	);
	const seg = b.pick(18, 10, 8);
	b.loft(rows, {
		seg,
		capEnd: true,
		weightAt: (p) => torsoWeights(p.y, p.z),
		deform:
			b.lod > 0
				? undefined
				: (p, _t, a, i) => {
						const q = rows[i]!;
						const [c, sn] = superellipse(turn(a, i, seg), N);
						p.x = (c >= 0 ? q.f : q.b!) * c;
						p.z = q.s * sn;
					},
		shadeAt: (p, a, i) => (b.lod === 0 && i > 3 ? scale(a, i, seg) : 0.85) * lerp(0.86, 1, smooth(37, 44, p.y)) * (Math.abs(p.z) > 6.8 && p.y > 46 && p.y < 54 ? 0.9 : 1)
	});
}

function buildCollar(b: PartBuilder): void {
	if (b.lod === 2) return;
	const row = (y: number, r: number, pal: number, shade = 1): Ring => ({ c: [-0.4, y, 0], f: r, b: r + 0.3, s: r + 0.45, w: torsoWeights(58.5), pal, shade });
	b.loft(b.pick([row(57.7, 3.35, DARK), row(58.5, 3.1, DARK), row(59.1, 2.85, DARK), row(59.15, 2.4, DARK, 0.7), row(58.2, 2.1, DARK, 0.5)], [row(57.7, 3.35, DARK), row(59.1, 2.85, DARK), row(58.4, 2.2, DARK, 0.6)], []), { seg: b.pick(12, 8, 6) });
}

const SLEEVE: readonly (readonly number[])[] = [
	// t, radius along X, radius sideways
	[-3.6, 1.45, 1.35],
	[-2.6, 2.85, 2.45],
	[-1.2, 3.45, 2.95],
	[0.6, 3.75, 3.3],
	[3, 3.7, 3.3],
	[7.5, 3.4, 3.05],
	[11, 3.1, 2.9],
	[14.5, 3.05, 2.85],
	[18.5, 2.5, 2.3],
	[21, 2.35, 2.1]
];
const END = 20.6;

function buildSleeve(b: PartBuilder, s: Side): void {
	const ring = (t: number, pal: number = SKIN, d = 0, shade = 1): Ring => {
		const r = sample(SLEEVE, t);
		return { c: alongArm(s, t), f: r[1]! + d, s: r[2]! + d, w: armWeights(s, t), pal, shade };
	};
	const rows = b.pick(
		[...[-3.6, -2.2, -0.2, 2.1, 4.4, 6.7, 8.7, 10.5, 12.3, 14.2, 16.4, 18.6].map((t) => ring(t)), ring(18.6, DARK, 0.25), ring(END, DARK, 0.25), ring(END, DARK, -0.4, 0.5)],
		[...[-3.4, -1, 3, 7, 9.6, 11.2, 13.4].map((t) => ring(t)), ring(18.6, DARK, 0.15), ring(END, DARK, 0.15)],
		[ring(-3), ring(2), ring(9), ring(13), ring(18.6, DARK), ring(END, DARK)]
	);
	const seg = b.pick(9, 6, 5);
	b.loft(rows, {
		seg,
		v: armSide(s),
		capStart: true,
		capEnd: b.lod > 0,
		deform:
			b.lod > 0
				? undefined
				: (p, _t, a, i) => {
						const q = rows[i]!;
						const v = armSide(s);
						const t = turn(a, i, seg);
						p.set(q.c[0] + q.f * Math.cos(t) + v[0] * q.s * Math.sin(t), q.c[1] + v[1] * q.s * Math.sin(t), q.c[2] + v[2] * q.s * Math.sin(t));
					},
		shadeAt: (p, a, i) => (b.lod === 0 && i < 11 ? scale(a, i, seg) : 0.85) * lerp(0.86, 1, smooth(0, 3, Math.abs(p.z) - 7))
	});
}

// ---------------------------------------------------------------------------
// Plates and straps

type P2 = readonly [number, number];

/** Raised plate: rings of points (counter-clockwise from outside), outermost first; the last one is closed. */
function plate(b: PartBuilder, layers: readonly { pts: readonly THREE.Vector3[]; pal: number; shade?: number }[], w: (p: THREE.Vector3) => Weights, peak = 0): void {
	const seg = layers[0]!.pts.length;
	b.loft(
		layers.map((l, i): Ring => ({ c: [i, 0, 0], f: 1, s: 1, w: CHEST, pal: l.pal, shade: l.shade ?? 1 })),
		{
			seg,
			u: [0, 1, 0],
			v: [0, 0, 1],
			capEnd: true,
			deform: (p, _t, a, i) => void p.copy(layers[i]!.pts[Math.round((a / (Math.PI * 2)) * seg) % seg]!),
			// Also sees the centre of the cap, which may stick out a little more.
			weightAt: (p) => {
				if (peak && !layers.some((l) => l.pts.some((q) => q.distanceToSquared(p) < 1e-8))) p.x += peak;
				return w(p);
			}
		}
	);
}

/** Move the points of a flat polygon towards its middle. */
function inset(pts: readonly P2[], d: number): P2[] {
	const cx = pts.reduce((t, p) => t + p[0], 0) / pts.length;
	const cy = pts.reduce((t, p) => t + p[1], 0) / pts.length;
	return pts.map(([x, y]) => {
		const k = Math.max(0.2, 1 - d / Math.hypot(x - cx, y - cy));
		return [cx + (x - cx) * k, cy + (y - cy) * k];
	});
}

/** Strap through points lying on the body. */
function strap(b: PartBuilder, path: readonly THREE.Vector3[], wide: number, high: number): void {
	b.loft(
		path.map((_, i): Ring => ({ c: [0, i, 0], f: 1, s: 1, w: CHEST, shade: TAN })),
		{
			seg: 4,
			pal: CREAM,
			capStart: true,
			capEnd: true,
			deform: (p, _t, a, i) => {
				const q = path[i]!;
				const dir = path[Math.min(i + 1, path.length - 1)]!.clone().sub(path[Math.max(i - 1, 0)]!).normalize();
				const n = q.clone().setY(q.y > 56 ? (q.y - 55) * 2 : 0).normalize();
				const side = dir.clone().cross(n).normalize();
				const up = side.clone().cross(dir).normalize();
				p.copy(q).addScaledVector(up, Math.cos(a) * high).addScaledVector(side, -Math.sin(a) * wide);
			},
			weightAt: (p) => torsoWeights(Math.min(p.y, 57.5), p.z)
		}
	);
}

/** Plastron: seam heights and half widths. */
const PLASTRON: readonly (readonly number[])[] = [
	[55.6, 2.3],
	[53.4, 4.4],
	[50.2, 5.5],
	[46.9, 4.8],
	[43.7, 4.35],
	[40.7, 4.1],
	[38.6, 2.7]
];

function buildPlastron(b: PartBuilder): void {
	const bend = (p: THREE.Vector3): Weights => torsoWeights(p.y, p.z);
	const at = ([z, y]: P2, off: number) => onBody(angleAt(y, z), y, off + b.pick(0, 0.12, 0.4));
	if (b.lod === 2) {
		const edge: P2[] = [[2.6, 55], [5.3, 50.2], [3.6, 39.2], [-3.6, 39.2], [-5.3, 50.2], [-2.6, 55]];
		plate(b, [{ pts: edge.map((p) => at(p, -0.2)), pal: CREAM }, { pts: edge.map((p) => at(p, 0.6)), pal: CREAM }], bend, 1.4);
		return;
	}
	// Dark bed, one piece from side to side per row.
	for (let i = 0; i < PLASTRON.length - 1; i++) {
		const [y0, w0] = PLASTRON[i]! as [number, number];
		const [y1, w1] = PLASTRON[i + 1]! as [number, number];
		for (const k of [-1, 1]) {
			const wide = (w0 + w1) / 2;
			const mid = (y0 + y1) / 2;
			const pts: P2[] = b.pick<P2[]>(
				[[0, y0], [w0, y0], [wide + 0.15, mid], [w1, y1], [0, y1], [0, mid]],
				[[0, y0], [w0, y0], [w1, y1], [0, y1]],
				[]
			).map(([z, y]): P2 => [z * k, y]);
			// Clockwise for the right half seen from the front (+Z is on the viewer's left).
			const ccw = k > 0 ? pts.slice() : pts.slice().reverse();
			const layer = (d: number, off: number, shade: number) => ({ pts: inset(ccw, d).map((p) => at(p, off)), pal: CREAM, shade });
			plate(b, b.pick([layer(-0.14, 0.02, 0.36), layer(0.24, 0.5, 0.97)], [layer(0.1, 0.3, 1)], []), bend, 0.15);
		}
	}
}

function buildStraps(b: PartBuilder): void {
	if (b.lod === 2) return;
	for (const k of [-1, 1]) {
		const f = (y: number, z: number) => onBody(k * angleAt(y, z), y, 0.2);
		const r = (y: number, z: number) => onBody(k * (Math.PI - angleAt(y, z)), y, 0.22);
		strap(b, b.pick([f(52.4, 4.2), f(55, 4.4), f(56.7, 4.6), f(57.5, 4.7), r(57.5, 4.7), r(56.3, 4.5), r(55, 4.4)], [f(52.4, 4.2), f(55.8, 4.45), f(57.5, 4.7), r(56, 4.5)], []), 1.15, 0.42);
		// Round the flank, under the arm.
		if (b.lod === 0) strap(b, [0.6, 0.95, 1.3, 1.65, 2, 2.35].map((a) => onBody(k * a, 45.2 + a * 0.3, 0.2)), 0.95, 0.36);
		if (b.lod === 0) {
			const p = f(54, 4.3);
			b.box([p.x + 0.35, p.y, p.z], [0.4, 1.2, 2.3], { w: torsoWeights(54, p.z), pal: CREAM, shade: 0.8, rot: [0, 0, 0.3] });
		}
	}
}

// ---------------------------------------------------------------------------
// Shell (rigid on the chest)

const CY = 49.4;
/** Centre line of the rim, right half from the tail to the neck: z, y. */
const EDGE: readonly P2[] = [[0, 37.4], [2.5, 38.9], [4.9, 42], [6.8, 45.6], [7.8, 49.2], [7.7, 52.6], [6.4, 55.2], [3.6, 56.9], [0, 57.1]];
/** Angle and radius round the middle. */
const POLAR: readonly (readonly number[])[] = (() => {
	const loop = [...EDGE, ...EDGE.slice(1, -1).reverse().map(([z, y]): P2 => [-z, y])];
	const curve = new THREE.CatmullRomCurve3(loop.map(([z, y]) => new THREE.Vector3(z, y, 0)), true);
	const rows = curve.getPoints(160).slice(0, 81).map((p) => [Math.atan2(p.y - CY, p.x), Math.hypot(p.x, p.y - CY)]);
	rows[0]![0] = -Math.PI / 2;
	rows[80]![0] = Math.PI / 2;
	return rows;
})();

/** Radius of the rim at an angle (0 right, π/2 up). */
function radius(th: number): number {
	const a = Math.asin(Math.sin(th));
	return sample(POLAR, a)[1]!;
}

/** Point of the outline, `rho` 0 middle … 1 rim. */
const polar = (th: number, rho: number): P2 => [Math.cos(th) * radius(th) * rho, CY + Math.sin(th) * radius(th) * rho];

/** Back of the suit below the shell. */
const BASE: readonly (readonly number[])[] = [
	[37, -6.2],
	[40, -5.5],
	[44, -5.2],
	[51, -5.6],
	[55, -5.3],
	[57.5, -4.4]
];
const base = (z: number, y: number): number => sample(BASE, y)[1]! + z * z * 0.012;

const HEIGHT = 6.5;
function depth(z: number, y: number): number {
	const rho = Math.min(1, Math.hypot(z, y - CY) / radius(Math.atan2(y - CY, z)));
	return base(z, y) - HEIGHT * (1 - rho ** 2.2) ** 0.72;
}

/** Point on the dome, `off` units outside it. */
function onShell([z, y]: P2, off: number): THREE.Vector3 {
	const e = 0.15;
	const dz = (depth(z + e, y) - depth(z - e, y)) / (2 * e);
	const dy = (depth(z, y + e) - depth(z, y - e)) / (2 * e);
	const n = new THREE.Vector3(-1, dy, dz).normalize();
	return new THREE.Vector3(depth(z, y), y, z).addScaledVector(n, off);
}

/** Five plates down the spine and four on each side, counter-clockwise seen from behind (z, y). */
const SCUTES: readonly (readonly P2[])[] = (() => {
	const RHO = 0.93;
	const deg = Math.PI / 180;
	const out = [62, 27, -10, -42, -69].map((d) => polar(d * deg, RHO));
	const between = [45, 9, -26, -56].map((d) => polar(d * deg, RHO));
	const mid: P2[] = [out[0]!, [3.3, 51.7], [3.3, 48.1], [2.7, 44.5], out[4]!];
	const edge: P2[] = [[1.7, 56.1], [1.8, 53.5], [1.9, 49.9], [1.75, 46.2], [1.25, 42.5], [0.45, 38.7]];
	const flip = ([z, y]: P2): P2 => [-z, y];
	const list: P2[][] = [];
	for (let k = 0; k < 5; k++) list.push([mid[k]!, edge[k]!, flip(edge[k]!), flip(mid[k]!), flip(edge[k + 1]!), edge[k + 1]!]);
	for (let i = 0; i < 4; i++) {
		const c = [mid[i]!, edge[i + 1]!, mid[i + 1]!, ...(i === 3 ? [] : [out[i + 1]!]), between[i]!, ...(i === 0 ? [] : [out[i]!])];
		list.push(c, c.map(flip).reverse());
	}
	return list;
})();

function buildShell(b: PartBuilder): void {
	const rigid = () => CHEST;
	// Dark dome: what shows between the plates.
	const seg = b.pick(14, 12, 8);
	const rhos = b.pick([1, 0.86, 0.6, 0.3], [1, 0.65], [1, 0.7]);
	plate(
		b,
		rhos.map((rho) => ({ pts: Array.from({ length: seg }, (_, j) => onShell(polar((j / seg) * Math.PI * 2, Math.min(rho, 0.985)), 0)), pal: DARK, shade: 0.36 })),
		rigid,
		b.pick(-0.3, -0.3, -0.5)
	);
	SCUTES.forEach((s, i) => {
		const spine = i < 5;
		const [rim, top] = (spine ? i % 2 === 0 : Math.floor((i - 5) / 2) % 2 === 1) ? [DARK, LIGHT] : [LIGHT, DARK];
		const layer = (d: number, off: number, pal: number, shade = 1) => ({ pts: inset(s, d).map((p) => onShell(p, off)), pal, shade });
		if (b.lod === 0) plate(b, [layer(0.18, -0.1, rim, 0.65), layer(0.45, 0.55, rim, 1.02), layer(1.05, 0.78, top)], rigid, -0.3);
		else plate(b, [layer(0.35, b.pick(0, 0.4, 0.5), top)], rigid, -0.6);
	});

	// Thick rim of notched marginal plates.
	const count = b.pick(16, 14, 10);
	const sec = b.pick(5, 4, 3);
	const rows: THREE.Vector3[][] = [];
	const shades: number[] = [];
	for (let m = 0; m < count; m++)
		for (const t of b.pick([0, 0.16, 0.84], [0], [0])) {
			const th = ((m + t) / count) * Math.PI * 2 - Math.PI / 2;
			const [z, y] = polar(th, 1);
			const [z1, y1] = polar(th + 0.02, 1);
			const [z0, y0] = polar(th - 0.02, 1);
			// Outwards, square to the outline.
			const o = new THREE.Vector3(0, -(z1 - z0), y1 - y0).normalize();
			const notch = b.lod === 0 && t === 0;
			const wide = notch ? 0.85 : 1.25;
			const thick = notch ? 0.85 : 1.15;
			const c = new THREE.Vector3(base(z, y) - 0.25, y, z);
			rows.push(
				Array.from({ length: sec }, (_, j) => {
					const f = (j / sec) * Math.PI * 2 + (sec === 5 ? Math.PI / 2 : sec === 4 ? Math.PI / 4 : sec === 3 ? Math.PI / 2 : 0);
					const p = c.clone().addScaledVector(o, Math.cos(f) * wide);
					p.x -= Math.sin(f) * thick;
					return p;
				})
			);
			shades.push(notch ? 0.6 : 1.2);
		}
	rows.push(rows[0]!.map((p) => p.clone()));
	shades.push(shades[0]!);
	b.grid(rows, { w: CHEST, pal: SKIN, wrap: true, flip: true, shadeAt: (_p, i) => shades[i]! });

	// Underside, facing the body.
	if (b.lod < 2) {
		const ring = Array.from({ length: 12 }, (_, j) => polar((j / 12) * Math.PI * 2, 1));
		plate(b, [{ pts: ring.map(([z, y]) => new THREE.Vector3(base(z, y) + 0.3, y, z)).reverse(), pal: CREAM, shade: 0.5 }], rigid);
	}
}

registerItemMesh('top_turtle', {
	hides: ['upperArms', 'forearms'],
	colors: [0x23713f, 0x6fae45, 0xf3e2ac, 0xa5d58c],
	build(b) {
		buildBody(b);
		buildCollar(b);
		for (const s of SIDES) buildSleeve(b, s);
		buildPlastron(b);
		buildStraps(b);
		buildShell(b);
	}
});
