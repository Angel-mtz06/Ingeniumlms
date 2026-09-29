#!/usr/bin/env bash
# Arranca la demo: compila la web si hace falta, revisa MediaPipe, levanta el servidor y abre Edge.
# Uso: tools/start.sh   (o doble clic en start.cmd, en la raíz del repo). Ctrl+C detiene el servidor.
# Variables: HOST (127.0.0.1), PORT (8000), NO_BROWSER=1 para no abrir el navegador,
#            FORCE_BUILD=1 para recompilar la web aunque parezca al día.
set -euo pipefail
shopt -s globstar nullglob

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
ROOT_OVERRIDE="${LSM_ROOT:-}"
# env.sh es del equipo original (D:/Ingenium): solo se carga si esa carpeta existe; si no, su mkdir
# en una unidad D: inexistente detenía el script. Siempre se sirve ESTA copia del repo.
if [ -d "/d/Ingenium" ]; then
  # shellcheck disable=SC1091
  source "$HERE/env.sh"
fi
export LSM_ROOT="${ROOT_OVERRIDE:-$REPO}" PYTHONIOENCODING=utf-8
if [ -d "$REPO/.venv/Scripts" ]; then export PATH="$REPO/.venv/Scripts:$PATH"; fi
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

port_busy() {
  python -c "import socket, sys; s = socket.socket(); s.settimeout(1); sys.exit(0 if s.connect_ex(('$HOST', $PORT)) == 0 else 1)"
}

WANT="$(python -c 'from lsm.paths import active_model_name; print(active_model_name())' 2>/dev/null || echo classifier_v1)"

# 1. Web compilada y al día
dist_stale() {
  local stamp="$WEB/dist/index.html"
  [ "${FORCE_BUILD:-0}" = 1 ] && return 0
  [ -f "$stamp" ] || return 0
  local f
  for f in "$WEB"/src/** "$WEB"/public/** "$WEB/index.html" "$WEB/package.json" "$WEB/vite.config.ts"; do
    if [ -f "$f" ] && [ "$f" -nt "$stamp" ]; then return 0; fi
  done
  return 1
}
build_web() {
if dist_stale; then
  echo "== Compilando la web (web/dist falta o es más vieja que web/src)…"
  why=""
  if ! command -v npm >/dev/null 2>&1; then
    why="no encuentro npm (instala Node.js)"
  elif [ ! -d "$WEB/node_modules" ]; then
    why="faltan las dependencias de la web (cd web && npm install)"
  elif ! (cd "$WEB" && npm run build); then
    why="falló npm run build (revisa los errores de arriba)"
  fi
  if [ -n "$why" ]; then
    [ -f "$WEB/dist/index.html" ] || fail "No hay web compilada y no pude compilarla: $why."
    echo "AVISO: $why; usando la web compilada anterior (web/dist)."
  fi
else
  echo "Web compilada y al día (web/dist)."
fi
}

# 0. ¿Ya está corriendo? Aun así se recompila la web si cambió: el servidor sirve web/dist desde
#    el disco, así que basta con recargar la página (antes aquí se salía sin compilar).
if healthy; then
  RUNNING="$(curl -fsS --noproxy '*' --max-time 2 "$URL/api/health" 2>/dev/null \
    | python -c 'import json, sys; print(json.load(sys.stdin).get("model") or "(sin clasificador)")' 2>/dev/null | tr -d '\r')"
  echo "Ya hay un servidor respondiendo en $URL (modelo: ${RUNNING:-desconocido})."
  if [ "$RUNNING" != "$WANT" ]; then
    echo "AVISO: el modelo activo configurado es $WANT: reinicia el servidor para usar $WANT (Ctrl+C en su ventana y vuelve a abrir start.cmd)."
  fi
  build_web
  echo "Si la página ya estaba abierta, recárgala (Ctrl+F5) para ver la versión nueva."
  open_browser
  exit 0
fi
if port_busy; then
  fail "El puerto $PORT ya está ocupado por otro programa (no es el servidor de la demo). Ciérralo o usa otro puerto: en Git Bash  PORT=8001 tools/start.sh  (en cmd:  set "PORT=8001"  y luego  start.cmd)."
fi
build_web

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
