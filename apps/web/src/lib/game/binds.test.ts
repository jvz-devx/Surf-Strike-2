import { describe, expect, it } from 'vitest';
import { Binds, DEFAULT_BINDS, normalizeKeyName } from './binds.js';
import { keyNameFromCode, mouseButtonName } from '../input/keys.js';
import { memoryStore } from './storage.js';

describe('binds', () => {
	it('has the documented defaults', () => {
		const b = new Binds(memoryStore());
		expect(b.get('w')).toBe('+forward');
		expect(b.get('space')).toBe('+jump');
		expect(b.get('mwheeldown')).toBe('+jump');
		expect(b.get('ctrl')).toBe('+duck');
		expect(b.get('y')).toBe('messagemode');
		expect(b.get('tab')).toBe('+showscores');
		expect(b.get('3')).toBe('vote 3');
		expect(b.get('m')).toBe('spectate');
		expect(b.get('r')).toBe('restart');
		expect(b.get('`')).toBe('toggleconsole');
	});
	it('normalises key names', () => {
		expect(normalizeKeyName('SPACE')).toBe('space');
		expect(normalizeKeyName('~')).toBe('`');
		expect(normalizeKeyName('LCTRL')).toBe('ctrl');
		expect(normalizeKeyName('esc')).toBeNull();
		expect(normalizeKeyName('')).toBeNull();
	});
	it('persists bind and unbind', () => {
		const store = memoryStore();
		const a = new Binds(store);
		a.bind('MOUSE3', '+duck');
		a.unbind('r');
		const b = new Binds(store);
		expect(b.get('mouse3')).toBe('+duck');
		expect(b.get('r')).toBeUndefined();
		b.reset();
		expect(new Binds(store).entries()).toEqual(Object.entries(DEFAULT_BINDS).sort(([x], [y]) => x.localeCompare(y)));
	});
	it('maps DOM codes to bind names', () => {
		expect(keyNameFromCode('KeyW')).toBe('w');
		expect(keyNameFromCode('Digit1')).toBe('1');
		expect(keyNameFromCode('ControlLeft')).toBe('ctrl');
		expect(keyNameFromCode('Backquote')).toBe('`');
		expect(keyNameFromCode('F5')).toBe('f5');
		expect(keyNameFromCode('Space')).toBe('space');
		expect(mouseButtonName(0)).toBe('mouse1');
		expect(mouseButtonName(1)).toBe('mouse3');
		expect(mouseButtonName(2)).toBe('mouse2');
	});
});
