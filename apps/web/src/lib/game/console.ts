/**
 * Developer console core: tokenizer, command registry, history and tab
 * completion. Game-specific commands are registered from commands.ts.
 */
export type PrintKind = 'input' | 'output' | 'error' | 'echo';

export interface CommandDef {
	name: string;
	help: string;
	/** Optional argument completion: returns full candidate arguments. */
	completeArgs?: (partial: string) => string[];
	run(args: string[], raw: string): void;
}

/**
 * Split a console line into statements on `;` (outside quotes), then each
 * statement into tokens (whitespace separated, double quotes group).
 */
export function splitStatements(line: string): string[] {
	const out: string[] = [];
	let cur = '';
	let quoted = false;
	for (const ch of line) {
		if (ch === '"') quoted = !quoted;
		if (ch === ';' && !quoted) {
			out.push(cur);
			cur = '';
		} else cur += ch;
	}
	out.push(cur);
	return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

export function tokenize(stmt: string): string[] {
	const out: string[] = [];
	const re = /"([^"]*)"?|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(stmt))) out.push(m[1] ?? m[2]);
	return out;
}

export interface ConsoleOptions {
	print(text: string, kind: PrintKind): void;
	/** Fallback for names not registered as commands (cvars). Return false if unknown. */
	fallback?(name: string, args: string[]): boolean;
	/** Extra completion names (cvar names). */
	names?(): string[];
	maxHistory?: number;
}

export class DevConsole {
	private commands = new Map<string, CommandDef>();
	private hist: string[] = [];

	constructor(private opts: ConsoleOptions) {}

	register(def: CommandDef): void {
		this.commands.set(def.name.toLowerCase(), def);
	}

	has(name: string): boolean {
		return this.commands.has(name.toLowerCase());
	}

	list(): CommandDef[] {
		return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	/** Run a line typed by the user: echoed and added to history. */
	submit(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;
		// The UI adds the "] " prompt prefix for 'input' lines.
		this.opts.print(trimmed, 'input');
		if (this.hist[this.hist.length - 1] !== trimmed) {
			this.hist.push(trimmed);
			const max = this.opts.maxHistory ?? 100;
			if (this.hist.length > max) this.hist.splice(0, this.hist.length - max);
		}
		this.exec(trimmed);
	}

	/** Run a line silently (binds, config). */
	exec(line: string): void {
		for (const stmt of splitStatements(line)) {
			const tokens = tokenize(stmt);
			if (tokens.length === 0) continue;
			const name = tokens[0].toLowerCase();
			const args = tokens.slice(1);
			const cmd = this.commands.get(name);
			if (cmd) {
				const rest = stmt.slice(stmt.indexOf(tokens[0]) + tokens[0].length).trim();
				cmd.run(args, rest);
			} else if (!this.opts.fallback?.(name, args)) {
				this.opts.print(`Unknown command: ${tokens[0]}`, 'error');
			}
		}
	}

	history(): string[] {
		return [...this.hist];
	}

	/** Full-line completions for a partial input line. */
	complete(prefix: string): string[] {
		const p = prefix.replace(/^\s+/, '');
		const space = p.indexOf(' ');
		if (space < 0) {
			const lower = p.toLowerCase();
			const names = new Set<string>();
			for (const c of this.commands.keys()) if (!c.startsWith('+') && !c.startsWith('-')) names.add(c);
			for (const n of this.opts.names?.() ?? []) names.add(n);
			return [...names].filter((n) => n.startsWith(lower)).sort();
		}
		const name = p.slice(0, space).toLowerCase();
		const partial = p.slice(space + 1).trimStart();
		const cmd = this.commands.get(name);
		if (!cmd?.completeArgs) return [];
		return cmd
			.completeArgs(partial)
			.filter((a) => a.toLowerCase().startsWith(partial.toLowerCase()))
			.sort()
			.map((a) => `${name} ${a}`);
	}
}
