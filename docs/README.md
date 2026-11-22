# Surf Strike 2 — Design Docs

Browser-based surf and bhop game with Source-engine movement. One shared lobby, no main menu (the page loads straight into a map), four original maps rotating by vote every 15 minutes.

Status: design agreed 2026-11-21. Milestones 0–10 implemented 2026-11-21; milestone 11 (deploy, playtest) pending.

Run with Node 24 (`.node-version`, picked up by `fnm`): `pnpm install`, then `pnpm dev` (client), `pnpm server` (dev game server on `:27016`; dev builds connect there, production `./start.sh` uses `:27015`), `pnpm host` (server + tunnel + discovery; for the public Vercel site run `./start.sh` from the repo root, which preflights `.env`, `cloudflared`, deps and the port, then runs `pnpm host`; `--port`, `--db`, `--help`), `pnpm check`, `pnpm test`, `pnpm build`.

## Documents

| File | Covers |
| --- | --- |
| [architecture.md](architecture.md) | Hosting, Cloudflare tunnel, server discovery, netcode, repo layout |
| [physics.md](physics.md) | Source movement port, cvars, collision and traces |
| [gameplay.md](gameplay.md) | Timer, zones, stages, leaderboards, chat, spectate, map vote, lobby, accounts |
| [modes.md](modes.md) | Gamemode framework (surf, bhop, tag), how to add a mode, tag rules |
| [maps.md](maps.md) | Map format and the four map designs |
| [ui.md](ui.md) | HUD, console, cvars, Esc settings, account panel, audio |
| [roadmap.md](roadmap.md) | Milestones and out of scope |
| [overview.html](overview.html) | Interactive visual overview of all the above (open in a browser) |

## Decisions at a glance

| Topic | Decision |
| --- | --- |
| Client | SvelteKit + Three.js + TypeScript, deployed on Vercel |
| Game server | Node + `ws` + SQLite, runs on the host's own PC |
| Public access | `cloudflared` quick tunnel, URL registered to a Vercel API backed by Vercel Blob |
| Offline behaviour | Solo play with a local timer and rotation; auto-reconnects when the server comes up |
| Netcode | Client simulates its own movement; server validates runs and relays state |
| Physics | CS2 movement: 64 tick with subtick input on a Source `CGameMovement` port, SharpTimer CS2 surf/bhop cvars |
| Rendering/collision | Three.js; custom convex-brush AABB traces, no physics engine |
| Gamemodes | `MapDef.kind` is the gamemode: surf and bhop (race: timer, zones, PBs) and tag (server-run rounds, score = time not IT); rotation mixes all modes ([modes.md](modes.md)) |
| Features | Timer, zones, stages, PBs, top-10 leaderboard, chat, Tab scoreboard, spectate |
| Not included | Practice `!saveloc`/`!tele`, weapons, anti-cheat, mobile |
| Identity | Simple accounts (username + password, no email/verification) in the server's SQLite; only accounts' runs reach the leaderboard. Guests pick a name and play everything without saving runs |
| Settings | Developer console (`~`) plus an Esc menu (Change map, Settings, Account) |
| Admin | Esc › Admin for accounts in `ADMIN_USERNAMES` (default `tim`; by account, never display name): enable/disable maps, force map change, ban/unban (account, guest key + IP, close 4009) |
| HUD | CS2-era layout and feel, original art, open fonts |
| Map vote | 15:00 per map; vote at 0:30 left; 3 other maps + "Extend 10 min"; `!rtv` at 60% |
| Maps | 9 original: surf (aurora, ember, skyrend, hadal: all rated easy), bhop (meadow easy, circuit / reliquary / rimefall hard), tag (quayside); themed, stylised |
| Lobby | 32 players max, no player collision, low-poly humanoids with name tags |
| Platform | Desktop browsers, mouse + keyboard, pointer lock |
| Audio | Real CC0 field/foley recordings (Freesound), one measured hall IR; no synthesised sound ([ui.md](ui.md#audio), [CREDITS.md](../CREDITS.md)) |

## Content rule

All maps, art and fonts are original. Sounds are real CC0 recordings, credited in [CREDITS.md](../CREDITS.md). No Valve assets, no one-to-one copies of existing community maps, no "Counter-Strike" branding. Movement matches Source because it is a port of the movement math, which is game mechanics, not content.
