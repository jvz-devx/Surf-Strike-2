import { describe, expect, it } from 'vitest';
import type { MapRecordInfo } from '@surf/shared';
import { mergeRecordsPush, recordFields } from './records.js';

const online: MapRecordInfo = { pbTicks: 640, pbSplits: [256], rank: 2, recordTicks: 512, recordName: 'Ana' };
const solo = { ticks: 400, splits: [200] };

describe('recordFields (HUD record panel)', () => {
	it('online: all four fields from the server, never the solo PB', () => {
		expect(recordFields('online', online, solo)).toEqual({ pbTicks: 640, pbRank: 2, recordTicks: 512, recordName: 'Ana' });
	});
	it('online without a PB still shows the map record', () => {
		const r = { ...online, pbTicks: null, pbSplits: null, rank: null };
		expect(recordFields('online', r, solo)).toEqual({ pbTicks: null, pbRank: null, recordTicks: 512, recordName: 'Ana' });
	});
	it('online before any records: empty, not the solo PB', () => {
		expect(recordFields('online', null, solo)).toEqual({ pbTicks: null, pbRank: null, recordTicks: null, recordName: null });
	});
	it('solo: the local PB only, never online records', () => {
		expect(recordFields('solo', online, solo)).toEqual({ pbTicks: 400, pbRank: null, recordTicks: null, recordName: null });
		expect(recordFields('solo', null, null)).toEqual({ pbTicks: null, pbRank: null, recordTicks: null, recordName: null });
	});
});

describe('mergeRecordsPush', () => {
	const pushed: MapRecordInfo = { ...online, rank: 3, recordTicks: 448, recordName: 'Bob' };
	it('takes a push for the current map online', () => {
		expect(mergeRecordsPush(online, { map: 'surf_a', records: pushed }, 'online', 'surf_a')).toBe(pushed);
		expect(mergeRecordsPush(null, { map: 'surf_a', records: pushed }, 'online', 'surf_a')).toBe(pushed);
	});
	it('ignores a push for another map or while solo', () => {
		expect(mergeRecordsPush(online, { map: 'surf_b', records: pushed }, 'online', 'surf_a')).toBe(online);
		expect(mergeRecordsPush(null, { map: 'surf_a', records: pushed }, 'solo', 'surf_a')).toBeNull();
	});
});
