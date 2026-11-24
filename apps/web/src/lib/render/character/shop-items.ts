/**
 * Meshes of the shop's items (data: SHOP_ITEMS in `packages/shared/src/cosmetics.ts`).
 * How to add one: docs/characters.md. All shapes and patterns are original.
 */
import * as THREE from 'three';
import { legWeights } from './body.js';
import { registerItemMesh } from './items.js';
import { bone, lerp, mix, PAL, smooth, superellipse, type PartBuilder, type Ring } from './mesh-kit.js';
import {
	buildCollar,
	buildLaces,
	buildLeg,
	buildSeat,
	buildShoeBase,
	buildSleeve,
	SHOE_TABLE,
	shoeWeights,
	torsoRings,
	torsoWeights
} from './outfit.js';
import { BIND, sideSign, type Side } from './skeleton.js';

const SIDES: readonly Side[] = ['L', 'R'];
const HEAD = bone('head');

// ---------------------------------------------------------------------------
// Hats (socket space: origin at band height, +X forward)

/** Ring of a hat; `f`, `back`, `s`: radius forward, backward, sideways. */
const hatRing = (y: number, f: number, back: number, s: number, shade = 1): Ring => ({ c: [0.1, y, 0], f, b: back, s, n: 2.2, w: HEAD, shade });

registerItemMesh('hat_cap', {
	hides: ['hair'],
	colors: [0x1d3f73, 0xf06a3c, 0xf3eee2, 0x12294d],
	build(b) {
		b.socket('hat', () => {
			b.loft([hatRing(-0.7, 4.8, 4.8, 4.4), hatRing(-0.6, 5.5, 5.7, 5.05), hatRing(0.3, 5.5, 5.7, 5.1), hatRing(1.7, 5.25, 5.45, 4.85), hatRing(3, 4.3, 4.6, 4), hatRing(3.9, 2.7, 3, 2.6), hatRing(4.25, 0.8, 1.1, 0.9)], {
				seg: b.pick(24, 12, 8),
				pal: PAL.hatA,
				capEnd: true,
				// A light front panel and a dark band around the rest.
				palAt: (i, a) => (Math.cos(a) > 0.55 && i < 5 ? PAL.hatC : i < 2 ? PAL.hatD : PAL.hatA)
			});
			if (b.lod < 2) b.ball([0, 4.3, 0], [0.75, 0.45, 0.75], { w: HEAD, pal: PAL.hatB, seg: 8, rings: 4 });
			// Curved peak.
			const cols = b.pick(13, 9, 5);
			const rows = Array.from({ length: 4 }, (_, i) => {
				const k = i / 3;
				return Array.from({ length: cols }, (_, j) => {
					const a = (j / (cols - 1) - 0.5) * 2.2;
					return new THREE.Vector3(Math.cos(a) * (5.1 + k * 4.2) - k * (1 - Math.cos(a)) * 1.5, -0.1 - k * k * 0.35 - Math.sin(a) ** 2 * 0.9 * k, Math.sin(a) * (4.9 + k * 0.2));
				});
			});
			b.grid(rows, { w: HEAD, pal: PAL.hatB, flip: true });
			b.grid(rows.map((r) => r.map((p) => p.clone().setY(p.y - 0.32))), { w: HEAD, pal: PAL.hatD });
			b.grid([rows[3]!, rows[3]!.map((p) => p.clone().setY(p.y - 0.32))], { w: HEAD, pal: PAL.hatB, flip: true });
		});
	}
});

registerItemMesh('hat_beanie', {
	hides: ['hair'],
	colors: [0xd89a1e, 0x6b2f52, 0xf4ecda, 0xb87f14],
	build(b) {
		b.socket('hat', () => {
			const seg = b.pick(32, 14, 8);
			// Ribbed knit; the back sits lower.
			const deform = (p: THREE.Vector3, _t: number, _a: number, i: number) => {
				p.y += p.x * 0.1 * (i < 6 ? 1 : 0);
			};
			const rib = (p: THREE.Vector3, a: number) => (b.lod > 0 ? 1 : Math.cos(a * 16 + 0.01) > 0 ? 1.04 : 0.84) * (p.y < -1.2 ? 0.9 : 1);
			b.loft([hatRing(0.4, 5.1, 5.6, 4.8), hatRing(1.6, 5.2, 5.6, 4.85), hatRing(2.9, 4.6, 4.9, 4.3), hatRing(4, 3.3, 3.6, 3.1), hatRing(4.7, 1.2, 1.5, 1.2)], {
				seg,
				pal: PAL.hatA,
				capEnd: true,
				deform,
				shadeAt: rib,
				palAt: (i) => (i === 1 ? PAL.hatB : PAL.hatA)
			});
			// Folded cuff.
			b.loft([hatRing(-1.2, 4.8, 5.1, 4.5, 0.7), hatRing(-1.25, 5.5, 5.95, 5.15), hatRing(-0.2, 5.75, 6.15, 5.35), hatRing(0.8, 5.6, 6.05, 5.25), hatRing(1, 5, 5.5, 4.7, 0.8)], {
				seg,
				deform,
				shadeAt: rib,
				pal: PAL.hatD
			});
			// Pom-pom.
			b.ball([-0.2, 6, 0], [1.75, 1.6, 1.75], { w: HEAD, pal: PAL.hatC, seg: b.pick(12, 7, 5), rings: b.pick(8, 5, 4) });
			if (b.lod === 0)
				for (let i = 0; i < 9; i++) {
					const a = i * 2.4;
					const y = 1.3 - i * 0.28;
					const r = Math.sqrt(Math.max(0, 2.2 - y * y * 0.9));
					b.ball([-0.2 + Math.cos(a) * r, 6 + y, Math.sin(a) * r], [0.62, 0.62, 0.62], { w: HEAD, pal: PAL.hatC, seg: 6, rings: 4, shade: i % 2 ? 0.88 : 1.02 });
				}
		});
	}
});

registerItemMesh('hat_straw', {
	hides: ['hair'],
	colors: [0xdcb668, 0x1f8f8a, 0xb88d45, 0xeacb86],
	build(b) {
		b.socket('hat', () => {
			const seg = b.pick(28, 14, 9);
			const weave = (_p: THREE.Vector3, a: number, i: number) => (b.lod > 0 ? 1 : (i + Math.floor(a * 9)) % 2 ? 0.9 : 1.02);
			b.loft([hatRing(-0.7, 4.9, 5, 4.6), hatRing(-0.5, 5.5, 5.8, 5.1), hatRing(0.9, 5.3, 5.5, 4.95), hatRing(1, 5.2, 5.4, 4.85), hatRing(2.6, 4.9, 5.1, 4.6), hatRing(3.4, 4.3, 4.5, 4), hatRing(3.8, 2.6, 2.8, 2.4)], {
				seg,
				pal: PAL.hatA,
				capEnd: true,
				shadeAt: weave,
				palAt: (i) => (i === 1 ? PAL.hatB : PAL.hatA)
			});
			// Wide brim, drooping at the sides.
			const brim = (grow: number, y: number): THREE.Vector3[] =>
				Array.from({ length: seg }, (_, j) => {
					const a = (j / seg) * Math.PI * 2;
					const k = grow / 5;
					return new THREE.Vector3(0.1 + Math.cos(a) * (5.2 + grow), y - Math.sin(a) ** 2 * 1.3 * k + Math.cos(a) * 0.35 * k, Math.sin(a) * (4.7 + grow));
				});
			const rows = [brim(0, 0), brim(1.7, -0.15), brim(3.4, -0.3), brim(4.6, -0.4)];
			b.grid(rows, { w: HEAD, pal: PAL.hatA, wrap: true, flip: true, shadeAt: (_p, i) => (i % 2 ? 0.9 : 1.02) });
			b.grid(rows.map((r) => r.map((p) => p.clone().setY(p.y - 0.28))), { w: HEAD, pal: PAL.hatC, wrap: true, shadeAt: () => 0.85 });
			b.grid([rows[3]!, rows[3]!.map((p) => p.clone().setY(p.y - 0.28))], { w: HEAD, pal: PAL.hatD, wrap: true, flip: true });
		});
	}
});

/** Crown of the fry cook hat: height and radius. */
const FRY_ROWS: readonly (readonly [number, number])[] = [[-0.2, 5.1], [1.5, 5.2], [4, 5.35], [6.5, 5.45], [8.5, 5.35], [10, 4.95], [11.1, 4.1], [11.8, 2.8], [12.1, 1.1]];
const fryRadius = (y: number): number => {
	let i = 1;
	while (i < FRY_ROWS.length - 1 && FRY_ROWS[i]![0] < y) i++;
	const [y0, r0] = FRY_ROWS[i - 1]!;
	const [y1, r1] = FRY_ROWS[i]!;
	return lerp(r0, r1, Math.min(1, Math.max(0, (y - y0) / (y1 - y0))));
};
/** Worn small, perched on top of the head and tipped back a little. */
const FRY_AT = { pos: [-0.5, 3.1, 0] as [number, number, number], scale: 0.58, rot: [0, 0, 0.1] as [number, number, number] };
/** Black, drawn as a very dark shade so the four palette colours stay free. */
const INK = 0.06;

registerItemMesh('hat_frycook', {
	// Sits on top of the hair, which stays as it is.
	colors: [0xf7f6f2, 0xee5a3e, 0x4f86c8, 0xb9e5f8],
	build(b) {
		b.socket('hat', () => {
			const seg = b.pick(36, 14, 9);
			const off = (a: number) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
			// Tall white crown; a light blue panel behind the red seam, on both sides.
			const rows = b.lod === 2 ? FRY_ROWS.filter((_, i) => i % 2 === 0) : FRY_ROWS;
			b.loft(rows.map(([y, r]) => ({ c: [0.1, y, 0], f: r, b: r + 0.15, s: r - 0.25, n: 2.2, w: HEAD })), {
				seg,
				pal: PAL.hatA,
				capEnd: true,
				palAt: (_i, a) => (off(a) > 1.4 && off(a) < 2.2 ? PAL.hatD : PAL.hatA)
			});
			// Point on the crown, `out` units outside it. Angle 0 is the front.
			const on = (y: number, a: number, out: number): THREE.Vector3 => {
				const r = fryRadius(y) + out;
				const [ca, sa] = superellipse(a, 2.2);
				return new THREE.Vector3(0.1 + ca * (ca < 0 ? r + 0.15 : r), y, sa * (r - 0.25));
			};
			// Angle of the front point `z` units to the side.
			const at = (z: number) => Math.sign(z) * Math.asin(Math.min(1, Math.abs(z) / 5.2) ** 1.1);
			// Black band around the head.
			b.loft([[-1, 4.9], [-1, 5.5], [0.7, 5.5], [0.75, 5.1]].map(([y, r]) => ({ c: [0.1, y!, 0], f: r!, b: r! + 0.15, s: r! - 0.25, n: 2.2, w: HEAD, shade: INK })), { seg, pal: PAL.hatC, shadeAt: () => INK });
			// Black button on top.
			b.ball([0.1, 12.1, 0], [1.7, 1, 1.7], { w: HEAD, pal: PAL.hatC, seg: b.pick(12, 8, 6), rings: b.pick(6, 4, 3), shade: INK });
			if (b.lod < 2) {
				// Red seam: up one side, over the top, down the other.
				const ys = FRY_ROWS.slice(0, 8).map(([y]) => y);
				const path = [...ys.map((y) => on(y, -1.45, 0.05)), on(12.1, 0, 0.1).setX(0.1).setZ(0), ...ys.slice().reverse().map((y) => on(y, 1.45, 0.05))];
				const n = b.pick(6, 4, 4);
				const tube = path.map((c, k) => {
					const dir = path[Math.min(k + 1, path.length - 1)]!.clone().sub(path[Math.max(k - 1, 0)]!).normalize();
					const side = new THREE.Vector3(1, 0, 0);
					const up = dir.clone().cross(side).normalize();
					return Array.from({ length: n }, (_, j) => {
						const t = (j / n) * Math.PI * 2;
						return c.clone().addScaledVector(side, Math.cos(t) * 0.42).addScaledVector(up, Math.sin(t) * 0.42);
					});
				});
				b.grid(tube, { w: HEAD, pal: PAL.hatB, wrap: true });
				// Black line between the light blue panel and the white back.
				if (b.lod === 0)
					for (const s of SIDES) {
						const z = sideSign(s);
						const line = ys.slice(1, 7).map((y) => [on(y, z * 2.16, 0.07), on(y, z * 2.24, 0.07)]);
						b.grid(line, { w: HEAD, pal: PAL.hatC, flip: z < 0, shadeAt: () => INK });
					}
				// Anchor on the front. Patches of [y, z half-width] follow the crown.
				const patch = (rowsIn: readonly (readonly [number, number, number])[]) => {
					b.grid(
						rowsIn.map(([y, z0, z1]) => [on(y, at(z0), 0.1), on(y, at((z0 + z1) / 2), 0.1), on(y, at(z1), 0.1)]),
						{ w: HEAD, pal: PAL.hatC, flip: true }
					);
				};
				const ring = (y: number, r: number, w: number) => {
					const k = b.pick(16, 8, 8);
					const edge = (rr: number) => Array.from({ length: k }, (_, j) => {
						const t = (j / k) * Math.PI * 2;
						return on(y + Math.sin(t) * rr, at(Math.cos(t) * rr), 0.1);
					});
					b.grid([edge(r), edge(r - w)], { w: HEAD, pal: PAL.hatC, wrap: true, flip: true });
				};
				ring(8.6, 0.95, 0.42);
				patch([[2.5, -0.22, 0.22], [7.8, -0.22, 0.22]]);
				patch([[6.2, -1.55, 1.55], [6.75, -1.55, 1.55]]);
				// Curved flukes.
				const arc = b.pick(12, 6, 6);
				const bend = (inner: boolean) => Array.from({ length: arc + 1 }, (_, j) => {
					const t = (j / arc - 0.5) * 2;
					const tip = 1 - Math.abs(t);
					const y = 3.3 + t * t * 1.1 + (inner ? 0.25 + 0.35 * tip : -0.15 * tip);
					return on(y, at(t * 2), 0.1);
				});
				b.grid([bend(false), bend(true)], { w: HEAD, pal: PAL.hatC, flip: true });
			}
			// Big blue peak with a black edge, turned up towards the tip.
			const cols = b.pick(15, 9, 5);
			const peakRow = (k: number) =>
				Array.from({ length: cols }, (_, j) => {
					const a = (j / (cols - 1) - 0.5) * 2.4;
					const c = Math.cos(a);
					return new THREE.Vector3(c * (5.3 + k * 6.4) - k * (1 - c) * 1.2, -0.15 - Math.sin(Math.PI * Math.min(1, k * 1.15)) * 0.5 + k * k * 1.1 - Math.sin(a) ** 2 * 1.1 * k, Math.sin(a) * (5 + k * 0.5));
				});
			const peak = [0, 0.35, 0.65, 0.88].map(peakRow);
			const edge = peakRow(1);
			const lower = (r: THREE.Vector3[]) => r.map((p) => p.clone().setY(p.y - 0.4));
			b.grid(peak, { w: HEAD, pal: PAL.hatC, flip: true });
			b.grid([peak[3]!, edge, lower(edge), lower(peak[3]!)], { w: HEAD, pal: PAL.hatC, flip: true, shadeAt: () => INK });
			b.grid(peak.map(lower), { w: HEAD, pal: PAL.hatC, shadeAt: () => 0.75 });
		}, FRY_AT);
	}
});

// ---------------------------------------------------------------------------
// Sunglasses (socket space: origin at the bridge of the nose)

registerItemMesh('glasses_shades', {
	colors: [0x15171b, 0xff8a2a, 0xffc24a, 0x15171b],
	build(b) {
		b.socket('glasses', () => {
			for (const s of SIDES) {
				const z = sideSign(s) * 2;
				// Wrapped around the face.
				const deform = (p: THREE.Vector3) => {
					p.x -= (Math.abs(p.z) - 1) * 0.42;
				};
				const lens = (x: number, f: number, w: number, pal: number): Ring => ({ c: [x, -0.05, z], f, b: f * 1.05, s: w, n: 3.2, w: HEAD, pal });
				b.loft([lens(0.15, 1.2, 1.72, PAL.glassesA), lens(0.55, 1.2, 1.72, PAL.glassesA), lens(0.6, 0.95, 1.45, PAL.glassesB), lens(0.66, 0.5, 1.0, PAL.glassesC)], {
					seg: b.pick(16, 10, 6),
					u: [0, 1, 0],
					v: [0, 0, 1],
					capStart: true,
					capEnd: true,
					deform
				});
				b.box([-3.1, 0.5, z * 2.06], [5.1, 0.6, 0.32], { w: HEAD, pal: PAL.glassesA, rot: [0, sideSign(s) * 0.05, 0] });
			}
			b.box([0.75, 0.45, 0], [0.4, 0.45, 1], { w: HEAD, pal: PAL.glassesA });
		});
	}
});

registerItemMesh('glasses_round', {
	colors: [0xc9a24d, 0x1b2926, 0x22332f, 0x8d6f30],
	build(b) {
		b.socket('glasses', () => {
			const seg = b.pick(18, 10, 7);
			for (const s of SIDES) {
				const z = sideSign(s) * 1.95;
				const deform = (p: THREE.Vector3) => {
					p.x -= (Math.abs(p.z) - 1) * 0.36;
				};
				const disc = (x: number, r: number, pal: number): Ring => ({ c: [x, -0.1, z], f: r, b: r, s: r, w: HEAD, pal });
				// Thin round metal rim with a dark lens inside.
				b.loft([disc(0.2, 1.42, PAL.glassesA), disc(0.46, 1.42, PAL.glassesA), disc(0.47, 1.2, PAL.glassesB), disc(0.53, 0.65, PAL.glassesC)], {
					seg,
					u: [0, 1, 0],
					v: [0, 0, 1],
					capStart: true,
					capEnd: true,
					deform
				});
				b.box([-3, 0.35, z * 2.12], [5.2, 0.3, 0.22], { w: HEAD, pal: PAL.glassesA, rot: [0, sideSign(s) * 0.05, 0] });
			}
			b.box([0.42, 0.25, 0], [0.24, 0.26, 1.3], { w: HEAD, pal: PAL.glassesD });
		});
	}
});

// ---------------------------------------------------------------------------
// T-shirts

interface Tee {
	/** Ring heights at LOD 0, 1, 2. */
	ys: readonly [readonly number[], readonly number[], readonly number[]];
	seg?: readonly [number, number, number];
	hem?: number;
	grow?: number;
	sleeve: number;
	sleevePals: (s: Side) => { sleeve: number; cuff: number };
	collar: number;
	/** Palette between two heights at an angle (0 front, π/2 right). */
	pal: (y0: number, y1: number, a: number, row: number) => number;
}

function buildTee(b: PartBuilder, t: Tee): void {
	const rings = torsoRings(t.hem ?? 37.2, b.pick(...t.ys), t.grow ?? 0.15);
	b.loft(rings, {
		seg: b.pick(...(t.seg ?? [20, 12, 8])),
		pal: PAL.topA,
		capEnd: true,
		weightAt: (p) => torsoWeights(p.y, p.z),
		deform:
			b.lod > 0
				? undefined
				: (p) => {
						// Chest and shoulder blades.
						if (p.x > 0) p.x += 0.35 * Math.exp(-(((p.y - 51.5) / 2.2) ** 2) - ((Math.abs(p.z) - 3.6) / 2.4) ** 2);
						else p.x -= 0.3 * Math.exp(-(((p.y - 52.5) / 2.4) ** 2) - ((Math.abs(p.z) - 4.4) / 2.2) ** 2);
					},
		palAt: (i, a) => t.pal(rings[i]!.c[1], rings[i + 1]!.c[1], a, i),
		shadeAt: (p) => lerp(0.84, 1, smooth(37, 44, p.y)) * (Math.abs(p.z) > 6.6 && p.y > 46 && p.y < 54 ? 0.9 : 1)
	});
	buildCollar(b, t.collar);
	for (const s of SIDES) buildSleeve(b, s, t.sleeve, t.sleevePals(s));
}

const SUNSET_YS = [38.4, 40.6, 42.4, 44.2, 46, 47.8, 49.6, 51.4, 53.2, 55.2, 56.6, 57.7, 58.5];
registerItemMesh('top_sunset', {
	colors: [0x1c2350, 0xd43a6e, 0xff8a3c, 0xffd86b],
	build: (b) =>
		buildTee(b, {
			ys: [SUNSET_YS, [40.6, 44.2, 47.8, 51.4, 53.2, 55.5, 57.7, 58.5], [40.6, 47.8, 53.2, 58.5]],
			sleeve: 7.4,
			sleevePals: () => ({ sleeve: PAL.topA, cuff: PAL.topC }),
			collar: PAL.topA,
			pal: (y0, y1) => {
				const y = (y0 + y1) / 2;
				return y < 40.6 ? PAL.topA : y < 44.2 ? PAL.topD : y < 47.8 ? PAL.topC : y < 51.4 ? PAL.topB : PAL.topA;
			}
		})
});

registerItemMesh('top_halves', {
	colors: [0xf2625a, 0x3fc6a4, 0xfbf3e4, 0x2b2f3a],
	build: (b) =>
		buildTee(b, {
			ys: [[38, 40, 42, 45, 48, 51, 53.2, 55.2, 56.6, 57.7, 58.5], [38.4, 42, 46, 51, 53.5, 56, 57.6, 58.5], [38.4, 44, 51, 55.5, 58.5]],
			hem: 36.5,
			grow: 0.45,
			sleeve: 9.6,
			// The sleeves take the other half's colour.
			sleevePals: (s) => ({ sleeve: s === 'R' ? PAL.topA : PAL.topB, cuff: PAL.topC }),
			collar: PAL.topC,
			pal: (_y0, y1, a) => (y1 < 37.4 ? PAL.topC : Math.sin(a) > 0 ? PAL.topB : PAL.topA)
		})
});

registerItemMesh('top_checker', {
	colors: [0x23262d, 0xf1ece0, 0xe24a3b, 0x23262d],
	build: (b) =>
		buildTee(b, {
			ys: [[38.6, 40.5, 42.4, 44.3, 46.2, 48.1, 50, 51.9, 53.8, 55.6, 56.8, 57.7, 58.5], [40.5, 44.3, 48.1, 51.9, 55.2, 57, 58.5], [40.5, 46, 51.9, 55.5, 58.5]],
			seg: [24, 12, 8],
			sleeve: 6.4,
			sleevePals: () => ({ sleeve: PAL.topA, cuff: PAL.topC }),
			collar: PAL.topC,
			pal: (y0, y1, a, row) => {
				const n = b.pick(24, 12, 8);
				if (y1 < 38 || y0 >= 55) return PAL.topA;
				return (row + Math.floor((a / (Math.PI * 2)) * n)) % 2 ? PAL.topA : PAL.topB;
			}
		})
});

// ---------------------------------------------------------------------------
// Trousers

/** Two cord ends hanging from the waistband. */
function drawstring(b: PartBuilder, pal: number): void {
	if (b.lod > 0) return;
	for (const s of SIDES) b.box([5.1, 35.6, sideSign(s) * 0.55], [0.3, 2.6, 0.32], { w: bone('pelvis'), pal, rot: [sideSign(s) * -0.12, 0, 0] });
}

registerItemMesh('bottom_boardshorts', {
	// No `hides`: the bare shins show below the hem.
	colors: [0x1799b8, 0xffe1a1, 0x0d5f7a, 0xff7a4a],
	build(b) {
		buildSeat(b, { seat: PAL.bottomA, belt: PAL.bottomC, buckle: PAL.bottomB });
		for (const s of SIDES) buildLeg(b, s, 21.8, { leg: PAL.bottomA, cuff: PAL.bottomB, stripe: PAL.bottomD }, { fit: (y) => 0.55 * (1 - smooth(23, 31, y)), stripe: 0.7, stripeTop: 34 });
		drawstring(b, PAL.bottomB);
	}
});

registerItemMesh('bottom_joggers', {
	hides: ['shins'],
	colors: [0xb4bac2, 0x2a2e36, 0x8f97a1, 0xf2f2ee],
	build(b) {
		buildSeat(b, { seat: PAL.bottomA, belt: PAL.bottomC, buckle: PAL.bottomD });
		// Loose over the calf, tight at the ankle.
		const fit = (y: number) => 0.5 * smooth(6, 9.5, y) * (1 - smooth(13, 18, y)) - 0.12 * (1 - smooth(4.5, 7.5, y)) + 0.2 * smooth(20, 25, y) * (1 - smooth(28, 33, y));
		for (const s of SIDES) buildLeg(b, s, 4, { leg: PAL.bottomA, cuff: PAL.bottomB, stripe: PAL.bottomB }, { fit, stripe: 0.8, stripeTop: 34 });
		drawstring(b, PAL.bottomD);
	}
});

registerItemMesh('bottom_cargo', {
	hides: ['shins'],
	colors: [0x7d7a4b, 0x5e5c36, 0x3c2c1c, 0xc7a758],
	build(b) {
		buildSeat(b);
		const fit = (y: number) => 0.5 * (1 - smooth(28, 33, y));
		for (const s of SIDES) {
			buildLeg(b, s, 3.1, { leg: PAL.bottomA, cuff: PAL.bottomB, stripe: PAL.bottomA }, { fit });
			const out = sideSign(s);
			const z = BIND[`thigh${s}`][2];
			const w = legWeights(s, 25);
			// Side pocket with a flap.
			b.box([-0.4, 24.8, z + out * 4.1], [4.8, 5, 1.2], { w, pal: PAL.bottomA, shade: 0.94 });
			if (b.lod < 2) b.box([-0.4, 26.9, z + out * 4.25], [5.1, 1.6, 1.3], { w, pal: PAL.bottomB });
			if (b.lod === 0) {
				b.box([-0.4, 26.5, z + out * 4.92], [0.6, 0.6, 0.2], { w, pal: PAL.bottomD });
				// Back pocket.
				b.box([-5.15, 31.6, z], [0.6, 3.4, 4], { w: legWeights(s, 32), pal: PAL.bottomB });
			}
		}
	}
});

// ---------------------------------------------------------------------------
// Shoes

/** Shaft around the ankle: rings of y, front, back, side radius; closed inwards at the top. */
function shaft(b: PartBuilder, s: Side, rows: readonly (readonly [number, number, number, number])[], pals: { shaft: number; top: number; inner: number }): void {
	const z0 = BIND[`foot${s}`][2] + sideSign(s) * 0.15;
	// Same weights as the trousers, and the leg leans forward going up.
	const ring = (y: number, f: number, back: number, r: number, pal: number, shade = 1): Ring => ({ c: [lerp(-1.1, -0.3, smooth(4, 9, y)), y, z0], f, b: back, s: r, w: legWeights(s, y), pal, shade });
	const rings = rows.map(([y, f, back, r], i) => ring(y, f, back, r, i >= rows.length - 2 ? pals.top : pals.shaft));
	const [y, f, back, r] = rows[rows.length - 1]!;
	b.loft([...rings, ring(y + 0.1, f - 0.4, back - 0.4, r - 0.4, pals.inner, 0.8), ring(y - 1.5, f - 0.7, back - 0.7, r - 0.7, pals.inner, 0.5)], {
		seg: b.pick(12, 8, 5)
	});
}

registerItemMesh('shoes_hightops', {
	colors: [0x6b3fc0, 0xf4f0e6, 0xf4f0e6, 0x201a33],
	build(b) {
		for (const s of SIDES) {
			const z0 = BIND[`foot${s}`][2] + sideSign(s) * 0.15;
			buildShoeBase(b, s, { palAt: (x) => (x >= 6 || (b.lod === 2 && x >= 5) ? PAL.shoesC : PAL.shoesA), soleHeight: () => 1.45, soleGrow: 0.3 });
			shaft(
				b,
				s,
				[
					[3.6, 3.4, 2.6, 2.2],
					[4.8, 3.0, 2.3, 2.35],
					[6, 2.6, 2.25, 2.4],
					[7.4, 2.5, 2.35, 2.4],
					[8.6, 2.55, 2.5, 2.45],
					[9, 2.55, 2.5, 2.45]
				],
				{ shaft: PAL.shoesA, top: PAL.shoesB, inner: PAL.shoesD }
			);
			buildLaces(b, s, SHOE_TABLE, PAL.shoesB);
			if (b.lod === 0)
				for (let i = 0; i < 3; i++) b.box([1.85 + i * 0.12, 5.7 + i * 1.05, z0], [0.4, 0.35, 2.2], { w: legWeights(s, 5.7 + i * 1.05), pal: PAL.shoesB });
		}
	}
});

registerItemMesh('shoes_slides', {
	colors: [0x17a2a0, 0x24303f, 0xfff0d2, 0x24303f],
	build(b) {
		for (const s of SIDES) {
			const side = sideSign(s);
			const z0 = BIND[`foot${s}`][2] + side * 0.15;
			const xs = b.pick([-4.2, -3.4, -2, 0, 2, 3.8, 5.4, 6.6, 7.3], [-4.2, -2.4, 0, 3, 5.6, 7.3], [-4.2, 0, 4, 7.2]);
			// x, half width, top of the bare foot, centre shift.
			const at = (x: number): readonly [number, number, number] => {
				const k = smooth(-4.4, -3, x) * (1 - smooth(6, 8.2, x) * 0.6);
				return [lerp(1.0, 2.15, k) + 0.25 * smooth(2, 5, x) * (1 - smooth(6, 7.4, x)), lerp(4.1, 2.5, smooth(0.5, 5.5, x)) - 0.9 * (1 - smooth(-4.4, -2.6, x)), -side * 0.3 * smooth(3, 8, x)];
			};
			b.loft(
				xs.map((x): Ring => {
					const [hw, top, shift] = at(x);
					return { c: [x, (top + 1.2) / 2, z0 + shift], f: (top - 1.2) / 2, s: hw * 0.93, n: 2.4, w: shoeWeights(s, x) };
				}),
				{ seg: b.pick(12, 8, 5), u: [0, 1, 0], v: [0, 0, 1], pal: PAL.skin, capStart: true, capEnd: true, shadeAt: (p) => lerp(0.82, 1, smooth(1.2, 2.6, p.y)) }
			);
			if (b.lod === 0)
				for (let i = 0; i < 5; i++) {
					const t = i / 4;
					b.ball([7.3 - t * t * 1.5, 1.85 - t * 0.1, z0 + side * (-1.65 + t * 3.2)], [lerp(0.95, 0.7, t), lerp(0.62, 0.48, t), lerp(0.52, 0.36, t)], { w: bone(`toe${s}`), pal: PAL.skin, seg: 7, rings: 5 });
				}
			// Ankle.
			b.loft(
				[
					{ c: [-1.5, 2.4, z0], f: 3, b: 2.3, s: 1.95, w: bone(`foot${s}`) },
					{ c: [-1.2, 4.2, z0], f: 2.2, b: 2, s: 1.85, w: legWeights(s, 4.2) },
					{ c: [-0.7, 6.5, z0], f: 1.9, b: 1.9, s: 1.75, w: legWeights(s, 6.5) },
					{ c: [-0.3, 9.5, z0], f: 2, b: 2.1, s: 1.9, w: legWeights(s, 9.5) }
				],
				{ seg: b.pick(10, 6, 4), pal: PAL.skin }
			);
			// Foam sole in two layers.
			const sole = (lo: number, hi: number, grow: number, pal: number) =>
				b.loft(
					xs.map((x, i): Ring => {
						const [hw, , shift] = at(x);
						const end = i === 0 ? -0.5 : i === xs.length - 1 ? 1.1 : 0;
						return { c: [x + end, (lo + hi) / 2, z0 + shift], f: (hi - lo) / 2, s: (hw + grow) * (end ? 0.72 : 1), n: 4, w: shoeWeights(s, x) };
					}),
					{ seg: b.pick(10, 6, 4), u: [0, 1, 0], v: [0, 0, 1], pal, capStart: true, capEnd: true }
				);
			sole(0, 0.75, 0.42, PAL.shoesB);
			sole(0.7, 1.35, 0.34, PAL.shoesA);
			// Wide strap over the instep.
			const strap = (x: number, grow: number, pal: number): Ring => {
				const [hw, top, shift] = at(x);
				return { c: [x, (top + 1.0) / 2 + 0.1, z0 + shift], f: (top - 0.8) / 2 + grow, s: hw * 0.95 + grow, n: 2.6, w: shoeWeights(s, x), pal };
			};
			b.loft([strap(1.3, 0.02, PAL.shoesA), strap(1.35, 0.34, PAL.shoesA), strap(2.4, 0.36, PAL.shoesC), strap(3.4, 0.36, PAL.shoesA), strap(4.6, 0.34, PAL.shoesA), strap(4.65, 0.02, PAL.shoesA)], {
				seg: b.pick(14, 8, 6),
				u: [0, 1, 0],
				v: [0, 0, 1]
			});
		}
	}
});

registerItemMesh('shoes_slipons', {
	colors: [0xb4493c, 0xf1e9d6, 0x2b2d34, 0xf2f0ea],
	build(b) {
		for (const s of SIDES) {
			// Plain canvas on a flat sole: no laces, a dark elastic band over the instep.
			buildShoeBase(b, s, { palAt: (x) => (b.lod < 2 && x >= -0.6 && x < 1.2 ? PAL.shoesC : PAL.shoesA), soleHeight: () => 1.35, soleGrow: 0.28 });
			// Low collar with a short sock.
			shaft(
				b,
				s,
				[
					[3.6, 3.4, 2.55, 2.2],
					[4.7, 2.95, 2.3, 2.3],
					[5.3, 2.7, 2.3, 2.35],
					[7, 2.5, 2.35, 2.38]
				],
				{ shaft: PAL.shoesA, top: PAL.shoesD, inner: PAL.shoesD }
			);
		}
	}
});

const BOOT_TABLE = SHOE_TABLE.map(([x, hw, top, shift]) => [x!, hw! + 0.2, top! + (x! > 3 ? 0.55 : 0.2), shift! * 0.6]);
registerItemMesh('shoes_boots', {
	colors: [0x8a5426, 0x1d1a17, 0xc99a5b, 0x2a231d],
	build(b) {
		for (const s of SIDES) {
			const z0 = BIND[`foot${s}`][2] + sideSign(s) * 0.15;
			buildShoeBase(b, s, { table: BOOT_TABLE, palAt: (x) => (x >= 6 ? PAL.shoesD : PAL.shoesA), soleHeight: (x) => lerp(2, 1.6, smooth(-2, 4, x)), soleGrow: 0.32 });
			shaft(
				b,
				s,
				[
					[3.6, 3.5, 2.7, 2.4],
					[4.8, 3.2, 2.4, 2.5],
					[6, 2.75, 2.35, 2.6],
					[8, 2.6, 2.6, 2.55],
					[9.2, 2.65, 2.65, 2.6],
					[9.6, 2.85, 2.85, 2.8],
					[10.6, 2.8, 2.8, 2.75]
				],
				{ shaft: PAL.shoesA, top: PAL.shoesC, inner: PAL.shoesD }
			);
			buildLaces(b, s, BOOT_TABLE, PAL.shoesC);
			if (b.lod > 0) continue;
			for (let i = 0; i < 3; i++) b.box([2 + i * 0.1, 5.7 + i * 1.15, z0], [0.4, 0.4, 2.4], { w: legWeights(s, 5.7 + i * 1.15), pal: PAL.shoesC });
			// Lugs along the sole.
			for (const k of [-1, 1])
				for (let i = 0; i < 4; i++) {
					const x = -3 + i * 2.5;
					b.box([x, 0.6, z0 + k * 2.62], [1.2, 1.2, 0.5], { w: shoeWeights(s, x), pal: PAL.shoesB });
				}
		}
	}
});
