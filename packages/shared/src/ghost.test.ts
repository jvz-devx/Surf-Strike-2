import { describe, expect, it } from 'vitest';
import {
	decodeGhostFrame,
	deflateGhost,
	emptyGhostPose,
	encodeGhostFrame,
	GHOST_MAX_SAMPLES,
	GhostRecorder,
	ghostIndex,
	inflateGhost,
	packGhost,
	sampleGhost,
	unpackGhost,
	type GhostTrack
} from './ghost.ts';
import { BIN_GHOST, FLAG_DUCKED, FLAG_ON_GROUND, FLAG_TELEPORTED } from './protocol.ts';
import { TICK_RATE } from './units.ts';

/**
 * Bhop/surf-like trajectory: horizontal speed building up to ~1500 u/s while
 * air-strafing (yaw sweeping), jump arcs under gravity, ducks, one teleport.
 */
function fakeRun(seconds: number, seed = 1): { tracks: Array<[number, number, number, number, number, number, number]> } {
	let r = seed;
	const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
	const dt = 1 / TICK_RATE;
	let x = 100.03125;
	let y = -20.5;
	let z = 0;
	let vz = 0;
	let speed = 250;
	let yaw = 0;
	let heading = 0;
	let pitch = 5;
	const out: Array<[number, number, number, number, number, number, number]> = [];
	const n = Math.round(seconds * TICK_RATE);
	for (let i = 0; i <= n; i++) {
		const strafe = Math.sin(i / 23);
		yaw = heading * 57.29578 + strafe * 35 + (rnd() - 0.5) * 0.6;
		heading += strafe * 0.004;
		speed = Math.min(1500, speed + 1.5);
		x += Math.cos(heading) * speed * dt + (rnd() - 0.5) * 0.01;
		y += Math.sin(heading) * speed * dt;
		vz -= 800 * dt;
		z += vz * dt;
		let flags = 0;
		if (z <= 0) {
			z = 0;
			vz = 301.99;
			flags |= FLAG_ON_GROUND;
		}
		pitch += (rnd() - 0.5) * 0.4;
		if (i % 400 > 380) flags |= FLAG_DUCKED;
		if (i === Math.round(n / 2)) {
			x = 4000;
			y = 4000;
			flags |= FLAG_TELEPORTED;
		}
		out.push([i + 5000, Math.fround(x), Math.fround(y), Math.fround(z), pitch, yaw > 180 ? yaw - 360 : yaw, flags]);
	}
	return { tracks: out };
}

function record(seconds: number): GhostTrack {
	const rec = new GhostRecorder();
	const { tracks } = fakeRun(seconds);
	rec.start(tracks[0][0]);
	for (const s of tracks) rec.push(...s);
	const t = rec.finish(tracks[tracks.length - 1][0]);
	if (!t) throw new Error('no track');
	return t;
}

describe('GhostRecorder', () => {
	it('records run ticks from the start tick, ignores early/duplicate ticks', () => {
		const rec = new GhostRecorder();
		rec.push(10, 0, 0, 0, 0, 0, 0); // not started
		rec.start(100);
		rec.push(99, 1, 0, 0, 0, 0, 0); // before start
		rec.push(100, 2, 0, 0, 0, 0, 0);
		rec.push(100, 3, 0, 0, 0, 0, 0); // duplicate
		rec.push(102, 4.06, -1, 2, 10, -170, FLAG_DUCKED);
		rec.push(101, 5, 0, 0, 0, 0, 0); // out of order
		const t = rec.finish(102)!;
		expect(t.length).toBe(2);
		expect([...t.tick]).toEqual([0, 2]);
		expect(t.x[1]).toBe(Math.round(4.06 * 8));
		expect(rec.recording).toBe(false);
		expect(rec.finish(200)).toBeNull();
	});

	it('cancel and restart drop the old samples', () => {
		const rec = new GhostRecorder();
		rec.start(0);
		rec.push(0, 1, 1, 1, 0, 0, 0);
		rec.start(50);
		rec.push(50, 2, 2, 2, 0, 0, 0);
		expect(rec.finish(60)!.length).toBe(1);
		rec.start(0);
		rec.push(0, 1, 1, 1, 0, 0, 0);
		rec.cancel();
		expect(rec.finish(10)).toBeNull();
	});
});

describe('pack / unpack', () => {
	it('round-trips exactly (quantised values)', () => {
		const t = record(20);
		const back = unpackGhost(packGhost(t))!;
		expect(back).not.toBeNull();
		expect(back.length).toBe(t.length);
		for (const k of ['tick', 'x', 'y', 'z', 'pitch', 'yaw', 'flags'] as const) expect([...back[k]]).toEqual([...t[k]]);
	});

	it('quantisation error stays below 1/16 unit and 0.01 degrees', () => {
		const { tracks } = fakeRun(5);
		const t = record(5);
		const pose = emptyGhostPose();
		for (let i = 0; i < tracks.length; i += 7) {
			const [, x, y, z, pitch, yaw] = tracks[i];
			expect(sampleGhost(t, i, pose)).toBe(i);
			expect(Math.abs(pose.x - x)).toBeLessThanOrEqual(1 / 16);
			expect(Math.abs(pose.y - y)).toBeLessThanOrEqual(1 / 16);
			expect(Math.abs(pose.z - z)).toBeLessThanOrEqual(1 / 16);
			expect(Math.abs(pose.pitch - pitch)).toBeLessThan(0.01);
			const dy = Math.abs(((pose.yaw - yaw + 540) % 360) - 180);
			expect(dy).toBeLessThan(0.01);
		}
	});

	it('rejects malformed input', () => {
		const p = packGhost(record(2));
		expect(unpackGhost(p.subarray(0, p.length - 3))).toBeNull();
		expect(unpackGhost(new Uint8Array([2, 1, 0]))).toBeNull();
		expect(unpackGhost(new Uint8Array([1, 0]))).toBeNull();
		const extra = new Uint8Array(p.length + 1);
		extra.set(p);
		expect(unpackGhost(extra)).toBeNull();
	});

	it('size budget: a one-minute run deflates to well under 100 KB', async () => {
		const t = record(60);
		const raw = packGhost(t);
		const z = (await deflateGhost(raw))!;
		expect(z).not.toBeNull();
		// Measured: ~30 KB packed, ~11 KB deflated per minute (3841 samples).
		console.log(`ghost 60 s: ${t.length} samples, packed ${raw.length} B, deflated ${z.length} B`);
		expect(z.length).toBeLessThan(100_000);
		expect(raw.length).toBeLessThan(t.length * 12);
		const back = unpackGhost((await inflateGhost(z))!)!;
		expect([...back.x]).toEqual([...t.x]);
	});

	it('inflate refuses output larger than the limit', async () => {
		const z = (await deflateGhost(new Uint8Array(100_000)))!;
		expect(await inflateGhost(z, 1000)).toBeNull();
		expect((await inflateGhost(z))!.length).toBe(100_000);
		expect(await inflateGhost(new Uint8Array([255, 255, 255, 1, 2]))).toBeNull();
	});
});

describe('BIN_GHOST frame', () => {
	it('round-trips header and payload', () => {
		const payload = new Uint8Array([1, 2, 3, 4, 5]);
		const buf = encodeGhostFrame({ map: 'surf_ember', name: 'Zoë', ticks: 5000, samples: 4000 }, payload);
		expect(new Uint8Array(buf)[0]).toBe(BIN_GHOST);
		const f = decodeGhostFrame(buf)!;
		expect(f).toEqual({ has: true, map: 'surf_ember', name: 'Zoë', ticks: 5000, samples: 4000, payload });
	});

	it('"none" frame', () => {
		const f = decodeGhostFrame(encodeGhostFrame({ map: 'bhop_x', name: 'ignored', ticks: 9, samples: 9 }, null))!;
		expect(f).toEqual({ has: false, map: 'bhop_x', name: '', ticks: 0, samples: 0, payload: new Uint8Array(0) });
	});

	it('rejects truncated, foreign and oversized frames', () => {
		const buf = encodeGhostFrame({ map: 'm', name: 'n', ticks: 1, samples: 1 }, new Uint8Array([1]));
		expect(decodeGhostFrame(buf.slice(0, 8))).toBeNull();
		const other = new Uint8Array(buf.slice(0));
		other[0] = 2;
		expect(decodeGhostFrame(other.buffer)).toBeNull();
		const big = encodeGhostFrame({ map: 'm', name: 'n', ticks: 1, samples: GHOST_MAX_SAMPLES + 1 }, new Uint8Array([1]));
		expect(decodeGhostFrame(big)).toBeNull();
	});
});

describe('sampleGhost', () => {
	function track(ticks: number[], xs: number[], flags: number[] = []): GhostTrack {
		const rec = new GhostRecorder();
		rec.start(0);
		ticks.forEach((t, i) => rec.push(t, xs[i], 0, 0, 0, i * 90, flags[i] ?? 0));
		return rec.finish(ticks[ticks.length - 1] + 1)!;
	}

	it('interpolates between ticks, holds across teleports, ends after the last sample', () => {
		const t = track([0, 1, 2, 4, 5], [0, 10, 20, 40, 1000], [0, 0, 0, 0, FLAG_TELEPORTED]);
		const p = emptyGhostPose();
		expect(sampleGhost(t, 0.5, p)).toBe(0);
		expect(p.x).toBeCloseTo(5, 6);
		expect(p.yaw).toBeCloseTo(45, 2);
		sampleGhost(t, 3, p); // gap of 2 ticks
		expect(p.x).toBeCloseTo(30, 6);
		sampleGhost(t, 4.5, p); // next sample teleported: hold
		expect(p.x).toBe(40);
		expect(sampleGhost(t, 5, p)).toBe(4);
		expect(p.x).toBe(1000);
		expect(sampleGhost(t, 5.01, p)).toBe(-1);
		expect(sampleGhost(t, -1, p)).toBe(-1);
	});

	it('yaw interpolates the short way round', () => {
		const rec = new GhostRecorder();
		rec.start(0);
		rec.push(0, 0, 0, 0, 0, 170, 0);
		rec.push(1, 0, 0, 0, 0, -170, 0);
		const t = rec.finish(1)!;
		const p = emptyGhostPose();
		sampleGhost(t, 0.5, p);
		expect(Math.abs(Math.abs(p.yaw) - 180)).toBeLessThan(0.01);
	});

	it('ghostIndex with a hint matches binary search', () => {
		const t = record(3);
		let hint = -1;
		for (let time = 0; time < t.length; time += 0.37) {
			const a = ghostIndex(t, time, hint);
			expect(a).toBe(ghostIndex(t, time));
			hint = a;
		}
		expect(ghostIndex(t, 10, t.length - 1)).toBe(10);
	});
});
