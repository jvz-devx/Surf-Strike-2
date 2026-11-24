import { registerItemMesh } from '../items.js';
import { lerp, PAL, sample, smooth, superellipse, type PartBuilder, type Ring } from '../mesh-kit.js';
import { HEAD } from '../shop-items.js';

/**
 * Sport wraps: one mirrored lens around the face, a half frame over its top
 * that runs on into wide arms with a ribbed rubber grip. Everything is swept
 * along one path around the head (socket space, the head's centre is at x -4.9).
 */
const CX = -4.9;

/** One cross-section: place on the path, outward direction, height range, thickness. */
interface Station {
	x: number;
	z: number;
	nx: number;
	nz: number;
	y: number;
	h: number;
	th: number;
	pal: number;
	shade: number;
}

/** Point and outward direction on the arc; `a` is 0 at the bridge, ±π/2 at the temples. */
function arc(a: number): { x: number; z: number; nx: number; nz: number } {
	const [c, s] = superellipse(a, 2.3);
	const nx = Math.sign(c) * Math.abs(c) ** 1.3 / 5.5;
	const nz = Math.sign(s) * Math.abs(s) ** 1.3 / 4.7;
	const l = Math.hypot(nx, nz);
	return { x: CX + 5.5 * c, z: 4.7 * s, nx: nx / l, nz: nz / l };
}

/** Lens outline over |angle|: angle, top, bottom. */
const LENS: readonly (readonly number[])[] = [
	[0, 1.2, -0.25],
	[0.1, 1.22, -0.62],
	[0.2, 1.24, -1.25],
	[0.34, 1.24, -1.72],
	[0.55, 1.2, -1.86],
	[0.8, 1.12, -1.66],
	[1.02, 0.9, -1.2],
	[1.2, 0.6, -0.66],
	[1.32, 0.4, -0.25]
];

/** Half frame over |angle|: angle, centre y, half height, half thickness. */
const FRAME: readonly (readonly number[])[] = [
	[0, 1.1, 0.34, 0.22],
	[0.25, 1.22, 0.3, 0.2],
	[0.6, 1.2, 0.3, 0.2],
	[0.95, 0.95, 0.38, 0.22],
	[1.2, 0.52, 0.56, 0.26],
	[1.38, 0.24, 0.6, 0.27]
];

/** Arm: x behind the head's centre line, y, half height, half thickness, side. */
const ARM: readonly (readonly number[])[] = [
	[-4.9, 0.18, 0.54, 0.23, 4.74],
	[-6, 0.18, 0.48, 0.21, 4.66],
	[-7.2, 0.06, 0.45, 0.21, 4.46],
	[-8.2, -0.35, 0.4, 0.2, 4.3]
];

function buildFrame(b: PartBuilder): void {
	const half: Station[] = [];
	const onArc = (a: number, pal: number, grow = 0, shade = 1) => {
		const [, y, h, th] = sample(FRAME, a) as [number, number, number, number];
		half.push({ ...arc(a), y, h: h + grow, th: th + grow, pal, shade });
	};
	const onArm = (x: number, pal: number, grow = 0, shade = 1) => {
		const [, y, h, th, z] = sample(ARM.map((r) => [-r[0]!, ...r.slice(1)]), -x) as [number, number, number, number, number];
		half.push({ x, z, nx: 0.12, nz: 0.993, y, h: h + grow, th: th + grow, pal, shade });
	};
	for (const a of b.pick([0, 0.12, 0.25, 0.4, 0.55, 0.7, 0.85, 1, 1.12, 1.22, 1.32], [0, 0.25, 0.55, 0.85, 1.1, 1.3], [0, 0.5, 0.95, 1.3])) onArc(a, PAL.glassesA);
	if (b.lod === 0) {
		// Hinge gap between the frame and the arm.
		onArc(1.36, PAL.glassesA);
		onArc(1.36, PAL.glassesD, -0.1);
		onArc(1.39, PAL.glassesD, -0.1);
		onArc(1.39, PAL.glassesA);
		onArm(-4.75, PAL.glassesA);
		onArm(-5.15, PAL.glassesA);
		// Ribbed rubber grip.
		for (let i = 0; i < 5; i++) {
			const x = lerp(-5.15, -7.6, i / 5);
			onArm(x - 0.03, PAL.glassesB, 0.06);
			onArm(x - 0.36, PAL.glassesB, 0.06);
			onArm(x - 0.4, PAL.glassesB, 0.02, 0.75);
		}
		onArm(-7.8, PAL.glassesB, 0.06);
		onArm(-8.2, PAL.glassesB, -0.06, 0.9);
	} else {
		onArm(-5.1, PAL.glassesA);
		onArm(-5.15, PAL.glassesB, 0.07);
		if (b.lod === 1) onArm(-6.8, PAL.glassesB, 0.07);
		onArm(-8.1, PAL.glassesB, 0.02);
	}
	// Left arm tip, round the front, right arm tip. A quad takes the palette of its station nearer the bridge.
	const path = [...half.slice(1).reverse().map((s) => ({ ...s, z: -s.z, nz: -s.nz })), ...half];
	const mid = half.length - 1;
	const seg = b.pick(8, 6, 4);
	b.loft(
		path.map((s, i): Ring => ({ c: [0, 0, i], f: 1, s: 1, w: HEAD, pal: s.pal, shade: s.shade })),
		{
			seg,
			u: [0, 1, 0],
			v: [1, 0, 0],
			capStart: true,
			capEnd: true,
			palAt: (i) => path[i < mid ? i + 1 : i]!.pal,
			deform: (p, _t, a, i) => {
				const s = path[i]!;
				const [up, out] = superellipse(a + Math.PI / seg, 3.4);
				p.set(s.x + s.nx * s.th * out, s.y + s.h * up, s.z + s.nz * s.th * out);
			}
		}
	);
}

function buildLens(b: PartBuilder): void {
	const half = b.pick([0.1, 0.2, 0.34, 0.48, 0.62, 0.8, 0.95, 1.08, 1.2, 1.3], [0.16, 0.34, 0.62, 0.95, 1.28], [0.3, 0.8, 1.25]);
	const path = [...[...half].reverse().map((a) => -a), 0, ...half];
	// Mirror bands from top to bottom, as a fraction of the lens height.
	const cuts = b.pick([0, 0.3, 0.46, 0.62, 0.8, 1], [0, 0.36, 0.68, 1], [0, 0.5, 1]);
	const pals = b.pick(
		[PAL.glassesB, PAL.glassesB, PAL.glassesC, PAL.glassesC, PAL.glassesD],
		[PAL.glassesB, PAL.glassesC, PAL.glassesD],
		[PAL.glassesB, PAL.glassesD]
	);
	const n = cuts.length;
	const seg = n + 2;
	b.loft(
		path.map((_, i): Ring => ({ c: [0, 0, i], f: 1, s: 1, w: HEAD, pal: PAL.glassesD })),
		{
			seg,
			u: [0, 1, 0],
			v: [1, 0, 0],
			capStart: true,
			capEnd: true,
			palAt: (_i, a) => pals[Math.floor((a / (Math.PI * 2)) * seg)] ?? PAL.glassesD,
			deform: (p, _t, a, i) => {
				const j = Math.round((a / (Math.PI * 2)) * seg);
				const at = arc(path[i]!);
				const [, top, bottom] = sample(LENS, Math.abs(path[i]!)) as [number, number, number];
				const outer = j < n;
				const t = outer ? cuts[j]! : j === n ? 1 : 0;
				const y = lerp(top, bottom, t);
				// Curved both ways, the lower edge tucks in towards the cheek.
				const d = (outer ? 0.06 : -0.16) - 0.09 * smooth(0.3, 1, t) * 2.2 - (outer && t === 1 ? 0.04 : 0);
				p.set(at.x + at.nx * d, y, at.z + at.nz * d);
			}
		}
	);
}

registerItemMesh('glasses_wrap', {
	colors: [0xf2f2ee, 0xff8a24, 0xd63a72, 0x4a2488],
	build(b) {
		b.socket('glasses', () => {
			buildLens(b);
			buildFrame(b);
			// Rubber nose pads under the bridge.
			if (b.lod === 0) for (const z of [-1, 1]) b.ball([0.2, -0.5, z * 0.62], [0.22, 0.42, 0.16], { w: HEAD, pal: PAL.glassesB, seg: 6, rings: 4, rot: [z * 0.35, 0, 0] });
		});
	}
});
