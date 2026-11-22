/**
 * Key binds (docs/ui.md#default-key-binds). Key names are Source-style and
 * derived from KeyboardEvent.code (layout independent), see input/keys.ts.
 */
import { readJson, STORAGE_KEYS, writeJson, type KeyValueStore } from './storage.js';

export const DEFAULT_BINDS: Readonly<Record<string, string>> = Object.freeze({
	w: '+forward',
	s: '+back',
	a: '+moveleft',
	d: '+moveright',
	space: '+jump',
	mwheelup: '+jump',
	mwheeldown: '+jump',
	ctrl: '+duck',
	y: 'messagemode',
	tab: '+showscores',
	'1': 'vote 1',
	'2': 'vote 2',
	'3': 'vote 3',
	'4': 'vote 4',
	m: 'spectate',
	r: 'restart',
	'`': 'toggleconsole',
	mouse1: '+attack',
	mouse2: '+attack2'
});

/** Keys that can never be bound (browser/UI reserved). */
const RESERVED = new Set(['escape']);

/** Normalise user-typed key names ("SPACE", "~", "lctrl") to bind names. */
export function normalizeKeyName(raw: string): string | null {
	const k = raw.trim().toLowerCase();
	if (!k) return null;
	const alias: Record<string, string> = {
		'~': '`',
		tilde: '`',
		backquote: '`',
		control: 'ctrl',
		lctrl: 'ctrl',
		rctrl: 'ctrl',
		lshift: 'shift',
		rshift: 'shift',
		lalt: 'alt',
		ralt: 'alt',
		esc: 'escape',
		return: 'enter',
		spacebar: 'space',
		' ': 'space',
		mwheel_up: 'mwheelup',
		mwheel_down: 'mwheeldown',
		del: 'delete'
	};
	const n = alias[k] ?? k;
	if (RESERVED.has(n)) return null;
	return n;
}

export class Binds {
	private table: Record<string, string>;

	constructor(private store: KeyValueStore) {
		const saved = readJson<Record<string, string>>(store, STORAGE_KEYS.binds);
		this.table =
			saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...saved } : { ...DEFAULT_BINDS };
	}

	get(key: string): string | undefined {
		return this.table[key];
	}

	/** Returns the normalised key, or null if invalid. */
	bind(key: string, command: string): string | null {
		const k = normalizeKeyName(key);
		if (!k) return null;
		this.table[k] = command.trim();
		this.save();
		return k;
	}

	unbind(key: string): string | null {
		const k = normalizeKeyName(key);
		if (!k || !(k in this.table)) return null;
		delete this.table[k];
		this.save();
		return k;
	}

	reset(): void {
		this.table = { ...DEFAULT_BINDS };
		this.save();
	}

	entries(): Array<[string, string]> {
		return Object.entries(this.table).sort(([a], [b]) => a.localeCompare(b));
	}

	private save(): void {
		writeJson(this.store, STORAGE_KEYS.binds, this.table);
	}
}
