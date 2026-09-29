#!/usr/bin/env bash
# Reentrena el clasificador con las grabaciones propias (pantalla Grabar → datasets/own).
#
# Uso (desde Git Bash):
#   tools/retrain.sh --dry-run        arma el dataset en una carpeta temporal y muestra las tomas por glosa
#   tools/retrain.sh                  entrena classifier_v<N+1> y lo compara con el activo (no lo activa)
#   tools/retrain.sh --activate       además lo activa si no es PEOR (>2 puntos menos en val o test)
#   tools/retrain.sh --activate --force   lo activa aunque sea PEOR / entrena aunque no haya tomas nuevas
#   tools/retrain.sh --rollback [modelo]  vuelve a un modelo ya entrenado (por defecto classifier_v1)
# Variables: EPOCHS (150 por defecto, ~30 min en CPU), LSM_ROOT (D:/Ingenium por defecto).
# Nada de lo que usa el modelo activo se reescribe: el candidato vive en models/classifier_v<N+1>.pt,
# models/references_classifier_v<N+1>.json y datasets/processed_classifier_v<N+1>/; activar o volver atrás
# es solo cambiar models/ACTIVE_MODEL (y reiniciar el servidor). LSM_MODEL en el entorno tiene prioridad.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
ROOT_OVERRIDE="${LSM_ROOT:-}"
# shellcheck disable=SC1091
source "$HERE/env.sh"
if [ -n "$ROOT_OVERRIDE" ]; then export LSM_ROOT="$ROOT_OVERRIDE"; fi  # env.sh fija D:/Ingenium
unset LSM_PROCESSED

DRY=0 ACTIVATE=0 FORCE=0 ROLLBACK=0 ROLLBACK_TO=classifier_v1
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[i]}" in
    --dry-run) DRY=1 ;;
    --activate) ACTIVATE=1 ;;
    --force) FORCE=1 ;;
    --rollback)
      ROLLBACK=1
      if (( i + 1 < ${#args[@]} )) && [[ "${args[i + 1]}" != --* ]]; then ROLLBACK_TO="${args[i + 1]}"; i=$((i + 1)); fi ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: ${args[i]} (usa --help)" >&2; exit 2 ;;
  esac
done

fail() { echo "ERROR: $*" >&2; exit 1; }

ROOT="$LSM_ROOT"
MODELS="$ROOT/models"
OWN_INDEX="$ROOT/datasets/own/index_own.csv"
EPOCHS="${EPOCHS:-150}"
[ -d "$MODELS" ] || fail "No existe la carpeta de modelos $MODELS."

warn_env_model() {
  if [ -n "${LSM_MODEL:-}" ]; then
    echo "AVISO: LSM_MODEL=$LSM_MODEL está definido en este entorno y tiene prioridad sobre models/ACTIVE_MODEL."
  fi
}

write_active() {  # escritura atómica: temporal + mv
  local tmp="$MODELS/.ACTIVE_MODEL.$$"
  printf '%s\n' "$1" > "$tmp"
  mv -f "$tmp" "$MODELS/ACTIVE_MODEL"
}

rollback_help() {
  echo "Para volver atrás:  tools/retrain.sh --rollback [modelo]   (por defecto classifier_v1) y reinicia el servidor."
}

# --- Rollback: solo cambia ACTIVE_MODEL ---
if [ "$ROLLBACK" = 1 ]; then
  [[ "$ROLLBACK_TO" =~ ^[A-Za-z0-9_-]{1,64}$ ]] || fail "Nombre de modelo inválido: $ROLLBACK_TO"
  [ -f "$MODELS/$ROLLBACK_TO.pt" ] || fail "No existe $MODELS/$ROLLBACK_TO.pt."
  if [ "$ROLLBACK_TO" = classifier_v1 ]; then
    rm -f "$MODELS/ACTIVE_MODEL"
  else
    write_active "$ROLLBACK_TO"
  fi
  echo "Listo: el modelo activo es $ROLLBACK_TO. Reinicia el servidor para usarlo."
  warn_env_model
  exit 0
fi

[[ "$EPOCHS" =~ ^[1-9][0-9]*$ ]] || fail "EPOCHS debe ser un entero positivo (recibí '$EPOCHS')."

echo "== Reentrenamiento (raíz de datos: $ROOT)"
if [ ! -f "$OWN_INDEX" ] || [ "$(wc -l < "$OWN_INDEX")" -lt 2 ]; then
  fail "No hay grabaciones propias ($OWN_INDEX no existe o está vacío). Graba señas en la pantalla Grabar primero."
fi
echo "Tomas propias registradas: $(( $(wc -l < "$OWN_INDEX") - 1 ))"

ACTIVE="$(python -c 'from lsm.paths import active_model_name; print(active_model_name())')"
echo "Modelo activo: $ACTIVE"

N=0
for f in "$MODELS"/classifier_v*.pt; do
  [ -e "$f" ] || continue
  v="$(basename "$f" .pt)"; v="${v#classifier_v}"
  if [[ "$v" =~ ^[0-9]+$ ]] && (( 10#$v > N )); then N=$((10#$v)); fi
done
NEW="classifier_v$((N + 1))"
LATEST_PT="$MODELS/classifier_v$N.pt"
if [ "$DRY" = 0 ] && [ "$FORCE" = 0 ] && [ -f "$LATEST_PT" ] && [ ! "$OWN_INDEX" -nt "$LATEST_PT" ]; then
  fail "No hay grabaciones nuevas desde que se entrenó classifier_v$N. Graba más tomas o usa --force."
fi

# Todo se prepara en carpetas del candidato; si algo falla, se borran y no queda nada a medias.
STAGE_P="" STAGE_M="" COMMITTED=0
cleanup() {
  if [ "$COMMITTED" = 0 ]; then
    [ -n "$STAGE_P" ] && rm -rf "$STAGE_P"
    [ -n "$STAGE_M" ] && rm -rf "$STAGE_M"
  fi
  return 0
}
trap cleanup EXIT
trap 'exit 130' INT TERM  # Ctrl+C también limpia

if [ "$DRY" = 1 ]; then
  STAGE_P="$ROOT/datasets/processed_dryrun"
  rm -rf "$STAGE_P"
  echo
  echo "== Armando el dataset en una carpeta temporal (no toca datasets/processed)"
  LSM_PROCESSED="$STAGE_P" python "$REPO/training/build_dataset.py"
  echo
  echo "Revisión terminada (--dry-run): no se entrenó nada. Revisa arriba los conteos por glosa propia (train/val)."
  exit 0
fi

STAGE_P="$ROOT/datasets/processed_$NEW"
STAGE_M="$MODELS/.staging_$NEW"
rm -rf "$STAGE_P" "$STAGE_M"
export LSM_PROCESSED="$STAGE_P"

echo
echo "== 1/4 Armando el dataset en datasets/processed_$NEW (build_dataset.py)"
python "$REPO/training/build_dataset.py"

echo
echo "== 2/4 Entrenando $NEW ($EPOCHS épocas)"
T0=$SECONDS
python "$REPO/training/train.py" --out "$NEW" --out-dir "$STAGE_M" --epochs "$EPOCHS"
echo "Entrenamiento: $(( SECONDS - T0 )) s en total."
[ -f "$STAGE_M/$NEW.pt" ] || fail "El entrenamiento no produjo $NEW.pt."

echo
echo "== 3/4 Comparación: $ACTIVE (activo) contra $NEW (nuevo)"
WORSE=0
set +e
python "$REPO/training/compare_models.py" "$ACTIVE" "$NEW" --new-dir "$STAGE_M"
rc=$?
set -e
if [ "$rc" = 3 ]; then WORSE=1; elif [ "$rc" != 0 ]; then fail "Falló la comparación de modelos."; fi

echo
echo "== 4/4 Referencias de Práctica del candidato (references_$NEW.json)"
python "$REPO/training/build_references.py" --out "$STAGE_M/references_$NEW.json"

# --- Escrituras finales, todas juntas ---
mv -f "$STAGE_M"/* "$MODELS"/
rmdir "$STAGE_M"
COMMITTED=1
echo
echo "Guardado: models/$NEW.pt, models/references_$NEW.json y datasets/processed_$NEW/."

if [ "$ACTIVATE" = 1 ] && { [ "$WORSE" = 0 ] || [ "$FORCE" = 1 ]; }; then
  write_active "$NEW"
  echo "Listo: $NEW quedó activo (models/ACTIVE_MODEL). Reinicia el servidor para usarlo."
  [ "$WORSE" = 1 ] && echo "AVISO: se activó con --force aunque la comparación lo marcó PEOR."
  rollback_help
  warn_env_model
elif [ "$ACTIVATE" = 1 ]; then
  echo "NO se activó $NEW porque es PEOR que $ACTIVE (usa --activate --force para activarlo igual)."
  echo "Sigue activo: $ACTIVE."
  exit 1
else
  echo "$NEW entrenado pero NO activado. Sigue activo: $ACTIVE."
  [ "$WORSE" = 1 ] && echo "AVISO: la comparación lo marcó PEOR."
  echo "Para activarlo:  printf '$NEW\\n' > \"$MODELS/ACTIVE_MODEL\"   y reinicia el servidor."
  rollback_help
fi
