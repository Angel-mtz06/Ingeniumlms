"""manifest.csv → models/references.json (todas las personas de cada glosa).
Uso: python build_references.py [--out RUTA]   (tools/retrain.sh escribe references_<modelo>.json)"""
import argparse
import csv
from pathlib import Path
from collections import defaultdict

from lsm.evaluator.references import build_reference, save_references
from lsm.normalize import NormSequence
from lsm.paths import MODELS, PROCESSED
from lsm.windows import NONE_GLOSS


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=None, help="por defecto models/references.json")
    out = ap.parse_args(argv).out or MODELS / "references.json"
    groups = defaultdict(list)
    for r in csv.DictReader(open(PROCESSED / "manifest.csv", encoding="utf-8")):
        if r["gloss"] != NONE_GLOSS:  # NINGUNA no es una seña: no tiene plantilla para practicar
            groups[r["gloss"]].append(NormSequence.load(r["norm_path"]))
    refs = {g: build_reference(g, norms) for g, norms in sorted(groups.items()) if len(norms) >= 3}
    out.parent.mkdir(parents=True, exist_ok=True)
    save_references(refs, out)
    print("referencias:", len(refs), "de", len(groups), "glosas")


if __name__ == "__main__":
    main()
