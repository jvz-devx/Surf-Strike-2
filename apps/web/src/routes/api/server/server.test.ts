import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './+server.js';

const URL_ = 'https://some-tunnel.trycloudflare.com';

// Outside Vercel the runtime cache is in memory.
async function post(body: unknown, secret = 'test-secret') {
	const request = new Request('http://localhost/api/server', { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify(body) });
	return POST({ request } as Parameters<typeof POST>[0]);
}

async function get() {
	const res = await GET({} as Parameters<typeof GET>[0]);
	return (await res.json()) as { url: string | null; lastSeen?: number };
}

describe('/api/server', () => {
	beforeEach(() => {
		vi.useFakeTimers({ now: 1_800_000_000_000, toFake: ['Date'] });
		vi.stubEnv('HOST_SECRET', 'test-secret');
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it('hands out the published URL until it is cleared', async () => {
		expect((await post({ url: URL_ })).status).toBe(200);
		expect(await get()).toEqual({ url: URL_, lastSeen: Date.now() });
		expect((await post({ url: null })).status).toBe(200);
		expect(await get()).toEqual({ url: null });
	});

	it('keeps the start time over heartbeats and forgets a silent host', async () => {
		const first = (await (await post({ url: URL_ })).json()) as { startedAt: number };
		vi.advanceTimersByTime(60_000);
		const second = (await (await post({ url: URL_ })).json()) as { startedAt: number; lastSeen: number };
		expect(second.startedAt).toBe(first.startedAt);
		expect(second.lastSeen).toBe(first.startedAt + 60_000);
		vi.advanceTimersByTime(3 * 60_000 + 1);
		expect(await get()).toEqual({ url: null });
	});

	it('refuses a wrong secret and bad URLs', async () => {
		await post({ url: null });
		expect((await post({ url: URL_ }, 'wrong')).status).toBe(401);
		expect((await post({ url: 'http://example.com' })).status).toBe(400);
		expect((await post({})).status).toBe(400);
		expect(await get()).toEqual({ url: null });
	});
});
