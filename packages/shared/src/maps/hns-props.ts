/**
 * Builders for hide and seek maps (docs/research/hide-and-seek-maps.md):
 * a brush collector that also records the map's secrets, walls with door /
 * window / fake openings, slabs with holes, stairs, and a furniture library
 * (beds, wardrobes, shelves, cars, trees, stalls…) placed in a rotated local
 * frame. Every brush is an axis-aligned box (or a walkable `ramp` wedge).
 * Hammer units, Z up; a prop's local footprint is [0, w] × [0, d] with its
 * front on the local y = 0 side.
 */
import type { Vec3 } from '../types.ts';
import type { BrushDef, Spawn } from './types.ts';

export type BrushKind = 'ground' | 'struct' | 'prop';

/** Kinds of hiding spot (a spot may have several). */
export type SpotKind =
	| 'fake' // behind or inside a clip-through brush
	| 'teleport' // only (or mainly) reached through a teleporter
	| 'roof' // on a roof / high ledge reached by climbing props
	| 'crouchjump' // needs a crouch-jump (> 55 units) on the way
	| 'prop' // inside a hollow prop
	| 'crawl' // in or behind a duck-only crawlspace
	| 'room' // small secret room
	| 'under' // under a structure (pier, stage, stairs)
	| 'water'; // under water

export interface Spot {
	id: string;
	name: string;
	/** Feet position on the floor of the spot. */
	pos: Vec3;
	kinds: SpotKind[];
}

export interface Box {
	min: Vec3;
	max: Vec3;
}

export interface Teleporter {
	id: string;
	zone: Box;
	dest: Spawn;
	/** Hidden (behind a fake brush, inside a prop…) or visible (booth / cubicle). */
	hidden: boolean;
	/** Id of the teleporter that brings you back, if any. */
	back?: string;
	/** A floor point just outside the zone, lined up with its narrow entrance (for the reachability graph). */
	approach?: Vec3;
	note: string;
}

/** A duck-only passage: feet positions at both ends on the duct floor. */
export interface Crawl {
	id: string;
	from: Vec3;
	to: Vec3;
}

export interface Rect {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}

export const rect = (x0: number, x1: number, y0: number, y1: number): Rect => ({
	x0: Math.min(x0, x1),
	x1: Math.max(x0, x1),
	y0: Math.min(y0, y1),
	y1: Math.max(y0, y1)
});

export const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Collects brushes plus the map's design data (secrets, rooms, loops). */
export class MapBuilder {
	readonly brushes: BrushDef[] = [];
	readonly kinds: BrushKind[] = [];
	readonly spots: Spot[] = [];
	readonly teleports: Teleporter[] = [];
	readonly crawls: Crawl[] = [];
	readonly rooms: string[] = [];
	readonly buildings: string[] = [];
	readonly loops: string[] = [];
	/** Default kind for `box` (set while building furniture). */
	kind: BrushKind = 'struct';

	box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: string, solid = true, kind = this.kind): void {
		const min = v(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1));
		const max = v(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
		if (max.x - min.x < 0.5 || max.y - min.y < 0.5 || max.z - min.z < 0.5) return;
		const b: BrushDef = { type: 'box', min, max, material };
		if (!solid) b.solid = false;
		this.brushes.push(b);
		this.kinds.push(kind);
	}

	/** A clip-through box (rendered, no collision). */
	fake(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: string, kind = this.kind): void {
		this.box(x0, y0, z0, x1, y1, z1, material, false, kind);
	}

	/**
	 * Walkable wedge rising from `low` edge to `high` edge along an axis:
	 * covers rect r, from height z0 (at the low edge, flush with the floor) to
	 * z1 at the high edge, with a vertical back face.
	 */
	wedge(r: Rect, dir: '+x' | '-x' | '+y' | '-y', z0: number, z1: number, material: string): void {
		const h = z1 - z0;
		const axisX = dir[1] === 'x';
		const pos = dir[0] === '+';
		const run = axisX ? r.x1 - r.x0 : r.y1 - r.y0;
		// Peak line at the high edge, running across; the slope faces back towards the low edge.
		if (axisX) {
			const x = pos ? r.x1 : r.x0;
			// Seen from `from` to `to` (+y), left = -x. Slope must face the low side.
			const side: 'left' | 'right' = pos ? 'left' : 'right';
			this.brushes.push({ type: 'ramp', from: v(x, r.y0, z1), to: v(x, r.y1, z1), height: h, halfWidth: run, side, material });
		} else {
			const y = pos ? r.y1 : r.y0;
			// from→to along +x: left = +y.
			const side: 'left' | 'right' = pos ? 'right' : 'left';
			this.brushes.push({ type: 'ramp', from: v(r.x0, y, z1), to: v(r.x1, y, z1), height: h, halfWidth: run, side, material });
		}
		this.kinds.push('struct');
	}

	spot(id: string, name: string, pos: Vec3, ...kinds: SpotKind[]): void {
		if (this.spots.some((s) => s.id === id)) throw new Error(`duplicate spot ${id}`);
		this.spots.push({ id, name, pos, kinds });
	}

	teleport(t: Teleporter): void {
		if (this.teleports.some((s) => s.id === t.id)) throw new Error(`duplicate teleporter ${t.id}`);
		this.teleports.push(t);
	}

	crawl(id: string, from: Vec3, to: Vec3): void {
		this.crawls.push({ id, from, to });
	}

	room(...names: string[]): void {
		this.rooms.push(...names);
	}

	/** Run `fn` with `kind` as the default brush kind. */
	as(kind: BrushKind, fn: () => void): void {
		const k = this.kind;
		this.kind = kind;
		try {
			fn();
		} finally {
			this.kind = k;
		}
	}
}

// ---------------------------------------------------------------------------
// Walls, slabs, stairs

/**
 * An opening in a wall: [a, b] along the wall, [z0, z1] absolute heights.
 * fill: 'glass' puts a 4-thick glass pane in the middle of the wall,
 * 'fake' fills the opening with a clip-through box of the wall's material
 * (a secret passage that looks like wall), 'none' (default) leaves it open.
 */
export interface Hole {
	a: number;
	b: number;
	z0: number;
	z1: number;
	fill?: 'none' | 'glass' | 'fake';
	/** Material of a fake fill (defaults to the wall's). */
	mat?: string;
}

/**
 * Wall along `axis` from `from` to `to`, occupying [t0, t1] across it and
 * [z0, z1] in height, with openings.
 */
export function wall(
	b: MapBuilder,
	axis: 'x' | 'y',
	from: number,
	to: number,
	t0: number,
	t1: number,
	z0: number,
	z1: number,
	mat: string,
	holes: Hole[] = []
): void {
	const put = (a0: number, a1: number, h0: number, h1: number, m: string, solid = true, c0 = t0, c1 = t1) =>
		axis === 'x' ? b.box(a0, c0, h0, a1, c1, h1, m, solid) : b.box(c0, a0, h0, c1, a1, h1, m, solid);
	const lo = Math.min(from, to);
	const hi = Math.max(from, to);
	for (const h of holes) if (h.a < lo - 1e-6 || h.b > hi + 1e-6 || h.b <= h.a) throw new Error(`wall: bad hole ${h.a}..${h.b} in ${lo}..${hi}`);
	const cuts = [...new Set([lo, hi, ...holes.flatMap((h) => [h.a, h.b])])].sort((p, q) => p - q);
	// Merge consecutive intervals covered by the same holes.
	let i = 0;
	while (i + 1 < cuts.length) {
		const key = (k: number) => {
			const m = (cuts[k]! + cuts[k + 1]!) / 2;
			return holes.filter((h) => h.a <= m && h.b >= m);
		};
		const hs = key(i);
		let j = i + 1;
		while (j + 1 < cuts.length) {
			const n = key(j);
			if (n.length !== hs.length || n.some((h, k) => h !== hs[k])) break;
			j++;
		}
		const a0 = cuts[i]!;
		const a1 = cuts[j]!;
		const sorted = hs.slice().sort((p, q) => p.z0 - q.z0);
		let z = z0;
		for (const h of sorted) {
			const hz0 = Math.max(z0, h.z0);
			const hz1 = Math.min(z1, h.z1);
			if (hz1 <= hz0) continue;
			if (hz0 > z) put(a0, a1, z, hz0, mat);
			if (h.fill === 'glass') {
				const m = (t0 + t1) / 2;
				put(a0, a1, hz0, hz1, 'glass', true, m - 2, m + 2);
			} else if (h.fill === 'fake') put(a0, a1, hz0, hz1, h.mat ?? mat, false);
			z = Math.max(z, hz1);
		}
		if (z < z1) put(a0, a1, z, z1, mat);
		i = j;
	}
}

/** Door opening [a, a + w] from floor z up `h`. */
export const door = (a: number, z: number, w = 64, h = 104): Hole => ({ a, b: a + w, z0: z, z1: z + h });
/** Glazed window [a, a + w], sill and top relative to floor z. */
export const win = (a: number, z: number, w = 96, sill = 40, top = 128): Hole => ({ a, b: a + w, z0: z + sill, z1: z + top, fill: 'glass' });
/** Clip-through section [a, a + w] from floor z up `h` (looks like wall). */
export const fakeHole = (a: number, z: number, w = 64, h = 104, mat?: string): Hole => ({ a, b: a + w, z0: z, z1: z + h, fill: 'fake', mat });
/** Unglazed window/vent opening. */
export const gap = (a: number, z0: number, w: number, z1: number): Hole => ({ a, b: a + w, z0, z1 });

/**
 * Horizontal slab over r minus `holes` (decomposed into as few boxes as the
 * grid of hole edges allows). Holes may extend past r.
 */
export function slab(b: MapBuilder, r: Rect, z0: number, z1: number, mat: string, holes: Rect[] = [], solid = true): void {
	const hs = holes
		.map((h) => ({ x0: Math.max(h.x0, r.x0), x1: Math.min(h.x1, r.x1), y0: Math.max(h.y0, r.y0), y1: Math.min(h.y1, r.y1) }))
		.filter((h) => h.x1 > h.x0 && h.y1 > h.y0);
	const xs = [...new Set([r.x0, r.x1, ...hs.flatMap((h) => [h.x0, h.x1])])].sort((a, c) => a - c);
	const ys = [...new Set([r.y0, r.y1, ...hs.flatMap((h) => [h.y0, h.y1])])].sort((a, c) => a - c);
	const inHole = (x: number, y: number) => hs.some((h) => x > h.x0 && x < h.x1 && y > h.y0 && y < h.y1);
	// Runs per band, merged vertically when identical.
	let open = new Map<string, Rect>();
	const flush = (m: Map<string, Rect>) => {
		for (const q of m.values()) b.box(q.x0, q.y0, z0, q.x1, q.y1, z1, mat, solid);
	};
	for (let j = 0; j + 1 < ys.length; j++) {
		const y0 = ys[j]!;
		const y1 = ys[j + 1]!;
		const ym = (y0 + y1) / 2;
		const runs: Array<[number, number]> = [];
		let start: number | null = null;
		for (let i = 0; i + 1 < xs.length; i++) {
			const filled = !inHole((xs[i]! + xs[i + 1]!) / 2, ym);
			if (filled && start === null) start = xs[i]!;
			if (!filled && start !== null) {
				runs.push([start, xs[i]!]);
				start = null;
			}
		}
		if (start !== null) runs.push([start, xs[xs.length - 1]!]);
		const next = new Map<string, Rect>();
		for (const [a, c] of runs) {
			const k = `${a},${c}`;
			const prev = open.get(k);
			if (prev) {
				prev.y1 = y1;
				next.set(k, prev);
				open.delete(k);
			} else next.set(k, rect(a, c, y0, y1));
		}
		flush(open);
		open = next;
	}
	flush(open);
}

export type Dir = '+x' | '-x' | '+y' | '-y';

/**
 * Solid flight of steps: step k covers [k, k+1]·run from the foot edge along
 * `dir` and rises to z0 + rise·(k+1). `foot` = centre of the foot edge.
 * Returns the rect the flight covers.
 */
export function flight(b: MapBuilder, foot: { x: number; y: number }, dir: Dir, steps: number, width: number, z0: number, mat: string, rise = 16, run = 24, floating = 0): Rect {
	const s = dir[0] === '+' ? 1 : -1;
	const hw = width / 2;
	const ax = dir[1] === 'x';
	for (let k = 0; k < steps; k++) {
		const a = (ax ? foot.x : foot.y) + s * run * k;
		const c = a + s * run;
		const top = z0 + rise * (k + 1);
		const bot = floating > 0 ? Math.max(z0, top - floating) : z0;
		if (ax) b.box(a, foot.y - hw, bot, c, foot.y + hw, top, mat);
		else b.box(foot.x - hw, a, bot, foot.x + hw, c, top, mat);
	}
	const a = ax ? foot.x : foot.y;
	const c = a + s * run * steps;
	return ax ? rect(a, c, foot.y - hw, foot.y + hw) : rect(foot.x - hw, foot.x + hw, a, c);
}

/** Railing along a rect edge set: posts + top rail, `h` tall. */
export function railing(b: MapBuilder, axis: 'x' | 'y', from: number, to: number, at: number, z: number, mat: string, h = 40, t = 4): void {
	const a0 = Math.min(from, to);
	const a1 = Math.max(from, to);
	const n = Math.max(1, Math.round((a1 - a0) / 64));
	const step = (a1 - a0) / n;
	for (let i = 0; i <= n; i++) {
		const p = Math.min(a1 - t, Math.max(a0, a0 + i * step - t / 2));
		if (axis === 'x') b.box(p, at - t / 2, z, p + t, at + t / 2, z + h - t, mat);
		else b.box(at - t / 2, p, z, at + t / 2, p + t, z + h - t, mat);
	}
	if (axis === 'x') b.box(a0, at - t / 2, z + h - t, a1, at + t / 2, z + h, mat);
	else b.box(at - t / 2, a0, z + h - t, at + t / 2, a1, z + h, mat);
}

// ---------------------------------------------------------------------------
// Props in a local frame

export type Face = 'n' | 's' | 'e' | 'w';

/** Local → world mapping for one prop (rotation in 90° steps). */
export class Frame {
	constructor(
		readonly b: MapBuilder,
		readonly ox: number,
		readonly oy: number,
		readonly oz: number,
		readonly face: Face
	) {}

	private map(lx: number, ly: number): [number, number] {
		switch (this.face) {
			case 's':
				return [this.ox + lx, this.oy + ly];
			case 'n':
				return [this.ox - lx, this.oy - ly];
			case 'e':
				return [this.ox - ly, this.oy + lx];
			case 'w':
				return [this.ox + ly, this.oy - lx];
		}
	}

	/** Box in local coordinates (z relative to the frame floor). */
	box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: string, solid = true): void {
		const [ax, ay] = this.map(x0, y0);
		const [bx, by] = this.map(x1, y1);
		this.b.box(ax, ay, this.oz + z0, bx, by, this.oz + z1, mat, solid, 'prop');
	}

	fake(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: string): void {
		this.box(x0, y0, z0, x1, y1, z1, mat, false);
	}

	/** World position of a local point. */
	at(lx: number, ly: number, lz = 0): Vec3 {
		const [x, y] = this.map(lx, ly);
		return v(x, y, this.oz + lz);
	}

	/** World yaw of a local direction given as a local yaw (0 = local +x, 90 = local +y). */
	yaw(local: number): number {
		const add = { s: 0, n: 180, e: 90, w: 270 }[this.face];
		return (((local + add) % 360) + 360) % 360;
	}
}

export interface Prop {
	w: number;
	d: number;
	build(f: Frame): void;
}

export const prop = (w: number, d: number, build: (f: Frame) => void): Prop => ({ w, d, build });

/** World footprint size of a prop facing `face`. */
export function footprint(p: Prop, face: Face): { sx: number; sy: number } {
	return face === 's' || face === 'n' ? { sx: p.w, sy: p.d } : { sx: p.d, sy: p.w };
}

/**
 * Place a prop with its world footprint's min corner at (x, y), floor z,
 * front facing `face` (the direction a person using it looks from). Returns its frame.
 */
export function put(b: MapBuilder, p: Prop, x: number, y: number, z: number, face: Face = 's'): Frame {
	let f: Frame;
	switch (face) {
		case 's':
			f = new Frame(b, x, y, z, 's');
			break;
		case 'n':
			f = new Frame(b, x + p.w, y + p.d, z, 'n');
			break;
		case 'e':
			f = new Frame(b, x + p.d, y, z, 'e');
			break;
		case 'w':
			f = new Frame(b, x, y + p.w, z, 'w');
			break;
	}
	p.build(f);
	return f;
}

/** Place a prop centred on (cx, cy). */
export function putC(b: MapBuilder, p: Prop, cx: number, cy: number, z: number, face: Face = 's'): Frame {
	const { sx, sy } = footprint(p, face);
	return put(b, p, cx - sx / 2, cy - sy / 2, z, face);
}

// ---------------------------------------------------------------------------
// Furniture library

export function crate(s: number, mat = 'crate', h = s): Prop {
	return prop(s, s, (f) => {
		f.box(0, 0, 0, s, s, h - 4, mat);
		f.box(2, 2, h - 4, s - 2, s - 2, h, mat === 'crate' ? 'crate_dark' : mat);
	});
}

/** Crates stacked in a pyramid-ish pile: sizes per layer from the bottom. */
export function crateStack(layers: number[][], s = 48, mat = 'crate'): Prop {
	const w = Math.max(...layers.map((l) => l.length)) * s;
	return prop(w, s, (f) => {
		let z = 0;
		for (const l of layers) {
			l.forEach((on, i) => {
				if (on) crate(s, mat).build(new Frame(f.b, ...offset(f, i * s, 0), f.oz + z, f.face));
			});
			z += s;
		}
	});
}

/** Shift a frame's origin by a local offset (keeps the rotation). */
export function offset(f: Frame, lx: number, ly: number): [number, number] {
	const p = f.at(lx, ly);
	return [p.x, p.y];
}

/** Sub-frame at a local offset and local height. */
export function sub(f: Frame, lx: number, ly: number, lz = 0): Frame {
	const p = f.at(lx, ly, lz);
	return new Frame(f.b, p.x, p.y, p.z, f.face);
}

export const barrel = (mat = 'barrel', band = 'steel'): Prop =>
	prop(40, 40, (f) => {
		const slices: Array<[number, number, number]> = [
			[0, 4, 0],
			[4, 22, 2],
			[22, 26, 0],
			[26, 46, 2],
			[46, 50, 0],
			[50, 56, 2]
		];
		for (const [z0, z1, inset] of slices) f.box(inset, inset, z0, 40 - inset, 40 - inset, z1, inset ? mat : band);
	});

export function table(w: number, d: number, h = 30, top = 'wood', leg = 'wood_dark'): Prop {
	return prop(w, d, (f) => {
		f.box(0, 0, h - 3, w, d, h, top);
		for (const [x, y] of [
			[2, 2],
			[w - 6, 2],
			[2, d - 6],
			[w - 6, d - 6]
		] as const)
			f.box(x, y, 0, x + 4, y + 4, h - 3, leg);
	});
}

export const chair = (mat = 'wood', seat = 'fabric_red'): Prop =>
	prop(28, 28, (f) => {
		for (const [x, y] of [
			[1, 1],
			[24, 1],
			[1, 24],
			[24, 24]
		] as const)
			f.box(x, y, 0, x + 3, y + 3, 16, mat);
		f.box(0, 0, 16, 28, 28, 20, seat);
		f.box(0, 24, 20, 28, 28, 48, mat);
	});

export const stool = (mat = 'chrome', seat = 'leather'): Prop =>
	prop(20, 20, (f) => {
		f.box(8, 8, 0, 12, 12, 26, mat);
		f.box(2, 2, 26, 18, 18, 30, seat);
	});

export function bed(w = 96, d = 128, sheet = 'linen', blanket = 'fabric_blue'): Prop {
	return prop(w, d, (f) => {
		f.box(0, 0, 0, w, d - 8, 16, 'wood');
		f.box(0, d - 8, 0, w, d, 56, 'wood_dark');
		f.box(2, 2, 16, w - 2, d - 10, 26, sheet);
		f.box(2, 2, 26, w - 2, d - 48, 30, blanket);
		f.box(12, d - 36, 26, w - 12, d - 14, 34, 'linen');
	});
}

/** Bunk bed: two decks on posts. */
export const bunk = (): Prop =>
	prop(48, 96, (f) => {
		for (const [x, y] of [
			[0, 0],
			[44, 0],
			[0, 92],
			[44, 92]
		] as const)
			f.box(x, y, 0, x + 4, y + 4, 112, 'steel');
		f.box(4, 0, 12, 44, 96, 20, 'linen');
		f.box(4, 0, 64, 44, 96, 72, 'linen');
		f.box(4, 4, 72, 44, 24, 76, 'fabric_blue');
	});

/**
 * Wardrobe 72 × 56 × 112. Hollow: 4-thick walls with clip-through doors, room
 * for a hull inside (a hiding spot); looks the same as the solid one.
 */
export function wardrobe(hollow = false, mat = 'wood_dark'): Prop {
	return prop(72, 56, (f) => {
		if (hollow) {
			f.box(0, 0, 0, 72, 56, 4, mat);
			f.box(0, 52, 4, 72, 56, 108, mat);
			f.box(0, 0, 4, 4, 52, 108, mat);
			f.box(68, 0, 4, 72, 52, 108, mat);
			f.box(0, 0, 108, 72, 56, 112, mat);
			f.fake(4, 0, 4, 68, 4, 108, mat);
		} else f.box(0, 0, 0, 72, 56, 112, mat);
		f.box(32, -2, 48, 34, 0, 64, 'brass', !hollow);
		f.box(38, -2, 48, 40, 0, 64, 'brass', !hollow);
	});
}

export const desk = (mat = 'wood'): Prop =>
	prop(96, 48, (f) => {
		f.box(0, 0, 28, 96, 48, 32, mat);
		f.box(2, 2, 0, 6, 46, 28, 'wood_dark');
		f.box(62, 2, 4, 94, 46, 28, 'wood_dark');
	});

/** Computer desk: desk + monitor + keyboard. */
export const officeDesk = (): Prop =>
	prop(96, 48, (f) => {
		desk('plastic_white').build(f);
		f.box(36, 28, 32, 60, 32, 36, 'steel');
		f.box(28, 30, 36, 68, 34, 62, 'screen');
		f.box(30, 6, 32, 66, 18, 34, 'plastic_black');
	});

const BOOKS = ['book_red', 'book_blue', 'book_green', 'book_cream', 'book_brown'];

/** Shelf with `levels` boards; `fill` puts books/goods on the boards. */
export function shelf(w: number, h: number, levels: number, fill: 'books' | 'goods' | 'boxes' | 'none' = 'books', seed = 1, d = 24, mat = 'wood'): Prop {
	return prop(w, d, (f) => {
		const r = rng(seed);
		f.box(0, 0, 0, 3, d, h, mat);
		f.box(w - 3, 0, 0, w, d, h, mat);
		f.box(3, d - 2, 0, w - 3, d, h, mat);
		const sp = h / levels;
		for (let k = 0; k <= levels; k++) {
			const z = Math.min(h - 2, k * sp);
			f.box(3, 0, z, w - 3, d - 2, z + 2, mat);
			if (k === levels || fill === 'none') continue;
			let x = 4;
			while (x < w - 10) {
				const gw = fill === 'boxes' ? 16 + Math.floor(r() * 16) : 8 + Math.floor(r() * 18);
				const gh = Math.min(sp - 6, (fill === 'books' ? 0.55 : 0.4) * sp + r() * 0.35 * sp);
				const x1 = Math.min(w - 4, x + gw);
				if (r() > 0.12) {
					const m =
						fill === 'books' ? BOOKS[Math.floor(r() * BOOKS.length)]! : fill === 'boxes' ? 'cardboard' : GOODS[Math.floor(r() * GOODS.length)]!;
					f.box(x, 2, z + 2, x1, d - 4, z + 2 + gh, m);
				}
				x = x1 + 1;
			}
		}
	});
}

const GOODS = ['plastic_red', 'plastic_yellow', 'plastic_blue', 'cardboard', 'plastic_white', 'tin'];

/**
 * Bookcase that is a secret door: the whole unit is clip-through (walk
 * straight through it). Looks like `shelf`.
 */
export function fakeShelf(w: number, h: number, levels: number, seed = 1, d = 24): Prop {
	return prop(w, d, (f) => {
		const real = shelf(w, h, levels, 'books', seed, d);
		const g = new Frame(new MapBuilder(), f.ox, f.oy, f.oz, f.face);
		real.build(g);
		for (const br of g.b.brushes) {
			if (br.type !== 'box') continue;
			f.b.box(br.min.x, br.min.y, br.min.z, br.max.x, br.max.y, br.max.z, br.material, false, 'prop');
		}
	});
}

export function sofa(w = 112, fabric = 'fabric_green'): Prop {
	return prop(w, 44, (f) => {
		f.box(0, 0, 0, w, 32, 18, fabric);
		f.box(0, 32, 0, w, 44, 40, fabric);
		f.box(0, 0, 18, 10, 32, 28, fabric);
		f.box(w - 10, 0, 18, w, 32, 28, fabric);
		f.box(10, 2, 18, w - 10, 30, 22, 'linen');
	});
}

export const armchair = (fabric = 'fabric_red'): Prop => sofa(44, fabric);

export function counter(w: number, h = 42, top = 'marble', body = 'wood_dark', d = 32): Prop {
	return prop(w, d, (f) => {
		f.box(0, 4, 0, w, d, h - 3, body);
		f.box(0, 0, h - 3, w, d, h, top);
	});
}

/** Kitchen run: cabinets with a worktop, a sink and a stove. */
export function kitchen(w: number): Prop {
	return prop(w, 32, (f) => {
		counter(w, 36, 'steel', 'plastic_white').build(f);
		f.box(16, 6, 36, 48, 26, 38, 'chrome');
		f.box(w - 48, 6, 36, w - 16, 26, 37, 'plastic_black');
		f.box(0, 24, 64, w, 32, 96, 'plastic_white');
	});
}

export const fridge = (): Prop =>
	prop(32, 32, (f) => {
		f.box(0, 0, 0, 32, 32, 80, 'plastic_white');
		f.box(26, -2, 36, 28, 0, 60, 'chrome');
	});

export const stove = (): Prop =>
	prop(32, 32, (f) => {
		f.box(0, 0, 0, 32, 32, 34, 'steel');
		f.box(4, 4, 34, 28, 28, 36, 'plastic_black');
	});

export const toilet = (): Prop =>
	prop(20, 30, (f) => {
		f.box(3, 0, 0, 17, 20, 16, 'porcelain');
		f.box(0, 20, 0, 20, 30, 32, 'porcelain');
	});

export const basin = (): Prop =>
	prop(24, 18, (f) => {
		f.box(10, 8, 0, 14, 14, 28, 'porcelain');
		f.box(0, 0, 28, 24, 18, 34, 'porcelain');
		f.box(4, 16, 40, 20, 18, 64, 'mirror');
	});

export const bathtub = (): Prop =>
	prop(64, 32, (f) => {
		f.box(0, 0, 0, 64, 32, 4, 'porcelain');
		f.box(0, 0, 4, 64, 4, 22, 'porcelain');
		f.box(0, 28, 4, 64, 32, 22, 'porcelain');
		f.box(0, 4, 4, 4, 28, 22, 'porcelain');
		f.box(60, 4, 4, 64, 28, 22, 'porcelain');
		f.box(4, 4, 4, 60, 28, 14, 'poolwater');
	});

export const shower = (): Prop =>
	prop(40, 40, (f) => {
		f.box(0, 0, 0, 40, 40, 2, 'tile_white');
		f.box(0, 38, 2, 40, 40, 96, 'tile_white');
		f.box(0, 0, 2, 2, 38, 96, 'glass');
		f.box(18, 30, 80, 22, 38, 84, 'chrome');
	});

export const tv = (): Prop =>
	prop(64, 20, (f) => {
		f.box(0, 0, 0, 64, 20, 24, 'wood_dark');
		f.box(8, 10, 24, 56, 13, 52, 'screen');
	});

export const lamp = (shade = 'lampshade'): Prop =>
	prop(16, 16, (f) => {
		f.box(4, 4, 0, 12, 12, 2, 'brass');
		f.box(7, 7, 2, 9, 9, 56, 'brass');
		f.box(0, 0, 56, 16, 16, 70, shade);
	});

export const plant = (h = 48): Prop =>
	prop(24, 24, (f) => {
		f.box(4, 4, 0, 20, 20, 14, 'terracotta');
		f.box(0, 0, 14, 24, 24, 14 + h * 0.5, 'leaf');
		f.box(4, 4, 14 + h * 0.5, 20, 20, 14 + h, 'leaf_dark');
	});

export const piano = (): Prop =>
	prop(64, 28, (f) => {
		f.box(0, 8, 0, 64, 28, 52, 'plastic_black');
		f.box(0, 0, 26, 64, 8, 30, 'porcelain');
	});

export const poolTable = (): Prop =>
	prop(96, 56, (f) => {
		f.box(8, 8, 0, 88, 48, 24, 'wood_dark');
		f.box(0, 0, 24, 96, 56, 28, 'wood_dark');
		f.box(4, 4, 28, 92, 52, 30, 'felt');
	});

/** Arcade cabinet; `hollow` = clip-through front, a hull fits inside (32 deep interior + body). */
export function arcade(screen = 'screen', hollow = false): Prop {
	return prop(40, 44, (f) => {
		if (hollow) {
			f.box(0, 0, 0, 40, 44, 2, 'plastic_black');
			f.box(0, 40, 2, 40, 44, 88, 'plastic_black');
			f.box(0, 0, 2, 2, 40, 88, 'plastic_black');
			f.box(38, 0, 2, 40, 40, 88, 'plastic_black');
			f.box(0, 0, 88, 40, 44, 96, 'neon_pink');
			f.fake(2, 0, 2, 38, 2, 88, 'plastic_black');
			f.fake(4, -6, 36, 36, 0, 44, 'plastic_red');
			f.fake(6, -1, 50, 34, 0, 78, screen);
		} else {
			f.box(0, 0, 0, 40, 44, 88, 'plastic_black');
			f.box(0, 0, 88, 40, 44, 96, 'neon_pink');
			f.box(4, -6, 36, 36, 0, 44, 'plastic_red');
			f.box(6, -1, 50, 34, 0, 78, screen);
		}
	});
}

export const washer = (): Prop =>
	prop(32, 32, (f) => {
		f.box(0, 0, 0, 32, 32, 40, 'plastic_white');
		f.box(8, -1, 12, 24, 0, 30, 'glass_dark');
	});

export const boiler = (): Prop =>
	prop(64, 64, (f) => {
		f.box(0, 0, 0, 64, 64, 8, 'steel');
		f.box(4, 4, 8, 60, 60, 120, 'rust');
		f.box(24, 24, 120, 40, 40, 176, 'steel');
	});

/** Locker row; `fakeAt` lockers are clip-through doors into a 32+ deep cavity behind (see caller). */
export function lockers(n: number, mat = 'locker'): Prop {
	return prop(n * 24, 20, (f) => {
		for (let i = 0; i < n; i++) {
			f.box(i * 24, 0, 0, i * 24 + 23, 20, 80, mat);
			f.box(i * 24 + 23, 0, 0, i * 24 + 24, 20, 80, 'steel');
			f.box(i * 24 + 4, -1, 60, i * 24 + 18, 0, 64, 'steel');
		}
	});
}

export const pew = (w = 128): Prop =>
	prop(w, 32, (f) => {
		f.box(0, 0, 0, 4, 32, 36, 'wood_dark');
		f.box(w - 4, 0, 0, w, 32, 36, 'wood_dark');
		f.box(4, 4, 16, w - 4, 24, 20, 'wood');
		f.box(4, 24, 16, w - 4, 32, 40, 'wood');
	});

export const bench = (w = 72, mat = 'wood', legs = 'iron'): Prop =>
	prop(w, 24, (f) => {
		f.box(2, 2, 0, 6, 20, 16, legs);
		f.box(w - 6, 2, 0, w - 2, 20, 16, legs);
		f.box(0, 0, 16, w, 18, 19, mat);
		f.box(0, 20, 16, w, 24, 36, mat);
	});

export const streetlamp = (): Prop =>
	prop(16, 16, (f) => {
		f.box(2, 2, 0, 14, 14, 8, 'iron');
		f.box(6, 6, 8, 10, 10, 160, 'iron');
		f.box(0, 0, 160, 16, 16, 176, 'lampglow');
		f.box(4, 4, 176, 12, 12, 180, 'iron');
	});

export const bin = (mat = 'plastic_green'): Prop =>
	prop(24, 24, (f) => {
		f.box(1, 1, 0, 23, 23, 34, mat);
		f.box(0, 0, 34, 24, 24, 38, 'plastic_black');
	});

/**
 * Dumpster 96 × 56 × 68: solid lid (a climbing step). Hollow: the front panel
 * is clip-through and the inside is 56 tall (duck only), a hiding spot.
 */
export function dumpster(hollow = false, mat = 'dumpster'): Prop {
	return prop(96, 56, (f) => {
		if (hollow) {
			f.box(0, 0, 0, 96, 56, 4, mat);
			f.box(0, 52, 4, 96, 56, 60, mat);
			f.box(0, 4, 4, 4, 52, 60, mat);
			f.box(92, 4, 4, 96, 52, 60, mat);
			f.fake(4, 0, 4, 92, 4, 60, mat);
		} else f.box(0, 0, 0, 96, 56, 60, mat);
		f.box(-4, -4, 60, 100, 60, 68, 'plastic_black');
	});
}

/** Vending machine; `fake` = the whole machine is clip-through. */
export function vending(mat = 'plastic_red', fake = false): Prop {
	return prop(44, 32, (f) => {
		f.box(0, 0, 0, 44, 32, 88, mat, !fake);
		f.box(4, -2, 24, 30, 0, 80, 'glass_dark', !fake);
		f.box(32, -2, 48, 40, 0, 72, 'plastic_black', !fake);
	});
}

export function umbrella(canvas = 'canvas_red'): Prop {
	return prop(96, 96, (f) => {
		f.box(46, 46, 0, 50, 50, 84, 'chrome');
		f.box(0, 0, 84, 96, 96, 88, canvas);
		f.box(16, 16, 88, 80, 80, 94, canvas);
		f.box(36, 36, 94, 60, 60, 100, 'canvas_white');
	});
}

export const sunbed = (mat = 'plastic_white', towel = 'fabric_blue'): Prop =>
	prop(28, 76, (f) => {
		f.box(0, 0, 0, 4, 4, 12, mat);
		f.box(24, 0, 0, 28, 4, 12, mat);
		f.box(0, 72, 0, 4, 76, 12, mat);
		f.box(24, 72, 0, 28, 76, 12, mat);
		f.box(0, 0, 12, 28, 56, 15, mat);
		f.box(4, 4, 15, 24, 52, 16, towel);
		f.box(0, 56, 12, 28, 76, 30, mat);
	});

export function car(paint: string): Prop {
	return prop(80, 184, (f) => {
		// Wheels under the body corners; chassis between them.
		for (const [x, y] of [
			[0, 24],
			[64, 24],
			[0, 128],
			[64, 128]
		] as const)
			f.box(x, y, 0, x + 16, y + 32, 20, 'tyre');
		f.box(16, 16, 8, 64, 168, 20, 'plastic_black');
		f.box(0, 0, 20, 80, 184, 44, paint);
		f.box(6, 56, 44, 74, 64, 64, 'glass_dark');
		f.box(6, 64, 44, 74, 140, 64, 'cartint');
		f.box(6, 140, 44, 74, 148, 62, 'glass_dark');
		f.box(6, 60, 64, 74, 144, 68, paint);
		f.box(8, -2, 30, 22, 0, 38, 'lampglow');
		f.box(58, -2, 30, 72, 0, 38, 'lampglow');
		f.box(8, 184, 30, 22, 186, 38, 'taillight');
		f.box(58, 184, 30, 72, 186, 38, 'taillight');
	});
}

/** Van: taller box body (roof at 96, a climbing step). */
export function van(paint: string): Prop {
	return prop(84, 216, (f) => {
		for (const [x, y] of [
			[0, 24],
			[68, 24],
			[0, 160],
			[68, 160]
		] as const)
			f.box(x, y, 0, x + 16, y + 32, 22, 'tyre');
		f.box(16, 16, 8, 68, 200, 22, 'plastic_black');
		f.box(0, 0, 22, 84, 216, 48, paint);
		f.box(4, 8, 48, 80, 52, 80, 'glass_dark');
		f.box(0, 52, 48, 84, 216, 96, paint);
		f.box(4, 0, 48, 80, 8, 64, paint);
		f.box(0, 8, 80, 84, 52, 88, paint);
	});
}

/**
 * Shipping container 96 × 320 × 104 (local front = an open end when `open`).
 * Open: hollow with 4-thick walls; the end at local y = 0 is open, a hiding
 * room. `fakeEnd`: the open end is closed by clip-through doors.
 */
export function container(mat: string, open = false, fakeEnd = false): Prop {
	return prop(96, 320, (f) => {
		if (!open) {
			f.box(0, 0, 0, 96, 320, 104, mat);
			return;
		}
		f.box(0, 0, 0, 96, 320, 4, mat);
		f.box(0, 0, 100, 96, 320, 104, mat);
		f.box(0, 0, 4, 4, 320, 100, mat);
		f.box(92, 0, 4, 96, 320, 100, mat);
		f.box(4, 316, 4, 92, 320, 100, mat);
		if (fakeEnd) f.fake(4, 0, 4, 92, 4, 100, mat);
	});
}

/** Broadleaf tree: trunk + three canopy tiers (canopy top = standable). */
export function tree(h = 128, r = 80, leaf = 'leaf'): Prop {
	return prop(2 * r, 2 * r, (f) => {
		f.box(r - 10, r - 10, 0, r + 10, r + 10, h, 'bark');
		f.box(0, 0, h, 2 * r, 2 * r, h + 56, leaf);
		f.box(r * 0.25, r * 0.25, h + 56, r * 1.75, r * 1.75, h + 104, leaf === 'leaf' ? 'leaf_dark' : leaf);
		f.box(r * 0.55, r * 0.55, h + 104, r * 1.45, r * 1.45, h + 132, leaf);
	});
}

/** Pine: trunk + narrowing tiers. */
export const pine = (h = 64): Prop =>
	prop(128, 128, (f) => {
		f.box(56, 56, 0, 72, 72, h, 'bark');
		let z = h;
		for (const r of [64, 50, 36, 22, 10]) {
			f.box(64 - r, 64 - r, z, 64 + r, 64 + r, z + 40, 'pine');
			z += 40;
		}
	});

/** Palm: leaning segmented trunk + a cross of fronds. */
export const palm = (h = 256): Prop =>
	prop(192, 192, (f) => {
		const n = 8;
		const seg = h / n;
		for (let i = 0; i < n; i++) {
			const o = 88 + Math.round(i * 1.5);
			f.box(o, 88, i * seg, o + 16, 104, (i + 1) * seg, 'palm_trunk');
		}
		const cx = 88 + Math.round(n * 1.5) + 8;
		f.box(cx - 16, 80, h, cx + 16, 112, h + 16, 'palm');
		f.box(cx - 96, 88, h + 4, cx - 16, 104, h + 12, 'palm');
		f.box(cx + 16, 88, h + 4, cx + 96, 104, h + 12, 'palm');
		f.box(cx - 8, 0, h + 4, cx + 8, 80, h + 12, 'palm');
		f.box(cx - 8, 112, h + 4, cx + 8, 192, h + 12, 'palm');
	});

export const bush = (s = 48, mat = 'hedge'): Prop =>
	prop(s, s, (f) => {
		f.box(0, 0, 0, s, s, s * 0.6, mat);
		f.box(s * 0.2, s * 0.2, s * 0.6, s * 0.8, s * 0.8, s * 0.85, mat);
	});

/** Fence along local x: posts every 64 and two rails between them. */
export function fence(len: number, h = 48, mat = 'wood_light'): Prop {
	return prop(len, 4, (f) => {
		const n = Math.max(1, Math.round(len / 64));
		const step = len / n;
		for (let i = 0; i <= n; i++) {
			const x = Math.min(len - 4, Math.max(0, i * step - 2));
			f.box(x, 0, 0, x + 4, 4, h, mat);
			if (i < n) {
				const x1 = Math.min(len - 4, Math.max(0, (i + 1) * step - 2));
				f.box(x + 4, 1, h * 0.35, x1, 3, h * 0.35 + 6, mat);
				f.box(x + 4, 1, h - 12, x1, 3, h - 6, mat);
			}
		}
	});
}

export const cone = (): Prop =>
	prop(16, 16, (f) => {
		f.box(0, 0, 0, 16, 16, 2, 'plastic_orange');
		f.box(4, 4, 2, 12, 12, 20, 'plastic_orange');
		f.box(6, 6, 20, 10, 10, 28, 'plastic_white');
	});

export const pallet = (load = false): Prop =>
	prop(48, 48, (f) => {
		f.box(0, 0, 0, 48, 6, 4, 'wood_light');
		f.box(0, 21, 0, 48, 27, 4, 'wood_light');
		f.box(0, 42, 0, 48, 48, 4, 'wood_light');
		f.box(0, 0, 4, 48, 48, 8, 'wood_light');
		if (load) f.box(2, 2, 8, 46, 46, 40, 'cardboard');
	});

export const tyres = (n = 3): Prop =>
	prop(28, 28, (f) => {
		for (let i = 0; i < n; i++) f.box(0, 0, i * 10, 28, 28, i * 10 + 10, 'tyre');
	});

export const keg = (): Prop =>
	prop(20, 20, (f) => {
		f.box(0, 0, 0, 20, 20, 26, 'steel');
	});

export const acUnit = (): Prop =>
	prop(64, 48, (f) => {
		f.box(0, 0, 0, 64, 48, 40, 'steel');
		f.box(8, -1, 8, 56, 0, 34, 'vent');
		f.box(16, 8, 40, 48, 40, 44, 'vent');
	});

/** Roof water tank on legs; hollow = clip-through front panel, room inside. */
export function waterTank(hollow = false): Prop {
	return prop(128, 128, (f) => {
		for (const [x, y] of [
			[0, 0],
			[120, 0],
			[0, 120],
			[120, 120]
		] as const)
			f.box(x, y, 0, x + 8, y + 8, 16, 'steel');
		if (hollow) {
			f.box(0, 0, 16, 128, 128, 20, 'tank');
			f.box(0, 124, 20, 128, 128, 120, 'tank');
			f.box(0, 4, 20, 4, 124, 120, 'tank');
			f.box(124, 4, 20, 128, 124, 120, 'tank');
			f.box(0, 0, 120, 128, 128, 128, 'tank');
			f.fake(4, 0, 20, 124, 4, 120, 'tank');
		} else f.box(0, 0, 16, 128, 128, 128, 'tank');
	});
}

export const chimney = (h = 96): Prop =>
	prop(48, 32, (f) => {
		f.box(0, 0, 0, 48, 32, h, 'brick');
		f.box(-4, -4, h, 52, 36, h + 8, 'stone');
	});

export const dish = (): Prop =>
	prop(48, 48, (f) => {
		f.box(20, 20, 0, 28, 28, 32, 'steel');
		f.box(0, 16, 32, 48, 24, 72, 'plastic_white');
	});

/** Market stall: counter, four posts, striped awning (awning top at 112). */
export function stall(stripes: [string, string], goods = 'goods'): Prop {
	return prop(128, 64, (f) => {
		f.box(0, 0, 0, 128, 32, 36, 'wood');
		for (const [x, y] of [
			[0, -4],
			[124, -4],
			[0, 60],
			[124, 60]
		] as const)
			f.box(x, y, 0, x + 4, y + 4, 104, 'wood_dark');
		for (let i = 0; i < 4; i++) f.box(i * 32, -8, 104, i * 32 + 32, 72, 112, stripes[i % 2]!);
		if (goods === 'goods') {
			const r = rng(Math.round(f.ox * 7 + f.oy));
			for (let i = 0; i < 5; i++) {
				const x = 6 + i * 24;
				f.box(x, 6, 36, x + 18, 26, 36 + 6 + Math.floor(r() * 10), GOODS[Math.floor(r() * GOODS.length)]!);
			}
		}
	});
}

/** Rowing boat; hollow = clip-through cover, duck-height room inside. */
export function boat(hollow = false, hull = 'boat'): Prop {
	return prop(72, 192, (f) => {
		f.box(8, 8, 0, 64, 184, 8, hull);
		f.box(0, 0, 8, 72, 192, 12, hull);
		if (hollow) {
			// Covered boat: 60 tall inside (duck only), clip-through bow and cover.
			f.box(0, 0, 12, 4, 192, 76, hull);
			f.box(68, 0, 12, 72, 192, 76, hull);
			f.box(4, 188, 12, 68, 192, 76, hull);
			f.fake(4, 0, 12, 68, 4, 76, hull);
			f.fake(4, 4, 72, 68, 188, 76, 'canvas_blue');
		} else {
			f.box(0, 0, 12, 4, 192, 40, hull);
			f.box(68, 0, 12, 72, 192, 40, hull);
			f.box(4, 188, 12, 68, 192, 40, hull);
			f.box(4, 0, 12, 68, 4, 40, hull);
			f.box(4, 80, 12, 68, 96, 24, 'wood');
		}
	});
}

export const lifebuoy = (): Prop =>
	prop(32, 8, (f) => {
		f.box(0, 4, 0, 4, 8, 64, 'wood');
		f.box(4, 0, 40, 28, 4, 44, 'plastic_red');
		f.box(4, 0, 60, 28, 4, 64, 'plastic_red');
		f.box(4, 0, 44, 8, 4, 60, 'plastic_white');
		f.box(24, 0, 44, 28, 4, 60, 'plastic_white');
	});

export const surfboard = (mat = 'plastic_yellow'): Prop =>
	prop(24, 6, (f) => {
		f.box(0, 0, 0, 24, 6, 88, mat);
	});

export const swingSet = (): Prop =>
	prop(160, 64, (f) => {
		f.box(0, 0, 0, 6, 6, 112, 'iron');
		f.box(0, 58, 0, 6, 64, 112, 'iron');
		f.box(154, 0, 0, 160, 6, 112, 'iron');
		f.box(154, 58, 0, 160, 64, 112, 'iron');
		f.box(0, 6, 106, 6, 58, 112, 'iron');
		f.box(154, 6, 106, 160, 58, 112, 'iron');
		f.box(6, 29, 106, 154, 35, 112, 'iron');
		for (const x of [36, 100]) {
			f.box(x, 31, 20, x + 2, 33, 106, 'chain');
			f.box(x + 22, 31, 20, x + 24, 33, 106, 'chain');
			f.box(x, 22, 16, x + 24, 42, 20, 'plastic_red');
		}
	});

/** Telephone box 72 × 72 × 120: open front (local y = 0), handset on the back wall. */
export const phoneBox = (): Prop =>
	prop(72, 72, (f) => {
		f.box(0, 0, 0, 72, 72, 4, 'phone_red');
		f.box(0, 68, 4, 72, 72, 108, 'phone_red');
		f.box(0, 0, 4, 4, 68, 108, 'phone_red');
		f.box(68, 0, 4, 72, 68, 108, 'phone_red');
		f.box(0, 0, 108, 72, 72, 120, 'phone_red');
		f.box(26, 62, 48, 46, 68, 72, 'plastic_black');
		f.box(4, 0, 96, 68, 4, 108, 'phone_red');
	});

export const flowerBed = (w: number, d: number, flower = 'flower_pink'): Prop =>
	prop(w, d, (f) => {
		f.box(0, 0, 0, w, 6, 16, 'stone');
		f.box(0, d - 6, 0, w, d, 16, 'stone');
		f.box(0, 6, 0, 6, d - 6, 16, 'stone');
		f.box(w - 6, 6, 0, w, d - 6, 16, 'stone');
		f.box(6, 6, 0, w - 6, d - 6, 12, 'soil');
		for (let x = 12; x + 12 <= w - 12; x += 28)
			for (let y = 12; y + 12 <= d - 12; y += 28) f.box(x, y, 12, x + 12, y + 12, 22, flower);
	});

/** Gravestone. */
export const grave = (): Prop =>
	prop(40, 64, (f) => {
		f.box(0, 0, 0, 40, 64, 6, 'stone');
		f.box(6, 52, 6, 34, 60, 44, 'stone');
	});

export const bikeRack = (): Prop =>
	prop(96, 24, (f) => {
		for (let x = 0; x <= 84; x += 28) {
			f.box(x, 10, 0, x + 4, 14, 28, 'chrome');
			f.box(x + 4, 4, 0, x + 6, 20, 26, 'tyre');
		}
		f.box(0, 10, 28, 88, 14, 32, 'chrome');
	});

/** The same prop, entirely clip-through (a disguised secret door). */
export function fakeOf(p: Prop): Prop {
	return prop(p.w, p.d, (f) => {
		const g = new Frame(new MapBuilder(), f.ox, f.oy, f.oz, f.face);
		p.build(g);
		for (const br of g.b.brushes) {
			if (br.type !== 'box') continue;
			f.b.box(br.min.x, br.min.y, br.min.z, br.max.x, br.max.y, br.max.z, br.material, false, 'prop');
		}
	});
}

/** Hollow box shell (4 thick) in world coords; `fakeSides` lists sides that are clip-through ('n','s','e','w','top'). */
export function shell(b: MapBuilder, r: Rect, z0: number, z1: number, mat: string, fakeSides: Array<'n' | 's' | 'e' | 'w' | 'top'>, t = 4, allFake = false): void {
	const f = (s: 'n' | 's' | 'e' | 'w' | 'top') => allFake || fakeSides.includes(s);
	b.box(r.x0, r.y0, z0, r.x1, r.y1, z0 + t, mat, !allFake, 'prop');
	b.box(r.x0, r.y0, z0 + t, r.x1, r.y0 + t, z1 - t, mat, !f('s'), 'prop');
	b.box(r.x0, r.y1 - t, z0 + t, r.x1, r.y1, z1 - t, mat, !f('n'), 'prop');
	b.box(r.x0, r.y0 + t, z0 + t, r.x0 + t, r.y1 - t, z1 - t, mat, !f('w'), 'prop');
	b.box(r.x1 - t, r.y0 + t, z0 + t, r.x1, r.y1 - t, z1 - t, mat, !f('e'), 'prop');
	b.box(r.x0, r.y0, z1 - t, r.x1, r.y1, z1, mat, !f('top'), 'prop');
}
