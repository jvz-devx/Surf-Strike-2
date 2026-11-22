/**
 * Procedural brush materials (docs/maps.md): triplanar value-noise albedo,
 * top colour on walkable faces (normal z >= 0.7), emissive seam cracks.
 * Lighting uniforms are shared objects so a theme change updates every material.
 */
import type { MaterialDef, Theme } from '@surf/shared';
import * as THREE from 'three';
import { toThree } from './coords.js';

export interface SharedUniforms {
	uSunDir: { value: THREE.Vector3 };
	uSunColor: { value: THREE.Color };
	uSunIntensity: { value: number };
	uSkyColor: { value: THREE.Color };
	uGroundColor: { value: THREE.Color };
	uAmbient: { value: number };
	uTime: { value: number };
}

export function createSharedUniforms(): SharedUniforms {
	return {
		uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
		uSunColor: { value: new THREE.Color(0xffffff) },
		uSunIntensity: { value: 1 },
		uSkyColor: { value: new THREE.Color(0x8899bb) },
		uGroundColor: { value: new THREE.Color(0x332211) },
		uAmbient: { value: 0.6 },
		uTime: { value: 0 }
	};
}

export function applyTheme(u: SharedUniforms, theme: Theme): void {
	toThree(theme.sunDir, u.uSunDir.value);
	if (u.uSunDir.value.lengthSq() < 1e-6) u.uSunDir.value.set(0, 1, 0);
	u.uSunDir.value.normalize();
	u.uSunColor.value.setHex(theme.sunColor);
	u.uSunIntensity.value = theme.sunIntensity;
	u.uSkyColor.value.setHex(theme.ambientSky);
	u.uGroundColor.value.setHex(theme.ambientGround);
	u.uAmbient.value = theme.ambientIntensity;
}

/** GLSL noise helpers shared by several shaders. */
export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	float a = hash12(i);
	float b = hash12(i + vec2(1.0, 0.0));
	float c = hash12(i + vec2(0.0, 1.0));
	float d = hash12(i + vec2(1.0, 1.0));
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
	float s = 0.0;
	float a = 0.5;
	for (int i = 0; i < 4; i++) {
		s += a * vnoise(p);
		p = p * 2.03 + vec2(17.1, 9.7);
		a *= 0.5;
	}
	return s / 0.9375;
}
`;

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
	vec4 wp = modelMatrix * vec4(position, 1.0);
	vWorldPos = wp.xyz;
	vNormal = normalize(mat3(modelMatrix) * normal);
	vec4 mvPosition = viewMatrix * wp;
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uTopColor;
uniform vec3 uSeamColor;
uniform float uSeam;
uniform float uNoise;
uniform float uNoiseScale;
uniform float uRoughness;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform float uAmbient;
uniform float uTime;
uniform float uOpacity;
uniform float uGlass;
varying vec3 vWorldPos;
varying vec3 vNormal;
#include <common>
#include <fog_pars_fragment>
${NOISE_GLSL}
float tri(vec3 p, vec3 w) {
	return fbm(p.zy) * w.x + fbm(p.xz) * w.y + fbm(p.xy) * w.z;
}
void main() {
	vec3 n = normalize(vNormal);
	if (uGlass > 0.5 && !gl_FrontFacing) n = -n;
	vec3 w = pow(abs(n), vec3(4.0));
	w /= (w.x + w.y + w.z);
	vec3 p = vWorldPos / uNoiseScale;
	float nz = tri(p, w);
	float fine = tri(p * 7.0 + 11.0, w);
	vec3 base = mix(uColor, uTopColor, step(0.7, n.y));
	base *= clamp(1.0 + (nz - 0.5) * 2.0 * uNoise + (fine - 0.5) * uNoise * 0.7, 0.0, 2.0);

	vec3 amb = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5) * uAmbient;
	float ndl = max(dot(n, uSunDir), 0.0);
	vec3 col = base * (amb + uSunColor * uSunIntensity * ndl);

	vec3 v = normalize(cameraPosition - vWorldPos);
	vec3 h = normalize(v + uSunDir);
	float shin = mix(80.0, 6.0, uRoughness);
	col += uSunColor * uSunIntensity * pow(max(dot(n, h), 0.0), shin) * (1.0 - uRoughness) * 0.6 * ndl;

	if (uSeam > 0.5) {
		float c = tri(p * 1.6 + 3.7, w);
		float crack = 1.0 - smoothstep(0.0, 0.03, abs(c - 0.5));
		float pulse = 0.7 + 0.3 * sin(uTime * 1.6 + c * 25.0);
		col = mix(col, uSeamColor * 1.5, crack * pulse);
	}
	float alpha = uOpacity;
	if (uGlass > 0.5) {
		// Glass: bright fresnel rim so panels read against the sky; more opaque at grazing angles.
		float fr = pow(1.0 - abs(dot(n, v)), 3.0);
		col += mix(uTopColor, vec3(1.0), 0.5) * fr * 0.8;
		alpha = clamp(uOpacity + fr * 0.45, 0.0, 0.9);
	}
	gl_FragColor = vec4(col, alpha);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}
`;

export const DEFAULT_MATERIAL: MaterialDef = { color: 0x8a8f99, noise: 0.15 };

/** Opacity a material is drawn with: `opacity`, else 0.3 for glass, else 1 (opaque). */
export function materialOpacity(def: MaterialDef): number {
	return Math.min(1, Math.max(0, def.opacity ?? (def.glass ? 0.3 : 1)));
}

export function createBrushMaterial(def: MaterialDef, shared: SharedUniforms): THREE.ShaderMaterial {
	const opacity = materialOpacity(def);
	const see = opacity < 1;
	const uniforms = {
		...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
		...shared,
		uColor: { value: new THREE.Color(def.color) },
		uTopColor: { value: new THREE.Color(def.topColor ?? def.color) },
		uSeamColor: { value: new THREE.Color(def.seamColor ?? 0) },
		uSeam: { value: def.seamColor !== undefined ? 1 : 0 },
		uNoise: { value: def.noise ?? 0.15 },
		uNoiseScale: { value: Math.max(1, def.noiseScale ?? 256) },
		uRoughness: { value: Math.min(1, Math.max(0, def.roughness ?? 0.8)) },
		uOpacity: { value: opacity },
		uGlass: { value: def.glass ? 1 : 0 }
	};
	return new THREE.ShaderMaterial({
		uniforms,
		vertexShader: VERT,
		fragmentShader: FRAG,
		fog: true,
		// See-through materials (glass): blended after opaque geometry, both sides, no depth write.
		...(see ? { transparent: true, depthWrite: false, side: THREE.DoubleSide } : {})
	});
}
