/** Rubber duck slippers: a big round duck per foot, webbed orange soles; the foot goes in at the back. */
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { lerp, mix, PAL, sample, smooth, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

const YELLOW = PAL.shoesA;
const ORANGE = PAL.shoesB;
const WHITE = PAL.shoesC;
const BLACK = PAL.shoesD;

/** Body: x, half width, bottom, top. */
const BODY: readonly (readonly number[])[] = [
	[-6.0, 0.5, 2.6, 3.8],
	[-5.6, 1.6, 1.6, 4.6],
	[-4.6, 2.75, 0.8, 5.05],
	[-2.8, 3.45, 0.5, 5.1],
	[-0.4, 3.75, 0.45, 5.0],
	[2, 3.75, 0.45, 4.7],
	[4.2, 3.5, 0.5, 4.4],
	[6.2, 2.9, 0.65, 4],
	[7.6, 2.0, 1.0, 3.4],
	[8.3, 0.9, 1.5, 2.6]
];

/** Stiff rubber: bends less than a shoe. */
const weights = (s: Side, x: number): Weights => mix(`foot${s}`, `toe${s}`, 0.6 * smooth(1.5, 6, x));

function buildDuck(b: PartBuilder, s: Side): void {
	const side = sideSign(s);
	const z0 = BIND[`foot${s}`][2] + side * 0.15;
	const xs = b.pick([-6, -5.5, -4.4, -2.4, 0.5, 3.4, 6, 7.6, 8.3], [-6, -4.8, -2, 3, 6.8, 8.2], [-5.8, -2, 5, 8]);
	b.loft(
		xs.map((x): Ring => {
			const [, hw, lo, top] = sample(BODY, x) as [number, number, number, number];
			return { c: [x, (lo + top) / 2, z0], f: (top - lo) / 2, s: hw, n: lerp(2.3, 2.2, smooth(0, 5, x)), w: weights(s, x) };
		}),
		{ seg: b.pick(14, 7, 5), u: [0, 1, 0], v: [0, 0, 1], pal: YELLOW, capStart: true, capEnd: true, shadeAt: (p) => lerp(0.8, 1, smooth(0.5, 2.6, p.y)) }
	);
	// Rolled rim round the opening, dark inside.
	const rim = (r: number, y: number, pal: number, shade = 1): Ring => ({ c: [-0.75, y, z0], f: r + 0.1, b: r + 0.25, s: r, w: weights(s, 0), pal, shade });
	b.loft(b.pick([rim(3.6, 2.6, YELLOW, 0.9), rim(3.55, 4.3, YELLOW, 0.92), rim(3.8, 4.75, YELLOW), rim(3.75, 5.3, YELLOW), rim(3.3, 5.5, YELLOW), rim(2.7, 4.9, BLACK)], [rim(3.6, 2.8, YELLOW), rim(3.75, 5.2, YELLOW), rim(2.7, 5.0, BLACK)], [rim(3.6, 2.8, YELLOW), rim(3.6, 5.2, YELLOW)]), {
		seg: b.pick(12, 6, 5),
		pal: BLACK,
		capEnd: true
	});
	// Short white sock.
	const sock = (y: number, r: number, pal = WHITE, shade = 1): Ring => ({ c: [lerp(-0.7, -0.3, smooth(4, 9, y)), y, z0], f: r + 0.2, b: r, s: r, w: legWeights(s, y), pal, shade });
	b.loft(b.pick([sock(4.4, 2.3), sock(6.9, 2.2), sock(6.95, 2.36, WHITE, 0.85), sock(8, 2.36)], [sock(4.4, 2.3), sock(8, 2.3)], [sock(4.4, 2.3), sock(8, 2.3)]), {
		seg: b.pick(10, 5, 4),
		pal: WHITE,
		capEnd: true,
		shadeAt: (_p, a) => (b.lod === 0 && Math.round((a / (Math.PI * 2)) * 10) % 2 ? 0.88 : 1)
	});
	// Webbed feet as the sole.
	const toes = b.pick(20, 8, 6);
	b.loft(
		[0, 1].map((i): Ring => ({ c: [0, i, 0], f: 1, s: 1, w: weights(s, 0), shade: i ? 1 : 0.8 })),
		{
			seg: toes,
			pal: ORANGE,
			capEnd: true,
			deform: (p, _t, a, i) => {
				const c = Math.cos(a);
				// Three toes in front.
				const web = b.lod === 0 ? 0.5 * Math.cos(a * 10) * smooth(0.5, 0.75, c) : 0;
				const x = c > 0 ? 7.7 * Math.sqrt(c) + web : 4.6 * c;
				p.set(0.6 + x, 0.05 + i * 0.75 + 0.2 * smooth(6, 9, x), z0 + Math.sin(a) * (3.1 + 0.55 * smooth(-0.2, 0.7, c)));
			},
			weightAt: (p) => weights(s, p.x)
		}
	);
	// Big head over the toes.
	const hx = 6.9;
	const hy = 5.0;
	const w = weights(s, 4.4);
	b.ball([hx, hy, z0], [2.75, 2.75, 2.95], { w, pal: YELLOW, seg: b.pick(13, 8, 5), rings: b.pick(8, 5, 4) });
	// Bill: open a little, turned up.
	const bill = (pts: readonly (readonly [number, number, number, number])[], shade: number) =>
		b.loft(
			pts.map(([x, y, hw, h]): Ring => ({ c: [x, y, z0], f: h, s: hw, n: 2.4, w })),
			{ seg: b.pick(8, 5, 4), u: [0, 1, 0], v: [0, 0, 1], pal: ORANGE, capStart: true, capEnd: true, shadeAt: () => shade }
		);
	bill(b.pick([[9, 4.75, 1.35, 0.6], [10, 4.65, 1.6, 0.42], [11, 4.8, 1.65, 0.28], [11.8, 5.1, 1.25, 0.2], [12.1, 5.25, 0.6, 0.1]], [[9, 4.75, 1.4, 0.6], [10.8, 4.75, 1.65, 0.32], [12, 5.2, 0.8, 0.12]], [[8.8, 4.7, 1.4, 0.6], [12, 5.1, 1.1, 0.2]]), 1);
	if (b.lod === 0) bill([[8.8, 4.0, 1.1, 0.35], [10.2, 3.75, 1.25, 0.25], [11.1, 3.85, 0.6, 0.12]], 0.8);
	// Tail.
	const tail = b.pick([[-4.4, 4.0, 1.7, 1.3], [-5.8, 4.7, 1.35, 0.8], [-6.9, 5.7, 0.9, 0.5], [-7.5, 6.6, 0.25, 0.18]], [[-4.4, 4, 1.7, 1.3], [-6.2, 4.9, 1.2, 0.7], [-7.5, 6.5, 0.3, 0.2]], [[-4.6, 4, 1.6, 1.2], [-7.3, 6.3, 0.4, 0.3]]);
	b.loft(
		tail.map(([x, y, hw, h]): Ring => ({ c: [x!, y!, z0], f: h!, s: hw!, w: weights(s, x!) })),
		{ seg: b.pick(8, 4, 4), u: [0, 1, 0], v: [0, 0, 1], pal: YELLOW, capEnd: true }
	);
	for (const k of [-1, 1]) {
		// Eyes.
		b.ball([hx + 1.75, hy + 1.0, z0 + k * 1.85], [0.75, 0.95, 0.75], { w, pal: b.lod === 2 ? BLACK : WHITE, seg: b.pick(8, 5, 4), rings: b.pick(4, 3, 3), rot: [0, k * -0.8, 0] });
		if (b.lod === 2) continue;
		b.ball([hx + 2.15, hy + 1.0, z0 + k * 2.15], [0.5, 0.65, 0.5], { w, pal: BLACK, seg: b.pick(7, 4, 4), rings: b.pick(4, 3, 3) });
		if (b.lod === 0) b.ball([hx + 2.5, hy + 1.3, z0 + k * 2.3], [0.18, 0.2, 0.18], { w, pal: WHITE, seg: 4, rings: 3 });
		if (b.lod > 0) continue;
		// Wings, swept up behind.
		const wing = [[2.8, 2.4, 0.7, 0.3], [1.2, 2.4, 1.4, 0.55], [-1.2, 2.7, 1.4, 0.5], [-3.5, 3.7, 0.3, 0.14]];
		b.loft(
			wing.map(([x, y, h, th]): Ring => ({ c: [x!, y!, z0 + k * (sample(BODY, x!)[1]! - 0.25)], f: h!, s: th!, w: weights(s, x!) })),
			{ seg: 6, u: [0, 1, 0], v: [0, 0, 1], pal: YELLOW, capStart: true, capEnd: true, shadeAt: () => 0.92 }
		);
	}
}

registerItemMesh('shoes_duck', {
	colors: [0xffd21f, 0xff8418, 0xfbf8ee, 0x1c1a18],
	build(b) {
		for (const s of SIDES) buildDuck(b, s);
	}
});
