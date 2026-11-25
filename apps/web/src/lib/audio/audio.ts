/**
 * Game sounds from real CC0 recordings (docs/ui.md#audio, CREDITS.md).
 * The AudioContext is created on the first user gesture, then the files in
 * /sfx are fetched and decoded. A missing or undecodable file only silences
 * that sound.
 *
 * Graph: each event → its gain → dry bus → master, and → reverb send →
 * ConvolverNode (measured hall IR) → master. Wind (low-passed by speed) and
 * the ramp slide are seamless loops. Master → safety limiter → destination.
 *
 * Combat sounds (infected, zombies) play on a fixed set of voices, each a
 * gain → stereo panner feeding the same dry bus and reverb send. Their pools
 * (SFX_DEFERRED) are fetched after the core set.
 */
import { COMBAT_VOICES, INFECTED_CHIMES, INFECTED_SOUNDS, ZOMBIES_SOUNDS, combatDb, voiceKey, type CombatSound } from '#lib/audio/combat.js';
import {
	Cycle,
	DEFAULT_VOLUME,
	LAND_MIN_SPEED,
	LIMITER_THRESHOLD_DB,
	REVERB_SEND_DB,
	STEP_DISTANCE,
	STEP_MIN_SPEED,
	VoicePool,
	crashBuild,
	dbToGain,
	distanceDb,
	eventDb,
	landDb,
	loopRegion,
	panFor,
	slideGain,
	stepAdvance,
	stepDb,
	variationDb,
	windParams
} from '#lib/audio/mix.js';
import { SFX_DEFERRED, SFX_EVENTS, SFX_IR, SFX_LOOPS } from '#lib/audio/sfx.js';

const SFX_BASE = '/sfx/';

export interface MovementAudioState {
	speed: number; // horizontal u/s
	onGround: boolean;
	surfing: boolean;
	ducked: boolean;
	/** False while spectating or paused: movement sounds fade out. */
	active: boolean;
}

type EventGroup = keyof typeof SFX_EVENTS;
type LoopName = keyof typeof SFX_LOOPS;
type Vec = { x: number; y: number; z: number };

const DEFERRED: ReadonlySet<EventGroup> = new Set(SFX_DEFERRED);
/** Fade (s) of a combat voice that a newer sound takes over. */
const VOICE_CUT_SECONDS = 0.003;

/** Loops that only play while something needs them. */
type BuildLoop = 'roll' | 'timpani';

/** The crash build-up fades by itself when nothing drives it for this long (s): a hidden tab, a closed menu. */
const BUILD_HOLD = 0.35;

export class GameAudio {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private dry: GainNode | null = null;
	private send: GainNode | null = null;
	private convolver: ConvolverNode | null = null;
	private windGain: GainNode | null = null;
	private windFilter: BiquadFilterNode | null = null;
	private slideGainNode: GainNode | null = null;
	private loops: AudioBufferSourceNode[] = [];
	private buildBuffers = new Map<BuildLoop, AudioBuffer>();
	private crashLoops: { src: Record<BuildLoop, AudioBufferSourceNode>; gain: Record<BuildLoop, GainNode>; filter: BiquadFilterNode } | null = null;
	private buffers = new Map<EventGroup, (AudioBuffer | null)[]>();
	private cycles = new Map<EventGroup, Cycle>();
	/** Longest take of each loaded pool (s). */
	private seconds = new Map<EventGroup, number>();
	private volume = DEFAULT_VOLUME;
	private stepDist = 0;
	private loading = false;
	private loadingDeferred = false;
	/** Combat voices: slot i is voiceGain[i] → voicePan[i]; voiceSrc[i] is what it plays now. */
	private readonly voices = new VoicePool(COMBAT_VOICES);
	private voiceGain: GainNode[] = [];
	private voicePan: (StereoPannerNode | null)[] = [];
	private voiceSrc: (AudioBufferSourceNode | null)[] = [];

	setVolume(v: number): void {
		this.volume = Math.max(0, Math.min(1, v));
		if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
	}

	/** Call from a user gesture. */
	resume(): void {
		if (!this.ctx) {
			const Ctor =
				typeof window !== 'undefined'
					? (window.AudioContext ??
						(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
					: undefined;
			if (!Ctor) return;
			try {
				this.ctx = new Ctor();
				this.build(this.ctx);
			} catch {
				this.ctx = null;
				return;
			}
		}
		if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
		if (!this.loading) {
			this.loading = true;
			void this.load(this.ctx).catch(() => {});
		}
	}

	private build(ctx: AudioContext): void {
		const limiter = ctx.createDynamicsCompressor();
		limiter.threshold.value = LIMITER_THRESHOLD_DB;
		limiter.knee.value = 0;
		limiter.ratio.value = 20;
		limiter.attack.value = 0.002;
		limiter.release.value = 0.15;
		limiter.connect(ctx.destination);

		this.master = ctx.createGain();
		this.master.gain.value = this.volume;
		this.master.connect(limiter);

		this.dry = ctx.createGain();
		this.dry.connect(this.master);

		this.send = ctx.createGain();
		// The IR file was scaled by SFX_IR.gainDb from unit energy; undo that here.
		this.send.gain.value = dbToGain(REVERB_SEND_DB - SFX_IR.gainDb);
		this.convolver = ctx.createConvolver();
		this.convolver.normalize = false;
		this.send.connect(this.convolver).connect(this.master);

		this.windFilter = ctx.createBiquadFilter();
		this.windFilter.type = 'lowpass';
		this.windFilter.frequency.value = windParams(0).cutoff;
		// Lowpass Q is in dB in WebAudio: −3 dB ≈ Q 0.707 (no resonance).
		this.windFilter.Q.value = -3;
		this.windGain = ctx.createGain();
		this.windGain.gain.value = 0;
		this.windFilter.connect(this.windGain).connect(this.master);

		this.slideGainNode = ctx.createGain();
		this.slideGainNode.gain.value = 0;
		this.slideGainNode.connect(this.dry);
		this.slideGainNode.connect(this.send);

		this.voiceGain = [];
		this.voicePan = [];
		this.voiceSrc = [];
		for (let i = 0; i < COMBAT_VOICES; i++) {
			const g = ctx.createGain();
			// Older browsers have no StereoPannerNode: those voices stay centred.
			const pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
			const out = pan ? g.connect(pan) : g;
			out.connect(this.dry);
			out.connect(this.send);
			this.voiceGain.push(g);
			this.voicePan.push(pan);
			this.voiceSrc.push(null);
		}
	}

	private async decode(ctx: AudioContext, file: string): Promise<AudioBuffer | null> {
		try {
			const res = await fetch(SFX_BASE + file);
			if (!res.ok) return null;
			return await ctx.decodeAudioData(await res.arrayBuffer());
		} catch {
			return null;
		}
	}

	private async load(ctx: AudioContext): Promise<void> {
		const ir = this.decode(ctx, SFX_IR.file).then((b) => {
			if (b && this.convolver && this.ctx === ctx) this.convolver.buffer = b;
		});
		const loops = (Object.keys(SFX_LOOPS) as LoopName[]).map(async (name) => {
			const b = await this.decode(ctx, SFX_LOOPS[name].file);
			if (!b || this.ctx !== ctx) return;
			if (name === 'roll' || name === 'timpani') this.buildBuffers.set(name, b);
			else this.startLoop(ctx, b, name);
		});
		const events = (Object.keys(SFX_EVENTS) as EventGroup[]).filter((g) => !DEFERRED.has(g)).map((g) => this.loadPool(ctx, g));
		await Promise.all([ir, ...loops, ...events]);
		await this.loadDeferred(ctx);
	}

	private async loadPool(ctx: AudioContext, g: EventGroup): Promise<void> {
		const bufs = await Promise.all(SFX_EVENTS[g].map((f) => this.decode(ctx, f)));
		if (this.ctx !== ctx) return;
		this.buffers.set(g, bufs);
		this.cycles.set(g, new Cycle(bufs.length));
		this.seconds.set(g, bufs.reduce((m, b) => Math.max(m, b?.duration ?? 0), 0));
	}

	/**
	 * The combat pools, one pool at a time in manifest order (gunshots first).
	 * Starts when the core set has loaded, or at the first combat sound if that
	 * comes earlier, so a race map's first sounds never wait behind them.
	 */
	private async loadDeferred(ctx: AudioContext): Promise<void> {
		if (this.loadingDeferred || this.ctx !== ctx) return;
		this.loadingDeferred = true;
		for (const g of SFX_DEFERRED) {
			if (this.ctx !== ctx) return;
			await this.loadPool(ctx, g);
		}
	}

	private startLoop(ctx: AudioContext, buffer: AudioBuffer, name: Exclude<LoopName, BuildLoop>): void {
		const dest = name === 'wind' ? this.windFilter : this.slideGainNode;
		if (!dest) return;
		const src = this.loopSource(ctx, buffer, name);
		src.connect(dest);
		this.loops.push(src);
	}

	private loopSource(ctx: AudioContext, buffer: AudioBuffer, name: LoopName): AudioBufferSourceNode {
		const region = loopRegion(buffer.getChannelData(0), buffer.sampleRate, buffer.duration, SFX_LOOPS[name].loopSeconds);
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		src.loop = true;
		src.loopStart = region.start;
		src.loopEnd = region.end;
		src.start(0, region.start);
		return src;
	}

	private get live(): boolean {
		return !!this.ctx && this.ctx.state === 'running' && !!this.master;
	}

	/** Plays the next take of a pool at the given level (dB). */
	private play(group: EventGroup, db: number, vary: boolean): void {
		if (!this.live) return;
		const bufs = this.buffers.get(group);
		const cycle = this.cycles.get(group);
		if (!bufs || !cycle) return;
		const buffer = bufs[cycle.next()];
		if (!buffer) return;
		const ctx = this.ctx!;
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		const g = ctx.createGain();
		g.gain.value = dbToGain(db + (vary ? variationDb() : 0));
		src.connect(g);
		g.connect(this.dry!);
		g.connect(this.send!);
		src.start();
	}

	/**
	 * Plays the next take of a combat sound on a pooled voice. Without `at` it
	 * is your own sound: full level, centred. With `at` (and the listener's eye
	 * and view yaw) it falls off with distance and is panned by direction.
	 */
	private combat(s: CombatSound, at?: Vec, listener?: Vec, yaw?: number): void {
		if (!this.live) return;
		const ctx = this.ctx!;
		if (!this.loadingDeferred) void this.loadDeferred(ctx).catch(() => {});
		const positional = at !== undefined && listener !== undefined;
		const db = combatDb(s, positional ? Math.hypot(at.x - listener.x, at.y - listener.y, at.z - listener.z) : undefined);
		if (db === null) return;
		const bufs = this.buffers.get(s.pool);
		const cycle = this.cycles.get(s.pool);
		if (!bufs || !cycle) {
			if (s.fallback === 'zone') this.zoneBeep();
			return;
		}
		const now = ctx.currentTime;
		// The pool's longest take bounds the voice; the source frees it when it ends.
		const slot = this.voices.acquire(voiceKey(s, positional), s.prio, now, this.seconds.get(s.pool) ?? 0, s.voices, s.gap);
		if (slot < 0) return;
		const buffer = bufs[cycle.next()];
		if (!buffer) return;
		const gain = this.voiceGain[slot]!.gain;
		const old = this.voiceSrc[slot];
		let start = now;
		if (old) {
			// The voice is taken over: fade its sound out over a few ms (no click), then start the new one.
			start = now + VOICE_CUT_SECONDS;
			gain.cancelScheduledValues(now);
			gain.setValueAtTime(gain.value, now);
			gain.linearRampToValueAtTime(0, start);
			old.onended = null;
			try {
				old.stop(start);
			} catch {
				// already stopped
			}
		}
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		gain.setValueAtTime(dbToGain(db + (s.vary ? variationDb() : 0)), start);
		this.voicePan[slot]?.pan.setValueAtTime(positional && s.range !== null ? panFor(listener, at, yaw ?? 0) : 0, start);
		src.connect(this.voiceGain[slot]!);
		src.onended = () => {
			src.disconnect();
			if (this.voiceSrc[slot] === src) {
				this.voiceSrc[slot] = null;
				this.voices.release(slot);
			}
		};
		this.voiceSrc[slot] = src;
		src.start(start);
	}

	/** Per-frame continuous sounds and footsteps. */
	update(dt: number, s: MovementAudioState): void {
		if (!this.live || !this.windGain || !this.windFilter || !this.slideGainNode) return;
		const t = this.ctx!.currentTime;
		const speed = s.active ? s.speed : 0;
		const wind = windParams(speed);
		this.windGain.gain.setTargetAtTime(wind.gain, t, 0.15);
		this.windFilter.frequency.setTargetAtTime(wind.cutoff, t, 0.2);
		this.slideGainNode.gain.setTargetAtTime(slideGain(speed, s.active && s.surfing), t, 0.06);

		if (s.active && s.onGround && !s.ducked && speed > STEP_MIN_SPEED) {
			this.stepDist += stepAdvance(speed, dt);
			if (this.stepDist >= STEP_DISTANCE) {
				this.stepDist = 0;
				this.play('step', stepDb(speed), true);
			}
		} else if (!s.onGround) {
			this.stepDist = STEP_DISTANCE * 0.6;
		}
	}

	jump(): void {
		this.play('jump', eventDb('jump'), true);
	}

	land(fallSpeed: number): void {
		if (fallSpeed < LAND_MIN_SPEED) return;
		const db = landDb(fallSpeed);
		if (db !== null) this.play('land', db, true);
	}

	zoneBeep(): void {
		this.play('zone', eventDb('zone'), false);
	}

	recordChime(): void {
		this.play('record', eventDb('record'), false);
	}

	voteChime(): void {
		this.play('vote', eventDb('vote'), false);
	}

	/**
	 * Zombies sounds (docs/modes.md#zombies), real CC0 recordings (CREDITS.md):
	 * gunshots, knife, reload, hit and hurt share the infected recordings
	 * (ZOMBIES_SOUNDS). The checkpoint reuses the zone bell; the zombie groan
	 * has no recording yet and stays silent. `at` is where another player's or
	 * a zombie's sound happens, `listener` the camera (the eye, or the spectator camera), `yaw` the view yaw.
	 */
	zombies(name: string, at?: Vec, listener?: Vec, yaw?: number): void {
		if (name === 'checkpoint') return this.zoneBeep();
		const s = ZOMBIES_SOUNDS[name];
		if (s) this.combat(s, at, listener, yaw);
	}

	/**
	 * Infected sounds (docs/modes.md#infected), all real CC0 recordings
	 * (CREDITS.md): every name of the client's InfSound plays (INFECTED_SOUNDS).
	 * Round start, Patient Zero and UAV pulses keep the zone bell; perk unlocks
	 * and an earned M.O.A.B. keep the record chime. Without `at` the sound is
	 * your own (full level); with `at` (Source-space position), `listener` (the
	 * camera: the eye, or the spectator camera) and `yaw` (view yaw, degrees) it falls off with distance and is
	 * panned by direction.
	 */
	infected(name: string, at?: Vec, listener?: Vec, yaw?: number): void {
		const chime = INFECTED_CHIMES[name];
		if (chime === 'zone') return this.zoneBeep();
		if (chime === 'record') return this.recordChime();
		const s = INFECTED_SOUNDS[name];
		if (s) this.combat(s, at, listener, yaw);
	}

	/**
	 * Hide and seek sounds (docs/modes.md#hide-and-seek), all real CC0
	 * recordings (CREDITS.md): knife swing (stick whooshes, pool of 4), knife
	 * hit (knife into foam, pool of 4); the seeker release reuses the vote
	 * gavel and the cash bag's appearance the zone bell (no recording of coins
	 * is sourced, so the pickup itself is silent). `dist`: how far away another player's swing is (units); omitted
	 * for your own sounds.
	 */
	hns(name: 'swing' | 'hit' | 'release' | 'bag', dist?: number): void {
		if (name === 'release') return this.voteChime();
		if (name === 'bag') return this.zoneBeep();
		const falloff = dist === undefined ? 0 : distanceDb(dist);
		if (falloff === null) return;
		this.play(name, eventDb(name) + falloff, true);
	}

	/** Loot box (docs/ui.md#lootbox): lid, one reel tick, and the reveal; `news`: someone else's, quieter. */
	box(name: 'open' | 'tick' | 'reveal' | 'rare' | 'news' | 'newsRare'): void {
		if (name === 'open') this.play('swing', eventDb('swing'), true);
		else if (name === 'tick') this.play('tick', eventDb('tick'), true);
		else if (name === 'reveal') this.zoneBeep();
		else if (name === 'news') this.play('zone', eventDb('zone') - 10, false);
		else if (name === 'newsRare') this.play('record', eventDb('record') - 8, false);
		else this.recordChime();
	}

	/**
	 * Crash (docs/ui.md#casino), every frame of a round: the drum rolls at this
	 * multiplier; null ends them. `out`: the player has cashed out already.
	 */
	crashBuild(mult: number | null, out = false): void {
		if (mult === null || !this.live) return this.endBuild();
		const ctx = this.ctx!;
		const t = ctx.currentTime;
		const b = (this.crashLoops ??= this.startBuild(ctx));
		if (!b) return;
		const m = crashBuild(mult, out);
		for (const name of ['roll', 'timpani'] as const) {
			const g = b.gain[name].gain;
			g.cancelScheduledValues(t);
			g.setTargetAtTime(m[name], t, 0.06);
			g.setTargetAtTime(0, t + BUILD_HOLD, 0.1);
			b.src[name].playbackRate.setTargetAtTime(m.rate, t, 0.06);
		}
		b.filter.frequency.setTargetAtTime(m.cutoff, t, 0.06);
	}

	private startBuild(ctx: AudioContext): GameAudio['crashLoops'] {
		const buffers = { roll: this.buildBuffers.get('roll'), timpani: this.buildBuffers.get('timpani') };
		if (!buffers.roll || !buffers.timpani || !this.dry || !this.send) return null;
		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.Q.value = -3;
		filter.connect(this.dry);
		filter.connect(this.send);
		const gain = { roll: ctx.createGain(), timpani: ctx.createGain() };
		const src = { roll: this.loopSource(ctx, buffers.roll, 'roll'), timpani: this.loopSource(ctx, buffers.timpani, 'timpani') };
		const start = crashBuild(1);
		filter.frequency.value = start.cutoff;
		for (const name of ['roll', 'timpani'] as const) {
			gain[name].gain.value = 0;
			src[name].playbackRate.value = start.rate;
			src[name].connect(gain[name]).connect(filter);
		}
		return { src, gain, filter };
	}

	private endBuild(): void {
		const b = this.crashLoops;
		if (!b || !this.ctx) return;
		this.crashLoops = null;
		const t = this.ctx.currentTime;
		for (const name of ['roll', 'timpani'] as const) {
			b.gain[name].gain.cancelScheduledValues(t);
			b.gain[name].gain.setTargetAtTime(0, t, 0.02);
			b.src[name].stop(t + 0.2);
		}
		b.src.roll.onended = () => b.filter.disconnect();
	}

	/** Casino (docs/ui.md#casino). */
	casino(name: 'bet' | 'flip' | 'tick' | 'stop' | 'crash' | 'win' | 'big'): void {
		if (name === 'bet' || name === 'stop') this.play('click', eventDb('click'), false);
		else if (name === 'tick') this.play('tick', eventDb('tick'), true);
		else if (name === 'win') this.zoneBeep();
		else if (name === 'big') this.recordChime();
		else if (name === 'crash') this.play('crash', eventDb('crash'), false);
		else this.play('swing', eventDb('swing'), true);
	}

	/** The one click voice (chat messages). */
	chatTick(): void {
		this.play('click', eventDb('click'), false);
	}

	dispose(): void {
		for (const l of this.loops) {
			try {
				l.stop();
			} catch {
				// ignore
			}
		}
		this.loops = [];
		this.crashLoops = null;
		this.buildBuffers.clear();
		this.buffers.clear();
		this.cycles.clear();
		this.seconds.clear();
		this.voices.clear();
		this.voiceGain = [];
		this.voicePan = [];
		this.voiceSrc = [];
		void this.ctx?.close().catch(() => {});
		this.ctx = null;
		this.master = null;
		this.loading = false;
		this.loadingDeferred = false;
	}
}
