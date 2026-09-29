"""Clase NINGUNA: las tomas largas de "no seña" se trocean en ventanas del tamaño de un segmento en vivo."""
from __future__ import annotations

import numpy as np

from lsm.normalize import NormSequence

NONE_GLOSS = "NINGUNA"
WINDOW_SIZES = (45, 60, 90)
WINDOW_STEP = 30


def window_bounds(T: int, sizes=WINDOW_SIZES, step: int = WINDOW_STEP) -> list[tuple[int, int]]:
    """(inicio, fin exclusivo) de cada ventana, por tamaño y luego por inicio. Si ninguna cabe, la toma entera."""
    out = [(s, s + n) for n in sizes for s in range(0, T - n + 1, step)]
    if not out and T > 0:
        out = [(0, T)]
    return out


def windows(norm: NormSequence, min_hand_ratio: float = 0.3, sizes=WINDOW_SIZES,
            step: int = WINDOW_STEP) -> list[NormSequence]:
    """Ventanas de `norm` con sample_id `<id>_w<k>` (k = índice en window_bounds). Se omiten las ventanas
    con manos en menos de `min_hand_ratio` de los cuadros (el segmentador en vivo nunca las produciría)."""
    out = []
    for k, (a, b) in enumerate(window_bounds(norm.T, sizes, step)):
        present = norm.present[a:b]
        if present.any(axis=1).mean() < min_hand_ratio:
            continue
        out.append(NormSequence(np.ascontiguousarray(norm.hands[a:b]), np.ascontiguousarray(present),
                                f"{norm.sample_id}_w{k}", norm.signer))
    return out
