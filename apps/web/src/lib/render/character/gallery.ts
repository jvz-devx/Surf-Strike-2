/**
 * Dev-only character gallery (`/?characters`, docs/characters.md): a scripted
 * turntable without the game. `window.__gallery` lets browser automation pose
 * characters; not part of production builds.
 */
import { emptyLoadout, type Loadout } from '@surf/shared';
import * as THREE from 'three';
import { emptyMotion, type MotionState } from './animator.js';
import { HeldAssets, type HeldItem } from './held.js';
import { applyLoadout, CharacterModel, personOf, type CharacterRole } from './model.js';
import { registerSamples, SAMPLE_IDS } from './samples.js';

export interface GalleryActor {
	id?: number;
	x?: number;
	z?: number;
	yaw?: number;
	role?: CharacterRole;
	held?: HeldItem | 'claws' | null;
	samples?: boolean;
	loadout?: Partial<Loadout>;
	motion?: Partial<MotionState>;
	/** Force a LOD by pretending this distance (u). */
	dist?: number;
	hair?: 'swept' | 'crop' | 'bob' | 'curls' | 'ponytail';
}

interface Live {
	model: CharacterModel;
	motion: MotionState;
	dist: number;
}

export class CharacterGallery {
	readonly renderer: THREE.WebGLRenderer;
	readonly scene = new THREE.Scene();
	readonly camera = new THREE.PerspectiveCamera(35, 1, 1, 10000);
	readonly assets = new HeldAssets();
	readonly sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
	readonly hemi = new THREE.HemisphereLight(0xbfd4ee, 0x4a4238, 1.1);
	readonly live: Live[] = [];
	private raf = 0;

	constructor(canvas: HTMLCanvasElement) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
		this.scene.background = new THREE.Color(0x9fb4c8);
		this.sun.position.set(0.7, 1, 0.5);
		const floor = new THREE.GridHelper(640, 40, 0x667788, 0x8899a8);
		this.scene.add(this.sun, this.hemi, floor);
		registerSamples();
		this.view(0, 40, 230, 0);
		this.show([{ id: 1 }]);
		const tick = (now: number) => {
			this.raf = requestAnimationFrame(tick);
			this.step(1 / 60);
			void now;
		};
		this.raf = requestAnimationFrame(tick);
	}

	/** Stop the automatic animation (scripted stepping). */
	pause(): void {
		cancelAnimationFrame(this.raf);
	}

	/** Orbit camera: angle 0 looks at the front (+X). */
	view(angleDeg: number, height: number, dist: number, pitchDeg = 4, cx = 0, cz = 0): void {
		const a = (angleDeg * Math.PI) / 180;
		const p = (pitchDeg * Math.PI) / 180;
		this.camera.position.set(cx + Math.cos(a) * Math.cos(p) * dist, height + Math.sin(p) * dist, cz + Math.sin(a) * Math.cos(p) * dist);
		this.camera.lookAt(cx, height, cz);
	}

	show(list: readonly GalleryActor[]): void {
		for (const l of this.live) l.model.dispose();
		this.live.length = 0;
		list.forEach((a, i) => {
			const person = personOf(a.id ?? i + 1);
			if (a.hair) person.style = a.hair;
			const model = new CharacterModel(person, this.assets, { ghost: a.role === 'ghost' });
			if (a.role) model.setRole(a.role);
			model.setHeld(a.held ?? null);
			if (a.samples) applyLoadout(model, { ...emptyLoadout(), ...SAMPLE_IDS });
			else if (a.loadout) applyLoadout(model, { ...emptyLoadout(), ...a.loadout });
			model.group.position.set(a.x ?? 0, 0, a.z ?? 0);
			this.scene.add(model.group);
			this.live.push({ model, motion: { ...emptyMotion(), yaw: a.yaw ?? 0, ...a.motion }, dist: a.dist ?? 0 });
		});
	}

	/** Advance `n` frames of `dt` seconds and draw. */
	step(dt: number, n = 1): void {
		for (let i = 0; i < n; i++) for (const l of this.live) l.model.update(dt, l.motion, l.dist);
		const c = this.renderer.domElement;
		if (c.width !== c.clientWidth || c.height !== c.clientHeight) {
			this.renderer.setSize(c.clientWidth, c.clientHeight, false);
			this.camera.aspect = c.clientWidth / Math.max(1, c.clientHeight);
			this.camera.updateProjectionMatrix();
		}
		this.renderer.render(this.scene, this.camera);
	}

	dispose(): void {
		this.pause();
		this.show([]);
		this.assets.dispose();
		this.renderer.dispose();
	}
}

/** Start the gallery; returns its cleanup. */
export function startGallery(canvas: HTMLCanvasElement): () => void {
	const g = new CharacterGallery(canvas);
	(globalThis as { __gallery?: CharacterGallery }).__gallery = g;
	return () => g.dispose();
}
