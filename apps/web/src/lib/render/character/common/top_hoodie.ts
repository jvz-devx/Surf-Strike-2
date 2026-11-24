import { alongArm, armSide, armWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, type PartBuilder, type Ring } from '../mesh-kit.js';
import { TORSO_TABLE, torsoRings, torsoWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import { sideSign, type Side } from '../skeleton.js';

/** Ease of the body over the torso. */
const EASE = 0.5;
/** Top of the ribbed waistband. */
const BAND = 38.8;
/** The body ends under the hood. */
const TOP = 57.2;
/** Torso weights at the neckline. */
const NECK = 58.5;

/** Front of the hoodie at a height, `z` to the side. */
function frontX(y: number, z = 0): number {
	const r = sample(TORSO_TABLE, y);
	const k = Math.min(1, Math.abs(z) / (r[3]! + EASE));
	const chest = 0.35 * Math.exp(-(((y - 51.5) / 2.2) ** 2) - ((Math.abs(z) - 3.6) / 2.4) ** 2);
	return (r[1]! + EASE) * (1 - k ** 2.35) ** (1 / 2.35) + chest;
}

function buildBody(b: PartBuilder): void {
	const ys = b.pick([BAND, 39.8, 41.4, 43.2, 45, 48, 51, 53.2, 55.2, 56.4, TOP], [BAND, 42, 46, 50, 53.5, 56, TOP], [BAND, 44, 51, 55.5, TOP]);
	const all = torsoRings(36.5, ys, b.lod === 2 ? EASE + 0.25 : EASE);
	// Close up the waistband is its own finely ribbed piece.
	const rings = b.lod === 0 ? all.slice(2) : all;
	const squeeze = (p: { x: number; z: number; y: number }) => {
		const band = 0.955 + 0.045 * smooth(BAND - 0.05, BAND + 1, p.y);
		p.x *= lerp(band, 1, 0.5);
		p.z *= band;
	};
	if (b.lod === 0) {
		const n = 44;
		b.loft([...all.slice(0, 3), { ...all[2]!, c: [0, BAND + 0.2, 0], shade: 0.85 }], {
			seg: n,
			pal: PAL.topC,
			weightAt: (p) => torsoWeights(p.y, p.z),
			deform: squeeze,
			shadeAt: (_p, a) => (Math.round((a / (Math.PI * 2)) * n) % 2 ? 1.2 : 0.74)
		});
	}
	b.loft(rings, {
		seg: b.pick(24, 14, 8),
		pal: PAL.topA,
		capEnd: true,
		weightAt: (p) => torsoWeights(p.y, p.z),
		deform: (p, _t, a, i) => {
			// Tight waistband, the body blouses over it.
			squeeze(p);
			const over = 1 + 0.035 * smooth(BAND, 40.2, p.y) * (1 - smooth(41, 45, p.y));
			const fold = b.lod > 0 || i < 2 || p.y > 47 ? 1 : 1 + 0.014 * Math.sin(a * 7 + p.y * 1.3) * Math.sin(a) ** 2;
			p.x *= over * fold;
			p.z *= over * fold;
			if (b.lod > 0) return;
			if (p.x > 0) p.x += 0.35 * Math.exp(-(((p.y - 51.5) / 2.2) ** 2) - ((Math.abs(p.z) - 3.6) / 2.4) ** 2);
			else p.x -= 0.3 * Math.exp(-(((p.y - 52.5) / 2.4) ** 2) - ((Math.abs(p.z) - 4.4) / 2.2) ** 2);
		},
		// Ribbed waistband and side panels in the darker cloth.
		palAt: (i, a) => (rings[i + 1]!.c[1] <= BAND || (b.lod === 0 && Math.abs(Math.sin(a)) > 0.975 && rings[i + 1]!.c[1] <= 48) ? PAL.topC : PAL.topA),
		shadeAt: (p) => lerp(0.86, 1, smooth(37, 44, p.y)) * (Math.abs(p.z) > 6.8 && p.y > 46 && p.y < 54 ? 0.9 : 1)
	});
}

const SLEEVE: readonly (readonly number[])[] = [
	// t, radius along X, radius sideways
	[-3.6, 1.5, 1.4],
	[-2.6, 2.9, 2.5],
	[-1.2, 3.5, 3.0],
	[0.6, 3.8, 3.35],
	[3, 3.75, 3.35],
	[7.5, 3.5, 3.15],
	[11, 3.2, 3.0],
	[14, 3.2, 3.0],
	[16.5, 3.0, 2.8],
	[17.8, 2.9, 2.7],
	[18.6, 2.25, 2.05]
];
const CUFF = 18.6;
const END = 20.9;

function buildHoodieSleeve(b: PartBuilder, s: Side): void {
	const ring = (t: number, d = 0, pal: number = PAL.topA, shade = 1): Ring => {
		const r = sample(SLEEVE, t);
		return { c: alongArm(s, t), f: r[1]! + d, s: r[2]! + d, w: armWeights(s, t), pal, shade };
	};
	const ts = b.pick([-3.6, -2.6, -1.2, 0.6, 2.8, 5.8, 8.8, 11, 13, 15, 16.6, 17.8, CUFF], [-3.4, -1.2, 2, 8.4, 11.2, 15, 17.6, CUFF], [-3, 2, 9.5, 14, CUFF]);
	const seg = b.pick(12, 7, 5);
	const n = ts.length;
	const cuff = [ring(CUFF, -0.02, PAL.topC), ring(END, -0.15, PAL.topC), ring(END, -0.55, PAL.topC, 0.7), ring(END - 0.9, -0.9, PAL.topC, 0.5)];
	const rows = [...ts.map((t) => ring(t)), ...(b.lod === 0 ? [] : cuff.slice(0, 2))];
	// Fine ribs close up.
	if (b.lod === 0) b.loft(cuff, { seg: 20, v: armSide(s), shadeAt: (_p, a) => (Math.round((a / (Math.PI * 2)) * 20) % 2 ? 1.18 : 0.76) });
	b.loft(rows, {
		seg,
		v: armSide(s),
		capStart: true,
		capEnd: b.lod > 0,
		deform:
			b.lod > 0
				? undefined
				: (p, _t, a, i) => {
						// Cloth bunching in the elbow and above the cuff.
						if (i >= n) return;
						const t = ts[i]!;
						const k = (0.028 * Math.exp(-(((t - 11) / 2) ** 2)) + 0.03 * Math.exp(-(((t - 16.6) / 1.4) ** 2))) * Math.sin(a * 3 + i * 2.1);
						const c = alongArm(s, t);
						p.x += (p.x - c[0]) * k;
						p.y += (p.y - c[1]) * k;
						p.z += (p.z - c[2]) * k;
					},
		shadeAt: (p, _a, i) => (i === n - 1 ? 0.85 : 1) * lerp(0.86, 1, smooth(0, 3, Math.abs(p.z) - 7))
	});
}

/** Hood outline in front, at the side and behind: distance from the middle, height. */
const HOOD: readonly (readonly (readonly [number, number])[])[] = [
	[[4.5, 55.5], [4.55, 56.4], [4.3, 57.3], [3.85, 57.9], [3.4, 58.1], [2.9, 57.8], [2.4, 57.4], [1.7, 57.3]],
	[[6.9, 56.2], [6.9, 57.5], [6.3, 58.6], [5.4, 59.15], [4.6, 59.2], [3.8, 58.8], [3.1, 58.8], [2.4, 58.6]],
	[[4.9, 48.8], [7.1, 50.2], [8.3, 53.6], [8, 56.5], [7.1, 57.6], [5.6, 57], [4.1, 58.1], [2.7, 58.6]]
];

/** The hood, lying on the back; the lining shows around the neck. */
function buildHood(b: PartBuilder): void {
	const rows = b.pick([0, 1, 2, 3, 4, 5, 6, 7], [0, 1, 2, 4, 5, 6], [0, 2, 4, 6]);
	const seg = b.pick(24, 12, 8);
	b.loft(
		rows.map((r): Ring => ({ c: [0, r, 0], f: 1, s: 1, w: torsoWeights(NECK), pal: r >= 4 ? PAL.topB : PAL.topA })),
		{
			seg,
			deform: (p, _t, a, i) => {
				const r = rows[i]!;
				const c = Math.cos(a);
				const s = Math.sin(a);
				const [f, side, back] = [HOOD[0]![r]!, HOOD[1]![r]!, HOOD[2]![r]!];
				const end = c > 0 ? f : back;
				// The bag narrows downwards into a soft point.
				const k = Math.abs(c) ** 1.6;
				p.set(c * (c > 0 ? f[0] : back[0]), lerp(side[1], end[1], k), s * side[0]);
				// Soft folds across the bag.
				if (b.lod === 0 && c < 0 && r > 0 && r < 4) p.x -= 0.22 * c * Math.sin(a * 6) * -1;
			},
			weightAt: (p) => torsoWeights(Math.min(p.y, NECK), p.z),
			shadeAt: (p, a, i) => {
				const r = rows[i]!;
				// Centre seam, shadow below the bag and inside the hood.
				if (r >= 5) return lerp(1, 0.72, (r - 4) / 3);
				return (r === 0 ? 0.75 : 1) * (Math.cos(a) < -0.999 && r < 4 ? 0.82 : 1) * (p.x < -3 && p.y < 52 ? 0.85 : 1);
			}
		}
	);
}

function buildZip(b: PartBuilder): void {
	const ys = b.pick([36.6, BAND - 0.1, 39.8, 41.4, 43.2, 45, 48, 51, 53.2, 55.2, 56.4], [36.6, 42, 46, 50, 53.5, 56.2], [36.6, 44, 51, 56]);
	const strip = (w: number, out: number, pal: number, at: readonly number[]) =>
		b.loft(
			at.map((y): Ring => ({ c: [frontX(y) + 0.02 + 0.2 * smooth(BAND, 40.2, y) * (1 - smooth(41, 45, y)) - 0.1 * (1 - smooth(BAND - 1, BAND, y)), y, 0], f: out, b: 0.3, s: w, n: 2.6, w: torsoWeights(y), pal })),
			{ seg: b.pick(4, 4, 3), pal, capEnd: true }
		);
	// Far away only a light line is left.
	strip(b.pick(0.8, 0.45, 0.5), b.pick(0.2, 0.3, 0.45), b.pick<number>(PAL.topC, PAL.topD, PAL.topD), ys);
	if (b.lod > 0) return;
	const teeth: number[] = [];
	for (let i = 0; i <= 18; i++) teeth.push(lerp(36.7, 56, i / 18));
	b.loft(
		teeth.map((y): Ring => ({ c: [frontX(y) + 0.25 + 0.2 * smooth(BAND, 40.2, y) * (1 - smooth(41, 45, y)) - 0.1 * (1 - smooth(BAND - 1, BAND, y)), y, 0], f: 0.12, b: 0.2, s: 0.26, w: torsoWeights(y) })),
		{ seg: 4, pal: PAL.topD, shadeAt: (_p, _a, i) => (i % 2 ? 0.6 : 0.95) }
	);
	// Slider with its pull tab.
	const w = torsoWeights(55.4);
	b.box([frontX(55.4) + 0.42, 55.4, 0], [0.4, 0.8, 0.8], { w, pal: PAL.topD, shade: 0.8 });
	b.box([frontX(54.4) + 0.4, 54.4, 0.05], [0.18, 1.4, 0.45], { w, pal: PAL.topD, rot: [0.08, 0, 0.5] });
}

/** Split pouch pocket: height, inner and outer edge. */
const POCKET: readonly (readonly [number, number, number])[] = [[39.5, 1, 5.7], [41.3, 1, 5.9], [41.6, 1, 5.7], [43.4, 1, 4.4], [45.2, 1, 3.1]];

function buildPocket(b: PartBuilder, s: Side): void {
	const out = sideSign(s);
	const rows = b.lod === 0 ? POCKET : [POCKET[0]!, POCKET[2]!, POCKET[4]!];
	b.loft(
		rows.map(([y, z0, z1]): Ring => ({ c: [0, y, (out * (z0 + z1)) / 2], f: 1, s: (z1 - z0) / 2, n: 3.4, w: torsoWeights(y) })),
		{
			seg: b.pick(10, 4, 4),
			pal: PAL.topA,
			capStart: b.lod === 0,
			capEnd: true,
			deform: (p, _t, a) => {
				const over = 1 + 0.035 * smooth(BAND, 40.2, p.y) * (1 - smooth(41, 45, p.y));
				p.x = frontX(p.y, p.z) * over + (Math.cos(a) > 0.01 ? 0.36 : -0.4);
			},
			weightAt: (p) => torsoWeights(p.y, p.z),
			// The slanted opening has a dark edge.
			palAt: (i, a) => (b.lod === 0 && i >= 1 && Math.sin(a) * out > 0.8 ? PAL.topC : PAL.topA),
			shadeAt: (p, a) => (Math.cos(a) > 0.01 ? (b.lod === 0 && Math.sin(a) * out > 0.8 ? 0.75 : 1) : 0.6) * lerp(0.9, 1, smooth(39, 43, p.y))
		}
	);
}

function buildString(b: PartBuilder, s: Side): void {
	const out = sideSign(s);
	const end = s === 'R' ? 50.6 : 51.4;
	const at = (y: number, r: number, pal: number): Ring => {
		const z = out * (1.35 + 0.35 * smooth(57, 52, y) + 0.15 * Math.sin(y));
		return { c: [frontX(y, z) + 0.2 + 0.35 * smooth(54.8, 56, y), y, z], f: r, s: r, w: torsoWeights(y, z), pal };
	};
	// Cord, then a longer knot-like tip.
	b.loft([at(56.8, 0.24, PAL.topD), at(56, 0.24, PAL.topD), at(55, 0.24, PAL.topD), at(53.2, 0.24, PAL.topD), at(end + 1.3, 0.24, PAL.topD), at(end + 1.2, 0.36, PAL.topB), at(end, 0.32, PAL.topB)], { seg: 4, pal: PAL.topB, capEnd: true });
	// Eyelet.
	b.box([frontX(56.8, out * 1.4) + 0.65, 56.9, out * 1.4], [0.3, 0.6, 0.6], { w: torsoWeights(57), pal: PAL.topD, shade: 0.8, rot: [0, 0, 0.4] });
}

registerItemMesh('top_hoodie', {
	hides: ['upperArms', 'forearms'],
	colors: [0x2f6a70, 0xe3a23c, 0x245059, 0xf3ead6],
	build(b) {
		buildBody(b);
		buildHood(b);
		buildZip(b);
		for (const s of SIDES) {
			buildHoodieSleeve(b, s);
			if (b.lod < 2) buildPocket(b, s);
			if (b.lod === 0) buildString(b, s);
		}
	}
});
