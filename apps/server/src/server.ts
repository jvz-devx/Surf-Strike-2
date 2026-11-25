/** HTTP + WebSocket game server: `/health`, `/metrics`, `/ws`, and optional SvelteKit client handler. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import type { MapDef } from '@surf/shared';
import { PROTOCOL_VERSION, RTV_BLOCK, TICK_RATE } from '@surf/shared';
import { parseAdminUsernames } from './admin.ts';
import { Db } from './db.ts';
import { Lobby, MODE_TICK_HZ } from './lobby.ts';
import type { LobbyOptions } from './lobby.ts';
import { defaultMapId, loadMaps } from './maps.ts';
import { ServerMetrics } from './metrics.ts';
import {
	clientIp,
	isOriginAllowed,
	parseAllowedOrigins,
	parseTrustProxy,
	type AllowedOrigins,
	type TrustProxy
} from './proxy.ts';

export const DEFAULT_PORT = 27015;
export const DEFAULT_DB_PATH = resolve(fileURLToPath(new URL('..', import.meta.url)), 'data/surf.db');
/** Default per-IP connection limit when NODE_ENV=production and MAX_PER_IP is unset. */
export const DEFAULT_PROD_MAX_PER_IP = 3;
/** Time to wait for clients to acknowledge WebSocket close 1001 before force-terminating. */
export const DEFAULT_CLOSE_GRACE_MS = 2_000;

export type WebHandler = (req: IncomingMessage, res: ServerResponse, next?: () => void) => void;

export interface ServerOptions extends Omit<LobbyOptions, 'maps' | 'db'> {
	/** 0 = random free port. Default PORT env or 27015. */
	port?: number;
	/** Bind address. Default HOST env or all interfaces. */
	host?: string;
	/** SQLite path or ':memory:'. Default DB_PATH env or apps/server/data/surf.db. */
	dbPath?: string;
	/** Maps to serve; default: MAPS from @surf/shared. */
	maps?: MapDef[];
	/** Proxy trust policy for clientIp (default: TRUST_PROXY env or 'loopback'). */
	trustProxy?: TrustProxy | string;
	/** WebSocket Origin allow-list (default: ALLOWED_ORIGINS env or null = allow all). */
	allowedOrigins?: AllowedOrigins | string | null;
	/** SvelteKit adapter-node handler function or path to `handler.js` (default: WEB_HANDLER env). */
	webHandler?: WebHandler | string;
	/** Grace period (ms) for open WebSockets to close cleanly with 1001 on shutdown. */
	closeGraceMs?: number;
}

export interface GameServer {
	port: number;
	host: string;
	lobby: Lobby;
	db: Db;
	metrics: ServerMetrics;
	close(): Promise<void>;
}

function parseOptionalInt(raw: string | undefined, name: string, min: number): number | undefined {
	if (raw === undefined || raw.trim() === '') return undefined;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < min) throw new Error(`Invalid ${name}: ${raw}`);
	return n;
}

async function resolveWebHandler(spec: WebHandler | string | undefined): Promise<WebHandler | null> {
	if (!spec) return null;
	if (typeof spec === 'function') return spec;
	const abs = resolve(spec);
	const mod = (await import(pathToFileURL(abs).href)) as { handler?: unknown };
	if (typeof mod.handler !== 'function') {
		throw new Error(`WEB_HANDLER (${abs}) does not export a handler function`);
	}
	return mod.handler as WebHandler;
}

export async function startServer(opts: ServerOptions = {}): Promise<GameServer> {
	const maps = opts.maps ?? loadMaps();
	if (maps.length === 0) {
		throw new Error(
			'No maps found: @surf/shared does not export a non-empty MAPS yet. Implement packages/shared/src/maps first.'
		);
	}
	const port = opts.port ?? Number(process.env.PORT || DEFAULT_PORT);
	const host = opts.host ?? (process.env.HOST?.trim() || undefined);
	const dbPath = opts.dbPath ?? (process.env.DB_PATH || DEFAULT_DB_PATH);
	const trustProxy =
		typeof opts.trustProxy === 'string'
			? parseTrustProxy(opts.trustProxy)
			: (opts.trustProxy ?? parseTrustProxy(process.env.TRUST_PROXY));
	const allowedOrigins =
		opts.allowedOrigins === undefined
			? parseAllowedOrigins(process.env.ALLOWED_ORIGINS)
			: typeof opts.allowedOrigins === 'string'
				? parseAllowedOrigins(opts.allowedOrigins)
				: opts.allowedOrigins;
	const maxPerIp =
		opts.maxPerIp ??
		parseOptionalInt(process.env.MAX_PER_IP, 'MAX_PER_IP', 0) ??
		(process.env.NODE_ENV === 'production' ? DEFAULT_PROD_MAX_PER_IP : 0);
	const maxPending = opts.maxPending ?? parseOptionalInt(process.env.MAX_PENDING_CONNECTIONS, 'MAX_PENDING_CONNECTIONS', 1);
	const helloTimeoutMs = opts.helloTimeoutMs ?? parseOptionalInt(process.env.HELLO_TIMEOUT_MS, 'HELLO_TIMEOUT_MS', 100);
	const webHandler = await resolveWebHandler(opts.webHandler ?? (process.env.WEB_HANDLER?.trim() || undefined));
	const closeGraceMs = opts.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS;

	const db = new Db(dbPath);
	const metrics = new ServerMetrics(MODE_TICK_HZ);
	let lobby: Lobby;
	try {
		lobby = new Lobby({
			...devRotationOverride(),
			...opts,
			maxPerIp,
			...(maxPending === undefined ? {} : { maxPending }),
			...(helloTimeoutMs === undefined ? {} : { helloTimeoutMs }),
			metrics: opts.metrics ?? metrics,
			maps,
			db,
			initialMap: opts.initialMap ?? defaultMapId(maps),
			adminUsernames: opts.adminUsernames ?? parseAdminUsernames(process.env.ADMIN_USERNAMES)
		});
	} catch (err) {
		metrics.close();
		db.close();
		throw err;
	}

	const http = createServer((req, res) => {
		const path = (req.url ?? '/').split('?')[0];
		if (path === '/health') {
			res.writeHead(200, {
				'content-type': 'application/json',
				'cache-control': 'no-store',
				'access-control-allow-origin': '*'
			});
			res.end(
				JSON.stringify({
					ok: true,
					version: PROTOCOL_VERSION,
					tickRate: TICK_RATE,
					map: lobby.currentMap.id,
					mode: lobby.currentMap.kind,
					players: lobby.playerCount
				})
			);
			return;
		}
		if (path === '/metrics') {
			res.writeHead(200, {
				'content-type': 'text/plain; version=0.0.4; charset=utf-8',
				'cache-control': 'no-store'
			});
			res.end(metrics.render(lobby));
			return;
		}
		if (path === '/ws') {
			res.writeHead(426, { 'content-type': 'text/plain', upgrade: 'websocket' }).end('upgrade required');
			return;
		}
		if (webHandler) {
			webHandler(req, res, () => {
				if (!res.writableEnded) res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
			});
			return;
		}
		res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
	});

	const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
	http.on('upgrade', (req, socket, head) => {
		const path = (req.url ?? '/').split('?')[0];
		if (path !== '/ws') {
			socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
			socket.destroy();
			return;
		}
		if (!isOriginAllowed(req, allowedOrigins)) {
			socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
			socket.destroy();
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit('connection', ws, req);
		});
	});
	wss.on('connection', (socket, req) => lobby.handleConnection(socket, clientIp(req, trustProxy)));

	try {
		await new Promise<void>((ok, fail) => {
			http.once('error', fail);
			http.listen(port, host, () => {
				http.off('error', fail);
				ok();
			});
		});
	} catch (err) {
		lobby.close();
		metrics.close();
		db.close();
		throw err;
	}
	const addr = http.address() as AddressInfo;

	let closing: Promise<void> | null = null;
	const close = (): Promise<void> => {
		if (closing) return closing;
		closing = (async () => {
			// Stop timers, flush playtime/economy, and send WebSocket close 1001 to every client.
			lobby.close();
			for (const s of wss.clients) {
				if (s.readyState === s.OPEN || s.readyState === s.CONNECTING) {
					s.close(1001, 'server shutting down');
				}
			}
			// Wait briefly for the 1001 close frames to flush and clients to acknowledge.
			if (wss.clients.size > 0 && closeGraceMs > 0) {
				await new Promise<void>((done) => {
					let pending = wss.clients.size;
					const finish = () => {
						clearTimeout(timer);
						done();
					};
					const timer = setTimeout(finish, closeGraceMs);
					timer.unref();
					const onDone = () => {
						if (--pending <= 0) finish();
					};
					for (const s of wss.clients) {
						if (s.readyState === s.CLOSED) onDone();
						else s.once('close', onDone);
					}
				});
			}
			for (const s of wss.clients) s.terminate();
			wss.close();
			http.closeIdleConnections?.();
			await new Promise<void>((done) => {
				const hard = setTimeout(() => {
					http.closeAllConnections();
					done();
				}, 1_500);
				hard.unref();
				http.close(() => {
					clearTimeout(hard);
					done();
				});
				http.closeAllConnections();
			});
			metrics.close();
			db.close();
		})();
		return closing;
	};

	return {
		port: addr.port,
		host: addr.address,
		lobby,
		db,
		metrics,
		close
	};
}

/**
 * Dev/QA only: MAP_DURATION_OVERRIDE=<seconds> shortens each map (and the RTV
 * lockout to a quarter of it) so votes can be tested quickly. Ignored when
 * NODE_ENV=production.
 */
export function devRotationOverride(env: NodeJS.ProcessEnv = process.env): Pick<LobbyOptions, 'mapDuration' | 'rtvBlock'> {
	const secs = Number(env.MAP_DURATION_OVERRIDE);
	if (env.NODE_ENV === 'production' || !env.MAP_DURATION_OVERRIDE || !Number.isFinite(secs) || secs <= 0) return {};
	return { mapDuration: secs, rtvBlock: Math.min(RTV_BLOCK, secs / 4) };
}

/** Load apps/server/.env if present (Node's built-in loader). */
export function loadDotEnv(): void {
	const file = resolve(fileURLToPath(new URL('..', import.meta.url)), '.env');
	try {
		process.loadEnvFile(file);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
	}
}
