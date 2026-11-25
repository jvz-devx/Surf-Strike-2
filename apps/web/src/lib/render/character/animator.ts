/**
 * Procedural character animation (docs/characters.md). Writes the flat
 * skeleton every frame from a motion state: leg IK with a distance-driven gait
 * (planted feet move exactly with the ground), crouch, air, landing, surf
 * stance, aim pitch, held items, reloads and the bolt cycle (reload.ts). No
 * allocations per frame.
 */
import {
	armAngles,
	armSwing,
	BODY_AIR_DRIFT,
	bodyAngles,
	bodyGait,
	clawAngles,
	cycleDistance,
	footPose,
	GRIP_RELAX_DROP,
	gripBobY,
	gripBobZ,
	gripRelax,
	legPose,
	newBodyAngles,
	newLegPose,
	PLAYER_ELBOWS,
	PLAYER_FIST,
	PLAYER_GRIPS,
	resetBody,
	shoulderRoll,
	shoulderYaw,
	stepBody,
	type ArmAngles,
	type BodyBlend,
	type BodyExtras,
	type BodyInput,
	type BodyPosture,
	type FootPose,
	type GaitShape
} from '@surf/shared';
import * as THREE from 'three';
import { HELD, type HeldItem } from './held.js';
import { BOLT_SECS, BOLTS, HandFrames, RELOADS, type Clip, type MagPlace } from './reload.js';
import { ANKLE_Y, ARM_TILT, armDir, BIND, FOREARM, sideSign, THIGH, UPPER_ARM, type BoneName, type CharacterSkeleton, type Side } from './skeleton.js';

export type Posture = BodyPosture;

export interface MotionState extends BodyInput {
	/** Unit normal of the ramp being surfed (Source axes), or null. */
	ramp: { x: number; y: number; z: number } | null;
}

export function emptyMotion(): MotionState {
	return { vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, ducked: false, ramp: null };
}

const DEG = Math.PI / 180;
const V = THREE.Vector3;
const Q = THREE.Quaternion;

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
	const t = clamp((x - a) / (b - a), 0, 1);
	return t * t * (3 - 2 * t);
};

// The gait, the lean and the foot and arm swings are shared with the server's hit tests.
export { cycleDistance, footOffset, gaitShape, type GaitShape } from '@surf/shared';

// Scratch -------------------------------------------------------------------

const v1 = new V();
const v2 = new V();
const v3 = new V();
const v4 = new V();
const q1 = new Q();
const q2 = new Q();
const e1 = new THREE.Euler();
const m1 = new THREE.Matrix4();
const ax = new V();
const ay = new V();
const az = new V();
const UP = new V(0, 1, 0);
const gripP = new V();
const gripQ = new Q();
const wrist = new V();
const dirA = new V();
const dirB = new V();
const ikT = new V();
const ikU = new V();
const ikE = new V();
const ikF = new V();

/** Yaw (left +), then forward pitch, then roll (right +). */
function ypr(out: THREE.Quaternion, yaw: number, pitch: number, roll: number): THREE.Quaternion {
	return out.setFromEuler(e1.set(roll, yaw, -pitch, 'YZX'));
}

const bindV = Object.fromEntries(Object.entries(BIND).map(([k, p]) => [k, new V(...p)])) as Record<BoneName, THREE.Vector3>;

/** Inverse bind basis of a segment: its axis is −Y, X is the bend direction. */
function basis(out: THREE.Quaternion, dir: THREE.Vector3, fwd: THREE.Vector3): THREE.Quaternion {
	ay.copy(dir).negate();
	ax.copy(fwd).addScaledVector(ay, -fwd.dot(ay)).normalize();
	az.crossVectors(ax, ay);
	return out.setFromRotationMatrix(m1.makeBasis(ax, ay, az));
}

const FWD = new V(1, 0, 0);
const segInv = (a: BoneName, b: BoneName) => basis(new Q(), v1.copy(bindV[b]).sub(bindV[a]).normalize(), FWD).invert();
const THIGH_INV = segInv('thighR', 'shinR');
const SHIN_INV = segInv('shinR', 'footR');
const SHIN_LEN = bindV.footR.distanceTo(bindV.shinR);
const ARM_INV: Record<Side, THREE.Quaternion> = {
	L: basis(new Q(), new V(...armDir('L')), FWD).invert(),
	R: basis(new Q(), new V(...armDir('R')), FWD).invert()
};
/** Rotates the A-pose arm to hang straight down. */
const HANG: Record<Side, THREE.Quaternion> = { R: new Q().setFromEuler(new THREE.Euler(ARM_TILT, 0, 0)), L: new Q().setFromEuler(new THREE.Euler(-ARM_TILT, 0, 0)) };
/** Inverse of the hand's bind basis (fingers, thumb). */
function handBasis(out: THREE.Quaternion, d: THREE.Vector3, t: THREE.Vector3): THREE.Quaternion {
	ax.copy(d).normalize();
	ay.copy(t).addScaledVector(ax, -t.dot(ax)).normalize();
	az.crossVectors(ax, ay);
	return out.setFromRotationMatrix(m1.makeBasis(ax, ay, az));
}
const HAND_INV: Record<Side, THREE.Quaternion> = {
	L: handBasis(new Q(), new V(...armDir('L')), FWD).invert(),
	R: handBasis(new Q(), new V(...armDir('R')), FWD).invert()
};

/** Turn of the hand sockets from their bone (skeleton.ts). */
const HAND_BIND: Record<Side, THREE.Quaternion> = { L: HAND_INV.L.clone().invert(), R: HAND_INV.R.clone().invert() };

// Reload scratch
const frames = new HandFrames();
const tip = new Float64Array(6);
const fistP = new V();
const fistQ = new Q();

const SIDES: readonly Side[] = ['L', 'R'];
const N = Object.fromEntries(
	SIDES.map((s) => [
		s,
		{
			clav: `clav${s}`,
			upperH: `upperH${s}`,
			upper: `upper${s}`,
			foreH: `foreH${s}`,
			fore: `fore${s}`,
			hand: `hand${s}`,
			fingers: `fingers${s}`,
			tips: `tips${s}`,
			thighH: `thighH${s}`,
			thigh: `thigh${s}`,
			shinH: `shinH${s}`,
			shin: `shin${s}`,
			foot: `foot${s}`,
			toe: `toe${s}`
		}
	])
) as unknown as Record<Side, Record<'clav' | 'upperH' | 'upper' | 'foreH' | 'fore' | 'hand' | 'fingers' | 'tips' | 'thighH' | 'thigh' | 'shinH' | 'shin' | 'foot' | 'toe', BoneName>>;

/** A clip comes in and is cut short over this long (s). */
export const CLIP_IN_SECS = 0.1;
export const CLIP_OUT_SECS = 0.15;
/** Distance a hand on its way to the belt keeps from the middle of the torso, and the side it passes on. */
const BODY_CLEAR = 10.5;
const OFF_BODY = new V(0.6, 0, -0.8);
/** Ducked it keeps this much higher. */
const OVER_THIGH = 5;
/** Acceleration of a dropped magazine (u/s²). */
const FALL = 800;

/** Where the parts of the held gun are (model space), while a clip runs. */
export interface PartsPose {
	/** A clip is showing: the gun is drawn in parts. */
	on: boolean;
	mag: MagPlace;
	magP: THREE.Vector3;
	magQ: THREE.Quaternion;
	/** A dropped magazine is falling. */
	falling: boolean;
	fallP: THREE.Vector3;
	fallQ: THREE.Quaternion;
	/** Moving part, from its place on the gun. */
	actP: THREE.Vector3;
	actQ: THREE.Quaternion;
	/** The gun off the right hand (a hand on the bolt): its place in the `handR` socket. */
	off: boolean;
	offP: THREE.Vector3;
	offQ: THREE.Quaternion;
}

export class CharacterAnimator implements BodyBlend {
	posture: Posture = 'normal';
	held: HeldItem | null = null;
	/** AI zombie winding up an attack: leans in, arms high. */
	lunging = false;
	/** Claw hands ready (infected). */
	claws = false;
	/** Model-space height of the crown after the last update. */
	headTop = 72;

	// Blends (shared body-pose.ts steps them)
	duck = 0;
	ground = 1;
	move = 0;
	private surf = 0;
	private hold = 0;
	private shownHeld: HeldItem | null = null;
	speed = 0;
	private phase = 0;
	dirF = 1;
	dirR = 0;
	hip = 0;
	turning = false;
	turnLift = 0;
	back = false;
	lastYaw = NaN;
	private time = Math.random() * 20;
	airTime = 0;
	lead: 1 | -1 = 1;
	lastVz = 0;
	land = 0;
	landV = 0;
	vzS = 0;
	accF = 0;
	accR = 0;
	lastF = 0;
	lastR = 0;
	aim = 0;
	private rampN = new V(0, 1, 0);
	private rampDrop = 0;
	private lunge = 0;
	private action = 0;
	private actionKind: 'fire' | 'swing' = 'fire';

	// Reload and bolt cycle
	private reloadItem: HeldItem | null = null;
	private reloadP = 1;
	private reloadMs = 0;
	private boltItem: HeldItem | null = null;
	private boltT = BOLT_SECS;
	/** The clip in the arms, where it is and how much of it shows (0..1). */
	private clip: Clip | null = null;
	private clipP = 0;
	private clipW = 0;
	readonly parts: PartsPose = { on: false, mag: 'gun', magP: new V(), magQ: new Q(), falling: false, fallP: new V(), fallQ: new Q(), actP: new V(), actQ: new Q(), off: false, offP: new V(), offQ: new Q() };
	private readonly gait: GaitShape = { duty: 0.5, stride: 10, lift: 2 };
	private readonly feet: Record<Side, FootPose> = {
		L: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, toe: 0 },
		R: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, toe: 0 }
	};
	private readonly angles = newBodyAngles();
	private readonly leg = newLegPose();
	private readonly extras: BodyExtras = { time: 0, surf: 0, rampDrop: 0, lunge: 0 };
	private readonly arm: ArmAngles = { fwd: 0, out: 0, bend: 0, inward: 0, curl: 0 };
	private readonly rampQ = new Q();
	private readonly fkUpper = new Q();
	private readonly fkFore = new Q();

	constructor(private readonly sk: CharacterSkeleton) {}

	/** Snap every blend (spawn, teleport). */
	reset(): void {
		resetBody(this);
		this.clip = null;
		this.clipW = 0;
		this.boltT = BOLT_SECS;
	}

	/** Recoil or knife / claw swing; a bolt-action rifle then works its bolt. */
	act(kind: 'fire' | 'swing'): void {
		this.action = 1;
		this.actionKind = kind;
		if (kind !== 'fire' || !this.held || !BOLTS[this.held]) return;
		this.boltItem = this.held;
		this.boltT = 0;
	}

	/**
	 * Where the reload of `item` is (0..1, of `ms`); null: none, a running one
	 * blends out. Set from the clock before every update, so a character that
	 * was not animated for a while is where it should be.
	 */
	reload(item: HeldItem | null, p = 1, ms = 0): void {
		this.reloadItem = item && RELOADS[item] ? item : null;
		this.reloadP = p;
		this.reloadMs = ms;
	}

	/** The clip that should show now: its weapon is in the hands and stays there. */
	private wanted(): Clip | null {
		const item = this.shownHeld;
		if (!item || item !== this.held) return null;
		if (this.reloadItem === item && this.reloadP < 1) return RELOADS[item]!;
		return this.boltItem === item && this.boltT < BOLT_SECS ? BOLTS[item]! : null;
	}

	/** Advance the running clip; one that ended early, or starts over, blends out first. */
	private stepClip(dt: number): void {
		this.boltT += dt;
		const want = this.wanted();
		const p = want === null ? 1 : want === RELOADS[want.item] ? this.reloadP : this.boltT / BOLT_SECS;
		// The gun it belongs to is gone (the swap is at the bottom of its dip).
		if (this.clip && this.clip.item !== this.shownHeld) this.clip = null;
		if (this.clip && (this.clip !== want || p < this.clipP - 1e-3)) {
			this.clipW -= dt / CLIP_OUT_SECS;
			if (this.clipW > 0) return;
			this.clip = null;
		}
		if (!want) return;
		if (!this.clip) this.clipW = 0;
		this.clip = want;
		this.clipP = p;
		this.clipW = Math.min(1, this.clipW + dt / CLIP_IN_SECS);
	}

	update(dtSec: number, s: MotionState): void {
		const dt = clamp(dtSec, 0, 0.1);
		const k = (rate: number) => 1 - Math.exp(-rate * dt);
		this.time += dt;
		const t = this.time;

		// ---- Motion in the facing frame ---------------------------------------
		const yaw = s.yaw * DEG;
		const cy = Math.cos(yaw);
		const sy = Math.sin(yaw);
		const speed = Math.hypot(cy * s.vx + sy * s.vy, sy * s.vx - cy * s.vy);
		const first = Number.isNaN(this.lastYaw);
		const ramp = !s.onGround ? s.ramp : null;
		if (first) this.surf = ramp ? 1 : 0;
		// A reversal mirrors the stride.
		if (stepBody(this, dt, s, ramp ? -0.75 * Math.sign(this.rampN.z || 1) : 0)) this.phase = (this.gait.duty - this.phase + 1) % 1;
		this.surf += ((ramp ? 1 : 0) - this.surf) * k(ramp ? 9 : 5);
		// Held item changes dip through the unarmed pose.
		if (this.held !== this.shownHeld) {
			this.hold += (0 - this.hold) * k(26);
			if (this.hold < 0.06 || !this.shownHeld) this.shownHeld = this.held;
		} else this.hold += ((this.held ? 1 : 0) - this.hold) * k(14);
		this.lunge += ((this.lunging ? 1 : 0) - this.lunge) * k(16);
		this.action = Math.max(0, this.action - dt / (this.actionKind === 'swing' ? 0.34 : 0.14));
		// The whole time passed, also for a character that was off screen.
		this.stepClip(dtSec);

		const g = this.ground;
		const surf = this.surf;
		const hip = this.hip;

		// ---- Gait phase ------------------------------------------------------------
		const gait = bodyGait(this.speed, this.duck, this.posture, this.gait);
		const dist = cycleDistance(gait);
		if (g > 0.2) this.phase = (this.phase + (speed * dt) / dist) % 1;
		const phL = this.phase;
		const phR = (this.phase + 0.5) % 1;

		// ---- Ramp --------------------------------------------------------------------
		if (ramp) {
			// Ramp normal in the facing frame.
			v1.set(cy * ramp.x + sy * ramp.y, ramp.z, sy * ramp.x - cy * ramp.y);
			this.rampN.lerp(v1, k(10)).normalize();
			const drop = (16 * (Math.abs(ramp.x) + Math.abs(ramp.y))) / Math.max(0.35, ramp.z);
			this.rampDrop += (-Math.min(13, drop) - this.rampDrop) * k(10);
		}
		const n = this.rampN;

		// ---- Pelvis ---------------------------------------------------------------------
		const posture = this.posture;
		const x = this.extras;
		x.time = t;
		x.surf = surf;
		x.rampDrop = this.rampDrop;
		x.lunge = this.lunge;
		const a = bodyAngles(this, phL, gait.duty, posture, this.hold, this.shownHeld ? PLAYER_GRIPS[HELD[this.shownHeld].hold].chestYaw : 0, x, this.angles);
		const pelvis = this.sk.bones.pelvis;
		pelvis.position.set(a.px, a.py, a.pz);
		ypr(pelvis.quaternion, a.pelvisYaw, a.pelvisPitch, a.pelvisRoll);
		if (surf > 0.01) {
			// Balance: the body leans into the ramp, part of the way to its normal.
			v1.set(n.x * 0.5, 1, n.z * 0.5).normalize();
			this.rampQ.setFromUnitVectors(UP, v1);
			q1.identity().slerp(this.rampQ, surf * 0.75);
			pelvis.quaternion.premultiply(q1);
			pelvis.position.x += n.x * surf * 2;
			pelvis.position.z += n.z * surf * 2;
		}

		// ---- Spine, chest, neck, head ------------------------------------------------------
		const chest = this.sk.bones.chest;
		ypr(chest.quaternion, a.chestYaw, a.chestPitch, a.chestRoll);
		if (surf > 0.01) {
			q1.identity().slerp(this.rampQ, surf * 0.5);
			chest.quaternion.premultiply(q1);
		}
		this.child('spine', 'pelvis');
		this.sk.bones.spine.quaternion.slerpQuaternions(pelvis.quaternion, chest.quaternion, 0.5);
		this.child('chest', 'spine');
		// The head looks where the player aims, kept level over a leaning torso.
		const head = this.sk.bones.head;
		ypr(head.quaternion, 0, a.headPitch, a.headRoll);
		const neck = this.sk.bones.neck;
		this.child('neck', 'chest');
		neck.quaternion.slerpQuaternions(chest.quaternion, head.quaternion, 0.5);
		this.child('head', 'neck');
		this.headTop = head.position.y + 11;

		// ---- Legs ---------------------------------------------------------------------------
		for (const side of SIDES) this.placeFoot(side, side === 'L' ? phL : phR, surf);
		for (const side of SIDES) this.solveLeg(side);

		// ---- Arms ---------------------------------------------------------------------------
		for (const side of SIDES) this.poseArm(side, surf);
		if (this.hold > 0.01 && this.shownHeld) this.holdItem(this.shownHeld, this.hold, a.move, a.run);
		for (const side of SIDES) this.finishArm(side);
	}

	/** Item to draw this frame (swaps at the bottom of the change). */
	get drawnHeld(): HeldItem | null {
		return this.shownHeld;
	}

	/** The held gun is drawn in parts this frame. */
	get partsOn(): boolean {
		return this.parts.on && this.clip !== null;
	}

	/** Position a child bone rigidly on its parent. */
	private child(c: BoneName, p: BoneName): void {
		const b = this.sk.bones;
		b[c].position.copy(bindV[c]).sub(bindV[p]).applyQuaternion(b[p].quaternion).add(b[p].position);
	}

	private placeFoot(side: Side, ph: number, surf: number): void {
		const z = sideSign(side);
		const ft = this.feet[side];
		const hip = this.hip;

		const turn = this.turnLift * (Math.sin(this.time * 14 + (z > 0 ? Math.PI : 0)) > 0 ? 1 : 0);
		footPose(this, this.angles, this.gait, z, ph, z === this.lead, turn, Math.sin(this.time * 5 + z) * BODY_AIR_DRIFT, ft);

		// Surf: feet apart along the board line, on the ramp plane.
		if (surf > 0.01) {
			const front = (side === 'L') === this.rampN.z < 0 ? 1 : -1;
			const n = this.rampN;
			const sx = front * 9.5;
			const sz = -n.z * 7 + z * 1.2;
			const y = clamp(this.rampDrop - (n.x * sx + n.z * sz) / Math.max(0.35, n.y), -15, 14);
			ft.x = lerp(ft.x, sx, surf);
			ft.y = lerp(ft.y, y + ANKLE_Y * n.y + 0.4, surf);
			ft.z = lerp(ft.z, sz, surf);
			ft.yaw = lerp(ft.yaw, hip * 1.15, surf);
			ft.pitch = lerp(ft.pitch, 0, surf);
			ft.toe = lerp(ft.toe, 1, surf);
		}
	}

	private solveLeg(side: Side): void {
		const b = this.sk.bones;
		const nm = N[side];
		const ft = this.feet[side];
		const z = sideSign(side);
		this.child(nm.thigh, 'pelvis');
		const hipP = b[nm.thigh].position;
		const leg = legPose(hipP.x, hipP.y, hipP.z, ft, z, this.duck, this.leg);
		// Thigh direction, and the way the knee points.
		v3.set(leg.tx, leg.ty, leg.tz);
		v1.set(leg.nx, leg.ny, leg.nz);
		const knee = b[nm.shin].position.set(leg.kneeX, leg.kneeY, leg.kneeZ);
		b[nm.thigh].quaternion.copy(basis(q1, v3, v1)).multiply(THIGH_INV);
		v4.set(leg.ankleX, leg.ankleY, leg.ankleZ).sub(knee).normalize();
		b[nm.shin].quaternion.copy(basis(q1, v4, v1)).multiply(SHIN_INV);
		b[nm.thighH].position.copy(hipP);
		b[nm.thighH].quaternion.slerpQuaternions(b.pelvis.quaternion, b[nm.thigh].quaternion, 0.5);
		b[nm.shinH].position.copy(knee);
		b[nm.shinH].quaternion.slerpQuaternions(b[nm.thigh].quaternion, b[nm.shin].quaternion, 0.5);
		// Foot and toe.
		const foot = b[nm.foot];
		foot.position.set(leg.ankleX, leg.ankleY, leg.ankleZ);
		ypr(foot.quaternion, ft.yaw, -ft.pitch, 0);
		const toe = b[nm.toe];
		ypr(toe.quaternion, ft.yaw, -ft.pitch * ft.toe, 0);
		if (this.surf > 0.01) {
			q1.setFromUnitVectors(UP, this.rampN);
			q2.identity().slerp(q1, this.surf * 0.75);
			foot.quaternion.premultiply(q2);
			toe.quaternion.premultiply(q2);
		}
		this.child(nm.toe, nm.foot);
	}

	/** Forward-kinematic arm relative to the chest. */
	private poseArm(side: Side, surf: number): void {
		const b = this.sk.bones;
		const nm = N[side];
		const z = sideSign(side);
		const chest = b.chest.quaternion;
		const arm = armAngles(this, this.angles, z, z === this.lead, Math.sin(this.time * 1.7 + 0.6), surf, this.arm);
		let { fwd, out, bend, inward, curl } = arm;
		if (surf > 0.01) {
			// Balancing: arms out, the one over the drop higher.
			const high = z * this.rampN.z > 0 ? 1 : 0;
			fwd = lerp(fwd, (z * Math.sign(this.rampN.z || 1) > 0 ? 0.35 : -0.1) + Math.sin(this.time * 2.6 + z) * 0.06, surf);
			out = lerp(out, lerp(0.85, 1.25, high) + Math.sin(this.time * 2.1 + z * 2) * 0.05, surf);
			bend = lerp(bend, 0.5, surf);
			inward = lerp(inward, 0.1, surf);
			curl = lerp(curl, 0.25, surf);
		}
		if (this.posture === 'zombie') {
			const a = Math.sin(this.time * 3.1 + z * 1.3) * 0.08;
			fwd = 1.42 + this.lunge * 0.5 + a + armSwing(this, this.angles, z) * this.angles.move * 0.16 + this.aim * 0.1;
			out = 0.02 + Math.sin(this.time * 2.3 + z) * 0.04;
			bend = 0.28 + a;
			inward = 0.1;
			curl = 0.75;
		} else if (this.posture === 'infected' && (this.claws || this.hold < 0.5)) {
			arm.fwd = fwd;
			({ fwd, out, bend, inward, curl } = clawAngles(this, this.angles, z, Math.sin(this.time * 2.4 + z) * 0.04, arm));
		}
		if (this.action > 0 && this.actionKind === 'swing' && this.hold < 0.5 && z > 0) {
			// Claw slash with the right hand.
			const s = Math.sin(this.action * Math.PI);
			fwd += s * 1.1;
			out -= s * 0.45;
			bend -= s * 0.5;
		}
		// Shoulder: lifts and reaches with the arm.
		const clav = b[nm.clav];
		this.child(nm.clav, 'chest');
		ypr(q1, shoulderYaw(z, fwd), 0, shoulderRoll(z, out));
		clav.quaternion.copy(chest).multiply(q1);
		this.child(nm.upper, nm.clav);
		// chest · swing(Z) · abduct(X) · twist(Y) · hang
		e1.set(-z * out, 0, fwd, 'ZXY');
		this.fkUpper.setFromEuler(e1).premultiply(chest);
		q1.setFromAxisAngle(UP, z * inward);
		this.fkUpper.multiply(q1);
		q1.setFromAxisAngle(v1.set(0, 0, 1), bend);
		this.fkFore.copy(this.fkUpper).multiply(q1);
		b[nm.upper].quaternion.copy(this.fkUpper).multiply(HANG[side]);
		b[nm.fore].quaternion.copy(this.fkFore).multiply(HANG[side]);
		this.child(nm.fore, nm.upper);
		this.child(nm.hand, nm.fore);
		b[nm.hand].quaternion.copy(b[nm.fore].quaternion);
		this.curl(side, curl, curl * 0.9);
	}

	/** Bend the fingers (relative to the hand). */
	private curl(side: Side, a: number, tip: number): void {
		const b = this.sk.bones;
		const nm = N[side];
		const z = sideSign(side);
		q1.setFromAxisAngle(FWD, z * a);
		b[nm.fingers].quaternion.copy(b[nm.hand].quaternion).multiply(q1);
		q1.setFromAxisAngle(FWD, z * tip);
		b[nm.tips].quaternion.copy(b[nm.fingers].quaternion).multiply(q1);
	}

	/** Blend the arms onto a held item. */
	private holdItem(id: HeldItem, w: number, move: number, run: number): void {
		const def = HELD[id];
		// The grip is shared with the server's hit tests (zombies/hitbox.ts).
		const g = PLAYER_GRIPS[def.hold];
		const b = this.sk.bones;
		const chest = b.chest;
		const swinging = this.action > 0 && this.actionKind === 'swing';
		const kick = this.action > 0 && this.actionKind === 'fire' ? this.action : 0;
		// Aim frame: at the shoulder line, turned to the view pitch.
		const pivot = v4.set(0, 7, 0).applyQuaternion(chest.quaternion).add(chest.position);
		const bob = move * run;
		const relax = gripRelax(g.relax, this.angles);
		ypr(q2, 0, this.aim * g.follow + relax - kick * 0.12, 0);
		const grip = gripP.set(def.at[0], def.at[1], def.at[2]);
		grip.y += gripBobY(this.phase) * bob - relax * GRIP_RELAX_DROP;
		grip.z += gripBobZ(this.phase) * bob;
		grip.x -= kick * 1.5;
		const clip = this.clip;
		const cw = clip ? smooth(0, 1, this.clipW) : 0;
		if (clip) {
			clip.gunAt(this.clipP, tip);
			grip.x += tip[3]! * cw;
			grip.y += tip[4]! * cw;
			grip.z += tip[5]! * cw;
		}
		const d = dirA.set(g.right[0], g.right[1], g.right[2]);
		const th = dirB.set(0, 1, 0);
		if (def.hold === 'one') {
			// Knife: guard in front of the body, slash across on a swing.
			th.set(0.5, 0.82, 0.3);
			if (swinging) {
				const u = 1 - this.action;
				const s = Math.sin(u * Math.PI);
				const x = smooth(0.1, 0.75, u);
				grip.x += s * 5;
				grip.y += lerp(5, -3, x) * s;
				grip.z += lerp(4, -13, x) * s;
				th.set(0.8, lerp(0.8, 0.1, x), lerp(0.4, -0.6, x));
			}
		}
		grip.applyQuaternion(q2).add(pivot);
		d.applyQuaternion(q2);
		th.applyQuaternion(q2);
		handBasis(gripQ, d, th); // grip space in model space
		if (clip) gripQ.multiply(ypr(q1, tip[2]! * cw, -tip[0]! * cw, tip[1]! * cw));
		// Right wrist: behind the fist along the fingers.
		wrist.set(-PLAYER_FIST, 0, 0).applyQuaternion(gripQ).add(grip);
		this.armIK('R', wrist, v3.set(...PLAYER_ELBOWS.R), w);
		q1.copy(gripQ).multiply(HAND_INV.R);
		const hr = b[N.R.hand];
		hr.quaternion.slerp(q1, w);
		this.curlTo('R', 1.35, 1.5, w);

		this.parts.on = false;
		this.parts.off = false;
		if (!g.left) return;
		// Left hand from the actual right grip, so it never slides on the item.
		grip.set(0, 0, 0);
		wrist.set(def.fore[0], def.fore[1], def.fore[2]);
		d.set(g.left[0], g.left[1], g.left[2]);
		if (def.hold === 'pistol') th.set(0.25, 0.95, -0.1);
		else th.set(0.72, 0.25, -0.64);
		// Socket position of the right hand.
		v1.set(PLAYER_FIST, 0, 0).applyQuaternion(gripQ).add(hr.position);
		wrist.applyQuaternion(gripQ).add(v1);
		d.applyQuaternion(gripQ);
		th.applyQuaternion(gripQ);
		handBasis(q2, d, th);
		const rest = def.hold === 'pistol' ? 1.3 : 1.1;
		const bend = clip ? this.clipHands(clip, cw, wrist, q2, rest, w) : rest;
		v1.set(-PLAYER_FIST, 0, 0).applyQuaternion(q2);
		wrist.add(v1);
		this.armIK('L', wrist, v3.set(...PLAYER_ELBOWS.L), w);
		q1.copy(q2).multiply(HAND_INV.L);
		b[N.L.hand].quaternion.slerp(q1, w);
		this.curlTo('L', bend, 1.3, w);
		if (clip) this.clipParts(clip, cw);
	}

	/**
	 * Hands of a running clip: the left fist (in and out: its rest centre `p` and
	 * turn `q`) and, for a bolt, the right arm, which leaves the gun where it is.
	 * Returns the bend of the left fingers.
	 */
	private clipHands(clip: Clip, cw: number, p: THREE.Vector3, q: THREE.Quaternion, rest: number, w: number): number {
		const b = this.sk.bones;
		const hr = b[N.R.hand];
		const f = frames;
		f.gunQ.copy(hr.quaternion).multiply(HAND_BIND.R);
		f.gunP.set(PLAYER_FIST, 0, 0).applyQuaternion(f.gunQ).add(hr.position);
		f.beltP.copy(b.pelvis.position);
		f.beltQ.copy(b.pelvis.quaternion);
		if (clip.right) {
			f.restP.copy(f.gunP);
			f.restQ.copy(f.gunQ);
			f.restCurl = 1.35;
			const bend = clip.right.at(this.clipP, f, fistP, fistQ);
			fistP.lerpVectors(f.gunP, fistP, cw);
			fistQ.slerpQuaternions(f.gunQ, fistQ, cw);
			v2.set(-PLAYER_FIST, 0, 0).applyQuaternion(fistQ).add(fistP);
			this.armIK('R', v2, v3.set(...PLAYER_ELBOWS.R), w);
			q1.copy(fistQ).multiply(HAND_INV.R);
			hr.quaternion.slerp(q1, w);
			this.curlTo('R', lerp(1.35, bend, cw), 1.5, w);
			// The gun stays: its place in the socket of the hand that moved.
			const o = this.parts;
			o.off = true;
			fistQ.copy(hr.quaternion).multiply(HAND_BIND.R);
			fistP.set(PLAYER_FIST, 0, 0).applyQuaternion(fistQ).add(hr.position);
			fistQ.invert();
			o.offP.copy(f.gunP).sub(fistP).applyQuaternion(fistQ);
			o.offQ.copy(fistQ).multiply(f.gunQ);
		}
		if (!clip.left) return rest;
		f.restP.copy(p);
		f.restQ.copy(q);
		f.restCurl = rest;
		const bend = clip.left.at(this.clipP, f, fistP, fistQ);
		if (clip.left.free > 0) this.aroundBody(fistP, clip.left.free);
		p.lerpVectors(f.restP, fistP, cw);
		q.slerpQuaternions(f.restQ, fistQ, cw);
		return lerp(rest, bend, cw);
	}

	/** Keep a travelling fist off the torso (gun pointed down), and ducked over and beside the raised left thigh. */
	private aroundBody(p: THREE.Vector3, share: number): void {
		const b = this.sk.bones;
		p.y += OVER_THIGH * this.duck * share;
		p.z -= OVER_THIGH * 0.6 * this.duck * share;
		this.around(p, b.pelvis.position, b.neck.position, BODY_CLEAR, OFF_BODY, share);
	}

	/** Push `p` out to `clear` from the segment `lo` to `hi`; a path through its middle goes past on the side `by`. */
	private around(p: THREE.Vector3, lo: THREE.Vector3, hi: THREE.Vector3, clear: number, by: THREE.Vector3, share: number): void {
		v1.copy(hi).sub(lo);
		const t = clamp(v2.copy(p).sub(lo).dot(v1) / v1.lengthSq(), 0, 1);
		v2.copy(lo).addScaledVector(v1, t);
		v1.copy(p).sub(v2);
		const d = v1.length();
		if (d >= clear) return;
		v1.addScaledVector(by, clear - d).setLength(clear).add(v2);
		p.lerp(v1, share);
	}

	/** Parts of the gun of a running clip; cut short, they are home from half of the blend on. */
	private clipParts(clip: Clip, cw: number): void {
		const o = this.parts;
		const home = this.clip !== this.wanted() && this.clipW < 0.5;
		const f = frames;
		o.on = true;
		clip.actAt(this.clipP, cw, o.actP, o.actQ);
		o.mag = home ? 'gun' : clip.magAt(this.clipP);
		if (o.mag === 'hand') {
			const hl = this.sk.bones[N.L.hand];
			fistQ.copy(hl.quaternion).multiply(HAND_BIND.L);
			o.magP.copy(clip.inHandP);
			o.magP.x += PLAYER_FIST;
			o.magP.applyQuaternion(fistQ).add(hl.position);
			o.magQ.copy(fistQ).multiply(clip.inHandQ);
		} else {
			o.magP.copy(f.gunP);
			o.magQ.copy(f.gunQ);
		}
		const fall = home ? -1 : clip.fallen(this.clipP, this.reloadMs);
		o.fallP.copy(f.gunP);
		o.fallQ.copy(f.gunQ);
		o.fallP.y -= (FALL / 2) * fall * fall;
		o.falling = fall >= 0 && o.fallP.y > 4;
	}

	private curlTo(side: Side, a: number, tip: number, w: number): void {
		this.curl(side, a * w + 0.4 * (1 - w), tip * w + 0.4 * (1 - w));
	}

	/** Two-bone arm IK blended over the current arm pose by `w`. */
	private armIK(side: Side, target: THREE.Vector3, pole: THREE.Vector3, w: number): void {
		const b = this.sk.bones;
		const nm = N[side];
		const sPos = b[nm.upper].position;
		ikT.copy(target).sub(sPos);
		let len = ikT.length();
		const max = (UPPER_ARM + FOREARM) * 0.995;
		if (len > max) len = max;
		len = Math.max(len, 4);
		ikT.normalize();
		pole.addScaledVector(ikT, -pole.dot(ikT)).normalize();
		const cosA = clamp((UPPER_ARM * UPPER_ARM + len * len - FOREARM * FOREARM) / (2 * UPPER_ARM * len), -1, 1);
		const sinA = Math.sqrt(1 - cosA * cosA);
		ikU.copy(ikT).multiplyScalar(cosA).addScaledVector(pole, sinA);
		ikE.copy(sPos).addScaledVector(ikU, UPPER_ARM);
		ikF.copy(sPos).addScaledVector(ikT, len).sub(ikE).normalize();
		// The elbow bends towards −pole: the arm's "forward" is away from the elbow.
		pole.negate();
		b[nm.upper].quaternion.slerp(basis(q1, ikU, pole).multiply(ARM_INV[side]), w);
		b[nm.fore].quaternion.slerp(basis(q1, ikF, pole).multiply(ARM_INV[side]), w);
		this.child(nm.fore, nm.upper);
		this.child(nm.hand, nm.fore);
	}

	private finishArm(side: Side): void {
		const b = this.sk.bones;
		const nm = N[side];
		b[nm.upperH].position.copy(b[nm.upper].position);
		b[nm.upperH].quaternion.slerpQuaternions(b[nm.clav].quaternion, b[nm.upper].quaternion, 0.5);
		b[nm.foreH].position.copy(b[nm.fore].position);
		b[nm.foreH].quaternion.slerpQuaternions(b[nm.upper].quaternion, b[nm.fore].quaternion, 0.5);
		this.child(nm.fingers, nm.hand);
		this.child(nm.tips, nm.fingers);
	}
}

