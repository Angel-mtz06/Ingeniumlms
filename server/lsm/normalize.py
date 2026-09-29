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


def mirror(norm: NormSequence) -> NormSequence:
    """Espejo horizontal: x → -x y se intercambian las manos (slot 0 ↔ 1). No modifica `norm`."""
    h = norm.hands.copy()
    h[..., 0] *= -1
    return NormSequence(hands=h[:, ::-1].copy(), present=norm.present[:, ::-1].copy(),
                        sample_id=norm.sample_id, signer=norm.signer)


def to_head_units(h: np.ndarray, cx: float, cy: float, s: float) -> np.ndarray:
    n = h.astype(np.float32).copy()
    n[:, 0] = (n[:, 0] - cx) / s
    n[:, 1] = (n[:, 1] - cy) / s
    n[:, 2] = n[:, 2] / s
    return n


def assign_slots(dets: list[np.ndarray], last_wrist: list[np.ndarray | None]) -> list[int]:
    """Slot de cada detección, en el mismo orden que `dets`."""
    if len(dets) >= 2:
        order = sorted(range(2), key=lambda i: dets[i][0, 0])
        slots = [0, 0]
        slots[order[0]], slots[order[1]] = 0, 1
        return slots
    if len(dets) == 1:
        w = dets[0][0, :2]
        known = [(k, np.linalg.norm(w - last_wrist[k][:2])) for k in (0, 1) if last_wrist[k] is not None]
        return [min(known, key=lambda kv: kv[1])[0]] if known else [0 if w[0] < 0 else 1]
    return []


def normalize(raw: RawSequence, anchor: np.ndarray | None = None) -> NormSequence:
    anchor = head_anchor(raw) if anchor is None else np.tile(np.asarray(anchor, np.float32).reshape(1, 3), (raw.T, 1))
    T = raw.T
    hands = np.zeros((T, 2, 21, 3), np.float32)
    present = np.zeros((T, 2), bool)
    last_wrist: list[np.ndarray | None] = [None, None]
    for t in range(T):
        cx, cy, s = anchor[t]
        dets = [to_head_units(h, cx, cy, s) for h in raw.hands[t] if not np.isnan(h[0, 0])][:2]
        for d, k in zip(dets, assign_slots(dets, last_wrist)):
            hands[t, k] = d
            present[t, k] = True
            last_wrist[k] = d[0]
    return NormSequence(hands=hands, present=present, sample_id=raw.sample_id, signer=raw.signer)
