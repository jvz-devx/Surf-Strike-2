/**
 * Remote players and the race ghost: character models (docs/characters.md)
 * with a name tag sprite. Positions are Source feet origins.
 */
import { emptyLoadout, type Loadout } from '@surf/shared';
import * as THREE from 'three';
import { emptyMotion, type MotionState } from './character/animator.js';
import type { CrowdView } from './character/crowd.js';
import { HeldAssets, type HeldItem } from './character/held.js';
import { applyLoadout, CharacterModel, personOf, type CharacterRole } from './character/model.js';
import { VelocityTracker } from './character/motion.js';

/** Height of the name tag centre above the crown. */
const TAG_ABOVE = 14;

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
}

export type InfectedRole = 'none' | 'infected' | 'alpha';

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
		return { root, model, motion: emptyMotion(), tag, tagTex: tex, name, it: false, zombie: false, infected: 'none', seeker: false };
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
		const style: TagStyle = a.infected !== 'none' ? a.infected : a.zombie ? 'zombie' : a.seeker ? 'seeker' : a.it ? 'it' : 'plain';
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

	/** Infected mode: infected (blood-red, hunched, red tag) or Patient Zero (charred, orange glow and tag). */
	setInfected(id: number, role: InfectedRole): void {
		const a = this.avatars.get(id);
		if (!a || a.infected === role) return;
		a.infected = role;
		this.restyle(a);
	}

	/** Look, posture and tag from the avatar's flags (infected > zombie > IT > base). */
	private restyle(a: Avatar): void {
		const role: CharacterRole = a.infected !== 'none' ? a.infected : a.zombie ? 'zombie' : a.seeker ? 'seeker' : a.it ? 'it' : 'none';
		a.model.setRole(role);
		this.retag(a);
	}

	/** Item in a player's hands (third person), `claws` for infected claws. */
	setHeld(id: number, item: HeldItem | 'claws' | null): void {
		this.avatars.get(id)?.model.setHeld(item);
	}

	/** A player shot (recoil) or swung a knife or claws. */
	act(id: number, kind: 'fire' | 'swing'): void {
		this.avatars.get(id)?.model.animator.act(kind);
	}

	/** Cosmetics of a player (docs/characters.md); kept across map changes. */
	setLoadout(id: number, loadout: Loadout | null): void {
		if (loadout) this.loadouts.set(id, { ...loadout });
		else this.loadouts.delete(id);
		const a = this.avatars.get(id);
		if (a) applyLoadout(a.model, loadout ?? emptyLoadout());
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

	/** Animate the visible players (once per frame, before rendering). */
	update(view: CrowdView): void {
		if (this.hidden) return;
		for (const a of this.avatars.values()) {
			if (!a.root.visible) continue;
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

export const GHOST_OPACITY = 0.35;

/**
 * The race ghost: a translucent, slightly glowing character with a name tag.
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
