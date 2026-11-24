/** Flannel shirt: plaid overshirt worn open over a white tee. */
import { armSide, armWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, smooth, type PartBuilder, type Ring } from '../mesh-kit.js';
import { buildCollar, torsoRings, torsoWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import { sideSign } from '../skeleton.js';
import { foldCollar, patch, shirtShade, shirtWeights, sleeveRing, sleeveShade, strip, Torso, wrinkle } from './top_denim.js';

const RED = PAL.topA;
const DARK = PAL.topB;
const WHITE = PAL.topC;
/** Where dark and red threads cross. */
const DEEP = PAL.topD;

const shirt = new Torso(
	(y) => 0.3 + 0.35 * (1 - smooth(54, 57.5, y)) + 0.85 * Math.exp(-(((y - 42) / 4.2) ** 2)) + 0.4 * (1 - smooth(35, 39, y)),
	(y) => lerp(2.8, 2.35, smooth(35, 42, y))
);
/** Half of the opening in front. */
const open = (y: number): number => lerp(0.34, 0.27, smooth(35, 45, y)) + 0.33 * smooth(51, 57.5, y);

/** Plaid along one direction: 0 red, 1 white line, 2 dark band. */
const SETT = [0, 2, 0, 1] as const;
const SIZE = [1.9, 1.75, 1.9, 0.36] as const;
function plaid(u: number, v: number): number {
	if (u === 2 && v === 2) return DARK;
	if (u === 1 || v === 1) return WHITE;
	return u === 2 || v === 2 ? DEEP : RED;
}

const HEM = 34.9;
function rowsOf(b: PartBuilder): { y: number; kind: number }[] {
	if (b.lod > 0) return b.pick([], [35, 38.9, 42.8, 46.7, 50.6, 54.5, 58.4], [35, 42, 49, 55.4, 58.4]).map((y, i) => ({ y, kind: i % 2 ? 2 : 0 }));
	const out: { y: number; kind: number }[] = [];
	let y = HEM;
	for (let i = 0; y < 53; i++) {
		out.push({ y, kind: SETT[i % 4]! });
		y += SIZE[i % 4]!;
	}
	return [...out, { y: 55.2, kind: 0 }, { y: 56.6, kind: 2 }, { y: 57.5, kind: 0 }, { y: 58.3, kind: 0 }];
}

function buildShell(b: PartBuilder): void {
	const rows = rowsOf(b);
	// Columns from the right edge of the opening round the back to the left one.
	const quads = b.pick(23, 13, 8);
	const u: number[] = [0];
	for (let j = 0; j < quads; j++) u.push(u[j]! + (b.lod === 0 ? SIZE[j % 4]! : 1));
	// Columns go by distance, not by angle: equally wide threads all round.
	const steps = 160;
	const span = (k: number) => lerp(open(45), Math.PI * 2 - open(45), k / steps);
	const arc: number[] = [0];
	for (let k = 1; k <= steps; k++) arc.push(arc[k - 1]! + shirt.at(45, span(k)).distanceTo(shirt.at(45, span(k - 1))));
	const share = u.map((v) => {
		const k = arc.findIndex((l) => l >= (v / u[quads]!) * arc[steps]! - 1e-6);
		return k / steps;
	});
	const kind = (j: number) => (b.lod === 0 ? SETT[j % 4]! : j % 2 ? 2 : 0);
	// Column 0 is deep inside and makes the facing of the two edges.
	const seg = quads + 2;
	const col = (a: number) => Math.round((a / (Math.PI * 2)) * seg) % seg;
	const rings = [{ y: HEM + 0.9, kind: 0, in: -0.9 }, { y: HEM, kind: 0, in: -0.15 }, ...rows.map((r) => ({ ...r, in: 0 }))];
	b.loft(
		rings.map((r, i): Ring => ({ c: [0, i, 0], f: 1, s: 1, w: [['chest', 1]], shade: [0.5, 0.85][i] })),
		{
			seg,
			pal: RED,
			weightAt: shirtWeights,
			deform: (p, _t, a, i) => {
				const j = col(a);
				const { y, in: d } = rings[i]!;
				if (j === 0) {
					p.set(0.5, y, 0);
					return;
				}
				const g = open(y);
				const at = lerp(g, Math.PI * 2 - g, share[j - 1]!);
				p.copy(shirt.at(y, at, d + b.pick(0, 0.1, 0.3) * (1 - smooth(36, 40, y))));
				// Soft folds at the hem, which is cut higher at the sides.
				const low = 1 - smooth(36, 46, y);
				const k = 1 + 0.014 * low * Math.sin(at * 6 + 1);
				p.x *= k;
				p.z *= k;
				p.y += 1.3 * (1 - smooth(35, 38.5, y)) * Math.sin(at) ** 2;
			},
			palAt: (i, a) => {
				const j = Math.floor((a / (Math.PI * 2)) * seg);
				if (j === 0 || j === seg - 1) return DEEP;
				return plaid(kind(j - 1), rings[i]!.kind);
			},
			shadeAt: (p, a) => (col(a) === 0 ? 0.35 : shirtShade(p))
		}
	);
	foldCollar(b, shirt, { a0: 0.62, tip: [54.6, 0.42], back: 56.3, pal: RED, off: 0.62, puff: 0.2, rows: 2, cols: 15 });
}

function buildSleeves(b: PartBuilder): void {
	// Rows of the plaid along the arm, above the cuff.
	const rows: { t: number; kind: number }[] = [];
	if (b.lod === 0) {
		for (let t = 17.9, i = 0; t > 0.5; i++) {
			t -= SIZE[i % 4]! * 1.15;
			rows.unshift({ t, kind: SETT[i % 4]! });
		}
		rows.unshift({ t: -3.6, kind: 0 }, { t: -2.4, kind: 0 }, { t: -0.9, kind: 0 });
	} else b.pick([], [-3.4, -0.6, 2.6, 5.8, 9, 12.2, 15.4], [-3, 2, 8, 13.5]).forEach((t, i) => rows.push({ t, kind: i % 2 ? 2 : 0 }));
	const seg = b.pick(10, 6, 5);
	const around = [0, 2, 0, 1, 0];
	// Right edge of every column, in turns.
	const edges = [0.12, 0.24, 0.355, 0.375, 0.5];
	for (const s of SIDES) {
		const cuff = b.pick(
			[sleeveRing(s, 17.9), sleeveRing(s, 17.95, 0.25, DEEP), sleeveRing(s, 20.6, 0.2, DEEP, 0.9), sleeveRing(s, 19.9, -0.9, DEEP, 0.4)],
			[sleeveRing(s, 17.9), sleeveRing(s, 18, 0.25, DEEP), sleeveRing(s, 20.6, 0.2, DEEP), sleeveRing(s, 20, -0.9, DEEP, 0.45)],
			[sleeveRing(s, 17.9, 0, DEEP), sleeveRing(s, 20.6, 0.1, DEEP)]
		);
		b.loft([...rows.map((r) => sleeveRing(s, r.t)), ...cuff], {
			seg,
			v: armSide(s),
			capStart: true,
			pal: RED,
			deform:
				b.lod > 0
					? undefined
					: (p, _t, a, i) => {
							if (i >= rows.length) return;
							const j = Math.round((a / (Math.PI * 2)) * seg);
							const at = (j === 0 ? 0 : edges[(j - 1) % 5]! + (j > 5 ? 0.5 : 0)) * Math.PI * 2;
							const r = sleeveRing(s, rows[i]!.t);
							const v = armSide(s);
							const q = r.s * Math.sin(at);
							p.set(r.c[0] + r.f * Math.cos(at), r.c[1] + v[1] * q, r.c[2] + v[2] * q);
							wrinkle(p, s, rows[i]!.t, at);
						},
			palAt: (i, a) => {
				if (i >= rows.length) return DEEP;
				const j = Math.floor((a / (Math.PI * 2)) * seg);
				return plaid(b.lod === 0 ? around[j % 5]! : j % 2 ? 2 : 0, rows[i]!.kind);
			},
			shadeAt: sleeveShade
		});
		if (b.lod === 0) {
			const r = sleeveRing(s, 19.3, 0.25);
			const v = armSide(s);
			b.ball([r.c[0] + 0.3, r.c[1] + v[1] * r.s, r.c[2] + v[2] * r.s], [0.34, 0.34, 0.34], { w: armWeights(s, 19.3), pal: WHITE, seg: 5, rings: 3 });
		}
	}
}

registerItemMesh('top_flannel', {
	hides: ['upperArms', 'forearms'],
	colors: [0xb23a35, 0x241f26, 0xf3efe6, 0x6b2a30],
	build(b) {
		// Tee.
		const ys = b.pick([38.4, 42, 45, 48, 51, 54, 56.6, 58.5], [38.4, 42, 48, 53.5, 58.5], [42, 51, 58.5]);
		b.loft(torsoRings(36.6, ys, 0.05), { seg: b.pick(14, 8, 6), pal: WHITE, capEnd: true, weightAt: (p) => torsoWeights(p.y, p.z), shadeAt: (p, a) => lerp(0.86, 1, smooth(37, 43, p.y)) * lerp(1, 0.72, smooth(0.15, 0.45, Math.min(a, Math.PI * 2 - a))) });
		buildCollar(b, WHITE);
		buildShell(b);
		buildSleeves(b);
		if (b.lod === 2) return;
		for (const s of SIDES) {
			const k = sideSign(s);
			// Bands along the opening, buttons on the left one and a pocket.
			const ys2 = b.pick([35.1, 37, 39.5, 42, 45, 48, 51, 53.5], [35.1, 41, 53], []);
			strip(b, shirt, ys2.map((y) => [y, k * (open(y) + 0.1)] as const), 0.55, 0.16, DEEP, { flat: true, shade: 0.9 });
			if (b.lod > 0) continue;
			if (k < 0)
				for (const y of [37.4, 40.6, 43.8, 47, 50.2]) {
					const p = shirt.at(y, k * (open(y) + 0.1), 0.2);
					b.ball([p.x, p.y, p.z], [0.22, 0.34, 0.34], { w: torsoWeights(y, p.z), pal: WHITE, seg: 5, rings: 3 });
				}
			patch(b, shirt, 49.6, k * 5.4, [[0, 1.5], [1.5, 1.5], [1.5, -1.1], [0, -1.8], [-1.5, -1.1], [-1.5, 1.5]], [[1, -0.1, DARK, 0.8], [1, 0.26, DEEP], [0.86, 0.29, RED, 0.92]]);
		}
	}
});
