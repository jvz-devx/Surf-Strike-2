/**
 * CS-style FOV: `fov` is the horizontal FOV at 4:3. The vertical FOV stays
 * constant for every aspect, so widescreen sees more (106.26° at 16:9).
 */
const DEG = Math.PI / 180;

export function verticalFovFromHorizontal43(fovDeg: number): number {
	return (2 * Math.atan(Math.tan((fovDeg * DEG) / 2) * (3 / 4))) / DEG;
}

export function horizontalFov(verticalDeg: number, aspect: number): number {
	return (2 * Math.atan(Math.tan((verticalDeg * DEG) / 2) * aspect)) / DEG;
}
