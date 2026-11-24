import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { PAL, sample, superellipse, type PartBuilder } from '../mesh-kit.js';
import { HEAD, hatRing } from '../shop-items.js';

/** Crown profile: y, front, back, side radius. */
const CROWN: readonly (readonly number[])[] = [
	[-1, 5.5, 5.85, 5.2],
	[0.2, 5.55, 5.9, 5.25],
	[1.4, 5.4, 5.75, 5.1],
	[2.7, 5.1, 5.4, 4.8],
	[3.9, 4.75, 5.05, 4.45],
	[4.15, 4.8, 5.1, 4.5],
	[4.4, 4.55, 4.85, 4.25],
	[4.75, 3.4, 3.7, 3.2],
	[4.95, 1.4, 1.6, 1.3]
];

/** Soft dents in the cloth, none at the brim. */
const crease = (a: number, y: number): number => 0.014 * Math.max(0, Math.min(1, y / 2)) * (Math.sin(a * 3 + 0.8) + Math.sin(a * 5 - y * 0.8));

/** Point on the crown at an angle and height, `off` outside it. */
function crownAt(a: number, y: number, off: number): THREE.Vector3 {
	const r = sample(CROWN, y);
	const [c, s] = superellipse(a, 2.2);
	const k = 1 + crease(a, y);
	return new THREE.Vector3((0.1 + ((c >= 0 ? r[1]! : r[2]!) + off) * c) * k, y, (r[3]! + off) * s * k);
}

/** Point on the brim, `k` 0 at the crown to 1 at the edge, `off` above it: sloped and slightly wavy. */
function brimAt(a: number, k: number, off: number): THREE.Vector3 {
	const [c, s] = superellipse(a, 2.2);
	const wave = k * k * (0.24 * Math.sin(a * 3 + 2.2) + 0.15 * Math.sin(a * 5 + 0.6));
	const out = k * (3.1 - 0.3 * c) + off * 0.5 + wave * 0.35;
	return new THREE.Vector3(0.1 + ((c >= 0 ? 5.45 : 5.75) + out) * c, -0.2 - 1.25 * k - 0.6 * k * k + 0.95 * k * Math.max(0, c) + wave + off * 0.85, (5.15 + out) * s);
}

/** A patch of cloth to print on: x to the right, y up, seen from outside. */
type Print = (x: number, y: number) => THREE.Vector3;

/** Pointed blade from (x, y) in direction `dir` (0 = up, positive = right). */
function blade(b: PartBuilder, at: Print, x: number, y: number, dir: number, len: number, w: number, pal: number, shade = 1): void {
	const ux = Math.sin(dir);
	const uy = Math.cos(dir);
	const p = (t: number, side: number) => at(x + ux * len * t + uy * w * side, y + uy * len * t - ux * w * side);
	const rows = [[p(0, 0), p(0.5, 0.5)], [p(0.5, -0.5), p(1, 0)]];
	b.grid(rows, { w: HEAD, pal, shadeAt: () => shade });
}

/** Feathered palm frond: a bent spine with rows of slanted leaflets. */
function frond(b: PartBuilder, at: Print, tilt: number, size: number, bend: number): void {
	if (b.lod === 2) {
		blade(b, at, -Math.sin(tilt) * size * 0.5, -Math.cos(tilt) * size * 0.5, tilt + bend * 0.5, size, size * 0.45, PAL.hatB, 0.92);
		return;
	}
	const pairs = b.pick(5, 3, 0);
	const spine = (t: number): [number, number, number] => {
		const d = tilt + bend * t;
		const m = tilt + bend * t * 0.5;
		return [Math.sin(m) * size * (t - 0.45), Math.cos(m) * size * (t - 0.45), d];
	};
	for (let i = 0; i < pairs; i++) {
		const t = 0.2 + (0.66 * i) / Math.max(1, pairs - 1);
		const [x, y, d] = spine(t);
		const len = size * (0.56 - 0.5 * Math.abs(t - 0.4));
		for (const side of [-1, 1]) blade(b, at, x, y, d + side * (1.12 - 0.35 * t), len, size * b.pick(0.15, 0.24, 0), PAL.hatB, side > 0 ? 1.04 : 0.84);
	}
	const [x, y, d] = spine(0.86);
	blade(b, at, x, y, d, size * 0.32, size * b.pick(0.14, 0.22, 0), PAL.hatB);
	const w = size * b.pick(0.028, 0.04, 0);
	b.grid(b.pick([0, 0.45, 0.9], [0, 0.9], []).map((t) => {
		const [px, py, pd] = spine(t);
		return [-1, 1].map((q) => at(px + Math.cos(pd) * w * q, py - Math.sin(pd) * w * q).multiplyScalar(1.004));
	}), { w: HEAD, pal: PAL.hatB, shadeAt: () => 0.62 });
}

/** Small five-petal flower. */
function flower(b: PartBuilder, at: Print, size: number): void {
	for (let i = 0; i < 5; i++) blade(b, at, 0, 0, 0.3 + (i / 5) * Math.PI * 2, size, size * 0.8, PAL.hatD, i % 2 ? 0.9 : 1.02);
	if (b.lod > 0) return;
	for (let i = 0; i < 3; i++) blade(b, (x, y) => at(x, y).multiplyScalar(1.006), 0, 0, i * 2.1, size * 0.36, size * 0.36, PAL.hatC);
}

registerItemMesh('hat_bucket', {
	hides: ['hair'],
	colors: [0x1d5a68, 0x7fc26a, 0xf5e8c8, 0xf27d58],
	build(b) {
		b.socket('hat', () => {
			const seg = b.pick(36, 16, 10);
			const off = b.pick(0.09, 0.14, 0.2);

			// Crown with a piped seam around the top.
			const rings = b.pick(CROWN, CROWN.filter((_, i) => i !== 2 && i !== 4), CROWN.filter((_, i) => i !== 1 && i !== 2 && i !== 4 && i !== 5));
			b.loft(rings.map(([y, f, back, s]) => hatRing(y!, f!, back!, s!)), {
				seg,
				pal: PAL.hatA,
				capEnd: true,
				deform: (p, _t, a) => {
					const k = 1 + crease(a, p.y);
					p.x *= k;
					p.z *= k;
				},
				palAt: (i) => (b.lod === 0 && i === 5 ? PAL.hatD : PAL.hatA),
				shadeAt: (p) => (p.y < -0.1 ? 0.8 : p.y > 4.5 ? 0.94 : 1)
			});

			// Brim: lining from the crown out, piped edge, top back in. The centres only set the winding.
			const top = b.pick([1, 0.94, 0.7, 0.46, 0.22, 0], [1, 0.92, 0.5, 0], [1, 0]);
			const under = b.pick([0, 0.5, 0.97], [0, 0.97], [0, 0.97]);
			const n = under.length;
			const brim: [number, number][] = [...under.map((k): [number, number] => [k, -0.3]), ...top.map((k): [number, number] => [k, 0])];
			b.loft(brim.map((_, i) => ({ ...hatRing(i, 5, 5, 5), shade: i < n ? 0.78 : 1 })), {
				seg,
				deform: (p, _t, a, i) => {
					p.copy(brimAt(a, ...brim[i]!));
				},
				// The quilted rows dip at the stitches.
				shadeAt: (_p, _a, i) => (i >= n && i - n > 1 && b.lod === 0 ? 0.95 : 1),
				palAt: (i) => (i < n - 1 ? PAL.hatC : b.lod < 2 && i < n + 1 ? PAL.hatD : PAL.hatA)
			});

			// Print.
			const crown = (deg: number, y0: number): Print => {
				const a0 = (deg * Math.PI) / 180;
				return (x, y) => crownAt(a0 - x / 5.3, y0 + y, off);
			};
			const onBrim = (deg: number, k0: number): Print => {
				const a0 = (deg * Math.PI) / 180;
				return (x, y) => brimAt(a0 - x / 7, k0 - y / 3.3, off);
			};
			const leaves: [number, number, number, number, number][] = [[2, 1.95, -0.75, 2.9, 0.7], [-42, 1.85, 0.7, 2.7, -0.6], [47, 1.9, 0.5, 2.7, -0.7], [131, 1.9, -0.6, 2.7, 0.7], [170, 1.9, 0.65, 2.9, -0.7], [-142, 1.9, -0.6, 2.7, 0.6]];
			for (const [deg, y, tilt, size, bend] of leaves) frond(b, crown(deg, y), tilt, size, bend);
			for (let i = 0; i < b.pick(8, 6, 0); i++) frond(b, onBrim(i * b.pick(45, 60, 0) + 22, 0.5), i % 2 ? 1.9 : -1.2, 2.3, i % 2 ? -0.5 : 0.5);
			if (b.lod < 2) {
				for (const [deg, y] of [[24, 2.75], [-20, 1.1], [149, 2.75], [-166, 1.1], [-70, 1.5], [70, 2.8], [-112, 2.8], [106, 2.4]] as const) flower(b, crown(deg, y), 0.62);
			}
			if (b.lod > 0) return;

			// Stitching: three rings on the brim and one under the top seam.
			const dash = (count: number, at: (a: number, side: number) => THREE.Vector3) => {
				for (let i = 0; i < count; i++) {
					const a = (i / count) * Math.PI * 2;
					const e = a + (0.6 / count) * Math.PI * 2;
					b.grid([[at(e, -1), at(a, -1)], [at(e, 1), at(a, 1)]], { w: HEAD, pal: PAL.hatC, shadeAt: () => 0.92 });
				}
			};
			for (const k of [0.22, 0.5, 0.82]) dash(60, (a, side) => brimAt(a, k - side * 0.013, 0.07));
			dash(48, (a, side) => crownAt(a, 3.6 + side * 0.045, 0.06));

			// Two eyelets on each side.
			for (const deg of [84, 100, -84, -100]) {
				const a0 = (deg * Math.PI) / 180;
				const ring = (r: number, o: number) => Array.from({ length: 8 }, (_, j) => {
					const t = (j / 8) * Math.PI * 2;
					return crownAt(a0 - (Math.cos(t) * r) / 5.2, 0.95 + Math.sin(t) * r, o);
				});
				b.grid([ring(0.4, 0.02), ring(0.32, 0.2), ring(0.2, 0.2), ring(0.16, 0.12)], { w: HEAD, pal: PAL.hatC, wrap: true, shadeAt: (_p, i) => (i > 2 ? 0.6 : 0.88) });
				b.grid([ring(0.2, 0.13), ring(0.01, 0.13)], { w: HEAD, pal: PAL.hatA, wrap: true, shadeAt: () => 0.25 });
			}
		}, { pos: [0, 0.45, 0], scale: 1 });
	}
});
