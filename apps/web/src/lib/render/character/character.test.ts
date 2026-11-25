import { emptyLoadout, getCosmetic, listCosmetics, type Loadout } from '@surf/shared';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CharacterAnimator, cycleDistance, emptyMotion, footOffset, gaitShape, type MotionState, type Posture } from './animator.js';
import { crowdScale } from './crowd.js';
import { effectDef } from './effects.js';
import { acquireLook, liveLooks, lookParts, mergeParts, type LookSpec } from './geometry.js';
import { HELD, HeldAssets, type HeldItem } from './held.js';
import { drawnItems, itemMesh } from './items.js';
import { PAL, PAL_SIZE, PartBuilder, type Lod } from './mesh-kit.js';
import { applyLoadout, CharacterModel, personOf, pickLod, type CharacterRole } from './model.js';
import { VelocityTracker } from './motion.js';
import { registerSamples, SAMPLE_IDS } from './samples.js';
import { BIND, BONES, commitPose, createSkeleton, SOCKET_DEFS } from './skeleton.js';

const LOOK: LookSpec = { hair: 'swept', items: drawnItems(emptyLoadout()), claws: false };

/** Bounds of the skinned mesh (all vertices, or the ones `keep` accepts by bone). */
function skinnedBounds(sk: ReturnType<typeof createSkeleton>, keep: (bone: string) => boolean = () => true): THREE.Box3 {
	commitPose(sk);
	sk.skeleton.update();
	const mats = sk.skeleton.boneMatrices as unknown as Float32Array;
	const g = mergeParts(lookParts(LOOK, 0));
	const pos = g.getAttribute('position');
	const si = g.getAttribute('skinIndex');
	const sw = g.getAttribute('skinWeight');
	const box = new THREE.Box3();
	const v = new THREE.Vector3();
	const out = new THREE.Vector3();
	const m = new THREE.Matrix4();
	for (let i = 0; i < pos.count; i++) {
		if (!keep(BONES[si.getX(i)]!)) continue;
		out.set(0, 0, 0);
		for (let k = 0; k < 4; k++) {
			const w = sw.getComponent(i, k);
			if (w === 0) continue;
			m.fromArray(mats, si.getComponent(i, k) * 16);
			out.addScaledVector(v.fromBufferAttribute(pos, i).applyMatrix4(m), w);
		}
		box.expandByPoint(out);
	}
	g.dispose();
	return box;
}

function pose(s: Partial<MotionState>, o: { posture?: Posture; held?: HeldItem; frames?: number } = {}) {
	const sk = createSkeleton();
	const a = new CharacterAnimator(sk);
	a.posture = o.posture ?? 'normal';
	a.held = o.held ?? null;
	const m = { ...emptyMotion(), ...s };
	for (let i = 0; i < (o.frames ?? 120); i++) a.update(1 / 60, m);
	return { sk, a };
}

const noArms = (b: string) => !/^(upper|fore|hand|fingers|tips|clav)/.test(b);

describe('character mesh', () => {
	it('is within budget and has valid weights, palette and winding at every LOD', () => {
		const budget = [8000, 2800, 1300];
		for (const lod of [0, 1, 2] as Lod[]) {
			const g = mergeParts(lookParts(LOOK, lod));
			expect(g.getIndex()!.count / 3).toBeLessThan(budget[lod]!);
			const sw = g.getAttribute('skinWeight').array;
			const si = g.getAttribute('skinIndex').array;
			const pal = g.getAttribute('aPal').array;
			for (let i = 0; i < sw.length; i += 4) {
				expect(sw[i]! + sw[i + 1]! + sw[i + 2]! + sw[i + 3]!).toBe(255);
				expect(Math.max(si[i]!, si[i + 1]!, si[i + 2]!, si[i + 3]!)).toBeLessThan(BONES.length);
				expect(pal[i]!).toBeLessThan(PAL_SIZE);
			}
			g.dispose();
		}
	});

	it('faces outwards: the mesh encloses a positive volume part by part', () => {
		for (const lod of [0, 1, 2] as Lod[])
			for (const p of lookParts({ ...LOOK, claws: true }, lod)) {
				let vol = 0;
				const a = new THREE.Vector3();
				const b = new THREE.Vector3();
				const c = new THREE.Vector3();
				for (let i = 0; i < p.idx.length; i += 3) {
					a.fromArray(p.pos, p.idx[i]! * 3);
					b.fromArray(p.pos, p.idx[i + 1]! * 3);
					c.fromArray(p.pos, p.idx[i + 2]! * 3);
					vol += a.dot(b.cross(c)) / 6;
				}
				expect(vol).toBeGreaterThan(0);
			}
	});
});

describe('animation fits the hull', () => {
	it('standing: 72 high, feet on the ground, inside the 32 wide hull', () => {
		const { sk, a } = pose({});
		const b = skinnedBounds(sk);
		expect(b.max.y).toBeGreaterThan(70);
		expect(b.max.y).toBeLessThan(73.2);
		expect(Math.abs(b.min.y)).toBeLessThan(0.5);
		expect(Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z)).toBeLessThan(17);
		expect(a.headTop).toBeCloseTo(72, 0);
	});

	it('ducked: at most the 54 high hull, still and walking', () => {
		for (const s of [{}, { vx: 85 }, { vx: -60, vy: 60 }]) {
			const { sk } = pose({ ducked: true, ...s });
			const b = skinnedBounds(sk, noArms);
			expect(b.max.y).toBeGreaterThan(49);
			expect(b.max.y).toBeLessThan(55.5);
			expect(b.min.y).toBeGreaterThan(-1.2);
			expect(Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z)).toBeLessThan(20);
		}
	});

	it('zombie and infected heads stay on the shared head hitbox (7.5 forward, 65 up)', () => {
		for (const posture of ['zombie', 'infected'] as const)
			for (const vx of [0, 265]) {
				const c = new THREE.Vector3();
				const n = 40;
				for (let f = 0; f < n; f++) {
					const { sk } = pose({ vx }, { posture, frames: 90 + f });
					const h = sk.bones.head;
					c.add(new THREE.Vector3(0.1, 5, 0).applyQuaternion(h.quaternion).add(h.position));
				}
				c.divideScalar(n);
				expect(Math.abs(c.x - 7.5)).toBeLessThan(3.2);
				expect(Math.abs(c.y - 65)).toBeLessThan(3.2);
				expect(Math.abs(c.z)).toBeLessThan(1.5);
			}
	});
});

describe('gait', () => {
	it('a planted foot moves exactly against the body at any speed', () => {
		for (const speed of [40, 85, 150, 250, 320])
			for (const duck of [0, 1]) {
				const g = gaitShape(speed, duck);
				const d = cycleDistance(g);
				for (let p = 0.02; p + 0.02 < g.duty; p += 0.02) {
					const moved = footOffset(g, p + 0.01) - footOffset(g, p);
					expect(moved + 0.01 * d).toBeCloseTo(0, 6);
				}
			}
	});

	it('running at 250 u/s does not skate: grounded balls of the feet hold still in the world', () => {
		for (const dir of [0, 45, 90, 180, -90]) {
			const sk = createSkeleton();
			const a = new CharacterAnimator(sk);
			const r = (dir * Math.PI) / 180;
			const m = { ...emptyMotion(), vx: Math.cos(r) * 250, vy: Math.sin(r) * 250 };
			const dt = 1 / 120;
			let worst = 0;
			let planted = 0;
			let high = 0;
			const last = { L: new THREE.Vector3(), R: new THREE.Vector3() };
			const was = { L: false, R: false };
			const inner = a as unknown as { phase: number; gait: { duty: number } };
			for (let i = 0; i < 360; i++) {
				a.update(dt, m);
				for (const s of ['L', 'R'] as const) {
					const p = sk.bones[`toe${s}`].position;
					// World position of the ball (Three axes).
					const w = new THREE.Vector3(p.x + m.vx * dt * i, p.y, p.z - m.vy * dt * i);
					const down = (inner.phase + (s === 'R' ? 0.5 : 0)) % 1 < inner.gait.duty;
					if (i > 200 && down && was[s]) {
						planted++;
						worst = Math.max(worst, Math.hypot(w.x - last[s].x, w.z - last[s].z) / dt);
						high = Math.max(high, p.y - BIND.toeR[1]);
					}
					was[s] = down;
					last[s].copy(w);
				}
			}
			expect(planted).toBeGreaterThan(40);
			expect(worst).toBeLessThan(30); // u/s, against 250 of body speed
			expect(high).toBeLessThan(1);
		}
	});

	it('keeps the limbs at their length in every pose', () => {
		const poses: Partial<MotionState>[] = [
			{},
			{ vx: 250 },
			{ ducked: true },
			{ ducked: true, vy: 85 },
			{ onGround: false, vz: 300 },
			{ onGround: false, vz: -400, ducked: true },
			{ onGround: false, vx: 900, ramp: { x: 0, y: 0.77, z: 0.64 } },
			{ pitch: 85 },
			{ pitch: -85 }
		];
		for (const s of poses)
			for (const held of [null, ...(Object.keys(HELD) as HeldItem[])]) {
				const { sk } = pose(s, held ? { held, frames: 50 } : { frames: 50 });
				const len = (a: keyof typeof sk.bones, b: keyof typeof sk.bones) => sk.bones[a].position.distanceTo(sk.bones[b].position);
				const bind = (a: keyof typeof sk.bones, b: keyof typeof sk.bones) => new THREE.Vector3(...BIND[a]).distanceTo(new THREE.Vector3(...BIND[b]));
				for (const [a, b] of [
					['thighL', 'shinL'],
					['shinR', 'footR'],
					['upperL', 'foreL'],
					['foreR', 'handR']
				] as const)
					expect(len(a, b)).toBeCloseTo(bind(a, b), 3);
				for (const b of BONES) expect(Number.isFinite(sk.bones[b].position.x + sk.bones[b].quaternion.w)).toBe(true);
			}
	});

	it('is continuous: no bone jumps on state changes', () => {
		const sk = createSkeleton();
		const a = new CharacterAnimator(sk);
		const m = emptyMotion();
		const last = BONES.map(() => new THREE.Vector3());
		const script: [number, Partial<MotionState>][] = [
			[40, { vx: 250 }],
			[80, { onGround: false, vz: 300 }],
			[120, { vz: -300 }],
			[130, { onGround: true, vz: 0 }],
			[160, { vx: -250 }],
			[200, { vx: 0, ducked: true }],
			[240, { vx: 80 }],
			[270, { vx: 0, ducked: false, yaw: 70 }],
			[320, { onGround: false, ramp: { x: 0, y: 0.7, z: 0.71 }, vx: 800 }],
			[360, { ramp: null }]
		];
		let worst = 0;
		for (let i = 0; i < 420; i++) {
			for (const [at, s] of script) if (at === i) Object.assign(m, s);
			a.update(1 / 60, m);
			BONES.forEach((b, k) => {
				const p = sk.bones[b].position;
				if (i > 0) worst = Math.max(worst, p.distanceTo(last[k]!));
				last[k]!.copy(p);
			});
		}
		expect(worst).toBeLessThan(11); // units per frame; a running foot swings at about 8
	});
});

describe('VelocityTracker', () => {
	it('follows steady motion and ignores teleports', () => {
		const v = new VelocityTracker();
		const m = emptyMotion();
		for (let i = 0; i <= 120; i++) v.push((i * 250) / 60, 0, 0, 1 / 60, m);
		expect(m.vx).toBeCloseTo(250, 0);
		v.push(9000, 0, 0, 1 / 60, m);
		expect(m.vx).toBe(0);
	});
});

describe('cosmetics', () => {
	const ids = new Set(listCosmetics().map((i) => i.id));
	let assets: HeldAssets;
	beforeAll(() => {
		registerSamples();
		registerSamples(); // idempotent
		assets = new HeldAssets();
	});
	afterAll(() => assets.dispose());

	const wear = (l: Partial<Loadout>): Loadout => ({ ...emptyLoadout(), ...l });

	it('every shop item has a mesh in its slot that builds at every LOD, within budget, in its own colours', () => {
		const items = [...ids].map((id) => getCosmetic(id)!).filter((i) => !i.isDefault && i.slot !== 'effect');
		expect(items).toHaveLength(75);
		for (const item of items) {
			if (item.slot === 'effect') continue;
			const mesh = itemMesh(item.id)!;
			// Epic masks cover the whole head.
			const budget = item.rarity === 'epic' ? [4200, 1300, 600] : [2600, 800, 420];
			expect(mesh, item.id).toBeDefined();
			expect(mesh.colors, item.id).toHaveLength(4);
			expect(drawnItems(wear({ [item.slot]: item.id }))[item.slot]).toBe(item.id);
			const own = { hat: PAL.hatA, glasses: PAL.glassesA, top: PAL.topA, bottom: PAL.bottomA, shoes: PAL.shoesA }[item.slot];
			for (const lod of [0, 1, 2] as Lod[]) {
				const b = new PartBuilder(lod);
				mesh.build(b);
				const { idx, pos, pal } = b.data;
				expect(idx.length / 3, `${item.id} lod ${lod}`).toBeGreaterThan(0);
				expect(idx.length / 3, `${item.id} lod ${lod}`).toBeLessThan(budget[lod]!);
				expect(pos.every(Number.isFinite), item.id).toBe(true);
				// Roles recolour a slot's palette: nothing may use another slot's.
				expect(pal.every((p) => p === PAL.skin || (p >= own && p < own + 4)), item.id).toBe(true);
				// Only the slides show skin.
				if (item.id !== 'shoes_slides') expect(pal, item.id).not.toContain(PAL.skin);
				let vol = 0;
				const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
				for (let i = 0; i < idx.length; i += 3) {
					for (let k = 0; k < 3; k++) v[k as 0 | 1 | 2].fromArray(pos, idx[i + k]! * 3);
					vol += v[0].dot(v[1].clone().cross(v[2])) / 6;
				}
				expect(vol, `${item.id} faces outwards`).toBeGreaterThan(0);
				mergeParts(lookParts({ ...LOOK, items: drawnItems(wear({ [item.slot]: item.id })) }, lod)).dispose();
			}
			// The fry cook hat and the headphones sit on top of the hair.
			if (item.slot === 'hat' && item.id !== 'hat_frycook' && item.id !== 'hat_headphones') expect(mesh.hides).toContain('hair');
		}
	});

	it('a tagged look has its own geometry (second WebGL context)', () => {
		const a = new CharacterModel(personOf(1), assets);
		const b = new CharacterModel(personOf(1), assets, { tag: 'preview' });
		expect(b.mesh.geometry).not.toBe(a.mesh.geometry);
		const before = liveLooks();
		b.dispose();
		expect(liveLooks()).toBe(before - 1);
		a.dispose();
	});

	it('samples are not part of the shipped registry', () => {
		for (const id of Object.values(SAMPLE_IDS)) {
			expect(ids.has(id)).toBe(false);
			expect(getCosmetic(id)).toBeDefined();
		}
	});

	it('swaps one slot at a time and back, sharing and freeing geometry', () => {
		const before = liveLooks();
		const a = new CharacterModel(personOf(1), assets);
		const b = new CharacterModel({ ...personOf(2), style: personOf(1).style }, assets);
		expect(b.mesh.geometry).toBe(a.mesh.geometry);
		const base = a.mesh.geometry;
		for (const [slot, id] of Object.entries(SAMPLE_IDS)) {
			applyLoadout(a, wear({ [slot]: id }));
			expect(a.mesh.geometry).not.toBe(base);
			expect(a.getLoadout()[slot as 'hat']).toBe(id);
			applyLoadout(a, emptyLoadout());
			expect(a.mesh.geometry).toBe(base);
		}
		let freed = 0;
		base.addEventListener('dispose', () => freed++);
		a.dispose();
		expect(freed).toBe(0);
		b.dispose();
		expect(freed).toBe(1);
		expect(liveLooks()).toBe(before);
	});

	it('unknown ids and wrong slots fall back to the default look', () => {
		expect(drawnItems(wear({ top: 'nope', hat: 'sample_boots', shoes: 'sample_boots' }))).toEqual({
			hat: null,
			glasses: null,
			top: 'top_default',
			bottom: 'bottom_default',
			shoes: 'sample_boots',
			effect: null
		});
	});

	it('a hat flattens the hair; long sleeves replace the arms; shorts show the shins', () => {
		const names = (l: Loadout) => lookParts({ hair: 'curls', items: drawnItems(l), claws: false }, 0);
		const plain = names(emptyLoadout());
		const hat = names(wear({ hat: 'sample_cap' }));
		const top = (parts: typeof plain) => Math.max(...parts[1]!.pos.filter((_, i) => i % 3 === 1));
		expect(top(hat)).toBeLessThan(top(plain));
		expect(names(wear({ top: 'sample_longsleeve' }))).toHaveLength(plain.length - 1);
		expect(names(wear({ bottom: 'sample_shorts' }))).toHaveLength(plain.length + 1);
	});

	it('rigid items sit on their socket and move with its bone only', () => {
		const p = lookParts({ ...LOOK, items: drawnItems(wear({ glasses: 'sample_shades' })) }, 0).at(-4)!;
		const c = new THREE.Vector3();
		for (let i = 0; i < p.pos.length; i += 3) c.add(new THREE.Vector3(p.pos[i], p.pos[i + 1], p.pos[i + 2]));
		c.divideScalar(p.pos.length / 3);
		expect(c.distanceTo(new THREE.Vector3(...SOCKET_DEFS.glasses.pos))).toBeLessThan(4);
		for (let i = 0; i < p.si.length; i += 4) {
			expect(BONES[p.si[i]!]).toBe('head');
			expect(p.sw[i]).toBe(1);
		}
	});

	it('every effect item has an effect; only the plain look draws it, and it goes with the character', () => {
		const fx = [...ids].map((id) => getCosmetic(id)!).filter((i) => i.slot === 'effect');
		expect(fx).toHaveLength(11);
		expect(fx.filter((i) => i.rarity === 'rare')).toHaveLength(10);
		expect(effectDef('effect_nope')).toBeNull();
		expect(effectDef('toString')).toBeNull();
		for (const i of fx) expect(effectDef(i.id), i.id).not.toBeNull();
		const m = new CharacterModel(personOf(4), assets);
		const drawn = () => m.group.children.filter((c) => c.name.startsWith('effect-'));
		expect(drawn()).toHaveLength(0);
		applyLoadout(m, wear({ effect: 'effect_fire' }));
		expect(drawn()).toHaveLength(2);
		// The shell follows clothes and LOD.
		applyLoadout(m, wear({ effect: 'effect_fire', top: 'top_sunset' }));
		m.update(1 / 60, emptyMotion(), 3000);
		const shell = drawn().find((c) => c.name === 'effect-shell') as THREE.SkinnedMesh;
		expect(shell.geometry).toBe(m.mesh.geometry);
		expect(drawn().find((c) => c.name === 'effect-flames')!.visible).toBe(false);
		m.setRole('it');
		expect(drawn()).toHaveLength(0);
		m.setRole('none');
		expect(drawn()).toHaveLength(2);
		m.setEffects(false);
		expect(drawn()).toHaveLength(0);
		m.setEffects(true);
		applyLoadout(m, wear({ effect: 'effect_blue' }));
		expect(drawn()).toHaveLength(2);
		m.dispose();
		const ghost = new CharacterModel(personOf(4), assets, { ghost: true });
		applyLoadout(ghost, wear({ effect: 'effect_fire' }));
		expect(ghost.group.children.filter((c) => c.name.startsWith('effect-'))).toHaveLength(2);
		// In the real colours of the player and the items.
		const solid = new CharacterModel(personOf(4), assets);
		applyLoadout(ghost, wear({ top: 'top_sunset' }));
		applyLoadout(solid, wear({ top: 'top_sunset' }));
		expect(ghost.material.palette).toEqual(solid.material.palette);
		solid.dispose();
		ghost.dispose();
	});

	it('roles override clothing colours and keep the loadout', () => {
		const m = new CharacterModel(personOf(3), assets);
		applyLoadout(m, wear(SAMPLE_IDS));
		const color = (i: number) => m.material.palette[i]!.clone();
		const own = color(PAL.topA);
		const lens = color(PAL.glassesB);
		const full = m.mesh.geometry;
		for (const role of ['it', 'seeker', 'zombie', 'infected', 'alpha'] as CharacterRole[]) {
			m.setRole(role);
			for (const i of [PAL.topA, PAL.bottomA, PAL.hatA]) expect(color(i).equals(own)).toBe(false);
			// Glowing eyes are never covered.
			const eyes = role !== 'it' && role !== 'seeker';
			expect(m.mesh.geometry === full).toBe(!eyes);
			expect(color(PAL.iris).w).toBe(eyes ? 1 : 0);
		}
		m.setRole('none');
		expect(color(PAL.topA).equals(own)).toBe(true);
		expect(color(PAL.glassesB).equals(lens)).toBe(true);
		expect(m.getLoadout()).toEqual(wear(SAMPLE_IDS));
		m.dispose();
	});

	it('held items hang on the right hand socket; claws do not', () => {
		const m = new CharacterModel(personOf(4), assets);
		const run = () => {
			for (let i = 0; i < 30; i++) m.update(1 / 60, emptyMotion(), 0);
		};
		m.setHeld('pistol');
		run();
		expect(m.sockets.handR.children[0]?.visible).toBe(true);
		m.setHeld('claws');
		run();
		expect(m.sockets.handR.children[0]?.visible).toBe(false);
		m.dispose();
	});
});

describe('detail', () => {
	it('LOD switches with hysteresis and sooner in a crowd', () => {
		expect([pickLod(100, 0), pickLod(660, 0), pickLod(660, 1), pickLod(720, 0), pickLod(5000, 1)]).toEqual([0, 0, 1, 1, 2]);
		expect(crowdScale(5)).toBe(1);
		expect(crowdScale(200)).toBeCloseTo(2.2);
	});

	it('a person is stable per id and varied across ids', () => {
		expect(personOf(5)).toEqual(personOf(5));
		expect(new Set(Array.from({ length: 32 }, (_, i) => personOf(i).style)).size).toBeGreaterThan(3);
	});
});
