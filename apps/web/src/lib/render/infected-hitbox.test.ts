/**
 * The server's player hit capsules (shared zombies/hitbox.ts) against the
 * characters as drawn (docs/modes.md#infected): the real CharacterModel,
 * animated and skinned on the CPU, default clothes, LOD 0, standing still.
 * On the move: infected-motion.test.ts.
 *
 * Tolerances, measured here over every hold, stance, posture and pitch:
 * - COVER: no point of the body mesh is further than this outside the nearest
 *   capsule (and a ray aimed at the mesh hits).
 * - OVERSHOOT (pitch -80, 0 and 80): no point of a capsule is further than this from the mesh, so a
 *   ray that stays more than 4 units away from the character misses.
 * Sampled: every vertex of the skinned mesh, at five moments of the idle
 * motion; 200 points on every capsule, distance to the triangles of the mesh.
 * Not sampled: what the hands hold, the throwing knife and the talons over the
 * finger tips (never part of the body), and the ponytail (one size for every
 * look; it hangs out 2.6 units behind the head).
 */
import { emptyLoadout, PLAYER_HOLDS, playerCapsules, rayPlayer, type PlayerPose, type Vec3, type WeaponId } from '@surf/shared';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { emptyMotion } from './character/animator.js';
import type { HairStyle } from './character/body.js';
import { HeldAssets, type HeldItem } from './character/held.js';
import { applyLoadout, CharacterModel, personOf, type CharacterRole } from './character/model.js';
import { BONES, type BoneName } from './character/skeleton.js';

const COVER = 0.4;
const OVERSHOOT = 3.9;

let assets: HeldAssets;
beforeAll(() => {
	assets = new HeldAssets();
	// The idle motion starts at a random time: a fixed one here, so every run measures the same poses.
	let r = 0;
	vi.spyOn(Math, 'random').mockImplementation(() => (r = (r + 0.37) % 1));
});
afterAll(() => {
	assets.dispose();
	vi.restoreAllMocks();
});

interface Case {
	role: CharacterRole;
	held: HeldItem | 'claws' | null;
	ducked: boolean;
	pitch: number;
}
const ITEMS = Object.keys(PLAYER_HOLDS) as HeldItem[];
const HOLDS: { role: CharacterRole; held: HeldItem | 'claws' | null }[] = [
	...[null, ...ITEMS].map((held) => ({ role: 'none' as const, held })),
	{ role: 'infected', held: 'claws' },
	{ role: 'alpha', held: 'claws' }
];
const PITCHES = [-80, -40, 0, 40, 80];

const hitPose = (c: Case): PlayerPose => ({ x: 0, y: 0, z: 0, yaw: 0, ducked: c.ducked, hunched: c.role !== 'none', held: c.held as WeaponId | null, pitch: c.pitch });
/** Model axes (x forward, y up, z right) to Source ones at yaw 0. */
const toSource = (x: number, y: number, z: number): Vec3 => ({ x, y: -z, z: y });

function stand(c: Case, o: { hair?: HairStyle; loadout?: boolean } = {}) {
	const m = new CharacterModel({ ...personOf(1), style: o.hair ?? 'swept' }, assets);
	if (o.loadout) applyLoadout(m, { ...emptyLoadout(), hat: 'hat_straw', top: 'top_puffer', bottom: 'bottom_cargo', shoes: 'shoes_boots' });
	m.setRole(c.role);
	m.setHeld(c.held);
	const s = { ...emptyMotion(), ducked: c.ducked, pitch: c.pitch };
	const run = (frames: number) => {
		for (let i = 0; i < frames; i++) m.animator.update(1 / 30, s);
	};
	run(90);
	return { m, run };
}

/** Skinned vertices of a character (model axes) and the bone each follows most. */
function skinned(m: CharacterModel): { pos: Float32Array; bone: BoneName[]; idx: ArrayLike<number> } {
	const sk = m.mesh.skeleton as THREE.Skeleton & { dirty: boolean };
	sk.dirty = true;
	sk.update();
	const mats = sk.boneMatrices as unknown as Float32Array;
	const g = m.mesh.geometry;
	const p = g.getAttribute('position');
	const si = g.getAttribute('skinIndex');
	const sw = g.getAttribute('skinWeight');
	const pos = new Float32Array(p.count * 3);
	const bone: BoneName[] = [];
	for (let i = 0; i < p.count; i++) {
		let most = 0;
		for (let k = 0; k < 4; k++) {
			const w = sw.getComponent(i, k);
			if (w > sw.getComponent(i, most)) most = k;
			if (w === 0) continue;
			const o = si.getComponent(i, k) * 16;
			for (let a = 0; a < 3; a++) pos[i * 3 + a]! += w * (mats[o + a]! * p.getX(i) + mats[o + 4 + a]! * p.getY(i) + mats[o + 8 + a]! * p.getZ(i) + mats[o + 12 + a]!);
		}
		bone.push(BONES[si.getComponent(i, most)]!);
	}
	return { pos, bone, idx: g.getIndex()!.array };
}

type Capsule = { part: string; a: THREE.Vector3; b: THREE.Vector3; r: number };
const capsules = (c: Case): Capsule[] =>
	playerCapsules(hitPose(c)).map((k) => ({ part: k.part, a: new THREE.Vector3(k.a.x, k.a.z, -k.a.y), b: new THREE.Vector3(k.b.x, k.b.z, -k.b.y), r: k.r }));

function toAxis(x: number, y: number, z: number, c: Capsule): number {
	const bx = c.b.x - c.a.x;
	const by = c.b.y - c.a.y;
	const bz = c.b.z - c.a.z;
	const px = x - c.a.x;
	const py = y - c.a.y;
	const pz = z - c.a.z;
	const l = bx * bx + by * by + bz * bz;
	const h = l > 1e-9 ? Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / l)) : 0;
	return Math.hypot(px - bx * h, py - by * h, pz - bz * h);
}
/** How far a point is outside the capsules (negative inside). */
const outside = (x: number, y: number, z: number, caps: readonly Capsule[]) => Math.min(...caps.map((c) => toAxis(x, y, z, c) - c.r));

/** Distance from a point to the mesh. */
function toMesh(p: THREE.Vector3, v: ReturnType<typeof skinned>): number {
	let d2 = Infinity;
	for (let i = 0; i < v.pos.length; i += 3) {
		const x = v.pos[i]! - p.x;
		const y = v.pos[i + 1]! - p.y;
		const z = v.pos[i + 2]! - p.z;
		d2 = Math.min(d2, x * x + y * y + z * z);
	}
	let best = Math.sqrt(d2);
	// Vertices are close together: triangles only matter near the limit.
	if (best < 3) return best;
	const tri = new THREE.Triangle();
	const q = new THREE.Vector3();
	for (let i = 0; i < v.idx.length; i += 3) {
		const a = v.idx[i]! * 3;
		if (Math.abs(v.pos[a]! - p.x) > best + 5) continue;
		tri.a.fromArray(v.pos, a);
		tri.b.fromArray(v.pos, v.idx[i + 1]! * 3);
		tri.c.fromArray(v.pos, v.idx[i + 2]! * 3);
		best = Math.min(best, tri.closestPointToPoint(p, q).distanceTo(p));
	}
	return best;
}

/** Evenly spread directions. */
const DIRS = Array.from({ length: 40 }, (_, j) => {
	const y = 1 - (2 * (j + 0.5)) / 40;
	const s = Math.sqrt(1 - y * y);
	return new THREE.Vector3(Math.cos(j * 2.39996) * s, y, Math.sin(j * 2.39996) * s);
});
const SIDE_DIRS = DIRS.map((d) => ({ d, o: toSource(d.x, d.y, d.z) }));

/** Parts of the mesh that are not the body: talons. */
const body = (bone: BoneName, held: Case['held']) => !(held === 'claws' && bone.startsWith('tips'));

describe.each(HOLDS)('hit capsules of $role holding $held', { timeout: 30_000 }, (h) => {
	for (const ducked of [false, true]) {
		const cases = PITCHES.map((pitch): Case => ({ ...h, ducked, pitch }));

		it(`cover the drawn body to within ${COVER} units, and a ray at it hits: ${ducked ? 'ducked' : 'standing'}`, () => {
			for (const c of cases) {
				const { m, run } = stand(c);
				const caps = capsules(c);
				const p = hitPose(c);
				for (let k = 0; k < 5; k++) {
					run(13);
					const v = skinned(m);
					let worst = 0;
					for (let i = 0; i < v.bone.length; i++) {
						if (!body(v.bone[i]!, c.held)) continue;
						const x = v.pos[i * 3]!;
						const y = v.pos[i * 3 + 1]!;
						const z = v.pos[i * 3 + 2]!;
						const out = outside(x, y, z, caps);
						worst = Math.max(worst, out);
						// A ray at a point of the body hits (one in seven, from a spread of directions).
						if (k === 0 && i % 7 === 0 && out < 0) {
							const { o } = SIDE_DIRS[i % SIDE_DIRS.length]!;
							const q = toSource(x, y, z);
							expect(rayPlayer({ x: q.x + o.x * 200, y: q.y + o.y * 200, z: q.z + o.z * 200 }, { x: -o.x, y: -o.y, z: -o.z }, p, 400)).not.toBeNull();
						}
					}
					expect(worst, `pitch ${c.pitch}`).toBeLessThan(COVER);
				}
				m.dispose();
			}
		});

		it(`stay within ${OVERSHOOT} units of it, and a ray more than 4 units outside misses: ${ducked ? 'ducked' : 'standing'}`, () => {
			for (const c of cases.filter((_, i) => i % 2 === 0)) {
				const { m } = stand(c);
				const caps = capsules(c);
				const p = hitPose(c);
				const v = skinned(m);
				const q = new THREE.Vector3();
				for (const k of caps)
					for (let t = 0; t <= 4; t++)
						for (const d of DIRS) {
							q.copy(k.a).lerp(k.b, t / 4).addScaledVector(d, k.r);
							// The outer surface of the union only.
							if (caps.some((o) => o !== k && toAxis(q.x, q.y, q.z, o) < o.r - 1e-6)) continue;
							expect(toMesh(q, v), `${k.part} at pitch ${c.pitch}`).toBeLessThan(OVERSHOOT);
						}
				// Rays on a grid from the front and from the right: distance of the ray to the nearest vertex.
				for (const front of [true, false])
					for (let u = -36; u <= 36; u += 6)
						for (let y = -8; y <= 88; y += 6) {
							let near = Infinity;
							for (let i = 0; i < v.pos.length; i += 3) near = Math.min(near, Math.hypot(v.pos[i + (front ? 2 : 0)]! - u, v.pos[i + 1]! - y));
							const hit = front
								? rayPlayer(toSource(200, y, u), { x: -1, y: 0, z: 0 }, p, 400)
								: rayPlayer(toSource(u, y, 200), { x: 0, y: 1, z: 0 }, p, 400);
							if (near > 4 && !inside(v, u, y, front)) expect(hit, `${front ? 'front' : 'side'} ${u} ${y} pitch ${c.pitch}`).toBeNull();
						}
				m.dispose();
			}
		});
	}
});

/** Whether the point (u, y) of a projection lies in a triangle of the mesh. */
function inside(v: ReturnType<typeof skinned>, u: number, y: number, front: boolean): boolean {
	const k = front ? 2 : 0;
	for (let i = 0; i < v.idx.length; i += 3) {
		const [a, b, c] = [v.idx[i]! * 3, v.idx[i + 1]! * 3, v.idx[i + 2]! * 3];
		const e = (p: number, q: number) => (v.pos[q + k]! - v.pos[p + k]!) * (y - v.pos[p + 1]!) - (v.pos[q + 1]! - v.pos[p + 1]!) * (u - v.pos[p + k]!);
		const [s, t, w] = [e(a, b), e(b, c), e(c, a)];
		if ((s >= 0 && t >= 0 && w >= 0) || (s <= 0 && t <= 0 && w <= 0)) return true;
	}
	return false;
}

describe('one size for every look', () => {
	it.each(['crop', 'bob', 'curls'] as const)('%s hair is covered', (hair) => {
		for (const c of [
			{ role: 'none', held: 'lmg', ducked: false, pitch: 0 },
			{ role: 'infected', held: 'claws', ducked: false, pitch: 40 }
		] as Case[]) {
			const { m } = stand(c, { hair });
			const v = skinned(m);
			const caps = capsules(c);
			for (let i = 0; i < v.bone.length; i++) if (v.bone[i] === 'head') expect(outside(v.pos[i * 3]!, v.pos[i * 3 + 1]!, v.pos[i * 3 + 2]!, caps)).toBeLessThan(COVER);
			m.dispose();
		}
	});

	it('the ponytail is not: at most 2.6 units of it hang out', () => {
		const c: Case = { role: 'none', held: 'lmg', ducked: false, pitch: 40 };
		const { m } = stand(c, { hair: 'ponytail' });
		const v = skinned(m);
		const caps = capsules(c);
		let worst = 0;
		for (let i = 0; i < v.bone.length; i++) if (v.bone[i] === 'head' || v.bone[i] === 'neck') worst = Math.max(worst, outside(v.pos[i * 3]!, v.pos[i * 3 + 1]!, v.pos[i * 3 + 2]!, caps));
		expect(worst).toBeGreaterThan(0.5);
		expect(worst).toBeLessThan(2.6);
		m.dispose();
	});

	it('cosmetics change the mesh, never the capsules: the hit pose has no place for them', () => {
		const c: Case = { role: 'none', held: 'smg', ducked: false, pitch: 0 };
		const plain = stand(c);
		const dressed = stand(c, { loadout: true });
		expect(dressed.m.mesh.geometry).not.toBe(plain.m.mesh.geometry);
		expect(Object.keys(hitPose(c)).sort()).toEqual(['ducked', 'held', 'hunched', 'pitch', 'x', 'y', 'yaw', 'z']);
		plain.m.dispose();
		dressed.m.dispose();
	});
});
