/**
 * `pnpm host` (docs/architecture.md#start-up-flow): game server + cloudflared
 * quick tunnel + discovery publish/heartbeat.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { loadDotEnv, startServer } from './server.ts';
import type { HostEnv } from './tunnel.ts';
import { cloudflaredBinary, parseTunnelUrl, publishUrl, readHostEnv } from './tunnel.ts';

/** Public host only: clients allowed per IP address (docs/architecture.md#connection-limit). */
const HOST_MAX_PER_IP = 3;
const HEARTBEAT_MS = 60_000;
const TUNNEL_TIMEOUT_MS = 60_000;

loadDotEnv();

let env: HostEnv;
try {
	env = readHostEnv();
} catch (err) {
	console.error(`host: ${(err as Error).message}`);
	process.exit(1);
}

let server: Awaited<ReturnType<typeof startServer>>;
try {
	server = await startServer({ port: env.port, maxPerIp: HOST_MAX_PER_IP });
} catch (err) {
	console.error(`host: failed to start the game server: ${(err as Error).message}`);
	process.exit(1);
}
console.log(`host: game server on http://localhost:${server.port} (map ${server.lobby.currentMap.id})`);

const bin = cloudflaredBinary();
console.log(`host: starting ${bin} tunnel --url http://localhost:${server.port}`);
const tunnel: ChildProcess = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${server.port}`], {
	stdio: ['ignore', 'pipe', 'pipe']
});

let publicUrl: string | null = null;
let heartbeat: NodeJS.Timeout | null = null;
let stopping = false;

async function publish(url: string | null): Promise<boolean> {
	try {
		await publishUrl(env, url);
		return true;
	} catch (err) {
		console.error(`host: publish failed: ${(err as Error).message}`);
		return false;
	}
}

async function shutdown(code = 0): Promise<void> {
	if (stopping) return;
	stopping = true;
	console.log('host: shutting down');
	if (heartbeat) clearInterval(heartbeat);
	if (publicUrl) {
		if (await publish(null)) console.log('host: discovery cleared');
	}
	if (tunnel.exitCode === null) tunnel.kill('SIGTERM');
	await server.close();
	process.exit(code);
}

const tunnelTimeout = setTimeout(() => {
	if (!publicUrl) {
		console.error('host: cloudflared did not print a trycloudflare.com URL within 60 s');
		void shutdown(1);
	}
}, TUNNEL_TIMEOUT_MS);

function onOutput(chunk: Buffer): void {
	if (publicUrl) return;
	const url = parseTunnelUrl(chunk.toString('utf8'));
	if (!url) return;
	publicUrl = url;
	clearTimeout(tunnelTimeout);
	console.log(`host: tunnel up at ${url} (ws: ${url.replace(/^https/, 'wss')}/ws)`);
	void publish(url).then((ok) => {
		if (ok) console.log(`host: published to ${env.discoveryUrl}/api/server`);
	});
	heartbeat = setInterval(() => void publish(url), HEARTBEAT_MS);
}

tunnel.stdout?.on('data', onOutput);
tunnel.stderr?.on('data', onOutput);
tunnel.on('error', (err) => {
	console.error(`host: cannot run cloudflared (${bin}): ${err.message}. Set CLOUDFLARED to its path.`);
	void shutdown(1);
});
tunnel.on('exit', (code, signal) => {
	if (stopping) return;
	console.error(`host: cloudflared exited (${signal ?? code})`);
	void shutdown(1);
});

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));
