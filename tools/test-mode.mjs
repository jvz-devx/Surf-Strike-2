#!/usr/bin/env node
/**
 * Targeted tests per gamemode: `pnpm test:mode <mode|all>` (`--list` for what runs).
 * Runs only the shared, server and web test files that cover one mode, so a
 * change to infected does not wait on the whole suite. `all` = pnpm check && pnpm test.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Test files in `dir` (relative to `pkg`) whose name starts with one of `prefixes`. */
function byPrefix(pkg, dir, prefixes) {
	const abs = join(ROOT, pkg, dir);
	if (!existsSync(abs)) return [];
	return readdirSync(abs)
		.filter((f) => f.endsWith('.test.ts') && prefixes.some((p) => f.startsWith(p)))
		.sort()
		.map((f) => `${dir}/${f}`);
}

const SHARED = 'packages/shared';
const SERVER = 'apps/server';
const WEB = 'apps/web';

/** Per mode: test files per package (paths relative to the package). */
const SUITES = {
	surf: {
		about: 'surf maps, movement, run tracker, server lobby/records/validation, web records',
		shared: () => ['src/maps/maps.test.ts', ...byPrefix(SHARED, 'src/maps', ['surf_']), 'src/movement/gamemovement.test.ts', 'src/run-tracker.test.ts'],
		server: () => ['src/lobby.test.ts', 'src/records.test.ts', 'src/validation.test.ts', 'src/ghost.test.ts'],
		web: () => ['src/lib/game/records.test.ts', 'src/lib/game/ghost.test.ts']
	},
	bhop: {
		about: 'bhop maps, movement, run tracker, server lobby/records/validation, web records',
		shared: () => ['src/maps/maps.test.ts', ...byPrefix(SHARED, 'src/maps', ['bhop_']), 'src/movement/gamemovement.test.ts', 'src/run-tracker.test.ts'],
		server: () => ['src/lobby.test.ts', 'src/records.test.ts', 'src/validation.test.ts', 'src/ghost.test.ts'],
		web: () => ['src/lib/game/records.test.ts', 'src/lib/game/ghost.test.ts']
	},
	tag: {
		about: 'shared tag rules + tag maps + maps, server tag.test.ts',
		shared: () => ['src/modes/tag.test.ts', 'src/maps/maps.test.ts', ...byPrefix(SHARED, 'src/maps', ['tag_'])],
		server: () => ['src/tag.test.ts'],
		web: () => []
	},
	zombies: {
		about: 'shared zombies rules + zombies maps + maps, server zombies.test.ts, web zombies-view',
		shared: () => ['src/modes/zombies/zombies.test.ts', 'src/maps/maps.test.ts', ...byPrefix(SHARED, 'src/maps', ['zombies_'])],
		server: () => ['src/zombies.test.ts'],
		web: () => ['src/lib/game/zombies-view.test.ts']
	},
	infected: {
		about: 'shared infected rules + infected_outpost + maps, server infected.test.ts, web infected game/render + format',
		shared: () => ['src/modes/infected/infected.test.ts', 'src/maps/maps.test.ts', ...byPrefix(SHARED, 'src/maps', ['infected_'])],
		server: () => ['src/infected.test.ts'],
		web: () => ['src/lib/game/infected.test.ts', 'src/lib/render/infected.test.ts', 'src/lib/ui/format.test.ts']
	}
};

/** Shell-free command per package. */
const RUNNERS = {
	shared: { pkg: SHARED, filter: '@surf/shared', cmd: (files) => ['vitest', '--run', ...files] },
	server: { pkg: SERVER, filter: 'server', cmd: (files) => ['node', '--import', 'tsx', '--test', ...files] },
	web: { pkg: WEB, filter: 'web', cmd: (files) => ['vitest', '--run', ...files] }
};

function usage() {
	const lines = ['Usage: pnpm test:mode <mode|all> [--list]', '', 'Modes:'];
	for (const [id, s] of Object.entries(SUITES)) lines.push(`  ${id.padEnd(9)} ${s.about}`);
	lines.push(`  ${'all'.padEnd(9)} pnpm check && pnpm test (everything)`);
	return lines.join('\n');
}

/** Resolved plan for a mode: [{ name, pkg, files, missing }]. */
function plan(mode) {
	const s = SUITES[mode];
	return Object.entries(RUNNERS).map(([name, r]) => {
		const all = [...new Set(s[name]())];
		const files = all.filter((f) => existsSync(join(ROOT, r.pkg, f)));
		const missing = all.filter((f) => !files.includes(f));
		return { name, runner: r, files, missing };
	});
}

function list() {
	console.log(usage());
	for (const mode of Object.keys(SUITES)) {
		console.log(`\n${mode}:`);
		for (const p of plan(mode)) {
			if (p.files.length === 0 && p.missing.length === 0) continue;
			console.log(`  ${p.runner.pkg}`);
			for (const f of p.files) console.log(`    ${f}`);
			for (const f of p.missing) console.log(`    ${f}  (missing, skipped)`);
		}
	}
}

function run(cmd, args) {
	console.log(`\n$ ${[cmd, ...args].join(' ')}`);
	const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
	if (r.error) {
		console.error(`test:mode: could not run ${cmd}: ${r.error.message}`);
		return 1;
	}
	return r.status ?? 1;
}

function main(argv) {
	const args = argv.filter((a) => a !== '--');
	if (args.includes('-h') || args.includes('--help')) {
		console.log(usage());
		return 0;
	}
	if (args.includes('--list')) {
		list();
		return 0;
	}
	if (args.length !== 1) {
		console.error(usage());
		return 2;
	}
	const mode = args[0].toLowerCase();
	if (mode === 'all') {
		return run('pnpm', ['check']) || run('pnpm', ['test']);
	}
	if (!Object.hasOwn(SUITES, mode)) {
		console.error(`test:mode: unknown mode "${args[0]}"\n\n${usage()}`);
		return 2;
	}
	const results = [];
	for (const p of plan(mode)) {
		for (const f of p.missing) console.warn(`test:mode: ${p.runner.pkg}/${f} not found, skipped`);
		if (p.files.length === 0) continue;
		const code = run('pnpm', ['--filter', p.runner.filter, 'exec', ...p.runner.cmd(p.files)]);
		results.push({ pkg: p.runner.pkg, files: p.files.length, code });
	}
	console.log(`\ntest:mode ${mode}:`);
	for (const r of results) console.log(`  ${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.pkg} (${r.files} file${r.files === 1 ? '' : 's'})`);
	return results.some((r) => r.code !== 0) ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
