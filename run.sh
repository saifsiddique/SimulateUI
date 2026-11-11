#!/usr/bin/env bash
# Usage (inside the activated em-sim env): ./run.sh [--dev]
# Unusual default ports avoid clashes with other projects; override with EMSIM_PORT / EMSIM_DEV_PORT.
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
command -v uvicorn >/dev/null || { echo "uvicorn not found. Activate the environment first: conda activate em-sim" >&2; exit 1; }
# The first start installs the frontend's packages (frontend/node_modules).
[[ -d "$root/frontend/node_modules" ]] || (echo "Installing the frontend packages (first start only)..." && cd "$root/frontend" && npm ci)
export EMSIM_PORT="${EMSIM_PORT:-8765}"
export EMSIM_DEV_PORT="${EMSIM_DEV_PORT:-5273}"
if [[ "${1:-}" == "--dev" ]]; then
  (cd "$root/frontend" && npm run dev -- --port "$EMSIM_DEV_PORT" --strictPort) &
  trap 'kill %1 2>/dev/null || true' EXIT
  echo "Frontend dev server: http://localhost:$EMSIM_DEV_PORT"
else
  # Build the page when it is missing or older than its sources (after an update).
  index="$root/frontend/dist/index.html"
  if [[ ! -f "$index" ]] || [[ -n "$(find "$root/frontend/src" "$root/frontend/public" "$root/frontend/index.html" -newer "$index" -type f -print -quit)" ]]; then
    echo "Building the page (frontend/dist)..."
    (cd "$root/frontend" && npm run build)
  fi
  echo "Open http://localhost:$EMSIM_PORT"
fi
uvicorn emsim.main:app --app-dir "$root/backend" --port "$EMSIM_PORT" --reload
