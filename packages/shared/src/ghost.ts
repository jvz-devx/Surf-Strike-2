/**
 * Record ghosts (docs/gameplay.md#ghosts): a run's trajectory, recorded at
 * 64 Hz from the zone{start} tick to the zone{end} tick, and its compact
 * binary encoding. Used by the server (records validated runs from state
 * packets) and the client (records its own runs, plays ghosts back).
 *
 * Track: quantised samples, one per received tick.
 *   tick   run tick (tick - start tick), strictly increasing, first = 0
 *   x/y/z  position in 1/8 units (int32)
 *   pitch/yaw  uint16, 65536 = 360°
 *   flags  state flags (FLAG_DUCKED, FLAG_ON_GROUND, FLAG_TELEPORTED)
 *
 * Packed (uncompressed) format, column-wise for good deflate results:
 *   u8 version, varint count,
 *   varint tick[0], varint tick deltas,
 *   x, y, z: zigzag varint value[0], first delta, then second differences,
 *   pitch, yaw: zigzag varint of int16-wrapped deltas (from 0),
 *   flags: raw bytes.
 * The wire/storage form is this, deflate-raw compressed (server: node:zlib,
 * client: DecompressionStream). Shared code stays compression-free.
 *
 * BIN_GHOST frame (server -> client, protocol.ts):
 *   u8 BIN_GHOST, u8 GHOST_VERSION, u8 flags (bit 0: has ghost),
 *   u8 mapLen, map utf8, u8 nameLen, name utf8,
 *   u32 ticks, u32 sample count, then the deflated packed track.
 */
import { BIN_GHOST, FLAG_TELEPORTED } from './protocol.ts';
import { TICK_RATE } from './units.ts';

export const GHOST_VERSION = 1;
/** Position quantisation: units are stored as round(v * GHOST_POS_SCALE). */
export const GHOST_POS_SCALE = 8;
/** Longest recordable run (samples): 30 minutes at 64 Hz. Longer runs get no ghost. */
export const GHOST_MAX_SAMPLES = 30 * 60 * TICK_RATE;
/** Largest accepted inflated track (bytes); guards against decompression bombs. */
export const GHOST_MAX_RAW_BYTES = 16 << 20;
/** Gaps up to this many ticks are interpolated; longer gaps hold the earlier sample. */
export const GHOST_MAX_LERP_GAP = 32;

const ANGLE_SCALE = 65536 / 360;

export interface GhostTrack {
	length: number;
	tick: Int32Array;
	x: Int32Array;
	y: Int32Array;
	z: Int32Array;
	pitch: Uint16Array;
	yaw: Uint16Array;
	flags: Uint8Array;
}

/** Interpolated ghost pose (Source units and degrees). */
export interface GhostPose {
	x: number;
	y: number;
	z: number;
	pitch: number;
	yaw: number;
	flags: number;
}

export function emptyGhostPose(): GhostPose {
	return { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, flags: 0 };
}

function allocTrack(n: number): GhostTrack {
	return {
		length: 0,
		tick: new Int32Array(n),
		x: new Int32Array(n),
		y: new Int32Array(n),
		z: new Int32Array(n),
		pitch: new Uint16Array(n),
		yaw: new Uint16Array(n),
		flags: new Uint8Array(n)
	};
}

export function quantAngle(deg: number): number {
	return Math.round(deg * ANGLE_SCALE) & 0xffff;
}

/** uint16 angle to degrees in (-180, 180]. */
export function dequantAngle(q: number): number {
	const d = q / ANGLE_SCALE;
	return d > 180 ? d - 360 : d;
}

// ---------------------------------------------------------------------------
// Recording

/**
 * Records one run. `start(tick)` on the zone{start} tick, `push` every state
 * (ticks before the start, duplicates and out-of-order ticks are ignored),
 * `finish(endTick)` on zone{end}. Storage grows on demand up to
 * GHOST_MAX_SAMPLES; past that the run is dropped (finish returns null).
 */
export class GhostRecorder {
	private t: GhostTrack = allocTrack(0);
	private startTick = 0;
	private active = false;
	private overflow = false;

	get recording(): boolean {
		return this.active;
	}

	get length(): number {
		return this.t.length;
	}

	start(tick: number): void {
		this.active = true;
		this.overflow = false;
		this.startTick = tick;
		this.t.length = 0;
	}

	cancel(): void {
		this.active = false;
		this.t.length = 0;
	}

	push(tick: number, x: number, y: number, z: number, pitch: number, yaw: number, flags: number): void {
		if (!this.active || this.overflow) return;
		const rt = tick - this.startTick;
		const t = this.t;
		const n = t.length;
		if (rt < 0 || (n > 0 && rt <= t.tick[n - 1])) return;
		if (![x, y, z, pitch, yaw].every(Number.isFinite)) return;
		if (n >= GHOST_MAX_SAMPLES) {
			this.overflow = true;
			return;
		}
		if (n >= t.tick.length) this.grow();
		const g = this.t;
		g.tick[n] = rt;
		g.x[n] = Math.round(x * GHOST_POS_SCALE);
		g.y[n] = Math.round(y * GHOST_POS_SCALE);
		g.z[n] = Math.round(z * GHOST_POS_SCALE);
		g.pitch[n] = quantAngle(pitch);
		g.yaw[n] = quantAngle(yaw);
		g.flags[n] = flags & 0xff;
		g.length = n + 1;
	}

	/** Finish the run at `endTick`; returns a trimmed copy of the track, or null. */
	finish(endTick: number): GhostTrack | null {
		const t = this.t;
		const ok = this.active && !this.overflow && t.length > 0 && endTick > this.startTick;
		this.active = false;
		if (!ok) {
			t.length = 0;
			return null;
		}
		const out = sliceTrack(t, t.length);
		t.length = 0;
		return out;
	}

	private grow(): void {
		const old = this.t;
		const cap = Math.min(GHOST_MAX_SAMPLES, Math.max(1024, old.tick.length * 2));
		const t = allocTrack(cap);
		t.tick.set(old.tick);
		t.x.set(old.x);
		t.y.set(old.y);
		t.z.set(old.z);
		t.pitch.set(old.pitch);
		t.yaw.set(old.yaw);
		t.flags.set(old.flags);
		t.length = old.length;
		this.t = t;
	}
}

function sliceTrack(t: GhostTrack, n: number): GhostTrack {
	return {
		length: n,
		tick: t.tick.slice(0, n),
		x: t.x.slice(0, n),
		y: t.y.slice(0, n),
		z: t.z.slice(0, n),
		pitch: t.pitch.slice(0, n),
		yaw: t.yaw.slice(0, n),
		flags: t.flags.slice(0, n)
	};
}

// ---------------------------------------------------------------------------
// Packing (uncompressed)

class Writer {
	buf = new Uint8Array(1024);
	n = 0;
	private ensure(k: number): void {
		if (this.n + k <= this.buf.length) return;
		let cap = this.buf.length * 2;
		while (cap < this.n + k) cap *= 2;
		const b = new Uint8Array(cap);
		b.set(this.buf.subarray(0, this.n));
		this.buf = b;
	}
	u8(v: number): void {
		this.ensure(1);
		this.buf[this.n++] = v;
	}
	bytes(b: Uint8Array): void {
		this.ensure(b.length);
		this.buf.set(b, this.n);
		this.n += b.length;
	}
	/** Unsigned varint (values up to 2^53). */
	uv(v: number): void {
		this.ensure(8);
		while (v >= 0x80) {
			this.buf[this.n++] = (v % 0x80) | 0x80;
			v = Math.floor(v / 0x80);
		}
		this.buf[this.n++] = v;
	}
	/** Zigzag signed varint. */
	sv(v: number): void {
		this.uv(v >= 0 ? v * 2 : -v * 2 - 1);
	}
	done(): Uint8Array {
		return this.buf.slice(0, this.n);
	}
}

class Reader {
	o = 0;
	constructor(private b: Uint8Array) {}
	get ok(): boolean {
		return this.o <= this.b.length;
	}
	u8(): number {
		return this.o < this.b.length ? this.b[this.o++] : (this.o++, 0);
	}
	uv(): number {
		let v = 0;
		let mul = 1;
		for (let i = 0; i < 8; i++) {
			if (this.o >= this.b.length) {
				this.o++;
				return 0;
			}
			const c = this.b[this.o++];
			v += (c & 0x7f) * mul;
			if (c < 0x80) return v;
			mul *= 0x80;
		}
		this.o = this.b.length + 1; // too long: invalid
		return 0;
	}
	sv(): number {
		const u = this.uv();
		return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
	}
	bytes(n: number): Uint8Array {
		const s = this.b.subarray(this.o, this.o + n);
		this.o += n;
		return s;
	}
}

/** Wrap a (fractional) uint16 angle into [0, 65536). */
function wrap16(a: number): number {
	return ((a % 65536) + 65536) % 65536;
}

/** int16-wrapped difference of two uint16 angles. */
function angleDelta(a: number, b: number): number {
	const d = (b - a) & 0xffff;
	return d >= 0x8000 ? d - 0x10000 : d;
}

export function packGhost(t: GhostTrack): Uint8Array {
	const w = new Writer();
	const n = t.length;
	w.u8(GHOST_VERSION);
	w.uv(n);
	for (let i = 0; i < n; i++) w.uv(i === 0 ? t.tick[0] : t.tick[i] - t.tick[i - 1]);
	for (const c of [t.x, t.y, t.z]) {
		for (let i = 0; i < n; i++) {
			if (i === 0) w.sv(c[0]);
			else if (i === 1) w.sv(c[1] - c[0]);
			else w.sv(c[i] - 2 * c[i - 1] + c[i - 2]);
		}
	}
	for (const c of [t.pitch, t.yaw]) {
		for (let i = 0; i < n; i++) w.sv(angleDelta(i === 0 ? 0 : c[i - 1], c[i]));
	}
	w.bytes(t.flags.subarray(0, n));
	return w.done();
}

/** Inverse of packGhost; null on malformed input. */
export function unpackGhost(bytes: Uint8Array): GhostTrack | null {
	const r = new Reader(bytes);
	if (r.u8() !== GHOST_VERSION) return null;
	const n = r.uv();
	if (!r.ok || n <= 0 || n > GHOST_MAX_SAMPLES || n > bytes.length) return null;
	const t = allocTrack(n);
	t.length = n;
	let tick = 0;
	for (let i = 0; i < n; i++) {
		const d = r.uv();
		if (i > 0 && d <= 0) return null;
		tick += d;
		t.tick[i] = tick;
	}
	for (const c of [t.x, t.y, t.z]) {
		let v = 0;
		let dv = 0;
		for (let i = 0; i < n; i++) {
			const s = r.sv();
			if (i === 0) v = s;
			else if (i === 1) {
				dv = s;
				v += dv;
			} else {
				dv += s;
				v += dv;
			}
			c[i] = v;
		}
	}
	for (const c of [t.pitch, t.yaw]) {
		let v = 0;
		for (let i = 0; i < n; i++) {
			v = (v + r.sv()) & 0xffff;
			c[i] = v;
		}
	}
	t.flags.set(r.bytes(n));
	if (!r.ok || r.o !== bytes.length) return null;
	return t;
}

// ---------------------------------------------------------------------------
// BIN_GHOST frame

export interface GhostHeader {
	map: string;
	/** Holder's name ('' when there is no ghost). */
	name: string;
	/** Run time in ticks (0 when there is no ghost). */
	ticks: number;
	/** Sample count (0 when there is no ghost). */
	samples: number;
}

export interface GhostFrame extends GhostHeader {
	/** False: the server has no ghost for `map`. */
	has: boolean;
	/** Deflate-raw compressed packed track (empty when !has). */
	payload: Uint8Array;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function shortUtf8(s: string): Uint8Array {
	let b = enc.encode(s);
	if (b.length > 255) b = enc.encode(dec.decode(b.subarray(0, 255)).replace(/�$/, ''));
	return b.subarray(0, 255);
}

/** Build a BIN_GHOST frame; `payload` null = "no ghost for this map". */
export function encodeGhostFrame(h: GhostHeader, payload: Uint8Array | null): ArrayBuffer {
	const map = shortUtf8(h.map);
	const name = shortUtf8(payload ? h.name : '');
	const body = payload ?? new Uint8Array(0);
	const buf = new ArrayBuffer(3 + 1 + map.length + 1 + name.length + 8 + body.length);
	const u = new Uint8Array(buf);
	const v = new DataView(buf);
	let o = 0;
	u[o++] = BIN_GHOST;
	u[o++] = GHOST_VERSION;
	u[o++] = payload ? 1 : 0;
	u[o++] = map.length;
	u.set(map, o);
	o += map.length;
	u[o++] = name.length;
	u.set(name, o);
	o += name.length;
	v.setUint32(o, payload ? h.ticks >>> 0 : 0, true);
	v.setUint32(o + 4, payload ? h.samples >>> 0 : 0, true);
	o += 8;
	u.set(body, o);
	return buf;
}

export function decodeGhostFrame(buf: ArrayBuffer): GhostFrame | null {
	const u = new Uint8Array(buf);
	if (u.length < 13 || u[0] !== BIN_GHOST || u[1] !== GHOST_VERSION) return null;
	const has = (u[2] & 1) !== 0;
	let o = 3;
	const ml = u[o++];
	if (o + ml + 1 > u.length) return null;
	const map = dec.decode(u.subarray(o, o + ml));
	o += ml;
	const nl = u[o++];
	if (o + nl + 8 > u.length) return null;
	const name = dec.decode(u.subarray(o, o + nl));
	o += nl;
	const v = new DataView(buf);
	const ticks = v.getUint32(o, true);
	const samples = v.getUint32(o + 4, true);
	o += 8;
	const payload = u.slice(o);
	if (has && (payload.length === 0 || samples === 0 || samples > GHOST_MAX_SAMPLES)) return null;
	return { has, map, name, ticks, samples, payload };
}

// ---------------------------------------------------------------------------
// Playback sampling

/**
 * Index of the last sample with tick <= t (-1 if t is before the first).
 * `hint` (the previous result) makes sequential playback O(1).
 */
export function ghostIndex(t: GhostTrack, time: number, hint = -1): number {
	const n = t.length;
	if (n === 0 || time < t.tick[0]) return -1;
	let i = hint;
	if (i >= 0 && i < n && t.tick[i] <= time) {
		// Walk forward a few samples from the hint.
		for (let k = 0; k < 4 && i + 1 < n && t.tick[i + 1] <= time; k++) i++;
		if (i + 1 >= n || t.tick[i + 1] > time) return i;
	}
	let lo = 0;
	let hi = n - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (t.tick[mid] <= time) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

/**
 * Pose at fractional run tick `time`, interpolated between samples (not
 * across teleports or long gaps). Returns the sample index used, or -1 when
 * `time` is outside the track (before the first or after the last sample).
 */
export function sampleGhost(t: GhostTrack, time: number, out: GhostPose, hint = -1): number {
	const n = t.length;
	if (n === 0 || !(time >= 0) || time > t.tick[n - 1]) return -1;
	const i = Math.max(0, ghostIndex(t, time, hint));
	const s = GHOST_POS_SCALE;
	let j = i;
	let f = 0;
	if (i + 1 < n && time > t.tick[i]) {
		const gap = t.tick[i + 1] - t.tick[i];
		if (gap <= GHOST_MAX_LERP_GAP && (t.flags[i + 1] & FLAG_TELEPORTED) === 0) {
			j = i + 1;
			f = (time - t.tick[i]) / gap;
		}
	}
	out.x = (t.x[i] + (t.x[j] - t.x[i]) * f) / s;
	out.y = (t.y[i] + (t.y[j] - t.y[i]) * f) / s;
	out.z = (t.z[i] + (t.z[j] - t.z[i]) * f) / s;
	out.pitch = dequantAngle(wrap16(t.pitch[i] + angleDelta(t.pitch[i], t.pitch[j]) * f));
	out.yaw = dequantAngle(wrap16(t.yaw[i] + angleDelta(t.yaw[i], t.yaw[j]) * f));
	out.flags = f < 0.5 ? t.flags[i] : t.flags[j];
	return i;
}

// ---------------------------------------------------------------------------
// Streams compression (browser, and Node 18+ for tests). The server uses
// node:zlib deflateRawSync, which produces the same deflate-raw format.

/** True when CompressionStream/DecompressionStream('deflate-raw') can be used. */
export function ghostStreamsSupported(): boolean {
	try {
		if (typeof DecompressionStream === 'undefined' || typeof CompressionStream === 'undefined') return false;
		new DecompressionStream('deflate-raw');
		return true;
	} catch {
		return false;
	}
}

async function pump(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array | null> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let n = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		n += value.length;
		if (n > max) {
			await reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(n);
	let o = 0;
	for (const c of chunks) {
		out.set(c, o);
		o += c.length;
	}
	return out;
}

function through(bytes: Uint8Array, ts: CompressionStream | DecompressionStream, max: number): Promise<Uint8Array | null> {
	const src = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream();
	return pump(src.pipeThrough(ts as unknown as ReadableWritablePair<Uint8Array, Uint8Array>), max);
}

/** Inflate deflate-raw bytes (null if unsupported, malformed or larger than `max`). */
export async function inflateGhost(bytes: Uint8Array, max = GHOST_MAX_RAW_BYTES): Promise<Uint8Array | null> {
	if (!ghostStreamsSupported()) return null;
	try {
		return await through(bytes, new DecompressionStream('deflate-raw'), max);
	} catch {
		return null;
	}
}

/** Deflate-raw compress (null if unsupported). */
export async function deflateGhost(bytes: Uint8Array): Promise<Uint8Array | null> {
	if (!ghostStreamsSupported()) return null;
	try {
		return await through(bytes, new CompressionStream('deflate-raw'), Infinity);
	} catch {
		return null;
	}
}
