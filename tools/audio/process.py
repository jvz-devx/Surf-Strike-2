#!/usr/bin/env python3
"""Turn the downloaded CC0 originals into the game's sound files.

Usage (run from the repo root; raw files are untrusted data, only ffmpeg reads them):

    python3 -I tools/audio/process.py <raw_dir> [--ab <ab_dir>] [--only <group>,<group>,…]

<raw_dir> holds the Freesound HQ preview MP3s named <freesound id>.mp3 (see
CREDITS.md). Writes apps/web/static/sfx/*.m4a (AAC, 48 kHz) and the generated
apps/web/src/lib/audio/sfx.ts. With --ab, the abOnly entries of the manifest
are rendered into <ab_dir> for listening tests.

With --only, just the named event groups are cut and encoded. Every other
shipped file stays byte-identical (AAC output differs between ffmpeg versions):
it is only measured again for sfx.ts, so <raw_dir> needs the originals of the
named groups alone. Use it to add or redo pools.

Processing (manifest.json holds every number):
- events: cut the take (start snapped to its transient), mono downmix, 30 Hz
  high-pass, short fade-in, sine fade-out; every take of a group is matched to
  one loudness (eventTargetLufs, measured with 1 s of padding), lowered for the
  whole group as needed so no take exceeds truePeakCeiling. Event levels in the
  mix are then set in code (apps/web/src/lib/audio/mix.ts). A take may name
  its own "src" (pools drawn from several recordings); a group may set
  "bitrate" (default 96k) and "tier": "deferred" (listed in SFX_DEFERRED: the
  game fetches those pools after the core set).
- loops: cut len + xfade seconds and fold the last xfade seconds over the start
  with an equal-power crossfade, so the file loops seamlessly; normalised to
  loopTargetLufs.
- IR: the measured impulse response, trimmed to its direct sound, faded out and
  scaled to unit energy per channel (the game uses ConvolverNode with
  normalize = false), then reduced if needed to stay under the peak ceiling.
After encoding, each file's true peak is re-measured; a file that overshoots is
re-encoded with less gain.
"""
import array
import json
import math
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, 'tools', 'audio', 'manifest.json')
OUT = os.path.join(ROOT, 'apps', 'web', 'static', 'sfx')
TS_OUT = os.path.join(ROOT, 'apps', 'web', 'src', 'lib', 'audio', 'sfx.ts')


def ffmpeg(args: list[str], data: bytes | None = None) -> bytes:
	return subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', *args], input=data, check=True, capture_output=True).stdout


def decode(path: str, start: float, dur: float, ch: int, sr: int) -> array.array:
	# -ss after -i: decode from the file start and drop samples up to `start`. Seeking the
	# MP3 input instead restarts the decoder without its bit reservoir, which can mute
	# the first frame after the seek point, exactly where a snapped transient sits.
	raw = ffmpeg(['-i', path, '-ss', f'{max(0.0, start):.4f}', '-t', f'{dur:.4f}', '-ac', str(ch), '-ar', str(sr), '-f', 'f32le', '-'])
	a = array.array('f')
	a.frombytes(raw)
	return a


def write_wav(path: str, x: array.array, ch: int, sr: int) -> None:
	ffmpeg(['-y', '-f', 'f32le', '-ar', str(sr), '-ac', str(ch), '-i', '-', '-c:a', 'pcm_f32le', path], x.tobytes())


def measure(path: str, pad: bool) -> tuple[float, float]:
	"""Integrated loudness (LUFS) and true peak (dBTP) via ebur128."""
	af = ('apad=pad_dur=1,' if pad else '') + 'ebur128=peak=true'
	r = subprocess.run(['ffmpeg', '-nostdin', '-nostats', '-i', path, '-af', af, '-f', 'null', '-'], capture_output=True, text=True, check=True)
	summary = r.stderr[r.stderr.rfind('Summary:') :]
	i = float(re.search(r'I:\s+(-?[\d.]+|-inf) LUFS', summary).group(1).replace('-inf', '-200'))
	tp = float(re.search(r'True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS', summary).group(1).replace('-inf', '-200'))
	return i, tp


def snap(path: str, t: float, rel_db: float, sr: int) -> float:
	w0 = max(0.0, t - 0.04)
	x = decode(path, w0, 0.14, 1, sr)
	ms = sr // 1000
	peaks = [max(abs(v) for v in x[i : i + ms]) for i in range(0, len(x) - ms, ms)]
	m = max(peaks) or 1e-9
	thr = m * 10 ** (rel_db / 20)
	for i, p in enumerate(peaks):
		if p >= thr:
			return max(0.0, w0 + i / 1000 - 0.002)
	return t


def fades(x: array.array, ch: int, sr: int, fin: float, fout: float) -> None:
	n = len(x) // ch
	nin = max(1, int(fin * sr))
	nout = max(1, int(fout * sr))
	for i in range(min(nin, n)):
		g = i / nin
		for c in range(ch):
			x[i * ch + c] *= g
	for j in range(min(nout, n)):
		i = n - nout + j
		g = math.cos(0.5 * math.pi * (j + 1) / nout)
		for c in range(ch):
			x[i * ch + c] *= g


def encode(wav: str, out: str, gain_db: float, ch: int, bitrate: str, highpass: bool, ceiling: float) -> tuple[float, float, float]:
	"""Encode with gain; re-encode lower if the AAC file overshoots the ceiling."""
	for _ in range(4):
		af = ('highpass=f=30,' if highpass else '') + f'volume={gain_db:.3f}dB'
		ffmpeg(['-y', '-i', wav, '-af', af, '-ac', str(ch), '-c:a', 'aac', '-b:a', bitrate, '-movflags', '+faststart', out])
		i, tp = measure(out, pad=True)
		if tp <= ceiling:
			return gain_db, i, tp
		gain_db -= tp - ceiling + 0.2
	raise SystemExit(f'{out}: cannot meet true peak ceiling')


def cut_take(raw: str, g: dict, take: dict, sr: int) -> array.array:
	start = take['start']
	if 'snapDb' in g:
		start = snap(raw, start, g['snapDb'], sr)
	x = decode(raw, start, take['dur'], 1, sr)
	fades(x, 1, sr, g['fadeIn'], g['fadeOut'])
	take['_snapped'] = round(start, 4)
	return x


def group_files(name: str, g: dict) -> list[str]:
	n = len(g['takes'])
	return [f'{name}-{k + 1}.m4a' if n > 1 else f'{name}.m4a' for k in range(n)]


def process_group(name: str, g: dict, raw_dir: str, out_dir: str, tmp: str, m: dict) -> list[dict]:
	sr = m['sampleRate']
	wavs = []
	for k, take in enumerate(g['takes']):
		raw = os.path.join(raw_dir, take.get('src', g.get('src', '')) + '.mp3')
		wav = os.path.join(tmp, f'{name}-{k + 1}.wav')
		write_wav(wav, cut_take(raw, g, take, sr), 1, sr)
		wavs.append((wav, *measure(wav, pad=True)))
	# Every take is matched to one group loudness T; T is the event target, or
	# lower if a take with a high crest factor would otherwise pass the ceiling.
	ceil = m['truePeakCeiling'] - 0.3
	target = min(m['eventTargetLufs'], *(li + ceil - tp for _w, li, tp in wavs))
	files = []
	for k, (wav, li, _tp) in enumerate(wavs):
		fname = group_files(name, g)[k]
		out = os.path.join(out_dir, fname)
		gdb, i, tp = encode(wav, out, target - li, 1, g.get('bitrate', '96k'), True, m['truePeakCeiling'])
		files.append({'file': fname, 'start': g['takes'][k]['_snapped'], 'dur': g['takes'][k]['dur'], 'gainDb': round(gdb, 2), 'lufs': i, 'truePeak': tp, 'bytes': os.path.getsize(out)})
	return files


def shipped_group(name: str, g: dict, out_dir: str) -> list[dict]:
	"""--only: a group that is not being redone. Its shipped files are measured, not written."""
	files = []
	for fname in group_files(name, g):
		out = os.path.join(out_dir, fname)
		i, tp = measure(out, pad=True)
		files.append({'file': fname, 'lufs': i, 'truePeak': tp, 'bytes': os.path.getsize(out), 'kept': True})
	return files


def shipped_loop(name: str, lp: dict, out_dir: str, m: dict) -> dict:
	out = os.path.join(out_dir, f'{name}.m4a')
	i, tp = measure(out, pad=False)
	return {'file': f'{name}.m4a', 'loopSeconds': int(lp['len'] * m['sampleRate']) / m['sampleRate'], 'lufs': i, 'truePeak': tp, 'bytes': os.path.getsize(out), 'kept': True}


def shipped_ir(ir: dict, out_dir: str) -> dict:
	"""--only: the IR gain cannot be measured from the file, so it is read back from the generated sfx.ts."""
	with open(TS_OUT) as f:
		gdb = float(re.search(r"SFX_IR = \{ file: '[^']+', gainDb: (-?[\d.]+)", f.read()).group(1))
	out = os.path.join(out_dir, ir['out'] + '.m4a')
	_i, tp = measure(out, pad=True)
	return {'file': ir['out'] + '.m4a', 'gainDb': gdb, 'truePeak': tp, 'bytes': os.path.getsize(out), 'kept': True}


def process_loop(name: str, lp: dict, raw_dir: str, out_dir: str, tmp: str, m: dict) -> dict:
	sr, ch = m['sampleRate'], lp['channels']
	raw = os.path.join(raw_dir, lp['src'] + '.mp3')
	n, nx = int(lp['len'] * sr), int(lp['xfade'] * sr)
	seg = decode(raw, lp['start'], lp['len'] + lp['xfade'] + 0.05, ch, sr)
	out = array.array('f', seg[nx * ch : (nx + n) * ch])
	for j in range(nx):
		a = math.cos(0.5 * math.pi * j / nx)
		b = math.sin(0.5 * math.pi * j / nx)
		i = n - nx + j
		for c in range(ch):
			out[i * ch + c] = seg[(n + j) * ch + c] * a + seg[j * ch + c] * b
	wav = os.path.join(tmp, f'{name}.wav')
	write_wav(wav, out, ch, sr)
	li, tp = measure(wav, pad=False)
	gain = min(m['loopTargetLufs'] - li, m['truePeakCeiling'] - 0.3 - tp)
	fname = f'{name}.m4a'
	gdb, i, tp = encode(wav, os.path.join(out_dir, fname), gain, ch, lp['bitrate'], True, m['truePeakCeiling'])
	i, _ = measure(os.path.join(out_dir, fname), pad=False)
	return {'file': fname, 'start': lp['start'], 'loopSeconds': n / sr, 'gainDb': round(gdb, 2), 'lufs': i, 'truePeak': tp, 'bytes': os.path.getsize(os.path.join(out_dir, fname))}


def process_ir(name: str, ir: dict, raw_dir: str, out_dir: str, tmp: str, m: dict) -> dict:
	sr, ch = m['sampleRate'], ir['channels']
	raw = os.path.join(raw_dir, ir['src'] + '.mp3')
	start = snap(raw, 0.04, -20, sr)
	x = decode(raw, start, ir['dur'], ch, sr)
	fades(x, ch, sr, 0.0005, ir['fadeOut'])
	energy = max(sum(x[i] * x[i] for i in range(c, len(x), ch)) for c in range(ch))
	scale = 1 / math.sqrt(energy)
	for i in range(len(x)):
		x[i] *= scale
	wav = os.path.join(tmp, f'{name}.wav')
	write_wav(wav, x, ch, sr)
	_li, tp = measure(wav, pad=True)
	gain = min(0.0, m['truePeakCeiling'] - 0.3 - tp)
	fname = f'{name}.m4a'
	gdb, _i, tp = encode(wav, os.path.join(out_dir, fname), gain, ch, ir['bitrate'], False, m['truePeakCeiling'])
	# The file is unit energy scaled by gdb; the game multiplies the wet send by
	# 10^(-gdb/20) to restore unit energy.
	return {'file': fname, 'start': round(start, 4), 'dur': ir['dur'], 'gainDb': round(gdb, 2), 'truePeak': tp, 'bytes': os.path.getsize(os.path.join(out_dir, fname))}


def write_ts(report: dict) -> None:
	ev = report['groups']
	lines = [
		'// Generated by tools/audio/process.py from tools/audio/manifest.json. Do not edit.',
		'',
		'/** Event pools: real recorded takes, cycled in order (CREDITS.md). */',
		'export const SFX_EVENTS = {',
	]
	for name, files in ev.items():
		lines.append(f"\t{name}: [{', '.join(repr(f['file']) for f in files)}],")
	lines += ['} as const;', '', '/** Seamless loops: loopSeconds is the exact loop length prepared offline. */', 'export const SFX_LOOPS = {']
	for name, lp in report['loops'].items():
		lines.append(f"\t{name}: {{ file: '{lp['file']}', loopSeconds: {lp['loopSeconds']} }},")
	lines += ['} as const;', '', '/** Measured integrated loudness of each file group (LUFS; event takes padded with 1 s). */', 'export const SFX_LUFS = {']
	for name, files in ev.items():
		lines.append(f"\t{name}: {round(sum(f['lufs'] for f in files) / len(files), 1)},")
	for name, lp in report['loops'].items():
		lines.append(f"\t{name}: {round(lp['lufs'], 1)},")
	ir = report['ir']
	lines += [
		'} as const;',
		'',
		'/** Measured room impulse response; the file was scaled by gainDb from unit energy. */',
		f"export const SFX_IR = {{ file: '{ir['file']}', gainDb: {ir['gainDb']} }} as const;",
		'',
	]
	if report['deferred']:
		lines += [
			'/** Pools fetched after the core set above has loaded (manifest tier: deferred). */',
			f"export const SFX_DEFERRED: readonly (keyof typeof SFX_EVENTS)[] = [{', '.join(repr(n) for n in report['deferred'])}];",
			'',
		]
	with open(TS_OUT, 'w') as f:
		f.write('\n'.join(lines).replace('"', "'"))


def main() -> None:
	raw_dir = sys.argv[1]
	ab_dir = sys.argv[sys.argv.index('--ab') + 1] if '--ab' in sys.argv else None
	with open(MANIFEST) as f:
		m = json.load(f)
	tmp = os.path.join(raw_dir, '..', 'work')
	os.makedirs(tmp, exist_ok=True)
	os.makedirs(OUT, exist_ok=True)
	only = set(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else None
	if only is not None and only - set(m['groups']):
		raise SystemExit(f'--only: no such group: {sorted(only - set(m["groups"]))}')
	report = {'groups': {}, 'loops': {}}
	for name, g in m['groups'].items():
		redo = only is None or name in only
		report['groups'][name] = process_group(name, g, raw_dir, OUT, tmp, m) if redo else shipped_group(name, g, OUT)
	for name, lp in m['loops'].items():
		report['loops'][name] = process_loop(name, lp, raw_dir, OUT, tmp, m) if only is None else shipped_loop(name, lp, OUT, m)
	report['ir'] = process_ir(m['ir']['out'], m['ir'], raw_dir, OUT, tmp, m) if only is None else shipped_ir(m['ir'], OUT)
	report['deferred'] = [name for name, g in m['groups'].items() if g.get('tier') == 'deferred']
	write_ts(report)
	if ab_dir:
		os.makedirs(ab_dir, exist_ok=True)
		ab = m['abOnly']
		report['ab'] = {
			'landWood': process_group('land-wood', ab['landWood'], raw_dir, ab_dir, tmp, m),
			'irGarage': process_ir('ir-garage', ab['irGarage'], raw_dir, ab_dir, tmp, m),
		}
	total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
	report['totalBytes'] = total
	print(json.dumps(report, indent=1))


if __name__ == '__main__':
	main()
