/** Astronaut jacket: white padded suit top with a neck ring, chest control panel, hose, orange stripes, ribbed elbows and a flat life-support pack. */
import * as THREE from 'three';
import { alongArm, armSide, armWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { bone, lerp, PAL, sample, smooth, superellipse, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { TORSO_TABLE, torsoWeights } from '../outfit.js';
import { SIDES } from '../shop-items.js';
import type { Side } from '../skeleton.js';

const WHITE = PAL.topA;
const ORANGE = PAL.topB;
const STEEL = PAL.topC;
const GLOW = PAL.topD;

const N = 2.35;
/** Padding over the body by height: rolls at the waist, full chest. */
const PAD: readonly (readonly number[])[] = [
	[36.5, 0.5],
	[38.5, 0.5],
	[38.8, 0.15],
	[40.1, 0.75],
	[41.3, 0.3],
	[42.7, 0.85],
	[43.9, 0.4],
	[46, 0.75],
	[51, 0.8],
	[55, 0.6],
	[56.6, 0.45],
	[57.7, 0.3],
	[58.4, 0.15]
];
const pad = (y: number): number => sample(PAD, y)[1]!;

/** Point on the body; `a` is 0 in front, π/2 at the right. */
function onBody(a: number, y: number, off: number): THREE.Vector3 {
	const r = sample(TORSO_TABLE, y);
	const [c, s] = superellipse(a, N);
	const e = pad(y) + off;
	return new THREE.Vector3((c >= 0 ? r[1]! + e : -r[2]! + e) * c, y, (r[3]! + e) * s);
}

/** Angle of the front point `z` to the side. */
function angleAt(y: number, z: number): number {
	const w = sample(TORSO_TABLE, y)[3]! + pad(y);
	return Math.sign(z) * Math.asin(Math.min(1, (Math.abs(z) / w) ** (N / 2)));
}

/** Tube or strap through points lying on the body. */
function strip(b: PartBuilder, path: readonly THREE.Vector3[], seg: number, wide: number, high: number, pal: number, o: { w?: (p: THREE.Vector3) => Weights; shadeAt?: (i: number) => number } = {}): void {
	const mid = new THREE.Vector3(-0.3, 0, 0);
	b.loft(
		path.map((_, i): Ring => ({ c: [0, i, 0], f: 1, s: 1, w: bone('chest'), shade: o.shadeAt?.(i) ?? 1 })),
		{
			seg,
			pal,
			capStart: true,
			capEnd: true,
			deform: (p, _t, a, i) => {
				const q = path[i]!;
				const dir = path[Math.min(i + 1, path.length - 1)]!.clone().sub(path[Math.max(i - 1, 0)]!).normalize();
				const n = q.clone().sub(mid).setY(q.y > 56 ? (q.y - 55) * 2 : 0).normalize();
				const side = dir.clone().cross(n).normalize();
				const up = side.clone().cross(dir).normalize();
				p.copy(q).addScaledVector(up, Math.cos(a) * high).addScaledVector(side, -Math.sin(a) * wide);
			},
			weightAt: (p) => o.w?.(p) ?? torsoWeights(Math.min(p.y, 57.5), p.z)
		}
	);
}

function buildBody(b: PartBuilder): void {
	const ring = (y: number, d = 0, pal: number = WHITE, shade = 1): Ring => {
		const r = sample(TORSO_TABLE, y);
		const e = pad(y) + d + b.pick(0, 0.15, 0.45);
		return { c: [0, y, 0], f: r[1]! + e, b: -r[2]! + e, s: r[3]! + e, n: N, w: torsoWeights(y), pal, shade };
	};
	const hem = [ring(37.6, -1, STEEL, 0.5), ring(36.5, -0.1, STEEL, 0.8)];
	const rows = b.pick(
		[...hem, ring(36.7, 0.1, STEEL), ring(38.4, 0, STEEL), ring(38.8, 0, WHITE, 0.72), ring(40.1), ring(41.3, 0, WHITE, 0.72), ring(42.7), ring(43.9, 0, WHITE, 0.75), ring(46), ring(49), ring(51.5), ring(53.8), ring(55.6), ring(56.8), ring(57.7), ring(58.4)],
		[hem[1]!, ring(38.5, 0, STEEL), ring(40.1), ring(41.6, 0, WHITE, 0.78), ring(43.5), ring(48), ring(52.5), ring(55.6), ring(57.2), ring(58.4)],
		[hem[1]!, ring(38.6), ring(44), ring(51), ring(55.6), ring(58.2)]
	);
	b.loft(rows, {
		seg: b.pick(16, 10, 8),
		capEnd: true,
		weightAt: (p) => torsoWeights(p.y, p.z),
		palAt: (i, a) => {
			const y = rows[i]!.c[1];
			// Orange piping down the flanks of the belt.
			if (b.lod === 0 && y > 36.6 && y < 38 && Math.abs(Math.sin(a)) > 0.5 && Math.abs(Math.sin(a)) < 0.75) return ORANGE;
			return undefined;
		},
		shadeAt: (p) => lerp(0.9, 1, smooth(37, 44, p.y)) * (Math.abs(p.z) > 6.8 && p.y > 46 && p.y < 54 ? 0.9 : 1)
	});
}

/** Metal ring the helmet locks into; lower in front, so the chin stays clear. */
function buildNeckRing(b: PartBuilder): void {
	const row = (y: number, r: number, pal: number = STEEL, shade = 1): Ring => ({ c: [-0.55, y, 0], f: r - 0.1, b: r + 0.15, s: r + 0.35, w: torsoWeights(58.5), pal, shade });
	b.loft(
		b.pick(
			[row(57.0, 4.35, WHITE, 0.85), row(57.5, 4.1, STEEL, 0.75), row(57.55, 4.5, STEEL), row(58.3, 4.55, ORANGE), row(58.4, 4.35, STEEL, 1.15), row(58.75, 4.1, STEEL, 1.1), row(58.75, 3.4, STEEL, 0.7), row(57.6, 2.7, STEEL, 0.5)],
			[row(57, 4.5, STEEL, 0.85), row(58.3, 4.55, ORANGE), row(58.75, 4.1, STEEL), row(58.5, 2.8, STEEL, 0.6)],
			[row(57.2, 4.6, STEEL), row(58.7, 4.2, STEEL), row(58.6, 2.6, STEEL, 0.6)]
		),
		{ seg: b.pick(16, 8, 6), deform: (p) => void (p.y -= p.x * 0.1) }
	);
}

const SLEEVE: readonly (readonly number[])[] = [
	// t, radius along X, radius sideways
	[-3.6, 1.5, 1.4],
	[-2.6, 2.95, 2.55],
	[-1.2, 3.6, 3.1],
	[0.6, 3.95, 3.45],
	[3, 3.95, 3.5],
	[7.5, 3.65, 3.3],
	[9, 3.4, 3.1],
	[13.2, 3.25, 3.0],
	[15.5, 3.4, 3.1],
	[18.2, 2.6, 2.4],
	[21, 2.4, 2.15]
];
const END = 20.7;

function buildSleeve(b: PartBuilder, s: Side): void {
	const ring = (t: number, pal: number = WHITE, d = 0, shade = 1): Ring => {
		const r = sample(SLEEVE, t);
		return { c: alongArm(s, t), f: r[1]! + d, s: r[2]! + d, w: armWeights(s, t), pal, shade };
	};
	const rows = b.pick(
		[
			...[-3.6, -2.4, -0.8, 1.6].map((t) => ring(t)),
			ring(4, ORANGE),
			ring(5, WHITE),
			ring(5.7, ORANGE),
			ring(6.7, WHITE),
			// Ribbed elbow.
			ring(8.9, STEEL, 0, 0.85),
			...[9.5, 10.15, 10.8, 11.45, 12.1, 12.75, 13.3].map((t, i) => ring(t, i === 6 ? WHITE : STEEL, i % 2 ? 0.12 : -0.35, i === 6 ? 0.8 : i % 2 ? 1.2 : 0.62)),
			ring(13.9),
			ring(15.8),
			ring(18.2, STEEL, 0, 0.85),
			ring(18.3, STEEL, 0.4),
			ring(19.3, ORANGE, 0.4),
			ring(19.4, WHITE, 0.05, 0.85),
			ring(END, STEEL, 0.1, 0.8),
			ring(END, STEEL, -0.5, 0.5)
		],
		[ring(-3.4), ring(-1), ring(4, ORANGE), ring(6.7), ring(9, STEEL), ring(11, STEEL, -0.2), ring(13.4), ring(18.2, STEEL, 0.3), ring(19.4, WHITE, 0.2), ring(END)],
		[ring(-3), ring(2), ring(4, ORANGE), ring(6.9), ring(9, STEEL), ring(13.4), ring(END)]
	);
	b.loft(rows, { seg: b.pick(9, 6, 5), v: armSide(s), capStart: true, capEnd: b.lod > 0, shadeAt: (p) => lerp(0.88, 1, smooth(0, 3, Math.abs(p.z) - 7)) });
}

const CHEST = torsoWeights(50);
/** Middle of the control panel. */
const PY = 50.1;

function buildPanel(b: PartBuilder): void {
	// Leaning back with the chest.
	const at = (x: number, y: number) => x - (PY - y) * 0.09;
	if (b.lod === 2) {
		b.box([6.4, PY, 0], [1.8, 4.6, 6], { w: CHEST, pal: STEEL, shade: 0.7 });
		b.box([7.3, PY + 0.9, 0.9], [0.4, 1.6, 2.6], { w: CHEST, pal: GLOW });
		return;
	}
	b.loft(
		b.pick([[5.2, 2.5, 3.2, 0.7], [7.05, 2.5, 3.2, 0.85], [7.4, 2.25, 2.95, 1], [7.4, 2.05, 2.75, 0.5]], [[5.2, 2.5, 3.2, 0.7], [7.3, 2.4, 3.1, 0.9], [7.35, 2, 2.7, 0.5]], []).map(([x, h, w, shade]): Ring => ({ c: [x!, PY, 0], f: h!, s: w!, n: 7, w: CHEST, shade })),
		{ seg: b.pick(16, 8, 4), u: [0, 1, 0], v: [0, 0, 1], pal: STEEL, capEnd: true, deform: (p) => void (p.x = at(p.x, p.y)) }
	);
	const box = (y: number, z: number, h: number, w: number, pal: number, lift = 0.15, shade = 1) => b.box([at(7.4, y) + lift / 2, y, z], [lift + 0.1, h, w], { w: CHEST, pal, shade });
	// Screen with a trace, lights, buttons, switches, knob.
	box(PY + 0.85, 1.05, 1.7, 2.7, WHITE, 0.2, 0.95);
	box(PY + 0.85, 1.05, 1.25, 2.25, GLOW, 0.3);
	if (b.lod === 1) {
		box(PY - 1.05, 0, 0.8, 4.4, ORANGE);
		return;
	}
	for (let i = 0; i < 2; i++) box(PY + 0.6 + i * 0.5, 0.85 + i * 0.3, 0.2, 1.4, STEEL, 0.36, 0.5);
	for (let i = 0; i < 3; i++) box(PY - 0.75, 0.2 + i * 0.85, 0.5, 0.5, i === 1 ? ORANGE : GLOW, 0.25);
	for (let i = 0; i < 2; i++) box(PY - 1.55, 0.6 + i * 1.2, 0.35, 0.95, WHITE, 0.2);
	for (let i = 0; i < 2; i++) box(PY - 1.15, -2.2 + i * 0.75, 1.1, 0.3, ORANGE, 0.45);
	b.loft(
		[[7.3, 0.85, 0.7], [7.75, 0.8, 1], [7.8, 0.35, 0.8]].map(([x, r, shade]): Ring => ({ c: [x!, PY + 0.85, -1.5], f: r!, s: r!, w: CHEST, shade })),
		{ seg: 8, u: [0, 1, 0], v: [0, 0, 1], pal: WHITE, capEnd: true, deform: (p) => void (p.x = at(p.x, p.y)) }
	);
}

function buildHose(b: PartBuilder): void {
	// From under the panel round the right side to the pack.
	const front = (y: number, z: number, off: number) => onBody(angleAt(y, z), y, off);
	const curve = new THREE.CatmullRomCurve3([front(48.2, 1.7, 0.6), front(46.6, 1.8, 0.95), front(45, 2.8, 1.0), front(44.6, 4.4, 0.85), front(45.6, 5.8, 0.7), onBody(1.15, 47.2, 0.5), onBody(1.6, 48.4, 0.4), onBody(2.1, 49, 0.5), onBody(2.55, 49, 0.8)]);
	const n = b.pick(17, 8, 2);
	if (b.lod === 2) return;
	strip(b, curve.getPoints(n - 1), b.pick(5, 3, 3), 0.62, 0.62, ORANGE, { shadeAt: (i) => (b.lod > 0 || i % 2 ? 1 : 0.6) });
	if (b.lod > 0) return;
	// Coupling under the panel.
	const c = front(47.4, 1.75, 0.7);
	b.box([c.x, c.y, c.z], [1.4, 0.8, 1.6], { w: CHEST, pal: STEEL, shade: 1.1 });
}

function buildHarness(b: PartBuilder): void {
	if (b.lod === 2) return;
	for (const k of [-1, 1]) {
		const f = (y: number, z: number) => onBody(k * angleAt(y, z), y, 0.05);
		const r = (y: number, z: number) => onBody(k * (Math.PI - angleAt(y, z)), y, 0.05);
		const path = b.pick([f(52, 2.5), f(54, 2.9), f(55.4, 3.3), f(56.5, 3.7), f(57.3, 4), f(57.6, 4.6), r(57.4, 4.2), r(56.6, 3.8), r(55.6, 3.4), r(53.8, 3)], [f(52, 2.5), f(55.4, 3.3), f(57.2, 4.1), r(57.2, 4.2), r(54.4, 3)], []);
		strip(b, path, 4, 0.75, 0.22, STEEL, { shadeAt: () => 0.85 });
		if (b.lod === 0) {
			const p = f(54.2, 2.95);
			b.box([p.x + 0.25, p.y, p.z], [0.4, 0.9, 1.9], { w: torsoWeights(54.2, p.z), pal: ORANGE, rot: [0, 0, 0.35] });
		}
	}
}

function buildPack(b: PartBuilder): void {
	const w = CHEST;
	const y0 = 50.6;
	if (b.lod === 2) {
		b.box([-6.8, y0, 0], [2.8, 8.2, 8.6], { w, pal: WHITE });
		b.box([-8.2, y0 + 1.6, 0], [0.4, 1.4, 5], { w, pal: ORANGE });
		return;
	}
	// Oxygen tanks on the sides.
	for (const k of [-1, 1])
		b.loft(
			b.pick([[46.4, 0.6], [47, 1.05], [53.4, 1.05], [54.1, 0.6], [54.2, 0.35], [54.9, 0.35]], [[46.4, 0.8], [54.2, 0.9]], []).map(([y, r], i): Ring => ({ c: [-6.5, y!, k * 4.25], f: r!, s: r!, w, pal: i > 2 ? ORANGE : STEEL })),
			{ seg: b.pick(7, 4, 4), capStart: true, capEnd: true }
		);
	b.loft(
		b.pick([[-4.6, 4.2, 3.7, 0.8], [-7.6, 4.2, 3.7, 1], [-8.05, 3.8, 3.3, 1]], [[-4.6, 4.2, 3.8, 0.8], [-8, 4, 3.5, 1]], []).map(([x, h, s, shade]): Ring => ({ c: [x!, y0, 0], f: h!, s: s!, n: 6, w, shade })),
		{ seg: b.pick(16, 8, 4), u: [0, 1, 0], v: [0, 0, 1], pal: WHITE, capStart: false, capEnd: true }
	);
	// Stripe, vent and status lights.
	b.box([-8.05, y0 + 1.9, 0], [0.25, 1.1, 6], { w, pal: ORANGE });
	if (b.lod === 1) return;
	b.box([-8.05, y0 - 1.5, 0], [0.2, 2.8, 4.4], { w, pal: STEEL, shade: 0.6 });
	for (let i = 0; i < 3; i++) b.box([-8.18, y0 - 0.6 - i * 0.9, 0], [0.2, 0.35, 3.8], { w, pal: STEEL, shade: 1.1 });
	for (const k of [-1, 1]) b.box([-8.1, y0 + 3.15, k * 1.9], [0.25, 0.45, 0.9], { w, pal: GLOW });
}

registerItemMesh('top_astronaut', {
	hides: ['upperArms', 'forearms'],
	colors: [0xeef1f4, 0xf2682a, 0x6f7987, 0x4be3ff],
	glow: [0, 0.1, 0, 0.85],
	build(b) {
		buildBody(b);
		buildNeckRing(b);
		for (const s of SIDES) buildSleeve(b, s);
		buildPanel(b);
		buildHose(b);
		buildHarness(b);
		buildPack(b);
	}
});
