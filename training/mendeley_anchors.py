# D:/Ingenium/training/mendeley_anchors.py
"""Referencia de cabeza constante por persona para Mendeley (caras pixeladas).
Centro = mediana de bloques de cara plausibles; escala = mediana del tamaño de mano / HAND_TO_HEAD,
con HAND_TO_HEAD calibrado en LSM Glosses (caras reales: tamaño de mano / distancia entre orejas)."""
from __future__ import annotations

import csv
import json
from collections import defaultdict

import numpy as np

from lsm.paths import PROCESSED, RAW_LANDMARKS
from lsm.schema import RawSequence

BOX_W = (20.0, 90.0)
BOX_ASPECT = (0.6, 1.6)
BOX_CX = (200.0, 440.0)
BOX_CY_MAX = 240.0
MIN_VIS = 0.5


def hand_scale(h: np.ndarray) -> float:
    return float(np.linalg.norm(h[9, :2] - h[0, :2]))


def plausible_box(b: np.ndarray) -> bool:
    if np.isnan(b).any():
        return False
    w, h = b[2] - b[0], b[3] - b[1]
    cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    return (BOX_W[0] <= w <= BOX_W[1] and h > 0 and BOX_ASPECT[0] <= w / h <= BOX_ASPECT[1]
            and BOX_CX[0] <= cx <= BOX_CX[1] and cy <= BOX_CY_MAX)


def hand_to_head_ratio(raws: list[RawSequence]) -> float:
    ratios = []
    for raw in raws:
        for t in range(raw.T):
            p = raw.pose[t]
            if np.isnan(p[0, 0]) or min(p[7, 3], p[8, 3]) <= MIN_VIS:
                continue
            ear = float(np.linalg.norm(p[7, :2] - p[8, :2]))
            if ear <= 1e-3:
                continue
            ratios += [hand_scale(h) / ear for h in raw.hands[t] if not np.isnan(h[0, 0])]
    return float(np.median(ratios))


def signer_anchor(raws: list[RawSequence], ratio: float) -> tuple[float, float, float] | None:
    boxes = [raw.face_box[0] for raw in raws if plausible_box(raw.face_box[0])]
    scales = [hand_scale(h) for raw in raws for t in range(raw.T) for h in raw.hands[t] if not np.isnan(h[0, 0])]
    if not boxes or not scales:
        return None
    b = np.median(np.stack(boxes), axis=0)
    return float((b[0] + b[2]) / 2), float((b[1] + b[3]) / 2), float(np.median(scales) / ratio)


def main():
    glosses = [RawSequence.load(p) for p in sorted((RAW_LANDMARKS / "glosses").glob("*.npz"))]
    ratio = hand_to_head_ratio(glosses)
    by = defaultdict(list)
    for r in csv.DictReader(open(RAW_LANDMARKS / "index_mendeley.csv", encoding="utf-8")):
        by[r["signer"]].append(RawSequence.load(r["path"]))
    signers = {}
    for s, raws in sorted(by.items()):
        a = signer_anchor(raws, ratio)
        if a is not None:
            signers[s] = [round(v, 2) for v in a]
        print(s, len(raws), a and [round(v, 1) for v in a])
    PROCESSED.mkdir(parents=True, exist_ok=True)
    json.dump({"hand_to_head": round(ratio, 4), "signers": signers},
              open(PROCESSED / "mendeley_anchors.json", "w", encoding="utf-8"), indent=2)
    print("HAND_TO_HEAD =", round(ratio, 4), "desde", len(glosses), "videos; personas con referencia:", len(signers))


if __name__ == "__main__":
    main()
