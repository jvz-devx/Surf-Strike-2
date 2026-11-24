/**
 * One drawable character (docs/characters.md): skinned mesh, skeleton,
 * animator, palette, role look, cosmetics and held item. One draw call for the
 * body, one more for a held item.
 */
import { COSMETIC_SLOTS, emptyLoadout, type CosmeticSlot, type Loadout } from '@surf/shared';
import * as THREE from 'three';
import { CharacterAnimator, type MotionState, type Posture } from './animator.js';
import { HAIR_STYLES, type HairStyle } from './body.js';
import { acquireLook, lookKey, type LookGeometry, type LookSpec } from './geometry.js';
import { HeldAssets, type HeldItem } from './held.js';
import { drawnItems, itemMesh, type PlayerTint } from './items.js';
import { CharacterMaterial } from './material.js';
import { PAL, type Lod } from './mesh-kit.js';
import './shop-items.js';
import './common/index.js';
import { commitPose, createSkeleton, type CharacterSkeleton, type SocketName } from './skeleton.js';

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

const SLOT_PAL: Record<CosmeticSlot, number> = { hat: PAL.hatA, glasses: PAL.glassesA, top: PAL.topA, bottom: PAL.bottomA, shoes: PAL.shoesA };
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
	private heldMesh: THREE.Mesh | null = null;
	private heldShown: HeldItem | null = null;
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
		this.animator = new CharacterAnimator(this.sk);
		this.recolor();
	}

	// ---- Look ------------------------------------------------------------------

	private spec(): LookSpec {
		const items = drawnItems(this.loadout);
		if (ROLES[this.role].bareEyes) items.glasses = null;
		return { hair: this.person.style, items, claws: this.claws, ...(this.opts.tag ? { tag: this.opts.tag } : {}) };
	}

	private rebuild(): void {
		const spec = this.spec();
		if (lookKey(spec) !== this.look.key) {
			const old = this.look;
			this.look = acquireLook(spec);
			this.mesh.geometry = this.look.get(this.lod);
			old.release();
		}
		this.recolor();
	}

	/** Wear a loadout (docs/characters.md). Same as `applyLoadout(model, loadout)`. */
	setLoadout(loadout: Loadout): void {
		if (COSMETIC_SLOTS.every((s) => this.loadout[s] === loadout[s])) return;
		this.loadout = { ...loadout };
		this.rebuild();
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
	}

	getRole(): CharacterRole {
		return this.role;
	}

	/** Item in the hands; `claws` grows talons instead. */
	setHeld(item: HeldItem | 'claws' | null): void {
		const claws = item === 'claws';
		this.animator.held = claws ? null : item;
		if (claws === this.claws) return;
		this.claws = claws;
		this.animator.claws = claws;
		this.rebuild();
	}

	private recolor(): void {
		const m = this.material;
		const p = this.person;
		const r = ROLES[this.role];
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
			const base = SLOT_PAL[slot];
			const over = slot === 'glasses' ? undefined : r[slot];
			const glow = slot === 'top' ? (r.topGlow ?? 0) : slot === 'bottom' ? (r.bottomGlow ?? 0) : slot === 'hat' ? (r.topGlow ?? 0) : 0;
			const def = items[slot] ? itemMesh(items[slot]!) : undefined;
			const own = typeof def?.colors === 'function' ? def.colors(p.tint) : (def?.colors ?? []);
			for (let i = 0; i < 4; i++) {
				const h = over?.[i] ?? own[i] ?? own[0] ?? 0xffffff;
				hex(base + i, h, over ? glow : 0);
			}
		}
		if (this.role === 'ghost') this.ghostTint();
	}

	private ghostTint(): void {
		const base = c2.setHex(0x9fdcff);
		for (const v of this.material.palette) {
			// Keep some of each part's lightness so the figure stays readable.
			const l = 0.55 + 0.45 * Math.sqrt(0.3 * v.x + 0.6 * v.y + 0.1 * v.z);
			v.set(base.r * l, base.g * l, base.b * l, 0.6);
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
		}
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

	/** Off screen: no animation, only keep the facing and the elapsed time. */
	skipFrame(dtSec: number, s: MotionState): void {
		this.setYaw(s.yaw);
		this.pending += dtSec;
		if (this.pending > 0.15) this.skip = 0;
	}

	private syncHeld(): void {
		const want = this.animator.drawnHeld;
		if (want === this.heldShown) return;
		this.heldShown = want;
		if (!want) {
			if (this.heldMesh) this.heldMesh.visible = false;
			return;
		}
		if (!this.heldMesh) {
			this.heldMesh = new THREE.Mesh(this.assets.geometry(want), this.assets.material);
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
		this.look.release();
		this.sk.skeleton.dispose();
		this.material.dispose();
	}
}

/** Dress a model: the single entry point for cosmetics. */
export function applyLoadout(model: CharacterModel, loadout: Loadout): void {
	model.setLoadout(loadout);
}
