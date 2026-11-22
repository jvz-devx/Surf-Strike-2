/**
 * Discovery API (docs/architecture.md#start-up-flow).
 *
 * POST /api/server  Authorization: Bearer <HOST_SECRET>  body { url: string | null }
 *   Stores { url, startedAt, lastSeen } at a fixed Vercel Blob path.
 * GET  /api/server  -> { url, lastSeen } or { url: null } (absent, cleared or stale > 3 min).
 *
 * Env (server only): HOST_SECRET, BLOB_READ_WRITE_TOKEN, optional BLOB_ACCESS
 * ('private' default, or 'public' to match the store's access mode).
 *
 * Env vars are read from process.env: SvelteKit 3's `$env/dynamic/private`
 * only exposes variables declared with defineEnvVars.
 */
import { json } from '@sveltejs/kit';
import { get, put } from '@vercel/blob';
import type { RequestHandler } from './$types';

const BLOB_PATH = 'discovery/server.json';
const STALE_MS = 3 * 60 * 1000;
const MAX_URL = 512;
const NO_STORE = { 'cache-control': 'no-store, max-age=0' };

interface DiscoveryRecord {
	url: string | null;
	startedAt: number | null;
	lastSeen: number;
}

function env(name: string): string | undefined {
	const p = (globalThis as { process?: { env?: { [k: string]: string | undefined } } }).process;
	const v = p?.env?.[name];
	return v ? v : undefined;
}

function access(): 'public' | 'private' {
	return env('BLOB_ACCESS') === 'public' ? 'public' : 'private';
}

async function sha256(s: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** Constant-time comparison (hash first so lengths always match). */
async function safeEqual(a: string, b: string): Promise<boolean> {
	const [x, y] = await Promise.all([sha256(a), sha256(b)]);
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
	return diff === 0;
}

/** Accept null, https/wss URLs, or http/ws on localhost. Returns the normalized URL or undefined if invalid. */
function normalizeServerUrl(v: unknown): string | null | undefined {
	if (v === null) return null;
	if (typeof v !== 'string' || v.length === 0 || v.length > MAX_URL) return undefined;
	let u: URL;
	try {
		u = new URL(v);
	} catch {
		return undefined;
	}
	if (u.username || u.password || u.search || u.hash) return undefined;
	const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
	const secure = u.protocol === 'https:' || u.protocol === 'wss:';
	const plain = u.protocol === 'http:' || u.protocol === 'ws:';
	if (!secure && !(plain && local)) return undefined;
	const path = u.pathname.replace(/\/+$/, '');
	return `${u.protocol}//${u.host}${path}`;
}

async function readRecord(token: string): Promise<DiscoveryRecord | null> {
	const res = await get(BLOB_PATH, { access: access(), token, useCache: false });
	if (!res || res.statusCode !== 200) return null;
	const data = (await new Response(res.stream).json()) as Partial<DiscoveryRecord>;
	if (typeof data !== 'object' || data === null || typeof data.lastSeen !== 'number') return null;
	return {
		url: typeof data.url === 'string' ? data.url : null,
		startedAt: typeof data.startedAt === 'number' ? data.startedAt : null,
		lastSeen: data.lastSeen
	};
}

export const GET: RequestHandler = async () => {
	const token = env('BLOB_READ_WRITE_TOKEN');
	if (!token) return json({ url: null }, { headers: NO_STORE });
	try {
		const rec = await readRecord(token);
		if (!rec || !rec.url || Date.now() - rec.lastSeen > STALE_MS) return json({ url: null }, { headers: NO_STORE });
		return json({ url: rec.url, lastSeen: rec.lastSeen }, { headers: NO_STORE });
	} catch (err) {
		console.error('discovery GET failed:', (err as Error).message);
		return json({ url: null }, { headers: NO_STORE });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const secret = env('HOST_SECRET');
	const token = env('BLOB_READ_WRITE_TOKEN');
	if (!secret || !token) {
		return json({ error: 'discovery not configured' }, { status: 503, headers: NO_STORE });
	}
	const auth = request.headers.get('authorization') ?? '';
	const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
	if (!(await safeEqual(given, secret))) {
		return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid JSON' }, { status: 400, headers: NO_STORE });
	}
	const url = normalizeServerUrl((body as { url?: unknown } | null)?.url);
	if (url === undefined) {
		return json({ error: 'url must be null or an https/wss URL' }, { status: 400, headers: NO_STORE });
	}

	try {
		const now = Date.now();
		let startedAt: number | null = null;
		if (url) {
			const prev = await readRecord(token).catch(() => null);
			startedAt = prev && prev.url === url && prev.startedAt ? prev.startedAt : now;
		}
		const rec: DiscoveryRecord = { url, startedAt, lastSeen: now };
		await put(BLOB_PATH, JSON.stringify(rec), {
			access: access(),
			token,
			addRandomSuffix: false,
			allowOverwrite: true,
			contentType: 'application/json',
			cacheControlMaxAge: 60
		});
		return json({ ok: true, ...rec }, { headers: NO_STORE });
	} catch (err) {
		console.error('discovery POST failed:', (err as Error).message);
		return json({ error: 'blob write failed' }, { status: 502, headers: NO_STORE });
	}
};
