/**
 * Remote players: original low-poly humanoids (boxes) with a per-player tint
 * and a name tag sprite. Positions are Source feet origins.
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;

/** Stable hue from a player id. */
export function playerHue(id: number): number {
	let h = (id + 1) * 2654435761;
	h = (h ^ (h >>> 16)) >>> 0;
	return (h % 360) / 360;
}

interface Avatar {
	root: THREE.Group;
	body: THREE.Group;
	materials: THREE.Material[];
	tag: THREE.Sprite;
	tagTex: THREE.CanvasTexture;
	name: string;
	/** Tag mode: this player is IT (red tint, red name tag). */
	it: boolean;
	/** Zombies mode: turned into a zombie (zombie colours, green tag). */
	zombie: boolean;
	skin: THREE.MeshLambertMaterial;
	baseSkin: THREE.Color;
	shirt: THREE.MeshLambertMaterial;
	pants: THREE.MeshLambertMaterial;
	baseShirt: THREE.Color;
	basePants: THREE.Color;
}

const IT_SHIRT = new THREE.Color(0xe02424);
const IT_PANTS = new THREE.Color(0x5a0c0c);
const IT_GLOW = new THREE.Color(0x400000);
const NO_GLOW = new THREE.Color(0x000000);
const ZOMBIE_SKIN = new THREE.Color(0x7d9a6e);
const ZOMBIE_SHIRT = new THREE.Color(0x4e5a52);
const ZOMBIE_PANTS = new THREE.Color(0x3a3a40);

function makeTag(name: string, it = false, zombie = false): { tex: THREE.CanvasTexture; aspect: number } {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 64;
	const g = canvas.getContext('2d');
	if (g) {
		g.font = '600 34px "Barlow Semi Condensed", "Rajdhani", sans-serif';
		g.textAlign = 'center';
		g.textBaseline = 'middle';
		const w = Math.min(250, g.measureText(name).width + 24);
		if (it) name = `IT · ${name}`;
		if (zombie) name = `ZOMBIE · ${name}`;
		g.fillStyle = it ? 'rgba(200, 24, 24, 0.85)' : zombie ? 'rgba(40, 110, 40, 0.85)' : 'rgba(8, 12, 18, 0.55)';
		g.fillRect(128 - w / 2, 10, w, 44);
		g.fillStyle = '#ffffff';
		g.shadowColor = 'rgba(0,0,0,0.8)';
		g.shadowBlur = 4;
		g.fillText(name, 128, 33, 240);
	}
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	return { tex, aspect: 4 };
}

/**
 * Low-poly humanoid built facing +X (yaw 0), Three Y up, feet at y = 0.
 * Sizes in Hammer units. Shared by remote players and the ghost.
 */
export function buildHumanoid(box: THREE.BoxGeometry, shirt: THREE.Material, pants: THREE.Material, skin: THREE.Material): THREE.Group {
	const body = new THREE.Group();
	const part = (mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
		const m = new THREE.Mesh(box, mat);
		m.scale.set(sx, sy, sz);
		m.position.set(x, y, z);
		body.add(m);
	};
	part(pants, 8, 34, 8, 0, 17, 5); // legs
	part(pants, 8, 34, 8, 0, 17, -5);
	part(shirt, 11, 26, 20, 0, 47, 0); // torso
	part(shirt, 6, 24, 6, 0, 46, 13.5); // arms
	part(shirt, 6, 24, 6, 0, 46, -13.5);
	part(skin, 11, 11, 11, 0, 66.5, 0); // head
	part(pants, 3, 3, 8, 6, 67.5, 0); // visor (shows facing)
	return body;
}

export class RemotePlayers {
	readonly group = new THREE.Group();
	private avatars = new Map<number, Avatar>();
	private box = new THREE.BoxGeometry(1, 1, 1);
	private hidden = false;

	constructor() {
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
		const hue = playerHue(id);
		const shirt = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(hue, 0.65, 0.5) });
		const pants = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(hue, 0.35, 0.22) });
		const skin = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(hue, 0.25, 0.78) });
		const body = buildHumanoid(this.box, shirt, pants, skin);

		const { tex } = makeTag(name);
		const tagMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
		const tag = new THREE.Sprite(tagMat);
		tag.scale.set(64, 16, 1);
		tag.position.set(0, 86, 0);
		tag.renderOrder = 5;

		const root = new THREE.Group();
		root.add(body, tag);
		this.group.add(root);
		return {
			root,
			body,
			materials: [shirt, pants, skin, tagMat],
			tag,
			tagTex: tex,
			name,
			it: false,
			zombie: false,
			skin,
			baseSkin: skin.color.clone(),
			shirt,
			pants,
			baseShirt: shirt.color.clone(),
			basePants: pants.color.clone()
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
		const { tex } = makeTag(a.name, a.it, a.zombie);
		(a.tag.material as THREE.SpriteMaterial).map = tex;
		(a.tag.material as THREE.SpriteMaterial).needsUpdate = true;
		a.tagTex = tex;
	}

	/** Tag mode: mark a player as IT (red tint and name tag) or not. */
	setIt(id: number, it: boolean): void {
		const a = this.avatars.get(id);
		if (!a || a.it === it) return;
		a.it = it;
		a.shirt.color.copy(it ? IT_SHIRT : a.baseShirt);
		a.pants.color.copy(it ? IT_PANTS : a.basePants);
		a.shirt.emissive.copy(it ? IT_GLOW : NO_GLOW);
		this.retag(a);
	}

	/** Zombies mode: show a turned player with the zombie look and a green ZOMBIE tag. */
	setZombie(id: number, zombie: boolean): void {
		const a = this.avatars.get(id);
		if (!a || a.zombie === zombie) return;
		a.zombie = zombie;
		a.skin.color.copy(zombie ? ZOMBIE_SKIN : a.baseSkin);
		a.shirt.color.copy(zombie ? ZOMBIE_SHIRT : a.baseShirt);
		a.pants.color.copy(zombie ? ZOMBIE_PANTS : a.basePants);
		a.body.rotation.z = zombie ? -0.2 : 0; // hunched forward
		this.retag(a);
	}

	has(id: number): boolean {
		return this.avatars.has(id);
	}

	/** Pose from Source coordinates (feet origin), yaw in degrees. */
	setPose(id: number, x: number, y: number, z: number, yawDeg: number, ducked: boolean, visible: boolean): void {
		const a = this.avatars.get(id);
		if (!a) return;
		a.root.visible = visible;
		if (!visible) return;
		a.root.position.set(x, z, -y);
		a.body.rotation.y = yawDeg * DEG;
		const sy = ducked ? 0.75 : 1;
		a.body.scale.y = sy;
		a.tag.position.y = 86 * sy;
	}

	ids(): IterableIterator<number> {
		return this.avatars.keys();
	}

	remove(id: number): void {
		const a = this.avatars.get(id);
		if (!a) return;
		a.root.removeFromParent();
		for (const m of a.materials) m.dispose();
		a.tagTex.dispose();
		this.avatars.delete(id);
	}

	clear(): void {
		for (const id of [...this.avatars.keys()]) this.remove(id);
	}

	dispose(): void {
		this.clear();
		this.box.dispose();
		this.group.removeFromParent();
	}
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

const GHOST_COLOR = new THREE.Color(0x9fdcff);
const GHOST_GLOW = new THREE.Color(0x2a6a90);
export const GHOST_OPACITY = 0.35;

/**
 * The race ghost: a translucent, slightly glowing humanoid with a name tag.
 * Purely visual (no collision). One instance, owned by the renderer.
 */
export class GhostAvatar {
	readonly group = new THREE.Group();
	private box = new THREE.BoxGeometry(1, 1, 1);
	private body: THREE.Group;
	private materials: THREE.Material[];
	private tag: THREE.Sprite;
	private tagTex: THREE.CanvasTexture | null = null;
	private label = '';

	constructor() {
		this.group.name = 'ghost';
		const mat = (lightness: number) =>
			new THREE.MeshLambertMaterial({
				color: GHOST_COLOR.clone().offsetHSL(0, 0, lightness),
				emissive: GHOST_GLOW,
				transparent: true,
				opacity: GHOST_OPACITY,
				depthWrite: false
			});
		const shirt = mat(0);
		const pants = mat(-0.25);
		const skin = mat(0.1);
		this.body = buildHumanoid(this.box, shirt, pants, skin);
		for (const m of this.body.children) m.renderOrder = 4;
		const tagMat = new THREE.SpriteMaterial({ transparent: true, opacity: 0.9, depthWrite: false, fog: false });
		this.tag = new THREE.Sprite(tagMat);
		this.tag.scale.set(96, 12, 1);
		this.tag.position.set(0, 86, 0);
		this.tag.renderOrder = 5;
		this.materials = [shirt, pants, skin, tagMat];
		this.group.add(this.body, this.tag);
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

	/** Pose from Source coordinates (feet origin), yaw in degrees. */
	setPose(x: number, y: number, z: number, yawDeg: number, ducked: boolean, visible: boolean): void {
		this.group.visible = visible;
		if (!visible) return;
		this.group.position.set(x, z, -y);
		this.body.rotation.y = yawDeg * DEG;
		const sy = ducked ? 0.75 : 1;
		this.body.scale.y = sy;
		this.tag.position.y = 86 * sy;
	}

	dispose(): void {
		this.group.removeFromParent();
		for (const m of this.materials) m.dispose();
		this.tagTex?.dispose();
		this.box.dispose();
	}
}
