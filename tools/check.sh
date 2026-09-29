#!/usr/bin/env bash
# Chequeo previo a la demo (con el servidor ya arrancado: start.cmd o tools/start.sh).
# Uso: tools/check.sh   Variables: HOST (127.0.0.1), PORT (8000), MIN_FREE_GB (2).
# Sale con 0 si todo lo esencial está bien; con 1 si algo falla (✗). Los avisos (⚠) no fallan.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/env.sh"
URL="http://${HOST:-127.0.0.1}:${PORT:-8000}"
MIN_FREE_GB="${MIN_FREE_GB:-2}"
FAILS=0

ok() { echo "✓ $*"; }
bad() { echo "✗ $*"; FAILS=$((FAILS + 1)); }
warn() { echo "⚠ $*"; }

echo "Chequeo de la demo contra $URL"

HEALTH="$(curl -fsS --noproxy '*' --max-time 5 "$URL/api/health" 2>/dev/null || true)"
if [ -z "$HEALTH" ]; then
  bad "El servidor no responde en $URL/api/health (arráncalo con start.cmd o tools/start.sh)"
else
  ok "El servidor responde en $URL"
  # Una línea por dato: clasificador, referencias, modelo, llm
  mapfile -t H < <(printf '%s' "$HEALTH" | python -c '
import json, sys
h = json.load(sys.stdin)
print("1" if h.get("classifier") else "0")
print(int(h.get("references") or 0))
print(h.get("model") or "")
print("1" if h.get("llm") else "0")' | tr -d '\r')  # python en Windows escribe CRLF
  if [ "${H[0]:-0}" = 1 ]; then ok "Clasificador cargado"; else bad "Clasificador NO cargado (revisa models/ y ACTIVE_MODEL)"; fi
  if [ "${H[1]:-0}" -gt 0 ]; then ok "Señas de referencia: ${H[1]}"; else bad "Sin señas de referencia (falta models/references.json)"; fi
  if [ -n "${H[2]:-}" ]; then ok "Modelo activo: ${H[2]}"; else bad "El servidor no informa el modelo activo"; fi
  if [ "${H[3]:-0}" = 1 ]; then ok "Oraciones con IA (modelo de lenguaje)"; else warn "Oraciones con plantillas (sin LLM): funciona sin internet, pero las frases son más simples"; fi
fi

if [ -f "$REPO/web/dist/index.html" ]; then ok "web/dist/index.html existe"; else bad "Falta web/dist/index.html (cd web && npm run build)"; fi

if [ -n "$HEALTH" ]; then
  for a in mediapipe/hand_landmarker.task mediapipe/pose_landmarker_full.task mediapipe/face_landmarker.task \
           mediapipe/wasm/vision_wasm_internal.wasm mediapipe/wasm/vision_wasm_internal.js; do
    code="$(curl -s --noproxy '*' --max-time 10 -o /dev/null -w '%{http_code}' "$URL/$a" || true)"
    if [ "$code" = 200 ]; then ok "/$a responde 200"; else bad "/$a responde ${code:-sin respuesta} (vuelve a compilar la web)"; fi
  done
fi

DRIVE="${LSM_ROOT:0:2}"  # p. ej. "D:" (la unidad de los datos y modelos)
FREE="$(python -c "import shutil; print(round(shutil.disk_usage('$DRIVE/').free / 2**30, 1))" 2>/dev/null | tr -d '\r' || echo "")"
if [ -z "$FREE" ]; then
  bad "No pude medir el espacio libre en $DRIVE"
elif python -c "import sys; sys.exit(0 if $FREE >= $MIN_FREE_GB else 1)"; then
  ok "Espacio libre en $DRIVE ${FREE} GB"
else
  bad "Poco espacio libre en $DRIVE ${FREE} GB (mínimo ${MIN_FREE_GB} GB)"
fi

echo
if [ "$FAILS" -eq 0 ]; then echo "Todo listo para la demo."; exit 0; fi
echo "$FAILS punto(s) con ✗: corrígelos antes de la demo."
exit 1
