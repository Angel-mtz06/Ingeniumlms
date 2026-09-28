"""Referencia corporal = la cabeza (centro y ancho en px), igual para todas las fuentes."""
from __future__ import annotations

import numpy as np

from lsm.schema import FACE_CHEEK_A, FACE_CHEEK_B, FACE_NOSE, RawSequence

# ancho de cabeza ≈ ancho del bloque pixelado × este factor (calibrar con training/calibrate_facebox.py)
FACEBOX_TO_HEAD = 0.85
# distancia entre orejas (pose) ≈ 0.83 × distancia entre mejillas (malla): se lleva a la misma unidad
EAR_TO_CHEEK = 1.21
POSE_NOSE, POSE_EAR_A, POSE_EAR_B = 0, 7, 8
MIN_VIS = 0.5


class AnchorError(ValueError):
    pass


def frame_anchor(raw: RawSequence, t: int) -> tuple[float, float, float] | None:
    f = raw.face[t]
    if not np.isnan(f[FACE_NOSE, 0]) and not np.isnan(f[FACE_CHEEK_A, 0]) and not np.isnan(f[FACE_CHEEK_B, 0]):
        s = float(np.linalg.norm(f[FACE_CHEEK_A, :2] - f[FACE_CHEEK_B, :2]))
        if s > 1e-3:
            return float(f[FACE_NOSE, 0]), float(f[FACE_NOSE, 1]), s
    p = raw.pose[t]
    if not np.isnan(p[POSE_NOSE, 0]) and min(p[POSE_NOSE, 3], p[POSE_EAR_A, 3], p[POSE_EAR_B, 3]) > MIN_VIS:
        s = float(np.linalg.norm(p[POSE_EAR_A, :2] - p[POSE_EAR_B, :2])) * EAR_TO_CHEEK
        if s > 1e-3:
            return float(p[POSE_NOSE, 0]), float(p[POSE_NOSE, 1]), s
    b = raw.face_box[t]
    if not np.isnan(b[0]) and b[2] > b[0]:
        return float((b[0] + b[2]) / 2), float((b[1] + b[3]) / 2), float((b[2] - b[0]) * FACEBOX_TO_HEAD)
    return None


def head_anchor(raw: RawSequence) -> np.ndarray:
    out = np.full((raw.T, 3), np.nan, np.float32)
    for t in range(raw.T):
        a = frame_anchor(raw, t)
        if a is not None:
            out[t] = a
    ok = ~np.isnan(out[:, 0])
    if not ok.any():
        raise AnchorError(f"sin referencia de cabeza en {raw.sample_id}")
    out[~ok] = np.median(out[ok], axis=0)
    return out
