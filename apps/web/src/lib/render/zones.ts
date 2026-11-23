/**
 * CS-style zone outlines: glowing box edges plus faint gradient walls.
 * Start green, end red, stages/checkpoints blue; teleports are invisible.
 */
import { isRaceMode, type MapDef, type Zone } from '@surf/shared';
import * as THREE from 'three';
import { biasLineDepth, type SharedUniforms } from './materials.js';

const ZONE_COLORS: Record<string, number> = {
	start: 0x3dff6e,
	end: 0xff3b3b,
	stage: 0x3b9dff,
	checkpoint: 0x3b9dff
};

const WALL_VERT = /* glsl */ `
attribute float aHeight;
varying float vH;
void main() {
	vH = aHeight;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const WALL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying float vH;
void main() {
	float a = pow(1.0 - vH, 2.2) * (0.22 + 0.05 * sin(uTime * 2.5));
	gl_FragColor = vec4(uColor, a);
	#include <colorspace_fragment>
}
`;

export interface ZoneMeshes {
	group: THREE.Group;
	dispose(): void;
}

function corners(z: Zone): THREE.Vector3[] {
	const { min, max } = z;
	// Source → Three: (x, y, z) → (x, z, −y)
	const out: THREE.Vector3[] = [];
	for (const zz of [min.z, max.z])
		for (const [x, y] of [
			[min.x, min.y],
			[max.x, min.y],
			[max.x, max.y],
			[min.x, max.y]
		])
			out.push(new THREE.Vector3(x, zz, -y));
	return out; // 0..3 bottom ring, 4..7 top ring
}

export function buildZoneMeshes(map: MapDef, shared: SharedUniforms): ZoneMeshes {
	const group = new THREE.Group();
	group.name = 'zones';
	const disposables: Array<{ dispose(): void }> = [];
	const byColor = new Map<number, { lines: number[]; walls: number[]; h: number[] }>();

	// Race zones (start, stages, checkpoints) only mean something in race modes;
	// other modes (e.g. Zombie Run) use checkpoints internally, so only their end zone is drawn.
	const race = isRaceMode(map.kind);
	for (const z of map.zones) {
		if (!race && z.type !== 'end') continue;
		const color = ZONE_COLORS[z.type];
		if (color === undefined) continue;
		let b = byColor.get(color);
		if (!b) byColor.set(color, (b = { lines: [], walls: [], h: [] }));
		const c = corners(z);
		const edge = (i: number, j: number) => b!.lines.push(c[i].x, c[i].y, c[i].z, c[j].x, c[j].y, c[j].z);
		for (let i = 0; i < 4; i++) {
			edge(i, (i + 1) % 4);
			edge(i + 4, ((i + 1) % 4) + 4);
			edge(i, i + 4);
		}
		for (let i = 0; i < 4; i++) {
			const a = c[i];
			const d = c[(i + 1) % 4];
			const at = c[i + 4];
			const dt = c[((i + 1) % 4) + 4];
			for (const [v, h] of [
				[a, 0],
				[d, 0],
				[dt, 1],
				[a, 0],
				[dt, 1],
				[at, 1]
			] as const) {
				b.walls.push(v.x, v.y, v.z);
				b.h.push(h);
			}
		}
	}

	for (const [color, b] of byColor) {
		const lineGeo = new THREE.BufferGeometry();
		lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(b.lines, 3));
		const lineMat = biasLineDepth(
			new THREE.LineBasicMaterial({
				color,
				transparent: true,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				fog: false
			})
		);
		const lines = new THREE.LineSegments(lineGeo, lineMat);
		lines.renderOrder = 2;
		group.add(lines);

		const wallGeo = new THREE.BufferGeometry();
		wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(b.walls, 3));
		wallGeo.setAttribute('aHeight', new THREE.Float32BufferAttribute(b.h, 1));
		const wallMat = new THREE.ShaderMaterial({
			uniforms: { uColor: { value: new THREE.Color(color) }, uTime: shared.uTime },
			vertexShader: WALL_VERT,
			fragmentShader: WALL_FRAG,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			blending: THREE.AdditiveBlending,
			// Zones are usually sized to their room, so these walls are coplanar with the
			// map's walls and floor edges: pull them towards the camera in depth so the glow
			// always wins the depth test instead of z-fighting (flickering stripes) with the wall.
			polygonOffset: true,
			polygonOffsetFactor: -1,
			polygonOffsetUnits: -4
		});
		const walls = new THREE.Mesh(wallGeo, wallMat);
		walls.renderOrder = 2;
		group.add(walls);
		disposables.push(lineGeo, lineMat, wallGeo, wallMat);
	}

	return {
		group,
		dispose() {
			group.removeFromParent();
			for (const d of disposables) d.dispose();
		}
	};
}
