/** Propeller cap: a beanie of eight bright panels with a small brim and a twisted propeller on a coil spring. */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, type PartBuilder, type Ring } from '../mesh-kit.js';
import { HEAD, hatRing } from '../shop-items.js';

const RED = PAL.hatA;
const YELLOW = PAL.hatB;
const BLUE = PAL.hatC;
const GREEN = PAL.hatD;
const PANELS = [RED, YELLOW, BLUE, GREEN];

/** Wound along a direction: rings of [distance, half chord, half thickness, twist]. */
function blade(b: PartBuilder, o: THREE.Vector3, dir: THREE.Vector3, up: THREE.Vector3, rows: readonly (readonly [number, number, number, number])[], pal: number, tip: number): void {
	const t = dir.clone().cross(up);
	b.loft(
		rows.map((_, i): Ring => ({ c: [0, i, 0], f: 1, s: 1, w: HEAD, pal: i >= rows.length - 3 && rows.length > 3 ? tip : pal })),
		{
			seg: b.pick(8, 6, 4),
			pal: tip,
			capStart: true,
			capEnd: true,
			deform: (p, _t, a, i) => {
				const [r, chord, thick, th] = rows[i]!;
				const e1 = t.clone().multiplyScalar(Math.cos(th)).addScaledVector(up, Math.sin(th));
				const e2 = up.clone().multiplyScalar(Math.cos(th)).addScaledVector(t, -Math.sin(th));
				p.copy(o).addScaledVector(dir, r).addScaledVector(e1, Math.cos(a) * chord).addScaledVector(e2, Math.sin(a) * thick);
			}
		}
	);
}

registerItemMesh('hat_propeller', {
	hides: ['hair'],
	colors: [0xe2352f, 0xf7c426, 0x2468d8, 0x27a85a],
	build(b) {
		b.socket('hat', () => {
			const seg = b.pick(32, 16, 8);
			const rings = b.pick(
				[hatRing(-0.9, 5.45, 5.8, 5.05), hatRing(0.2, 5.6, 5.95, 5.25), hatRing(1.5, 5.4, 5.75, 5.05), hatRing(2.8, 4.65, 5, 4.35), hatRing(3.8, 3.4, 3.7, 3.15), hatRing(4.45, 1.9, 2.1, 1.75), hatRing(4.7, 0.5, 0.6, 0.5)],
				[hatRing(-0.9, 5.45, 5.8, 5.05), hatRing(0.8, 5.55, 5.9, 5.2), hatRing(2.8, 4.65, 5, 4.35), hatRing(4.1, 2.8, 3, 2.6), hatRing(4.7, 0.5, 0.6, 0.5)],
				[hatRing(-0.9, 5.5, 5.8, 5.1), hatRing(1.2, 5.6, 5.9, 5.2), hatRing(3.4, 4.1, 4.4, 3.8), hatRing(4.7, 0.6, 0.7, 0.6)]
			);
			// Eight puffed panels; one faces forward.
			const turn = b.lod === 2 ? 0 : Math.PI / 8;
			const panel = (a: number) => PANELS[Math.floor(((a + turn) / (Math.PI * 2)) * 8) % 4]!;
			const atSeam = (a: number) => Math.abs(Math.sin((a + turn) * 4)) < 0.01;
			b.loft([{ ...rings[0]!, f: 4.8, b: 5, s: 4.4, shade: 0.5 }, ...rings], {
				seg,
				pal: BLUE,
				capEnd: true,
				palAt: (_i, a) => panel(a),
				deform: (p, _t, a, i) => {
					if (b.lod === 2 || i < 2) return;
					const k = 1 + (atSeam(a) ? -0.025 : 0.022);
					p.x *= k;
					p.z *= k;
				},
				shadeAt: (p, a) => (b.lod < 2 && atSeam(a) ? 0.8 : 1) * lerp(0.9, 1, Math.min(1, Math.max(0, p.y + 0.9)))
			});
			// Rolled band.
			if (b.lod < 2)
				b.loft([hatRing(-1.05, 5.1, 5.4, 4.7, 0.7), hatRing(-1.15, 5.65, 6, 5.25), hatRing(-0.65, 5.85, 6.2, 5.45), hatRing(-0.15, 5.75, 6.1, 5.35), hatRing(-0.05, 5.4, 5.7, 5)], {
					seg: b.pick(28, 14, 8),
					pal: BLUE,
					shadeAt: (_p, a) => (b.lod === 0 && Math.round((a / (Math.PI * 2)) * 28) % 2 ? 0.88 : 1)
				});
			// Short upturned brim with a yellow edge.
			const cols = b.pick(15, 9, 5);
			const brim = (k: number, y: number) =>
				Array.from({ length: cols }, (_, j) => {
					const a = (j / (cols - 1) - 0.5) * 2;
					const c = Math.cos(a);
					return new THREE.Vector3(c * (5.4 + k * 2.9) - k * (1 - c) * 1.6, -0.75 - k * 0.15 + k * k * 0.45 - Math.sin(a) ** 2 * 0.5 * k + y, Math.sin(a) * (5.2 + k * 0.25));
				});
			const ks = b.pick([0, 0.4, 0.78], [0, 0.78], [0, 0.78]);
			b.grid(ks.map((k) => brim(k, 0)), { w: HEAD, pal: RED, flip: true });
			b.grid([brim(0.78, 0.05), brim(0.95, 0.06), brim(1.02, -0.14), brim(0.95, -0.36), brim(0.78, -0.34)], { w: HEAD, pal: YELLOW, flip: true });
			b.grid(ks.map((k) => brim(k, -0.32)), { w: HEAD, pal: RED, shadeAt: () => 0.7 });

			// Button, spring, hub and propeller, tipped a little to one side.
			b.ball([0.1, 4.75, 0], [1.1, 0.55, 1.1], { w: HEAD, pal: RED, seg: b.pick(12, 7, 5), rings: b.pick(5, 4, 3) });
			const up = new THREE.Vector3(0.1, 1, 0.2).normalize();
			const base = new THREE.Vector3(0.1, 5, 0);
			const along = (t: number) => base.clone().addScaledVector(up, t).add(new THREE.Vector3(0.12 * Math.sin(t * 1.2), 0, 0));
			const TOP = 3.1;
			if (b.lod === 0) {
				const n = 30;
				b.loft(
					Array.from({ length: n + 1 }, (_, i): Ring => ({ c: [0, i, 0], f: 1, s: 1, w: HEAD })),
					{
						seg: 4,
						pal: YELLOW,
						deform: (p, t, a) => {
							const h = t * Math.PI * 2 * 4;
							const r = lerp(0.72, 0.45, t) + 0.15 * Math.cos(a);
							p.copy(along(0.15 + t * (TOP - 0.2) - 0.15 * Math.sin(a))).add(new THREE.Vector3(Math.cos(h) * r, 0, -Math.sin(h) * r));
						},
						shadeAt: (_p, a) => (Math.cos(a) < 0 ? 0.6 : 0.95)
					}
				);
			}
			b.loft(
				[0, TOP].map((t): Ring => {
					const c = along(t);
					return { c: [c.x, c.y, c.z], f: b.pick(0.28, 0.5, 0.6), s: b.pick(0.28, 0.5, 0.6), w: HEAD };
				}),
				{ seg: b.pick(6, 5, 4), pal: b.lod === 0 ? BLUE : YELLOW }
			);
			const hub = along(TOP + 0.3);
			b.ball([hub.x, hub.y, hub.z], [0.95, 0.75, 0.95], { w: HEAD, pal: BLUE, seg: b.pick(10, 6, 5), rings: b.pick(6, 4, 3) });
			const yaw = 0.95;
			const dir = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
			dir.addScaledVector(up, -dir.dot(up)).normalize();
			const rows = b.pick(
				[[0.4, 0.35, 0.22, 0.75], [1.4, 0.8, 0.2, 0.62], [2.8, 1.3, 0.18, 0.48], [4.3, 1.5, 0.17, 0.36], [4.7, 1.48, 0.17, 0.33], [5.6, 1.2, 0.15, 0.28], [6.2, 0.6, 0.12, 0.25]] as const,
				[[0.4, 0.4, 0.25, 0.7], [2.8, 1.3, 0.22, 0.48], [4.6, 1.5, 0.2, 0.34], [6.2, 0.7, 0.15, 0.26]] as const,
				[[0.3, 0.6, 0.3, 0.5], [6, 1.3, 0.25, 0.4]] as const
			);
			blade(b, hub, dir, up, rows, RED, YELLOW);
			blade(b, hub, dir.clone().negate(), up, rows, b.lod === 2 ? YELLOW : GREEN, YELLOW);
			if (b.lod === 0) {
				const c = along(TOP + 1);
				b.ball([c.x, c.y, c.z], [0.4, 0.35, 0.4], { w: HEAD, pal: RED, seg: 8, rings: 5 });
			}
		});
	}
});
