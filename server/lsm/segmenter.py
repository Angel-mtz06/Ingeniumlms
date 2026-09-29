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
    reason: str = ""  # solo "end": "reposo" | "quietud" | "max_len"


POST_STILL_MIN = 15  # un segmento que sigue a un cierre por quietud necesita ≥15 cuadros…
POST_STILL_DROP = 1.0  # …y no bajar en neto más de 1 ancho de cabeza (si no, es solo bajar la mano)


DESCENT_DY = 0.05  # anchos de cabeza por cuadro a 30 fps: la muñeca sigue bajando hacia el reposo
DESCENT_MAX_TRIM = 0.4

# Los umbrales en cuadros están calibrados a 30 fps. `rate` = fps/30: a 15 fps (rate 0.5) cada umbral
# en cuadros se escala por rate (mismo tiempo) y cada umbral de velocidad por cuadro se divide por rate.
BASE_FPS = 30.0
MIN_FRAMES = {"rest": 2, "still": 2, "pause": 2, "min_len": 2, "max_len": 2, "post_still": 1}


def scale_frames(base: int, rate: float, lo: int = 1) -> int:
    """Umbral en cuadros calibrado a 30 fps → cuadros a la tasa actual (rate = fps/30), mínimo `lo`."""
    return max(lo, round(base * rate))


def trim_descent(ys, rate: float = 1.0) -> int:
    """ys: y de la muñeca más alta por cuadro del segmento. Devuelve el índice del último cuadro que se
    conserva tras quitar la bajada final hacia el reposo (nunca más del 40 % del segmento)."""
    dy = DESCENT_DY / rate
    b = len(ys) - 1
    lo = b - int(DESCENT_MAX_TRIM * len(ys))
    while b > max(0, lo) and ys[b] - ys[b - 1] > dy:
        b -= 1
    return b


def _top_y(hands: np.ndarray, present: np.ndarray) -> float:
    """y de la muñeca más alta presente (y crece hacia abajo)."""
    ys = hands[:, 0, 1][present]
    return float(ys.min()) if ys.size else float("nan")


class Segmenter:
    """Cierra un segmento activo, en este orden de prioridad:
    1) reposo: la mano vuelve abajo (o desaparece) `rest_frames` cuadros;
    2) quietud: la muñeca casi no se mueve `still_frames` cuadros (Práctica lo desactiva);
    3) max_len: tope de longitud.
    Los parámetros (cuadros y velocidad por cuadro) están a 30 fps; `rate` = fps/30 los lleva a la tasa real."""

    def __init__(self, rest_y: float = REST_Y, still_speed: float = 0.04, rest_frames: int = 6,
                 still_frames: int = 12, pause_frames: int = 45, min_len: int = 6, max_len: int = 75,
                 rate: float = 1.0):
        self.rest_y, self.still_speed = rest_y, still_speed
        self.rest_frames, self.still_frames, self.pause_frames = rest_frames, still_frames, pause_frames
        self.min_len, self.max_len = min_len, max_len
        self.rate = rate
        self.state = "idle"
        self.start = self.last_active = -1
        self.rest_count = self.still_count = self.idle_count = 0
        self.pending = 0
        self.need_motion = False
        self.post_still = False
        self.ys: list[float] = []  # y de la muñeca más alta por cuadro del segmento activo
        self.prev_w: np.ndarray | None = None
        self.prev_p: np.ndarray | None = None

    def set_rate(self, rate: float) -> None:
        """rate = fps estimados / 30. Se puede cambiar en cualquier cuadro."""
        self.rate = rate

    def frames(self, name: str) -> int:
        """Umbral `name` (rest, still, pause, min_len, max_len, post_still) en cuadros a la tasa actual."""
        base = POST_STILL_MIN if name == "post_still" else getattr(
            self, name if name in ("min_len", "max_len") else f"{name}_frames")
        return scale_frames(base, self.rate, MIN_FRAMES[name])

    def speed_limit(self) -> float:
        """Velocidad de quietud por cuadro a la tasa actual (a 15 fps la muñeca recorre el doble por cuadro)."""
        return self.still_speed / self.rate

    def _speed(self, hands: np.ndarray, present: np.ndarray) -> float:
        w = hands[:, 0, :2]
        sp = 0.0
        if self.prev_w is not None:
            for s in (0, 1):
                if present[s] and self.prev_p[s]:
                    sp = max(sp, float(np.linalg.norm(w[s] - self.prev_w[s])))
        self.prev_w, self.prev_p = w.copy(), present.copy()
        return sp

    def _close(self, end: int, reason: str) -> list[SegEvent]:
        start = self.start
        self.state = "idle"
        self.idle_count = 0
        self.need_motion = reason == "quietud"
        if end - start + 1 < self.frames("min_len"):
            return []
        if reason == "reposo" and self.post_still:
            # se juzga sin la bajada final: una seña real tras un sostén también termina bajando
            ys = self.ys[:end - start + 1]
            keep = trim_descent(ys, self.rate)
            if keep + 1 < self.frames("post_still") or ys[keep] - ys[0] > POST_STILL_DROP:
                return []  # tras un sostén: bajar la mano al reposo no es una seña
        self.pending += 1
        return [SegEvent("end", start, end, reason)]

    def update(self, idx: int, hands: np.ndarray, present: np.ndarray) -> list[SegEvent]:
        active = bool((present & (hands[:, 0, 1] < self.rest_y)).any())
        speed = self._speed(hands, present)
        if self.state == "idle":
            if active and (not self.need_motion or speed >= 2 * self.speed_limit()):
                self.state, self.start, self.last_active = "active", idx, idx
                self.rest_count = self.still_count = 0
                self.post_still = self.need_motion
                self.need_motion = False
                self.ys = [_top_y(hands, present)]
                return []
            if not active:
                self.need_motion = False
                self.idle_count += 1
                # ">=": si la tasa cambia a media espera, la pausa no se salta (pending vuelve a 0)
                if self.idle_count >= self.frames("pause") and self.pending:
                    self.pending = 0
                    return [SegEvent("pause")]
            return []
        if active:
            self.last_active = idx
            self.rest_count = 0
            self.still_count = self.still_count + 1 if speed < self.speed_limit() else 0
        else:
            self.rest_count += 1
        self.ys.append(_top_y(hands, present))
        length = idx - self.start + 1
        # prioridad: reposo → quietud → max_len
        still = self.frames("still")
        if self.rest_count >= self.frames("rest"):
            return self._close(self.last_active, "reposo")
        if self.still_count >= still and length >= self.frames("min_len") + still:
            return self._close(idx, "quietud")
        if length >= self.frames("max_len"):
            return self._close(idx, "max_len")
        return []
