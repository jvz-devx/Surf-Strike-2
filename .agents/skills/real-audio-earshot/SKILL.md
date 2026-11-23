---
name: real-audio-earshot
description: Source, master and verify real recorded audio (SFX, ambience, music) for games, apps and films, using the earshot CLI or MCP server only as ears and a meter. Use when a project needs sound effects or music, when asked to replace synthesized or placeholder audio, to check whether sounds are real, to trim or rank candidate recordings, or to master audio to a loudness target. Not for writing synthesis code.
---

# Real Audio with earshot

Every shipped sound is a real recording with a verified licence. earshot (https://github.com/Leonxlnx/earshot, v1.0.0, MIT) listens, measures, trims and ranks. It does not make the sounds.

## Hard rules

- Never synthesize SFX or music: no numpy/scipy waveforms, Web Audio oscillators or noise buffers, SuperCollider, Tone.js patches, or Kenney packs.
- Never ship output from earshot's generators. These are banned: `make`, `make --set`, `sounds`, `recipe`, `build`, `pack` of generated takes, `sfx`, `kit`, `forge`, `fit`, `gallery`, and the MCP tools `make`, `make_set`, `sounds`, `build`, `sfx_list`, `sfx_render`, `kit_render`. Its "learned" sounds are resynthesized from numbers, not recordings.
- Allowed earshot use: `describe`, `match`, `rank`, `find`, `compare`, `ab`, `realness`, `timeline`, `sheet`, `critique`, `measure`, `doctor` (CLI or the MCP tools with the same names).
- Repeated sounds (footsteps, impacts, shots, UI clicks) need 3 or more distinct real takes. Never pitch-shift or re-filter one take to fake variations.
- Never write "it sounds good" or "sounds right". Report numbers and timestamps the user can check (see Reporting).

## Install and check

Not installed by default and not on PyPI under this name (`earshot` there is another project). Install from GitHub; `listen` brings the models (about 1.1 GB download), `measure` brings librosa, `images` is needed for `sheet`:

```bash
uv tool install "earshot[listen,measure,images,mcp] @ git+https://github.com/Leonxlnx/earshot"
earshot doctor --fetch      # download the pinned CLAP + AudioSet models now
earshot doctor --load       # confirm both models load
```

ffmpeg must be on PATH for ogg/mp3/m4a/webm and video. Optional MCP server (models stay loaded between calls, much faster than repeated CLI runs that each load for 20-40 s):

```bash
claude mcp add earshot --scope user -e EARSHOT_THREADS=3 -- earshot mcp
```

Other clients: `{"mcpServers": {"earshot": {"command": "earshot", "args": ["mcp"], "env": {"EARSHOT_THREADS": "3"}}}}`.

Every listening command and `measure` accept `--json` and `--out result.json`. Errors are one line on stderr, exit 1.

## Workflow

### 1. Brief

List every sound by the physical action that makes it ("boot heel on wet concrete", "pump shotgun rack"), not by mood. Note count of takes, max length, loop or one-shot.

### 2. Source real recordings

- Freesound (`https://freesound.org/people/<user>/sounds/<id>/`) and Openverse (`https://openverse.org`, audio, licence filter CC0). Search by the physical action.
- CC0 only. Use CC BY only when the user approves it for that asset, with full attribution. Reject NC, ND, Sampling+, "personal use", unlabeled "royalty free", YouTube rips, AI-generated or code-synthesized uploads.
- Read the licence on each item's own page, not the search result. Record the licence text and the date you read it.
- Music: build from real sampled instruments, VSCO 2 Community Edition (CC0) or the University of Iowa Musical Instrument Samples (check the current terms on the Iowa page), and place them in a real room impulse response (a measured IR, licence verified and credited like any asset). No synth pads.
- Keep downloads in their own untrusted folder; never run anything from it.

### 3. Pick and trim with earshot

```bash
earshot realness cand/*.wav --ast                                   # p_real + verdict; reject "likely code-synthesized"
earshot rank "a single boot heel step on wet concrete" cand/ --top 5
earshot find long_take.wav "a single boot heel step" --top 6 --kind event
earshot match pick.wav "a boot step on wet concrete" --alts "a door knock" "a hand clap" --start 1.20 --end 1.62
earshot describe pick.wav --start 1.20 --end 1.62
earshot compare pick.wav --refs refs/ -k 5
earshot ab old.wav new.wav --query "a boot step on wet concrete"
```

`find` prints trims as `0:03.94-0:04.19 (0.24 s ..., z +4.1 strong)`. Cut with ffmpeg at those times (`ffmpeg -ss 3.94 -to 4.19 -i long_take.wav -c:a pcm_s24le step_1.wav`), add 2-5 ms fades, then re-run `match` on the cut file.

Trust levels (from earshot's own docs): loudness, timing and "is this the kind of sound" on single sounds are reliable; tags in a busy mix, genre and mood are hints. `realness` can miss a quiet synthesized layer under a real mix, so judge stems and sources, not only the bounce. Clean professional UI tones can read as synthesized, and about 7% of real clips get a firm "synthesized" verdict. If a recording with verified provenance comes back `uncertain` or `likely code-synthesized`, report it with its `p_real` and source page; don't silently swap it.

### 4. Master

Target: -14 LUFS integrated, true peak at most -1.5 dBTP, 48 kHz.

Use the bundled script (ffmpeg and jq only, tested on ffmpeg 8):

```bash
<this skill dir>/scripts/master.sh in.wav out.wav           # optional 3rd/4th args: LUFS target, TP ceiling
```

It runs two-pass loudnorm in linear mode (pure gain). When loudnorm falls back to `dynamic` because the true-peak ceiling blocks the gain, it pre-limits at 192 kHz (`alimiter` at 0.79 linear) and repeats the linear pass. It ends with an `ebur128` measurement and exits 1 when the file is outside -14 ±0.5 LUFS or above -1.5 dBTP.

The same two passes by hand. Use bash, or write `${F}` in zsh: zsh reads `$F:l...` as a lowercase modifier and breaks the filter string. ffmpeg prints progress after the JSON, so extract the `{...}` block instead of using `tail`:

```bash
F=$(ffmpeg -hide_banner -nostats -i in.wav -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 \
  | sed -n '/^{/,/^}/p' \
  | jq -r '"measured_I=\(.input_i):measured_TP=\(.input_tp):measured_LRA=\(.input_lra):measured_thresh=\(.input_thresh):offset=\(.target_offset)"')
ffmpeg -hide_banner -nostats -i in.wav -af "loudnorm=I=-14:TP=-1.5:LRA=11:${F}:linear=true:print_format=json" \
  -ar 48000 -c:a pcm_s24le out.wav          # loudnorm resamples internally; -ar 48000 brings it back
```

Short, transient one-shots often can't reach -14 LUFS under a -1.5 dBTP ceiling without crushing the attack. In a test, a 0.56 s bell stopped at -17.4 LUFS at -1.5 dBTP. Report the shortfall and level-match the set; don't over-limit it. `earshot measure` returns no `lufs` below 0.4 s, `lufs` from 0.4 s, `short_term_max_lufs` from 3 s, and `lra_lu` from 6 s. Below 0.4 s, level-match on `rms_dbfs` and `true_peak_dbtp` and say so. Gain for a match: `ffmpeg -i in.wav -af volume=<dB> -c:a pcm_s24le out.wav`, then measure again.

### 5. Verify

```bash
earshot measure out/*.wav --json --out out/qa/measure.json          # duration, lufs, true_peak_dbtp, rms_dbfs, clipped_samples
ffmpeg -hide_banner -nostats -i out.wav -af ebur128=peak=true -f null - 2>&1 | sed -n '/Summary/,$p'   # cross-check
earshot realness out/*.wav --json --out out/qa/realness.json
earshot timeline film.mp4 --cues cues.json                           # sync of sounds to picture cuts / cue times
earshot sheet film.mp4 -o out/qa/sheet.png                           # annotated spectrogram + events to look at
```

Gate: every file at -14 ±0.5 LUFS (or the documented one-shot rule), `true_peak_dbtp` ≤ -1.5, `realness` verdict `real or pro-produced`, no cut tails or clicks.

### 6. Credit

`CREDITS.md` gets one entry per shipped asset, including CC0: shipped file path, title, author, source page URL, licence name and link, date checked, and what was changed ("trimmed 1.20-1.62 s, loudness-normalised").

## Reporting

For each shipped file give: path, duration (s), integrated LUFS (or short-term max for one-shots), true peak dBTP, `p_real` and verdict, `match` z and verdict for its description, source URL and licence, and the timestamps the user should listen to (for example "step_2.wav 0.00-0.18 s: heel strike; check for a click at 0.17 s"). Name anything that failed a gate.
