#!/usr/bin/env bash
# Ahmed AI Video Editor launcher for macOS and Linux: ./launcher/start.sh  (or double-click on macOS
# after `chmod +x`). Installs the packages on first run, serves the optimised build on port 5411 and
# opens it in the browser. ./launcher/start.sh stop  stops the server.
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
port=5411
url="http://localhost:$port/"
up() { curl -fs "http://localhost:$port/api/projects" >/dev/null 2>&1; }
open_url() { if command -v open >/dev/null; then open "$1"; else xdg-open "$1" >/dev/null 2>&1 || echo "Open $1"; fi; }

if [ "$1" = "stop" ]; then lsof -ti tcp:$port | xargs -r kill; echo "Editor server stopped."; exit; fi
if ! up; then
  command -v node >/dev/null || { echo "Install Node.js LTS from https://nodejs.org first."; exit 1; }
  command -v ffmpeg >/dev/null || echo "Note: ffmpeg is missing; rendering and audio tools need it."
  if [ ! -d "$root/reel/node_modules/remotion" ] || [ ! -d "$root/editor/node_modules/vite" ]; then
    echo "First start: installing the editor (a few minutes)..."
    npm --prefix "$root/reel" ci && npm --prefix "$root/editor" ci
  fi
  script=serve
  if [ ! -f "$root/editor/dist/index.html" ] || [ -n "$(find "$root/editor/src" "$root/editor/server" "$root/reel/src" -newer "$root/editor/dist/index.html" -type f | head -1)" ]; then script=app; fi
  (cd "$root" && nohup npm --prefix editor run $script > editor/.launch.log 2>&1 &)
  for _ in $(seq 240); do up && break; sleep 0.5; done
  up || { echo "The editor server did not start; see editor/.launch.log"; exit 1; }
fi
open_url "$url"
