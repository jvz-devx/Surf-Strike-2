# Gamemodes

Every map belongs to one gamemode: its `MapDef.kind` (the field keeps its old name). There are three modes:

| Mode | Family | Rules | Default cvars | Min players | Scoreboard |
| --- | --- | --- | --- | --- | --- |
| `surf` | race | Timer, start/end zones, stages, PBs, leaderboard ([gameplay.md](gameplay.md)) | `SURF_CVARS` | 1 | Rank, PB, Status, Ping |
| `bhop` | race | Same as surf | `BHOP_CVARS` | 1 | Rank, PB, Status, Ping |
| `tag` | tag | Rounds of tag, see [Tag](#tag) | `TAG_CVARS` | 2 | Score, Status, Ping |

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
