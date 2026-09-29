"""Clase NINGUNA: las tomas largas de "no seña" se trocean en ventanas del tamaño de un segmento en vivo."""
from __future__ import annotations

import numpy as np

from lsm.normalize import NormSequence

NONE_GLOSS = "NINGUNA"
WINDOW_SIZES = (20, 30, 45, 60, 90, 120)  # de un gesto corto al tope de un segmento de Traducción (120)
WINDOW_STEP = 30
MAX_WINDOWS = 8  # por toma: que 10 s de NINGUNA no pesen como decenas de tomas de una seña


def window_bounds(T: int, sizes=WINDOW_SIZES, step: int = WINDOW_STEP) -> list[tuple[int, int]]:
    """(inicio, fin exclusivo) de cada ventana, por tamaño y luego por inicio. Si ninguna cabe, la toma entera."""
    out = [(s, s + n) for n in sizes for s in range(0, T - n + 1, step)]
    if not out and T > 0:
        out = [(0, T)]
    return out


def windows(norm: NormSequence, min_hand_ratio: float = 0.3, sizes=WINDOW_SIZES, step: int = WINDOW_STEP,
            max_windows: int = MAX_WINDOWS) -> list[NormSequence]:
    """Ventanas de `norm` con sample_id `<id>_w<k>` (k = índice en window_bounds). Se omiten las ventanas
    con manos en menos de `min_hand_ratio` de los cuadros (el segmentador en vivo nunca las produciría) y,
    de las que quedan, se toman como mucho `max_windows` repartidas de manera uniforme (determinista)."""
    bounds = window_bounds(norm.T, sizes, step)
    keep = [k for k, (a, b) in enumerate(bounds) if norm.present[a:b].any(axis=1).mean() >= min_hand_ratio]
    if len(keep) > max_windows:
        keep = [keep[i] for i in sorted(set(np.linspace(0, len(keep) - 1, max_windows).round().astype(int)))]
    return [NormSequence(np.ascontiguousarray(norm.hands[a:b]), np.ascontiguousarray(norm.present[a:b]),
                         f"{norm.sample_id}_w{k}", norm.signer)
            for k in keep for a, b in [bounds[k]]]
