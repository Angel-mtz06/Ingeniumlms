"""Reproduce un RawSequence (.npz) en una Session para probar sin cámara ni guantes.
Uso: python replay.py <archivo.npz> [--mode translate|practice] [--target GLOSA]"""
import argparse
import asyncio

import numpy as np

from lsm.classifier.infer import Classifier
from lsm.evaluator.references import load_references
from lsm.paths import MODELS, active_model_name, active_references_path
from lsm.schema import RawSequence
from lsm.sentences import SentenceBuilder
from lsm.session import Session


def raw_to_frames(raw: RawSequence) -> list[dict]:
    frames = []
    for t in range(raw.T):
        hands = [h.tolist() for h in raw.hands[t] if not np.isnan(h[0, 0])]
        pose = None if np.isnan(raw.pose[t, 0, 0]) else np.nan_to_num(raw.pose[t]).tolist()
        face = None if np.isnan(raw.face[t, 0, 0]) else raw.face[t].tolist()
        frames.append({"type": "frame", "w": raw.width, "h": raw.height, "hands": hands, "pose": pose,
                       "face": face, "gloves": {}})
    return frames


async def run(path, mode, target, rest_frames=60):
    raw = RawSequence.load(path)
    name = active_model_name()
    clf_path, ref_path = MODELS / f"{name}.pt", active_references_path(name)
    s = Session(Classifier.load(clf_path) if clf_path.exists() else None,
                load_references(ref_path) if ref_path.exists() else {}, SentenceBuilder())
    frames = raw_to_frames(raw)
    rest = dict(frames[0], hands=[])  # manos fuera = reposo, para cerrar el segmento y la pausa
    for m in [{"type": "hello", "mode": mode, "target": target}] + frames + [rest] * rest_frames:
        for out in await s.handle(m):
            if out["type"] != "live":
                print(out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--mode", default="translate")
    ap.add_argument("--target", default=None)
    a = ap.parse_args()
    asyncio.run(run(a.path, a.mode, a.target))
