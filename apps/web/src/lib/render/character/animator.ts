/**
 * Procedural character animation (docs/characters.md). Writes the flat
 * skeleton every frame from a motion state: leg IK with a distance-driven gait
 * (planted feet move exactly with the ground), crouch, air, landing, surf
 * stance, aim pitch and held items. No allocations per frame.
 */
import * as THREE from 'three';
import { HELD, type HeldItem } from './held.js';
import { ANKLE_Y, ARM_TILT, armDir, BALL, BIND, FOREARM, HIP_Y, sideSign, THIGH, UPPER_ARM, type BoneName, type CharacterSkeleton, type Side } from './skeleton.js';

export type Posture = 'normal' | 'infected' | 'zombie';

export interface MotionState {
	/** Velocity in Source axes (u/s). */
	vx: number;
	vy: number;
	vz: number;
	/** Source view angles in degrees (pitch + = down). */
	yaw: number;
	pitch: number;
	onGround: boolean;
	ducked: boolean;
	/** Unit normal of the ramp being surfed (Source axes), or null. */
	ramp: { x: number; y: number; z: number } | null;
}

export function emptyMotion(): MotionState {
	return { vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, ducked: false, ramp: null };
}

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const V = THREE.Vector3;
const Q = THREE.Quaternion;

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
	const t = clamp((x - a) / (b - a), 0, 1);
	return t * t * (3 - 2 * t);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// Gait --------------------------------------------------------------------

export interface GaitShape {
	/** Share of the cycle a foot is planted. */
	duty: number;
	/** Distance a planted foot covers relative to the body. */
	stride: number;
	/** Swing height. */
	lift: number;
}

/** Gait for a ground speed (u/s); `duck` 0..1 shortens the steps. */
export function gaitShape(speed: number, duck: number, out: GaitShape = { duty: 0, stride: 0, lift: 0 }): GaitShape {
	const r = clamp(speed / 250, 0, 1);
	out.duty = lerp(lerp(0.62, 0.32, smooth(0.15, 1, r)), 0.55, duck * 0.8);
	out.stride = lerp(lerp(13, 30, smooth(0, 1, r)), lerp(12, 24, r), duck);
	out.lift = lerp(lerp(2.5, 8.5, r), 4.5, duck);
	return out;
}

/** Distance the body travels in one full cycle: planted feet then cancel the body's motion exactly. */
export function cycleDistance(g: GaitShape): number {
	return g.stride / g.duty;
}

/** Offset of a foot along the direction of travel at `phase` (0..1). */
export function footOffset(g: GaitShape, phase: number): number {
	if (phase < g.duty) return g.stride * (0.5 - phase / g.duty);
	const w = (phase - g.duty) / (1 - g.duty);
	// Cubic swing that leaves and meets the ground at part of the ground speed (no skid on contact).
	const m = (-0.5 * (1 - g.duty)) / g.duty;
	return g.stride * (w * w * (3 - 2 * w) - 0.5 + m * (w * (w - 1) * (w - 1) + w * w * (w - 1)));
}

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

interface FootTarget {
	ankle: THREE.Vector3;
	yaw: number;
	pitch: number;
	/** 0: the toe stays flat on the ground, 1: it follows the foot. */
	toe: number;
}

export class CharacterAnimator {
	posture: Posture = 'normal';
	held: HeldItem | null = null;
	/** AI zombie winding up an attack: leans in, arms high. */
	lunging = false;
	/** Claw hands ready (infected). */
	claws = false;
	/** Model-space height of the crown after the last update. */
	headTop = 72;

	// Blends
	private duck = 0;
	private ground = 1;
	private move = 0;
	private surf = 0;
	private hold = 0;
	private shownHeld: HeldItem | null = null;
	private speed = 0;
	private phase = 0;
	/** Direction of travel in the facing frame (f, r), smoothed. */
	private dirF = 1;
	private dirR = 0;
	/** Lower body yaw relative to the facing (left +). */
	private hip = 0;
	private turning = false;
	private turnLift = 0;
	private back = false;
	private lastYaw = NaN;
	private time = Math.random() * 20;
	private airTime = 0;
	private lead: 1 | -1 = 1;
	private lastVz = 0;
	private land = 0;
	private landV = 0;
	private vzS = 0;
	private accF = 0;
	private accR = 0;
	private lastF = 0;
	private lastR = 0;
	private aim = 0;
	private rampN = new V(0, 1, 0);
	private rampDrop = 0;
	private lunge = 0;
	private action = 0;
	private actionKind: 'fire' | 'swing' = 'fire';
	private readonly gait: GaitShape = { duty: 0.5, stride: 10, lift: 2 };
	private readonly feet: Record<Side, FootTarget> = {
		L: { ankle: new V(), yaw: 0, pitch: 0, toe: 0 },
		R: { ankle: new V(), yaw: 0, pitch: 0, toe: 0 }
	};
	private readonly rampQ = new Q();
	private readonly fkUpper = new Q();
	private readonly fkFore = new Q();

	constructor(private readonly sk: CharacterSkeleton) {}

	/** Snap every blend (spawn, teleport). */
	reset(): void {
		this.lastYaw = NaN;
		this.hip = 0;
		this.land = this.landV = 0;
		this.accF = this.accR = 0;
	}

	/** Recoil or knife / claw swing. */
	act(kind: 'fire' | 'swing'): void {
		this.action = 1;
		this.actionKind = kind;
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
		const f = cy * s.vx + sy * s.vy;
		const r = sy * s.vx - cy * s.vy;
		const speed = Math.hypot(f, r);
		const first = Number.isNaN(this.lastYaw);
		const dYaw = first ? 0 : wrap(yaw - this.lastYaw);
		this.lastYaw = yaw;
		const ramp = !s.onGround ? s.ramp : null;

		if (s.onGround) {
			if (this.airTime > 0.06) {
				// Landing: dip with the fall speed.
				this.landV -= clamp(-this.lastVz / 420, 0, 1.3) * 60;
			}
			this.airTime = 0;
		} else {
			if (this.airTime === 0) this.lead = this.lead > 0 ? -1 : 1;
			this.airTime += dt;
			this.lastVz = s.vz;
		}
		if (first) {
			this.duck = s.ducked ? 1 : 0;
			this.ground = s.onGround ? 1 : 0;
			this.speed = speed;
			this.aim = s.pitch * DEG;
			this.airTime = 0;
			this.lastF = f;
			this.lastR = r;
			this.surf = ramp ? 1 : 0;
		}
		this.duck += ((s.ducked ? 1 : 0) - this.duck) * k(13);
		// Short hops over steps keep the ground pose.
		this.ground += ((s.onGround || this.airTime < 0.05 ? 1 : 0) - this.ground) * k(s.onGround ? 18 : 11);
		this.surf += ((ramp ? 1 : 0) - this.surf) * k(ramp ? 9 : 5);
		this.speed += (speed - this.speed) * k(14);
		this.move += (smooth(12, 70, speed) - this.move) * k(12);
		this.vzS += (s.vz - this.vzS) * k(10);
		this.aim += (clamp(s.pitch, -80, 80) * DEG - this.aim) * k(22);
		if (dt > 0) {
			this.accF += (clamp((f - this.lastF) / dt, -2500, 2500) - this.accF) * k(6);
			this.accR += (clamp((r - this.lastR) / dt, -2500, 2500) - this.accR) * k(6);
		}
		this.lastF = f;
		this.lastR = r;
		if (speed > 8) {
			// Turn towards the new direction of travel (at once from a standstill).
			const now = Math.atan2(r, f);
			let was = Math.atan2(this.dirR, this.dirF);
			if (this.move >= 0.1 && Math.abs(wrap(now - was)) > 1.75) {
				// Reversal: mirror the stride in time instead of swinging the feet around.
				was += Math.PI;
				this.phase = (this.gait.duty - this.phase + 1) % 1;
			}
			const a = this.move < 0.1 ? now : was + wrap(now - was) * k(16);
			this.dirF = Math.cos(a);
			this.dirR = Math.sin(a);
		}
		// Landing spring.
		this.landV += (-this.land * 260 - this.landV * 22) * dt;
		this.land = clamp(this.land + this.landV * dt, -7, 1.5);
		// Held item changes dip through the unarmed pose.
		if (this.held !== this.shownHeld) {
			this.hold += (0 - this.hold) * k(26);
			if (this.hold < 0.06 || !this.shownHeld) this.shownHeld = this.held;
		} else this.hold += ((this.held ? 1 : 0) - this.hold) * k(14);
		this.lunge += ((this.lunging ? 1 : 0) - this.lunge) * k(16);
		this.action = Math.max(0, this.action - dt / (this.actionKind === 'swing' ? 0.34 : 0.14));

		const duck = this.duck;
		const g = this.ground;
		const air = 1 - g;
		const surf = this.surf;
		const move = this.move * g;
		const run = clamp(this.speed / 250, 0, 1);

		// ---- Hips -----------------------------------------------------------------
		let hipTarget: number;
		if (this.move > 0.15 && g > 0.3) {
			const c = this.dirF;
			this.back = this.back ? c < 0.1 : c < -0.25;
			const a = Math.atan2(this.back ? -this.dirR : this.dirR, this.back ? -this.dirF : this.dirF);
			hipTarget = -clamp(a, -1.25, 1.25);
			this.hip += (hipTarget - this.hip) * k(11);
			this.turning = false;
			this.turnLift += (0 - this.turnLift) * k(10);
		} else if (g > 0.5) {
			// Standing: the feet stay where they are until the turn is too far, then step around.
			this.hip = clamp(this.hip - dYaw, -1.1, 1.1);
			if (Math.abs(this.hip) > 0.75) this.turning = true;
			if (this.turning) {
				this.hip += (0 - this.hip) * k(9);
				if (Math.abs(this.hip) < 0.06) this.turning = false;
			}
			this.turnLift += ((this.turning ? Math.min(1, Math.abs(this.hip) * 1.6) : 0) - this.turnLift) * k(14);
		} else {
			this.hip += ((ramp ? -0.75 * Math.sign(this.rampN.z || 1) : 0) - this.hip) * k(8);
			this.turnLift = 0;
		}
		const hip = this.hip;
		const ch = Math.cos(hip);
		const sh = Math.sin(hip);
		// Travel direction in the hip frame.
		const hx = this.dirF * ch - this.dirR * sh;
		const hz = this.dirF * sh + this.dirR * ch;

		// ---- Gait phase ------------------------------------------------------------
		const gait = gaitShape(this.speed, duck, this.gait);
		if (this.posture !== 'normal') gait.stride *= 0.82; // shorter shamble, hips stay up: the head keeps to its hitbox
		const dist = cycleDistance(gait);
		if (g > 0.2) this.phase = (this.phase + (speed * dt) / dist) % 1;
		const phL = this.phase;
		const phR = (this.phase + 0.5) % 1;
		// Lowest in mid-stance.
		const step = Math.cos((phL - gait.duty / 2) * TAU * 2);
		const swing = Math.cos(phL * TAU); // +1: left foot forward

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
		const hunch = posture === 'normal' ? 0 : 0.25;
		const crouch = duck * (1 - surf * 0.5);
		const breath = Math.sin(t * 1.7);
		const idle = (1 - move) * g;
		let py = HIP_Y + 1 - 0.4 * g;
		py -= move * (1.4 + 2.6 * run) * (1 - crouch * 0.7) * (posture === 'normal' ? 1 : 0.3);
		py -= move * run * Math.abs(hz) * 2.4 * (1 - crouch);
		py -= move * step * 1.25 * run * (1 - crouch * 0.6);
		py -= crouch * lerp(16, 14.8, move) * lerp(1, 0.94, air);
		py += idle * breath * 0.18;
		py += this.land * g * (1 - crouch * 0.6);
		py -= air * (1 - surf) * (1.5 - clamp(this.vzS / 300, -1, 1) * 1.2);
		py += surf * (this.rampDrop * 0.55 - 7);
		const leanAmt = move * (0.05 + 0.13 * run) * (1 - crouch * 0.4) * (posture === 'normal' ? 1 : 0.35);
		const accLean = 0.00012 * g;
		let leanF = this.dirF * leanAmt + clamp(this.accF * accLean, -0.14, 0.16) + hunch * 0.4;
		let leanR = this.dirR * leanAmt * 0.8 + clamp(this.accR * accLean, -0.14, 0.14);
		leanF *= 1 - surf;
		leanR *= 1 - surf;
		// In the air the body trails the sideways acceleration a little (strafing).
		const strafe = clamp(this.accR / 2600, -1, 1) * air * (1 - surf);
		const airPitch = air * (1 - surf) * clamp(this.vzS / 900, -0.12, 0.14);

		const pelvis = this.sk.bones.pelvis;
		const sway = move * run * Math.sin((phL - gait.duty / 2) * TAU) * 0.7 + idle * Math.sin(t * 0.55) * 0.35;
		const px = -crouch * 2.2 * (1 - move * 0.5) - hunch * 4;
		pelvis.position.set(px * ch + sway * sh, py, -px * sh + sway * ch);
		const twist = swing * 0.13 * move * run;
		ypr(
			pelvis.quaternion,
			hip - twist * Math.sign(hx || 1),
			leanF * 0.55 + crouch * lerp(0.28, 0.34, move) + airPitch + surf * 0.16 + hunch * 0.25,
			leanR * 0.6 + move * run * Math.sin((phL - gait.duty / 2) * TAU) * 0.05 + strafe * 0.12
		);
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
		const aim = this.aim;
		const armed = this.hold;
		const aimTorso = aim * lerp(0.22, 0.42, armed) * (1 - surf * 0.4);
		const cp = leanF + crouch * lerp(0.5, 0.56, move) + aimTorso * 0.85 + airPitch * 0.5 + hunch * 0.95 + surf * 0.3 + this.lunge * 0.25 + idle * breath * 0.012;
		const zsway = posture === 'zombie' ? Math.sin(t * 6) * 0.06 : 0;
		const cr = leanR + strafe * 0.22 + zsway;
		const cyaw = twist * 1.1 * Math.sign(hx || 1) - armed * (this.shownHeld && HELD[this.shownHeld].hold === 'long' ? 0.16 : 0) + hip * surf * 0.4;
		const chest = this.sk.bones.chest;
		ypr(chest.quaternion, cyaw, cp, cr);
		if (surf > 0.01) {
			q1.identity().slerp(this.rampQ, surf * 0.5);
			chest.quaternion.premultiply(q1);
		}
		this.child('spine', 'pelvis');
		this.sk.bones.spine.quaternion.slerpQuaternions(pelvis.quaternion, chest.quaternion, 0.5);
		this.child('chest', 'spine');
		// The head looks where the player aims, kept level over a leaning torso.
		const head = this.sk.bones.head;
		const headPitch = clamp(aim * 0.95, -1.1, 1.05) * (posture === 'normal' ? 1 : 0.6) + (posture === 'zombie' ? 0.1 : 0);
		const tilt = posture === 'zombie' ? 0.16 + Math.sin(t * 2.1) * 0.05 : 0;
		ypr(head.quaternion, 0, headPitch + cp * 0.12, cr * 0.4 + tilt);
		const neck = this.sk.bones.neck;
		this.child('neck', 'chest');
		neck.quaternion.slerpQuaternions(chest.quaternion, head.quaternion, 0.5);
		this.child('head', 'neck');
		this.headTop = head.position.y + 11;

		// ---- Legs ---------------------------------------------------------------------------
		for (const side of SIDES) this.placeFoot(side, side === 'L' ? phL : phR, hx, hz, gait, move, crouch, air, surf, run);
		for (const side of SIDES) this.solveLeg(side);

		// ---- Arms ---------------------------------------------------------------------------
		for (const side of SIDES) this.poseArm(side, swing, move, run, idle, crouch, air, surf, strafe);
		if (this.hold > 0.01 && this.shownHeld) this.holdItem(this.shownHeld, this.hold, move, run);
		for (const side of SIDES) this.finishArm(side);
	}

	/** Item to draw this frame (swaps at the bottom of the change). */
	get drawnHeld(): HeldItem | null {
		return this.shownHeld;
	}

	/** Position a child bone rigidly on its parent. */
	private child(c: BoneName, p: BoneName): void {
		const b = this.sk.bones;
		b[c].position.copy(bindV[c]).sub(bindV[p]).applyQuaternion(b[p].quaternion).add(b[p].position);
	}

	private placeFoot(side: Side, ph: number, hx: number, hz: number, gait: GaitShape, move: number, crouch: number, air: number, surf: number, run: number): void {
		const z = sideSign(side);
		const ft = this.feet[side];
		const hip = this.hip;

		// Ground: ball-of-foot target in the hip frame.
		const along = footOffset(gait, ph);
		const planted = ph < gait.duty;
		const w = planted ? 0 : (ph - gait.duty) / (1 - gait.duty);
		const u = planted ? ph / gait.duty : 1;
		let lift = planted ? 0 : Math.sin(Math.PI * Math.pow(w, 0.8)) * gait.lift;
		// Heel-off, kick, toes up before contact.
		const off = 0.75 * lerp(0.45, 1, run);
		let fp = planted ? -off * smooth(0.45, 1, u) + 0.2 * run * (1 - smooth(0, 0.16, u)) : lerp(-off * 1.2 * (1 - smooth(0.25, 0.75, w)), 0.2 * run, smooth(0.6, 1, w));
		fp *= lerp(1, 0.55, crouch);
		const fwd = hx >= 0 ? 1 : 0.45;
		fp *= lerp(0.4, 1, Math.abs(hx)) * fwd;
		const track = lerp(1, 0.62, run * Math.abs(hx)); // feet land closer to the midline when running
		const stanceX = side === 'L' ? lerp(1.2, 5.5, crouch) : lerp(-1.0, -5.5, crouch);
		const turn = this.turnLift * (Math.sin(this.time * 14 + (z > 0 ? Math.PI : 0)) > 0 ? 1 : 0);
		const bx = stanceX * (1 - move) + along * hx * move + BALL[0] - 0.6;
		const bz = z * (4.3 + (1 - move) * lerp(0.9, 1.5, crouch)) * lerp(1, track, move) + along * hz * move;
		lift = lift * move + turn * 2.6;
		// Crouched and still: the back foot rests on its ball.
		const crouchHeel = side === 'R' ? -0.75 : -0.12;
		let pitch = fp * move + crouchHeel * crouch * (1 - move);
		let toe = planted ? 0 : smooth(0, 0.3, w) * (1 - smooth(0.7, 1, w));
		const toeOut = z * -0.13 * lerp(1, 0.35, move);
		this.ankleFromBall(ft.ankle, bx, lift, bz, pitch, toeOut);
		let yaw = toeOut;

		// Air: relative to the pelvis.
		if (air > 0.01) {
			const lead = z === this.lead ? 1 : 0;
			const up = clamp(this.vzS / 260, -1, 1) * 0.5 + 0.5; // 1 rising, 0 falling
			const hipY = this.sk.bones.pelvis.position.y - 1;
			const tuck = Math.max(crouch, 0);
			const ax1 = lerp(lead ? 3.2 : -2.2, lead ? 5.5 : -7, up);
			const drop = lerp(lead ? 27.5 : 29, lead ? 22.5 : 26, up) - tuck * 9;
			const ap = lerp(lead ? -0.3 : -0.5, lead ? -0.2 : -0.95, up);
			v1.set(ax1 + Math.sin(this.time * 5 + z) * 0.6, Math.max(ANKLE_Y - 0.5, hipY - drop), z * 4.6);
			ft.ankle.lerp(v1, air);
			pitch = lerp(pitch, ap, air);
			toe = lerp(toe, 1, air);
			yaw = lerp(yaw, 0, air);
		}

		// Out of the hip frame.
		const x = ft.ankle.x;
		const zz = ft.ankle.z;
		const c = Math.cos(hip);
		const s = Math.sin(hip);
		ft.ankle.x = x * c + zz * s;
		ft.ankle.z = -x * s + zz * c;
		ft.yaw = yaw + hip;
		ft.pitch = pitch;
		ft.toe = toe;

		// Surf: feet apart along the board line, on the ramp plane.
		if (surf > 0.01) {
			const front = (side === 'L') === this.rampN.z < 0 ? 1 : -1;
			const n = this.rampN;
			const sx = front * 9.5;
			const sz = -n.z * 7 + z * 1.2;
			const y = clamp(this.rampDrop - (n.x * sx + n.z * sz) / Math.max(0.35, n.y), -15, 14);
			v1.set(sx, y + ANKLE_Y * n.y + 0.4, sz);
			ft.ankle.lerp(v1, surf);
			ft.yaw = lerp(ft.yaw, hip * 1.15, surf);
			ft.pitch = lerp(ft.pitch, 0, surf);
			ft.toe = lerp(ft.toe, 1, surf);
		}
	}

	/** Ankle of a foot whose ball is at (x, y, z) with a given pitch and yaw. */
	private ankleFromBall(out: THREE.Vector3, x: number, y: number, z: number, pitch: number, yaw: number): void {
		ypr(q1, yaw, -pitch, 0);
		v2.set(BALL[0], BALL[1], BALL[2]).applyQuaternion(q1);
		const ballY = ANKLE_Y + BALL[1];
		out.set(x - v2.x, y + ballY - v2.y, z - v2.z);
	}

	private solveLeg(side: Side): void {
		const b = this.sk.bones;
		const nm = N[side];
		const ft = this.feet[side];
		const z = sideSign(side);
		this.child(nm.thigh, 'pelvis');
		const hipP = b[nm.thigh].position;
		const A = ft.ankle;
		// Knee direction: where the foot points, slightly outwards, tipped with the pelvis.
		v1.set(Math.cos(ft.yaw), 0.15, -Math.sin(ft.yaw));
		const splay = z * lerp(0.1, 0.28, this.duck);
		v1.x += Math.sin(ft.yaw) * splay;
		v1.z += Math.cos(ft.yaw) * splay;
		v2.copy(A).sub(hipP);
		let len = v2.length();
		const max = (THIGH + SHIN_LEN) * 0.996;
		if (len > max) {
			v2.multiplyScalar(max / len);
			len = max;
			A.copy(hipP).add(v2);
		}
		len = Math.max(len, 7);
		v2.normalize();
		v1.addScaledVector(v2, -v1.dot(v2)).normalize();
		const cosA = clamp((THIGH * THIGH + len * len - SHIN_LEN * SHIN_LEN) / (2 * THIGH * len), -1, 1);
		const sinA = Math.sqrt(1 - cosA * cosA);
		// Thigh direction.
		v3.copy(v2).multiplyScalar(cosA).addScaledVector(v1, sinA);
		const knee = b[nm.shin].position.copy(hipP).addScaledVector(v3, THIGH);
		b[nm.thigh].quaternion.copy(basis(q1, v3, v1)).multiply(THIGH_INV);
		v4.copy(A).sub(knee).normalize();
		b[nm.shin].quaternion.copy(basis(q1, v4, v1)).multiply(SHIN_INV);
		b[nm.thighH].position.copy(hipP);
		b[nm.thighH].quaternion.slerpQuaternions(b.pelvis.quaternion, b[nm.thigh].quaternion, 0.5);
		b[nm.shinH].position.copy(knee);
		b[nm.shinH].quaternion.slerpQuaternions(b[nm.thigh].quaternion, b[nm.shin].quaternion, 0.5);
		// Foot and toe.
		const foot = b[nm.foot];
		foot.position.copy(knee).addScaledVector(v4, SHIN_LEN);
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
	private poseArm(side: Side, swing: number, move: number, run: number, idle: number, crouch: number, air: number, surf: number, strafe: number): void {
		const b = this.sk.bones;
		const nm = N[side];
		const z = sideSign(side);
		const chest = b.chest.quaternion;
		// Opposite to the leg of the same side.
		const sw = swing * z * Math.sign(this.dirF >= -0.2 ? 1 : -1);
		const breath = Math.sin(this.time * 1.7 + 0.6);
		let fwd = idle * (0.04 + breath * 0.015) + move * (sw * lerp(0.35, 0.78, run) + 0.02) + crouch * 0.3;
		let out = 0.13 + move * 0.06 + breath * idle * 0.012;
		let bend = idle * 0.3 + move * (lerp(0.45, 1.45, run) + sw * 0.28 * run) + crouch * 0.5 * (1 - move);
		let inward = 0.15 + move * 0.4 * run + Math.max(0, sw) * 0.2 * run;
		let curl = lerp(0.45, 1.1, move * run);
		if (air > 0.01) {
			const a = air * (1 - surf);
			const up = clamp(this.vzS / 260, -1, 1) * 0.5 + 0.5;
			fwd = lerp(fwd, (z === this.lead ? -0.3 : 0.42) * lerp(0.6, 1, up), a);
			out = lerp(out, lerp(0.75, 0.4, up) + strafe * z * 0.35, a);
			bend = lerp(bend, lerp(0.8, 1.2, up), a);
			inward = lerp(inward, 0.25, a);
			curl = lerp(curl, 0.35, a);
		}
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
			fwd = 1.42 + this.lunge * 0.5 + a + sw * move * 0.16 + this.aim * 0.1;
			out = 0.02 + Math.sin(this.time * 2.3 + z) * 0.04;
			bend = 0.28 + a;
			inward = 0.1;
			curl = 0.75;
		} else if (this.posture === 'infected' && (this.claws || this.hold < 0.5)) {
			fwd = lerp(0.62, fwd * 0.5 + 0.35, move * 0.5) + Math.sin(this.time * 2.4 + z) * 0.04;
			out = 0.5 + crouch * 0.05;
			bend = 1.15 - sw * move * 0.15;
			inward = 0.5;
			curl = 0.75;
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
		ypr(q1, z * clamp(fwd, -0.6, 1.3) * 0.12, 0, z * -clamp(out - 0.3, 0, 1.2) * 0.22);
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
		const b = this.sk.bones;
		const chest = b.chest;
		const swinging = this.action > 0 && this.actionKind === 'swing';
		const kick = this.action > 0 && this.actionKind === 'fire' ? this.action : 0;
		// Aim frame: at the shoulder line, turned to the view pitch.
		const pivot = v4.set(0, 7, 0).applyQuaternion(chest.quaternion).add(chest.position);
		const bob = move * run;
		const ph = this.phase * TAU * 2;
		const relax = bob * (def.hold === 'one' ? 0.1 : 0.12);
		ypr(q2, 0, this.aim * (def.hold === 'one' ? 0.75 : 0.95) + relax - kick * 0.12, 0);
		const grip = gripP.set(def.at[0], def.at[1], def.at[2]);
		grip.y += Math.sin(ph) * 0.45 * bob - relax * 6;
		grip.z += Math.cos(ph / 2) * 0.5 * bob;
		grip.x -= kick * 1.5;
		const d = dirA.set(1, 0, 0);
		const th = dirB.set(0, 1, 0);
		if (def.hold === 'one') {
			// Knife: guard in front of the body, slash across on a swing.
			d.set(0.86, -0.12, -0.5);
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
		// Right wrist: 3 behind the fist along the fingers.
		wrist.set(-3, 0, 0).applyQuaternion(gripQ).add(grip);
		this.armIK('R', wrist, v3.set(-0.35, -1, 0.75), w);
		q1.copy(gripQ).multiply(HAND_INV.R);
		const hr = b[N.R.hand];
		hr.quaternion.slerp(q1, w);
		this.curlTo('R', 1.35, 1.5, w);

		if (def.hold === 'one') return;
		// Left hand from the actual right grip, so it never slides on the item.
		grip.set(0, 0, 0);
		wrist.set(def.fore[0], def.fore[1], def.fore[2]);
		if (def.hold === 'pistol') {
			d.set(0.82, 0.1, 0.56);
			th.set(0.25, 0.95, -0.1);
		} else {
			d.set(0.62, 0.3, 0.72);
			th.set(0.72, 0.25, -0.64);
		}
		// Socket position of the right hand.
		v1.set(3, 0, 0).applyQuaternion(gripQ).add(hr.position);
		wrist.applyQuaternion(gripQ).add(v1);
		d.applyQuaternion(gripQ);
		th.applyQuaternion(gripQ);
		handBasis(q2, d, th);
		v1.set(-3, 0, 0).applyQuaternion(q2);
		wrist.add(v1);
		this.armIK('L', wrist, v3.set(-0.2, -1, -0.55), w);
		q1.copy(q2).multiply(HAND_INV.L);
		b[N.L.hand].quaternion.slerp(q1, w);
		this.curlTo('L', def.hold === 'pistol' ? 1.3 : 1.1, 1.3, w);
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

