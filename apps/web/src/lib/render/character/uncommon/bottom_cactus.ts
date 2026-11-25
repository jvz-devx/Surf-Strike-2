/** Cactus pants: deep vertical ribs with rows of spines, pink flowers and a small round arm on the thigh. */
import * as THREE from 'three';
import { legWeights } from '../body.js';
import { registerItemMesh } from '../items.js';
import { bone, lerp, mix, PAL, sample, smooth, superellipse, type PartBuilder, type Ring, type Weights } from '../mesh-kit.js';
import { SIDES } from '../shop-items.js';
import { BIND, sideSign, type Side } from '../skeleton.js';

const GREEN = PAL.bottomA;
const SPINE = PAL.bottomB;
const PINK = PAL.bottomC;
const YELLOW = PAL.bottomD;

const TAU = Math.PI * 2;

/** Leg (groove of the ribs): bind y, front, back, sideways. */
const LEG: readonly (readonly number[])[] = [
	[2.7, 3.35, 4.55, 3.2],
	[5.5, 3.25, 4.3, 3.15],
	[9, 3.25, 3.55, 3.1],
	[14.5, 3.3, 3.75, 3.2],
	[17.5, 3.45, 3.6, 3.25],
	[19.8, 3.7, 3.5, 3.35],
	[22.5, 3.75, 3.75, 3.5],
	[27, 4.15, 4.25, 3.85],
	[31, 4.6, 4.8, 4.15],
	[34, 4.7, 5.05, 4.15],
	[35.4, 4.3, 4.6, 3.6],
	[36.4, 3.0, 3.4, 2.2]
];
const HEM = 2.8;
const RIB = 1.1;
const LEG_X = -0.2;
/** Seat: y, front, back, sideways, exponent. */
const SEAT: readonly (readonly number[])[] = [
	[30.6, 1.6, 2.2, 2, 2.2],
	[31.8, 3.3, 4.1, 5.2, 2.6],
	[33, 4.35, 5.0, 8.0, 2.8],
	[34.4, 5.0, 5.35, 8.3, 2.7],
	[35.6, 4.85, 5.3, 7.9, 2.5],
	[37, 4.75, 5.1, 7.5, 2.4],
	[38.6, 4.0, 4.4, 6.6, 2.3]
];

function seatWeights(y: number, z: number): Weights {
	if (y > 35.5) return mix('pelvis', 'spine', smooth(36.5, 39, y) * 0.3);
	return mix('pelvis', z > 0 ? 'thighHR' : 'thighHL', smooth(1, 6, Math.abs(z)) * lerp(0.75, 0.3, smooth(33, 35.4, y)));
}

/** Height of the ribs: less at the hem, none between the legs and where the seat takes over. */
function ribHeight(s: Side, a: number, y: number): number {
	const inner = smooth(0.35, 0.95, -Math.sin(a) * sideSign(s)) * smooth(24, 30, y);
	return RIB * (1 - inner) * lerp(0.35, 1, smooth(3, 11, y)) * (1 - smooth(33, 35.6, y));
}

function onLeg(s: Side, a: number, y: number, off: number, out = new THREE.Vector3()): THREE.Vector3 {
	const r = sample(LEG, y);
	const [c, k] = superellipse(a, lerp(2.15, 2.5, smooth(26, 30, y)));
	return out.set(LEG_X + (c >= 0 ? r[1]! + off : r[2]! + off) * c, y, BIND[`thigh${s}`][2] + (r[3]! + off) * k);
}

const SPINE_ROWS = [6.6, 10.6, 14.6, 18.6, 22.8, 27];

/** Two spines in a V (one far away) out of a point on a ridge. */
function spines(b: PartBuilder, p: THREE.Vector3, n: THREE.Vector3, w: Weights, size: number): void {
	const up = new THREE.Vector3(0, 1, 0);
	const side = new THREE.Vector3().crossVectors(up, n).normalize();
	const r = b.pick(0.15, 0.24, 0.3) * size;
	for (const k of b.pick([-1, 1], [0], [])) {
		const dir = n.clone().addScaledVector(side, k * 0.55).addScaledVector(up, k * 0.45 + 0.1).normalize();
		const u = side.clone().addScaledVector(dir, -side.dot(dir)).normalize();
		const v = new THREE.Vector3().crossVectors(dir, u);
		const tip = p.clone().addScaledVector(dir, 1.05 * size);
		const ring = [0, 1, 2].map((j) => p.clone().addScaledVector(dir, -0.12).addScaledVector(u, Math.cos((j / 3) * TAU) * r).addScaledVector(v, Math.sin((j / 3) * TAU) * r));
		b.loft([{ c: [0, 0, 0], f: 1, s: 1, w, shade: 0.9 }], {
			seg: 3,
			pal: SPINE,
			capEnd: true,
			// The ring, then the middle of the cap pulled out to the tip.
			deform: (q, _t, a) => void q.copy(ring[Math.round((a / TAU) * 3) % 3]!),
			weightAt: (q) => {
				if (!ring.some((c) => c.distanceToSquared(q) < 1e-8)) q.copy(tip);
				return w;
			}
		});
	}
}

function buildLegOf(b: PartBuilder, s: Side): void {
	const ribs = b.pick(9, 5, 6);
	const seg = b.lod === 2 ? 6 : ribs * 2;
	const ys = b.pick([36.2, 34.2, 31.4, 27.5, 23.8, 21.4, 19.6, 17.6, 14.5, 10, 6], [36.2, 33.5, 29, 23, 19.6, 16, 9], [36.2, 33, 25, 19.8, 12]);
	const all = [...ys, ...b.pick([HEM + 0.4, HEM, HEM, HEM + 1.6], [HEM, HEM + 0.4], [HEM, HEM + 0.4])];
	const hem = ys.length + b.pick(1, 0, 0);
	b.loft(
		all.map((y, i): Ring => ({ c: [0, y, 0], f: 1, s: 1, w: legWeights(s, y), shade: i > hem ? 0.5 : 1 })),
		{
			seg,
			pal: GREEN,
			capStart: true,
			deform: (p, _t, a, i) => {
				const y = all[i]!;
				const ridge = Math.round((a / TAU) * seg) % 2 === 0;
				const h = ribHeight(s, a, y);
				const off = b.lod === 2 ? h * 0.5 : ridge ? h : b.lod === 1 ? h * 0.1 : -0.05;
				onLeg(s, a, y, i > hem ? (i === hem + 1 ? -0.35 : -0.8) : off, p);
			},
			shadeAt: (p, a, i) => {
				const ridge = Math.round((a / TAU) * seg) % 2 === 0;
				const h = ribHeight(s, a, all[i]!) / RIB;
				const between = lerp(0.75, 1, smooth(0, 2.5, Math.abs(p.z) + Math.max(0, p.y - 28) * 0.3));
				return between * (b.lod === 2 ? (ridge ? 1.05 : 0.75) : ridge ? lerp(0.95, 1.1, h) : lerp(0.9, 0.36, h));
			}
		}
	);
	if (b.lod === 2) return;
	for (let k = 0; k < ribs; k++) {
		const a = (k / ribs) * TAU;
		const inward = -Math.sin(a) * sideSign(s);
		SPINE_ROWS.forEach((y0, i) => {
			if (b.lod === 1 && (i + k) % 2) return;
			const y = y0 + (k % 2) * 2.2;
			if (inward > 0.5 && (y > 22 || inward > 0.85)) return;
			const p = onLeg(s, a, y, ribHeight(s, a, y));
			const out = onLeg(s, a, y, ribHeight(s, a, y) + 1).sub(p).normalize();
			spines(b, p, out, legWeights(s, y), 1);
		});
	}
}

function buildHips(b: PartBuilder): void {
	const seg = b.pick(26, 10, 6);
	const table = b.lod === 0 ? SEAT : SEAT.filter((_, i) => i !== 1);
	b.loft(
		table.map(([y, f, back, s, n]): Ring => ({ c: [LEG_X, y!, 0], f: f!, b: back!, s: s!, n, w: bone('pelvis') })),
		{
			seg,
			pal: GREEN,
			capStart: true,
			capEnd: true,
			weightAt: (p) => seatWeights(p.y, p.z),
			// Shallow ribs; deep enough to read, not to show the legs.
			deform:
				b.lod > 0
					? undefined
					: (p, _t, a) => {
							if (Math.round((a / TAU) * seg) % 2) return;
							const k = 1 + 0.06 * smooth(31, 33, p.y) * (1 - smooth(34.4, 35.5, p.y));
							p.x = LEG_X + (p.x - LEG_X) * k;
							p.z *= 1 + (k - 1) * 0.6;
						},
			shadeAt: (p, a) => lerp(0.75, 1, smooth(30.6, 33, p.y)) * (b.lod > 0 ? 0.95 : Math.round((a / TAU) * seg) % 2 ? lerp(0.62, 0.85, smooth(35.4, 36.5, p.y)) : 1.08)
		}
	);
	// Waistband.
	const at = (y: number, d: number, shade: number): Ring => {
		const q = sample(SEAT, y);
		return { c: [LEG_X, y, 0], f: q[1]! + d, b: q[2]! + d, s: q[3]! + d, n: q[4], w: bone('pelvis'), shade };
	};
	b.loft([at(35.6, 0.35, 0.5), at(37.1, 0.36, 0.58), at(37.3, -0.2, 0.4)], { seg: b.pick(14, 8, 6), pal: GREEN, weightAt: (p) => seatWeights(Math.max(p.y, 35.6), p.z) });
}

/** Flower facing `n`: two tiers of pointed petals round a yellow middle. */
function flower(b: PartBuilder, c: THREE.Vector3, n: THREE.Vector3, size: number, w: Weights): void {
	const u = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y);
	if (u.lengthSq() < 0.1) u.set(1, 0, 0).addScaledVector(n, -n.x);
	u.normalize();
	const v = new THREE.Vector3().crossVectors(n, u);
	const at = (r: number, a: number, h: number, p: THREE.Vector3) =>
		p.copy(c).addScaledVector(u, Math.cos(a) * r * size).addScaledVector(v, Math.sin(a) * r * size).addScaledVector(n, h * size);
	const petals = b.pick(6, 4, 4);
	const seg = petals * 2;
	const tiers = b.pick(
		[[1.7, 1.05, 0.45, 0, 0.85], [1.15, 0.7, 0.95, Math.PI / 6, 1.15]] as const,
		[[1.7, 0.8, 0.6, 0, 1]] as const,
		[]
	);
	if (b.lod === 2) {
		const q = new THREE.Vector3();
		at(0, 0, 0.3, q);
		b.ball([q.x, q.y, q.z], [1.1 * size, 1.1 * size, 1.1 * size], { w, pal: PINK, seg: 4, rings: 3 });
		return;
	}
	for (const [tip, valley, high, turn, shade] of tiers)
		b.loft(
			[0, 1, 2].map((i): Ring => ({ c: [n.x * i, n.y * i, n.z * i], f: 1, s: 1, w, shade: shade * (i === 2 ? 0.75 : 1) })),
			{
				seg,
				u: [u.x, u.y, u.z],
				v: [v.x, v.y, v.z],
				pal: PINK,
				capEnd: true,
				deform: (p, _t, a, i) => {
					const isTip = Math.round((a / TAU) * seg) % 2 === 0;
					const th = a + turn;
					if (i === 0) at(0.4, th, -0.3, p);
					else if (i === 1) at(isTip ? tip : valley, th, isTip ? high : high * 0.65, p);
					else at(0.4, th, 0.35 + (high - 0.5) * 0.6, p);
				},
				shadeAt: (_p, a, i) => (i === 1 ? (Math.round((a / TAU) * seg) % 2 === 0 ? 1.12 : 0.85) : 1)
			}
		);
	const q = new THREE.Vector3();
	at(0, 0, b.lod === 0 ? 0.72 : 0.5, q);
	b.ball([q.x, q.y, q.z], [0.42 * size, 0.42 * size, 0.42 * size], { w, pal: YELLOW, seg: b.pick(5, 3, 3), rings: b.pick(4, 2, 2) });
}

/** Small arm on the outside of the left thigh, towards the back: out, then up into a round head. */
function buildArm(b: PartBuilder): void {
	const s: Side = 'L';
	const y0 = 21.8;
	const a = sideSign(s) * 1.95;
	const p = onLeg(s, a, y0, 0.2);
	const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
	const side = new THREE.Vector3(-out.z, 0, out.x);
	const w = legWeights(s, 24);
	const ribs = b.pick(5, 3, 2);
	const seg = ribs * 2;
	// [out, up, radius, how far the ring has turned upwards]
	const rows = b.pick<readonly (readonly [number, number, number, number])[]>(
		[[-0.8, -0.2, 0.85, 0], [0.7, 0, 0.95, 0.15], [1.6, 0.5, 1.15, 0.75], [2.0, 1.4, 1.45, 1.35], [2.1, 2.5, 1.55, 1.57], [2.1, 3.5, 1.3, 1.57], [2.1, 4.1, 0.75, 1.57]],
		[[-0.6, -0.1, 0.9, 0], [1.5, 0.5, 1.2, 0.75], [2.1, 2.3, 1.55, 1.57], [2.1, 4, 0.8, 1.57]],
		[[-0.5, 0, 0.9, 0], [1.8, 0.8, 1.3, 0.9], [2.1, 4, 1, 1.57]]
	);
	const mid = (r: readonly number[]) => new THREE.Vector3(p.x, y0 + r[1]!, p.z).addScaledVector(out, r[0]!);
	b.loft(
		rows.map((r, i): Ring => ({ c: [0, i, 0], f: 1, s: 1, w })),
		{
			seg,
			// With `v` sideways and the axis up, `u` starts out downwards.
			u: [1, 0, 0],
			v: [0, 0, 1],
			pal: GREEN,
			capEnd: true,
			deform: (q, _t, ang, i) => {
				const [o, up, r0, t] = rows[i]!;
				const r = r0 * (Math.round((ang / TAU) * seg) % 2 === 0 ? 1.1 : 0.84);
				const e = out.clone().multiplyScalar(Math.sin(t)).addScaledVector(new THREE.Vector3(0, -1, 0), Math.cos(t));
				q.copy(mid([o, up])).addScaledVector(e, Math.cos(ang) * r).addScaledVector(side, Math.sin(ang) * r);
			},
			shadeAt: (_q, ang) => (Math.round((ang / TAU) * seg) % 2 === 0 ? 1.1 : 0.6)
		}
	);
	if (b.lod === 0)
		for (const [i, off] of [[3, 0], [4, 1]] as const)
			for (let k = off % 2; k < ribs; k += 2) {
				const ang = (k / ribs) * TAU;
				const n = out.clone().multiplyScalar(Math.cos(ang)).addScaledVector(side, Math.sin(ang));
				spines(b, mid(rows[i]!).addScaledVector(n, rows[i]![2] * 1.1), n, w, 0.75);
			}
	const top = mid([2.1, 4.1]);
	flower(b, top, new THREE.Vector3(out.x * 0.25, 1, out.z * 0.25).normalize(), 0.95, w);
}

function buildFlowers(b: PartBuilder): void {
	const on = (s: Side, a: number, y: number, size: number) => {
		const c = onLeg(s, a, y, ribHeight(s, a, y) * 0.6);
		const n = onLeg(s, a, y, 3).sub(onLeg(s, a, y, 0)).normalize();
		flower(b, c.addScaledVector(n, 0.15), n, size, legWeights(s, y));
	};
	on('R', 0.15, 31, 1.4);
	on('R', -0.3, 19, 1.15);
}

registerItemMesh('bottom_cactus', {
	hides: ['shins'],
	colors: [0x58ab50, 0xfff2c8, 0xff5c9e, 0xffd23c],
	build(b) {
		buildHips(b);
		for (const s of SIDES) buildLegOf(b, s);
		buildFlowers(b);
		buildArm(b);
	}
});
