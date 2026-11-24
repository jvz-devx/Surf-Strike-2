/** Canvas low-tops: plain canvas on a flat rubber sole, rubber toe cap, simple laces. */
import { registerItemMesh } from '../items.js';
import { PAL, sample, type Ring } from '../mesh-kit.js';
import { buildLaces, buildShoeBase, SHOE_TABLE, shoeWeights } from '../outfit.js';
import { shaft, SIDES } from '../shop-items.js';
import { BIND, sideSign } from '../skeleton.js';

registerItemMesh('shoes_canvas', {
	colors: [0xd9768f, 0xf3eee2, 0xf8f6f0, 0xa9aeb5],
	build(b) {
		for (const s of SIDES) {
			const side = sideSign(s);
			const z0 = BIND[`foot${s}`][2] + side * 0.15;
			buildShoeBase(b, s, { palAt: (x) => (b.lod === 2 && x >= 5 ? PAL.shoesB : PAL.shoesA), soleHeight: () => 1.25, soleGrow: 0.26 });
			// Rubber toe cap over the canvas.
			if (b.lod < 2) {
				const cap = (x: number, grow: number, shade = 1): Ring => {
					const [, hw, top, shift] = sample(SHOE_TABLE, x) as [number, number, number, number];
					return { c: [x, (top + 0.9) / 2, z0 + side * shift], f: (top - 0.9) / 2 + grow, s: hw * 0.97 + grow, n: 2.5, w: shoeWeights(s, x), shade };
				};
				b.loft(b.pick([cap(5.5, 0, 0.8), cap(5.55, 0.14), cap(6.4, 0.16), cap(7.5, 0.16), cap(8.15, 0.12)], [cap(5.5, 0, 0.8), cap(5.55, 0.15), cap(7, 0.16), cap(8.15, 0.12)], []), {
					seg: b.pick(14, 8, 5),
					u: [0, 1, 0],
					v: [0, 0, 1],
					pal: PAL.shoesB,
					capEnd: true
				});
			}
			// Low collar with a short sock.
			shaft(
				b,
				s,
				[
					[3.6, 3.4, 2.5, 2.2],
					[4.7, 3.15, 2.3, 2.3],
					[5.2, 3.1, 2.3, 2.4],
					[5.25, b.pick(2.95, 3, 3.3), b.pick(2.2, 2.3, 2.5), b.pick(2.25, 2.35, 2.5)],
					[7.2, b.pick(2.8, 2.85, 3.1), b.pick(2.35, 2.4, 2.6), b.pick(2.35, 2.4, 2.55)]
				],
				{ shaft: PAL.shoesA, top: PAL.shoesD, inner: PAL.shoesD }
			);
			buildLaces(b, s, SHOE_TABLE, PAL.shoesC);
		}
	}
});
