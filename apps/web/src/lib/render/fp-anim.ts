/**
 * Plays the first-person gun animations (render/fp-clips.ts) on a loaded gun (render/gun-rig.ts) and its hands
 * (render/hands.ts): the cycle and the trigger after a shot, the sniper's bolt, the reload, and the way back when
 * one of them is cut short. Owned by ZombieRenderer. Every pose is a function of the reload progress, the time since
 * the last shot and the rounds left; the only memory is the pose a cut-short move is left from.
 *
 * A code-built gun (no rig, no hands) only gets the moves of the whole gun.
 */
import { WEAPONS, type WeaponId } from '@surf/shared';
import * as THREE from 'three';
import { BELT_ROUNDS, beltBack, beltRounds, BOLT_MS, CYCLES, cycleAt, drawHand, ELBOW, FP_BOLTS, FP_RELOADS, newSample, restSample, squeezed, triggerAt, withKey, type Clip, type ClipSample, type HandKey, type HandTrack } from './fp-clips.js';
import { GUN_PARTS, type GunId, type GunRig } from './gun-rig.js';
import { blendHands, type GunPoseName, type HandPlace, type Quat } from './hand-poses.js';
import type { WeaponHandPair } from './hands.js';
import type { V3 } from './weapon-assets.js';

/** A move that is cut short (swap, death, the end of the round) goes back to rest in this long (ms). */
export const CANCEL_MS = 140;
/** A shown reload that ends this close to its end (share) has finished: nothing to blend out. */
const DONE = 0.985;
/** Where the pistol's second hand goes when it isn't needed (off its magazine pose, model units): off screen. */
const AWAY: V3 = [-12, -14, 8];
/** A shot is over for the gun after this long (ms): cycle, trigger and belt. */
const REST_MS = 400;
/** Longest the trigger of an automatic gun is held back after a shot, in fire intervals. */
const HOLD = 1.2;

export const isGun = (id: WeaponId | null): id is GunId => id !== null && id in GUN_PARTS;

/** Scale of the viewmodel node (render/zombies.ts): gun offsets are outside it, elbows inside. */
export const VM_SCALE = 0.42;

const ELBOWS = [0, 0, 0];
const V = new THREE.Vector3();
const E = new THREE.Euler();
const Q1 = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const turnQuat = (t: V3): Quat => {
	const q = Q1.setFromEuler(E.set(t[0], t[1], t[2]));
	return [q.x, q.y, q.z, q.w];
};
const mulQuat = (a: Quat, b: Quat): Quat => {
	const q = Q1.set(a[0], a[1], a[2], a[3]).multiply(Q2.set(b[0], b[1], b[2], b[3]));
	return [q.x, q.y, q.z, q.w];
};

/** What the animation is made from this frame. */
export interface FpInput {
	/** Reload progress 0..1, 1 when not reloading. */
	reload: number;
	/** Rounds in the magazine; undefined: unknown (the gun never shows empty). */
	mag: number | undefined;
	/** Dry-fire pulse 0..1. */
	dry: number;
	/** Aim progress 0..1: the bolt is worked with the sights left where they are. */
	aim: number;
	/** How far the gun is lowered by the draw (1 out of view). */
	lower: number;
}

/** What happened in a frame: casings and marks for the renderer. */
export interface FpEvents {
	/** The sniper's bolt has opened: its case goes out. */
	opened: boolean;
}

/** Where everything is: what is shown, and what a cut-short move is left from. */
interface Shown {
	sample: ClipSample;
	left: HandPlace | null;
	right: HandPlace | null;
}

export class FpAnim {
	/** Gun offset x, y, z and turn up, left, roll of the last `update` (viewmodel node). */
	readonly gun = new Float64Array(6);
	readonly events: FpEvents = { opened: false };
	private id: GunId | null = null;
	private shotAt = -Infinity;
	/** The running reload started with an empty magazine; null: no reload was shown in the last frame. */
	private emptyReload: boolean | null = null;
	private lastReload = 1;
	/** The bolt clip running in the last frame. */
	private bolting = false;
	private boltAt = -1;
	private cutAt = -Infinity;
	private readonly cut: Shown = { sample: newSample(), left: null, right: null };
	private readonly shown: Shown = { sample: newSample(), left: null, right: null };
	private readonly out = newSample();
	private beltShown = -1;
	/** The rest pose that is shown (0: none), and what it was put on. */
	private restKey = 0;
	private restRig: GunRig | undefined;
	private restHands: WeaponHandPair | undefined;

	/** Another weapon is held: everything at rest, nothing carried over. */
	hold(id: WeaponId | null): void {
		this.id = isGun(id) ? id : null;
		this.shotAt = this.cutAt = -Infinity;
		this.emptyReload = null;
		this.lastReload = 1;
		this.bolting = false;
		this.boltAt = -1;
		this.beltShown = -1;
		this.restKey = 0;
		this.gun.fill(0);
		restSample(this.shown.sample);
		this.shown.left = this.shown.right = null;
	}

	/** A shot. */
	fired(now: number): void {
		this.shotAt = now;
	}

	/** Whether the gun is out of its rest pose by a reload or a bolt (the tests). */
	get busy(): boolean {
		return this.emptyReload !== null || this.bolting;
	}

	/** The magazine as last shown: travel, offset, turn. */
	get shownMag(): Float64Array {
		return this.shown.sample.mag;
	}

	/** Rounds the belt of the LMG shows, for the renderer; -1 for a gun without one. */
	get belt(): number {
		return this.beltShown;
	}

	/** Progress of the bolt clip at `now`, 1 when it isn't running. */
	private boltProgress(now: number): number {
		const t = (now - this.shotAt) / (BOLT_MS);
		return t >= 0 && t < 1 ? t : 1;
	}

	/**
	 * Pose the gun for this frame. `rig` and `hands` of the loaded model (undefined: the code-built gun).
	 * Call it for a hidden viewmodel too: its time goes on.
	 */
	update(now: number, inp: FpInput, rig: GunRig | undefined, hands: WeaponHandPair | undefined): void {
		this.events.opened = false;
		const id = this.id;
		if (!id) return;
		const reload = inp.reload >= 0 && inp.reload < 1 ? inp.reload : 1;
		const bolt = reload < 1 ? 1 : this.boltProgress(now);
		const wasReload = this.emptyReload !== null;
		// What was running and is cut short leaves the pose it was in.
		const cutReload = wasReload && (reload >= 1 ? this.lastReload < DONE : reload < this.lastReload - 1e-6);
		const cutBolt = this.bolting && bolt >= 1 && reload < 1;
		if (cutReload || cutBolt) this.keep(now);
		if (reload < 1 && (!wasReload || reload < this.lastReload - 1e-6)) this.emptyReload = inp.mag === 0;
		if (reload >= 1) this.emptyReload = null;
		this.lastReload = reload;
		this.bolting = bolt < 1 && !!FP_BOLTS[id];

		const clip: Clip | null = reload < 1 ? FP_RELOADS[id][this.emptyReload ? 'empty' : 'loaded'] : this.bolting ? FP_BOLTS[id]! : null;
		const p = reload < 1 ? reload : bolt;
		const s = clip ? clip.at(p, this.out) : restSample(this.out);
		// The case leaves as the bolt is all the way back.
		if (this.bolting) {
			const open = FP_BOLTS[id]!.def.bolt!.find((k) => k.to[1] === 1)!.t;
			this.events.opened = p >= open && this.boltAt < open;
			this.boltAt = p;
		} else this.boltAt = -1;

		const cycle = CYCLES[id];
		if (cycle && reload >= 1) s.bolt[0] = cycleAt(cycle, now - this.shotAt, inp.mag === 0);
		const auto = WEAPONS[id].automatic;
		const trigger = reload < 1 ? 0 : Math.max(triggerAt(now - this.shotAt, auto ? WEAPONS[id].fireMs * HOLD : 60), inp.dry > 0 ? Math.min(1, inp.dry * 1.4) : 0);
		this.beltShown = id === 'lmg' ? (reload < 1 && this.emptyReload !== null && s.magShown && p >= (clip?.times?.fresh ?? 1) ? BELT_ROUNDS : inp.mag === undefined ? BELT_ROUNDS : beltRounds(inp.mag)) : -1;

		const w = 1 - ease((now - this.cutAt) / CANCEL_MS);
		const cutting = w > 0 && this.cutAt !== -Infinity;
		if (cutting) this.mix(s, w);

		// Worked while aiming, the sights stay where they are; a reload takes over as the aim goes.
		const still = 1 - inp.aim;
		for (let i = 0; i < 6; i++) this.gun[i] = s.gun[i]! * still;

		copySample(this.shown.sample, s);
		// At rest and shown so: nothing to pose (a gun mostly does nothing).
		const quiet = !clip && !cutting && trigger === 0 && inp.lower === 0 && (now - this.shotAt > REST_MS || this.shotAt === -Infinity) ? 1 + (this.beltShown + 1) + (s.bolt[0]! > 0 ? 100 : 0) : 0;
		if (quiet > 0 && quiet === this.restKey && rig === this.restRig && hands === this.restHands) return;
		this.restKey = quiet;
		this.restRig = rig;
		this.restHands = hands;
		if (!rig) {
			// The hands of a code-built gun are part of it: it goes down out of the way instead of turning its underside up.
			const down = Math.min(1, Math.abs(s.gun[5]!) / 0.4) * (reload < 1 ? 1 : 0);
			this.gun.fill(0);
			this.gun[1] = down > 0 ? -1.8 * down : 0;
			this.gun[2] = reload < 1 ? s.gun[2]! : 0;
			this.gun[3] = Math.max(0, s.gun[3]!) * down;
			return;
		}
		const slider = rig.part('slide') ? 'slide' : 'bolt';
		rig.move(slider, s.bolt);
		rig.move('cover', s.cover[0]!);
		const mag = [s.mag[1]!, s.mag[2]!, s.mag[3]!];
		const turn = [s.mag[4]!, s.mag[5]!, s.mag[6]!];
		const step = GUN_PARTS[id].mag![0]!;
		rig.move('mag', s.mag[0]!, mag, turn);
		const magNode = rig.part('mag');
		if (magNode) magNode.visible = s.magShown;
		rig.move('trigger', trigger);
		const beltNode = rig.part('belt');
		if (beltNode) {
			const hung = s.hang || cutting;
			rig.move('belt', s.belt[0]!, hung ? mag.map((v, i) => v + step.axis[i]! * step.to * s.mag[0]!) : undefined, hung ? turn : undefined);
			beltNode.visible = s.magShown && this.beltShown !== 0;
			rig.beltRounds(this.beltShown);
			// It goes on by a round with each shot.
			rig.beltFeed(reload >= 1 ? beltBack(now - this.shotAt) : 0);
		}
		if (!hands) return;
		const resolve = (k: HandKey): HandPlace | null => {
			// Let go of there: the part it held goes on without it.
			if (k.when) rig.move(slider, k.when);
			const h = hands.pose(k.pose, k.on);
			if (k.when) rig.move(slider, s.bolt);
			if (!h) return null;
			// An arm that carries the magazine away goes with it.
			if (k.pose === 'mag') for (let i = 0; i < 3; i++) ELBOWS[i] = h.elbow[i]! + (mag[i]! + step.axis[i]! * step.to * s.mag[0]!) * ELBOW;
			return withKey(k.pose === 'mag' ? { ...h, elbow: [ELBOWS[0]!, ELBOWS[1]!, ELBOWS[2]!] } : h, k, turnQuat, mulQuat);
		};
		const side = (track: HandTrack | null, rest: GunPoseName | null): HandPlace | null => {
			if (track) return track.shown(p) ? track.at(p, resolve, blendHands) : null;
			return rest ? hands.pose(rest) : null;
		};
		let right = side(clip?.right ?? null, 'grip');
		let left = side(clip?.left ?? null, hands.named('fore') ? 'fore' : null);
		if (!clip && left) {
			const off = drawHand(inp.lower);
			if (off) left = withKey(left, { t: 0, pose: 'fore', off, open: Math.min(1, -off[1] / 1.2) }, turnQuat, mulQuat);
		}
		if (cutting) {
			right = fromCut(this.cut.right, right, w);
			// The pistol's second hand goes back down out of the picture.
			if (!left && this.cut.left) {
				const away = hands.pose('mag');
				if (away) left = withKey(away, { t: 0, pose: 'mag', off: AWAY, open: 0.8 }, turnQuat, mulQuat);
			}
			left = fromCut(this.cut.left, left, w);
		}
		this.shown.right = right;
		this.shown.left = left;
		// The shoulders stay where they are while the gun turns and moves: the elbows with them.
		hands.set('r', right && this.shoulder(squeezed(id, right, trigger), hands));
		hands.set('l', left && this.shoulder(left, hands));
	}

	/** A hand whose elbow stays where it is while the gun is offset: turned and moved back in model space. */
	private shoulder(h: HandPlace, hands: WeaponHandPair): HandPlace {
		const o = this.gun;
		if (!(o[0] || o[1] || o[2] || o[3] || o[4] || o[5])) return h;
		const sp = hands.space;
		V.set(h.elbow[0], h.elbow[1], h.elbow[2]).applyQuaternion(sp.quaternion).multiplyScalar(sp.scale.x).add(sp.position);
		V.set(V.x - o[0]! / VM_SCALE, V.y - o[1]! / VM_SCALE, V.z - o[2]! / VM_SCALE).applyQuaternion(Q1.setFromEuler(E.set(o[3]!, o[4]!, o[5]!)).invert());
		V.sub(sp.position).divideScalar(sp.scale.x).applyQuaternion(Q1.copy(sp.quaternion).invert());
		return { ...h, elbow: [V.x, V.y, V.z] };
	}

	/** Remember what is shown: the pose the next one is blended from. */
	private keep(now: number): void {
		copySample(this.cut.sample, this.shown.sample);
		// A magazine on its way between two reloads is not in the picture: it comes back from where the old one went.
		this.cut.left = this.shown.left;
		this.cut.right = this.shown.right;
		this.cutAt = now;
	}

	/** Blend `w` of the kept pose into `s`. */
	private mix(s: ClipSample, w: number): void {
		const c = this.cut.sample;
		for (const k of ['gun', 'bolt', 'cover', 'belt', 'mag'] as const) for (let i = 0; i < s[k].length; i++) s[k][i] = s[k][i]! + (c[k][i]! - s[k][i]!) * w;
	}
}

/** A hand on its way back from where it was cut off; a hand that had gone (or goes) off screen isn't blended. */
function fromCut(cut: HandPlace | null, to: HandPlace | null, w: number): HandPlace | null {
	return cut && to ? blendHands(to, cut, w) : to;
}

function copySample(to: ClipSample, from: ClipSample): void {
	to.gun.set(from.gun);
	to.bolt.set(from.bolt);
	to.cover.set(from.cover);
	to.belt.set(from.belt);
	to.mag.set(from.mag);
	to.magShown = from.magShown;
	to.hang = from.hang;
}

const ease = (t: number): number => {
	const u = Math.min(1, Math.max(0, t));
	return u * u * (3 - 2 * u);
};
