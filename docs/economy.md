# Points and coins

Status: design, not implemented. The owner asked for a balanced point system and left the final numbers to us. This is the spec for the implementation; change the numbers here first.

## Terms

- **Points** are what you earn. "Total points" on the scoreboard is the lifetime sum and never goes down.
- **Coins** are the spendable balance. Every point earned adds 1 coin. Buying in the shop lowers the coins only.
- Accounts only. Guests play everything but earn nothing.
- All awards are whole numbers, decided by the server.

## Target rates

A basic shop item costs 75 coins. The intent is that the first one takes about 40 minutes of normal play and about 2 hours of only being online.

| Play | Points per hour |
| --- | --- |
| Online and active, no mode awards | 40 |
| Average player in any mode, including playtime | 90–130 |
| Very good player in any mode, including playtime | 150–190 |

No mode should pay clearly more per hour than another at the same skill. Where a mode can be repeated quickly, the awards decay.

## Playtime

10 points for every 15 minutes of active online time, in every mode, carried over between maps and sessions. Time does not count while the player is AFK: no movement key, mouse or button input for 3 minutes. Holding one key or repeating the same input does not count as activity. Time spent spectating counts for at most 5 minutes in a row.

## Race modes (surf, bhop)

Only validated runs count.

| Map | Finish |
| --- | --- |
| Easy surf | 4 |
| Easy bhop | 5 |
| Hard bhop | 12 |
| Hard surf | 15 |

- **Repeats** on the same map within one map session (until the map changes): 100 %, 50 %, 25 %, then 0, rounded up.
- **First finish ever** of a map: a bonus equal to the finish award.
- **Personal best** beaten: +2, once per map session. The first run is not a PB.
- **Server record** beaten: +5 easy, +15 hard. Only when it beats another account's record, at most once per map per account per 24 hours.

The owner's suggestion (bhop 4, surf 2, hard surf 3) paid an easy map almost as much as a hard one. A hard map can take several map sessions to finish once, so it pays three to four times as much.

## Zombie Run

The mode has no numbered rounds; the gates are its steps. One run is one round of points, matching "round 2 gives 2, round 3 gives 3".

- Passing gate *n* alive as a survivor: *n* points. A gate counts when it opens and the player reaches the next zone alive.
- Reaching the evac as a living survivor: the number of gates + 3.
- A survivor who was turned keeps what they earned. As a player-zombie: 1 point per survivor killed, at most 3 per run.
- Repeated wins on the same map session: 100 %, 75 %, 50 %, then 25 %.
- More survivors mean more zombies, so there is no solo bonus or penalty.

## Tag

Needs at least 3 active players. Rounds are 3 minutes.

- **Chased:** 1 point per 20 seconds as a runner while an IT is within 500 units, in line of sight, and both are moving. At most 3 per round. Hiding away from the action pays nothing.
- **Tags:** 1 point per different runner tagged, at most 3 per round.
- **Placement,** with 4 or more players and a round played from the start: 3 / 2 / 1 points for the top three.

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

- **Survivor kills:** 1 point per 4 infected killed, at most 4 per round.
- **Infections:** 1 point per survivor infected, at most 5 per round; +1 for a bank shot, once per round.
- **Survive the round:** 4 points.
- **Last survivor alive when the survivors win:** +3.
- **Specialist (7-kill streak):** 2 points, once per round.
- **M.O.A.B. detonated:** 8 points.
- **Beacon smashed:** 1 point, once per round.
- **Infected win:** 2 points for Patient Zero, 1 point for every other infected who infected someone.

The mode's own score (`+100` per kill and so on) stays as it is and only ranks players inside the round.

## Abuse and collusion

Detection must not be sensitive. Friends who play together, a bad seeker, a lucky streak or a shared IP address are normal. Nothing below bans on a single event.

**Prevention** (no punishment, the award is simply not paid):

- AFK players do not count towards minimum player counts and earn nothing.
- Minimum player counts are counted in distinct accounts.
- Caps and decay as listed per mode.
- A backstop of 250 points per rolling hour per account, excluding first-finish and record bonuses.
- Awards are rejected for players over the mode's speed cap, or teleported by something other than a map trigger, in the last 5 seconds.

**Signals** (each adds strike weight):

| Signal | Weight |
| --- | --- |
| A seeker or IT stays within 100 units and in line of sight of the same target for 20 s without a swing or tag attempt, while the target earns points | 2 |
| More than 70 % of an account's chase or view points over 3 rounds come from one other account, with 5 or more players available | 1 |
| The same pair tags, finds or infects each other 4 or more times within 60 s | 1 |
| Two accounts on the same IP address, one of which never acts, feed the other 3 rounds in a row | 2 |
| Automated input: the same input pattern repeated for 10 minutes while points are being earned | 2 |
| An award request the server has to reject as impossible (only where a client can trigger one) | 1 |

**Response:**

- Strikes decay by 1 every 10 minutes.
- At 3: a private warning. Awards from the involved pair are paused for 5 minutes.
- At 5, with signals from at least 2 different rounds or 2 different signal types and after a warning: a 5-minute ban, with the reason and the time left shown. It lifts by itself and strikes reset to 2.
- Every warning and ban goes into an admin-visible log with its evidence. Points already earned stay; only admins can remove them.
- Admin accounts are logged but never banned automatically.

## Feedback to the player

A small, non-blocking popup shows each award with its reason (for example `+3 Found a hider`), grouped when several arrive together. The Esc menu shows coins, lifetime points and the latest awards.
