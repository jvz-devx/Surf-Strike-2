/**
 * Character material (docs/characters.md): Lambert plus a per-character
 * palette, a baked shade and a soft rim light, so a whole character is one
 * draw call. All instances share one shader program.
 *
 * Palette entries are (r, g, b, glow). Glow 0 is plain lit cloth, 1 is an
 * unlit, unfogged colour (infected eyes); in between mixes the two.
 */
import * as THREE from 'three';
import { PAL_SIZE } from './mesh-kit.js';

export class CharacterMaterial extends THREE.MeshLambertMaterial {
	readonly palette: THREE.Vector4[] = Array.from({ length: PAL_SIZE }, () => new THREE.Vector4(1, 1, 1, 0));
	private readonly ghost: boolean;

	/** `ghost`: translucent, denser at the silhouette, no depth writes. */
	constructor(ghost = false) {
		super({ color: 0xffffff });
		this.ghost = ghost;
		if (ghost) {
			this.transparent = true;
			this.depthWrite = false;
		}
		const palette = { value: this.palette };
		this.onBeforeCompile = (shader) => {
			shader.uniforms.uPal = palette;
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', `#include <common>\nattribute vec4 aPal;\nuniform vec4 uPal[${PAL_SIZE}];\nvarying vec3 vPal;\nvarying float vGlow;`)
				.replace('#include <color_vertex>', '#include <color_vertex>\nvec4 pal = uPal[int(aPal.x + 0.5)];\nvPal = pal.rgb * mix(aPal.y * 0.005, 1.0, pal.a);\nvGlow = pal.a;');
			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', '#include <common>\nvarying vec3 vPal;\nvarying float vGlow;')
				.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vPal;')
				.replace(
					'#include <emissivemap_fragment>',
					/* glsl */ `#include <emissivemap_fragment>
float rim = 1.0 - saturate(dot(normalize(vViewPosition), normal));
rim *= rim * rim;
totalEmissiveRadiance += diffuseColor.rgb * (0.07 + 0.4 * rim);
${ghost ? 'diffuseColor.a *= 0.75 + 1.5 * rim;' : ''}`
				)
				.replace('#include <fog_fragment>', 'vec3 unfogged = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(vPal, 1.0)).rgb, vGlow);\ngl_FragColor.rgb = unfogged;\n#include <fog_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, unfogged, smoothstep(0.5, 1.0, vGlow));');
		};
		this.customProgramCacheKey = () => `character${ghost ? '-ghost' : ''}`;
	}

	set(index: number, color: THREE.Color, glow = 0): void {
		this.palette[index]!.set(color.r, color.g, color.b, glow);
	}

	override clone(): this {
		const m = new CharacterMaterial(this.ghost);
		m.palette.forEach((p, i) => p.copy(this.palette[i]!));
		return m as this;
	}
}
