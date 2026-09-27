"""manifest.csv → models/references.json (todas las personas de cada glosa)."""
import csv
from collections import defaultdict

from lsm.evaluator.references import build_reference, save_references
from lsm.normalize import NormSequence
from lsm.paths import MODELS, PROCESSED


def main():
    groups = defaultdict(list)
    for r in csv.DictReader(open(PROCESSED / "manifest.csv", encoding="utf-8")):
        groups[r["gloss"]].append(NormSequence.load(r["norm_path"]))
    refs = {g: build_reference(g, norms) for g, norms in sorted(groups.items()) if len(norms) >= 3}
    MODELS.mkdir(parents=True, exist_ok=True)
    save_references(refs, MODELS / "references.json")
    print("referencias:", len(refs), "de", len(groups), "glosas")


if __name__ == "__main__":
    main()
