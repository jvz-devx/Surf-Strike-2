/**
 * How a character moves (docs/characters.md): the numbers behind the drawn
 * body, without a renderer. The web animator (render/character/animator.ts)
 * draws from these functions and the server poses its hit capsules from the
 * same ones (modes/zombies/hitbox.ts), so a running, jumping or ducking player
 * is hit where the body is drawn.
 *
 * Model space: x forward, y up, z to the right, feet at the origin. Yaw turns
 * left, pitch forward (down), roll right. Nothing here allocates.
 */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
	const t = clamp((x - a) / (b - a), 0, 1);
	return t * t * (3 - 2 * t);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export type BodyPosture = 'normal' | 'infected' | 'zombie';

// Joints --------------------------------------------------------------------

/** Heights of the leg joints in the bind pose. */
export const BODY_HIP_Y = 36;
export const BODY_KNEE_Y = 19.8;
export const BODY_ANKLE_Y = 3.8;
/** The ankle is this far behind the knee in the bind pose. */
export const BODY_ANKLE_X = -0.6;
export const BODY_THIGH = BODY_HIP_Y - BODY_KNEE_Y;
/** Knee to ankle. */
export const BODY_SHIN = Math.hypot(BODY_ANKLE_X, BODY_KNEE_Y - BODY_ANKLE_Y);
/** Ball of the foot relative to the ankle. */
export const BODY_BALL: readonly [number, number, number] = [5, -2.9, 0];
/** Hip joint beside the middle of the body. */
export const BODY_HIP_Z = 4.3;

// Gait ----------------------------------------------------------------------

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

/** Gait of a posture: a hunched body takes shorter, shambling steps and its hips stay up, so the head keeps to its hitbox. */
export function bodyGait(speed: number, duck: number, posture: BodyPosture, out: GaitShape): GaitShape {
	gaitShape(speed, duck, out);
	if (posture !== 'normal') out.stride *= 0.82;
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

// Blends --------------------------------------------------------------------

/** What a character does (Source axes and angles). */
export interface BodyInput {
	vx: number;
	vy: number;
	vz: number;
	/** Degrees; pitch + = down. */
	yaw: number;
	pitch: number;
	onGround: boolean;
	ducked: boolean;
}

/** Eased state of a body. */
export interface BodyBlend {
	duck: number;
	ground: number;
	move: number;
	speed: number;
	/** Direction of travel in the facing frame (forward, right). */
	dirF: number;
	dirR: number;
	/** Lower body yaw relative to the facing (left +). */
	hip: number;
	turning: boolean;
	turnLift: number;
	back: boolean;
	lastYaw: number;
	airTime: number;
	/** Side of the leg in front in the air. */
	lead: 1 | -1;
	lastVz: number;
	land: number;
	landV: number;
	vzS: number;
	accF: number;
	accR: number;
	lastF: number;
	lastR: number;
	aim: number;
}

export function newBodyBlend(): BodyBlend {
	return {
		duck: 0,
		ground: 1,
		move: 0,
		speed: 0,
		dirF: 1,
		dirR: 0,
		hip: 0,
		turning: false,
		turnLift: 0,
		back: false,
		lastYaw: NaN,
		airTime: 0,
		lead: 1,
		lastVz: 0,
		land: 0,
		landV: 0,
		vzS: 0,
		accF: 0,
		accR: 0,
		lastF: 0,
		lastR: 0,
		aim: 0
	};
}

/** Snap what does not follow the input (spawn, teleport); the next step takes over the rest. */
export function resetBody(b: BodyBlend): void {
	b.lastYaw = NaN;
	b.hip = 0;
	b.land = b.landV = 0;
	b.accF = b.accR = 0;
}

/** Share of the way an ease of `rate` goes in `dt` seconds. */
const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** How far (radians) the feet of a standing character stay behind its turning body before they step around. */
export const BODY_TURN_MAX = 0.75;
/** The feet drift this far forward and back in the air. */
export const BODY_AIR_DRIFT = 0.6;
/** Furthest the feet trail while they step around. */
const TURN_CLAMP = 1.1;
/** Ease rates of the hips: on the move, and in the air. */
export const BODY_HIP_EASE = Object.freeze({ move: 11, air: 8 });

/**
 * Advance the eased state by `dt` seconds. `airHip`: where the hips turn in
 * the air (the surf stance). Returns true when the direction of travel
 * reversed and the stride mirrors in time.
 */
export function stepBody(b: BodyBlend, dt: number, s: BodyInput, airHip = 0): boolean {
	const yaw = s.yaw * DEG;
	const cy = Math.cos(yaw);
	const sy = Math.sin(yaw);
	const f = cy * s.vx + sy * s.vy;
	const r = sy * s.vx - cy * s.vy;
	const speed = Math.hypot(f, r);
	const first = Number.isNaN(b.lastYaw);
	const dYaw = first ? 0 : wrap(yaw - b.lastYaw);
	b.lastYaw = yaw;

	if (s.onGround) {
		if (b.airTime > 0.06) {
			// Landing: dip with the fall speed.
			b.landV -= clamp(-b.lastVz / 420, 0, 1.3) * 60;
		}
		b.airTime = 0;
	} else {
		if (b.airTime === 0) b.lead = b.lead > 0 ? -1 : 1;
		b.airTime += dt;
		b.lastVz = s.vz;
	}
	if (first) {
		b.duck = s.ducked ? 1 : 0;
		b.ground = s.onGround ? 1 : 0;
		b.speed = speed;
		b.aim = s.pitch * DEG;
		b.airTime = 0;
		b.lastF = f;
		b.lastR = r;
	}
	b.duck += ((s.ducked ? 1 : 0) - b.duck) * ease(13, dt);
	// Short hops over steps keep the ground pose.
	b.ground += ((s.onGround || b.airTime < 0.05 ? 1 : 0) - b.ground) * ease(s.onGround ? 18 : 11, dt);
	b.speed += (speed - b.speed) * ease(14, dt);
	b.move += (smooth(12, 70, speed) - b.move) * ease(12, dt);
	b.vzS += (s.vz - b.vzS) * ease(10, dt);
	b.aim += (clamp(s.pitch, -80, 80) * DEG - b.aim) * ease(22, dt);
	if (dt > 0) {
		b.accF += (clamp((f - b.lastF) / dt, -2500, 2500) - b.accF) * ease(6, dt);
		b.accR += (clamp((r - b.lastR) / dt, -2500, 2500) - b.accR) * ease(6, dt);
	}
	b.lastF = f;
	b.lastR = r;
	let reversed = false;
	if (speed > 8) {
		// Turn towards the new direction of travel (at once from a standstill).
		const now = Math.atan2(r, f);
		let was = Math.atan2(b.dirR, b.dirF);
		if (b.move >= 0.1 && Math.abs(wrap(now - was)) > 1.75) {
			// Reversal: mirror the stride in time instead of swinging the feet around.
			was += Math.PI;
			reversed = true;
		}
		const a = b.move < 0.1 ? now : was + wrap(now - was) * ease(16, dt);
		b.dirF = Math.cos(a);
		b.dirR = Math.sin(a);
	}
	// Landing spring.
	b.landV += (-b.land * 260 - b.landV * 22) * dt;
	b.land = clamp(b.land + b.landV * dt, -7, 1.5);

	// Hips.
	if (bodyWalks(b)) {
		const c = b.dirF;
		b.back = b.back ? c < 0.1 : c < -0.25;
		const a = Math.atan2(b.back ? -b.dirR : b.dirR, b.back ? -b.dirF : b.dirF);
		b.hip += (-clamp(a, -1.25, 1.25) - b.hip) * ease(BODY_HIP_EASE.move, dt);
		b.turning = false;
		b.turnLift += (0 - b.turnLift) * ease(10, dt);
	} else if (bodyStands(b)) {
		// Standing: the feet stay where they are until the turn is too far, then step around.
		b.hip = clamp(b.hip - dYaw, -TURN_CLAMP, TURN_CLAMP);
		if (Math.abs(b.hip) > BODY_TURN_MAX) b.turning = true;
		if (b.turning) {
			b.hip += (0 - b.hip) * ease(9, dt);
			if (Math.abs(b.hip) < 0.06) b.turning = false;
		}
		b.turnLift += ((b.turning ? Math.min(1, Math.abs(b.hip) * 1.6) : 0) - b.turnLift) * ease(14, dt);
	} else {
		b.hip += (airHip - b.hip) * ease(BODY_HIP_EASE.air, dt);
		b.turnLift = 0;
	}
	return reversed;
}

/** The hips follow the direction of travel. */
export const bodyWalks = (b: BodyBlend): boolean => b.move > 0.15 && b.ground > 0.3;
/** The feet stay where they are (asked after `bodyWalks`). */
export const bodyStands = (b: BodyBlend): boolean => b.ground > 0.5;

// Torso ---------------------------------------------------------------------

/** What only the drawing side adds to the body: all 0 on the server. */
export interface BodyExtras {
	/** Clock of the breathing and idle sway (s). */
	time: number;
	surf: number;
	rampDrop: number;
	lunge: number;
}

/** A posed body: shares of the motions, the pelvis and the angles of the torso. */
export interface BodyAngles {
	move: number;
	run: number;
	idle: number;
	crouch: number;
	air: number;
	/** Travel direction in the hip frame. */
	hx: number;
	hz: number;
	/** +1: left foot forward. */
	swing: number;
	strafe: number;
	px: number;
	py: number;
	pz: number;
	pelvisYaw: number;
	pelvisPitch: number;
	pelvisRoll: number;
	chestYaw: number;
	chestPitch: number;
	chestRoll: number;
	headPitch: number;
	headRoll: number;
}

export function newBodyAngles(): BodyAngles {
	return { move: 0, run: 0, idle: 0, crouch: 0, air: 0, hx: 0, hz: 0, swing: 0, strafe: 0, px: 0, py: 0, pz: 0, pelvisYaw: 0, pelvisPitch: 0, pelvisRoll: 0, chestYaw: 0, chestPitch: 0, chestRoll: 0, headPitch: 0, headRoll: 0 };
}

/** The parts of `BodyBlend` a pose needs. */
export type BodyMotion = Pick<BodyBlend, 'duck' | 'ground' | 'move' | 'speed' | 'dirF' | 'dirR' | 'hip' | 'land' | 'vzS' | 'accF' | 'accR' | 'aim'>;

/**
 * Pelvis, torso and head of a body at gait phase `phL` (of the left foot;
 * NaN: the middle of the cycle's bob and sway). `armed` 0..1: an item is in
 * the hands, which turns the chest by `gripYaw`.
 */
export function bodyAngles(b: BodyMotion, phL: number, duty: number, posture: BodyPosture, armed: number, gripYaw: number, x: BodyExtras, o: BodyAngles): BodyAngles {
	const t = x.time;
	const surf = x.surf;
	const hip = b.hip;
	const g = b.ground;
	const air = 1 - g;
	const move = b.move * g;
	const run = clamp(b.speed / 250, 0, 1);
	const ch = Math.cos(hip);
	const sh = Math.sin(hip);
	const hx = b.dirF * ch - b.dirR * sh;
	const hz = b.dirF * sh + b.dirR * ch;
	// Lowest in mid-stance.
	const gone = Number.isNaN(phL);
	const step = gone ? 0 : Math.cos((phL - duty / 2) * TAU * 2);
	const swing = gone ? 0 : Math.cos(phL * TAU); // +1: left foot forward
	const weight = gone ? 0 : Math.sin((phL - duty / 2) * TAU);

	const hunch = posture === 'normal' ? 0 : 0.25;
	const crouch = b.duck * (1 - surf * 0.5);
	const breath = Math.sin(t * 1.7);
	const idle = (1 - move) * g;
	let py = BODY_HIP_Y + 1 - 0.4 * g;
	py -= move * (1.4 + 2.6 * run) * (1 - crouch * 0.7) * (posture === 'normal' ? 1 : 0.3);
	py -= move * run * Math.abs(hz) * 2.4 * (1 - crouch);
	py -= move * step * 1.25 * run * (1 - crouch * 0.6);
	py -= crouch * lerp(16, 14.8, move) * lerp(1, 0.94, air);
	py += idle * breath * 0.18;
	py += b.land * g * (1 - crouch * 0.6);
	py -= air * (1 - surf) * (1.5 - clamp(b.vzS / 300, -1, 1) * 1.2);
	py += surf * (x.rampDrop * 0.55 - 7);
	const leanAmt = move * (0.05 + 0.13 * run) * (1 - crouch * 0.4) * (posture === 'normal' ? 1 : 0.35);
	const accLean = 0.00012 * g;
	let leanF = b.dirF * leanAmt + clamp(b.accF * accLean, -0.14, 0.16) + hunch * 0.4;
	let leanR = b.dirR * leanAmt * 0.8 + clamp(b.accR * accLean, -0.14, 0.14);
	leanF *= 1 - surf;
	leanR *= 1 - surf;
	// In the air the body trails the sideways acceleration a little (strafing).
	const strafe = clamp(b.accR / 2600, -1, 1) * air * (1 - surf);
	const airPitch = air * (1 - surf) * clamp(b.vzS / 900, -0.12, 0.14);

	const sway = move * run * weight * 0.7 + idle * Math.sin(t * 0.55) * 0.35;
	const px = -crouch * 2.2 * (1 - move * 0.5) - hunch * 4;
	const twist = swing * 0.13 * move * run;
	const way = Math.sign(hx || 1);
	o.move = move;
	o.run = run;
	o.idle = idle;
	o.crouch = crouch;
	o.air = air;
	o.hx = hx;
	o.hz = hz;
	o.swing = swing;
	o.strafe = strafe;
	o.px = px * ch + sway * sh;
	o.py = py;
	o.pz = -px * sh + sway * ch;
	o.pelvisYaw = hip - twist * way;
	o.pelvisPitch = leanF * 0.55 + crouch * lerp(0.28, 0.34, move) + airPitch + surf * 0.16 + hunch * 0.25;
	o.pelvisRoll = leanR * 0.6 + move * run * weight * 0.05 + strafe * 0.12;

	const aim = b.aim;
	const aimTorso = aim * lerp(0.22, 0.42, armed) * (1 - surf * 0.4);
	const cp = leanF + crouch * lerp(0.5, 0.56, move) + aimTorso * 0.85 + airPitch * 0.5 + hunch * 0.95 + surf * 0.3 + x.lunge * 0.25 + idle * breath * 0.012;
	const cr = leanR + strafe * 0.22 + (posture === 'zombie' ? Math.sin(t * 6) * 0.06 : 0);
	o.chestYaw = twist * 1.1 * way + armed * gripYaw + hip * surf * 0.4;
	o.chestPitch = cp;
	o.chestRoll = cr;
	// The head looks where the player aims, kept level over a leaning torso.
	o.headPitch = clamp(aim * 0.95, -1.1, 1.05) * (posture === 'normal' ? 1 : 0.6) + (posture === 'zombie' ? 0.1 : 0) + cp * 0.12;
	o.headRoll = cr * 0.4 + (posture === 'zombie' ? 0.16 + Math.sin(t * 2.1) * 0.05 : 0);
	return o;
}

// Legs ----------------------------------------------------------------------

/** A foot: its ankle, and how the foot and toe point. */
export interface FootPose {
	x: number;
	y: number;
	z: number;
	yaw: number;
	pitch: number;
	/** 0: the toe stays flat on the ground, 1: it follows the foot. */
	toe: number;
}

/**
 * Where a foot goes (`z`: +1 right, -1 left) at its gait phase `ph`. `leads`:
 * the leg in front in the air; `stepLift` 0..1: lifted to step around;
 * `wobble`: how far it drifts in the air.
 */
export function footPose(b: BodyMotion, a: BodyAngles, gait: GaitShape, z: 1 | -1, ph: number, leads: boolean, stepLift: number, wobble: number, o: FootPose): FootPose {
	const { move, run, crouch, air, hx, hz } = a;
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
	const stanceX = z < 0 ? lerp(1.2, 5.5, crouch) : lerp(-1.0, -5.5, crouch);
	const bx = stanceX * (1 - move) + along * hx * move + BODY_BALL[0] - 0.6;
	const bz = z * (4.3 + (1 - move) * lerp(0.9, 1.5, crouch)) * lerp(1, track, move) + along * hz * move;
	lift = lift * move + stepLift * 2.6;
	// Crouched and still: the back foot rests on its ball.
	const crouchHeel = z > 0 ? -0.75 : -0.12;
	let pitch = fp * move + crouchHeel * crouch * (1 - move);
	let toe = planted ? 0 : smooth(0, 0.3, w) * (1 - smooth(0.7, 1, w));
	const toeOut = z * -0.13 * lerp(1, 0.35, move);
	// The ankle of the foot whose ball is there.
	const pc = Math.cos(pitch);
	const ps = Math.sin(pitch);
	const ox = BODY_BALL[0] * pc - BODY_BALL[1] * ps;
	const oy = BODY_BALL[0] * ps + BODY_BALL[1] * pc;
	let x = bx - ox * Math.cos(toeOut);
	let y = lift + BODY_ANKLE_Y + BODY_BALL[1] - oy;
	let zz = bz + ox * Math.sin(toeOut);
	let yaw = toeOut;

	// Air: relative to the pelvis.
	if (air > 0.01) {
		const up = clamp(b.vzS / 260, -1, 1) * 0.5 + 0.5; // 1 rising, 0 falling
		const hipY = a.py - 1;
		const tuck = Math.max(crouch, 0);
		const ax = lerp(leads ? 3.2 : -2.2, leads ? 5.5 : -7, up);
		const drop = lerp(leads ? 27.5 : 29, leads ? 22.5 : 26, up) - tuck * 9;
		const ap = lerp(leads ? -0.3 : -0.5, leads ? -0.2 : -0.95, up);
		x = lerp(x, ax + wobble, air);
		y = lerp(y, Math.max(BODY_ANKLE_Y - 0.5, hipY - drop), air);
		zz = lerp(zz, z * 4.6, air);
		pitch = lerp(pitch, ap, air);
		toe = lerp(toe, 1, air);
		yaw = lerp(yaw, 0, air);
	}

	// Out of the hip frame.
	const c = Math.cos(b.hip);
	const s = Math.sin(b.hip);
	o.x = x * c + zz * s;
	o.y = y;
	o.z = -x * s + zz * c;
	o.yaw = yaw + b.hip;
	o.pitch = pitch;
	o.toe = toe;
	return o;
}

/** A two-bone leg: its knee, the directions of the thigh and the knee, and the ankle it reaches. */
export interface LegPose {
	kneeX: number;
	kneeY: number;
	kneeZ: number;
	/** Thigh direction. */
	tx: number;
	ty: number;
	tz: number;
	/** The way the knee points. */
	nx: number;
	ny: number;
	nz: number;
	ankleX: number;
	ankleY: number;
	ankleZ: number;
}

export function newLegPose(): LegPose {
	return { kneeX: 0, kneeY: 0, kneeZ: 0, tx: 0, ty: 0, tz: 0, nx: 0, ny: 0, nz: 0, ankleX: 0, ankleY: 0, ankleZ: 0 };
}

const LEG_MAX = (BODY_THIGH + BODY_SHIN) * 0.996;

/** Leg from a hip joint to a foot (`z`: +1 right, -1 left). The foot comes closer when the leg cannot reach it. */
export function legPose(hipX: number, hipY: number, hipZ: number, f: FootPose, z: 1 | -1, duck: number, o: LegPose): LegPose {
	// Knee direction: where the foot points, slightly outwards, tipped with the pelvis.
	const c = Math.cos(f.yaw);
	const s = Math.sin(f.yaw);
	const splay = z * lerp(0.1, 0.28, duck);
	let nx = c + s * splay;
	let ny = 0.15;
	let nz = -s + c * splay;
	let dx = f.x - hipX;
	let dy = f.y - hipY;
	let dz = f.z - hipZ;
	const far = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
	let len = far;
	if (len > LEG_MAX) {
		const k = LEG_MAX / len;
		len = LEG_MAX;
		f.x = hipX + dx * k;
		f.y = hipY + dy * k;
		f.z = hipZ + dz * k;
	}
	dx /= far;
	dy /= far;
	dz /= far;
	len = Math.max(len, 7);
	const along = nx * dx + ny * dy + nz * dz;
	nx -= dx * along;
	ny -= dy * along;
	nz -= dz * along;
	const n = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
	nx /= n;
	ny /= n;
	nz /= n;
	const cosA = clamp((BODY_THIGH * BODY_THIGH + len * len - BODY_SHIN * BODY_SHIN) / (2 * BODY_THIGH * len), -1, 1);
	const sinA = Math.sqrt(1 - cosA * cosA);
	const tx = dx * cosA + nx * sinA;
	const ty = dy * cosA + ny * sinA;
	const tz = dz * cosA + nz * sinA;
	o.tx = tx;
	o.ty = ty;
	o.tz = tz;
	o.nx = nx;
	o.ny = ny;
	o.nz = nz;
	const kx = (o.kneeX = hipX + tx * BODY_THIGH);
	const ky = (o.kneeY = hipY + ty * BODY_THIGH);
	const kz = (o.kneeZ = hipZ + tz * BODY_THIGH);
	const sx = f.x - kx;
	const sy = f.y - ky;
	const sz = f.z - kz;
	const sl = BODY_SHIN / (Math.sqrt(sx * sx + sy * sy + sz * sz) || 1);
	o.ankleX = kx + sx * sl;
	o.ankleY = ky + sy * sl;
	o.ankleZ = kz + sz * sl;
	return o;
}

// Arms ----------------------------------------------------------------------

/** Angles of an arm that holds nothing, from the chest. */
export interface ArmAngles {
	fwd: number;
	out: number;
	bend: number;
	inward: number;
	curl: number;
}

/** The swinging arm of a body (`z`: +1 right, -1 left): `breath` -1..1 moves it at rest. */
export function armAngles(b: BodyMotion, a: BodyAngles, z: 1 | -1, leads: boolean, breath: number, surf: number, o: ArmAngles): ArmAngles {
	const { move, run, idle, crouch, air } = a;
	const sw = armSwing(b, a, z);
	o.fwd = idle * (0.04 + breath * 0.015) + move * (sw * lerp(0.35, 0.78, run) + 0.02) + crouch * 0.3;
	o.out = 0.13 + move * 0.06 + breath * idle * 0.012;
	o.bend = idle * 0.3 + move * (lerp(0.45, 1.45, run) + sw * 0.28 * run) + crouch * 0.5 * (1 - move);
	o.inward = 0.15 + move * 0.4 * run + Math.max(0, sw) * 0.2 * run;
	o.curl = lerp(0.45, 1.1, move * run);
	if (air > 0.01) {
		const k = air * (1 - surf);
		const up = clamp(b.vzS / 260, -1, 1) * 0.5 + 0.5;
		o.fwd = lerp(o.fwd, (leads ? -0.3 : 0.42) * lerp(0.6, 1, up), k);
		o.out = lerp(o.out, lerp(0.75, 0.4, up) + a.strafe * z * 0.35, k);
		o.bend = lerp(o.bend, lerp(0.8, 1.2, up), k);
		o.inward = lerp(o.inward, 0.25, k);
		o.curl = lerp(o.curl, 0.35, k);
	}
	return o;
}

/** Arm swing -1..1: opposite to the leg of the same side. */
export const armSwing = (b: BodyMotion, a: BodyAngles, z: 1 | -1): number => a.swing * z * Math.sign(b.dirF >= -0.2 ? 1 : -1);

/** The raised claws of an infected, from its swinging arm; `wobble` moves them at rest. */
export function clawAngles(b: BodyMotion, a: BodyAngles, z: 1 | -1, wobble: number, o: ArmAngles): ArmAngles {
	o.fwd = lerp(0.62, o.fwd * 0.5 + 0.35, a.move * 0.5) + wobble;
	o.out = 0.5 + a.crouch * 0.05;
	o.bend = 1.15 - armSwing(b, a, z) * a.move * 0.15;
	o.inward = 0.5;
	o.curl = 0.75;
	return o;
}

/** How far the shoulder turns with its arm: yaw and roll (right +) of the collarbone. */
export const shoulderYaw = (z: 1 | -1, fwd: number): number => z * clamp(fwd, -0.6, 1.3) * 0.12;
export const shoulderRoll = (z: 1 | -1, out: number): number => z * -clamp(out - 0.3, 0, 1.2) * 0.22;

/** Running lowers a held item: it tips forward by this much, and drops by this many units per radian of it. */
export const gripRelax = (relax: number, a: Pick<BodyAngles, 'move' | 'run'>): number => a.move * a.run * relax;
export const GRIP_RELAX_DROP = 6;
/** Bob of a held item over the gait (phase of the left foot), up and to the right. */
export const gripBobY = (phL: number): number => Math.sin(phL * TAU * 2) * 0.45;
export const gripBobZ = (phL: number): number => Math.cos(phL * TAU) * 0.5;
