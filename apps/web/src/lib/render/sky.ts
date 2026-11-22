/** Sky gradient dome that follows the camera (never fogged). */
import type { Theme } from '@surf/shared';
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
	vDir = normalize(position);
	vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	gl_Position = vec4(p.xy, p.w * 0.99999, p.w); // just inside the far plane
}
`;
const FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
varying vec3 vDir;
void main() {
	float y = vDir.y;
	vec3 col = y >= 0.0
		? mix(uHorizon, uTop, pow(smoothstep(0.0, 1.0, y), 0.6))
		: mix(uHorizon, uBottom, pow(smoothstep(0.0, 1.0, -y), 0.5));
	gl_FragColor = vec4(col, 1.0);
	#include <colorspace_fragment>
}
`;

export class Sky {
	readonly mesh: THREE.Mesh;
	private geo = new THREE.SphereGeometry(1000, 32, 16);
	private mat: THREE.ShaderMaterial;

	constructor() {
		this.mat = new THREE.ShaderMaterial({
			uniforms: {
				uTop: { value: new THREE.Color() },
				uHorizon: { value: new THREE.Color() },
				uBottom: { value: new THREE.Color() }
			},
			vertexShader: VERT,
			fragmentShader: FRAG,
			side: THREE.BackSide,
			depthWrite: false,
			fog: false
		});
		this.mesh = new THREE.Mesh(this.geo, this.mat);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = -10;
	}

	setTheme(t: Theme): void {
		this.mat.uniforms.uTop.value.setHex(t.skyTop);
		this.mat.uniforms.uHorizon.value.setHex(t.skyHorizon);
		this.mat.uniforms.uBottom.value.setHex(t.skyBottom);
	}

	follow(camera: THREE.Camera): void {
		this.mesh.position.copy(camera.position);
	}

	dispose(): void {
		this.mesh.removeFromParent();
		this.geo.dispose();
		this.mat.dispose();
	}
}
