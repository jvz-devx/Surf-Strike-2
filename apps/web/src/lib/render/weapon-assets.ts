/**
 * First-person weapon models (CREDITS.md, "Models"): one textured model per gun
 * and the knife, loaded on first use. The guns are modelled by Blender scripts
 * (tools/models/procedural/), the knife is generated (tools/models/build.sh).
 * The code-built models (render/viewmodels.ts) are the fallback: they show
 * until a file has loaded and stay if it fails. The claws are code-built only,
 * and so is everything other players hold (render/character/held-models.ts).
 *
 * Asset space (tools/models/prep.py): three axes, +X right, +Y up, the bore
 * along −Z, the middle of the muzzle (the tip of the blade) at the origin,
 * length 1 along the bore. The fit data below places a model in the
 * first-person model space of its weapon.
 */
import type { WeaponId } from '@surf/shared';
import * as THREE from 'three';
import { PART_NAMES, POINT_NAMES } from './gun-rig.js';
import { HandKit, HANDS_URL } from './hands.js';

export type V3 = readonly [x: number, y: number, z: number];

export interface GeneratedModel {
	/** Middle of the grip, where the right hand closes (asset space). */
	grip: V3;
	/** How far the grip leans back from the vertical (rad). */
	rake: number;
	/** Under the fore-end, where the left hand cradles it (asset space); null: one hand. */
	fore: V3 | null;
	/**
	 * Rear point of the sight line, the one that lands on the view axis when
	 * aiming: the bottom of the rear notch or aperture, or the middle of the
	 * eyepiece (asset space); null: no sights.
	 */
	sight: V3 | null;
	/**
	 * Front point of the sight line: the top of the front post, or the
	 * middle of the objective (asset space); null: no sights. The model is
	 * turned a little so the line from `sight` to `front` runs along the bore
	 * direction: aimed, the front sight sits on the rear one.
	 */
	front: V3 | null;
	/** An optic whose glass is cut open: a red dot at `front` is the aim mark. */
	dot?: true;
	/**
	 * First-person material of a model whose base colour is lighter than the
	 * others: room reflection strength (in place of FP_LIGHT.env) and a factor
	 * on the base colour.
	 */
	shade?: { env: number; color: number };
	/**
	 * In the model space of the code-built model of the weapon
	 * (render/viewmodels.ts): length of the model, where its origin (the
	 * muzzle) goes, on the bore of the code-built gun; half width and depth of
	 * the grip in the right hand, half width of the fore-end and how far the
	 * left fingers reach up it; how far ahead of the eye the sight point sits when
	 * fully aimed (viewmodel camera units, as AIM_DEPTH in render/sights.ts).
	 */
	fp: { len: number; at: V3; grip: readonly [hw: number, hd: number]; fore: readonly [hw: number, h: number]; aim: number };
	/**
	 * Built from the detailed generation: the file keeps the whole mesh and
	 * 2048 px base colour and normal maps (MODEL_BUDGET.detailed).
	 */
	detailed?: true;
}

/** Size and cost limits of one shipped file, checked by the tests. */
export const MODEL_BUDGET = {
	plain: { bytes: 300_000, triangles: 12_000 },
	detailed: { bytes: 700_000, triangles: 30_000 }
} as const;

/** The budget of the shipped file of a generated model. */
export function modelBudget(g: GeneratedModel): { bytes: number; triangles: number } {
	return g.detailed ? MODEL_BUDGET.detailed : MODEL_BUDGET.plain;
}

/** Every weapon id: its generated model, or code-built only. */
export const GENERATED: Readonly<Record<WeaponId, GeneratedModel | 'code-built'>> = Object.freeze<Record<WeaponId, GeneratedModel | 'code-built'>>({
	// Built by script in the model units of the code-built pistol (tools/models/procedural/pistol.py): the grip, magazine,
	// sights and muzzle are where the code-built ones are. One-handed: no fore-end. The sight line runs level from the
	// rear notch at the height of its ears over the tip of the front post: aimed, the post fills the notch to the top.
	pistol: {
		grip: [0, -0.319, 0.8302],
		rake: 0.3,
		fore: null,
		sight: [0, 0.1041, 0.7477],
		front: [0, 0.1041, 0.099],
		fp: { len: 13.64, at: [0, 2.05, -8.87], grip: [0.95, 1.3], fore: [0, 0], aim: 4.8 }
	},
	// Built by script in the model units of the code-built SMG (tools/models/procedural/smg.py): the grip, the
	// tube magazine under the barrel and the muzzle are where the code-built ones are. The left hand cradles the
	// grooved handguard round the magazine; the sight line runs from the middle of the rear aperture over the tip
	// of the post in the front hood, level with the bore.
	smg: {
		grip: [0, -0.2381, 0.9001],
		rake: 0.31,
		fore: [0, -0.229, 0.3581],
		sight: [0, 0.119, 0.89],
		front: [0, 0.119, 0.3277],
		fp: { len: 19.74, at: [0, 0.9, -13.27], grip: [1.0, 1.25], fore: [1.7, 2.2], aim: 4 }
	},
	// Built by script in the model units of the code-built light machine gun (tools/models/procedural/lmg.py): the
	// grip, the handguard and the muzzle are where the code-built ones are; the right hand on the grip, the left
	// under the handguard. The sight line runs along the axis of the open tube optic on the top rail, from the
	// eyepiece to the objective, where the red dot is the aim mark.
	lmg: {
		grip: [0, -0.1104, 0.7295],
		rake: 0.31,
		fore: [0, -0.0586, 0.3171],
		sight: [0, 0.0856, 0.7228],
		front: [0, 0.0856, 0.5966],
		dot: true,
		fp: { len: 44.37, at: [0, 0.6, -27.67], grip: [1.0, 1.25], fore: [1.35, 2.0], aim: 7 }
	},
	// Built by script in the model units of the code-built sniper rifle (tools/models/procedural/sniper.py): the
	// right hand on the raked grip of the stock, the left under the fore-end ahead of the magazine, both where the
	// code-built hands are. The sight line is the axis of the scope, from the middle of the eyepiece to the middle
	// of the objective, level with the bore; the tube is open along it.
	sniper: {
		grip: [0, -0.0912, 0.7576],
		rake: 0.42,
		fore: [0, -0.0511, 0.4263],
		sight: [0, 0.0489, 0.7509],
		front: [0, 0.0489, 0.4263],
		fp: { len: 44.97, at: [0, 0.8, -28.67], grip: [1.2, 1.3], fore: [1.2, 1.7], aim: 6.5 }
	},
	// Built by script in the model units of the code-built .50 cal rifle (tools/models/procedural/heavy_rifle.py): the
	// grip, fore-end, muzzle and scope are where the code-built ones are. The right hand on the pistol grip, the left
	// under the handguard below the barrel shroud; the sight line is the axis of the scope, which is open end to end.
	barrett: {
		grip: [0, -0.0836, 0.7891],
		rake: 0.31,
		fore: [0, -0.0353, 0.4008],
		sight: [0, 0.078, 0.7819],
		front: [0, 0.078, 0.4292],
		fp: { len: 53.82, at: [0, 0.3, -36.37], grip: [1.0, 1.3], fore: [1.5, 1.8], aim: 6.5 },
		detailed: true
	},
	// The blade replaces the code-built one; the fist stays. `at` puts the middle of the handle where the code-built handle is.
	knife: {
		grip: [0, -0.017, 0.802],
		rake: 0,
		fore: null,
		sight: null,
		front: null,
		fp: { len: 14.7, at: [0, 0.25, -11.39], grip: [0, 0], fore: [0, 0], aim: 0 },
	},
	// Built by script in the model units of the code-built shotgun (tools/models/procedural/shotgun.py): the grip,
	// fore-end and muzzle are where the code-built ones are. The sight line runs from the middle of the ghost ring
	// over the tip of the front post, level with the bore; the ring is wide enough that, aimed at this depth, the
	// view over the post stays open.
	striker: {
		grip: [0, -0.1202, 0.7412],
		rake: 0.31,
		fore: [0, -0.0687, 0.312],
		sight: [0, 0.0662, 0.7339],
		front: [0, 0.0662, 0.0569],
		fp: { len: 40.77, at: [0, 0.8, -25.32], grip: [1.0, 1.25], fore: [1.45, 2.0], aim: 3.8 }
	},
	claws: 'code-built'
});

/** The generated model of a weapon, or null (code-built only). */
export function generated(id: WeaponId): GeneratedModel | null {
	const g = GENERATED[id];
	return g === 'code-built' ? null : g;
}

/**
 * The turn that lays the sight line of a model (`sight` to `front`) along the
 * bore direction (−Z), into `out`; identity without sights.
 */
export function sightTurn(g: GeneratedModel, out: THREE.Quaternion): THREE.Quaternion {
	if (!g.sight || !g.front) return out.identity();
	const d = new THREE.Vector3(g.front[0] - g.sight[0], g.front[1] - g.sight[1], g.front[2] - g.sight[2]).normalize();
	return out.setFromUnitVectors(d, new THREE.Vector3(0, 0, -1));
}

/** URL of a shipped file (apps/web/static). */
export const modelUrl = (id: WeaponId): string => `/models/weapons/${id}-fp.glb`;

/** Loads a model file and resolves its scene. */
export type ModelLoad = (url: string) => Promise<THREE.Object3D>;

/** The browser loader: three's glTF loader with the meshopt decoder, imported on the first load. */
export const gltfLoad: ModelLoad = async (url) => {
	const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
		import('three/examples/jsm/loaders/GLTFLoader.js'),
		import('three/examples/jsm/libs/meshopt_decoder.module.js')
	]);
	const loader = new GLTFLoader();
	loader.setMeshoptDecoder(MeshoptDecoder);
	return (await loader.loadAsync(url)).scene;
};

/** No loading: every model stays code-built (node, the tests, `?mockvm&gen=0`). */
export const noLoad: ModelLoad = () => Promise.reject(new Error('model loading is off'));

/** The loader of a renderer that is given none: off outside a browser (node, the tests). */
export const defaultLoad: ModelLoad = (url) => (typeof window === 'undefined' || typeof document === 'undefined' ? noLoad(url) : gltfLoad(url));

/** Quantized positions and normals (normalized integers) cannot take a transform: make them floats. */
function floats(g: THREE.BufferGeometry): void {
	for (const name of ['position', 'normal']) {
		const a = g.getAttribute(name);
		if (!a || a.array instanceof Float32Array) continue;
		const out = new Float32Array(a.count * a.itemSize);
		for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
		g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
	}
}

/**
 * The model of a loaded file, taken out of its scene: the one mesh of a plain file, or for a gun with
 * moving parts (render/gun-rig.ts) a group of the body mesh, a node per part at its pivot and the named points. Node
 * transforms (quantization) are baked into the geometry. Null when the meshes don't share one
 * material, or when the file holds none.
 */
export function takeModel(scene: THREE.Object3D): THREE.Object3D | null {
	const meshes: THREE.Mesh[] = [];
	const named: THREE.Object3D[] = [];
	scene.updateMatrixWorld(true);
	scene.traverse((o) => {
		if (o instanceof THREE.Mesh) meshes.push(o);
		else if ((PART_NAMES as readonly string[]).includes(o.name) || (POINT_NAMES as readonly string[]).includes(o.name)) named.push(o);
	});
	const first = meshes[0];
	if (!first || meshes.some((m) => Array.isArray(m.material) || m.material !== first.material || m instanceof THREE.SkinnedMesh)) return null;
	if (meshes.length > 1 && !named.length) return null;
	const root = new THREE.Group();
	root.name = 'gun';
	const nodes = new Map<THREE.Object3D, THREE.Group>();
	const ownerOf = (o: THREE.Object3D | null): THREE.Object3D => {
		for (let p = o; p; p = p.parent) if (nodes.has(p)) return nodes.get(p)!;
		return root;
	};
	for (const o of named) {
		const n = new THREE.Group();
		n.name = o.name;
		// Top down: a parent has its node before its children do.
		const parent = ownerOf(o.parent);
		const at = o.matrixWorld.clone();
		if (parent !== root) at.premultiply(parent.matrixWorld.clone().invert());
		at.decompose(n.position, n.quaternion, n.scale);
		n.scale.setScalar(1);
		parent.add(n);
		nodes.set(o, n);
		root.updateMatrixWorld(true);
	}
	for (const m of meshes) {
		const owner = ownerOf(m.parent);
		floats(m.geometry);
		m.geometry.applyMatrix4(owner === root ? m.matrixWorld : owner.matrixWorld.clone().invert().multiply(m.matrixWorld));
		m.removeFromParent();
		m.position.set(0, 0, 0);
		m.quaternion.identity();
		m.scale.set(1, 1, 1);
		m.updateMatrix();
		owner.add(m);
	}
	if (named.length) return root;
	first.removeFromParent();
	return first;
}

/** The meshes of a model. */
export function meshesOf(o: THREE.Object3D): THREE.Mesh[] {
	const out: THREE.Mesh[] = [];
	o.traverse((c) => {
		if (c instanceof THREE.Mesh) out.push(c);
	});
	return out;
}

/** Textures of a material. */
export function texturesOf(m: THREE.Material): THREE.Texture[] {
	return Object.values(m).filter((v): v is THREE.Texture => v instanceof THREE.Texture);
}

/** Free a loaded model: its geometry, material and textures. */
export function disposeModel(o: THREE.Object3D): void {
	for (const m of meshesOf(o)) {
		m.geometry.dispose();
		const mat = m.material as THREE.Material;
		for (const t of texturesOf(mat)) t.dispose();
		mat.dispose();
	}
}

/**
 * Light a first-person model for the viewmodel scene (a hemisphere and a sun,
 * no sky to reflect): a metal would come out near black. The room environment
 * gives the metal something to reflect; a little of the base colour as
 * emissive keeps the faces turned from the sun readable, as the code-built
 * palette does.
 */
export function lightFirstPerson(m: THREE.Material, env: THREE.Texture | null, g?: GeneratedModel | null): void {
	if (!(m instanceof THREE.MeshStandardMaterial)) return;
	m.envMap = env;
	m.envMapIntensity = g?.shade?.env ?? FP_LIGHT.env;
	if (g?.shade) m.color.multiplyScalar(g.shade.color);
	m.metalness = Math.min(m.metalness, FP_LIGHT.metal);
	if (FP_LIGHT.fill > 0) {
		m.emissive.setScalar(FP_LIGHT.fill);
		m.emissiveMap = m.map;
	}
	m.needsUpdate = true;
}

/**
 * First-person material values: environment strength, metalness cap, emissive
 * fill. At 0.2 the guns come out as dark as their neutral-light reference
 * renders; stronger, the room reflection on the top faces (seen at a grazing
 * angle from the eye) turns the metal pale.
 */
export const FP_LIGHT = { env: 0.2, metal: 1, fill: 0 } as const;

/**
 * Generated models of one renderer: each file is loaded once, on
 * its first request, and kept until `dispose()`. `ready` is called when a
 * model has arrived; a failed load is remembered and leaves the fallback. The
 * gloved hands (render/hands.ts) are one more file, fetched with the first
 * weapon; `handsReady` is called when they have arrived.
 */
export class ModelCache {
	private pending = new Map<WeaponId, Promise<void>>();
	private models = new Map<WeaponId, THREE.Object3D>();
	private handsPending: Promise<void> | null = null;
	private hands: HandKit | null = null;
	private gone = false;

	constructor(
		private readonly load: ModelLoad,
		private readonly ready: (id: WeaponId, model: THREE.Object3D) => void,
		private readonly handsReady?: (kit: HandKit) => void
	) {}

	/** Start loading the model of a weapon (no generated model, null or already asked: nothing). */
	request(id: WeaponId | null): void {
		if (!id || this.gone || !generated(id) || this.pending.has(id)) return;
		this.requestHands();
		let p: Promise<void>;
		try {
			p = this.load(modelUrl(id)).then(
				(scene) => {
					const model = takeModel(scene);
					if (!model) return;
					if (this.gone) return disposeModel(model);
					this.models.set(id, model);
					this.ready(id, model);
				},
				() => undefined
			);
		} catch {
			p = Promise.resolve();
		}
		this.pending.set(id, p);
	}

	private requestHands(): void {
		if (this.handsPending || !this.handsReady) return;
		const failed = () => undefined;
		try {
			this.handsPending = this.load(HANDS_URL).then((scene) => {
				const kit = HandKit.from(scene);
				if (!kit) return;
				if (this.gone) return kit.dispose();
				this.hands = kit;
				this.handsReady!(kit);
			}, failed);
		} catch {
			this.handsPending = Promise.resolve();
		}
	}

	/** The loaded model of a weapon, if it has arrived. */
	get(id: WeaponId): THREE.Object3D | undefined {
		return this.models.get(id);
	}

	/** Resolves when every load started so far has finished, loaded or failed. */
	async settled(): Promise<void> {
		await Promise.all([...this.pending.values(), this.handsPending]);
	}

	dispose(): void {
		this.gone = true;
		for (const m of this.models.values()) disposeModel(m);
		this.models.clear();
		this.hands?.dispose();
		this.hands = null;
	}
}
