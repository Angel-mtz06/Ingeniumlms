# D:/Ingenium/training/build_dataset.py
"""Índices crudos → NormSequence en caché + manifest.csv + vocab.csv."""
import csv
import json
from collections import Counter

import numpy as np

from lsm.anchor import AnchorError
from lsm.normalize import normalize
from lsm.paths import DATASETS, PROCESSED, RAW_LANDMARKS
from lsm.schema import RawSequence
from lsm.splits import split_of
from lsm.vocab import build_vocab, lookup, write_vocab_csv
from lsm.windows import NONE_GLOSS, windows

MIN_HAND_RATIO = 0.3
TRAIN_DATASETS = ("glosses", "own")


def main():
    anchors_path = PROCESSED / "mendeley_anchors.json"
    if "mendeley" in TRAIN_DATASETS and not anchors_path.exists():
        raise SystemExit("Falta mendeley_anchors.json: ejecuta training/mendeley_anchors.py")
    signer_anchors = json.load(open(anchors_path, encoding="utf-8"))["signers"] if anchors_path.exists() else {}

    norm_dir = PROCESSED / "norm"
    norm_dir.mkdir(parents=True, exist_ok=True)
    rows, skipped = [], Counter()
    glosses_names = set()
    indexes = [RAW_LANDMARKS / "index_mendeley.csv", RAW_LANDMARKS / "index_glosses.csv",
               DATASETS / "own" / "index_own.csv"]
    for idx in indexes:
        if not idx.exists():
            continue
        for r in csv.DictReader(open(idx, encoding="utf-8")):
            if r["dataset"] == "glosses":
                glosses_names.add(r["source_label"])
            if r["dataset"] not in TRAIN_DATASETS:
                skipped["dataset_excluido"] += 1
                continue
            gloss = lookup(r["dataset"], r["source_label"])
            is_none = r["dataset"] == "own" and gloss == NONE_GLOSS
            if float(r["hand_ratio"]) < MIN_HAND_RATIO and not is_none:  # NINGUNA: se filtra por ventana
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
            parts = windows(n, min_hand_ratio=MIN_HAND_RATIO) if is_none else [n]
            if not parts:
                skipped["pocas_manos"] += 1
                continue
            for part in parts:
                dst = norm_dir / f"{part.sample_id}.npz"
                part.save(dst)
                rows.append({"sample_id": part.sample_id, "gloss": gloss, "signer": r["signer"],
                             "dataset": r["dataset"], "norm_path": str(dst),
                             "split": split_of(r["signer"], r["dataset"], part.sample_id, gloss)})
    with open(PROCESSED / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    manifest_glosses = {r["gloss"] for r in rows}
    vocab_rows = [row for row in build_vocab(sorted(glosses_names)) if row["gloss"] in manifest_glosses]
    known = {row["gloss"] for row in vocab_rows}
    for g in sorted(manifest_glosses - known):
        vocab_rows.append({"gloss": g, "category": "propias", "sources": "own"})
    write_vocab_csv(vocab_rows, PROCESSED / "vocab.csv")
    print("muestras:", len(rows), "omitidas:", dict(skipped))
    print("por split:", Counter(r["split"] for r in rows))
    print("glosas:", len(manifest_glosses))
    own = Counter((r["gloss"], r["split"]) for r in rows if r["dataset"] == "own")
    if own:
        print("grabaciones propias por glosa (train/val; NINGUNA en ventanas):")
        for g in sorted({g for g, _ in own}):
            print(f"  {g}: {own[g, 'train']}/{own[g, 'val']}")
            if not own[g, "train"]:
                print(f"  AVISO: {g} no tiene tomas de entrenamiento (graba al menos 5 tomas: la 000, 005… van a val)")
    else:
        print("grabaciones propias: ninguna")


if __name__ == "__main__":
    main()
