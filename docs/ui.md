# UI

CS2-era layout and feel: dark translucent panels, thin borders, condensed type. All art is original. Fonts are open (for example Barlow Semi Condensed and Rajdhani, self-hosted with `@fontsource`). No Valve assets or logos.

The HUD is Svelte components layered over the Three.js canvas.

## HUD layout

| Position | Element |
| --- | --- |
| Bottom centre | Speed (horizontal u/s, large), timer and current stage below it |
| Bottom centre, above speed | Split popup on stage or checkpoint (`Stage 3 01:12.402 −0.213`) |
| Top centre | Map name and time left (`surf_ember · 07:42`) |
| Top right | Connection status (`Online · 12 / 32` or `Offline — solo`), FPS if `cl_showfps 1` |
| Bottom left | Chat (fades after 8 s; full history while typing) |
| Left middle | Vote panel (up to 7 options "Surf · Kessler" … "Extend 10 min" with key numbers and live vote counts, countdown bar) |
| Top centre, below map name | RTV request modal (see [RTV request](#rtv-request)) |
| Right middle | PB and map record for this map |
| Centre | Crosshair (configurable) |
| Below crosshair | Pressed keys (W A S D, jump, crouch) if `cl_showkeys 1` |
| Full screen (hold Tab) | Scoreboard (see [gameplay.md](gameplay.md#tab-scoreboard)) |
| Top centre, spectating | `Spectating <name>` bar with controls hint |

The speed number turns green while gaining speed and red while losing speed, as on surf servers.

## RTV request

A small CS2-style vote notice (like the kick or pause vote) at the top centre, under the map name, while an RTV request is open ([gameplay.md](gameplay.md#map-rotation-and-voting); `RtvRequest.svelte`):

- Header "Map vote request" and the seconds left; text "**<name>** wants to vote for a new map (Bhop · Meadow)" (the nominated map, if any).
- Two buttons **1 Yes** / **2 No** with live counts, your own answer highlighted (the initiator starts on Yes), a 20 s countdown bar, and "1 = Yes · 2 = No · 2/4 yes needed".
- Keys `1` / `2` answer while the request is open (they do not trigger their binds then; `3`+ keep theirs). With a free cursor (pointer not locked), the buttons can be clicked.
- Spectators see it with "Spectating: you cannot vote".
- When it closes it shows "Passed: map vote starting" (green) or "Declined" (red) for 2.5 s; a passed request is replaced by the vote panel at once.

Key routing (`apps/web/src/lib/game/vote.ts` `routeVoteKey`, ahead of binds): map vote open: `1`–`7` vote; else RTV request open: `1` yes, `2` no; else the key's bind runs (for example zombies weapon slots).

## Zombies HUD

Shown on zombies maps (`ZombiesHud.svelte`, [modes.md](modes.md#zombies)): a round banner under the map name (countdown; Survivor/Zombie, round clock, zone, zombies alive, your kills / team kills; result summary), route progress bar and the gate line ("Gate 2/5: get half the survivors into the green area" or "Gate 2/5 opens in 23 s"), short flash banners (checkpoint, gate, turned), kill feed top right, health (5 pips; a bar as a zombie) and weapon / ammo / reload bar bottom right, a loadout list (keys 1-4) while it is open, hit markers (white, yellow for headshots, red for kills), a red vignette when hit, and the sniper scope overlay. Binds in zombies: mouse1 fire, mouse2 scope, R reload, 1-4 weapon (map vote while one is open).

## Hide and seek HUD

Shown on hide and seek maps (`HnsHud.svelte`, [modes.md](modes.md#hide-and-seek)), in two parts:

- **Top** (under the map name): a role banner (blue HIDER / red SEEKER) with the phase text ("Hide! Seekers released in", "Find them", "Stay hidden", "Next round in"), the phase countdown (mm:ss while seeking, red at 30 s or less), hiders left and your finds as a seeker; the seeker names; the round summary while ended ("Hiders win! Survived: …" / "Seekers win!", top seeker); short flash banners ("You were found by Alice — you are now a seeker", "You found Bob!", "Bob is the last hider", "30 seconds left"); a "Frozen 3" line during the post-find freeze. Waiting / offline: "Waiting for players — needs 2+".
- **Screen**: the blindfold for seekers during the hiding phase (opaque black over the game with "You are a seeker", "Blindfolded while the hiders hide" and a large countdown; chat, the banner and the scoreboard stay on top; the crosshair is hidden), and the kill feed top right ("Alice found Bob", your own finds outlined).

Seekers hold a knife viewmodel (the zombies knife, swing on Mouse1); hiders have none. Remote seekers are drawn red with a `SEEKER · name` tag. Name tags show only within 600 units and in line of sight, and never hiders' tags to a seeker. `!r` is refused during a round.

## Account panel

Replaces the first-visit name prompt ([gameplay.md](gameplay.md#accounts-and-identity)). A small centred panel in the same style (`AuthPanel.svelte`):

- Tabs **Login | Register**: username field (`autocomplete="username"`) and password field (`type="password"`, `current-password` for login, `new-password` for register), submit button ("Please wait…" while the server answers).
- Register validates inline with the same shared rules as the server: "Username cannot contain spaces.", "Password must be at least 5 characters.", and so on. Server errors ("Wrong username or password.", "That username is taken.", rate limits) show under the fields.
- **Play as guest** switches to a name field (max 24 chars, prefilled with the stored guest name) and a "Play" button. Guests' runs are not saved to the leaderboard.
- Offline or connecting: a notice ("Server offline — play as guest; log in when online.") and the submit button is disabled.
- `Esc` or × closes it. Closing it on the first visit counts as playing as guest under the current name.
- Shown on the first visit and when a stored session is rejected (unless the player chose guest). After that the page goes straight into the game. Clicking the canvas requests pointer lock. While it is open, game binds are ignored as for the other overlays.

## Developer console

Opened with `` ` `` or `~`. A CS-style panel in the top half of the screen: scrolling log, input line, command history (up/down), tab completion for commands and cvars.

| Command / cvar | Default | Effect |
| --- | --- | --- |
| `sensitivity` | 2.0 | Mouse sensitivity (Source-compatible) |
| `m_yaw`, `m_pitch` | 0.022 | Degrees per mouse count |
| `fov` | 90 | Horizontal FOV at 4:3, scaled for widescreen as in CS (106.26° at 16:9) |
| `volume` | 0.5 | Master volume 0–1 |
| `cl_showfps` | 0 | FPS counter |
| `cl_showpos` | 0 | Position, angles, velocity readout |
| `cl_showkeys` | 0 | Pressed-keys display |
| `cl_hideplayers` | 0 | Hide other players |
| `cl_ghost` | 1 | Show the race ghost on surf and bhop maps ([Ghost](#ghost)) |
| `cl_crosshairsize`, `cl_crosshairgap`, `cl_crosshairthickness`, `cl_crosshaircolor_r/g/b`, `cl_crosshairdot` | CS-like | Crosshair |
| `name <name>` | | Change guest name (logged-in players always show their username) |
| `bind <key> <command>`, `unbind <key>` | | Key bindings |
| `map <id>` | | Change map (solo only) |
| `connect <url>`, `disconnect` | | Manual server connection |
| `sv_*` | per map | Physics cvars (solo only; runs become unofficial) |
| `cvarlist`, `help`, `clear` | | Console helpers |

Settings are saved to localStorage on change.

## Esc menu

A CS2-style pause menu opened with `Esc` (pointer lock is released). The game stays visible behind a dark gradient; the HUD is hidden while it is open. Components live in `apps/web/src/lib/ui/menu/` (`EscMenu.svelte` and one component per submenu); pure helpers (map grouping, settings sections, cvar defaults) are in `menu.ts` with unit tests.

Main menu (left column): brand, current map and mode, then the entries **Resume**, **Change map**, **Settings**, **Account** (and **Admin** for admin accounts, see below), and below them the account line ("Logged in as X" or "Guest · runs are not saved") and a key hint. A submenu opens in a panel beside the entries; clicking its entry again folds it.

Keyboard: `↑`/`↓` move between the main entries, `Tab` moves through the open submenu, `←`/`→` (and `Home`/`End`) switch tabs. `Esc` goes back one level (submenu to main menu), then resumes. In the map filter, `Esc` first clears the text. Focus is always visible.

- **Change map**: tabs **All** plus one per gamemode with maps, in `GAME_MODES` registry order and labels (Surf, Bhop, Tag, …), so new modes appear without UI changes. Opens on the current map's mode. Within a mode, maps sort by difficulty (easy first), then title. Each row shows title, id, an easy/hard badge, and marks the current map. A filter box matches title or id. Picking a map switches at once and resumes in solo or when you are alone on the server (`canChangeMap`). With others online every map stays clickable (button tooltip and tag "Request map vote"): picking one starts an RTV request nominating it and resumes, so the modal is visible. The notice above the list says so, or, when requests are not possible, why and for how long: "Map vote declined — try again in 45 s", "Map vote requests open in 12 s" (first 20 s of a map), "A map vote is in progress", "A map vote request is open", or "Spectators cannot request a map vote" (rows read-only then). The current map and admin-disabled maps ("Disabled by admin") cannot be nominated. State logic: `mapMenuState` / `mapRowPickable` in `menu.ts`.
- **Settings**: tabs
  - Mouse: sensitivity (slider + number), `m_yaw`, `m_pitch`
  - Video: FOV, show FPS, show position
  - HUD: crosshair colour, size, gap, thickness, centre dot with a live 1:1 preview; show keys, show ghost (`cl_ghost`), hide players (`cl_hideplayers`)
  - Audio: master volume

  Each tab has **Reset … to defaults**, which sets that tab's cvars to the engine defaults (`CLIENT_CVARS`); it is disabled when they already are.
- **Account**: "Logged in as X" with **Log out**, or guest with **Log in / Register** (opens the account panel).
- <a id="admin"></a>**Admin** (only when the server says the account is admin, [gameplay.md](gameplay.md#admin); `AdminMenu.svelte`): **Extend +10 min** in the header, then tabs
  - Maps: every map grouped by gamemode with an on/off switch (the last enabled map cannot be switched off) and **Force change** with an inline "Change now? Yes / Cancel"; the current map is marked.
  - Players: connected players with an Admin / Account / Guest badge and **Ban** (inline confirm with an optional reason; not for admins), plus "Ban an account by username" for offline accounts.
  - Bans: username, kind, reason, date, who banned, and **Unban**.

  The result of the last action shows under the tabs. In Change map, maps disabled by an admin are greyed with "Disabled by admin" and cannot be picked (admins still can).

All values are the same cvars as the console and are saved the same way.

Dev preview: `/?mockhud&open=settings` (main menu), `&open=maps` (map submenu), `&open=settings&view=settings&tab=hud` (a settings tab), `&view=account`, `&view=admin` (logged in as an admin; `&tab=maps|players|bans`), and `&solo=0` for the read-only map list.

## Ghost

The race ghost ([gameplay.md](gameplay.md#ghosts)) is the remote-player humanoid in a pale cyan, at opacity 0.35 with a faint glow, drawn without depth writes so it never hides the map. Its name tag is a small drawn ghost icon (no emoji font needed) and `Name · 01:23.456`, or `Your PB · 01:23.456` for your local best. `cl_ghost 0` hides it; `cl_hideplayers` does not affect it. The console prints `Record ghost: Name time` when one loads.

## Default key binds

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| `Space`, mouse wheel | Jump |
| `Ctrl` | Crouch |
| `Y` | Chat |
| `Tab` | Scoreboard |
| `1`–`7` | Map vote (while open); `1` / `2` = yes / no on an RTV request; else their binds (`vote 1`–`vote 4`) |
| `M` | Toggle spectate |
| `R` | Restart run (`!r`) |
| `` ` `` / `~` | Console |
| `Esc` | Esc menu |

## Audio

All sounds are real recordings released under CC0, sourced from Freesound and listed with their trims in [CREDITS.md](../CREDITS.md). Nothing is synthesised: code only selects, places, levels, filters and convolves the recordings. Files live in `apps/web/static/sfx/` (AAC `.m4a`, 48 kHz, mono events, about 0.6 MB in total) and are fetched after the first user gesture. A file that fails to load only silences that sound.

| Sound | Trigger | Recording |
| --- | --- | --- |
| Footsteps | Walking on ground; rate by speed, capped at running cadence | Boots on concrete, pool of 6 |
| Jump | Leaving the ground | Boot push-off on rock, pool of 4 |
| Land | Hitting the ground; louder with fall speed (level only) | Boot landing on rock (same session as jump), pool of 4 |
| Wind | Continuous loop; gain and a low-pass (400 Hz to 9 kHz) rise with speed, no pitch change | Mountain wind with strong gusts, stereo |
| Ramp slide | Continuous loop while surfing; gain rises with speed | Snowboard sliding on snow |
| Zone | Entering start, stage, checkpoint, end | Antique clock bell, one strike |
| Record | New PB or map record | Large church bell, one strike |
| Vote | Vote opens; hide and seek seeker release | Two gavel knocks on a wooden desk |
| Click | New chat message (the only click voice) | Computer mouse button |

Rules:

- **One space.** Every event and the slide bed also feed one shared ConvolverNode with a measured impulse response (Liverpool Philharmonic Hall), with the send 14 dB below the dry signal. The wind is already an outdoor recording and stays dry.
- **Variation.** Pooled takes play in order (1, 2, …, n, 1, …) with a random ±1.5 dB level change per play. No playback-rate or pitch variation.
- **Levels.** Takes in a pool are matched in loudness offline. The wind bed at full speed is the reference (−20 LUFS before the master volume). Events are placed relative to it in `apps/web/src/lib/audio/mix.ts`. Every file has a true peak of −1.5 dBTP or lower. The master volume (`volume` cvar) feeds a safety limiter.
- **Loops.** Loop points are prepared offline with an equal-power crossfade, so the loops are seamless.
- **Pipeline.** `tools/audio/process.py` rebuilds the files from the downloaded originals using `tools/audio/manifest.json`. `tools/audio/demo.py` renders a demo mix mastered to −14 LUFS for listening checks. Both scripts use Python 3 and ffmpeg.

## Platform

Desktop browsers (Chrome, Firefox, Edge, Safari) with mouse and keyboard. Pointer lock is required. On touch-only devices, show a "Desktop only" message.
