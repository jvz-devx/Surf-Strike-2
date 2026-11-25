import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WebSocket } from 'ws';
import { UNRELIABLE_BACKLOG_MIN, UNRELIABLE_BACKLOG_MULT, WsClientTransport } from './transport.ts';

function fakeSocket(bufferedAmount = 0) {
	const sent: Array<string | Uint8Array> = [];
	const ws = {
		OPEN: 1,
		readyState: 1,
		bufferedAmount,
		send(data: string | Uint8Array) {
			sent.push(data);
		},
		on() {},
		close() {},
		terminate() {}
	};
	return { ws: ws as unknown as WebSocket & { bufferedAmount: number; readyState: number }, sent };
}

describe('WsClientTransport', () => {
	it('drops droppable frames past a small snapshot backlog instead of buffering 1 MiB', () => {
		const { ws, sent } = fakeSocket(0);
		const t = new WsClientTransport(ws);
		const snap32p = new Uint8Array(1005); // 32-player v2 snapshot

		// Under budget (~3 snapshots = 3015 B): delivered.
		ws.bufferedAmount = 1005;
		assert.equal(t.sendUnreliable(snap32p), true);
		assert.equal(sent.length, 1);
		assert.equal(t.droppedUnreliable, 0);

		// Just above 3 snapshots (3016 B, far below old 1 MiB limit): dropped.
		ws.bufferedAmount = snap32p.byteLength * UNRELIABLE_BACKLOG_MULT + 1;
		assert.equal(t.sendUnreliable(snap32p), false);
		assert.equal(sent.length, 1);
		assert.equal(t.droppedUnreliable, 1);

		// Small 260 B snapshot uses UNRELIABLE_BACKLOG_MIN (2048 B) floor so normal bursts never drop.
		const snap8p = new Uint8Array(260);
		ws.bufferedAmount = UNRELIABLE_BACKLOG_MIN;
		assert.equal(t.sendUnreliable(snap8p), true);
		ws.bufferedAmount = UNRELIABLE_BACKLOG_MIN + 1;
		assert.equal(t.sendUnreliable(snap8p), false);
		assert.equal(t.droppedUnreliable, 2);

		// Reliable frames (JSON events, BIN_GHOST) are never dropped for backlog.
		ws.bufferedAmount = 100_000;
		t.sendReliable('{"type":"chat"}');
		t.sendReliable(new Uint8Array(500));
		assert.equal(sent.length, 4);
	});
});
