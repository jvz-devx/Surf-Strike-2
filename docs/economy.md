# Points and coins

Status: the core is implemented (ledger, activity, playtime points, abuse detection, client views, the API for modes), and the awards of surf, bhop, Zombie Run, Tag and Infected. The awards of Hide and seek and the shop are not. The owner asked for a balanced point system and left the final numbers to us. Change the numbers here first, then in `packages/shared/src/economy.ts`, which holds all of them.

## Terms

- **Points** are what you earn. "Total points" on the scoreboard is the lifetime sum and never goes down.
- **Coins** are the spendable balance. Every point earned adds 1 coin. Buying in the shop lowers the coins only.
- Accounts only. Guests play everything but earn nothing.
- All base awards are whole numbers, decided by the server. The multiplier makes fractions, so amounts are stored in tenths of a point (integers). Popups show one decimal when needed (`+1.2`); totals and the balance are shown rounded down.

## Target rates

A basic shop item costs 75 coins. The intent is that the first one takes about 40 minutes of normal play and about 2 hours of only being online.

| Play | Points per hour |
| --- | --- |
| Online and active, no mode awards | 40 |
| Average player in any mode, including playtime | 90–130 |
| Very good player in any mode, including playtime | 150–190 |

No mode should pay clearly more per hour than another at the same skill. Where a mode can be repeated quickly, the awards decay.

Estimates for the race modes and Zombie Run, playtime included:

| Mode | Average player | Very good player | From |
| --- | --- | --- | --- |
| Surf and bhop | 75–90 | 110–155 without changing the map early, up to about 190 with `!rtv` | Clean runs of 30–50 s (easy surf), 45 s (bhop), 55 s and 89 s (hard surf), 15-minute map sessions |
| Zombie Run | 105–145 | 155–175 | 16–18 rounds per hour, nearly all won; average 22–35 per hour, mostly lost at gate 2–4 (bots with human aim errors in the real rules) |

Both ranges are at multiplier ×1.0. In the multiplayer modes a full lobby pays up to twice as much.

## Player multiplier

Owner's rule. In Zombie Run, Infected, Hide and seek and Tag every award, including the cash bag, is multiplied by the number of active players on the server when it is paid. It does not apply to surf, bhop or playtime.

| Active players | 1–2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 and up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Multiplier | ×1.0 | ×1.2 | ×1.3 | ×1.4 | ×1.5 | ×1.6 | ×1.7 | ×1.8 | ×1.9 | ×2.0 |

**Active player:** connected, not spectating, and has moved in the last 30 seconds. Anyone still for longer is AFK: not kicked, only not counted. Time in which the game itself holds a player still (frozen or blindfolded seeker, respawn wait, map change) does not run the 30 seconds down. Hiders in Hide and seek also stay active by looking around, because sitting still is how they play. An account connected more than once counts once. Guests count as players. A player who just joined, or comes back from spectating, is not active before the first movement. Teleports, respawns and falling straight down are not movement.

The minimum player counts below use the same definition of active.

**Connections:** in production at most 3 clients per IP address (IPv6: per /64) may be connected, so a lobby cannot be filled with one person's bots.

## Playtime

10 points for every 15 minutes of active online time, in every mode, carried over between maps and sessions. Time does not count while the player is AFK: no movement key, mouse or button input for 3 minutes. Holding one key or repeating the same input does not count as activity. Time spent spectating counts for at most 5 minutes in a row (until there is input while playing again). Input is read from the state packets: view movements, changes of run direction and ducks. Two in a row that were already seen in the same order in the last 10 minutes are a repetition.

## Race modes (surf, bhop)

Only validated runs count.

| Map | Finish |
| --- | --- |
| Easy surf | 4 |
| Easy bhop | 5 |
| Hard bhop | 12 |
| Hard surf | 15 |

- **Repeats** on the same map within one map session (until the map changes), and within 60 minutes whatever the sessions: 100 %, 50 %, 25 %, then 0, rounded up. The hour is there because a lone player can change the map at any time: two hard maps in turn would pay over 600 points per hour.
- **First finish ever** of a map: a bonus equal to the finish award. "Ever" means there was no stored run of the account on the map before this one, so maps finished before coins existed do not pay it.
- **Personal best** beaten: +2, once per map session and at most once per map in 60 minutes. The first run is not a PB, an equal time neither.
- **Server record** beaten: +5 easy, +15 hard. Only when it beats another account's record, at most once per map per account per 24 hours. The first time on a map beats nobody. Of two equal times the older one holds the record.
- Guests' finishes only show the login hint.

The owner's suggestion (bhop 4, surf 2, hard surf 3) paid an easy map almost as much as a hard one. A hard map can take several map sessions to finish once, so it pays three to four times as much.

## Zombie Run

The mode has no numbered rounds; the gates are its steps. One run is one round of points, matching "round 2 gives 2, round 3 gives 3".

- **Gate *n*:** *n* points for each living survivor who passes it: the whole body is behind the gate on the route's side (or, after a gap in the position packets, in a checkpoint or the evac beyond it) while the gate is open. Once per player, gate and round; reconnecting or an account connected twice does not pay it again.
- **In order.** Only the next gate on the player's own way counts. Gates skipped by a late join at a checkpoint, by a fall-out teleport to a checkpoint further on, or by being behind a gate that is not open are never passed, also not by walking back through them.
- **Evac:** the number of gates + 3 (8 on Low Tide). The round ends when the first survivor reaches the boat, so it pays every living survivor who has passed the last gate by then, in that round, and at least half of all gates (3 of 5). Whoever joins for the last gates gets those gates but not the evac.
- **Turned.** A survivor who was turned keeps what they earned, and gets nothing more for gates or the evac in that round, also not when they come back as a survivor (reconnect, spectate).
- **As a player-zombie:** 1 point per survivor killed, each survivor once per round, at most 3 per run.
- **Repeats** of the same gate, and of the evac, on the same map within one map session and within 60 minutes whatever the sessions: 100 %, 50 %, 25 %, then 10 %, rounded up to whole points. A gate therefore never pays less than 1. Whole runs pay 23, 13, 8 and then 6.
- A lost round pays nothing by itself; the gates passed in it stay.
- More survivors mean more zombies, so there is no solo bonus or penalty.

The first draft only let the evac decay (100, 75, 50, 25 %). A round that is won takes 200 seconds on Low Tide (150 of them are gate countdowns), so that paid a good player over 350 points per hour, and an average one about 240.

## Tag

Needs at least 3 active players. Rounds are 3 minutes.

- **Chased:** 1 point per 20 seconds as a runner while an IT is within 500 units, in line of sight, and both are moving. At most 3 per round. Hiding away from the action pays nothing.
- **Tags:** 1 point per different runner tagged, at most 3 per round. A runner who reconnects is the same one.
- **Placement,** with 4 or more players and a round played from the start: 3 / 2 / 1 points for the top three by time not IT. Players tied on that time (0.1 s, as shown) are ordered by how long they were chased; still tied players share the points of their places, rounded down, at least 1. Who was never IT and was chased for less than 10 s in the round takes no place: hiding pays nothing. Late joiners, and players who left or spectated in between, are skipped.
- **A round cancelled** by too few players pays no placement; chases and tags already paid stay.
- Coming within 64 units of a runner counts as a tag attempt for the `shadow` signal.

## Hide and seek

Triggered with more than 4 players (5 or more active). Below that the mode pays nothing but playtime. Rounds are about 5 minutes.

- **Seeker chasing:** 1 point per 20 seconds of an active chase, at most 4 per round. A chase is: within 600 units, in line of sight, closing in or following, both moving.
- **Hider being chased:** 1 point per 10 seconds, at most 8 per round. The hider takes the risk, so it pays twice as fast.
- **Seeker finds a hider:** 3 points each.
- **Hider in plain view:** 2 points per 30 seconds seen by a seeker while staying in the same small area (within 128 units), at most 6 per round. Seen means in the seeker's field of view, in line of sight, within 2000 units. Moving to a new area restarts the 30 seconds. Chase time does not count twice.
- **Hider survives the round:** 5 points if any seeker saw them for 5 seconds or more in total, 2 points if never seen.
- **Seekers win:** 3 points for each player who started as a seeker.
- **Cash bag:** once per round, halfway through the seeking phase, a bag with 4–10 coins (random) appears at a fixed, open, reachable spot near the middle of the map. Announced to everyone in chat and on the HUD. Only hiders can take it, by touch. Seekers can guard it. It stays until it is taken or the round ends. Each map declares the spot.

## Infected

Needs at least 4 active players. Rounds are 2–4 minutes.

- **Survivor kills:** 1 point per 4 infected killed, at most 4 per round. The same infected counts for at most 4 kills per survivor and round.
- **Infections:** 1 point per survivor infected, at most 5 per round; +1 for a bank shot, once per round. The whole lobby shares a stock of 16 payable infections that refills by 1 per 15 s of a running round: normal play does not notice it, rounds thrown away in seconds use it up.
- **Survive the round:** 4 points when at least half of the first survivors were infected and you killed at least one infected, else 2.
- **Last survivor alive when the survivors win:** +3, with the same conditions as the 4 points.
- **Specialist (7-kill streak):** 2 points, once per round, when the streak has kills of at least 2 different infected.
- **M.O.A.B. detonated:** 8 points to the caller, once per map session. Its victims count for nothing else. Surviving pays only when the normal clock (2 minutes) was played, so not after an earlier M.O.A.B.
- **Beacon smashed:** 1 point, once per round, for somebody else's beacon.
- **Infected win:** 2 points for Patient Zero, 1 point for every other infected who infected someone, when at least half of the normal clock was played.
- **Survivor first, infected later in the same round:** both halves pay. Kills, specialist, beacon and a called M.O.A.B. stay; from then on infections and the infected win count; surviving does not. Late joiners start as infected and are paid like the others.
- **A round cancelled** by too few players pays nothing for surviving or winning.
- **AFK:** 30 seconds without moving, as everywhere; a gunshot during the round counts as moving, so holding an angle and shooting is playing. Looking around or swinging the knife does not.

The limits beyond the first draft come from a bot simulation (2026-11-24, points per hour at ×1.0 including 40 playtime). Without them Patient Zero being let to infect everyone in seconds paid 240–249, an infected team that refuses to attack 144–152, protecting one survivor 156–160, and a very good player 198. With them: 54–59, 90–95, 108–110 and 142–166; average play 98–108. Tag: average 90–133, very good 134–186, hiding only the playtime. Bots on a simple arena, so rough.

The mode's own score (`+100` per kill and so on) stays as it is and only ranks players inside the round.

## Abuse and collusion

Detection must not be sensitive. Friends who play together, a bad seeker, a lucky streak or a shared IP address are normal. Nothing below bans on a single event.

**Prevention** (no punishment, the award is simply not paid):

- AFK players do not count towards minimum player counts and earn nothing.
- At most 3 connections per IP address in production, and one count per account.
- Caps and decay as listed per mode.
- A backstop of 250 points per rolling hour per account, counted before the multiplier, playtime included, excluding first-finish and record bonuses. What is left of it is paid.
- Awards are rejected for 5 seconds after a horizontal speed above the mode's sanity limit, or a jump in position faster than that limit that is not a respawn by the mode, a map spawn or a teleport destination. The limits (`SPEED_LIMIT`, units/s) are well above normal play, they are not the movement caps: hide and seek 600, Infected and Zombie Run 1000, tag 3500, surf and bhop 16384 (runs are validated anyway).

**Signals** (each adds strike weight):

| Signal | Weight |
| --- | --- |
| `shadow`: a seeker or IT stays within 100 units of the same target, looking at it and able to hit it (no glass or wall between), for 20 s without a swing or tag attempt, while the target earns points from them | 2 for the hunter, 1 for the target |
| `concentration`: more than 70 % of an account's chase or view points (6 or more) over 3 rounds come from one other account that is part of each of the 3, with 5 or more players available | 1, the earning account only |
| `contact`: the same pair tags, finds or infects each other 4 or more times within 60 s, with 5 or more players available | 1 each |
| `ipFeed`: a player on the same IP address who never acts in the round feeds an account 2 or more points, 3 rounds in a row | 2 each |
| `macro`: 10 minutes with 100 or more inputs of which 5 % or less are different, while points are earned in both halves | 2 |
| `impossible`: an award request the server has to reject as impossible (only where a client can trigger one) | 1 |

Changes to the first draft, because it flagged normal play: in the original form three friends in a small tag game would have been warned within minutes (`contact` every minute), a hider could have been banned because of a seeker who trolls them (`shadow`), and a round with one seeker makes 100 % of every hider's points come from that seeker. Therefore the conditions above, and the repeat limit below. Guests can be a partner in a signal but never get strikes.

**Response:**

- The same signal counts once per account and minute; `contact` and `concentration` once per 10 minutes, so alone they never reach a warning.
- Strikes decay by 1 every 10 minutes.
- At 3: a private warning. The warned account's awards are paused for 5 minutes (playtime is not), and so are those its partner earns from it.
- At 5, with signals from at least 2 different rounds or 2 different signal types and at least 30 s after a warning: a 5-minute ban, with the reason and the time left shown. It lifts by itself, strikes reset to 2, and the next ban needs a new warning. Strikes live in memory and are lost when the server restarts; bans are stored.
- Every warning and ban goes into an admin-visible log with its evidence. Points already earned stay; only admins can remove them.
- Admin accounts are logged but never banned automatically.

## Feedback to the player

Every award shows a small, non-blocking popup with the amount, the reason and the multiplier (for example `+4.5 coins · Found a hider · ×1.5`). Awards that arrive together are stacked. Outside the multiplayer modes the multiplier reads `×1.0`. The current multiplier and the active player count are also visible in the right-side panel. The Esc menu shows coins, lifetime points and the latest awards.

Guests see "Log in or register to earn coins for this." once per session, the first time they would have earned something.

## Implementation

| File | Job |
| --- | --- |
| `packages/shared/src/economy.ts` | All numbers, the reasons (`AWARDS`), multiplier, decay and formatting |
| `packages/shared/src/modes/hunt.ts` | `HuntTracker` (chase, view, shadow), `buildSight`, `TimeMeter` |
| `apps/server/src/economy.ts` | `Economy`: the only place that pays; `ModeEconomy` for the modes; finds the abuse signals |
| `apps/server/src/activity.ts` | Activity, input and suspect movement per connection |
| `apps/server/src/abuse.ts` | Strikes, decay, warning, pause, ban decision |
| `apps/server/src/economy-helpers.ts` | Simulated lobby for tests |
| `apps/server/src/payout-helpers.ts` | A real mode on that lobby for the payout tests |
| `apps/web/src/lib/game/coins.ts` | Popups and the Coins view on the client |

### Storage

All in the game server's SQLite, amounts in tenths. Migrations are additive: new tables, and two new columns with a default. An older server can still open the database; it only ignores the expiry of a running temporary ban.

| Table | Columns |
| --- | --- |
| `account_stats` | as before, plus `active_ms` (active time towards the next playtime points) |
| `bans` | as before, plus `expires_at` (wall clock ms; null = permanent) |
| `point_log` | `account_id`, `created_at`, `mode`, `map`, `reason`, `label`, `base`, `counted` (towards the backstop), `multiplier`, `amount` (negative for purchases) |
| `point_rollup` | `account_id`, `mode`, `reason`, `entries`, `base`, `amount`: sums of log rows older than 30 days, which are deleted |
| `abuse_log` | `created_at`, `account_id`, `username`, `action` (`warning`, `ban`, `exempt`), `strikes`, `evidence`; the latest 2000 rows. No IP addresses |

Totals, log row and (for playtime) the rest of the active time are written in one transaction. Active time is written every 60 s, when the account leaves and at shutdown.

### Wire

Additive; older clients ignore the messages, newer clients show nothing without them. Amounts and multipliers are tenths.

| Direction | Message |
| --- | --- |
| S→C | `coins { total, balance, recent[{ at, reason, label, amount, mult }] }`: after `welcome`, `auth` and purchases; the latest 20 entries |
| S→C | `award { at, reason, label, base, mult, amount, total, balance }`: to the player who earned it |
| S→C | `multiplier { mult, active, need }`: on join and every change, to everyone; `need` = active players this mode needs to pay |
| S→C | `coinsNotice { text, tone: info\|warn }`: guest hint, abuse warning (also sent as a chat line for older clients) |
| S→C | `banned { reason, seconds? }`: `seconds` until the ban lifts by itself; absent = permanent |
| S→C | `adminState`: `bans[].secondsLeft?`, `abuse[]?` |

<a id="paying-from-a-mode"></a>

### Paying from a mode

A mode calls `host.economy` (`ModeEconomy`) and nothing else. Every rule of this document that is not about the mode's own game is applied there: guests, AFK, spectators, minimum players, multiplier, caps per round and session (from `AWARDS`), backstop, suspect movement, abuse pause. So a mode just calls `award`, and never checks these itself.

| Call | Meaning |
| --- | --- |
| `award(playerId, base, reason, { against?, label? })` | Pay `base` tenths (the `*_PAY` constants, or `pts(3)`). `against`: the player it was earned from; **always pass it when there is one**. `label`: instead of the reason's text (`Gate 3`). Returns `{ paid, refused? }` |
| `roundStart()` / `roundEnd()` | Per-round caps and tallies start over / the round's abuse checks run. Call `roundEnd` after the last award of the round |
| `tally(playerId, key, 'round' \| 'session')` | Count something; returns the count so far. Survives a reconnect. `tallied(...)` reads it |
| `earned(playerId, reason, 'round' \| 'session')` | Base tenths paid so far |
| `sinceLastPaid(playerId, reason)` | ms since the last time on this map, or null (the 24 h record rule) |
| `paidWithin(playerId, reason, ms, label?)` | How often it was paid on this map in the last `ms`, across map sessions (repeat decay) |
| `activePlayers()`, `isActive(playerId)`, `multiplier()`, `enoughPlayers(reason?)` | Current values |
| `contact(byId, targetId)` | Call for **every** tag, find or infection, paid or not |
| `report('shadow', [hunterId, targetId], evidence)`, `report('impossible', [playerId], evidence)` | Abuse evidence |
| `acted(playerId)` | A verified action that counts as moving for the 30 s (Infected: a gunshot); not input for playtime |
| `teleported(playerId)` | Only for a move that is neither a `spawn` event sent with `host.send` (`zm`, `inf`, `hns`) nor to a spawn or destination of the map |

A map session is one mode instance: from map change to map change, extensions included. Its handle stops paying afterwards. Outside a round (before the first `roundStart`) the caps of `AWARDS` run for the whole session.

Optional on `ServerMode`: `stillness(p)` returns `'held'` while the game keeps a player from moving, `'look'` when looking around is enough, else null. Hide and seek (frozen; hiders), Zombie Run and Infected (dead) have it.

A repeated race finish and a first one:

```ts
const n = Math.max(host.economy.tally(p.id, 'finish', 'session') - 1, host.economy.paidWithin(p.id, 'raceFinish', REPEAT_MS)); // earlier finishes
host.economy.award(p.id, decayed(raceFinish(host.map), RACE_PAY.repeat, n), 'raceFinish');
if (firstEver) host.economy.award(p.id, raceFinish(host.map), 'raceFirst');
```

<a id="chase-and-view"></a>

Chases in a mode with hunters and targets (tag: `chaseRange: HUNT_RANGE.tagChase`, no `pursuit`, no `viewRange`):

```ts
// constructor
this.hunt = new HuntTracker({ sight: buildSight(host.map), chaseRange: HUNT_RANGE.hnsChase, pursuit: true, viewRange: HUNT_RANGE.hnsView });
this.chased = new TimeMeter(HNS_PAY.hiderChased.everyMs);

// every tick of the round; bodies from p.state: { id, x, y, z, yaw, pitch, ducked }
const s = this.hunt.update(host.now(), seekers, hiders);
if (s) {
	for (const [id, e] of s.chased)
		if (this.chased.add(id, e.ms) > 0) host.economy.award(id, HNS_PAY.hiderChased.points, 'hnsChased', { against: e.by });
	for (const { hunter, target } of s.shadows) host.economy.report('shadow', [hunter, target], '20 s without a swing');
}

// on a swing, tag or hit, and at round start
this.hunt.attempt(seekerId);
this.hunt.reset();
this.chased.reset();
```

`s.chasing` is the same per hunter and `s.seen` the targets in view. A target with several hunters is credited once, by the nearest. `HuntTracker` samples 4 times per second, uses at most 96 traces per sample, and measures speed from positions. The line of sight treats fake walls (`solid: false`) as opaque and glass as transparent.

### For the shop

`Economy.spend(accountId, amount, item)` (`lobby.economy`) takes tenths from the balance in one transaction, never below zero, logs `shop:<item>` and sends `coins`. It returns false when the balance is too low. The Coins view is `apps/web/src/lib/ui/menu/CoinsMenu.svelte`.
