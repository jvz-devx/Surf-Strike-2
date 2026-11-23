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
| Top left | Award popups ([Award popups](#award-popups)), below the position readout |
| Right middle | Score panel: map records, PB and gap, or the current standing ([Score panel](#score-panel)) |
| Centre | Crosshair (configurable) |
| Below crosshair | Pressed keys (W A S D, jump, crouch) if `cl_showkeys 1` |
| Full screen (hold Tab) | Scoreboard (see [gameplay.md](gameplay.md#tab-scoreboard)) |
| Top centre, spectating | `Spectating <name>` bar with controls hint |

The speed number turns green while gaining speed and red while losing speed, as on surf servers.

## Score panel

Always on while playing (`ScorePanel.svelte`), driven by the gamemode's definition in `packages/shared/src/modes/score.ts` ([modes.md](modes.md#score-display)).

- **Surf, bhop:** "Map records" (top 6 of the 10 the server sends), your own row highlighted, then Personal best with your rank and Gap to record (red, or "Record holder" in green). An older server sends only the record: the list is then the record and your own time. Offline: "Offline: no map records" and your local PB. "Unofficial" badge when `sv_*` was changed.
- **Other modes:** the live standing of the current game, best first, with the round number. Tag: time not IT, `IT` marker. Zombie Run: kills, times turned, and the route progress and checkpoint below. Infected: score, kills, kill streak, `A` / `INF` markers. Hide and seek: role, finds, survived.
- Every mode ends with a **Coins** line: the [multiplier](economy.md#player-multiplier) and the active players (`×1.5 6 active`), or `Off 4/5 active` in red when the mode needs more players to pay. Not shown offline or on an older server.
- At most 8 players (6 records). Your own row is always there: further down it replaces the last row, with a dashed line above it and its real position.
- **Placement.** Vertically centred in the free strip on the right, below the connection status (and a full kill feed) and above the mode's health and weapon bars. `score-panel.ts` holds these areas and `fitPanel`, which decides how much fits: fewer rows in low windows, narrower without minor columns below 1000 px width, only your own row (and the race lines) below 820 px, hidden below 480 px or when there is no height left.
- Hidden while the Tab scoreboard is open, and with `cl_scorepanel 0` (Settings › HUD › "Show score panel").

Dev preview: `/?mockhud&novote&mode=<gamemode>&players=<n>&self=<position>`, `&old=1` for an older server, `&open=scoreboard` for the Tab scoreboard, `&coins=<n>` award popups (`0`: a guest), `&warn` a warning, `&ban=<seconds>` the ban screen.

## Award popups

`AwardPopups.svelte`, pure helpers in `game/coins.ts`. Every award shows its amount, reason and multiplier (`+4.5 coins  Found a hider  ×1.5`) at the top left for 4.5 s, newest at the bottom, at most 5 (2 while a map vote is open, so they stay above its panel). Notices (guest hint, abuse warning) use the same stack for 10 s. They take no input, play no sound, and their width keeps clear of the banners at the top centre in every mode.

## Ban screen

`BanScreen.svelte`. A banned player gets "You are banned", the reason and, for a ban that lifts by itself, the time left. "Play solo meanwhile" (or `Esc`) shrinks it to a line at the top left with the countdown. The client reconnects by itself one second after the ban is over, also after a reload. The screen frees the pointer and counts as an overlay for game binds.

## RTV request

A small CS2-style vote notice (like the kick or pause vote) at the top centre, under the map name, while an RTV request is open ([gameplay.md](gameplay.md#map-rotation-and-voting); `RtvRequest.svelte`):

- Header "Map vote request" and the seconds left; text "**<name>** wants to vote for a new map (Bhop · Meadow)" (the nominated map, if any).
- Two buttons **1 Yes** / **2 No** with live counts, your own answer highlighted (the initiator starts on Yes), a 20 s countdown bar, and "1 = Yes · 2 = No · 2/4 yes needed".
- Keys `1` / `2` answer while the request is open (they do not trigger their binds then; `3`+ keep theirs). With a free cursor (pointer not locked), the buttons can be clicked.
- Spectators see it with "Spectating: you cannot vote".
- When it closes it shows "Passed: map vote starting" (green) or "Declined" (red) for 2.5 s; a passed request is replaced by the vote panel at once.

Key routing (`apps/web/src/lib/game/vote.ts` `routeVoteKey`, ahead of binds): map vote open: `1`–`7` vote; else RTV request open: `1` yes, `2` no; else the key's bind runs (for example Zombie Run weapon slots).

<a id="zombies-hud"></a>

## Zombie Run HUD

Shown on Zombie Run maps (`ZombiesHud.svelte`, [modes.md](modes.md#zombies)): a round banner under the map name (countdown; Survivor/Zombie, round clock, zone, zombies alive, your kills / team kills; result summary), route progress bar and the gate line ("Gate 2/5: get half the survivors into the green area" or "Gate 2/5 opens in 23 s"), short flash banners (checkpoint, gate, turned), kill feed top right, health (5 pips; a bar as a zombie) and weapon / ammo / reload bar bottom right, a loadout list (keys 1-4) while it is open, hit markers (white, yellow for headshots, red for kills), a red vignette when hit, and the sniper scope overlay. Binds in Zombie Run: mouse1 fire, mouse2 scope, R reload, 1-4 weapon (map vote while one is open).

## Hide and seek HUD

Shown on hide and seek maps (`HnsHud.svelte`, [modes.md](modes.md#hide-and-seek)), in two parts:

- **Top** (under the map name): a role banner (blue HIDER / red SEEKER) with the phase text ("Hide! Seekers released in", "Find them", "Stay hidden", "Next round in"), the phase countdown (mm:ss while seeking, red at 30 s or less), hiders left and your finds as a seeker; the seeker names; the round summary while ended ("Hiders win! Survived: …" / "Seekers win!", top seeker); short flash banners ("You were found by Alice — you are now a seeker", "You found Bob!", "Bob is the last hider", "30 seconds left"); a "Frozen 3" line during the post-find freeze. Waiting / offline: "Waiting for players — needs 2+".
- **Screen**: the blindfold for seekers during the hiding phase (opaque black over the game with "You are a seeker", "Blindfolded while the hiders hide" and a large countdown; chat, the banner and the scoreboard stay on top; the crosshair is hidden), and the kill feed top right ("Alice found Bob", your own finds outlined).

Seekers hold a knife viewmodel (the Zombie Run knife, swing on Mouse1); hiders have none. Remote seekers are drawn red with a `SEEKER · name` tag. Name tags show only within 600 units and in line of sight, and never hiders' tags to a seeker. `!r` is refused during a round.

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
| `cl_fullscreen` | 1 | Play in fullscreen, where `Ctrl+W` cannot close the tab (Chromium only, [Platform](#platform)) |
| `cl_showfps` | 0 | FPS counter |
| `cl_showpos` | 0 | Position, angles, velocity readout |
| `cl_showkeys` | 0 | Pressed-keys display |
| `cl_hideplayers` | 0 | Hide other players |
| `cl_scorepanel` | 1 | Show the score panel ([Score panel](#score-panel)) |
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

Main menu (left column): brand, current map and mode, then the entries **Resume**, **Change map**, **Settings**, **Coins**, **Account** (and **Admin** for admin accounts, see below), and below them the account line ("Logged in as X" or "Guest · runs are not saved") and a key hint. A submenu opens in a panel beside the entries; clicking its entry again folds it.

Keyboard: `↑`/`↓` move between the main entries, `Tab` moves through the open submenu, `←`/`→` (and `Home`/`End`) switch tabs. `Esc` goes back one level (submenu to main menu), then resumes. In the map filter, `Esc` first clears the text. Focus is always visible.

- **Change map**: tabs **All** plus one per gamemode with maps, in `GAME_MODES` registry order and labels (Surf, Bhop, Tag, …), so new modes appear without UI changes. Opens on the current map's mode. Within a mode, maps sort by difficulty (easy first), then title, then size. Each row shows title, id, an easy/hard badge (Medium/Large for maps that come in sizes, `mapTag` in `menu.ts`), and marks the current map. A filter box matches title, id or size. Picking a map switches at once and resumes in solo or when you are alone on the server (`canChangeMap`). With others online every map stays clickable (button tooltip and tag "Request map vote"): picking one starts an RTV request nominating it and resumes, so the modal is visible. The notice above the list says so, or, when requests are not possible, why and for how long: "Map vote declined — try again in 45 s", "Map vote requests open in 12 s" (first 20 s of a map), "A map vote is in progress", "A map vote request is open", or "Spectators cannot request a map vote" (rows read-only then). The current map and admin-disabled maps ("Disabled by admin") cannot be nominated. State logic: `mapMenuState` / `mapRowPickable` in `menu.ts`.
- **Settings**: tabs
  - Mouse: sensitivity (slider + number), `m_yaw`, `m_pitch`
  - Video: FOV, **Fullscreen (blocks Ctrl+W)** (`cl_fullscreen`; in browsers without the Keyboard Lock API a note instead), show FPS, show position
  - HUD: crosshair colour, size, gap, thickness, centre dot with a live 1:1 preview; show keys, show score panel (`cl_scorepanel`), show ghost (`cl_ghost`), hide players (`cl_hideplayers`)
  - Audio: master volume

  Each tab has **Reset … to defaults**, which sets that tab's cvars to the engine defaults (`CLIENT_CVARS`); it is disabled when they already are.
- <a id="coins"></a>**Coins** (`CoinsMenu.svelte`): coins, points earned in total (both rounded down), the current multiplier and active players, and the latest 20 awards and purchases. Guests get a login button.
- **Account**: "Logged in as X" with **Log out**, or guest with **Log in / Register** (opens the account panel).
- <a id="admin"></a>**Admin** (only when the server says the account is admin, [gameplay.md](gameplay.md#admin); `AdminMenu.svelte`): **Extend +10 min** in the header, then tabs
  - Maps: every map grouped by gamemode with an on/off switch (the last enabled map cannot be switched off) and **Force change** with an inline "Change now? Yes / Cancel"; the current map is marked.
  - Players: connected players with an Admin / Account / Guest badge and **Ban** (inline confirm with an optional reason; not for admins), plus "Ban an account by username" for offline accounts.
  - Bans: username, kind, reason, date, who banned, when it lifts, and **Unban**.
  - Abuse log: the latest 50 automatic warnings and bans with their evidence.

  The result of the last action shows under the tabs. In Change map, maps disabled by an admin are greyed with "Disabled by admin" and cannot be picked (admins still can).

All values are the same cvars as the console and are saved the same way.

Dev preview: `/?mockhud&open=settings` (main menu), `&open=maps` (map submenu), `&open=settings&view=settings&tab=hud` (a settings tab), `&view=account`, `&view=coins`, `&view=admin` (logged in as an admin; `&tab=maps|players|bans|abuse`), and `&solo=0` for the read-only map list.

## Ghost

The race ghost ([gameplay.md](gameplay.md#ghosts)) is the player character ([characters.md](characters.md)) in a pale cyan, at opacity 0.35 (stronger at the silhouette) with a faint glow, drawn without depth writes so it never hides the map. Its name tag is a small drawn ghost icon (no emoji font needed) and `Name · 01:23.456`, or `Your PB · 01:23.456` for your local best. `cl_ghost 0` hides it; `cl_hideplayers` does not affect it. The console prints `Record ghost: Name time` when one loads.

## Default key binds

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| `Space`, mouse wheel | Jump |
| `Ctrl` | Crouch |
| `Y` | Chat |
| `Tab` | Scoreboard |
| `1`–`8` | Map vote (while open); `1` / `2` = yes / no on an RTV request; else their binds (Zombie Run weapons `1`–`4`; Infected `1` primary, `2` pistol, `3` knife, `4` call M.O.A.B.) |
| `M` | Toggle spectate |
| `R` | Restart run (`!r`); Zombie Run / Infected reload |
| `E` | Infected: plant a respawn beacon (`beacon`) |
| `N` | Infected: call an earned M.O.A.B. (`moab`) |
| `` ` `` / `~` | Console |
| `Esc` | Esc menu |

Binds added after a player first saved their table (`E` → `beacon`, `N` → `moab`) are offered once: they are filled in when the key is free and the command is not bound elsewhere, and the offered list is stored in `surf.binds.offered` so a later `unbind` sticks. In a window, `Ctrl`+`N` stays with the browser, so `N` does nothing while crouching; in fullscreen with the keyboard lock it works ([Platform](#platform)).

## Audio

All sounds are real recordings released under CC0, sourced from Freesound and listed with their trims in [CREDITS.md](../CREDITS.md). Nothing is synthesised: code only selects, places, levels, filters and convolves the recordings. Files live in `apps/web/static/sfx/` (AAC `.m4a`, 48 kHz, mono events, about 0.65 MB in total) and are fetched after the first user gesture. A file that fails to load only silences that sound.

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
| Knife swing | Hide and seek: your knife swing; another seeker's swing within 1024 units (−6 dB per doubling of distance beyond 128) | Bamboo stick whooshes, pool of 4 |
| Knife hit | Hide and seek: you found a hider, or you were found | Knife stabbing a foam block, pool of 4 |

Rules:

- **One space.** Every event and the slide bed also feed one shared ConvolverNode with a measured impulse response (Liverpool Philharmonic Hall), with the send 14 dB below the dry signal. The wind is already an outdoor recording and stays dry.
- **Variation.** Pooled takes play in order (1, 2, …, n, 1, …) with a random ±1.5 dB level change per play. No playback-rate or pitch variation.
- **Levels.** Takes in a pool are matched in loudness offline. The wind bed at full speed is the reference (−20 LUFS before the master volume). Events are placed relative to it in `apps/web/src/lib/audio/mix.ts`. Every file has a true peak of −1.5 dBTP or lower. The master volume (`volume` cvar) feeds a safety limiter.
- **Loops.** Loop points are prepared offline with an equal-power crossfade, so the loops are seamless.
- **Pipeline.** `tools/audio/process.py` rebuilds the files from the downloaded originals using `tools/audio/manifest.json`. `tools/audio/demo.py` renders a demo mix mastered to −14 LUFS for listening checks. Both scripts use Python 3 and ffmpeg.

## Platform

Desktop browsers (Chrome, Firefox, Edge, Safari) with mouse and keyboard. Pointer lock is required. On touch-only devices, show a "Desktop only" message.

### Accidental Ctrl+W

Crouch on `Ctrl` plus forward on `W` is an easy slip that closes the tab. Pure rules are in `apps/web/src/lib/input/guard.ts` (unit tests in `guard.test.ts`).

1. **Block (Chromium, `fullscreen.ts`).** With `cl_fullscreen 1` (default) the click that locks the pointer also puts the page in fullscreen and calls `navigator.keyboard.lock()` for `Escape`, `W`, `T`, `N` and `Q`. `Ctrl` combinations then reach the page and are swallowed while the pointer is locked (`isBrowserShortcut`; developer tools, AltGr and Cmd combinations are left alone). F11 fullscreen does not count, and fullscreen without the keyboard lock does not block `Ctrl+W`.
   - Short `Esc` releases the pointer and opens the menu, still in fullscreen; hold `Esc` (about 1.5 s) to leave fullscreen. `Ctrl+W` does nothing in the menu either while fullscreen is on.
   - Leaving fullscreen releases the keyboard lock. The next click that locks the pointer enters fullscreen again. Resuming with `Esc` is not a user gesture, so it stays windowed. Switching the setting off leaves fullscreen at once.
   - One-time prompts outside our control: some Chromium versions ask "Override some keys on your keyboard" (if refused, a chat notice says that `Ctrl+W` is not blocked), and GNOME on Wayland asks "Allow inhibiting shortcuts" (either answer is fine). Both take the pointer lock, so the Esc menu opens: answer, then Resume.
   - A chat hint explains this once per browser, after the first successful lock.
   - Firefox and Safari have no keyboard lock: the setting is replaced by a note and the game stays windowed.
2. **Ask.** Otherwise a `beforeunload` "Leave site?" prompt is armed while the pointer is locked, for 2 s after it is released, and, with no menu or other overlay open, for 10 s after the last game key or resume (`leaveGuardArmed`; "Click to play" with keys still moving the player). Closing the tab from the Esc menu after 2 s asks nothing.
3. **Recover.** Session, guest name, player id, settings and binds are saved on change, so a reopened page reconnects at once under the same name; the server sends its current map. The last map (`surf.lastMap`) is loaded first (after `?map=`), so solo play returns to it. A run in progress is lost.
