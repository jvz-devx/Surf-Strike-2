/**
 * Local PB ghosts (docs/gameplay.md#ghosts): this browser's fastest run per
 * map, kept in IndexedDB as the packed (uncompressed) track. Every access is
 * guarded; without IndexedDB (private mode, blocked storage, SSR) ghosts live
 * in memory for the session only.
 */
import { packGhost, unpackGhost, type GhostTrack } from '@surf/shared';

export interface StoredGhost {
	map: string;
	ticks: number;
	track: GhostTrack;
}

interface Row {
	map: string;
	ticks: number;
	data: Uint8Array;
}

const DB_NAME = 'surf-ghosts';
const STORE = 'pb';

export interface GhostStore {
	get(map: string): Promise<StoredGhost | null>;
	/** Save if faster than the stored ghost; resolves true when saved. */
	saveIfFaster(g: StoredGhost): Promise<boolean>;
}

export function memoryGhostStore(): GhostStore {
	const m = new Map<string, Row>();
	return {
		async get(map) {
			return toGhost(m.get(map));
		},
		async saveIfFaster(g) {
			const old = m.get(g.map);
			if (old && old.ticks <= g.ticks) return false;
			m.set(g.map, { map: g.map, ticks: g.ticks, data: packGhost(g.track) });
			return true;
		}
	};
}

function toGhost(r: Row | undefined | null): StoredGhost | null {
	if (!r || typeof r.ticks !== 'number' || !(r.data instanceof Uint8Array)) return null;
	const track = unpackGhost(r.data);
	return track ? { map: r.map, ticks: r.ticks, track } : null;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
	return new Promise((ok, fail) => {
		r.onsuccess = () => ok(r.result);
		r.onerror = () => fail(r.error);
	});
}

/** IndexedDB-backed store, falling back to memory when IndexedDB is unusable. */
export function browserGhostStore(): GhostStore {
	const mem = memoryGhostStore();
	let dbp: Promise<IDBDatabase | null> | null = null;
	const open = (): Promise<IDBDatabase | null> => {
		dbp ??= new Promise<IDBDatabase | null>((ok) => {
			try {
				if (typeof indexedDB === 'undefined') return ok(null);
				const r = indexedDB.open(DB_NAME, 1);
				r.onupgradeneeded = () => {
					if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'map' });
				};
				r.onsuccess = () => ok(r.result);
				r.onerror = () => ok(null);
				r.onblocked = () => ok(null);
			} catch {
				ok(null);
			}
		});
		return dbp;
	};
	return {
		async get(map) {
			try {
				const db = await open();
				if (!db) return mem.get(map);
				return toGhost((await req(db.transaction(STORE).objectStore(STORE).get(map))) as Row | undefined);
			} catch {
				return mem.get(map);
			}
		},
		async saveIfFaster(g) {
			try {
				const db = await open();
				if (!db) return mem.saveIfFaster(g);
				const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
				const old = (await req(store.get(g.map))) as Row | undefined;
				if (old && typeof old.ticks === 'number' && old.ticks <= g.ticks) return false;
				const row: Row = { map: g.map, ticks: g.ticks, data: packGhost(g.track) };
				await req(store.put(row));
				return true;
			} catch {
				return mem.saveIfFaster(g);
			}
		}
	};
}
