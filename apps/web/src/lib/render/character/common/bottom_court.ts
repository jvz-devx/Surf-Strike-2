/** Court shorts: knee-length basketball-style shorts with cream side panels, piping and a drawstring. */
import * as THREE from 'three';
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, type PartBuilder, type Ring } from '../mesh-kit.js';
import { buildSeat } from '../outfit.js';
import { drawstring, SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

const MAIN = PAL.bottomA;
const PANEL = PAL.bottomB;
const PIPE = PAL.bottomC;
const DEEP = PAL.bottomD;

/** Leg: bind y, front, back, outwards, inwards. Wide at the hem. */
const LEG: readonly (readonly number[])[] = [
	[20.2, 5.2, 5.4, 5.3, 3.95],
	[24, 5.0, 5.3, 5.05, 4.05],
	[28, 4.9, 5.2, 4.8, 4.15],
	[31, 4.9, 5.15, 4.5, 4.3],
	[34, 4.95, 5.3, 4.35, 4.3],
	[35.8, 4.5, 5.0, 3.5, 3.5],
	[37, 3.2, 3.6, 2.2, 2.2]
];
const HEM = 20.4;
const X = -0.2;

function buildLegOf(b: PartBuilder, s: Side): void {
	const z0 = BIND[`thigh${s}`][2];
	const out = sideSign(s);
	const seg = b.pick(28, 10, 6);
	const at = (y: number, a: number, d = 0): THREE.Vector3 => {
		const r = sample(LEG, y);
		const n = 2 / 2.3;
		const c = Math.cos(a);
		const k = Math.sin(a);
		const ca = Math.sign(c) * Math.abs(c) ** n;
		const sa = Math.sign(k) * Math.abs(k) ** n;
		const p = new THREE.Vector3((ca > 0 ? r[1]! : r[2]!) * ca, y, (sa * out > 0 ? r[3]! : r[4]!) * sa);
		// Folds falling to the hem.
		const fold = b.lod === 0 ? 0.035 * (1 - smooth(21, 30, y)) * Math.sin(a * 5 + out) : 0;
		const l = Math.hypot(p.x, p.z);
		p.multiplyScalar(1 + fold + d / l);
		return p.set(p.x + X, y, p.z + z0);
	};
	// The side is cut a little higher.
	const side = (a: number) => Math.max(0, Math.sin(a) * out);
	const cut = (p: THREE.Vector3, a: number) => {
		p.y += 0.9 * side(a) ** 6 * (1 - smooth(20.5, 24, p.y));
	};
	const ys = b.pick([37, 35.8, 34, 31, 28, 25.5, 23.4], [37, 34.8, 31, 27], [36.5, 32]);
	const rows: readonly (readonly [number, number, number?, number?])[] = [
		...ys.map((y) => [y, 0] as const),
		...b.pick([[21.6, 0], [21.6, 0.08, PIPE], [21.2, 0.08], [HEM, 0.06], [HEM, -0.4, DEEP, 0.6], [HEM + 2.5, -1.3, DEEP, 0.4]] as const, [[21.6, 0.05, PIPE], [21.1, 0.05], [HEM, 0.05], [HEM + 2, -1.1, DEEP, 0.4]] as const, [[HEM, 0.1], [HEM + 1.5, -1, DEEP, 0.4]] as const)
	];
	const wide = b.pick(0.62, 0.8, 0.8);
	b.loft(
		rows.map(([y, , pal, shade], i): Ring => ({ c: [X, 100 - i, z0], f: 1, s: 1, w: legWeights(s, y), pal, shade })),
		{
			seg,
			pal: MAIN,
			capStart: true,
			deform: (p, _t, a, i) => {
				const [y, d] = rows[i]!;
				p.copy(at(y, a, d));
				cut(p, a);
			},
			palAt: (i, a) => rows[i]![2] ?? (Math.sin(a) * out > wide && rows[i]![0] < 35 ? PANEL : MAIN),
			shadeAt: (p) => lerp(0.76, 1, smooth(0, 3, Math.abs(p.z) + Math.max(0, p.y - 28) * 0.35)) * lerp(0.92, 1, smooth(20, 25, p.y))
		}
	);
	if (b.lod > 0) return;
	// Piping along both edges of the panel.
	const first = Array.from({ length: seg }, (_, j) => j).find((j) => Math.sin(((j + 0.5) / seg) * Math.PI * 2) > wide)!;
	const step = (Math.PI * 2) / seg;
	for (const e of [first, seg / 2 - first]) {
		const a = out * e * step;
		const path = [34.4, 31, 28, 25.5, 23.4, 21.5].map((y) => {
			const p = at(y, a, 0.02);
			cut(p, a);
			return p;
		});
		b.loft(path.map((p): Ring => ({ c: [p.x, p.y, p.z], f: 0.2, s: 0.2, w: legWeights(s, p.y) })), { seg: 5, pal: PIPE, capStart: true, capEnd: true });
	}
	// Slit at the bottom of the panel.
	const slit = [23.2, 21.2].map((y) => at(y, out * Math.PI * 0.5, 0.03));
	b.grid([slit.map((p) => p.clone().setX(p.x - 0.12)), slit.map((p) => p.clone().setX(p.x + 0.12))], { w: legWeights(s, 22), pal: PIPE, flip: out > 0 });
}

registerItemMesh('bottom_court', {
	// No `hides`: the bare shins show below the hem.
	colors: [0x1f7a5a, 0xf4eee0, 0x14303a, 0x176049],
	build(b) {
		buildSeat(b, { seat: MAIN, belt: DEEP, buckle: DEEP });
		for (const s of SIDES) buildLegOf(b, s);
		drawstring(b, PANEL);
	}
});
