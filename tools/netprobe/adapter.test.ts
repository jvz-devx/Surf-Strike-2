import assert from 'node:assert/strict';
import test from 'node:test';
import { adapterFor } from './adapter.ts';
import { decodeState, encodeSnapshot, type SnapshotEntry } from './wire-v1.ts';

const first: SnapshotEntry = {
	id: 1, tick: 10, x: 100, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
	pitch: 0, yaw: 0, flags: 0, status: 1, stage: 0, runTicks: 0
};

test('v1 uses the 44-byte sender and original arrival-time teleport behavior', async () => {
	const adapter = await adapterFor(1);
	const { id, ...state } = first;
	const bytes = adapter.encode(state, 0);
	assert.equal(bytes.byteLength, 44);
	assert.deepEqual(decodeState(bytes), state);

	const observer = adapter.observer(new Set([id]));
	assert.equal(observer.render(id, 600).point, null);
	assert.equal(observer.snapshot(encodeSnapshot([first, { ...first, id: 2 }]), 600), true);
	assert.equal(observer.snapshot(encodeSnapshot([{ ...first, z: 384, flags: 4 }]), 640), true);
	assert.deepEqual(observer.render(id, 720), {
		point: { x: 100, y: 0, z: 192 }, delayMs: 100, underrun: false, held: false
	});
	assert.equal(observer.render(2, 720).point, null);
	assert.equal(observer.snapshot(encodeSnapshot([{ ...first, z: 1920, flags: 4 }]), 680), true);
	assert.equal(observer.render(id, 760).point?.z, 1920);
	assert.equal(observer.render(id, 800).held, true);
	assert.equal(observer.render(id, 4000).point, null);
	observer.clear();
	assert.equal(observer.render(id, 800).point, null);
});

test('unsupported health versions fail explicitly', async () => {
	await assert.rejects(adapterFor(3), /Unsupported server protocol v3/);
});
