/** Map KeyboardEvent.code to Source-style bind key names. */
const SPECIAL: Record<string, string> = {
	Space: 'space',
	ControlLeft: 'ctrl',
	ControlRight: 'ctrl',
	ShiftLeft: 'shift',
	ShiftRight: 'shift',
	AltLeft: 'alt',
	AltRight: 'alt',
	MetaLeft: 'meta',
	MetaRight: 'meta',
	Tab: 'tab',
	Enter: 'enter',
	NumpadEnter: 'kp_enter',
	Escape: 'escape',
	Backspace: 'backspace',
	Backquote: '`',
	Minus: '-',
	Equal: '=',
	BracketLeft: '[',
	BracketRight: ']',
	Backslash: '\\',
	Semicolon: 'semicolon',
	Quote: "'",
	Comma: ',',
	Period: '.',
	Slash: '/',
	CapsLock: 'capslock',
	ArrowUp: 'uparrow',
	ArrowDown: 'downarrow',
	ArrowLeft: 'leftarrow',
	ArrowRight: 'rightarrow',
	Insert: 'ins',
	Delete: 'delete',
	Home: 'home',
	End: 'end',
	PageUp: 'pgup',
	PageDown: 'pgdn',
	IntlBackslash: '\\'
};

export function keyNameFromCode(code: string, key?: string): string | null {
	if (SPECIAL[code]) return SPECIAL[code];
	let m = /^Key([A-Z])$/.exec(code);
	if (m) return m[1].toLowerCase();
	m = /^Digit(\d)$/.exec(code);
	if (m) return m[1];
	m = /^F(\d{1,2})$/.exec(code);
	if (m) return `f${m[1]}`;
	m = /^Numpad(\d)$/.exec(code);
	if (m) return `kp_${m[1]}`;
	// Unknown code (rare layouts): fall back to the produced character.
	if (key && key.length === 1) return key.toLowerCase();
	return null;
}

export function mouseButtonName(button: number): string {
	// DOM: 0 left, 1 middle, 2 right. Source: mouse1 left, mouse2 right, mouse3 middle.
	if (button === 1) return 'mouse3';
	if (button === 2) return 'mouse2';
	return `mouse${button + 1}`;
}
