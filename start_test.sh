#!/usr/bin/env bash
# Start a local development instance: the SvelteKit dev client (Vite) and a dev
# game server on 27016, which dev builds connect to automatically
# (apps/web/src/lib/net/discovery.ts DEV_FALLBACK_URL). Production (./start.sh,
# port 27015) is never touched. Ctrl+C stops both.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

GAME_PORT=27016 # fixed: dev clients fall back to ws://localhost:27016/ws
DEFAULT_DB="apps/server/data/dev.db"

usage() {
	cat <<'EOF'
Usage: ./start_test.sh [--web-port <n>] [--db <path>] [--fresh] [-h|--help]

Starts a local dev instance of Surf Strike 2:
  - dev game server on port 27016 (separate dev database)
  - web client with hot reload on http://localhost:5173 (default)
The dev client connects to the dev game server on its own. Ctrl+C stops both.
Production (./start.sh on port 27015, apps/server/data/surf.db) is not touched.

Options:
  --web-port <n>  Web dev server port (default 5173)
  --db <path>     Dev SQLite file (default apps/server/data/dev.db)
  --fresh         Delete the dev database first (accounts, runs, ghosts)
  -h, --help      Show this help and exit
EOF
}

die() {
	echo "start_test.sh: $*" >&2
	exit 1
}

web_port=5173
db_arg=""
fresh=0
while [[ $# -gt 0 ]]; do
	case "$1" in
	--web-port)
		[[ $# -ge 2 ]] || die "--web-port needs a value"
		web_port=$2
		shift 2
		;;
	--web-port=*)
		web_port=${1#*=}
		shift
		;;
	--db)
		[[ $# -ge 2 ]] || die "--db needs a value"
		db_arg=$2
		shift 2
		;;
	--db=*)
		db_arg=${1#*=}
		shift
		;;
	--fresh)
		fresh=1
		shift
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		usage >&2
		die "unknown argument: $1"
		;;
	esac
done
if ! [[ "$web_port" =~ ^[0-9]+$ ]] || ((web_port < 1 || web_port > 65535)); then
	die "invalid web port: $web_port"
fi
((web_port != 27015)) || die "27015 is the production game server port; pick another web port."

# --- Node 24 via fnm -------------------------------------------------------
if command -v fnm >/dev/null 2>&1; then
	eval "$(fnm env --shell bash)"
	if ! fnm use --silent-if-unchanged >/dev/null 2>&1; then
		fnm use 24 >/dev/null 2>&1 || true
	fi
fi
command -v node >/dev/null 2>&1 || die "Node not found. Install Node 24 (e.g. 'fnm install 24')."
node_major=$(node -p 'process.versions.node.split(".")[0]')
((node_major >= 22)) || die "Node $(node -v) is too old; need Node >= 22 (24 recommended). Run 'fnm install 24'."
if command -v pnpm >/dev/null 2>&1; then
	PNPM=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
	PNPM=(corepack pnpm)
else
	die "pnpm not found. Run 'corepack enable' (Node $(node -v))."
fi

# --- Dependencies ----------------------------------------------------------
if [[ ! -d node_modules || ! -d apps/server/node_modules || ! -d apps/web/node_modules ]]; then
	echo "start_test.sh: installing dependencies (pnpm install --frozen-lockfile)"
	"${PNPM[@]}" install --frozen-lockfile
fi

# --- Ports free? -----------------------------------------------------------
port_busy() {
	if command -v ss >/dev/null 2>&1; then
		[[ -n "$(ss -Hltn "sport = :$1" 2>/dev/null)" ]]
	elif command -v lsof >/dev/null 2>&1; then
		lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
	else
		return 1
	fi
}
port_busy "$GAME_PORT" && die "port $GAME_PORT (dev game server) is already in use. Stop the other dev server first."
port_busy "$web_port" && die "port $web_port (web dev server) is already in use. Stop it or use --web-port <n>."

# --- Dev database ----------------------------------------------------------
db=${db_arg:-$DEFAULT_DB}
mkdir -p "$(dirname "$db")"
DB_PATH="$(cd "$(dirname "$db")" && pwd)/$(basename "$db")"
[[ "$(basename "$DB_PATH")" != "surf.db" ]] || [[ -n "$db_arg" ]] ||
	die "refusing to use the production database for dev."
if ((fresh)); then
	rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"
	echo "start_test.sh: removed dev database $DB_PATH"
fi

# --- Go --------------------------------------------------------------------
cat <<EOF
Surf Strike 2 local dev instance
  web:   http://localhost:$web_port  (hot reload)
  game:  ws://localhost:$GAME_PORT/ws  (dev clients connect automatically)
  db:    $DB_PATH
  node:  $(node -v)
Ctrl+C to stop both.

EOF

# On exit, stop the whole process group (pnpm, tsx watch, vite and the log prefixers).
cleanup() {
	trap - INT TERM EXIT
	kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Game server with file watching (restarts on server/shared code changes).
PORT=$GAME_PORT DB_PATH=$DB_PATH NODE_ENV=development "${PNPM[@]}" --filter server dev 2>&1 | sed -u 's/^/[game] /' &
"${PNPM[@]}" --filter web exec vite dev --port "$web_port" --strictPort 2>&1 | sed -u 's/^/[web]  /' &

# Stop everything as soon as either process exits.
wait -n
echo "start_test.sh: a process exited; stopping the other." >&2
