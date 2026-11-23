#!/usr/bin/env bash
# Master one file to -14 LUFS integrated, true peak <= -1.5 dBTP, 48 kHz 24-bit WAV, using ffmpeg only.
#   master.sh IN OUT [LUFS] [TP]
# 1. two-pass loudnorm in linear mode (pure gain, no dynamics).
# 2. if loudnorm falls back to dynamic (TP blocks the gain), pre-limit at 4x rate, then repeat linear loudnorm.
# Prints the final ebur128 measurement. Exit 1 if outside LUFS +-0.5 or above TP; report that, don't crush transients.
set -euo pipefail
in=$1; out=$2; I=${3:--14}; TP=${4:--1.5}
command -v ffmpeg >/dev/null && command -v jq >/dev/null || { echo "needs ffmpeg and jq" >&2; exit 2; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

measure() {  # loudnorm pass-1 JSON for $1
  ffmpeg -hide_banner -nostats -i "$1" -af "loudnorm=I=${I}:TP=${TP}:LRA=11:print_format=json" -f null - 2>&1 \
    | sed -n '/^{/,/^}/p'
}
linear() {  # $1 in, $2 out; prints normalization_type
  local m f
  m=$(measure "$1")
  f=$(jq -r '"measured_I=\(.input_i):measured_TP=\(.input_tp):measured_LRA=\(.input_lra):measured_thresh=\(.input_thresh):offset=\(.target_offset)"' <<<"$m")
  ffmpeg -hide_banner -nostats -y -i "$1" \
    -af "loudnorm=I=${I}:TP=${TP}:LRA=11:${f}:linear=true:print_format=json" \
    -ar 48000 -c:a pcm_s24le "$2" 2>&1 | sed -n '/^{/,/^}/p' | jq -r .normalization_type
}

kind=$(linear "$in" "$out")
if [ "$kind" = dynamic ]; then
  gain=$(measure "$in" | jq -r --argjson t "$I" '($t - (.input_i|tonumber)) * 100 | round / 100')
  # ceiling 0.79 linear (~ -2 dBFS) leaves room for the inter-sample peaks the final pass trims
  ffmpeg -hide_banner -loglevel error -y -i "$in" \
    -af "aresample=192000,volume=${gain}dB,alimiter=limit=0.79:attack=1:release=50:level=false,aresample=48000" \
    -c:a pcm_s24le "$tmp/lim.wav"
  kind=$(linear "$tmp/lim.wav" "$out")
  echo "pre-limited (+${gain} dB into limiter), then loudnorm: $kind"
fi

r=$(ffmpeg -hide_banner -nostats -i "$out" -af ebur128=peak=true -f null - 2>&1 | sed -n '/Summary/,$p')
li=$(awk '/ I:/{print $2}' <<<"$r"); tp=$(awk '/ Peak:/{print $2}' <<<"$r")
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")
echo "$out: ${dur} s, ${li} LUFS integrated, true peak ${tp} dBTP, normalization ${kind}"
awk -v li="$li" -v tp="$tp" -v I="$I" -v TP="$TP" \
  'BEGIN{d=li-I; if(d<0)d=-d; if(d>0.5||tp>TP){print "FAIL: outside gate"; exit 1}; print "PASS"}'
