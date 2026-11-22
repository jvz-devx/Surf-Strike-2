/**
 * Theme effects (maps/types.ts Theme.effects): aurora ribbons, embers,
 * clouds, grid floor, lava sea, snow floor. All procedural, animated by the
 * shared `uTime` uniform; nothing allocates per frame.
 */
import type { Theme, Vec3 } from '@surf/shared';
import * as THREE from 'three';
import { createBrushMaterial, NOISE_GLSL, type SharedUniforms } from './materials.js';

export interface Effects {
	group: THREE.Group;
	update(timeSec: number): void;
	dispose(): void;
}

type EffectDef = Theme['effects'][number];

/** Small deterministic RNG so effects look the same on every load. */
function rng(seed: number): () => number {
	let s = seed >>> 0 || 1;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

const FOG_VERT_HEAD = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorldPos;
`;
const FOG_VERT_BODY = /* glsl */ `
	vec4 wp = modelMatrix * vec4(position, 1.0);
	vWorldPos = wp.xyz;
	vec4 mvPosition = viewMatrix * wp;
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
`;
const FRAG_TAIL = /* glsl */ `
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
`;

function floorPlane(size: number, center: Vec3, z: number): THREE.PlaneGeometry {
	const g = new THREE.PlaneGeometry(size, size, 1, 1);
	g.rotateX(-Math.PI / 2);
	g.translate(center.x, z, -center.y);
	return g;
}

function gridFloor(e: Extract<EffectDef, { type: 'gridFloor' }>, center: Vec3, shared: SharedUniforms) {
	const geo = floorPlane(e.size, center, e.z);
	const mat = new THREE.ShaderMaterial({
		uniforms: {
			...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
			uColor: { value: new THREE.Color(e.color) },
			uTime: shared.uTime
		},
		vertexShader: `${FOG_VERT_HEAD} void main() { ${FOG_VERT_BODY} }`,
		fragmentShader: /* glsl */ `
			uniform vec3 uColor;
			uniform float uTime;
			varying vec3 vWorldPos;
			#include <common>
			#include <fog_pars_fragment>
			float grid(vec2 p, float cell) {
				vec2 q = p / cell;
				vec2 g = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-4));
				return 1.0 - min(min(g.x, g.y), 1.0);
			}
			void main() {
				vec2 p = vWorldPos.xz;
				float minor = grid(p, 128.0);
				float major = grid(p, 1024.0);
				float dist = length(cameraPosition.xz - p);
				float fade = 1.0 - smoothstep(3000.0, 24000.0, dist);
				float pulse = 0.75 + 0.25 * sin(uTime * 0.8 - dist * 0.0015);
				vec3 col = uColor * 0.03 + uColor * (minor * 0.35 + major * 0.9) * fade * pulse;
				gl_FragColor = vec4(col, 1.0);
				${FRAG_TAIL}
			}`,
		fog: true
	});
	return new THREE.Mesh(geo, mat);
}

function lavaSea(e: Extract<EffectDef, { type: 'lavaSea' }>, center: Vec3, shared: SharedUniforms) {
	const geo = floorPlane(e.size, center, e.z);
	const mat = new THREE.ShaderMaterial({
		uniforms: {
			...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
			uColor: { value: new THREE.Color(e.color) },
			uTime: shared.uTime
		},
		vertexShader: `${FOG_VERT_HEAD} void main() { ${FOG_VERT_BODY} }`,
		fragmentShader: /* glsl */ `
			uniform vec3 uColor;
			uniform float uTime;
			varying vec3 vWorldPos;
			#include <common>
			#include <fog_pars_fragment>
			${NOISE_GLSL}
			void main() {
				vec2 p = vWorldPos.xz / 700.0;
				float t = uTime * 0.05;
				float n = fbm(p + vec2(t, -t * 0.7) + fbm(p * 0.5 - t) * 1.5);
				float crust = smoothstep(0.42, 0.62, n);
				float hot = pow(1.0 - crust, 2.0);
				float pulse = 0.85 + 0.15 * sin(uTime * 1.3 + n * 12.0);
				vec3 col = mix(uColor * 1.8 * pulse, uColor * 0.05, crust) + vec3(1.0, 0.85, 0.4) * hot * 0.25;
				gl_FragColor = vec4(col, 1.0);
				${FRAG_TAIL}
			}`,
		fog: true
	});
	return new THREE.Mesh(geo, mat);
}

function snowFloor(e: Extract<EffectDef, { type: 'snowFloor' }>, center: Vec3, shared: SharedUniforms) {
	const geo = floorPlane(e.size, center, e.z);
	const mat = createBrushMaterial({ color: e.color, noise: 0.08, noiseScale: 900, roughness: 0.6 }, shared);
	return new THREE.Mesh(geo, mat);
}

function aurora(e: Extract<EffectDef, { type: 'aurora' }>, center: Vec3, shared: SharedUniforms) {
	const group = new THREE.Group();
	const colors = e.colors.length ? e.colors : [0x5cffb0, 0x7a6bff];
	const geo = new THREE.PlaneGeometry(40000, 5000, 200, 1);
	geo.translate(0, 2500, 0);
	const mats: THREE.ShaderMaterial[] = [];
	colors.forEach((c, i) => {
		const mat = new THREE.ShaderMaterial({
			uniforms: {
				uColor: { value: new THREE.Color(c) },
				uTime: shared.uTime,
				uSeed: { value: i * 1.37 + 0.5 }
			},
			vertexShader: /* glsl */ `
				uniform float uTime;
				uniform float uSeed;
				varying vec2 vUv;
				void main() {
					vUv = uv;
					vec3 p = position;
					float x = p.x;
					p.z += sin(x * 0.00025 + uSeed * 2.0 + uTime * 0.04) * 3000.0
						+ sin(x * 0.0011 + uTime * 0.11 + uSeed) * 500.0;
					p.y += sin(x * 0.0006 + uTime * 0.07 + uSeed * 3.0) * 600.0 * uv.y;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
				}`,
			fragmentShader: /* glsl */ `
				uniform vec3 uColor;
				uniform float uTime;
				uniform float uSeed;
				varying vec2 vUv;
				${NOISE_GLSL}
				void main() {
					float y = vUv.y;
					float a = smoothstep(0.0, 0.12, y) * pow(1.0 - y, 1.6);
					float bands = fbm(vec2(vUv.x * 60.0 + uTime * 0.15 + uSeed * 10.0, uTime * 0.05));
					float edge = 1.0 - smoothstep(0.0, 0.08, abs(vUv.x - 0.5) - 0.42);
					a *= mix(0.25, 1.0, bands) * edge * 0.55;
					vec3 col = mix(uColor, uColor.zxy * 0.8 + 0.2, y * 0.6);
					gl_FragColor = vec4(col, a);
					#include <colorspace_fragment>
				}`,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			blending: THREE.AdditiveBlending,
			fog: false
		});
		mats.push(mat);
		const m = new THREE.Mesh(geo, mat);
		m.frustumCulled = false;
		const ang = i * 0.9 - 0.4;
		m.rotation.y = ang;
		m.position.set(center.x + Math.sin(ang) * (9000 + i * 2500), e.height, -center.y - Math.cos(ang) * (9000 + i * 2500));
		group.add(m);
	});
	return {
		obj: group,
		dispose: () => {
			geo.dispose();
			for (const m of mats) m.dispose();
		}
	};
}

function embers(e: Extract<EffectDef, { type: 'embers' }>, shared: SharedUniforms) {
	const r = rng(7);
	const n = Math.max(1, Math.min(20000, Math.floor(e.count)));
	const pos = new Float32Array(n * 3);
	const seed = new Float32Array(n);
	const { min, max } = e.area;
	for (let i = 0; i < n; i++) {
		const x = min.x + (max.x - min.x) * r();
		const y = min.y + (max.y - min.y) * r();
		const z = min.z + (max.z - min.z) * r();
		pos[i * 3] = x;
		pos[i * 3 + 1] = z;
		pos[i * 3 + 2] = -y;
		seed[i] = r();
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
	const mat = new THREE.ShaderMaterial({
		uniforms: {
			uColor: { value: new THREE.Color(e.color) },
			uTime: shared.uTime,
			uMinY: { value: min.z },
			uHeight: { value: Math.max(1, max.z - min.z) }
		},
		vertexShader: /* glsl */ `
			uniform float uTime;
			uniform float uMinY;
			uniform float uHeight;
			attribute float aSeed;
			varying float vAlpha;
			void main() {
				vec3 p = position;
				float speed = 30.0 + aSeed * 90.0;
				float h = mod(p.y - uMinY + uTime * speed, uHeight);
				p.y = uMinY + h;
				p.x += sin(uTime * 0.7 + aSeed * 40.0) * 70.0;
				p.z += cos(uTime * 0.55 + aSeed * 31.0) * 70.0;
				vec4 mv = modelViewMatrix * vec4(p, 1.0);
				gl_Position = projectionMatrix * mv;
				gl_PointSize = clamp((6.0 + aSeed * 10.0) * 400.0 / max(-mv.z, 1.0), 1.0, 24.0);
				float fl = 0.55 + 0.45 * sin(uTime * (4.0 + aSeed * 5.0) + aSeed * 100.0);
				vAlpha = fl * (1.0 - h / uHeight) * smoothstep(0.0, 0.08, h / uHeight);
			}`,
		fragmentShader: /* glsl */ `
			uniform vec3 uColor;
			varying float vAlpha;
			void main() {
				float d = length(gl_PointCoord - 0.5);
				float a = smoothstep(0.5, 0.0, d) * vAlpha;
				gl_FragColor = vec4(uColor * 1.6, a);
				#include <colorspace_fragment>
			}`,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending
	});
	const pts = new THREE.Points(geo, mat);
	pts.frustumCulled = false;
	return { obj: pts, dispose: () => (geo.dispose(), mat.dispose()) };
}

function clouds(e: Extract<EffectDef, { type: 'clouds' }>, center: Vec3) {
	const r = rng(13);
	const count = Math.max(1, Math.min(400, Math.floor(e.count)));
	const puffs = 6;
	const geo = new THREE.IcosahedronGeometry(1, 1);
	const mat = new THREE.MeshLambertMaterial({
		color: e.color,
		flatShading: true,
		transparent: true,
		opacity: 0.92,
		emissive: new THREE.Color(e.color).multiplyScalar(0.35)
	});
	const mesh = new THREE.InstancedMesh(geo, mat, count * puffs);
	const m = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const s = new THREE.Vector3();
	const p = new THREE.Vector3();
	let k = 0;
	for (let c = 0; c < count; c++) {
		const ang = r() * Math.PI * 2;
		const rad = 2500 + r() * 16000;
		const cx = Math.cos(ang) * rad;
		const cz = Math.sin(ang) * rad;
		const cy = e.height + (r() - 0.5) * 600;
		for (let i = 0; i < puffs; i++) {
			const size = 250 + r() * 450;
			p.set(cx + (r() - 0.5) * 1400, cy + (r() - 0.3) * 200, cz + (r() - 0.5) * 900);
			s.set(size * 1.3, size * 0.6, size);
			q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r() * Math.PI);
			m.compose(p, q, s);
			mesh.setMatrixAt(k++, m);
		}
	}
	mesh.instanceMatrix.needsUpdate = true;
	mesh.frustumCulled = false;
	const group = new THREE.Group();
	group.position.set(center.x, 0, -center.y);
	group.add(mesh);
	return {
		obj: group,
		spin: group,
		dispose: () => {
			geo.dispose();
			mat.dispose();
			mesh.dispose();
		}
	};
}

export function buildEffects(theme: Theme, center: Vec3, shared: SharedUniforms): Effects {
	const group = new THREE.Group();
	group.name = 'effects';
	const disposers: Array<() => void> = [];
	const spinners: THREE.Object3D[] = [];

	for (const e of theme.effects ?? []) {
		switch (e.type) {
			case 'gridFloor':
			case 'lavaSea':
			case 'snowFloor': {
				const mesh =
					e.type === 'gridFloor'
						? gridFloor(e, center, shared)
						: e.type === 'lavaSea'
							? lavaSea(e, center, shared)
							: snowFloor(e, center, shared);
				group.add(mesh);
				disposers.push(() => {
					mesh.geometry.dispose();
					(mesh.material as THREE.Material).dispose();
				});
				break;
			}
			case 'aurora': {
				const a = aurora(e, center, shared);
				group.add(a.obj);
				disposers.push(a.dispose);
				break;
			}
			case 'embers': {
				const em = embers(e, shared);
				group.add(em.obj);
				disposers.push(em.dispose);
				break;
			}
			case 'clouds': {
				const c = clouds(e, center);
				group.add(c.obj);
				spinners.push(c.spin);
				disposers.push(c.dispose);
				break;
			}
		}
	}

	return {
		group,
		update(t) {
			for (const s of spinners) s.rotation.y = t * 0.004;
		},
		dispose() {
			group.removeFromParent();
			for (const d of disposers) d();
		}
	};
}
