#!/usr/bin/env python3
"""Print transient onsets of a recording to help choose trim points.

Usage: python3 -I tools/audio/analyze.py <file> [threshold_db] [min_gap_s]

Decodes with ffmpeg to 48 kHz mono float, computes a 5 ms RMS envelope and
prints every onset (envelope rising above threshold_db relative to the file
peak after at least min_gap_s below it) with its peak level and duration.
"""
import array
import math
import subprocess
import sys

SR = 48000


def decode_mono(path: str) -> array.array:
	raw = subprocess.run(
		['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
		check=True,
		capture_output=True,
	).stdout
	a = array.array('f')
	a.frombytes(raw)
	return a


def envelope(x: array.array, hop: int) -> list[float]:
	out = []
	for i in range(0, len(x) - hop, hop):
		s = 0.0
		for v in x[i : i + hop]:
			s += v * v
		out.append(math.sqrt(s / hop))
	return out


def main() -> None:
	path = sys.argv[1]
	thr_db = float(sys.argv[2]) if len(sys.argv) > 2 else -30.0
	gap = float(sys.argv[3]) if len(sys.argv) > 3 else 0.25
	x = decode_mono(path)
	hop = SR // 200
	env = envelope(x, hop)
	peak = max(env) or 1e-9
	db = [20 * math.log10(max(e, 1e-9) / peak) for e in env]
	floor = sorted(db)[len(db) // 10]
	print(f'{path}: {len(x) / SR:.2f}s noise floor (p10) {floor:.1f} dB rel peak env')
	on = None
	quiet = gap
	for i, d in enumerate(db):
		t = i * hop / SR
		if on is None and d > thr_db and quiet >= gap:
			on = i
			pk = d
		elif on is not None:
			pk = max(pk, d)
			if d < thr_db - 12:
				print(f'  onset {on * hop / SR:7.3f}s  end {t:7.3f}s  dur {t - on * hop / SR:5.3f}s  peak {pk:6.1f} dB')
				on = None
				quiet = 0.0
		if d <= thr_db:
			quiet += hop / SR
		else:
			if on is None:
				quiet = 0.0


if __name__ == '__main__':
	main()
