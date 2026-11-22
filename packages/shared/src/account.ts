/**
 * Account rules shared by the client (inline validation) and the server
 * (authoritative checks): docs/gameplay.md#accounts-and-identity.
 * Username: 1-24 chars, no whitespace, printable characters only, unique
 * case-insensitively. Password: 5-128 chars, nothing else.
 */

export const USERNAME_MAX = 24;
export const PASSWORD_MIN = 5;
export const PASSWORD_MAX = 128;

/** Any whitespace (ASCII and Unicode). */
const WHITESPACE = /\s/u;
/** Control, format (zero-width, bidi), private-use, surrogate and unassigned code points. */
const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}]/u;

/** Canonical form for storage and lookup (NFC). */
export function normalizeUsername(raw: string): string {
	return raw.normalize('NFC');
}

/** Case-insensitive key for uniqueness. */
export function usernameKey(username: string): string {
	return normalizeUsername(username).toLowerCase();
}

/** Null when valid, else a short user-facing reason. */
export function usernameError(raw: string): string | null {
	const u = normalizeUsername(raw);
	if (u.length === 0) return 'Enter a username.';
	if (WHITESPACE.test(u)) return 'Username cannot contain spaces.';
	if (NON_PRINTABLE.test(u)) return 'Username contains invalid characters.';
	if (u.length > USERNAME_MAX) return `Username can be at most ${USERNAME_MAX} characters.`;
	return null;
}

/** Null when valid, else a short user-facing reason. */
export function passwordError(password: string): string | null {
	if (password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
	if (password.length > PASSWORD_MAX) return `Password can be at most ${PASSWORD_MAX} characters.`;
	return null;
}
