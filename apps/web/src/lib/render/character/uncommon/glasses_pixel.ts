/** Pixel shades: 8-bit staircase sunglasses built from cubes, with white glint pixels. */
import { registerItemMesh } from '../items.js';
import { PAL, type PartBuilder } from '../mesh-kit.js';
import { HEAD, SIDES } from '../shop-items.js';
import { sideSign } from '../skeleton.js';

const BLACK = PAL.glassesA;
const WHITE = PAL.glassesB;
const GREY = PAL.glassesC;
const NAVY = PAL.glassesD;

/** Size of a pixel. */
const P = 0.53;
const TOP = 1.15;
/** Columns from the bridge outwards, per row: first and last. */
const ROWS: readonly (readonly [number, number])[] = [[0, 8], [0, 8], [1, 7], [1, 6], [2, 5], [3, 4]];
/** Steps back around the face, per column. */
const DEPTH = [0.5, 0.5, 0.36, 0.22, 0.08, -0.18, -0.44, -0.7, -0.96];
/** Glints, in columns from the left of the picture of each lens: row, column. */
const GLINT: readonly (readonly [number, number, number])[] = [
	[1, 2, WHITE], [1, 3, WHITE], [2, 3, WHITE], [2, 4, WHITE], [3, 4, WHITE],
	[1, 4, GREY], [2, 5, GREY], [3, 5, GREY], [1, 6, GREY]
];

function pixelOf(row: number, col: number, k: number): number {
	if (row === 0) return BLACK;
	// Both lenses shine the same way: the picture of the left lens is not mirrored.
	const c = k > 0 ? col : 8 - col;
	for (const [r, g, pal] of GLINT) if (r === row && g === c) return pal;
	return row === ROWS.length - 1 || col === ROWS[row]![0] || col === ROWS[row]![1] ? BLACK : NAVY;
}

function lens(b: PartBuilder, k: 1 | -1): void {
	ROWS.forEach(([from, to], row) => {
		const y = TOP - row * P;
		if (b.lod === 2) {
			if (row % 2) return;
			b.box([0.1, y - P / 2, (k * (from + to + 1) * P) / 2], [0.7, P * 2, (to - from + 1) * P], { w: HEAD, pal: BLACK, rot: [0, k * 0.3, 0] });
			return;
		}
		for (let col = from; col <= to; ) {
			// Far away equal neighbours merge into one block.
			const pal = pixelOf(row, col, k);
			let end = col;
			if (b.lod > 0) while (end < to && pixelOf(row, end + 1, k) === pal && Math.abs(DEPTH[end + 1]! - DEPTH[col]!) < 0.3) end++;
			const lift = pal === WHITE ? 0.1 : pal === GREY ? 0.05 : row === 0 ? 0.12 : 0;
			const x = (DEPTH[col]! + DEPTH[end]!) / 2 + lift;
			b.box([x, y, k * ((col + end + 1) / 2) * P], [P * 1.25, P * 0.995, P * (end - col + 0.995)], { w: HEAD, pal, shade: (row + col) % 2 ? 0.9 : 1.08 });
			col = end + 1;
		}
	});
}

/** Arm as a flight of pixel steps: x, y (in pixels), length. */
const ARM: readonly (readonly [number, number, number])[] = [[-2.2, 0, 4], [-4.4, -1, 3], [-6, -2, 2]];

registerItemMesh('glasses_pixel', {
	colors: [0x16171c, 0xffffff, 0x8a93a8, 0x20253a],
	glow: [0, 0.35, 0, 0],
	build(b) {
		b.socket('glasses', () => {
			for (const s of SIDES) {
				const k = sideSign(s);
				lens(b, k);
				const z = k * 8.5 * P;
				for (const [x, step, n] of ARM) {
					const y = TOP - P / 2 + step * P * 0.75;
					if (b.lod > 0) b.box([x, y, z], [n * P * 1.2, P * 1.4, P], { w: HEAD, pal: BLACK });
					else for (let i = 0; i < n; i++) b.box([x + ((n - 1) / 2 - i) * P * 1.12, y, z], [P * 1.12, P * 1.4, P], { w: HEAD, pal: BLACK, shade: i % 2 ? 0.9 : 1.08 });
				}
			}
			if (b.lod === 2) return;
			// Nose pads, one pixel each.
			for (const k of [-1, 1]) b.box([0.3, TOP - 2 * P, k * 0.75], [P, P, P * 0.5], { w: HEAD, pal: BLACK, shade: 0.8 });
		});
	}
});
