/**
 * What the gloved hands touch, measured on the shipped meshes (render/hand-contact.ts) in model units of the gun
 * (about 2.3 cm each): in the rest pose of every weapon no point of the fingers and the palm is deeper inside than
 * DEPTH, every fingertip and the palm is within TOUCH of it (nothing floats), and the forearm stays out of the
 * stock. The other named poses keep the same depth and touch what they hold. The limits were set before the poses were solved.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { restVmFeel } from '../game/gunfeel.js';
import { GUN_PARTS, type GunId } from './gun-rig.js';
import { handSamples, measure, Solid, trianglesOf, type Contact, type HandSample } from './hand-contact.js';
import { blendHands, blendQuat, blendShapes, FIST, freeShape, OPEN, weaponHands, type GunPoseName, type HandSide, type PoseName, type Quat } from './hand-poses.js';
import { HAND_BONES, skinnedPositions, type WeaponHandPair } from './hands.js';
import { shippedLoad } from './shipped-models.js';
import { HeldAssets } from './character/held.js';
import { ZombieRenderer } from './zombies.js';

/** Deepest a finger or the palm may sink in, farthest a touching part may be, deepest a forearm may cut the gun. */
const DEPTH = 0.1;
const TOUCH = 0.15;
const ARM = 0.1;
/** Points on the skin, at most this far apart. */
const SPACING = 0.12;

const GUNS = Object.keys(GUN_PARTS) as GunId[];
const HELD = [...GUNS, 'knife'] as const;
type Held = (typeof HELD)[number];
const TIPS = ['index', 'middle', 'ring', 'pinky', 'thumb'] as const;
/** What each pose has to touch; rest poses touch with everything. */
const HOLDS: Partial<Record<PoseName, readonly (keyof Contact['gaps'])[]>> = {
	grip: [...TIPS, 'palm'],
	grip_off: [...TIPS, 'palm'],
	fore: [...TIPS, 'palm'],
	knife: [...TIPS, 'palm'],
	mag: ['index', 'thumb', 'palm'],
	bolt: ['index', 'thumb'],
	cover: ['index', 'middle', 'thumb']
};
/** Poses a gun must have. */
const POSES: Record<GunId, GunPoseName[]> = {
	pistol: ['grip', 'grip_off', 'mag', 'bolt'],
	smg: ['grip', 'grip_off', 'fore', 'mag', 'bolt'],
	lmg: ['grip', 'grip_off', 'fore', 'mag', 'bolt', 'cover'],
	sniper: ['grip', 'grip_off', 'fore', 'mag', 'bolt'],
	barrett: ['grip', 'grip_off', 'fore', 'mag', 'bolt'],
	striker: ['grip', 'grip_off', 'fore', 'mag', 'bolt']
};
const BOLT_SIDE: Record<GunId, HandSide> = { pistol: 'l', smg: 'l', lmg: 'r', sniper: 'r', barrett: 'r', striker: 'l' };

const AXIS = new THREE.Vector3();

interface Rig {
	z: ZombieRenderer;
	pair: WeaponHandPair;
	solid: Solid;
	samples: Record<HandSide, HandSample[]>;
}
const rigs = new Map<Held, Promise<Rig>>();
function rigOf(id: Held): Promise<Rig> {
	let r = rigs.get(id);
	if (!r)
		rigs.set(
			id,
			(r = (async () => {
				const z = new ZombieRenderer(new HeldAssets(), shippedLoad);
				z.setWeapon(id);
				await z.preload([id]);
				z.updateViewmodel(1000, true, 1, 0, restVmFeel());
				z.vmScene.updateMatrixWorld(true);
				const pair = z.hands(id)!;
				expect(pair, id).toBeDefined();
				// The gun in the model space the hands are posed in.
				const toModel = pair.space.matrixWorld.clone().invert();
				const part = pair.space.parent!;
				const solid = new Solid(trianglesOf(part.children[0]!, toModel));
				return { z, pair, solid, samples: { r: handSamples(pair.hands.r.mesh, SPACING), l: handSamples(pair.hands.l.mesh, SPACING) } };
			})())
		);
	return r;
}
/** Positions of a hand in model space. */
function modelPositions(r: Rig, side: HandSide): Float32Array {
	r.z.vmScene.updateMatrixWorld(true);
	const at = skinnedPositions(r.pair.hands[side].mesh);
	const toModel = r.pair.space.matrixWorld.clone().invert();
	const v = new THREE.Vector3();
	for (let i = 0; i < at.length; i += 3) v.fromArray(at, i).applyMatrix4(toModel).toArray(at, i);
	return at;
}
function contact(r: Rig, name: PoseName): Contact {
	r.pair.rest();
	const side = r.pair.named(name)!.side;
	r.pair.set(side, r.pair.pose(name)!);
	const c = measure(r.solid, r.samples[side], modelPositions(r, side));
	r.pair.rest();
	return c;
}

describe('the measuring itself', () => {
	it('inside and outside of overlapping boxes, depth to the outer surface only', () => {
		// A 2 × 2 × 2 cube round the origin, and one shifted by 1: their union, 3 long; faces inside it don't count.
		const g = new THREE.Group();
		const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2).toNonIndexed());
		const n = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2).toNonIndexed());
		n.position.x = 1;
		g.add(m, n);
		const s = new Solid(trianglesOf(g, new THREE.Matrix4()));
		expect(s.inside(0, 0, 0)).toBe(true);
		expect(s.inside(1.7, 0.2, 0.1)).toBe(true);
		expect(s.inside(2.2, 0.2, 0.1)).toBe(false);
		expect(s.signed(2.5, 0.1, 0)).toBeCloseTo(0.5, 6);
		// 0.05 from the hidden face at x = 1, but 0.9 from the surface.
		expect(s.signed(0.95, 0.1, 0)).toBeCloseTo(-0.9, 1);
	});

	it('known points of every gun: the middle of the grip is inside, points beside and under it are not', async () => {
		for (const id of GUNS) {
			const r = await rigOf(id);
			const root = r.pair.pose('grip');
			expect(root, id).not.toBeNull();
			r.z.vmScene.updateMatrixWorld(true);
			const p = r.z.rig(id)!.point('hand_r')!.getWorldPosition(new THREE.Vector3()).applyMatrix4(r.pair.space.matrixWorld.clone().invert());
			expect(r.solid.inside(p.x, p.y, p.z), id).toBe(true);
			for (const x of [-3, 3]) expect(r.solid.inside(p.x + x, p.y, p.z), id).toBe(false);
			expect(r.solid.inside(p.x, p.y - 8, p.z), id).toBe(false);
		}
		// Building the outer surface of six guns takes a while.
	}, 120_000);

	it('the regions of the hand: five fingertips, a palm, a forearm', async () => {
		const { samples } = await rigOf('smg');
		for (const side of ['r', 'l'] as const) {
			for (const t of TIPS) expect(samples[side].filter((s) => s.tip === t).length, t).toBeGreaterThan(40);
			expect(samples[side].filter((s) => s.palm).length).toBeGreaterThan(150);
			expect(samples[side].filter((s) => s.arm).length).toBeGreaterThan(150);
		}
	});
});

describe('contact of the hands', () => {
	it('every gun has its named poses, the charging handle on the side its hand can reach', () => {
		for (const id of GUNS) {
			const w = weaponHands(id)!;
			expect(Object.keys(w.poses).sort(), id).toEqual([...POSES[id]].sort());
			expect(w.poses.bolt!.side, id).toBe(BOLT_SIDE[id]);
			expect(w.rest, id).toEqual({ r: 'grip', l: id === 'pistol' ? null : 'fore' });
			for (const p of Object.values(w.poses)) {
				expect(p.fingers).toHaveLength(16);
				expect(p.thumb).toHaveLength(5);
				expect(Math.hypot(...p.q)).toBeCloseTo(1, 4);
			}
		}
		expect(weaponHands('knife')!.rest).toEqual({ r: 'knife', l: null });
		expect(weaponHands('claws')).toBeNull();
	});

	it.each(HELD)('%s: rest poses hold the weapon, no deeper than ' + DEPTH + ', nothing floating by more than ' + TOUCH, async (id) => {
		const r = await rigOf(id);
		for (const side of ['r', 'l'] as const) {
			const name = weaponHands(id)!.rest[side];
			if (!name) continue;
			const c = contact(r, name);
			if (process.env.CONTACT_REPORT) console.log([id, name, 'depth', c.depth.toFixed(3), ...Object.entries(c.gaps).map(([k, v]) => k + ' ' + v.toFixed(3)), 'forearm', c.arm.toFixed(3)].join(' '));
			expect(c.depth, id + ' ' + name + ' at ' + c.deepest).toBeLessThanOrEqual(DEPTH);
			for (const t of [...TIPS, 'palm'] as const) expect(c.gaps[t], id + ' ' + name + ' ' + t).toBeLessThanOrEqual(TOUCH);
			expect(c.arm, id + ' ' + name + ' forearm').toBeLessThanOrEqual(ARM);
		}
	}, 60_000);

	it.each(HELD)('%s: the other poses, no deeper than ' + DEPTH + ', touching what they hold', async (id) => {
		const r = await rigOf(id);
		for (const name of r.pair.names) {
			const c = contact(r, name);
			if (process.env.CONTACT_REPORT) console.log([id, name, 'depth', c.depth.toFixed(3), c.deepest, 'inside', c.inside.toFixed(3), ...Object.entries(c.gaps).map(([k, v]) => k + ' ' + v.toFixed(3)), 'forearm', c.arm.toFixed(3)].join(' '));
			expect(c.depth, id + ' ' + name + ' at ' + c.deepest).toBeLessThanOrEqual(DEPTH);
			for (const t of HOLDS[name]!) expect(c.gaps[t], id + ' ' + name + ' ' + t).toBeLessThanOrEqual(TOUCH);
			expect(c.arm, id + ' ' + name + ' forearm').toBeLessThanOrEqual(ARM);
		}
	}, 60_000);

	it('the trigger finger is on the trigger in `grip` and off it in `grip_off`', async () => {
		for (const id of GUNS) {
			const r = await rigOf(id);
			const trigger = r.z.rig(id)!.part('trigger')!;
			r.z.vmScene.updateMatrixWorld(true);
			const s = new Solid(trianglesOf(trigger, r.pair.space.matrixWorld.clone().invert()));
			const gap = (name: PoseName) => {
				r.pair.set('r', r.pair.pose(name)!);
				const c = measure(s, r.samples.r, modelPositions(r, 'r')).gaps.index;
				r.pair.rest();
				return c;
			};
			expect(gap('grip'), id).toBeLessThanOrEqual(TOUCH);
			expect(gap('grip_off'), id).toBeGreaterThan(0.3);
		}
	});

	it('the right hand closes round the grip: the thumb on the left (the sniper grip is too thick: on the right), the other fingers across the front; nothing of it on the pistol slide', async () => {
		for (const id of GUNS) {
			const r = await rigOf(id);
			r.z.vmScene.updateMatrixWorld(true);
			const toModel = r.pair.space.matrixWorld.clone().invert();
			const grip = r.z.rig(id)!.point('hand_r')!.getWorldPosition(new THREE.Vector3()).applyMatrix4(toModel);
			for (const name of ['grip', 'grip_off'] as const) {
				r.pair.set('r', r.pair.pose(name)!);
				const at = modelPositions(r, 'r');
				const mean = (bone: string) => {
					const v = new THREE.Vector3();
					const own = r.samples.r.filter((s) => s.bone === bone && !s.face);
					for (const s of own) v.add(new THREE.Vector3().fromArray(at, s.vertex * 3));
					return v.divideScalar(own.length);
				};
				const label = id + ' ' + name;
				if (id === 'sniper') expect(mean('thumb3').x, label).toBeGreaterThan(grip.x + 0.8);
				else expect(mean('thumb3').x, label).toBeLessThan(grip.x - 0.8);
				for (const f of ['middle3', 'ring3', 'pinky3']) {
					// Round the front: ahead of the middle of the grip, and past its middle to the left (the short little finger nearly).
					expect(mean(f).z, label + ' ' + f).toBeLessThan(grip.z);
					expect(mean(f).x, label + ' ' + f).toBeLessThan(grip.x + (f === 'pinky3' ? 0.7 : 0.3));
				}
				// The wrist behind the grip, on its right.
				expect(mean('thumb1').z, label).toBeGreaterThan(grip.z);
				if (id === 'pistol') {
					const slide = new Solid(trianglesOf(r.z.rig(id)!.part('slide')!, toModel));
					expect(measure(slide, r.samples.r, at).gaps.thumb, label).toBeGreaterThan(0.05);
				}
				r.pair.rest();
			}
		}
	}, 60_000);

	it('a knob, a slide and the feed cover are held: thumb on one side, two fingers on the other, wherever the part has gone', async () => {
		/** Tips this close to the part they hold; the palm of a hand round a knob no further from it. */
		const HELD = 0.1;
		const PALM = 0.7;
		for (const [id, pose, name, states] of [
			['sniper', 'bolt', 'bolt', [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1]]],
			['lmg', 'bolt', 'bolt', [[0], [0.5], [1]]],
			['barrett', 'bolt', 'bolt', [[0], [0.5], [1]]],
			['pistol', 'bolt', 'slide', [[0], [0.85], [1]]],
			['lmg', 'cover', 'cover', [[0], [0.5], [1]]]
		] as const) {
			const r = await rigOf(id);
			const rig = r.z.rig(id)!;
			const side = weaponHands(id)!.poses[pose]!.side;
			for (const s of states) {
				const label = id + ' ' + pose + ' at ' + s.join(' ');
				rig.move(name, s);
				const on = pose === 'cover' ? 'cover' : undefined;
				r.pair.set(side, r.pair.pose(pose, on)!);
				const at = modelPositions(r, side);
				const toModel = r.pair.space.matrixWorld.clone().invert();
				let tri = trianglesOf(rig.part(name)!, toModel);
				// The sheet metal of the cover: its rail and the optic on it are no handle.
				if (pose === 'cover') {
					const node = rig.part(name)!;
					const home = rig.restOf(name)!;
					const back = new THREE.Matrix4().copy(toModel).multiply(node.parent!.matrixWorld).multiply(new THREE.Matrix4().compose(home.position, home.quaternion, node.scale)).multiply(node.matrixWorld.clone().invert()).multiply(toModel.clone().invert());
					const v = new THREE.Vector3();
					const keep: number[] = [];
					for (let i = 0; i < tri.length; i += 9) if ([0, 3, 6].every((k) => v.fromArray(tri, i + k).applyMatrix4(back).y < 2.85)) keep.push(...tri.subarray(i, i + 9));
					tri = Float64Array.from(keep);
				}
				const c = measure(new Solid(tri), r.samples[side], at);
				for (const t of ['index', 'middle', 'thumb'] as const) expect(c.gaps[t], label + ' ' + t).toBeLessThanOrEqual(HELD);
				if (side === 'r') expect(c.gaps.palm, label + ' palm').toBeLessThanOrEqual(PALM);
				// Nothing of the hand in the gun with its part there.
				const all = measure(new Solid(trianglesOf(r.pair.space.parent!.children[0]!, toModel)), r.samples[side], at);
				expect(all.depth, label + ' at ' + all.deepest).toBeLessThanOrEqual(DEPTH);
				expect(all.arm, label + ' forearm').toBeLessThanOrEqual(ARM);
				// The thumb across from the fingers, seen along the knob, the slide or the edge of the cover.
				const mean = (bone: string) => {
					const v = new THREE.Vector3();
					const own = r.samples[side].filter((k) => k.bone === bone && !k.face);
					for (const k of own) v.add(new THREE.Vector3().fromArray(at, k.vertex * 3));
					return v.divideScalar(own.length);
				};
				if (pose === 'bolt') {
					const point = rig.point('grip_bolt')!;
					const centre = point.getWorldPosition(new THREE.Vector3()).applyMatrix4(toModel);
					const way = (bone: string) => {
						const v = mean(bone).sub(centre);
						// Along the bore for the slide, along the knob for the others.
						if (id === 'pistol') v.setZ(0);
						else v.addScaledVector(AXIS.set(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), id === 'sniper' ? -0.42 + s[0]! * 1.05 : 0), -v.dot(AXIS));
						return v.normalize();
					};
					for (const f of ['index3', 'middle3']) expect(way('thumb3').dot(way(f)), label + ' ' + f).toBeLessThan(0);
				}
				r.pair.rest();
				rig.reset();
			}
		}
	}, 120_000);

	it('the hands stay out of each other: every left-hand pose against the right hand at rest', async () => {
		for (const id of GUNS) {
			const r = await rigOf(id);
			r.pair.rest();
			const right = modelPositions(r, 'r');
			const g = r.pair.hands.r.mesh.geometry;
			const n = g.index ? g.index.count : right.length / 3;
			const tri = new Float64Array(n * 3);
			for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) tri[i * 3 + k] = right[(g.index ? g.index.getX(i) : i) * 3 + k]!;
			const solid = new Solid(tri);
			for (const name of r.pair.names) {
				if (r.pair.named(name)!.side !== 'l') continue;
				r.pair.set('l', r.pair.pose(name)!);
				const c = measure(solid, r.samples.l, modelPositions(r, 'l'));
				expect(c.depth, id + ' ' + name + ' at ' + c.deepest).toBeLessThanOrEqual(DEPTH);
				expect(c.arm, id + ' ' + name).toBeLessThanOrEqual(ARM);
			}
			r.pair.rest();
		}
	}, 120_000);

	it('a hand on the magazine or the handle goes with it', async () => {
		for (const id of GUNS) {
			const r = await rigOf(id);
			const rig = r.z.rig(id)!;
			for (const [pose, part] of [
				['mag', 'mag'],
				['bolt', rig.part('bolt') ? 'bolt' : 'slide']
			] as const) {
				const a = r.pair.pose(pose)!;
				const node = rig.part(part)!;
				const at = (p: readonly number[]) => new THREE.Vector3(...(p as [number, number, number]));
				const rest = node.position.clone();
				rig.move(part, 1);
				const b = r.pair.pose(pose)!;
				const moved = at(b.p).distanceTo(at(a.p));
				expect(moved, id + ' ' + pose).toBeGreaterThan(2);
				// A slide moves it just as far; the sniper bolt also swings it up.
				if (id !== 'sniper' || pose === 'mag') expect(moved, id + ' ' + pose).toBeCloseTo(node.position.distanceTo(rest) * rig.len, 3);
				rig.reset();
				expect(at(r.pair.pose(pose)!.p).distanceTo(at(a.p))).toBeCloseTo(0, 9);
			}
		}
	});
});

describe('pose data', () => {
	const q = (x: number, y: number, z: number, a: number): Quat => {
		const v = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(x, y, z).normalize(), a);
		return [v.x, v.y, v.z, v.w];
	};
	it('blending is pure, hits both ends and turns the short way', () => {
		const a = { p: [0, 0, 0], q: q(0, 1, 0, 0.2), elbow: [0, -10, 20], ...OPEN } as const;
		const b = { p: [2, 4, -6], q: q(0, 1, 0, 1.2), elbow: [2, -10, 20], ...FIST } as const;
		const before = JSON.stringify([a, b]);
		const start = blendHands(a, b, 0);
		const end = blendHands(a, b, 1);
		expect(start.p).toEqual(a.p);
		expect(end.p).toEqual(b.p);
		start.q.forEach((v, i) => expect(v).toBeCloseTo(a.q[i]!, 9));
		end.q.forEach((v, i) => expect(v).toBeCloseTo(b.q[i]!, 9));
		end.fingers.forEach((v, i) => expect(v).toBeCloseTo(FIST.fingers[i]!, 9));
		const mid = blendHands(a, b, 0.5);
		expect(mid.p).toEqual([1, 2, -3]);
		mid.q.forEach((v, i) => expect(v).toBeCloseTo(q(0, 1, 0, 0.7)[i]!, 9));
		expect(blendShapes(OPEN, FIST, 0.5).thumb[0]).toBeCloseTo((OPEN.thumb[0]! + FIST.thumb[0]!) / 2, 9);
		// The same turn with the other sign: no spin.
		const n = q(0, 1, 0, 0.2).map((v) => -v) as unknown as Quat;
		blendQuat(q(0, 1, 0, 0.2), n, 0.5).forEach((v, i) => expect(Math.abs(v)).toBeCloseTo(Math.abs(q(0, 1, 0, 0.2)[i]!), 9));
		expect(JSON.stringify([a, b])).toBe(before);
		expect(freeShape('open')).toBe(OPEN);
		expect(freeShape('fist')).toBe(FIST);
	});

	it('the left hand is the mirror image of the right one', async () => {
		const { pair } = await rigOf('smg');
		const at = (side: HandSide) => {
			const h = pair.hands[side];
			const m = side === 'r' ? 1 : -1;
			h.place({ p: [0, 0, 0], q: [0, 0, 0, 1], elbow: [m * 3, -4, 20], ...FIST });
			h.group.updateMatrixWorld(true);
			const inv = h.group.matrixWorld.clone().invert();
			const out = skinnedPositions(h.mesh);
			const v = new THREE.Vector3();
			for (let i = 0; i < out.length; i += 3) v.fromArray(out, i).applyMatrix4(inv).toArray(out, i);
			return out;
		};
		const r = at('r');
		const l = at('l');
		const key = (a: Float32Array, s: number) => {
			const c = [0, 0, 0];
			for (let i = 0; i < a.length; i += 3) {
				c[0]! += s * a[i]!;
				c[1]! += a[i + 1]!;
				c[2]! += a[i + 2]!;
			}
			return c.map((v) => v / (a.length / 3));
		};
		const a = key(r, 1);
		const b = key(l, -1);
		a.forEach((v, i) => expect(b[i]).toBeCloseTo(v, 3));
		expect(Object.keys(HAND_BONES)).toHaveLength(17);
		pair.rest();
	});
});
