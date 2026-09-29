"""Compara dos clasificadores por sus reportes JSON y por su exactitud en las grabaciones propias de val.
Uso: python compare_models.py <modelo_activo> <modelo_nuevo>   (nombres sin .pt, en models/)"""
from __future__ import annotations

import csv
import json
import sys

from lsm.paths import MODELS, PROCESSED

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


def own_val_acc_of(model_name: str) -> float | None:
    """Exactitud top-1 del modelo en las muestras propias de val del manifest actual (None si no hay)."""
    rows = [r for r in csv.DictReader(open(PROCESSED / "manifest.csv", encoding="utf-8"))
            if r["dataset"] == "own" and r["split"] == "val"]
    path = MODELS / f"{model_name}.pt"
    if not rows or not path.exists():
        return None
    from lsm.classifier.infer import Classifier
    from lsm.normalize import NormSequence
    clf = Classifier.load(path)
    hits = [clf.predict(NormSequence.load(r["norm_path"]), k=1)[0][0] == r["gloss"] for r in rows]
    return sum(hits) / len(hits)


def _report(name: str) -> dict:
    p = MODELS / f"{name}_report.json"
    return json.load(open(p, encoding="utf-8")) if p.exists() else {}


def main(old: str, new: str) -> None:
    ro, rn = _report(old), _report(new)
    # El modelo activo se mide con las grabaciones propias de hoy (su reporte puede ser anterior a ellas)
    ro = dict(ro, own_val_acc=own_val_acc_of(old))
    rows = comparison(ro, rn)
    w = max(len(r[0]) for r in rows)
    print(f"{'métrica':<{w}}  {old:>14}  {new:>14}")
    for label, a, b in rows:
        print(f"{label:<{w}}  {a:>14}  {b:>14}")
    print("Nota: val/test del modelo activo vienen de su propio reporte; la fila de grabaciones propias se")
    print("midió ahora con las mismas muestras para los dos.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
