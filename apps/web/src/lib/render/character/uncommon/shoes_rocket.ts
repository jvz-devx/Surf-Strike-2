/** Rocket boots: chunky silver retro-futuristic boots with twin heel thrusters, red fins and toe, hazard stripe sole. */
import * as THREE from 'three';
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { bone, lerp, PAL, sample, smooth, type PartBuilder, type Ring } from '../mesh-kit.js';
import { shoeWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

const SILVER = PAL.shoesA;
const RED = PAL.shoesB;
const DARK = PAL.shoesC;
const AMBER = PAL.shoesD;

/** Upper: x, half width, top y, centre shift. Fat and round. */
const UPPER: readonly (readonly number[])[] = [
	[-4.3, 1.4, 2.7, 0],
	[-3.9, 2.1, 3.1, 0],
	[-2.6, 2.7, 3.9, 0],
	[-0.6, 2.75, 5.2, 0],
	[1.4, 2.85, 5.2, -0.05],
	[2.8, 2.95, 4.75, -0.1],
	[4.2, 3.05, 4.4, -0.15],
	[5, 3.08, 4.3, -0.2],
	[6.6, 2.9, 4.0, -0.28],
	[7.6, 2.2, 3.5, -0.33],
	[8.1, 1.35, 3.0, -0.35],
	[8.3, 0.5, 2.6, -0.35]
];
const SOLE = 0.75;
const BAND = 1.85;

/** Outline of the sole, seen from above. */
function outline(side: number, a: number, grow: number): readonly [number, number] {
	const c = Math.cos(a);
	const x = c > 0 ? 8.45 * Math.abs(c) ** 0.72 : -4.4 * Math.abs(c) ** 0.7;
	const k = x + (c > 0 ? 1 : -1) * grow * Math.abs(c);
	const shift = -side * 0.35 * smooth(0, 8, x);
	return [k, shift + Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** 0.75 * (lerp(2.55, 3.0, smooth(-1, 4, x)) + grow)];
}

function buildSole(b: PartBuilder, s: Side, z0: number): void {
	const side = sideSign(s);
	const slab = (rows: readonly (readonly [number, number, number])[], seg: number, o: { pal: number; palAt?: (i: number, a: number) => number | undefined; twist?: number; capEnd?: boolean; capStart?: boolean }) =>
		b.loft(
			rows.map(([y, , shade]): Ring => ({ c: [0, y, 0], f: 1, s: 1, w: bone(`foot${s}`), shade })),
			{
				seg,
				...o,
				deform: (p, _t, a, i) => {
					const [x, z] = outline(side, a + (o.twist ?? 0) * i, rows[i]![1]);
					p.set(x, rows[i]![0] + 0.16 * Math.max(0, x - 6), z0 + z);
				},
				weightAt: (p) => shoeWeights(s, p.x)
			}
		);
	if (b.lod === 2) {
		slab([[0, 0.15, 0.8], [BAND, 0.25, 1]], 8, { pal: DARK, palAt: (_i, a) => (Math.sin(a * 4) > 0 ? AMBER : DARK), capEnd: true });
		return;
	}
	// Rubber tread, hazard band, lip of the upper.
	slab(b.pick([[0, 0.1, 0.7], [0.2, 0.32, 0.8], [SOLE, 0.34, 1], [SOLE, 0.1, 1]], [[0, 0.1, 0.7], [SOLE, 0.32, 1]], []), b.pick(16, 9, 8), { pal: DARK, capStart: true });
	const n = b.pick(26, 10, 8);
	slab([[SOLE - 0.05, 0.16, 0.95], [BAND, 0.16, 1]], n, { pal: AMBER, twist: -(Math.PI * 2) / n, palAt: (_i, a) => (Math.floor((a / (Math.PI * 2)) * n) % 2 ? AMBER : DARK) });
	if (b.lod === 0) slab([[BAND - 0.05, 0.12, 0.9], [BAND + 0.04, 0.36, 1], [BAND + 0.4, 0.1, 1.05]], 16, { pal: DARK });
}

/** Round body along a path: [x, y, radius, palette, shade]. */
function turned(b: PartBuilder, s: Side, z: number, rows: readonly (readonly [number, number, number, number, number])[], seg: number, caps: { capStart?: boolean; capEnd?: boolean } = {}): void {
	// Nozzles point back and down: rings tilt with the path.
	const u = new THREE.Vector3(rows[rows.length - 1]![1] - rows[0]![1], -(rows[rows.length - 1]![0] - rows[0]![0]), 0).normalize();
	b.loft(
		rows.map(([x, y, r, pal, shade]): Ring => ({ c: [x, y, z], f: r, s: r, w: bone(`foot${s}`), pal, shade })),
		{ seg, u: [u.x, u.y, 0], v: [0, 0, 1], ...caps }
	);
}

function buildThrusters(b: PartBuilder, s: Side, z0: number): void {
	for (const k of [-1, 1]) {
		const z = z0 + k * 1.5;
		const at = (t: number): readonly [number, number] => [-3.2 - t * 0.96, 3.05 - t * 0.26];
		const r = (t: number, rad: number, pal: number, shade = 1): readonly [number, number, number, number, number] => [...at(t), rad, pal, shade];
		// Tank, collar ring, flared bell; the fire lies deep inside.
		turned(
			b,
			s,
			z,
			b.pick(
				[r(0.2, 1.05, SILVER), r(2.0, 1.22, RED, 0.95), r(2.05, 1.36, RED), r(2.5, 1.36, DARK), r(2.6, 0.92, DARK, 0.8), r(3, 0.95, SILVER, 0.85), r(4.1, 1.42, SILVER), r(4.25, 1.38, SILVER, 1.1), r(4.2, 1.16, AMBER, 0.9), r(3.5, 0.7, AMBER), r(3.9, 0.4, AMBER, 1.2)],
				[r(0.4, 1.1, SILVER), r(2, 1.3, RED), r(2.7, 1.0, SILVER), r(4.2, 1.42, SILVER), r(4.1, 1.15, AMBER), r(3.5, 0.7, AMBER)],
				[r(0.8, 1.2, SILVER), r(2.6, 1.1, SILVER), r(4.2, 1.45, AMBER), r(3.7, 0.9, AMBER)]
			),
			b.pick(8, 5, 4),
			{ capEnd: true }
		);
	}
}

/** Swept fin: outline points [x, y] (counter-clockwise from the right), half thickness. */
function fin(b: PartBuilder, s: Side, pts: readonly (readonly [number, number])[], half: number, pal: number, place: (x: number, y: number, t: number) => THREE.Vector3): void {
	const cx = pts.reduce((t, p) => t + p[0], 0) / pts.length;
	const cy = pts.reduce((t, p) => t + p[1], 0) / pts.length;
	const rows = b.pick([[-half * 0.5, 0.85], [0, 1], [half * 0.5, 0.85]] as const, [[-half * 0.5, 0.95], [half * 0.5, 0.95]] as const, [[-half * 0.5, 0.95], [half * 0.5, 0.95]] as const);
	b.loft(
		rows.map(([t]): Ring => ({ c: [0, 0, t], f: 1, s: 1, w: bone(`foot${s}`), pal })),
		{
			seg: pts.length,
			u: [1, 0, 0],
			v: [0, 1, 0],
			capStart: true,
			capEnd: true,
			deform: (p, _t, a, i) => {
				const q = pts[Math.round((a / (Math.PI * 2)) * pts.length) % pts.length]!;
				const [t, k] = rows[i]!;
				p.copy(place(lerp(cx, q[0], k), lerp(cy, q[1], k), t));
			}
		}
	);
}

function buildBoot(b: PartBuilder, s: Side): void {
	const side = sideSign(s);
	const z0 = BIND[`foot${s}`][2] + side * 0.15;
	const xs = b.pick([-4.3, -3.6, -0.6, 1.4, 4.2, 4.9, 5, 6.8, 8, 8.3], [-4.3, -2.6, 1, 4.9, 7, 8.2], [-4.4, 0, 4.9, 8.2]);
	b.loft(
		xs.map((x): Ring => {
			const [, hw, top, dz] = sample(UPPER, x) as [number, number, number, number];
			const lo = lerp(1.2, 2, smooth(6.6, 8.2, x));
			// The toe cap stands proud of the instep.
			const d = b.lod === 0 && x >= 5 ? 0.16 : 0;
			return { c: [x, (top + lo) / 2 + d / 2, z0 + side * dz], f: (top - lo) / 2 + d, s: hw + d, n: 2.3, w: shoeWeights(s, x), pal: x >= 4.9 ? RED : SILVER };
		}),
		{ seg: b.pick(11, 6, 6), u: [0, 1, 0], v: [0, 0, 1], capStart: true, capEnd: true, pal: SILVER, shadeAt: (p) => lerp(0.8, 1, smooth(1.4, 3.2, p.y)) }
	);
	buildSole(b, s, z0);
	// Shaft: ringed like a pressure boot, inside the trousers.
	const ring = (y: number, r: number, pal: number = SILVER, shade = 1): Ring => ({ c: [lerp(-0.95, -0.3, smooth(4, 8, y)), y, z0], f: r + 0.2, b: r, s: r, w: legWeights(s, y), pal, shade });
	b.loft(
		b.pick(
			[ring(3.6, 2.25), ring(5.2, 2.3), ring(5.4, 2.05, DARK, 0.9), ring(5.8, 2.32), ring(6.6, 2.36), ring(6.8, 2.1, DARK, 0.9), ring(7.2, 2.4), ring(8.2, 2.35, RED), ring(8.3, 2.6, RED), ring(9.3, 2.6, RED), ring(9.2, 2.0, DARK, 0.6)],
			[ring(3.6, 2.25), ring(5.4, 2.15), ring(8.2, 2.3, RED), ring(8.3, 2.55, RED), ring(9.3, 2.55, RED)],
			[ring(3.6, 2.2), ring(8.2, 2.3, RED), ring(9.3, 2.4, RED)]
		),
		{ seg: b.pick(10, 6, 4), capEnd: true }
	);
	buildThrusters(b, s, z0);
	// Fins: a big one outside the heel, a small one inside, a tall one between the nozzles.
	const wing: readonly (readonly [number, number])[] = [[1.2, 2.0], [-1.6, 3.6], [-5.4, 5.0], [-6.2, 4.7], [-4.8, 2.4], [-3.6, 1.9]];
	const wingAt = (k: number, size: number) => (x: number, y: number, t: number) => {
		const out = size * Math.max(0, y - 1.9) * 0.45;
		return new THREE.Vector3(x, y, z0 + k * (2.55 + out) + t);
	};
	fin(b, s, wing, 0.3, RED, wingAt(side, 1));
	if (b.lod === 0) fin(b, s, wing.map(([x, y]) => [x * 0.9 - 0.2, 2 + (y - 2) * 0.7] as const), 0.3, RED, wingAt(-side, 0.35));
	fin(b, s, [[-3.4, 3.2], [-4.4, 5.6], [-6.4, 6.9], [-7.1, 6.8], [-6.1, 3.4], [-5, 2.7]], 0.34, RED, (x, y, t) => new THREE.Vector3(x, y, z0 + t));
	if (b.lod > 0) return;
	// Glowing dial on the outside, instep clamp, bolts on the toe cap.
	for (const [x, y, r, pal, d] of [[0.6, 3.5, 0.95, DARK, 2.78], [0.6, 3.5, 0.6, AMBER, 2.98]] as const)
		b.loft(
			[0, 0.3].map((h): Ring => ({ c: [x, y, z0 + side * (d + h)], f: r - h * 0.3, s: r - h * 0.3, w: shoeWeights(s, x) })),
			{ seg: 8, u: [1, 0, 0], v: [0, 1, 0], pal, capEnd: true }
		);
	for (const x of [1.7, 3.2]) {
		const [, hw, top] = sample(UPPER, x) as [number, number, number];
		b.loft(
			[-0.5, -0.36, 0.36, 0.5].map((d, i): Ring => ({ c: [x + d, (top + 1.2) / 2, z0 - side * 0.1], f: (top - 1.2) / 2 + (i % 3 ? 0.2 : -0.1), s: hw + (i % 3 ? 0.2 : -0.1), n: 2.3, w: shoeWeights(s, x) })),
			{ seg: 9, u: [0, 1, 0], v: [0, 0, 1], pal: DARK }
		);
		b.box([x + 0.1, top + 0.15, z0 - side * 0.1], [0.75, 0.4, 1.3], { w: shoeWeights(s, x), pal: AMBER, rot: [0, 0, -0.35] });
	}
}

registerItemMesh('shoes_rocket', {
	colors: [0xc9d0da, 0xd9352b, 0x22252c, 0xffb31f],
	glow: [0, 0, 0, 0.55],
	build(b) {
		for (const s of SIDES) buildBoot(b, s);
	}
});
