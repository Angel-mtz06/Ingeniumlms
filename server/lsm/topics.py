"""Temas de conversación de Interpretación: las glosas del tema elegido reciben un empujón en el reordenamiento.

Cada tema junta categorías de `lsm.themes` más unas palabras "núcleo" que aparecen en cualquier conversación.
El empujón suma log(boost) al puntaje de la candidata (boost = LSM_TOPIC_BOOST, por defecto 3) y solo reordena
dentro del top-k, con los mismos límites que el contexto (ver `lsm.context.rerank`). "todo" = sin empujón.
"""
from __future__ import annotations

import logging
import math
import os

from lsm.themes import THEME_OF
from lsm.windows import NONE_GLOSS

ALL = "todo"
TOPIC_THEMES: dict[str, tuple[str, ...]] = {
    "saludos": ("Saludos y cortesía", "Personas", "Preguntas", "Respuestas y descripciones", "Comunicación",
                "Tiempo"),
    "salud": ("Salud y síntomas", "Cuerpo", "Profesiones", "Lugares", "Acciones", "Tiempo"),
    "emergencias": ("Emergencias", "Profesiones", "Lugares", "Acciones", "Salud y síntomas"),
}
CORE = frozenset("YO MI SU EL SI NO COMO DONDE CUANTO AHORA AYUDA NECESITAR TENER IR POR_FAVOR GRACIAS".split())
TOPICS: dict[str, frozenset[str]] = {
    name: frozenset({g for g, t in THEME_OF.items() if t in themes} | CORE) - {NONE_GLOSS}
    for name, themes in TOPIC_THEMES.items()
}
NAMES = (ALL, *TOPICS)  # valores válidos del mensaje {"type": "topic"}
DEFAULT_BOOST = 3.0
BOOST_RANGE = (1.0, 20.0)

log = logging.getLogger(__name__)


def topic_glosses(topic: str | None) -> frozenset[str]:
    """Glosas que reciben el empujón con `topic`; vacío para "todo" o un tema desconocido."""
    return TOPICS.get(topic or ALL, frozenset())


def topic_boost(env: dict | None = None) -> float:
    """Factor del empujón desde LSM_TOPIC_BOOST (por defecto 3; acotado a 1–20; 1 = sin empujón)."""
    raw = (os.environ if env is None else env).get("LSM_TOPIC_BOOST", "").strip()
    if not raw:
        return DEFAULT_BOOST
    try:
        b = float(raw)
    except ValueError:
        log.warning("LSM_TOPIC_BOOST inválido (%r); uso %.1f", raw, DEFAULT_BOOST)
        return DEFAULT_BOOST
    if not math.isfinite(b):
        return DEFAULT_BOOST
    return min(BOOST_RANGE[1], max(BOOST_RANGE[0], b))
