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
	/** Infected mode: 'infected' (blood-red look, red tag) or 'alpha' (Patient Zero: charred, orange glow and tag). */
	infected: InfectedRole;
	skin: THREE.MeshLambertMaterial;
	baseSkin: THREE.Color;
	shirt: THREE.MeshLambertMaterial;
	pants: THREE.MeshLambertMaterial;
	baseShirt: THREE.Color;
	basePants: THREE.Color;
	/** Glowing eyes (infected roles); the visor is hidden while they show. */
	eyes: THREE.Mesh[];
	eyeMat: THREE.MeshBasicMaterial;
	visor: THREE.Object3D | undefined;
}

const IT_SHIRT = new THREE.Color(0xe02424);
const IT_PANTS = new THREE.Color(0x5a0c0c);
const IT_GLOW = new THREE.Color(0x400000);
const NO_GLOW = new THREE.Color(0x000000);
const ZOMBIE_SKIN = new THREE.Color(0x7d9a6e);
const ZOMBIE_SHIRT = new THREE.Color(0x4e5a52);
const ZOMBIE_PANTS = new THREE.Color(0x3a3a40);
// Infected looks are dark crimson / charcoal: well below the luminance of warm desert sand and
// terracotta (infected_outpost 0xd2b589, 0xc29e70) and far from any survivor tint, with glowing eyes.
const INF_SKIN = new THREE.Color(0x5a3432);
const INF_SHIRT = new THREE.Color(0x4a0c10);
const INF_PANTS = new THREE.Color(0x1c1012);
const INF_GLOW = new THREE.Color(0x400406);
const INF_EYES = 0xff3a1e;
const ALPHA_SKIN = new THREE.Color(0x3a2a28);
const ALPHA_SHIRT = new THREE.Color(0x181012);
const ALPHA_PANTS = new THREE.Color(0x100c0e);
const ALPHA_GLOW = new THREE.Color(0x6a2a00);
const ALPHA_EYES = 0xffb21e;

export type InfectedRole = 'none' | 'infected' | 'alpha';

type TagStyle = 'plain' | 'it' | 'zombie' | 'infected' | 'alpha';

const TAG_STYLE: Record<TagStyle, { prefix: string; bg: string }> = {
	plain: { prefix: '', bg: 'rgba(8, 12, 18, 0.55)' },
	it: { prefix: 'IT · ', bg: 'rgba(200, 24, 24, 0.85)' },
	zombie: { prefix: 'ZOMBIE · ', bg: 'rgba(40, 110, 40, 0.85)' },
	infected: { prefix: 'INFECTED · ', bg: 'rgba(150, 16, 24, 0.88)' },
	alpha: { prefix: 'PATIENT ZERO · ', bg: 'rgba(214, 104, 12, 0.92)' }
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
		const visor = body.children[6]; // legs ×2, torso, arms ×2, head, visor
		// Glowing eyes for the infected looks (hidden otherwise); unlit and unfogged so they read at range.
		const eyeMat = new THREE.MeshBasicMaterial({ color: INF_EYES, fog: false });
		const eyes: THREE.Mesh[] = [];
		for (const z of [-2.6, 2.6]) {
			const e = new THREE.Mesh(this.box, eyeMat);
			e.scale.set(1.4, 1.8, 2.2);
			e.position.set(5.8, 68, z);
			e.visible = false;
			body.add(e);
			eyes.push(e);
		}

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
			materials: [shirt, pants, skin, tagMat, eyeMat],
			tag,
			tagTex: tex,
			name,
			it: false,
			zombie: false,
			infected: 'none',
			skin,
			baseSkin: skin.color.clone(),
			shirt,
			pants,
			baseShirt: shirt.color.clone(),
			basePants: pants.color.clone(),
			eyes,
			eyeMat,
			visor
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
		const style: TagStyle = a.infected !== 'none' ? a.infected : a.zombie ? 'zombie' : a.it ? 'it' : 'plain';
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

	/** Colours, glow, posture and tag from the avatar's flags (infected > zombie > IT > base). */
	private restyle(a: Avatar): void {
		let skin = a.baseSkin;
		let shirt = a.baseShirt;
		let pants = a.basePants;
		let glow = NO_GLOW;
		let hunch = 0;
		if (a.infected === 'alpha') {
			[skin, shirt, pants, glow, hunch] = [ALPHA_SKIN, ALPHA_SHIRT, ALPHA_PANTS, ALPHA_GLOW, -0.12];
		} else if (a.infected === 'infected') {
			[skin, shirt, pants, glow, hunch] = [INF_SKIN, INF_SHIRT, INF_PANTS, INF_GLOW, -0.22];
		} else if (a.zombie) {
			[skin, shirt, pants, hunch] = [ZOMBIE_SKIN, ZOMBIE_SHIRT, ZOMBIE_PANTS, -0.2];
		} else if (a.it) {
			[shirt, pants, glow] = [IT_SHIRT, IT_PANTS, IT_GLOW];
		}
		a.skin.color.copy(skin);
		a.shirt.color.copy(shirt);
		a.pants.color.copy(pants);
		a.shirt.emissive.copy(glow);
		a.skin.emissive.copy(a.infected === 'none' ? NO_GLOW : glow);
		a.body.rotation.z = hunch; // hunched forward
		const eyes = a.infected !== 'none';
		for (const e of a.eyes) e.visible = eyes;
		if (a.visor) a.visor.visible = !eyes;
		a.eyeMat.color.setHex(a.infected === 'alpha' ? ALPHA_EYES : INF_EYES);
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
