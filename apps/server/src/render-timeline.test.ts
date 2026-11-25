import assert from 'node:assert/strict';
import { it } from 'node:test';
import { observeRenderTime, renderRewindMs, type ModePlayer } from './modes/types.ts';

const history = 400;
const peer = () => ({ ping: 80, hasRttSample: true }) as ModePlayer;

it('keeps timestamp and legacy attacks on one slowly changing timeline', () => {
	const p = peer();
	const now = 1000;
	assert.equal(renderRewindMs(now - 110, now, p, history, 0), 110);
	for (let i = 1; i <= 6; i++) {
		const at = now + 200 * i;
		const modern = i % 2 === 0;
		const result = renderRewindMs(modern ? at - 290 : undefined, at, p, history, 0);
		assert.ok(result !== undefined && result >= 60 && result <= 180, String(result));
	}
});

it('keeps an invalid timestamp on the established timeline', () => {
	const p = peer();
	assert.equal(renderRewindMs(890, 1000, p, history, 0), 110);
	assert.equal(renderRewindMs(800, 1400, p, history, 0), 110);
});


it('uses recent states to bound attacks even when the shooter changes claim formats', () => {
	const p = peer();
	for (let now = 1000; now <= 2000; now += 20) {
		observeRenderTime(now - 110, now, p);
		assert.equal(renderRewindMs(now - 290, now, p, history, 0), 142);
		assert.equal(renderRewindMs(undefined, now, p, history, 0), 78);
	}
});
