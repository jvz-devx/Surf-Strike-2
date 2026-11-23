/**
 * Split/PB helpers and the solo personal-best store (solo runs are kept in
 * localStorage per map and never sent to the leaderboard).
 */
import type { MapRecordInfo, RecordEntry } from '@surf/shared';
import { readJson, STORAGE_KEYS, writeJson, type KeyValueStore } from './storage.js';

export interface LocalPb {
	ticks: number;
	splits: number[];
}

export function loadSoloPb(store: KeyValueStore, mapId: string): LocalPb | null {
	const v = readJson<LocalPb>(store, STORAGE_KEYS.pb(mapId));
	if (!v || typeof v.ticks !== 'number' || !Number.isFinite(v.ticks) || v.ticks <= 0) return null;
	return { ticks: v.ticks, splits: Array.isArray(v.splits) ? v.splits.filter((n) => typeof n === 'number') : [] };
}

/** Save if better; returns true when it is a new PB. */
export function saveSoloPb(store: KeyValueStore, mapId: string, run: LocalPb): boolean {
	const old = loadSoloPb(store, mapId);
	if (old && old.ticks <= run.ticks) return false;
	writeJson(store, STORAGE_KEYS.pb(mapId), run);
	return true;
}

/** Delta in ticks against the PB split at the same position, or null. */
export function splitDelta(pbSplits: readonly number[] | null | undefined, position: number, ticks: number): number | null {
	if (!pbSplits || position < 0 || position >= pbSplits.length) return null;
	const ref = pbSplits[position];
	return typeof ref === 'number' && Number.isFinite(ref) ? ticks - ref : null;
}

/** The record fields of the HUD score panel in race modes (ScorePanel.svelte). */
export interface RecordFields {
	pbTicks: number | null;
	pbRank: number | null;
	recordTicks: number | null;
	recordName: string | null;
	/** Leaderboard top; null offline and from an older server. */
	recordTop: RecordEntry[] | null;
}

/**
 * What the score panel shows. Online: the server's records only (never the
 * solo PB). Solo: the local solo PB only, no rank or map record.
 */
export function recordFields(mode: 'solo' | 'online', online: MapRecordInfo | null, soloPb: LocalPb | null): RecordFields {
	if (mode === 'online') {
		return {
			pbTicks: online?.pbTicks ?? null,
			pbRank: online?.rank ?? null,
			recordTicks: online?.recordTicks ?? null,
			recordName: online?.recordName ?? null,
			recordTop: online?.top ?? null
		};
	}
	return { pbTicks: soloPb?.ticks ?? null, pbRank: null, recordTicks: null, recordName: null, recordTop: null };
}

/**
 * Records after a server `records` push (another player changed the
 * leaderboard): taken only online and for the map being played, otherwise
 * the current records are kept.
 */
export function mergeRecordsPush(
	current: MapRecordInfo | null,
	push: { map: string; records: MapRecordInfo },
	mode: 'solo' | 'online',
	mapId: string
): MapRecordInfo | null {
	return mode === 'online' && push.map === mapId ? push.records : current;
}
