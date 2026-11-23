# Gamemodes

Every map belongs to one gamemode: its `MapDef.kind` (the field keeps its old name). There are four modes:

| Mode | Family | Rules | Default cvars | Min players | Scoreboard |
| --- | --- | --- | --- | --- | --- |
| `surf` | race | Timer, start/end zones, stages, PBs, leaderboard ([gameplay.md](gameplay.md)) | `SURF_CVARS` | 1 | Rank, PB, Status, Ping |
| `bhop` | race | Same as surf | `BHOP_CVARS` | 1 | Rank, PB, Status, Ping |
| `tag` | tag | Rounds of tag, see [Tag](#tag) | `TAG_CVARS` | 2 | Score, Status, Ping |
| `zombies` | coop | Co-op escape with weapons against AI zombies, see [Zombies](#zombies) | `ZOMBIES_CVARS` | 1 | Kills, Turned, Status, Ping |

The map rotation, vote, `!rtv`, chat, spectating and lobby are the same in every mode. The rotation mixes maps of all modes, so a vote can move the lobby from a surf map to a tag map.

## Framework

```
packages/shared/src/modes/
  index.ts   GameModeId, GAME_MODES registry, modeOf(map), mapCvars(map), TAG_CVARS
  tag.ts     TagGame: pure tag rules with an injected clock, plus tagTouch, randomSpawn, hullInBox
apps/server/src/modes/
  types.ts   ServerMode interface, ModeHost, ModePlayer
  race.ts    RaceMode: RunValidator per player, PB/leaderboard, !top/!pb, race scoreboard
  tag.ts     TagMode: runs TagGame on the latest state packets, chat announcements, modeState
  index.ts   createServerMode(host): picks the module by GAME_MODES[kind].family
```

- **Registry.** `GAME_MODES[id]` gives a mode's `label`, `family` (`race` or its own), `cvars` profile, `minPlayers` and `scoreColumns`. `mapCvars(map)` is the mode profile plus the map's `cvars` overrides; the server sends it in `welcome` and `mapChange`.
- **Server.** The lobby has no mode logic. It owns one `ServerMode` per map and replaces it on map change. It forwards these calls: `join` (after `welcome`/`mapChange`), `leave`, `spectate`, `state` (each state packet), `zone`, `command` (`!top`, `!pb`), `scoreRows`, `records` and `tick`. `tick` runs at `MODE_TICK_HZ` (32 Hz).
- **Client.** `game.ts` reads `modeOf(map)`. In race modes `RunTracker` runs every tick, as before. In other modes the tracker is skipped: teleport zones respawn the player at a random map spawn, and the race HUD (timer, splits, record panel) is hidden. `hud.gameMode`, `hud.modeFamily` and `hud.tag` drive the UI. The scoreboard takes its columns from `GAME_MODES[mode].scoreColumns`.
- **Protocol.** These changes are additive. `welcome` and `mapChange` carry `mode`. Non-race modes send `modeState` messages; race modes never do. `ScoreRow` has optional `score` and `it` fields. `Status` has new `Tagger` and `Runner` values.

### Adding a mode

1. Add the id to `GameModeId` and an entry to `GAME_MODES` (new `family` if it is not a race).
2. Put its pure rules in `packages/shared/src/modes/<mode>.ts`, with vitest tests on a fake clock.
3. Add `apps/server/src/modes/<mode>.ts` implementing `ServerMode`, and a case in `createServerMode`.
4. Add a `ModeState` variant to `protocol.ts` (keep the `{ type: 'modeState', mode }` shape).
5. Client: handle the mode in `game.ts` (`isRace()` branches, `onModeState`), add HUD fields in `contract.ts` and a HUD component.
6. Give its maps `kind: '<mode>'`, and add map checks in `maps/maps.test.ts`.

## Tag

Server-authoritative. The shared `TagGame` class runs on the server, using the latest state packet of every player who is not spectating.

- **Phases.** `waiting` is free roam with nobody IT, while fewer than 2 players are active. `countdown` lasts 5 s, then a round starts. `playing` lasts 3:00. After a round, the next `countdown` starts. If players drop below 2 at any point, the mode goes back to `waiting`, and a running round is cancelled.
- **IT.** At round start, one random active player is IT. With 8 or more players, two players are IT. If an IT leaves mid-round, a random runner becomes IT.
- **Tagging.** An IT tags a runner whose hull it touches: the horizontal distance between origins is ≤ 40 units (`TAG_RANGE`; hulls are 32 wide), and the hulls overlap vertically (72 tall, 54 ducked). The server checks this at 32 Hz. If several runners touch, the closest one is tagged. The tagged player becomes IT, and the tagger becomes a runner with 3 s of tag-back immunity. A player tagged in one check cannot tag in that same check. There is no freeze after a tag.
- **Score.** Your score is the number of seconds you were not IT this round. Late joiners start at 0 as runners. Scores reset at round start and stay visible during the countdown.
- **Round end.** Chat announces the top 3 (`Round 2 over! 1. Alice 151.2 s  2. ...`), and the next round starts after 5 s.
- **Messages.** `modeState { mode: 'tag', phase, round, timeLeft, it[], immune[], scores[] }` is sent on every change and at least once a second. `tagged { by, target }` is sent on each tag. Chat announces countdowns, round starts, tags and IT handovers.
- **Client.** The tag HUD shows an IT or RUNNER banner, the round time left, your score, who is IT and a short flash on tags. Remote IT players have a red tint and a red `IT · name` tag. `!r` / `!back` respawn at a random spawn, but not during a round. `!top` / `!pb` show your round score. Offline, or alone on the server, the HUD shows "Waiting for players — tag needs 2+" and you roam freely; there are no bots.
- **Physics.** `TAG_CVARS` is `BHOP_CVARS` (modern CS2 jump, autobhop) with `sv_airaccelerate 150`. This keeps chases readable, and the map's surf sections still work.
- **Maps.** A tag map has `kind: 'tag'`, `layout: 'open'`, at least 8 `spawns`, and only teleport zones, with one teleport zone under everything for fall-outs. There are no start, end, stage or checkpoint zones. See [maps.md](maps.md).

## Zombies

Prototype co-op mode (map: `zombies_lowtide`). Server-authoritative online; offline the client runs the same shared `ZombiesGame` locally, so it is playable solo. Code: `packages/shared/src/modes/zombies/` (`weapons.ts`, `hitbox.ts`, `path.ts`, `gates.ts`, `game.ts`, `net.ts`, tests), `apps/server/src/modes/zombies.ts`, client `apps/web/src/lib/game/zombies.ts`, `render/zombies.ts`, `ui/ZombiesHud.svelte`.

### Rules

- **Round flow.** `waiting` (nobody on the map) → `countdown` 8 s (everyone spawns at the start as a survivor and picks a weapon) → `playing` → `ended` (7 s summary in chat and HUD: time, kills, top killer) → next countdown. One player is enough. A round over 15 min is lost.
- **Goal.** The route is split into zones by **gates** (glowing amber barriers). The round is **won** when any survivor reaches the evac zone (the end zone at the pier tip, behind the last gate). It is **lost** when no survivors are left.
- **Gates.** Each gate has an unlock area on its near side (green floor marker). When at least **50 %** of the living survivors stand in it at the same moment (1 of 1, 1 of 2, 2 of 3, 2 of 4, ...), a **30 s** countdown starts (HUD and chat). It is never cancelled: survivors may leave the area. When it ends, the gate's collision is removed and the mesh fades. Only the first closed gate can start counting. Gate state and seconds left are in `modeState.gates`.
- **Checkpoints** (one per zone, before its gate): the first survivor in one heals all survivors to full and refills reserve ammo. Late joiners spawn there as survivors.
- **Survivors** have 5 HP. Each zombie hit takes 1 (300 ms of invulnerability after a hit, no regeneration). Falling into the water costs 1 HP and teleports back to the checkpoint.
- **Turning.** A survivor at 0 HP joins the **zombie side** for the rest of the round: after 3 s they rise at a zombie spawn area as a player-controlled zombie. They have zombie stats: 265 u/s (slowed by hits like AI zombies), 8 HP, the zombie hitboxes (headshot = kill), claws only (melee, 64 reach, 0.9 s between swings, 1 HP per hit on survivors). Killed player-zombies respawn after 4 s. Their kills on survivors count. They cannot pick weapons, trigger checkpoints, gates or the evac. Remote player-zombies are drawn in zombie colours with a green `ZOMBIE · name` tag. Everyone starts the next round as a survivor.

### Weapons

One weapon per life, picked with **1-4** while the loadout window is open (countdown, and 15 s after a (re)spawn); a map vote keeps 1-4 while it is open. Mouse1 fires (`+attack`), **R reloads** (in zombies only; `!r` restarts the round in solo, online rounds restart by themselves), mouse2 toggles the sniper scope. Damage is in zombie HP (8); **any headshot kills**. Movement speed is the weapon's (CS-style `sv_maxspeed`).

| Key | Weapon | Body hits to kill | Move speed | Fire | Magazine / reserve | Reload | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Light machine gun | 8 | 195 | 80 ms, automatic | 100 / 300 | 4.2 s | 1.6° spread |
| 2 | Pistol | 4 | 240 | 150 ms | 12 / 96 | 1.5 s | 0.5° spread |
| 3 | Knife | 1 | 250 | 450 ms | — | — | 76 reach, 38° cone |
| 4 | Sniper rifle | 1 | 205 | 1.25 s bolt | 5 / 30 | 3.0 s | pierces 3 zombies; scope 40° FOV, no spread scoped (3° unscoped) |

Hits slow a zombie for 0.6 s (×0.6, stacking to ×0.5 and ×0.42) and push it back (pistol 80, LMG 40 u/s).

### AI zombies

- **Bodies.** Each zombie is a player hull moved by the real `playerMove` (gravity, steps, collision with the map and closed gates) at 64 Hz, with its own cvars (no autobhop). Base speed 265 u/s (survivors 195-250). 8 HP. Hitboxes (`hitbox.ts`): a vertical cylinder (radius 13, 0-54) and a head sphere (radius 7.5, 7.5 forward along the yaw, 65 up) matching the hunched model.
- **Steering.** Target = nearest living survivor (re-picked every 8 ticks). If it is close, or in line of sight within 1100 units, the zombie runs straight at it; otherwise it follows the map's waypoint route (`MapDef.zombies.path`) towards the target's route progress with a 160-unit look-ahead. Separation from nearby zombies (no zombie-zombie collision). Blocked while moving: jump. Zombies at a closed gate wait there; others that make no progress for 6 s are removed (the spawner refills).
- **Attacks.** Within 50 units: 350 ms wind-up (shown as a lean and glow), then 1 hit if still within 65; 0.9 s cooldown.
- **Spawner.** Interval `1.5 s / (1 + 0.6·(survivors − 1)) · (1 − 0.35·progress)` (min 0.2 s); cap `min(40, 12 + 6·players)`. It uses spawn areas (`MapDef.zombies.spawnZones`) feeding route nodes from 2 behind to 3 ahead of the front survivor, at least 700 and at most 3200 units from survivors, and never areas behind a closed gate. Zombies 1600 route units behind the last survivor and 1200 from everyone despawn.
- **Cost.** Measured: 40 chasing zombies cost about 0.19 ms per 64 Hz step on the server (about 12 ms of CPU per second, ~1 % of a core), so the server runs the full 64 Hz simulation (2 steps per 32 Hz mode tick).

### Netcode

- **Zombies:** `BIN_ZOMBIES` (type 4) every mode tick (32 Hz), droppable under backlog: `u8 4, u8 version 1, u32 sim tick, u8 count`, then 11 bytes per zombie (`u16 id`, `i16 x·2, y·2, z·2`, `u8 yaw·256/360`, `u8 flags` (attacking, hit, slowed, on ground), `u8 hp·255`). Clients interpolate them 100 ms in the past like remote players (`net/zombie-interp.ts`).
- **Shots:** C→S `fire { weapon, origin (eye), dir (unit), tick }`, `reload {}`, `loadout { weapon }`. The client predicts fire rate, ammo and reloads and draws tracers and the muzzle flash at once. The server checks: alive, weapon is the player's, fire interval ≥ 75 % of the weapon's (jitter tolerance; reloads 85 %), ammo, finite values, a unit direction, and an origin within 80 units of the last state's eye. Rejected shots answer with an `ammo` resync. **Lag compensation:** `tick` is the interpolated zombie sim tick the shooter was looking at; the server tests AI zombies against their pose at that tick (400 ms history, clamped). Player-zombies are tested at their latest position. World geometry (and closed gates) stop bullets.
- **Events:** S→C `zm { ev }` with `ev.e` = `phase`, `spawn` (teleport/respawn, team and hp, to that player), `hit` (hit marker, to the shooter), `kill` (kill feed; `pid` for player-zombies), `shot` (others' tracers), `hurt`, `zhurt` (player-zombie slow and knockback, to that player), `down` (turned), `checkpoint`, `gate`, `ammo` (to that player), `end`. `modeState { mode: 'zombies', phase, round, timeLeft, elapsed, checkpoint, checkpoints, progress, zombies, kills, gates[], players[{ id, team, hp, alive, kills, deaths, weapon }] }` on change (≤ 4 Hz) and every second. Player health and teams are server-authoritative; positions stay client-authoritative as in the other modes.
- **Physics.** `ZOMBIES_CVARS` = surf profile with `sv_airaccelerate 30` and `sv_enablebunnyhopping 0` (CS2 cap: 286 u/s on each jump), autobhop on: run-and-gun.

### Known gaps (prototype)

- No sounds yet except the checkpoint/gate bell: the audio rules allow only real CC0 recordings, none were sourced for guns, knife, reload, zombies or hurt (hooks exist, `GameAudio.zombies`).
- No player-zombie collision with survivors or AI zombies (as everywhere in the game); player-zombies are not lag-compensated; their speed and slows are applied client-side.
- Zombie navigation is a single waypoint route; zombies spawned off it walk straight to it.
- Viewmodels are simple boxes and fairly large; no hands or animations beyond recoil, reload dip and a knife swing.
