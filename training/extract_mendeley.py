"""Mendeley MSLwords1 → RawSequence por muestra. Lee los JPG directo del zip."""
from __future__ import annotations

import argparse
import csv
import os
import zipfile
from collections import defaultdict
from multiprocessing import Pool

import cv2
import numpy as np

from extract_common import Extractor, face_box_from_skin
from lsm.paths import DATASETS, RAW_LANDMARKS
from lsm.schema import RawSequence

ZIP = DATASETS / "mendeley" / "6rj76z6y3n-1.zip"
OUT = RAW_LANDMARKS / "mendeley"
_zip = None
_ex = None


def _init():
    global _zip, _ex
    _zip = zipfile.ZipFile(ZIP)
    _ex = Extractor(video=False, pose_model="pose_landmarker_heavy", use_face=False)


def _work(item):
    folder, names = item  # folder = "SSWWW"
    signer, word = folder[:2], folder[2:]
    sid = f"m{signer}_{word}"
    dst = OUT / f"{sid}.npz"
    frames = [cv2.imdecode(np.frombuffer(_zip.read(n), np.uint8), cv2.IMREAD_COLOR) for n in sorted(names)]
    H, W = frames[0].shape[:2]
    raw = RawSequence.empty(len(frames), W, H, fps=0.0, sample_id=sid, dataset="mendeley",
                            source_label=word, signer=f"m{signer}")
    for t, bgr in enumerate(frames):
        _ex.process(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), raw, t)
    boxes = [face_box_from_skin(frames[i]) for i in {0, len(frames) - 1}]
    boxes = [b for b in boxes if not np.isnan(b).any()]
    if boxes:
        raw.face_box[:] = np.median(np.stack(boxes), axis=0)
    raw.save(dst)
    hand_ratio = float((~np.isnan(raw.hands[:, :, 0, 0])).any(axis=1).mean())
    return {"sample_id": sid, "dataset": "mendeley", "source_label": word, "signer": f"m{signer}",
            "path": str(dst), "n_frames": raw.T, "hand_ratio": round(hand_ratio, 3)}


def merge_index(old: list[dict], new: list[dict]) -> list[dict]:
    """Índice combinado por sample_id: las filas nuevas reemplazan a las viejas y el resto se conserva
    (con --words no se pierden las demás palabras ya extraídas)."""
    merged = {r["sample_id"]: r for r in old}
    merged.update({r["sample_id"]: r for r in new})
    return [merged[k] for k in sorted(merged)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None,
                         help="Procesar solo las primeras N muestras (tras ordenar); por defecto, todas.")
    parser.add_argument("--words", type=int, nargs="+", default=None,
                        help="Solo estos ids de palabra de Mendeley (p. ej. 58 = MAMA); por defecto, todas.")
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    groups = defaultdict(list)
    with zipfile.ZipFile(ZIP) as z:
        for n in z.namelist():
            parts = n.split("/")
            if n.lower().endswith(".jpg") and len(parts) >= 4:
                if args.words is None or int(parts[-2][2:]) in args.words:
                    groups[parts[-2]].append(n)
    items = sorted(groups.items())
    if args.limit is not None:
        items = items[:args.limit]
    print("muestras:", len(items))
    rows = []
    with Pool(max(1, (os.cpu_count() or 4) - 2), initializer=_init) as pool:
        for i, row in enumerate(pool.imap_unordered(_work, items, chunksize=4)):
            rows.append(row)
            if i % 100 == 0:
                print(i, row["sample_id"], row["hand_ratio"], flush=True)
    index = RAW_LANDMARKS / "index_mendeley.csv"
    if args.words is not None and index.exists():  # extracción parcial: conservar las demás palabras
        rows = merge_index(list(csv.DictReader(open(index, encoding="utf-8"))), rows)
    rows.sort(key=lambda r: r["sample_id"])
    with open(index, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print("listo:", len(rows), "hand_ratio medio:", np.mean([float(r["hand_ratio"]) for r in rows]))


if __name__ == "__main__":
    main()
