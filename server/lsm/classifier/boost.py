"""Sensibilidad por seña: las señas más usadas en la demo se reconocen con más facilidad.

La probabilidad de cada seña de SIGN_BOOST se multiplica por su factor y se vuelve a normalizar: con 1.8, HOLA con
0.29 le gana a NO con 0.39, pero una seña que el clasificador casi no vio (0.03 contra NINGUNA 0.79) no aparece de la
nada. Aplica en Interpretación, Práctica y los juegos.

LSM_SIGN_BOOST cambia la lista: "0" la apaga; "HOLA=2,MAMA=1.5" usa esos factores en lugar de los de aquí.
"""
from __future__ import annotations

import logging
import os
from typing import Sequence

import numpy as np

SIGN_BOOST: dict[str, float] = {"HOLA": 1.8, "GRACIAS": 1.8, "POR_FAVOR": 1.8, "AYUDA": 1.8, "MAMA": 1.8,
                                "COMO": 1.8, "ESTAR": 1.8}
MAX_BOOST = 5.0

log = logging.getLogger(__name__)


def sign_boost(env: dict | None = None) -> dict[str, float]:
    """Factores de sensibilidad (de LSM_SIGN_BOOST si viene; si no, SIGN_BOOST). Valores fuera de (0, MAX_BOOST] se
    ignoran."""
    raw = (os.environ if env is None else env).get("LSM_SIGN_BOOST")
    if raw is None:
        return dict(SIGN_BOOST)
    raw = raw.strip()
    if raw in ("", "0"):
        return {}
    out: dict[str, float] = {}
    for part in raw.split(","):
        gloss, _, value = part.partition("=")
        try:
            f = float(value)
        except ValueError:
            log.warning("LSM_SIGN_BOOST: no entiendo %r", part)
            continue
        if gloss.strip() and 0 < f <= MAX_BOOST:
            out[gloss.strip().upper()] = f
    return out


def apply_boost(p: np.ndarray, labels: Sequence[str], boost: dict[str, float]) -> np.ndarray:
    """Probabilidades con los factores aplicados y vueltas a normalizar (sin factores, las mismas)."""
    if not boost:
        return p
    w = np.array([boost.get(g, 1.0) for g in labels], dtype=np.float64)
    q = np.asarray(p, dtype=np.float64) * w
    s = q.sum()
    return (q / s).astype(np.float32) if s > 0 else p
