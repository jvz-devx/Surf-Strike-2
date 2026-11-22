/**
 * Ghost playback (docs/gameplay.md#ghosts), pure logic: which ghost to show,
 * and its pose for the local run's timer. Rendering is in render/players.ts,
 * storage of the local PB ghost in ghost-store.ts.
 */
import { emptyGhostPose, formatTicks, sampleGhost, type GhostPose, type GhostTrack } from '@surf/shared';

export interface GhostSource {
	/** 'record': the server's map record ghost; 'pb': this browser's best run. */
	kind: 'record' | 'pb';
	map: string;
	name: string;
	ticks: number;
	track: GhostTrack;
}

export type RunPhase = 'start' | 'running' | 'finished' | 'idle';

/** Online: the map record ghost, else the local PB ghost. Solo: the local PB ghost. */
export function chooseGhost(
	online: boolean,
	record: GhostSource | null,
	localPb: GhostSource | null,
	map: string
): GhostSource | null {
	const r = online && record?.map === map ? record : null;
	const l = localPb?.map === map ? localPb : null;
	return r ?? l;
}

/** Name tag text, e.g. "Alice · 01:23.456" or "Your PB · 01:23.456". */
export function ghostLabel(g: Pick<GhostSource, 'kind' | 'name' | 'ticks'>): string {
	return `${g.kind === 'pb' ? 'Your PB' : g.name} · ${formatTicks(g.ticks)}`;
}

/**
 * Plays a ghost in sync with the local run: the ghost's run tick is the
 * player's run tick (plus the render interpolation fraction). It shows only
 * while the player's run is running and the ghost has not finished; leaving
 * the start zone restarts it from its first sample, and restart, !r,
 * teleport-to-start and finishing hide it.
 */
export class GhostPlayback {
	readonly pose: GhostPose = emptyGhostPose();
	private src: GhostSource | null = null;
	private hint = -1;

	get source(): GhostSource | null {
		return this.src;
	}

	set(src: GhostSource | null): void {
		if (src === this.src) return;
		this.src = src;
		this.hint = -1;
	}

	/**
	 * Updates `pose`; returns whether the ghost is visible.
	 * `runTicks`: the run tracker's ticks of the newest simulated tick;
	 * `alpha`: render fraction between the previous and the newest tick
	 * (the local view is drawn between them, so the ghost is too).
	 */
	update(phase: RunPhase, runTicks: number, alpha: number): boolean {
		const g = this.src;
		if (!g || phase !== 'running') {
			this.hint = -1;
			return false;
		}
		const time = Math.max(0, runTicks - 1 + Math.min(1, Math.max(0, alpha)));
		if (time > g.ticks) return false;
		const i = sampleGhost(g.track, time, this.pose, this.hint);
		this.hint = i;
		return i >= 0;
	}
}
