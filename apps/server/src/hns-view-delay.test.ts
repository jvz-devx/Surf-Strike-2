/**
 * Hide and seek knife rewind: the view delay is derived from the shared
 * interpolation delay and snapshot rate, and is still the 116 ms it was as a
 * literal.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INTERP_DELAY_MS, SNAPSHOT_HZ } from '@surf/shared';
import { HNS_VIEW_DELAY_MS } from './modes/hns.ts';

test('HNS_VIEW_DELAY_MS: interpolation delay plus half a snapshot interval, 116 ms', () => {
	assert.equal(HNS_VIEW_DELAY_MS, 116);
	assert.equal(HNS_VIEW_DELAY_MS, INTERP_DELAY_MS + Math.round(1000 / SNAPSHOT_HZ / 2));
	assert.equal(INTERP_DELAY_MS, 100);
	// Half an interval is 15.625 ms at 32 Hz: the literal rounded it to 16.
	assert.equal(1000 / SNAPSHOT_HZ / 2, 15.625);
});
