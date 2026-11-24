/** Lava pants: dark rock plates (Voronoi cells) over a glowing orange to yellow base, straight leg. */
import * as THREE from 'three';
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { bone, lerp, mix, PAL, sample, smooth, superellipse, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

const ROCK = PAL.bottomA;
const STONE = PAL.bottomB;
const ORANGE = PAL.bottomC;
const YELLOW = PAL.bottomD;

/** Leg: bind y, front, back, sideways. */
const LEG: readonly (readonly number[])[] = [
	[2.7, 3.3, 3.5, 3.15],
	[5, 3.25, 3.5, 3.1],
	[9, 3.25, 3.55, 3.1],
	[14.5, 3.35, 3.8, 3.25],
	[17.5, 3.5, 3.65, 3.3],
	[19.8, 3.75, 3.55, 3.4],
	[22.5, 3.8, 3.8, 3.55],
	[27, 4.2, 4.3, 3.9],
	[31, 4.65, 4.85, 4.25],
	[34, 4.75, 5.1, 4.25],
	[35.4, 4.3, 4.6, 3.6],
	[36.4, 3.0, 3.4, 2.2]
];
const HEM = 2.8;
const LEG_X = -0.2;
/** Seat: y, front, back, sideways, exponent. */
const SEAT: readonly (readonly number[])[] = [
	[30.6, 1.6, 2.2, 2, 2.2],
	[31.8, 3.3, 4.1, 5.2, 2.6],
	[33, 4.3, 4.95, 7.9, 2.8],
	[34.4, 4.95, 5.3, 8.2, 2.7],
	[35.6, 4.85, 5.3, 7.9, 2.5],
	[37, 4.75, 5.1, 7.5, 2.4],
	[38.6, 4.0, 4.4, 6.6, 2.3]
];

function seatWeights(y: number, z: number): Weights {
	if (y > 35.5) return mix('pelvis', 'spine', smooth(36.5, 39, y) * 0.3);
	return mix('pelvis', z > 0 ? 'thighHR' : 'thighHL', smooth(1, 6, Math.abs(z)) * lerp(0.75, 0.3, smooth(33, 35.4, y)));
}

const onLeg = (s: Side, a: number, y: number, off: number): THREE.Vector3 => {
	const r = sample(LEG, y);
	const [c, k] = superellipse(a, lerp(2.15, 2.5, smooth(26, 30, y)));
	return new THREE.Vector3(LEG_X + (c >= 0 ? r[1]! + off : r[2]! + off) * c, y, BIND[`thigh${s}`][2] + (r[3]! + off) * k);
};
const onSeat = (a: number, y: number, off: number): THREE.Vector3 => {
	const r = sample(SEAT, y);
	const [c, k] = superellipse(a, r[4]!);
	return new THREE.Vector3(LEG_X + (c >= 0 ? r[1]! + off : r[2]! + off) * c, y, (r[3]! + off) * k);
};

const hash = (n: number): number => {
	const x = Math.sin(n * 127.1 + 11.7) * 43758.5453;
	return x - Math.floor(x);
};

type P2 = readonly [number, number];
/** Irregular cells on a cylinder unrolled to `width`, `gap` apart. Counter-clockwise. */
function cells(width: number, y0: number, y1: number, rows: number, cols: number, gap: number, seed: number): P2[][] {
	const seeds: P2[] = [];
	const h = (y1 - y0) / rows;
	for (let r = 0; r < rows; r++)
		for (let c = 0; c < cols; c++) {
			const k = seed + r * 31 + c * 7;
			seeds.push([((c + (r % 2) * 0.5 + (hash(k) - 0.5) * 0.62) / cols) * width, y0 + (r + 0.5 + (hash(k + 0.5) - 0.5) * 0.7) * h]);
		}
	return seeds.map((s, i) => {
		let poly: P2[] = [[s[0] - 9, y0], [s[0] + 9, y0], [s[0] + 9, y1], [s[0] - 9, y1]];
		seeds.forEach((t, j) => {
			for (const turn of [-1, 0, 1]) {
				if (i === j && turn === 0) continue;
				const dx = t[0] + turn * width - s[0];
				const dy = t[1] - s[1];
				const l = Math.hypot(dx, dy);
				const side = (p: P2) => ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / l - l / 2 + gap / 2;
				const out: P2[] = [];
				poly.forEach((p, n) => {
					const q = poly[(n + 1) % poly.length]!;
					const a = side(p);
					const b = side(q);
					if (a <= 0) out.push(p);
					if (a * b < 0) out.push([lerp(p[0], q[0], a / (a - b)), lerp(p[1], q[1], a / (a - b))]);
				});
				poly = out;
			}
		});
		// Drop corners that are almost on top of each other.
		return poly.filter((p, n) => {
			const q = poly[(n + 1) % poly.length]!;
			return Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.55;
		});
	});
}

/** One raised plate with bevelled edges. */
function plate(b: PartBuilder, poly: readonly P2[], on: (u: number, y: number, off: number) => THREE.Vector3, w: (p: THREE.Vector3) => Weights, raise: number, pal: number, shade: number): void {
	if (poly.length < 3) return;
	// Far away only the top face is left; a loft of one ring faces the other way.
	if (b.lod > 0) poly = [...poly].reverse();
	const cx = poly.reduce((t, p) => t + p[0], 0) / poly.length;
	const cy = poly.reduce((t, p) => t + p[1], 0) / poly.length;
	const rings = b.lod === 0 ? ([[1, -0.5], [0.92, raise + 0.08]] as const) : ([[0.95, raise + 0.2]] as const);
	b.loft(
		rings.map((_, i): Ring => ({ c: [0, i, 0], f: 1, s: 1, w: bone('pelvis'), shade: shade * (i === 0 && b.lod === 0 ? 0.6 : 1) })),
		{
			seg: poly.length,
			pal,
			capEnd: true,
			deform: (p, _t, a, i) => {
				const q = poly[Math.round((a / (Math.PI * 2)) * poly.length) % poly.length]!;
				const [k, off] = rings[i]!;
				p.copy(on(lerp(cx, q[0], k), lerp(cy, q[1], k), off));
			},
			weightAt: (p) => w(p),
			shadeAt: (_p, a, i) => (i === 1 ? 1 + 0.12 * Math.sin(a) : 1)
		}
	);
}

/** Lava is hotter (yellow) in some places. */
const lava = (a: number, y: number): number => (Math.sin(a * 2 + y * 0.45) + Math.sin(y * 0.83 - a * 3) > 0.35 ? YELLOW : ORANGE);

const WIDTH = Math.PI * 2 * 3.7;

function buildLegOf(b: PartBuilder, s: Side): void {
	const z0 = BIND[`thigh${s}`][2];
	const ring = (y: number, d = 0, pal?: number, shade = 1): Ring => {
		const r = sample(LEG, y);
		return { c: [LEG_X, y, z0], f: r[1]! + d, b: r[2]! + d, s: r[3]! + d, n: lerp(2.15, 2.5, smooth(26, 30, y)), w: legWeights(s, y), pal, shade };
	};
	if (b.lod === 2) {
		// Far away: bands of rock with lava seams.
		const rows = [36.2, 34, 29, 28, 23, 22, 19, 14, 13, 8.6, 7.8, HEM].map((y) => ring(y, 0.2));
		b.loft(rows, { seg: 6, pal: ROCK, capStart: true, capEnd: true, palAt: (i, a) => ((i === 2 || i === 4 || i === 7 || i === 9) && Math.sin(a * 3 + i * 2) > -0.8 ? (i % 2 ? YELLOW : ORANGE) : ROCK) });
		return;
	}
	const ys = b.pick([36.2, 34.8, 31, 27, 23, 20.6, 18, 14.5, 10, 6], [36.2, 34, 29, 23, 19.8, 16, 10], []);
	b.loft([...ys.map((y) => ring(y, b.lod === 0 ? -0.4 : -0.35)), ring(HEM, -0.35, ORANGE), ring(HEM, -0.7, STONE, 0.6), ring(HEM + 1.4, -1, STONE, 0.4)], {
		seg: b.pick(12, 7, 6),
		capStart: true,
		pal: ORANGE,
		palAt: (i, a) => (i < ys.length ? lava(a, ys[i]!) : undefined)
	});
	const polys = b.lod === 0 ? cells(WIDTH, HEM - 0.1, 34.6, 8, 5, 0.52, s === 'R' ? 3 : 57) : cells(WIDTH, HEM - 0.1, 34.8, 4, 6, 0.6, s === 'R' ? 3 : 57);
	polys.forEach((poly, i) => {
		const cy = poly.reduce((t, p) => t + p[1], 0) / poly.length;
		const ca = (poly.reduce((t, p) => t + p[0], 0) / poly.length / WIDTH) * Math.PI * 2;
		// Nothing between the legs, below the seat.
		if (cy > 29 && Math.sin(ca) * sideSign(s) < -0.8) return;
		plate(b, poly, (u, y, off) => onLeg(s, (u / WIDTH) * Math.PI * 2, y, off), (p) => legWeights(s, p.y), 0.3, hash(i * 3.3) > 0.68 ? STONE : ROCK, lerp(0.85, 1.12, hash(i * 1.7)));
	});
}

function buildHips(b: PartBuilder): void {
	b.loft(
		(b.lod === 0 ? SEAT : SEAT.filter((_, i) => i !== 1)).map(([y, f, back, s, n]): Ring => {
			// The lava lies deeper than the plates.
			const d = b.lod === 0 && y! < 35 ? 0.4 : 0;
			return { c: [LEG_X, y!, 0], f: f! - d, b: back! - d, s: s! - d, n, w: bone('pelvis') };
		}),
		{ seg: b.pick(18, 10, 6), pal: b.lod > 0 ? ROCK : ORANGE, capStart: true, capEnd: true, weightAt: (p) => seatWeights(p.y, p.z), palAt: (i, a) => (b.lod > 0 || i > 3 ? ROCK : lava(a, 31 + i * 1.6)) }
	);
	const at = (y: number, d: number, shade = 1): Ring => {
		const q = sample(SEAT, y);
		return { c: [LEG_X, y, 0], f: q[1]! + d, b: q[2]! + d, s: q[3]! + d, n: q[4], w: bone('pelvis'), shade };
	};
	// Rough stone belt with an ember for a buckle.
	b.loft([at(35.4, -0.2, 0.7), at(35.5, 0.3, 0.9), at(36.8, 0.28), at(36.9, -0.25, 0.8)], {
		seg: b.pick(24, 10, 6),
		pal: STONE,
		weightAt: (p) => seatWeights(Math.max(p.y, 35.6), p.z),
		shadeAt: (_p, a, i) => (b.lod === 0 ? 0.85 + 0.35 * hash(Math.round((a / (Math.PI * 2)) * 24) + i) : 1)
	});
	if (b.lod === 2) return;
	const w = bone('pelvis');
	b.ball([4.95, 36.15, 0], [0.5, 1.0, 1.3], { w, pal: ROCK, seg: b.pick(8, 6, 4), rings: b.pick(5, 4, 3) });
	b.ball([5.2, 36.15, 0], [0.45, 0.6, 0.8], { w, pal: YELLOW, seg: b.pick(6, 5, 4), rings: 4 });
	if (b.lod === 1) return;
	const width = Math.PI * 2 * 6.4;
	const polys = cells(width, 31.4, 35.5, 1, 12, 0.5, 9);
	polys.forEach((poly, i) => plate(b, poly, (u, y, off) => onSeat((u / width) * Math.PI * 2, y, off), (p) => seatWeights(p.y, p.z), 0.16, i % 3 ? ROCK : STONE, lerp(0.85, 1.1, hash(i * 2.1))));
}

registerItemMesh('bottom_lava', {
	hides: ['shins'],
	colors: [0x2e2725, 0x453a36, 0xff5410, 0xffb52e],
	glow: [0, 0, 0.75, 0.75],
	build(b) {
		buildHips(b);
		for (const s of SIDES) buildLegOf(b, s);
	}
});
