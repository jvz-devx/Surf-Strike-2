/**
 * Third-person reloads (reload.ts): the timelines, the parts of the gun, and
 * the drawn characters: nothing jumps when a magazine changes hands, hands
 * and magazine stay out of the body, feet and head do what they did.
 */
import { WEAPONS } from '@surf/shared';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { emptyMotion, type MotionState } from './animator.js';
import { HELD, HeldAssets, type HeldItem } from './held.js';
import { HELD_BUDGET } from './held-models.js';
import { CharacterModel, personOf, type CharacterRole } from './model.js';
import { BOLT_SECS, BOLTS, HandFrames, RELOADS } from './reload.js';
import { BONES, type BoneName } from './skeleton.js';

const GUNS = (Object.keys(HELD) as HeldItem[]).filter((w) => WEAPONS[w].magazine > 0);
const MS = 3000;

let assets: HeldAssets;
beforeAll(() => {
	assets = new HeldAssets();
	// The idle motion starts at a random time: a fixed one here, so twins breathe together.
	vi.spyOn(Math, 'random').mockReturnValue(0.4);
});
afterAll(() => {
	assets.dispose();
	vi.restoreAllMocks();
});

/** A character holding `w`, settled. */
function holding(w: HeldItem, o: { role?: CharacterRole; motion?: Partial<MotionState> } = {}) {
	const m = new CharacterModel(personOf(1), assets);
	m.setRole(o.role ?? 'none');
	m.setHeld(w);
	const s: MotionState = { ...emptyMotion(), ...o.motion };
	for (let i = 0; i < 90; i++) m.update(1 / 30, s, 50);
	const step = (dt = 1 / 60) => m.update(dt, s, 50);
	/** Stand at `p` of the reload. */
	const at = (p: number) => {
		m.animator.reload(w, p, MS);
		step(0.3);
		step(1e-4);
	};
	const rest = () => {
		m.animator.reload(null);
		step(0.3);
		step(1e-4);
	};
	return { m, s, step, at, rest };
}

const bone = (m: CharacterModel, b: BoneName) => (m as unknown as { sk: { bones: Record<BoneName, { position: THREE.Vector3; quaternion: THREE.Quaternion }> } }).sk.bones[b];
/** Everything about a pose that must not jump: hands, gun, magazine (model space). */
function pose(m: CharacterModel) {
	m.group.updateMatrixWorld(true);
	const gun = m.group.getObjectByName('held') as THREE.Mesh;
	return {
		handL: bone(m, 'handL').position.clone(),
		handR: bone(m, 'handR').position.clone(),
		gun: gun.localToWorld(new THREE.Vector3(10, 2, 0)),
		mag: new THREE.Vector3(6, -1, 0).applyQuaternion(m.animator.parts.magQ).add(m.animator.parts.magP)
	};
}

describe('timelines', () => {
	it('every gun has a reload; the knife has none; only the sniper rifle has a bolt to work', () => {
		expect(Object.keys(RELOADS).sort()).toEqual([...GUNS].sort());
		expect(Object.keys(BOLTS)).toEqual(['sniper']);
		// Done before the fastest next shot (specialist).
		expect(BOLT_SECS * 1000).toBeLessThan(WEAPONS.sniper.fireMs * 0.85);
	});

	it('starts and ends in the rest hold: hands, gun, moving part, magazine', () => {
		const f = new HandFrames();
		f.restP.set(1, 2, 3);
		f.gunP.set(9, 9, 9);
		f.beltP.set(-9, -9, -9);
		const p = new THREE.Vector3();
		const q = new THREE.Quaternion();
		const tip = new Float64Array(6);
		for (const clip of [...Object.values(RELOADS), ...Object.values(BOLTS)])
			for (const t of [0, 1]) {
				for (const hand of [clip.left, clip.right]) {
					if (!hand) continue;
					hand.at(t, f, p, q);
					expect(p.toArray(), clip.item).toEqual([1, 2, 3]);
				}
				clip.gunAt(t, tip);
				expect([...tip], clip.item).toEqual([0, 0, 0, 0, 0, 0]);
				clip.actAt(t, 1, p, q);
				expect(p.length() + q.angleTo(new THREE.Quaternion()), clip.item).toBeCloseTo(0, 6);
				expect(clip.magAt(t)).toBe('gun');
			}
	});

	it('keys run forward from 0 to 1', () => {
		for (const clip of [...Object.values(RELOADS), ...Object.values(BOLTS)])
			for (const hand of [clip.left, clip.right]) {
				const t = hand?.times ?? [0];
				expect(t[0]).toBeGreaterThanOrEqual(0);
				expect(t.at(-1)).toBeLessThanOrEqual(1);
				for (let i = 1; i < t.length; i++) expect(t[i]!, clip.item).toBeGreaterThan(t[i - 1]!);
			}
	});

	it('the magazine: in the gun, in the hand, gone at the belt, a new one in the hand, in the gun; the pistol drops its own', () => {
		for (const w of GUNS) {
			const seen: string[] = [];
			for (let p = 0; p <= 1; p += 0.005) {
				const at = RELOADS[w]!.magAt(p);
				if (seen.at(-1) !== at) seen.push(at);
			}
			expect(seen, w).toEqual(w === 'pistol' ? ['gun', 'none', 'hand', 'gun'] : ['gun', 'hand', 'none', 'hand', 'gun']);
		}
		const pistol = RELOADS.pistol!;
		expect(pistol.fallen(0.1, 1500)).toBeLessThan(0);
		expect(pistol.fallen(0.34, 1500)).toBeCloseTo(0.3, 6);
		// Twice as fast with sleight of hand, but gravity stays what it is.
		expect(pistol.fallen(0.34, 750)).toBeCloseTo(0.15, 6);
		expect(RELOADS.lmg!.fallen(0.5, 4200)).toBeLessThan(0);
	});
});

describe('guns in parts', () => {
	it('body, magazine and moving part are built once, only for guns, and add up to little more than the whole', () => {
		const a = new HeldAssets();
		expect(a.parts('knife')).toBeNull();
		const tris = (g: THREE.BufferGeometry | null) => (g ? g.getAttribute('position').count / 3 : 0);
		for (const w of GUNS) {
			const p = a.parts(w)!;
			expect(a.parts(w)).toBe(p);
			const all = tris(p.body) + tris(p.mag) + tris(p.act);
			expect(all, w).toBeGreaterThanOrEqual(tris(a.geometry(w)));
			expect(all, w).toBeLessThanOrEqual(HELD_BUDGET[w] + 60);
			expect(tris(p.body), w).toBeLessThan(tris(a.geometry(w)));
			expect(tris(p.mag), w).toBeGreaterThan(10);
			expect(p.act !== null, w).toBe(['pistol', 'lmg', 'sniper', 'barrett'].includes(w));
		}
		expect(a.splits).toBe(GUNS.length + 1);
		let disposed = 0;
		for (const w of GUNS) a.parts(w)!.body.addEventListener('dispose', () => disposed++);
		a.dispose();
		expect([disposed, a.splits]).toEqual([GUNS.length, 0]);
	});

	it('at rest the gun is one mesh; reloading it is the body, and the magazine is missing from it and in the left hand', () => {
		for (const w of GUNS) {
			const h = holding(w);
			const gun = h.m.group.getObjectByName('held') as THREE.Mesh;
			expect(gun.geometry).toBe(assets.geometry(w));
			expect(h.m.partsShown).toEqual([]);
			const mag = RELOADS[w]!.mag!;
			h.at((mag.fresh + mag.seat) / 2);
			expect(gun.geometry, w).toBe(assets.parts(w)!.body);
			expect(h.m.partsShown, w).toContain('mag');
			// In the fist: its nearest vertex is within a hand of it.
			const mesh = h.m.group.getObjectByName('mag') as THREE.Mesh;
			const fist = new THREE.Vector3(3, 0, 0).applyQuaternion(bone(h.m, 'handL').quaternion.clone().multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0)))).add(bone(h.m, 'handL').position);
			mesh.updateWorldMatrix(true, false);
			const box = new THREE.Box3().setFromObject(mesh, true);
			expect(box.distanceToPoint(fist), w).toBeLessThan(4);
			// Between the old and the new one there is none.
			h.at((mag.stow + mag.fresh) / 2);
			expect(h.m.partsShown, w).not.toContain('mag');
			h.rest();
			expect(gun.geometry, w).toBe(assets.geometry(w));
			expect(h.m.partsShown, w).toEqual([]);
			h.m.dispose();
		}
	});

	it('the pistol\'s old magazine falls to the ground while the hand is away', () => {
		const h = holding('pistol');
		const mag = RELOADS.pistol!.mag!;
		const y = (p: number) => {
			h.m.animator.reload('pistol', p, 1500);
			h.step(0.3);
			h.step(1e-4);
			return h.m.partsShown.includes('mag-drop') ? h.m.group.getObjectByName('mag-drop')!.position.y : null;
		};
		expect(y(mag.out - 0.01)).toBeNull();
		const a = y(mag.out + 0.02)!;
		const b = y(mag.out + 0.15)!;
		expect(a).toBeGreaterThan(40);
		expect(b).toBeLessThan(a - 12);
		expect(y(mag.out + 0.35)).toBeNull();
		h.m.dispose();
	});
});

const STANCES: { role?: CharacterRole; motion?: Partial<MotionState> }[] = [
	{},
	{ motion: { ducked: true } },
	{ motion: { pitch: -60 } },
	{ motion: { pitch: 60 } },
	{ role: 'alpha' },
	{ role: 'alpha', motion: { ducked: true, pitch: 40 } }
];

describe('drawn reloads', () => {
	it('nothing jumps: not when the magazine changes hands, not anywhere between (every gun, six stances)', () => {
		for (const w of GUNS)
			for (const st of STANCES) {
				const h = holding(w, st);
				const { mag } = RELOADS[w]!;
				// The magazine on either side of a handover.
				for (const t of mag!.drop ? [mag!.seat] : [mag!.out, mag!.seat]) {
					h.at(t - 1e-4);
					const a = pose(h.m).mag;
					h.at(t + 1e-4);
					expect(pose(h.m).mag.distanceTo(a), `${w} ${t}`).toBeLessThan(0.3);
				}
				h.rest();
				let last = pose(h.m);
				let fastest = 0;
				let when = '';
				const dp = 0.004;
				for (let p = 0; p < 1; p += dp) {
					h.m.animator.reload(w, p, MS);
					h.step(MS * dp * 1e-3);
					const now = pose(h.m);
					for (const k of ['handL', 'handR', 'gun'] as const) {
						const d = now[k].distanceTo(last[k]);
						if (d <= fastest) continue;
						fastest = d;
						when = `${k} at ${p.toFixed(3)}`;
					}
					last = now;
				}
				h.m.animator.reload(null);
				h.step(MS * dp * 1e-3);
				// Units per second at the weapon's own reload time.
				expect(fastest / (dp * WEAPONS[w].reloadMs * 1e-3), `${w} ${JSON.stringify(st)} ${when}`).toBeLessThan(400);
				const end = pose(h.m);
				for (const k of ['handL', 'handR', 'gun'] as const) expect(end[k].distanceTo(last[k]), w).toBeLessThan(0.5);
				h.m.dispose();
			}
	});

	it('feet, hips and head do what they do without it, standing and running', () => {
		for (const motion of [{}, { vx: 250 }, { vx: -120, vy: 90, pitch: 30 }, { onGround: false, vz: 120 }]) {
			const a = holding('lmg', { motion });
			const b = holding('lmg', { motion });
			for (let i = 1; i < 60; i++) {
				a.m.animator.reload('lmg', i / 60, MS);
				a.step();
				b.step();
				for (const n of ['pelvis', 'chest', 'head', 'footL', 'footR', 'shinL', 'toeR'] as const) {
					expect(bone(a.m, n).position.distanceTo(bone(b.m, n).position), n).toBeLessThan(1e-9);
					expect(bone(a.m, n).quaternion.angleTo(bone(b.m, n).quaternion), n).toBeLessThan(1e-6);
				}
			}
			expect(bone(a.m, 'handL').position.distanceTo(bone(b.m, 'handL').position)).toBeGreaterThan(0.3);
			a.m.dispose();
			b.m.dispose();
		}
	});

	it('hands and magazine stay out of the body at level aim: no deeper than half a unit more than at rest', () => {
		for (const w of GUNS)
			for (const st of [STANCES[0]!, STANCES[1]!, STANCES[4]!]) {
				const h = holding(w, st);
				const hand = (v: Skinned, side: 'L' | 'R') => v.pos.filter((_, i) => i % 7 === 0 && [`hand${side}`, `fingers${side}`, `tips${side}`].includes(v.bone[i]!));
				const v0 = skinned(h.m);
				const rest = { L: depth(hand(v0, 'L'), core(v0)), R: depth(hand(v0, 'R'), core(v0)) };
				const geo = assets.parts(w)!.mag.getAttribute('position') as THREE.BufferAttribute;
				for (let p = 0.05; p < 1; p += 0.07) {
					h.at(p);
					const v = skinned(h.m);
					const body = core(v);
					for (const side of ['L', 'R'] as const) expect(depth(hand(v, side), body) - rest[side], `${w} hand${side} ${p.toFixed(2)}`).toBeLessThan(0.5);
					const o = h.m.animator.parts;
					if (o.mag !== 'hand') continue;
					const pts: THREE.Vector3[] = [];
					for (let i = 0; i < geo.count; i += 7) pts.push(new THREE.Vector3().fromBufferAttribute(geo, i).applyQuaternion(o.magQ).add(o.magP));
					expect(depth(pts, body), `${w} magazine ${p.toFixed(2)}`).toBeLessThan(0.5);
				}
				h.m.dispose();
			}
	}, 60_000);
});

describe('cut short', () => {
	it('blends out within 150 ms from anywhere, without a jump, and the magazine is back in the gun', () => {
		for (const w of GUNS)
			for (const p of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) {
				const h = holding(w);
				const rest = pose(h.m);
				h.at(p);
				let last = pose(h.m);
				const far = last.handL.distanceTo(rest.handL);
				h.m.animator.reload(null);
				for (let i = 0; i < 10; i++) {
					h.step(0.0151);
					const now = pose(h.m);
					// Smoothstep over ten frames: the steepest one is under a fifth of the way.
					expect(now.handL.distanceTo(last.handL), `${w} ${p}`).toBeLessThan(0.2 * far + 1.2);
					expect(now.handR.distanceTo(last.handR), `${w} ${p}`).toBeLessThan(2);
					last = now;
				}
				expect(last.handL.distanceTo(rest.handL), `${w} ${p}`).toBeLessThan(0.4);
				expect(last.handR.distanceTo(rest.handR), `${w} ${p}`).toBeLessThan(0.4);
				expect(h.m.partsShown).toEqual([]);
				h.m.dispose();
			}
	});

	it('a reload that starts over blends out first, then runs from its start', () => {
		const h = holding('smg');
		h.at(0.45);
		let last = pose(h.m);
		for (let i = 0; i < 30; i++) {
			h.m.animator.reload('smg', i / 180, MS);
			h.step();
			const now = pose(h.m);
			expect(now.handL.distanceTo(last.handL)).toBeLessThan(6);
			last = now;
		}
		const fresh = holding('smg');
		fresh.at(29 / 180);
		expect(last.handL.distanceTo(pose(fresh.m).handL)).toBeLessThan(0.6);
		h.m.dispose();
		fresh.m.dispose();
	});

	it('a swap takes the parts with the gun; the next gun is whole; reset() clears everything', () => {
		const h = holding('barrett');
		h.at(0.5);
		h.m.setHeld('pistol');
		for (let i = 0; i < 30; i++) h.step();
		const gun = h.m.group.getObjectByName('held') as THREE.Mesh;
		expect(gun.geometry).toBe(assets.geometry('pistol'));
		expect(h.m.partsShown).toEqual([]);
		h.m.setHeld('barrett');
		h.m.animator.reload(null);
		for (let i = 0; i < 30; i++) h.step();
		h.at(0.5);
		h.m.animator.reload(null);
		h.m.animator.reset();
		h.step();
		expect(gun.geometry).toBe(assets.geometry('barrett'));
		expect(h.m.partsShown).toEqual([]);
		h.m.dispose();
	});

	it('the reload of a gun that is not in the hands does not show', () => {
		const h = holding('pistol');
		const rest = pose(h.m);
		h.m.animator.reload('lmg', 0.5, MS);
		for (let i = 0; i < 30; i++) h.step();
		expect(pose(h.m).handL.distanceTo(rest.handL)).toBeLessThan(0.6);
		expect(h.m.partsShown).toEqual([]);
		h.m.dispose();
	});
});

describe('bolt', () => {
	it('after a shot the right hand works the bolt and the gun stays where it is; then everything is as before', () => {
		const h = holding('sniper');
		const rest = pose(h.m);
		h.m.animator.act('fire');
		let away = 0;
		let slid = 0;
		for (let t = 0; t < BOLT_SECS; t += 1 / 60) {
			h.step();
			const now = pose(h.m);
			away = Math.max(away, now.handR.distanceTo(rest.handR));
			slid = Math.max(slid, -h.m.animator.parts.actP.x);
			// Past the recoil the gun only tips.
			if (t > 0.2) expect(now.gun.distanceTo(rest.gun)).toBeLessThan(3);
			expect(bone(h.m, 'handL').position.distanceTo(now.handL)).toBe(0);
		}
		expect(away).toBeGreaterThan(5);
		expect(slid).toBeGreaterThan(2);
		for (let i = 0; i < 15; i++) h.step();
		const end = pose(h.m);
		expect(end.handR.distanceTo(rest.handR)).toBeLessThan(0.6);
		expect(end.gun.distanceTo(rest.gun)).toBeLessThan(0.6);
		expect(h.m.partsShown).toEqual([]);
		const gun = h.m.group.getObjectByName('held')!;
		expect([gun.position.length(), gun.quaternion.w]).toEqual([0, 1]);
		h.m.dispose();
	});

	it('other guns and the knife have none; a reload takes its place', () => {
		for (const w of ['barrett', 'pistol', 'knife'] as const) {
			const h = holding(w);
			h.m.animator.act(w === 'knife' ? 'swing' : 'fire');
			for (let i = 0; i < 30; i++) {
				h.step();
				expect(h.m.partsShown).toEqual([]);
			}
			h.m.dispose();
		}
		const h = holding('sniper');
		h.m.animator.act('fire');
		for (let i = 0; i < 20; i++) h.step();
		for (let i = 0; i < 40; i++) {
			h.m.animator.reload('sniper', 0.55, MS);
			h.step();
		}
		expect(h.m.partsShown).toContain('mag');
		expect(h.m.animator.parts.mag).toBe('hand');
		h.m.dispose();
	});
});

// ---------------------------------------------------------------------------

interface Skinned {
	pos: THREE.Vector3[];
	bone: BoneName[];
	idx: ArrayLike<number>;
}

/** Skinned vertices (model axes) and the bone each follows most. */
function skinned(m: CharacterModel): Skinned {
	const sk = m.mesh.skeleton as THREE.Skeleton & { dirty: boolean };
	sk.dirty = true;
	sk.update();
	const mats = sk.boneMatrices as unknown as Float32Array;
	const g = m.mesh.geometry;
	const p = g.getAttribute('position');
	const si = g.getAttribute('skinIndex');
	const sw = g.getAttribute('skinWeight');
	const pos: THREE.Vector3[] = [];
	const bones: BoneName[] = [];
	for (let i = 0; i < p.count; i++) {
		let most = 0;
		const v = new THREE.Vector3();
		for (let k = 0; k < 4; k++) {
			const w = sw.getComponent(i, k);
			if (w > sw.getComponent(i, most)) most = k;
			if (w === 0) continue;
			const o = si.getComponent(i, k) * 16;
			v.x += w * (mats[o]! * p.getX(i) + mats[o + 4]! * p.getY(i) + mats[o + 8]! * p.getZ(i) + mats[o + 12]!);
			v.y += w * (mats[o + 1]! * p.getX(i) + mats[o + 5]! * p.getY(i) + mats[o + 9]! * p.getZ(i) + mats[o + 13]!);
			v.z += w * (mats[o + 2]! * p.getX(i) + mats[o + 6]! * p.getY(i) + mats[o + 10]! * p.getZ(i) + mats[o + 14]!);
		}
		pos.push(v);
		bones.push(BONES[si.getComponent(i, most)]!);
	}
	return { pos, bone: bones, idx: g.getIndex()!.array };
}

const CORE = new Set<BoneName>(['pelvis', 'spine', 'chest', 'neck', 'head', 'clavL', 'clavR', 'thighL', 'thighR', 'thighHL', 'thighHR']);
/** Triangles of torso, head and thighs. */
function core(v: Skinned): THREE.Vector3[] {
	const out: THREE.Vector3[] = [];
	for (let i = 0; i < v.idx.length; i += 3) if ([0, 1, 2].every((k) => CORE.has(v.bone[v.idx[i + k]!]!))) for (let k = 0; k < 3; k++) out.push(v.pos[v.idx[i + k]!]!);
	return out;
}

const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const T = new THREE.Triangle();
/** Deepest of the points inside a (nearly closed) mesh; 0 when all are outside. Inside: the winding number. */
function depth(points: THREE.Vector3[], tris: THREE.Vector3[]): number {
	let worst = 0;
	const box = new THREE.Box3().setFromPoints(tris);
	for (const q of points) {
		if (!box.containsPoint(q)) continue;
		let w = 0;
		let near = Infinity;
		for (let i = 0; i < tris.length; i += 3) {
			A.copy(tris[i]!).sub(q);
			B.copy(tris[i + 1]!).sub(q);
			C.copy(tris[i + 2]!).sub(q);
			const a = A.length();
			const b = B.length();
			const c = C.length();
			const det = A.x * (B.y * C.z - B.z * C.y) - A.y * (B.x * C.z - B.z * C.x) + A.z * (B.x * C.y - B.y * C.x);
			w += 2 * Math.atan2(det, a * b * c + A.dot(B) * c + B.dot(C) * a + C.dot(A) * b);
		}
		if (w / (4 * Math.PI) < 0.5) continue;
		for (let i = 0; i < tris.length; i += 3) {
			T.set(tris[i]!, tris[i + 1]!, tris[i + 2]!);
			near = Math.min(near, T.closestPointToPoint(q, C).distanceTo(q));
		}
		worst = Math.max(worst, near);
	}
	return worst;
}
