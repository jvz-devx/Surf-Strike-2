/** Varsity jacket: navy wool body, cream sleeves, striped ribs, snaps, welts and a wave patch. */
import * as THREE from 'three';
import { alongArm, armSide, armWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { lerp, mix, PAL, sample, smooth, type PartBuilder, type Ring } from '../mesh-kit.js';
import { TORSO_TABLE, torsoWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import { type Side, type V3 } from '../skeleton.js';

const NAVY = PAL.topA;
const CREAM = PAL.topB;
const GOLD = PAL.topC;
const RIB = PAL.topD;
/** Superellipse exponent of the torso. */
const N = 2.35;

/** Room between the body and the jacket: it bulges over the hem and hangs straight at the waist. */
const ease = (y: number): number => lerp(0.4, 0.75, smooth(37.6, 39.4, y)) + 0.45 * Math.exp(-(((y - 42.2) / 2.6) ** 2)) - 0.4 * smooth(54, 58.2, y);
const torso = (y: number): { f: number; back: number; s: number } => {
	const [, f, back, s] = sample(TORSO_TABLE, y);
	const d = ease(y);
	return { f: f! + d, back: -back! + d, s: s! + d };
};
const weightAt = (p: THREE.Vector3) => torsoWeights(p.y, p.z);

/** Maps x = height above the cloth, y, z to the front of the jacket. */
const onFront = (p: THREE.Vector3): THREE.Vector3 => {
	const { f, s } = torso(p.y);
	const k = Math.min(0.98, Math.abs(p.z) / s);
	const x = f * (1 - k ** N) ** (1 / N);
	const nx = (x / f) ** (N - 1) / f;
	const nz = (Math.sign(p.z) * k ** (N - 1)) / s;
	const h = p.x / Math.hypot(nx, nz);
	return p.set(x + nx * h, p.y, p.z + nz * h);
};

/** Knitted ribs: every other vertex darker. */
const ribs = (b: PartBuilder, seg: number) => (_p: THREE.Vector3, a: number) => (b.lod === 0 ? (Math.round((a / (Math.PI * 2)) * seg) % 2 ? 0.8 : 1.12) : 1);

function buildBody(b: PartBuilder): void {
	const ring = (y: number, d = 0, shade = 1): Ring => {
		const t = torso(y);
		return { c: [0, y, 0], f: t.f + d, b: t.back + d, s: t.s + d, n: N, w: torsoWeights(y), shade };
	};
	const ys = b.pick([38.5, 39.4, 41.5, 44, 47, 50, 52, 53.6, 55.2, 56.6, 57.7, 58.5], [38.8, 42, 46.5, 51, 54, 56.6, 58.5], [40, 45, 51, 55.5, 58.5]);
	b.loft([ring(38.6, -1.1, 0.55), ring(38, -0.1, 0.8), ...ys.map((y) => ring(y))], {
		seg: b.pick(24, 12, 8),
		pal: NAVY,
		capEnd: true,
		weightAt,
		deform:
			b.lod > 0
				? undefined
				: (p, _t, a) => {
						// Soft folds over the hem on the back and sides; the front stays smooth for the details.
						if (p.x > 2.5) return;
						const k = 1 + 0.018 * Math.exp(-(((p.y - 40.5) / 2.2) ** 2)) * Math.sin(a * 6 + p.y * 0.8);
						p.x *= k;
						p.z *= k;
						p.x -= p.x < 0 ? 0.25 * Math.exp(-(((p.y - 52.5) / 2.4) ** 2) - ((Math.abs(p.z) - 4.4) / 2.2) ** 2) : 0;
					},
		shadeAt: (p) => lerp(0.86, 1, smooth(38, 42, p.y)) * (Math.abs(p.z) > 6.8 && p.y > 45 && p.y < 54 ? 0.88 : 1)
	});

	// Hem: ribbed band with two stripes.
	const hem = (y: number, d: number, shade = 1): Ring => {
		const [, f, back, s] = sample(TORSO_TABLE, y);
		return { c: [0, y, 0], f: f! + d, b: -back! + d, s: s! + d, n: N, w: torsoWeights(y), shade };
	};
	const seg = b.pick(24, 10, 8);
	const rows = b.pick(
		[hem(36.9, -0.4, 0.5), hem(36, 0.35, 0.9), hem(36.55, 0.5), hem(36.95, 0.52), hem(37.4, 0.52), hem(37.8, 0.5), hem(38.6, 0.2)],
		[hem(36.9, -0.4, 0.5), hem(36, 0.4, 0.9), hem(36.7, 0.5), hem(37.6, 0.5), hem(38.6, 0.2)],
		[hem(36, 0.4), hem(36.9, 0.45), hem(37.6, 0.45), hem(38.5, 0.4)]
	);
	b.loft(rows, { seg, pal: RIB, weightAt, shadeAt: ribs(b, seg), palAt: (i) => (b.pick(i === 2 || i === 4, i === 2, i === 1) ? CREAM : RIB) });

	// Ribbed collar with a notch at the front.
	const collar = (y: number, f: number, back: number, s: number, shade = 1): Ring => ({ c: [-0.4, y, 0], f, b: back, s, w: mix('chest', 'neck', 0.2 + 0.3 * smooth(58, 60, y)), shade });
	const cseg = b.pick(18, 8, 6);
	const crows = b.pick(
		[collar(57.4, 3.6, 4.3, 5.3), collar(58.3, 3.5, 3.9, 4.2), collar(58.7, 3.4, 3.65, 3.75), collar(59.05, 3.3, 3.5, 3.5), collar(59.7, 3.1, 3.3, 3.2), collar(59.75, 2.75, 2.9, 2.8, 0.8), collar(58.4, 2.35, 2.5, 2.5, 0.45)],
		[collar(57.4, 3.6, 4.3, 5.3), collar(58.5, 3.4, 3.75, 3.9), collar(59.1, 3.3, 3.5, 3.5), collar(59.7, 3.1, 3.3, 3.2), collar(58.4, 2.35, 2.5, 2.5, 0.45)],
		[collar(57.4, 3.6, 4.3, 5.3), collar(59.6, 3.1, 3.3, 3.2)]
	);
	b.loft(crows, {
		seg: cseg,
		pal: RIB,
		shadeAt: ribs(b, cseg),
		palAt: (i) => (i === 0 && b.lod < 2 ? NAVY : i === b.pick(2, 1, 9) ? CREAM : RIB),
		deform: (p, _t, _a, i) => {
			if (i === 0) return;
			const k = smooth(57.8, 59.7, p.y);
			p.y += (-p.x * 0.13 - (p.x > 0 ? 0.75 * Math.exp(-((p.z / 0.9) ** 2)) : 0)) * k;
		}
	});
}

function buildSleeves(b: PartBuilder): void {
	const T = [
		[-3.6, 1.3, 1],
		[-2.4, 2.6, 2.05],
		[-0.8, 3.35, 2.75],
		[1.2, 3.75, 3.2],
		[4.5, 3.85, 3.35],
		[7.5, 3.7, 3.3],
		[11, 3.45, 3.2],
		[14, 3.4, 3.15],
		[17, 3.05, 2.85],
		[18.4, 2.75, 2.5]
	];
	for (const s of SIDES) {
		const ring = (t: number, pal: number = CREAM, shade = 1): Ring => {
			const r = sample(T, t);
			return { c: alongArm(s, t), f: r[1]!, s: r[2]!, w: armWeights(s, t), pal, shade };
		};
		const band = (t: number, r: number, pal: number = RIB, shade = 1): Ring => ({ c: alongArm(s, t), f: r + 0.12, s: r - 0.05, w: armWeights(s, t), pal, shade });
		const cuff = b.pick(
			[ring(18.3), band(18.6, 2.2, RIB, 0.8), band(19.05, 2.2, CREAM), band(19.4, 2.18), band(19.75, 2.15, CREAM), band(20.1, 2.1), band(20.7, 1.95), band(20.2, 1.15, RIB, 0.5)],
			[ring(18.3), band(18.6, 2.2), band(19.3, 2.18, CREAM), band(19.9, 2.1), band(20.7, 1.5, RIB, 0.8)],
			[ring(18.2), band(18.5, 2.25), band(20.7, 1.95)]
		);
		const ts = b.pick([-3.6, -2.4, -0.8, 1.2, 4.5, 8, 10, 11.6, 14, 17], [-3.4, -1, 2, 6.5, 11, 15.5], [-3, 2, 9, 14]);
		b.loft([...ts.map((t) => ring(t)), ...cuff], {
			seg: b.pick(12, 7, 5),
			v: armSide(s),
			capStart: true,
			deform: b.lod > 0 ? undefined : (p, _t, a, i) => wrinkle(p, s, ts[i], a),
			shadeAt: (p) => lerp(0.8, 1, smooth(0, 2.6, Math.abs(p.z) - 7.6))
		});
	}
}

/** Creases inside the elbow and soft bunching above the cuff. */
function wrinkle(p: THREE.Vector3, s: Side, t: number | undefined, a: number): void {
	if (t === undefined || t < 6) return;
	const c = alongArm(s, t);
	const k = 1 + 0.03 * Math.exp(-(((t - 10.5) / 2.2) ** 2)) * Math.sin(t * 2.6 + a) + 0.03 * smooth(13, 17, t) * Math.sin(a * 3 + t);
	p.set(c[0] + (p.x - c[0]) * k, c[1] + (p.y - c[1]) * k, c[2] + (p.z - c[2]) * k);
}

/** Flat disc on the front, standing `h` above the cloth. */
function disc(b: PartBuilder, y: number, z: number, rows: readonly (readonly [h: number, r: number])[], seg: number, pal: (i: number) => number): void {
	b.loft(
		rows.map(([h, r], i): Ring => ({ c: [h, y, z], f: r, s: r, w: torsoWeights(y, z), pal: pal(i) })),
		{ seg, u: [0, 1, 0], v: [0, 0, 1], capEnd: true, deform: (p) => void onFront(p) }
	);
}

/** Wave of the patch: pairs of edge points (viewer's right, up), from the swell to the tip of the curl. */
const CURL: readonly (readonly [readonly [number, number], readonly [number, number]])[] = [
	[[-1.5, -0.45], [-1.42, -0.7]],
	[[-0.95, -0.2], [-0.8, -0.95]],
	[[-0.5, 0.3], [0, -0.7]],
	[[-0.1, 0.85], [0.1, -0.1]],
	[[0.4, 1.15], [0.35, 0.4]],
	[[0.95, 0.95], [0.7, 0.5]],
	[[1.2, 0.4], [1.02, 0.35]],
	[[1.12, -0.02], [1.1, -0.04]]
];
const WATER: readonly (readonly [readonly [number, number], readonly [number, number]])[] = [
	[[-0.85, -0.9], [-0.85, -1.2]],
	[[0, -0.72], [0, -1.35]],
	[[0.6, -0.65], [0.7, -1.2]],
	[[1.45, -0.4], [1.3, -0.75]]
];

function buildDetails(b: PartBuilder): void {
	// Patch on the left chest: gold rim, cream felt, navy wave.
	const at: V3 = [0.36, 50.4, -4.3];
	disc(b, at[1], at[2], b.pick([[-0.3, 2.15], [0.24, 2.15], [0.3, 2], [0.3, 1.78], [0.3, 0.9]], [[-0.2, 2.15], [0.3, 2.1], [0.32, 1.75]], [[0.3, 2.2], [0.35, 1.5], [0.35, 0.8]]), b.pick(16, 8, 6), (i) => (i < b.pick(3, 1, 1) ? GOLD : CREAM));
	if (b.lod < 2)
		for (const shape of [CURL, WATER]) {
			const edge = (k: 0 | 1) => shape.map((pair) => onFront(new THREE.Vector3(at[0], at[1] + pair[k][1], at[2] - pair[k][0])));
			b.grid([edge(1), edge(0)], { w: torsoWeights(at[1], at[2]), pal: NAVY });
		}
	if (b.lod === 2) return;

	// Front placket over the closing, buttoned with snaps.
	const placket = (y: number): Ring => ({ c: [0, y, 0.25], f: 0.2, b: 0.4, s: 0.95, n: 7, w: torsoWeights(y) });
	b.loft(b.pick([38.15, 39.4, 42, 45.5, 50, 53.6, 55.6, 57.5], [38.3, 42, 46.5, 51, 57.3], []).map(placket), {
		seg: b.pick(8, 4, 4),
		pal: NAVY,
		capStart: b.lod === 0,
		weightAt,
		deform: (p) => void onFront(p),
		shadeAt: (p, a) => (Math.cos(a) > 0.9 ? 1.12 : 0.8)
	});
	const snaps = b.pick([40, 43.2, 46.4, 49.6, 52.8, 56], [40.5, 46, 51.5], []);
	for (const y of snaps) disc(b, y, 0.25, b.pick([[0.1, 0.55], [0.42, 0.5], [0.48, 0.22]], [[0, 0.6], [0.45, 0.5]], []), b.pick(6, 4, 4), () => CREAM);

	// Angled pocket welts.
	for (const s of SIDES) {
		const k = s === 'R' ? 1 : -1;
		const welt = (t: number, half: number): Ring => ({ c: [0.05, lerp(44.6, 40.4, t), k * lerp(3.4, 5.9, t)], f: 0.3, b: 0.4, s: half, n: 5, w: torsoWeights(42) });
		b.loft([welt(0, 0.5), ...b.pick([welt(0.5, 0.5)], [], []), welt(1, 0.5)], {
			seg: b.pick(8, 4, 4),
			v: [0, 0, 1],
			pal: CREAM,
			capStart: b.lod === 0,
			capEnd: b.lod === 0,
			weightAt,
			deform: (p) => void onFront(p)
		});
	}
}

registerItemMesh('top_varsity', {
	hides: ['upperArms', 'forearms'],
	colors: [0x22335f, 0xf0e4c9, 0xe3a03a, 0x17213f],
	build(b) {
		buildBody(b);
		buildSleeves(b);
		buildDetails(b);
	}
});
