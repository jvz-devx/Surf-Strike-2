# Architecture

The static client is on Vercel. The lobby runs as one Node process on the host's PC, exposed as `wss://` through a Cloudflare quick tunnel. The tunnel URL is published to Vercel Blob every time the server starts.

```
 Friends' browsers                    Vercel                         Host PC
┌──────────────────┐   GET /       ┌──────────────────┐
│ SvelteKit client │──────────────▶│ static client    │
│ Three.js, physics│   GET         │                  │
│ HUD, console     │──/api/server─▶│ discovery API    │◀── POST /api/server ──┐
└────────┬─────────┘               │ (Vercel Blob)    │    (HOST_SECRET)      │
         │                         └──────────────────┘                       │
         │  wss://<random>.trycloudflare.com/ws          ┌─────────────────┐  │
         └──────────────────────────────────────────────▶│ cloudflared     │  │
                                                         └───────┬─────────┘  │
                                                                 ▼            │
                                                         ┌─────────────────┐  │
                                                         │ game server     │──┘
                                                         │ Node, ws, SQLite│
                                                         │ localhost:27015 │
                                                         └─────────────────┘
```

## Parts

| Part | Runs on | Tech | Job |
| --- | --- | --- | --- |
| Client | Vercel (static) | SvelteKit, Three.js, TypeScript | Rendering, movement simulation, HUD, console, solo fallback |
| Discovery API | Vercel function | SvelteKit `+server.ts`, `@vercel/blob` | `POST /api/server` stores the tunnel URL (needs `HOST_SECRET`); `GET` returns it |
| Game server | Host PC | Node 22+, `ws`, `better-sqlite3` | Lobby state, relay, run validation, map timer and vote, leaderboards |
| Tunnel | Host PC | `cloudflared` quick tunnel | Public HTTPS/WSS URL with no port forwarding |
| Database | Host PC | SQLite file | Accounts and sessions, guest players, personal bests, top-10 per map |

## Start-up flow (`pnpm host`)

Run `./start.sh` from the repo root to host for the public Vercel site. It loads Node 24 via `fnm`, checks `apps/server/.env` (`HOST_SECRET`, `DISCOVERY_URL`), `cloudflared`, installed deps and that the port is free, then `exec`s `pnpm host`. Flags: `--port <n>`, `--db <path>`, `-h`.

1. Start the game server on `localhost:27015`.
2. Spawn `cloudflared tunnel --url http://localhost:27015` and parse the `https://*.trycloudflare.com` URL from its output.
3. `POST` that URL to `https://<vercel-app>/api/server` with header `Authorization: Bearer <HOST_SECRET>`. The API writes `{ url, startedAt }` to a fixed Blob path.
4. Every 60 s, re-post as a heartbeat (`lastSeen`).
5. On shutdown (SIGINT/SIGTERM), post `{ url: null }` so clients skip the connection attempt.

## Client connect flow

1. Load the page and immediately start solo mode on the current default map.
2. `GET /api/server`. If `url` is null or `lastSeen` is older than 3 minutes, stay solo and show "Offline — solo" in the HUD.
3. Otherwise open `wss://<tunnel>/ws`. On success, switch to the server's current map and state.
4. On disconnect, fall back to solo on the same map. Retry discovery every 10 s.
5. A `?server=<url>` query parameter overrides discovery, for local testing.

## One-time setup

- Create a Vercel project and a Vercel Blob store; link the store to the project.
- Set `HOST_SECRET` (random 32+ chars, enforced) in Vercel env vars and in `apps/server/.env`.
- The Blob store provides `BLOB_READ_WRITE_TOKEN` to the project. Optional `BLOB_ACCESS` = `private` (default) or `public`, matching the store. The endpoint reads env via `process.env` because SvelteKit 3 deprecated `$env/dynamic/private`.
- `apps/server/.env` (see `.env.example`): `HOST_SECRET`, `DISCOVERY_URL`, `PORT` (27015), `DB_PATH` (default `apps/server/data/surf.db`), optional `CLOUDFLARED`, `ADMIN_USERNAMES` (admin accounts, default `tim`; [Admin and bans](#admin-and-bans)).
- Set `DISCOVERY_URL` in `apps/server/.env` to the deployed Vercel app.
- `cloudflared` is already installed at `~/.local/bin/cloudflared`.
- The host's Node is v20.20.1, which is past end of life (April 2026). Upgrade to Node 22 or 24 (via `fnm`) before development.

## Netcode

Each client simulates its own movement with zero input lag. The server trusts positions but validates timed runs, then relays everyone's state to everyone else.

- **Client to server:** a binary state packet at 64 Hz (one per 64-tick simulation tick): position, velocity, view angles, flags (ducked, on ground), tick number.
- **Server to clients:** a binary snapshot at 32 Hz with all players' states, plus JSON reliable events (chat, zone hits, run finished, vote, map change, join/leave).
- **Remote players:** rendered about 100 ms in the past, interpolated between snapshots.
- **Run validation:** the client sends zone events with tick numbers. The server checks:
  - zones were entered in order (start, stages in order, end);
  - elapsed ticks roughly match wall-clock time (±5%);
  - horizontal speed never exceeded `sv_maxvelocity`;
  - no position jumps larger than speed allows (teleport detection), except server-known teleport triggers.
  A run failing any check is not saved, and the player gets a chat notice.
- **Close codes:** 4000 no hello within 10 s, 4001 bad player id, 4002 same player id or same account connected again (old socket; that client stops auto-reconnecting until reload), 4003 server full, 4008 rate-limit kick, 4009 banned (sent after a `banned { reason }` message; the client shows "You are banned" and stops auto-reconnecting until reload; see [Admin and bans](#admin-and-bans)).
- **Security:** friends-only by design. Chat is HTML-escaped, names are limited to 24 chars, and each client is rate-limited (state 70 msg/s, chat 2 msg/s). No anti-cheat beyond run validation. Accounts: see below. Admin rights come only from the logged-in account (`ADMIN_USERNAMES`), never from a display name, and guests cannot use a registered username as their name ([Admin and bans](#admin-and-bans)).

## Protocol sketch

| Direction | Message | Encoding |
| --- | --- | --- |
| C→S | `hello { playerId, name, version, token? }` (`token`: stored session, auto-login) | JSON |
| S→C | `welcome { selfId, map, mode, mapTimeLeft, players[], cvars, records, account }` (`account`: `{ username, admin }` or `null` for guests; `admin` only decides whether the client shows the Admin menu) | JSON |
| S→C | `maps { enabled[] }`: maps players may pick (votes, Change map); right after `welcome` and to everyone on every change | JSON |
| C→S | `register { username, password }`, `login { username, password }`, `logout {}` (any time after `welcome`, on the open socket) | JSON |
| S→C | `auth { ok: true, username, token?, records?, admin? }` / `auth { ok: false, error }` (`username: null` = logged out; also sent with `ok: false` after a `welcome` whose hello token was rejected) | JSON |
| C→S | `state` (tick, pos, vel, angles, flags) | binary, 64 Hz |
| S→C | `snapshot` (all players' state) | binary, 32 Hz |
| C→S | `zone { kind, index, tick }` | JSON |
| S→C | `runResult { ticks, rank, pb, record, splits, records }` (`records`: the runner's PB, rank and map record after the run, PB or not) | JSON |
| S→C | `records { map, records }`: pushed to every other player on the map when a run sets a new PB (their rank and the map record may have changed) | JSON |
| C↔S | `chat { text }` / `chat { from, text, admin? }` (`admin`: server-set marker for admin senders; scoreboard rows carry the same flag) | JSON |
| C→S | `admin { action }`: `setMapEnabled { mapId, enabled }`, `ban { targetId? \| username?, reason? }`, `unban { banId }`, `forceMap { mapId }`, `extend`, `listBans`. Re-checked on the server; non-admins get `adminResult { ok: false }` and nothing happens | JSON |
| S→C | `adminResult { ok, error?, message? }` (every `admin` request) and, to admins only, `adminState { maps[{ id, title, kind, enabled }], bans[{ id, username, kind, reason, createdAt, createdBy }], players[{ id, name, account?, guest, admin }] }` (after each request and when players or bans change) | JSON |
| S→C | `banned { reason }`, then close 4009 | JSON |
| C→S | `vote { option }`, `rtv`, `spectate { targetId }` | JSON |
| S→C | `voteStart`, `voteUpdate`, `voteEnd`, `mapChange { map, mode, ... }` | JSON |
| S→C | `modeState { mode: 'tag', phase, round, timeLeft, it[], immune[], scores[] }` (non-race modes, on change + every 1 s), `tagged { by, target }` ([modes.md](modes.md)) | JSON |
| C→S | `getGhost { map }` (race maps, after `welcome`/`mapChange`) | JSON |
| C→S | Zombies: `fire { weapon, origin, dir, tick }`, `reload {}`, `loadout { weapon }` (validated and lag-compensated by the server, [modes.md](modes.md#zombies)) | JSON |
| S→C | Zombies: `modeState { mode: 'zombies', phase, gates[], players[{ team, hp, ... }], ... }`, `zm { ev }` (spawn, hit, kill, shot, hurt, zhurt, down, checkpoint, gate, ammo, end) | JSON |
| S→C | `BIN_ZOMBIES` (type 4): `u8 4, u8 version, u32 sim tick, u8 count`, 11 bytes per zombie (id, position ·2 as i16, yaw, flags, hp); 32 Hz on zombies maps, droppable under backlog | binary |
| S→C | `BIN_GHOST` (type 3): `u8 3, u8 version, u8 flags (bit 0 = has ghost), u8 mapLen, map, u8 nameLen, name, u32 ticks, u32 samples`, then the deflate-raw track. Reply to `getGhost` ("none" when there is no ghost or `map` is not the current map), and pushed to everyone on a new record ghost ([gameplay.md](gameplay.md#ghosts)) | binary |

## Accounts

Username + password, no email or verification ([gameplay.md](gameplay.md#accounts-and-identity)). Everything lives in the game server's SQLite; traffic is TLS (`wss://` through the Cloudflare tunnel). Code: `apps/server/src/auth.ts`, rules shared with the client in `packages/shared/src/account.ts`.

- **Rules:** username 1–24 characters, no whitespace at all, printable characters only (no control, zero-width or bidi characters), stored NFC with its original casing and unique case-insensitively (`username_lower`). Password 5–128 characters, nothing else.
- **Hashing:** `node:crypto` scrypt (N = 16384, r = 8, p = 1, 32-byte key) with a random 16-byte salt per account, stored as `scrypt$N$r$p$salt$hash` (base64url); checked with `timingSafeEqual`. A login for an unknown username hashes against a dummy hash so both failures take the same time and return the same error ("Wrong username or password.").
- **Sessions:** a successful register or login returns a token (32 random bytes, base64url). The server stores only its SHA-256 hash in `sessions`, valid for 90 days. The client keeps the token in localStorage and sends it in `hello` to log in automatically. `logout` deletes the session row. Expired rows are deleted when looked up and pruned on each new login.
- **Rate limits** (sliding one-minute window): 5 failed logins per connection and 5 per username (across all connections), then "Too many attempts. Wait a minute and try again."; 3 register attempts per connection. One register/login at a time per connection.
- **One connection per account:** a login (message or hello token) closes any other connection of that account with 4002.
- **Never logged:** passwords and tokens. The log shows only `login #id account <id> <username>` or `login failed #id`.

| Table | Columns |
| --- | --- |
| `accounts` | `id`, `username`, `username_lower` (unique), `password_hash`, `created_at`, `last_login` |
| `sessions` | `token_hash` (SHA-256 hex), `account_id`, `created_at`, `expires_at` |
| `replays` | `map` (primary key), `account_id`, `time_ticks`, `samples`, `data` (deflate-raw BLOB), `created_at`: one record ghost per map, replaced only by a faster validated account run ([gameplay.md](gameplay.md#ghosts)) |

## Admin and bans

A small admin menu (Esc menu › Admin, [ui.md](ui.md#admin)) for the host. Code: `apps/server/src/admin.ts`.

- **Who is admin.** Only logged-in accounts whose username (case-insensitive, `username_lower`) is listed in `ADMIN_USERNAMES` in `apps/server/.env` (comma-separated; unset = `tim`, empty = no admins). The server decides at hello-token login and at `login`/`register`, and resets it on `logout`. Display names never count: a guest can type any name, but guest names equal (ignoring case) to a registered username are refused (hello falls back to `Guest-xxxx`; `name` / `!name` get a system message). The client is told `account.admin` only to show the menu; every `admin` message is re-checked server-side and non-admins get an error.
- **Rate limit and audit.** 30 admin actions per minute per connection. Every action is printed to the server console (`admin <name> (account <id>) <action> <target>`) and stored in `admin_log`; passwords, tokens and IPs are never logged.
- **Maps.** Disabled maps (`map_settings`) are left out of vote options, `!rtv` votes, random picks (`MapRotation` takes a live `isEnabled` filter) and the lone-player Change map; at least one map always stays enabled. Disabling the current map does not end it. `forceMap` changes to any map (disabled ones too) at once for everyone, through `MapRotation.forceMap` and the normal `mapChange` broadcast; `extend` adds 10 minutes (not during a vote or pending change).
- **Bans.** Targets: a connected player (by lobby id) or an account by username (offline ban). An account ban stores the account id (plus the player key of a connected target): all of its connections are kicked (`banned`, close 4009), and hello-token auto-login and `login` are refused. A guest ban stores the player key and, when known, the client IP: hellos with that key or IP are refused unless the hello token logs in an admin account. Admin accounts cannot be banned (nor ban themselves). Unban deletes the row.
- **Client IP.** Tunnel connections arrive from cloudflared on loopback, so the IP is the `CF-Connecting-IP` header; it is only trusted on loopback connections. Direct connections use the socket address. A loopback address is never stored (it would ban everyone on the tunnel).

| Table | Columns |
| --- | --- |
| `map_settings` | `map_id` (primary key), `enabled` (0/1; missing row = enabled) |
| `bans` | `id`, `account_id` (nullable), `player_key` (nullable), `ip` (nullable), `username_snapshot`, `reason`, `created_at`, `created_by` |
| `admin_log` | `id`, `created_at`, `admin_account_id`, `admin_username`, `action` (`enable-map`, `disable-map`, `force-map`, `extend`, `ban`, `unban`), `target`, `detail` |

## Repo layout

pnpm workspace monorepo:

```
apps/
  web/         SvelteKit client, adapter-vercel, /api/server route
  server/      Node game server (ws, better-sqlite3, cloudflared launcher)
packages/
  shared/      physics, collision, map definitions, protocol types, cvar defaults
docs/          these documents
```

`packages/shared` is used by both the client (simulation, rendering input) and the server (zone positions for validation, map list for votes).
