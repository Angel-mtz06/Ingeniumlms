"""Mano de más en una seña de palabras (la misma idea que el alfabeto con dos manos a la vista).

Si una mano hace la seña y la otra está en reposo (muñeca bajo REST_Y) o casi quieta, esa otra mano puede ser
de más: se clasifica también SIN ella y, si así la seña sale más clara, se usa esa lectura. La lectura con las dos
manos se queda si empata (el modelo se entrenó con la otra mano a la vista a veces) y siempre que la versión sin
ella no sea NINGUNA; así las señas de dos manos con una mano base quieta no pierden esa mano.
"""
from __future__ import annotations

from typing import Callable, Sequence

import numpy as np

from lsm.features import REST_Y
from lsm.normalize import NormSequence
from lsm.windows import NONE_GLOSS

IDLE_REST_FRAC = 0.6  # la otra mano en reposo al menos esta fracción de los cuadros en que se ve
STILL_TRAVEL = 0.6    # ... o casi quieta: recorrido de su muñeca (anchos de cabeza) en todo el segmento
MOVE_TRAVEL = 1.5     # mientras la que hace la seña sí se mueve
ALT_MARGIN = 0.05     # sin la otra mano, la seña tiene que ganar por esto


def _travel(norm: NormSequence, s: int) -> float:
    w = norm.hands[norm.present[:, s], s, 0, :2]
    return float(np.linalg.norm(np.diff(w, axis=0), axis=1).sum()) if len(w) > 1 else 0.0


def extra_hands(norm: NormSequence) -> list[int]:
    """Slots que pueden sobrar: la mano en reposo casi todo el tiempo, o quieta mientras la otra se mueve."""
    if not (norm.present[:, 0].any() and norm.present[:, 1].any()):
        return []
    act = norm.present & (norm.hands[:, :, 0, 1] < REST_Y)
    out = []
    for s in (0, 1):
        o = 1 - s
        if not act[:, o].any():
            continue
        resting = 1.0 - float(act[norm.present[:, s], s].mean())
        still = _travel(norm, s) < STILL_TRAVEL and _travel(norm, o) >= MOVE_TRAVEL
        if resting >= IDLE_REST_FRAC or still:
            out.append(s)
    return out


def without(norm: NormSequence, s: int) -> NormSequence:
    """La misma secuencia sin la mano del slot `s` (como si no se hubiera visto)."""
    hands, present = norm.hands.copy(), norm.present.copy()
    hands[:, s] = 0
    present[:, s] = False
    return NormSequence(hands, present, norm.sample_id, norm.signer)


def focus(probs: Callable[[NormSequence], np.ndarray], labels: Sequence[str],
          norm: NormSequence) -> tuple[np.ndarray, NormSequence]:
    """Probabilidades de la seña y la secuencia con que se leyó (sin la mano de más, si así sale más clara)."""
    best, used = probs(norm), norm
    for s in extra_hands(norm):
        alt_norm = without(norm, s)
        alt = probs(alt_norm)
        i = int(np.argmax(alt))
        if labels[i] != NONE_GLOSS and alt[i] > float(best.max()) + ALT_MARGIN:
            best, used = alt, alt_norm
    return best, used
