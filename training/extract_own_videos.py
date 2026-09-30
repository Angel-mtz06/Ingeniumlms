"""Videos propios (mp4 del celular) → RawSequence en datasets/own, igual que la pantalla Grabar.

Uso: python extract_own_videos.py CARPETA --gloss MAMA [--gap 90] [--signer-prefix mama]
Cada video es una toma de la seña. Los videos se agrupan en "personas" por tandas: un hueco mayor a --gap
segundos entre las marcas de tiempo del nombre (AAAAMMDD_HHMMSS.mp4) abre una persona nueva (mama1, mama2…).
Si todos los videos son de la misma persona, usa --single-signer.
Los videos verticales del celular traen una rotación en los metadatos: se aplica aquí."""
from __future__ import annotations

import argparse
import csv
import os
import re
from datetime import datetime
from multiprocessing import Pool
from pathlib import Path

import cv2
import numpy as np

from extract_common import Extractor
from lsm.paths import DATASETS
from lsm.schema import RawSequence
from lsm.vocab import canonical

MAX_SIDE = 1920  # lado mayor tras girar; la mano debe seguir siendo detectable
INDEX_FIELDS = ["sample_id", "dataset", "source_label", "signer", "path", "n_frames", "hand_ratio"]
ROT = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}
_STAMP = re.compile(r"(\d{8})_(\d{6})")


def stamp_of(p: Path) -> float:
    m = _STAMP.search(p.stem)
    return datetime.strptime("".join(m.groups()), "%Y%m%d%H%M%S").timestamp() if m else p.stat().st_mtime


def read_frames(path: Path):
    cap = cv2.VideoCapture(str(path))
    cap.set(cv2.CAP_PROP_ORIENTATION_AUTO, 0)  # el giro se aplica a mano, igual en todas las versiones
    rot = int(cap.get(cv2.CAP_PROP_ORIENTATION_META) or 0)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, round(fps / 30.0))
    frames, i = [], 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        if i % step == 0:
            if rot in ROT:
                fr = cv2.rotate(fr, ROT[rot])
            h, w = fr.shape[:2]
            k = MAX_SIDE / max(h, w)
            if k < 1:
                fr = cv2.resize(fr, (int(round(w * k)), int(round(h * k))), interpolation=cv2.INTER_AREA)
            frames.append(fr)
        i += 1
    cap.release()
    return frames, fps / step


def _work(job):
    path, sid, gloss, signer, out_dir = job
    frames, fps = read_frames(Path(path))
    if not frames:
        return None
    H, W = frames[0].shape[:2]
    raw = RawSequence.empty(len(frames), W, H, fps=fps, sample_id=sid, dataset="own", source_label=gloss, signer=signer)
    ex = Extractor(video=True)  # uno por video: el seguimiento no debe cruzar videos
    dt = int(round(1000 / fps))
    for t, bgr in enumerate(frames):
        ex.process(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), raw, t, dt_ms=dt)
    ex.close()
    dst = Path(out_dir) / "raw" / f"{sid}.npz"
    raw.save(dst)
    hand_ratio = float((~np.isnan(raw.hands[:, :, 0, 0])).any(axis=1).mean())
    return {"sample_id": sid, "dataset": "own", "source_label": gloss, "signer": signer, "path": str(dst),
            "n_frames": raw.T, "hand_ratio": round(hand_ratio, 3), "src": Path(path).name, "wh": f"{W}x{H}"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", type=Path)
    ap.add_argument("--gloss", required=True)
    ap.add_argument("--signer-prefix", default="p", help="prefijo de la persona (letras/dígitos/guion, sin _)")
    ap.add_argument("--gap", type=float, default=90.0, help="segundos de hueco que separan a una persona de otra")
    ap.add_argument("--single-signer", action="store_true", help="todos los videos son de la misma persona")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=min(6, max(1, (os.cpu_count() or 4) - 2)))
    ap.add_argument("--out", type=Path, default=DATASETS / "own")
    args = ap.parse_args()

    gloss = canonical(args.gloss)
    videos = sorted((p for p in args.folder.iterdir() if p.suffix.lower() in (".mp4", ".mov")), key=stamp_of)
    if args.limit:
        videos = videos[:args.limit]
    signer_of, n, last = {}, 0, None
    for p in videos:
        t = stamp_of(p)
        if last is None or (not args.single_signer and t - last > args.gap):
            n += 1
        signer_of[p], last = f"{args.signer_prefix}{n}", t
    (args.out / "raw").mkdir(parents=True, exist_ok=True)
    takes: dict[str, int] = {}
    jobs = []
    for p in videos:
        s = signer_of[p]
        k = takes.get(s, 0)
        takes[s] = k + 1
        jobs.append((str(p), f"{s}_{gloss}_{k:03d}", gloss, s, str(args.out)))
    print(f"{len(jobs)} videos, {n} persona(s):", {s: takes[s] for s in takes}, flush=True)
    rows = []
    with Pool(args.workers) as pool:
        for r in pool.imap_unordered(_work, jobs):
            if r:
                rows.append(r)
                print(r["sample_id"], r["src"], r["wh"], "cuadros", r["n_frames"], "manos", r["hand_ratio"], flush=True)
    rows.sort(key=lambda r: r["sample_id"])
    idx = args.out / "index_own.csv"
    old = [r for r in csv.DictReader(open(idx, encoding="utf-8"))] if idx.exists() else []
    new_ids = {r["sample_id"] for r in rows}
    merged = [r for r in old if r["sample_id"] not in new_ids] + [{k: r[k] for k in INDEX_FIELDS} for r in rows]
    with open(idx, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=INDEX_FIELDS)
        w.writeheader()
        w.writerows(merged)
    print("listo:", len(rows), "tomas; manos detectadas medio:", round(float(np.mean([r["hand_ratio"] for r in rows])), 3))


if __name__ == "__main__":
    main()
