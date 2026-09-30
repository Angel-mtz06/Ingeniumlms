"""Compara un ensamble de semillas contra un solo modelo en val y test (personas no vistas) y, si se pide, lo guarda.

Uso:
  python training/ensemble_eval.py --members logs/model_v2/augnone_s0.pt logs/model_v2/augnone_s1.pt \
      logs/model_v2/augnone_s2.pt --single logs/model_v2/augnone_s1.pt \
      --manifest datasets/processed_classifier_v2/manifest.csv [--save models/classifier_v2e.pt]
Las rutas relativas son respecto a LSM_ROOT. Métricas sobre señas: exactitud (top-1) y top-3; sobre NINGUNA:
falsos positivos con la regla de la sesión (una NINGUNA que no queda como top-1 con p ≥ 0.5 se colaría como seña)
y señas perdidas como NINGUNA. Solo lee los datos; --save escribe un archivo nuevo (se niega a sobrescribir).
"""
import argparse
import csv
import json
import time
from pathlib import Path

import numpy as np
import torch

from lsm.classifier.infer import Classifier, EnsembleClassifier, save_ensemble
from lsm.normalize import NormSequence
from lsm.paths import ROOT
from lsm.windows import NONE_GLOSS

NONE_MIN = 0.5  # igual que lsm.session.NONE_MIN


def resolve(p: str) -> Path:
    q = Path(p)
    return q if q.is_absolute() else ROOT / q


def metrics(P: np.ndarray, y: np.ndarray, none: int) -> dict:
    sign = y != none
    top = np.argsort(-P, 1)
    none_ok = (top[:, 0] == none) & (P[:, none] >= NONE_MIN)
    return {"acc": float((top[sign, 0] == y[sign]).mean()),
            "top3": float((top[sign, :3] == y[sign, None]).any(1).mean()),
            "none_fp": float(1 - none_ok[~sign].mean()) if (~sign).any() else None,
            "lost_as_none": float(none_ok[sign].mean()),
            "n": int(sign.sum()), "n_none": int((~sign).sum())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--members", nargs="+", required=True)
    ap.add_argument("--single", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--save")
    a = ap.parse_args()
    torch.set_num_threads(4)
    members = [Classifier.load(resolve(p)) for p in a.members]
    ens = EnsembleClassifier(members)
    single = Classifier.load(resolve(a.single))
    if single.labels != ens.labels:
        raise SystemExit("el modelo solo y el ensamble no tienen las mismas etiquetas en el mismo orden")
    li = {g: i for i, g in enumerate(ens.labels)}
    rows = list(csv.DictReader(open(resolve(a.manifest), encoding="utf-8")))
    out = {"labels_identical": True, "n_labels": len(ens.labels)}
    for split in ("val", "test"):
        sel = [r for r in rows if r["split"] == split and r["gloss"] in li]
        seqs = [NormSequence.load(r["norm_path"]) for r in sel]
        y = np.array([li[r["gloss"]] for r in sel])
        per = np.stack([np.stack([m.probs(s) for s in seqs]) for m in members])
        ps = np.stack([single.probs(s) for s in seqs])
        out[split] = {"signers": sorted({r["signer"] for r in sel}), "single": metrics(ps, y, li[NONE_GLOSS]),
                      "ensemble": metrics(per.mean(0), y, li[NONE_GLOSS]),
                      "members": {Path(p).stem: metrics(per[i], y, li[NONE_GLOSS]) for i, p in enumerate(a.members)}}
    seq = NormSequence.load([r for r in rows if r["split"] == "test"][0]["norm_path"])
    for name, clf in (("single", single), ("ensemble", ens)):
        clf.predict(seq)
        t = time.perf_counter()
        for _ in range(20):
            clf.predict(seq)
        out[f"ms_per_sign_{name}"] = round((time.perf_counter() - t) / 20 * 1000, 1)
    print(json.dumps(out, indent=1))
    if a.save:
        dst = resolve(a.save)
        if dst.exists():
            raise SystemExit(f"{dst} ya existe: no se sobrescribe")
        save_ensemble([resolve(p) for p in a.members], dst, single=Path(a.single).stem, eval=out)
        print("guardado:", dst)


if __name__ == "__main__":
    main()
