# Self-hosting with Docker

The self-hosted container image runs the Node 24 game server and serves the SvelteKit web client on one port (`8080`). One URL provides both the playable browser client and the `/ws` WebSocket endpoint without the Vercel `/api/server` discovery route.

## Container image

The root [Dockerfile](../Dockerfile) uses a two-stage build on `node:24-trixie-slim` (glibc 2.41):

1. Build stage installs workspace dependencies, builds `apps/web` with `SURF_ADAPTER=node` (`@sveltejs/adapter-node`), bundles `apps/server/src/index.ts` into `dist/server.mjs` with `esbuild` (`better-sqlite3` external), and exports production `node_modules` for runtime.
2. Runtime stage copies the bundle, the built client handler, and production `node_modules`, creates `/data` and `/data/backups` owned by uid 1000 (`node`), switches to `USER node`, and runs `node dist/server.mjs` directly as PID 1 so `SIGTERM` reaches the process.

The runtime filesystem can be mounted read-only (`--read-only`). The process writes only to `/data` (SQLite database, WAL/SHM files, backups) and `/tmp`.

GitHub Actions ([.github/workflows/image.yml](../.github/workflows/image.yml)) builds and pushes `linux/amd64` images to `ghcr.io/<owner>/surf-strike-2` on pushes to `master`, pushes to `feat/netcode*`, and manual `workflow_dispatch` runs. Tags are the sanitized branch name (for example `feat/netcode` becomes `netcode`), `sha-<short>`, and `latest` on `master`. The workflow writes the pushed image digest to the GitHub Actions step summary.

## Quick start with `docker run`

Build locally from the repo root or pull from GHCR:

```bash
docker build -t surf-strike-2 .
```

Run with a persistent volume and a read-only root filesystem:

```bash
docker run -d \
  --name surf-strike-2 \
  --restart unless-stopped \
  --read-only \
  --tmpfs /tmp \
  -p 8080:8080 \
  -v surf-strike-data:/data \
  -e TRUST_PROXY=private \
  -e ALLOWED_ORIGINS=https://surf.example.com \
  -e ADMIN_USERNAMES=tim \
  surf-strike-2
```

Open `http://localhost:8080/` in a browser (or `https://surf.example.com/` behind TLS termination). Self-hosted builds connect directly to `wss://<host>/ws` (or `ws://<host>/ws` over plain HTTP). A `?server=<url>` query parameter still overrides the WebSocket target.

## Ports and endpoints

The container listens on `HOST:PORT` (default `0.0.0.0:8080`):

| Path | Purpose |
| --- | --- |
| `/` and static assets | SvelteKit client (`@sveltejs/adapter-node` handler) |
| `/ws` | Game WebSocket upgrade endpoint (plain HTTP returns `426 Upgrade Required`) |
| `/health` | Lightweight JSON probe (`{ ok, version, tickRate, map, mode, players }`) |
| `/metrics` | Prometheus text metrics (`text/plain; version=0.0.4`) |

## Environment variables

| Variable | Default in image | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `production` | Enables production defaults (`MAX_PER_IP=3`) and disables `MAP_DURATION_OVERRIDE` |
| `HOST` | `0.0.0.0` | Network interface to bind |
| `PORT` | `8080` | HTTP and WebSocket port (plain server default outside Docker is `27015`) |
| `DB_PATH` | `/data/surf.db` | SQLite database path |
| `WEB_HANDLER` | `/app/web/handler.js` | Path to the `@sveltejs/adapter-node` `handler.js`; unset to run API/WS only |
| `ADMIN_USERNAMES` | `tim` | Comma-separated admin account usernames (case-insensitive); set empty for none |
| `TRUST_PROXY` | `loopback` | Trusted proxy hops for `CF-Connecting-IP` and `X-Forwarded-For` (see below) |
| `ALLOWED_ORIGINS` | unset (any) | Comma-separated allowed WebSocket `Origin` values plus optional `same-origin` |
| `MAX_PER_IP` | `3` in production (`0` in dev) | Maximum connected players per IPv4 address or IPv6 `/64` (`0` disables) |
| `MAX_PENDING_CONNECTIONS` | `16` | Maximum open sockets awaiting `hello`, separate from the 32 player slots |
| `HELLO_TIMEOUT_MS` | `5000` | Close sockets that do not send `hello` within this many milliseconds (close `4000`) |
| `BACKUP_DIR` | `/data/backups` | Directory for hourly SQLite backups; unset to disable in-process backups |
| `BACKUP_INTERVAL_MS` | `3600000` | Interval between online backups in milliseconds (1 hour) |
| `BACKUP_KEEP` | `48` | Number of newest `surf-<UTC>.db` backups to keep |

## Reverse proxy and hardening

### `TRUST_PROXY`

Visitor IPs drive guest bans and per-IP connection limits. When traffic enters through an in-cluster tunnel or reverse proxy, the TCP peer address is the proxy IP rather than the player's address. Set `TRUST_PROXY` to match your proxy hops so guest bans never ban the proxy:

- `loopback` (default): trust `CF-Connecting-IP` and `X-Forwarded-For` only from `127.0.0.0/8` and `::1`. Matches local `./start.sh` with `cloudflared`.
- `none`: ignore forwarded headers and use direct socket addresses only.
- `private`: trust loopback, RFC1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), CGNAT (`100.64.0.0/10`), link-local, and IPv6 ULA (`fc00::/7`). Use this behind an in-cluster reverse proxy or tunnel pod.
- `cf`: trust `CF-Connecting-IP` only from loopback or private hops; ignore `X-Forwarded-For`.
- Explicit IP or CIDR list: comma-separated entries such as `10.42.0.0/16,127.0.0.1` or `loopback,fd00::/8`.

When `X-Forwarded-For` is used, the server walks hops right-to-left and picks the first untrusted IP, ignoring client-spoofed entries on the left. Trusted proxy addresses and loopback addresses are never returned as visitor IPs.

### `ALLOWED_ORIGINS`

Set `ALLOWED_ORIGINS` to restrict browser WebSocket upgrades on `/ws`, for example `https://surf.example.com` or `same-origin`. Disallowed or missing `Origin` headers receive `403 Forbidden`. Leave unset for local testing and bot tools that do not send an `Origin` header.

### Pre-hello limits and shutdown

Pre-hello WebSocket connections are capped separately (`MAX_PENDING_CONNECTIONS`, default `16`) and per IP, with a 5-second hello timeout (`HELLO_TIMEOUT_MS`), so unauthenticated sockets cannot fill the 32 player slots.

On `SIGTERM` or `SIGINT`, the server stops lobby timers, flushes account playtime and economy state, sends WebSocket close code `1001` to all clients, waits up to 2 seconds for close frames to flush, stops any in-flight backup, closes the HTTP server, and closes SQLite cleanly within 5 seconds.

## Metrics

`/metrics` exposes Prometheus gauges and counters:

- Lobby occupancy: `surf_players`, `surf_pending_connections`, `surf_max_players`
- Event-loop delay (`perf_hooks.monitorEventLoopDelay`): `surf_event_loop_delay_p50_ms`, `surf_event_loop_delay_p99_ms`, `surf_event_loop_delay_max_ms`
- Tick lateness: `surf_snapshot_tick_lateness_{p50,p99,max}_ms`, `surf_snapshot_ticks_total`, `surf_mode_tick_lateness_{p50,p99,max}_ms`, `surf_mode_ticks_total`
- Network throughput and backpressure: `surf_bytes_sent_total`, `surf_bytes_sent_per_second`, `surf_frames_dropped_total`, `surf_socket_buffered_bytes_max`
- Process health: `process_resident_memory_bytes`, `process_uptime_seconds`

## Volumes and backups

Mount `/data` on local persistent storage (not NFS, which breaks SQLite WAL locking). On Kubernetes, run a single replica with `strategy: Recreate` and a `Retain` PersistentVolumeClaim.

Backups run in-process using `better-sqlite3`'s `db.backup()` API rather than `cp` or a separate Kubernetes CronJob:

- Copying a live WAL file with `cp` can capture a mid-write state and corrupt the copy.
- A separate CronJob pod would consume extra memory and contend with a `ReadWriteOnce` volume mount.
- `db.backup()` copies pages incrementally without blocking the 64-tick event loop, writes to `surf-<YYYYMMDDTHHMMSSZ>.db.tmp`, renames atomically to `/data/backups/surf-<YYYYMMDDTHHMMSSZ>.db`, and prunes older snapshots so the newest 48 (2 days) stay on disk.

To restore from a backup, stop the container, replace `/data/surf.db` with the chosen backup file, remove any old `/data/surf.db-wal` and `/data/surf.db-shm` files, and start the container again.

## Coexisting with `./start.sh`

The Vercel deployment with `./start.sh` and Cloudflare quick tunnels continues to work as before. To prevent a local `./start.sh` run from overwriting or clearing a fixed self-hosted server in discovery:

- Set `FIXED_SERVER_URL=https://surf.example.com` in `apps/server/.env`. Both `./start.sh` and `pnpm host` check `/health` and refuse to start while the fixed server is healthy.
- `pnpm host` also inspects `GET <DISCOVERY_URL>/api/server` before publishing and before clearing on shutdown, and sends `expectedUrl` when posting `{ url: null }` so it never wipes another server's URL.
