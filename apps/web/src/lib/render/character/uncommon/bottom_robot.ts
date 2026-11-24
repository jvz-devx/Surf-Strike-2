/** Robot legs: steel armour plates over a dark under-layer, bare knee joints with a glowing ring, pistons and bolts. */
import * as THREE from 'three';
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { bone, lerp, mix, PAL, sample, smooth, superellipse, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { SIDES } from '../shop-items.js';
import { BIND, KNEE_Y, sideSign, type Side } from '../skeleton.js';

const STEEL = PAL.bottomA;
const UNDER = PAL.bottomB;
const ACCENT = PAL.bottomC;
const GLOW = PAL.bottomD;

/** Under-layer of a leg: bind y, front, back, sideways. Thin at the knee; room for boot shafts below. */
const LEG: readonly (readonly number[])[] = [
	[2.6, 3.1, 3.3, 2.95],
	[5, 3.05, 3.3, 2.95],
	[10, 3.05, 3.4, 2.95],
	[13.5, 3.0, 3.5, 2.95],
	[16, 2.85, 3.1, 2.8],
	[18, 2.75, 2.8, 2.55],
	[21.5, 2.8, 2.85, 2.6],
	[23.5, 3.2, 3.3, 3.05],
	[27, 3.95, 4.05, 3.65],
	[31, 4.45, 4.65, 4.05],
	[34, 4.6, 4.95, 4.1],
	[35.4, 4.2, 4.5, 3.5],
	[36.4, 3.0, 3.4, 2.2]
];
const HEM = 2.8;
const LEG_X = -0.2;
/** Seat: y, front, back, sideways, exponent. */
const SEAT: readonly (readonly number[])[] = [
	[30.6, 1.6, 2.2, 2, 2.2],
	[31.8, 3.3, 4.1, 5.2, 2.6],
	[33, 4.3, 4.95, 7.8, 2.8],
	[34.4, 4.95, 5.3, 8.1, 2.7],
	[35.6, 4.85, 5.3, 7.8, 2.5],
	[37, 4.75, 5.1, 7.5, 2.4],
	[38.6, 4.0, 4.4, 6.6, 2.3]
];

function seatWeights(y: number, z: number): Weights {
	if (y > 35.5) return mix('pelvis', 'spine', smooth(36.5, 39, y) * 0.3);
	return mix('pelvis', z > 0 ? 'thighHR' : 'thighHL', smooth(1, 6, Math.abs(z)) * lerp(0.75, 0.3, smooth(33, 35.4, y)));
}

/** Point on a leg: angle 0 in front, π/2 outside, whichever leg. */
function onLeg(s: Side, a: number, y: number, off: number): THREE.Vector3 {
	const r = sample(LEG, y);
	const [c, k] = superellipse(a, lerp(2.15, 2.5, smooth(26, 30, y)));
	return new THREE.Vector3(LEG_X + (c >= 0 ? r[1]! + off : r[2]! + off) * c, y, BIND[`thigh${s}`][2] + sideSign(s) * (r[3]! + off) * k);
}
function onSeat(a: number, y: number, off: number): THREE.Vector3 {
	const r = sample(SEAT, y);
	const [c, k] = superellipse(a, r[4]!);
	return new THREE.Vector3(LEG_X + (c >= 0 ? r[1]! + off : r[2]! + off) * c, y, (r[3]! + off) * k);
}

/** Cross-section row of a plate, from the bottom up: y, first and last angle, height above the under-layer, crease in the middle. */
type Row = readonly [number, number, number, number, number?];

/** Curved armour plate. `turn`: +1 when angles grow from +X to +Z. */
function plate(b: PartBuilder, rows: readonly Row[], cols: number, on: (a: number, y: number, off: number) => THREE.Vector3, w: (p: THREE.Vector3) => Weights, turn: number, pal: number, shade = 1): void {
	const n = cols + 3;
	b.loft(
		rows.map((r): Ring => ({ c: [0, r[0], 0], f: 1, s: 1, w: bone('pelvis'), shade })),
		{
			seg: n,
			pal,
			v: [0, 0, turn],
			capStart: true,
			capEnd: true,
			deform: (p, _t, a, i) => {
				const [y, a0, a1, off, crease = 0] = rows[i]!;
				const j = Math.round((a / (Math.PI * 2)) * n) % n;
				// Outer arc, then back along the inside.
				if (j <= cols) {
					const t = j / cols;
					const edge = j === 0 || j === cols ? -0.18 : 0;
					p.copy(on(lerp(a0, a1, t), y, off + edge + crease * (1 - Math.abs(t - 0.5) * 2)));
				} else p.copy(on(j === cols + 1 ? a1 : a0, y, -0.5));
			},
			weightAt: (p) => w(p)
		}
	);
}

/** Round part turned about an axis along Z: [z, radius, palette, shade]. */
function hub(b: PartBuilder, x: number, y: number, z0: number, dir: number, rows: readonly (readonly [number, number, number, number?])[], seg: number, w: Weights): void {
	b.loft(
		rows.map(([z, r, pal, shade]): Ring => ({ c: [x, y, z0 + dir * z], f: r, s: r, w, pal, shade: shade ?? 1 })),
		{ seg, u: [1, 0, 0], v: [0, 1, 0], capEnd: true }
	);
}

function rod(b: PartBuilder, pts: readonly { p: THREE.Vector3; r: number; w: Weights; pal: number }[], seg: number): void {
	b.loft(
		pts.map((q): Ring => ({ c: [q.p.x, q.p.y, q.p.z], f: q.r, s: q.r, w: q.w, pal: q.pal })),
		{ seg, capStart: true, capEnd: true }
	);
}

function buildLegOf(b: PartBuilder, s: Side): void {
	const side = sideSign(s);
	const z0 = BIND[`thigh${s}`][2];
	const ring = (y: number, d = 0, pal: number = UNDER, shade = 1): Ring => {
		const r = sample(LEG, y);
		return { c: [LEG_X, y, z0], f: r[1]! + d, b: r[2]! + d, s: r[3]! + d, n: lerp(2.15, 2.5, smooth(26, 30, y)), w: legWeights(s, y), pal, shade };
	};
	const shin = (p: THREE.Vector3) => legWeights(s, Math.min(p.y, 15.7));
	const thigh = (p: THREE.Vector3) => legWeights(s, Math.max(p.y, 23.9));
	if (b.lod === 2) {
		// Far away: bands of steel, dark knee with a glowing ring.
		b.loft([ring(36.2), ring(34), ring(33.4, 0.45, STEEL), ring(24, 0.5, STEEL), ring(23.2, 0, UNDER), ring(16.4, 0, UNDER), ring(15.4, 0.6, STEEL), ring(5.2, 0.3, STEEL), ring(5, 0.4, ACCENT), ring(HEM, 0.45, ACCENT)].map((r, i, l) => ({ ...r, pal: l[Math.min(i + 1, l.length - 1)]!.pal === r.pal ? r.pal : r.c[1] < 24 && r.c[1] > 16 ? UNDER : r.pal })), { seg: 6, capStart: true, capEnd: true });
		const kw = bone(`shinH${s}`);
		b.box([LEG_X + 0.4, KNEE_Y, z0], [5.4, 4.4, 5], { w: kw, pal: STEEL });
		b.box([LEG_X + 0.2, KNEE_Y, z0 + side * 2.5], [2.6, 2.6, 0.9], { w: kw, pal: GLOW });
		return;
	}
	// Under-layer: rubber with ribs round the knee.
	const ys = b.pick([36.2, 34, 29, 23.8, 22.9, 22.1, 17.6, 16.8, 16, 8], [36.2, 33, 23.6, 20.5, 17, 9], []);
	const rib = (y: number) => b.lod === 0 && [22.9, 16.8].includes(y);
	b.loft([...ys.map((y) => ring(y, rib(y) ? -0.22 : 0, UNDER, rib(y) ? 0.7 : 1)), ring(HEM), ...(b.lod === 0 ? [ring(HEM, -0.35, UNDER, 0.6), ring(HEM + 1.3, -0.6, UNDER, 0.4)] : [])], { seg: b.pick(9, 6, 5), capStart: true, weightAt: (p, i) => (i < ys.length ? legWeights(s, p.y) : legWeights(s, HEM)) });

	const on = (a: number, y: number, off: number) => onLeg(s, a, y, off);
	const put = (rows: readonly Row[], cols: number, w: (p: THREE.Vector3) => Weights, pal: number, shade = 1) => plate(b, rows, cols, on, w, side, pal, shade);
	if (b.lod === 0) {
		// Thigh: pointed front plate, outer plate, back plate.
		put([[23.5, -0.35, 0.35, 0.6, 0.2], [25, -0.78, 0.78, 0.55, 0.4], [31.4, -0.85, 0.85, 0.4, 0.25], [32.8, -0.45, 0.55, 0.3, 0.1]], 4, thigh, STEEL, 1.05);
		put([[24.5, 1.15, 1.8, 0.4], [26.4, 0.98, 2.1, 0.55], [30, 1.15, 1.95, 0.45]], 2, thigh, STEEL, 0.9);
		put([[24.2, 2.6, 3.7, 0.5], [31.5, 2.4, 3.9, 0.45]], 3, thigh, STEEL, 0.86);
		// Shin guard with a ridge, calf plates either side of a slot for the pistons.
		put([[HEM + 0.4, -0.8, 0.8, 0.35, 0.15], [6, -0.75, 0.75, 0.45, 0.35], [12.6, -1.0, 1.0, 0.7, 0.5], [14.8, -0.7, 0.7, 0.9, 0.45], [16.6, -0.28, 0.28, 0.95, 0.2]], 4, shin, STEEL, 1.05);
		put([[6.2, 1.1, 2.1, 0.4], [8.5, 1.0, 2.5, 0.5], [13, 1.2, 2.65, 0.7], [15, 1.5, 2.4, 0.6]], 2, shin, STEEL, 0.92);
		put([[6.2, -2.1, -1.1, 0.4], [8.5, -2.5, -1.0, 0.45], [13, -2.65, -1.2, 0.55], [15, -2.4, -1.5, 0.5]], 2, shin, STEEL, 0.88);
		// Orange warning stripe on the thigh and the shin.
		put([[29.2, -0.7, 0.7, 0.62, 0.34], [30.4, -0.7, 0.7, 0.6, 0.32]], 4, thigh, ACCENT);
		put([[7.2, -0.3, 0.3, 0.9, 0.12], [10.2, -0.42, 0.42, 1.05, 0.15]], 2, shin, ACCENT);
	} else {
		put([[23.6, -0.4, 0.4, 0.8], [25.4, -0.9, 0.9, 0.85], [32.4, -0.8, 0.8, 0.7]], 2, thigh, STEEL, 1.05);
		put([[24.2, 2.3, 3.98, 0.7], [31.5, 2.3, 3.98, 0.6]], 2, thigh, STEEL, 0.88);
		put([[HEM + 0.4, -0.85, 0.85, 0.6], [13, -1.0, 1.0, 1.1], [16.4, -0.4, 0.4, 1.1]], 2, shin, STEEL, 1.05);
		put([[6, 1.25, 2.5, 0.6], [14.6, 1.3, 2.6, 0.7]], 1, shin, STEEL, 0.92);
		put([[6, -2.5, -1.25, 0.6], [14.6, -2.6, -1.3, 0.7]], 1, shin, STEEL, 0.9);
	}
	// Hem ring.
	b.loft(b.pick([ring(HEM + 0.9, 0, ACCENT, 0.9), ring(HEM + 0.7, 0.36, ACCENT), ring(HEM - 0.05, 0.3, ACCENT)], [ring(HEM + 0.8, 0.3, ACCENT), ring(HEM, 0.36, ACCENT)], []), { seg: b.pick(11, 6, 5) });

	// Knee joint: a drum across the leg, glowing ring on both ends.
	const kw = bone(`shinH${s}`);
	const kx = LEG_X + 0.25;
	hub(
		b,
		kx,
		KNEE_Y,
		z0,
		side,
		b.pick(
			[[0, 2.25, STEEL, 0.8], [2.6, 2.25, STEEL, 0.9], [3.05, 2.0, STEEL], [3.05, 1.65, UNDER], [2.85, 1.6, GLOW], [2.95, 1.0, GLOW], [2.95, 0.9, STEEL], [3.35, 0.75, STEEL]],
			[[0, 2.25, STEEL, 0.85], [2.9, 2.15, STEEL], [3.05, 1.8, GLOW], [3.15, 0.7, STEEL]],
			[]
		),
		b.pick(10, 6, 5),
		kw
	);
	// The inner end is flat: the other knee is close.
	if (b.lod === 0) hub(b, kx, KNEE_Y, z0, -side, [[0, 2.25, STEEL, 0.8], [2.65, 2.1, STEEL, 0.9], [2.7, 1.6, GLOW], [2.7, 0.9, STEEL]], 9, kw);
	// Knee cap: a bent plate in front of the drum.
	const cap = (rows: readonly (readonly [number, number, number])[]) =>
		b.loft(
			rows.map(([y, x, half]): Ring => ({ c: [x, y, z0], f: 0.35, b: 0.8, s: half, n: 3, w: kw })),
			{ seg: b.pick(7, 4, 4), pal: STEEL, capStart: true, capEnd: true, shadeAt: () => 1.08 }
		);
	cap(b.pick([[17.7, 2.35, 0.8], [18.5, 2.85, 1.55], [21.2, 2.9, 1.6], [22.1, 2.4, 0.7]], [[17.8, 2.6, 1.2], [19.8, 3.1, 1.7], [22, 2.6, 1.1]], []));
	if (b.lod === 1) return;
	// Pistons behind the knee, from the thigh to the calf: sleeve and rod.
	for (const a of [2.5, 3.78]) {
		const top = onLeg(s, a, 25, 0.15);
		const low = onLeg(s, a, 13.6, 0.35);
		const tw = legWeights(s, 24);
		const lw = legWeights(s, 15.6);
		const at = (t: number): THREE.Vector3 => top.clone().lerp(low, t);
		const w = (t: number): Weights => [[`thigh${s}`, 1 - t], [`shin${s}`, t]];
		rod(b, [{ p: at(0), r: 0.62, w: tw, pal: UNDER }, { p: at(0.48), r: 0.62, w: w(0.48), pal: UNDER }, { p: at(0.48), r: 0.34, w: w(0.48), pal: STEEL }, { p: at(1), r: 0.34, w: lw, pal: STEEL }], 4);
	}
	// Bolts.
	const bolt = (a: number, y: number, off: number, w: Weights) => {
		const p = onLeg(s, a, y, off);
		b.ball([p.x, p.y, p.z], [0.27, 0.27, 0.27], { w, pal: UNDER, seg: 4, rings: 2 });
	};
	for (const a of [-0.58, 0.58]) bolt(a, 13.2, 0.78, legWeights(s, 13.2));
	bolt(1.5, 28.4, 0.55, legWeights(s, 28.4));
	bolt(1.9, 13.2, 0.6, legWeights(s, 13.2));
}

function buildHips(b: PartBuilder): void {
	const rows = b.pick(SEAT, SEAT.filter((_, i) => i !== 1), SEAT.filter((_, i) => i % 2 === 0));
	b.loft(
		rows.map(([y, f, back, s, n]): Ring => ({ c: [LEG_X, y!, 0], f: f!, b: back!, s: s!, n, w: bone('pelvis') })),
		{ seg: b.pick(16, 8, 6), pal: UNDER, capStart: true, capEnd: true, weightAt: (p) => seatWeights(p.y, p.z) }
	);
	// Belt: steel band with a glowing core in front.
	const at = (y: number, d: number, shade = 1): Ring => {
		const q = sample(SEAT, y);
		return { c: [LEG_X, y, 0], f: q[1]! + d, b: q[2]! + d, s: q[3]! + d, n: q[4], w: bone('pelvis'), shade };
	};
	b.loft(b.pick([at(35.2, -0.2, 0.7), at(35.35, 0.3), at(36.7, 0.28), at(36.85, -0.25, 0.8)], [at(35.35, 0.3), at(36.7, 0.3)], [at(35.35, 0.3), at(36.7, 0.3)]), {
		seg: b.pick(16, 9, 6),
		pal: STEEL,
		weightAt: (p) => seatWeights(Math.max(p.y, 35.6), p.z),
		palAt: (i, a) => (b.lod === 0 && i === 1 && Math.abs(Math.sin(a)) > 0.8 && Math.abs(Math.sin(a)) < 0.9 ? ACCENT : STEEL)
	});
	if (b.lod === 2) return;
	const w = bone('pelvis');
	// Buckle core.
	const core = (rows: readonly (readonly [number, number, number])[]) =>
		b.loft(
			rows.map(([x, r, pal]): Ring => ({ c: [x, 35.9, 0], f: r, s: r, w, pal })),
			{ seg: b.pick(8, 6, 4), u: [0, 1, 0], v: [0, 0, 1], capEnd: true }
		);
	core(b.pick([[4.4, 1.25, STEEL], [5.15, 1.15, STEEL], [5.15, 0.85, UNDER], [5.0, 0.8, GLOW], [5.2, 0.5, GLOW]], [[4.5, 1.2, STEEL], [5.2, 1.0, GLOW], [5.2, 0.6, GLOW]], []));
	// Steel crotch and rear plates.
	const seat = (rowsOf: readonly Row[], cols: number, shade: number) => plate(b, rowsOf, cols, onSeat, (p) => seatWeights(p.y, p.z), 1, STEEL, shade);
	if (b.lod === 1) return;
	seat([[31.8, -0.3, 0.3, 0.35], [33, -0.34, 0.34, 0.35], [34.9, -0.5, 0.5, 0.25]], 4, 0.92);
	seat([[33.1, 2.6, 3.68, 0.35], [35, 2.5, 3.78, 0.25]], 4, 0.88);
	// Hip drives on the outside.
	for (const s of SIDES)
		hub(
			b,
			-0.2,
			32.4,
			sideSign(s) * 8.0,
			sideSign(s),
			[[-0.6, 1.9, STEEL, 0.8], [0.45, 1.75, STEEL], [0.45, 1.35, UNDER], [0.3, 0.75, ACCENT], [0.75, 0.6, ACCENT]],
			10,
			mix('pelvis', `thigh${s}`, 0.85)
		);
}

registerItemMesh('bottom_robot', {
	hides: ['shins'],
	colors: [0xaab4c0, 0x25282e, 0xf08a24, 0x35d8ff],
	glow: [0, 0, 0, 0.8],
	build(b) {
		buildHips(b);
		for (const s of SIDES) buildLegOf(b, s);
	}
});
