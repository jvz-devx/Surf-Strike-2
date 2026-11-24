/** Trapper hat: quilted olive crown with thick fleece trim, a fleece front flap and ear flaps with leather ties. */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, superellipse, type PartBuilder, type Ring } from '../mesh-kit.js';
import { HEAD, SIDES } from '../shop-items.js';
import { sideSign, type V3 } from '../skeleton.js';

const CLOTH = PAL.hatA;
const FLEECE = PAL.hatB;
const DARK = PAL.hatC;
const LEATHER = PAL.hatD;

/** Crown: y, front, back, side radius. */
const CROWN: readonly (readonly number[])[] = [
	[-2.4, 5.0, 5.35, 4.8],
	[-0.4, 5.25, 5.6, 5.0],
	[1.1, 5.4, 5.75, 5.15],
	[2.4, 5.1, 5.4, 4.85],
	[3.5, 4.3, 4.55, 4.1],
	[4.3, 3.0, 3.2, 2.85],
	[4.75, 1.3, 1.4, 1.25]
];
/** Quilting: gores around the crown, and heights of the stitched rings. */
const GORES = 8;
const STITCH = [-0.6, 1.3, 2.9, 4.1, 4.75];

/** Repeatable noise, -1..1. */
const noise = (i: number, j: number): number => {
	const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
	return (n - Math.floor(n)) * 2 - 1;
};
const fromFront = (a: number): number => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));

/** Point on the crown, `off` outside it. Angle 0 is the front. */
function crownAt(a: number, y: number, off: number): THREE.Vector3 {
	const r = sample(CROWN, y);
	const [c, s] = superellipse(a, 2.2);
	return new THREE.Vector3(0.1 + ((c >= 0 ? r[1]! : r[2]!) + off) * c, y, (r[3]! + off) * s);
}

function buildCrown(b: PartBuilder): void {
	const seg = b.pick(GORES * 4, 16, 8);
	// [height, share of a quilted cushion]
	const rows: (readonly [number, number])[] = [];
	if (b.lod === 0)
		for (let i = 0; i < STITCH.length - 1; i++) {
			const y0 = STITCH[i]!;
			const y1 = STITCH[i + 1]!;
			rows.push([y0, 0], [lerp(y0, y1, 0.3), 0.85], [lerp(y0, y1, 0.72), 0.85]);
		}
	else for (const y of b.pick([], [-0.6, 1.1, 2.9, 4.1], [-0.6, 2.2])) rows.push([y, 0.6]);
	rows.push([b.lod === 2 ? 4.3 : 4.75, b.lod === 0 ? 0 : 0.5]);
	const gore = (a: number) => (b.lod === 0 ? Math.abs(Math.sin((a * GORES) / 2)) ** 0.6 : 0.8);
	b.loft(
		rows.map((_, i): Ring => ({ c: [0.1, i, 0], f: 1, s: 1, w: HEAD })),
		{
			seg,
			pal: CLOTH,
			capEnd: true,
			deform: (p, _t, a, i) => void p.copy(crownAt(a, rows[i]![0], 0.34 * rows[i]![1] * gore(a))),
			shadeAt: (_p, a, i) => (b.lod === 0 ? lerp(0.62, 1.06, Math.min(gore(a), rows[i]![1] / 0.85)) : 0.95)
		}
	);
	if (b.lod < 2) b.ball([0.1, 4.8, 0], [0.75, 0.38, 0.75], { w: HEAD, pal: LEATHER, seg: b.pick(10, 6, 5), rings: b.pick(5, 3, 3) });
}

/** Fleece roll around the edge; lower at the back, thin behind the front flap. */
function buildTrim(b: PartBuilder): void {
	const seg = b.pick(40, 16, 8);
	const k = b.pick(6, 5, 4);
	const rows = Array.from({ length: seg }, (_, j) => {
		const a = (j / seg) * Math.PI * 2;
		const t = fromFront(a) / Math.PI;
		const thick = lerp(0.35, 1, smooth(0.16, 0.28, t));
		const cy = -0.25 - 0.5 * smooth(0.25, 0.5, t) - 0.95 * smooth(0.6, 0.95, t);
		return Array.from({ length: k }, (_, i) => {
			const u = (i / k) * Math.PI * 2;
			const lump = b.lod === 0 ? 1 + 0.13 * noise(i, j) : 1;
			return crownAt(a, cy + Math.sin(u) * 1.12 * lump * lerp(0.75, 1, thick), 0.35 + 0.4 * smooth(0.6, 0.85, t) + Math.cos(u) * 0.82 * thick * lump);
		});
	});
	b.grid([...rows, rows[0]!], { w: HEAD, pal: FLEECE, wrap: true, shadeAt: (p, i) => (b.lod === 0 ? 0.96 + 0.11 * noise(i, Math.round(p.y * 5)) : 1) * lerp(0.86, 1.02, smooth(-2.2, 0.2, p.y)) });
}

/** Folded-up front flap: a thick pad of fleece. */
function buildFrontFlap(b: PartBuilder): void {
	const nu = b.pick(13, 7, 4);
	const nv = b.pick(8, 4, 3);
	const at = (i: number, j: number, off: number): THREE.Vector3 => {
		const u = (j / (nu - 1)) * 2 - 1;
		const v = (i / (nv - 1)) * 2 - 1;
		const edge = Math.max(Math.abs(u), Math.abs(v)) === 1;
		const pad = (1 - Math.abs(u) ** 5) * (1 - Math.abs(v) ** 5);
		const top = 3.15 - 0.35 * u * u;
		const y = lerp(-0.75, top, (v + 1) / 2) + (edge ? 0 : 0.1 * noise(i + 7, j));
		// Narrower at the bottom.
		return crownAt(u * lerp(0.72, 0.8, (v + 1) / 2), y, edge ? off - 0.1 : off + 0.35 + 0.65 * Math.sqrt(pad) + (b.lod === 0 ? 0.17 * noise(i, j + 3) : 0));
	};
	const front = Array.from({ length: nv }, (_, i) => Array.from({ length: nu }, (_, j) => at(i, j, 0.25)));
	b.grid(front, { w: HEAD, pal: FLEECE, flip: true, shadeAt: (p, i) => (i === 0 || i === nv - 1 ? 0.78 : 1) * (b.lod === 0 ? 0.97 + 0.11 * noise(Math.round(p.z * 5), i) : 1) });
	if (b.lod > 0) return;
	// Snaps that hold the flap up.
	for (const s of SIDES) {
		const p = crownAt(sideSign(s) * 0.58, 2.35, 1.2);
		b.ball([p.x, p.y, p.z], [0.25, 0.34, 0.34], { w: HEAD, pal: LEATHER, seg: 7, rings: 4 });
	}
}

function buildEarFlaps(b: PartBuilder): void {
	const X0 = -0.6;
	for (const s of SIDES) {
		const z = sideSign(s);
		// Outward distance, size, palette, shade.
		const layers = b.pick<readonly (readonly [number, number, number, number])[]>(
			[[4.55, 0.7, FLEECE, 0.6], [4.6, 0.95, FLEECE, 0.8], [5.0, 1.08, FLEECE, 1], [5.45, 1.06, FLEECE, 1.02], [5.72, 0.94, FLEECE, 1], [5.62, 0.83, DARK, 0.9], [5.74, 0.8, CLOTH, 0.95], [5.95, 0.4, CLOTH, 1.05]],
			[[4.6, 0.9, FLEECE, 0.75], [5.1, 1.08, FLEECE, 1], [5.65, 0.96, FLEECE, 1], [5.7, 0.8, CLOTH, 1]],
			[[4.6, 1, FLEECE, 0.8], [5.5, 1.02, FLEECE, 1], [5.7, 0.7, CLOTH, 1]]
		);
		b.loft(
			layers.map(([o, , pal, shade]): Ring => ({ c: [X0, -2.4, z * o], f: 1, s: 1, w: HEAD, pal, shade })),
			{
				seg: b.pick(22, 10, 7),
				u: [0, 1, 0],
				v: [1, 0, 0],
				capEnd: true,
				deform: (p, _t, a, i) => {
					const [o, k, pal] = layers[i]!;
					const [c, n] = superellipse(a, 2.6);
					const lump = b.lod === 0 && pal === FLEECE && i > 0 ? 1 + 0.045 * noise(i, Math.round(a * 4)) : 1;
					const y = -2.4 + c * (c > 0 ? 2.7 : 3.5) * k * lump;
					// A tongue: tapered to the bottom, leaning out a little.
					p.set(X0 + n * 2.65 * k * lump * lerp(0.66, 1, smooth(-6, -1.5, y)), y, z * (o + 0.05 * Math.max(0, -y - 1)));
				}
			}
		);
		if (b.lod === 2) continue;
		// Tie with a knot at the end.
		const tie: V3[] = [[X0, -5.2, z * 5.5], [X0 + 0.1, -6.1, z * 5.75], [X0 + 0.05, -7.0, z * 5.85], [X0, -7.7, z * 5.8]];
		b.loft(tie.map((c): Ring => ({ c, f: 0.22, s: 0.18, w: HEAD })), { seg: b.pick(5, 3, 3), pal: LEATHER, capEnd: true });
		b.ball([X0, -7.75, z * 5.8], [0.36, 0.45, 0.36], { w: HEAD, pal: LEATHER, seg: b.pick(7, 5, 4), rings: b.pick(4, 3, 3), shade: 0.9 });
		if (b.lod === 0) b.box([X0, -4.35, z * 6.02], [0.9, 0.75, 0.12], { w: HEAD, pal: LEATHER });
	}
}

registerItemMesh('hat_trapper', {
	hides: ['hair'],
	colors: [0x5d6b3c, 0xeadfc6, 0x39442a, 0x8f5a2e],
	build(b) {
		b.socket('hat', () => {
			buildCrown(b);
			buildTrim(b);
			buildFrontFlap(b);
			buildEarFlaps(b);
		});
	}
});
