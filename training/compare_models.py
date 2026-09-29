"""Compara dos clasificadores por sus reportes JSON y por su exactitud en las grabaciones propias de val.
Uso: python compare_models.py <modelo_activo> <modelo_nuevo> [--new-dir CARPETA]
  (nombres sin .pt; el activo está en models/, el nuevo en --new-dir o en models/).
Sale con 3 si el nuevo es PEOR: val_acc o test_acc más de 2 puntos por debajo del activo."""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

from lsm.paths import MODELS, PROCESSED

WORSE_EXIT = 3
TOLERANCE = 0.02  # 2 puntos porcentuales
METRICS = (("val_acc", "exactitud val (personas no vistas)"), ("test_acc", "exactitud test"),
           ("test_top3", "top-3 test"), ("test_macro_f1", "macro-F1 test"),
           ("own_val_acc", "exactitud en grabaciones propias (val)"), ("n_classes", "clases"),
           ("n_own_train", "muestras propias en train"))


def _fmt(v) -> str:
    if v is None:
        return "—"
    return f"{v:.3f}" if isinstance(v, float) else str(v)


def comparison(old: dict, new: dict) -> list[tuple[str, str, str]]:
    """(métrica, activo, nuevo) con "—" donde el reporte no tiene el dato."""
    return [(label, _fmt(old.get(k)), _fmt(new.get(k))) for k, label in METRICS]


def is_worse(old: dict, new: dict, tol: float = TOLERANCE) -> bool:
    """True si val_acc o test_acc del nuevo cae más de `tol` frente al activo (solo si ambos tienen el dato)."""
    for k in ("val_acc", "test_acc"):
        a, b = old.get(k), new.get(k)
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and b < a - tol - 1e-9:
            return True
    return False


def own_val_acc_of(model_path: Path) -> float | None:
    """Exactitud top-1 del modelo en las muestras propias de val del manifest actual (None si no hay)."""
    manifest = PROCESSED / "manifest.csv"
    if not manifest.exists() or not model_path.exists():
        return None
    rows = [r for r in csv.DictReader(open(manifest, encoding="utf-8"))
            if r["dataset"] == "own" and r["split"] == "val"]
    if not rows:
        return None
    from lsm.classifier.infer import Classifier
    from lsm.normalize import NormSequence
    clf = Classifier.load(model_path)
    hits = [clf.predict(NormSequence.load(r["norm_path"]), k=1)[0][0] == r["gloss"] for r in rows]
    return sum(hits) / len(hits)


def _report(d: Path, name: str) -> dict:
    p = d / f"{name}_report.json"
    return json.load(open(p, encoding="utf-8")) if p.exists() else {}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("old")
    ap.add_argument("new")
    ap.add_argument("--new-dir", type=Path, default=None)
    a = ap.parse_args(argv)
    new_dir = a.new_dir or MODELS
    ro, rn = _report(MODELS, a.old), _report(new_dir, a.new)
    # El modelo activo se mide con las grabaciones propias de hoy (su reporte puede ser anterior a ellas)
    ro = dict(ro, own_val_acc=own_val_acc_of(MODELS / f"{a.old}.pt"))
    rows = comparison(ro, rn)
    w = max(len(r[0]) for r in rows)
    print(f"{'métrica':<{w}}  {a.old:>14}  {a.new:>14}")
    for label, x, y in rows:
        print(f"{label:<{w}}  {x:>14}  {y:>14}")
    print("Nota: val/test del modelo activo vienen de su propio reporte; la fila de grabaciones propias se")
    print("midió ahora con las mismas muestras para los dos.")
    if is_worse(ro, rn):
        print(f"PEOR: {a.new} pierde más de {TOLERANCE * 100:.0f} puntos de exactitud (val o test) frente a {a.old}.")
        return WORSE_EXIT
    print(f"OK: {a.new} no empeora más de {TOLERANCE * 100:.0f} puntos frente a {a.old}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
