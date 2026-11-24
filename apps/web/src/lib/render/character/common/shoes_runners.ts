/** Pulse runners: running shoes on a thick sculpted foam sole. */
import * as THREE from 'three';
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, superellipse, type PartBuilder, type Ring } from '../mesh-kit.js';
import { SHOE_TABLE, shoeWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

/** Footprint: x, half width before the ends are rounded. */
const WIDTH: readonly (readonly number[])[] = [[-5, 2.4], [-3, 2.42], [-0.5, 2.25], [1.5, 2.4], [4.2, 2.78], [6.5, 2.6], [8.6, 2.3]];
const MID = 1.75;
const HALF = 6.65;
/** Upper: x, height of the top. */
const TOP: readonly (readonly number[])[] = [[-4.5, 3.5], [-3.9, 4.75], [-3.2, 5.3], [-2, 5.4], [-0.6, 5.5], [0.7, 5.35], [1.8, 4.75], [3.2, 4.2], [4.8, 3.75], [6.2, 3.45], [7.2, 3.1], [7.9, 2.6]];

/** Bottom of the sole: rocker at the heel, curved up at the toe. */
const soleLow = (x: number): number => 0.45 * (1 - smooth(-5, -3.2, x)) + 0.95 * smooth(4.2, 8.6, x) ** 1.4;
/** Top of the sole: high at the heel, low under the ball, up again around the toe. */
const soleHigh = (x: number): number => lerp(2.85, 1.75, smooth(-3, 4.2, x)) + 0.7 * smooth(5, 8.6, x) + 0.2 * (1 - smooth(-5, -3.6, x));
const halfWidth = (x: number): number => sample(WIDTH, x)[1]! * Math.max(0, 1 - Math.abs((x - MID) / HALF) ** 3.4) ** (1 / 2.6);

/** Foam profile: share of the height, offset from the footprint, palette of the band above it. */
type Foam = readonly [number, number, number];
const FOAM: readonly Foam[] = [
	[0, -0.45, PAL.shoesD],
	[0.1, 0, PAL.shoesD],
	[0.2, 0.05, PAL.shoesB],
	[0.4, 0.3, PAL.shoesB],
	[0.54, 0.12, PAL.shoesC],
	[0.64, 0.1, PAL.shoesB],
	[0.76, 0.24, PAL.shoesB],
	[0.97, 0.14, PAL.shoesB],
	[1, -0.5, PAL.shoesB]
];

function buildRunner(b: PartBuilder, s: Side): void {
	const side = sideSign(s);
	const z0 = BIND[`foot${s}`][2] + side * 0.15;
	const zAt = (x: number) => z0 + side * sample(SHOE_TABLE, x)[3]!;

	// Sole.
	const foam = b.pick(FOAM, [FOAM[0]!, FOAM[2]!, FOAM[3]!, FOAM[7]!, FOAM[8]!], [FOAM[0]!, FOAM[3]!, FOAM[7]!, FOAM[8]!]);
	b.loft(
		foam.map(([k], i): Ring => ({ c: [0, k + i * 0.01, 0], f: 1, s: 1, w: shoeWeights(s, 0) })),
		{
			seg: b.pick(26, 14, 8),
			pal: PAL.shoesD,
			capStart: true,
			deform: (p, _t, a, i) => {
				const [k, grow] = foam[i]!;
				const [ca, sa] = superellipse(a, 2.7);
				const x = MID + HALF * ca;
				// The groove fades towards the toe and waves along the side.
				const out = grow + (b.lod === 0 && (i === 4 || i === 5) ? 0.14 * smooth(0, 5, x) : 0);
				const wave = b.lod === 0 && i > 2 && i < 7 ? 0.07 * Math.sin(x * 1.1 + 0.6) : 0;
				// The heel flares out behind the shoe.
				const flare = 0.3 * (1 - smooth(-4.9, -3.6, x)) * (1 - k);
				p.set(x + ca * (out - 0.05) - flare, lerp(soleLow(x), soleHigh(x), k + wave), zAt(x) + Math.sign(sa) * Math.abs(sa) * (sample(WIDTH, x)[1]! + out));
			},
			weightAt: (p) => shoeWeights(s, p.x),
			// Coloured groove under the heel and arch only.
			palAt: (i, a) => (foam[i]![2] === PAL.shoesC && Math.cos(a) > 0.35 ? PAL.shoesB : foam[i]![2]),
			shadeAt: (p, _a, i) => (i === foam.length - 1 ? 0.8 : b.lod === 0 && (i === 4 || i === 5) ? 0.9 : lerp(0.9, 1, smooth(0.3, 1.2, p.y)))
		}
	);

	// Upper. `on` is the point at `x` and angle `a` (0 top, positive to +z), `out` units outside it.
	const upper = (x: number) => {
		const lo = soleLow(x) + 0.5;
		const top = sample(TOP, x)[1]!;
		return { y: (top + lo) / 2, f: (top - lo) / 2, s: Math.max(0.6, halfWidth(x) - 0.12) };
	};
	const taper = (p: THREE.Vector3, x: number) => {
		// Narrower towards the collar.
		const z = zAt(x);
		p.z = z + (p.z - z) * (1 - 0.13 * smooth(2.6, 5, p.y));
	};
	const xs = b.pick([-4.5, -4.2, -3.5, -2.4, -0.8, 0.7, 2, 3.4, 4.8, 6.1, 7.2, 7.9], [-4.5, -2.6, -0.6, 1.2, 3.4, 5.4, 7.1, 7.9], [-4, -2, 1.4, 5, 7.3]);
	const at = (x: number, a: number, out: number): THREE.Vector3 => {
		const u = upper(x);
		const [ca, sa] = superellipse(a, 2.4);
		const p = new THREE.Vector3(x, u.y + (u.f + out) * ca, zAt(x) + (u.s + out) * sa);
		taper(p, x);
		return p;
	};
	// On the facets between the rings, so panels lie flat.
	const on = (x: number, a: number, out: number): THREE.Vector3 => {
		let i = 1;
		while (i < xs.length - 1 && xs[i]! < x) i++;
		const t = Math.max(0, (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!));
		return at(xs[i - 1]!, a, out).lerp(at(xs[i]!, a, out), t);
	};
	b.loft(
		xs.map((x): Ring => {
			const u = upper(x);
			return { c: [x, u.y, zAt(x)], f: u.f, s: u.s, n: 2.4, w: shoeWeights(s, x), pal: x < -3.9 ? PAL.shoesC : undefined };
		}),
		{
			seg: b.pick(16, 8, 6),
			u: [0, 1, 0],
			v: [0, 0, 1],
			pal: PAL.shoesA,
			capStart: true,
			capEnd: true,
			deform: (p, _t, _a, i) => taper(p, xs[i]!),
			palAt: (i, a) => {
				const off = Math.abs(Math.sin(a / 2));
				// Far away, the heel counter and the panels are part of the knit.
				if (b.lod > 0) return i === 0 ? PAL.shoesC : b.lod === 1 && i === 3 && off > 0.45 ? PAL.shoesB : PAL.shoesA;
				return xs[i]! < -3.6 ? PAL.shoesC : PAL.shoesA;
			},
			shadeAt: (p, a, i) => (b.lod > 0 ? 1 : (i + Math.round((a / Math.PI) * 8)) % 2 ? 1.04 : 0.94) * lerp(0.82, 1, smooth(1.4, 2.8, p.y))
		}
	);

	// Collar: padded dark rim and a short sock; weights of the trousers.
	const ring = (y: number, f: number, back: number, r: number, pal: number, shade = 1): Ring => ({ c: [lerp(-1.1, -0.4, smooth(4, 9, y)), y, z0], f, b: back, s: r, w: legWeights(s, y), pal, shade });
	const collar = [
		ring(3.6, 3.2, 2.35, 2.05, PAL.shoesA),
		ring(4.7, 3.05, 2.25, 2.15, PAL.shoesA),
		ring(5.2, 3.1, 2.08, 2.2, PAL.shoesD),
		ring(5.55, 3.15, 2.13, 2.25, PAL.shoesD),
		ring(5.75, 3, 1.98, 2.05, PAL.shoesD, 0.85),
		ring(5.6, 2.9, 1.92, 2.02, PAL.shoesB, 0.8),
		ring(6.9, 2.95, 2.15, 2.2, PAL.shoesB),
		ring(7, 2.7, 1.95, 2, PAL.shoesB, 0.8),
		ring(5.8, 1.6, 1.6, 1.55, PAL.shoesD, 0.5)
	];
	b.loft(b.pick(collar, [0, 2, 3, 5, 6, 8].map((i) => collar[i]!), [0, 3, 6, 8].map((i) => collar[i]!)), { seg: b.pick(12, 8, 5) });

	if (b.lod > 0) return;

	// Panel lying on the upper; `edge(t, a)`: x at t 0..1 for the angle a.
	const Q = Math.PI / 8;
	const panel = (z: number, as: readonly number[], rows: number, edge: (t: number, a: number) => number, out: number, pal: number) => {
		const pts = Array.from({ length: rows + 1 }, (_, i) => as.map((a) => on(edge(i / rows, a), z * a, out)));
		const x = pts[0]![0]!.x * 0.5 + pts[rows]![as.length - 1]!.x * 0.5;
		b.grid(pts, { w: shoeWeights(s, x), pal, flip: z < 0 });
	};
	for (const z of [-1, 1]) {
		// Heel counter, swept forward at the bottom.
		panel(z, [Q * 1.5, Q * 2, Q * 3, Q * 4, Q * 5], 3, (t, a) => lerp(-3.6, lerp(-3, -0.8, smooth(0.5, 1.9, a)), t), 0.1, PAL.shoesC);
		// Two slanted panels from the laces down to the sole.
		for (const i of [0, 1]) panel(z, [0.6, Q * 2, Q * 3, Q * 4, Q * 5], 2, (t, a) => 1.75 + i * 1.75 - (a - 0.6) * 1.05 + (t - 0.5) * (0.8 - i * 0.12), 0.14, i ? PAL.shoesC : PAL.shoesB);
		// Eyestay along the laces.
		panel(z, [0.42, 0.62], 4, (t) => lerp(0.8, 4.5, t), 0.11, PAL.shoesD);
	}
	// Toe bumper.
	const bump = [7.9, 7.2, 6.1, 4.8];
	for (const z of [-1, 1]) b.grid(bump.map((x, i) => [on(x, z * lerp(Q * 2.5, Q * 4, i / 3), 0.12), on(x, z * Q * 4.6, 0.12), on(x, z * Q * 5.5, 0.1)]), { w: shoeWeights(s, 7), pal: PAL.shoesD, flip: z > 0 });
	// Laces, with a bow at the top.
	for (let i = 0; i < 4; i++) {
		const x = 1.2 + i * 0.95;
		const y = sample(TOP, x)[1]! + 0.04;
		b.box([x, y, zAt(x)], [0.36, 0.26, 2.2], { w: shoeWeights(s, x), pal: PAL.shoesB, rot: [0, (i % 2 ? 1 : -1) * 0.14, -0.45] });
	}
	for (const z of [-1, 1]) {
		const c: [number, number, number] = [1.05, 5.28, z0 + z * 0.72];
		b.box(c, [0.3, 0.24, 1.15], { w: legWeights(s, 4.2), pal: PAL.shoesB, rot: [z * 0.35, z * -0.5, 0] });
	}
	// Pull tab behind the collar.
	b.box([-3.11, 5.25, z0], [0.26, 1.4, 0.95], { w: legWeights(s, 5), pal: PAL.shoesC, rot: [0, 0, -0.04] });
}

registerItemMesh('shoes_runners', {
	colors: [0x2b5fd0, 0xf6f3ea, 0xff6a4a, 0x18223c],
	build(b) {
		for (const s of SIDES) buildRunner(b, s);
	}
});
