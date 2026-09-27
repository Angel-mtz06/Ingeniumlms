"""Cuadros que llegan del navegador → RawSequence y normalización incremental."""
from __future__ import annotations

from collections import deque

import numpy as np

from lsm.anchor import frame_anchor
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


class LiveNormalizer:
    def __init__(self, window: int = 30):
        self.anchors: deque = deque(maxlen=window)
        self.last_wrist: list[np.ndarray | None] = [None, None]

    def push(self, raw1: RawSequence) -> tuple[np.ndarray, np.ndarray]:
        hands = np.zeros((2, 21, 3), np.float32)
        present = np.zeros(2, bool)
        a = frame_anchor(raw1, 0)
        if a is not None:
            self.anchors.append(a)
        if not self.anchors:
            return hands, present
        cx, cy, s = np.median(np.array(self.anchors), axis=0)
        dets = [to_head_units(h, cx, cy, s) for h in raw1.hands[0] if not np.isnan(h[0, 0])][:2]
        for d, k in zip(dets, assign_slots(dets, self.last_wrist)):
            hands[k] = d
            present[k] = True
            self.last_wrist[k] = d[0]
        return hands, present
