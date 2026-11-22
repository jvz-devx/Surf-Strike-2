# Credits

## Sounds

Every game sound is a real recording released under **CC0 1.0** (public domain dedication, https://creativecommons.org/publicdomain/zero/1.0/). No attribution is legally required; it is given here anyway. The licence was checked on each sound's own Freesound page. Source files are the Freesound HQ preview MP3s (`https://cdn.freesound.org/previews/...-hq.mp3`).

`tools/audio/process.py` turns them into the shipped files in `apps/web/static/sfx/`. All trim points, fades and levels are in `tools/audio/manifest.json`. Every file gets the same treatment: mono downmix for events, 30 Hz high-pass, a 1–12 ms fade-in at the transient, a sine fade-out, loudness matching within its pool, true peak ≤ −1.5 dBTP, and AAC encoding in `.m4a` (48 kHz). No pitch shifting, no synthesis.

| Used for | Shipped file(s) | Title | Author | Original | Licence | Processing |
| --- | --- | --- | --- | --- | --- | --- |
| Footsteps (pool of 6) | `step-1…6.m4a` | footsteps concrete | Yuval | https://freesound.org/people/Yuval/sounds/205748/ | CC0 1.0 | Six single steps cut at 0.93, 1.66, 2.40, 3.20, 8.70, 9.48 s, 0.30 s each, 80 ms fade-out, matched to one loudness |
| Jump (pool of 4) | `jump-1…4.m4a` | Footsteps_Mountain_Boots_Rock_Jump_Sequence_Mono.wav | Nox_Sound | https://freesound.org/people/Nox_Sound/sounds/558477/ | CC0 1.0 | The boot push-off before each of four jumps (1.52, 4.38, 6.02, 7.47 s; 0.39–0.55 s, ending before the impact), 12 ms fade-in, 60 ms fade-out |
| Land (pool of 4) | `land-1…4.m4a` | same recording as Jump | Nox_Sound | https://freesound.org/people/Nox_Sound/sounds/558477/ | CC0 1.0 | The four landing impacts (2.00, 4.96, 6.51, 7.88 s), 0.36–0.40 s, 120 ms fade-out |
| Wind bed (loop) | `wind.m4a` (stereo) | mountain wind heavy strong gusts Swiss Alps.flac | kyles | https://freesound.org/people/kyles/sounds/454092/ | CC0 1.0 | 2.5–20.5 s, last 1.5 s crossfaded (equal power) over the start into a seamless 16.5 s loop, −20 LUFS |
| Ramp slide bed (loop) | `slide.m4a` | Snowboard_Slide_Loop_Mono_01.wav | Nox_Sound | https://freesound.org/people/Nox_Sound/sounds/612665/ | CC0 1.0 | 0.2–11.7 s, 1 s equal-power crossfade into a seamless 10.5 s loop, −20 LUFS |
| Zone entry | `zone.m4a` | Antique fireplace clock bell one strike | Kinoton | https://freesound.org/people/Kinoton/sounds/347139/ | CC0 1.0 | The single strike from 0.31 s, 1.4 s with a 0.7 s fade-out |
| Record (new PB / map record) | `record.m4a` | BELLLrg_Herz-Jesu Church Single Low Bell Close_GILLE_GRAZ_SoundfieldSPS_Binaural3o.wav | JakobGille | https://freesound.org/people/JakobGille/sounds/693718/ | CC0 1.0 | The strongest strike of the swinging bell (from 1.52 s), 3.8 s ending before the next strike, 1.6 s fade-out, binaural downmixed to mono |
| Vote opens | `vote.m4a` | Gavel on wooden desk | Aerny | https://freesound.org/people/Aerny/sounds/618138/ | CC0 1.0 | Both gavel knocks (0.01 s and 1.14 s), 1.5 s, 0.25 s fade-out |
| Click (chat message; the one click voice) | `click.m4a` | Mouse click sounds | Masgame | https://freesound.org/people/Masgame/sounds/347544/ | CC0 1.0 | One click at 1.84 s, 90 ms, 30 ms fade-out |
| Room (convolution reverb IR) | `ir-hall.m4a` (stereo) | IR Liverpool Philharmonic Hall.wav | johnnyguitar01 | https://freesound.org/people/johnnyguitar01/sounds/423866/ | CC0 1.0 | Measured impulse response, first 2.0 s from the direct sound, 0.4 s fade-out, scaled to unit energy per channel |

### Listened to but not shipped (A/B candidates)

| Candidate for | Title | Author | Original | Licence |
| --- | --- | --- | --- | --- |
| Landing (heavier body fall) | G24-10-Hard Fall on Wood.wav | craigsmith | https://freesound.org/people/craigsmith/sounds/438309/ | CC0 1.0 |
| Room IR (longer, darker space) | IR_artisan_garage_B1_01_balloon_stereo_noise_filter | kirkpatrick.live | https://freesound.org/people/kirkpatrick.live/sounds/568064/ | CC0 1.0 |

Also downloaded and rejected (all CC0 1.0): Footsteps_Mountain_Boots_Tile_Mono.wav by Nox_Sound (https://freesound.org/people/Nox_Sound/sounds/555868/), Landing_Stone_1/2.wav by KieranKeegan (https://freesound.org/people/KieranKeegan/sounds/422753/, /422754/, only two takes), Snowboard_Slide_Loop_Mono_04.wav by Nox_Sound (https://freesound.org/people/Nox_Sound/sounds/612662/), Mouse clicks by Breviceps (https://freesound.org/people/Breviceps/sounds/447938/, noisier), Large Stairwell IR by LewisEmmott5 (https://freesound.org/people/LewisEmmott5/sounds/732025/).
