/** Player identity: random UUID v4, guest name and account session in localStorage. */
import { MAX_NAME, sanitizeText } from '@surf/shared';
import { STORAGE_KEYS, type KeyValueStore } from './storage.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuidV4(): string {
	const c = globalThis.crypto;
	if (c && typeof c.randomUUID === 'function') {
		try {
			return c.randomUUID();
		} catch {
			// insecure context: fall through
		}
	}
	const b = new Uint8Array(16);
	if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
	else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function loadPlayerId(store: KeyValueStore): string {
	const id = store.get(STORAGE_KEYS.playerId);
	if (id && UUID_RE.test(id)) return id;
	const fresh = uuidV4();
	store.set(STORAGE_KEYS.playerId, fresh);
	return fresh;
}

export function cleanName(raw: string): string | null {
	const s = sanitizeText(raw, MAX_NAME);
	return s.length > 0 ? s : null;
}

export function loadName(store: KeyValueStore): string | null {
	const n = store.get(STORAGE_KEYS.name);
	return n ? cleanName(n) : null;
}

export function saveName(store: KeyValueStore, name: string): void {
	store.set(STORAGE_KEYS.name, name);
}

export interface StoredSession {
	token: string;
	username: string;
}

/** Session saved by a successful login/register; null if none (or storage blocked). */
export function loadSession(store: KeyValueStore): StoredSession | null {
	const token = store.get(STORAGE_KEYS.session);
	const username = store.get(STORAGE_KEYS.account);
	if (!token || !username || token.length > 128) return null;
	return { token, username };
}

export function saveSession(store: KeyValueStore, s: StoredSession): void {
	store.set(STORAGE_KEYS.session, s.token);
	store.set(STORAGE_KEYS.account, s.username);
	store.remove(STORAGE_KEYS.guest);
}

export function clearSession(store: KeyValueStore): void {
	store.remove(STORAGE_KEYS.session);
	store.remove(STORAGE_KEYS.account);
}

export function isGuest(store: KeyValueStore): boolean {
	return store.get(STORAGE_KEYS.guest) === '1';
}

export function setGuest(store: KeyValueStore): void {
	store.set(STORAGE_KEYS.guest, '1');
}
