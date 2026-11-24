/** Puffer jacket: horizontally quilted amber jacket with a slate yoke, high padded collar, zip and elastic cuffs. */
import * as THREE from 'three';
import { alongArm, armSide, armWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { lerp, mix, PAL, sample, smooth, type PartBuilder, type Ring } from '../mesh-kit.js';
import { TORSO_TABLE, torsoWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import { sideSign } from '../skeleton.js';

const MAIN = PAL.topA;
const YOKE = PAL.topB;
const ZIP = PAL.topC;
const EDGE = PAL.topD;
const N = 2.35;

/** Stitch lines up the body and down the sleeve. */
const BODY_LINES = [37, 40.3, 43.6, 46.8, 49.9, 52.8, 55.4, 57.6];
const YOKE_FROM = 52.8;
const ARM_LINES = [-0.8, 2.6, 5.8, 9, 12.2, 15.3, 18.4];
/** Where a ring lies in its channel, and how far the padding is out there. */
const PUFF: readonly (readonly (readonly [number, number])[])[] = [[[0, 0], [0.24, 0.92], [0.74, 0.92]], [[0, 0.1], [0.5, 1]], [[0.5, 0.8]]];

interface Row {
	at: number;
	puff: number;
}
const channels = (b: PartBuilder, lines: readonly number[]): Row[] => lines.slice(0, -1).flatMap((l, i) => PUFF[b.lod]!.map(([k, puff]) => ({ at: lerp(l, lines[i + 1]!, k), puff })));

/** Torso without the padding; it hangs straight at the waist. */
function torso(y: number): { f: number; back: number; s: number } {
	const [, f, back, s] = sample(TORSO_TABLE, y);
	const d = 0.45 + 0.5 * Math.exp(-(((y - 42.4) / 3) ** 2)) - 0.35 * smooth(54, 58.2, y);
	return { f: f! + d, back: -back! + d, s: s! + d };
}
const weightAt = (p: THREE.Vector3) => torsoWeights(p.y, p.z);
/** The padding is pressed flat along the zip. */
const free = (z: number): number => 0.15 + 0.85 * smooth(0.3, 2.2, Math.abs(z));

/** Maps x = height above the unpadded cloth, y, z to the front. */
function onFront(p: THREE.Vector3): THREE.Vector3 {
	const { f, s } = torso(p.y);
	const k = Math.min(0.98, Math.abs(p.z) / s);
	const x = f * (1 - k ** N) ** (1 / N);
	const nx = (x / f) ** (N - 1) / f;
	const nz = (Math.sign(p.z) * k ** (N - 1)) / s;
	const h = p.x / Math.hypot(nx, nz);
	return p.set(x + nx * h, p.y, p.z + nz * h);
}

function buildBody(b: PartBuilder): void {
	const ring = (y: number, d = 0, pal?: number, shade = 1): Ring => {
		const t = torso(y);
		return { c: [0, y, 0], f: t.f + d, b: t.back + d, s: t.s + d, n: N, w: torsoWeights(y), pal, shade };
	};
	const rows = channels(b, BODY_LINES);
	const amp = (y: number) => 0.62 * (1 - 0.45 * smooth(52, 57, y));
	const rings = rows.map((r) => ring(r.at, 0, r.at >= YOKE_FROM ? YOKE : MAIN, lerp(0.6, 1.03, Math.min(1, r.puff))));
	// Elastic hem below, plain top under the collar.
	const hem = b.pick([ring(37, -1, EDGE, 0.5), ring(36, -0.15, EDGE, 0.8), ring(36.1, 0.1, EDGE), ring(36.9, 0.1, EDGE)], [ring(37, -1, EDGE, 0.5), ring(35.6, 0.45, EDGE, 0.9), ring(36.9, 0.45, EDGE)], [ring(35.6, 0.5, EDGE), ring(36.8, 0.4, EDGE)]);
	const all = [...hem, ...rings, ring(57.6, 0, YOKE, 0.7), ring(58.5, -0.1, YOKE, 0.8)];
	const puff = (i: number): number => rows[i - hem.length]?.puff ?? 0;
	b.loft(all, {
		seg: b.pick(18, 9, 8),
		capEnd: true,
		weightAt,
		deform: (p, _t, a, i) => {
			const d = puff(i) * amp(p.y) * (p.x > 0 ? free(p.z) : 1);
			// Uneven padding, and gathers pulled in by the stitching.
			const lump = b.lod === 0 ? 1 + 0.16 * Math.sin(a * 5 + i * 2.1) + 0.1 * Math.sin(a * 9 - i) : 1;
			const l = Math.hypot(p.x, p.z);
			const k = 1 + (d * lump) / l;
			p.x *= k;
			p.z *= k;
		},
		shadeAt: (p) => (Math.abs(p.z) > 7 && p.y > 45 && p.y < 54 ? 0.86 : 1)
	});
}

function buildCollar(b: PartBuilder): void {
	const at = (y: number, f: number, back: number, s: number, shade = 1, pal: number = MAIN): Ring => ({ c: [-0.4, y, 0], f, b: back, s, w: mix('chest', 'neck', 0.15 + 0.35 * smooth(58, 60, y)), shade, pal });
	const rows = b.pick(
		[at(57.2, 3.5, 4.2, 5.2, 0.7, YOKE), at(57.9, 3.6, 4.1, 4.75, 0.65), at(58.2, 3.85, 4.2, 4.55), at(58.7, 3.75, 3.95, 4.15), at(58.95, 3.35, 3.55, 3.65, 0.62), at(59.25, 3.5, 3.65, 3.7), at(59.75, 3.35, 3.5, 3.5), at(60, 2.95, 3.1, 3.05, 0.9), at(58.6, 2.45, 2.6, 2.55, 0.45, EDGE)],
		[at(57.2, 3.5, 4.2, 5.2, 0.7, YOKE), at(58.2, 3.8, 4.15, 4.6), at(58.95, 3.4, 3.6, 3.7, 0.7), at(59.8, 3.4, 3.5, 3.5), at(58.6, 2.45, 2.6, 2.55, 0.45, EDGE)],
		[at(57.2, 3.5, 4.2, 5.2, 0.8, YOKE), at(58.4, 3.8, 4.1, 4.4), at(59.8, 3.2, 3.4, 3.4)]
	);
	// Lower at the throat, with a dip at the zip.
	const dip = (p: THREE.Vector3) => p.setY(p.y + (-p.x * 0.13 - (p.x > 0 ? 0.3 * Math.exp(-((p.z / 0.9) ** 2)) : 0)) * smooth(57.8, 59.6, p.y));
	b.loft(rows, { seg: b.pick(16, 8, 6), deform: (p, _t, _a, i) => void (i > 0 && dip(p)) });
	if (b.lod > 0) return;
	// The zip goes on up the collar.
	for (const [half, off, pal] of [[0.55, 0.1, EDGE], [0.24, 0.18, ZIP]] as const) {
		const zip = rows.slice(0, 7).map((r) => [half, -half].map((z) => dip(new THREE.Vector3(r.c[0] + r.f + off, r.c[1], z))));
		b.grid(zip, { w: mix('chest', 'neck', 0.35), pal });
	}
}

function buildSleeves(b: PartBuilder): void {
	const T = [
		[-3.6, 1.3, 1],
		[-2.4, 2.6, 2.1],
		[-0.8, 3.35, 2.8],
		[1.2, 3.65, 3.15],
		[4.5, 3.65, 3.15],
		[8, 3.45, 3.05],
		[12, 3.2, 2.95],
		[16, 2.95, 2.7],
		[18.4, 2.5, 2.25]
	];
	for (const s of SIDES) {
		const ring = (t: number, d = 0, pal: number = MAIN, shade = 1): Ring => {
			const r = sample(T, t);
			return { c: alongArm(s, t), f: r[1]! + d, s: r[2]! + d, w: armWeights(s, t), pal, shade };
		};
		const rows = channels(b, ARM_LINES);
		const band = (t: number, r: number, shade = 1): Ring => ({ c: alongArm(s, t), f: r + 0.1, s: r, w: armWeights(s, t), pal: EDGE, shade });
		const rings = [
			...b.pick([ring(-3.6, 0, YOKE), ring(-2.4, 0, YOKE)], [ring(-3, 0, YOKE)], [ring(-3, 0, YOKE)]),
			...rows.map((r) => ring(r.at, r.puff * 0.48, r.at < 2.6 ? YOKE : MAIN, lerp(0.62, 1.03, Math.min(1, r.puff)))),
			...b.pick([ring(18.4, -0.1, EDGE, 0.7), band(18.7, 2.2), band(19.6, 2.1), band(20.6, 1.95, 0.9), band(20, 1.15, 0.5)], [ring(18.4, 0, EDGE, 0.8), band(19.4, 2.1), band(20.6, 1.6, 0.85)], [band(18.6, 2.3), band(20.6, 1.9)])
		];
		b.loft(rings, {
			seg: b.pick(10, 5, 5),
			v: armSide(s),
			capStart: true,
			deform:
				b.lod > 0
					? undefined
					: (p, _t, a, i) => {
							const k = 1 + 0.018 * Math.sin(a * 3 + i * 1.7);
							const c = rings[i]!.c;
							p.set(c[0] + (p.x - c[0]) * k, c[1] + (p.y - c[1]) * k, c[2] + (p.z - c[2]) * k);
						},
			shadeAt: (p) => lerp(0.8, 1, smooth(0, 2.6, Math.abs(p.z) - 7.6))
		});
	}
}

/** Flat strip along a path of [y, z] on the front, `h` above the unpadded cloth. */
function strip(b: PartBuilder, path: readonly (readonly [number, number])[], half: number, h: number, pal: number, shade = 1): void {
	b.loft(
		path.map(([y, z]): Ring => ({ c: [h - 0.2, y, z], f: 0.2, b: 0.5, s: half, n: 6, w: torsoWeights(y, z) })),
		{ seg: b.pick(6, 4, 4), v: [0, 0, 1], pal, capStart: b.lod === 0, capEnd: b.lod === 0, weightAt, deform: (p) => void onFront(p), shadeAt: () => shade }
	);
}

function buildDetails(b: PartBuilder): void {
	if (b.lod === 2) return;
	// Zip: dark tape with light teeth, up to the collar.
	const ys = b.pick([36.2, 39, 42, 45, 48, 51, 53.5, 55.5, 57.3], [36.2, 42, 48, 53.5, 57], []);
	if (b.lod === 0) strip(b, ys.map((y) => [y, 0] as const), 0.75, 0.34, EDGE);
	strip(b, ys.map((y) => [y, 0] as const), b.pick(0.3, 0.45, 0), 0.46, ZIP);
	if (b.lod === 0) {
		const w = torsoWeights(57.4);
		const p = onFront(new THREE.Vector3(0.6, 56.2, 0));
		b.box([p.x, p.y, p.z], [0.25, 0.8, 0.75], { w: torsoWeights(56.2), pal: ZIP, rot: [0, 0, 0.5] });
		// Hanger loop on the back of the yoke.
		b.box([-4.55, 56.6, 0], [0.3, 0.5, 1.7], { w, pal: ZIP, rot: [0, 0, -0.4] });
	}
	// Angled zipped pockets.
	for (const s of SIDES) {
		const k = sideSign(s);
		const path = b.pick([[45.4, k * 3.6], [43.3, k * 4.5], [41, k * 5.5]] as const, [[45.4, k * 3.6], [41, k * 5.5]] as const, []);
		strip(b, path, 0.5, 0.78, EDGE);
		if (b.lod === 0) strip(b, path, 0.16, 0.86, ZIP);
	}
}

registerItemMesh('top_puffer', {
	hides: ['upperArms', 'forearms'],
	colors: [0xe8892b, 0x38465a, 0xe6e2d8, 0x222b38],
	build(b) {
		buildBody(b);
		buildCollar(b);
		buildSleeves(b);
		buildDetails(b);
	}
});
