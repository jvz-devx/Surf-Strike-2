// Solve the hand poses of the first-person guns against the shipped meshes, and write them to
// apps/web/src/lib/render/hand-pose-data.ts (README.md in this folder, "Hands").
//
//   node --experimental-transform-types tools/models/procedural/fit_hands.mjs [weapon id ...] [--only pose,pose] [weapon.pose ...] [--print]
//
// The pistol's left-hand poses keep clear of its right hand as it is in the data file: solve 'grip' first, in a run of its own.
//
// Run it after a change to a gun's grip, fore-end, magazine or handle, or to the hands (on 8 CPU cores: about a minute a
// pose, one process per weapon). Each pose starts from a seed below: how the palm faces, which point of it lies
// where. A CMA-ES search then moves the wrist and bends the fingers of the real skinned mesh until the
// named fingertips and the palm touch the gun without sinking in. Same seed, same result.
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { availableParallelism } from 'node:os';

registerHooks({
	resolve(spec, ctx, next) {
		// The sources import './x.js' for x.ts, as the bundler resolves it.
		if (spec.startsWith('.') && spec.endsWith('.js') && ctx.parentURL?.endsWith('.ts')) {
			const ts = new URL(spec.slice(0, -3) + '.ts', ctx.parentURL);
			if (existsSync(ts)) return next(ts.href, ctx);
		}
		return next(spec, ctx);
	}
});
const web = new URL('../../../apps/web/', import.meta.url);
const src = new URL('src/lib/render/', web);
const load = (f) => import(new URL(f, src).href);
const THREE = await import(pathToFileURL(fileURLToPath(new URL('node_modules/three/build/three.module.js', web))).href);
const { glbScene } = await load('glb-reader.ts');
const { HandKit, HANDS_URL, HAND_BONES } = await load('hands.ts');
const { GunRig } = await load('gun-rig.ts');
const { GENERATED, modelUrl, sightTurn, takeModel } = await load('weapon-assets.ts');
const { handSamples, Solid, trianglesOf, measure } = await load('hand-contact.ts');
const { OPEN } = await load('hand-poses.ts');

const add = (a, b, k = 1) => a.map((v, i) => v + b[i] * k);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => add([0, 0, 0], a, 1 / Math.hypot(...a));

// ---------------------------------------------------------------------
// Seeds. fingers: the way the straight fingers point; palm: the way the palm faces (model axes of the gun);
// on: where the point 'ref' of the hand (hand space) lies at the start. touch: what has to touch; trigger: where the pad
// of the index finger rests. bend: how far the fingers are closed at the start; hold: how strongly they keep that.

const PALM = [0.05, -0.62, -2.3];
/** Right hand round a pistol grip leaning back by 'rake': the palm on its right and back. */
const onGrip = (centre, rake, hw, hd, trigger, o = {}) => {
	const up = [0, Math.cos(rake), -Math.sin(rake)];
	const fwd = [0, -Math.sin(rake), -Math.cos(rake)];
	// TRY='{"turn": 0.9}': try other numbers for the grips of one run.
	o = { ...o, ...JSON.parse(process.env.TRY ?? '{}') };
	const a = o.turn ?? 0.5;
	const tilt = o.tilt ?? 0.15;
	// The fingers point forwards, a little up the grip.
	const f = unit(add(add(add([0, 0, 0], fwd, Math.cos(a)), [1, 0, 0], Math.sin(a)), up, tilt));
	const n = add(add([0, 0, 0], [-1, 0, 0], Math.cos(a)), fwd, Math.sin(a));
	// The thumb goes round the back to the left side, forwards; the web between thumb and index finger behind the grip.
	const thumbTo = add(add(add(centre, up, o.thumbUp ?? 1.9), [-1, 0, 0], (o.thumbOut ?? hw) + 0.35), fwd, o.thumbFwd ?? 0.5);
	// A grip too thick to go round: the thumb rests on the strong side, and the palm sits flatter.
	if (o.open) return { side: 'r', at: 'hand_r', fingers: f, palm: n, ref: PALM, on: add(add(add(centre, [1, 0, 0], hw * 0.8), fwd, -hd * 0.75), up, 0.1), touch: ['index', 'middle', 'ring', 'pinky', 'thumb', 'palm'], trigger, bend: 0.75, maxBend: 0.5, straighter: 1.5, across: centre[0], ...o };
	return { side: 'r', at: 'hand_r', fingers: f, palm: n, thumbTo, web: true, ref: [-0.9, -0.6, -2.4], on: add(add(add(centre, [1, 0, 0], hw * 0.35), fwd, -hd), up, o.high ?? 0.9), touch: ['index', 'middle', 'ring', 'pinky', 'thumb', 'palm'], trigger, bend: 0.75, maxBend: 0.5, straighter: 1.5, across: centre[0], ...o };
};
/** Left hand under a fore-end: palm up, fingers up the right side, thumb up the left. */
const under = (at, on, o = {}) => ({ side: 'l', at, fingers: [0.85, 0, -0.52], palm: [0, 1, 0], ref: [0, -0.6, -2.2], on, touch: ['index', 'middle', 'ring', 'pinky', 'thumb', 'palm'], bend: 0.55, ...o });

// The knife is placed with a turn (PLACES.knife in viewmodels.ts): its forearm leaves the picture down to the right and
// back, so in the model space of the knife that direction is turned back.
const knifeTurn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0.55, -0.6)).invert();
const knifeArm = new THREE.Vector3(0.3, -0.55, 0.78).normalize().applyQuaternion(knifeTurn);
const KNIFE_ELBOW = add([0, 0, 0.5], knifeArm.toArray(), 26).map((v) => Math.round(v * 100) / 100);
// The straight fingers go on from the forearm, across the handle.
const KNIFE_FINGERS = unit([-knifeArm.x, -knifeArm.y, 0]);
// The thumb side (−X of the hand) is the blade side: X = Y × Z is +Z of the knife.
const KNIFE_PALM = [KNIFE_FINGERS[1], -KNIFE_FINGERS[0], 0];

/**
 * Right hand on a knob that stands out to the right, as on a door knob: the palm on its end, the thumb across from two fingers.
 * Three ways to come to it; the best one is kept.
 */
const roundKnob = (at, axis) => ({
	ref: [-0.4, -1.5, -4.6],
	on: at,
	around: { at, axis, fingers: ['index', 'middle'] },
	touch: ['index', 'middle', 'thumb'],
	palmNear: 0.5,
	bend: 0.7,
	alts: [
		{ fingers: [-0.75, 0.1, -0.65], palm: [-0.65, -0.1, 0.75] },
		{ fingers: [-0.45, -0.2, -0.87], palm: [-0.85, 0.1, 0.45] },
		{ fingers: [-0.6, 0.55, -0.55], palm: [-0.7, 0.2, 0.7] },
		{ fingers: [-0.8, -0.45, -0.4], palm: [-0.4, -0.2, 0.9] }
	]
});

const lmgGrip = (trigger, o) => ({ alts: [0.75, 0.5].map((turn) => onGrip([0, -4.3, 4.7], 0.31, 1.0, 1.3, trigger, { turn, tries: 5, pads: { pinky: [-0.1, -5.75, 3.55] }, ...o })), side: 'r', at: 'hand_r' });

const SEEDS = {
	pistol: {
		elbow: { r: [4.5, -11, 22], l: [-21, -14, 20] },
		rest: { r: 'grip', l: null },
		poses: {
			// Below the beavertail and the slide, which has to run free.
			grip: onGrip([0, -2.3, 2.45], 0.3, 0.9, 1.35, [0.3, -0.5, -1.25], { high: 0.6, thumbUp: 2.0, thumbFwd: 0.4, thumbWeight: 5, keep: 0.3, tries: 8 }),
			grip_off: onGrip([0, -2.3, 2.45], 0.3, 0.9, 1.35, [1.0, 0.1, -2.0], { straight: true, high: 0.6, thumbUp: 2.0, thumbFwd: 0.4, thumbWeight: 5, keep: 0.3, tries: 8 }),
			// Below the right hand, on the base plate.
			mag: under('grip_mag', [0, -5.6, 3.2], { touch: ['thumb', 'index', 'palm'], fingers: [0.95, 0, -0.3], tries: 10 }),
			// On the serrations of the slide, the thumb on the left, the fingers on the right: over the top, or from behind.
			bolt: { side: 'l', at: 'grip_bolt', part: 'slide', states: [[0], [0.85], [1]], touch: ['index', 'middle', 'thumb'], pads: { index: [0.95, 2.1, 0.75], middle: [0.95, 2.05, 0.0], thumb: [-0.95, 2.1, 0.6] }, bend: 0.6, tries: 8, alts: [
				{ fingers: [0.95, -0.2, -0.2], palm: [-0.2, -1, 0], ref: [0.4, -1.2, -4.4], on: [0, 2.8, 0.5] },
				{ fingers: [0.75, -0.1, -0.65], palm: [0.2, -0.95, 0.2], ref: [0.6, -1.2, -4.2], on: [0, 2.6, 0.8] },
				{ fingers: [0.85, 0.25, -0.45], palm: [0.4, -0.7, -0.6], ref: [0.8, -1.0, -4.0], on: [0, 2.3, 1.2] }
			] }
		}
	},
	smg: {
		elbow: { r: [5.3, -14, 29], l: [-22.5, -16.5, 16.5] },
		rest: { r: 'grip', l: 'fore' },
		poses: {
			grip: onGrip([0, -3.8, 4.5], 0.31, 1.0, 1.25, [0, -2.05, 1.05]),
			grip_off: onGrip([0, -3.8, 4.5], 0.31, 1.0, 1.25, [0.75, -2.0, 0.9], { straight: true }),
			fore: under('hand_l', [0, -3.62, -6.2]),
			mag: under('grip_mag', [0, -3.62, -6.2]),
			bolt: { side: 'l', at: 'grip_bolt', fingers: [0.5, 0.15, -0.85], palm: [0.85, -0.3, 0.45], ref: [0.4, -0.7, -4.6], on: [-2.2, 1.25, -2.2], touch: ['index', 'thumb'], bend: 0.95, hold: 0.4 }
		}
	},
	lmg: {
		elbow: { r: [5.3, -14, 29.5], l: [-22.5, -15, 9] },
		rest: { r: 'grip', l: 'fore' },
		poses: {
			// The little finger too closes round the front of the grip, below the low trigger.
			grip: lmgGrip([0, -2.9, 1.1], {}),
			grip_off: lmgGrip([1.45, -2.1, 1.2], { straight: true, tries: 8, pads: { middle: [-0.25, -3.6, 2.85], ring: [-0.2, -4.7, 3.3], pinky: [-0.1, -5.75, 3.55] } }),
			fore: under('hand_l', [0, -2.0, -13.6]),
			mag: under('grip_mag', [-0.9, -6.5, -3.9], { touch: ['thumb', 'index', 'middle', 'palm'] }),
			bolt: { side: 'r', at: 'grip_bolt', part: 'bolt', states: [[0], [0.5], [1]], ...roundKnob([2.35, 0.6, -1.4], [1, 0, 0]) },
			// Across the left edge of the sheet metal, ahead of the mount of the optic: the fingers over it beside the rail, the thumb on its side by the latch.
			cover: { side: 'l', at: null, part: 'cover', states: [[0], [0.5], [1]], below: 2.85, touch: ['index', 'middle', 'thumb'], pads: { index: [-1.2, 2.75, -0.6], middle: [-1.2, 2.75, -1.4], thumb: [-1.65, 2.15, 1.0] }, bend: 0.5, alts: [
				{ fingers: [0.9, -0.15, -0.4], palm: [-0.1, -1, 0], ref: [0.4, -0.9, -4.8], on: [-1.5, 2.9, -0.8] },
				{ fingers: [0.75, -0.35, -0.55], palm: [-0.35, -0.9, 0], ref: [0.4, -0.9, -4.8], on: [-1.6, 2.8, -0.6] },
				{ fingers: [0.7, 0.15, -0.7], palm: [0.5, -0.8, 0.2], ref: [0.6, -0.9, -4.6], on: [-1.6, 2.6, -0.4] }
			] }
		}
	},
	sniper: {
		elbow: { r: [7, -13.5, 30], l: [-22.5, -14.5, 13] },
		rest: { r: 'grip', l: 'fore' },
		poses: {
			// The stock runs on over a thick grip: the thumb stays on the right, along the stock.
			grip: onGrip([0, -3.3, 5.4], 0.42, 1.2, 1.36, [0, -2.1, 0.85], { open: true, turn: 0.55 }),
			grip_off: onGrip([0, -3.3, 5.4], 0.42, 1.2, 1.36, [1.25, -1.2, 1.2], { straight: true, open: true, turn: 0.55 }),
			fore: under('hand_l', [0, -1.6, -9.5]),
			mag: under('grip_mag', [0, -3.52, -3.45], { touch: ['thumb', 'index', 'middle', 'palm'], fingers: [0.75, 0.1, -0.65] }),
			bolt: { side: 'r', at: 'grip_bolt', part: 'bolt', states: [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1]], ...roundKnob([2.75, -0.13, 2.79], [0.91, -0.41, 0.09]) }
		}
	},
	barrett: {
		elbow: { r: [5.3, -14, 31], l: [-22.5, -14.6, 8] },
		rest: { r: 'grip', l: 'fore' },
		poses: {
			grip: onGrip([0, -4.2, 6.1], 0.31, 1.0, 1.3, [0, -2.45, 2.85]),
			grip_off: onGrip([0, -4.2, 6.1], 0.31, 1.0, 1.3, [1.65, -1.1, 2.4], { straight: true }),
			fore: under('hand_l', [0, -1.6, -14.8]),
			mag: under('grip_mag', [0, -8.05, -0.4], { touch: ['thumb', 'index', 'middle', 'palm'] }),
			bolt: { side: 'r', at: 'grip_bolt', part: 'bolt', states: [[0], [0.15], [0.3], [0.5], [0.75], [1]], ...roundKnob([2.25, 1.32, 0.3], [1, 0, 0]) }
		}
	},
	striker: {
		elbow: { r: [5.3, -14, 29.7], l: [-22.5, -15, 10] },
		rest: { r: 'grip', l: 'fore' },
		poses: {
			grip: onGrip([0, -4.1, 4.9], 0.31, 1.0, 1.3, [0, -2.25, 1.3]),
			grip_off: onGrip([0, -4.1, 4.9], 0.31, 1.0, 1.3, [1.72, -1.1, 1.3], { straight: true }),
			fore: under('hand_l', [0, -2.05, -12.6]),
			mag: under('grip_mag', [0, -8.9, -3.4], { touch: ['thumb', 'index', 'middle', 'palm'] }),
			bolt: { side: 'l', at: 'grip_bolt', fingers: [0.5, 0.15, -0.85], palm: [0.85, -0.3, 0.45], ref: [0.4, -0.7, -4.6], on: [-2.35, 1.05, -2.5], touch: ['index', 'thumb'], bend: 0.95, hold: 0.4 }
		}
	},
	knife: {
		// The fist round the handle (the handle runs along the bore), the thumb towards the blade; the forearm comes from below right.
		elbow: { r: KNIFE_ELBOW, l: [-20, -15, 20] },
		rest: { r: 'knife', l: null },
		poses: {
			knife: { side: 'r', at: null, fingers: KNIFE_FINGERS, palm: KNIFE_PALM, ref: [0, -0.62, -3.0], on: add([0, 0.1, 1.45], KNIFE_PALM, -0.7), hold: 0.5, touch: ['index', 'middle', 'ring', 'pinky', 'thumb', 'palm'], bend: 1.0 }
		}
	}
};
export { SEEDS };

// ---------------------------------------------------------------------

/** Wrist turn from the ways the fingers point and the palm faces. */
function turnOf(seed) {
	const f = unit(seed.fingers);
	const n = unit(add(seed.palm, f, -dot(seed.palm, f)));
	const Z = add([0, 0, 0], f, -1);
	const Y = add([0, 0, 0], n, -1);
	const X = [Y[1] * Z[2] - Y[2] * Z[1], Y[2] * Z[0] - Y[0] * Z[2], Y[0] * Z[1] - Y[1] * Z[0]];
	return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...X), new THREE.Vector3(...Y), new THREE.Vector3(...Z)));
}

/** Small seeded random source: the search is repeatable. */
function rng(seed) {
	let a = seed >>> 0;
	const u = () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

/** CMA-ES: minimise f from x0 with step sizes s. */
function cmaes(f, x0, s, { generations, lambda, seed }) {
	const n = x0.length;
	const rand = rng(seed);
	const mu = lambda >> 1;
	const w = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
	const ws = w.reduce((a, b) => a + b, 0);
	w.forEach((_, i) => (w[i] /= ws));
	const mueff = 1 / w.reduce((a, b) => a + b * b, 0);
	const cc = (4 + mueff / n) / (n + 4 + (2 * mueff) / n);
	const cs = (mueff + 2) / (n + mueff + 5);
	const c1 = 2 / ((n + 1.3) ** 2 + mueff);
	const cmu = Math.min(1 - c1, (2 * (mueff - 2 + 1 / mueff)) / ((n + 2) ** 2 + mueff));
	const damps = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + cs;
	const chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
	let mean = x0.map((v, i) => v / s[i]);
	let sigma = 1;
	let C = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
	let L = C.map((r) => r.slice());
	const ps = new Array(n).fill(0);
	const pc = new Array(n).fill(0);
	let best = { x: x0.slice(), y: f(x0) };
	const solveL = (v) => {
		const y = v.slice();
		for (let i = 0; i < n; i++) {
			for (let j = 0; j < i; j++) y[i] -= L[i][j] * y[j];
			y[i] /= L[i][i];
		}
		return y;
	};
	for (let g = 0; g < generations; g++) {
		const pop = [];
		for (let k = 0; k < lambda; k++) {
			const z = Array.from({ length: n }, rand);
			const y = new Array(n).fill(0);
			for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) y[i] += L[i][j] * z[j];
			const x = mean.map((m, i) => (m + sigma * y[i]) * s[i]);
			pop.push({ x, y, v: f(x) });
		}
		pop.sort((a, b) => a.v - b.v);
		if (pop[0].v < best.y) best = { x: pop[0].x, y: pop[0].v };
		const step = new Array(n).fill(0);
		for (let k = 0; k < mu; k++) for (let i = 0; i < n; i++) step[i] += w[k] * pop[k].y[i];
		mean = mean.map((m, i) => m + sigma * step[i]);
		const white = solveL(step);
		for (let i = 0; i < n; i++) ps[i] = (1 - cs) * ps[i] + Math.sqrt(cs * (2 - cs) * mueff) * white[i];
		const pn = Math.hypot(...ps);
		const hs = pn / Math.sqrt(1 - (1 - cs) ** (2 * (g + 1))) / chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
		for (let i = 0; i < n; i++) pc[i] = (1 - cc) * pc[i] + hs * Math.sqrt(cc * (2 - cc) * mueff) * step[i];
		for (let i = 0; i < n; i++)
			for (let j = 0; j <= i; j++) {
				let v = (1 - c1 - cmu) * C[i][j] + c1 * (pc[i] * pc[j] + (1 - hs) * cc * (2 - cc) * C[i][j]);
				for (let k = 0; k < mu; k++) v += cmu * w[k] * pop[k].y[i] * pop[k].y[j];
				C[i][j] = C[j][i] = v;
			}
		sigma = Math.min(3, sigma * Math.exp((cs / damps) * (pn / chiN - 1)));
		// Cholesky.
		for (let i = 0; i < n; i++)
			for (let j = 0; j <= i; j++) {
				let v = C[i][j];
				for (let k = 0; k < j; k++) v -= L[i][k] * L[j][k];
				L[i][j] = i === j ? Math.sqrt(Math.max(1e-12, v)) : v / L[j][j];
			}
		if (sigma < 1e-4) break;
	}
	return best;
}

/** Signed distances on a grid, worked out where they are asked for. */
class Grid {
	constructor(solid, centre, half, step) {
		Object.assign(this, { solid, step, n: Math.ceil((2 * half) / step) + 1, o: centre.map((c) => c - half) });
		this.v = new Float32Array(this.n ** 3).fill(NaN);
	}
	node(i, j, k) {
		const at = (i * this.n + j) * this.n + k;
		let v = this.v[at];
		if (v !== v) this.v[at] = v = this.solid.signed(this.o[0] + i * this.step, this.o[1] + j * this.step, this.o[2] + k * this.step);
		return v;
	}
	at(x, y, z) {
		const fx = (x - this.o[0]) / this.step, fy = (y - this.o[1]) / this.step, fz = (z - this.o[2]) / this.step;
		const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
		if (i < 0 || j < 0 || k < 0 || i >= this.n - 1 || j >= this.n - 1 || k >= this.n - 1) return 3;
		const u = fx - i, v = fy - j, w = fz - k;
		const a = this.node(i, j, k) * (1 - w) + this.node(i, j, k + 1) * w;
		const b = this.node(i, j + 1, k) * (1 - w) + this.node(i, j + 1, k + 1) * w;
		const c = this.node(i + 1, j, k) * (1 - w) + this.node(i + 1, j, k + 1) * w;
		const d = this.node(i + 1, j + 1, k) * (1 - w) + this.node(i + 1, j + 1, k + 1) * w;
		return (a * (1 - v) + b * v) * (1 - u) + (c * (1 - v) + d * v) * u;
	}
}

const shipped = (url) => glbScene(readFileSync(new URL('static' + url, web)));

async function gunOf(id) {
	const gen = GENERATED[id];
	const model = takeModel(await shipped(modelUrl(id)));
	const fit = new THREE.Matrix4().compose(new THREE.Vector3(...gen.fp.at), sightTurn(gen, new THREE.Quaternion()), new THREE.Vector3().setScalar(gen.fp.len));
	const rig = new GunRig(id, model, gen.fp.len);
	const own = trianglesOf(model, fit);
	const solid = new Solid(own);
	/** Frame of a point of the gun in model space (no scale). */
	const frame = (name) => {
		const m = new THREE.Matrix4();
		for (let o = rig.point(name); o && o !== model; o = o.parent) m.premultiply(new THREE.Matrix4().compose(o.position, o.quaternion, o.scale));
		const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
		m.premultiply(fit).decompose(p, q, s);
		return { p, q };
	};
	/**
	 * A part and what it moves in: its triangles, and per state (amounts of its steps) how it is moved and the rest of
	 * the gun as the part sees it. A hand that rides the part is measured against all of them.
	 */
	const moving = (name, states) => {
		const node = rig.part(name);
		const inside = new Set();
		node.traverse((o) => inside.add(o));
		const part = trianglesOf(node, fit);
		const rest = [];
		model.updateWorldMatrix(true, true);
		const m = new THREE.Matrix4(), v = new THREE.Vector3();
		model.traverse((o) => {
			if (!(o instanceof THREE.Mesh) || inside.has(o)) return;
			m.multiplyMatrices(fit, o.matrixWorld);
			const g = o.geometry, pos = g.getAttribute('position');
			for (let i = 0; i < (g.index ? g.index.count : pos.count); i++) rest.push(...v.fromBufferAttribute(pos, g.index ? g.index.getX(i) : i).applyMatrix4(m).toArray());
		});
		const at = () => {
			model.updateWorldMatrix(true, true);
			const k = new THREE.Matrix4().multiplyMatrices(fit, node.matrixWorld), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
			k.decompose(p, q, s);
			return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
		};
		const home = at().invert();
		const moves = states.map((s) => {
			rig.move(name, s);
			const t = at().multiply(home);
			rig.reset();
			return t;
		});
		return { part, rest: Float64Array.from(rest), moves };
	};
	return { id, gen, rig, solid, frame, own, moving };
}

/** Triangles moved by a matrix. */
function moved(tri, m) {
	const out = new Float64Array(tri.length), v = new THREE.Vector3();
	for (let i = 0; i < tri.length; i += 3) v.fromArray(tri, i).applyMatrix4(m).toArray(out, i);
	return out;
}
function together(a, b) {
	const out = new Float64Array(a.length + b.length);
	out.set(a);
	out.set(b, a.length);
	return out;
}

/** The gun with its right hand in the way: what a left hand has to keep out of. Needs the right hand's pose solved before. */
async function withRightHand(gun, kit, def) {
	const { HAND_POSE_DATA } = await load('hand-pose-data.ts');
	const p = HAND_POSE_DATA[gun.id]?.poses[def.rest.r];
	if (!p) return gun.solid;
	const hand = kit.make('r');
	const f = gun.frame(p.at);
	const at = new THREE.Vector3(...p.p).applyQuaternion(f.q).add(f.p);
	const q = f.q.clone().multiply(new THREE.Quaternion(...p.q));
	hand.place({ ...p, p: at.toArray(), q: q.toArray(), elbow: def.elbow.r });
	hand.group.updateMatrixWorld(true);
	hand.mesh.skeleton.update();
	const g = hand.mesh.geometry;
	const n = g.index ? g.index.count : g.getAttribute('position').count;
	gun.right = new Float64Array(n * 3);
	const v = new THREE.Vector3();
	for (let i = 0; i < n; i++) hand.mesh.getVertexPosition(g.index ? g.index.getX(i) : i, v).applyMatrix4(hand.mesh.matrixWorld).toArray(gun.right, i * 3);
	hand.dispose();
	return new Solid(together(gun.own, gun.right));
}

// Joint limits: sideways, then the bends of the three joints; the thumb's base (Euler) and its two bends.
const LO = [-0.22, -0.15, -0.02, -0.02];
const HI = [0.22, 1.55, 1.75, 1.2];
const TLO = [-0.6, -0.95, -0.9, -0.25, -0.35];
const THI = [1.0, 0.85, 0.9, 0.95, 1.2];
const RADII = { index: [0.5, 0.46, 0.41], middle: [0.52, 0.47, 0.42], ring: [0.5, 0.46, 0.41], pinky: [0.45, 0.41, 0.37], thumb: [0.58, 0.52, 0.46] };
const TIPS = { index: [0, 0, -1.08], middle: [0, 0, -1.12], ring: [0, 0, -1.1], pinky: [0, 0, -0.98], thumb: [-0.66 * 1.17, -0.3 * 1.17, -0.69 * 1.17] };

function solvePose(gun, kit, name, seed, elbow, seedNumber) {
	const hand = kit.make(seed.side);
	const dense = handSamples(hand.mesh, 0.12);
	const samples = dense.filter((s) => !s.arm && !s.face);
	const geo = hand.mesh.geometry;
	const pos = geo.getAttribute('position'), si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
	const skel = hand.mesh.skeleton;
	const tipNames = ['index', 'middle', 'ring', 'pinky', 'thumb'];
	const V = new THREE.Vector3();
	// Per sample: bind position per bone (at most three matter), the weights.
	const S = samples.map((s) => {
		const bones = [];
		for (let k = 0; k < 4; k++) {
			const w = sw.getComponent(s.vertex, k);
			if (w < 0.01) continue;
			const b = si.getComponent(s.vertex, k);
			V.fromBufferAttribute(pos, s.vertex).applyMatrix4(skel.boneInverses[b]);
			bones.push(b, w, V.x, V.y, V.z);
		}
		return { ...s, bones };
	});
	// Points on the faces between them (a thin edge passes between two vertices), in batches per face.
	const placeOf = (i) => [0, 1, 2].map((k) => pos.getComponent(i, k).toFixed(5)).join();
	const indexOf = new Map(S.map((s, i) => [placeOf(s.vertex), i]));
	const faces = new Map();
	for (const s of dense) {
		if (!s.face || s.arm) continue;
		const c = s.face.map((v) => indexOf.get(placeOf(v)));
		if (c.some((v) => v === undefined)) continue;
		const key = c.join();
		if (!faces.has(key)) faces.set(key, { c, w: [] });
		faces.get(key).w.push(...s.weights);
	}
	const faceList = [...faces.values()];
	const at = new Float64Array(S.length * 3);
	const dist = new Float64Array(S.length);
	const boneIndex = new Map(skel.bones.map((b, i) => [b.name, i]));
	// The pad of the index finger: the palm side of its last bone.
	const padOf = Object.fromEntries(tipNames.map((f) => [f, S.map((s, i) => [s, i]).filter(([s]) => s.bone === f + '3' && (f === 'thumb' || V.fromBufferAttribute(pos, s.vertex).applyMatrix4(skel.boneInverses[skel.bones.findIndex((b) => b.name === f + '3')]).y < -0.2)).map(([, i]) => i)]));
	const padAt = (f) => {
		const out = [0, 0, 0];
		for (const i of padOf[f]) for (let k = 0; k < 3; k++) out[k] += at[i * 3 + k] / padOf[f].length;
		return out;
	};
	const pad = new Set(S.filter((s) => s.bone === 'index3' && V.fromBufferAttribute(pos, s.vertex).applyMatrix4(skel.boneInverses[boneIndex.get('index3')]).y < -0.2).map((s) => s.vertex));
	const turn = turnOf(seed);
	const on = new THREE.Vector3(...seed.on);
	const wrist0 = on.clone().sub(new THREE.Vector3(...seed.ref).applyQuaternion(turn));
	const centre = wrist0.clone().add(new THREE.Vector3(0, 0, -3.2).applyQuaternion(turn));
	const grids = [new Grid(seed.side === 'l' ? gun.withRight : gun.solid, centre.toArray(), 7.5, 0.1)];
	// What it touches is the gun, not the other hand.
	let touch = seed.side === 'l' && gun.withRight !== gun.solid ? new Grid(gun.solid, centre.toArray(), 7.5, 0.1) : grids[0];
	let moves = [];
	if (seed.part) {
		// It rides a part: clear of the gun wherever that goes, and it touches the part itself.
		const m = gun.moving(seed.part, seed.states);
		moves = m.moves;
		const still = seed.side === 'l' && gun.right ? together(m.rest, gun.right) : m.rest;
		for (const t of moves.slice(1)) grids.push(new Grid(new Solid(moved(still, t.clone().invert())), centre.toArray(), 7.5, 0.1));
		const keep = [];
		for (let o = 0; o < m.part.length; o += 9) if (!seed.below || Math.max(m.part[o + 1], m.part[o + 4], m.part[o + 7]) < seed.below) keep.push(...m.part.subarray(o, o + 9));
		touch = new Grid(new Solid(Float64Array.from(keep)), centre.toArray(), 7.5, 0.1);
	}
	const first = grids[0];
	const grid = {
		at(x, y, z) {
			let d = first.at(x, y, z);
			for (let g = 1; g < grids.length; g++) {
				const e = grids[g].at(x, y, z);
				if (e < d) d = e;
			}
			return d;
		}
	};
	const alone = grids.length === 1 && touch === first;
	const b = seed.bend ?? 0.5;
	const start = [0, 0, 0, 0, 0, 0];
	for (let f = 0; f < 4; f++) start.push(0, b, b * 1.15, b * 0.7);
	start.push(0.25, -0.1, 0.1, 0.25, 0.35);
	if (seed.straight || seed.trigger) start.splice(6, 4, 0.1, seed.straight ? 0.1 : 0.5, seed.straight ? 0.15 : 0.5, 0.15);
	const natural = start.slice();
	const steps = [0.35, 0.35, 0.35, 0.18, 0.18, 0.18];
	for (let f = 0; f < 4; f++) steps.push(0.06, 0.22, 0.25, 0.18);
	steps.push(0.25, 0.25, 0.2, 0.2, 0.25);
	const dq = new THREE.Quaternion(), q = new THREE.Quaternion(), e = new THREE.Vector3(), wp = new THREE.Vector3();
	const place = (x) => {
		e.set(x[3], x[4], x[5]);
		const a = e.length();
		dq.setFromAxisAngle(a > 1e-9 ? e.divideScalar(a) : e.set(1, 0, 0), a);
		q.copy(dq).multiply(turn);
		// Turned about the point of the hand that touches, not about the wrist.
		wp.set(x[0], x[1], x[2]).add(on).sub(V.set(...seed.ref).applyQuaternion(q));
		const fingers = [];
		for (let i = 0; i < 16; i++) fingers.push(Math.min(HI[i % 4], Math.max(LO[i % 4], x[6 + i])));
		const thumb = [];
		for (let i = 0; i < 5; i++) thumb.push(Math.min(THI[i], Math.max(TLO[i], x[22 + i])));
		return { p: wp.toArray(), q: q.toArray(), elbow, fingers, thumb };
	};
	const mats = skel.bones.map(() => new Float64Array(12));
	const P = new Float64Array(3);
	const seg = new Map();
	const buf = new Float64Array(S.length);
	/** Share of the cost of sinking in: the first rounds may pass through the gun to get round it. */
	let soft = 1;
	const palmD = [];
	const thumbEnd = new Set(S.filter((s) => s.bone === 'thumb3').map((s) => s.vertex));
	const web = new Set(S.filter((s) => {
		V.fromBufferAttribute(pos, s.vertex).applyMatrix4(skel.boneInverses[boneIndex.get('hand')]);
		return (seed.side === 'r' ? V.x : -V.x) < -0.9 && V.z < -2.0 && V.z > -3.2 && !s.tip && (s.bone === 'hand' || s.bone === 'thumb1' || s.bone === 'index1');
	}).map((s) => s.vertex));
	const cost = (x) => {
		const h = place(x);
		hand.place(h);
		hand.group.updateMatrixWorld(true);
		skel.bones.forEach((bone, i) => {
			const m = bone.matrixWorld.elements;
			const t = mats[i];
			for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) t[r * 4 + c] = m[c * 4 + r];
		});
		let pen = 0;
		let deepest = 0;
		const tip = [9, 9, 9, 9, 9];
		const mid = [9, 9, 9, 9, 9];
		palmD.length = 0;
		let padX = 0, padY = 0, padZ = 0, padN = 0;
		let thX = 0, thY = 0, thZ = 0, webD = 9;
		for (let k = 0; k < S.length; k++) {
			const s = S[k];
			let px = 0, py = 0, pz = 0;
			for (let j = 0; j < s.bones.length; j += 5) {
				const t = mats[s.bones[j]], w = s.bones[j + 1], bx = s.bones[j + 2], by = s.bones[j + 3], bz = s.bones[j + 4];
				px += w * (t[0] * bx + t[1] * by + t[2] * bz + t[3]);
				py += w * (t[4] * bx + t[5] * by + t[6] * bz + t[7]);
				pz += w * (t[8] * bx + t[9] * by + t[10] * bz + t[11]);
			}
			const d = grid.at(px, py, pz);
			dist[k] = d;
			at[k * 3] = px;
			at[k * 3 + 1] = py;
			at[k * 3 + 2] = pz;
			if (d < 0.0) {
				pen += d * d;
				if (-d > deepest) deepest = -d;
			}
			const near = alone ? d : touch.at(px, py, pz);
			if (s.tip) {
				const f = tipNames.indexOf(s.tip);
				if (near < tip[f]) tip[f] = near;
			} else if (s.bone.endsWith('2')) {
				const f = tipNames.indexOf(s.bone.slice(0, -1));
				if (f >= 0 && near < mid[f]) mid[f] = near;
			}
			if (s.palm) palmD.push(near);
			if (thumbEnd.has(s.vertex)) {
				thX += px;
				thY += py;
				thZ += pz;
			}
			if (d < webD && web.has(s.vertex)) webD = d;
			if (pad.has(s.vertex)) {
				padX += px;
				padY += py;
				padZ += pz;
				padN++;
			}
		}
		// The faces near the gun.
		for (const f of faceList) {
			const [i, j, k] = f.c;
			if (Math.min(dist[i], dist[j], dist[k]) > 0.3) continue;
			for (let n = 0; n < f.w.length; n += 3) {
				const a = f.w[n], b = f.w[n + 1], c = f.w[n + 2];
				const d = grid.at(at[i * 3] * a + at[j * 3] * b + at[k * 3] * c, at[i * 3 + 1] * a + at[j * 3 + 1] * b + at[k * 3 + 1] * c, at[i * 3 + 2] * a + at[j * 3 + 2] * b + at[k * 3 + 2] * c);
				if (d < 0) {
					pen += d * d * 0.4;
					if (-d > deepest) deepest = -d;
				}
			}
		}
		const sq = (v) => v * v;
		const over = (v) => (v > 0 ? v * v : 0);
		let c = soft * (1.2 * pen + 300 * over(deepest - 0.045));
		for (let f = 0; f < 5; f++) {
			const must = seed.touch.includes(tipNames[f]);
			c += (must ? 30 : 0.15) * over(tip[f] - 0.04);
			if (must && f < 4 && !(f === 0 && seed.trigger) && !seed.around && !(tipNames[f] in (seed.pads ?? {}))) c += 1.5 * over(mid[f] - 0.12);
		}
		if (seed.touch.includes('palm')) {
			palmD.sort((a, z) => a - z);
			c += 30 * over(palmD[4] - 0.05) + 5 * over(palmD[Math.floor(palmD.length * 0.12)] - 0.12) + 1.0 * over(palmD[Math.floor(palmD.length * 0.4)] - 0.35);
		}
		if (seed.trigger && padN) c += 10 * over(Math.hypot(padX / padN - seed.trigger[0], padY / padN - seed.trigger[1], padZ / padN - seed.trigger[2]) - 0.18);
		if (seed.thumbTo) {
			const n = thumbEnd.size;
			c += (seed.thumbWeight ?? 6) * over(Math.hypot(thX / n - seed.thumbTo[0], thY / n - seed.thumbTo[1], thZ / n - seed.thumbTo[2]) - 0.8);
		}
		if (seed.web) c += 10 * over(webD - 0.1);
		// The fingers across the front of the grip, past its middle.
		if (seed.across !== undefined) for (const f of ['middle', 'ring', 'pinky']) c += 10 * over(padAt(f)[0] - seed.across - (f === 'pinky' ? 0.35 : 0.1));
		if (seed.palmNear !== undefined) {
			let near = 9;
			for (const d of palmD) if (d < near) near = d;
			c += 4 * over(near - seed.palmNear);
		}
		// The pads on their places.
		for (const f in seed.pads ?? {}) c += 10 * over(Math.hypot(...add(padAt(f), seed.pads[f], -1)) - 0.3);
		// Round a knob: the thumb across from the fingers.
		if (seed.around) {
			const axis = unit(seed.around.axis);
			const from = (f) => {
				const v = add(padAt(f), seed.around.at, -1);
				return unit(add(v, axis, -dot(v, axis)));
			};
			const t = from('thumb');
			for (const f of seed.around.fingers) c += 3 * over(dot(t, from(f)) + 0.45);
		}
		// Joints: limits, natural bends, the fingers alike.
		for (let i = 0; i < 16; i++) c += 25 * (over(x[6 + i] - HI[i % 4]) + over(LO[i % 4] - x[6 + i]));
		for (let i = 0; i < 5; i++) c += 25 * (over(x[22 + i] - THI[i]) + over(TLO[i] - x[22 + i])) + 0.25 * sq(x[22 + i] - natural[22 + i]);
		for (let f = 0; f < 4; f++) {
			const a = 6 + f * 4;
			c += 1.5 * sq(x[a]) + 0.4 * sq(x[a + 3] - 0.6 * x[a + 2]) + (seed.hold ?? 0.05) * (sq(x[a + 1] - natural[a + 1]) + sq(x[a + 2] - natural[a + 2]));
			// A finger with nothing to hold keeps its seed shape.
			if (!seed.touch.includes(tipNames[f])) c += 1.2 * (sq(x[a + 1] - natural[a + 1]) + sq(x[a + 2] - natural[a + 2]));
			if (f > 0 && f < 3) c += 0.25 * (sq(x[a + 1] - x[a + 5]) + sq(x[a + 2] - x[a + 6]));
		}
		// The wrist near its seed, not bent too far from the forearm.
		c += (seed.keep ?? 0.12) * (sq(x[0]) + sq(x[1]) + sq(x[2])) + 1.2 * (sq(x[3]) + sq(x[4]) + sq(x[5]));
		V.set(...h.elbow).sub(wp).normalize();
		const bend = Math.acos(Math.min(1, Math.max(-1, V.dot(e.set(0, 0, 1).applyQuaternion(q)))));
		c += (seed.maxBend === undefined ? 8 : 24) * over(bend - (seed.maxBend ?? 0.75)) + (seed.straighter ?? 0) * over(bend - 0.3);
		for (const t of moves.slice(1)) {
			// Where the part has gone the forearm still comes from its elbow.
			V.copy(wp).applyMatrix4(t);
			e.set(...h.elbow).sub(V).normalize();
			const turned = V.set(0, 0, 1).applyQuaternion(q).transformDirection(t);
			c += 3 * over(Math.acos(Math.min(1, Math.max(-1, turned.dot(e)))) - 0.95);
		}
		// The forearm and the cuff beside the gun.
		V.set(...h.elbow).sub(wp).normalize();
		for (const t of [1.5, 3, 4.5, 6, 7.5]) c += 6 * over(1.75 - grid.at(wp.x + V.x * t, wp.y + V.y * t, wp.z + V.z * t));
		// Fingers through each other.
		const ends = (f, i) => {
			const bone = skel.bones[boneIndex.get(tipNames[f] + (i + 1))].matrixWorld.elements;
			const a = [bone[12], bone[13], bone[14]];
			if (i < 2) {
				const n = skel.bones[boneIndex.get(tipNames[f] + (i + 2))].matrixWorld.elements;
				return [a, [n[12], n[13], n[14]]];
			}
			const t = TIPS[tipNames[f]];
			V.set(seed.side === 'l' ? -t[0] : t[0], t[1], t[2]).multiplyScalar(0.72).applyMatrix4(skel.bones[boneIndex.get(tipNames[f] + '3')].matrixWorld);
			return [a, [V.x, V.y, V.z]];
		};
		const caps = tipNames.map((_, f) => [0, 1, 2].map((i) => ends(f, i)));
		for (let f = 0; f < 5; f++)
			for (let g = f + 1; g < 5; g++)
				for (let i = 0; i < 3; i++)
					for (let j = 0; j < 3; j++) {
						if (f < 4 && g < 4 && (g > f + 1 || i === 0 || j === 0)) continue;
						if (g === 4 && j === 0) continue;
						const r = RADII[tipNames[f]][i] + RADII[tipNames[g]][j] - (g === 4 ? 0.12 : 0.2);
						c += 12 * over(r - segments(caps[f][i], caps[g][j]));
					}
		return c;
	};
	let best = null;
	for (let k = 0; k < (seed.tries ?? 6); k++) {
		const x0 = start.slice();
		if (k) {
			const r = rng(seedNumber + k * 77);
			for (let i = 0; i < x0.length; i++) x0[i] += r() * steps[i] * 0.5;
		}
		let x = x0;
		// Every other round starts solid: a soft start finds the way round the gun, or gets stuck in it.
		for (const [share, generations] of k % 2 ? [[0.03, 110], [0.2, 90], [1, 220]] : [[1, 300]]) {
			soft = share;
			x = cmaes(cost, x, share < 1 ? steps : steps.map((v) => v * 0.6), { generations, lambda: 20, seed: seedNumber + k }).x;
		}
		const r = { x, y: cost(x) };
		if (!best || r.y < best.y) best = r;
	}
	best = cmaes(cost, best.x, steps.map((v) => v * 0.25), { generations: 420, lambda: 24, seed: seedNumber + 99 });
	const h = place(best.x);
	hand.place(h);
	hand.group.updateMatrixWorld(true);
	const all = handSamples(hand.mesh, 0.12);
	const out = new Float32Array(pos.count * 3);
	skel.update();
	for (let i = 0; i < pos.count; i++) hand.mesh.getVertexPosition(i, V).applyMatrix4(hand.mesh.matrixWorld).toArray(out, i * 3);
	const m = measure(gun.solid, all, out);
	if (seed.part) {
		// The deepest of every state.
		const r = gun.moving(seed.part, seed.states);
		r.moves.slice(1).forEach((t) => {
			const other = measure(new Solid(moved(r.rest, t.clone().invert())), all, out);
			m.depth = Math.max(m.depth, other.depth);
			m.arm = Math.max(m.arm, other.arm);
		});
		const own = measure(touch.solid, all, out);
		m.gaps = own.gaps;
	}
	V.set(...h.elbow).sub(new THREE.Vector3(...h.p)).normalize();
	const bend = Math.acos(V.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...h.q))));
	hand.dispose();
	return { h, m, cost: best.y, bend };
}

function segments([a, b], [c, d]) {
	const u = add(b, a, -1), v = add(d, c, -1), w = add(a, c, -1);
	const A = dot(u, u), B = dot(u, v), C = dot(v, v), D = dot(u, w), E = dot(v, w);
	const den = A * C - B * B;
	const cl = (t) => Math.min(1, Math.max(0, t));
	let s = den > 1e-9 ? cl((B * E - C * D) / den) : 0;
	const t = cl((B * s + E) / C);
	s = cl((B * t - D) / A);
	return Math.hypot(...w.map((k, i) => k + u[i] * s - v[i] * t));
}

const round = (v, d = 4) => Number(v.toFixed(d));

async function solveWeapon(id, only) {
	const kit = HandKit.from(await shipped(HANDS_URL));
	if (!kit) throw new Error('no hand file');
	const gun = await gunOf(id);
	const def = SEEDS[id];
	// Only the pistol brings the two hands together.
	gun.withRight = id === 'pistol' ? await withRightHand(gun, kit, def) : gun.solid;
	const poses = {};
	let n = 0;
	for (const [name, seed] of Object.entries(def.poses)) {
		n++;
		if (only && !only.includes(name)) continue;
		const t = Date.now();
		let r = null;
		(seed.alts ?? [{}]).forEach((alt, i) => {
			const s = solvePose(gun, kit, name, { ...seed, ...alt }, def.elbow[seed.side], 1000 + n * 10 + i * 100);
			if (process.env.ALTS) process.stderr.write(id + ' ' + name + ' alt ' + i + ' cost ' + s.cost.toFixed(3) + ' deep ' + s.m.depth.toFixed(3) + ' gaps ' + JSON.stringify(Object.fromEntries(Object.entries(s.m.gaps).map(([k, v]) => [k, Number(v.toFixed(2))]))) + ' wrist ' + Math.round((s.bend * 180) / Math.PI) + '\n');
			if (!r || s.cost < r.cost) r = s;
		});
		const q = new THREE.Quaternion(...r.h.q), p = new THREE.Vector3(...r.h.p);
		if (seed.at) {
			const f = gun.frame(seed.at);
			p.sub(f.p).applyQuaternion(f.q.clone().invert());
			q.premultiply(f.q.clone().invert());
		}
		poses[name] = { side: seed.side, at: seed.at, p: p.toArray().map((v) => round(v)), q: q.toArray().map((v) => round(v, 5)), fingers: r.h.fingers.map((v) => round(v)), thumb: r.h.thumb.map((v) => round(v)) };
		const g = Object.entries(r.m.gaps).map(([k, v]) => k[0] + (k === 'palm' ? 'lm' : '') + ' ' + v.toFixed(3)).join('  ');
		process.stderr.write(id.padEnd(8) + name.padEnd(9) + ' cost ' + r.cost.toFixed(3).padStart(8) + '  deep ' + r.m.depth.toFixed(3) + ' ' + r.m.deepest.padEnd(8) + ' gaps ' + g + '  arm ' + r.m.arm.toFixed(2) + '  wrist ' + Math.round((r.bend * 180) / Math.PI) + ' deg  ' + ((Date.now() - t) / 1000).toFixed(0) + ' s\n');
	}
	return { elbow: def.elbow, rest: def.rest, poses };
}

const args = process.argv.slice(2);
if (args[0] === '--one') {
	const only = args[2] ? args[2].split(',') : null;
	process.stdout.write(JSON.stringify(await solveWeapon(args[1], only)));
} else {
	const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
	const ids = args.filter((a) => a in SEEDS);
	const want = ids.length ? ids : Object.keys(SEEDS);
	const file = fileURLToPath(new URL('hand-pose-data.ts', src));
	const { HAND_POSE_DATA } = await load('hand-pose-data.ts');
	const data = structuredClone(HAND_POSE_DATA);
	// 'lmg.bolt' names one pose of one weapon.
	const named = args.filter((a) => /^\w+\.\w+$/.test(a)).map((a) => a.split('.'));
	const queue = named.length && !ids.length ? named : want.flatMap((id) => Object.keys(SEEDS[id].poses).filter((p) => !only || only.split(',').includes(p)).map((p) => [id, p])).concat(named);
	const run = async () => {
		for (let job; (job = queue.shift()); ) {
			const [id, pose] = job;
			const out = await new Promise((ok, fail) => {
				const c = spawn(process.execPath, ['--no-warnings', '--experimental-transform-types', fileURLToPath(import.meta.url), '--one', id, pose], { stdio: ['ignore', 'pipe', 'inherit'] });
				let s = '';
				c.stdout.on('data', (b) => (s += b));
				c.on('close', (code) => (code ? fail(new Error(id + ' ' + pose + ' failed')) : ok(JSON.parse(s))));
			});
			const old = data[id]?.poses ?? {};
			const poses = {};
			for (const n of Object.keys(SEEDS[id].poses)) if (out.poses[n] ?? old[n]) poses[n] = out.poses[n] ?? old[n];
			data[id] = { elbow: out.elbow, rest: out.rest, poses };
		}
	};
	await Promise.all(Array.from({ length: Math.min(availableParallelism(), queue.length) }, run));
	if (!args.includes('--print')) {
		const line = (o) => JSON.stringify(o).replace(/"([a-z_]+)":/g, '$1: ').replace(/"/g, "'").replace(/,(?=\S)/g, ', ');
		let t = "/** Written by tools/models/procedural/fit_hands.mjs: do not edit by hand. */\nimport type { WeaponId } from '@surf/shared';\nimport type { WeaponHands } from './hand-poses.js';\n\nexport const HAND_POSE_DATA: Readonly<Partial<Record<WeaponId, WeaponHands>>> = {\n";
		t += Object.keys(SEEDS).filter((id) => data[id]).map((id) => {
			const d = data[id];
			return '\t' + id + ': {\n\t\telbow: ' + line(d.elbow) + ',\n\t\trest: ' + line(d.rest) + ',\n\t\tposes: {\n' + Object.entries(d.poses).map(([n, p]) => '\t\t\t' + n + ': ' + line(p)).join(',\n') + '\n\t\t}\n\t}';
		}).join(',\n');
		writeFileSync(file, t + '\n};\n');
	}
}
