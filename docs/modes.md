# Gamemodes

Every map belongs to one gamemode: its `MapDef.kind` (the field keeps its old name). There are three modes:

| Mode | Family | Rules | Default cvars | Min players | Scoreboard |
| --- | --- | --- | --- | --- | --- |
| `surf` | race | Timer, start/end zones, stages, PBs, leaderboard ([gameplay.md](gameplay.md)) | `SURF_CVARS` | 1 | Rank, PB, Status, Ping |
| `bhop` | race | Same as surf | `BHOP_CVARS` | 1 | Rank, PB, Status, Ping |
| `tag` | tag | Rounds of tag, see [Tag](#tag) | `TAG_CVARS` | 2 | Score, Status, Ping |
| `zombies` | coop | Co-op escape against AI + turned player-zombies | `ZOMBIES_CVARS` | 1 | Kills, Turned, Status, Ping |
| `infected` | infected | MW3-style infected with throwing knives, see [Infected](#infected) | `INFECTED_CVARS` | 2 | Score, Kills, Deaths, Status, Ping |

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

## Infected

Server-authoritative MW3-style Infected. The shared `InfectedGame` class (`packages/shared/src/modes/infected/game.ts`) runs on the server; clients send `fire`, `reload`, `loadout` (weapon swap), `throwKnife`, `placeBeacon` and `callMoab`, and render predicted throwing knives and UAV pulses.

- **Phases.** `waiting` (< 2 active players, free roam; solo offline also roams freely with no bots) → `grace` (12 s pre-infection spread-out) → `playing` (2:00 round clock, +20 s added on every infection) → `ended` (7 s round summary) → `grace`.
- **Patient Zero (Alpha).** At the end of `grace`, one random player becomes Patient Zero. They keep the round's primary gun + a throwing knife until the first infection occurs (dealing normal gun damage against 5 HP survivors, headshots instakill & infect). Once anyone is infected, Patient Zero drops the gun and switches to claws + throwing knife.
- **Survivor classes (MW3 primaries).** Each round rotates the survivor primary through `INF_PRESETS`: Barrett .50cal → Striker → LMG → SMG. Every class has three slots, each with its own magazine and reserve (swaps never reset ammo; a swap cancels a reload):
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
- **Physics & Maps.** Uses `INFECTED_CVARS` (`ZOMBIES_CVARS` run-and-gun profile). `infected_outpost` ("Outpost") is a desert radar outpost arena (`kind: 'infected'`, `layout: 'open'`, 20 spawns).
