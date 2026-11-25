/**
 * Name tags of remote players on screen (render/players.ts) with a real camera:
 * as big as ever from afar, never wider than TAG_MAX_SHARE of the window
 * height up close. Node has no canvas: a stub 2D context draws nothing.
 */
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CrowdView } from './character/crowd.js';
import { HeldAssets } from './character/held.js';
import { standing } from './players-testkit.js';
import { RemotePlayers } from './players.js';

beforeAll(() => {
	const ctx = { measureText: () => ({ width: 100 }), fillRect: () => {}, strokeRect: () => {}, strokeText: () => {}, fillText: () => {} };
	vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
});
afterAll(() => {
	vi.unstubAllGlobals();
});

interface Shot {
	/** Tag width and height (px). */
	w: number;
	h: number;
	/** World units between the crown and the lower edge of the tag. */
	gap: number;
	sprite: THREE.Sprite;
	players: RemotePlayers;
}

const EYE = 64;

/** A player `dist` in front of the eye (three axes: the camera looks down -z), seen in a `w` × `h` window. */
function shoot(dist: number, { w = 1280, h = 720, fov = 73.74, pitch = 0, up = 0, frames = 2 } = {}): Shot {
	const camera = new THREE.PerspectiveCamera(fov, w / h, 1, 20000);
	camera.position.set(0, EYE, 0);
	camera.rotation.x = (pitch * Math.PI) / 180;
	const players = new RemotePlayers(new HeldAssets());
	players.upsert(1, 'Bob');
	players.setInfected(1, 'infected');
	players.setPose(1, standing(0, dist, up), true);
	const crowd = new CrowdView();
	for (let i = 0; i < frames; i++) {
		crowd.begin(i / 60, camera);
		players.update(crowd, i * 16);
	}
	players.group.updateMatrixWorld(true);
	const sprite = players.group.getObjectByProperty('isSprite', true) as THREE.Sprite;
	const at = sprite.getWorldPosition(new THREE.Vector3()).applyMatrix4(camera.matrixWorldInverse);
	// A sprite faces the camera: its edges lie at its own depth.
	const px = (dx: number, dy: number): THREE.Vector3 => new THREE.Vector3(at.x + dx, at.y + dy, at.z).applyMatrix4(camera.projectionMatrix);
	const sx = sprite.scale.x / 2;
	const sy = sprite.scale.y / 2;
	return {
		w: ((px(sx, 0).x - px(-sx, 0).x) / 2) * w,
		h: ((px(0, sy).y - px(0, -sy).y) / 2) * h,
		gap: sprite.position.y - sy - crownOf(players),
		sprite,
		players
	};
}

/** The crown the model reports for the pose as it stands. */
function crownOf(p: RemotePlayers): number {
	return p.model(1)!.update(0, standing(0, 100, 0), 100);
}

describe('name tags on screen', () => {
	it('far away the tag is 64 × 16 units, as before', () => {
		for (const dist of [200, 400, 900, 3000]) {
			const s = shoot(dist);
			expect([s.sprite.scale.x, s.sprite.scale.y]).toEqual([64, 16]);
			expect(s.w).toBeLessThanOrEqual(160);
			expect(s.gap).toBeCloseTo(6, 1);
		}
		// Twice as far, half as wide.
		expect(shoot(400).w / shoot(800).w).toBeCloseTo(2, 2);
	});

	it('up close it is never wider than 160 px of a 720 px window', () => {
		// Claw range without a limit: more than 500 px.
		for (const dist of [20, 48, 76, 120, 180]) {
			const s = shoot(dist);
			expect(s.w).toBeGreaterThan(158.5);
			expect(s.w).toBeLessThan(161.5);
			expect(s.w / s.h).toBeCloseTo(4, 3);
		}
	});

	it('takes the same share of a higher window', () => {
		expect(shoot(48, { w: 1920, h: 1080 }).w).toBeCloseTo(240, 0);
		expect(shoot(48, { w: 2560, h: 1080 }).w).toBeCloseTo(240, 0);
	});

	it('holds while aimed (narrower view, further out)', () => {
		expect(shoot(48, { fov: 20 }).w).toBeGreaterThan(155);
		for (const dist of [90, 300, 600]) expect(shoot(dist, { fov: 20 }).w).toBeLessThan(162);
		expect(shoot(300, { fov: 20 }).sprite.scale.x).toBeLessThan(64);
		expect(shoot(300).sprite.scale.x).toBe(64);
	});

	it('goes by depth: a player above, seen looking up, gets the same width', () => {
		for (const [up, pitch] of [[60, 40], [90, 50], [-40, -30]] as const) {
			const s = shoot(60, { up, pitch });
			expect(s.w).toBeGreaterThan(150);
			expect(s.w).toBeLessThan(170);
		}
	});

	it('shrinks onto the head: the gap to the crown stays', () => {
		for (const dist of [40, 60, 100, 150]) expect(shoot(dist).gap).toBeCloseTo(6, 1);
	});

	it('grows back with distance, without a step', () => {
		let last = 0;
		for (let d = 20; d <= 260; d += 2) {
			const x = shoot(d, { frames: 1 }).sprite.scale.x;
			expect(x).toBeGreaterThanOrEqual(last - 1e-9);
			if (last > 0) expect(x - last).toBeLessThan(1);
			last = x;
		}
		expect(last).toBe(64);
	});

	it('does not show a tag the mode hides (hide and seek)', () => {
		const s = shoot(48);
		s.players.setTagVisible(1, false);
		const crowd = new CrowdView();
		const camera = new THREE.PerspectiveCamera(73.74, 16 / 9, 1, 20000);
		camera.position.set(0, EYE, 0);
		for (let i = 0; i < 3; i++) {
			crowd.begin(i / 60, camera);
			s.players.update(crowd, i * 16);
		}
		expect(s.sprite.visible).toBe(false);
	});
});
