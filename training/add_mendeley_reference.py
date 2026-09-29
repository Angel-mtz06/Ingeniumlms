"""Agrega a un references_*.json la referencia de Práctica de una glosa de Mendeley, sin reentrenar.

Uso: python add_mendeley_reference.py --gloss MAMA --out models/references_classifier_v2.json
Práctica solo usa la referencia (dedos, ubicación, movimiento); el clasificador no interviene en la nota.
Necesita datasets/raw_landmarks/index_mendeley.csv (extract_mendeley.py --words <id>) y al menos algunos
videos de LSM Glosses extraídos, para calibrar la proporción mano/cabeza de las caras pixeladas."""
from __future__ import annotations

import argparse
import csv
import shutil
from collections import defaultdict
from pathlib import Path

import numpy as np

from lsm.anchor import AnchorError
from lsm.evaluator.references import build_reference, load_references, save_references
from lsm.normalize import NormSequence, normalize
from lsm.paths import RAW_LANDMARKS
from lsm.schema import RawSequence
from lsm.vocab import lookup
from mendeley_anchors import hand_to_head_ratio, signer_anchor

MIN_HAND_RATIO = 0.3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gloss", required=True)
    ap.add_argument("--out", type=Path, required=True, help="references_*.json a actualizar (se hace copia .bak)")
    ap.add_argument("--no-mirror", action="store_true",
                    help="no reflejar las muestras (por defecto sí: las fotos de Mendeley están en espejo "
                         "respecto a la cámara en vivo; COMER y YO aparecen con la mano contraria a Glosses)")
    args = ap.parse_args()

    glosses = []
    for p in sorted((RAW_LANDMARKS / "glosses").glob("*.npz")):
        try:
            glosses.append(RawSequence.load(p))
        except Exception:  # archivo a medias por una extracción interrumpida
            continue
    ratio = hand_to_head_ratio(glosses)
    print(f"proporción mano/cabeza: {ratio:.4f} (desde {len(glosses)} videos de Glosses)")

    rows = [r for r in csv.DictReader(open(RAW_LANDMARKS / "index_mendeley.csv", encoding="utf-8"))
            if lookup("mendeley", r["source_label"]) == args.gloss]
    by = defaultdict(list)
    for r in rows:
        by[r["signer"]].append(RawSequence.load(r["path"]))
    anchors = {s: signer_anchor(raws, ratio) for s, raws in by.items()}

    norms = []
    for r in rows:
        anchor = anchors.get(r["signer"])
        if float(r["hand_ratio"]) < MIN_HAND_RATIO or anchor is None:
            print("omitida:", r["sample_id"], "hand_ratio", r["hand_ratio"], "ancla", anchor is not None)
            continue
        try:
            n = normalize(RawSequence.load(r["path"]), anchor=np.array(anchor, np.float32))
        except AnchorError:
            print("omitida (sin cabeza):", r["sample_id"])
            continue
        if not args.no_mirror:  # mismo espejo que lsm.augment: x → -x y se intercambian los slots
            h = n.hands.copy()
            h[..., 0] *= -1
            n = NormSequence(hands=h[:, ::-1].copy(), present=n.present[:, ::-1].copy(),
                             sample_id=n.sample_id, signer=n.signer)
        norms.append(n)
    if len(norms) < 3:
        raise SystemExit(f"Solo {len(norms)} muestras válidas de {args.gloss}: se necesitan al menos 3.")

    ref = build_reference(args.gloss, norms)
    refs = load_references(args.out)
    bak = args.out.with_name(args.out.name + ".bak")
    if not bak.exists():  # solo el original: repetir el script no pisa la copia buena
        shutil.copy2(args.out, bak)
    refs[args.gloss] = ref
    save_references(refs, args.out)
    print(f"{args.gloss}: referencia con {len(norms)} muestras, manos usadas {ref.slots_used.tolist()}; "
          f"{len(refs)} referencias en {args.out.name}")


if __name__ == "__main__":
    main()
