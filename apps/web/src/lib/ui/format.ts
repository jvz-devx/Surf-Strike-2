/**
 * Small pure helpers for the HUD (formatting, crosshair geometry). No DOM, no Svelte: unit-tested in node.
 */
import { TICK_RATE, formatClock, formatDelta, formatTicks } from '@surf/shared';

// Shared with the score definitions (packages/shared/src/modes/score.ts).
export { formatClock, formatDelta, TICK_RATE };

/** Run time `mm:ss.mmm` from ticks. */
export function formatRunTime(ticks: number, tickRate = TICK_RATE): string {
	return formatTicks(Math.max(0, ticks), tickRate);
}

/** 'faster' for negative deltas, 'slower' for positive, 'even' for zero/null. */
export function deltaClass(deltaTicks: number | null, tickRate = TICK_RATE): 'faster' | 'slower' | 'even' {
	if (deltaTicks === null) return 'even';
	const ms = Math.round((deltaTicks / tickRate) * 1000);
	return ms < 0 ? 'faster' : ms > 0 ? 'slower' : 'even';
}

/** Opacity of a timed popup: 1 until `hold` ms, then linear fade over `fade` ms. */
export function fadeOpacity(ageMs: number, hold: number, fade: number): number {
	if (ageMs < 0) return 1;
	if (ageMs <= hold) return 1;
	if (ageMs >= hold + fade) return 0;
	return 1 - (ageMs - hold) / fade;
}

/** Text under the timer: stage/checkpoint progress or run phase. */
export function stageText(
	phase: 'start' | 'running' | 'finished' | 'idle',
	stage: number,
	stageCount: number,
	kind: 'stage' | 'checkpoint'
): string {
	if (phase === 'start') return 'Start zone';
	if (phase === 'finished') return 'Finished';
	if (phase === 'idle') return '';
	if (stageCount <= 0) return 'Running';
	if (kind === 'stage') return `Stage ${Math.max(1, stage)} / ${stageCount}`;
	return `Checkpoint ${stage} / ${stageCount}`;
}

/** Read a numeric cvar with a fallback. */
export function cvarNum(cvars: Record<string, number | string>, name: string, fallback: number): number {
	const v = cvars[name];
	if (v === undefined || v === '') return fallback;
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : fallback;
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * CS-style crosshair geometry in CSS px, relative to the screen centre.
 * size = line length in half-units (CS-ish: 5 → 10 px), gap adds to a base gap
 * of 4 px (can be negative, clamped at 0), thickness ≥ 1 px.
 */
export function crosshairRects(size: number, gap: number, thickness: number, dot: boolean): Rect[] {
	const t = Math.max(1, Math.round(thickness));
	const len = Math.max(0, Math.round(size * 2));
	const g = Math.max(0, Math.round(4 + gap));
	const half = t / 2;
	const rects: Rect[] = [];
	if (len > 0) {
		rects.push({ x: -half, y: -g - len, w: t, h: len }); // top
		rects.push({ x: -half, y: g, w: t, h: len }); // bottom
		rects.push({ x: -g - len, y: -half, w: len, h: t }); // left
		rects.push({ x: g, y: -half, w: len, h: t }); // right
	}
	if (dot) rects.push({ x: -half, y: -half, w: t, h: t });
	return rects;
}

function clampByte(n: number): number {
	return Math.min(255, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));
}

export function rgbToHex(r: number, g: number, b: number): string {
	return '#' + [r, g, b].map((c) => clampByte(c).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex: string): [number, number, number] | null {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	const n = parseInt(m[1], 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Longest common prefix of completion candidates. */
export function commonPrefix(items: readonly string[]): string {
	if (items.length === 0) return '';
	let p = items[0];
	for (const s of items) {
		let i = 0;
		while (i < p.length && i < s.length && p[i].toLowerCase() === s[i].toLowerCase()) i++;
		p = p.slice(0, i);
	}
	return p;
}

/** Clean a player name from the prompt: trimmed, max 24 chars; null when empty. */
export function cleanName(raw: string): string | null {
	// eslint-disable-next-line no-control-regex
	const s = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24).trim();
	return s.length > 0 ? s : null;
}

/** Speed as integer u/s. */
export function formatSpeed(speed: number): string {
	return String(Math.max(0, Math.round(speed)));
}
