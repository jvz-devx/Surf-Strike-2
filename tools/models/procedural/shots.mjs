// Headless screenshots of a first-person model in the dev viewer (`/?mockvm`),
// for checking a script-built gun in the game's view. Nothing opens on screen.
//
//   PLAYWRIGHT=<dir> node tools/models/procedural/shots.mjs <weapon id> <out dir> [base url]
//
// PLAYWRIGHT: a directory whose node_modules holds playwright-core (install it
// in a scratch directory, not in the workspace: `npm i playwright-core`).
// CHROMIUM: a Chromium or headless-shell binary (default: Playwright's own).
// The base url defaults to http://localhost:6573, a Vite dev server started with
// `pnpm --filter web exec vite dev --port 6573 --strictPort`. Every request to
// another host or port is blocked, so the page never reaches a game server.
// Writes <weapon>-<pose>-<bg>.png at 1920x1080 for the hip and fully aimed
// poses on the light and dark backgrounds, and a side view, each once the
// viewer's label says which model it drew.
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [weapon, out, base = 'http://localhost:6573'] = process.argv.slice(2);
if (!weapon || !out) {
	console.error('usage: PLAYWRIGHT=<dir> node shots.mjs <weapon id> <out dir> [base url]');
	process.exit(2);
}
const pwDir = process.env.PLAYWRIGHT;
if (!pwDir) {
	console.error('PLAYWRIGHT must name a directory with node_modules/playwright-core');
	process.exit(2);
}
const { chromium } = await import(pathToFileURL(join(pwDir, 'node_modules/playwright-core/index.mjs')).href);
mkdirSync(out, { recursive: true });
const origin = new URL(base).origin;
const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.CHROMIUM || undefined,
	args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.route('**/*', (r) => (new URL(r.request().url()).origin === origin ? r.continue() : r.abort()));
page.on('pageerror', (e) => console.error('page error:', e.message));
const shots = [
	['rest', 'light', 'view=fp&pose=rest'],
	['rest', 'dark', 'view=fp&pose=rest'],
	['aim', 'light', 'view=fp&pose=aim'],
	['aim', 'dark', 'view=fp&pose=aim'],
	['side', 'light', 'view=side&pose=rest']
];
for (const [pose, bg, q] of shots) {
	await page.goto(`${base}/?mockvm&weapon=${weapon}&${q}&bg=${bg}`);
	// The first frame waits for the model; the label then ends in "generated" or "code-built".
	const label = await page
		.waitForFunction(() => [...document.querySelectorAll('span')].map((s) => s.textContent ?? '').find((t) => / · (generated|code-built)$/.test(t)), null, { timeout: 60_000 })
		.then((h) => h.jsonValue());
	await page.waitForTimeout(500);
	const file = join(out, `${weapon}-${pose}-${bg}.png`);
	await page.screenshot({ path: file });
	console.log(file, '|', label);
}
await browser.close();
