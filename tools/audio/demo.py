#!/usr/bin/env python3
"""Render a ~12 s demo mix of a typical play sequence from the shipped sound files.

Usage (repo root):

    python3 -I tools/audio/demo.py <out_dir> [--wet DB] [--ir FILE] [--land-dir DIR --land-prefix P] [--name NAME]

Decodes apps/web/static/sfx/*.m4a with ffmpeg and mixes them the way
apps/web/src/lib/audio/audio.ts does (levels and speed mappings mirror
apps/web/src/lib/audio/mix.ts; the reverb send goes through the same IR with
ffmpeg afir). The mix is mastered to -14 LUFS with a peak limiter, written as
<name>.wav and encoded to <name>.m4a (AAC, like the game files); the encoded
file's loudness and true peak are printed.

Sequence: walk out of the start zone, three bhop jumps/landings, surf a ramp
with the wind rising, land in the end zone (crouched), zone sound, record
sound, chat click.
"""
import array
import json
import math
import os
import random
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SFX = os.path.join(ROOT, 'apps', 'web', 'static', 'sfx')
SR = 48000
DUR = 12.0

# Mirrors apps/web/src/lib/audio/mix.ts and sfx.ts.
MIX = dict(wind=-20, slideMin=-26, slideMax=-20, step=-28, jump=-33, landMin=-33, landMax=-21, zone=-29, record=-24, vote=-27, click=-31, swing=-30, hit=-24)
# Combat levels (infected, zombies); not part of the demo sequence.
MIX.update(shotBarrett=-15.5, shotSniper=-17, shotStriker=-18, shotLmg=-20.5, shotPistol=-23.5, shotSmg=-25, reload=-31, reloadDone=-31, dryfire=-33, draw=-33, scope=-37, claws=-28, throw=-29, knifeBounce=-31, knifeStick=-30, knifePickup=-33, impact=-31, hitBody=-24.5, hitHead=-22, hitKill=-21, hurt=-26, death=-27, infect=-26, beacon=-28, beaconSmash=-26, beaconUse=-28, moab=-22, moabDetonate=-19.5)
VARIATION_DB = 1.5
STEP_DISTANCE, STEP_MIN_SPEED, STEP_MAX_SPEED, LAND_MIN_SPEED = 76, 90, 320, 120


def ts_consts() -> dict:
	src = open(os.path.join(ROOT, 'apps', 'web', 'src', 'lib', 'audio', 'sfx.ts')).read()
	lufs = dict(re.findall(r'\t(\w+): (-?[\d.]+),', src[src.index('SFX_LUFS') :]))
	events = {k: re.findall(r"'([^']+)'", v) for k, v in re.findall(r'\t(\w+): \[([^\]]*)\]', src)}
	loops = {k: float(v) for k, v in re.findall(r"\t(\w+): \{ file: '[^']+', loopSeconds: ([\d.]+) \}", src)}
	ir_db = float(re.search(r"SFX_IR = \{ file: '[^']+', gainDb: (-?[\d.]+)", src).group(1))
	return {'lufs': {k: float(v) for k, v in lufs.items()}, 'events': events, 'loops': loops, 'irDb': ir_db}


def db2g(db: float) -> float:
	return 10 ** (db / 20)


def decode(path: str, ch: int) -> array.array:
	raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-ac', str(ch), '-ar', str(SR), '-f', 'f32le', '-'], check=True, capture_output=True).stdout
	a = array.array('f')
	a.frombytes(raw)
	return a


def write_wav(path: str, x: array.array, ch: int) -> None:
	subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(ch), '-i', '-', '-c:a', 'pcm_f32le', path], input=x.tobytes(), check=True)


def measure(path: str) -> tuple[float, float]:
	r = subprocess.run(['ffmpeg', '-nostdin', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True, check=True)
	s = r.stderr[r.stderr.rfind('Summary:') :]
	return float(re.search(r'I:\s+(-?[\d.]+) LUFS', s).group(1)), float(re.search(r'Peak:\s+(-?[\d.]+|-inf) dBFS', s).group(1))


def loudnorm_json(path: str) -> dict:
	r = subprocess.run(['ffmpeg', '-nostdin', '-nostats', '-i', path, '-af', 'loudnorm=I=-14:TP=-1.5:print_format=json', '-f', 'null', '-'], capture_output=True, text=True, check=True)
	return json.loads(r.stderr[r.stderr.rfind('{') : r.stderr.rfind('}') + 1])


def speed_at(t: float) -> tuple[float, bool, bool, bool]:
	"""(horizontal speed, onGround, surfing, ducked) of the scripted run."""
	if t < 0.4:
		return 250 * t / 0.4, True, False, False
	if t < 2.6:
		return 250, True, False, False
	if t < 4.67:  # bhops: air between hops, speed gained per hop
		hops = [(2.6, 3.27, 250, 330), (3.27, 3.97, 330, 420), (3.97, 4.67, 420, 520)]
		for a, b, s0, s1 in hops:
			if a <= t < b:
				return s0 + (s1 - s0) * (t - a) / (b - a), False, False, False
	if t < 5.2:
		return 520, False, False, False
	if t < 9.0:  # surf: speed builds on the ramp
		return 520 + 1380 * ((t - 5.2) / 3.8) ** 1.2, False, True, False
	if t < 9.6:
		return 1900, False, False, False
	if t < 10.4:  # crouched landing in the end zone, friction stops the player
		return 1900 * (1 - (t - 9.6) / 0.8) ** 2, True, False, True
	return 0, True, False, False


# (time, kind, arg): jumps, landings (fall speed), zone, record, click.
EVENTS = [
	(0.25, 'zone', 0),
	(2.6, 'jump', 0),
	(3.25, 'land', 330),
	(3.27, 'jump', 0),
	(3.95, 'land', 380),
	(3.97, 'jump', 0),
	(4.65, 'land', 420),
	(4.67, 'jump', 0),
	(9.6, 'land', 760),
	(9.75, 'zone', 0),
	(10.15, 'record', 0),
	(11.3, 'click', 0),
]


def lowpass_coefs(fc: float, q: float = 0.7079) -> tuple[float, ...]:
	w = 2 * math.pi * min(fc, SR * 0.45) / SR
	alpha = math.sin(w) / (2 * q)
	cw = math.cos(w)
	a0 = 1 + alpha
	return ((1 - cw) / 2 / a0, (1 - cw) / a0, (1 - cw) / 2 / a0, -2 * cw / a0, (1 - alpha) / a0)


def render(args: dict) -> None:
	c = ts_consts()
	lufs = c['lufs']
	lvl = lambda g, m: m - lufs[g]  # noqa: E731
	rng = random.Random(7)
	n = int(DUR * SR)
	dry = array.array('f', bytes(8 * n))  # stereo
	send = array.array('f', bytes(4 * n))  # mono send, made dual-mono for the stereo IR

	pools = {}
	for g, files in c['events'].items():
		if g == 'land' and args.get('land_dir'):
			files = sorted(f for f in os.listdir(args['land_dir']) if f.startswith(args['land_prefix']))
			pools[g] = [decode(os.path.join(args['land_dir'], f), 1) for f in files]
			m = [measure_padded(os.path.join(args['land_dir'], f)) for f in files]
			lufs['land'] = sum(m) / len(m)
		else:
			pools[g] = [decode(os.path.join(SFX, f), 1) for f in files]
	cyc = {g: -1 for g in pools}
	log = []

	def play(g: str, t: float, db: float, vary: bool) -> None:
		cyc[g] = (cyc[g] + 1) % len(pools[g])
		v = (rng.random() * 2 - 1) * VARIATION_DB if vary else 0.0
		gain = db2g(db + v)
		x = pools[g][cyc[g]]
		i0 = int(t * SR)
		for i in range(min(len(x), n - i0)):
			s = x[i] * gain
			dry[2 * (i0 + i)] += s
			dry[2 * (i0 + i) + 1] += s
			send[i0 + i] += s
		log.append(f'{t:6.2f}s {g}#{cyc[g] + 1} {db + v:+.1f} dB')

	# Beds and footsteps, updated per 128-sample block like the audio thread.
	wind = decode(os.path.join(SFX, 'wind.m4a'), 2)
	slide = decode(os.path.join(SFX, 'slide.m4a'), 1)
	wlen, slen = int(c['loops']['wind'] * SR), int(c['loops']['slide'] * SR)
	wg = cut = sg = 0.0
	cut = 400.0
	z = [[0.0] * 4 for _ in range(2)]
	step_dist = 0.0
	blk = 128
	full_wind = db2g(lvl('wind', MIX['wind']))
	for b0 in range(0, n, blk):
		t = b0 / SR
		speed, ground, surf, duck = speed_at(t)
		w = min(1, max(0, (speed - 150) / 1850))
		tw = full_wind * w**1.5 if w > 0 else 0.0
		tc = 400 * (9000 / 400) ** w
		k = min(1, speed / 1500)
		ts = db2g(lvl('slide', MIX['slideMin'] + (MIX['slideMax'] - MIX['slideMin']) * k)) if surf else 0.0
		dt = blk / SR
		wg += (tw - wg) * (1 - math.exp(-dt / 0.15))
		cut += (tc - cut) * (1 - math.exp(-dt / 0.2))
		sg += (ts - sg) * (1 - math.exp(-dt / 0.06))
		b0c, b1c, b2c, a1c, a2c = lowpass_coefs(cut)
		for i in range(b0, min(n, b0 + blk)):
			for ch in range(2):
				xin = wind[2 * (i % wlen) + ch]
				zz = z[ch]
				y = b0c * xin + b1c * zz[0] + b2c * zz[1] - a1c * zz[2] - a2c * zz[3]
				zz[1], zz[0], zz[3], zz[2] = zz[0], xin, zz[2], y
				dry[2 * i + ch] += y * wg
			s = slide[i % slen] * sg
			dry[2 * i] += s
			dry[2 * i + 1] += s
			send[i] += s
		if ground and not duck and speed > STEP_MIN_SPEED:
			step_dist += min(speed, STEP_MAX_SPEED) * dt
			if step_dist >= STEP_DISTANCE:
				step_dist = 0
				kk = max(0.35, min(1, speed / 250))
				play('step', t, lvl('step', MIX['step']) + 20 * math.log10(kk), True)
		elif not ground:
			step_dist = STEP_DISTANCE * 0.6

	for t, kind, arg in EVENTS:
		if kind == 'land':
			if arg >= LAND_MIN_SPEED:
				kk = min(1, max(0, (arg - 100) / 700))
				play('land', t, lvl('land', MIX['landMin'] + (MIX['landMax'] - MIX['landMin']) * kk), True)
		elif kind == 'jump':
			play('jump', t, lvl('jump', MIX['jump']), True)
		else:
			play(kind, t, lvl(kind, MIX[kind]), False)

	out_dir, name = args['out'], args['name']
	tmp = os.path.join(out_dir, f'.{name}')
	os.makedirs(tmp, exist_ok=True)
	stereo_send = array.array('f', bytes(8 * n))
	stereo_send[0::2] = send
	stereo_send[1::2] = send
	write_wav(os.path.join(tmp, 'dry.wav'), dry, 2)
	write_wav(os.path.join(tmp, 'send.wav'), stereo_send, 2)
	ir = args.get('ir') or os.path.join(SFX, 'ir-hall.m4a')
	ir_db = args.get('ir_db', c['irDb'])
	wet_gain = db2g(args['wet'] - ir_db)
	raw_mix = os.path.join(tmp, 'mix.wav')
	subprocess.run(
		['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', os.path.join(tmp, 'dry.wav'), '-i', os.path.join(tmp, 'send.wav'), '-i', ir,
		 '-filter_complex', f'[2:a]aresample={SR}[ir];[1:a][ir]afir=irnorm=-1:gtype=none:wet={wet_gain:.6f}[wet];[0:a][wet]amix=inputs=2:normalize=0:duration=first',
		 '-c:a', 'pcm_f32le', raw_mix],
		check=True,
	)
	# Master: gain to -14 LUFS, then a look-ahead peak limiter; encode; repeat until the AAC file meets the targets.
	li, _ = measure(raw_mix)
	gain = -14 - li
	limit = -3.0
	wav = os.path.join(out_dir, f'{name}.wav')
	m4a = os.path.join(out_dir, f'{name}.m4a')
	for _ in range(6):
		subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', raw_mix, '-af', f'volume={gain:.3f}dB,alimiter=limit={db2g(limit):.5f}:level=disabled:attack=2:release=60', '-c:a', 'pcm_s24le', wav], check=True)
		subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', wav, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', m4a], check=True)
		i, tp = measure(m4a)
		if abs(i + 14) <= 0.3 and tp <= -1.5:
			break
		gain += -14 - i
		if tp > -1.5:
			limit -= tp + 1.5 + 0.2
	ln = loudnorm_json(m4a)
	wi, wtp = measure(wav)
	print(f'{name}: encoded {m4a}: I {i:.1f} LUFS, true peak {tp:.1f} dBTP (loudnorm: I {ln["input_i"]}, TP {ln["input_tp"]}, LRA {ln["input_lra"]}); wav I {wi:.1f} TP {wtp:.1f}')
	if args.get('log'):
		print('\n'.join(log))


def measure_padded(path: str) -> float:
	r = subprocess.run(['ffmpeg', '-nostdin', '-nostats', '-i', path, '-af', 'apad=pad_dur=1,ebur128', '-f', 'null', '-'], capture_output=True, text=True, check=True)
	s = r.stderr[r.stderr.rfind('Summary:') :]
	return float(re.search(r'I:\s+(-?[\d.]+) LUFS', s).group(1))


def main() -> None:
	a = sys.argv[1:]
	opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d  # noqa: E731
	args = {
		'out': a[0],
		'name': opt('--name', 'demo'),
		'wet': float(opt('--wet', '-14')),
		'ir': opt('--ir'),
		'land_dir': opt('--land-dir'),
		'land_prefix': opt('--land-prefix', 'land-'),
		'log': '--log' in a,
	}
	if opt('--ir-db') is not None:
		args['ir_db'] = float(opt('--ir-db'))
	os.makedirs(args['out'], exist_ok=True)
	render(args)


if __name__ == '__main__':
	main()
