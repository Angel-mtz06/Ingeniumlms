"""Cuadros que llegan del navegador → RawSequence y normalización incremental."""
from __future__ import annotations

from collections import deque

import numpy as np

from lsm.anchor import frame_anchor
from lsm.body import Body, body_from_raw, hand_over_face, near_face
from lsm.normalize import assign_slots, to_head_units
from lsm.schema import N_FACE, RawSequence


def _fill(raw: RawSequence, t: int, frame: dict) -> None:
    for k, h in enumerate((frame.get("hands") or [])[:2]):
        raw.hands[t, k] = np.asarray(h, np.float32).reshape(21, 3)
    if frame.get("pose"):
        raw.pose[t] = np.asarray(frame["pose"], np.float32).reshape(33, 4)
    if frame.get("face"):
        raw.face[t] = np.asarray(frame["face"], np.float32).reshape(N_FACE, 3)


def frame_to_raw(frame: dict) -> RawSequence:
    raw = RawSequence.empty(1, int(frame["w"]), int(frame["h"]), fps=30.0)
    _fill(raw, 0, frame)
    return raw


def frames_to_raw(frames: list[dict], **meta) -> RawSequence:
    raw = RawSequence.empty(len(frames), int(frames[0]["w"]), int(frames[0]["h"]), fps=30.0, **meta)
    for t, f in enumerate(frames):
        _fill(raw, t, f)
    return raw


# Cuadros que se conserva una mano perdida frente a la cara (el detector la pierde al taparla o pasar por encima).
HOLD_NEAR_FACE = 3


class LiveNormalizer:
    """Normaliza cuadro por cuadro con la mediana de las últimas anclas de cabeza.

    - Con una mano encima de la cara la malla facial sale deformada: ese cuadro no aporta ancla ni cuerpo.
    - `body`: cara, cuello y torso de la persona (unidades de cabeza) del último cuadro confiable.
    - Una mano que desaparece frente a la cara se conserva hasta HOLD_NEAR_FACE cuadros.
    """

    def __init__(self, window: int = 30):
        self.anchors: deque = deque(maxlen=window)
        self.last_wrist: list[np.ndarray | None] = [None, None]
        self.body: Body | None = None
        self.last_hand: list[np.ndarray | None] = [None, None]
        self.held = [0, 0]
        self.occluded = False  # el último cuadro tenía una mano encima de la cara

    def push(self, raw1: RawSequence) -> tuple[np.ndarray, np.ndarray]:
        hands = np.zeros((2, 21, 3), np.float32)
        present = np.zeros(2, bool)
        self.occluded = hand_over_face(raw1, 0)
        a = frame_anchor(raw1, 0)
        if a is not None and (not self.occluded or not self.anchors):
            self.anchors.append(a)
        if not self.anchors:
            return hands, present
        cx, cy, s = np.median(np.array(self.anchors), axis=0)
        if not self.occluded:
            self.body = body_from_raw(raw1, 0, (cx, cy, s)) or self.body
        dets = [to_head_units(h, cx, cy, s) for h in raw1.hands[0] if not np.isnan(h[0, 0])][:2]
        for d, k in zip(dets, assign_slots(dets, self.last_wrist)):
            hands[k] = d
            present[k] = True
            self.last_wrist[k] = d[0]
        for k in (0, 1):
            if present[k]:
                self.last_hand[k], self.held[k] = hands[k].copy(), 0
            elif (self.last_hand[k] is not None and self.held[k] < HOLD_NEAR_FACE
                  and near_face(self.body, self.last_hand[k])):
                hands[k], present[k] = self.last_hand[k], True
                self.held[k] += 1
            else:
                self.last_hand[k], self.held[k] = None, 0
        return hands, present
