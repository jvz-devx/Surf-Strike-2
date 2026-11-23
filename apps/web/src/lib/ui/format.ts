/**
 * Small pure helpers for the HUD (formatting, crosshair geometry, scoreboard
 * text). No DOM, no Svelte: unit-tested in node.
 */
import { Status, TICK_RATE, formatTicks } from '@surf/shared';
import type { ScoreRow } from '@surf/shared';

export { TICK_RATE };
const MINUS = '−';

/** Run time `mm:ss.mmm` from ticks. */
export function formatRunTime(ticks: number, tickRate = TICK_RATE): string {
	return formatTicks(Math.max(0, ticks), tickRate);
}

/** Split delta in ticks → `−0.213` / `+1.050` / `+1:02.500`. Zero is `±0.000`. */
export function formatDelta(deltaTicks: number, tickRate = TICK_RATE): string {
	const ms = Math.round((Math.abs(deltaTicks) / tickRate) * 1000);
	if (ms === 0) return '±0.000';
	const sign = deltaTicks < 0 ? MINUS : '+';
	const m = Math.floor(ms / 60000);
	const s = Math.floor((ms % 60000) / 1000);
	const r = String(ms % 1000).padStart(3, '0');
	return m > 0 ? `${sign}${m}:${String(s).padStart(2, '0')}.${r}` : `${sign}${s}.${r}`;
}

/** 'faster' for negative deltas, 'slower' for positive, 'even' for zero/null. */
export function deltaClass(deltaTicks: number | null, tickRate = TICK_RATE): 'faster' | 'slower' | 'even' {
	if (deltaTicks === null) return 'even';
	const ms = Math.round((deltaTicks / tickRate) * 1000);
	return ms < 0 ? 'faster' : ms > 0 ? 'slower' : 'even';
}

/** Seconds → `mm:ss` (rounded up, never negative). */
export function formatClock(seconds: number): string {
	const t = Math.max(0, Math.ceil(seconds));
	const m = Math.floor(t / 60);
	const s = t % 60;
	return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Opacity of a timed popup: 1 until `hold` ms, then linear fade over `fade` ms. */
export function fadeOpacity(ageMs: number, hold: number, fade: number): number {
	if (ageMs < 0) return 1;
	if (ageMs <= hold) return 1;
	if (ageMs >= hold + fade) return 0;
	return 1 - (ageMs - hold) / fade;
}

/** Status column text for the scoreboard. */
export function statusText(row: Pick<ScoreRow, 'status' | 'stage' | 'spectating'>, staged = true): string {
	if (row.spectating) return 'Spectating';
	switch (row.status) {
		case Status.StartZone:
			return 'Start zone';
		case Status.Running:
			return staged && row.stage > 0 ? `Stage ${row.stage}` : 'Running';
		case Status.Finished:
			return 'Finished';
		case Status.Spectating:
			return 'Spectating';
		case Status.Tagger:
			return 'IT';
		case Status.Runner:
			return 'Runner';
		case Status.Alive:
			return 'Survivor';
		case Status.Down:
			return 'Zombie';
		case Status.Hider:
			return 'Hider';
		case Status.Seeker:
			return 'Seeker';
		default:
			return 'Idle';
	}
}

/**
 * Players sorted by PB (no PB last, then by name), or by score (highest first)
 * when `byScore` (tag); spectators split out.
 */
export function splitScoreboard(
	rows: readonly ScoreRow[],
	byScore = false
): { players: ScoreRow[]; spectators: ScoreRow[] } {
	const players = rows.filter((r) => !r.spectating && r.status !== Status.Spectating);
	const spectators = rows.filter((r) => r.spectating || r.status === Status.Spectating);
	players.sort((a, b) => {
		if (byScore) return (b.score ?? b.kills ?? 0) - (a.score ?? a.kills ?? 0) || a.name.localeCompare(b.name);
		if (a.pbTicks === null && b.pbTicks === null) return a.name.localeCompare(b.name);
		if (a.pbTicks === null) return 1;
		if (b.pbTicks === null) return -1;
		return a.pbTicks - b.pbTicks;
	});
	spectators.sort((a, b) => a.name.localeCompare(b.name));
	return { players, spectators };
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
