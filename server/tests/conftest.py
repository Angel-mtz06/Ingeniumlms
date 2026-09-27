import math

import numpy as np

from lsm.schema import RawSequence

X_OFF = (-0.6, -0.3, 0.0, 0.3, 0.6)  # pulgar..meñique


def make_hand(wrist=(0.0, 0.0), size=1.0, flex=(0, 0, 0, 0, 0)) -> np.ndarray:
    """Mano sintética (21,3). La base de cada dedo está a y=-1 (arriba en la imagen).
    Con flex=0 el dedo sigue la dirección muñeca→base; flex rota esa dirección en el plano xy."""
    pts = np.zeros((21, 3), np.float32)
    for f in range(5):
        ids = [1 + 4 * f, 2 + 4 * f, 3 + 4 * f, 4 + 4 * f]
        base = np.array([X_OFF[f], -1.0, 0.0])
        d = base / np.linalg.norm(base)
        th = math.radians(flex[f])
        dr = np.array([d[0] * math.cos(th) - d[1] * math.sin(th), d[0] * math.sin(th) + d[1] * math.cos(th), 0.0])
        for k, i in enumerate(ids):
            pts[i] = base + dr * (0.8 * k / 3)
    pts = pts * size
    pts[:, 0] += wrist[0]
    pts[:, 1] += wrist[1]
    return pts


def raw_with_head(T=5, head=(320.0, 100.0), head_w=30.0, hands_px=None) -> RawSequence:
    """Secuencia con pose (nariz + orejas visibles) y manos opcionales en píxeles.
    hands_px: lista de longitud T; cada elemento es una lista de arrays (21,3)."""
    raw = RawSequence.empty(T, 640, 480, fps=30.0, sample_id="s", dataset="test", source_label="X", signer="t01")
    for t in range(T):
        raw.pose[t, :, 3] = 0.0
        raw.pose[t, 0] = [head[0], head[1], 0, 0.99]
        raw.pose[t, 7] = [head[0] + head_w / 2, head[1], 0, 0.99]
        raw.pose[t, 8] = [head[0] - head_w / 2, head[1], 0, 0.99]
        if hands_px is not None:
            for k, h in enumerate(hands_px[t][:2]):
                raw.hands[t, k] = h
    return raw
