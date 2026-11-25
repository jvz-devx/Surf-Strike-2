/**
 * One drawable character (docs/characters.md): skinned mesh, skeleton,
 * animator, palette, role look, cosmetics and held item. One draw call for the
 * body, one more for a held item.
 */
import { COSMETIC_SLOTS, emptyLoadout, type CosmeticSlot, type Loadout } from '@surf/shared';
import * as THREE from 'three';
import { CharacterAnimator, type MotionState, type Posture } from './animator.js';
import { CharacterEffect, effectDef } from './effects.js';
import { HAIR_STYLES, type HairStyle } from './body.js';
import { acquireLook, lookKey, type LookGeometry, type LookSpec } from './geometry.js';
import type { GunId } from '../gun-rig.js';
import { FLASHES, nextShape } from '../muzzle-flash.js';
import { HELD, HeldAssets, type HeldItem } from './held.js';
import { drawnItems, itemMesh, type PlayerTint } from './items.js';
import { CharacterMaterial } from './material.js';
import { PAL, type Lod } from './mesh-kit.js';
import './shop-items.js';
import './basic/index.js';
import './common/index.js';
import './uncommon/index.js';
import './rare/index.js';
import './epic/index.js';
import { BONES, commitPose, createSkeleton, type CharacterSkeleton, type SocketName } from './skeleton.js';

/** Gameplay looks. They override clothing colours, so they read at any distance. */
export type CharacterRole = 'none' | 'it' | 'seeker' | 'zombie' | 'infected' | 'alpha' | 'ghost';

/** Stable hue from a player id. */
export function playerHue(id: number): number {
	let h = (id + 1) * 2654435761;
	h = (h ^ (h >>> 16)) >>> 0;
	return (h % 360) / 360;
}

const SKINS = [0xf1c9a5, 0xe3ae86, 0xcf9467, 0xa86f47, 0x7d4f33, 0x5a3826].map((h) => new THREE.Color(h));
const HAIRS = [0x1d1714, 0x3a2416, 0x6b4122, 0xa97838, 0xd9b76a, 0x8a3a1e, 0x6f7076].map((h) => new THREE.Color(h));

/** The person under the clothes. */
export interface Person {
	skin: THREE.Color;
	hair: THREE.Color;
	style: HairStyle;
	tint: PlayerTint;
}

/** Stable look of a player id: hue for the default clothes, skin, hair. */
export function personOf(id: number): Person {
	const hue = playerHue(id);
	let h = Math.imul(id + 7, 0x9e3779b1) >>> 0;
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
	h = (h ^ (h >>> 13)) >>> 0;
	return {
		skin: SKINS[h % SKINS.length]!,
		hair: HAIRS[(h >>> 4) % HAIRS.length]!,
		style: HAIR_STYLES[(h >>> 9) % HAIR_STYLES.length]!,
		tint: {
			top: new THREE.Color().setHSL(hue, 0.62, 0.5),
			bottom: new THREE.Color().setHSL(hue, 0.24, 0.24)
		}
	};
}

const SLOT_PAL: Record<Exclude<CosmeticSlot, 'effect'>, number> = { hat: PAL.hatA, glasses: PAL.glassesA, top: PAL.topA, bottom: PAL.bottomA, shoes: PAL.shoesA };
const c1 = new THREE.Color();
const c2 = new THREE.Color();

interface RoleLook {
	posture: Posture;
	skin?: number;
	skinGlow?: number;
	hair?: number;
	eyes?: number;
	/** Colours A-D and glow of the overridden slots; unlisted slots keep the item's colours. */
	top?: readonly number[];
	topGlow?: number;
	bottom?: readonly number[];
	bottomGlow?: number;
	shoes?: readonly number[];
	hat?: readonly number[];
	/** Eyes must be visible: no glasses. */
	bareEyes?: boolean;
	claws?: boolean;
}

const RED: RoleLook = {
	posture: 'normal',
	top: [0xe02424, 0xb31218, 0xff6a52, 0x3a0808],
	topGlow: 0.22,
	bottom: [0x6a0f10, 0x4a090b, 0x2a0606, 0xff6a52],
	bottomGlow: 0.1,
	shoes: [0x3a0a0a, 0xe02424, 0xe02424, 0x6a0f10],
	hat: [0xe02424, 0xb31218, 0xff6a52, 0x3a0808]
};

const ROLES: Record<CharacterRole, RoleLook> = {
	none: { posture: 'normal' },
	it: RED,
	seeker: RED,
	zombie: {
		posture: 'zombie',
		skin: 0x86a576,
		hair: 0x2e3328,
		eyes: 0xd8ff6a,
		top: [0x4e5a52, 0x3e4942, 0x68705e, 0x2b312c],
		bottom: [0x3a3a40, 0x2c2c32, 0x26262a, 0x50504a],
		shoes: [0x2a2a2c, 0x4a4a46, 0x35352f, 0x4c4f46],
		hat: [0x4e5a52, 0x3e4942, 0x68705e, 0x2b312c],
		bareEyes: true
	},
	infected: {
		posture: 'infected',
		skin: 0x7a3a36,
		skinGlow: 0.16,
		hair: 0x1a0c0c,
		eyes: 0xff3a1e,
		top: [0x6e0e14, 0x560a10, 0x9a1a1e, 0x1c0507],
		topGlow: 0.3,
		bottom: [0x1c1012, 0x120a0c, 0x0c0708, 0x3c070b],
		shoes: [0x140c0d, 0x241012, 0x2a0a0c, 0x1c1012],
		hat: [0x6e0e14, 0x3c070b, 0x9a1a1e, 0x1c0507],
		bareEyes: true
	},
	alpha: {
		posture: 'infected',
		skin: 0x4a2c20,
		skinGlow: 0.3,
		hair: 0x0c0808,
		eyes: 0xffb21e,
		top: [0x8a3c0a, 0x642c0a, 0xff9420, 0x180c06],
		topGlow: 0.5,
		bottom: [0x140e0c, 0xff7a14, 0x2a1408, 0xff9420],
		bottomGlow: 0.25,
		shoes: [0x120c0a, 0xc85a10, 0x2a1408, 0x140e0c],
		hat: [0x8a3c0a, 0x2a1408, 0xff9420, 0x180c06],
		bareEyes: true
	},
	ghost: { posture: 'normal' }
};

/** Which LOD a character gets at a distance from the camera (u), with hysteresis. */
export function pickLod(dist: number, current: Lod): Lod {
	const a = current > 0 ? 620 : 700;
	const b = current > 1 ? 1750 : 1950;
	return dist < a ? 0 : dist < b ? 1 : 2;
}

/** Frames between animation updates at an effective distance. The position still moves every frame. */
export function animateEvery(dist: number): number {
	return dist > 2400 ? 4 : dist > 1500 ? 3 : dist > 800 ? 2 : 1;
}

export class CharacterModel {
	/** Add this to the scene: feet at its origin, turned by `setYaw`. */
	readonly group = new THREE.Group();
	readonly mesh: THREE.SkinnedMesh<THREE.BufferGeometry, CharacterMaterial>;
	readonly material: CharacterMaterial;
	readonly animator: CharacterAnimator;
	/** Attachment points. Add rigid meshes with `attach`. */
	readonly sockets: CharacterSkeleton['sockets'];
	private readonly sk: CharacterSkeleton;
	private look: LookGeometry;
	private lod: Lod = 0;
	private person: Person;
	private loadout: Loadout = emptyLoadout();
	private role: CharacterRole = 'none';
	private claws = false;
	private depth: THREE.SkinnedMesh<THREE.BufferGeometry, THREE.Material> | null = null;
	private effect: CharacterEffect | null = null;
	private effectId: string | null = null;
	private effectsOn = true;
	private heldMesh: THREE.Mesh | null = null;
	private heldShown: HeldItem | null = null;
	private flashMesh: THREE.Mesh | null = null;
	private flashShape = -1;
	private flashShots = 0;
	/** The gun in parts, while its player reloads (built once, at the first reload). */
	private magMesh: THREE.Mesh | null = null;
	private dropMesh: THREE.Mesh | null = null;
	private actMesh: THREE.Mesh | null = null;
	private split: HeldItem | null = null;
	/** Throwing knife of an infected, in the left claw. */
	private hasKnife = false;
	private knifeHand: THREE.Mesh | null = null;
	/** Seconds of animation not yet applied (throttled far characters). */
	private pending = 0;
	private skip = Math.floor(Math.random() * 3);

	constructor(
		person: Person,
		private readonly assets: HeldAssets,
		private readonly opts: { ghost?: boolean; tag?: string } = {}
	) {
		this.person = person;
		this.material = new CharacterMaterial(opts.ghost);
		if (opts.ghost) this.role = 'ghost';
		this.sk = createSkeleton();
		this.sockets = this.sk.sockets;
		this.look = acquireLook(this.spec());
		this.mesh = new THREE.SkinnedMesh(this.look.get(0), this.material);
		this.mesh.name = 'character';
		this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 36, 0), 56);
		// Bone matrices are already in model space: no bind transforms.
		this.mesh.bindMode = THREE.DetachedBindMode;
		this.mesh.bind(this.sk.skeleton, new THREE.Matrix4());
		this.group.add(this.mesh);
		if (opts.ghost) {
			// Depth first: only the outermost surface of the see-through body is drawn.
			const m = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
			this.depth = new THREE.SkinnedMesh(this.mesh.geometry, m);
			this.depth.boundingSphere = this.mesh.boundingSphere;
			this.depth.bindMode = THREE.DetachedBindMode;
			this.depth.bind(this.sk.skeleton, new THREE.Matrix4());
			// With the transparent objects, before the body.
			m.transparent = true;
			this.depth.renderOrder = 3.5;
			this.mesh.renderOrder = 4;
			this.group.add(this.depth);
		}
		this.animator = new CharacterAnimator(this.sk);
		this.recolor();
	}

	// ---- Look ------------------------------------------------------------------

	private spec(): LookSpec {
		const items = drawnItems(this.loadout);
		// A mask over the whole face leaves no room for glasses.
		if (ROLES[this.role].bareEyes || (items.hat && itemMesh(items.hat)?.coversFace)) items.glasses = null;
		return { hair: this.person.style, items, claws: this.claws, ...(this.opts.tag ? { tag: this.opts.tag } : {}) };
	}

	private rebuild(): void {
		const spec = this.spec();
		if (lookKey(spec) !== this.look.key) {
			const old = this.look;
			this.look = acquireLook(spec);
			this.mesh.geometry = this.look.get(this.lod);
			this.effect?.setGeometry(this.mesh.geometry);
			if (this.depth) this.depth.geometry = this.mesh.geometry;
			old.release();
		}
		this.recolor();
	}

	/** Wear a loadout (docs/characters.md). Same as `applyLoadout(model, loadout)`. */
	setLoadout(loadout: Loadout): void {
		if (COSMETIC_SLOTS.every((s) => this.loadout[s] === loadout[s])) return;
		this.loadout = { ...loadout };
		this.rebuild();
		this.syncEffect();
	}

	getLoadout(): Loadout {
		return { ...this.loadout };
	}

	setPerson(person: Person): void {
		this.person = person;
		this.rebuild();
	}

	setRole(role: CharacterRole): void {
		if (role === this.role) return;
		this.role = role;
		this.animator.posture = ROLES[role].posture;
		this.rebuild();
		this.syncEffect();
	}

	/** Draw worn effects or not (not in hide and seek: they would give hiders away). */
	setEffects(on: boolean): void {
		if (on === this.effectsOn) return;
		this.effectsOn = on;
		this.syncEffect();
	}

	/** Role looks must read at any distance: no effects on them. The ghost's are fainter. */
	private syncEffect(): void {
		const def = this.effectsOn && (this.role === 'none' || this.role === 'ghost') ? effectDef(this.loadout.effect) : null;
		const id = def ? this.loadout.effect : null;
		if (id === this.effectId) return;
		this.effectId = id;
		this.effect?.dispose();
		this.effect = def ? new CharacterEffect(def, this.mesh.geometry, this.sk.skeleton, this.role === 'ghost' ? 0.5 : 1) : null;
		if (this.effect) this.group.add(...this.effect.objects);
	}

	getRole(): CharacterRole {
		return this.role;
	}

	/**
	 * Item in the hands; `claws` grows talons instead. `knife`: an infected
	 * still has the throwing knife. Returns whether the item changed.
	 */
	setHeld(item: HeldItem | 'claws' | null, knife = false): boolean {
		const claws = item === 'claws';
		const changed = item !== this.held;
		this.animator.held = claws ? null : item;
		if (changed || knife !== this.hasKnife) {
			this.hasKnife = knife;
			if (knife && claws && !this.knifeHand) this.attach('handL', (this.knifeHand = this.assets.knifeInHand()));
			if (this.knifeHand) this.knifeHand.visible = knife && claws;
		}
		if (claws === this.claws) return changed;
		this.claws = claws;
		this.animator.claws = claws;
		this.rebuild();
		return changed;
	}

	/** What `setHeld` last put in the hands. */
	get held(): HeldItem | 'claws' | null {
		return this.claws ? 'claws' : this.animator.held;
	}

	/** The throwing knife of an infected. */
	get knife(): boolean {
		return this.hasKnife;
	}

	/** Holds a gun. */
	get gun(): boolean {
		const h = this.animator.held;
		return h !== null && HELD[h].muzzle !== null;
	}

	/** A gun is in the hands and drawn (not during the swap to it). */
	get hasMuzzle(): boolean {
		return this.gun && this.heldShown === this.animator.held;
	}

	/** World position of the muzzle of the drawn gun; false without one. */
	muzzle(out: THREE.Vector3): boolean {
		if (!this.hasMuzzle || !this.heldMesh) return false;
		const m = HELD[this.heldShown!].muzzle!;
		this.heldMesh.updateWorldMatrix(true, false);
		this.heldMesh.localToWorld(out.set(m[0], m[1], m[2]));
		return true;
	}

	/** Show or hide the muzzle flash of the drawn gun. */
	showMuzzle(on: boolean): void {
		if (!on || !this.hasMuzzle || !this.heldMesh) {
			if (this.flashMesh) this.flashMesh.visible = false;
			return;
		}
		if (!this.flashMesh) {
			this.flashMesh = new THREE.Mesh(this.assets.flashes.of('pistol')[0], this.assets.flashes.material);
			this.flashMesh.name = 'muzzle';
			this.flashMesh.renderOrder = 3;
			this.heldMesh.add(this.flashMesh);
		}
		const id = this.heldShown as GunId;
		const { muzzle, flash } = HELD[id];
		// With reduced motion one flash in three, and a smaller one: a burst doesn't strobe.
		if (this.assets.calm && this.flashShots++ % 3 !== 0) {
			this.flashMesh.visible = false;
			return;
		}
		const shapes = this.assets.flashes.of(id);
		this.flashShape = nextShape(this.flashShape, shapes.length);
		this.flashMesh.geometry = shapes[this.flashShape]!;
		this.flashMesh.position.set(muzzle![0], muzzle![1], muzzle![2]);
		this.flashMesh.scale.setScalar(flash * (0.85 + 0.3 * Math.random()) * (this.assets.calm ? 0.6 : 1));
		// The brake of the .50 cal blows to the sides.
		this.flashMesh.rotation.x = FLASHES[id].jets > 0 ? 0 : Math.random() * Math.PI * 2;
		this.flashMesh.visible = true;
	}

	/** Write the palette of the look (of another role: to ease between the two). */
	recolor(role: CharacterRole = this.role): void {
		const m = this.material;
		const p = this.person;
		const r = ROLES[role];
		const hex = (i: number, h: number, glow = 0) => m.set(i, c1.setHex(h), glow);
		if (r.skin !== undefined) c2.setHex(r.skin);
		else c2.copy(p.skin);
		m.set(PAL.skin, c2, r.skinGlow ?? 0);
		m.set(PAL.skinDark, c1.copy(c2).multiplyScalar(0.72), r.skinGlow ?? 0);
		if (r.hair !== undefined) c2.setHex(r.hair);
		else c2.copy(p.hair);
		m.set(PAL.hair, c2);
		m.set(PAL.brow, c1.copy(c2).multiplyScalar(0.7));
		if (r.eyes !== undefined) {
			hex(PAL.eyeWhite, r.eyes, 1);
			hex(PAL.iris, r.eyes, 1);
		} else {
			hex(PAL.eyeWhite, 0xf4f1ea, 0.12);
			hex(PAL.iris, 0x2b2018);
		}
		hex(PAL.mouth, r.claws || this.claws ? 0x1a1214 : 0x5d2a26);
		const items = drawnItems(this.loadout);
		for (const slot of COSMETIC_SLOTS) {
			if (slot === 'effect') continue;
			const base = SLOT_PAL[slot];
			const over = slot === 'glasses' ? undefined : r[slot];
			const glow = slot === 'top' ? (r.topGlow ?? 0) : slot === 'bottom' ? (r.bottomGlow ?? 0) : slot === 'hat' ? (r.topGlow ?? 0) : 0;
			const def = items[slot] ? itemMesh(items[slot]!) : undefined;
			const own = typeof def?.colors === 'function' ? def.colors(p.tint) : (def?.colors ?? []);
			for (let i = 0; i < 4; i++) {
				const h = over?.[i] ?? own[i] ?? own[0] ?? 0xffffff;
				hex(base + i, h, over ? glow : (def?.glow?.[i] ?? 0));
			}
		}
	}

	// ---- Frame -------------------------------------------------------------------

	setYaw(deg: number): void {
		this.group.rotation.y = (deg * Math.PI) / 180;
	}

	/**
	 * Animate and pick the LOD. `dist` to the camera (u). Far characters animate
	 * on fewer frames. Returns the height of the crown above the feet.
	 */
	update(dtSec: number, s: MotionState, dist: number): number {
		this.setYaw(s.yaw);
		const lod = pickLod(dist, this.lod);
		if (lod !== this.lod) {
			this.lod = lod;
			this.mesh.geometry = this.look.get(lod);
			this.effect?.setGeometry(this.mesh.geometry);
			if (this.depth) this.depth.geometry = this.mesh.geometry;
		}
		this.effect?.update(dtSec, dist, s.vx, s.vy, s.vz);
		this.pending += dtSec;
		if (--this.skip <= 0) {
			this.skip = animateEvery(dist);
			this.animator.update(this.pending, s);
			this.pending = 0;
			this.syncHeld();
			commitPose(this.sk);
		}
		return this.animator.headTop;
	}

	/**
	 * Take over the look and the pose of another character as it stands: person,
	 * clothes, role, claws, LOD, bones and facing (a corpse). Nothing held.
	 */
	mirror(from: CharacterModel): void {
		this.person = from.person;
		this.loadout = { ...from.loadout };
		this.role = from.role;
		this.claws = from.claws;
		this.rebuild();
		this.lod = from.lod;
		this.mesh.geometry = this.look.get(this.lod);
		this.group.rotation.y = from.group.rotation.y;
		for (const b of BONES) {
			this.sk.bones[b].position.copy(from.sk.bones[b].position);
			this.sk.bones[b].quaternion.copy(from.sk.bones[b].quaternion);
		}
		commitPose(this.sk);
	}

	/** Pose at once, whatever the throttle says (a model that gets one pose only). */
	settle(s: MotionState): void {
		this.skip = 0;
		this.update(0, s, 0);
	}

	/** Off screen: no animation, only keep the facing and the elapsed time. */
	skipFrame(dtSec: number, s: MotionState): void {
		this.setYaw(s.yaw);
		this.pending += dtSec;
		if (this.pending > 0.15) this.skip = 0;
	}

	private syncHeld(): void {
		const want = this.animator.drawnHeld;
		if (this.split !== null && (want !== this.split || !this.animator.partsOn)) this.join();
		this.swapHeld(want);
		if (this.animator.partsOn) this.syncParts();
	}

	/** Draw the held gun in parts, where the animator has them. */
	private syncParts(): void {
		const gun = this.heldMesh;
		const item = this.heldShown;
		const parts = item && this.assets.parts(item);
		if (!gun || !parts) return;
		const p = this.animator.parts;
		if (this.split !== item) {
			this.split = item;
			gun.geometry = parts.body;
			const mag = (this.magMesh ??= this.part('mag', this.mesh));
			mag.geometry = parts.mag;
			if (parts.act) {
				const act = (this.actMesh ??= this.part('held-act', gun));
				act.geometry = parts.act;
				act.visible = true;
			}
		}
		const mag = this.magMesh!;
		mag.visible = p.mag !== 'none';
		mag.position.copy(p.magP);
		mag.quaternion.copy(p.magQ);
		if (p.falling) {
			const drop = (this.dropMesh ??= this.part('mag-drop', this.mesh));
			drop.geometry = parts.mag;
			drop.position.copy(p.fallP);
			drop.quaternion.copy(p.fallQ);
		}
		if (this.dropMesh) this.dropMesh.visible = p.falling;
		if (this.actMesh) {
			this.actMesh.position.copy(p.actP);
			this.actMesh.quaternion.copy(p.actQ);
		}
		if (p.off) {
			gun.position.copy(p.offP);
			gun.quaternion.copy(p.offQ);
		} else {
			gun.position.set(0, 0, 0);
			gun.quaternion.identity();
		}
	}

	private part(name: string, parent: THREE.Object3D): THREE.Mesh {
		const m = new THREE.Mesh(new THREE.BufferGeometry(), this.assets.material);
		m.name = name;
		parent.add(m);
		return m;
	}

	/** Back to the gun as one mesh, in the hand. */
	private join(): void {
		this.heldMesh!.geometry = this.assets.geometry(this.split!);
		this.heldMesh!.position.set(0, 0, 0);
		this.heldMesh!.quaternion.identity();
		this.split = null;
		for (const m of [this.magMesh, this.dropMesh, this.actMesh]) if (m) m.visible = false;
	}

	/** Parts drawn besides the gun (tests and debugging). */
	get partsShown(): string[] {
		return [this.magMesh, this.dropMesh, this.actMesh].filter((m) => m?.visible).map((m) => m!.name);
	}

	private swapHeld(want: HeldItem | null): void {
		if (want === this.heldShown) return;
		this.heldShown = want;
		if (this.flashMesh) this.flashMesh.visible = false;
		if (!want) {
			if (this.heldMesh) this.heldMesh.visible = false;
			return;
		}
		if (!this.heldMesh) {
			this.heldMesh = new THREE.Mesh(this.assets.geometry(want), this.assets.material);
			this.heldMesh.name = 'held';
			this.attach('handR', this.heldMesh);
		}
		this.heldMesh.geometry = this.assets.geometry(want);
		this.heldMesh.visible = true;
	}

	/** Attach a rigid object to a socket (held items, tests). */
	attach(socket: SocketName, o: THREE.Object3D): void {
		this.sockets[socket].add(o);
		this.mesh.add(this.sockets[socket]);
		commitPose(this.sk);
	}

	/** Triangles of the current body geometry (dev tools). */
	get triangles(): number {
		return this.mesh.geometry.getIndex()!.count / 3;
	}

	get currentLod(): Lod {
		return this.lod;
	}

	dispose(): void {
		this.group.removeFromParent();
		this.effect?.dispose();
		this.depth?.material.dispose();
		this.look.release();
		this.sk.skeleton.dispose();
		this.material.dispose();
	}
}

/** Dress a model: the single entry point for cosmetics. */
export function applyLoadout(model: CharacterModel, loadout: Loadout): void {
	model.setLoadout(loadout);
}
