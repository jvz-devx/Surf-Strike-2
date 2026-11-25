/**
 * Measures the server's player hit capsules (shared zombies/hitbox.ts) against
 * the moving characters as drawn: the real CharacterModel, animated and skinned
 * on the CPU, next to the body the server follows (shared PlayerBody). Not a
 * test file; used by infected-motion.test.ts.
 */
import { copyMotion, lerpMotion, PLAYER_HOLDS, playerCapsules, PlayerBody, rayPlayer, restMotion, type PlayerPose, type WeaponId } from '@surf/shared';
import * as THREE from 'three';
import { cycleDistance, emptyMotion, gaitShape, type MotionState } from './character/animator.js';
import type { HeldAssets, HeldItem } from './character/held.js';
import { CharacterModel, personOf, type CharacterRole } from './character/model.js';
import { BONES } from './character/skeleton.js';

export const ITEMS = Object.keys(PLAYER_HOLDS) as HeldItem[];
export interface Look {
	role: CharacterRole;
	held: HeldItem | 'claws' | null;
}

export const REGIONS = ['torso', 'arms', 'legs'] as const;
export type Region = (typeof REGIONS)[number];
export type PerRegion = Record<Region, number>;
export const perRegion = (v = 0): PerRegion => ({ torso: v, arms: v, legs: v });
const TORSO = 0;
const ARMS = 1;
const LEGS = 2;
const NONE = 3;

const boneRegion = (name: string): number => (/^(thigh|shin|foot|toe)/.test(name) ? LEGS : /^(clav|upper|fore|hand|fingers|tips)/.test(name) ? ARMS : TORSO);
const partRegion = (name: string): number => (/^(thigh|shin|foot)/.test(name) ? LEGS : /^(upperArm|foreArm|hand)/.test(name) ? ARMS : TORSO);

/** A character, the body the server follows for it, and what they do. */
export class Subject {
	readonly model: CharacterModel;
	readonly body = new PlayerBody();
	readonly s: MotionState;
	readonly pos: Float32Array;
	readonly region: Uint8Array;
	private readonly debt = { server: 0 };

	constructor(
		readonly look: Look,
		assets: HeldAssets,
		motion: Partial<MotionState> = {}
	) {
		const m = (this.model = new CharacterModel({ ...personOf(1), style: 'swept' }, assets));
		m.setRole(look.role);
		m.setHeld(look.held);
		this.s = { ...emptyMotion(), ...motion };
		const si = m.mesh.geometry.getAttribute('skinIndex');
		const sw = m.mesh.geometry.getAttribute('skinWeight');
		this.pos = new Float32Array(si.count * 3);
		this.region = new Uint8Array(si.count);
		for (let i = 0; i < si.count; i++) {
			let most = 0;
			for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > sw.getComponent(i, most)) most = k;
			const bone = BONES[si.getComponent(i, most)]!;
			// Talons are not part of the body.
			this.region[i] = look.held === 'claws' && bone.startsWith('tips') ? NONE : boneRegion(bone);
		}
	}

	/** Both sides see the same input for `dt` seconds: the client draws a frame, the server steps at 64 Hz. */
	step(dt: number): void {
		this.model.animator.update(dt, this.s);
		for (this.debt.server += dt; this.debt.server >= 1 / 64 - 1e-9; this.debt.server -= 1 / 64) this.body.follow(1, 1 / 64, this.s);
	}

	settle(seconds = 1.5): void {
		for (let t = 0; t < seconds; t += 1 / 60) this.step(1 / 60);
	}

	/** Server's hit pose, feet at the origin, facing +x. */
	pose(): PlayerPose {
		const motion = restMotion();
		copyMotion(this.body.motion, motion);
		return { x: 0, y: 0, z: 0, yaw: 0, ducked: this.s.ducked, hunched: this.look.role !== 'none', held: this.look.held as WeaponId | null, pitch: this.s.pitch, motion };
	}

	/** Skin the mesh as it is drawn now into `pos` (model axes). */
	skin(stride = 1): Float32Array {
		const { pos } = this;
		const sk = this.model.mesh.skeleton as THREE.Skeleton & { dirty: boolean };
		sk.dirty = true;
		sk.update();
		const mats = sk.boneMatrices as unknown as Float32Array;
		const g = this.model.mesh.geometry;
		const p = g.getAttribute('position').array;
		const si = g.getAttribute('skinIndex');
		const sw = g.getAttribute('skinWeight');
		for (let i = 0; i < si.count; i += stride) {
			const px = p[i * 3]!;
			const py = p[i * 3 + 1]!;
			const pz = p[i * 3 + 2]!;
			let x = 0;
			let y = 0;
			let z = 0;
			for (let k = 0; k < 4; k++) {
				const w = sw.getComponent(i, k);
				if (w === 0) continue;
				const o = si.getComponent(i, k) * 16;
				x += w * (mats[o]! * px + mats[o + 4]! * py + mats[o + 8]! * pz + mats[o + 12]!);
				y += w * (mats[o + 1]! * px + mats[o + 5]! * py + mats[o + 9]! * pz + mats[o + 13]!);
				z += w * (mats[o + 2]! * px + mats[o + 6]! * py + mats[o + 10]! * pz + mats[o + 14]!);
			}
			pos[i * 3] = x;
			pos[i * 3 + 1] = y;
			pos[i * 3 + 2] = z;
		}
		return pos;
	}

	get index(): ArrayLike<number> {
		return this.model.mesh.geometry.getIndex()!.array;
	}

	dispose(): void {
		this.model.dispose();
	}
}

/** Capsules of a pose in model axes: ax ay az bx by bz r, and their region. */
export interface Caps {
	n: number;
	v: Float64Array;
	region: Uint8Array;
	part: string[];
}
export function caps(p: PlayerPose): Caps {
	const list = playerCapsules(p);
	const v = new Float64Array(list.length * 7);
	list.forEach((c, i) => v.set([c.a.x, c.a.z, -c.a.y, c.b.x, c.b.z, -c.b.y, c.r], i * 7));
	return { n: list.length, v, region: Uint8Array.from(list, (c) => partRegion(c.part)), part: list.map((c) => c.part) };
}

/** How far a point is outside the capsules (negative inside); stops at the first capsule deeper than `enough`. */
export function outside(x: number, y: number, z: number, c: Caps, enough = -Infinity, skip = -1): number {
	let best = Infinity;
	const v = c.v;
	for (let i = 0, k = 0; i < c.n; i++, k += 7) {
		if (i === skip) continue;
		const ax = v[k]!;
		const ay = v[k + 1]!;
		const az = v[k + 2]!;
		const bx = v[k + 3]! - ax;
		const by = v[k + 4]! - ay;
		const bz = v[k + 5]! - az;
		const px = x - ax;
		const py = y - ay;
		const pz = z - az;
		const l = bx * bx + by * by + bz * bz;
		let h = l > 1e-9 ? (px * bx + py * by + pz * bz) / l : 0;
		h = h < 0 ? 0 : h > 1 ? 1 : h;
		const qx = px - bx * h;
		const qy = py - by * h;
		const qz = pz - bz * h;
		const d = Math.sqrt(qx * qx + qy * qy + qz * qz) - v[k + 6]!;
		if (d < best) {
			best = d;
			if (best < enough) return best;
		}
	}
	return best;
}

/** Furthest drawn point outside the capsules, per region of the body, right now. */
export function cover(sub: Subject, c: Caps, worst: PerRegion, stride = 1): void {
	const pos = sub.skin(stride);
	const n = sub.region.length;
	for (let i = 0; i < n; i += stride) {
		const r = sub.region[i]!;
		if (r === NONE) continue;
		const d = outside(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!, c, 0);
		const key = REGIONS[r]!;
		if (d > worst[key]) worst[key] = d;
	}
}

/** Everything drawn over a while: the points of the skinned triangles, in a grid. */
export class Cloud {
	private readonly cells = new Map<number, number[]>();
	private static readonly SIZE = 4;

	private add(x: number, y: number, z: number): void {
		const k = Cloud.key(Math.floor(x / 4), Math.floor(y / 4), Math.floor(z / 4));
		const c = this.cells.get(k);
		if (c) c.push(x, y, z);
		else this.cells.set(k, [x, y, z]);
	}
	private static key(x: number, y: number, z: number): number {
		return (x + 64) * 65536 + (y + 64) * 256 + (z + 64);
	}

	/** The mesh as last skinned: its vertices, and points on triangles with long edges. */
	addMesh(sub: Subject): void {
		const { pos, index } = sub;
		for (let i = 0; i < pos.length; i += 3) this.add(pos[i]!, pos[i + 1]!, pos[i + 2]!);
		for (let i = 0; i < index.length; i += 3) {
			const a = index[i]! * 3;
			const b = index[i + 1]! * 3;
			const c = index[i + 2]! * 3;
			const e = (p: number, q: number) => Math.hypot(pos[p]! - pos[q]!, pos[p + 1]! - pos[q + 1]!, pos[p + 2]! - pos[q + 2]!);
			const long = Math.max(e(a, b), e(b, c), e(c, a));
			if (long < 1.6) continue;
			const n = Math.ceil(long / 1.2);
			for (let u = 0; u <= n; u++)
				for (let w = 0; w <= n - u; w++) {
					if ((u === 0 && w === 0) || u === n || w === n) continue;
					const f = u / n;
					const g = w / n;
					const h = 1 - f - g;
					this.add(pos[a]! * h + pos[b]! * f + pos[c]! * g, pos[a + 1]! * h + pos[b + 1]! * f + pos[c + 1]! * g, pos[a + 2]! * h + pos[b + 2]! * f + pos[c + 2]! * g);
				}
		}
	}

	/** Distance to the nearest point, or `max` when nothing is closer. */
	distance(x: number, y: number, z: number, max = 24): number {
		const S = Cloud.SIZE;
		const cx = Math.floor(x / S);
		const cy = Math.floor(y / S);
		const cz = Math.floor(z / S);
		let best = max * max;
		for (let ring = 0; ring * S - S < Math.sqrt(best) && ring <= Math.ceil(max / S); ring++)
			for (let i = -ring; i <= ring; i++)
				for (let j = -ring; j <= ring; j++)
					for (let k = -ring; k <= ring; k++) {
						if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) !== ring) continue;
						const c = this.cells.get(Cloud.key(cx + i, cy + j, cz + k));
						if (!c) continue;
						for (let q = 0; q < c.length; q += 3) {
							const dx = c[q]! - x;
							const dy = c[q + 1]! - y;
							const dz = c[q + 2]! - z;
							const d = dx * dx + dy * dy + dz * dz;
							if (d < best) best = d;
						}
					}
		return Math.sqrt(best);
	}
}

const DIRS = Array.from({ length: 26 }, (_, j) => {
	const y = 1 - (2 * (j + 0.5)) / 26;
	const s = Math.sqrt(1 - y * y);
	return [Math.cos(j * 2.39996) * s, y, Math.sin(j * 2.39996) * s] as const;
});

/** Furthest point of the capsules' outer surface from anything drawn, per region. */
export function overshoot(c: Caps, cloud: Cloud, worst: PerRegion, regions: readonly number[] = [TORSO, ARMS, LEGS]): void {
	for (let i = 0; i < c.n; i++) {
		if (!regions.includes(c.region[i]!)) continue;
		const key = REGIONS[c.region[i]!]!;
		const k = i * 7;
		const v = c.v;
		for (let t = 0; t <= 3; t++)
			for (const [dx, dy, dz] of DIRS) {
				const f = t / 3;
				const x = v[k]! + (v[k + 3]! - v[k]!) * f + dx * v[k + 6]!;
				const y = v[k + 1]! + (v[k + 4]! - v[k + 1]!) * f + dy * v[k + 6]!;
				const z = v[k + 2]! + (v[k + 5]! - v[k + 2]!) * f + dz * v[k + 6]!;
				// The outer surface of the union only.
				if (outside(x, y, z, c, -1e-6, i) < -1e-6) continue;
				const d = cloud.distance(x, y, z, Math.max(24, worst[key]));
				if (d > worst[key]) worst[key] = d;
			}
	}
}

/** Seconds of one gait cycle at a speed. */
export function cycleSeconds(speed: number, duck: number, hunched: boolean): number {
	if (speed < 20) return 1;
	const g = gaitShape(speed, duck);
	return (cycleDistance(g) * (hunched ? 0.82 : 1)) / speed;
}

export interface Case extends Look {
	ducked: boolean;
	pitch: number;
	speed: number;
	/** Direction of travel (degrees, left +) from where the player faces. */
	dir: number;
	/** In the air, at this vertical speed. */
	vz?: number;
	/** Standing: turn this way round and back on the spot first. */
	turn?: boolean;
	/** Travel another way first (the hips remember). */
	from?: number;
}
export const heading = (speed: number, dir: number) => ({ vx: Math.cos((dir * Math.PI) / 180) * speed, vy: Math.sin((dir * Math.PI) / 180) * speed });

export interface Measured {
	out: PerRegion;
	over: PerRegion;
}

/** Both numbers of a settled motion, over a whole cycle of `frames`. */
export function measure(c: Case, assets: HeldAssets, o: { frames?: number; stride?: number; over?: boolean; regions?: readonly number[] } = {}): Measured {
	const frames = o.frames ?? 24;
	const out = perRegion();
	const over = perRegion();
	const cloud = new Cloud();
	let last: Caps | null = null;
	// In the air either leg may be in front; a client may draw either.
	for (const lead of c.vz === undefined ? [0] : [1, -1]) {
		const sub = new Subject(c, assets, { ducked: c.ducked, pitch: c.pitch, ...heading(c.speed, c.from ?? c.dir) });
		if (c.from !== undefined) sub.settle(0.8);
		Object.assign(sub.s, heading(c.speed, c.dir));
		sub.settle();
		if (c.vz !== undefined) {
			sub.s.onGround = false;
			sub.s.vz = c.vz;
			sub.settle();
			(sub.model.animator as unknown as { lead: number }).lead = lead;
		}
		const cycle = c.vz === undefined ? cycleSeconds(c.speed, c.ducked ? 1 : 0, c.role !== 'none') : 1.2;
		const note = () => {
			const k = caps(sub.pose());
			cover(sub, k, out, o.stride ?? 1);
			if (o.over !== false) {
				if ((o.stride ?? 1) !== 1) sub.skin();
				cloud.addMesh(sub);
			}
			last = k;
		};
		if (c.turn) {
			// To one side, all the way to the other, and back: never so fast that the feet step.
			for (const to of [40, -40, 40, 0, -40]) while (Math.abs(sub.s.yaw - to) > 0.5) {
				sub.s.yaw += Math.sign(to - sub.s.yaw);
				sub.step(1 / 60);
				if (Math.round(sub.s.yaw) % 8 === 0) note();
			}
		}
		for (let i = 0; i < frames; i++) {
			sub.step(cycle / frames);
			note();
		}
		sub.dispose();
	}
	if (o.over !== false) overshoot(last!, cloud, over, o.regions);
	return { out, over };
}

/** Drawn body hit by a ray in model axes (nearest triangle of these regions), or -1. */
export function rayMesh(sub: Subject, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, region = -1): number {
	const { pos, index } = sub;
	let best = -1;
	for (let i = 0; i < index.length; i += 3) {
		const a = index[i]! * 3;
		const b = index[i + 1]! * 3;
		const c = index[i + 2]! * 3;
		if (region >= 0 && sub.region[index[i]!] !== region) continue;
		const e1x = pos[b]! - pos[a]!;
		const e1y = pos[b + 1]! - pos[a + 1]!;
		const e1z = pos[b + 2]! - pos[a + 2]!;
		const e2x = pos[c]! - pos[a]!;
		const e2y = pos[c + 1]! - pos[a + 1]!;
		const e2z = pos[c + 2]! - pos[a + 2]!;
		const px = dy * e2z - dz * e2y;
		const py = dz * e2x - dx * e2z;
		const pz = dx * e2y - dy * e2x;
		const det = e1x * px + e1y * py + e1z * pz;
		if (Math.abs(det) < 1e-9) continue;
		const tx = ox - pos[a]!;
		const ty = oy - pos[a + 1]!;
		const tz = oz - pos[a + 2]!;
		const u = (tx * px + ty * py + tz * pz) / det;
		if (u < 0 || u > 1) continue;
		const qx = ty * e1z - tz * e1y;
		const qy = tz * e1x - tx * e1z;
		const qz = tx * e1y - ty * e1x;
		const v = (dx * qx + dy * qy + dz * qz) / det;
		if (v < 0 || u + v > 1) continue;
		const t = (e2x * qx + e2y * qy + e2z * qz) / det;
		if (t > 0 && (best < 0 || t < best)) best = t;
	}
	return best;
}

/** Whether the server counts a hit of the model-axes ray. */
export function serverHit(p: PlayerPose, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): boolean {
	return rayPlayer({ x: ox, y: -oz, z: oy }, { x: dx, y: -dz, z: dy }, p, 4000) !== null;
}

export interface LegShots {
	/** Shots that meet a drawn leg, and how many of them the server counts. */
	leg: number;
	legHit: number;
	/** Shots through the gap between the legs (below the hips, between the two drawn legs, meeting nothing). */
	gap: number;
	gapHit: number;
}

/** Shots at the legs of a runner from 400 units away at eye height, seen from `from` degrees (0 = in front, left +). */
export function legShots(c: Case, from: number, assets: HeldAssets, poses = 24): LegShots {
	const r: LegShots = { leg: 0, legHit: 0, gap: 0, gapHit: 0 };
	const sub = new Subject(c, assets, { ducked: c.ducked, pitch: c.pitch, ...heading(c.speed, c.dir) });
	sub.settle();
	const cycle = cycleSeconds(c.speed, c.ducked ? 1 : 0, c.role !== 'none');
	const a = (from * Math.PI) / 180;
	const ox = Math.cos(a) * 400;
	const oz = -Math.sin(a) * 400;
	const oy = 64;
	// Screen axes: right of the view.
	const rx = -Math.sin(a);
	const rz = -Math.cos(a);
	for (let k = 0; k < poses; k++) {
		sub.step(cycle / poses);
		sub.skin();
		const p = sub.pose();
		for (let y = 1; y <= 30; y += 1.5) {
			const row: { u: number; hit: boolean }[] = [];
			for (let u = -30; u <= 30; u += 1) {
				const tx = rx * u;
				const tz = rz * u;
				const l = Math.hypot(tx - ox, y - oy, tz - oz);
				const dx = (tx - ox) / l;
				const dy = (y - oy) / l;
				const dz = (tz - oz) / l;
				const drawn = rayMesh(sub, ox, oy, oz, dx, dy, dz) >= 0;
				row.push({ u, hit: drawn });
				if (!drawn) continue;
				if (rayMesh(sub, ox, oy, oz, dx, dy, dz, LEGS) < 0) continue;
				r.leg++;
				if (serverHit(p, ox, oy, oz, dx, dy, dz)) r.legHit++;
			}
			const first = row.findIndex((q) => q.hit);
			const end = row.findLastIndex((q) => q.hit);
			for (let i = first + 1; i < end; i++) {
				if (first < 0 || row[i]!.hit) continue;
				const tx = rx * row[i]!.u;
				const tz = rz * row[i]!.u;
				const l = Math.hypot(tx - ox, y - oy, tz - oz);
				r.gap++;
				if (serverHit(p, ox, oy, oz, (tx - ox) / l, (y - oy) / l, (tz - oz) / l)) r.gapHit++;
			}
		}
	}
	sub.dispose();
	return r;
}

/** A motion over time: what the player's state says at `t` seconds. */
export type Script = (t: number, s: MotionState) => void;

/**
 * A motion that changes, as it goes over the wire: the client draws snapshots
 * at 32 Hz, interpolated; the server updates at 32 Hz too and is asked for the
 * pose in between.
 * `until` (s): what is measured before it counts as the change itself, the rest as settled.
 */
export function transient(look: Look, script: Script, assets: HeldAssets, o: { until: number; end: number; pitch?: number; phase?: number; fps?: number }): { during: PerRegion; after: PerRegion; head: number } {
	const during = perRegion();
	const after = perRegion();
	let head = 0;
	const sub = new Subject(look, assets, { pitch: o.pitch ?? 0 });
	const at = (t: number): MotionState => {
		const s = { ...emptyMotion(), pitch: o.pitch ?? 0 };
		script(Math.max(0, t), s);
		return s;
	};
	const snapshot = (t: number): MotionState => {
		const a = at(Math.floor(t * 32) / 32);
		const b = at(Math.floor(t * 32) / 32 + 1 / 32);
		const f = (t * 32) % 1;
		const near = f < 0.5 ? a : b;
		return {
			...near,
			vx: a.vx + (b.vx - a.vx) * f,
			vy: a.vy + (b.vy - a.vy) * f,
			vz: a.vz + (b.vz - a.vz) * f,
			yaw: a.yaw + (b.yaw - a.yaw) * f,
			pitch: a.pitch + (b.pitch - a.pitch) * f
		};
	};
	const dt = 1 / (o.fps ?? 60);
	const body = new PlayerBody();
	const prev = restMotion();
	const pose = sub.pose();
	let tick = -Math.round(64 * (1.5 + (o.phase ?? 0)));
	for (let t = tick / 64; t < o.end; t += dt) {
		Object.assign(sub.s, snapshot(Math.max(0, t)));
		sub.model.animator.update(dt, sub.s);
		// The server updates at 32 Hz with the last packet it has.
		for (; tick / 64 <= t + 1 / 32; tick += 2) {
			copyMotion(body.motion, prev);
			body.follow(2, 1 / 64, at(tick / 64));
		}
		if (t < 0) continue;
		// The pose the server rewinds to: between the two updates around it.
		lerpMotion(prev, body.motion, Math.max(0, Math.min(1, (t - (tick - 4) / 64) * 32)), pose.motion!);
		pose.ducked = sub.s.ducked;
		pose.pitch = sub.s.pitch;
		const c = caps(pose);
		cover(sub, c, t < o.until ? during : after);
		const h = c.part.indexOf('head') * 7;
		const bone = (sub.model.animator as unknown as { sk: { bones: Record<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }> } }).sk.bones['head']!;
		const mid = new THREE.Vector3(0, 5, 0).applyQuaternion(bone.quaternion).add(bone.position);
		head = Math.max(head, Math.hypot(mid.x - (c.v[h]! + c.v[h + 3]!) / 2, mid.y - (c.v[h + 1]! + c.v[h + 4]!) / 2, mid.z - (c.v[h + 2]! + c.v[h + 5]!) / 2));
	}
	sub.dispose();
	return { during, after, head };
}

const along = (t: number, accel: number, top: number) => Math.min(top, Math.max(0, t) * accel);
const set = (s: MotionState, speed: number, dir: number) => Object.assign(s, heading(speed, dir));
/** Ballistic hop: 301 u/s up, gravity 800, air time 0.75 s. */
const hop = (t: number, s: MotionState) => {
	s.onGround = false;
	s.vz = 301 - 800 * t;
};
const HOP = 0.7525;
/** Motions that change at t = 0 (or repeat), and for how long the change lasts. */
export const SCRIPTS: Readonly<Record<string, { until: number; end: number; run: (top: number) => Script }>> = {
	'start forward': { until: 0.5, end: 1.2, run: (top) => (t, s) => set(s, along(t, 1500, top), 0) },
	'start to the side': { until: 0.5, end: 1.2, run: (top) => (t, s) => set(s, along(t, 1500, top), 90) },
	stop: { until: 0.6, end: 1.4, run: (top) => (t, s) => set(s, Math.max(0, top - t * 800), 0) },
	'strafe left and right': {
		until: 1.8,
		end: 1.8,
		run: (top) => (t, s) => set(s, top * Math.max(-1, Math.min(1, 1.6 * Math.sin((t * 2 * Math.PI) / 0.9))), 90)
	},
	'turn the run 90 degrees': { until: 0.5, end: 1.2, run: (top) => (t, s) => set(s, top, Math.min(90, t * 500)) },
	'look around on the run': {
		until: 0.5,
		end: 1.2,
		run: (top) => (t, s) => {
			set(s, top, 0);
			s.yaw = Math.min(120, t * 800);
		}
	},
	'turn on the spot': { until: 1.2, end: 1.8, run: () => (t, s) => void (s.yaw = Math.min(180, t * 200)) },
	'flick on the spot': { until: 0.5, end: 1.2, run: () => (t, s) => void (s.yaw = Math.min(120, t * 1200)) },
	jump: {
		until: HOP + 0.4,
		end: 1.8,
		run: (top) => (t, s) => {
			set(s, top, 0);
			if (t > 0 && t < HOP) hop(t, s);
		}
	},
	'bunny hops': {
		until: 2.4,
		end: 2.4,
		run: (top) => (t, s) => {
			set(s, top * 1.15, 0);
			if (t > 0) hop(t % HOP, s);
		}
	},
	'duck and up': { until: 1, end: 1.6, run: () => (t, s) => void (s.ducked = t > 0 && t < 0.5) },
	'duck on the run': {
		until: 1.1,
		end: 1.8,
		run: (top) => (t, s) => {
			s.ducked = t > 0 && t < 0.6;
			set(s, t > 0 && t < 0.6 ? Math.max(85, top - t * 900) : t >= 0.6 ? Math.min(top, 85 + (t - 0.6) * 1000) : top, 0);
		}
	},
	'look up and down': { until: 0.4, end: 0.8, run: () => (t, s) => void (s.pitch = Math.min(60, Math.max(-60, -60 + t * 600))) }
};
