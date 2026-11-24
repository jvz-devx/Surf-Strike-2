/**
 * Track pants: dark, with one wide coloured side panel edged in white, an
 * elastic waist with a drawstring, zipped pockets, snaps down the lower side
 * and a slightly flared hem.
 */
import * as THREE from 'three';
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { bone, lerp, mix, PAL, sample, smooth, superellipse, type LoftOptions, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

const MAIN = PAL.bottomA;
const PANEL = PAL.bottomB;
const EDGE = PAL.bottomC;
const METAL = PAL.bottomD;

/** Leg radii: bind y, front, back, sideways. Straight over the knee, flared below the calf. */
const LEG: readonly (readonly number[])[] = [
	[2.4, 4.05, 4.75, 3.75],
	[4.4, 3.8, 4.5, 3.6],
	[7, 3.45, 3.95, 3.3],
	[10, 3.28, 3.62, 3.2],
	[14.5, 3.35, 3.85, 3.32],
	[17.5, 3.5, 3.7, 3.4],
	[19.8, 3.8, 3.6, 3.5],
	[22.5, 3.85, 3.85, 3.62],
	[27, 4.3, 4.4, 4.02],
	[31, 4.75, 4.95, 4.3],
	[34, 4.85, 5.2, 4.3],
	[35.8, 4.0, 4.5, 3.1],
	[37, 3.2, 3.6, 2.2]
];
const HEM = 2.7;
const LEG_X = -0.2;
const legN = (y: number): number => (y > 28 ? 2.5 : lerp(2.6, 2.15, smooth(3, 9, y)));

/** Half width of the panel and of the panel with its edging, by height. */
const panelHalf = (y: number): number => lerp(2.2, 1.55, smooth(6, 34, y));
const EDGE_W = 0.42;

/**
 * A column of the mesh: an angle in units of π, or a fixed distance `x` along
 * the panel. Lofts space their columns evenly; these put them on the seams.
 */
type Col = number | 'front' | 'frontEdge' | 'back' | 'backEdge' | 'frontMid' | 'backMid';

function colAngle(c: Col, y: number, f: number, b: number, n: number): number {
	if (typeof c === 'number') return c * Math.PI;
	const w = panelHalf(y);
	const at = (x: number, r: number) => Math.acos(Math.min(1, x / r) ** (n / 2));
	switch (c) {
		case 'front':
			return at(w, f);
		case 'frontEdge':
			return at(w + EDGE_W, f);
		case 'frontMid':
			return at(w + EDGE_W, f) / 2;
		case 'back':
			return Math.PI - at(w, b);
		case 'backEdge':
			return Math.PI - at(w + EDGE_W, b);
		case 'backMid':
			return Math.PI - at(w + EDGE_W, b) / 2;
	}
}

/** Loft with its columns on the seams. `side` −1 mirrors it. `pals[j]`: palette from column j to j + 1. */
function seamLoft(
	b: PartBuilder,
	rings: readonly Ring[],
	cols: readonly Col[],
	pals: readonly (number | undefined)[],
	side: 1 | -1,
	o: Omit<LoftOptions, 'seg'> & { bend?: (p: THREE.Vector3, a: number) => void }
): void {
	const seg = cols.length;
	const column = (a: number) => Math.round((a / (Math.PI * 2)) * seg) % seg;
	b.loft(rings, {
		...o,
		seg,
		deform: (p, _t, a, i) => {
			const r = rings[i]!;
			const n = r.n ?? 2;
			const j = column(a);
			const k = side > 0 ? j : (seg - j) % seg;
			const ang = colAngle(cols[k]!, r.c[1], r.f, r.b ?? r.f, n);
			const [ca, sa] = superellipse(ang, n);
			p.set(r.c[0] + (ca >= 0 ? r.f : (r.b ?? r.f)) * ca, r.c[1], r.c[2] + side * r.s * sa);
			o.bend?.(p, ang);
		},
		palAt: (i, a) => {
			const j = Math.floor((a / (Math.PI * 2)) * seg);
			return rings[i]!.pal ?? pals[side > 0 ? j : seg - 1 - j];
		}
	});
}

/** Point on the outside of a leg at height `y` and angle `a` (0 front, π/2 outside), and the outward direction. */
function legPoint(s: Side, y: number, a: number, d = 0): { p: THREE.Vector3; n: THREE.Vector3 } {
	const [, f, back, r] = sample(LEG, y) as [number, number, number, number];
	const [ca, sa] = superellipse(a, legN(y));
	const n = new THREE.Vector3((Math.sign(ca) * Math.abs(ca) ** 1.3) / f, 0, (sideSign(s) * sa ** 1.3) / r).normalize();
	const p = new THREE.Vector3(LEG_X + (ca >= 0 ? f : back) * ca, y, BIND[`thigh${s}`][2] + sideSign(s) * r * sa);
	return { p: p.addScaledVector(n, d), n };
}

function buildTrackLeg(b: PartBuilder, s: Side): void {
	const z = BIND[`thigh${s}`][2];
	const ring = (y: number, d = 0, shade = 1): Ring => {
		const r = sample(LEG, y);
		return { c: [LEG_X, y, z], f: r[1]! + d, b: r[2]! + d, s: r[3]! + d * 0.85, n: legN(y), w: legWeights(s, y), shade };
	};
	const ys = b.pick([37, 35.8, 34, 31, 28, 25, 23, 21.5, 19.8, 18.2, 16.5, 14, 11.5, 9, 7, 5.2], [37, 35, 31, 27, 23, 19.8, 17, 11, 6.5], [36.5, 32, 26, 19.8, 14, 7]);
	const rings = ys.map((y) => ring(y));
	// Hem: a stitched fold.
	if (b.lod === 0) rings.push(ring(HEM + 1.3, 0.02), ring(HEM + 1.15, -0.06, 0.62), ring(HEM + 1, 0.06));
	rings.push(ring(HEM, 0.06), ring(HEM, -0.3, 0.6), ring(HEM + 1.2, -1.1, 0.45));
	const cols: Col[] = b.pick<Col[]>(
		[0, 'frontMid', 'frontEdge', 'front', 0.5, 'back', 'backEdge', 'backMid', 1, 1.2, 1.4, 1.6, 1.8],
		[0, 'frontEdge', 'front', 0.5, 'back', 'backEdge', 1, 1.33, 1.67],
		[0, 'frontEdge', 'backEdge', 1, 1.5]
	);
	const isPanel = (c: Col) => c === 'front' || (c === 0.5 && b.lod < 2) || (b.lod === 2 && c === 'frontEdge');
	const pals = cols.map((c) => (isPanel(c) ? PANEL : b.lod < 2 && (c === 'frontEdge' || c === 'back') ? EDGE : MAIN));
	seamLoft(b, rings, cols, pals, sideSign(s), {
		capStart: true,
		pal: MAIN,
		bend: (p, a) => {
			// The hem sits higher over the instep and lower at the heel.
			p.y += Math.cos(a) * (Math.cos(a) > 0 ? 0.75 : 0.3) * (1 - smooth(HEM + 1.3, 8, p.y));
			if (b.lod > 0) return;
			// Soft nylon folds behind the knee and above the hem, a pressed crease down the front.
			const knee = Math.exp(-(((p.y - 19) / 2.6) ** 2));
			const low = Math.exp(-(((p.y - 8.5) / 2.6) ** 2));
			const k = 1 + (0.022 * knee * (a > 2 && a < 4.3 ? 1 : 0.4) + 0.016 * low) * Math.sin(p.y * 2.3 + a * 2);
			p.x *= k;
			p.z = z + (p.z - z) * k;
			if (a < 0.01) p.x += 0.14 * smooth(6, 10, p.y) * (1 - smooth(25, 30, p.y));
		},
		shadeAt: (p) => lerp(0.78, 1, smooth(0, 3, Math.abs(p.z) + Math.max(0, p.y - 28) * 0.35)) * lerp(0.92, 1, smooth(HEM, HEM + 6, p.y))
	});
	if (b.lod > 0) return;

	// Snaps down the middle of the panel.
	const side = sideSign(s);
	for (let i = 0; i < 5; i++) {
		const y = 4.7 + i * 2.1;
		const { p } = legPoint(s, y, Math.PI / 2);
		const w = legWeights(s, y);
		const disc = (out: number, r: number): Ring => ({ c: [p.x, y, p.z + side * out], f: r, s: r, w });
		b.loft([disc(-0.2, 0.44), disc(0.13, 0.42), disc(0.22, 0.24)], { seg: 6, u: [1, 0, 0], v: [0, 1, 0], pal: METAL, capEnd: true });
	}

	// Slanted pocket zip between the front crease and the panel, with a pull.
	// It lies on the flat facet there: between two columns and two rings.
	const ringBelow = (y: number) => (y < 28 ? 25 : y < 31 ? 28 : 31);
	const facet = (y: number, t: number): THREE.Vector3 => {
		const row = (h: number): THREE.Vector3 => {
			const [, f, back] = sample(LEG, h) as [number, number, number];
			const at = (c: Col) => legPoint(s, h, colAngle(c, h, f, back, legN(h))).p;
			return at('frontMid').lerp(at('frontEdge'), t);
		};
		const lo = ringBelow(y);
		return row(lo).lerp(row(lo + 3), (y - lo) / 3);
	};
	// Weights between two rings, so it bends with the cloth under it.
	const facetWeights = (y: number): Weights => {
		const lo = ringBelow(y);
		const t = (y - lo) / 3;
		return [...legWeights(s, lo).map(([n, w]) => [n, w * (1 - t)] as const), ...legWeights(s, lo + 3).map(([n, w]) => [n, w * t] as const)];
	};
	const path = [32.6, 31, 29.5, 28, 27.2].map((y, i) => {
		const t = lerp(0.3, 0.72, i / 4);
		const along = facet(y, t + 0.1).sub(facet(y, t - 0.1));
		return { y, p: facet(y, t), n: new THREE.Vector3(along.z * side, 0, -along.x * side).normalize(), w: facetWeights(y) };
	});
	const mid = path[2]!.n;
	const zip = (half: number, out: number, pal: number, shade: number) =>
		b.loft(
			path.map(({ p, w }): Ring => ({ c: [p.x, p.y, p.z], f: out, s: half, n: 4, w })),
			{ seg: 8, u: [mid.x, 0, mid.z], v: [-mid.z * side, 0, mid.x * side], pal, capStart: true, capEnd: true, shadeAt: () => shade }
		);
	zip(0.48, 0.14, MAIN, 0.6);
	zip(0.17, 0.24, METAL, 1);
	const top = path[0]!;
	b.box([top.p.x + top.n.x * 0.28, 32.2, top.p.z + top.n.z * 0.28], [0.18, 1, 0.42], { w: top.w, pal: EDGE, rot: [0, -Math.atan2(top.n.z, top.n.x), 0] });
}

/** The seat follows the thighs, the waistband stays on the pelvis. */
function seatWeights(y: number, z: number): Weights {
	if (y > 36.6) return mix('pelvis', 'spine', smooth(36.6, 39, y) * 0.35);
	return mix('pelvis', z > 0 ? 'thighHR' : 'thighHL', smooth(1, 6, Math.abs(z)) * 0.75 * (1 - smooth(35.4, 36.6, y)) * smooth(30, 31.8, y));
}

function buildTrackSeat(b: PartBuilder): void {
	const p = bone('pelvis');
	const half: Col[] = b.pick<Col[]>([0, 'frontMid', 'frontEdge', 'front', 0.5, 'back', 'backEdge', 'backMid'], [0, 'frontEdge', 'front', 'back', 'backEdge'], [0, 'frontEdge', 'backEdge']);
	const rings: Ring[] = [
		{ c: [-0.4, 30.6, 0], f: 1.6, b: 2.2, s: 2, w: p, shade: 0.74 },
		{ c: [-0.35, 31.8, 0], f: 3.3, b: 4.1, s: 5.2, n: 2.6, w: p, shade: 0.8 },
		{ c: [-0.3, 33, 0], f: 4.35, b: 5, s: 8, n: 2.8, w: p, shade: 0.92 },
		{ c: [-0.2, 34.4, 0], f: 5.0, b: 5.4, s: 8.4, n: 2.7, w: p },
		{ c: [-0.1, 35.6, 0], f: 4.95, b: 5.4, s: 8.1, n: 2.5, w: p },
		{ c: [0, 36.6, 0], f: 4.7, b: 5.1, s: 7.4, n: 2.4, w: p }
	];
	// Columns: the right half, then its mirror image from the back to the front.
	const seg = half.length * 2;
	const right = (j: number) => j <= half.length;
	const angle = (j: number, r: Ring): number => {
		const k = right(j) ? j : seg - j;
		const a = k === half.length ? Math.PI : colAngle(half[k]!, 35, r.f, r.b ?? r.f, r.n ?? 2);
		return right(j) ? a : Math.PI * 2 - a;
	};
	const strip = (j: number): number => {
		const k = j < half.length ? j : seg - 1 - j;
		const c = half[k]!;
		if (b.lod < 2 && (c === 'frontEdge' || c === 'back')) return EDGE;
		if (c === 'front' || c === 0.5 || (b.lod === 2 && c === 'frontEdge')) return PANEL;
		return MAIN;
	};
	b.loft(rings, {
		seg,
		pal: MAIN,
		capStart: true,
		capEnd: true,
		deform: (q, _t, a, i) => {
			const r = rings[i]!;
			const ang = angle(Math.round((a / (Math.PI * 2)) * seg) % seg, r);
			const [ca, sa] = superellipse(ang, r.n ?? 2);
			q.set(r.c[0] + (ca >= 0 ? r.f : r.b!) * ca, r.c[1], r.s * sa);
		},
		palAt: (i, a) => (i < 2 ? MAIN : strip(Math.floor((a / (Math.PI * 2)) * seg))),
		weightAt: (q) => seatWeights(q.y, q.z)
	});

	// Elastic waistband, gathered.
	b.loft(
		[
			{ c: [-0.1, 35.5, 0], f: 4.7, b: 5.1, s: 7.8, n: 2.5, w: p, shade: 0.7 },
			{ c: [-0.1, 35.4, 0], f: 5.14, b: 5.55, s: 8.28, n: 2.5, w: p },
			{ c: [-0.05, 36, 0], f: 5.1, b: 5.5, s: 8.0, n: 2.45, w: p, shade: 1.15 },
			{ c: [0, 36.7, 0], f: 4.92, b: 5.3, s: 7.6, n: 2.4, w: p },
			{ c: [0, 38, 0], f: 4.6, b: 4.9, s: 7.1, n: 2.3, w: p },
			{ c: [0, 39, 0], f: 3.4, b: 3.8, s: 6, n: 2.3, w: p, shade: 0.7 }
		],
		{
			seg: b.pick(36, 12, 6),
			pal: MAIN,
			capEnd: true,
			weightAt: (q) => seatWeights(q.y, q.z),
			shadeAt: (_q, a) => (b.lod > 0 ? 0.9 : Math.cos(a * 18) > 0 ? 1.12 : 0.72)
		}
	);

	if (b.lod > 0) return;
	// Drawstring with a knot and metal tips.
	for (const s of SIDES) {
		const side = sideSign(s);
		b.box([5.2, 36.0, side * 0.75], [0.2, 0.5, 0.5], { w: p, pal: METAL });
		const cord = (x: number, y: number, z: number, r: number, pal: number): Ring => ({ c: [x, y, z], f: r, s: r, w: p, pal });
		b.loft(
			[
				cord(5.1, 36.1, side * 0.75, 0.17, EDGE),
				cord(5.42, 35.7, side * 0.3, 0.17, EDGE),
				cord(5.4, 34.9, side * 0.5, 0.17, EDGE),
				cord(5.3, 33.9 - side * 0.2, side * 0.75, 0.17, METAL),
				cord(5.3, 33.8 - side * 0.2, side * 0.76, 0.22, METAL),
				cord(5.25, 33.2 - side * 0.2, side * 0.82, 0.2, METAL)
			],
			{ seg: 5, capEnd: true }
		);
	}
	b.ball([5.42, 35.65, 0], [0.28, 0.32, 0.4], { w: p, pal: EDGE, seg: 6, rings: 4 });
}

registerItemMesh('bottom_track', {
	hides: ['shins'],
	colors: [0x2b2f38, 0x2f62d6, 0xf3f1ea, 0xb4bac4],
	build(b) {
		buildTrackSeat(b);
		for (const s of SIDES) buildTrackLeg(b, s);
	}
});
