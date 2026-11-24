/** Rugby shirt: thick maroon and sky-blue hoops, white twill collar, rubber buttons. */
import { armSide } from '../body.js';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, smooth, type PartBuilder, type Ring } from '../mesh-kit.js';
import { torsoWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import { ARM_TILT, BIND } from '../skeleton.js';
import { button, foldCollar, line, neckline, shirtShade, sleeveRing, sleeveShade, strip, Torso, wrinkle } from './top_denim.js';

const MAROON = PAL.topA;
const SKY = PAL.topB;
const WHITE = PAL.topC;
const RIB = PAL.topD;

const HEM = 36.2;
const HOOP = 3.4;
const FIRST = 38.4;
/** Colour of the hoop at a height; the hoops of the sleeves line up with the body. */
const hoop = (y: number): number => (Math.floor((y - FIRST) / HOOP + 100) % 2 ? MAROON : SKY);

const cloth = new Torso((y) => 0.22 + 0.5 * Math.exp(-(((y - 41.5) / 3.4) ** 2)) + 0.15 * smooth(45, 50, y) * (1 - smooth(53, 57.5, y)));

function buildBody(b: PartBuilder): void {
	const ys = b.pick(
		[HEM, 37.6, FIRST, 40.2, 41.8, 43.5, 45.2, 46.9, 48.6, 50.3, 52, 53.7, 55.4, 56.6, 57.7, 58.5],
		[HEM, FIRST, 41.8, 45.2, 48.6, 52, 55.4, 57.2, 58.5],
		[HEM, FIRST, 41.8, 45.2, 48.6, 52, 55.4, 58.5]
	);
	const all = [HEM + 0.9, ...ys, 58.5];
	b.loft(all.map((y, i): Ring => ({ c: [0, i, 0], f: 1, s: 1, w: torsoWeights(y), shade: [0.55, 0.85][i] })), {
		seg: b.pick(24, 12, 8),
		pal: MAROON,
		weightAt: (p) => torsoWeights(p.y, p.z),
		deform: (p, _t, a, i) => {
			const y = all[i]!;
			p.copy(cloth.at(y, a, i === 0 ? -0.9 : i === 1 ? 0.02 : 0));
			if (b.lod === 0 && y < 48) {
				const k = 1 + 0.014 * Math.exp(-(((y - 42) / 3) ** 2)) * Math.sin(a * 5 + y * 0.8);
				p.x *= k;
				p.z *= k;
			}
			neckline(p, a, 1.3, i === all.length - 1);
		},
		palAt: (i) => hoop((Math.max(all[i]!, HEM) + all[i + 1]!) / 2),
		shadeAt: (p, _a, i) => shirtShade(p) * (i === all.length - 1 ? 0.5 : 1)
	});
	foldCollar(b, cloth, { a0: 0.24, tip: [54.5, 0.36], back: 56.5, pal: WHITE, off: 0.42, puff: 0.12, rows: 2 });
}

function buildSleeves(b: PartBuilder): void {
	const top = BIND.upperR[1];
	// Along the arm: the edges of the hoops, and rings between them.
	const edge = (n: number) => (top - (FIRST + n * HOOP)) / Math.cos(ARM_TILT);
	const edges = [5, 4, 3, 2, 1].map(edge).filter((t) => t < 18);
	const ts = b.pick([-3.6, -2.4, ...edges.flatMap((t) => [t, t + edge(0) / 2 - edge(1) / 2])], [-3.4, ...edges], [-3, ...edges]).filter((t) => t < 17.6);
	for (const s of SIDES) {
		const cuff = b.pick(
			[sleeveRing(s, 18.6, -0.05), sleeveRing(s, 18.7, 0.08, WHITE, 0.85), sleeveRing(s, 19.4, 0.1, WHITE), sleeveRing(s, 20.6, 0.02, WHITE), sleeveRing(s, 20.7, -0.2, WHITE, 0.7), sleeveRing(s, 20, -0.9, WHITE, 0.45)],
			[sleeveRing(s, 18.6, -0.05), sleeveRing(s, 18.7, 0.1, WHITE), sleeveRing(s, 20.6, 0.05, WHITE), sleeveRing(s, 20, -0.9, WHITE, 0.45)],
			[sleeveRing(s, 18.6, 0, WHITE), sleeveRing(s, 20.6, 0.05, WHITE)]
		);
		const rings = [...ts.map((t) => sleeveRing(s, t)), ...cuff];
		b.loft(rings, {
			seg: b.pick(12, 7, 5),
			v: armSide(s),
			pal: SKY,
			capStart: true,
			deform: b.lod > 0 ? undefined : (p, _t, a, i) => i < ts.length && wrinkle(p, s, ts[i]!, a),
			palAt: (i) => rings[i]!.pal ?? hoop((rings[i]!.c[1] + rings[i + 1]!.c[1]) / 2),
			shadeAt: (p, a, i) => sleeveShade(p) * (b.lod === 0 && i > ts.length && i < ts.length + 4 ? (Math.round((a / Math.PI) * 6) % 2 ? 0.86 : 1.02) : 1)
		});
	}
}

registerItemMesh('top_rugby', {
	hides: ['upperArms', 'forearms'],
	colors: [0x7b2440, 0x9cc6e2, 0xf7f4ec, 0x4f1529],
	build(b) {
		buildBody(b);
		buildSleeves(b);
		if (b.lod === 2) return;
		// Short placket with three rubber buttons, stitched at the end.
		strip(b, cloth, line(cloth, [48.3, 0], [56, 0], b.pick(5, 2, 1)), 0.95, 0.24, WHITE, { flat: true });
		for (const y of b.pick([49.6, 51.9, 54.2], [50, 53], [])) button(b, cloth, y, 0, 0.42, 0.26, RIB);
		if (b.lod > 0) return;
		strip(b, cloth, line(cloth, [49, -0.75], [49, 0.75], 2), 0.07, 0.36, RIB);
		for (const k of SIDES) {
			const z = k === 'R' ? 1 : -1;
			// Taped shoulder seams and a side vent at the hem.
			strip(b, cloth, Array.from({ length: 5 }, (_, i) => [lerp(57.6, 55.2, i / 4), z * lerp(Math.PI * 0.5, Math.PI * 0.53, i / 4)] as const), 0.25, 0.1, RIB, { flat: true });
			strip(b, cloth, [[36.4, (z * Math.PI) / 2], [38.2, (z * Math.PI) / 2]], 0.3, 0.1, WHITE, { flat: true });
		}
	}
});
