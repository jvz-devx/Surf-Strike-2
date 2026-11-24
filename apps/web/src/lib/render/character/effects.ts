/**
 * Body effects (docs/characters.md#effects): an aura or flames over a whole
 * character. Two draw calls per wearer: a glowing shell that shares the
 * character's geometry and skeleton, and instanced flame quads that hang on the
 * bones. Everything moves on the GPU from one clock.
 *
 * Both are drawn premultiplied (`solid` 0: pure light, 1: opaque smoke), so
 * black and gray work like the bright colours.
 */
import * as THREE from 'three';
import { BONE_INDEX, BIND, SIDE_BONES, type BoneName, type V3 } from './skeleton.js';

export interface EffectDef {
	/** Inner and outer colour of shell and flames. */
	core: number;
	edge: number;
	/** 0 light, 1 smoke. */
	solid: number;
	/** Strength of the shell. */
	shell: number;
	/** Flame quads near the camera, their size (u), and their strength. */
	flames: number;
	size: number;
	strength: number;
}

const aura = (core: number, edge: number, o: Partial<EffectDef> = {}): EffectDef => ({ core, edge, solid: 0.4, shell: 0.68, flames: 34, size: 8.5, strength: 0.4, ...o });

/** Effect of every item in the `effect` slot. */
const EFFECTS: Readonly<Record<string, EffectDef>> = {
	effect_blue: aura(0x6ab8ff, 0x1450ff),
	effect_yellow: aura(0xfff08a, 0xffc400),
	effect_red: aura(0xff7a5c, 0xff1010),
	effect_purple: aura(0xc78bff, 0x7a14ff),
	effect_black: aura(0x08080a, 0x020203, { solid: 1, shell: 0.85, strength: 0.55 }),
	effect_orange: aura(0xffb45a, 0xff6a00),
	effect_pink: aura(0xffa8e0, 0xff2fa8),
	effect_white: aura(0xffffff, 0xcfe4ff, { shell: 0.55 }),
	effect_green: aura(0x9dff9a, 0x14d63a),
	effect_gray: aura(0xa6abb2, 0x5c6168, { solid: 0.85, strength: 0.4 }),
	effect_fire: { core: 0xffd24a, edge: 0xff3c00, solid: 0.6, shell: 0.6, flames: 84, size: 13, strength: 0.85 }
};

export function effectDef(id: string | null): EffectDef | null {
	return id !== null && Object.hasOwn(EFFECTS, id) ? EFFECTS[id]! : null;
}

/** Flames thin out beyond this, and are gone at the far distance (u). */
export const FLAME_NEAR = 700;
export const FLAME_FAR = 2400;
export const SHELL_FAR = 4000;

// ---------------------------------------------------------------------------
// Where flames start: bone, radius around it, and points along a segment (bind pose)

const SEGMENTS: { bone: BoneName; a: V3; b: V3; r: number; n: number }[] = (() => {
	const out: { bone: BoneName; a: V3; b: V3; r: number; n: number }[] = [
		{ bone: 'head', a: [-0.4, 63, 0], b: [-0.8, 70.5, 0], r: 4.4, n: 5 },
		{ bone: 'chest', a: [-0.3, 48, 0], b: [-0.3, 55, 0], r: 6.4, n: 6 },
		{ bone: 'spine', a: [-0.2, 42, 0], b: [-0.3, 48, 0], r: 5.6, n: 4 },
		{ bone: 'pelvis', a: [0, 35, 0], b: [0, 40, 0], r: 5.8, n: 4 }
	];
	const mid = (p: V3, q: V3): [V3, V3] => [p, q];
	for (const s of ['L', 'R'] as const) {
		const seg = (bone: (typeof SIDE_BONES)[number], to: (typeof SIDE_BONES)[number], r: number, n: number) => {
			const [a, b] = mid(BIND[`${bone}${s}`], BIND[`${to}${s}`]);
			out.push({ bone: `${bone}${s}`, a, b, r, n });
		};
		seg('upper', 'fore', 2.6, 3);
		seg('fore', 'hand', 2, 3);
		seg('hand', 'tips', 1.6, 1);
		seg('thigh', 'shin', 3.4, 4);
		seg('shin', 'foot', 2.6, 3);
		seg('foot', 'toe', 2, 1);
	}
	return out;
})();

/** Low-discrepancy, so the same wearer always burns the same way. */
const frac = (x: number) => x - Math.floor(x);

function flameGeometry(count: number): THREE.InstancedBufferGeometry {
	const slots: { bone: number; p: V3 }[] = [];
	for (let k = 0; slots.length < count; k++)
		for (const s of SEGMENTS)
			for (let i = 0; i < s.n; i++) {
				const j = slots.length;
				const t = frac(0.31 + j * 0.61803 + k * 0.17);
				const ang = frac(j * 0.75487) * Math.PI * 2;
				const r = s.r * (0.75 + 0.35 * frac(j * 0.56984));
				slots.push({
					bone: BONE_INDEX[s.bone],
					p: [s.a[0] + (s.b[0] - s.a[0]) * t + Math.cos(ang) * r, s.a[1] + (s.b[1] - s.a[1]) * t, s.a[2] + (s.b[2] - s.a[2]) * t + Math.sin(ang) * r]
				});
			}
	// Any first part of the list covers the whole body.
	const order = slots.map((_, i) => i).sort((x, y) => frac(x * 0.61803) - frac(y * 0.61803));
	const at = new Float32Array(count * 3);
	const si = new Float32Array(count * 4);
	const sw = new Float32Array(count * 4);
	const seed = new Float32Array(count * 2);
	for (let i = 0; i < count; i++) {
		const s = slots[order[i]!]!;
		at.set(s.p, i * 3);
		si[i * 4] = s.bone;
		sw[i * 4] = 1;
		seed[i * 2] = frac(i * 0.75487 + 0.13);
		seed[i * 2 + 1] = frac(i * 0.56984 + 0.71);
	}
	const g = new THREE.InstancedBufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
	g.setIndex([0, 1, 2, 0, 2, 3]);
	g.setAttribute('aAt', new THREE.InstancedBufferAttribute(at, 3));
	g.setAttribute('skinIndex', new THREE.InstancedBufferAttribute(si, 4));
	g.setAttribute('skinWeight', new THREE.InstancedBufferAttribute(sw, 4));
	g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 2));
	g.instanceCount = count;
	g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 42, 0), 70);
	return g;
}

// ---------------------------------------------------------------------------
// Shaders

const NOISE = /* glsl */ `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { return 0.6 * noise(p) + 0.3 * noise(p * 2.1 + 7.3) + 0.1 * noise(p * 4.3 + 1.7); }
`;

const SHELL_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
	#include <beginnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <begin_vertex>
	#include <skinning_vertex>
	vec3 n = normalize(objectNormal);
	float wave = sin(transformed.y * 0.55 - uTime * 5.0 + transformed.x) * sin(transformed.z * 0.6 + uTime * 3.1);
	transformed += n * (2.0 + 0.5 * wave);
	// Licks upwards, most at the top of shapes.
	transformed.y += max(0.0, n.y) * (0.8 + 0.6 * wave);
	vP = transformed;
	vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
	vN = normalMatrix * n;
	vV = -mv.xyz;
	// Behind the surface it grew from: no slivers of hems and cuffs.
	mv.z -= 1.6;
	gl_Position = projectionMatrix * mv;
}`;

const SHELL_FRAG = /* glsl */ `
#include <common>
uniform float uTime;
uniform float uFade;
uniform float uSolid;
uniform float uPower;
uniform vec3 uCore;
uniform vec3 uEdge;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
${NOISE}
void main() {
	float ndv = saturate(abs(dot(normalize(vN), normalize(vV))));
	// Back faces only: the body hides all but a halo around its outline, fading to the outer edge.
	float halo = smoothstep(0.02, 0.7, ndv);
	float ang = atan(vP.z, vP.x);
	float n = fbm(vec2(ang * 2.6 + vP.x * 0.12 + vP.z * 0.12, vP.y * 0.16 - uTime * 1.7));
	float flick = smoothstep(0.22, 0.75, n);
	float a = halo * (0.35 + 0.85 * flick) * uPower * uFade;
	vec3 c = mix(uEdge, uCore, flick * 0.8);
	gl_FragColor = vec4(c, 1.0);
	#include <colorspace_fragment>
	a = min(a, 1.0);
	gl_FragColor = vec4(gl_FragColor.rgb * a, a * uSolid);
}`;

const FLAME_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
attribute vec3 aAt;
attribute vec2 aSeed;
uniform float uTime;
uniform float uSize;
uniform vec3 uDrag;
varying vec2 vUv;
varying float vLife;
varying float vSeed;
void main() {
	float life = fract(uTime * (0.75 + 0.5 * aSeed.y) + aSeed.x);
	vec4 p = getBoneMatrix(skinIndex.x) * vec4(aAt, 1.0);
	vec4 w = modelMatrix * vec4(p.xyz, 1.0);
	float s = uSize * (0.6 + 0.7 * aSeed.y) * (0.55 + 0.45 * sin(3.14159 * min(1.0, life * 1.15)));
	w.y += life * uSize * 0.75;
	w.xz += 0.12 * uSize * life * vec2(sin(uTime * 4.0 + aSeed.x * 40.0), cos(uTime * 3.4 + aSeed.y * 40.0));
	w.xyz += uDrag * life;
	vec4 mv = viewMatrix * w;
	// Upright quads that lean with the drag, a little towards the camera so they lick over the body.
	vec3 up = (viewMatrix * vec4(normalize(vec3(uDrag.x, 9.0, uDrag.z)), 0.0)).xyz;
	mv.xyz += vec3(position.x * s * 0.72, 0.0, 0.0) + up * (position.y - 0.25) * s * 1.35;
	mv.z += 2.2;
	vUv = vec2(position.x + 0.5, position.y);
	vLife = life;
	vSeed = aSeed.x * 17.0;
	gl_Position = projectionMatrix * mv;
}`;

const FLAME_FRAG = /* glsl */ `
#include <common>
uniform float uTime;
uniform float uFade;
uniform float uSolid;
uniform float uPower;
uniform vec3 uCore;
uniform vec3 uEdge;
varying vec2 vUv;
varying float vLife;
varying float vSeed;
${NOISE}
void main() {
	vec2 uv = vUv;
	float n = fbm(vec2(uv.x * 2.6 + vSeed, uv.y * 2.2 - uTime * 2.3 + vSeed));
	// A tongue: wide at the bottom, torn towards the tip.
	float x = (uv.x - 0.5) * 2.0 + (n - 0.5) * 1.1 * uv.y;
	float width = mix(0.8, 0.06, pow(uv.y, 0.8)) * smoothstep(0.0, 0.16, uv.y);
	float body = smoothstep(width + 0.001, width * 0.25, abs(x)) * smoothstep(0.03, 0.2, uv.y);
	float tongue = body * smoothstep(0.18, 0.62, n + 0.55 * (1.0 - uv.y));
	float a = tongue * smoothstep(0.0, 0.18, vLife) * (1.0 - smoothstep(0.5, 1.0, vLife)) * uPower * uFade;
	if (a < 0.004) discard;
	float heat = saturate(tongue * (1.15 - uv.y) * (1.0 - 0.6 * vLife));
	vec3 c = mix(uEdge, uCore, smoothstep(0.2, 0.85, heat));
	gl_FragColor = vec4(c, 1.0);
	#include <colorspace_fragment>
	gl_FragColor = vec4(gl_FragColor.rgb * a, a * uSolid);
}`;

function effectMaterial(vertexShader: string, fragmentShader: string, d: EffectDef, power: number, side: THREE.Side): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		vertexShader,
		fragmentShader,
		side,
		transparent: true,
		depthWrite: false,
		blending: THREE.CustomBlending,
		blendSrc: THREE.OneFactor,
		blendDst: THREE.OneMinusSrcAlphaFactor,
		uniforms: {
			uTime: { value: 0 },
			uFade: { value: 1 },
			uSolid: { value: d.solid },
			uPower: { value: power },
			uSize: { value: d.size },
			uDrag: { value: new THREE.Vector3() },
			uCore: { value: new THREE.Color(d.core) },
			uEdge: { value: new THREE.Color(d.edge) }
		}
	});
}

/** Flames trail behind the movement by at most this much (u). */
const DRAG_MAX = 16;
let nextPhase = 0;

/** Effect on one character. Add `objects` next to its mesh. */
export class CharacterEffect {
	private readonly shell: THREE.SkinnedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
	private readonly flames: THREE.SkinnedMesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
	private readonly sphere = new THREE.Sphere(new THREE.Vector3(0, 42, 0), 70);
	private time: number;

	constructor(
		private readonly def: EffectDef,
		geometry: THREE.BufferGeometry,
		skeleton: THREE.Skeleton
	) {
		// Two wearers never flicker in step.
		this.time = (nextPhase = (nextPhase + 7.31) % 50);
		this.shell = new THREE.SkinnedMesh(geometry, effectMaterial(SHELL_VERT, SHELL_FRAG, def, def.shell, THREE.BackSide));
		this.flames = new THREE.SkinnedMesh(flameGeometry(def.flames), effectMaterial(FLAME_VERT, FLAME_FRAG, def, def.strength, THREE.DoubleSide));
		for (const m of this.objects) {
			m.bindMode = THREE.DetachedBindMode;
			m.bind(skeleton, new THREE.Matrix4());
			m.boundingSphere = this.sphere;
			m.renderOrder = 3;
		}
		this.flames.renderOrder = 4;
		this.shell.name = 'effect-shell';
		this.flames.name = 'effect-flames';
		this.sync();
	}

	get objects(): THREE.SkinnedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] {
		return [this.shell, this.flames];
	}

	/** The character's geometry changed (other clothes or LOD). */
	setGeometry(g: THREE.BufferGeometry): void {
		this.shell.geometry = g;
	}

	/** `vx, vy, vz`: velocity in Source axes; `dist` to the camera. */
	update(dt: number, dist: number, vx: number, vy: number, vz: number): void {
		// Wrapped where nothing shows it: the noise only sees small numbers.
		this.time = (this.time + dt) % 600;
		const near = 1 - THREE.MathUtils.smoothstep(dist, FLAME_NEAR, FLAME_FAR);
		this.flames.visible = near > 0.02;
		this.shell.visible = dist < SHELL_FAR;
		this.flames.geometry.instanceCount = Math.max(4, Math.round(this.def.flames * Math.max(0.35, near)));
		this.flames.material.uniforms.uFade!.value = Math.min(1, near * 2);
		this.shell.material.uniforms.uFade!.value = 1 - THREE.MathUtils.smoothstep(dist, SHELL_FAR * 0.6, SHELL_FAR);
		const drag = this.flames.material.uniforms.uDrag!.value as THREE.Vector3;
		drag.set(-vx, -vz, vy).multiplyScalar(0.03);
		if (drag.lengthSq() > DRAG_MAX * DRAG_MAX) drag.setLength(DRAG_MAX);
		this.sync();
	}

	private sync(): void {
		for (const m of this.objects) m.material.uniforms.uTime!.value = this.time;
	}

	dispose(): void {
		for (const m of this.objects) {
			m.removeFromParent();
			m.material.dispose();
		}
		// The shell's geometry belongs to the character.
		this.flames.geometry.dispose();
	}
}
