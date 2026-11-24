/**
 * Turntable of one character for the shop (docs/ui.md#shop). Owns a small
 * second WebGL context that exists only while the shop is open: nothing of it
 * runs or stays allocated after `dispose`.
 */
import { emptyLoadout, getCosmetic, LOOTBOX, type CosmeticSlot, type Loadout } from '@surf/shared';
import * as THREE from 'three';
import { emptyMotion } from './animator.js';
import { HeldAssets } from './held.js';
import { createLootbox } from '../lootbox.js';
import { applyLoadout, CharacterModel, personOf } from './model.js';

/** Degrees per second. */
const SPIN = 28;
/** No more frames than this: the game keeps drawing behind the menu. */
const FRAME_MS = 1000 / 45;
/** Thumbnail framing per slot: height looked at, visible height, turn (degrees). */
const THUMB: Record<CosmeticSlot, readonly [number, number, number]> = {
	hat: [69.5, 21, -32],
	glasses: [66.2, 13, -25],
	top: [49, 32, -20],
	bottom: [21, 46, -38],
	shoes: [4.6, 20, -48],
	effect: [38, 92, -20]
};
const BOX_THUMB = [9, 30, -35] as const;
const THUMB_PX = 192;
const DARK = new THREE.Color(0x171c24);
let opened = 0;

export class CharacterPreview {
	private readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	private readonly camera = new THREE.PerspectiveCamera(26, 1, 10, 1000);
	private readonly assets = new HeldAssets();
	private readonly model: CharacterModel;
	private readonly motion = emptyMotion();
	private readonly still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	private raf = 0;
	private last = 0;
	private drag: number | null = null;
	/** Turntable angle in degrees. */
	private angle = 0;

	private loadout: Loadout = emptyLoadout();
	private thumbs: { id: string; ready: (id: string, url: string) => void }[] = [];
	private readonly thumbCam = new THREE.PerspectiveCamera(20, 1, 10, 1000);

	/** `playerId` gives the person (skin, hair, tint) the others see. */
	constructor(
		private readonly canvas: HTMLCanvasElement,
		playerId: number
	) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		// Its own geometry: the game's renderer never shares buffers with this context.
		this.model = new CharacterModel(personOf(playerId), this.assets, { tag: `preview${++opened}` });
		const sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
		sun.position.set(0.9, 1, 0.5);
		this.scene.add(sun, new THREE.HemisphereLight(0xcfe0f4, 0x5a5046, 1.5), this.model.group);
		this.motion.yaw = -20;
		canvas.addEventListener('pointerdown', this.onDown);
		canvas.addEventListener('pointermove', this.onMove);
		canvas.addEventListener('pointerup', this.onUp);
		canvas.addEventListener('pointercancel', this.onUp);
		this.raf = requestAnimationFrame(this.frame);
	}

	setLoadout(loadout: Loadout): void {
		this.loadout = loadout;
		applyLoadout(this.model, loadout);
	}

	thumbnails(ids: readonly string[], ready: (id: string, url: string) => void): void {
		this.thumbs = ids.map((id) => ({ id, ready }));
	}

	/** Draw one item on this canvas and copy it; the caller redraws before the browser shows it. */
	private thumbnail(id: string, ready: (id: string, url: string) => void): void {
		const item = getCosmetic(id);
		const box = id === LOOTBOX.id ? createLootbox() : null;
		if (!item && !box) return;
		const [y, height, turn] = item ? THUMB[item.slot] : BOX_THUMB;
		if (item) applyLoadout(this.model, { ...emptyLoadout(), [item.slot]: id });
		// Light on a transparent picture would be lost: effects get a dark ground.
		if (item?.slot === 'effect') this.scene.background = DARK;
		const subject = box?.group ?? this.model.group;
		if (box) {
			this.model.group.visible = false;
			this.scene.add(box.group);
		}
		const dist = height / 2 / Math.tan((this.thumbCam.fov * Math.PI) / 360);
		this.thumbCam.position.set(dist, y + dist * (box ? 0.35 : 0.12), 0);
		this.thumbCam.lookAt(0, y, 0);
		subject.rotation.y = (turn * Math.PI) / 180;
		// Into a corner of the canvas, without resizing it.
		const r = this.renderer;
		const c = this.canvas;
		const pr = r.getPixelRatio();
		const px = Math.min(THUMB_PX, c.width, c.height);
		r.setViewport(0, 0, px / pr, px / pr);
		r.render(this.scene, this.thumbCam);
		r.setViewport(0, 0, c.width / pr, c.height / pr);
		const out = document.createElement('canvas');
		out.width = out.height = THUMB_PX;
		out.getContext('2d')?.drawImage(c, 0, c.height - px, px, px, 0, 0, THUMB_PX, THUMB_PX);
		const url = out.toDataURL();
		this.scene.background = null;
		if (box) {
			this.scene.remove(box.group);
			box.dispose();
			this.model.group.visible = true;
		}
		applyLoadout(this.model, this.loadout);
		ready(id, url);
	}

	private frame = (now: number): void => {
		this.raf = requestAnimationFrame(this.frame);
		const dt = Math.min(0.1, (now - this.last) / 1000);
		if (now - this.last < FRAME_MS - 2) return;
		this.last = now;
		const c = this.canvas;
		const w = c.clientWidth;
		const h = c.clientHeight;
		if (w === 0 || h === 0) return;
		const pr = this.renderer.getPixelRatio();
		if (c.width !== Math.floor(w * pr) || c.height !== Math.floor(h * pr)) {
			this.renderer.setSize(w, h, false);
			this.camera.aspect = w / h;
			// The whole figure (about 84 high with a hat, 50 wide) fits.
			const half = Math.tan((this.camera.fov * Math.PI) / 360);
			const dist = Math.max(42 / half, 25 / (half * this.camera.aspect)) + 10;
			this.camera.position.set(dist, 46, 0);
			this.camera.lookAt(0, 38, 0);
			this.camera.updateProjectionMatrix();
		}
		// The model turns, so its feet stay planted (the animator would step around).
		if (this.drag === null && !this.still) this.angle += SPIN * dt;
		this.model.update(dt, this.motion, 0);
		const thumb = this.thumbs.shift();
		if (thumb) this.thumbnail(thumb.id, thumb.ready);
		this.model.group.rotation.y = ((this.motion.yaw + this.angle) * Math.PI) / 180;
		this.renderer.render(this.scene, this.camera);
	};

	private onDown = (e: PointerEvent): void => {
		this.drag = e.clientX;
		this.canvas.setPointerCapture(e.pointerId);
	};
	private onMove = (e: PointerEvent): void => {
		if (this.drag === null) return;
		this.angle += (e.clientX - this.drag) * 0.6;
		this.drag = e.clientX;
	};
	private onUp = (): void => {
		this.drag = null;
	};

	dispose(): void {
		cancelAnimationFrame(this.raf);
		this.canvas.removeEventListener('pointerdown', this.onDown);
		this.canvas.removeEventListener('pointermove', this.onMove);
		this.canvas.removeEventListener('pointerup', this.onUp);
		this.canvas.removeEventListener('pointercancel', this.onUp);
		this.model.dispose();
		this.assets.dispose();
		this.renderer.dispose();
		this.renderer.forceContextLoss();
	}
}
