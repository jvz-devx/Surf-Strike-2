/** Cloth, weights and sewing shared by the pieces of the grey suit. */
import * as THREE from 'three';
import { lerp, smooth, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { torsoWeights } from '../outfit.js';

/** Worsted wool: mid grey, charcoal where the shade darkens it. */
export const WOOL = 0x737780;
export const CHARCOAL = 0x24262b;
export const SILVER = 0xd4d8de;

/** Jacket weights: the skirt follows the thighs like the trousers below it. */
export function skirtWeights(p: THREE.Vector3): Weights {
	if (p.y >= 38.5) return torsoWeights(p.y, p.z);
	const s = p.z > 0 ? 'R' : 'L';
	const k = smooth(0.6, 4.6, Math.abs(p.z)) * (1 - smooth(33.5, 38.5, p.y));
	const thigh = 1 - smooth(29, 36, p.y);
	const body = smooth(36, 43, p.y);
	return [
		['pelvis', (1 - body) * (1 - k)],
		['spine', body * (1 - k)],
		[`thighH${s}`, k * (1 - thigh)],
		[`thigh${s}`, k * thigh]
	];
}

/**
 * Closed sheet: `rows` of equally many points around its cross-section, the
 * outside first and the hidden underside last. `flip` turns it inside out
 * (for mirrored rows).
 */
export function sheet(
	b: PartBuilder,
	rows: readonly (readonly THREE.Vector3[])[],
	o: { pal: number; flip?: boolean; weightAt?: (p: THREE.Vector3) => Weights; shadeAt?: (row: number, col: number, p: THREE.Vector3) => number; palAt?: (row: number, col: number) => number | undefined }
): void {
	const seg = rows[0]!.length;
	const col = (a: number) => Math.round((a / (Math.PI * 2)) * seg) % seg;
	b.loft(
		rows.map((_, i): Ring => ({ c: [0, o.flip ? -i : i, 0], f: 1, s: 1, w: [['chest', 1]], pal: o.palAt ? undefined : o.pal })),
		{
			seg,
			pal: o.pal,
			capStart: true,
			capEnd: true,
			deform: (p, _t, a, i) => void p.copy(rows[i]![col(a)]!),
			weightAt: o.weightAt ?? ((p) => torsoWeights(p.y, p.z)),
			shadeAt: o.shadeAt && ((p, a, i) => o.shadeAt!(i, col(a), p)),
			palAt: o.palAt && ((i, a) => o.palAt!(i, Math.floor((a / (Math.PI * 2)) * seg)))
		}
	);
}

/** Soft light on the leg of the trousers. */
export const legShade = (p: THREE.Vector3): number => lerp(0.62, 1, smooth(0, 3.4, Math.abs(p.z) + Math.max(0, p.y - 28) * 0.35)) * lerp(0.82, 1, smooth(3, 9, p.y));
