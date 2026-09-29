#!/usr/bin/env bash
# Arranca la demo: compila la web si hace falta, revisa MediaPipe, levanta el servidor y abre Edge.
# Uso: tools/start.sh   (o doble clic en start.cmd, en la raíz del repo). Ctrl+C detiene el servidor.
# Variables: HOST (127.0.0.1), PORT (8000), NO_BROWSER=1 para no abrir el navegador.
set -euo pipefail
shopt -s globstar nullglob

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/env.sh"
export HOST="${HOST:-127.0.0.1}" PORT="${PORT:-8000}"
URL="http://$HOST:$PORT"
WEB="$REPO/web"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"

fail() { echo "ERROR: $*" >&2; exit 1; }

healthy() { curl -fsS --noproxy '*' --max-time 2 "$URL/api/health" >/dev/null 2>&1; }

open_browser() {
  if [ "${NO_BROWSER:-0}" = 1 ]; then echo "Abre $URL en el navegador."; return; fi
  if [ -x "$EDGE" ]; then
    "$EDGE" "$URL" >/dev/null 2>&1 &
    echo "Abrí $URL en Edge."
  elif cmd.exe //c start "" "$URL" >/dev/null 2>&1; then
    echo "Abrí $URL en el navegador predeterminado."
  else
    echo "No pude abrir el navegador: abre $URL a mano (en Edge)."
  fi
}

# 0. ¿Ya está corriendo?
if healthy; then
  echo "Ya hay un servidor respondiendo en $URL."
  open_browser
  exit 0
fi

# 1. Web compilada y al día
dist_stale() {
  local stamp="$WEB/dist/index.html"
  [ -f "$stamp" ] || return 0
  local f
  for f in "$WEB"/src/** "$WEB"/public/** "$WEB/index.html" "$WEB/package.json" "$WEB/vite.config.ts"; do
    if [ -f "$f" ] && [ "$f" -nt "$stamp" ]; then return 0; fi
  done
  return 1
}
if dist_stale; then
  echo "== Compilando la web (web/dist falta o es más vieja que web/src)…"
  command -v npm >/dev/null 2>&1 || fail "No encuentro npm. Instala Node.js o compila en otra terminal: cd web && npm run build"
  [ -d "$WEB/node_modules" ] || fail "Faltan las dependencias de la web: cd web && npm install"
  (cd "$WEB" && npm run build) || fail "Falló npm run build (revisa los errores de arriba)."
else
  echo "Web compilada y al día (web/dist)."
fi

# 2. MediaPipe (modelos .task y wasm) — la cámara no funciona sin ellos
missing=()
for m in hand_landmarker pose_landmarker_full face_landmarker; do
  [ -f "$WEB/public/mediapipe/$m.task" ] || missing+=("web/public/mediapipe/$m.task")
done
[ -f "$WEB/public/mediapipe/wasm/vision_wasm_internal.wasm" ] || missing+=("web/public/mediapipe/wasm/")
if [ "${#missing[@]}" -gt 0 ]; then
  echo "ERROR: faltan archivos de MediaPipe: ${missing[*]}" >&2
  echo "Para generarlos (una vez, con internet):" >&2
  echo "  source tools/env.sh && python training/download_models.py   # baja los .task a models/mediapipe" >&2
  echo "  cd web && node scripts/copy-mediapipe.mjs && npm run build   # copia .task y wasm a web/public/mediapipe" >&2
  exit 1
fi
[ -f "$WEB/dist/mediapipe/hand_landmarker.task" ] || fail "web/dist no trae MediaPipe: vuelve a compilar (cd web && npm run build)."
echo "MediaPipe listo."

# 3. Servidor + navegador (cuando /api/health responda)
(
  for _ in $(seq 1 90); do
    if healthy; then open_browser; exit 0; fi
    sleep 1
  done
  echo "El servidor no respondió en 90 s: abre $URL a mano cuando arranque."
) &
WAITER=$!
trap 'kill "$WAITER" 2>/dev/null || true' EXIT

echo "== Servidor en $URL (Ctrl+C para detenerlo)"
cd "$REPO/server"
python -m lsm.app
