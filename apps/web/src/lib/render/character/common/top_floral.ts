/** Floral shirt: boxy holiday shirt, open notched collar, flowers on deep teal. */
import * as THREE from 'three';
import { alongArm, armSide, armWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, superellipse, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { torsoWeights, TORSO_TABLE } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import { armDir, BIND, sideSign, type Side } from '../skeleton.js';

const HEM = 34.9;
/** Cross-section exponent: boxier at the hem, over the seat of the trousers. */
const expo = (y: number): number => lerp(2.8, 2.35, smooth(35, 42, y));
/** Sleeve length from the shoulder. */
const END = 9.3;
const UP = new THREE.Vector3(0, 1, 0);

const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// Torso surface

/** Loose cloth: straight down from the chest instead of following the waist. */
const ease = (y: number): number => 0.35 * (1 - smooth(54, 57.5, y)) + 0.85 * Math.exp(-(((y - 42) / 4.2) ** 2)) + 0.45 * (1 - smooth(35, 39, y));

const radii = (y: number): { f: number; b: number; s: number } => {
	const r = sample(TORSO_TABLE, y);
	const e = ease(y);
	return { f: r[1]! + e, b: -r[2]! + e, s: r[3]! + e };
};

/** Point of the cloth at a height and angle (0 front, π/2 right). */
function torso(y: number, a: number): THREE.Vector3 {
	const r = radii(y);
	const [c, s] = superellipse(a, expo(y));
	const p = vec((c >= 0 ? r.f : r.b) * c, y, r.s * s);
	// Soft vertical folds towards the hem, chest and shoulder blades.
	const k = 1 + 0.016 * (1 - smooth(36, 47, y)) * Math.sin(a * 6 + 1.6);
	p.x *= k;
	p.z *= k;
	if (p.x > 0) p.x += 0.35 * Math.exp(-(((y - 51.5) / 2.2) ** 2) - ((Math.abs(p.z) - 3.6) / 2.4) ** 2);
	else p.x -= 0.3 * Math.exp(-(((y - 52.5) / 2.4) ** 2) - ((Math.abs(p.z) - 4.4) / 2.2) ** 2);
	return p;
}

/** Angle of a point near the torso surface. */
function torsoAngle(p: THREE.Vector3): number {
	const r = radii(p.y);
	const u = p.x / (p.x >= 0 ? r.f : r.b);
	const v = p.z / r.s;
	const e = expo(p.y) / 2;
	return Math.atan2(Math.sign(v) * Math.abs(v) ** e, Math.sign(u) * Math.abs(u) ** e);
}

function torsoNormal(y: number, a: number): THREE.Vector3 {
	const da = torso(y, a + 0.04).sub(torso(y, a - 0.04));
	const dy = torso(y + 0.15, a).sub(torso(y - 0.15, a));
	return dy.cross(da).normalize();
}

/** Point on the front at a height and sideways position, lifted off the cloth. */
function front(y: number, z: number, off: number): THREE.Vector3 {
	const a = Math.asin(Math.min(1, Math.abs(z) / radii(y).s) ** (expo(y) / 2)) * Math.sign(z);
	return torso(y, a).addScaledVector(torsoNormal(y, a), off);
}

/** Torso weights; the hem follows the thighs like the seat of the trousers below it. */
function shirtWeights(p: THREE.Vector3): Weights {
	if (p.y >= 38) return torsoWeights(p.y, p.z);
	const k = smooth(1, 6, Math.abs(p.z)) * 0.75 * (1 - smooth(35.4, 38, p.y));
	const base = torsoWeights(p.y, p.z);
	return [...base.map(([b, w]) => [b, w * (1 - k)] as const), [p.z > 0 ? 'thighHR' : 'thighHL', k] as const];
}

const shirtShade = (p: THREE.Vector3): number => lerp(0.86, 1, smooth(36, 44, p.y)) * (Math.abs(p.z) > 6.8 && p.y > 46 && p.y < 54 ? 0.9 : 1);

// ---------------------------------------------------------------------------
// Sleeve surface

const SLEEVE: readonly (readonly number[])[] = [
	// t, along X, sideways
	[-3.6, 1.4, 1.3],
	[-2.6, 2.75, 2.35],
	[-1.2, 3.4, 2.9],
	[0.6, 3.75, 3.3],
	[3, 3.85, 3.4],
	[6, 3.95, 3.45],
	[END, 4.1, 3.55]
];

function sleeve(s: Side, t: number, a: number, d = 0): THREE.Vector3 {
	const r = sample(SLEEVE, t);
	const v = armSide(s);
	const p = vec(...alongArm(s, t));
	p.x += (r[1]! + d) * Math.cos(a);
	return p.addScaledVector(vec(...v), (r[2]! + d) * Math.sin(a));
}

function sleeveT(s: Side, p: THREE.Vector3): number {
	return p.clone().sub(vec(...BIND[`upper${s}`])).dot(vec(...armDir(s)));
}

const sleeveShade = (p: THREE.Vector3): number => lerp(0.86, 1, smooth(0, 3, Math.abs(p.z) - 7));

// ---------------------------------------------------------------------------
// Flowers

interface Cloth {
	/** Point at (sideways, up) from the motif's centre, lifted by `off`. */
	at(u: number, v: number, off: number): THREE.Vector3;
	w(p: THREE.Vector3): Weights;
	shade(p: THREE.Vector3): number;
}

function torsoCloth(y: number, a: number): Cloth {
	const c = torso(y, a);
	const n = torsoNormal(y, a);
	const up = UP.clone().addScaledVector(n, -n.y).normalize();
	const side = up.clone().cross(n);
	return {
		at: (u, v, off) => {
			const q = c.clone().addScaledVector(side, u).addScaledVector(up, v);
			const b = torsoAngle(q);
			return torso(q.y, b).addScaledVector(torsoNormal(q.y, b), off);
		},
		w: shirtWeights,
		shade: shirtShade
	};
}

function sleeveCloth(s: Side, t: number, a: number): Cloth {
	const v = vec(...armSide(s));
	const c = sleeve(s, t, a);
	const n = vec(Math.cos(a), 0, 0).addScaledVector(v, Math.sin(a));
	const up = vec(...armDir(s)).negate();
	const side = up.clone().cross(n);
	const o = vec(...BIND[`upper${s}`]);
	return {
		at: (u, h, off) => {
			const q = c.clone().addScaledVector(side, u).addScaledVector(up, h);
			const qt = sleeveT(s, q);
			const r = sample(SLEEVE, qt);
			return sleeve(s, qt, Math.atan2(q.sub(o).dot(v) / r[2]!, (q.x - 0) / r[1]!), off);
		},
		w: (p) => armWeights(s, sleeveT(s, p)),
		shade: sleeveShade
	};
}

/** Flat patch on the cloth: a fan through `seg` points of `outline`. */
function patch(b: PartBuilder, cloth: Cloth, seg: number, off: number, pal: number, outline: (j: number) => readonly [number, number], shade = 1): void {
	const c: Ring = { c: [0, 0, 0], f: 1, s: 1, w: [['chest', 1]], pal };
	b.loft([c], {
		seg,
		pal,
		capEnd: true,
		deform: (p, _t, a) => {
			const [u, v] = outline(Math.round((a / (Math.PI * 2)) * seg));
			p.copy(cloth.at(u, v, off + b.pick(0, 0.12, 0.2)));
		},
		weightAt: (p) => cloth.w(p),
		shadeAt: (p) => cloth.shade(p) * shade
	});
}

/** Flower with five petals and, when big, two leaves. `r`: radius, `turn`: rotation. */
function flower(b: PartBuilder, cloth: Cloth, r: number, turn: number, pal: number, eye: number, leaves: boolean): void {
	if (leaves && b.lod < 2)
		for (const d of b.lod ? [0.5] : [0.5, 2.7]) {
			const a = turn + d;
			const ca = Math.cos(a);
			const sa = Math.sin(a);
			const shape: readonly (readonly [number, number])[] = [[r * 0.4, 0], [r * 1.15, -r * 0.42], [r * 2.15, r * 0.1], [r * 1.25, r * 0.38]];
			patch(b, cloth, 4, 0.1, PAL.topD, (j) => [shape[j]![0] * ca - shape[j]![1] * sa, shape[j]![0] * sa + shape[j]![1] * ca]);
		}
	const n = b.pick(15, leaves ? 5 : 4, 4);
	patch(b, cloth, n, 0.15, pal, (j) => {
		// Near: two points per petal tip and one between the petals.
		const a = turn + ((n === 15 ? Math.floor(j / 3) * 3 + [-0.85, 0.85, 1.5][j % 3]! : j) / n) * Math.PI * 2;
		const k = n === 15 ? (j % 3 === 2 ? 0.5 : 1) * r : r * 0.9;
		return [Math.cos(a) * k, Math.sin(a) * k];
	});
	if (b.lod === 0) patch(b, cloth, 5, 0.24, eye, (j) => [Math.cos(turn + j * 1.2566) * r * 0.3, Math.sin(turn + j * 1.2566) * r * 0.3]);
}

/** Torso motifs: height, angle, radius (big coral or small cream flowers). */
function motifs(): { y: number; a: number; big: boolean }[] {
	const out: { y: number; a: number; big: boolean }[] = [];
	const rows = [37.4, 40.6, 43.8, 47, 50.2, 53.4];
	rows.forEach((y, i) => {
		for (let j = 0; j < 8; j++) {
			// Arc positions spread over the flat front and back; nudged so the rows don't line up.
			const a = ((j + (i % 2 ? 0.5 : 0) + 0.16 * Math.sin(i * 2.3 + j * 4.1)) / 8) * Math.PI * 2;
			out.push({ y: y + 0.6 * Math.sin(i * 1.7 + j * 2.9), a, big: (j + (i >> 1)) % 2 === 0 });
		}
	});
	// Upper chest, beside the lapels.
	out.push({ y: 50.2, a: 0.48, big: true }, { y: 53.1, a: -0.62, big: false });
	return out;
}

// ---------------------------------------------------------------------------
// Sewn-on parts

/** Raised piece on the front: rows of [left z, left y, right z, right y]. */
function panel(b: PartBuilder, rows: readonly (readonly [number, number, number, number])[], off: number, pal: number, shade = 1): void {
	b.loft(
		rows.map(([, y], i): Ring => ({ c: [0, y - i * 0.001, 0], f: 1, s: 1, w: [['chest', 1]], pal })),
		{
			seg: 4,
			pal,
			capStart: true,
			capEnd: true,
			deform: (p, _t, a, i) => {
				const j = Math.round((a / (Math.PI * 2)) * 4) % 4;
				const [z0, y0, z1, y1] = rows[i]!;
				const right = j === 1 || j === 2;
				p.copy(front(right ? y1 : y0, right ? z1 : z0, j < 2 ? off : 0));
			},
			weightAt: (p) => shirtWeights(p),
			shadeAt: (p, a) => shade * shirtShade(p) * (a > 2 ? 0.85 : 1)
		}
	);
}

/** Camp collar: stands at the nape, folds down over the shoulders to two points. */
function collar(b: PartBuilder): void {
	const cols = b.pick(13, 7, 7);
	const a0 = 0.6;
	const rows: THREE.Vector3[][] = [[], [], [], [], []];
	for (let j = 0; j < cols; j++) {
		const a = lerp(a0, Math.PI * 2 - a0, j / (cols - 1));
		const q = Math.min(a, Math.PI * 2 - a);
		const f = 1 - smooth(a0, 1.35, q);
		const y = lerp(57.5, 59.35, smooth(a0, 1.7, q));
		const ring = (k: number, dy: number) => vec(-0.5 + 2.95 * k * Math.cos(a), y + dy, 3.1 * k * Math.sin(a));
		const sgn = a < Math.PI ? 1 : -1;
		const qe = lerp(q, 0.31, f);
		const ye = q < 1.6 ? lerp(57.45, 55.2, f) : lerp(57.45, 56.5, smooth(1.6, 2.7, q));
		const edge = (off: number) => torso(ye, qe * sgn).addScaledVector(torsoNormal(ye, qe * sgn), off);
		rows[0]!.push(ring(0.86, -1));
		rows[1]!.push(ring(0.98, 0));
		rows[2]!.push(ring(1.1, -0.02));
		rows[3]!.push(edge(0.5));
		rows[4]!.push(edge(b.lod === 2 ? -0.6 : 0.02));
	}
	b.grid(rows, { w: torsoWeights(58.5), pal: PAL.topA, shadeAt: (_p, i) => [0.5, 0.8, 1.12, 1.2, 0.6][i]! });
}

function buildSleeves(b: PartBuilder): void {
	const ts = b.pick([-3.6, -2.6, -1.2, 0.6, 3.2, 6], [-3.4, -1.2, 2], [-3, 2]);
	for (const s of SIDES) {
		const ring = (t: number, d = 0, shade = 1): Ring => {
			const r = sample(SLEEVE, t);
			return { c: alongArm(s, t), f: r[1]! + d, s: r[2]! + d, w: armWeights(s, t), shade };
		};
		b.loft(
			[...ts.map((t) => ring(t)), ...(b.lod === 0 ? [ring(END - 1.3), ring(END - 1.3, 0.14)] : []), ring(END, 0.16), ring(END, -0.25, 0.7), ring(END - 1.2, -0.95, 0.45)],
			{ seg: b.pick(12, 7, 5), v: armSide(s), capStart: true, pal: PAL.topA, shadeAt: sleeveShade }
		);
		const spots = [
			[1.4, 0.75, 1], [1.6, 2.4, 1], [5.2, 1.55, 1], [5.6, 0.05, 0], [5.4, 3.1, 0], [6.4, 4.7, 0]
		] as const;
		for (const [i, [t, a, big]] of spots.entries()) {
			if (b.lod > 0 && i > 3) continue;
			const turn = i * 1.9 + sideSign(s) * 0.6;
			flower(b, sleeveCloth(s, t, a), big ? 1.2 : 0.9, turn, big ? PAL.topB : PAL.topC, big ? PAL.topC : PAL.topB, !!big);
		}
	}
}

registerItemMesh('top_floral', {
	colors: [0x0e5560, 0xf2705a, 0xf7e6c2, 0x35a183],
	build(b) {
		const ys = b.pick([36.3, 38.2, 40.2, 42, 45, 48, 51, 53.2, 55.2, 56.6, 57.7, 58.5], [38, 42, 46.5, 51, 54.5, 57.2, 58.5], [38.4, 44, 51, 55.5, 58.5]);
		const ring = (y: number, shade = 1): Ring => ({ c: [0, y, 0], f: 1, s: 1, w: [['chest', 1]], shade });
		const rings = [ring(HEM + 0.9, 0.55), ring(HEM, 0.85), ...ys.map((y) => ring(y))];
		b.loft(rings, {
			seg: b.pick(22, 12, 8),
			pal: PAL.topA,
			capEnd: true,
			weightAt: (p, i) => (i < rings.length ? shirtWeights(p) : torsoWeights(p.y)),
			deform: (p, _t, a, i) => {
				const y = rings[i]!.c[1];
				p.copy(torso(y, a));
				if (i < 2) {
					// Hem turned inwards.
					const k = i === 0 ? 0.88 : 0.98;
					p.x *= k;
					p.z *= k;
				}
				// Fewer sides: grow the hem so its flats clear the seat too.
				const wide = 1 + b.pick(0, 0.045, 0.08) * (1 - smooth(35.2, 39, y));
				p.x *= wide;
				p.z *= wide;
				// The open neck dips in front.
				const q = Math.min(a, Math.PI * 2 - a);
				p.y -= 2.3 * (1 - smooth(0.2, 0.95, q)) * Math.max(0, Math.min(1, (y - 55.2) / 3.3));
			},
			shadeAt: (p, a, i) => shirtShade(p) * (i > rings.length - 4 && Math.min(a, Math.PI * 2 - a) < 0.5 ? 0.55 : 1)
		});
		buildSleeves(b);
		collar(b);
		for (const m of motifs()) {
			const p = torso(m.y, m.a);
			// Keep the button row, pocket, lapels and the arm holes clear.
			const gap = m.big ? 1.1 : 0.75;
			if (p.x > 0 && Math.abs(p.z) < 1 + gap) continue;
			if (p.x > 0 && p.z < -1.6 && p.z > -6.6 && p.y > 46 && p.y < 52.2) continue;
			if (p.x > 0 && Math.abs(p.z) < 4.6 && p.y > 51.8) continue;
			if ((p.y > 49.5 && Math.abs(p.z) > 6.6) || (p.y > 45 && Math.abs(p.z) > 7.6)) continue;
			if (b.lod === 2 && !m.big) continue;
			flower(b, torsoCloth(m.y, m.a), m.big ? 1.4 : 0.95, m.y * 2.1 + m.a * 3.7, m.big ? PAL.topB : PAL.topC, m.big ? PAL.topC : PAL.topB, m.big);
		}
		if (b.lod === 2) return;
		// Lapels below the collar points, a notch between them.
		for (const s of SIDES) {
			const k = sideSign(s);
			const rows = ([[1.35, 56.5, 2.3, 56], [1.0, 55.8, 3.5, 54.5], [0.6, 54.9, 2.4, 53.5], [0.1, 53.7, 0.7, 52.6]] as const).filter((_, i) => b.lod === 0 || i !== 2).map(([i, yi, o, yo]): [number, number, number, number] => (k > 0 ? [i, yi, o, yo] : [-o, yo, -i, yi]));
			panel(b, rows, 0.42, PAL.topA, 1.2);
		}
		// Button band from the lapels to the hem, buttons, pocket with a cream edge.
		const band = b.pick([53.3, 51, 48, 45, 42, 40.2, 38.2, 36.3, HEM + 0.05], [53.3, 48, 42, 38, HEM + 0.05], []);
		panel(b, band.map((y): [number, number, number, number] => [-0.85, y, 0.85, y]), 0.18, PAL.topA, 1.12);
		if (b.lod === 0) panel(b, ([[-2.3, 51.2, -6.1], [-2.3, 49.4, -6.1], [-2.4, 47.6, -6], [-3.2, 46.9, -5.2]] as const).map(([zr, y, zl]): [number, number, number, number] => [zl, y, zr, y]), 0.24, PAL.topA, 1.14);
		panel(b, [[-6.2, 51.5, -2.2, 51.5], [-6.2, 50.9, -2.2, 50.9]], 0.34, PAL.topC);
		if (b.lod > 0) return;
		for (const y of [51.6, 48.2, 44.8, 41.4, 38]) {
			const cloth = torsoCloth(y, 0);
			patch(b, cloth, 7, 0.34, PAL.topC, (j) => [Math.cos(j * 0.8976) * 0.42, Math.sin(j * 0.8976) * 0.42]);
			patch(b, cloth, 4, 0.37, PAL.topA, (j) => [Math.cos(j * 1.5708) * 0.12, Math.sin(j * 1.5708) * 0.12], 0.6);
		}
		flower(b, { ...torsoCloth(48.8, 0), at: (u, v, off) => front(48.8 + v, -4.2 + u * -1, off + 0.22) }, 0.95, 0.4, PAL.topC, PAL.topB, false);
	}
});
