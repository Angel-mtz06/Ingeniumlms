#!/usr/bin/env bash
# Reentrena el clasificador con las grabaciones propias (pantalla Grabar → datasets/own).
#
# Uso (desde Git Bash):
#   tools/retrain.sh --dry-run     solo arma el dataset y muestra cuántas tomas propias hay por glosa
#   tools/retrain.sh               entrena classifier_v<N+1> (N = mayor versión en models/) y lo compara
#   tools/retrain.sh --activate    además lo deja activo (models/ACTIVE_MODEL); reinicia el servidor después
#   tools/retrain.sh --force       entrena aunque no haya grabaciones nuevas desde el modelo activo
# Variables: EPOCHS (150 por defecto, ~30 min en CPU), LSM_ROOT (D:/Ingenium por defecto).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
ROOT_OVERRIDE="${LSM_ROOT:-}"
# shellcheck disable=SC1091
source "$HERE/env.sh"
if [ -n "$ROOT_OVERRIDE" ]; then export LSM_ROOT="$ROOT_OVERRIDE"; fi  # env.sh fija D:/Ingenium

DRY=0 ACTIVATE=0 FORCE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --activate) ACTIVATE=1 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: $arg (usa --help)" >&2; exit 2 ;;
  esac
done

fail() { echo "ERROR: $*" >&2; exit 1; }

ROOT="$LSM_ROOT"
MODELS="$ROOT/models"
OWN_INDEX="$ROOT/datasets/own/index_own.csv"
EPOCHS="${EPOCHS:-150}"
[[ "$EPOCHS" =~ ^[1-9][0-9]*$ ]] || fail "EPOCHS debe ser un entero positivo (recibí '$EPOCHS')."

echo "== Reentrenamiento (raíz de datos: $ROOT)"
[ -d "$MODELS" ] || fail "No existe la carpeta de modelos $MODELS."
if [ ! -f "$OWN_INDEX" ] || [ "$(wc -l < "$OWN_INDEX")" -lt 2 ]; then
  fail "No hay grabaciones propias ($OWN_INDEX no existe o está vacío). Graba señas en la pantalla Grabar primero."
fi
echo "Tomas propias registradas: $(( $(wc -l < "$OWN_INDEX") - 1 ))"

ACTIVE="$(python -c 'from lsm.paths import active_model_name; print(active_model_name())')"
ACTIVE_PT="$MODELS/$ACTIVE.pt"
echo "Modelo activo: $ACTIVE"
if [ "$DRY" = 0 ] && [ "$FORCE" = 0 ] && [ -f "$ACTIVE_PT" ] && [ ! "$OWN_INDEX" -nt "$ACTIVE_PT" ]; then
  fail "No hay grabaciones nuevas desde que se entrenó $ACTIVE. Graba más tomas o usa --force."
fi

echo
echo "== 1/4 Armando el dataset (build_dataset.py)"
python "$REPO/training/build_dataset.py"

if [ "$DRY" = 1 ]; then
  echo
  echo "Revisión terminada (--dry-run): no se entrenó nada. Revisa arriba los conteos por glosa propia (train/val)."
  exit 0
fi

N=0
for f in "$MODELS"/classifier_v*.pt; do
  [ -e "$f" ] || continue
  v="$(basename "$f" .pt)"; v="${v#classifier_v}"
  if [[ "$v" =~ ^[0-9]+$ ]] && [ "$v" -gt "$N" ]; then N="$v"; fi
done
NEW="classifier_v$((N + 1))"

echo
echo "== 2/4 Entrenando $NEW ($EPOCHS épocas)"
T0=$SECONDS
python "$REPO/training/train.py" --out "$NEW" --epochs "$EPOCHS"
echo "Entrenamiento: $(( SECONDS - T0 )) s en total."
[ -f "$MODELS/$NEW.pt" ] || fail "El entrenamiento no produjo $MODELS/$NEW.pt."

echo
echo "== 3/4 Comparación: $ACTIVE (activo) contra $NEW (nuevo)"
python "$REPO/training/compare_models.py" "$ACTIVE" "$NEW"

echo
echo "== 4/4 Referencias de Práctica (build_references.py)"
if [ -f "$MODELS/references.json" ]; then
  BACKUP="$MODELS/references_$(date +%Y%m%d-%H%M%S).json"
  cp "$MODELS/references.json" "$BACKUP"
  echo "Respaldo: $BACKUP"
fi
python "$REPO/training/build_references.py"

echo
if [ "$ACTIVATE" = 1 ]; then
  printf '%s\n' "$NEW" > "$MODELS/ACTIVE_MODEL"
  echo "Listo: $NEW quedó activo (models/ACTIVE_MODEL). Reinicia el servidor para usarlo."
else
  echo "Listo: $NEW entrenado pero NO activado (sigue $ACTIVE)."
  echo "Para activarlo:  printf '$NEW\\n' > \"$MODELS/ACTIVE_MODEL\"   y reinicia el servidor."
fi
