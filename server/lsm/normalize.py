"""Landmarks en unidades de cabeza y asignación estable de manos a slots.
Slot 0 = lado izquierdo de la imagen (mano derecha del signante); slot 1 = lado derecho."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from lsm.anchor import head_anchor
from lsm.schema import RawSequence


@dataclass
class NormSequence:
    hands: np.ndarray    # (T,2,21,3) unidades de cabeza; ausente = 0
    present: np.ndarray  # (T,2) bool
    sample_id: str = ""
    signer: str = ""

    @property
    def T(self) -> int:
        return int(self.hands.shape[0])

    def save(self, path: str | Path) -> None:
        np.savez_compressed(path, hands=self.hands, present=self.present,
                            meta=np.array(json.dumps({"sample_id": self.sample_id, "signer": self.signer})))

    @staticmethod
    def load(path: str | Path) -> "NormSequence":
        with np.load(path) as z:
            return NormSequence(hands=z["hands"], present=z["present"], **json.loads(str(z["meta"])))


def normalize(raw: RawSequence) -> NormSequence:
    anchor = head_anchor(raw)
    T = raw.T
    hands = np.zeros((T, 2, 21, 3), np.float32)
    present = np.zeros((T, 2), bool)
    last_wrist: list[np.ndarray | None] = [None, None]
    for t in range(T):
        cx, cy, s = anchor[t]
        dets = []
        for h in raw.hands[t]:
            if np.isnan(h[0, 0]):
                continue
            n = h.astype(np.float32).copy()
            n[:, 0] = (n[:, 0] - cx) / s
            n[:, 1] = (n[:, 1] - cy) / s
            n[:, 2] = n[:, 2] / s
            dets.append(n)
        if len(dets) >= 2:
            dets = sorted(dets[:2], key=lambda d: d[0, 0])
            slots = [0, 1]
        elif len(dets) == 1:
            w = dets[0][0, :2]
            known = [(k, np.linalg.norm(w - last_wrist[k][:2])) for k in (0, 1) if last_wrist[k] is not None]
            slots = [min(known, key=lambda kv: kv[1])[0]] if known else [0 if w[0] < 0 else 1]
        else:
            slots = []
        for d, k in zip(dets, slots):
            hands[t, k] = d
            present[t, k] = True
            last_wrist[k] = d[0]
    return NormSequence(hands=hands, present=present, sample_id=raw.sample_id, signer=raw.signer)
