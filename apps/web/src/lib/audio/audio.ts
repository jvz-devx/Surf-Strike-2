/**
 * Game sounds from real CC0 recordings (docs/ui.md#audio, CREDITS.md).
 * The AudioContext is created on the first user gesture, then the files in
 * /sfx are fetched and decoded. A missing or undecodable file only silences
 * that sound.
 *
 * Graph: each event → its gain → dry bus → master, and → reverb send →
 * ConvolverNode (measured hall IR) → master. Wind (low-passed by speed) and
 * the ramp slide are seamless loops. Master → safety limiter → destination.
 */
import {
	Cycle,
	LAND_MIN_SPEED,
	REVERB_SEND_DB,
	STEP_DISTANCE,
	STEP_MIN_SPEED,
	dbToGain,
	eventDb,
	landDb,
	loopRegion,
	slideGain,
	stepAdvance,
	stepDb,
	variationDb,
	windParams
} from '#lib/audio/mix.js';
import { SFX_EVENTS, SFX_IR, SFX_LOOPS } from '#lib/audio/sfx.js';

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
	private buffers = new Map<EventGroup, (AudioBuffer | null)[]>();
	private cycles = new Map<EventGroup, Cycle>();
	private volume = 0.5;
	private stepDist = 0;
	private loading = false;

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
		limiter.threshold.value = -3;
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
			if (b && this.ctx === ctx) this.startLoop(ctx, b, name);
		});
		const events = (Object.keys(SFX_EVENTS) as EventGroup[]).map(async (g) => {
			const files = SFX_EVENTS[g];
			const bufs = await Promise.all(files.map((f) => this.decode(ctx, f)));
			if (this.ctx !== ctx) return;
			this.buffers.set(g, bufs);
			this.cycles.set(g, new Cycle(bufs.length));
		});
		await Promise.all([ir, ...loops, ...events]);
	}

	private startLoop(ctx: AudioContext, buffer: AudioBuffer, name: LoopName): void {
		const dest = name === 'wind' ? this.windFilter : this.slideGainNode;
		if (!dest) return;
		const region = loopRegion(buffer.getChannelData(0), buffer.sampleRate, buffer.duration, SFX_LOOPS[name].loopSeconds);
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		src.loop = true;
		src.loopStart = region.start;
		src.loopEnd = region.end;
		src.connect(dest);
		src.start(0, region.start);
		this.loops.push(src);
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
	 * Zombies sounds (docs/modes.md#zombies). Only real recordings may ship
	 * (CREDITS.md); none are sourced for gunshots, knife, reload, zombies or
	 * hurt yet, so those stay silent. The checkpoint reuses the zone bell.
	 * `at`/`listener`/`yaw` are for positional playback once recordings exist.
	 */
	zombies(name: string, _at?: { x: number; y: number; z: number }, _listener?: { x: number; y: number; z: number }, _yaw?: number): void {
		if (name === 'checkpoint') this.zoneBeep();
	}

	/**
	 * Hide and seek sounds (docs/modes.md#hide-and-seek). The seeker release
	 * reuses the vote gavel (a real CC0 recording, CREDITS.md); the knife swing
	 * and hit stay silent until real CC0 recordings are sourced.
	 */
	hns(name: 'swing' | 'hit' | 'release'): void {
		if (name === 'release') this.voteChime();
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
		this.buffers.clear();
		this.cycles.clear();
		void this.ctx?.close().catch(() => {});
		this.ctx = null;
		this.master = null;
		this.loading = false;
	}
}
