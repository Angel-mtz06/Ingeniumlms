"""Detecta inicio/fin de señas y pausas de oración en el flujo en vivo."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from lsm.features import REST_Y


@dataclass
class SegEvent:
    kind: str  # "end" | "pause"
    start: int = -1
    end: int = -1


class Segmenter:
    def __init__(self, rest_y: float = REST_Y, still_speed: float = 0.04, rest_frames: int = 6,
                 still_frames: int = 12, pause_frames: int = 45, min_len: int = 6, max_len: int = 75):
        self.rest_y, self.still_speed = rest_y, still_speed
        self.rest_frames, self.still_frames, self.pause_frames = rest_frames, still_frames, pause_frames
        self.min_len, self.max_len = min_len, max_len
        self.state = "idle"
        self.start = self.last_active = -1
        self.rest_count = self.still_count = self.idle_count = 0
        self.pending = 0
        self.need_motion = False
        self.prev_w: np.ndarray | None = None
        self.prev_p: np.ndarray | None = None

    def _speed(self, hands: np.ndarray, present: np.ndarray) -> float:
        w = hands[:, 0, :2]
        sp = 0.0
        if self.prev_w is not None:
            for s in (0, 1):
                if present[s] and self.prev_p[s]:
                    sp = max(sp, float(np.linalg.norm(w[s] - self.prev_w[s])))
        self.prev_w, self.prev_p = w.copy(), present.copy()
        return sp

    def _close(self, end: int, by_stillness: bool) -> list[SegEvent]:
        start = self.start
        self.state = "idle"
        self.idle_count = 0
        self.need_motion = by_stillness
        if end - start + 1 < self.min_len:
            return []
        self.pending += 1
        return [SegEvent("end", start, end)]

    def update(self, idx: int, hands: np.ndarray, present: np.ndarray) -> list[SegEvent]:
        active = bool((present & (hands[:, 0, 1] < self.rest_y)).any())
        speed = self._speed(hands, present)
        if self.state == "idle":
            if active and (not self.need_motion or speed >= 2 * self.still_speed):
                self.state, self.start, self.last_active = "active", idx, idx
                self.rest_count = self.still_count = 0
                self.need_motion = False
                return []
            if not active:
                self.need_motion = False
                self.idle_count += 1
                if self.idle_count == self.pause_frames and self.pending:
                    self.pending = 0
                    return [SegEvent("pause")]
            return []
        if active:
            self.last_active = idx
            self.rest_count = 0
            self.still_count = self.still_count + 1 if speed < self.still_speed else 0
        else:
            self.rest_count += 1
        length = idx - self.start + 1
        if self.rest_count >= self.rest_frames:
            return self._close(self.last_active, by_stillness=False)
        if self.still_count >= self.still_frames and length >= self.min_len + self.still_frames:
            return self._close(idx, by_stillness=True)
        if length >= self.max_len:
            return self._close(idx, by_stillness=False)
        return []
