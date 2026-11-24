/**
 * Dark lord helmet (docs/characters.md): a glossy flared helmet over an angular
 * mask, built in code. The gloss is baked into the shade, so every plane keeps
 * its highlight without textures.
 */
import * as THREE from 'three';
import { registerItemMesh } from '../items.js';
import { lerp, PAL, smooth, superellipse, type PartBuilder, type Ring } from '../mesh-kit.js';
import { HEAD } from '../shop-items.js';
import type { V3 } from '../skeleton.js';

const GLOSS = PAL.hatA;
const STEEL = PAL.hatB;
const SILVER = PAL.hatC;
const DARK = PAL.hatD;

const v = (p: V3): THREE.Vector3 => new THREE.Vector3(...p);
const TOP = 73.35;
/** Height where the dome turns into the neck flare. */
const WAIST = 67.6;
const CX = -0.3;

/** Lower edge of the dome: brow at the front, down the temples, low around the neck. */
function edgeY(a: number): number {
	const t = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
	const brow = 67.35 + 0.55 * smooth(0, 0.55, t);
	return lerp(brow, 58.7 - 0.3 * smooth(1.6, Math.PI, t), smooth(0.68, 1.22, t) ** 0.8);
}

/** Point of the helmet at a height and angle (0 front, π/2 right). */
function dome(a: number, y: number, out = 0): THREE.Vector3 {
	const k = y > WAIST ? Math.max(0, 1 - ((y - WAIST) / (TOP - WAIST)) ** 2.15) ** (1 / 2.15) : 1;
	const d = Math.max(0, WAIST - y);
	const f = 6.55 * k + 0.1 * d;
	const b = 7.2 * k + 2.5 * (1 - smooth(62, 70, y)) + 0.016 * d * d;
	const s = 6.6 * k + 0.1 * d + 0.017 * d * d;
	const [ca, sa] = superellipse(a, 2.25);
	return new THREE.Vector3(CX + (ca >= 0 ? f + out : b + out) * ca, y + out * Math.max(0, 1 - k), (s + out) * sa);
}

/** Baked reflections of a glossy black surface. */
function gloss(n: THREE.Vector3): number {
	const lobe = (x: number, y: number, z: number, p: number) => {
		const l = Math.hypot(x, y, z);
		return Math.max(0, (n.x * x + n.y * y + n.z * z) / l) ** p;
	};
	return 0.09 + 1.05 * lobe(0.6, 0.72, 0.5, 13) + 0.35 * lobe(0.5, 0.45, -0.85, 14) + 0.5 * lobe(-0.75, 0.5, 0.55, 16) + 0.35 * lobe(-0.6, 0.55, -0.75, 16) + 0.22 * smooth(0.2, 0.85, n.y) + 0.14 * lobe(0.1, -0.25, 1, 14) + 0.14 * lobe(0.1, -0.25, -1, 14);
}

function domeGloss(p: THREE.Vector3, a: number, y: number): number {
	const e = 0.12;
	const da = dome(a + e * 0.2, y).sub(dome(a - e * 0.2, y));
	const dy = dome(a, Math.min(TOP - 0.02, y + e)).sub(dome(a, Math.max(58, y - e)));
	const n = dy.cross(da).normalize();
	if (n.dot(new THREE.Vector3(p.x - CX, p.y - 64, p.z)) < 0) n.negate();
	if (y > TOP - 0.3) n.set(0, 1, 0);
	return gloss(n);
}

interface PatchOptions {
	pal?: number;
	nu?: number;
	nv?: number;
	/** Shade at the four corners, times the gloss of the plane. */
	s?: readonly [number, number, number, number];
}

const INSIDE = new THREE.Vector3(0, 64.5, 0);

/** Grid facing away from the middle of the head. */
function sheet(b: PartBuilder, pts: THREE.Vector3[][], pal: number, shadeAt: (p: THREE.Vector3, i: number) => number, o: { wrap?: boolean; inward?: boolean; from?: THREE.Vector3 } = {}): void {
	// Compare the summed normal with the direction from the middle.
	let sum = 0;
	for (let i = 0; i < pts.length - 1; i++)
		for (let j = 0; j < pts[i]!.length - 1; j++) {
			const p = pts[i]![j]!;
			const n = pts[i]![j + 1]!.clone().sub(p).cross(pts[i + 1]![j]!.clone().sub(p));
			n.add(pts[i]![j + 1]!.clone().sub(pts[i + 1]![j + 1]!).cross(pts[i + 1]![j]!.clone().sub(pts[i + 1]![j + 1]!)).negate());
			sum += n.dot(p.clone().sub(o.from ?? INSIDE));
		}
	b.grid(pts, { w: HEAD, pal, wrap: o.wrap, flip: sum < 0 !== (o.inward ?? false), shadeAt });
}

/** Four-cornered plane, flat shaded against its neighbours. */
function patch(b: PartBuilder, c: readonly [V3, V3, V3, V3], m: number, o: PatchOptions = {}): void {
	const [p00, p01, p11, p10] = c.map((p) => v([p[0], p[1], p[2] * m])) as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
	const nu = b.lod === 0 ? (o.nu ?? 2) : 1;
	const nv = b.lod === 0 ? (o.nv ?? 2) : 1;
	const n = p01.clone().sub(p10).cross(p11.clone().sub(p00)).normalize();
	const mid = p00.clone().add(p11).add(p01).add(p10).multiplyScalar(0.25);
	if (n.dot(mid.sub(INSIDE)) < 0) n.negate();
	const g = o.pal === undefined || o.pal === GLOSS ? gloss(n) : 0.62 + 0.5 * Math.max(0, n.dot(v([0.6, 0.65, 0.45]).normalize()));
	const s = o.s ?? [1, 1, 1, 1];
	const pts: THREE.Vector3[][] = [];
	const shades = new Map<THREE.Vector3, number>();
	for (let i = 0; i <= nv; i++) {
		const row: THREE.Vector3[] = [];
		for (let j = 0; j <= nu; j++) {
			const u = j / nu;
			const t = i / nv;
			const p = p00.clone().lerp(p01, u).lerp(p10.clone().lerp(p11, u), t);
			shades.set(p, g * lerp(lerp(s[0], s[1], u), lerp(s[3], s[2], u), t));
			row.push(p);
		}
		pts.push(row);
	}
	sheet(b, pts, o.pal ?? GLOSS, (p) => shades.get(p) ?? g);
}

/** Round bar through points, with its own radius at each. */
function tube(b: PartBuilder, path: readonly V3[], radii: readonly number[], seg: number, pal: number, shade: (up: number) => number): void {
	const c = path.map(v);
	const rows = c.map((p, k) => {
		const dir = c[Math.min(k + 1, c.length - 1)]!.clone().sub(c[Math.max(k - 1, 0)]!).normalize();
		const side = new THREE.Vector3(0.05, 0, 1).cross(dir).normalize();
		const up = dir.clone().cross(side);
		return Array.from({ length: seg }, (_, j) => {
			const t = (j / seg) * Math.PI * 2;
			return p.clone().addScaledVector(side, Math.cos(t) * radii[k]!).addScaledVector(up, Math.sin(t) * radii[k]!);
		});
	});
	const ys = rows.map((r, k) => r.map((p) => (p.y - c[k]!.y) / (radii[k]! || 1)));
	const all = new Map<THREE.Vector3, number>();
	rows.forEach((r, k) => r.forEach((p, j) => all.set(p, shade(ys[k]![j]!))));
	const closed = [rows[0]!.map(() => c[0]!), ...rows, rows[rows.length - 1]!.map(() => c[c.length - 1]!)];
	b.grid(closed, { w: HEAD, pal, wrap: true, shadeAt: (p) => all.get(p) ?? shade(0.3) });
}

/** Closed curve through points (Catmull-Rom), `n` points. */
const loop = (pts: readonly V3[], n: number, m: number): THREE.Vector3[] => new THREE.CatmullRomCurve3(pts.map((p) => v([p[0], p[1], p[2] * m])), true, 'centripetal').getPoints(n).slice(0, n);

// Landmarks of the right half of the mask.
const EYE: readonly V3[] = [[5.95, 66.2, 0.85], [5.75, 66.85, 1.7], [4.6, 66.75, 3.75], [4.35, 65.1, 4.3], [5.2, 64.5, 3.35], [6.0, 65.0, 1.5]];
const AROUND: readonly V3[] = [[6.5, 66.75, 0.5], [5.95, 67.6, 2.2], [4.2, 67.4, 4.55], [4.0, 64.9, 5.05], [5.75, 63.95, 3.3], [6.75, 64.3, 1.15]];
const N_TOP: V3 = [6.05, 68.1, 0];
const N_MID: V3 = [7.15, 65.6, 0];
const N_TIP: V3 = [7.75, 64.05, 0];
const Q1: V3 = [6.75, 62.2, 2.0];
const Q2: V3 = [5.6, 62.1, 3.75];
const Q3: V3 = [3.5, 62.5, 5.1];
const R1: V3 = [6.5, 60.35, 3.0];
const R2: V3 = [5.2, 60.5, 3.9];
const R3: V3 = [3.1, 60.9, 4.8];
const J0: V3 = [6.1, 58.9, 0];
const J1: V3 = [5.75, 58.9, 1.75];
const J2: V3 = [4.4, 59.3, 3.2];
const J3: V3 = [2.7, 59.7, 4.4];
const S1: V3 = [1.4, 65, 6.0];
const S2: V3 = [1.3, 62.5, 6.0];
const S3: V3 = [1.1, 60.2, 5.7];
const T3: V3 = [1.5, 68.6, 5.75];
const K0: V3 = [-1.6, 68.4, 6.3];
const K1: V3 = [-1.6, 64.8, 6.75];
const K2: V3 = [-1.6, 62.2, 7.1];
const K3: V3 = [-1.6, 59.4, 7.9];

function buildDome(b: PartBuilder): void {
	const seg = b.pick(44, 22, 14);
	// Columns gather where the edge sweeps down the temples.
	const angle = (j: number) => {
		const t = (j / seg) * Math.PI * 2;
		return t - 0.16 * Math.sin(2 * t) + 0.04 * Math.sin(4 * t);
	};
	const ts = b.pick([0.004, 0.02, 0.06, 0.13, 0.24, 0.37, 0.5, 0.62, 0.74, 0.88, 1], [0.01, 0.08, 0.24, 0.5, 0.75, 1], [0.01, 0.2, 0.5, 1]);
	const shade = new Map<THREE.Vector3, number>();
	const rows = ts.map((t) =>
		Array.from({ length: seg }, (_, j) => {
			const a = angle(j);
			// Level rows over the crown, then down to the edge.
			const y = t < 0.5 ? lerp(TOP, 69.2, (t / 0.5) ** 0.85) : lerp(69.2, edgeY(a), (t - 0.5) / 0.5);
			const p = dome(a, y);
			shade.set(p, domeGloss(p, a, y) * (t > 0.95 ? 1.15 : 1));
			return p;
		})
	);
	const top = new THREE.Vector3(CX, TOP, 0);
	shade.set(top, 0.5);
	b.grid([rows[0]!.map(() => top), ...rows], { w: HEAD, pal: GLOSS, wrap: true, shadeAt: (p) => shade.get(p) ?? 0.2 });
	// Rolled edge and the dark inside of the flare.
	const lip = (out: number, drop: number) => Array.from({ length: seg }, (_, j) => {
		const a = angle(j);
		const p = dome(a, edgeY(a), out);
		p.y -= drop;
		return p;
	});
	const rim = b.pick([[0, 0], [0.3, 0], [0.3, 0.25], [0.02, 0.4], [-0.5, 0.2]], [[0, 0], [0.3, 0.1], [-0.5, 0.2]], [[0, 0], [-0.5, 0.2]]);
	b.grid(rim.map(([o, d]) => lip(o!, d!)), { w: HEAD, pal: GLOSS, wrap: true, shadeAt: (p, i) => (i <= 1 ? 0.95 : i === 2 ? 0.5 : 0.12) * (0.6 + 0.4 * smooth(-4, 6, p.x)) });
	const inner = (out: number, up: number) => Array.from({ length: seg }, (_, j) => {
		const a = angle(j);
		return dome(a, Math.min(68.3, edgeY(a) + up), out);
	});
	if (b.lod < 2) b.grid([inner(-0.5, -0.2), inner(-0.62, 2), inner(-0.7, 5)], { w: HEAD, pal: GLOSS, wrap: true, shadeAt: () => 0.06 });

	// Raised ridge from the brow over the crown to the back.
	const line: [THREE.Vector3, number][] = [];
	const n = b.pick(26, 12, 7);
	for (let i = 0; i <= n; i++) {
		const t = (i / n) * 2 - 0.02;
		const front = t < 1;
		const q = front ? 1 - t : t - 1;
		// Along the profile: crown at q = 0.
		const y = front ? TOP - (TOP - 67.15) * Math.sin(q * 1.5) ** 2 : TOP - (TOP - 61) * (1 - Math.cos(q * 1.5)) * 1.07;
		line.push([dome(front ? 0 : Math.PI, Math.min(TOP - 0.001, y)), front ? lerp(0.95, 0.6, smooth(0, 1, q)) : lerp(0.95, 0.75, q)]);
	}
	const section: readonly (readonly [number, number])[] = [[-1.35, -0.25], [-0.85, 0.42], [0.85, 0.42], [1.35, -0.25]];
	const ridge = line.map(([p, w], i) => {
		const a = line[Math.max(0, i - 1)]![0];
		const c = line[Math.min(line.length - 1, i + 1)]![0];
		const nrm = new THREE.Vector3(-(c.y - a.y), c.x - a.x, 0).normalize().negate();
		return section.map(([z, o]) => p.clone().addScaledVector(nrm, i === line.length - 1 ? -0.25 : o).setZ(z * w));
	});
	// Crisp: one sheet per face.
	for (let k = 0; k < 3; k++) {
		const face = ridge.map((r) => [r[k]!, r[k + 1]!]);
		const m = new Map<THREE.Vector3, number>();
		face.forEach((r, i) => {
			const a = face[Math.max(0, i - 1)]![0]!;
			const c = face[Math.min(face.length - 1, i + 1)]![0]!;
			const nn = new THREE.Vector3(c.y - a.y, -(c.x - a.x), 0).normalize().negate();
			nn.z = (k - 1) * 1.1;
			nn.normalize();
			r.forEach((p) => m.set(p, gloss(nn) * 1.7));
		});
		b.grid(face, { w: HEAD, pal: GLOSS, flip: true, shadeAt: (p) => m.get(p) ?? 0.3 });
	}
}

function buildMask(b: PartBuilder): void {
	for (const m of [1, -1]) {
		// Brow, socket and cheekbone around the lens.
		const n = b.pick(24, 12, 6);
		const eye = loop(EYE, n, m);
		const around = loop(AROUND, n, m);
		const mid = eye.map((p, j) => p.clone().lerp(around[j]!, 0.3).add(new THREE.Vector3(-0.12, 0, 0)));
		const rimIn = eye.map((p) => p.clone().add(new THREE.Vector3(-0.25, 0, 0)));
		const sh = new Map<THREE.Vector3, number>();
		around.forEach((p) => sh.set(p, 0.25 + 0.85 * smooth(66.4, 67.8, p.y) + 0.55 * smooth(65.2, 64, p.y)));
		mid.forEach((p) => sh.set(p, p.y > 66.4 ? 0.16 : 0.42));
		eye.forEach((p) => sh.set(p, 0.12));
		rimIn.forEach((p) => sh.set(p, 0.05));
		sheet(b, b.pick([around, mid, eye, rimIn], [around, eye], [around, eye]), GLOSS, (p) => sh.get(p)!, { wrap: true });
		// Bulging smoked lens.
		const c = eye.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(n);
		const ls = (k: number, out: number) => eye.map((p) => c.clone().lerp(p, k).add(new THREE.Vector3(out, 0, out * 0.35 * m)));
		sheet(b, b.pick([ls(1, -0.18), ls(0.8, 0.3), ls(0.45, 0.58), ls(0, 0.66)], [ls(1, -0.1), ls(0.6, 0.45), ls(0, 0.6)], [ls(1, -0.05), ls(0, 0.5)]), DARK, (p) => 0.5 + 0.75 * smooth(65.6, 66.6, p.y) * smooth(1.6, 3, Math.abs(p.z)) - 0.25 * smooth(65.4, 64.8, p.y), { wrap: true });

		// Nose ridge.
		const O = AROUND;
		patch(b, [N_TOP, O[1]!, O[0]!, N_MID].map((p, i) => (i === 1 ? ([5.9, 68.1, 1.1] as V3) : p)) as unknown as [V3, V3, V3, V3], m, { s: [1.2, 1, 1, 1.6] });
		patch(b, [N_MID, O[0]!, O[5]!, N_TIP], m, { pal: STEEL, s: [1, 0.8, 0.8, 1.15] });
		// Behind the brow, under the dome.
		patch(b, [[5.9, 68.1, 1.1], [5.6, 68.1, 2.2], O[1]!, O[0]!], m, { nu: 1, nv: 1 });
		patch(b, [O[1]!, O[2]!, [3.4, 68.6, 4.5], [5.2, 68.6, 2.2]], m, { nu: 1, nv: 1 });
		patch(b, [O[2]!, T3, S1, O[3]!], m, { s: [0.6, 0.5, 0.8, 1] });

		// Cheeks: two planes under the cheekbone, then the jaw.
		patch(b, [O[5]!, O[4]!, Q2, Q1], m, { pal: STEEL, s: [1.05, 1.15, 0.75, 0.6] });
		patch(b, [O[4]!, O[3]!, Q3, Q2], m, { s: [2.6, 2.4, 0.9, 1], nu: 3, nv: 3 });
		patch(b, [O[3]!, S1, S2, Q3], m, { s: [1.6, 1, 0.8, 1] });
		patch(b, [Q1, Q2, R2, R1], m, { pal: STEEL, s: [0.6, 0.8, 0.5, 0.45] });
		patch(b, [Q2, Q3, R3, R2], m, { s: [1.4, 1.2, 0.6, 0.7] });
		patch(b, [Q3, S2, S3, R3], m, { s: [1, 0.8, 0.6, 0.8] });
		patch(b, [R1, R2, J2, J1], m, { s: [0.8, 0.9, 0.6, 0.6] });
		patch(b, [R2, R3, J3, J2], m, { s: [1, 1, 0.6, 0.6], nu: 1, nv: 1 });
		patch(b, [R3, S3, [1, 59.6, 5.3], J3], m, { nu: 1, nv: 1 });
		// Inner walls back to the flare.
		patch(b, [T3, K0, K1, S1], m, { s: [0.5, 0.4, 0.4, 0.8], nu: 1, nv: 1 });
		patch(b, [S1, K1, K2, S2], m, { s: [0.8, 0.4, 0.4, 0.8], nu: 1, nv: 1 });
		patch(b, [S2, K2, K3, S3], m, { s: [0.8, 0.4, 0.3, 0.6], nu: 1, nv: 1 });
		patch(b, [S3, K3, [-1.6, 59, 7.9], [1, 59.6, 5.3]], m, { nu: 1, nv: 1 });

		// Muzzle: bevelled frame of the grille.
		const A: V3 = [7.6, 63.55, 0];
		const E: V3 = [6.95, 60.75, 2.35];
		const Ai: V3 = [7.3, 63.0, 0];
		const Ei: V3 = [6.75, 61.05, 1.75];
		patch(b, [N_TIP, O[5]!, Q1, A], m, { nu: 1, s: [1.3, 0.9, 0.8, 1.2] });
		patch(b, [A, Q1, R1, E], m, { s: [1, 0.8, 0.8, 1.2] });
		patch(b, [A, E, Ei, Ai], m, { pal: STEEL, nu: 3, nv: 1, s: [1.2, 1.1, 0.7, 0.8] });
		patch(b, [E, [7.05, 60.75, 0], [6.85, 61.05, 0], Ei], m, { pal: STEEL, nu: 1, nv: 1, s: [1.1, 1.2, 0.8, 0.8] });
		// Recess.
		patch(b, [[6.5, 63.6, 0], [6.4, 63.6, 0.5], [6.1, 60.5, 2.5], [6.3, 60.5, 0]], m, { pal: DARK, nu: 1, nv: 1, s: [0.35, 0.35, 0.35, 0.35] });
		// Chin: ledge, then a plate with vents.
		patch(b, [[7.05, 60.75, 0], E, [6.3, 60.1, 1.95], [6.5, 60.1, 0]], m, { s: [1.5, 1.2, 0.4, 0.5], nu: 1 });
		patch(b, [E, R1, J1, [6.3, 60.1, 1.95]], m, { nu: 1, s: [0.8, 0.8, 0.6, 0.6] });
		patch(b, [[6.5, 60.1, 0], [6.3, 60.1, 1.95], J1, J0], m, { s: [1.1, 0.8, 0.7, 1] });
		// Tube along the lower cheek to the tusk tip.
		if (b.lod < 2) {
			const seg = b.pick(7, 5, 3);
			tube(b, b.pick([[1.4, 61.0, 5.85 * m], [3.2, 60.85, 4.95 * m], [5.2, 60.5, 4.0 * m], [6.45, 60.35, 3.1 * m]], [[1.4, 61, 5.85 * m], [4.4, 60.65, 4.5 * m], [6.45, 60.35, 3.1 * m]], []) as V3[], [0.22, 0.28, 0.3, 0.32], seg, GLOSS, (u) => 0.2 + 1.0 * smooth(0.1, 1, u));
			tube(b, [[6.2, 60.7, 3.1 * m], [6.85, 60.4, 2.65 * m], [7.25, 60.25, 2.35 * m], [7.4, 60.2, 2.25 * m]], [0.5, 0.5, 0.46, 0.25], b.pick(9, 5, 3), SILVER, (u) => 0.55 + 0.65 * smooth(-0.4, 0.9, u));
		}
	}
	// Vertical slats of the grille.
	const slats = b.pick(7, 5, 0);
	for (let i = 0; i < slats; i++) {
		const z = ((i + 0.5) / slats - 0.5) * 3.3;
		const top = lerp(63.05, 61.2, Math.abs(z) / 1.75);
		const x = 7.02 - Math.abs(z) * 0.2;
		patch(b, [[x + 0.16, top, z - 0.1], [x + 0.16, top, z + 0.1], [x - 0.24, 60.95, z + 0.1], [x - 0.24, 60.95, z - 0.1]], 1, { pal: SILVER, nu: 1, nv: 1, s: [0.5, 0.5, 0.75, 0.75] });
		if (b.lod === 0) for (const e of [-1, 1]) {
			const q = ([[x + 0.16, top, z + 0.1 * e], [x - 0.24, 60.95, z + 0.1 * e], [x - 0.9, 60.95, z + 0.1 * e], [x - 0.5, top, z + 0.1 * e]] as V3[]).map(v);
			sheet(b, [[q[0]!, q[1]!], [q[3]!, q[2]!]], STEEL, () => 0.4, { from: new THREE.Vector3(x, 62, z) });
		}
	}
	if (b.lod === 2) patch(b, [[7, 63, -0.1], [7, 63, 0.1], [6.75, 61, 1.7], [6.75, 61, -1.7]], 1, { pal: SILVER, s: [0.35, 0.35, 0.35, 0.35] });
	// Chin vents.
	if (b.lod === 0)
		for (let i = -2; i <= 2; i++) patch(b, [[6.47, 59.95, i * 0.38 - 0.12], [6.47, 59.95, i * 0.38 + 0.12], [6.26, 59.25, i * 0.38 + 0.12], [6.26, 59.25, i * 0.38 - 0.12]], 1, { pal: SILVER, nu: 1, nv: 1, s: [0.5, 0.5, 0.7, 0.7] });

	// Closed underneath, up to the neck.
	const jaw: THREE.Vector3[] = [];
	const half: V3[] = [J0, J1, J2, J3, [1, 59.6, 5.3], [-1.6, 59, 7.9]];
	for (let i = half.length - 1; i > 0; i--) jaw.push(v([half[i]![0], half[i]![1], -half[i]![2]]));
	for (const p of half) jaw.push(v(p));
	const backN = b.pick(11, 7, 5);
	for (let i = 0; i < backN; i++) {
		const a = lerp(1.85, Math.PI * 2 - 1.85, i / (backN - 1));
		jaw.push(dome(a, edgeY(a), -0.45).setY(edgeY(a)));
	}
	const collar = jaw.map((p) => {
		const a = Math.atan2(p.z, p.x + 0.4);
		return new THREE.Vector3(-0.4 + Math.cos(a) * 2.05, 59.5, Math.sin(a) * 2.1);
	});
	sheet(b, [jaw, collar], GLOSS, () => 0.06, { wrap: true, from: new THREE.Vector3(0, 70, 0) });
}

/** Dark lining right around the head: no skin shows through a gap. */
function buildLining(b: PartBuilder): void {
	const ring = (y: number, f: number, back: number, s: number): Ring => ({ c: [0, y, 0], f, b: back, s, w: HEAD, shade: 0.05 });
	b.loft([ring(59.4, 2, 2.3, 2.1), ring(59.9, 4.4, 2.4, 2.4), ring(61.4, 5.15, 3.4, 3.5), ring(63, 5.3, 4.4, 4.2), ring(64.4, 6, 5, 4.8), ring(65.6, 5.45, 5.3, 5), ring(67.6, 5.1, 5.5, 4.9), ring(69.6, 4.7, 5.2, 4.5)], { seg: b.pick(18, 12, 8), pal: GLOSS });
}

registerItemMesh('hat_darkhelm', {
	hides: ['hair'],
	coversFace: true,
	colors: [0x585d67, 0x3d424b, 0x9aa1ab, 0x3a2422],
	build(b) {
		buildLining(b);
		buildDome(b);
		buildMask(b);
	}
});
