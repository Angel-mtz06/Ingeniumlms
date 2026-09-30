"""Reemplaza en un references_*.json la referencia de Práctica de una glosa con las tomas propias (datasets/own).

Uso: python add_own_reference.py --gloss MAMA --out models/references_classifier_v2.json
No reentrena el clasificador: Práctica solo usa la referencia (dedos, ubicación, orientación, movimiento).
Las tomas salen de la pantalla Grabar o de extract_own_videos.py. Se hace copia .bak la primera vez."""
from __future__ import annotations

import argparse
import csv
import json
import shutil
from pathlib import Path

from lsm.anchor import AnchorError
from lsm.evaluator.references import build_reference, load_references, save_references
from lsm.features import REST_Y
from lsm.normalize import NormSequence, mirror, normalize
from lsm.paths import DATASETS
from lsm.schema import RawSequence
from lsm.vocab import canonical

MIN_HAND_RATIO = 0.3  # mismo umbral que build_dataset.py


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gloss", required=True)
    ap.add_argument("--out", type=Path, required=True, help="references_*.json a actualizar")
    ap.add_argument("--min-hands", type=float, default=MIN_HAND_RATIO)
    ap.add_argument("--tolerance", default=None,
                    help='margen extra por parámetro, JSON: \'{"configuracion":1.2,"ubicacion":1.3,'
                         '"movimiento":2.5,"orientacion":1.6}\' (divide el z; 1 = sin margen). Útil cuando la '
                         "cámara en vivo (fps, resolución, luz) difiere de la de las tomas")
    ap.add_argument("--espejo", action="store_true",
                    help="las tomas están en espejo (cámara frontal del celular): se reflejan antes de usarlas")
    args = ap.parse_args()
    gloss = canonical(args.gloss)

    norms, signers = [], {}
    for r in csv.DictReader(open(DATASETS / "own" / "index_own.csv", encoding="utf-8")):
        if r["source_label"] != gloss:
            continue
        if float(r["hand_ratio"]) < args.min_hands:
            print("omitida (pocas manos):", r["sample_id"], r["hand_ratio"])
            continue
        try:
            n = normalize(RawSequence.load(r["path"]))
            if args.espejo:
                n = mirror(n)
        except AnchorError:
            print("omitida (sin cabeza):", r["sample_id"])
            continue
        # Una mano en reposo (muñeca bajo REST_Y, la misma altura con que el segmentador en vivo decide que
        # no se está señando) no es parte de la seña: si no, la referencia exigiría enseñar las dos manos.
        p = n.present & (n.hands[:, :, 0, 1] < REST_Y)
        h = n.hands.copy()
        h[~p] = 0
        norms.append(NormSequence(hands=h, present=p, sample_id=n.sample_id, signer=n.signer))
        signers[r["signer"]] = signers.get(r["signer"], 0) + 1
    if len(norms) < 3:
        raise SystemExit(f"Solo {len(norms)} tomas válidas de {gloss}: se necesitan al menos 3.")

    ref = build_reference(gloss, norms)
    if args.tolerance:
        ref.tolerance = {k: float(v) for k, v in json.loads(args.tolerance).items()}
    refs = load_references(args.out)
    bak = args.out.with_name(args.out.name + ".bak")
    if not bak.exists():
        shutil.copy2(args.out, bak)
    refs[gloss] = ref
    save_references(refs, args.out)
    print(f"{gloss}: referencia con {len(norms)} tomas de {len(signers)} personas {signers}; "
          f"manos usadas {ref.slots_used.tolist()}; margen {ref.tolerance}; ejemplo {ref.example_id}; {len(refs)} referencias")


if __name__ == "__main__":
    main()
