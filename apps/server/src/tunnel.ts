/** cloudflared + discovery helpers used by host.ts (pure parts are unit-tested). */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TUNNEL_RE = /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com/i;

/** Extract the quick-tunnel URL from a chunk of cloudflared output. */
export function parseTunnelUrl(text: string): string | null {
	const m = TUNNEL_RE.exec(text);
	if (!m) return null;
	// cloudflared prints https://api.trycloudflare.com in some errors; that is not a tunnel.
	if (/^https:\/\/api\.trycloudflare\.com$/i.test(m[0])) return null;
	return m[0].toLowerCase();
}

/** cloudflared binary: $CLOUDFLARED, ~/.local/bin/cloudflared, else from PATH. */
export function cloudflaredBinary(env: NodeJS.ProcessEnv = process.env): string {
	if (env.CLOUDFLARED) return env.CLOUDFLARED;
	const local = join(homedir(), '.local/bin/cloudflared');
	return existsSync(local) ? local : 'cloudflared';
}

export interface HostEnv {
	hostSecret: string;
	discoveryUrl: string;
	port: number;
}

/** Read and check the host env vars. Throws with a readable message. */
export function readHostEnv(env: NodeJS.ProcessEnv = process.env): HostEnv {
	const missing: string[] = [];
	const hostSecret = env.HOST_SECRET?.trim() ?? '';
	const discoveryUrl = env.DISCOVERY_URL?.trim().replace(/\/+$/, '') ?? '';
	if (!hostSecret) missing.push('HOST_SECRET');
	if (!discoveryUrl) missing.push('DISCOVERY_URL');
	if (missing.length) {
		throw new Error(
			`Missing ${missing.join(' and ')}. Copy apps/server/.env.example to apps/server/.env and fill it in.`
		);
	}
	if (hostSecret.length < 32) throw new Error('HOST_SECRET must be at least 32 characters.');
	try {
		const u = new URL(discoveryUrl);
		if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
			throw new Error('bad protocol');
		}
	} catch {
		throw new Error(`DISCOVERY_URL is not a valid https URL: ${discoveryUrl}`);
	}
	const port = Number(env.PORT || 27015);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`PORT is invalid: ${env.PORT}`);
	return { hostSecret, discoveryUrl, port };
}

/** POST {url} to the discovery API. Never logs the secret. */
export async function publishUrl(
	env: Pick<HostEnv, 'hostSecret' | 'discoveryUrl'>,
	url: string | null,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await fetchImpl(`${env.discoveryUrl}/api/server`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${env.hostSecret}` },
		body: JSON.stringify({ url }),
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) {
		const body = (await res.text().catch(() => '')).slice(0, 200);
		throw new Error(`discovery API answered ${res.status}${body ? `: ${body}` : ''}`);
	}
}
