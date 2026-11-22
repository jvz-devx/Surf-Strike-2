import { describe, expect, it } from 'vitest';
import { passwordError, usernameError, usernameKey } from './account.ts';

describe('account rules', () => {
	it('accepts simple usernames', () => {
		for (const u of ['a', 'Alice', 'x_y-z.9', 'Ünïcødé', 'a'.repeat(24)]) expect(usernameError(u)).toBeNull();
	});

	it('rejects empty, whitespace, non-printable and long usernames', () => {
		expect(usernameError('')).toMatch(/Enter/);
		for (const u of ['a b', ' a', 'a ', 'a\tb', 'a\nb', 'a b', 'a　b']) expect(usernameError(u)).toMatch(/spaces/);
		for (const u of ['a\u0000b', 'a​b', 'a‮b', 'a\u007f']) expect(usernameError(u)).toMatch(/invalid/);
		expect(usernameError('a'.repeat(25))).toMatch(/at most 24/);
	});

	it('keys usernames case-insensitively', () => {
		expect(usernameKey('Alice')).toBe(usernameKey('aLICE'));
		expect(usernameKey('é')).toBe(usernameKey('é'));
	});

	it('password: 5 to 128 chars, anything allowed', () => {
		expect(passwordError('1234')).toMatch(/at least 5/);
		expect(passwordError('12345')).toBeNull();
		expect(passwordError('  sp  aces ')).toBeNull();
		expect(passwordError('x'.repeat(128))).toBeNull();
		expect(passwordError('x'.repeat(129))).toMatch(/at most 128/);
	});
});
