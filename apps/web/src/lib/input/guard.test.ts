import { describe, expect, it, vi } from 'vitest';
import { GameFullscreen, keyboardLockApi } from './fullscreen.js';
import { isBrowserShortcut, LEAVE_GUARD_KEYS_MS, LEAVE_GUARD_MS, leaveGuardArmed, LOCK_KEYS } from './guard.js';
import { keyNameFromCode } from './keys.js';

const mods = (m: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}) => ({
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
	metaKey: false,
	...m
});

describe('isBrowserShortcut', () => {
	it('takes Ctrl with a letter, digit, sign or Tab', () => {
		for (const k of ['w', 't', 'n', 'q', 'r', 's', 'd', '1', '-', 'tab']) {
			expect(isBrowserShortcut(k, mods({ ctrlKey: true }))).toBe(true);
			expect(isBrowserShortcut(k, mods())).toBe(false);
		}
	});

	it('leaves plain game keys, AltGr, Cmd and developer tools alone', () => {
		expect(isBrowserShortcut('ctrl', mods({ ctrlKey: true }))).toBe(false);
		expect(isBrowserShortcut('space', mods({ ctrlKey: true }))).toBe(false);
		expect(isBrowserShortcut('f11', mods({ ctrlKey: true }))).toBe(false);
		expect(isBrowserShortcut('q', mods({ ctrlKey: true, altKey: true }))).toBe(false);
		expect(isBrowserShortcut('w', mods({ metaKey: true }))).toBe(false);
		expect(isBrowserShortcut('i', mods({ ctrlKey: true, shiftKey: true }))).toBe(false);
		expect(isBrowserShortcut('w', mods({ ctrlKey: true, shiftKey: true }))).toBe(true);
	});
});

describe('leaveGuardArmed', () => {
	const idle = { locked: false, sinceUnlock: Infinity, sinceGameKey: Infinity, overlay: false };

	it('asks while locked and shortly after', () => {
		expect(leaveGuardArmed({ ...idle, locked: true, overlay: true })).toBe(true);
		expect(leaveGuardArmed({ ...idle, sinceUnlock: LEAVE_GUARD_MS, overlay: true })).toBe(true);
	});

	it('lets a deliberate close from a menu through', () => {
		expect(leaveGuardArmed({ ...idle, sinceUnlock: LEAVE_GUARD_MS + 1, sinceGameKey: 0, overlay: true })).toBe(false);
	});

	it('asks while keys play the game without a pointer lock', () => {
		expect(leaveGuardArmed({ ...idle, sinceGameKey: LEAVE_GUARD_KEYS_MS })).toBe(true);
		expect(leaveGuardArmed({ ...idle, sinceGameKey: LEAVE_GUARD_KEYS_MS + 1 })).toBe(false);
		expect(leaveGuardArmed(idle)).toBe(false);
	});
});

describe('keyboard lock', () => {
	function fakes(over: { lock?: () => Promise<void>; activation?: boolean } = {}) {
		const listeners: Array<() => void> = [];
		const doc = {
			fullscreenEnabled: true,
			fullscreenElement: null as unknown,
			documentElement: {
				requestFullscreen: vi.fn(async () => {
					doc.fullscreenElement = doc.documentElement;
					for (const l of listeners) l();
				})
			},
			exitFullscreen: vi.fn(async () => {
				doc.fullscreenElement = null;
				for (const l of listeners) l();
			}),
			addEventListener: (_t: string, l: () => void) => void listeners.push(l),
			removeEventListener: vi.fn()
		};
		const nav = {
			keyboard: { lock: vi.fn(over.lock ?? (async () => {})), unlock: vi.fn() },
			userActivation: { isActive: over.activation ?? true }
		};
		const onLock = vi.fn();
		return { doc, nav, onLock, fs: new GameFullscreen(onLock, doc as unknown as Document, nav as unknown as Navigator) };
	}

	it('names only valid codes the game can bind, and Escape', () => {
		for (const c of LOCK_KEYS) expect(keyNameFromCode(c)).not.toBeNull();
		expect(LOCK_KEYS).toContain('KeyW');
		expect(LOCK_KEYS).toContain('Escape');
	});

	it('is feature-detected', () => {
		const kb = { lock: async () => {}, unlock: () => {} };
		expect(keyboardLockApi({ keyboard: kb }, { fullscreenEnabled: true })).toBe(kb);
		expect(keyboardLockApi({ keyboard: kb }, { fullscreenEnabled: false })).toBeNull();
		expect(keyboardLockApi({}, { fullscreenEnabled: true })).toBeNull(); // Firefox, Safari
		expect(keyboardLockApi(undefined, undefined)).toBeNull();
	});

	it('locks on entering fullscreen and unlocks on leaving', async () => {
		const { doc, nav, fs } = fakes();
		fs.enter();
		await Promise.resolve();
		expect(nav.keyboard.lock).toHaveBeenCalledWith(LOCK_KEYS);
		fs.enter(); // already there: only locks the keys again
		expect(nav.keyboard.lock).toHaveBeenCalledTimes(2);
		expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
		await Promise.resolve();
		fs.exit();
		expect(nav.keyboard.unlock).toHaveBeenCalledTimes(1);
		fs.enter(); // fullscreen was left: the next click asks again
		expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(2);
	});

	it('does not ask without a user gesture', () => {
		const { doc, fs } = fakes({ activation: false });
		fs.enter();
		expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
	});

	it('reports the lock result', async () => {
		const { fs, onLock } = fakes();
		fs.enter();
		await new Promise((r) => setTimeout(r));
		expect(onLock).toHaveBeenCalledWith(true);
	});

	it('survives a refused keyboard lock', async () => {
		const { fs, onLock } = fakes({ lock: () => Promise.reject(new Error('denied')) });
		fs.enter();
		await new Promise((r) => setTimeout(r));
		expect(fs.active).toBe(true);
		expect(onLock).toHaveBeenCalledWith(false);
	});
});
