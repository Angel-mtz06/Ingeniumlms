"""LSM Glosses (.7z) → videos → RawSequence por video (<=30 fps, 960 px de ancho)."""
from __future__ import annotations

import argparse
import csv
import os
from multiprocessing import Pool
from pathlib import Path

import cv2
import numpy as np
import py7zr

from extract_common import Extractor
from lsm.paths import DATASETS, RAW_LANDMARKS
from lsm.schema import RawSequence

ARCHIVE = DATASETS / "lsm_glosses" / "lsm_glosses.7z"
EXTRACTED = DATASETS / "lsm_glosses" / "extracted"
OUT = RAW_LANDMARKS / "glosses"
TARGET_W = 960
VIDEO_EXTS = (".mp4", ".mov")  # el archivo mezcla .mp4 y .MOV (21 de 1415)


def _work(path_str: str):
    path = Path(path_str)
    gloss, subj = path.stem.rsplit("_", 1)
    sid = f"g{int(subj):02d}_{gloss}"
    dst = OUT / f"{sid}.npz"
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, round(fps / 30.0))
    frames = []
    i = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        if i % step == 0:
            h, w = fr.shape[:2]
            frames.append(cv2.resize(fr, (TARGET_W, int(round(h * TARGET_W / w)))))
        i += 1
    cap.release()
    if not frames:
        return None
    H, W = frames[0].shape[:2]
    raw = RawSequence.empty(len(frames), W, H, fps=fps / step, sample_id=sid, dataset="glosses",
                            source_label=gloss, signer=f"g{int(subj):02d}")
    ex = Extractor(video=True)  # uno por video: el seguimiento no debe cruzar videos
    dt = int(round(1000 * step / fps))
    for t, bgr in enumerate(frames):
        ex.process(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), raw, t, dt_ms=dt)
    ex.close()
    raw.save(dst)
    hand_ratio = float((~np.isnan(raw.hands[:, :, 0, 0])).any(axis=1).mean())
    return {"sample_id": sid, "dataset": "glosses", "source_label": gloss, "signer": raw.signer,
            "path": str(dst), "n_frames": raw.T, "hand_ratio": round(hand_ratio, 3)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None,
                         help="Procesar solo los primeros N videos (tras ordenar); por defecto, todos.")
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 2),
                         help="Procesos en paralelo (por defecto cpu_count()-2).")
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    if not EXTRACTED.exists():
        print("descomprimiendo", ARCHIVE)
        with py7zr.SevenZipFile(ARCHIVE) as z:
            z.extractall(EXTRACTED)
    videos = sorted(str(p) for p in EXTRACTED.rglob("*") if p.suffix.lower() in VIDEO_EXTS)
    if args.limit is not None:
        videos = videos[:args.limit]
    print("videos:", len(videos))
    rows = []
    with Pool(args.workers) as pool:
        for i, row in enumerate(pool.imap_unordered(_work, videos, chunksize=2)):
            if row:
                rows.append(row)
            if i % 50 == 0:
                print(i, row and row["sample_id"], flush=True)
    rows.sort(key=lambda r: r["sample_id"])
    with open(RAW_LANDMARKS / "index_glosses.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print("listo:", len(rows), "hand_ratio medio:", np.mean([r["hand_ratio"] for r in rows]))


if __name__ == "__main__":
    main()
