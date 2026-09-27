# D:/Ingenium/training/build_dataset.py
"""Índices crudos → NormSequence en caché + manifest.csv + vocab.csv."""
import csv
import json
from collections import Counter

import numpy as np

from lsm.anchor import AnchorError
from lsm.normalize import normalize
from lsm.paths import PROCESSED, RAW_LANDMARKS
from lsm.schema import RawSequence
from lsm.splits import split_of
from lsm.vocab import build_vocab, lookup, write_vocab_csv

MIN_HAND_RATIO = 0.3


def main():
    anchors_path = PROCESSED / "mendeley_anchors.json"
    if not anchors_path.exists():
        raise SystemExit("Falta mendeley_anchors.json: ejecuta training/mendeley_anchors.py")
    signer_anchors = json.load(open(anchors_path, encoding="utf-8"))["signers"]

    norm_dir = PROCESSED / "norm"
    norm_dir.mkdir(parents=True, exist_ok=True)
    rows, skipped = [], Counter()
    glosses_names = set()
    for idx in ("index_mendeley.csv", "index_glosses.csv"):
        for r in csv.DictReader(open(RAW_LANDMARKS / idx, encoding="utf-8")):
            if r["dataset"] == "glosses":
                glosses_names.add(r["source_label"])
            if float(r["hand_ratio"]) < MIN_HAND_RATIO:
                skipped["pocas_manos"] += 1
                continue
            anchor = None
            if r["dataset"] == "mendeley":
                if r["signer"] not in signer_anchors:
                    skipped["sin_ancla_persona"] += 1
                    continue
                anchor = np.array(signer_anchors[r["signer"]], np.float32)
            try:
                n = normalize(RawSequence.load(r["path"]), anchor=anchor)
            except AnchorError:
                skipped["sin_cabeza"] += 1
                continue
            dst = norm_dir / f"{r['sample_id']}.npz"
            n.save(dst)
            rows.append({"sample_id": r["sample_id"], "gloss": lookup(r["dataset"], r["source_label"]),
                         "signer": r["signer"], "dataset": r["dataset"], "norm_path": str(dst),
                         "split": split_of(r["signer"])})
    with open(PROCESSED / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    write_vocab_csv(build_vocab(sorted(glosses_names)), PROCESSED / "vocab.csv")
    print("muestras:", len(rows), "omitidas:", dict(skipped))
    print("por split:", Counter(r["split"] for r in rows))
    print("glosas:", len({r["gloss"] for r in rows}))


if __name__ == "__main__":
    main()
