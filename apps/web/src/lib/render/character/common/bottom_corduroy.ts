/** Corduroy pants: rust cords with vertical wales, relaxed straight legs and a dark belt. */
import * as THREE from 'three';
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { bone, lerp, mix, PAL, sample, smooth, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

const CORD = PAL.bottomA;
const DARK = PAL.bottomB;
const BELT = PAL.bottomC;
const BRASS = PAL.bottomD;

/** Leg: bind y, front, back, sideways. */
const LEG: readonly (readonly number[])[] = [
	[2.7, 3.5, 3.75, 3.35],
	[5, 3.45, 3.75, 3.3],
	[9, 3.45, 3.75, 3.3],
	[14.5, 3.55, 3.95, 3.45],
	[17.5, 3.65, 3.85, 3.5],
	[19.8, 3.9, 3.75, 3.6],
	[22.5, 3.95, 4, 3.75],
	[27, 4.35, 4.45, 4.05],
	[31, 4.75, 4.95, 4.3],
	[34, 4.85, 5.2, 4.3],
	[35.4, 4.4, 4.75, 3.6],
	[36.4, 3.0, 3.4, 2.2]
];
const HEM = 2.8;
const LEG_X = -0.2;
/** Seat: y, front, back, sideways, exponent. */
const SEAT: readonly (readonly number[])[] = [
	[30.6, 1.6, 2.2, 2, 2.2],
	[31.8, 3.3, 4.1, 5.2, 2.6],
	[33, 4.35, 5, 8, 2.8],
	[34.4, 5.0, 5.4, 8.35, 2.7],
	[35.6, 4.95, 5.4, 8.0, 2.5],
	[37, 4.8, 5.2, 7.6, 2.4],
	[38.6, 4.0, 4.4, 6.6, 2.3]
];

function seatWeights(y: number, z: number): Weights {
	if (y > 35.5) return mix('pelvis', 'spine', smooth(36.5, 39, y) * 0.3);
	return mix('pelvis', z > 0 ? 'thighHR' : 'thighHL', smooth(1, 6, Math.abs(z)) * lerp(0.75, 0.3, smooth(33, 35.4, y)));
}

/** Outermost point of the hips; `dir`: 1 front, -1 back. */
function hipX(y: number, z: number, dir: 1 | -1): number {
	const at = (r: number, s: number, n: number, dz: number) => (Math.abs(dz) >= s ? -Infinity : dir * LEG_X + r * (1 - (Math.abs(dz) / s) ** n) ** (1 / n));
	const q = sample(SEAT, y);
	const l = sample(LEG, y);
	const c = dir > 0 ? 1 : 2;
	return dir * Math.max(0, at(q[c]!, q[3]!, q[4]!, z), at(l[c]!, l[3]!, 2.5, Math.abs(z) - 4.3));
}

const cloth = (p: THREE.Vector3): number => lerp(0.76, 1, smooth(0, 3, Math.abs(p.z) + Math.max(0, p.y - 28) * 0.35)) * lerp(0.86, 1, smooth(3, 8, p.y)) * (1 + 0.1 * Math.exp(-(((p.y - 21) / 3) ** 2)) * smooth(1, 3, p.x));

/** Ridge or groove of a column. */
const wale = (b: PartBuilder, a: number, seg: number): number => (b.lod === 0 ? (Math.round((a / (Math.PI * 2)) * seg) % 2 ? -1 : 1) : 0);
const ribShade = (b: PartBuilder, a: number, seg: number) => 1 + 0.27 * wale(b, a, seg);

function buildLegOf(b: PartBuilder, s: Side): void {
	const z0 = BIND[`thigh${s}`][2];
	const seg = b.pick(30, 9, 6);
	const ring = (y: number, d = 0, pal?: number, shade = 1): Ring => {
		const r = sample(LEG, y);
		return { c: [LEG_X, y, z0], f: r[1]! + d, b: r[2]! + d, s: r[3]! + d, n: y > 28 ? 2.5 : 2.15, w: legWeights(s, y), pal, shade };
	};
	const ys = b.pick([36.4, 35.2, 32.5, 27.5, 22.8, 19.8, 17.2, 12, 6.4, 4.6], [36.4, 34.8, 31, 27, 23, 19.8, 17, 11], [36, 32, 26, 19.8, 12]);
	b.loft([...ys.map((y) => ring(y)), ring(HEM, 0, undefined, 0.9), ring(HEM, -0.45, DARK, 0.6), ring(HEM + 1.4, -1, DARK, 0.4)], {
		seg,
		capStart: true,
		pal: CORD,
		deform: (p, _t, a, i) => {
			if (b.lod > 0 || i > ys.length) return;
			const knee = Math.exp(-(((p.y - 19) / 2.6) ** 2)) * (a > 2 && a < 4.3 ? 1 : 0.3);
			const hem = Math.exp(-(((p.y - 5.6) / 1.8) ** 2));
			const k = 1 + 0.02 * knee * Math.sin(p.y * 2.3 + a * 2) + 0.03 * hem * Math.sin(p.y * 2.4 + a) + 0.011 * wale(b, a, seg);
			p.x *= k;
			p.z = z0 + (p.z - z0) * k;
		},
		shadeAt: (p, a, i) => cloth(p) * (i <= ys.length ? ribShade(b, a, seg) : 1)
	});
	if (b.lod > 0) return;
	// Scooped pocket opening in a darker trim.
	const out = sideSign(s);
	const pts = [[35.3, 4.2], [33.8, 5.0], [32.4, 6.3], [31.6, 7.4]].map(([y, z]) => new THREE.Vector3(hipX(y!, z!, 1) + 0.02, y!, out * z!));
	b.loft(
		pts.map((p): Ring => ({ c: [p.x, p.y, p.z], f: 0.17, s: 0.17, w: p.y > 34 ? seatWeights(p.y, p.z) : legWeights(s, p.y) })),
		{ seg: 4, pal: DARK, capStart: true, capEnd: true }
	);
	// Back pocket with a flap and a button.
	const zb = out * 4.15;
	const box = (y: number, hy: number, d: number, pal: number, shade: number) => {
		const corner = (dy: number, dz: number, off: number) => {
			const y1 = y + dy * hy;
			const z1 = zb + dz * 2;
			return new THREE.Vector3(hipX(y1, z1, -1) - off, y1, z1);
		};
		const rows = [1, 0.96, -0.96, -1].map((dy, i) => [1, 0.96, 0, -0.96, -1].map((dz, j) => corner(dy, dz, i === 0 || i === 3 || j === 0 || j === 4 ? -0.2 : d)));
		b.grid(rows, { w: legWeights(s, y), pal, shadeAt: () => shade });
	};
	box(31.2, 1.9, 0.18, CORD, 0.92);
	box(32.7, 0.75, 0.34, DARK, 1);
	b.ball([hipX(32.4, zb, -1) - 0.42, 32.4, zb], [0.2, 0.34, 0.34], { w: legWeights(s, 32.4), pal: BRASS, seg: 6, rings: 4 });
}

function buildHips(b: PartBuilder): void {
	const full = b.pick(0, 0.2, 0.35);
	const seg = b.pick(28, 10, 6);
	b.loft(
		(b.lod === 0 ? SEAT : SEAT.filter((_, i) => i !== 1)).map(([y, f, back, s, n]): Ring => ({ c: [LEG_X, y!, 0], f: f! + full, b: back! + full, s: s! + full * 0.5, n, w: bone('pelvis') })),
		{ seg, pal: CORD, capStart: true, capEnd: true, weightAt: (p) => seatWeights(p.y, p.z), shadeAt: (p, a) => cloth(p) * ribShade(b, a, seg) }
	);
	const at = (y: number, d: number, shade = 1): Ring => {
		const q = sample(SEAT, y);
		return { c: [LEG_X, y, 0], f: q[1]! + d + full, b: q[2]! + d + full, s: q[3]! + d + full, n: q[4], w: bone('pelvis'), pal: BELT, shade };
	};
	b.loft([at(35.6, -0.2, 0.7), at(35.6, 0.22, 0.9), at(36.9, 0.22), at(36.95, -0.25, 0.8)], { seg: b.pick(20, 10, 6), weightAt: (p) => seatWeights(Math.max(p.y, 35.6), p.z) });
	if (b.lod > 1) return;
	const pel = bone('pelvis');
	b.box([5.03 + full, 36.25, 0], [0.36, 1.6, 2], { w: pel, pal: BRASS });
	if (b.lod > 0) return;
	b.box([5.2, 36.25, 0.1], [0.14, 0.95, 1.3], { w: pel, pal: BELT, shade: 0.7 });
	b.box([5.28, 36.25, -0.1], [0.12, 0.24, 1.4], { w: pel, pal: BRASS });
	for (const [z, dir] of [[3.4, 1], [-3.4, 1], [4.2, -1], [-4.2, -1], [0, -1]] as const) b.box([hipX(36.2, z, dir) + dir * 0.16, 36.2, z], [0.4, 1.9, 0.6], { w: seatWeights(36.2, z), pal: CORD, shade: 0.8, rot: [0, dir * z * 0.05, 0] });
	// Fly.
	const fly = [[35.4, 1.0], [34, 1.0], [32.9, 0.7], [32.2, 0]].map(([y, z]) => new THREE.Vector3(hipX(y!, z!, 1) + 0.02, y!, z!));
	b.loft(fly.map((p): Ring => ({ c: [p.x, p.y, p.z], f: 0.1, s: 0.1, w: seatWeights(p.y, p.z) })), { seg: 4, pal: DARK, capStart: true, capEnd: true });
}

registerItemMesh('bottom_corduroy', {
	hides: ['shins'],
	colors: [0xa9592f, 0x6b3419, 0x33241c, 0xd2b878],
	build(b) {
		buildHips(b);
		for (const s of SIDES) buildLegOf(b, s);
	}
});
