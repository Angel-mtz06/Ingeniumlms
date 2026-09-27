"""Mediana de (distancia entre orejas de la pose) / (ancho del bloque de la cara) en Mendeley."""
import csv

import numpy as np

from lsm.paths import RAW_LANDMARKS
from lsm.schema import RawSequence

ratios = []
for r in csv.DictReader(open(RAW_LANDMARKS / "index_mendeley.csv", encoding="utf-8")):
    raw = RawSequence.load(r["path"])
    bw = raw.face_box[0, 2] - raw.face_box[0, 0]
    if np.isnan(bw) or bw <= 0:
        continue
    for t in range(raw.T):
        p = raw.pose[t]
        if not np.isnan(p[0, 0]) and min(p[7, 3], p[8, 3]) > 0.5:
            ratios.append(np.linalg.norm(p[7, :2] - p[8, :2]) / bw)
print("n =", len(ratios), "mediana =", round(float(np.median(ratios)), 3),
      "p25/p75 =", np.round(np.percentile(ratios, [25, 75]), 3))
