"""Características por cuadro, compartidas por el entrenamiento y el servidor en vivo."""
from __future__ import annotations

import numpy as np

from lsm.normalize import NormSequence

T_OUT = 16
HAND_DIM = 72
F_DIM = 2 * HAND_DIM + 6
REST_Y = 3.5  # muñeca más abajo que 3.5 anchos de cabeza bajo la nariz = reposo
FINGERS = ((1, 4), (5, 8), (9, 12), (13, 16), (17, 20))  # (base, punta): pulgar..meñique


def _angle(v1: np.ndarray, v2: np.ndarray) -> float:
    n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
    if n1 < 1e-9 or n2 < 1e-9:
        return 0.0
    # Use atan2 with full 3D cross product magnitude for numerical stability
    cross_mag = np.linalg.norm(np.cross(v1, v2))
    dot = float(np.dot(v1, v2))
    angle_rad = float(np.arctan2(cross_mag, dot))
    return float(np.degrees(angle_rad))


def finger_flexion(hand: np.ndarray) -> np.ndarray:
    """Ángulo entre (base − muñeca) y (punta − base) por dedo. 0° = recto."""
    return np.array([_angle(hand[b] - hand[0], hand[tip] - hand[b]) for b, tip in FINGERS], np.float32)


def hand_local(hand: np.ndarray) -> np.ndarray:
    loc = hand - hand[0]
    s = np.linalg.norm(loc[9])
    return (loc / s if s > 1e-9 else loc).astype(np.float32)


def active_span(norm: NormSequence, pad: int = 1) -> tuple[int, int]:
    wrist_y = norm.hands[:, :, 0, 1]
    active = (norm.present & (wrist_y < REST_Y)).any(axis=1)
    idx = np.flatnonzero(active)
    if idx.size == 0:
        return 0, norm.T - 1
    return max(0, int(idx[0]) - pad), min(norm.T - 1, int(idx[-1]) + pad)


def resample(norm: NormSequence, start: int, end: int, t_out: int = T_OUT):
    src = np.arange(start, end + 1)
    q = np.linspace(start, end, t_out)
    hands = np.zeros((t_out, 2, 21, 3), np.float32)
    present = np.zeros((t_out, 2), bool)
    for s in (0, 1):
        pres = norm.present[start:end + 1, s]
        present[:, s] = np.interp(q, src, pres.astype(np.float32)) >= 0.5
        if pres.any():
            ts = src[pres]
            vals = norm.hands[start:end + 1][pres, s].reshape(len(ts), -1)
            cols = [np.interp(q, ts, vals[:, c]) for c in range(vals.shape[1])]
            hands[:, s] = np.stack(cols, axis=1).reshape(t_out, 21, 3)
    hands[~present] = 0
    return hands, present


def featurize(norm: NormSequence, t_out: int = T_OUT) -> np.ndarray:
    start, end = active_span(norm)
    hands, present = resample(norm, start, end, t_out)
    f = np.zeros((t_out, F_DIM), np.float32)
    for s in (0, 1):
        o = s * HAND_DIM
        for t in range(t_out):
            if not present[t, s]:
                continue
            h = hands[t, s]
            f[t, o] = 1.0
            f[t, o + 1:o + 4] = h[0]
            f[t, o + 4:o + 67] = hand_local(h).ravel()
            f[t, o + 67:o + 72] = finger_flexion(h) / 180.0
        w = hands[:, s, 0]
        vel = np.diff(w, axis=0, prepend=w[:1])
        both = present[:, s] & np.concatenate([[False], present[:-1, s]])
        vel[~both] = 0
        f[:, 2 * HAND_DIM + 3 * s:2 * HAND_DIM + 3 * s + 3] = vel
    return f
