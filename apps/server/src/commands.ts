/** Chat commands (docs/gameplay.md#chat). */

export type Command =
	| { cmd: 'rtv' }
	| { cmd: 'top' }
	| { cmd: 'pb' }
	| { cmd: 'spec'; name: string }
	| { cmd: 'name'; name: string }
	| { cmd: 'help' }
	| { cmd: 'client' } // !r, !restart, !back: handled by the client
	| { cmd: 'unknown'; name: string };

export const HELP_LINES = [
	'Commands:',
	'!r / !restart: back to start, reset timer',
	'!back: back to the current stage or checkpoint',
	'!rtv: request a map vote (everyone answers 1 = yes, 2 = no)',
	'!top: top 10 for this map',
	'!pb: your PB and rank',
	'!spec [name]: spectate (a player, or the next one); again to play',
	'!name <new name>: change name (guests; accounts play as their username)',
	'!help: this list'
];

/** Parse a chat line that starts with '!'. Returns null for normal chat. */
export function parseCommand(text: string): Command | null {
	if (!text.startsWith('!')) return null;
	const body = text.slice(1).trim();
	const sp = body.search(/\s/);
	const name = (sp < 0 ? body : body.slice(0, sp)).toLowerCase();
	const arg = sp < 0 ? '' : body.slice(sp + 1).trim();
	switch (name) {
		case 'rtv':
			return { cmd: 'rtv' };
		case 'top':
			return { cmd: 'top' };
		case 'pb':
			return { cmd: 'pb' };
		case 'spec':
			return { cmd: 'spec', name: arg };
		case 'name':
			return { cmd: 'name', name: arg };
		case 'help':
		case 'commands':
			return { cmd: 'help' };
		case 'r':
		case 'restart':
		case 'back':
			return { cmd: 'client' };
		default:
			return { cmd: 'unknown', name };
	}
}
