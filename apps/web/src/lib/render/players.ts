/**
 * Remote players and the race ghost: character models (docs/characters.md)
 * with a name tag sprite. Positions are Source feet origins.
 */
import { emptyLoadout, type Loadout, type WeaponId } from '@surf/shared';
import * as THREE from 'three';
import { emptyMotion, type MotionState } from './character/animator.js';
import type { CrowdView } from './character/crowd.js';
import type { HeldAssets, HeldItem } from './character/held.js';
import { PALETTE_SIZE } from './character/material.js';
import { applyLoadout, CharacterModel, personOf, type CharacterRole } from './character/model.js';
import { VelocityTracker } from './character/motion.js';

/** Height of the name tag centre above the crown. */
const TAG_ABOVE = 14;
/** Hit flash on the victim's avatar (ms) and its white glow (Infected). */
export const HIT_FLASH_MS = 100;
const HIT_FLASH = new THREE.Color(0xffffff).multiplyScalar(0.55);
const NO_GLOW = new THREE.Color(0x000000);
/** A survivor who turns eases into the infected colours over this long (ms). */
export const TURN_EASE_MS = 450;
/** `turn()` arms the ease for the role flip of the next mode state (ms). */
const TURN_ARM_MS = 1500;
/** Muzzle flash of a remote shot (ms). */
export const MUZZLE_FLASH_MS = 55;
const V = new THREE.Vector3();

/** Pose and motion of a player this frame (Source units and axes). */
export interface AvatarPose extends MotionState {
	x: number;
	y: number;
	z: number;
}

export function emptyPose(): AvatarPose {
	return { x: 0, y: 0, z: 0, ...emptyMotion() };
}

interface Avatar {
	root: THREE.Group;
	model: CharacterModel;
	motion: MotionState;
	tag: THREE.Sprite;
	tagTex: THREE.CanvasTexture;
	name: string;
	/** Tag mode: this player is IT (red tint, red name tag). */
	it: boolean;
	/** Zombie Run: turned into a zombie (zombie colours, green tag). */
	zombie: boolean;
	/** Infected mode: 'infected' (blood-red look, red tag) or 'alpha' (Patient Zero: charred, orange glow and tag). */
	infected: InfectedRole;
	/** Hide and seek: a seeker (red tint, red SEEKER tag). */
	seeker: boolean;
	/** Infected practice range: a target dummy (its tag is the bare name, whatever its look). */
	target: boolean;
	/** Hit flash and muzzle flash until (ms); 0 when off. */
	flashUntil: number;
	muzzleUntil: number;
	/** Turn ease: palettes it runs between and its start (-Infinity when not easing); `turnAt` arms it. */
	from: Float32Array;
	to: Float32Array;
	easeAt: number;
	turnAt: number;
	/** Running reload: the gun, when it started and how long it takes (ms); 0 ms when none runs. */
	reloadItem: HeldItem | null;
	reloadAt: number;
	reloadMs: number;
}

export type InfectedRole = 'none' | 'infected' | 'alpha';
export type InfectedLook = Exclude<InfectedRole, 'none'>;

type TagStyle = 'plain' | 'it' | 'zombie' | 'infected' | 'alpha' | 'seeker';

const TAG_STYLE: Record<TagStyle, { prefix: string; bg: string }> = {
	plain: { prefix: '', bg: 'rgba(8, 12, 18, 0.55)' },
	it: { prefix: 'IT · ', bg: 'rgba(200, 24, 24, 0.85)' },
	zombie: { prefix: 'ZOMBIE · ', bg: 'rgba(40, 110, 40, 0.85)' },
	infected: { prefix: 'INFECTED · ', bg: 'rgba(150, 16, 24, 0.88)' },
	alpha: { prefix: 'PATIENT ZERO · ', bg: 'rgba(214, 104, 12, 0.92)' },
	seeker: { prefix: 'SEEKER · ', bg: 'rgba(200, 24, 24, 0.85)' }
};

function makeTag(name: string, style: TagStyle = 'plain'): { tex: THREE.CanvasTexture; aspect: number } {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 64;
	const g = canvas.getContext('2d');
	if (g) {
		const st = TAG_STYLE[style];
		name = st.prefix + name;
		g.font = `600 ${style === 'infected' || style === 'alpha' ? 28 : 34}px "Barlow Semi Condensed", "Rajdhani", sans-serif`;
		g.textAlign = 'center';
		g.textBaseline = 'middle';
		const w = Math.min(250, g.measureText(name).width + 24);
		g.fillStyle = st.bg;
		g.fillRect(128 - w / 2, 10, w, 44);
		if (style === 'alpha' || style === 'infected') {
			// Dark outer outline, then a bright inner one: the tag reads on sand and on sky.
			g.strokeStyle = 'rgba(0, 0, 0, 0.85)';
			g.lineWidth = 2;
			g.strokeRect(128 - w / 2 - 1, 9, w + 2, 46);
			g.strokeStyle = style === 'alpha' ? 'rgba(255, 214, 120, 0.95)' : 'rgba(255, 120, 120, 0.85)';
			g.lineWidth = 3;
			g.strokeRect(128 - w / 2 + 1.5, 11.5, w - 3, 41);
			g.lineWidth = 4;
			g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
			g.lineJoin = 'round';
			g.strokeText(name, 128, 33, 240);
		}
		g.fillStyle = '#ffffff';
		g.shadowColor = 'rgba(0,0,0,0.8)';
		g.shadowBlur = 4;
		g.fillText(name, 128, 33, 240);
	}
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	return { tex, aspect: 4 };
}

export class RemotePlayers {
	readonly group = new THREE.Group();
	private avatars = new Map<number, Avatar>();
	private loadouts = new Map<number, Loadout>();
	private hidden = false;
	private effects = true;

	constructor(private readonly assets: HeldAssets) {
		this.group.name = 'players';
	}

	setHidden(hidden: boolean): void {
		this.hidden = hidden;
		this.group.visible = !hidden;
	}

	get isHidden(): boolean {
		return this.hidden;
	}

	private create(id: number, name: string): Avatar {
		const model = new CharacterModel(personOf(id), this.assets);
		model.setEffects(this.effects);
		const loadout = this.loadouts.get(id);
		if (loadout) applyLoadout(model, loadout);

		const { tex } = makeTag(name);
		const tagMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
		const tag = new THREE.Sprite(tagMat);
		tag.scale.set(64, 16, 1);
		tag.position.set(0, 72 + TAG_ABOVE, 0);
		tag.renderOrder = 5;

		const root = new THREE.Group();
		root.add(model.group, tag);
		this.group.add(root);
		return {
			root,
			model,
			motion: emptyMotion(),
			tag,
			tagTex: tex,
			name,
			it: false,
			zombie: false,
			infected: 'none',
			seeker: false,
			target: false,
			flashUntil: 0,
			muzzleUntil: 0,
			from: new Float32Array(PALETTE_SIZE),
			to: new Float32Array(PALETTE_SIZE),
			easeAt: -Infinity,
			turnAt: -Infinity,
			reloadItem: null,
			reloadAt: 0,
			reloadMs: 0
		};
	}

	/** Ensure an avatar exists with this name. */
	upsert(id: number, name: string): void {
		const a = this.avatars.get(id);
		if (!a) {
			const av = this.create(id, name);
			av.root.visible = false;
			this.avatars.set(id, av);
			return;
		}
		if (a.name !== name) {
			a.name = name;
			this.retag(a);
		}
	}

	private retag(a: Avatar): void {
		a.tagTex.dispose();
		const style: TagStyle = a.target ? 'plain' : a.infected !== 'none' ? a.infected : a.zombie ? 'zombie' : a.seeker ? 'seeker' : a.it ? 'it' : 'plain';
		const { tex } = makeTag(a.name, style);
		(a.tag.material as THREE.SpriteMaterial).map = tex;
		(a.tag.material as THREE.SpriteMaterial).needsUpdate = true;
		a.tagTex = tex;
	}

	/** Tag mode: mark a player as IT (red tint and name tag) or not. */
	setIt(id: number, it: boolean): void {
		const a = this.avatars.get(id);
		if (!a || a.it === it) return;
		a.it = it;
		this.restyle(a);
	}

	/** Zombies mode: show a turned player with the zombie look and a green ZOMBIE tag. */
	setZombie(id: number, zombie: boolean): void {
		const a = this.avatars.get(id);
		if (!a || a.zombie === zombie) return;
		a.zombie = zombie;
		this.restyle(a);
	}

	/**
	 * Infected mode: infected (blood-red, hunched, red tag) or Patient Zero (charred, orange glow and tag).
	 * With `now`, a survivor whose infection was announced by `turn()` eases into the colours.
	 */
	setInfected(id: number, role: InfectedRole, now?: number): void {
		const a = this.avatars.get(id);
		if (!a || a.infected === role) return;
		const ease = now !== undefined && a.infected === 'none' && role !== 'none' && now - a.turnAt < TURN_ARM_MS;
		if (ease) a.model.material.save(a.from);
		a.turnAt = -Infinity;
		a.easeAt = -Infinity;
		a.infected = role;
		this.restyle(a);
		if (ease) this.startEase(a, now);
	}

	/** Infected practice range: mark a target dummy. Its name tag stays the bare name (no role prefix). */
	setTarget(id: number, target: boolean): void {
		const a = this.avatars.get(id);
		if (!a || a.target === target) return;
		a.target = target;
		this.retag(a);
	}

	/** Ease from the palette in `a.from` to the one the avatar wears now. */
	private startEase(a: Avatar, now: number): void {
		a.model.material.save(a.to);
		a.easeAt = now;
	}

	/** Look, posture and tag from the avatar's flags (infected > zombie > IT > base). */
	private restyle(a: Avatar): void {
		const role: CharacterRole = a.infected !== 'none' ? a.infected : a.zombie ? 'zombie' : a.seeker ? 'seeker' : a.it ? 'it' : 'none';
		a.model.setRole(role);
		this.retag(a);
	}

	/**
	 * Item in a player's hands (third person), `claws` for infected claws.
	 * `knife`: an infected still has the throwing knife, shown in the left claw
	 * (Patient Zero of an older server may hold a gun; the knife is not drawn then).
	 */
	setHeld(id: number, item: HeldItem | 'claws' | null, knife = false): void {
		const a = this.avatars.get(id);
		if (!a) return;
		const was = a.model.held;
		if (!a.model.setHeld(item, knife)) return;
		// Swapped away from the gun: its reload is over. One of the new gun may be ahead of the mode state.
		if (a.reloadItem === was) this.endReload(a);
		a.muzzleUntil = 0;
		a.model.showMuzzle(false);
	}

	/** A player shot (recoil) or swung a knife or claws. A gun that shoots is not being reloaded. */
	act(id: number, kind: 'fire' | 'swing'): void {
		const a = this.avatars.get(id);
		if (!a) return;
		this.endReload(a);
		a.model.animator.act(kind);
	}

	// ---------------------------------------------------------------------
	// Reloads (docs/characters.md#animation)

	/**
	 * A player started reloading `item` at `now`, for `ms`. It shows while the
	 * item is in the hands and runs on the clock, also off screen and hidden. A
	 * swap, a shot, `turn` and `stopReload` end it early; it blends out then.
	 */
	reload(id: number, item: WeaponId, now: number, ms: number): void {
		const a = this.avatars.get(id);
		if (!a || item === 'claws' || !(ms > 0)) return;
		a.reloadItem = item;
		a.reloadAt = now;
		a.reloadMs = ms;
	}

	/** A reload ended early (swap, death, new round). */
	stopReload(id: number): void {
		const a = this.avatars.get(id);
		if (a) this.endReload(a);
	}

	/** Every reload ended early (round reset), or those of players `keep` refuses. */
	stopReloads(keep?: (id: number) => boolean): void {
		for (const [id, a] of this.avatars) if (a.reloadMs > 0 && !keep?.(id)) this.endReload(a);
	}

	private endReload(a: Avatar): void {
		a.reloadItem = null;
		a.reloadMs = 0;
		a.model.animator.reload(null);
	}

	// ---------------------------------------------------------------------
	// Hit and kill feedback (docs/modes.md#infected)

	/**
	 * This survivor was just infected (`infect` event). The avatar eases into
	 * the infected colours instead of switching at once: armed here, started
	 * when the mode state flips its role, or started now when the state came
	 * first. Posture and claws switch at once: the server's hit capsules do too.
	 */
	turn(id: number, now: number): void {
		const a = this.avatars.get(id);
		if (!a) return;
		this.endReload(a);
		if (a.infected === 'none') {
			a.turnAt = now;
			return;
		}
		a.model.recolor('none');
		a.model.material.save(a.from);
		a.model.recolor();
		this.startEase(a, now);
	}

	/** My shot hit this player: the avatar flashes white for HIT_FLASH_MS. */
	flash(id: number, now: number): void {
		const a = this.avatars.get(id);
		if (a) a.flashUntil = now + HIT_FLASH_MS;
	}

	/** A remote shot or swing (Infected): recoil and muzzle flash for a gun, a slash for melee. */
	fired(id: number, now: number): void {
		const a = this.avatars.get(id);
		if (!a) return;
		this.act(id, a.model.gun ? 'fire' : 'swing');
		if (!a.model.hasMuzzle) return;
		a.muzzleUntil = now + MUZZLE_FLASH_MS;
		a.model.showMuzzle(true);
	}

	/**
	 * Muzzle of the gun a drawn avatar holds, as a Source point (tracer start
	 * of a remote shot). False when the avatar is hidden or holds no gun.
	 */
	muzzle(id: number, out: { x: number; y: number; z: number }): boolean {
		const a = this.avatars.get(id);
		if (!a || this.hidden || !a.root.visible || !a.model.muzzle(V)) return false;
		out.x = V.x;
		out.y = -V.z;
		out.z = V.y;
		return true;
	}

	/** Where an avatar stands right now; false when it is not in play (down, spectating, no snapshot). Ignores `cl_hideplayers`. */
	pose(id: number, out: AvatarPose): boolean {
		const a = this.avatars.get(id);
		if (!a || !a.root.visible) return false;
		out.x = a.root.position.x;
		out.y = -a.root.position.z;
		out.z = a.root.position.y;
		copyMotion(out, a.motion);
		return true;
	}

	/** The drawn character of a player (its corpse takes over the look and the pose). */
	model(id: number): CharacterModel | null {
		return this.avatars.get(id)?.model ?? null;
	}

	/** Length (ms) of the reload a player is in, 0 for none (tests and debugging). */
	reloading(id: number): number {
		return this.avatars.get(id)?.reloadMs ?? 0;
	}

	/** Feedback state of an avatar (tests and debugging). */
	feedback(id: number): { held: HeldItem | 'claws' | null; knife: boolean; muzzleFlash: boolean; flashing: boolean; easing: boolean } | null {
		const a = this.avatars.get(id);
		if (!a) return null;
		return { held: a.model.held, knife: a.model.knife, muzzleFlash: a.muzzleUntil > 0, flashing: a.flashUntil > 0, easing: a.easeAt !== -Infinity };
	}

	/** Turn ease, hit flash, muzzle flash and reload progress of this frame. */
	private paint(a: Avatar, now: number): void {
		if (a.reloadMs > 0) {
			// Events are stamped with performance.now(), frames with the (slightly older) rAF time.
			const p = Math.max(0, (now - a.reloadAt) / a.reloadMs);
			if (p < 1) a.model.animator.reload(a.reloadItem, p, a.reloadMs);
			else this.endReload(a);
		}
		const mat = a.model.material;
		if (a.easeAt !== -Infinity) {
			// Events are stamped with performance.now(), frames with the (slightly older) rAF time.
			const k = Math.max(0, (now - a.easeAt) / TURN_EASE_MS);
			if (k >= 1) {
				a.easeAt = -Infinity;
				a.model.recolor();
			} else mat.mix(a.from, a.to, k * k * (3 - 2 * k));
		}
		if (a.flashUntil > 0) {
			const on = now < a.flashUntil;
			mat.emissive.copy(on ? HIT_FLASH : NO_GLOW);
			if (!on) a.flashUntil = 0;
		}
		if (a.muzzleUntil > 0 && now >= a.muzzleUntil) {
			a.muzzleUntil = 0;
			a.model.showMuzzle(false);
		}
	}

	/** Cosmetics of a player (docs/characters.md); kept across map changes. */
	setLoadout(id: number, loadout: Loadout | null): void {
		if (loadout) this.loadouts.set(id, { ...loadout });
		else this.loadouts.delete(id);
		const a = this.avatars.get(id);
		if (a) applyLoadout(a.model, loadout ?? emptyLoadout());
	}

	/** Draw body effects (docs/characters.md#effects); off in hide and seek. */
	setEffects(on: boolean): void {
		this.effects = on;
		for (const a of this.avatars.values()) a.model.setEffects(on);
	}

	/** What a player wears, null for the default look. */
	loadoutOf(id: number): Loadout | null {
		return this.loadouts.get(id) ?? null;
	}

	/** Hide and seek: mark a seeker (red tint and SEEKER tag) or a hider. */
	setSeeker(id: number, seeker: boolean): void {
		const a = this.avatars.get(id);
		if (!a || a.seeker === seeker) return;
		a.seeker = seeker;
		this.restyle(a);
	}

	/** Show or hide a player's name tag (hide and seek: only up close and in sight). */
	setTagVisible(id: number, visible: boolean): void {
		const a = this.avatars.get(id);
		if (a) a.tag.visible = visible;
	}

	has(id: number): boolean {
		return this.avatars.has(id);
	}

	/** Pose and motion for this frame; `update` animates it. */
	setPose(id: number, p: AvatarPose, visible: boolean): void {
		const a = this.avatars.get(id);
		if (!a) return;
		if (visible && !a.root.visible) a.model.animator.reset();
		a.root.visible = visible;
		if (!visible) return;
		a.root.position.set(p.x, p.z, -p.y);
		copyMotion(a.motion, p);
	}

	/** Animate the visible players (once per frame, before rendering). `now` (ms) runs the flashes and eases, on hidden avatars too. */
	update(view: Pick<CrowdView, 'dt' | 'distance'>, now: number): void {
		for (const a of this.avatars.values()) {
			this.paint(a, now);
			if (this.hidden || !a.root.visible) continue;
			const dist = view.distance(a.root.position);
			if (dist < 0) {
				a.model.skipFrame(view.dt, a.motion);
				continue;
			}
			a.tag.position.y = a.model.update(view.dt, a.motion, dist) + TAG_ABOVE;
		}
	}

	ids(): IterableIterator<number> {
		return this.avatars.keys();
	}

	/** A player left for good. */
	remove(id: number): void {
		this.loadouts.delete(id);
		this.drop(id);
	}

	private drop(id: number): void {
		const a = this.avatars.get(id);
		if (!a) return;
		a.root.removeFromParent();
		a.model.dispose();
		a.tag.material.dispose();
		a.tagTex.dispose();
		this.avatars.delete(id);
	}

	/** Map change: drop the models, keep the loadouts. */
	clear(): void {
		for (const id of [...this.avatars.keys()]) this.drop(id);
	}

	dispose(): void {
		this.clear();
		this.loadouts.clear();
		this.group.removeFromParent();
	}
}

function copyMotion(out: MotionState, s: MotionState): void {
	out.vx = s.vx;
	out.vy = s.vy;
	out.vz = s.vz;
	out.yaw = s.yaw;
	out.pitch = s.pitch;
	out.onGround = s.onGround;
	out.ducked = s.ducked;
	out.ramp = s.ramp;
}

// ---------------------------------------------------------------------------
// Ghost (docs/gameplay.md#ghosts)

/** Ghost name tag: a small drawn ghost icon (no emoji font needed) and the label. */
function makeGhostTag(label: string): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = 512;
	canvas.height = 64;
	const g = canvas.getContext('2d');
	if (g) {
		g.font = '600 32px "Barlow Semi Condensed", "Rajdhani", sans-serif';
		g.textBaseline = 'middle';
		const tw = Math.min(440, g.measureText(label).width);
		const w = tw + 64;
		const x0 = 256 - w / 2;
		g.fillStyle = 'rgba(20, 40, 60, 0.55)';
		g.fillRect(x0, 10, w, 44);
		// Icon: dome head, wavy hem, two eyes.
		const cx = x0 + 26;
		g.fillStyle = 'rgba(200, 240, 255, 0.95)';
		g.beginPath();
		g.arc(cx, 28, 11, Math.PI, 0);
		g.lineTo(cx + 11, 44);
		for (let k = 0; k < 3; k++) {
			const xa = cx + 11 - (k + 0.5) * (22 / 3);
			g.quadraticCurveTo(xa, k % 2 === 0 ? 38 : 48, cx + 11 - (k + 1) * (22 / 3), 44);
		}
		g.closePath();
		g.fill();
		g.fillStyle = 'rgba(20, 40, 60, 0.9)';
		g.fillRect(cx - 6, 25, 4, 5);
		g.fillRect(cx + 2, 25, 4, 5);
		g.fillStyle = '#e8f8ff';
		g.shadowColor = 'rgba(0,0,0,0.8)';
		g.shadowBlur = 4;
		g.fillText(label, x0 + 48, 33, 440);
	}
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

export const GHOST_OPACITY = 0.45;

/**
 * The race ghost: the run's player, see-through, in their own colours and items, with a name tag.
 * Purely visual (no collision). One instance, owned by the renderer.
 */
export class GhostAvatar {
	readonly group = new THREE.Group();
	private readonly model: CharacterModel;
	private readonly motion = emptyMotion();
	private readonly velocity = new VelocityTracker();
	private readonly pos = { x: 0, y: 0, z: 0 };
	private tag: THREE.Sprite;
	private tagTex: THREE.CanvasTexture | null = null;
	private label = '';
	private personId = 0;

	constructor(assets: HeldAssets) {
		this.group.name = 'ghost';
		this.model = new CharacterModel(personOf(0), assets, { ghost: true });
		this.model.material.opacity = GHOST_OPACITY;
		this.model.mesh.renderOrder = 4;
		const tagMat = new THREE.SpriteMaterial({ transparent: true, opacity: 0.9, depthWrite: false, fog: false });
		this.tag = new THREE.Sprite(tagMat);
		this.tag.scale.set(96, 12, 1);
		this.tag.position.set(0, 72 + TAG_ABOVE, 0);
		this.tag.renderOrder = 5;
		this.group.add(this.model.group, this.tag);
		this.group.visible = false;
	}

	/** The run's player: person (as on a player with this id) and cosmetics. */
	setPlayer(personId: number, loadout: Loadout | null): void {
		if (personId !== this.personId) {
			this.personId = personId;
			this.model.setPerson(personOf(personId));
		}
		applyLoadout(this.model, loadout ?? emptyLoadout());
	}

	setLabel(label: string): void {
		if (label === this.label) return;
		this.label = label;
		this.tagTex?.dispose();
		this.tagTex = makeGhostTag(label);
		const m = this.tag.material as THREE.SpriteMaterial;
		m.map = this.tagTex;
		m.needsUpdate = true;
	}

	/** Pose from Source coordinates (feet origin), angles in degrees; the velocity comes from the motion. */
	setPose(x: number, y: number, z: number, pitch: number, yaw: number, ducked: boolean, onGround: boolean, ramp: MotionState['ramp'], visible: boolean): void {
		if (visible && !this.group.visible) {
			this.velocity.reset();
			this.model.animator.reset();
		}
		this.group.visible = visible;
		if (!visible) return;
		this.group.position.set(x, z, -y);
		this.pos.x = x;
		this.pos.y = y;
		this.pos.z = z;
		this.motion.pitch = pitch;
		this.motion.yaw = yaw;
		this.motion.ducked = ducked;
		this.motion.onGround = onGround;
		this.motion.ramp = ramp;
	}

	update(view: CrowdView): void {
		if (!this.group.visible) return;
		this.velocity.push(this.pos.x, this.pos.y, this.pos.z, view.dt, this.motion);
		const dist = view.distance(this.group.position);
		if (dist < 0) this.model.skipFrame(view.dt, this.motion);
		else this.tag.position.y = this.model.update(view.dt, this.motion, dist) + TAG_ABOVE;
	}

	dispose(): void {
		this.group.removeFromParent();
		this.model.dispose();
		this.tag.material.dispose();
		this.tagTex?.dispose();
	}
}