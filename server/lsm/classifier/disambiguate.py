"""Desempate conservador entre pares de señas que el clasificador confunde, con las referencias del modelo activo.

Cuando las dos del par están arriba y con probabilidades parecidas:
- HOLA/NO: gana la que tiene la forma de los dedos (índice a meñique) más parecida a su referencia.
- CÓMO/HOSPITAL: la forma de los dedos no alcanza (las tomas de CÓMO varían mucho), así que se usa el puntaje completo
  de Práctica contra cada referencia (configuración, ubicación, movimiento y orientación): gana la que saca clara
  ventaja. En los ejemplos de las referencias: CÓMO 84 contra 58, HOSPITAL 98 contra 75.
El desempate solo intercambia las probabilidades: no vuelve segura una lectura débil.
"""
from __future__ import annotations

import numpy as np

from lsm.evaluator.references import GlossRef, sample_stats
from lsm.normalize import NormSequence

PAIRS: tuple[tuple[str, str], ...] = (("HOLA", "NO"),)
SCORE_PAIRS: tuple[tuple[str, str], ...] = (("COMO", "HOSPITAL"),)
SCORE_MIN = 60.0     # la ganadora tiene que parecerse de verdad a su referencia…
SCORE_MARGIN = 12.0  # …y sacarle esta ventaja (puntos de 0 a 100) a la otra


def distinguish_pair(top: list, seq: NormSequence, references: dict[str, GlossRef], pair: tuple[str, str]) -> list:
    # Solo disputas entre estas dos candidatas. No inventar una alternativa ausente
    # ni cambiar una predicción firme a partir de una sola medida geométrica.
    names = set(pair)
    candidates = {g: p for g, p in top if g in names}
    signs = [g for g, _ in top if g != "NINGUNA"]
    if (len(candidates) != 2 or not signs or signs[0] not in names
            or not names <= references.keys()
            or abs(candidates[pair[0]] - candidates[pair[1]]) > .2):
        return top
    a, b = references[pair[0]], references[pair[1]]
    # Las manos que usan las dos referencias (HOLA/NO: la dominante; CÓMO/HOSPITAL: las dos).
    slots = [s for s in (0, 1) if a.slots_used[s] and b.slots_used[s]] or [a.dom]
    stats = sample_stats(seq)
    if any(stats["present_frac"][s] < .75 for s in slots):
        return top
    errors = {}
    for gloss in pair:
        ref = references[gloss]
        # Índice a meñique: la flexión distingue las configuraciones de estas
        # referencias; la posición de la mano o el objetivo elegido no decide.
        z = [np.abs(stats["flex"][s, 1:] - ref.flex_mean[s, 1:]) / np.maximum(ref.flex_std[s, 1:], 12.) for s in slots]
        z = np.concatenate(z)
        if not np.isfinite(z).all():
            return top
        errors[gloss] = float(np.mean(z))
    winner = min(errors, key=errors.get)
    loser = next(g for g in pair if g != winner)
    if errors[winner] > 2. or errors[loser] - errors[winner] < 1. or candidates[winner] >= candidates[loser]:
        return top
    # Conservar la confianza total y su incertidumbre: el desempate no convierte
    # una salida débil del modelo en una seña segura.
    return sorted([[g, candidates[loser] if g == winner else candidates[winner] if g == loser else p]
                   for g, p in top], key=lambda item: -item[1])


def _pair_in_dispute(top: list, references: dict, pair: tuple[str, str]) -> dict | None:
    names = set(pair)
    candidates = {g: p for g, p in top if g in names}
    signs = [g for g, _ in top if g != "NINGUNA"]
    if (len(candidates) != 2 or not signs or signs[0] not in names or not names <= references.keys()
            or abs(candidates[pair[0]] - candidates[pair[1]]) > .2):
        return None
    return candidates


def distinguish_by_score(top: list, seq: NormSequence, references: dict[str, GlossRef], pair: tuple[str, str]) -> list:
    """Desempate con el puntaje completo contra cada referencia (el mismo de Práctica, con cualquiera de las manos)."""
    from lsm.evaluator.scoring import evaluate_either_hand  # aquí: scoring importa mucho y solo hace falta al desempatar
    candidates = _pair_in_dispute(top, references, pair)
    if candidates is None or not seq.present.any():
        return top
    nan_flex, nan_contact = np.full((2, 5), np.nan), np.full((2, 4), np.nan)
    totals = {g: float(evaluate_either_hand(references[g], seq, nan_flex, nan_contact).total) for g in pair}
    if not all(np.isfinite(v) for v in totals.values()):
        return top
    winner = max(totals, key=totals.get)
    loser = next(g for g in pair if g != winner)
    if totals[winner] < SCORE_MIN or totals[winner] - totals[loser] < SCORE_MARGIN or candidates[winner] >= candidates[loser]:
        return top
    return sorted([[g, candidates[loser] if g == winner else candidates[winner] if g == loser else p]
                   for g, p in top], key=lambda item: -item[1])


def distinguish_hola_no(top: list, seq: NormSequence, references: dict[str, GlossRef]) -> list:
    return distinguish_pair(top, seq, references, ("HOLA", "NO"))


def distinguish_pairs(top: list, seq: NormSequence, references: dict[str, GlossRef]) -> list:
    """Aplica el desempate de cada par de PAIRS (por la forma de los dedos) y de SCORE_PAIRS (por el puntaje)."""
    for pair in PAIRS:
        top = distinguish_pair(top, seq, references, pair)
    for pair in SCORE_PAIRS:
        top = distinguish_by_score(top, seq, references, pair)
    return top
