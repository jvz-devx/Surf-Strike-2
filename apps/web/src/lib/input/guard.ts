/**
 * Pure rules against accidental Ctrl+W (docs/ui.md#platform): which key
 * combinations the game swallows, when leaving the page asks first, and which
 * keys the Keyboard Lock API takes in fullscreen. No DOM access.
 */

/** Keep the leave-page prompt armed this long after the pointer lock ends (Ctrl+W also drops the lock). */
export const LEAVE_GUARD_MS = 2000;
/** Without a pointer lock or an overlay ("Click to play"): armed this long after the last game key or resume. */
export const LEAVE_GUARD_KEYS_MS = 10_000;

/**
 * KeyboardEvent.code values for `navigator.keyboard.lock()`. Shortcuts that close or replace the
 * tab or the browser (Ctrl+W, T, N, Q), plus Escape: with it the page gets a short Esc press and
 * the menu opens without leaving fullscreen (hold Esc to leave).
 */
export const LOCK_KEYS: readonly string[] = Object.freeze(['Escape', 'KeyW', 'KeyT', 'KeyN', 'KeyQ']);

export interface Modifiers {
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	metaKey: boolean;
}

/**
 * A Ctrl combination the browser would act on (close, reload, bookmark, tab switch, zoom, ...),
 * pressed while playing: crouch is on Ctrl, so it is a game key, not a shortcut. `name` is the bind
 * key name (physical position; every letter counts, so other layouts are covered). Left to the
 * browser: AltGr (Ctrl+Alt), Cmd, and Ctrl+Shift combinations (developer tools) except close/quit
 * and new tab/window.
 */
export function isBrowserShortcut(name: string, m: Modifiers): boolean {
	if (!m.ctrlKey || m.altKey || m.metaKey) return false;
	if (m.shiftKey) return /^[wtnq]$/.test(name) || name === 'tab';
	return name.length === 1 || name === 'tab';
}

export interface LeaveGuardState {
	/** Pointer locked right now. */
	locked: boolean;
	/** Ms since the pointer lock was last released. */
	sinceUnlock: number;
	/** Ms since the last game key (other than Ctrl) without an overlay open, or since returning to the game. */
	sinceGameKey: number;
	/** Menu, console, chat or account panel open. */
	overlay: boolean;
}

/** Ask "Leave site?" before the page closes. Deliberate closes from a menu leave without a prompt. */
export function leaveGuardArmed(s: LeaveGuardState): boolean {
	if (s.locked || s.sinceUnlock <= LEAVE_GUARD_MS) return true;
	return !s.overlay && s.sinceGameKey <= LEAVE_GUARD_KEYS_MS;
}
