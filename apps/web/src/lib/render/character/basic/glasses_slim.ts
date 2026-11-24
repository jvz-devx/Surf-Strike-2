/** Slim shades: narrow rectangular black frames with one flat tint. */
import type * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { PAL, type Ring } from '../mesh-kit.js';
import { HEAD, SIDES } from '../shop-items.js';
import { sideSign } from '../skeleton.js';

registerItemMesh('glasses_slim', {
	colors: [0x17181c, 0x3f78ad, 0x17181c, 0x17181c],
	build(b) {
		b.socket('glasses', () => {
			for (const s of SIDES) {
				const k = sideSign(s);
				// Follows the face.
				const deform = (p: THREE.Vector3) => {
					p.x -= (Math.abs(p.z) - 1) * 0.34;
				};
				const ring = (x: number, h: number, w: number, pal: number, shade = 1): Ring => ({ c: [x, 0, k * 2.05], f: h, s: w, n: 7, w: HEAD, pal, shade });
				b.loft(
					b.lod === 2
						? [ring(0.2, 0.86, 1.74, PAL.glassesA), ring(0.62, 0.86, 1.74, PAL.glassesA), ring(0.64, 0.62, 1.48, PAL.glassesB)]
						: [ring(0.2, 0.86, 1.74, PAL.glassesA), ring(0.62, 0.86, 1.74, PAL.glassesA), ring(0.66, 0.62, 1.48, PAL.glassesA, 0.8), ring(0.54, 0.6, 1.46, PAL.glassesB, 0.9), ring(0.56, 0.3, 1.1, PAL.glassesB)],
					{ seg: b.pick(24, 12, 8), u: [0, 1, 0], v: [0, 0, 1], capStart: true, capEnd: true, deform }
				);
				// Temple.
				b.box([-3, 0.35, k * 3.92], [5.4, 0.42, 0.26], { w: HEAD, pal: PAL.glassesA, rot: [0, k * 0.11, 0] });
			}
			// Bridge.
			b.box([0.6, 0.28, 0], [0.28, 0.32, 1.1], { w: HEAD, pal: PAL.glassesA });
		});
	}
});
