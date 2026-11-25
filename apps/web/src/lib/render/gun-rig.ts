/**
 * Moving parts of the first-person guns (tools/models/procedural/README.md,
 * "Moving parts"): the named nodes of a loaded gun file, how far each one moves
 * and in which direction, and the points where hands take hold and cases leave.
 * A gun file without named nodes has an empty rig; the code-built guns have none.
 *
 * Part nodes have their origin on their pivot or slide axis. Axes are the ones
 * of the gun: +X right, +Y up, the bore along −Z. Distances here are model
 * units of the gun (as in `GENERATED.<id>.fp`), angles radians.
 */
import type { WeaponId } from '@surf/shared';
import * as THREE from 'three';
import type { V3 } from './weapon-assets.js';

export const PART_NAMES = ['slide', 'bolt', 'mag', 'cover', 'belt', 'trigger'] as const;
export type PartName = (typeof PART_NAMES)[number];
/**
 * Points: `eject` (the ejection port, +X is the way a case leaves), `magwell` (the
 * seat of the magazine, −Y is the way out), `grip_mag` and `grip_bolt` (where a hand takes
 * hold of the magazine and of the charging handle, slide or bolt knob; they move
 * with that part), `hand_r` and `hand_l` (grip and fore-end).
 */
export const POINT_NAMES = ['eject', 'magwell', 'grip_mag', 'grip_bolt', 'hand_r', 'hand_l'] as const;
export type PointName = (typeof POINT_NAMES)[number];

/** One motion of a part: a turn about an axis through its origin, or a slide along a direction, `to` at full travel. */
export interface PartStep {
	kind: 'turn' | 'slide';
	axis: V3;
	to: number;
}

export type GunId = Exclude<WeaponId, 'knife' | 'claws'>;

const turn = (axis: V3, to: number): PartStep => ({ kind: 'turn', axis, to });
const slide = (axis: V3, to: number): PartStep => ({ kind: 'slide', axis, to });
/** A trigger goes back: its blade hangs down from the pin. */
const TRIGGER = [turn([1, 0, 0], -0.28)] as const;

/**
 * The parts of each gun and their travel, in the order the steps happen. A magazine slides out of its
 * seat along `magwell` −Y; its full travel is clear of the gun.
 */
export const GUN_PARTS: Readonly<Record<GunId, Readonly<Partial<Record<PartName, readonly PartStep[]>>>>> = {
	pistol: {
		slide: [slide([0, 0, 1], 3.0)],
		mag: [slide([0, -Math.cos(0.308), Math.sin(0.308)], 7)],
		trigger: TRIGGER
	},
	smg: {
		bolt: [slide([0, 0, 1], 3.0)],
		mag: [slide([0, -1, 0], 4.5)],
		trigger: TRIGGER
	},
	lmg: {
		bolt: [slide([0, 0, 1], 4.0)],
		cover: [turn([1, 0, 0], -1.0)],
		mag: [slide([0, -1, 0], 5.5)],
		// Up off the tray and out of the mouth of the box, then to the left.
		belt: [slide([-0.5, 0.87, 0], 3.0)],
		trigger: TRIGGER
	},
	sniper: {
		bolt: [turn([0, 0, 1], 1.05), slide([0, 0, 1], 4.2)],
		mag: [slide([0, -1, 0], 4.0)],
		trigger: TRIGGER
	},
	barrett: {
		bolt: [slide([0, 0, 1], 3.4)],
		mag: [slide([0, -Math.cos(0.075), Math.sin(0.075)], 8)],
		trigger: TRIGGER
	},
	striker: {
		bolt: [slide([0, 0, 1], 4.0)],
		mag: [slide([0, -1, 0], 6)],
		trigger: TRIGGER
	}
};

/** The motion of a part of a weapon; none for a weapon or a part without one. */
export function partSteps(id: WeaponId, part: PartName): readonly PartStep[] {
	return (GUN_PARTS as Partial<Record<WeaponId, Partial<Record<PartName, readonly PartStep[]>>>>)[id]?.[part] ?? [];
}

/** Progress `t` (0..1) over all steps of a motion, one after the other, as an amount per step. */
export function stepAmounts(steps: number, t: number): number[] {
	return Array.from({ length: steps }, (_, i) => Math.min(1, Math.max(0, t * steps - i)));
}

const Q = new THREE.Quaternion();
const A = new THREE.Vector3();
const E = new THREE.Euler();

interface Part {
	node: THREE.Object3D;
	position: THREE.Vector3;
	quaternion: THREE.Quaternion;
}

/** Middles between the rounds of the belt, along it from the feed (tools/models/procedural/lmg.py RND), model units. */
const BELT_CUTS = [0.415, 1.13, 1.815, 2.53, 3.29, 4.06, 4.82];
/** The belt lies in the tray up to here (x from its origin), then hangs down. */
const BELT_EDGE = 0.35;
/** The origin of the belt part, along the belt. */
const BELT_AT = 2.15;
/** The places of the rounds, from the feed on, and the next one down in the box (x, y; tools/models/procedural/lmg.py RND), model units. */
const BELT_WAY: readonly (readonly [number, number])[] = [[-0.05, 1.5], [-0.78, 1.5], [-1.48, 1.5], [-2.15, 1.4], [-2.564, 0.637], [-2.75, -0.125], [-2.614, -0.888], [-2.25, -1.65], [-2.2, -2.4]];

/** The belt of a gun: its triangles in the order of its rounds, where each round ends in the index, and the vertices of each round. */
interface Belt {
	geometry: THREE.BufferGeometry | null;
	ends: number[];
	/** Round of every vertex, its place at rest, and one pitch from the feed to the next (in the space of the mesh), per round. */
	round: Uint8Array;
	rest: Float32Array;
	way: THREE.Vector3[];
	fed: number;
}

function beltOf(node: THREE.Object3D, rest: THREE.Vector3, len: number): Belt {
	let mesh: THREE.Mesh | null = null;
	node.traverse((o) => {
		if (o instanceof THREE.Mesh) mesh ??= o;
	});
	const m = mesh as THREE.Mesh | null;
	if (!m) return { geometry: null, ends: [], round: new Uint8Array(0), rest: new Float32Array(0), way: [], fed: 0 };
	const g = m.geometry as THREE.BufferGeometry;
	// From the mesh to the space the part moves in.
	const to = new THREE.Matrix4();
	for (let o: THREE.Object3D | null = m; o; o = o.parent) {
		const at = o === node ? rest : o.position;
		to.premultiply(new THREE.Matrix4().compose(at, o.quaternion, o.scale));
		if (o === node) break;
	}
	const pos = g.getAttribute('position');
	const n = g.index ? g.index.count : pos.count;
	const rounds: number[][] = Array.from({ length: BELT_CUTS.length + 1 }, () => []);
	for (let i = 0; i < n; i += 3) {
		const v = [0, 1, 2].map((k) => (g.index ? g.index.getX(i + k) : i + k));
		let x = 0;
		let y = 0;
		for (const k of v) {
			A.fromBufferAttribute(pos, k).applyMatrix4(to).sub(rest).multiplyScalar(len / 3);
			x += A.x;
			y += A.y;
		}
		const s = x > BELT_EDGE ? BELT_AT - x : BELT_AT - y;
		const k = BELT_CUTS.findIndex((c) => s < c);
		rounds[k < 0 ? BELT_CUTS.length : k]!.push(...v);
	}
	const ends: number[] = [];
	let end = 0;
	for (const r of rounds) ends.push((end += r.length));
	g.setIndex(rounds.flat());
	// A part of the belt moves as one piece: corners at one place belong together, however the triangles are sorted.
	const place = new Map<string, number>();
	const group = Int32Array.from({ length: pos.count }, (_, i) => {
		const key = pos.getX(i).toFixed(6) + ',' + pos.getY(i).toFixed(6) + ',' + pos.getZ(i).toFixed(6);
		const first = place.get(key);
		if (first === undefined) place.set(key, i);
		return first ?? i;
	});
	const find = (i: number): number => {
		while (group[i] !== i) i = group[i] = group[group[i]!]!;
		return i;
	};
	rounds.forEach((r) => {
		for (let i = 0; i < r.length; i += 3) for (const k of [1, 2]) group[find(r[i + k]!)] = find(r[i]!);
	});
	// Its round: the nearest one to its feed end.
	const of = new Map<number, number>();
	rounds.forEach((r, k) => {
		for (const v of r) if (!of.has(find(v))) of.set(find(v), k);
	});
	const round = Uint8Array.from({ length: pos.count }, (_, i) => of.get(find(i)) ?? 0);
	const back = to.clone().invert();
	const way = rounds.map((_, k) => {
		const a = BELT_WAY[k]!;
		const b = BELT_WAY[k + 1]!;
		return new THREE.Vector3((b[0] - a[0]) / len, (b[1] - a[1]) / len, 0).transformDirection(back).multiplyScalar(Math.hypot(b[0] - a[0], b[1] - a[1]) / len / to.getMaxScaleOnAxis());
	});
	return { geometry: g, ends, round, rest: Float32Array.from({ length: pos.count * 3 }, (_, i) => pos.getComponent((i / 3) | 0, i % 3)), way, fed: 0 };
}

/** The named nodes of one loaded gun, with their rest pose. `len`: model units per unit of the nodes' space. */
export class GunRig {
	private readonly parts = new Map<PartName, Part>();
	private readonly points = new Map<PointName, THREE.Object3D>();
	private belt: Belt | null = null;

	constructor(
		readonly id: WeaponId,
		root: THREE.Object3D,
		readonly len: number
	) {
		const find = (o: THREE.Object3D) => {
			for (const n of PART_NAMES) if (o.name === n && !this.parts.has(n)) this.parts.set(n, { node: o, position: o.position.clone(), quaternion: o.quaternion.clone() });
			for (const n of POINT_NAMES) if (o.name === n && !this.points.has(n)) this.points.set(n, o);
			for (const c of o.children) find(c);
		};
		find(root);
	}

	/** Names of the parts the file has. */
	get names(): PartName[] {
		return [...this.parts.keys()];
	}

	/** The node of a part, if the file has it. */
	part(name: PartName): THREE.Object3D | undefined {
		return this.parts.get(name)?.node;
	}

	/** Where a part is at rest, in the space of its parent. */
	restOf(name: PartName): { readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion } | undefined {
		return this.parts.get(name);
	}

	/** The node of a point, if the file has it. */
	point(name: PointName): THREE.Object3D | undefined {
		return this.points.get(name);
	}

	/**
	 * Put a part `t` along its travel: 0 at rest, 1 at the end. A number runs the steps one
	 * after the other; a list gives each step its own amount (the sniper bolt: lift, slide).
	 * `at` (model units) and `turn` (Euler XYZ, about the origin of the part) take it further, off its
	 * track: a magazine in the hand. False when the gun has no such part.
	 */
	move(name: PartName, t: number | ArrayLike<number>, at?: readonly number[], turn?: readonly number[]): boolean {
		const p = this.parts.get(name);
		const steps = partSteps(this.id, name);
		if (!p) return false;
		const amounts = typeof t === 'number' ? stepAmounts(steps.length, t) : t;
		p.node.position.copy(p.position);
		p.node.quaternion.copy(p.quaternion);
		steps.forEach((s, i) => {
			const k = Math.min(1, Math.max(0, amounts[i] ?? 0)) * s.to;
			A.set(s.axis[0], s.axis[1], s.axis[2]).normalize();
			if (s.kind === 'slide') p.node.position.addScaledVector(A, k / this.len);
			else p.node.quaternion.premultiply(Q.setFromAxisAngle(A, k));
		});
		if (at) p.node.position.addScaledVector(A.set(at[0]!, at[1]!, at[2]!), 1 / this.len);
		if (turn) p.node.quaternion.premultiply(Q.setFromEuler(E.set(turn[0]!, turn[1]!, turn[2]!)));
		return true;
	}

	/** Show the first `n` rounds of the belt, from the feed on: the rest has gone through the gun. */
	beltRounds(n: number): void {
		const p = this.parts.get('belt');
		if (!p) return;
		this.belt ??= beltOf(p.node, p.position, this.len);
		const k = Math.max(0, Math.min(this.belt.ends.length, Math.floor(n)));
		const g = this.belt.geometry;
		g?.setDrawRange(0, Infinity);
		if (k < this.belt.ends.length) g?.setDrawRange(0, k > 0 ? this.belt.ends[k - 1]! : 0);
	}

	/**
	 * The belt on its way into the gun after a shot: every round `back` (1..0) of a pitch behind its place, along the way
	 * the belt takes out of the box, over the edge of the tray and into the feed.
	 */
	beltFeed(back: number): void {
		const p = this.parts.get('belt');
		if (!p) return;
		const b = (this.belt ??= beltOf(p.node, p.position, this.len));
		if (!b.geometry || b.fed === back) return;
		b.fed = back;
		const pos = b.geometry.getAttribute('position') as THREE.BufferAttribute;
		for (let i = 0; i < pos.count; i++) {
			const w = b.way[b.round[i]!]!;
			pos.setXYZ(i, b.rest[i * 3]! + w.x * back, b.rest[i * 3 + 1]! + w.y * back, b.rest[i * 3 + 2]! + w.z * back);
		}
		pos.needsUpdate = true;
	}

	/** Every part back to its rest pose, and shown. */
	reset(): void {
		this.beltRounds(Infinity);
		this.beltFeed(0);
		for (const p of this.parts.values()) {
			p.node.position.copy(p.position);
			p.node.quaternion.copy(p.quaternion);
			p.node.visible = true;
		}
	}
}
