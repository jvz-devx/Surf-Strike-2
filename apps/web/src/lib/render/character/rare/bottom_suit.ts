/** Tailored suit trousers: slim straight legs with a pressed crease, black belt and silver buckle. */
import * as THREE from 'three';
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { bone, lerp, mix, PAL, sample, smooth, superellipse, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';
import { CHARCOAL, legShade, SILVER, WOOL } from './suit.js';

const CLOTH = PAL.bottomA;
const BELT = PAL.bottomB;
const METAL = PAL.bottomC;
const SEAM = PAL.bottomD;

/** Leg: bind y, front, back, sideways. */
const LEG: readonly (readonly number[])[] = [
	[2.4, 3.3, 3.4, 3.05],
	[5, 3.2, 3.35, 3.0],
	[9, 3.1, 3.4, 2.95],
	[14, 3.15, 3.7, 3.1],
	[17.5, 3.35, 3.6, 3.25],
	[19.8, 3.65, 3.5, 3.35],
	[23, 3.7, 3.75, 3.55],
	[27, 4.1, 4.25, 3.9],
	[31, 4.65, 4.85, 4.25],
	[34, 4.85, 5.2, 4.3],
	[35.2, 4.4, 4.75, 3.7],
	[36.2, 3.0, 3.3, 2.2]
];
const LEG_X = -0.2;
/** Height of the hem: resting on the shoe in front, longer behind. */
const HEM_FRONT = 3.7;
const HEM_BACK = 2.3;

/** Seat: y, front, back, sideways, exponent. */
const SEAT: readonly (readonly number[])[] = [
	[30.6, 1.6, 2.2, 2, 2.2],
	[31.8, 3.3, 4.1, 5.2, 2.6],
	[33, 4.35, 5, 8, 2.8],
	[34.4, 4.95, 5.35, 8.3, 2.7],
	[35.4, 4.95, 5.35, 8.05, 2.55],
	[37, 4.75, 5.15, 7.55, 2.4],
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

function seam(b: PartBuilder, pts: readonly THREE.Vector3[], w: (p: THREE.Vector3) => Weights, r = 0.1): void {
	b.loft(
		pts.map((p): Ring => ({ c: [p.x, p.y, p.z], f: r, s: r, w: w(p) })),
		{ seg: 4, pal: SEAM, capStart: true, capEnd: true }
	);
}

function buildLegOf(b: PartBuilder, s: Side): void {
	const z0 = BIND[`thigh${s}`][2];
	const out = sideSign(s);
	// Angles of the columns: narrow ones beside the creases, front and back.
	const angles = b.pick(
		[0, 0.2, 0.62, 1.1, 1.57, 2.05, 2.55, 2.94],
		[0, 0.4, 1.1, 1.85, 2.6],
		[0, 1.15, 2.2]
	);
	const half = [...angles, Math.PI];
	const cols = [...half, ...angles.slice(1).reverse().map((a) => -a)];
	const seg = cols.length;
	const ys = b.pick([36.2, 35.2, 33.4, 30.5, 27, 23.6, 21.4, 19.6, 17.6, 14, 10, 7, 5.2], [36.2, 34.8, 31, 26, 21.5, 18.5, 13, 7], [36, 32, 26, 19.8, 12]);
	const rows: readonly (readonly [number, number, number])[] = [...ys.map((y) => [y, 0, 1] as const), [0, 0.04, 0.95], [0, -0.35, 0.5], [0, -0.9, 0.35]];
	b.loft(
		rows.map(([y], i): Ring => ({ c: [0, -i, 0], f: 1, s: 1, w: legWeights(s, y), pal: i > ys.length ? SEAM : undefined })),
		{
			seg,
			capStart: true,
			pal: CLOTH,
			deform: (p, _t, a, i) => {
				const j = Math.round((a / (Math.PI * 2)) * seg) % seg;
				const c = cols[j]!;
				const [y0, d] = rows[i]!;
				const hem = lerp(HEM_FRONT, HEM_BACK, smooth(0, Math.PI, Math.abs(c)));
				const y = i < ys.length ? y0 : hem + (i === rows.length - 1 ? 1.2 : 0);
				const r = sample(LEG, y);
				const [u, v] = superellipse(c, y > 28 ? 2.5 : 2.15);
				const press = 1 - smooth(31, 35.5, y);
				let fx = (u >= 0 ? r[1]! : r[2]!) + d;
				// Break: the front dents in above the hem.
				if (b.lod === 0 && u > 0) fx -= 0.3 * Math.exp(-(((y - 5.4) / 0.9) ** 2)) * u;
				if (b.lod === 0 && u < 0) fx -= 0.12 * Math.exp(-(((y - 18.4) / 1.6) ** 2)) * -u;
				p.set(LEG_X + fx * u, y, z0 + (r[3]! + d) * v);
				if (i < ys.length + 1 && b.lod < 2 && (c === 0 || c === Math.PI)) p.x += (c === 0 ? 0.34 : -0.28) * press;
			},
			weightAt: (p) => legWeights(s, p.y),
			shadeAt: (p, a, i) => {
				const c = cols[Math.round((a / (Math.PI * 2)) * seg) % seg]!;
				const press = b.lod === 2 ? 0 : 1 - smooth(32, 35.5, p.y);
				const crease = c === 0 ? 0.28 : Math.abs(c) < 0.3 ? -0.12 * (c * out > 0 ? 0.6 : 1.3) : c === Math.PI ? 0.16 : Math.abs(c) > 2.8 ? -0.1 : 0;
				return rows[i]![2] * legShade(p) * (0.9 + crease * press) * (b.lod === 0 ? 1 - 0.12 * Math.exp(-(((p.y - 5.4) / 0.7) ** 2)) * smooth(0, 2, p.x) : 1);
			}
		}
	);
	if (b.lod > 0) return;
	// Slanted side pocket.
	const pts = [[35.2, 4.9], [33.6, 5.7], [32, 6.6], [30.8, 7.3]].map(([y, z]) => new THREE.Vector3(hipX(y!, z!, 1) + 0.02, y!, out * z!));
	seam(b, pts, (p) => (p.y > 34 ? seatWeights(p.y, p.z) : legWeights(s, p.y)), 0.11);
	// Jetted back pocket with a button.
	const zb = out * 4.2;
	const jet = [-1.9, -0.9, 0, 0.9, 1.9].map((dz) => new THREE.Vector3(hipX(33.9, zb + dz, -1) - 0.02, 33.9, zb + dz));
	b.loft(
		jet.map((p): Ring => ({ c: [p.x, p.y, p.z], f: 0.12, s: 0.16, w: legWeights(s, p.y) })),
		{ seg: 4, u: [1, 0, 0], v: [0, 1, 0], pal: SEAM, capStart: true, capEnd: true }
	);
	b.ball([hipX(33.2, zb, -1) - 0.06, 33.2, zb], [0.16, 0.28, 0.28], { w: legWeights(s, 33.2), pal: SEAM, seg: 6, rings: 4 });
}

function buildHips(b: PartBuilder): void {
	const full = b.pick(0, 0.2, 0.35);
	const seg = b.pick(22, 10, 6);
	b.loft(
		SEAT.map(([y, f, back, s, n]): Ring => ({ c: [LEG_X, y!, 0], f: f! + full, b: back! + full, s: s! + full * 0.5, n, w: bone('pelvis') })),
		{ seg, pal: CLOTH, capStart: true, capEnd: true, weightAt: (p) => seatWeights(p.y, p.z), shadeAt: (p) => legShade(p) * 0.9 }
	);
	const at = (y: number, d: number, shade = 1): Ring => {
		const q = sample(SEAT, y);
		return { c: [LEG_X, y, 0], f: q[1]! + d + full, b: q[2]! + d + full, s: q[3]! + d + full, n: q[4], w: bone('pelvis'), pal: BELT, shade };
	};
	b.loft(b.pick([at(35.6, -0.2, 0.5), at(35.6, 0.2, 0.6), at(36.2, 0.26, 1.25), at(36.8, 0.2, 0.7), at(36.85, -0.25, 0.5)], [at(35.6, 0.15, 0.7), at(36.2, 0.26, 1.2), at(36.85, 0.1, 0.6)], [at(35.6, 0.2), at(36.85, 0.15)]), { seg, weightAt: (p) => seatWeights(Math.max(p.y, 35.6), p.z) });
	if (b.lod === 2) return;
	// Slim buckle: a silver frame round the belt.
	const pel = bone('pelvis');
	b.box([5 + full, 36.2, 0], [0.4, 1.5, 1.7], { w: pel, pal: METAL });
	if (b.lod === 1) return;
	b.box([5.17, 36.2, 0.1], [0.16, 0.9, 1.05], { w: pel, pal: BELT, shade: 0.9 });
	b.box([5.24, 36.2, -0.15], [0.14, 0.2, 1.3], { w: pel, pal: METAL });
	b.box([4.96, 36.2, 1.75], [0.34, 1.35, 0.4], { w: pel, pal: BELT, shade: 1.2 });
	for (const [z, dir] of [[3.6, 1], [-3.6, 1], [4.2, -1], [-4.2, -1], [0, -1]] as const) b.box([hipX(36.2, z, dir) + dir * 0.18, 36.2, z], [0.36, 1.75, 0.5], { w: seatWeights(36.2, z), pal: CLOTH, shade: 0.78, rot: [0, dir * z * 0.05, 0] });
	seam(b, [[35.4, 0.85], [34, 0.85], [32.9, 0.6], [32.2, 0]].map(([y, z]) => new THREE.Vector3(hipX(y!, z!, 1) + 0.01, y!, z!)), (p) => seatWeights(p.y, p.z), 0.08);
}

registerItemMesh('bottom_suit', {
	hides: ['shins'],
	// Wool, belt leather, silver, seams.
	colors: [WOOL, CHARCOAL, SILVER, 0x3a3d44],
	build(b) {
		buildHips(b);
		for (const s of SIDES) buildLegOf(b, s);
	}
});
