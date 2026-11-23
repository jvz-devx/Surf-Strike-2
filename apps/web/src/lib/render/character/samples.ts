/**
 * Sample cosmetics that prove the slot API (docs/characters.md). Dev gallery
 * and tests only: nothing in the game imports this file, so they never ship.
 */
import { getCosmetic, registerCosmetic, type CosmeticSlot } from '@surf/shared';
import { itemMesh, registerItemMesh, type ItemMesh } from './items.js';
import { bone, mix, PAL, type Ring } from './mesh-kit.js';
import { buildLeg, buildSeat, buildSleeve, torsoRings, torsoWeights } from './outfit.js';
import { BIND, sideSign, type Side } from './skeleton.js';
import * as THREE from 'three';

const SIDES: readonly Side[] = ['L', 'R'];

const SAMPLES: Record<string, { slot: CosmeticSlot; name: string; mesh: ItemMesh }> = {
	sample_cap: {
		slot: 'hat',
		name: 'Sample cap',
		mesh: {
			hides: ['hair'],
			colors: [0x1f6f5c, 0xf2c14e, 0xffffff, 0x123d33],
			build(b) {
				// Socket space: origin at the centre of the head, at band height (bind y 68.4).
				b.socket('hat', () => {
					const seg = b.pick(20, 12, 8);
					const ring = (y: number, f: number, back: number, s: number): Ring => ({ c: [0.1, y, 0], f, b: back, s, n: 2.2, w: bone('head') });
					b.loft([ring(-1, 4.6, 4.6, 4.2), ring(-0.9, 5.4, 5.5, 4.95), ring(0.6, 5.35, 5.45, 4.9), ring(2.2, 4.6, 4.8, 4.2), ring(3.4, 3.0, 3.4, 2.8), ring(3.9, 1.0, 1.4, 1)], {
						seg,
						pal: PAL.hatA,
						capEnd: true,
						palAt: (i, a) => (i === 1 ? PAL.hatB : Math.cos(a) > 0.6 && i < 4 ? PAL.hatC : PAL.hatA)
					});
					// Peak.
					const rows: THREE.Vector3[][] = [];
					for (let i = 0; i <= 3; i++) {
						const k = i / 3;
						rows.push(
							Array.from({ length: 9 }, (_, j) => {
								const a = (j / 8 - 0.5) * 2.1;
								return new THREE.Vector3(Math.cos(a) * (5 + k * 4.2) + 0.1 - k * (1 - Math.cos(a)) * 2, -0.55 - k * k * 0.9 - Math.abs(Math.sin(a)) * 0.7 * k, Math.sin(a) * (4.8 + k * 0.5));
							})
						);
					}
					b.grid(rows, { w: bone('head'), pal: PAL.hatB, flip: true });
					b.grid(
						rows.map((r) => r.map((p) => p.clone().setY(p.y - 0.3))),
						{ w: bone('head'), pal: PAL.hatD }
					);
				});
			}
		}
	},
	sample_shades: {
		slot: 'glasses',
		name: 'Sample sunglasses',
		mesh: {
			colors: [0x14161a, 0x243b55, 0x14161a, 0x14161a],
			build(b) {
				// Socket space: origin at the bridge of the nose, +X out of the face.
				b.socket('glasses', () => {
					const w = bone('head');
					for (const s of SIDES) {
						const z = sideSign(s);
						b.ball([0.05, 0, z * 1.95], [0.28, 1.0, 1.5], { w, pal: PAL.glassesB, seg: b.pick(12, 8, 6), rings: b.pick(6, 4, 3), rot: [0, z * -0.2, 0] });
						if (b.lod < 2) b.box([-0.15, 0.85, z * 1.95], [0.4, 0.35, 3.1], { w, pal: PAL.glassesA, rot: [0, z * -0.2, 0] });
						b.box([-3, 0.45, z * 4.2], [5.4, 0.35, 0.3], { w, pal: PAL.glassesA, rot: [0, z * 0.06, 0] });
					}
					b.box([0.2, 0.35, 0], [0.35, 0.35, 1.2], { w, pal: PAL.glassesA });
				});
			}
		}
	},
	sample_longsleeve: {
		slot: 'top',
		name: 'Sample long sleeve',
		mesh: {
			hides: ['upperArms', 'forearms'],
			colors: [0xf0a63a, 0x1d2b4a, 0xf7efe0, 0x1d2b4a],
			build(b) {
				const ys = b.pick([37, 38.4, 40, 42, 44, 46, 48, 50, 51.6, 53.2, 55.2, 56.6, 57.7, 58.5, 59], [38, 42, 46, 48.4, 51, 53.5, 56, 58, 59], [38.4, 44, 51, 55.5, 59]);
				b.loft(torsoRings(36.4, ys, 0.4), {
					seg: b.pick(24, 14, 8),
					capEnd: true,
					weightAt: (p) => torsoWeights(p.y, p.z),
					palAt: (i) => (b.lod < 2 && i > 1 && i % 4 < 2 ? PAL.topB : PAL.topA)
				});
				b.loft(
					[
						{ c: [-0.35, 57.8, 0], f: 3.7, b: 4.1, s: 4.5, w: mix('chest', 'neck', 0.2) },
						{ c: [-0.3, 60, 0], f: 3.1, b: 3.3, s: 3.3, w: mix('chest', 'neck', 0.6) },
						{ c: [-0.3, 59.4, 0], f: 2.6, b: 2.7, s: 2.7, w: mix('chest', 'neck', 0.5), shade: 0.7 }
					],
					{ seg: b.pick(18, 10, 6), pal: PAL.topB }
				);
				for (const s of SIDES) buildSleeve(b, s, 20.6, { sleeve: PAL.topA, cuff: PAL.topB });
			}
		}
	},
	sample_shorts: {
		slot: 'bottom',
		name: 'Sample shorts',
		mesh: {
			// No `hides`: the bare shins show below the hem.
			colors: [0x2c5f8a, 0xf4f1e8, 0x1c3a55, 0xf4f1e8],
			build(b) {
				buildSeat(b);
				for (const s of SIDES) buildLeg(b, s, 23.5);
			}
		}
	},
	sample_boots: {
		slot: 'shoes',
		name: 'Sample boots',
		mesh: {
			colors: [0x7a4b22, 0x1e1a16, 0x9a6a34, 0x3c2a18],
			build(b) {
				for (const s of SIDES) {
					const z0 = BIND[`foot${s}`][2];
					b.loft(
						[
							{ c: [-4.2, 2.2, z0], f: 1.9, s: 1.8, w: bone(`foot${s}`) },
							{ c: [-2, 2.8, z0], f: 2.6, s: 2.6, w: bone(`foot${s}`) },
							{ c: [1.5, 2.6, z0], f: 2.3, s: 2.6, w: bone(`foot${s}`) },
							{ c: [5, 1.9, z0], f: 1.7, s: 2.8, w: mix(`foot${s}`, `toe${s}`, 0.8) },
							{ c: [8, 1.5, z0], f: 1.1, s: 1.6, w: bone(`toe${s}`) }
						],
						{ seg: b.pick(12, 8, 6), u: [0, 1, 0], v: [0, 0, 1], pal: PAL.shoesA, capStart: true, capEnd: true, palAt: (_i, a) => (Math.cos(a) < -0.75 ? PAL.shoesB : PAL.shoesA) }
					);
					const shin = bone(`shin${s}`);
					b.loft(
						[
							{ c: [-1, 3, z0], f: 2.7, s: 2.5, w: bone(`foot${s}`) },
							{ c: [-0.7, 6, z0], f: 3.1, s: 2.8, w: mix(`foot${s}`, `shin${s}`, 0.6) },
							{ c: [-0.4, 9.5, z0], f: 3.1, s: 2.9, w: shin },
							{ c: [-0.6, 10.5, z0], f: 3.1, s: 3.0, w: shin, pal: PAL.shoesC },
							{ c: [-0.6, 11, z0], f: 2.4, s: 2.3, w: shin, pal: PAL.shoesD }
						],
						{ seg: b.pick(12, 8, 6), pal: PAL.shoesA }
					);
				}
			}
		}
	}
};

export const SAMPLE_IDS = Object.freeze({ hat: 'sample_cap', glasses: 'sample_shades', top: 'sample_longsleeve', bottom: 'sample_shorts', shoes: 'sample_boots' });

/** Register one sample item per slot (idempotent). */
export function registerSamples(): void {
	for (const [id, s] of Object.entries(SAMPLES)) {
		if (!getCosmetic(id)) registerCosmetic({ id, slot: s.slot, name: s.name });
		if (!itemMesh(id)) registerItemMesh(id, s.mesh);
	}
}
