/**
 * Scene owner: WebGL renderer, camera, lights, sky, map world, zones,
 * effects and remote players. World coordinates are Hammer units.
 */
import type { MapDef, Vec3 } from '@surf/shared';
import * as THREE from 'three';
import { applyViewAngles, setThree, toThree } from './coords.js';
import { buildEffects, type Effects } from './effects.js';
import { verticalFovFromHorizontal43 } from './fov.js';
import { applyTheme, createSharedUniforms, type SharedUniforms } from './materials.js';
import { GhostAvatar, RemotePlayers } from './players.js';
import { Sky } from './sky.js';
import { ZombieRenderer } from './zombies.js';
import { buildWorldMeshes, type WorldMeshes } from './world.js';
import { buildZoneMeshes, type ZoneMeshes } from './zones.js';

export class GameRenderer {
	readonly renderer: THREE.WebGLRenderer;
	readonly scene = new THREE.Scene();
	readonly camera: THREE.PerspectiveCamera;
	readonly players = new RemotePlayers();
	/** Race ghost (docs/gameplay.md#ghosts); posed by game.ts every frame. */
	readonly ghost = new GhostAvatar();
	/** Zombies mode: zombies, corpses, tracers and the first-person viewmodel (docs/modes.md#zombies). */
	readonly zombies = new ZombieRenderer();
	private shared: SharedUniforms = createSharedUniforms();
	private sky = new Sky();
	private hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1);
	private sun = new THREE.DirectionalLight(0xffffff, 1);
	private fog = new THREE.Fog(0x000000, 1000, 20000);
	private world: WorldMeshes | null = null;
	private zones: ZoneMeshes | null = null;
	private effects: Effects | null = null;
	private observer: ResizeObserver;
	private center: Vec3 = { x: 0, y: 0, z: 0 };

	constructor(private canvas: HTMLCanvasElement) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.camera = new THREE.PerspectiveCamera(verticalFovFromHorizontal43(90), 16 / 9, 2, 250000);
		this.scene.fog = this.fog;
		this.scene.add(this.sky.mesh, this.hemi, this.sun, this.sun.target, this.players.group, this.ghost.group, this.zombies.group);
		this.observer = new ResizeObserver(() => this.resize());
		this.observer.observe(canvas);
		this.resize();
	}

	private resize(): void {
		const w = Math.max(1, this.canvas.clientWidth);
		const h = Math.max(1, this.canvas.clientHeight);
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.zombies.resize(w / h);
	}

	setFov(fov43: number): void {
		const v = verticalFovFromHorizontal43(fov43);
		if (Math.abs(this.camera.fov - v) < 1e-6) return;
		this.camera.fov = v;
		this.camera.updateProjectionMatrix();
	}

	loadMap(map: MapDef): void {
		this.unloadMap();
		const t = map.theme;
		this.sky.setTheme(t);
		this.fog.color.setHex(t.fogColor);
		this.fog.near = t.fogNear;
		this.fog.far = t.fogFar;
		this.hemi.color.setHex(t.ambientSky);
		this.hemi.groundColor.setHex(t.ambientGround);
		this.hemi.intensity = t.ambientIntensity * Math.PI * 0.5;
		this.sun.color.setHex(t.sunColor);
		this.sun.intensity = t.sunIntensity;
		applyTheme(this.shared, t);

		this.world = buildWorldMeshes(map, this.shared);
		const b = this.world.bounds;
		this.center = { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 };
		const c = toThree(this.center);
		this.sun.target.position.copy(c);
		this.sun.position.copy(c).addScaledVector(this.shared.uSunDir.value, 10000);
		this.zones = buildZoneMeshes(map, this.shared);
		this.effects = buildEffects(t, this.center, this.shared);
		this.scene.add(this.world.group, this.zones.group, this.effects.group);
	}

	private unloadMap(): void {
		this.world?.dispose();
		this.zones?.dispose();
		this.effects?.dispose();
		this.world = this.zones = this.effects = null;
		this.players.clear();
		this.zombies.reset();
	}

	/** Eye position in Source coordinates; Source view angles in degrees. */
	setView(x: number, y: number, z: number, pitch: number, yaw: number): void {
		setThree(this.camera.position, x, y, z);
		applyViewAngles(this.camera, pitch, yaw);
	}

	render(timeSec: number): void {
		this.shared.uTime.value = timeSec;
		this.effects?.update(timeSec);
		this.sky.follow(this.camera);
		this.renderer.render(this.scene, this.camera);
		this.zombies.update(timeSec * 1000);
		if (this.zombies.vmVisible) {
			// Viewmodel over the world: own scene and camera, cleared depth so it never clips into walls.
			this.renderer.autoClear = false;
			this.renderer.clearDepth();
			this.renderer.render(this.zombies.vmScene, this.zombies.vmCamera);
			this.renderer.autoClear = true;
		}
	}

	dispose(): void {
		this.observer.disconnect();
		this.unloadMap();
		this.players.dispose();
		this.ghost.dispose();
		this.zombies.dispose();
		this.sky.dispose();
		this.renderer.dispose();
		this.renderer.forceContextLoss();
	}
}
