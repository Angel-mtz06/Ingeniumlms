"""Aumentación para compensar ~10–22 personas por seña."""
from __future__ import annotations

import numpy as np

from lsm.normalize import NormSequence


def augment(norm: NormSequence, rng: np.random.Generator, p_mirror: float = 0.3) -> NormSequence:
    h = norm.hands.copy()
    p = norm.present.copy()
    T = h.shape[0]
    if T >= 4:  # recorte temporal (≥85 %)
        n = max(2, int(round(T * rng.uniform(0.85, 1.0))))
        s0 = int(rng.integers(0, T - n + 1))
        h, p = h[s0:s0 + n], p[s0:s0 + n]
    if rng.random() < p_mirror:  # espejo: persona zurda
        h[..., 0] *= -1
        h, p = h[:, ::-1].copy(), p[:, ::-1].copy()
    ang = np.radians(rng.uniform(-15, 15))
    R = np.array([[np.cos(ang), -np.sin(ang)], [np.sin(ang), np.cos(ang)]], np.float32)
    scale = rng.uniform(0.85, 1.15)
    shift = rng.uniform(-0.3, 0.3, size=2).astype(np.float32)
    h[..., :2] = (h[..., :2] @ R.T) * scale + shift
    h[..., 2] *= scale
    p &= ~(rng.random(p.shape) < 0.05)  # manos perdidas
    h[~p] = 0
    return NormSequence(hands=h.astype(np.float32), present=p, sample_id=norm.sample_id, signer=norm.signer)
