/**
 * Layout rules of the Infected HUD that are decided in code (infected-hud.ts):
 * hit arcs stay out of the round header stack, and the score popups and the ammo
 * prompt stay off the line of the crosshair arms and the scope's hair. The boxes are the ones measured on the rendered
 * mock (`/?mockhud&mode=infected&scene=last`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	CROSSHAIR_LINE_CLEAR_PX,
	ARC_KEEP_PX,
	arcClear,
	hurtArcPath,
	popRowTop,
	RING_BOX,
	RING_HALF_DEG,
	RING_RADIUS,
	RING_THICKNESS,
	ringKeepOut,
	type ScreenRect
} from '#lib/ui/infected-hud.js';
import { crosshairRects } from '#lib/ui/format.js';

const rect = (left: number, top: number, right: number, bottom: number): ScreenRect => ({ left, top, right, bottom });
/** The ring svg on screen: RING_BOX units wide at `scale`, centred on the crosshair of a w × h window. */
const ring = (w: number, h: number, scale: number): ScreenRect => rect(w / 2 - (RING_BOX / 2) * scale, h / 2 - (RING_BOX / 2) * scale, w / 2 + (RING_BOX / 2) * scale, h / 2 + (RING_BOX / 2) * scale);

/** Glow of an arc on screen (px): the drop shadow of `.dmg path`. */
const GLOW_PX = 5;

/**
 * Outline of the arc at `bearing` on screen, from the path the HUD draws
 * (`M -x y A r r 0 0 1 x y A i i 0 0 0 -x y Z`), sampled densely.
 */
function outline(bearing: number, on: ScreenRect): [number, number][] {
	const n = hurtArcPath(RING_RADIUS, RING_HALF_DEG, RING_THICKNESS).match(/-?\d+(\.\d+)?/g)!.map(Number);
	const [mx, my, r, , , , , ex, ey, inner] = n as [number, number, number, number, number, number, number, number, number, number];
	const pts: [number, number][] = [];
	const arcTo = (x0: number, y0: number, x1: number, y1: number, rad: number): void => {
		// Both edges bulge up: the centre lies below the chord, and the short way round is the arc.
		const half = Math.hypot(x1 - x0, y1 - y0) / 2;
		const cx = (x0 + x1) / 2;
		const cy = (y0 + y1) / 2 + Math.sqrt(Math.max(0, rad * rad - half * half));
		const a0 = Math.atan2(y0 - cy, x0 - cx);
		let da = Math.atan2(y1 - cy, x1 - cx) - a0;
		while (da > Math.PI) da -= 2 * Math.PI;
		while (da < -Math.PI) da += 2 * Math.PI;
		for (let i = 0; i <= 400; i++) {
			const a = a0 + (da * i) / 400;
			pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
		}
	};
	arcTo(mx, my, ex, ey, r); // outer edge
	arcTo(ex, ey, mx, my, inner); // inner edge, back
	const k = (on.right - on.left) / RING_BOX;
	const cx = (on.left + on.right) / 2;
	const cy = (on.top + on.bottom) / 2;
	const b = (bearing * Math.PI) / 180;
	return pts.map(([x, y]) => [cx + (x * Math.cos(b) - y * Math.sin(b)) * k, cy + (x * Math.sin(b) + y * Math.cos(b)) * k]);
}

/** Smallest distance (px) between the arc's outline and a block on screen. */
function gap(bearing: number, on: ScreenRect, block: ScreenRect): number {
	let best = Infinity;
	for (const [x, y] of outline(bearing, on)) best = Math.min(best, Math.hypot(Math.max(block.left - x, 0, x - block.right), Math.max(block.top - y, 0, y - block.bottom)));
	return best;
}

/** Round header stacks as measured: banner, M.O.A.B. banner, UAV line and flash at 1280 wide. */
const STACK_720_S1 = rect(384.1, 64, 895.9, 212); // --hud-scale 1: four rows
const STACK_720_S1_3 = rect(384.1, 64, 895.9, 175); // banner, M.O.A.B., UAV line
const STACK_720_S1_2 = rect(384.1, 64, 895.9, 143); // banner, M.O.A.B.
const STACK_720_AUTO = rect(414.4, 64, 865.6, 198); // --hud-scale 0.85: four rows
const STACK_720_AUTO_3 = rect(414.4, 64, 865.6, 165);
const STACK_1080 = rect(704.1, 64, 1215.9, 212); // 1920 wide, scale 1: four rows

describe('ringKeepOut: a HUD block in ring units', () => {
	it('is centred on the ring, scaled with it and grown by the glow and the gap', () => {
		const k = ringKeepOut(STACK_720_S1, ring(1280, 720, 1))!;
		expect(k.x0).toBeCloseTo(384.1 - 640 - ARC_KEEP_PX, 6);
		expect(k.x1).toBeCloseTo(895.9 - 640 + ARC_KEEP_PX, 6);
		expect(k.y0).toBeCloseTo(64 - 360 - ARC_KEEP_PX, 6);
		expect(k.y1).toBeCloseTo(212 - 360 + ARC_KEEP_PX, 6);
		// At --hud-scale 0.85 a pixel is more ring units.
		const s = ringKeepOut(STACK_720_AUTO, ring(1280, 720, 0.85))!;
		expect(s.y1).toBeCloseTo((198 - 360 + ARC_KEEP_PX) / 0.85, 6);
		expect(ARC_KEEP_PX).toBeGreaterThan(GLOW_PX);
		// No ring on screen: nothing to keep out of.
		expect(ringKeepOut(STACK_720_S1, rect(0, 0, 0, 0))).toBeNull();
	});
});

describe('arcClear: hit arcs stay out of the round header stack', () => {
	it('the findings: at 1280x720 the arc from straight ahead ran into the UAV line and the flash', () => {
		// As drawn before: the top arc at y 172..183 with a 5 px glow, the UAV line ending at 175, the flash from 185.
		expect(gap(0, ring(1280, 720, 1), STACK_720_S1_3)).toBe(0);
		expect(gap(0, ring(1280, 720, 1), STACK_720_S1)).toBe(0);
		expect(gap(0, ring(1280, 720, 0.85), STACK_720_AUTO)).toBeLessThan(GLOW_PX); // the "touch" at the default scale
		// Now those arcs are not drawn.
		expect(arcClear(0, ringKeepOut(STACK_720_S1_3, ring(1280, 720, 1)))).toBe(false);
		expect(arcClear(0, ringKeepOut(STACK_720_S1, ring(1280, 720, 1)))).toBe(false);
		expect(arcClear(0, ringKeepOut(STACK_720_AUTO, ring(1280, 720, 0.85)))).toBe(false);
	});

	it('only the arcs that would reach the stack go: the sides and the back always stay', () => {
		const deep = ringKeepOut(STACK_720_S1, ring(1280, 720, 1));
		for (const b of [90, -90, 180, 135, -135, 70, -70]) expect(arcClear(b, deep), String(b)).toBe(true);
		for (const b of [0, 20, -20, 40, -40]) expect(arcClear(b, deep), String(b)).toBe(false);
		// A shorter stack hides less, and a stack that ends above the ring hides nothing.
		const three = ringKeepOut(STACK_720_S1_3, ring(1280, 720, 1));
		expect(arcClear(30, three)).toBe(false);
		expect(arcClear(50, three)).toBe(true);
		const clear = [ringKeepOut(STACK_720_S1_2, ring(1280, 720, 1)), ringKeepOut(STACK_720_AUTO_3, ring(1280, 720, 0.85)), ringKeepOut(STACK_1080, ring(1920, 1080, 1)), null];
		for (const keepOut of clear) for (let b = -180; b <= 180; b += 2) expect(arcClear(b, keepOut)).toBe(true);
	});

	it('every arc that is drawn keeps its glow and a gap away from the stack, at every bearing', () => {
		const cases: [ScreenRect, ScreenRect][] = [
			[STACK_720_S1, ring(1280, 720, 1)],
			[STACK_720_S1_3, ring(1280, 720, 1)],
			[STACK_720_AUTO, ring(1280, 720, 0.85)],
			[STACK_1080, ring(1920, 1080, 1)],
			// A narrow stack (a short flash under a short banner): arcs beside it stay.
			[rect(560, 64, 720, 212), ring(1280, 720, 1)]
		];
		for (const [stack, on] of cases) {
			const keepOut = ringKeepOut(stack, on);
			let hidden = 0;
			for (let b = -180; b < 180; b += 1) {
				if (arcClear(b, keepOut)) expect(gap(b, on, stack), `bearing ${b}`).toBeGreaterThan(GLOW_PX + 1);
				else {
					hidden++;
					// Nothing is hidden that was not within the keep-out distance.
					expect(gap(b, on, stack), `bearing ${b}`).toBeLessThan(ARC_KEEP_PX + 1);
				}
			}
			// Hidden arcs are a front sector, symmetric about straight ahead.
			for (let b = 1; b < 180; b += 1) expect(arcClear(b, keepOut)).toBe(arcClear(-b, keepOut));
			expect(hidden).toBeLessThan(140);
		}
	});
});

describe('popRowTop: score popup rows around the crosshair line', () => {
	it('every row sits above the line of the crosshair arms and the scope hair, the newest nearest, none overlapping', () => {
		for (let row = 0; row < 3; row++) {
			const top = popRowTop(row);
			// The row is one unit high: it ends at or above the line (the HUD lifts it 4 px more, clear of the arms).
			expect(top + 1).toBeLessThanOrEqual(0);
			if (row > 0) expect(top + 1).toBeLessThanOrEqual(popRowTop(row - 1));
		}
		expect(popRowTop(0)).toBe(-1);
	});

	it('the ammo prompt and the popups end above a crosshair arm up to 6 px thick, scoped or not', () => {
		// An arm is cl_crosshairthickness px thick around the line, with a 1 px shadow.
		const thickness = 6;
		for (const r of crosshairRects(5, 40, thickness, false)) if (r.w > r.h) expect(-r.y + 1).toBeLessThanOrEqual(CROSSHAIR_LINE_CLEAR_PX);
		// Both use the constant, in one place each, whatever the scope: the component has no other lift.
		const src = readFileSync(new URL('./InfectedHud.svelte', import.meta.url), 'utf8');
		const rule = (sel: string) => src.slice(src.indexOf('\n\t' + sel + ' {'), src.indexOf('\n\t}', src.indexOf('\n\t' + sel + ' {')));
		expect(rule('.ammo-prompt')).toContain('translateY(calc(-100% - var(--clear)))');
		expect(rule('.spop')).toContain('translateY(calc(var(--rowtop) * 1.5em - var(--clear)))');
		expect(src.split('--clear="{CROSSHAIR_LINE_CLEAR_PX}px"')).toHaveLength(3);
		expect(src).not.toMatch(/\.ammo-prompt\.scoped|\.pops\.scoped/);
	});
});
