/**
 * Map list from @surf/shared. Read through the namespace so the server still
 * type-checks and starts with a clear error while the map module is a stub.
 */
import * as shared from '@surf/shared';
import type { MapDef } from '@surf/shared';

function isMapDef(v: unknown): v is MapDef {
	if (!v || typeof v !== 'object') return false;
	const m = v as Partial<MapDef>;
	return typeof m.id === 'string' && Array.isArray(m.zones) && !!m.spawn && typeof m.layout === 'string';
}

/** All maps exported by @surf/shared (`MAPS` as array or record). */
export function loadMaps(): MapDef[] {
	const mod = shared as unknown as { MAPS?: unknown };
	const raw = mod.MAPS;
	const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
	return list.filter(isMapDef);
}

/** `DEFAULT_MAP_ID` from @surf/shared if it names a known map. */
export function defaultMapId(maps: MapDef[]): string | undefined {
	const id = (shared as unknown as { DEFAULT_MAP_ID?: unknown }).DEFAULT_MAP_ID;
	return typeof id === 'string' && maps.some((m) => m.id === id) ? id : undefined;
}
