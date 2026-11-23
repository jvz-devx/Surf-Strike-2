# Gamemodes

Every map belongs to one gamemode: its `MapDef.kind` (the field keeps its old name). There are five modes:

| Mode | Family | Rules | Default cvars | Min players | Scoreboard |
| --- | --- | --- | --- | --- | --- |
| `surf` | race | Timer, start/end zones, stages, PBs, leaderboard ([gameplay.md](gameplay.md)) | `SURF_CVARS` | 1 | Rank, PB, Status, Ping |
| `bhop` | race | Same as surf | `BHOP_CVARS` | 1 | Rank, PB, Status, Ping |
| `tag` | tag | Rounds of tag, see [Tag](#tag) | `TAG_CVARS` | 2 | Score, Status, Ping |
| `zombies` | coop | Co-op escape with weapons against AI zombies, see [Zombies](#zombies) | `ZOMBIES_CVARS` | 1 | Kills, Turned, Status, Ping |
| `infected` | infected | Infected with throwing knives, see [Infected](#infected) | `INFECTED_CVARS` | 2 | Score, Kills, Deaths, Status, Ping |
| `hns` | hns | Hide and seek with knives; found hiders become seekers, see [Hide and seek](#hide-and-seek) | `HNS_CVARS` | 2 | Role, Finds, Survived, Ping |

The map rotation, vote, `!rtv`, chat, spectating and lobby are the same in every mode. The rotation mixes maps of all modes, so a vote can move the lobby from a surf map to a tag map.

## Framework

```
packages/shared/src/modes/
  index.ts   GameModeId, GAME_MODES registry, modeOf(map), mapCvars(map), TAG_CVARS
  tag.ts     TagGame: pure tag rules with an injected clock, plus tagTouch, randomSpawn, hullInBox
  hns.ts     HnsGame: pure hide and seek rules (clock-injected), knifeHit, hnsSpawns, HNS_* constants
apps/server/src/modes/
  types.ts   ServerMode interface, ModeHost, ModePlayer
  race.ts    RaceMode: RunValidator per player, PB/leaderboard, !top/!pb, race scoreboard
  tag.ts     TagMode: runs TagGame on the latest state packets, chat announcements, modeState
  hns.ts     HnsMode: runs HnsGame, knife messages, event routing, announcements, speed-cap check
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

## Infected

Server-authoritative MW3-style Infected. The shared `InfectedGame` class (`packages/shared/src/modes/infected/game.ts`) runs on the server; clients send `fire`, `reload`, `loadout` (weapon swap), `throwKnife`, `placeBeacon` and `callMoab`, and render predicted throwing knives and UAV pulses.

- **Phases.** `waiting` (< 2 active players, free roam; solo offline also roams freely with no bots) → `grace` (12 s pre-infection spread-out) → `playing` (2:00 round clock, +20 s added on every infection) → `ended` (7 s round summary) → `grace`.
- **Patient Zero (Alpha).** At the end of `grace`, one random player becomes Patient Zero. They keep the round's primary gun + a throwing knife until the first infection occurs (dealing normal gun damage against 5 HP survivors, headshots instakill & infect). Once anyone is infected, Patient Zero drops the gun and switches to claws + throwing knife.
- **Survivor classes (MW3 primaries).** Each round rotates the survivor primary through `INF_PRESETS` (labels in parentheses): Barrett (`.50 cal rifle`) → Striker (`Auto shotgun`) → LMG → SMG. Every class has three slots, each with its own magazine and reserve (swaps never reset ammo; a swap cancels a reload):
  - `[1]` the round primary, `[2]` the pistol (`INF_SECONDARY`, 12 + 36), `[3]` the knife. `4` (or `N`) calls an earned M.O.A.B.
  - **Barrett .50cal**: semi-auto anti-materiel rifle, one-hit kill, pierces 3, 10 + 20 rounds. `Mouse2` toggles a 38° scope that stays up between shots (the bolt-action sniper unscopes after each shot).
  - **Striker**: semi-auto drum shotgun, 8 pellets in a 4° cone per trigger pull (1 damage each), 12 + 24 shells, 1400 u range. The server resolves every pellet; the client draws 5–8 scattered cosmetic pellet tracers.
  - **LMG**: 750 rpm, 100 + 100 rounds, slowest run speed.
  - **SMG** (PP90M1 style): ~920 rpm, 36 + 72 rounds, fastest run speed (245 u/s).
  - Ammo is limited (`INF_AMMO`). Before Scavenger, an infected kill refills 40% of the primary's scavenger share.
- **Specialist perks (kill streaks).** Infected killed in one survivor life build a streak; perks unlock at `INF_PERK_KILLS` and end with that life (a fall-out keeps them). Hardline is the base perk: the M.O.A.B. needs 24 kills instead of 25.
  - 1 kill **Sleight of Hand**: reloads take half as long (`INF_SLEIGHT_RELOAD_FACTOR`).
  - 3 kills **Scavenger Pro**: every kill refills a full scavenger share of the primary (reserve up to 1.5× its cap) and of the pistol.
  - 5 kills **Steady Aim**: half spread (aim and shotgun pellets, `INF_STEADY_SPREAD_FACTOR`) and 12% more run speed (`INF_STEADY_SPEED_FACTOR`).
  - 7 kills **Specialist**: all perks plus a heal to 6 HP (`INF_SPECIALIST_HP`), 15% faster fire cadence (`INF_SPECIALIST_CADENCE_FACTOR`), 20% more knockback and `+250` score.
  - A `perk` event announces each unlock; the client predicts the reload, cadence, spread and speed factors and reconciles streak and perks from `modeState`.
- **M.O.A.B. tactical nuke.** At a 24-kill streak (`INF_MOAB_KILLS`) the survivor gets a private `moabReady`. `N` (or `4`) sends `callMoab`; everyone sees `moabCall` and a 10 s countdown (`INF_MOAB_COUNTDOWN_SECS`, also in `modeState.moab`). On `moabDetonate` every living infected dies, the caller gets the kills and `+500`, and the survivors win the round. The countdown is dropped if the round ends first.
- **Combat & Respawns.** Claws and throwing knives are instant 1-hit infections. Infected have 5 HP (headshots instakill), suffer hit slows/knockback, and respawn after 3 s at the spawn farthest from living survivors with a fresh throwing knife. Late joiners during `playing` spawn as infected.
- **MW3 Throwing Knife (`Mouse2`).** One per life for infected. Server-simulated parabolic gravity arc (`1150 u/s`, gravity `650 u/s²`) that bounces once off walls/floors (bank shots stay lethal and award a bonus) before sticking on the next contact (or dropping cleanly to the floor if it hits high up on a wall or ceiling). Stuck knives stay in the world and can be retrieved by their owner walking over them.
- **MW3 Respawn Beacon (`E`).** Infected players can plant a glowing Tactical Insertion flare on walkable ground (`1.5 s` cooldown, max 1 active; re-planting replaces the previous beacon). Dying while a beacon is active respawns you directly at your beacon (consuming it). Survivors can shoot or knife enemy beacons (1 hit) to smash them for `+50` score and deny the forward respawn.
- **Last Survivor UAV.** When 1 survivor remains against 2+ infected, a UAV sweep pulses their position every 5 s as a through-wall 3D beacon for infected.
- **Scoring.** Kill infected `+100`, infect survivor `+150` (`+50` throwing knife, `+50` bank shot), survive an infection `+25`, survive the round `+250`, smash a beacon `+50`, Specialist `+250`, M.O.A.B. `+500`.
- **HUD.** Survivors see three slot pills (`[1] primary · [2] Pistol · [3] Knife`), a perk track (Hardline, then 1 Sleight, 3 Scavenger, 5 Steady Aim, 7 Specialist lit by the streak, with the streak count and progress to the M.O.A.B.), a perk-unlock toast, and a pulsing gold `M.O.A.B. ready · N Call` badge. A called M.O.A.B. shows a red-amber `☢ M.O.A.B. inbound · 9.3s · caller` banner under the round header for everyone; the detonation flashes the screen white to amber over 2.4 s. Sounds reuse the real zone bell (call, detonation) and record chime (perk, ready); nothing is synthesised.
- **Physics & Maps.** Uses `INFECTED_CVARS` (`ZOMBIES_CVARS` run-and-gun profile). Maps (`kind: 'infected'`, `layout: 'open'`): `infected_outpost` ("Outpost"), `infected_terminal` ("Terminal"), and `infected_foundry` ("Foundry").

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

## Hide and seek

Mode id `hns` (family `hns`), label "Hide and Seek". Built like the CS:GO community hide and seek servers, with the "infection" twist the owner asked for: a hider knifed by a seeker becomes a seeker. Server-authoritative: the shared `HnsGame` (`packages/shared/src/modes/hns.ts`) runs in `apps/server/src/modes/hns.ts`; the client (`apps/web/src/lib/game/hns.ts`, `hns-view.ts`, `ui/HnsHud.svelte`) only displays the result and sends knife swings. Maps: `kind: 'hns'` with `MapDef.hns` ([maps.md](maps.md)).

### Rules

| Phase | Length | What happens |
| --- | --- | --- |
| `waiting` | while < 2 players | Free roam as a hider, HUD "Waiting for players — needs 2+". Offline (solo) the same, with "(offline: free roam)". No bots. |
| `starting` | 5 s | Countdown once 2 players are in (first round only). |
| `hiding` | 45 s (`HNS_HIDE_SECS`, env `HNS_HIDE_SECS`) | Seekers are teleported to a seeker spawn, **frozen and blindfolded** (black screen with the release countdown). Hiders are teleported to distinct, shuffled hider spawns and spread out. |
| `seeking` | 4:00 (`HNS_SEEK_SECS`, env `HNS_SEEK_SECS`) | Seekers are released ("Ready or not, here they come!", gavel sound) and hunt with knives. Warnings at 60, 30 and 10 s left; "X is the last hider!" when one is left. |
| `ended` | 8 s | Summary in chat and HUD (winner, survivors, top seeker by finds), then the next round's hiding phase starts with re-picked seekers. |

- **Seekers.** 1 seeker, 2 from 8 players (`HNS_TWO_SEEKER_PLAYERS`, the same split tag uses). At each round start the seekers are picked among the players who have not *started* a round as seeker for the longest (never first), randomly among ties, so the role rotates. Seekers get the knife (Mouse1); hiders have no weapon.
- **Knife.** Reach 64 units from the eye to the target's hull surface, 30° aim cone (×1.6 within 40 units), one swing per 0.5 s, one hit kills (`HNS_KNIFE`). The client sends `knife { origin, dir }`; the server checks: seeker, seeking phase, not frozen, finite values, a unit direction, origin within 80 units of the seeker's last eye, swing interval ≥ 75 % of 0.5 s, and line of sight (world trace; `solid: false` brushes do not block). **Lag compensation:** every state packet is stored with its arrival time (500 ms history); a swing is tested against each hider at `now − min(400, ping + 116) ms` (the seeker's RTT plus the 100 ms client interpolation delay and half a snapshot interval) and at their latest position; either counts, the closest hit wins.
- **Found.** The hider becomes a seeker at once, is teleported to a seeker spawn and is frozen there for 3 s (`HNS_FOUND_FREEZE_SECS`; HUD "You were found by X — you are now a seeker", kill feed "X found Y"). Respawning at the seeker spawn (as CS:GO servers moved killed T to the CT side) instead of in place means a found hider cannot instantly knife the hider standing next to them.
- **Win.** Seekers win the moment no hiders are left (found, or the last hiders left the server). Hiders win when the seeking clock runs out with at least one hider left. Scores: finds (hiders knifed) and seconds survived as a hider in the seeking phase; both reset each round.
- **Late joiners** during hiding or seeking join as seekers (frozen with the others while hiding): a fresh hider spawn could be next to a seeker, and joining as seeker cannot be used to scout. Between rounds they are hiders.
- **Disconnects.** A leaving player is removed from the round. If every seeker leaves, a random hider becomes the seeker (teleported, frozen 3 s while seeking). Dropping below 2 players cancels the round and goes back to waiting.
- **Freeze is server-enforced.** A frozen player whose position is more than 48 units from their freeze spawn is teleported back (`spawn` event, at most every 0.5 s); the client also skips movement while frozen.
- **`!r` / `!back`** respawn (hiders at a hider spawn, seekers at a seeker spawn) only outside a round. Fall-out teleport zones respawn by role; teleport zones with `dest` move the player to that point (secret passages).
- **Name tags.** Only within 600 units and in line of sight (`HNS_NAMETAG_RANGE`); seekers never see hiders' tags (no wallhack through tags). Seekers are drawn red with a red `SEEKER · name` tag.
- **Physics.** `HNS_CVARS` = surf profile (CS2 accelerate 6.5, friction 5.2, 250 run speed, legacy full-height jump), autobhop on, `sv_airaccelerate 100`, and `sv_air_speed_cap 300`: horizontal speed is clamped to 300 u/s whenever the player is airborne (bhop, strafes, ramps). Ground speed stays capped by `sv_maxspeed` 250. The cap is a mode cvar read by the movement code (`checkVelocity`), 0 (off) in every other mode. The server logs state packets above 320 u/s and ignores that player's knife swings for 1 s after one.
- **Messages.** C→S `knife { origin, dir }`. S→C `hns { ev }` with `ev.e` = `spawn` (teleport + freeze, to that player only), `swing` (to the others), `waiting`, `starting`, `roundStart`, `release`, `found`, `newSeeker`, `lastHider`, `warn`, `end`. `modeState { mode: 'hns', phase, round, timeLeft, seekers[], hiders[], winner, players[{ id, role, finds, survived, frozen }] }` on every change and once a second. Scoreboard rows: `status` Hider/Seeker, `kills` = finds, `score` = seconds survived.

### Why these numbers (research)

CS:GO hide and seek was never an official mode; every community server ran its own plugin and config, so these are the common conventions rather than one standard:

- **Freeze and blind the seekers at round start.** The original SourceMod plugin's `sm_hns_freezects` ("Should CTs get freezed and blinded on spawn?", default on): [AlliedModders: SM Hide and Seek](https://forums.alliedmods.net/showthread.php?p=1162319). The CS2 HNS plugin ChaseMod freezes the seekers for `ctStartFreezeTime` 15 s by default: [ChaseMod](https://github.com/ipsvn/ChaseMod) ([config](https://github.com/ipsvn/ChaseMod/blob/master/ChaseModConfig.cs)). A Workshop HNS map gives hiders one minute to hide: [Steam Workshop: Hide and Seek map](https://steamcommunity.com/sharedfiles/filedetails/?id=2445282334). We use 45 s: our maps are smaller than Inferno, and there is no flash/smoke to help hiders.
- **Round length.** That Workshop map gives seekers 10 minutes, hosting guides quote 8-10 minute matches ([Apex Hosting HNS guide](https://apexminecrafthosting.com/guides/csgo/setup-and-play-a-hide-seek-csgo-server/)). With conversion (seekers multiply) rounds end faster, so 4:00 of seeking keeps one map (15 min) at 2-3 rounds.
- **Knife-only seekers, unarmed hiders, seekers chosen in turns.** ChaseMod's knife damage/cooldown settings and its team switching on a seeker win ([ChaseMod](https://github.com/ipsvn/ChaseMod)); we rotate seekers by "sought least recently" instead of team swaps.
- **Last-hider events.** The Workshop map reveals everyone at one minute left or one hider left; we only announce the last hider (and 60/30/10 s warnings), because a reveal would make the 300 u/s cap the only defence.
- **Bhop cap 300** is the owner's rule.

### Known gaps

- Positions are client-authoritative as in every mode: snapshots still carry every player's position, so a modified client could show hiders through walls. Server-side visibility culling is not done.
- Knife swing and hit are silent: no real CC0 knife recording has been sourced yet (audio rules). The seeker release plays the existing gavel recording.
- No spectating while found (found hiders play on as seekers); spectating works as in every mode.
- Map votes give hns no reserved slot (`VOTE_MAP_SLOTS` covers surf/bhop/tag/zombies); hns maps fill free slots like any map.

